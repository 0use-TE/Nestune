'use client';

import { useCallback, useEffect, useRef } from 'react';
import { api } from './api';
import type { CanvasState, CanvasSyncReply } from './canvas-types';

type CanvasCursor = { token: string | null; state: CanvasState };
type SyncSession = { owner: number; abort: AbortController; cursor: CanvasCursor | null; request: Promise<void> | null; presented?: CanvasState };
const storeName = 'boards';
let database: Promise<IDBDatabase> | undefined;

function openCache() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('nestune-canvas-cache', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Canvas cache is unavailable'));
  }).catch(error => {
    database = undefined;
    throw error;
  });
  return database;
}

async function readCache(owner: number) {
  const db = await openCache();
  return new Promise<CanvasCursor | null>((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).get(owner);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function writeCache(owner: number, cursor: CanvasCursor) {
  const db = await openCache();
  db.transaction(storeName, 'readwrite').objectStore(storeName).put(cursor, owner);
}

function applyReply(base: CanvasCursor | null, reply: CanvasSyncReply | CanvasState): CanvasCursor | null {
  if (!('kind' in reply)) return { token: null, state: reply }; // Legacy web service.
  if (reply.kind === 'snapshot') return { token: reply.token, state: reply.state };
  if (reply.kind === 'unchanged') return reply.token === base?.token ? base : null;
  if (!base || base.token !== reply.from) return null;
  const byId = new Map(base.state.records.map(item => [item.id, item]));
  for (const id of reply.removed) byId.delete(id);
  for (const item of reply.upserts) byId.set(item.id, item);
  const records = reply.order ? reply.order.map(id => byId.get(id)) : [...byId.values()];
  if (records.length !== byId.size || records.some(item => !item)) return null;
  return { token: reply.token, state: { revision: reply.revision, records: records as CanvasState['records'] } };
}

export function useCanvasSync(userId: number | undefined, onState: (state: CanvasState, previous?: CanvasState) => boolean, onError: (error: Error) => void) {
  const live = useRef({ onState, onError });
  live.current = { onState, onError };
  const active = useRef<SyncSession | null>(null);
  const refresh = useCallback((): Promise<void> => {
    const session = active.current;
    if (!session) return Promise.resolve();
    if (session.request) return session.request;
    const signal = session.abort.signal;
    const base = session.cursor;
    const request = async () => {
      const since = base?.token ? '&since=' + encodeURIComponent(base.token) : '';
      const options = { signal, cache: 'no-store' as const };
      let next = applyReply(base, await api<CanvasSyncReply | CanvasState>('/api/canvas?sync=1' + since, options));
      if (!next) next = applyReply(null, await api<CanvasSyncReply | CanvasState>('/api/canvas?sync=1', options));
      if (signal.aborted || !next) return;
      session.cursor = next;
      if (next !== base) void writeCache(session.owner, next).catch(() => {});
      if (live.current.onState(next.state, session.presented)) session.presented = next.state;
    };
    session.request = request().finally(() => { session.request = null; });
    return session.request;
  }, []);

  useEffect(() => {
    if (userId === undefined) return;
    const session: SyncSession = { owner: userId, abort: new AbortController(), cursor: null, request: null };
    active.current = session;
    let deadline: ReturnType<typeof setTimeout>;
    const load = async () => {
      const timeout = new Promise<null>(resolve => { deadline = setTimeout(() => resolve(null), 220); });
      const saved = await Promise.race([readCache(userId).catch(() => null), timeout]);
      clearTimeout(deadline);
      if (session.abort.signal.aborted) return;
      if (saved && !session.cursor && !session.request) {
        session.cursor = saved;
        if (live.current.onState(saved.state)) session.presented = saved.state;
      }
      await refresh();
    };
    void load().catch(error => { if (!session.abort.signal.aborted) live.current.onError(error); });
    const backgroundRefresh = () => { if (!document.hidden) void refresh().catch(() => {}); };
    const timer = setInterval(backgroundRefresh, 2000);
    window.addEventListener('focus', backgroundRefresh);
    window.addEventListener('online', backgroundRefresh);
    document.addEventListener('visibilitychange', backgroundRefresh);
    return () => {
      active.current = null;
      session.abort.abort();
      clearTimeout(deadline);
      clearInterval(timer);
      window.removeEventListener('focus', backgroundRefresh);
      window.removeEventListener('online', backgroundRefresh);
      document.removeEventListener('visibilitychange', backgroundRefresh);
    };
  }, [userId, refresh]);
  return refresh;
}
