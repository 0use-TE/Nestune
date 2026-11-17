import { playlistLink, shareUrl, type ExternalPlaylist } from '@/lib/playlist-link';
import type { Song } from '@/lib/types';
import { playlist } from './netease';
import { qqPlaylist } from './qqmusic';
import { fail } from './http';
import { uniqueRecordings, rememberSongs } from './recordings';
import { createPlaylist } from './playlists';
import { db, run, now } from './db';

const shortHosts = new Set(['163cn.tv', '163cn.com', 'c6.y.qq.com', 'c.y.qq.com', 'y.qq.com', 'music.163.com', 'y.music.163.com']);
export async function resolvePlaylistLink(text: string): Promise<ExternalPlaylist> {
  let raw = shareUrl(text);
  for (let count = 0; count < 4; count++) {
    const parsed = playlistLink(raw); if (parsed) return parsed;
    let url: URL; try { url = new URL(raw); } catch { throw fail(400, '请粘贴网易云或 QQ 音乐歌单分享链接'); }
    if (url.protocol !== 'https:' || !shortHosts.has(url.hostname) || url.port || url.username || url.password) throw fail(400, '不支持这个歌单链接');
    let result = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (result.status === 405 || !result.headers.get('location')) {
      await result.body?.cancel();
      result = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
    }
    const next = result.headers.get('location');
    await result.body?.cancel();
    if (!next || result.status < 300 || result.status >= 400) break;
    raw = new URL(next, url).href;
  }
  throw fail(400, '无法解析短链接，请复制歌单完整分享链接');
}
export async function externalPlaylist(source: ExternalPlaylist) {
  if (source.provider === 'qq') { const data = await qqPlaylist(source.id); return { ...data, songs: uniqueRecordings(data.songs) }; }
  const songs: Song[] = []; let meta: Awaited<ReturnType<typeof playlist>>['playlist'] | undefined;
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await playlist(source.id, 100, offset); meta ??= page.playlist;
    if (!Number.isSafeInteger(meta.trackCount) || meta.trackCount < 0) throw fail(502, '无法确认歌单的完整曲目数量，请稍后重试');
    if (meta.trackCount > 1000) throw fail(400, '一个歌单最多导入 1000 首，请拆分后再导入');
    songs.push(...page.songs);
    if (offset + page.songs.length >= page.playlist.trackCount) break;
    if (!page.songs.length) throw fail(502, '歌单只返回了部分内容，请检查访问权限后重试');
  }
  if (!meta || meta.trackCount > 1000) throw fail(400, '一个歌单最多导入 1000 首，请拆分后再导入');
  if (songs.length < meta.trackCount) throw fail(502, '歌单内容不完整，本次没有导入');
  return { name: meta.name, cover: meta.cover, songs: uniqueRecordings(songs), provider: source.provider, id: source.id };
}
export async function importPlaylist(user: number, text: string, name?: string) {
  const source = await resolvePlaylistLink(text), data = await externalPlaylist(source);
  if (!data.songs.length) throw fail(400, '这个歌单没有可导入的歌曲');
  const connection = db(); connection.exec('BEGIN IMMEDIATE');
  try {
    const target = createPlaylist(user, (name?.trim() || data.name).slice(0, 40), `从${source.provider === 'qq' ? 'QQ 音乐' : '网易云'}导入`);
    rememberSongs(data.songs);
    const at = now();
    for (let index = 0; index < data.songs.length; index++) {
      const song = data.songs[index];
      run('INSERT INTO playlist_songs(playlist_id,song_id,meta,added_at) VALUES(?,?,?,?)', target.id, song.id, JSON.stringify(song), at + index);
    }
    connection.exec('COMMIT'); return { playlist: { ...target, trackCount: data.songs.length }, imported: data.songs.length };
  } catch (error) { connection.exec('ROLLBACK'); throw error; }
}
