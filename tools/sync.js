/* ══════════════════════════════════════════════════════════════════
   CloudSync —— localStorage ⇄ R2 云同步桥（单用户 / 密码门版）
   - 云端/本地由 window.__CLOUD_AUTH__.active 判定（部署即云；localhost/file 为本地）
   - 本地开发 = 纯本地模式：不发任何网络请求
   - 云端模式：进页面拉取（新者胜），编辑后防抖自动上传，每 30s 兜底 flush
   - 右下角状态点：绿=全部已同步 / 黄=同步中 / 灰=有未同步(或本地模式)
     悬停弹出面板：状态 + 上次同步 + 「立即同步 / 上传全部」
   后端 API:  /api/sync/:key  （GET / PUT，见 functions/api/sync/[key].js）
   ══════════════════════════════════════════════════════════════════ */
(function () {
  var DEF_EP = '/api/sync';
  var CFG_META = 'cs_meta';

  // 每个页面需要镜像到云端的 localStorage key（<toolKey> 与 R2 路径末段一致）
  var MIRROR = {
    '提示词工具': ['prompt_manager_data', 'prompt_manager_settings'],
    '样式代码库': ['sniplib_v3'],
    'R2 文件链接生成器': ['r2_buckets', 'r2_domains'],
    '快捷回复话术库': ['reply_scripts_data'],
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

  var ready = false;      // 初次拉取完成后才允许自动上传，避免覆盖云端
  var _applying = false;  // 正在写入远端数据时，抑制自动上传，防回环
  var lastSync = 0;
  var inflight = 0;       // 正在进行的网络请求数
  var timers = {};        // 各 key 的防抖上传定时器

  function CA() { return window.__CLOUD_AUTH__ || {}; }
  function cloudMode() { return !!(CA().active); }
  function endpoint() { return DEF_EP; }
  function getMeta() { try { return JSON.parse(_getItem(CFG_META) || '{}'); } catch (e) { return {}; } }
  function setMeta(m) { _setItem(CFG_META, JSON.stringify(m)); }

  // meta[k] = { ts: 上次成功同步的云端时间戳, ok: 上次同步是否成功 }
  function mark(k, ok, ts) {
    var m = getMeta(); var cur = m[k] || { ts: 0, ok: false };
    m[k] = { ts: (ts || cur.ts || 0), ok: !!ok };
    setMeta(m); updateDot();
  }

  // ── 拦截 setItem：命中镜像 key 且已就绪且云端可用时，防抖上传 ──
  localStorage.setItem = function (k, v) {
    _setItem(k, v);
    if (ready && !_applying && KEYS.indexOf(k) >= 0 && cloudMode()) schedulePush(k);
  };

  function hasPending() { for (var k in timers) { if (timers[k]) return true; } return false; }

  function schedulePush(k) {
    if (timers[k]) clearTimeout(timers[k]);
    timers[k] = setTimeout(function () { doPush(k); }, 1200);
    updateDot();
  }
  function flushPending() {
    for (var k in timers) { if (timers[k]) { clearTimeout(timers[k]); timers[k] = null; doPush(k); } }
  }

  function begin() { inflight++; updateDot(); }
  function end() { inflight = Math.max(0, inflight - 1); updateDot(); }

  function doPush(k) {
    if (timers[k]) { clearTimeout(timers[k]); timers[k] = null; }
    begin();
    return fetch(endpoint() + '/' + encodeURIComponent(k), {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: localStorage.getItem(k) || '',
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      lastSync = Date.now(); mark(k, true, j.updatedAt);
    }).catch(function () {
      mark(k, false);
    }).then(function () { end(); });
  }

  function uploadAll() {
    if (!cloudMode()) { updateDot(); return; }
    Promise.all(KEYS.map(function (k) { return doPush(k); })).then(function () {
      toast('已上传全部数据到云端');
    });
  }

  // 拉取云端并应用。force=true 无条件用远端覆盖本地；reload 决定是否刷新
  function pullAll(force, reload) {
    if (!cloudMode()) { updateDot(); return Promise.resolve(); }
    begin();
    return Promise.all(KEYS.map(function (k) {
      return fetch(endpoint() + '/' + encodeURIComponent(k), { headers: { 'Accept': 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) { return { k: k, j: j }; })
        .catch(function (e) { return { k: k, err: e }; });
    })).then(function (res) {
      var changed = false, errs = 0, m = getMeta();
      res.forEach(function (r) {
        if (r.err) { errs++; mark(r.k, false); return; }
        var k = r.k, j = r.j, localTs = (m[k] && m[k].ts) || 0;
        if (j.value != null) {
          if (force || j.updatedAt > localTs) {
            _applying = true; _setItem(k, j.value); _applying = false;
            mark(k, true, j.updatedAt); changed = true;
          } else if (localTs > j.updatedAt) {
            doPush(k); // 本地更新，回推
          } else {
            mark(k, true, localTs);
          }
        } else {
          // 远端为空：本地若已有数据作为首次备份上传；否则视为已同步
          if (localStorage.getItem(k) != null) doPush(k);
          else mark(k, true, j.updatedAt || 0);
        }
      });
      if (errs === res.length) { end(); ready = true; updateDot(); return; }
      lastSync = Date.now(); end(); updateDot();
      if (changed && reload && !sessionStorage.getItem('cs_reloaded')) {
        sessionStorage.setItem('cs_reloaded', '1'); location.reload(); return;
      }
      ready = true;
    });
  }

  // 手动同步：先冲掉待上传，再与云端双向对账（新者胜，必要时刷新一次）
  function syncNow() {
    if (!cloudMode()) { updateDot(); return; }
    flushPending();
    toast('正在同步…');
    pullAll(false, true);
  }

  // ───────────────────────── 右下角状态点 ─────────────────────────
  var dotEl, dot2El, statusEl, timeEl;
  var DOT = {
    ok: ['#2ecc71', '全部已同步'],
    syncing: ['#e0a800', '同步中…'],
    pending: ['#9aa0a6', '有数据未同步'],
    off: ['#9aa0a6', '本地模式（未联网）'],
  };
  function allMirrorKeys() {
    var a = [];
    for (var n in MIRROR) MIRROR[n].forEach(function (k) { if (a.indexOf(k) < 0) a.push(k); });
    return a;
  }
  // 整站聚合：本机用过的每个 key 都要"上次同步成功"才算绿；有未成功→灰；进行中→黄
  function aggregate() {
    if (!cloudMode()) return 'off';
    if (inflight > 0 || hasPending()) return 'syncing';
    var m = getMeta(), keys = allMirrorKeys(), bad = false;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (localStorage.getItem(k) == null) continue; // 本机没用过该工具，不计
      var s = m[k];
      if (!s || s.ok !== true) bad = true;
    }
    return bad ? 'pending' : 'ok';
  }
  function updateDot() {
    var s = aggregate(), c = DOT[s][0], t = DOT[s][1];
    if (dotEl) dotEl.style.background = c;
    if (dot2El) dot2El.style.background = c;
    if (statusEl) statusEl.textContent = t;
    if (timeEl) timeEl.textContent = lastSync ? ('上次同步: ' + new Date(lastSync).toLocaleTimeString()) : '尚未同步';
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;right:16px;bottom:76px;background:#222;color:#eee;padding:8px 12px;border-radius:8px;font-size:12px;z-index:100000;box-shadow:0 4px 12px rgba(0,0,0,.3);font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1800);
  }

  function buildDot() {
    var rail = (window.__SITE_CORNER__ && window.__SITE_CORNER__()) || null;
    var item = document.createElement('div');
    item.className = 'sc-item';

    var pop = document.createElement('div');
    pop.className = 'sc-pop';
    pop.innerHTML =
      '<div style="width:236px;background:#242424;color:#ddd;border:1px solid #444;border-radius:12px;padding:14px;font-size:12px;box-shadow:0 8px 30px rgba(0,0,0,.4);font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif">' +
      '<div style="font-weight:600;margin-bottom:9px;">☁️ 云同步</div>' +
      '<div style="margin-bottom:5px;"><span id="cs-dot2" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#999;margin-right:6px;vertical-align:middle;"></span><span id="cs-state">状态</span></div>' +
      '<div id="cs-time" style="color:#888;margin-bottom:10px;"></div>' +
      '<div style="color:#888;margin-bottom:11px;">本页同步项：<span style="color:#7fd1ff">' + KEYS.join(', ') + '</span></div>' +
      '<div style="display:flex;gap:8px;">' +
      '<button data-act="sync" style="flex:1;padding:7px;border:none;border-radius:6px;background:#6c47ff;color:#fff;font-weight:600;cursor:pointer;">立即同步</button>' +
      '<button data-act="upload" style="flex:1;padding:7px;border:none;border-radius:6px;background:#2ecc71;color:#05301a;font-weight:600;cursor:pointer;">上传全部</button>' +
      '</div></div>';

    var btn = document.createElement('button');
    btn.id = 'site-sync-btn';
    btn.title = '云同步状态（悬停查看 / 手动同步）';
    btn.style.cssText = 'width:44px;height:44px;border-radius:50%;background:#fff;border:1px solid #e6e6e6;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.18);cursor:pointer;display:flex;align-items:center;justify-content:center';
    btn.innerHTML = '<span id="cs-dot" style="display:inline-block;width:13px;height:13px;border-radius:50%;background:#999;box-shadow:0 0 0 3px rgba(0,0,0,.04);"></span>';

    item.appendChild(pop);
    item.appendChild(btn);

    if (rail) {
      if (rail.firstChild) rail.insertBefore(item, rail.firstChild); else rail.appendChild(item);
    } else {
      var w = document.createElement('div');
      w.style.cssText = 'position:fixed;right:14px;bottom:68px;z-index:99997';
      w.appendChild(item); document.body.appendChild(w);
    }

    dotEl = document.getElementById('cs-dot');
    dot2El = document.getElementById('cs-dot2');
    statusEl = document.getElementById('cs-state');
    timeEl = document.getElementById('cs-time');

    pop.addEventListener('click', function (e) {
      var act = e.target.getAttribute('data-act');
      if (act === 'sync') syncNow();
      else if (act === 'upload') uploadAll();
    });

    updateDot();
  }

  function init() {
    buildDot();
    if (!CA().active) { ready = true; updateDot(); return; } // 本地开发：不联网
    pullAll(false, true); // 能到这里说明已通过密码门
    setInterval(function () { if (cloudMode()) { flushPending(); updateDot(); } }, 30000); // 兜底 flush
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
