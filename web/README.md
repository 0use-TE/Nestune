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
- Only the admin creates users (`/admin` → 用户). Creating one returns a **one-time activation code** (48 h). The user opens the login page → 收到激活码？首次登录 → username + code + their own new password. The admin never learns the password.
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

## Not in this version

PWA/offline, HTTPS setup, audio-worker auto-import of saved songs.

## NAS deployment

Run the Web Compose project from `/vol1/opt/docker/nestune/web`. The existing audio-worker Compose project supplies the `nestune_default` network. Keep `ADMIN_KEY`, `WORKER_KEY`, and the LAN `BIND_IP` in the server-side `.env` file. Give the container's Node user (UID 1000) write access to `./data`.

```sh
docker compose -f compose.nas.yaml up -d --build
docker compose -f compose.nas.yaml ps
```
