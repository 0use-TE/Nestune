import { randomUUID } from 'node:crypto';
import { workerSource } from '@/server/pwa-worker';

// Prerender once per build: a release always produces a new worker, even if only UI code changed.
export const dynamic = 'force-static';

export function GET() {
  return new Response(workerSource(randomUUID()), {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
  });
}
