/* ══════════════════════════════════════════════════════════════════
   site-ui.js —— 全站通用 UI 注入
   1) 兜底注入 favicon（若页面 head 已有静态 link 则跳过）
   2) 左下角悬浮「返回首页」按钮（首页自动不显示）
   3) 挂 window.__CLOUD_AUTH__：仅用于区分「云端部署 / 本地开发」
      - 访问密码门由后端 _middleware.js 负责，未验证根本进不到这些页面，
        所以这里不再需要前端遮罩/身份判断。
   在任意页面 <head> 引入即可：<script src="/site-ui.js"></script>
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

  // ── 2. 返回首页悬浮按钮 ──
  var path;
  try { path = decodeURIComponent(location.pathname); } catch (e) { path = location.pathname; }
  var isHome = (path === '/' || /\/index\.html$/i.test(path) || path === '');
  if (isHome) return;

  function homeBtn() {
    if (document.getElementById('site-home-btn')) return;
    var a = document.createElement('a');
    a.id = 'site-home-btn';
    a.href = '/';
    a.title = '返回首页';
    a.setAttribute('aria-label', '返回首页');
    a.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/></svg>';
    a.style.cssText =
      'position:fixed;left:14px;bottom:14px;z-index:99997;' +
      'width:44px;height:44px;border-radius:50%;background:#6c47ff;' +
      'display:flex;align-items:center;justify-content:center;text-decoration:none;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.25);border:none;cursor:pointer;' +
      'transition:transform .15s ease,background .2s ease;';
    a.addEventListener('mouseenter', function () { a.style.background = '#5a37e6'; a.style.transform = 'translateY(-2px)'; });
    a.addEventListener('mouseleave', function () { a.style.background = '#6c47ff'; a.style.transform = ''; });
    document.body.appendChild(a);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', homeBtn);
  } else {
    homeBtn();
  }
})();
