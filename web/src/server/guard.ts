import { NextRequest } from 'next/server';
import { UserRow, requireAdmin, requireUserSession } from './auth';
import { settings } from './db';
import { route } from './http';
import { hit } from './ratelimit';

type Ctx = { params: Promise<Record<string, string>> };

/** Authenticated end-user route with a per-user request budget. */
export function userRoute(
  handler: (req: NextRequest, ctx: Ctx, user: UserRow, sessionId: string) => unknown,
  opts: { bucket?: string; multiplier?: number } = {},
) {
  return route(async (req, ctx) => {
    const { user, sessionId } = await requireUserSession();
    hit(`api:${opts.bucket || 'main'}:${user.id}`, settings().rateLimitPerMin * (opts.multiplier || 1));
    return handler(req, ctx, user, sessionId);
  });
}

/** Admin route: only reachable with a session created from the ADMIN_KEY. */
export function adminRoute(handler: (req: NextRequest, ctx: Ctx) => unknown) {
  return route(async (req, ctx) => {
    await requireAdmin();
    return handler(req, ctx);
  });
}
