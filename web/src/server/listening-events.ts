import { takeSlot } from './ratelimit';

type Notify = () => void;
const globals = globalThis as typeof globalThis & { __nt_listening_events?: Map<number, Set<Notify>> };
const listeners = globals.__nt_listening_events ??= new Map();

export function notifyListeningUsers(users: number[]) {
  for (const user of new Set(users)) for (const notify of listeners.get(user) ?? []) notify();
}

export function listeningEventStream(signal: AbortSignal, user: number, authorized: () => boolean) {
  const release = takeSlot(`listening-events:${user}`, 6);
  const subscribers = listeners.get(user) ?? new Set<Notify>();
  const encoder = new TextEncoder();
  const change = encoder.encode('event: room\ndata: 1\n\n');
  const heartbeat = encoder.encode(': heartbeat\n\n');
  let cleanup: () => void = release;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let timer: ReturnType<typeof setInterval>;
      const close = () => { cleanup(); controller.close(); };
      function send(packet: Uint8Array) {
        if (closed) return;
        try {
          if (!authorized() || (controller.desiredSize ?? 0) <= 0) { close(); return; }
          controller.enqueue(packet);
        } catch { close(); }
      }
      const notify = () => send(change);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        subscribers.delete(notify);
        if (!subscribers.size && listeners.get(user) === subscribers) listeners.delete(user);
        signal.removeEventListener('abort', close);
        release();
      };
      if (signal.aborted) { close(); return; }
      listeners.set(user, subscribers);
      subscribers.add(notify);
      signal.addEventListener('abort', close, { once: true });
      controller.enqueue(encoder.encode('retry: 5000\n\n'));
      timer = setInterval(() => send(heartbeat), 15_000);
    },
    cancel: () => cleanup(),
  }, { highWaterMark: 4 });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'private, no-store, no-transform',
    'X-Accel-Buffering': 'no',
  } });
}
