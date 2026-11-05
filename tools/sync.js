/* ══════════════════════════════════════════════════════════════════
   CloudSync —— localStorage ⇄ R2 云同步桥（单用户 / 密码门版）
   - 云端/本地由 window.__CLOUD_AUTH__.active 判定（部署即云；localhost/file 为本地）
   - 本地开发 = 纯本地模式：不发任何网络请求
   - 云端模式：进页面「全站」拉取对账（新者胜），编辑后防抖自动上传，每 30s 兜底 flush
     ★ 同步范围 = 全站所有工具的 key（不只当前页），否则状态点永远无法变绿
   - 右下角状态点：绿=全部已同步 / 黄=同步中 / 灰=有未同步(或本地模式)
     悬停弹出面板：逐项状态 + 上次同步 + 「立即同步 / 上传全部」
   - 引入页：全站每个页面都引（含首页与无数据工具页），因此进任意页即完成一次全站对账
   后端 API:  /api/sync/:key  （GET / PUT，见 functions/api/sync/[key].js）
   ══════════════════════════════════════════════════════════════════ */
(function () {
  var DEF_EP = '/api/sync';
  var CFG_META = 'cs_meta';

  // 每个工具需要镜像到云端的 localStorage key（<toolKey> 与 R2 路径末段一致）
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
  function allKeys() {
    var a = [];
    for (var n in MIRROR) MIRROR[n].forEach(function (k) { if (a.indexOf(k) < 0) a.push(k); });
    return a;
  }

  var PAGE_KEYS = detectKeys();       // 本页所属工具的 key（只用于判定“要不要刷新页面”；首页/无数据工具页为空）
  var KEYS = allKeys();               // ★ 全站同步范围（状态点要能代表整站，故不再按页早退）

  var _setItem = localStorage.setItem.bind(localStorage);
  var _getItem = localStorage.getItem.bind(localStorage);

  var ready = false;      // 初次拉取完成后才允许自动上传，避免覆盖云端
  var _applying = false;  // 正在写入远端数据时，抑制自动上传，防回环
  var lastSync = 0;
  var inflight = 0;       // 正在进行的网络请求数
  var timers = {};        // 各 key 的防抖上传定时器
  var errs = {};          // 各 key 最近一次失败原因（面板诊断用）

  function CA() { return window.__CLOUD_AUTH__ || {}; }
  function cloudMode() { return !!(CA().active); }
  function endpoint() { return DEF_EP; }
  function getMeta() { try { return JSON.parse(_getItem(CFG_META) || '{}'); } catch (e) { return {}; } }
  function setMeta(m) { _setItem(CFG_META, JSON.stringify(m)); }
  function empty(v) { return v == null || v === ''; }

  // 内容指纹：只存长度+32位哈希，用于判断「本地是否比上次同步时又改过」
  function fp(v) {
    if (v == null) return '';
    var h = 5381;
    for (var i = 0; i < v.length; i++) { h = ((h << 5) + h + v.charCodeAt(i)) | 0; }
    return v.length + ':' + (h >>> 0).toString(36);
  }

  // meta[k] = { ts: 上次成功同步的云端时间戳, ok: 是否成功, fp: 上次同步时的内容指纹 }
  function mark(k, ok, ts, f) {
    var m = getMeta(); var cur = m[k] || { ts: 0, ok: false, fp: '' };
    m[k] = { ts: (ts || cur.ts || 0), ok: !!ok, fp: (f != null ? f : (cur.fp || '')) };
    if (ok) delete errs[k];
    setMeta(m); updateDot();
  }
  // 本地有数据、且与上次同步时不一致 → 本地是新的，该推不该拉
  function isDirty(k) {
    var v = _getItem(k);
    if (empty(v)) return false;
    var m = getMeta()[k];
    if (!m || !m.fp) return true;
    return m.fp !== fp(v);
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
    var v = _getItem(k);
    if (empty(v)) { mark(k, true, 0, fp(v)); return Promise.resolve(); } // 本机没数据，不往云端写空值
    begin();
    return fetch(endpoint() + '/' + encodeURIComponent(k), {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: v,
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      lastSync = Date.now(); mark(k, true, j.updatedAt, fp(v));
    }).catch(function (e) {
      errs[k] = (e && e.message) || '上传失败'; mark(k, false);
    }).then(function () { end(); });
  }

  // 上传全部：全站所有本机有数据的 key
  function uploadAll() {
    if (!cloudMode()) { toast('本地模式：未连接云端'); updateDot(); return; }
    toast('正在上传…');
    Promise.all(KEYS.map(function (k) { return doPush(k); })).then(function () {
      lastSync = Date.now(); updateDot();
      toast(aggregate() === 'ok' ? '已全部上传到云端' : '有项目上传失败，详见状态点');
    });
  }

  function getRemote(k) {
    return fetch(endpoint() + '/' + encodeURIComponent(k), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { return { k: k, j: j }; })
      .catch(function (e) { return { k: k, err: (e && e.message) || '拉取失败' }; });
  }

  // 全站对账：本地改过→推；本机没有/云端更新→拉；两边一致→标已同步
  // reload=true 时，若当前页的数据被云端覆盖，刷新一次让界面读到新数据
  function pullAll(reload) {
    if (!cloudMode()) { updateDot(); return Promise.resolve(); }
    begin();
    return Promise.all(KEYS.map(getRemote)).then(function (res) {
      var m = getMeta(), pushes = [], pageChanged = false, errCount = 0;
      res.forEach(function (r) {
        var k = r.k;
        if (r.err) { errCount++; errs[k] = r.err; mark(k, false); return; }
        var j = r.j, local = _getItem(k), localTs = (m[k] && m[k].ts) || 0;

        if (empty(j.value)) {                 // 云端还没这一项
          if (empty(local)) mark(k, true, 0, fp(local));
          else pushes.push(doPush(k));        // 本地已有 → 首次备份上传
          return;
        }
        if (empty(local)) {                   // 本机没这一项 → 直接用云端
          _applying = true; _setItem(k, j.value); _applying = false;
          mark(k, true, j.updatedAt, fp(j.value));
          if (PAGE_KEYS.indexOf(k) >= 0) pageChanged = true;
          return;
        }
        if (isDirty(k) || localTs > j.updatedAt) { pushes.push(doPush(k)); return; } // 本地胜
        if (j.updatedAt > localTs) {          // 云端胜
          _applying = true; _setItem(k, j.value); _applying = false;
          mark(k, true, j.updatedAt, fp(j.value));
          if (PAGE_KEYS.indexOf(k) >= 0) pageChanged = true;
        } else {
          mark(k, true, localTs, fp(local));  // 两边一致
        }
      });
      return Promise.all(pushes).then(function () {
        if (errCount === res.length) { end(); ready = true; updateDot(); return; }
        lastSync = Date.now(); end(); updateDot();
        if (pageChanged && reload && sessionStorage.getItem('cs_reloaded') !== '1') {
          sessionStorage.setItem('cs_reloaded', '1'); location.reload(); return;
        }
        ready = true;
      });
    });
  }

  // 手动同步：先冲掉待上传，再与云端全站对账（新者胜，必要时刷新一次）
  function syncNow() {
    if (!cloudMode()) { toast('本地模式：未连接云端'); updateDot(); return; }
    flushPending();
    toast('正在同步…');
    pullAll(true);
  }

  // ───────────────────────── 右下角状态点 ─────────────────────────
  var dotEl, dot2El, statusEl, timeEl, listEl;
  var DOT = {
    ok: ['#2ecc71', '全部已同步'],
    syncing: ['#e0a800', '同步中…'],
    pending: ['#9aa0a6', '有数据未同步'],
    off: ['#9aa0a6', '本地模式（未联网）'],
  };
  // 整站聚合：本机有数据的每个 key 都要"上次同步成功"才算绿；有未成功→灰；进行中→黄
  function aggregate() {
    if (!cloudMode()) return 'off';
    if (inflight > 0 || hasPending()) return 'syncing';
    var m = getMeta(), bad = false;
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i];
      if (empty(_getItem(k))) continue;  // 本机没用过该工具，不计
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
    renderList();
  }
  // 面板逐项状态：灰的时候能看出到底哪一项没同步、为何失败
  function renderList() {
    if (!listEl) return;
    var m = getMeta(), off = !cloudMode(), html = '';
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i], s = m[k], color, label;
      if (off) { color = '#888'; label = '本地模式'; }
      else if (errs[k]) { color = '#ff6b6b'; label = errs[k]; }
      else if (empty(_getItem(k))) { color = '#5c5c5c'; label = '本机无数据'; }
      else if (s && s.ok === true) { color = '#2ecc71'; label = '已同步'; }
      else { color = '#9aa0a6'; label = '未同步'; }
      html += '<div style="display:flex;justify-content:space-between;gap:10px;padding:2px 0;">' +
        '<span style="color:#aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + k + '</span>' +
        '<span style="color:' + color + ';flex:none;">' + label + '</span></div>';
    }
    listEl.innerHTML = html;
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;right:16px;bottom:76px;background:#222;color:#eee;padding:8px 12px;border-radius:8px;font-size:12px;z-index:100000;box-shadow:0 4px 12px rgba(0,0,0,.3);font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1800);
  }

  function buildDot() {
    var item = document.createElement('div');
    item.className = 'sc-item';

    var pop = document.createElement('div');
    pop.className = 'sc-pop';
    pop.style.right = '30px';
    pop.innerHTML =
      '<div style="width:264px;background:#242424;color:#ddd;border:1px solid #444;border-radius:12px;padding:14px;font-size:12px;box-shadow:0 8px 30px rgba(0,0,0,.4);font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif">' +
      '<div style="font-weight:600;margin-bottom:9px;">☁️ 云同步<span style="font-weight:400;color:#888;font-size:11px;margin-left:6px;">全站 ' + KEYS.length + ' 项</span></div>' +
      '<div style="margin-bottom:5px;"><span id="cs-dot2" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#999;margin-right:6px;vertical-align:middle;"></span><span id="cs-state">状态</span></div>' +
      '<div id="cs-time" style="color:#888;margin-bottom:10px;"></div>' +
      '<div id="cs-list" style="border-top:1px solid #3a3a3a;padding-top:7px;margin-bottom:11px;font-size:11px;line-height:1.5;max-height:170px;overflow:auto;"></div>' +
      '<div style="display:flex;gap:8px;">' +
      '<button data-act="sync" style="flex:1;padding:7px;border:none;border-radius:6px;background:#6c47ff;color:#fff;font-weight:600;cursor:pointer;">立即同步</button>' +
      '<button data-act="upload" style="flex:1;padding:7px;border:none;border-radius:6px;background:#2ecc71;color:#05301a;font-weight:600;cursor:pointer;">上传全部</button>' +
      '</div></div>';

    var btn = document.createElement('button');
    btn.id = 'site-sync-btn';
    btn.title = '云同步状态（悬停查看 / 手动同步）';
    btn.style.cssText = 'width:30px;height:30px;border-radius:50%;background:#fff;border:1px solid #e6e6e6;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.16);cursor:pointer;display:flex;align-items:center;justify-content:center';
    btn.innerHTML = '<span id="cs-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#999;"></span>';

    item.appendChild(pop);
    item.appendChild(btn);

    var corner = document.getElementById('site-sync-corner');
    if (!corner) {
      corner = document.createElement('div');
      corner.id = 'site-sync-corner';
      corner.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:99997;';
      document.body.appendChild(corner);
    }
    corner.appendChild(item);

    dotEl = document.getElementById('cs-dot');
    dot2El = document.getElementById('cs-dot2');
    statusEl = document.getElementById('cs-state');
    timeEl = document.getElementById('cs-time');
    listEl = document.getElementById('cs-list');

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
    // 能到这里说明已通过密码门；若刚因拉取而刷新过，本次不再刷新（防循环）
    var justReloaded = sessionStorage.getItem('cs_reloaded') === '1';
    sessionStorage.removeItem('cs_reloaded');
    pullAll(!justReloaded);
    setInterval(function () { if (cloudMode()) { flushPending(); updateDot(); } }, 30000); // 兜底 flush
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
