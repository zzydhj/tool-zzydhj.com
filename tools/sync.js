/* ══════════════════════════════════════════════════════════════════
   CloudSync —— 通用 localStorage ⇄ Cloudflare Pages 云同步桥
   - 各工具只需在自身主 <script> 之前引入本文件即可，无需改任何逻辑
   - 未配置 Token：完全等同原来的纯本地行为（不发任何网络请求）
   - 已配置：打开时拉取云端(远端更新则应用并刷新一次)，编辑后防抖自动上传
   - 右下角悬浮小部件：状态 + 立即上传 / 立即下载 / 设置
   后端 API:  /api/sync/:key  （GET / PUT，见 functions/api/sync/[key].js）
   ══════════════════════════════════════════════════════════════════ */
(function () {
  var CFG_EP = 'cs_endpoint';
  var CFG_TK = 'cs_token';
  var CFG_META = 'cs_meta';
  var DEF_EP = '/api/sync';

  // 每个页面需要镜像到云端的 localStorage key
  var MIRROR = {
    '提示词工具': ['prompt_manager_data', 'prompt_manager_settings'],
    '样式代码库': ['sniplib_v3'],
    'R2 文件链接生成器': ['r2_buckets', 'r2_domains'],
  };

  function detectKeys() {
    var p;
    try { p = decodeURIComponent(location.pathname); } catch (e) { p = location.pathname; }
    for (var name in MIRROR) { if (p.indexOf(name) >= 0) return MIRROR[name]; }
    return [];
  }

  var KEYS = detectKeys();
  if (KEYS.length === 0) return; // 非数据类工具页，直接退出

  var _setItem = localStorage.setItem.bind(localStorage);
  var _getItem = localStorage.getItem.bind(localStorage);

  var ready = false;      // 初次拉取完成后才允许自动上传，避免"默认数据"误覆盖云端
  var _applying = false;  // 正在写入远端数据时，抑制自动上传，防回环
  var lastSync = 0;

  function endpoint() { return (_getItem(CFG_EP) || DEF_EP).replace(/\/+$/, ''); }
  function token() { return _getItem(CFG_TK) || ''; }
  function enabled() { return !!token(); }
  function getMeta() { try { return JSON.parse(_getItem(CFG_META) || '{}'); } catch (e) { return {}; } }
  function setMeta(m) { _setItem(CFG_META, JSON.stringify(m)); }

  // ── 拦截 setItem：命中镜像 key 且已就绪时，防抖上传 ──
  localStorage.setItem = function (k, v) {
    _setItem(k, v);
    if (ready && !_applying && KEYS.indexOf(k) >= 0 && enabled()) schedulePush(k);
  };

  var timers = {};
  function schedulePush(k) {
    if (timers[k]) clearTimeout(timers[k]);
    timers[k] = setTimeout(function () { doPush(k); }, 1200);
  }

  function headers() {
    var h = { 'Content-Type': 'text/plain' };
    var t = token();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  function doPush(k) {
    var ep = endpoint();
    status('syncing');
    return fetch(ep + '/' + encodeURIComponent(k), {
      method: 'PUT', headers: headers(), body: localStorage.getItem(k) || '',
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var m = getMeta(); m[k] = j.updatedAt; setMeta(m);
      lastSync = Date.now(); status('ok');
    }).catch(function () { status('error'); });
  }

  function uploadAll() {
    if (!enabled()) { status('off'); return; }
    Promise.all(KEYS.map(function (k) { return doPush(k); })).then(function () {
      status('ok'); toast('已上传全部数据到云端');
    });
  }

  // 拉取云端并应用。force=true 时无条件用远端覆盖本地；reload 决定是否刷新
  function pullAll(force, reload) {
    if (!enabled()) { status('off'); return Promise.resolve(); }
    var ep = endpoint();
    status('syncing');
    return Promise.all(KEYS.map(function (k) {
      return fetch(ep + '/' + encodeURIComponent(k), { headers: headers() })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) { return { k: k, j: j }; })
        .catch(function (e) { return { k: k, err: e }; });
    })).then(function (res) {
      var changed = false, errs = 0, m = getMeta();
      res.forEach(function (r) {
        if (r.err) { errs++; return; }
        var k = r.k, j = r.j, localTs = m[k] || 0;
        if (j.value != null) {
          if (force || j.updatedAt > localTs) {
            _applying = true; _setItem(k, j.value); _applying = false;
            m[k] = j.updatedAt; changed = true;
          } else if (localTs > j.updatedAt) {
            doPush(k); // 本地更新，回推
          }
        } else {
          // 远端为空：本地若已有数据，则作为首次备份上传
          if (localStorage.getItem(k) != null) doPush(k);
        }
      });
      setMeta(m);
      if (errs === res.length) { status('error'); ready = true; return; }
      lastSync = Date.now(); status('ok');
      if (changed && reload) {
        if (!sessionStorage.getItem('cs_reloaded')) {
          sessionStorage.setItem('cs_reloaded', '1');
          location.reload();
          return;
        }
      }
      ready = true;
    });
  }

  function downloadAll() {
    pullAll(true, true);
  }

  // ───────────────────────── 悬浮小部件 ─────────────────────────
  var stateEl, dotEl, epEl, tkEl, timeEl;
  var STATE = {
    off: ['#999', '未配置'], syncing: ['#e0a800', '同步中'],
    ok: ['#2ecc71', '已同步'], error: ['#e74c3c', '离线/错误'],
  };
  function status(s) {
    if (stateEl && STATE[s]) {
      dotEl.style.background = STATE[s][0];
      stateEl.textContent = STATE[s][1];
      if (timeEl) timeEl.textContent = lastSync ? ('上次: ' + new Date(lastSync).toLocaleTimeString()) : '';
    }
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;right:16px;bottom:70px;background:#222;color:#eee;padding:8px 12px;border-radius:8px;font-size:12px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.3)';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1800);
  }

  function buildWidget() {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:99998;font-family:-apple-system,Segoe UI,Microsoft YaHei,sans-serif;';

    var btn = document.createElement('button');
    btn.innerHTML = '<span id="cs-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#999;margin-right:6px;vertical-align:middle;"></span><span id="cs-state">云同步</span>';
    btn.style.cssText = 'background:#2a2a2a;color:#eee;border:1px solid #444;border-radius:20px;padding:7px 14px;font-size:12px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)';
    wrap.appendChild(btn);
    document.body.appendChild(wrap);

    var panel = document.createElement('div');
    panel.style.cssText = 'display:none;position:fixed;right:14px;bottom:56px;width:260px;background:#242424;color:#ddd;border:1px solid #444;border-radius:12px;padding:16px;font-size:12px;z-index:99999;box-shadow:0 8px 30px rgba(0,0,0,.4)';
    panel.innerHTML =
      '<div style="font-weight:600;margin-bottom:10px;">☁️ 云端同步</div>' +
      '<div style="margin-bottom:10px;color:#bbb;">本页同步项：<span style="color:#7fd1ff">' + KEYS.join(', ') + '</span></div>' +
      '<div style="margin-bottom:6px;"><span id="cs-dot2" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#999;margin-right:6px;"></span><span id="cs-state2">状态</span> <span id="cs-time" style="color:#777;margin-left:6px;"></span></div>' +
      '<label style="display:block;color:#888;margin-top:10px;">接口地址 (留空=同源 /api/sync)</label>' +
      '<input id="cs-ep" type="text" placeholder="/api/sync" style="width:100%;box-sizing:border-box;margin-top:4px;padding:7px 8px;border-radius:6px;border:1px solid #444;background:#1b1b1b;color:#eee;font-size:12px;">' +
      '<label style="display:block;color:#888;margin-top:10px;">访问令牌 Token</label>' +
      '<input id="cs-tk" type="text" placeholder="SYNC_TOKEN" style="width:100%;box-sizing:border-box;margin-top:4px;padding:7px 8px;border-radius:6px;border:1px solid #444;background:#1b1b1b;color:#eee;font-size:12px;">' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
      '<button data-act="save" style="flex:1;padding:8px;border:none;border-radius:6px;background:#6c47ff;color:#fff;font-size:12px;cursor:pointer;">保存</button>' +
      '<button data-act="upload" style="flex:1;padding:8px;border:none;border-radius:6px;background:#2ecc71;color:#05301a;font-weight:600;cursor:pointer;">上传</button>' +
      '<button data-act="download" style="flex:1;padding:8px;border:none;border-radius:6px;background:#3498db;color:#fff;cursor:pointer;">下载</button>' +
      '</div>' +
      '<button data-act="disable" style="margin-top:8px;width:100%;padding:6px;border:1px solid #553;background:#1b1b1b;color:#e74c3c;border-radius:6px;font-size:11px;cursor:pointer;">禁用同步(仅本地)</button>';
    document.body.appendChild(panel);

    // 引用状态元素（面板打开时才存在，故延迟取）
    btn.addEventListener('click', function () {
      var open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'block';
      if (!open) {
        epEl = panel.querySelector('#cs-ep'); tkEl = panel.querySelector('#cs-tk');
        stateEl = panel.querySelector('#cs-state2'); dotEl = panel.querySelector('#cs-dot2');
        timeEl = panel.querySelector('#cs-time');
        epEl.value = _getItem(CFG_EP) || '';
        tkEl.value = _getItem(CFG_TK) || '';
        status(enabled() ? (ready ? 'ok' : 'syncing') : 'off');
      }
    });

    panel.addEventListener('click', function (e) {
      var act = e.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'save') {
        var epv = (epEl.value || '').trim();
        if (epv) _setItem(CFG_EP, epv); else localStorage.removeItem(CFG_EP);
        _setItem(CFG_TK, (tkEl.value || '').trim());
        toast('已保存，正在重新同步');
        ready = false; sessionStorage.removeItem('cs_reloaded');
        pullAll(false, true);
      } else if (act === 'upload') {
        uploadAll();
      } else if (act === 'download') {
        toast('正在从云端下载…'); downloadAll();
      } else if (act === 'disable') {
        localStorage.removeItem(CFG_TK);
        ready = true; status('off'); toast('已禁用，仅本地存储');
      }
    });
  }

  function init() {
    buildWidget();
    if (enabled()) {
      pullAll(false, true); // 首次：拉取并按需刷新一次
    } else {
      ready = true; // 未配置：本地模式，不做任何网络请求
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
