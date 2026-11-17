import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { isCanvasMusic } from '@/lib/canvas-types';

vi.mock('@/server/netease', () => {
  const track = (id: string) => ({ id, name: 'Song ' + id, duration: 180, artists: [{ id: '1', name: 'Artist' }], album: { id: '7', name: 'Album' }, cover: null });
  return { songMeta: vi.fn(async (id: string) => track(id)), songs: vi.fn(async (ids: string[]) => ids.filter(id => id !== '999').map(track)), album: vi.fn(async () => ({ album: { id: '7', name: 'Album' }, songs: [track('101'), track('102')] })) };
});
let folder: string;
let database: typeof import('@/server/db');
let canvas: typeof import('@/server/canvas');
beforeAll(async () => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nestune-canvas-'));
  vi.stubEnv('DATA_DIR', folder);
  database = await import('@/server/db'); canvas = await import('@/server/canvas');
  for (const id of [1, 2, 3]) database.run("INSERT INTO users(id,username,display_name,status,created_at) VALUES(?,?,?,'active',1)", id, 'user' + id, ['小雨','阿林','小陈'][id - 1]);
});
beforeEach(() => { database.run("DELETE FROM kv WHERE key LIKE 'canvas:%'"); database.run('DELETE FROM playlists'); vi.clearAllMocks(); });
afterAll(() => { database.db().close(); fs.rmSync(folder, { recursive: true, force: true }); vi.unstubAllEnvs(); });

it('shares one persistent board, preserves concurrent additions and attributes their original posters', async () => {
  await Promise.all([canvas.addRecord(1, { songId: '101', x: 150, y: 200 }), canvas.addRecord(2, { albumId: '7', kind: 'album', x: 550, y: 400 })]);
  const shared = canvas.readCanvas();
  expect(shared.revision).toBe(2); expect(shared.records.map(r => r.ownerId).sort()).toEqual([1, 2]);
  const album = shared.records.find(r => r.ownerId === 2)!;
  expect(album).toMatchObject({ kind: 'album', albumId: '7', name: 'Album', ownerName: '阿林' });
  expect(isCanvasMusic(album) && album.tracks?.map(s => s.id)).toEqual(['101','102']);
  canvas.moveRecord(3, { id: album.id, x: 350, y: 300 });
  expect(canvas.readCanvas().records.find(r => r.id === album.id)?.ownerName).toBe('阿林');
  expect(JSON.parse(database.kvGet('canvas:shared:v1')!).records).toEqual(canvas.readCanvas().records);
});
it('allows exactly one person to take a shared item, including someone other than its poster', async () => {
  const state = await canvas.addRecord(1, { songId: '101', x: 150, y: 200 });
  const results = await Promise.allSettled([canvas.takeCanvasItem(2, state.records[0].id), canvas.takeCanvasItem(3, state.records[0].id)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
  expect(canvas.readCanvas().records).toEqual([]);
  await expect(canvas.takeCanvasItem(1, state.records[0].id)).rejects.toThrow('已经被别人拿走');
});
it('keeps a moved record above newer notes, persists the order and never duplicates an item', async () => {
  const first = await canvas.addRecord(1, { songId: '101', x: 150, y: 200 });
  const record = first.records[0];
  const withNote = canvas.addCanvasTool(2, { kind: 'note', text: '在这里听歌', x: 400, y: 350 });
  const note = withNote.records.at(-1)!;
  const moved = canvas.moveRecord(3, { id: record.id, x: note.x, y: note.y });
  expect(moved.records.map(r => r.id)).toEqual([note.id, record.id]);
  expect(canvas.readCanvas().records.map(r => r.id)).toEqual([note.id, record.id]);
  expect(JSON.parse(database.kvGet('canvas:shared:v1')!).records.map((r: { id: string }) => r.id)).toEqual([note.id, record.id]);
  expect(moved.records.at(-1)).toMatchObject({ x: 400, y: 350, ownerName: '小雨' });
  canvas.moveRecord(2, { id: record.id, x: 450, y: 350 });
  expect(canvas.readCanvas().records.map(r => r.id)).toEqual([note.id, record.id]);
});
it('takes a complete ordered queue snapshot without changing the original user queue', async () => {
  database.run("INSERT OR REPLACE INTO queue(user_id,data) VALUES(1,?)", JSON.stringify({ ids: ['102','101','102'], index: 0, position: 0 }));
  const before = database.one<{ data: string }>('SELECT data FROM queue WHERE user_id=1')!.data;
  const state = await canvas.addRecord(1, { kind: 'queue', songIds: ['102','101','102'], x: 100, y: 100 });
  const result = await canvas.takeCanvasItem(2, state.records[0].id);
  expect(isCanvasMusic(result.item) && result.item.tracks?.map(s => s.id)).toEqual(['102','101','102']);
  expect(result.state.records).toEqual([]);
  expect(database.one<{ data: string }>('SELECT data FROM queue WHERE user_id=1')!.data).toBe(before);
});
it('shares a playlist snapshot while preserving its source and checking playlist ownership', async () => {
  database.run("INSERT INTO playlists(id,user_id,name,description,created_at,updated_at) VALUES(11,1,'夜晚散步','',1,1)");
  const { songMeta } = await import('@/server/netease');
  for (const [index, id] of ['103','101'].entries()) database.run('INSERT INTO playlist_songs(playlist_id,song_id,meta,added_at) VALUES(11,?,?,?)', id, JSON.stringify(await songMeta(id)), index);
  await expect(canvas.addRecord(2, { kind: 'playlist', playlistId: '11', x: 100, y: 100 })).rejects.toThrow('歌单不存在');
  const shared = await canvas.addRecord(1, { kind: 'playlist', playlistId: '11', x: 100, y: 100 });
  const result = await canvas.takeCanvasItem(2, shared.records[0].id);
  expect(result.item.name).toBe('夜晚散步');
  expect(isCanvasMusic(result.item) && result.item.tracks?.map(s => s.id)).toEqual(['103','101']);
  expect(database.all('SELECT * FROM playlist_songs WHERE playlist_id=11')).toHaveLength(2);
});
it('rejects invalid coordinates, local files, unavailable queue entries and private uploads without losing shared data', async () => {
  for (const x of [NaN, Infinity, -1, 1001, '50']) await expect(canvas.addRecord(1, { songId: '101', x, y: 100 })).rejects.toThrow();
  await expect(canvas.addRecord(1, { songId: 'device-123', x: 100, y: 100 })).rejects.toThrow();
  await expect(canvas.addRecord(1, { kind: 'queue', songIds: ['101','999'], x: 100, y: 100 })).rejects.toThrow();
  await expect(canvas.addRecord(1, { songId: 'upload-' + 'a'.repeat(32), x: 100, y: 100 })).rejects.toThrow('设为公开');
  expect(canvas.readCanvas()).toEqual({ revision: 0, records: [] });
});
it('stores notes and emoji on the same board and allows another user to take them away', () => {
  const withNote = canvas.addCanvasTool(1, { kind: 'note', text: '今天也要好好听歌。', color: 'butter', x: 100, y: 100 });
  expect(withNote.records[0]).toMatchObject({ ownerName: '小雨', kind: 'note', text: '今天也要好好听歌。' });
  canvas.addCanvasTool(2, { kind: 'emoji', emoji: '🎧', x: 300, y: 200 });
  canvas.removeRecord(3, withNote.records[0].id);
  expect(canvas.readCanvas().records.map(r => r.kind)).toEqual(['emoji']);
  expect(() => canvas.addCanvasTool(1, { kind: 'note', text: '', x: 100, y: 100 })).toThrow();
});
it('serves only referenced raster images and stops serving an image after someone takes it', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6km8AAAAASUVORK5CYII=', 'base64');
  const state = canvas.addCanvasImage(1, png, { x: 300, y: 200 });
  const item = state.records[0]; if (item.kind !== 'image') throw new Error('image missing');
  expect(canvas.canvasImage(item.imageFile).headers.get('Content-Type')).toBe('image/png');
  expect(() => canvas.addCanvasImage(1, Buffer.from('<svg onload="alert(1)"/>'), { x: 100, y: 100 })).toThrow();
  expect(() => canvas.canvasImage('../app.db')).toThrow();
  await canvas.takeCanvasItem(2, item.id);
  expect(() => canvas.canvasImage(item.imageFile)).toThrow('已被取走');
});
it('hides uploads which are no longer public', async () => {
  const state = await canvas.addRecord(1, { songId: '101', x: 100, y: 100 });
  const item = state.records[0]; if (!isCanvasMusic(item)) throw new Error('music missing');
  item.song.id = 'upload-' + 'a'.repeat(32); database.kvSet('canvas:shared:v1', JSON.stringify(state));
  expect(canvas.readCanvas().records).toEqual([]);
  expect(canvas.readCanvas().records).toHaveLength(0);
});

it('leaves a record in place if the receiving queue rejects it', async () => {
  const board = await canvas.addRecord(1, { kind: 'album', albumId: '7', x: 200, y: 200 });
  await expect(canvas.takeCanvasItem(2, board.records[0].id, () => { throw new Error('queue full'); })).rejects.toThrow('queue full');
  expect(canvas.readCanvas()).toEqual(board);
});
