export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public requestId?: string) {
    super(requestId ? `${message}（编号 ${requestId.slice(0, 8)}）` : message);
    this.name = 'ApiError';
  }
}
const safeId = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(value) ? value : undefined;

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try { res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: 'same-origin',
  }); } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') throw error;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    throw new ApiError(offline ? '设备当前没有网络连接' : '暂时无法连接网站入口，请检查网络或稍后重试', 0, offline ? 'client_offline' : 'network_unreachable');
  }
  let data: any;
  try { data = res.status === 204 ? {} : await res.json(); }
  catch {
    if (res.ok) throw new ApiError('服务器返回了无法识别的响应，请稍后重试', res.status, 'invalid_response', safeId(res.headers.get('x-request-id')));
    data = {};
  }
  const requestId = safeId(res.headers.get('x-request-id')) ?? safeId(data?.requestId);
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && data?.code === 'unauthorized') window.dispatchEvent(new Event('nt:unauthorized'));
    const code = typeof data?.code === 'string' ? data.code : res.headers.get('x-nestune-error-code') || `http_${res.status}`;
    const fallback = code === 'gateway_upstream_unreachable' ? '网站入口暂时无法连接音乐服务，请稍后重试' : res.status >= 500 ? `服务暂时不可用（HTTP ${res.status}），请稍后重试` : '请求失败，请稍后重试';
    throw new ApiError(typeof data?.error === 'string' ? data.error : fallback, res.status, code, requestId);
  }
  return data as T;
}
export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, json?: unknown) => api<T>(p, { method: 'POST', json: json ?? {} });
export const put = <T = any>(p: string, json?: unknown) => api<T>(p, { method: 'PUT', json: json ?? {} });
export const patch = <T = any>(p: string, json?: unknown) => api<T>(p, { method: 'PATCH', json: json ?? {} });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });
