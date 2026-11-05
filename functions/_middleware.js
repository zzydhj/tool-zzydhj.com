/* ══════════════════════════════════════════════════════════════════
   _middleware.js —— 整站「密码门」
   匹配所有路由（含静态资源），未通过验证：
     - 页面请求 → 返回自包含登录页
     - /api/*   → 返回 401 JSON
   放行：/login（登录处理）、OPTIONS 预检、favicon/robots 等无害资源。
   ══════════════════════════════════════════════════════════════════ */
import { isAuthenticated } from './_lib/auth.js';
import { renderLogin } from './_lib/loginpage.js';

const PASS_THROUGH = new Set(['/login', '/favicon.svg', '/robots.txt', '/favicon.ico']);

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') return next();
  if (PASS_THROUGH.has(path)) return next();

  if (await isAuthenticated(request, env)) return next();

  // 未认证
  if (path.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(renderLogin(path, ''), {
    status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
