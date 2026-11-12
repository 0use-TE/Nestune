# Nestune

| Folder | What |
|---|---|
| `web/` | **Current app.** Next.js: player UI + backend API + admin panel. See `web/README.md`. |
| `audio-worker/` | NCM decrypt / MP3 transcode container. Deployed on the NAS (see below). |
| `prototype/` | Static HTML mock-ups used to agree on the visual style. |

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
