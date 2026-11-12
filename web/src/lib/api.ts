export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && data?.code === 'unauthorized') window.dispatchEvent(new Event('nt:unauthorized'));
    throw new ApiError(data?.error || '请求失败，请稍后重试', res.status, data?.code);
  }
  return data as T;
}
export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, json?: unknown) => api<T>(p, { method: 'POST', json: json ?? {} });
export const put = <T = any>(p: string, json?: unknown) => api<T>(p, { method: 'PUT', json: json ?? {} });
export const patch = <T = any>(p: string, json?: unknown) => api<T>(p, { method: 'PATCH', json: json ?? {} });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });
