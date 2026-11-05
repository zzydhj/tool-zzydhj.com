/* _lib/http.js —— 统一 CORS / JSON 响应 / 预检 / 错误类型 */
export class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

// 把 HttpError 转成对应状态码，其它异常转 500
export function fail(err) {
  const status = err && err.status ? err.status : 500;
  return json({ error: (err && err.message) || 'error' }, status);
}
