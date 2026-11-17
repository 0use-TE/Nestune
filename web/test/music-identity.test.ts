import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Song } from '@/lib/types';
import { isQqId, mergeSongPages, sameRecording, sourceIds } from '@/lib/music-ids';

const song = (id: string, patch: Partial<Song> = {}): Song => ({ id, name: 'Billie Jean', artists: [{ id: '1', name: 'Michael Jackson' }], album: { id: '1', name: 'Thriller' }, cover: null, duration: 294, access: { playable: true, max: 'exhigh' }, ...patch });
let folder: string, database: typeof import('@/server/db'), recordings: typeof import('@/server/recordings');
beforeAll(async () => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nestune-recording-'));
  vi.stubEnv('DATA_DIR', folder); database = await import('@/server/db'); recordings = await import('@/server/recordings');
});
beforeEach(() => database.run('DELETE FROM music_sources'));
afterAll(() => { database.db().close(); fs.rmSync(folder, { recursive: true, force: true }); vi.unstubAllEnvs(); });

it('validates namespaced source IDs without accepting paths, URLs or legacy local IDs', () => {
  expect(isQqId('qq-002P5kP80d88Vp')).toBe(true);
  for (const id of ['qq-', 'qq-../test', 'qq-a?x=1', 'qq-a%2Fb', 'https://qq.com', '21178262', 'device:test', 'qq-a\r\n']) expect(isQqId(id)).toBe(false);
});
it('matches a recording using normalized release, artist and duration', () => {
  expect(sameRecording(song('21178262'), song('qq-a', { name: 'Ｂｉｌｌｉｅ　Ｊｅａｎ', duration: 293, artists: [{ id: 'qq-x', name: 'MICHAEL JACKSON' }] }))).toBe(true);
});
it('keeps live, cover, instrumental, remix and remaster versions separate', () => {
  for (const version of ['Live', 'Cover', 'Instrumental', 'Remix', '2001 Remastered', '现场', '伴奏', '翻唱', '重录']) {
    expect(sameRecording(song('1'), song('qq-a', { name: `Billie Jean (${version})` }))).toBe(false);
    expect(sameRecording(song('1'), song('qq-a', { album: { id: '2', name: `Thriller (${version})` } }))).toBe(false);
  }
});
it('requires complete, unambiguous metadata and the same performers', () => {
  for (const patch of [{ duration: 383 }, { duration: 0 }, { album: { id: null, name: '' } }, { album: { id: '2', name: 'Greatest Hits' } }, { artists: [] }, { artists: [{ id: '2', name: 'Another performer' }] }]) expect(sameRecording(song('1'), song('qq-a', patch))).toBe(false);
  expect(sameRecording(song('1'), song('2'))).toBe(false);
});
it('records a cross-page match and preserves both original aliases without rewriting old user data', () => {
  recordings.rememberSongs([song('qq-a')]);
  expect(recordings.recordingId('qq-a')).toBe('qq-a');
  recordings.rememberSongs([song('21178262')]);
  expect(recordings.recordingId('qq-a')).toBe('21178262');
  expect(recordings.recordingAliases('qq-a').sort()).toEqual(['21178262', 'qq-a']);
  expect(recordings.enrichSong(song('qq-a'))).toMatchObject({ id: 'qq-a', canonicalId: '21178262', sources: [{ id: '21178262', provider: 'netease' }, { id: 'qq-a', provider: 'qq' }] });
});
it('does not merge transitively through a second release from the same provider', () => {
  recordings.rememberSongs([song('1'), song('qq-a')]);
  recordings.rememberSongs([song('qq-b')]);
  expect(recordings.recordingAliases('1')).toHaveLength(2);
  expect(recordings.recordingAliases('qq-b')).toEqual(['qq-b']);
});
it('leaves multiple equally plausible releases separate instead of choosing an arbitrary match', () => {
  recordings.rememberSongs([song('1'), song('2'), song('qq-a')]);
  expect(recordings.recordingAliases('qq-a')).toEqual(['qq-a']);
});
it('unifies favorites and page rows while retaining intentional repetitions in a playback queue', () => {
  recordings.rememberSongs([song('1', { access: { playable: false, max: null } }), song('qq-a')]);
  const ne = recordings.enrichSong(song('1')), qq = recordings.enrichSong(song('qq-a'));
  expect(ne.access?.playable).toBe(true);
  expect(recordings.uniqueRecordings([ne, qq, ne])).toHaveLength(1);
  expect([ne, qq, ne].map(s => s.id)).toEqual(['1', 'qq-a', '1']);
  const merged = mergeSongPages([song('qq-a')], [ne]);
  expect(merged).toHaveLength(1); expect(merged[0].id).toBe('1'); expect(sourceIds(merged[0]).sort()).toEqual(['1', 'qq-a']);
});
