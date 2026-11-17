import type { Song } from './types';

export type CanvasBase = {
  id: string; ownerId: number; ownerName?: string; ownerAvatar?: string | null;
  x: number; y: number; rotation: number; name: string;
};
export type CanvasRecord = CanvasBase & {
  kind: 'song' | 'album' | 'playlist' | 'queue'; song: Song; tracks?: Song[]; albumId: string | null;
};
export type CanvasNote = CanvasBase & { kind: 'note'; text: string; color: 'paper' | 'butter' | 'rose' | 'mint' };
export type CanvasImage = CanvasBase & { kind: 'image'; imageFile: string };
export type CanvasEmoji = CanvasBase & { kind: 'emoji'; emoji: string };
export type CanvasItem = CanvasRecord | CanvasNote | CanvasImage | CanvasEmoji;
export type CanvasState = { revision: number; records: CanvasItem[] };
export type CanvasTake = { state: CanvasState; item: CanvasItem };
export type CanvasSource = {
  kind: CanvasRecord['kind']; name: string; cover?: string | null;
  songId?: string; albumId?: string; playlistId?: string; songIds?: string[]; previewSong?: Song;
};
export const isCanvasMusic = (item: { kind: string }): item is CanvasRecord => ['song', 'album', 'playlist', 'queue'].includes(item.kind);
export const CANVAS_DRAG_TYPE = 'application/x-nestune-canvas';
