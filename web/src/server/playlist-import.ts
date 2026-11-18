import { playlistLink, shareUrl, type ExternalPlaylist } from '@/lib/playlist-link';
import { importablePlaylist } from './netease';
import { qqPlaylist } from './qqmusic';
import { fail } from './http';
import { uniqueRecordings, rememberSongs } from './recordings';
import { createPlaylist } from './playlists';
import { db, run, now } from './db';

const shortHosts = new Set(['163cn.tv', '163cn.com', 'c6.y.qq.com', 'c.y.qq.com', 'y.qq.com', 'i2.y.qq.com', 'music.163.com', 'y.music.163.com']);
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
  if (source.provider === 'qq') {
    const data = await qqPlaylist(source.id);
    return { ...data, songs: uniqueRecordings(data.songs), skipped: 0 };
  }
  const { playlist, songs, skipped } = await importablePlaylist(source.id);
  return { name: playlist.name, cover: playlist.cover, songs: uniqueRecordings(songs), provider: source.provider, id: source.id, skipped };
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
    connection.exec('COMMIT');
    return { playlist: { ...target, trackCount: data.songs.length }, imported: data.songs.length, skipped: data.skipped };
  } catch (error) { connection.exec('ROLLBACK'); throw error; }
}
