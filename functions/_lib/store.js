/* ══════════════════════════════════════════════════════════════════
   _lib/store.js —— R2 存储层（纯函数，不含鉴权）
   单用户命名空间：users/<uid>/tools/<key>.json
   每个对象写入时把 updatedAt 存进 customMetadata，供"新者胜"比较。
   浏览器永不持有 R2 凭证，读写只在 Pages Function 内发生。
   ══════════════════════════════════════════════════════════════════ */

export function toolPath(uid, key) { return `users/${uid}/tools/${key}.json`; }

// 读工具数据；不存在返回 { value:null, updatedAt:0 }
export async function getTool(env, uid, key) {
  const o = await env.STORAGE.get(toolPath(uid, key));
  if (!o) return { value: null, updatedAt: 0 };
  return {
    value: await o.text(),
    updatedAt: Number((o.httpMetadata && o.httpMetadata.customMetadata && o.httpMetadata.customMetadata.updatedAt) || 0),
  };
}

export async function putTool(env, uid, key, value, updatedAtOpt) {
  const updatedAt = updatedAtOpt || Date.now();
  await env.STORAGE.put(toolPath(uid, key), value, {
    httpMetadata: { customMetadata: { updatedAt: String(updatedAt) } },
  });
  return updatedAt;
}
