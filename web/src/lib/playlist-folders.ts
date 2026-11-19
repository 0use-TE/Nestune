import type { Song } from './types';
export type FolderKind = 'album' | 'mine' | 'shared' | 'netease' | 'qq';
export type PlaylistFolder = { id: number; kind: FolderKind; targetId: string; name: string; cover: string | null; readonly: boolean; available: boolean; songs: Song[]; directSongs: Song[]; folders: PlaylistFolder[] };
export type FolderSource = { kind: FolderKind; id: string };
export type AddFolderInput = FolderSource | { link: string };
