/* ══════════════════════════════════════════════════════════════════
   site-ui.js —— 全站通用 UI 注入
   1) 兜底注入 favicon
   2) 左下角悬浮「首页」按钮：点击回首页；悬停弹出工具抽屉可直接切换
      （工具列表来自单一数据源 /tools.json，与首页共用）
   3) 挂 window.__CLOUD_AUTH__：区分「云端部署 / 本地开发」
   （右下角云同步状态点由 tools/sync.js 自行挂载，与本文件互不耦合）
   引入：<script src="/site-ui.js"></script>
   ══════════════════════════════════════════════════════════════════ */
(function () {
  // ── 1. favicon 兜底 ──
  if (!document.querySelector('link[rel="icon"]')) {
    var link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.href = '/favicon.svg';
    document.head.appendChild(link);
  }

  // ── 3. 云端/本地判定（同步，供 sync.js 与各工具初始化读取）──
  function detectActive() {
    if (location.protocol === 'file:') return false;
    var h = location.hostname || '';
    if (h === 'localhost' || h === '' || h === '::1' || h === '[::1]' || /^127\./.test(h)) return false;
    return true; // 已部署（能到这里说明已通过密码门）→ 启用云同步
  }
  window.__CLOUD_AUTH__ = { active: detectActive(), ready: true };

  // ── 共享样式：右下角竖排容器 + 悬停弹出的浮层（Home 抽屉与云同步面板复用）──
  var css = document.createElement('style');
  css.textContent = [
    '.sc-item{position:relative}',
    '.sc-pop{display:none;position:absolute;bottom:0;z-index:99999}',
    '.sc-item:hover .sc-pop{display:block}',
    '#site-drawer{width:230px;max-height:62vh;overflow:auto;background:#fff;border:1px solid #e6e6e6;border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.16);padding:8px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}',
    '#site-drawer .dh{font-size:11px;color:#aaa;padding:6px 8px 6px;letter-spacing:.5px}',
    '#site-drawer a{display:flex;align-items:center;gap:10px;padding:9px 9px;border-radius:8px;text-decoration:none;color:#1d1d1f;line-height:1.2}',
    '#site-drawer a:hover{background:#f2eeff}',
    '#site-drawer a.cur{background:#efeaff}',
    '#site-drawer a.cur .dn{color:#6c47ff}',
    '#site-drawer .di{font-size:16px;width:18px;text-align:center;flex:none}',
    '#site-drawer .dn{font-weight:600;font-size:13px}'
  ].join('');
  document.head.appendChild(css);

  // ── 4. 左下角容器（首页按钮 + 抽屉）──
  function homeCorner() {
    var r = document.getElementById('site-home-corner');
    if (r) return r;
    r = document.createElement('div');
    r.id = 'site-home-corner';
    r.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:99997;';
    document.body.appendChild(r);
    return r;
  }

  // ── 2. 首页按钮 + 工具抽屉（首页本身不显示）──
  var path;
  try { path = decodeURIComponent(location.pathname); } catch (e) { path = location.pathname; }
  var isHome = (path === '/' || /\/index\.html$/i.test(path) || path === '');
  if (isHome) return;

  function buildHome() {
    if (document.getElementById('site-home-btn')) return;
    var corner = homeCorner();
    var item = document.createElement('div');
    item.className = 'sc-item';

    var drawer = document.createElement('div');
    drawer.className = 'sc-pop';
    drawer.id = 'site-drawer';
    drawer.style.left = '44px';
    drawer.innerHTML = '<div class="dh">🧰 工具切换</div><div id="site-drawer-list">加载中…</div>';

    var a = document.createElement('a');
    a.id = 'site-home-btn';
    a.href = '/';
    a.title = '返回首页（悬停可切换工具）';
    a.setAttribute('aria-label', '返回首页');
    a.style.cssText = 'width:44px;height:44px;border-radius:50%;background:#6c47ff;' +
      'display:flex;align-items:center;justify-content:center;text-decoration:none;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer;transition:background .2s ease;';
    a.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/></svg>';
    a.addEventListener('mouseenter', function () { a.style.background = '#5a37e6'; });
    a.addEventListener('mouseleave', function () { a.style.background = '#6c47ff'; });

    item.appendChild(drawer);
    item.appendChild(a);
    corner.appendChild(item);
    loadDrawer();
  }

  function loadDrawer() {
    fetch('/tools.json', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (list) {
        var box = document.getElementById('site-drawer-list');
        if (!box) return;
        box.innerHTML = '';
        list.forEach(function (t) {
          var el = document.createElement('a');
          el.href = t.href;
          if (t.href === path) el.className = 'cur';
          el.innerHTML = '<span class="di">' + t.icon + '</span><span class="dn">' + t.name + '</span>';
          box.appendChild(el);
        });
      })
      .catch(function () {
        var box = document.getElementById('site-drawer-list');
        if (box) box.textContent = '加载失败';
      });
  }

  function mount() { buildHome(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
