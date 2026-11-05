"""Reconnect a private companion socket on a remote Linux Hermes host.

The socket must be in a directory writable by the SSH user. For a container,
place it in a private bind mount readable by the bridge user. No TCP listener
is published on the server. This process must stay running on the computer.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import shlex
import subprocess
import time


def prepare_command(path: str) -> str:
    # SSH does not always unlink its remote socket after an interrupted session.
    # Refuse an occupied socket, a symlink, or somebody else's file. Remove only
    # a stale socket owned by this SSH user, never a directory or ordinary file.
    code = f'''import os,socket,stat,sys
path={path!r}
try: info=os.lstat(path)
except FileNotFoundError: sys.exit(0)
if not stat.S_ISSOCK(info.st_mode) or info.st_uid!=os.getuid(): sys.exit(2)
probe=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
probe.settimeout(2)
try: probe.connect(path)
except (ConnectionRefusedError,FileNotFoundError):
 current=os.lstat(path)
 if (current.st_dev,current.st_ino)!=(info.st_dev,info.st_ino): sys.exit(2)
 os.unlink(path)
else: sys.exit(3)
finally: probe.close()
'''
    encoded = base64.b64encode(code.encode()).decode()
    return shlex.join(['python3', '-c', f"exec(__import__('base64').b64decode('{encoded}'))"])


def ssh_arguments(host: str, identity: str) -> list[str]:
    if not host or host.startswith('-') or any(c.isspace() for c in host):
        raise ValueError('Use one SSH host alias or user@host.')
    return ['ssh', '-i', str(Path(identity).resolve()), '-o', 'BatchMode=yes',
            '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15']


def run(args) -> None:
    if not args.socket.startswith('/') or len(args.socket.encode()) > 100 or any(c in args.socket for c in '\n\r\x00:'):
        raise ValueError('Use an absolute Linux socket path shorter than 101 bytes, without colons.')
    base = ssh_arguments(args.host, args.identity)
    state = args.state_dir.resolve()
    state.mkdir(parents=True, exist_ok=True)
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    child = None
    try:
        while True:
            with (state / 'tunnel.log').open('a', encoding='utf-8') as log:
                try:
                    ready = subprocess.run(base + [args.host, prepare_command(args.socket)],
                        stdin=subprocess.DEVNULL, stdout=log, stderr=log, timeout=25, creationflags=flags)
                    if ready.returncode:
                        log.write(f'Socket preparation unavailable ({ready.returncode}); retrying.\n')
                    else:
                        mode = '660' if args.group_readable else '600'
                        command = f'chmod {mode} {shlex.quote(args.socket)} && exec sleep infinity'
                        child = subprocess.Popen(base + ['-T', '-o', 'ExitOnForwardFailure=yes',
                            '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3',
                            '-R', f'{args.socket}:127.0.0.1:{args.port}', args.host, command],
                            stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=flags)
                        (state / 'tunnel.json').write_text(json.dumps({'pid': os.getpid(),
                            'ssh_pid': child.pid, 'script': str(Path(__file__).resolve()), 'started_at': time.time()}))
                        log.write(f'{time.time():.0f}: private tunnel started\n'); log.flush()
                        child.wait()
                        log.write(f'SSH exited ({child.returncode}); reconnecting.\n')
                        child = None
                except (OSError, subprocess.TimeoutExpired) as exc:
                    log.write(f'{type(exc).__name__}; retrying private tunnel.\n')
            time.sleep(15)
    finally:
        if child is not None:
            child.terminate()
            child.wait(timeout=10)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', required=True)
    parser.add_argument('--identity', required=True)
    parser.add_argument('--socket', required=True)
    parser.add_argument('--state-dir', required=True, type=Path)
    parser.add_argument('--group-readable', action='store_true')
    parser.add_argument('--port', type=int, default=8770, choices=range(1, 65536), metavar='PORT')
    run(parser.parse_args())
