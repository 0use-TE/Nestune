import type { Song } from './types';

export const UPLOAD_VISIBILITY = { private: '仅自己', shared: '共享', public: '公开' } as const;
export type UploadVisibility = keyof typeof UPLOAD_VISIBILITY;
export const MAX_UPLOAD_AUDIO = 64 * 1024 * 1024;
export const MAX_UPLOAD_LYRICS = 128 * 1024;
export const isUploadSong = (id: unknown): id is string => typeof id === 'string' && /^upload-[a-f0-9]{32}$/.test(id);

export type ManagedUpload = {
  song: Song;
  artist: string;
  lyricist: string;
  composer: string;
  lyrics: string;
  visibility: UploadVisibility;
  recipients: number[];
  createdAt: number;
};
