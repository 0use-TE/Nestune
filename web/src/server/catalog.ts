import { isUploadSong } from '@/lib/upload-types';
import { numericId } from './http';
import { songMeta } from './netease';
import { uploadedSong } from './uploads';

export const catalogId = (id: unknown) => isUploadSong(id) ? id : numericId(id);
export const catalogSong = (viewer: number, id: string) => isUploadSong(id) ? uploadedSong(viewer, id) : songMeta(id);
