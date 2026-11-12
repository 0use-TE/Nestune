import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

let directory: string;
let database: typeof import('@/server/db');
let uploads: typeof import('@/server/uploads');

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nestune-upload-test-'));
  vi.stubEnv('DATA_DIR', directory);
  database = await import('@/server/db');
  uploads = await import('@/server/uploads');
  for (const [id, name] of [[1, 'Uploader'], [2, 'Friend'], [3, 'Other']] as const) {
    database.run("INSERT INTO users(id,username,display_name,status,created_at) VALUES(?,?,?,'active',?)", id, name, name, Date.now());
  }
  database.run('INSERT INTO friendships(low_id,high_id,requested_by,accepted) VALUES(1,2,1,1)');
});

afterAll(() => {
  database?.db().close();
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function wave() {
  const buffer = Buffer.alloc(44 + 16_000);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(16000, 40);
  return new File([buffer], 'fixture.wav', { type: 'audio/wav' });
}

function form(visibility: string, recipients: number[] = []) {
  const data = new FormData();
  data.set('name', 'Studio version');
  data.set('artist', 'Performer');
  data.set('lyricist', 'Writer');
  data.set('composer', 'Composer');
  data.set('lyrics', '[00:00.20]First line');
  data.set('visibility', visibility);
  for (const id of recipients) data.append('recipients', String(id));
  return data;
}

it('enforces private, selected friend, and public visibility through edits and deletion', async () => {
  const input = form('private');
  input.set('audio', wave());
  const { song } = await uploads.saveUpload(1, input);
  expect(song).toMatchObject({ duration: 1, uploader: { id: 1, name: 'Uploader' } });
  expect(uploads.searchUploads(1, 'Performer', 20, 0).total).toBe(1);
  expect(uploads.visibleUpload(2, song.id)).toBeUndefined();
  await expect(uploads.saveUpload(2, form('public'), song.id)).rejects.toMatchObject({ status: 404 });
  await expect(uploads.saveUpload(1, form('shared', [3]), song.id)).rejects.toMatchObject({ status: 400 });
  await uploads.saveUpload(1, form('shared', [2]), song.id);
  expect(uploads.searchUploads(2, 'studio', 20, 0).items[0]?.id).toBe(song.id);
  expect(uploads.visibleUpload(3, song.id)).toBeUndefined();
  expect(uploads.uploadLyrics(2, song.id)).toMatchObject({ lines: [{ t: 0.2, text: 'First line' }], credits: ['作词：Writer', '作曲：Composer'] });

  const publicForm = form('public');
  publicForm.set('lyrics', 'Lyrics without timestamps');
  await uploads.saveUpload(1, publicForm, song.id);
  expect(uploads.uploadLyrics(3, song.id)).toMatchObject({ lines: [], plainText: 'Lyrics without timestamps' });
  expect(uploads.searchUploads(3, 'writer', 20, 0).total).toBe(1);
  await uploads.saveUpload(1, form('private'), song.id);
  expect(() => uploads.requireUpload(3, song.id)).toThrow();
  expect(uploads.visibleSong(3, song)).toBeUndefined();
  expect(fs.existsSync(uploads.uploadAudio(uploads.requireUpload(1, song.id)).path)).toBe(true);
  uploads.deleteUpload(1, song.id);
  expect(uploads.myUploads(1)).toEqual([]);
  expect(fs.readdirSync(path.join(directory, 'uploads'))).toEqual([]);
});

it('rejects a renamed non-audio file before storing it', async () => {
  const input = form('public');
  input.set('audio', new File(['not audio'], 'fake.mp3', { type: 'audio/mpeg' }));
  await expect(uploads.saveUpload(1, input)).rejects.toMatchObject({ status: 400 });
  expect(fs.readdirSync(path.join(directory, 'uploads'))).toEqual([]);
});
