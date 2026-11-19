import type { Song } from './types';
import type { CanvasSettings } from './canvas-settings';

export type CanvasBase = {
  id: string; ownerId: number; ownerName?: string; ownerAvatar?: string | null;
  x: number; y: number; rotation: number; name: string;
};
export type CanvasRecord = CanvasBase & {
  kind: 'song' | 'album' | 'playlist' | 'queue'; song: Song; tracks?: Song[]; albumId: string | null;
};
export const CANVAS_MOMENT_FONTS = ['handwritten', 'brush', 'serif'] as const;
type CanvasMoment = { timestamp: number; font: typeof CANVAS_MOMENT_FONTS[number] };
export type CanvasNote = CanvasBase & {
  kind: 'note'; text: string; color: 'paper' | 'butter' | 'rose' | 'mint'; moment?: CanvasMoment;
};
type CanvasPaint = { width: number; height: number; boardWidth?: number };
export type CanvasImage = CanvasBase & { kind: 'image'; imageFile: string; graffiti?: CanvasPaint };
export type CanvasEmoji = CanvasBase & { kind: 'emoji'; emoji: string };
export type CanvasItem = CanvasRecord | CanvasNote | CanvasImage | CanvasEmoji;
export type CanvasWallTile = { x: number; y: number; version: string; pixels?: number };
export type CanvasState = { revision: number; records: CanvasItem[]; wall?: CanvasWallTile[]; settings?: CanvasSettings };
export type CanvasSyncReply =
  | { kind: 'snapshot'; token: string; state: CanvasState }
  | { kind: 'unchanged'; token: string }
  | { kind: 'delta'; from: string; token: string; revision: number; upserts: CanvasItem[]; removed: string[]; order?: string[]; wall?: CanvasWallTile[]; settings?: CanvasSettings };
export type CanvasTake = { state: CanvasState; item: CanvasItem };
export type CanvasSource = {
  kind: CanvasRecord['kind']; name: string; cover?: string | null;
  songId?: string; albumId?: string; playlistId?: string; songIds?: string[]; previewSong?: Song;
};
export const isCanvasMusic = (item: { kind: string }): item is CanvasRecord => ['song', 'album', 'playlist', 'queue'].includes(item.kind);
export const isCanvasGraffiti = (item: CanvasItem): item is CanvasImage & { graffiti: CanvasPaint } => item.kind === 'image' && !!item.graffiti;
export const CANVAS_DRAG_TYPE = 'application/x-nestune-canvas';
