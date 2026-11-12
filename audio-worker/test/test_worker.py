import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from worker import Worker, JobError, create_server


class WorkerTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(__file__).resolve().parents[1] / 'work' / 'test-runtime'
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.root = Path(self.temp.name)
        self.input = self.root / 'input'
        self.input.mkdir()
        self.output = self.root / 'output'
        self.state = self.root / 'state'
        self.commands = []
        self.key = 'private-worker-test-key-' * 3
        self.worker = self.make_worker()

    def tearDown(self):
        self.temp.cleanup()

    def make_worker(self, runner=None):
        return Worker(self.input, self.output, self.state, self.key, runner=runner or self.runner)

    def runner(self, args, **kwargs):
        self.commands.append(args)
        if args[0] == 'ncmdump':
            out = Path(args[-1])
            out.mkdir(parents=True)
            (out / 'source.mp3').write_bytes(b'ID3-MP3-CONTENT')
        if args[0] == 'ffmpeg' and args[-1] != '-':
            Path(args[-1]).write_bytes(b'ID3-CONVERTED')
        info = {'streams': [{'codec_name': 'mp3', 'sample_rate': '48000', 'channels': 2}], 'format': {'duration': '120.0'}}
        return subprocess.CompletedProcess(args, 0, json.dumps(info).encode())

    def ncm(self, name='歌曲.ncm'):
        (self.input / name).write_bytes(b'CTENFDAM' + b'fixture')
        return name

    def test_path_traversal_and_unsupported_formats_rejected(self):
        for name in ['../secret.ncm', '/etc/passwd', 'folder\\secret.ncm', 'missing.ncm', '']:
            with self.subTest(name=name), self.assertRaises(JobError):
                self.worker.submit({'input': name})
        (self.input / 'script.py').write_text('not audio')
        with self.assertRaises(JobError):
            self.worker.submit({'input': 'script.py'})

    @unittest.skipIf(sys.platform == 'win32', 'Windows symlink permissions differ')
    def test_symlink_cannot_escape_input(self):
        outside = self.root / 'outside.ncm'
        outside.write_bytes(b'CTENFDAM')
        (self.input / 'escape.ncm').symlink_to(outside)
        with self.assertRaises(JobError):
            self.worker.submit({'input': 'escape.ncm'})

    def test_invalid_job_options_rejected(self):
        source = self.ncm()
        for options in [{'format': 'wav'}, {'bitrate': 999}, {'bitrate': True}]:
            with self.assertRaises(JobError):
                self.worker.submit({'input': source, **options})

    def test_active_duplicate_returns_same_job(self):
        payload = {'input': self.ncm()}
        self.assertEqual(self.worker.submit(payload)['id'], self.worker.submit(payload)['id'])

    def test_unicode_ncm_and_lyrics_are_published_without_modifying_input(self):
        source = self.ncm('RADWIMPS - なんでもないや.ncm')
        original = (self.input / source).read_bytes()
        lyric = (self.input / source).with_suffix('.lrc')
        lyric.write_bytes('[00:01]歌词'.encode())
        job = self.worker.submit({'input': source})
        self.assertTrue(self.worker.run_one())
        result = self.worker.get(job['id'])
        self.assertEqual(result['status'], 'completed')
        final = self.output / result['result']['output']
        self.assertEqual(final.read_bytes(), b'ID3-MP3-CONTENT')
        self.assertEqual(final.with_suffix('.lrc').read_bytes(), lyric.read_bytes())
        self.assertEqual((self.input / source).read_bytes(), original)
        self.assertFalse(result['result']['transcoded'])
        self.assertEqual(result['result']['inputSha256'], hashlib.sha256(original).hexdigest())
        self.assertFalse(any('-m' in command for command in self.commands))

    def test_native_decoder_zero_exit_without_output_is_failure(self):
        def no_output(args, **kwargs):
            return subprocess.CompletedProcess(args, 0, b'')
        worker = self.make_worker(no_output)
        job = worker.submit({'input': self.ncm()})
        worker.run_one()
        self.assertEqual(worker.get(job['id'])['status'], 'failed')
        self.assertFalse((self.output / job['id']).exists())

    def test_invalid_ncm_header_never_reaches_native_tool(self):
        (self.input / 'bad.ncm').write_bytes(b'not-an-ncm')
        job = self.worker.submit({'input': 'bad.ncm'})
        self.worker.run_one()
        self.assertEqual(self.worker.get(job['id'])['status'], 'failed')
        self.assertEqual(self.commands, [])

    def test_existing_mp3_is_preserved_byte_for_byte(self):
        (self.input / 'audio.mp3').write_bytes(b'ID3-ORIGINAL')
        job = self.worker.submit({'input': 'audio.mp3'})
        self.worker.run_one()
        result = self.worker.get(job['id'])['result']
        self.assertEqual((self.output / result['output']).read_bytes(), b'ID3-ORIGINAL')
        self.assertEqual(result['inputSha256'], result['outputSha256'])

    def test_flac_to_mp3_uses_requested_bitrate(self):
        (self.input / 'audio.flac').write_bytes(b'fLaC')
        def flac_runner(args, **kwargs):
            result = self.runner(args, **kwargs)
            if args[0] == 'ffprobe' and args[-1].endswith('.flac'):
                info = json.loads(result.stdout)
                info['streams'][0]['codec_name'] = 'flac'
                result.stdout = json.dumps(info).encode()
            return result
        worker = self.make_worker(flac_runner)
        job = worker.submit({'input': 'audio.flac', 'bitrate': 192})
        worker.run_one()
        result = worker.get(job['id'])['result']
        self.assertTrue(result['transcoded'])
        self.assertTrue(any('192k' in command for command in self.commands))
        self.assertTrue(result['output'].endswith('.mp3'))

    def test_original_output_preserves_flac(self):
        (self.input / 'audio.flac').write_bytes(b'fLaC-original')
        job = self.worker.submit({'input': 'audio.flac', 'format': 'original'})
        self.worker.run_one()
        result = self.worker.get(job['id'])['result']
        self.assertTrue(result['output'].endswith('.flac'))
        self.assertEqual(result['inputSha256'], result['outputSha256'])

    def test_failed_verification_does_not_publish_output(self):
        def reject(args, **kwargs):
            if args[0] == 'ffmpeg':
                return subprocess.CompletedProcess(args, 1)
            return self.runner(args, **kwargs)
        worker = self.make_worker(reject)
        job = worker.submit({'input': self.ncm()})
        worker.run_one()
        self.assertEqual(worker.get(job['id'])['status'], 'failed')
        self.assertFalse((self.output / job['id']).exists())
        self.assertTrue((self.input / job['source']).exists())

    def test_processing_jobs_resume_after_restart_and_results_survive(self):
        job = self.worker.submit({'input': self.ncm()})
        self.worker.update(job['id'], status='processing')
        restarted = self.make_worker()
        self.assertEqual(restarted.get(job['id'])['status'], 'queued')
        restarted.run_one()
        self.assertEqual(self.make_worker().get(job['id'])['status'], 'completed')

    def test_http_requires_separate_worker_key(self):
        server = create_server(self.worker, ('127.0.0.1', 0))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = 'http://127.0.0.1:' + str(server.server_address[1])
        try:
            with urllib.request.urlopen(base + '/health') as response:
                self.assertEqual(response.status, 200)
            with self.assertRaises(urllib.error.HTTPError) as denied:
                urllib.request.urlopen(base + '/jobs')
            self.assertEqual(denied.exception.code, 401)
            payload = json.dumps({'input': self.ncm()}).encode()
            req = urllib.request.Request(base + '/jobs', data=payload, headers={'Authorization': 'Bearer ' + self.key})
            with urllib.request.urlopen(req) as response:
                self.assertEqual(response.status, 202)
                job = json.load(response)
                self.assertEqual(job['status'], 'queued')
                self.assertNotIn(self.key, json.dumps(job))
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
