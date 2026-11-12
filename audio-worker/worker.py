"""Persistent, single-consumer audio conversion service; Python standard library only."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, unquote


class JobError(Exception):
    pass


class Worker:
    def __init__(self, incoming, output, state, key, runner=subprocess.run):
        if not key or len(key) < 32:
            raise ValueError('WORKER_KEY must contain at least 32 characters')
        self.incoming = Path(incoming).resolve()
        self.output = Path(output).resolve()
        self.state = Path(state).resolve()
        self.key = key
        self.runner = runner
        self.output.mkdir(parents=True, exist_ok=True)
        self.state.mkdir(parents=True, exist_ok=True)
        self.db = self.state / 'jobs.sqlite3'
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.wake = threading.Event()
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('''CREATE TABLE IF NOT EXISTS jobs (
              id TEXT PRIMARY KEY, source TEXT NOT NULL, format TEXT NOT NULL,
              bitrate INTEGER NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL,
              created REAL NOT NULL, updated REAL NOT NULL, result TEXT, error TEXT)''')
            db.execute("UPDATE jobs SET status='queued',stage='queued' WHERE status='processing'")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.db, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def source(self, relative):
        if not isinstance(relative, str) or not relative or len(relative) > 1024 or '\\' in relative:
            raise JobError('input 必须是输入目录下的相对路径')
        rel = Path(relative)
        if rel.is_absolute() or '..' in rel.parts:
            raise JobError('不允许访问输入目录之外的文件')
        source = (self.incoming / rel).resolve()
        if not source.is_relative_to(self.incoming) or source == self.incoming:
            raise JobError('不允许访问输入目录之外的文件')
        if not source.is_file() or source.suffix.lower() not in ('.ncm', '.mp3', '.flac'):
            raise JobError('输入文件不存在或格式不支持，仅接受 NCM、MP3、FLAC')
        if source.stat().st_size > 1024 ** 3:
            raise JobError('单文件不得超过 1 GiB')
        return source

    def submit(self, payload):
        if not isinstance(payload, dict):
            raise JobError('请求内容必须是 JSON 对象')
        source = self.source(payload.get('input'))
        output_format = payload.get('format', 'mp3')
        bitrate = payload.get('bitrate', 320)
        if output_format not in ('mp3', 'original') or type(bitrate) is not int or bitrate not in (128, 192, 256, 320):
            raise JobError('format 支持 mp3/original，bitrate 支持 128/192/256/320')
        relative = source.relative_to(self.incoming).as_posix()
        with self.lock, self.connect() as db:
            existing = db.execute("SELECT id FROM jobs WHERE source=? AND format=? AND bitrate=? AND status IN ('queued','processing')", (relative, output_format, bitrate)).fetchone()
            if existing:
                return self.get(existing['id'])
            if db.execute("SELECT count(*) FROM jobs WHERE status IN ('queued','processing')").fetchone()[0] >= 100:
                raise JobError('任务队列已满')
            job = str(uuid.uuid4())
            now = time.time()
            db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?)', (job, relative, output_format, bitrate, 'queued', 'queued', now, now, None, None))
        self.wake.set()
        return self.get(job)

    def get(self, job):
        with self.connect() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (job,)).fetchone()
        if row is None:
            return None
        value = dict(row)
        value['result'] = json.loads(value['result']) if value['result'] else None
        return value

    def listing(self):
        with self.connect() as db:
            ids = [r['id'] for r in db.execute('SELECT id FROM jobs ORDER BY created DESC LIMIT 50')]
        return [self.get(job) for job in ids]

    def update(self, job, **values):
        values['updated'] = time.time()
        with self.connect() as db:
            db.execute('UPDATE jobs SET ' + ','.join(k + '=?' for k in values) + ' WHERE id=?', (*values.values(), job))

    def command(self, args, timeout=600, capture=False):
        try:
            result = self.runner(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL, timeout=timeout, check=False)
        except subprocess.TimeoutExpired as exc:
            raise JobError('音频处理超时，原文件已保留') from exc
        if result.returncode:
            raise JobError('音频工具处理失败，原文件已保留')
        return result.stdout if capture else None

    def verify(self, file):
        raw = self.command(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries',
                            'stream=codec_name,sample_rate,channels:format=duration', '-of', 'json', str(file)], capture=True)
        info = json.loads(raw)
        streams = info.get('streams', [])
        duration = float(info.get('format', {}).get('duration', 0))
        if not streams or duration <= 0 or not file.stat().st_size:
            raise JobError('输出文件没有有效音频')
        self.command(['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-err_detect', 'explode', '-threads', '2', '-i', str(file),
                      '-map', '0:a:0', '-f', 'null', '-'])
        return {'codec': streams[0]['codec_name'], 'sampleRate': int(streams[0]['sample_rate']),
                'channels': streams[0]['channels'], 'durationSeconds': round(duration, 3)}

    def process(self, job):
        partial = self.output / '.partial' / job['id']
        published = self.output / job['id']
        try:
            # A crash after atomic publication is recoverable without converting again.
            if published.is_dir():
                result = json.loads((published / 'manifest.json').read_text(encoding='utf-8'))
                output = (self.output / result['output']).resolve()
                if not output.is_relative_to(published.resolve()) or result['jobId'] != job['id']:
                    raise JobError('已有输出校验失败')
                self.verify(output)
                self.update(job['id'], status='completed', stage='completed', result=json.dumps(result), error=None)
                return
            source = self.source(job['source'])
            initial = source.stat()
            self.update(job['id'], stage='copying')
            (self.state / 'work').mkdir(exist_ok=True)
            with tempfile.TemporaryDirectory(prefix=job['id'] + '-', dir=self.state / 'work') as temporary:
                temp = Path(temporary)
                local = temp / ('source' + source.suffix.lower())
                digest = hashlib.sha256()
                copied = 0
                with source.open('rb') as src, local.open('wb') as dst:
                    while chunk := src.read(1024 * 1024):
                        copied += len(chunk)
                        if copied > 1024 ** 3:
                            raise JobError('输入文件超过 1 GiB，原文件已保留')
                        digest.update(chunk)
                        dst.write(chunk)
                if source.stat().st_size != initial.st_size or source.stat().st_mtime_ns != initial.st_mtime_ns:
                    raise JobError('输入文件仍在变动，请下载完成后重新提交')
                if local.suffix == '.ncm':
                    with local.open('rb') as handle:
                        if handle.read(8) != b'CTENFDAM':
                            raise JobError('无效的 NCM 文件头')
                    self.update(job['id'], stage='decrypting')
                    extracted = temp / 'extracted'
                    self.command(['ncmdump', str(local), '-o', str(extracted)], timeout=120)
                    # ncmdump may report errors while returning zero: require an actual output.
                    outputs = list(extracted.glob('*')) if extracted.exists() else []
                    outputs = [p for p in outputs if p.is_file() and p.suffix.lower() in ('.mp3', '.flac')]
                    if len(outputs) != 1:
                        raise JobError('NCM 解密没有生成有效音频，原文件已保留')
                    decoded = outputs[0]
                else:
                    decoded = local
                self.update(job['id'], stage='verifying-source')
                input_info = self.verify(decoded)
                if partial.exists():
                    shutil.rmtree(partial)
                partial.mkdir(parents=True)
                extension = '.mp3' if job['format'] == 'mp3' else decoded.suffix.lower()
                output = partial / (source.stem + extension)
                transcoded = job['format'] == 'mp3' and input_info['codec'] != 'mp3'
                if transcoded:
                    self.update(job['id'], stage='transcoding')
                    self.command(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(decoded), '-map', '0:a:0', '-map_metadata', '0',
                                  '-c:a', 'libmp3lame', '-threads', '2', '-b:a', f"{job['bitrate']}k", str(output)])
                else:
                    shutil.copyfile(decoded, output)
                self.update(job['id'], stage='verifying-output')
                info = self.verify(output)
                if abs(info['durationSeconds'] - input_info['durationSeconds']) > 1:
                    raise JobError('转换前后音频时长不一致')
                # Copy UTF-8/LRC bytes unchanged; no source modification.
                lyric = source.with_suffix('.lrc')
                if lyric.is_file() and lyric.resolve().is_relative_to(self.incoming):
                    shutil.copyfile(lyric, partial / (source.stem + '.lrc'))
                with output.open('rb') as handle:
                    output_digest = hashlib.file_digest(handle, 'sha256').hexdigest()
                result = {'jobId': job['id'], 'output': (Path(job['id']) / output.name).as_posix(),
                          'inputSha256': digest.hexdigest(), 'outputSha256': output_digest,
                          'bytes': output.stat().st_size, 'transcoded': transcoded, 'audio': info}
                (partial / 'manifest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
                os.replace(partial, published)
                self.update(job['id'], status='completed', stage='completed', result=json.dumps(result), error=None)
        except Exception as exc:
            message = str(exc) if isinstance(exc, JobError) else '音频处理失败，原文件已保留'
            self.update(job['id'], status='failed', stage='failed', error=message)
        finally:
            if partial.exists() and partial.resolve().is_relative_to((self.output / '.partial').resolve()):
                shutil.rmtree(partial)

    def run_one(self):
        with self.lock, self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
            if row:
                db.execute("UPDATE jobs SET status='processing',stage='starting',updated=? WHERE id=?", (time.time(), row['id']))
        if row:
            self.process(dict(row))
            return True
        return False

    def run(self):
        while not self.stop.is_set():
            if not self.run_one():
                self.wake.wait(1)
                self.wake.clear()


def create_server(worker, address):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'NestuneAudioWorker'

        def log_message(self, *_):
            pass

        def respond(self, status, value):
            raw = json.dumps(value, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(raw)

        def request(self):
            route = urlsplit(self.path).path
            if self.command == 'GET' and route == '/health':
                return self.respond(200, {'ok': True, 'service': 'audio-worker'})
            if not hmac.compare_digest(self.headers.get('Authorization', '').encode(), ('Bearer ' + worker.key).encode()):
                return self.respond(401, {'error': '需要 WORKER_KEY'})
            try:
                if self.command == 'POST' and route == '/jobs':
                    try:
                        size = int(self.headers.get('Content-Length', '0'))
                    except ValueError:
                        raise JobError('无效的请求长度')
                    if size <= 0 or size > 8192:
                        return self.respond(413, {'error': 'JSON 请求大小必须为 1 至 8192 字节'})
                    payload = json.loads(self.rfile.read(size))
                    return self.respond(202, worker.submit(payload))
                if self.command == 'GET' and route == '/jobs':
                    return self.respond(200, {'jobs': worker.listing()})
                if self.command == 'GET' and route.startswith('/jobs/'):
                    job = worker.get(unquote(route.removeprefix('/jobs/')))
                    return self.respond(200, job) if job else self.respond(404, {'error': '任务不存在'})
                return self.respond(404, {'error': '接口不存在'})
            except (JobError, json.JSONDecodeError, UnicodeDecodeError) as exc:
                return self.respond(400, {'error': str(exc) if isinstance(exc, JobError) else 'JSON 格式错误'})
            except Exception:
                return self.respond(500, {'error': '处理请求失败'})

        do_GET = request
        do_POST = request

    server = ThreadingHTTPServer(address, Handler)
    server.daemon_threads = True
    return server


if __name__ == '__main__':
    worker = Worker(os.getenv('INPUT_DIR', '/input'), os.getenv('OUTPUT_DIR', '/output'),
                    os.getenv('STATE_DIR', '/state'), os.getenv('WORKER_KEY', ''))
    threading.Thread(target=worker.run, daemon=True).start()
    server = create_server(worker, ('0.0.0.0', int(os.getenv('PORT', '4191'))))
    print('Nestune audio-worker listening internally on port 4191', flush=True)
    server.serve_forever()
