import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { parseBlob } from 'music-metadata';
import type { Song } from '@/lib/types';
import { isUploadSong, MAX_UPLOAD_AUDIO, MAX_UPLOAD_LYRICS, UPLOAD_VISIBILITY, type ManagedUpload, type UploadVisibility } from '@/lib/upload-types';
import { MAX_AVATAR, sniffImage } from './avatar';
import { dir } from './config';
import { all, db, now, one, run } from './db';
import { fail, str } from './http';
import { mimeOf } from './media';
import { parseLrc } from './netease';

type UploadRow = {
  id: string; owner_id: number; owner_name: string; name: string; artist: string; album: string;
  lyricist: string; composer: string; lyrics: string; visibility: UploadVisibility; duration: number;
  audio_ext: string; audio_size: number; cover_file: string | null; created_at: number;
};

const SELECT = `SELECT s.*,COALESCE(NULLIF(u.display_name,''),u.username) owner_name
  FROM uploaded_songs s JOIN users u ON u.id=s.owner_id`;
const VISIBLE = `(s.owner_id=:viewer OR (u.status='active' AND
  (s.visibility='public' OR (s.visibility='shared' AND EXISTS (
    SELECT 1 FROM upload_recipients r JOIN friendships f
      ON f.low_id=min(s.owner_id,r.user_id) AND f.high_id=max(s.owner_id,r.user_id) AND f.accepted=1
    WHERE r.song_id=s.id AND r.user_id=:viewer
  )))))`;

export const uploadPath = (file: string) => dir('uploads', file);
const audioName = (row: UploadRow) => `${row.id}.${row.audio_ext}`;
export const uploadAudio = (row: UploadRow) => ({ path: uploadPath(audioName(row)), mime: mimeOf(row.audio_ext), ext: row.audio_ext, size: row.audio_size });

function songShape(row: UploadRow): Song {
  return {
    id: row.id, name: row.name, duration: row.duration,
    artists: row.artist ? [{ id: '', name: row.artist }] : [],
    album: { id: null, name: row.album },
    cover: row.cover_file ? `/api/uploads/${row.id}/cover?v=${row.cover_file}` : null,
    uploader: { id: row.owner_id, name: row.owner_name },
  };
}

export function visibleUpload(viewer: number, id: string) {
  return one<UploadRow>(`${SELECT} WHERE s.id=:id AND ${VISIBLE}`, { viewer, id });
}

export function requireUpload(viewer: number, id: string) {
  const row = visibleUpload(viewer, id);
  if (!row) throw fail(404, '歌曲不存在或不可见');
  return row;
}

export const uploadedSong = (viewer: number, id: string) => songShape(requireUpload(viewer, id));

export function visibleSong(viewer: number, song: Song): Song | undefined {
  if (!isUploadSong(song.id)) return song;
  const row = visibleUpload(viewer, song.id);
  return row ? songShape(row) : undefined;
}

export function uploadLyrics(viewer: number, id: string) {
  const row = requireUpload(viewer, id);
  const lines = parseLrc(row.lyrics);
  const credits = [row.lyricist && `作词：${row.lyricist}`, row.composer && `作曲：${row.composer}`].filter(Boolean);
  return { id, lines, plainText: lines.length ? '' : row.lyrics, credits };
}

export function searchUploads(viewer: number, query: string, limit: number, offset: number) {
  const where = `WHERE ${VISIBLE} AND (instr(lower(s.name),lower(:query))>0 OR instr(lower(s.artist),lower(:query))>0
    OR instr(lower(s.album),lower(:query))>0 OR instr(lower(s.lyricist),lower(:query))>0 OR instr(lower(s.composer),lower(:query))>0
    OR instr(lower(COALESCE(NULLIF(u.display_name,''),u.username)),lower(:query))>0)`;
  const params = { viewer, query };
  const { n: total } = one<{ n: number }>(`SELECT count(*) n FROM uploaded_songs s JOIN users u ON u.id=s.owner_id ${where}`, params)!;
  const items = all<UploadRow>(`${SELECT} ${where} ORDER BY s.created_at DESC,s.id LIMIT :limit OFFSET :offset`, { ...params, limit, offset }).map(songShape);
  return { items, total };
}

function managed(row: UploadRow): ManagedUpload {
  return {
    song: songShape(row), artist: row.artist, lyrics: row.lyrics, lyricist: row.lyricist, composer: row.composer,
    visibility: row.visibility, createdAt: row.created_at,
    recipients: all<{ user_id: number }>('SELECT user_id FROM upload_recipients WHERE song_id=?', row.id).map(item => item.user_id),
  };
}

export const myUploads = (owner: number) => all<UploadRow>(`${SELECT} WHERE s.owner_id=? ORDER BY s.created_at DESC,s.id`, owner).map(managed);

function owned(owner: number, id: string) {
  const row = one<UploadRow>(`${SELECT} WHERE s.owner_id=? AND s.id=?`, owner, id);
  if (!row) throw fail(404, '找不到上传的歌曲');
  return row;
}

export async function uploadForm(req: Request) {
  const maxBytes = MAX_UPLOAD_AUDIO + MAX_AVATAR + MAX_UPLOAD_LYRICS + 32 * 1024;
  if (!req.body || !req.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;')) throw fail(400, '请选择音频文件');
  if (Number(req.headers.get('content-length')) > maxBytes) throw fail(413, '上传文件过大');
  let bytes = 0;
  let overLimit = false;
  const bounded = req.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        overLimit = true;
        controller.error(fail(413, '上传文件过大'));
      } else controller.enqueue(chunk);
    },
  }));
  const init = { method: 'POST', headers: req.headers, body: bounded, duplex: 'half' } as RequestInit;
  try { return await new Request(req.url, init).formData(); }
  catch { throw overLimit ? fail(413, '上传文件过大') : fail(400, '上传格式无效'); }
}

function readFields(form: FormData, owner: number) {
  const visibility = form.get('visibility');
  if (typeof visibility !== 'string' || !Object.hasOwn(UPLOAD_VISIBILITY, visibility)) throw fail(400, '请选择可见范围');
  const recipients = visibility === 'shared' ? [...new Set(form.getAll('recipients').map(Number))] : [];
  if (visibility === 'shared' && (!recipients.length || recipients.some(peer => !Number.isSafeInteger(peer) || peer === owner ||
    !one(`SELECT 1 FROM friendships f JOIN users u ON u.id=? AND u.status='active'
      WHERE f.low_id=? AND f.high_id=? AND f.accepted=1`, peer, Math.min(peer, owner), Math.max(peer, owner))))) {
    throw fail(400, '请选择有效的共享好友');
  }
  const lyrics = str(form.get('lyrics'), 0, MAX_UPLOAD_LYRICS, '歌词').replace(/^\uFEFF/, '');
  if (Buffer.byteLength(lyrics) > MAX_UPLOAD_LYRICS) throw fail(413, '歌词文件不能超过 128 KB');
  return {
    name: str(form.get('name'), 1, 160, '歌名'), artist: str(form.get('artist'), 0, 160, '歌手'),
    album: str(form.get('album'), 0, 160, '专辑'), lyricist: str(form.get('lyricist'), 0, 160, '作词'),
    composer: str(form.get('composer'), 0, 160, '作曲'), lyrics, visibility: visibility as UploadVisibility, recipients,
  };
}

function audioExtension(header: Buffer) {
  const prefix = header.toString('ascii', 0, 4);
  if (prefix === 'fLaC') return 'flac';
  if (prefix === 'OggS') return 'ogg';
  if (prefix === 'RIFF' && header.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (header.toString('ascii', 4, 8) === 'ftyp') return 'm4a';
  if (prefix.startsWith('ID3') || (header[0] === 255 && (header[1] & 224) === 224)) return 'mp3';
  return null;
}

async function readAudio(form: FormData) {
  const file = form.get('audio');
  if (!(file instanceof File) || !file.size) throw fail(400, '请选择音频文件');
  if (file.size > MAX_UPLOAD_AUDIO) throw fail(413, '音频不能超过 64 MB');
  const ext = audioExtension(Buffer.from(await file.slice(0, 16).arrayBuffer()));
  if (!ext) throw fail(400, '音频格式需要是 MP3、FLAC、M4A、WAV 或 OGG');
  const metadata = await parseBlob(file, { duration: true }).catch(() => { throw fail(400, '无法读取此音频文件'); });
  const { duration, hasVideo, hasAudio, codec } = metadata.format;
  if (hasVideo || hasAudio === false || !codec || !duration || !Number.isFinite(duration)) throw fail(400, '请选择可播放的音频文件');
  return { file, ext, duration, embeddedCover: metadata.common.picture?.[0]?.data };
}

async function readCover(form: FormData, embedded?: Uint8Array) {
  const file = form.get('cover');
  const selected = file instanceof File && file.size > 0 ? file : null;
  if (selected && selected.size > MAX_AVATAR) throw fail(413, '封面不能超过 2 MB');
  const bytes = selected ? Buffer.from(await selected.arrayBuffer()) : embedded && embedded.length <= MAX_AVATAR ? Buffer.from(embedded) : null;
  const ext = bytes && sniffImage(bytes);
  if (selected && !ext) throw fail(400, '封面需要是 PNG、JPG 或 WebP');
  return bytes && ext ? { bytes, ext } : null;
}

function saveRecipients(id: string, recipients: number[]) {
  run('DELETE FROM upload_recipients WHERE song_id=?', id);
  for (const peer of recipients) run('INSERT INTO upload_recipients(song_id,user_id) VALUES(?,?)', id, peer);
}

function transaction(write: () => void) {
  db().exec('BEGIN IMMEDIATE');
  try { write(); db().exec('COMMIT'); }
  catch (error) { db().exec('ROLLBACK'); throw error; }
}

export async function saveUpload(owner: number, form: FormData, existing?: string) {
  const audio = existing ? null : await readAudio(form);
  const cover = await readCover(form, form.get('removeCover') === '1' ? undefined : audio?.embeddedCover);
  const fields = readFields(form, owner);
  const previous = existing ? owned(owner, existing) : null;
  const id = existing ?? `upload-${randomUUID().replaceAll('-', '')}`;
  const newCover = cover ? `${id}-${randomUUID()}.${cover.ext}` : null;
  const coverFile = newCover ?? (form.get('removeCover') === '1' ? null : previous?.cover_file ?? null);
  const file = audio ? `${id}.${audio.ext}` : null;
  const audioBytes = audio ? Buffer.from(await audio.file.arrayBuffer()) : null;
  try {
    if (file && audioBytes) fs.writeFileSync(uploadPath(file), audioBytes, { mode: 0o600, flag: 'wx' });
    if (cover && newCover) fs.writeFileSync(uploadPath(newCover), cover.bytes, { mode: 0o600, flag: 'wx' });
    transaction(() => {
      const metadata = [fields.name, fields.artist, fields.album, fields.lyricist, fields.composer, fields.lyrics, fields.visibility, coverFile];
      if (audio) run(`INSERT INTO uploaded_songs(id,owner_id,name,artist,album,lyricist,composer,lyrics,visibility,cover_file,duration,audio_ext,audio_size,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, owner, ...metadata, audio.duration, audio.ext, audio.file.size, now());
      else run(`UPDATE uploaded_songs SET name=?,artist=?,album=?,lyricist=?,composer=?,lyrics=?,visibility=?,cover_file=? WHERE id=?`, ...metadata, id);
      saveRecipients(id, fields.recipients);
    });
  } catch (error) {
    if (file) fs.rmSync(uploadPath(file), { force: true });
    if (newCover) fs.rmSync(uploadPath(newCover), { force: true });
    throw error;
  }
  if (previous?.cover_file && previous.cover_file !== coverFile) fs.rmSync(uploadPath(previous.cover_file), { force: true });
  return managed(owned(owner, id));
}

export function deleteUpload(owner: number, id: string) {
  const row = owned(owner, id);
  transaction(() => {
    run('DELETE FROM uploaded_songs WHERE id=?', id);
    for (const table of ['favorites', 'playlist_songs', 'history']) run(`DELETE FROM ${table} WHERE song_id=?`, id);
  });
  fs.rmSync(uploadPath(audioName(row)), { force: true });
  if (row.cover_file) fs.rmSync(uploadPath(row.cover_file), { force: true });
}
