import type { SharedQueue } from './shared-queue';
import type { Song } from './types';
export const PRESENCE_TIMEOUT_MS = 35_000;
export const LISTENING_ROOM_CAPACITY = 8;
export type ListeningTrack = { id: string; name: string; artist: string };
export type Person = {
  id: number; username: string; name: string; avatar: string | null;
  online: boolean | null; track: ListeningTrack | null;
  friendship: 'friend' | 'incoming' | 'outgoing' | null;
};
export function inviteFriends(people: Person[] = [], memberIds: number[] = []) {
  return people.filter(person => person.friendship === 'friend' && !memberIds.includes(person.id))
    .sort((a, b) => Number(b.online === true) - Number(a.online === true) || a.name.localeCompare(b.name, 'zh-CN') || a.id - b.id);
}
export type SharedPlaylist = { id: number; name: string; cover: string | null; trackCount: number };
export type SharedSong = ListeningTrack & { cover: string | null };
export type InviteStatus = 'pending' | 'accepted' | 'cancelled' | 'declined' | 'expired' | 'ended';
export type ListeningInvite = { id: number; roomId: number; hostId: number; guestId: number; status: InviteStatus; createdAt: number; updatedAt: number; expiresAt: number };
export const INVITE_STATUS: Record<InviteStatus, string> = {
  pending: '等待回应', accepted: '已接受', cancelled: '已取消', declined: '已拒绝', expired: '已失效', ended: '已结束',
};
export type Message = { id: number; senderId: number; text: string; sentAt: number; song?: SharedSong; playlist?: SharedPlaylist; invite?: ListeningInvite };
export type ConversationSummary = { peerId: number; latest: Message; unread: number; latestIncomingId: number; peerReadThrough: number };
export type ConversationHistory = { messages: Message[]; peerReadThrough: number };
export type Playback = { songId: string; position: number; playing: boolean };
export type ListeningRoom = {
  id: number; hostId: number; guestId: number; active: boolean;
  onThisDevice: boolean;
  playback: Playback | null; updatedAt: number;
  transportVersion: number;
  queue: SharedQueue | null;
  queueUnchanged?: boolean;
  group?: { memberIds: number[]; pendingIds: number[]; messages: Message[]; playbackVersion: number };
  inviteId?: number;
  domain?: { id: number; name: string };
};
export type DomainSummary = {
  id: number; name: string; ownerId: number | null; members: number;
  invited: boolean; listeners: number; track: string | null;
};
export type DomainMessage = Omit<Message, 'senderId'> & { senderId: number | null };
export type DomainDetail = DomainSummary & {
  memberIds: number[]; pendingIds: number[];
  songs: { song: Song; addedBy: number | null }[];
  messages: DomainMessage[];
  hasEarlier: boolean;
};
export type SocialState = { people: Person[]; rooms: ListeningRoom[]; inbox: ConversationSummary[]; showOnline: boolean; serverTime: number; peopleVersion?: string };
export type SocialUpdate = Omit<SocialState, 'people'> & { people?: Person[] };
