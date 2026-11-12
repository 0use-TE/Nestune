"""Run inside the container: python cli.py submit relative/file.ncm --format mp3 --wait."""
import argparse
import json
import os
import time
import urllib.request
import urllib.error

parser = argparse.ArgumentParser()
sub = parser.add_subparsers(dest='command', required=True)
submit = sub.add_parser('submit')
submit.add_argument('input')
submit.add_argument('--format', choices=['mp3', 'original'], default='mp3')
submit.add_argument('--bitrate', type=int, choices=[128, 192, 256, 320], default=320)
submit.add_argument('--wait', action='store_true')
status = sub.add_parser('status')
status.add_argument('id')
sub.add_parser('list')
args = parser.parse_args()
base = os.getenv('WORKER_URL', 'http://127.0.0.1:4191')


def request(route, data=None):
    raw = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(base + route, data=raw, headers={
        'Authorization': 'Bearer ' + os.environ['WORKER_KEY'], 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise SystemExit(exc.read().decode('utf-8'))


if args.command == 'submit':
    job = request('/jobs', {'input': args.input, 'format': args.format, 'bitrate': args.bitrate})
    deadline = time.monotonic() + 1800
    while args.wait and job['status'] in ('queued', 'processing') and time.monotonic() < deadline:
        time.sleep(1)
        job = request('/jobs/' + job['id'])
elif args.command == 'status':
    job = request('/jobs/' + args.id)
else:
    job = request('/jobs')
print(json.dumps(job, ensure_ascii=False, indent=2))
if args.command == 'submit' and args.wait and job['status'] != 'completed':
    raise SystemExit(1)
