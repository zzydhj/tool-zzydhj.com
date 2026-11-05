/* ══════════════════════════════════════════════════════════════════
   /login —— 处理访问密码提交
   POST：校验 ACCESS_PASSWORD → 成功签发 30 天 Cookie 并跳回原页；失败回登录页报错
   GET ：直接显示登录页
   ══════════════════════════════════════════════════════════════════ */
import { checkPassword, makeToken, buildSetCookie } from './_lib/auth.js';
import { renderLogin } from './_lib/loginpage.js';

function safeNext(v) {
  const s = String(v || '/');
  return (s.startsWith('/') && !s.startsWith('//')) ? s : '/';
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  return new Response(renderLogin(safeNext(url.searchParams.get('next')), ''), {
    status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const secure = url.protocol === 'https:';

  const ok = await checkPassword(request, env);
  const form = await request.formData().catch(() => null);
  const next = safeNext(form && form.get('next'));

  if (!ok) {
    const msg = env.ACCESS_PASSWORD ? '密码不正确，请重试' : '服务端未配置访问密码（ACCESS_PASSWORD）';
    return new Response(renderLogin(next, msg), {
      status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const { value, maxAge } = await makeToken(env.AUTH_SECRET || env.ACCESS_PASSWORD);
  return new Response(null, {
    status: 302,
    headers: { 'Set-Cookie': buildSetCookie(value, maxAge, secure), 'Location': next },
  });
}
