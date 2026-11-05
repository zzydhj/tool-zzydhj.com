/* _lib/loginpage.js —— 自包含登录页（不依赖任何被保护的资源） */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderLogin(next, error) {
  const errHtml = error
    ? '<div style="background:#fdecec;color:#c0392b;border:1px solid #f5b7b1;border-radius:8px;padding:8px 12px;font-size:13px;margin-bottom:16px">' + esc(error) + '</div>'
    : '';
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>访问验证</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;background:#f5f5f7;color:#1d1d1f;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{width:100%;max-width:360px;background:#fff;border:1px solid #e8e8e8;border-radius:16px;padding:32px 28px;box-shadow:0 10px 40px rgba(0,0,0,.08);text-align:center}
.lock{font-size:40px;line-height:1;margin-bottom:12px}
h1{font-size:18px;margin-bottom:6px}
p.sub{font-size:13px;color:#888;margin-bottom:22px}
input{width:100%;padding:11px 12px;border:1px solid #ddd;border-radius:9px;font-size:15px;outline:none;margin-bottom:14px;font-family:inherit}
input:focus{border-color:#6c47ff}
button{width:100%;padding:11px;background:#6c47ff;color:#fff;border:none;border-radius:9px;font-size:14px;font-weight:600;cursor:pointer}
button:hover{background:#5a38e0}
.tip{font-size:11px;color:#bbb;margin-top:16px;line-height:1.6}
</style></head>
<body>
<div class="card">
  <div class="lock">🔒</div>
  <h1>访问验证</h1>
  <p class="sub">此站点受密码保护，请输入访问密码</p>
  ${errHtml}
  <form method="POST" action="/login">
    <input type="hidden" name="next" value="${esc(next || '/')}">
    <input type="password" name="password" placeholder="访问密码" autocomplete="current-password" autofocus>
    <button type="submit">进入</button>
  </form>
  <div class="tip">同一设备登录后 30 天内免重复输入</div>
</div>
</body></html>`;
}
