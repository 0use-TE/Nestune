import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, dir } from './config';

const g = globalThis as unknown as { __nt_db?: DatabaseSync };

function open() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const d of ['cache', 'library', 'avatars', 'runtime', 'uploads']) fs.mkdirSync(dir(d), { recursive: true });
  const db = new DatabaseSync(dir('app.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '',
      pwd_hash TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      act_hash TEXT NOT NULL DEFAULT '',
      act_expires INTEGER NOT NULL DEFAULT 0,
      max_quality TEXT NOT NULL DEFAULT 'exhigh',
      can_save INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_login_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      ua TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      song_id TEXT NOT NULL,
      meta TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, song_id)
    );
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      song_id TEXT NOT NULL,
      meta TEXT NOT NULL,
      played_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS history_user ON history(user_id, played_at DESC);
    CREATE TABLE IF NOT EXISTS library (
      song_id TEXT PRIMARY KEY,
      meta TEXT NOT NULL,
      file TEXT NOT NULL,
      ext TEXT NOT NULL,
      size INTEGER NOT NULL,
      level TEXT NOT NULL,
      saved_by INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      song_id TEXT NOT NULL,
      level TEXT NOT NULL,
      actual_level TEXT NOT NULL,
      ext TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      last_access INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      hits INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS queue (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS uploaded_songs (
      id TEXT PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      lyricist TEXT NOT NULL,
      composer TEXT NOT NULL,
      lyrics TEXT NOT NULL,
      visibility TEXT NOT NULL CHECK(visibility IN ('private','shared','public')),
      duration REAL NOT NULL,
      audio_ext TEXT NOT NULL,
      audio_size INTEGER NOT NULL,
      cover_file TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS uploaded_songs_owner ON uploaded_songs(owner_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS upload_recipients (
      song_id TEXT NOT NULL REFERENCES uploaded_songs(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (song_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS playlists_user ON playlists(user_id);
    CREATE TABLE IF NOT EXISTS playlist_songs (
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      song_id TEXT NOT NULL,
      meta TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, song_id)
    );
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS social_presence (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      visible INTEGER NOT NULL DEFAULT 1,
      last_seen INTEGER NOT NULL DEFAULT 0,
      track TEXT
    );
    CREATE TABLE IF NOT EXISTS friendships (
      low_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      high_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      requested_by INTEGER NOT NULL,
      accepted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (low_id, high_id)
    );
    CREATE INDEX IF NOT EXISTS friendships_high ON friendships(high_id);
    CREATE TABLE IF NOT EXISTS friend_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      low_id INTEGER NOT NULL,
      high_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      song TEXT,
      FOREIGN KEY (low_id, high_id) REFERENCES friendships(low_id, high_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS friend_messages_pair ON friend_messages(low_id, high_id, id DESC);
    CREATE TABLE IF NOT EXISTS friend_message_reads (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      peer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, peer_id)
    );
    CREATE TABLE IF NOT EXISTS listening_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      guest_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      host_session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
      guest_session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
      active INTEGER NOT NULL DEFAULT 0,
      song_id TEXT,
      position REAL NOT NULL DEFAULT 0,
      playing INTEGER NOT NULL DEFAULT 0,
      transport_version INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS listening_room_pair ON listening_rooms(min(host_id, guest_id), max(host_id, guest_id));
    CREATE TABLE IF NOT EXISTS listening_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL UNIQUE,
      host_id INTEGER NOT NULL,
      guest_id INTEGER NOT NULL,
      low_id INTEGER NOT NULL,
      high_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','accepted','cancelled','declined','expired','ended')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (low_id,high_id) REFERENCES friendships(low_id,high_id) ON DELETE CASCADE
    );
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    const columns = db.prepare('PRAGMA table_info(listening_rooms)').all();
    if (!columns.some(column => column.name === 'transport_version')) {
      db.exec('ALTER TABLE listening_rooms ADD COLUMN transport_version INTEGER NOT NULL DEFAULT 0');
    }
    if (!columns.some(column => column.name === 'host_session_id')) {
      db.exec('ALTER TABLE listening_rooms ADD COLUMN host_session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE');
      db.exec('ALTER TABLE listening_rooms ADD COLUMN guest_session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE');
      // Rooms from older versions have no record of the inviting or accepting session.
      db.exec('DELETE FROM listening_rooms');
    }
    if (!db.prepare('PRAGMA table_info(friend_messages)').all().some(column => column.name === 'song')) {
      db.exec('ALTER TABLE friend_messages ADD COLUMN song TEXT');
    }
    if (!db.prepare('PRAGMA table_info(friend_messages)').all().some(column => column.name === 'invite_id')) {
      db.exec('ALTER TABLE friend_messages ADD COLUMN invite_id INTEGER REFERENCES listening_invites(id) ON DELETE SET NULL');
    }
    // Preserve existing live invitations when upgrading, without creating duplicate chat cards.
    db.exec(`INSERT OR IGNORE INTO listening_invites(room_id,host_id,guest_id,low_id,high_id,status,created_at,updated_at,expires_at)
      SELECT r.id,r.host_id,r.guest_id,min(r.host_id,r.guest_id),max(r.host_id,r.guest_id),
        CASE WHEN r.active=1 THEN 'accepted' ELSE 'pending' END,r.updated_at,r.updated_at,r.updated_at+600000
      FROM listening_rooms r WHERE EXISTS(SELECT 1 FROM friendships f
        WHERE f.low_id=min(r.host_id,r.guest_id) AND f.high_id=max(r.host_id,r.guest_id) AND f.accepted=1);
      INSERT INTO friend_messages(low_id,high_id,sender_id,text,sent_at,invite_id)
      SELECT i.low_id,i.high_id,i.host_id,'一起听邀请',i.created_at,i.id FROM listening_invites i
      WHERE NOT EXISTS(SELECT 1 FROM friend_messages m WHERE m.invite_id=i.id);
      CREATE INDEX IF NOT EXISTS friend_messages_invite ON friend_messages(invite_id);`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  return db;
}

export const db = (): DatabaseSync => (g.__nt_db ??= open());

export const now = () => Date.now();
export const one = <T = Record<string, any>>(sql: string, ...args: any[]) => db().prepare(sql).get(...args) as T | undefined;
export const all = <T = Record<string, any>>(sql: string, ...args: any[]) => db().prepare(sql).all(...args) as T[];
export const run = (sql: string, ...args: any[]) => db().prepare(sql).run(...args);

export const kvGet = (k: string): string | undefined => one<{ value: string }>('SELECT value FROM kv WHERE key=?', k)?.value;
export const kvSet = (k: string, v: string) => { run('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, v); };

export const SETTING_DEFAULTS = { rateLimitPerMin: 120, maxStreams: 3, cacheLimitGb: 20 };
export type Settings = typeof SETTING_DEFAULTS;
export function settings(): Settings {
  try { return { ...SETTING_DEFAULTS, ...JSON.parse(kvGet('settings') || '{}') }; } catch { return { ...SETTING_DEFAULTS }; }
}
export function saveSettings(patch: Partial<Settings>) {
  const next = { ...settings() };
  for (const k of Object.keys(SETTING_DEFAULTS) as (keyof Settings)[]) {
    const v = patch[k];
    if (v !== undefined) {
      if (!Number.isFinite(Number(v)) || Number(v) < 1 || Number(v) > 100000) throw new Error('设置值无效');
      next[k] = Number(v);
    }
  }
  kvSet('settings', JSON.stringify(next));
  return next;
}
