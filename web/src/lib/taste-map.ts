import { providerOf } from './music-ids';
import type { Song } from './types';

export type TasteCenter = {
  id: string;
  kind: 'artist' | 'tag' | 'discovery';
  label: string;
  weight: number;
};

export type TasteTrack = {
  song: Song;
  centerIds: string[];
  reason: string;
  unheard?: boolean;
};

export type TasteMap = {
  centers: TasteCenter[];
  tracks: TasteTrack[];
  mixIds: string[];
};

export type TasteSelection =
  | { kind: 'mix' }
  | { kind: 'center'; id: string }
  | { kind: 'song'; id: string }
  | { kind: 'album'; id: string };

export function groupTasteAlbums(tracks: TasteTrack[]) {
  const albums = new Map<string, TasteTrack[]>();
  for (const track of tracks) {
    const { album, artists, cover, provider } = track.song;
    if (!album?.name?.trim()) continue;
    const id = JSON.stringify(album.id
      ? [provider ?? providerOf(track.song.id), album.id]
      : [album.name, cover || artists[0]?.name]);
    const members = albums.get(id);
    if (members) members.push(track);
    else albums.set(id, [track]);
  }
  return new Map([...albums.values()].map(members => ['album:' + members[0].song.id, members]));
}
