import { NextRequest, NextResponse } from 'next/server';
import { extraOrigins } from './config';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
export const fail = (status: number, message: string, code?: string) => new HttpError(status, message, code);

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export function clientIp(req: Request) {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'local';
}

/** Reject cross-site state-changing requests. */
export function checkOrigin(req: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const origin = req.headers.get('origin');
  if (!origin) return;
  const host = req.headers.get('host');
  let ok = false;
  try { ok = new URL(origin).host === host; } catch { ok = false; }
  if (!ok && !extraOrigins().includes(origin)) throw fail(403, '不允许此跨站请求');
}

type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: NextRequest, ctx: Ctx) => Promise<Response | unknown> | Response | unknown;

export function route(handler: Handler) {
  return async (req: NextRequest, ctx: Ctx) => {
    try {
      checkOrigin(req);
      const out = await handler(req, ctx);
      return out instanceof Response ? out : json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
      console.error('[api]', req.method, req.nextUrl.pathname, e);
      return json({ error: '服务内部错误' }, 500);
    }
  };
}

export async function body<T = Record<string, unknown>>(req: Request, max = 16384): Promise<T> {
  const text = await req.text();
  if (Buffer.byteLength(text) > max) throw fail(413, '请求过大');
  try { return JSON.parse(text || '{}') as T; } catch { throw fail(400, 'JSON 格式错误'); }
}

export const str = (v: unknown, min: number, max: number, label: string) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min || s.length > max) throw fail(400, `${label}长度需要在 ${min} 到 ${max} 之间`);
  return s;
};

export function intParam(v: string | null, fallback: number, max: number, label = '分页参数') {
  if (v === null || v === '') return fallback;
  if (!/^\d+$/.test(v)) throw fail(400, `${label}无效`);
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n > max) throw fail(400, `${label}超出范围`);
  return n;
}
export function numericId(v: unknown) {
  if (!/^\d{1,20}$/.test(String(v ?? ''))) throw fail(400, 'ID 必须是数字');
  return String(v);
}
