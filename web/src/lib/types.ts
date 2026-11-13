export type Artist = { id: string; name: string };
export type Song = {
  id: string; name: string; duration: number; artists: Artist[];
  album: { id: string | null; name: string }; cover: string | null; fee?: number;
  qualities?: { level: string; bitrate?: number; size?: number }[];
  access?: { playable: boolean; max: string | null; reason?: string };
  uploader?: { id: number; name: string };
};
export type Tier = { level: string; label: string; format: string; bitrate: number | null; size: number | null; state: 'ok' | 'over_cap' | 'no_access' | 'missing' };
export type Me = {
  id: number; username: string; displayName: string; bio: string; email: string; avatar: string | null;
  status: string; maxQuality: string; createdAt: number; lastLoginAt: number; profilePublic: boolean;
};
export type PlaylistLite = { id: number; name: string; description: string; trackCount: number; cover: string | null; updatedAt: number; isPublic?: boolean };
export type LyricLine = { t: number; text: string; tr?: string; roma?: string };
export type Card = { id: string; name: string; cover: string | null; sub?: string };
