import { createHash } from 'node:crypto';
import type { CanvasState, CanvasSyncReply } from '@/lib/canvas-types';
import { readCanvas } from './canvas';
import { db, one } from './db';

type BoardIndex = { signatures: Map<string, string>; order: string[] };
const recent = new Map<string, BoardIndex>();
let cached: { database: ReturnType<typeof db>; stamp: string; state: CanvasState; token: string; index: BoardIndex } | undefined;
const digest = (input: string) => createHash('sha256').update(input).digest('hex').slice(0, 32);

function currentBoard() {
  const database = db();
  const local = one<{ changes: number }>('SELECT total_changes() AS changes')!.changes;
  const external = one<{ data_version: number }>('PRAGMA data_version')!.data_version;
  const stamp = `${local}:${external}`;
  if (cached?.database === database && cached.stamp === stamp) return cached;
  if (cached && cached.database !== database) recent.clear();
  // Profile, song visibility and recording metadata changes can affect the board without a canvas write.
  const state = readCanvas();
  const signatures = new Map(state.records.map(item => [item.id, digest(JSON.stringify(item))]));
  const order = state.records.map(item => item.id);
  const token = digest(JSON.stringify([state.revision, [...signatures]]));
  const index = { signatures, order };
  cached = { database, stamp, state, token, index };
  recent.delete(token);
  recent.set(token, index);
  if (recent.size > 24) {
    const oldest = recent.keys().next().value;
    if (oldest !== undefined) recent.delete(oldest);
  }
  return cached;
}

export function readCanvasSync(since: string | null): CanvasSyncReply {
  const { state, token, index } = currentBoard();
  if (token === since) return { kind: 'unchanged', token };
  const previous = since ? recent.get(since) : undefined;
  if (!since || !previous) return { kind: 'snapshot', token, state };
  const upserts = state.records.filter(item => previous.signatures.get(item.id) !== index.signatures.get(item.id));
  const removed = previous.order.filter(id => !index.signatures.has(id));
  const reordered = previous.order.length !== index.order.length || index.order.some((id, position) => id !== previous.order[position]);
  return { kind: 'delta', from: since, token, revision: state.revision, upserts, removed, ...(reordered && { order: index.order }) };
}
