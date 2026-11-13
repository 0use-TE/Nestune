# Nestune web

Next.js 15 app: the player UI, the whole backend (API routes) and the admin panel in one process.
Node 24+ (uses the built-in `node:sqlite`).

```powershell
cd D:\Projects\Nestune\web
npm install
copy .env.example .env.local    # then set ADMIN_KEY
npm run dev                     # http://localhost:3000   admin: /admin
npm test                        # 27 tests
npm run build; npm start        # production
```

## Accounts

- There is **no admin account**. `/admin` unlocks only with `ADMIN_KEY` from the server environment (8 tries/min/IP, 12 h session).
- The admin generates **one-time activation codes** (`/admin` → 用户 → 生成激活码, valid for 48 h) without creating an account. Users choose 激活账号, verify their code, then set their own username, nickname and password. A successful registration consumes the code and signs them in; invalid fields or a username conflict leave it usable. Codes inherit the quality limit chosen by the admin and can be revoked before use. Existing accounts and password-reset codes continue to work.
- Forgot password: admin → 重置密码 issues a new code, clears the password and signs the user out.
- Per user the admin sets: max audio quality, whether they may save to the local library, enable/disable, force sign-out.
- Users edit their own nickname, bio, email, avatar (PNG/JPG/WebP ≤ 2 MB, magic-byte checked) and password (changing it signs out other devices).

## Data (`./data`, git-ignored)

| Path | What |
|---|---|
| `app.db` | users, sessions, favourites, history, playlists, queue, library index, settings |
| `session.json` | the bound music-source login (server only, never sent to browsers) |
| `cache/` | played songs, LRU-evicted above the limit (default 20 GB) |
| `library/` | songs users saved; never auto-evicted |
| `uploads/` | audio and cover files uploaded through Settings. Back up with `app.db`, which holds lyrics, credits and visibility |
| `avatars/` | profile pictures |

Open **个人设置 → 我的上传** to upload or manage tracks. Uploads start private, can be shared with selected friends, and can be published to all signed-in users. The NAS Compose data volume persists uploads across container rebuilds.

## API (all JSON, same-origin, cookie auth)

User: `POST /api/auth/login|activate|logout` · `GET/PATCH /api/me` · `POST /api/me/password` · `POST/DELETE /api/me/avatar` ·
`/api/me/favorites[/id]` · `/api/me/history` · `/api/me/queue` · `/api/me/playlists[/id[/songs[/songId]]]` ·
`GET /api/search?keywords&type=song|artist|album|playlist` · `/api/search/hot|suggest` · `/api/home` ·
`/api/albums/id` · `/api/playlists/id` · `/api/artists/id` · `/api/songs/id[/lyrics|available|stream]` · `/api/library`.

`/api/songs/{id}/stream?level=` feeds `<audio>`: Range requests, cached on disk, library first, quality capped by the user's limit.

Admin (admin cookie): `/api/admin/login|logout|session|overview|users|netease|cache|library|settings|worker`.

## Safety notes

Cross-site writes are rejected (Origin check). Audio is only fetched from the music CDN domains, redirects re-checked. Private playlists and the bound account's own playlists are refused. Song/album/playlist payloads are field-whitelisted. Per-user rate limit and concurrent-download cap are adjustable in 系统设置.

## PWA

Together-listening invitations can be sent from a friend's chat. The invitation stays in chat history with its accepted, cancelled, declined, expired, or ended status; unanswered invitations expire after 10 minutes. The player fits the viewport, with scrolling confined to lyrics and messages. On phones, the **播放 / 聊天** tabs and horizontal swipes switch between playback and a full chat page; switching preserves the message draft.

After acceptance, the host device initializes a room-owned queue from its current songs, index, position and playback mode. Both participants can add, remove, clear, select, seek and change playback mode. Entries have individual keys so duplicate songs can be removed independently; server-side commands preserve concurrent edits. Only the participating sessions can read or edit this queue. Device-local files must be uploaded and shared first, and uploaded tracks must be visible to both people.

The queue panel has numbered rows, durations, a current-track marker, **清空**, and a **保存为歌单** action for a shared queue. Clearing the shared queue stops playback but keeps the room open. Each device preserves its personal queue, mode and position separately, including across a page refresh in the same tab. Leaving or ending the room restores that personal queue in a paused state. Shared changes are not written to either user's saved personal queue; save a shared list as a personal playlist before ending the session if you want to keep it.

Use **https://music.0use.net** (the existing tunnel points to NAS port 3000). In Settings → Preferences, choose **安装 Nestune**; on iPhone/iPad use Safari → Share → Add to Home Screen. Sign in again after installation if the browser requests it. Plain LAN HTTP addresses do not support service workers.

The manifest supplies desktop, Android maskable, and Apple home-screen icons. The service worker caches only public app assets and an offline connection screen. Account APIs, audio, uploaded files, personalized pages, and the admin panel are never stored in its cache. This version does not provide offline song playback.

On a first visit, a small installation card offers the browser's installation prompt or platform instructions. It appears once per browser profile (tracked in local storage) and does not appear in installed windows or the admin panel. It does not take keyboard focus. Settings keeps the installation entry available afterward.

Each production build generates a new worker. A prepared update offers **立即更新 / 稍后** instead of reloading during playback. If another window activates an update, existing windows continue until the user reloads. Development mode does not automatically register the worker. Docker must copy `public/` into both build and runtime images.

## Not in this version

Offline song playback, HTTPS setup, audio-worker auto-import of saved songs.

## NAS deployment

Run the Web Compose project from `/vol1/opt/docker/nestune/web`. The existing audio-worker Compose project supplies the `nestune_default` network. Keep `ADMIN_KEY`, `WORKER_KEY`, and the LAN `BIND_IP` in the server-side `.env` file. Give the container's Node user (UID 1000) write access to `./data`.

```sh
docker compose -f compose.nas.yaml up -d --build
docker compose -f compose.nas.yaml ps
```
