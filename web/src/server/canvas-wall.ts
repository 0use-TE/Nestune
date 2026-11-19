import { createHash } from 'node:crypto';
import sharp, { type Sharp } from 'sharp';
import { GRAFFITI_PNG_MAX_BYTES, MAX_GRAFFITI_SIDE, MAX_GRAFFITI_WORLD_WIDTH } from '@/lib/canvas-graffiti';
import type { CanvasWallTile } from '@/lib/canvas-types';
import { LEGACY_WALL_TILE_PIXELS, WALL_TILE_SIZE } from '@/lib/canvas-wall';
import { all, one, run } from './db';
import { fail } from './http';

type Coord = { x: number; y: number };
type Position = Coord & { width?: number };
type Dimensions = { width: number; height: number };
type LegacyPaint = { read: () => Promise<Buffer>; position: Position; dimensions: Dimensions };
type Footprint = { left: number; right: number; top: number; bottom: number; tiles: Coord[]; pixels: number };
type Patch = Dimensions & { left: number; top: number; rgba: Buffer };
type TileRaster = { pixels: number; image: Uint8Array };
type StoredTile = TileRaster & { version: string; mime: 'image/png' | 'image/webp' };
type TileUpdate = CanvasWallTile & { pixels: number; previous?: string; image?: Buffer };
const MAX_TILES_PER_PAINT = 64;
const MIN_TILE_PIXELS = 128;
const TILE_PIXEL_STEP = 32;
const webp = { lossless: true, effort: 3 };
const keyOf = ({ x, y }: Coord) => `${x}:${y}`;

export function wallTiles() {
  return all<CanvasWallTile & { pixels: number }>('SELECT x,y,version,pixels FROM canvas_wall_tiles ORDER BY y,x');
}

function currentTile(x: number, y: number) {
  return one<StoredTile>('SELECT version,pixels,mime,image FROM canvas_wall_tiles WHERE x=? AND y=?', x, y);
}

async function decodePaint(bytes: Buffer, expected?: Dimensions) {
  if (!bytes.length || bytes.length > GRAFFITI_PNG_MAX_BYTES) throw fail(413, '图片不能超过 3 MB');
  const source = sharp(bytes, { limitInputPixels: MAX_GRAFFITI_SIDE ** 2 });
  const { format, width, height } = await source.metadata().catch(() => { throw fail(400, '涂鸦 PNG 无法读取'); });
  if (format !== 'png' || width > MAX_GRAFFITI_SIDE || height > MAX_GRAFFITI_SIDE) {
    throw fail(400, '涂鸦需要尺寸有效的 PNG 图片');
  }
  if (expected && (width !== expected.width || height !== expected.height)) {
    throw fail(400, '历史涂鸦的图片尺寸与记录不符');
  }
  return { source, dimensions: { width, height } };
}

function footprint(position: Position, dimensions: Dimensions): Footprint {
  const width = position.width ?? Math.max(12, dimensions.width / 2);
  const height = width * dimensions.height / dimensions.width;
  if (!Number.isFinite(height) || height <= 0 || height > MAX_GRAFFITI_WORLD_WIDTH) {
    throw fail(400, '涂鸦放置尺寸无效');
  }
  const left = position.x - width / 2, right = position.x + width / 2;
  const top = position.y - height / 2, bottom = position.y + height / 2;
  const firstX = Math.floor(left / WALL_TILE_SIZE), lastX = Math.ceil(right / WALL_TILE_SIZE) - 1;
  const firstY = Math.floor(top / WALL_TILE_SIZE), lastY = Math.ceil(bottom / WALL_TILE_SIZE) - 1;
  if ((lastX - firstX + 1) * (lastY - firstY + 1) > MAX_TILES_PER_PAINT) {
    throw fail(400, '这次涂鸦跨得太远，请分几次喷涂');
  }
  const tiles: Coord[] = [];
  for (let y = firstY; y <= lastY; y++) {
    for (let x = firstX; x <= lastX; x++) tiles.push({ x, y });
  }
  const nativePixels = dimensions.width / width * WALL_TILE_SIZE;
  const pixels = Math.max(MIN_TILE_PIXELS, Math.min(LEGACY_WALL_TILE_PIXELS,
    Math.ceil(nativePixels / TILE_PIXEL_STEP) * TILE_PIXEL_STEP));
  return { left, right, top, bottom, tiles, pixels };
}

function pixelRange(start: number, end: number, density: number) {
  const first = Math.round(start * density), last = Math.round(end * density);
  if (last > first) return [first, last] as const;
  const centre = Math.floor((start + end) * density / 2);
  return [centre, centre + 1] as const;
}

async function paintPatch(source: Sharp, area: Footprint, { x, y }: Coord, pixels: number): Promise<Patch | undefined> {
  const density = pixels / WALL_TILE_SIZE;
  const [left, right] = pixelRange(area.left, area.right, density);
  const [top, bottom] = pixelRange(area.top, area.bottom, density);
  const tileLeft = x * pixels, tileTop = y * pixels;
  const startX = Math.max(left, tileLeft), startY = Math.max(top, tileTop);
  const width = Math.min(right, tileLeft + pixels) - startX;
  const height = Math.min(bottom, tileTop + pixels) - startY;
  if (width <= 0 || height <= 0) return;
  // Use the same scaled pixel grid in every tile sharing this resolution.
  const rgba = await source.clone().resize(right - left, bottom - top, { fit: 'fill' })
    .extract({ left: startX - left, top: startY - top, width, height }).toColourspace('srgb').ensureAlpha().raw().toBuffer()
    .catch(() => { throw fail(400, '涂鸦 PNG 无法读取'); });
  for (let alpha = 3; alpha < rgba.length; alpha += 4) {
    if (rgba[alpha]) return { left: startX - tileLeft, top: startY - tileTop, width, height, rgba };
  }
}

function tileCanvas(pixels: number, previous?: TileRaster) {
  if (previous) {
    const existing = sharp(previous.image);
    return previous.pixels === pixels ? existing : existing.resize(pixels, pixels);
  }
  return sharp({ create: { width: pixels, height: pixels, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
}

function blendPatch(patch: Patch, pixels: number, previous?: TileRaster) {
  const { width, height, left, top, rgba } = patch;
  return tileCanvas(pixels, previous)
    .composite([{ input: rgba, left, top, raw: { width, height, channels: 4 } }]).webp(webp).toBuffer();
}

function tileUpdate(coord: Coord, pixels: number, image: Buffer, previous?: string): TileUpdate {
  const version = createHash('sha256').update(image).digest('hex').slice(0, 32);
  return { ...coord, pixels, previous, version, image: version !== previous ? image : undefined };
}

async function blendPaint(source: Sharp, area: Footprint): Promise<TileUpdate[]> {
  const updates: TileUpdate[] = [];
  for (const coord of area.tiles) {
    const existing = currentTile(coord.x, coord.y);
    const pixels = Math.max(area.pixels, existing?.pixels ?? 0);
    const patch = await paintPatch(source, area, coord, pixels);
    if (patch) updates.push(tileUpdate(coord, pixels, await blendPatch(patch, pixels, existing), existing?.version));
  }
  return updates;
}

function writeTiles(updates: TileUpdate[]) {
  for (const { x, y, previous } of updates) {
    const before = one<{ version: string }>('SELECT version FROM canvas_wall_tiles WHERE x=? AND y=?', x, y);
    if (before?.version !== previous) throw new UpdatedTile();
  }
  for (const { x, y, pixels, version, image } of updates) {
    if (!image) continue;
    run(`INSERT INTO canvas_wall_tiles(x,y,version,pixels,mime,image) VALUES(?,?,?,?,'image/webp',?)
      ON CONFLICT(x,y) DO UPDATE SET version=excluded.version,pixels=excluded.pixels,mime=excluded.mime,image=excluded.image`,
    x, y, version, pixels, image);
  }
}

// PNG decoding is asynchronous. Check tile versions inside the transaction immediately before writing.
export async function compositeWall<T>(bytes: Buffer, position: Position, commit: (apply: () => void) => T): Promise<T> {
  const { source, dimensions } = await decodePaint(bytes);
  const area = footprint(position, dimensions);
  for (let attempt = 0; attempt < 4; attempt++) {
    const updates = await blendPaint(source, area);
    if (!updates.length) throw fail(400, '这张涂鸦没有可合成的喷漆');
    try {
      return commit(() => writeTiles(updates));
    } catch (error) {
      if (!(error instanceof UpdatedTile)) throw error;
    }
  }
  throw fail(409, '这片墙面正在被其他人涂鸦，请再点一次完成');
}

export async function stageLegacyWall(paints: LegacyPaint[]) {
  // Choose each tile's resolution before compositing older marks into it.
  const planned = paints.map(paint => ({ ...paint, area: footprint(paint.position, paint.dimensions) }));
  const sizes = new Map(wallTiles().map(tile => [keyOf(tile), tile.pixels]));
  for (const { area } of planned) {
    for (const coord of area.tiles) {
      const key = keyOf(coord);
      sizes.set(key, Math.max(area.pixels, sizes.get(key) ?? 0));
    }
  }
  const baked = new Map<string, Coord & TileRaster>();
  for (const { read, dimensions, area } of planned) {
    const { source } = await decodePaint(await read(), dimensions);
    for (const coord of area.tiles) {
      const key = keyOf(coord);
      const pixels = sizes.get(key) ?? area.pixels;
      const patch = await paintPatch(source, area, coord, pixels);
      if (!patch) continue;
      const image = await blendPatch(patch, pixels, baked.get(key));
      baked.set(key, { ...coord, pixels, image });
    }
  }
  const updates: TileUpdate[] = [];
  for (const tile of baked.values()) {
    // Paint already stored as tiles sits above all legacy marks on the current wall.
    const latest = currentTile(tile.x, tile.y);
    const pixels = Math.max(tile.pixels, latest?.pixels ?? 0);
    const overlay = latest && latest.pixels !== pixels
      ? await tileCanvas(pixels, latest).webp(webp).toBuffer() : latest?.image;
    const combined = overlay
      ? await tileCanvas(pixels, tile).composite([{ input: Buffer.from(overlay) }]).webp(webp).toBuffer()
      : Buffer.from(tile.image);
    updates.push(tileUpdate({ x: tile.x, y: tile.y }, pixels, combined, latest?.version));
  }
  return () => {
    try { writeTiles(updates); }
    catch (error) {
      if (!(error instanceof UpdatedTile)) throw error;
      throw fail(409, '迁移期间墙面有更新，请重新开始迁移');
    }
  };
}

class UpdatedTile extends Error {}

export function wallTileImage(x: number, y: number, version: string | null, match?: string | null) {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !version || !/^[a-f0-9]{32}$/.test(version)) {
    throw fail(404, '墙面区域不存在');
  }
  const tile = currentTile(x, y);
  if (!tile || tile.version !== version) throw fail(404, '墙面区域已更新');
  const headers = {
    'Content-Type': tile.mime,
    'Cache-Control': 'private, max-age=86400, immutable',
    'X-Content-Type-Options': 'nosniff',
    ETag: `"${version}"`,
  };
  if (match === headers.ETag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(tile.image), { headers });
}
