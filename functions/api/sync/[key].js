// ══════════════════════════════════════════════════════════════════
// Cloudflare Pages Function —— 工具数据云同步 API
// 路由:  GET / PUT  /api/sync/:key
// 后端:  默认使用 KV 绑定（在 Pages 项目里绑定名为 DATA 的 KV 命名空间）
// 鉴权:  Header  Authorization: Bearer <SYNC_TOKEN>（在 Pages 环境变量里设置）
//
// ── 若改用 R2（不想开 KV）──
//   1) 在 Pages 项目里把 R2 桶绑定为 env.DATA（用法基本一致）
//   2) 把下面三处 KV 调用换成 R2：
//        getWithMetadata → const o = await env.DATA.get(ck); value=o.body?await o.text():null; updatedAt=Number(o.httpMetadata?.customMetadata?.updatedAt||0)
//        put(...,{metadata}) → await env.DATA.put(ck, body, { httpMetadata:{ customMetadata:{ updatedAt:String(Date.now()) } } })
//   注：R2 的 updatedAt 精度/一致性优于 KV 的最终一致，但个人用 KV 已足够且更省事。
// ══════════════════════════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

// 只允许安全字符，防止路径穿越等
const KEY_RE = /^[A-Za-z0-9_.-]{1,100}$/;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function authOk(request, env) {
  const token = env.SYNC_TOKEN;
  // 未配置 token 时不鉴权（不推荐用于公开站点）
  if (!token) return true;
  const h = request.headers.get('Authorization') || '';
  return h === 'Bearer ' + token;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  if (!authOk(request, env)) return json({ error: 'unauthorized' }, 401);
  const key = params.key;
  if (!KEY_RE.test(key || '')) return json({ error: 'bad key' }, 400);
  if (!env.DATA) return json({ error: 'KV binding "DATA" is not configured in Pages' }, 500);

  const ck = 'tool:' + key;
  const { value, metadata } = await env.DATA.getWithMetadata(ck, { type: 'text' });
  return json({
    key,
    value: value == null ? null : value,
    updatedAt: (metadata && metadata.updatedAt) || 0,
  });
}

export async function onRequestPut(context) {
  const { request, env, params } = context;
  if (!authOk(request, env)) return json({ error: 'unauthorized' }, 401);
  const key = params.key;
  if (!KEY_RE.test(key || '')) return json({ error: 'bad key' }, 400);
  if (!env.DATA) return json({ error: 'KV binding "DATA" is not configured in Pages' }, 500);

  const body = await request.text();
  // 简单体积上限（KV 单值上限约 25MB，这里保守限制，防止滥用）
  if (body.length > 4 * 1024 * 1024) return json({ error: 'too large' }, 413);

  const updatedAt = Date.now();
  const ck = 'tool:' + key;
  await env.DATA.put(ck, body, { metadata: { updatedAt } });
  return json({ key, ok: true, updatedAt });
}
