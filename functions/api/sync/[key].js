/* ══════════════════════════════════════════════════════════════════
   云同步 API —— GET / PUT  /api/sync/:key
   后端：Cloudflare R2（Pages 绑定名 STORAGE），单用户固定命名空间
         users/me/tools/<key>.json
   鉴权：整站「密码门」Cookie（见 _middleware.js / _lib/auth.js）；
         中间件已拦未授权，这里再做一层函数级校验（纵深防御）。
   ══════════════════════════════════════════════════════════════════ */
import { isAuthenticated } from '../../_lib/auth.js';
import { getTool, putTool } from '../../_lib/store.js';
import { HttpError, json, preflight, fail } from '../../_lib/http.js';

const UID = 'me';
const KEY_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const MAX_BYTES = 4 * 1024 * 1024;

export async function onRequestOptions() { return preflight(); }

async function requireAuth(request, env) {
  if (!env.STORAGE) throw new HttpError(500, 'R2 binding "STORAGE" is not configured');
  if (!(await isAuthenticated(request, env))) throw new HttpError(401, 'unauthorized');
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  try {
    await requireAuth(request, env);
    const key = params.key;
    if (!KEY_RE.test(key || '')) throw new HttpError(400, 'bad key');
    const { value, updatedAt } = await getTool(env, UID, key);
    return json({ key, value: value == null ? null : value, updatedAt: updatedAt || 0 });
  } catch (e) { return fail(e); }
}

export async function onRequestPut(context) {
  const { request, env, params } = context;
  try {
    await requireAuth(request, env);
    const key = params.key;
    if (!KEY_RE.test(key || '')) throw new HttpError(400, 'bad key');
    const body = await request.text();
    if (body.length > MAX_BYTES) throw new HttpError(413, 'too large');
    const updatedAt = await putTool(env, UID, key, body);
    return json({ key, ok: true, updatedAt });
  } catch (e) { return fail(e); }
}
