# Nestune

一个属于你的音乐空间。在线听歌、管理歌单和自己的音乐，也可以邀请朋友一起听、边听边聊。

[开始体验](https://music.0use.net/) · [项目介绍](https://0use.net/Nestune/) · **V1.0.0**

测试账号：`test` · 密码：`W1111111`

| Folder | What |
|---|---|
| `web/` | **Current app.** Next.js: player UI + backend API + admin panel. See `web/README.md`. |
| `audio-worker/` | NCM decrypt / MP3 transcode container. Deployed on the NAS (see below). |
| `prototype/` | Static HTML mock-ups used to agree on the visual style. |
| `clients/` | Windows client and packaging scripts. Android packaging is paused. |
| `docs/` | Static project website. GitHub Actions deploys it to GitHub Pages when this folder changes on `main`. |

## Run locally

```powershell
cd web
npm install
copy .env.example .env.local   # set ADMIN_KEY
npm run dev
```

## audio-worker on the NAS

Runs from `/vol1/opt/docker/nestune` on the Fnos box (`compose.yaml` = `audio-worker/compose.nas.yaml`, `.env` holds `WORKER_KEY`).
Port 4191 is published on the LAN and protected by `WORKER_KEY`; `/health` is open. Folders: `storage/incoming` (input, read-only), `storage/music` (output), `audio-worker/state` (queue DB).

```sh
cd /vol1/opt/docker/nestune
docker compose ps
docker compose logs --tail 30
docker compose up -d --no-build --pull never
```
