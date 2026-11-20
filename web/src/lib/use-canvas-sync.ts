'use client';

import { useCallback, useEffect, useRef } from 'react';
import { api } from './api';
import { DEFAULT_CANVAS_SETTINGS } from './canvas-settings';
import type { CanvasState, CanvasSyncReply } from './canvas-types';

type CanvasCursor = { token: string | null; state: CanvasState };
type SyncSession = {
  owner: number; abort: AbortController; cursor: CanvasCursor | null; request: Promise<void> | null;
  presented?: CanvasState; timer?: ReturnType<typeof setTimeout>; version?: string;
  streaming: boolean; connect: () => void;
};
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
  let records = base.state.records;
  if (reply.order || reply.removed.length || reply.upserts.length) {
    const byId = new Map(records.map(item => [item.id, item]));
    for (const id of reply.removed) byId.delete(id);
    for (const item of reply.upserts) byId.set(item.id, item);
    const next = reply.order ? reply.order.map(id => byId.get(id)) : [...byId.values()];
    if (next.length !== byId.size || !next.every(item => item !== undefined)) return null;
    records = next;
  }
  return { token: reply.token, state: {
    revision: reply.revision, records, wall: reply.wall ?? base.state.wall,
    settings: reply.settings ?? base.state.settings,
  } };
}

function stopPolling(session: SyncSession) {
  clearTimeout(session.timer);
  session.timer = undefined;
}

function schedulePoll(session: SyncSession, refresh: () => Promise<void>) {
  if (session.timer !== undefined || session.abort.signal.aborted || document.hidden) return;
  const seconds = session.cursor?.state.settings?.syncIntervalSeconds ?? DEFAULT_CANVAS_SETTINGS.syncIntervalSeconds;
  session.timer = setTimeout(() => {
    session.timer = undefined;
    if (!document.hidden) void refresh().catch(() => {});
  }, seconds * 1000);
}

export function useCanvasSync(userId: number | undefined, onState: (state: CanvasState, previous?: CanvasState) => boolean, onError: (error: Error) => void) {
  const live = useRef({ onState, onError });
  live.current = { onState, onError };
  const active = useRef<SyncSession | null>(null);
  const presentPending = useCallback(() => {
    const session = active.current;
    const next = session?.cursor?.state;
    if (session && next && next !== session.presented && live.current.onState(next, session.presented)) session.presented = next;
  }, []);
  const refresh = useCallback(function refresh(): Promise<void> {
    const session = active.current;
    if (!session) return Promise.resolve();
    if (session.request) return session.request;
    stopPolling(session);
    session.connect();
    const signal = session.abort.signal;
    const base = session.cursor;
    const version = session.version;
    let succeeded = false;
    const request = async () => {
      const since = base?.token ? '&since=' + encodeURIComponent(base.token) : '';
      const options = { signal, cache: 'no-store' as const };
      let next = applyReply(base, await api<CanvasSyncReply | CanvasState>('/api/canvas?sync=1' + since, options));
      if (!next) next = applyReply(null, await api<CanvasSyncReply | CanvasState>('/api/canvas?sync=1', options));
      if (signal.aborted || !next) return;
      session.cursor = next;
      succeeded = true;
      if (next !== base) void writeCache(session.owner, next).catch(() => {});
      presentPending();
    };
    session.request = request().finally(() => {
      session.request = null;
      if (signal.aborted || document.hidden) return;
      // The notification can arrive after the in-flight request took its snapshot.
      if (succeeded && session.version && session.version !== version && session.version !== session.cursor?.token) {
        void refresh().catch(() => {});
      } else if (!session.streaming || !succeeded) schedulePoll(session, refresh);
    });
    return session.request;
  }, [presentPending]);

  useEffect(() => {
    if (userId === undefined) return;
    let source: EventSource | null = null;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const disconnect = () => {
      source?.close();
      source = null;
      clearTimeout(watchdog);
      session.streaming = false;
      session.version = undefined;
    };
    const watchConnection = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        disconnect();
        void refresh().catch(() => {});
      }, 45_000);
    };
    const connect = () => {
      if (source || document.hidden || navigator.onLine === false || typeof EventSource === 'undefined') return;
      const events = new EventSource('/api/canvas/events');
      source = events;
      watchConnection();
      events.addEventListener('version', (event: MessageEvent<string>) => {
        if (source !== events || !/^[a-f0-9]{32}$/.test(event.data)) return;
        session.streaming = true;
        session.version = event.data;
        watchConnection();
        if (event.data !== session.cursor?.token) void refresh().catch(() => {});
        else stopPolling(session);
      });
      events.addEventListener('heartbeat', () => { if (source === events) watchConnection(); });
      events.onerror = () => {
        if (source !== events) return;
        session.streaming = false;
        if (events.readyState === EventSource.CLOSED) disconnect();
        schedulePoll(session, refresh);
      };
    };
    const session: SyncSession = {
      owner: userId, abort: new AbortController(), cursor: null, request: null, streaming: false, connect,
    };
    active.current = session;
    let deadline: ReturnType<typeof setTimeout>;
    const load = async () => {
      const timeout = new Promise<null>(resolve => { deadline = setTimeout(() => resolve(null), 220); });
      const saved = await Promise.race([readCache(userId).catch(() => null), timeout]);
      clearTimeout(deadline);
      if (session.abort.signal.aborted) return;
      if (saved && !session.cursor && !session.request) {
        session.cursor = saved;
        presentPending();
      }
      await refresh();
    };
    void load().catch(error => { if (!session.abort.signal.aborted) live.current.onError(error); });
    const backgroundRefresh = () => {
      if (document.hidden) {
        disconnect();
        stopPolling(session);
      } else void refresh().catch(() => {});
    };
    window.addEventListener('focus', backgroundRefresh);
    window.addEventListener('online', backgroundRefresh);
    document.addEventListener('visibilitychange', backgroundRefresh);
    return () => {
      active.current = null;
      session.abort.abort();
      disconnect();
      clearTimeout(deadline);
      stopPolling(session);
      window.removeEventListener('focus', backgroundRefresh);
      window.removeEventListener('online', backgroundRefresh);
      document.removeEventListener('visibilitychange', backgroundRefresh);
    };
  }, [userId, presentPending, refresh]);
  return { refresh, presentPending };
}
