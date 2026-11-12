import type { Song } from './types';

export const MAX_ART_BYTES = 2 * 1024 * 1024;
const MAX_TAG_WRITE_BYTES = 64 * 1024 * 1024;
export const ART_EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function thumbnail(blob: Blob) {
  if (!ART_EXTENSION[blob.type] || blob.size > MAX_ART_BYTES) return null;
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/webp', 0.85);
    } finally { bitmap.close(); }
  } catch { return null; }
}

export async function readDeviceTags(file: File, sidecar: File | undefined, fallback: Song): Promise<Song> {
  let tags;
  try {
    const metadata = await import('music-metadata');
    const parsed = await metadata.parseBlob(file);
    tags = parsed.common;
    if (parsed.format.duration && Number.isFinite(parsed.format.duration)) fallback = { ...fallback, duration: parsed.format.duration };
  } catch { /* Some files contain playable audio without readable tags. */ }
  const picture = tags?.picture?.find(image => image.type === 'Cover (front)') ?? tags?.picture?.[0];
  const embedded = picture && picture.data.length <= MAX_ART_BYTES
    ? await thumbnail(new Blob([new Uint8Array(picture.data)], { type: picture.format })) : null;
  const imageName = sidecar?.name.toLowerCase().replace(/\.jpeg$/, '.jpg');
  const sidecarType = sidecar?.type || Object.keys(ART_EXTENSION).find(type => imageName?.endsWith(`.${ART_EXTENSION[type]}`));
  const cover = embedded ?? (sidecar && sidecarType ? await thumbnail(sidecar.slice(0, sidecar.size, sidecarType)) : null);
  const artistNames = tags?.artists?.length ? tags.artists : tags?.artist ? [tags.artist] : [];
  return {
    ...fallback, name: tags?.title?.trim() || fallback.name,
    artists: [...new Set(artistNames.map(name => name.trim()).filter(Boolean))].map(name => ({ id: '', name })),
    album: { id: null, name: tags?.album?.trim() || '' }, cover,
  };
}

export async function embedDeviceTags(file: File, song: Song, cover: Blob | null) {
  if (file.size > MAX_TAG_WRITE_BYTES) return null;
  try {
    const { updateBuffer } = await import('music-metadata');
    const artist = song.artists.map(item => item.name).join(' / ');
    const bytes = await updateBuffer(new Uint8Array(await file.arrayBuffer()), {
      title: song.name,
      ...(artist && { artist }),
      ...(song.album.name && { album: song.album.name }),
      ...(cover && { picture: [{ type: 'Cover (front)', format: cover.type, data: new Uint8Array(await cover.arrayBuffer()) }] }),
    });
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: file.type });
  } catch { return null; }
}
