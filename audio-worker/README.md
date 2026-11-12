# Nestune audio-worker

独立音频任务容器，Python 标准库 + 官方 ncmdump 1.5.1 Linux amd64 + FFmpeg 7.1。使用按 digest 固定的 static-ffmpeg 镜像提供 FFmpeg/FFprobe，Python 与 C++ 运行时镜像也固定 digest，构建不依赖在线 apt 安装。
仅支持当前飞牛的 x86_64 架构。官方发布包下载 SHA-256 和 GitHub release digest 已核对；镜像构建再次核对二进制 SHA-256，许可证位于 vendor/。

## 功能

- NCM 解密，保留原始 MP3 或 FLAC；可指定统一输出 MP3。
- 默认保留已是 MP3 的音频字节，不反复有损编码。只有 FLAC 转 MP3 时使用指定的 128/192/256/320 kbps。
- FFprobe 检查音轨和时长；FFmpeg 完整解码检查后才原子发布结果。
- 同名 LRC 原样复制；输入目录只读，不删除或修改原文件。
- SQLite 任务持久化，重启时重新领取未完成任务；处理中相同输入与选项不会重复入队。
- 单进程顺序处理，默认队列最多 100 个待处理任务，输入最大 1 GiB。
- 内部 HTTP 4191，无宿主机端口映射；单独 WORKER_KEY，不接受或保存网易云 Cookie。

## 本机构建和测试

实际 `.env` 已随机生成 WORKER_KEY，`.env.example` 仅为字段示例。

```powershell
cd D:\Projects\Nestune\audio-worker
python -m unittest discover -s test -v
docker compose build
docker compose up -d --no-build
```

将待处理文件及同名 `.lrc` 放在 `storage/incoming/`，文件完全写入后再提交任务。

```sh
docker compose exec -T audio-worker python cli.py submit "song.ncm" --format mp3 --wait
docker compose exec -T audio-worker python cli.py submit "song.ncm" --format original --wait
docker compose exec -T audio-worker python cli.py status TASK_ID
docker compose exec -T audio-worker python cli.py list
```

任务结果在 `storage/music/<任务ID>/`，包含音频、可用的同名歌词和 manifest.json。
清单记录输入输出 SHA-256、实际编码、时长、文件大小和是否重新编码。
转换失败返回 failed/error；原文件保留，不将半成品放入最终目录。
音频任务只处理已经下载完成的本地文件；还没有自动接入网易云下载流或未来的 app-api。

## 飞牛部署

与现有服务共用 `/vol1/opt/docker/nestune/compose.yaml`，源文件为 `../backend/deploy/compose.nas.yaml`。

```text
/vol1/opt/docker/nestune/
├── compose.yaml
├── .env                     # 新增独立 WORKER_KEY
├── music-api/
├── audio-worker/
│   └── state/               # SQLite 数据库与处理中临时文件
└── storage/
    ├── incoming/            # 放入 NCM、MP3、FLAC 及同名 LRC
    └── music/               # 校验后的结果，按任务 ID 分目录
```

在 NAS 项目根目录执行以上 Compose CLI 命令即可。容器以 UID/GID 1000 运行，输入只读、输出与任务状态可写；只读根文件系统、512 MiB 内存、1 CPU、128 PID。
默认一次只部署一个 audio-worker 实例。

## 供业务后端调用的内部 API

同一 Compose 网络地址 `http://audio-worker:4191`。
除 health 外均要求 `Authorization: Bearer <WORKER_KEY>`。不要把 WORKER_KEY 发到浏览器。

| 方法 | 路径 | 功能 |
|---|---|---|
| GET | `/health` | 存活检查 |
| POST | `/jobs` | 提交转换任务，202 返回任务 ID |
| GET | `/jobs/{id}` | 查询状态、阶段、输出信息 |
| GET | `/jobs` | 最近 50 个任务 |

提交 JSON：

```json
{"input":"album/song.ncm","format":"mp3","bitrate":320}
```

input 是 incoming 目录下的相对路径，禁止绝对路径、目录穿越和指向目录之外的软链接。
状态为 queued / processing / completed / failed。完成后业务后端通过共享音乐目录读取 result.output 指定的相对路径。
