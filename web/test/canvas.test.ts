import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { CANVAS_MOMENT_FONTS, isCanvasMusic } from '@/lib/canvas-types';
import { DEFAULT_CANVAS_SETTINGS } from '@/lib/canvas-settings';

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
beforeEach(() => {
  database.run("DELETE FROM kv WHERE key LIKE 'canvas:%'");
  database.run('DELETE FROM canvas_wall_tiles');
  database.run('DELETE FROM playlists');
  vi.clearAllMocks();
});
afterAll(() => { database.db().close(); fs.rmSync(folder, { recursive: true, force: true }); vi.unstubAllEnvs(); });

it('enforces changed personal and shared quotas without removing existing objects', async () => {
  const { saveCanvasSettings } = await import('@/server/canvas-settings');
  const { readCanvasSync } = await import('@/server/canvas-sync');
  const note = { kind: 'note', text: 'QA', x: 1, y: 2 };
  const initial = readCanvasSync(null);
  for (let i = 0; i < 30; i++) canvas.addCanvasTool(1, note);
  expect(() => canvas.addCanvasTool(1, note)).toThrow('每人最多放置 30 个物件');
  const next = saveCanvasSettings({ ...DEFAULT_CANVAS_SETTINGS, wallpaper: 'plaster', personalLimit: 31, totalLimit: 31 });
  expect(readCanvasSync(initial.token)).toMatchObject({ kind: 'delta', settings: next });
  canvas.addCanvasTool(1, note);
  expect(() => canvas.addCanvasTool(2, note)).toThrow('画布已满');
  saveCanvasSettings({ ...next, personalLimit: 1, totalLimit: 2 });
  expect(canvas.readCanvas().records).toHaveLength(31);
  expect(() => saveCanvasSettings({ ...next, wallpaper: '__proto__' })).toThrow('画布壁纸或涂鸦设置无效');
  expect(() => saveCanvasSettings({ ...next, personalLimit: 32 })).toThrow('每人上限');
  canvas.removeRecord(1, canvas.readCanvas().records[0].id);
  expect(canvas.readCanvas().records).toHaveLength(30);
});

it('pauses new graffiti while leaving existing paint readable', async () => {
  const { saveCanvasSettings } = await import('@/server/canvas-settings');
  const paint = await sharp({ create: { width: 24, height: 24, channels: 4, background: '#e02020' } }).png().toBuffer();
  const position = { x: 75, y: 80, boardWidth: 12 };
  const before = await canvas.addCanvasWallPaint(paint, position);
  saveCanvasSettings({ ...DEFAULT_CANVAS_SETTINGS, allowGraffiti: false });
  expect(() => canvas.addCanvasWallPaint(paint, position)).toThrow('画布暂时关闭了涂鸦发布');
  expect(canvas.readCanvas().wall).toEqual(before.wall);
});

it('uses the new zoom default with older settings and syncs a changed limit', async () => {
  const { saveCanvasSettings } = await import('@/server/canvas-settings');
  const { readCanvasSync } = await import('@/server/canvas-sync');
  const { zoomLimitPercent, ...oldSettings } = DEFAULT_CANVAS_SETTINGS;
  database.kvSet('canvas:settings', JSON.stringify(oldSettings));
  expect(canvas.readCanvas().settings.zoomLimitPercent).toBe(zoomLimitPercent);
  const initial = readCanvasSync(null);
  const customized = saveCanvasSettings({ ...oldSettings, zoomLimitPercent: 825 });
  expect(readCanvasSync(initial.token)).toMatchObject({ kind: 'delta', settings: customized, upserts: [], removed: [] });
  expect(saveCanvasSettings(oldSettings).zoomLimitPercent).toBe(825);
  for (const value of [99, 1001, 200.5, '500', null]) {
    expect(() => saveCanvasSettings({ ...oldSettings, zoomLimitPercent: value })).toThrow('最大缩放比例');
  }
  expect(canvas.readCanvas().settings.zoomLimitPercent).toBe(825);
});

it('updates wall pixels in place across tile boundaries and syncs tile versions', async () => {
  const { readCanvasSync } = await import('@/server/canvas-sync');
  const { wallTileImage } = await import('@/server/canvas-wall');
  const paint = (r: number, b: number, alpha = 1) =>
    sharp({ create: { width: 80, height: 40, channels: 4, background: { r, g: 0, b, alpha } } }).png().toBuffer();
  const position = { x: 0, y: 120, boardWidth: 40 };
  const blank = readCanvasSync(null);
  const first = await canvas.addCanvasWallPaint(await paint(255, 0), position);
  expect(first.records).toEqual([]);
  expect(first.wall?.map(({ x, y }) => [x, y])).toEqual([[-1, 0], [0, 0]]);
  const redTiles = first.wall!;
  const blended = await canvas.addCanvasWallPaint(await paint(0, 255, .5), position);
  expect(blended.wall).not.toEqual(redTiles);
  expect(() => wallTileImage(0, 0, redTiles[1].version)).toThrow('墙面区域已更新');
  for (const tile of blended.wall!) {
    const response = wallTileImage(tile.x, tile.y, tile.version);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toBe('private, max-age=86400, immutable');
    expect(wallTileImage(tile.x, tile.y, tile.version, response.headers.get('etag')).status).toBe(304);
    const left = tile.x === -1 ? 1023 : 0;
    const [r, g, b, a] = await sharp(Buffer.from(await response.arrayBuffer()))
      .extract({ left, top: 240, width: 1, height: 1 }).raw().toBuffer();
    expect(r).toBeGreaterThanOrEqual(126);
    expect(r).toBeLessThanOrEqual(128);
    expect([g, b, a]).toEqual([0, 128, 255]);
  }
  const blue = await canvas.addCanvasWallPaint(await paint(0, 255), position);
  const newest = redTiles.map(({ x, y }) => blue.wall!.find(tile => tile.x === x && tile.y === y)!);
  expect(newest).toEqual(blue.wall);
  const tile = newest[1];
  const image = Buffer.from(await wallTileImage(tile.x, tile.y, tile.version).arrayBuffer());
  expect([...await sharp(image).extract({ left: 0, top: 240, width: 1, height: 1 }).raw().toBuffer()]).toEqual([0, 0, 255, 255]);
  expect(database.one<{ count: number }>('SELECT count(*) AS count FROM canvas_wall_tiles')!.count).toBe(2);
  expect(fs.existsSync(path.join(folder, 'canvas-images'))).toBe(false);
  expect(readCanvasSync(blank.token)).toMatchObject({ kind: 'delta', wall: blue.wall, upserts: [], removed: [] });
});

it('stores soft paint at lower resolution and upgrades only tiles touched by higher-detail paint', async () => {
  const { wallTileImage } = await import('@/server/canvas-wall');
  const sprite = (width: number, background: string) =>
    sharp({ create: { width, height: width, channels: 4, background } }).png().toBuffer();
  const soft = await canvas.addCanvasWallPaint(await sprite(24, '#ff0000'), { x: 512, y: 256, boardWidth: 128 });
  const first = soft.wall!;
  expect(first.map(({ x, pixels }) => [x, pixels])).toEqual([[0, 128], [1, 128]]);
  const withDetail = await canvas.addCanvasWallPaint(await sprite(40, '#0000ff'), { x: 520, y: 256, boardWidth: 12 });
  expect(withDetail.wall![0]).toEqual(first[0]);
  const updated = withDetail.wall![1];
  expect(updated.pixels).toBe(1024);
  const image = Buffer.from(await wallTileImage(1, 0, updated.version).arrayBuffer());
  const pixel = async (left: number) => [...await sharp(image)
    .extract({ left, top: 512, width: 1, height: 1 }).raw().toBuffer()];
  expect(await pixel(16)).toEqual([0, 0, 255, 255]);
  expect(await pixel(80)).toEqual([255, 0, 0, 255]);
});

it('preserves concurrent paint submissions that touch the same tile', async () => {
  const { wallTileImage } = await import('@/server/canvas-wall');
  const square = (r: number, b: number) =>
    sharp({ create: { width: 24, height: 24, channels: 4, background: { r, g: 0, b, alpha: 1 } } }).png().toBuffer();
  const [red, blue] = await Promise.all([square(255, 0), square(0, 255)]);
  await Promise.all([
    canvas.addCanvasWallPaint(red, { x: 100, y: 100, boardWidth: 12 }),
    canvas.addCanvasWallPaint(blue, { x: 120, y: 100, boardWidth: 12 }),
  ]);
  const tile = canvas.readCanvas().wall![0];
  const png = Buffer.from(await wallTileImage(0, 0, tile.version).arrayBuffer());
  const at = async (left: number) => [...await sharp(png)
    .extract({ left, top: 200, width: 1, height: 1 }).raw().toBuffer()];
  expect(await at(200)).toEqual([255, 0, 0, 255]);
  expect(await at(240)).toEqual([0, 0, 255, 255]);
  expect(canvas.readCanvas().revision).toBe(2);
});

it('migrates older marks in display order beneath newer paint and preserves other canvas records', async () => {
  const { wallTileImage } = await import('@/server/canvas-wall');
  const sprite = (r: number, g: number, b: number, alpha = 1) =>
    sharp({ create: { width: 40, height: 40, channels: 4, background: { r, g, b, alpha } } }).png().toBuffer();
  const legacy = { x: 512, y: 100, graffiti: true, boardWidth: 20 };
  const red = await sprite(255, 0, 0);
  const first = canvas.addCanvasImage(1, red, legacy);
  const original = first.records[0];
  if (original.kind !== 'image') throw new Error('Missing legacy image');
  canvas.addCanvasImage(2, await sprite(0, 0, 255, .5), legacy);
  const note = canvas.addCanvasTool(1, { kind: 'note', text: '还在墙上', x: 50, y: 50 }).records.at(-1);
  await canvas.addCanvasWallPaint(await sprite(0, 255, 0), { x: 515, y: 100, boardWidth: 4 });

  expect(await canvas.migrateLegacyCanvasWall()).toEqual({ migrated: 2, tiles: 2 });
  const migrated = canvas.readCanvas();
  expect(migrated.records).toEqual([note]);
  const rightTile = migrated.wall!.find(tile => tile.x === 1)!;
  const image = Buffer.from(await wallTileImage(1, 0, rightTile.version).arrayBuffer());
  const pixel = async (left: number) => [...await sharp(image).extract({ left, top: 200, width: 1, height: 1 }).raw().toBuffer()];
  expect(await pixel(0)).toEqual([126, 0, 128, 255]);
  expect(await pixel(6)).toEqual([0, 255, 0, 255]);
  expect(fs.readFileSync(path.join(folder, 'canvas-images', original.imageFile))).toEqual(red);
  expect(await canvas.migrateLegacyCanvasWall()).toEqual({ migrated: 0, tiles: 2 });
  expect(canvas.readCanvas().revision).toBe(migrated.revision);
});

it('leaves the entire previous wall available when an older image cannot be read', async () => {
  const png = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#c46f48' } }).png().toBuffer();
  const first = canvas.addCanvasImage(1, png, { x: 50, y: 50, graffiti: true });
  const before = canvas.addCanvasImage(2, png, { x: 70, y: 50, graffiti: true });
  const missing = before.records[1];
  if (missing.kind !== 'image') throw new Error('Missing fixture image');
  fs.unlinkSync(path.join(folder, 'canvas-images', missing.imageFile));
  await expect(canvas.migrateLegacyCanvasWall()).rejects.toThrow('ENOENT');
  expect(canvas.readCanvas()).toEqual(before);
  const valid = first.records[0];
  if (valid.kind !== 'image') throw new Error('Missing fixture image');
  expect(canvas.canvasImage(valid.imageFile).status).toBe(200);
});

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
  for (const x of [NaN, Infinity, -1000001, 1000001, '50']) await expect(canvas.addRecord(1, { songId: '101', x, y: 100 })).rejects.toThrow();
  await expect(canvas.addRecord(1, { songId: 'device-123', x: 100, y: 100 })).rejects.toThrow();
  await expect(canvas.addRecord(1, { kind: 'queue', songIds: ['101','999'], x: 100, y: 100 })).rejects.toThrow();
  await expect(canvas.addRecord(1, { songId: 'upload-' + 'a'.repeat(32), x: 100, y: 100 })).rejects.toThrow('设为公开');
  expect(canvas.readCanvas()).toEqual({ revision: 0, records: [], settings: DEFAULT_CANVAS_SETTINGS });
});
it('stores notes and emoji on the same board and allows another user to take them away', () => {
  const withNote = canvas.addCanvasTool(1, { kind: 'note', text: '今天也要好好听歌。', color: 'butter', x: 100, y: 100 });
  expect(withNote.records[0]).toMatchObject({ ownerName: '小雨', kind: 'note', text: '今天也要好好听歌。' });
  canvas.addCanvasTool(2, { kind: 'emoji', emoji: '🎧', x: 300, y: 200 });
  canvas.removeRecord(3, withNote.records[0].id);
  expect(canvas.readCanvas().records.map(r => r.kind)).toEqual(['emoji']);
  expect(() => canvas.addCanvasTool(1, { kind: 'note', text: '', x: 100, y: 100 })).toThrow();
});
it('captures a fixed server timestamp and font only for an opted-in note', () => {
  const now = Date.parse('2026-11-18T03:04:05Z');
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  try {
    const note = { kind: 'note', text: '把此刻留下', x: 100, y: 100, moment: { timestamp: 1, font: 'invalid' } };
    const stamped = canvas.addCanvasTool(1, { ...note, captureMoment: true }).records[0];
    expect(stamped.kind).toBe('note');
    if (stamped.kind !== 'note') throw new Error('Missing note');
    expect(stamped.moment?.timestamp).toBe(now);
    expect(CANVAS_MOMENT_FONTS).toContain(stamped.moment?.font);

    clock.mockReturnValue(now + 60000);
    const plain = canvas.addCanvasTool(2, { ...note, captureMoment: false }).records.at(-1);
    expect(plain).not.toHaveProperty('moment');
    canvas.moveRecord(2, { id: stamped.id, x: 200, y: 200 });
    expect(canvas.readCanvas().records.at(-1)).toMatchObject({ id: stamped.id, moment: stamped.moment });
  } finally {
    clock.mockRestore();
  }
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
it('keeps graffiti as a fixed paint mark that can be covered but never moved or taken', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6km8AAAAASUVORK5CYII=', 'base64');
  const large = Buffer.from(png);
  large.writeUInt32BE(99999, 16);
  const placement = { x: 200, y: 200, graffiti: true };
  expect(() => canvas.addCanvasImage(1, large, placement)).toThrow('涂鸦尺寸无效');
  expect(() => canvas.addCanvasImage(1, Buffer.from('GIF89a'), placement)).toThrow('涂鸦需要 PNG');
  expect(() => canvas.addCanvasImage(1, png, { ...placement, boardWidth: '40001' })).toThrow('涂鸦放置尺寸无效');
  const item = canvas.addCanvasImage(1, png, placement).records[0];
  expect(item).toMatchObject({ kind: 'image', name: '涂鸦', rotation: 0, graffiti: { width: 1, height: 1 } });
  expect(canvas.readCanvas().records[0]).toEqual(item);
  if (item.kind !== 'image') throw new Error('Missing image');
  const image = canvas.canvasImage(item.imageFile);
  expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
  expect(canvas.canvasImage(item.imageFile, image.headers.get('etag')).status).toBe(304);
  expect(() => canvas.removeRecord(1, item.id)).toThrow('涂鸦固定在墙面上');
  await expect(canvas.takeCanvasItem(2, item.id)).rejects.toThrow('涂鸦固定在墙面上');
  expect(() => canvas.moveRecord(2, { id: item.id, x: 490, y: 140 })).toThrow('涂鸦固定在墙面上');
  const higherResolution = Buffer.from(png);
  higherResolution.writeUInt32BE(1280, 16);
  const fitted = canvas.addCanvasImage(1, higherResolution, { ...placement, boardWidth: '377.25' }).records.at(-1)!;
  expect(canvas.readCanvas().records.map(record => record.id)).toEqual([item.id, fitted.id]);
  expect(canvas.readCanvas().records[1]).toMatchObject({ x: 200, y: 200, graffiti: { width: 1280, height: 1, boardWidth: 377.25 } });
});
it('synchronizes only changed board objects, including order and profile edits at the same revision', async () => {
  const { readCanvasSync } = await import('@/server/canvas-sync');
  const first = canvas.addCanvasTool(1, { kind: 'note', text: '第一张', x: 200, y: 200 }).records[0];
  const initial = readCanvasSync(null);
  if (initial.kind !== 'snapshot') throw new Error('Missing initial snapshot');
  expect(readCanvasSync(initial.token)).toEqual({ kind: 'unchanged', token: initial.token });
  const added = canvas.addCanvasTool(1, { kind: 'note', text: '第二张', x: 220, y: 210 }).records.at(-1)!;
  const add = readCanvasSync(initial.token);
  expect(add).toMatchObject({ kind: 'delta', upserts: [added], removed: [], order: [first.id, added.id] });
  canvas.moveRecord(1, { id: first.id, x: 300, y: 260 });
  const move = readCanvasSync(add.token);
  expect(move).toMatchObject({ kind: 'delta', upserts: [{ id: first.id, x: 300, y: 260 }], removed: [], order: [added.id, first.id] });
  const revision = canvas.readCanvas().revision;
  database.run('UPDATE users SET display_name=? WHERE id=?', '新名字', 1);
  try {
    const profile = readCanvasSync(move.token);
    expect(profile).toMatchObject({ kind: 'delta', revision, upserts: [{ ownerName: '新名字' }, { ownerName: '新名字' }] });
    canvas.removeRecord(1, added.id);
    expect(readCanvasSync(profile.token)).toMatchObject({ kind: 'delta', upserts: [], removed: [added.id], order: [first.id] });
    expect(readCanvasSync('unknown')).toMatchObject({ kind: 'snapshot', state: { records: [{ id: first.id }] } });
  } finally {
    database.run('UPDATE users SET display_name=? WHERE id=?', '小雨', 1);
  }
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
