import { takeSlot } from './ratelimit';

type Send = (token: string | null) => void;
type EventHub = {
  listeners: Set<Send>;
  readToken?: () => string;
  token?: string;
  heartbeat?: ReturnType<typeof setInterval>;
  change?: ReturnType<typeof setTimeout>;
};
const globals = globalThis as typeof globalThis & { __nt_canvas_events?: EventHub };
const hub = globals.__nt_canvas_events ??= { listeners: new Set() };
const HEARTBEAT_MS = 15_000;

function publish() {
  let token: string | undefined;
  try { token = hub.readToken?.(); }
  catch (error) { console.warn('Canvas version check failed', error); return; }
  if (!token || token === hub.token) return;
  hub.token = token;
  for (const send of hub.listeners) send(token);
}

export function notifyCanvasChanged() {
  if (!hub.listeners.size || hub.change !== undefined) return;
  hub.change = setTimeout(() => {
    hub.change = undefined;
    publish();
  }, 75);
}

function subscribe(readToken: () => string, send: Send) {
  if (!hub.listeners.size) {
    hub.readToken = readToken;
    hub.token = readToken();
    hub.heartbeat = setInterval(() => {
      // Picks up profile, music metadata and writes from another server process.
      publish();
      for (const listener of hub.listeners) listener(null);
    }, HEARTBEAT_MS);
  }
  hub.listeners.add(send);
  return () => {
    hub.listeners.delete(send);
    if (hub.listeners.size) return;
    clearInterval(hub.heartbeat);
    clearTimeout(hub.change);
    hub.heartbeat = hub.change = undefined;
    hub.readToken = hub.token = undefined;
  };
}

export function canvasEventStream(signal: AbortSignal, userId: number, isAuthorized: () => boolean, readToken: () => string) {
  const release = takeSlot(`canvas-events:${userId}`, 6);
  const encode = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let closed = false;
  const cleanup = () => {
    if (closed) return false;
    closed = true;
    unsubscribe?.();
    signal.removeEventListener('abort', abort);
    release();
    return true;
  };
  let abort: () => void;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      abort = () => { if (cleanup()) controller.close(); };
      if (signal.aborted) { abort(); return; }
      try {
        const send: Send = token => {
          if (closed) return;
          try {
            if (!isAuthorized() || (controller.desiredSize ?? 0) <= 0) { abort(); return; }
          } catch {
            abort();
            return;
          }
          const body = token === null ? 'event: heartbeat\ndata: 1\n\n' : `event: version\ndata: ${token}\n\n`;
          controller.enqueue(encode.encode(body));
        };
        unsubscribe = subscribe(readToken, send);
        signal.addEventListener('abort', abort, { once: true });
        controller.enqueue(encode.encode('retry: 5000\n\n'));
        send(readToken());
      } catch (error) {
        cleanup();
        controller.error(error);
      }
    },
    cancel: () => { cleanup(); },
  }, { highWaterMark: 4 });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'private, no-store, no-transform',
    'X-Accel-Buffering': 'no',
  } });
}
