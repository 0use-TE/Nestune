# Nestune

一个属于你的音乐空间。在线听歌、管理歌单和自己的音乐，也可以邀请朋友一起听、边听边聊。

[开始体验](https://nestune.0use.net:8443/) · [项目介绍](https://0use.net/Nestune/) · [V1.2.1 更新与构建说明](docs/releases/v1.2.1.md)

测试账号：`test` · 密码：`W1111111`

| Folder | What |
|---|---|
| `web/` | **Current app.** Next.js: player UI + backend API + admin panel. See `web/README.md`. |
| `audio-worker/` | NCM decrypt / MP3 transcode container. Deployed on the NAS (see below). |
| `prototype/` | Static HTML mock-ups used to agree on the visual style. |
| `clients/` | Tauri desktop clients for Windows, Linux and macOS, plus packaging scripts. See `clients/README.md`. Android includes the native media service and keyboard/back integration. |
| `docs/` | Static project website. GitHub Actions deploys it to GitHub Pages when this folder changes on `main`. |

## V1.2.1

![Nestune 桌面首页](docs/assets/showcase-home.webp)

- 搜索与播放歌曲、专辑和歌单，沉浸播放器与歌词、可管理的播放队列。
- 分别收藏歌曲、专辑和歌单，创建、分享自己的歌单，上传自己的音乐。
- 好友聊天、歌曲与公开歌单分享、一起听邀请和双方共同管理的队列。
- 浏览器 / PWA，以及 Windows、macOS、Linux 和 Android 客户端。
- Android 系统媒体信息与控制、返回键处理、键盘适配；设置中检查更新。
- 共享画布可放置唱片、专辑、歌单、便签与图片，拖到底部追加播放队列。
- 我的歌单支持一键或拖动整单入队，保留当前播放进度。
- 播放器音量、静音和记忆设置；Windows 与 Android 系统悬浮歌词。
- 播放与下载权限分开判断，连接错误提供错误码和请求编号。
- 网易云与 QQ 音乐双源搜索、同录音合并，支持优先音源和保留进度的手动切换。
- 逐字歌词以蓝黄流光扫色，每句随机配色路径；支持播放器、应用内浮窗和浏览器画中画。
- 原生 1.2.1 构建源码已包含 Windows/安卓系统浮窗流光（安卓 code 7）；当前已发布安装包见下表。
- 歌手完整曲库一键播放；Windows 歌词锁定位置后仍可解锁、切换背景和关闭。

| 平台 | 下载 |
| --- | --- |
| Windows x64 · 1.1.1 | [安装版](https://nestune.0use.net:8443/api/client-updates/windows/111) |
| macOS Universal · 原生 1.0.0 | [DMG](https://github.com/0use-TE/Nestune/releases/download/v1.0.0/Nestune-1.0.0-macOS-universal.dmg) · [App ZIP](https://github.com/0use-TE/Nestune/releases/download/v1.0.0/Nestune-1.0.0-macOS-universal.app.zip) |
| Linux x86-64 · 原生 1.0.0 | [AppImage](https://github.com/0use-TE/Nestune/releases/download/v1.0.0/Nestune-1.0.0-Linux-x64.AppImage) · [DEB](https://github.com/0use-TE/Nestune/releases/download/v1.0.0/Nestune-1.0.0-Linux-amd64.deb) |
| Android 7+ · 1.1.0 | [通用 APK](https://nestune.0use.net:8443/api/client-updates/android/6) |

客户端连接在线服务；网页功能更新无需重新打包，系统悬浮歌词需安装新版 Windows 或 Android 客户端。安装、系统依赖及签名说明见 [clients/README.md](clients/README.md)。[当前安装包校验](docs/releases/v1.1.1.md) · [更新记录](CHANGELOG.md)

展示截图来自当前产品，个人收藏及聊天使用演示内容。

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
