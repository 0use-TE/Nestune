import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { GRAFFITI_PNG_MAX_BYTES, MAX_GRAFFITI_SIDE, MAX_GRAFFITI_WORLD_WIDTH } from '@/lib/canvas-graffiti';
import type { CanvasWallTile } from '@/lib/canvas-types';
import { WALL_TILE_DENSITY, WALL_TILE_PIXELS } from '@/lib/canvas-wall';
import { all, one, run } from './db';
import { fail } from './http';

type Position = { x: number; y: number; width?: number };
type LegacyPaint = { bytes: Buffer; position: Position; dimensions: { width: number; height: number } };
type Patch = { x: number; y: number; left: number; top: number; width: number; height: number; rgba: Buffer };
type TileUpdate = CanvasWallTile & { previous?: string; png?: Buffer };
const MAX_TILES_PER_PAINT = 64;
const emptyTile = {
  create: { width: WALL_TILE_PIXELS, height: WALL_TILE_PIXELS, channels: 4 as const, background: { r: 0, g: 0, b: 0, alpha: 0 } },
};

export function wallTiles() {
  return all<CanvasWallTile>('SELECT x,y,version FROM canvas_wall_tiles ORDER BY y,x');
}

function currentTile(x: number, y: number) {
  return one<{ version: string; png: Uint8Array }>('SELECT version,png FROM canvas_wall_tiles WHERE x=? AND y=?', x, y);
}

async function paintPatches(bytes: Buffer, position: Position, expected?: LegacyPaint['dimensions']): Promise<Patch[]> {
  if (!bytes.length || bytes.length > GRAFFITI_PNG_MAX_BYTES) throw fail(413, '图片不能超过 3 MB');
  const source = sharp(bytes, { limitInputPixels: MAX_GRAFFITI_SIDE ** 2 });
  const metadata = await source.metadata().catch(() => { throw fail(400, '涂鸦 PNG 无法读取'); });
  if (metadata.format !== 'png' || metadata.width > MAX_GRAFFITI_SIDE || metadata.height > MAX_GRAFFITI_SIDE) {
    throw fail(400, '涂鸦需要尺寸有效的 PNG 图片');
  }
  if (expected && (metadata.width !== expected.width || metadata.height !== expected.height)) {
    throw fail(400, '历史涂鸦的图片尺寸与记录不符');
  }
  const worldWidth = position.width ?? Math.max(12, metadata.width / 2);
  const worldHeight = worldWidth * metadata.height / metadata.width;
  if (worldHeight > MAX_GRAFFITI_WORLD_WIDTH) throw fail(400, '涂鸦放置尺寸无效');
  const width = Math.max(1, Math.round(worldWidth * WALL_TILE_DENSITY));
  const height = Math.max(1, Math.round(worldHeight * WALL_TILE_DENSITY));
  const left = Math.round(position.x * WALL_TILE_DENSITY - width / 2);
  const top = Math.round(position.y * WALL_TILE_DENSITY - height / 2);
  const firstX = Math.floor(left / WALL_TILE_PIXELS), lastX = Math.floor((left + width - 1) / WALL_TILE_PIXELS);
  const firstY = Math.floor(top / WALL_TILE_PIXELS), lastY = Math.floor((top + height - 1) / WALL_TILE_PIXELS);
  if ((lastX - firstX + 1) * (lastY - firstY + 1) > MAX_TILES_PER_PAINT) {
    throw fail(400, '这次涂鸦跨得太远，请分几次喷涂');
  }
  // Resize on a common pixel grid before extracting each tile so the overlap lines up at its edges.
  const resized = source.resize(width, height, { fit: 'fill' }).toColourspace('srgb').ensureAlpha();
  const patches: Patch[] = [];
  for (let y = firstY; y <= lastY; y++) {
    for (let x = firstX; x <= lastX; x++) {
      const tileLeft = x * WALL_TILE_PIXELS, tileTop = y * WALL_TILE_PIXELS;
      const startX = Math.max(left, tileLeft), startY = Math.max(top, tileTop);
      const crop = {
        left: startX - left, top: startY - top,
        width: Math.min(left + width, tileLeft + WALL_TILE_PIXELS) - startX,
        height: Math.min(top + height, tileTop + WALL_TILE_PIXELS) - startY,
      };
      const rgba = await resized.clone().extract(crop).raw().toBuffer()
        .catch(() => { throw fail(400, '涂鸦 PNG 无法读取'); });
      let alpha = 3;
      while (alpha < rgba.length && !rgba[alpha]) alpha += 4;
      if (alpha < rgba.length) {
        patches.push({ x, y, left: startX - tileLeft, top: startY - tileTop, width: crop.width, height: crop.height, rgba });
      }
    }
  }
  return patches;
}

function blendPatch(patch: Patch, previous?: Uint8Array) {
  const { width, height, left, top, rgba } = patch;
  return (previous ? sharp(previous) : sharp(emptyTile))
    .composite([{ input: rgba, left, top, raw: { width, height, channels: 4 } }]).png().toBuffer();
}

function tileUpdate(x: number, y: number, png: Buffer, previous?: string): TileUpdate {
  const version = createHash('sha256').update(png).digest('hex').slice(0, 32);
  return { x, y, previous, version, png: version !== previous ? png : undefined };
}

async function blendPatches(patches: Patch[]): Promise<TileUpdate[]> {
  const updates: TileUpdate[] = [];
  for (const patch of patches) {
    const { x, y } = patch;
    const existing = currentTile(x, y);
    updates.push(tileUpdate(x, y, await blendPatch(patch, existing?.png), existing?.version));
  }
  return updates;
}

function writeTiles(updates: TileUpdate[]) {
  for (const { x, y, previous } of updates) {
    const before = one<{ version: string }>('SELECT version FROM canvas_wall_tiles WHERE x=? AND y=?', x, y);
    if (before?.version !== previous) throw new UpdatedTile();
  }
  for (const { x, y, version, png } of updates) {
    if (!png) continue;
    run(`INSERT INTO canvas_wall_tiles(x,y,version,png) VALUES(?,?,?,?)
      ON CONFLICT(x,y) DO UPDATE SET version=excluded.version,png=excluded.png`, x, y, version, png);
  }
}

// PNG decoding is asynchronous. Check tile versions inside the transaction immediately before writing.
export async function compositeWall<T>(bytes: Buffer, position: Position, commit: (apply: () => void) => T): Promise<T> {
  const patches = await paintPatches(bytes, position);
  if (!patches.length) throw fail(400, '这张涂鸦没有可合成的喷漆');
  for (let attempt = 0; attempt < 4; attempt++) {
    const updates = await blendPatches(patches);
    try {
      return commit(() => writeTiles(updates));
    } catch (error) {
      if (!(error instanceof UpdatedTile)) throw error;
    }
  }
  throw fail(409, '这片墙面正在被其他人涂鸦，请再点一次完成');
}

export async function stageLegacyWall(paints: AsyncIterable<LegacyPaint>) {
  const baked = new Map<string, { x: number; y: number; png: Buffer }>();
  for await (const { bytes, position, dimensions } of paints) {
    for (const patch of await paintPatches(bytes, position, dimensions)) {
      const { x, y } = patch;
      const key = `${x}:${y}`;
      const png = await blendPatch(patch, baked.get(key)?.png);
      baked.set(key, { x, y, png });
    }
  }
  const updates: TileUpdate[] = [];
  for (const { x, y, png } of baked.values()) {
    // Paint already stored as tiles sits above all legacy marks on the current wall.
    const latest = currentTile(x, y);
    const combined = latest ? await sharp(png).composite([{ input: Buffer.from(latest.png) }]).png().toBuffer() : png;
    updates.push(tileUpdate(x, y, combined, latest?.version));
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
    'Content-Type': 'image/png',
    'Cache-Control': 'private, max-age=86400, immutable',
    'X-Content-Type-Options': 'nosniff',
    ETag: `"${version}"`,
  };
  if (match === headers.ETag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(tile.png), { headers });
}
