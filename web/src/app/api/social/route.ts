import type { ListeningTrack, Playback } from '@/lib/social-types';
import type { Song } from '@/lib/types';
import { isUploadSong } from '@/lib/upload-types';
import { catalogId, catalogSong } from '@/server/catalog';
import { userRoute } from '@/server/guard';
import { body, fail, numericId, str } from '@/server/http';
import { requireUpload } from '@/server/uploads';
import { editListeningQueue, initializeListeningQueue, saveListeningQueue } from '@/server/listening-queue';
import { acceptListening, answerFriend, controlListening, inviteListener, leaveListening, markMessagesRead, peerReadThrough, readMessages, requestFriend, sendMessage, setOnlineVisibility, shareSong, sharePlaylist, socialDirectory, socialState, syncSocial } from '@/server/social';

const options = { bucket: 'social' };

function id(value: unknown) {
  const result = Number(numericId(value));
  if (!Number.isSafeInteger(result) || result < 1) throw fail(400, 'ID 无效');
  return result;
}

function track(value: unknown): ListeningTrack | null {
  if (value == null) return null;
  if (typeof value !== 'object') throw fail(400, '歌曲数据无效');
  const data = value as Record<string, unknown>;
  return { id: catalogId(data.id), name: str(data.name, 1, 160, '歌曲名'), artist: str(data.artist, 0, 160, '歌手名') };
}

function playback(value: unknown): Playback | null {
  if (value == null) return null;
  if (typeof value !== 'object') throw fail(400, '播放状态无效');
  const data = value as Record<string, unknown>;
  if (typeof data.position !== 'number' || !Number.isFinite(data.position) || data.position < 0 || data.position > 86400 || typeof data.playing !== 'boolean') {
    throw fail(400, '播放状态无效');
  }
  return { songId: catalogId(data.songId), position: data.position, playing: data.playing };
}

export const GET = userRoute((req, _ctx, user, sessionId) => {
  const peer = req.nextUrl.searchParams.get('peer');
  const before = req.nextUrl.searchParams.get('before');
  if (req.nextUrl.searchParams.get('scope') === 'directory') return { people: socialDirectory(user.id) };
  if (!peer) return socialState({ userId: user.id, sessionId });
  const other = id(peer);
  return { messages: readMessages(user.id, other, before ? id(before) : undefined), peerReadThrough: peerReadThrough(user.id, other) };
}, options);

export const POST = userRoute(async (req, _ctx, user, sessionId) => {
  const data = await body(req, 65536);
  if (!data || typeof data !== 'object') throw fail(400, '请求无效');
  const listener = { userId: user.id, sessionId };
  switch (data.action) {
    case 'sync': {
      const version = data.transportVersion ?? 0;
      if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) throw fail(400, '播放版本无效');
      if (data.seed !== undefined) await initializeListeningQueue(listener, id(data.roomId), data.seed);
      let known: { peopleVersion?: string; queues?: Record<string, number> } | undefined;
      if (data.known !== undefined) {
        if (!data.known || typeof data.known !== 'object' || Array.isArray(data.known)) throw fail(400, '同步版本无效');
        const value = data.known as Record<string, unknown>;
        if (value.peopleVersion !== undefined && (typeof value.peopleVersion !== 'string' || !/^[a-f0-9]{64}$/.test(value.peopleVersion))) throw fail(400, '用户版本无效');
        const queues: Record<string, number> = {};
        if (value.queues !== undefined) {
          if (!value.queues || typeof value.queues !== 'object' || Array.isArray(value.queues) || Object.keys(value.queues).length > 10) throw fail(400, '队列版本无效');
          for (const [key, revision] of Object.entries(value.queues)) {
            if (!/^[1-9][0-9]{0,14}$/.test(key) || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw fail(400, '队列版本无效');
            queues[key] = revision;
          }
        }
        known = { peopleVersion: value.peopleVersion as string | undefined, queues };
      }
      return syncSocial(listener, track(data.track), data.roomId == null ? undefined : id(data.roomId), playback(data.playback), version, known);
    }
    case 'visibility':
      if (typeof data.visible !== 'boolean') throw fail(400, '在线状态无效');
      setOnlineVisibility(user.id, data.visible);
      break;
    case 'friend': requestFriend(user.id, id(data.peerId)); break;
    case 'acceptFriend': answerFriend(user.id, id(data.peerId), true); break;
    case 'declineFriend': answerFriend(user.id, id(data.peerId), false); break;
    case 'message': return { message: sendMessage(user.id, id(data.peerId), str(data.text, 1, 1000, '消息')) };
    case 'shareSong': {
      const songId = catalogId(data.songId);
      const peerId = id(data.peerId);
      const message = await shareSong(user.id, peerId, async () => {
        const song: Song = await catalogSong(user.id, songId);
        if (isUploadSong(songId)) requireUpload(peerId, songId);
        return { id: song.id, name: song.name, artist: song.artists.map(artist => artist.name).join(' / '), cover: song.cover || null };
      });
      return { message };
    }
    case 'sharePlaylist': return { message: sharePlaylist(user.id, id(data.peerId), id(data.playlistId)) };
    case 'read': markMessagesRead(user.id, id(data.peerId), id(data.throughId)); break;
    case 'invite': inviteListener(listener, id(data.peerId)); break;
    case 'acceptInvite': acceptListening(listener, id(data.roomId)); break;
    case 'roomPlayback':
      if (data.playing !== undefined && typeof data.playing !== 'boolean') throw fail(400, '播放状态无效');
      controlListening(listener, id(data.roomId), catalogId(data.songId), data.playing);
      break;
    case 'leave': leaveListening(listener, id(data.roomId)); break;
    case 'saveRoomQueue': return { playlist: saveListeningQueue(listener, id(data.roomId), data.name) };
    case 'roomQueue': await editListeningQueue(listener, id(data.roomId), data.command); break;
    default: throw fail(400, '未知操作');
  }
  return socialState(listener);
}, options);
