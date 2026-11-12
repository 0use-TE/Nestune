export type ListeningTrack = { id: string; name: string; artist: string };
export type Person = {
  id: number; username: string; name: string; avatar: string | null;
  online: boolean | null; track: ListeningTrack | null;
  friendship: 'friend' | 'incoming' | 'outgoing' | null;
};
export type SharedSong = ListeningTrack & { cover: string | null };
export type InviteStatus = 'pending' | 'accepted' | 'cancelled' | 'declined' | 'expired' | 'ended';
export type ListeningInvite = { id: number; roomId: number; hostId: number; guestId: number; status: InviteStatus; createdAt: number; updatedAt: number; expiresAt: number };
export const INVITE_STATUS: Record<InviteStatus, string> = {
  pending: '等待回应', accepted: '已接受', cancelled: '已取消', declined: '已拒绝', expired: '已失效', ended: '已结束',
};
export type Message = { id: number; senderId: number; text: string; sentAt: number; song?: SharedSong; invite?: ListeningInvite };
export type ConversationSummary = { peerId: number; latest: Message; unread: number; latestIncomingId: number; peerReadThrough: number };
export type ConversationHistory = { messages: Message[]; peerReadThrough: number };
export type Playback = { songId: string; position: number; playing: boolean };
export type ListeningRoom = {
  id: number; hostId: number; guestId: number; active: boolean;
  onThisDevice: boolean;
  playback: Playback | null; updatedAt: number;
  transportVersion: number;
};
export type SocialState = { people: Person[]; rooms: ListeningRoom[]; inbox: ConversationSummary[]; showOnline: boolean; serverTime: number };
