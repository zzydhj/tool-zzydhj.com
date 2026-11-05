/* ══════════════════════════════════════════════════════════════════
   _lib/auth.js —— 单用户「访问密码」+ 签名 Cookie（记住我）
   模型：
     - 站点整体由 _middleware.js 把守；未通过密码 → 显示登录页 / API 返回 401
     - 密码来自环境变量 ACCESS_PASSWORD（你自己在 Pages 设置，代码/日志都不记录）
     - 登录成功签发一个 HMAC 签名的长效 Cookie（默认 30 天）；换设备/过期/清 Cookie 再要
   环境变量：
     - ACCESS_PASSWORD（必填）：访问密码
     - AUTH_SECRET（可选）：Cookie 签名密钥；不填则用 ACCESS_PASSWORD 派生
   ══════════════════════════════════════════════════════════════════ */

export const AUTH_COOKIE_NAME = 'site_auth';
const MAX_AGE_DAYS = 30;

function enc(s) { return new TextEncoder().encode(s); }
function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function secretOf(env) { return env.AUTH_SECRET || env.ACCESS_PASSWORD || ''; }

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc(data));
  return toHex(sig);
}

export async function makeToken(secret, ttlDays = MAX_AGE_DAYS) {
  const exp = Date.now() + ttlDays * 86400000;
  const value = exp + '.' + await hmacHex(secret, String(exp));
  return { value, maxAge: ttlDays * 86400 };
}

async function verifyToken(secret, token) {
  if (!token || !secret) return false;
  const i = token.indexOf('.');
  if (i < 0) return false;
  const exp = token.slice(0, i);
  const mac = token.slice(i + 1);
  const e = Number(exp);
  if (!e || e < Date.now()) return false;
  const want = await hmacHex(secret, exp);
  return constantTimeEqual(want, mac);
}

function readCookie(request, name) {
  const h = request.headers.get('Cookie') || '';
  for (const part of h.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      try { return decodeURIComponent(part.slice(idx + 1)); } catch (e) { return part.slice(idx + 1); }
    }
  }
  return '';
}

export async function isAuthenticated(request, env) {
  return await verifyToken(secretOf(env), readCookie(request, AUTH_COOKIE_NAME));
}

// 校验提交的密码表单；未配置 ACCESS_PASSWORD 时一律拒绝（fail closed，避免裸奔）
export async function checkPassword(request, env) {
  const expected = env.ACCESS_PASSWORD;
  if (!expected) return false;
  let given = '';
  try { const f = await request.formData(); given = String(f.get('password') || ''); }
  catch (e) { return false; }
  return constantTimeEqual(given, expected);
}

export function buildSetCookie(tokenValue, maxAge, secure) {
  return AUTH_COOKIE_NAME + '=' + encodeURIComponent(tokenValue) +
    '; Path=/; Max-Age=' + maxAge + '; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : '');
}

export function buildClearCookie(secure) {
  return AUTH_COOKIE_NAME + '=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : '');
}
