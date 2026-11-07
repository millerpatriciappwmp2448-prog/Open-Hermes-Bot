"""Bound every simulator operation and retain the last completed stage."""

import json
import os
from pathlib import Path
import re
import subprocess
import time


def launch(udid, app, out, *, execute=subprocess.run, sleep=time.sleep):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    result = {'status': 'inconclusive', 'stage': 'install'}

    def record():
        (out / 'sim-result.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result), flush=True)

    def run(stage, command, timeout):
        result['stage'] = stage
        record()
        with (out / f'sim-{stage}.txt').open('w') as log:
            try:
                done = execute(command, stdout=log, stderr=subprocess.STDOUT,
                               timeout=timeout)
                return 'ok' if done.returncode == 0 else f'exit_{done.returncode}'
            except subprocess.TimeoutExpired:
                return 'timeout'

    simctl = ['xcrun', 'simctl']
    outcome = run('install', simctl + ['install', udid, app], 120)
    if outcome != 'ok':
        result.update(status='infrastructure_error', outcome=outcome)
        record()
        return result

    outcome = run('launch', simctl + ['launch',
        f'--stdout={out.resolve() / "sim-stdout.log"}',
        f'--stderr={out.resolve() / "sim-stderr.log"}',
        udid, 'com.hermesbot.mobile'], 60)
    text = (out / 'sim-launch.txt').read_text()
    match = re.search(r'com\.hermesbot\.mobile: (\d+)', text)
    if outcome != 'ok' or not match:
        result.update(outcome=outcome)
        record()
        return result

    result['pid'] = int(match[1])
    result['stage'] = 'watch'
    record()
    sleep(40)
    # Simulator processes are host processes. Avoid blocking on another simctl
    # IPC, and reject a surviving launchctl job whose process already exited.
    outcome = run('process', ['ps', '-p', str(result['pid']), '-o', 'pid=,command='], 15)
    process = (out / 'sim-process.txt').read_text()
    alive = any(row.strip().startswith(f"{result['pid']} ") and
                '/HermesBot.app/HermesBot' in row for row in process.splitlines())
    result['status'] = ('inconclusive' if outcome == 'timeout' else
                        'alive' if outcome == 'ok' and alive else 'exited')
    record()
    result['screenshot'] = run('screenshot', simctl + [
        'io', udid, 'screenshot', str(out / 'sim-launch.png')], 30)
    result['stage'] = 'complete'
    record()
    return result


if __name__ == '__main__':
    result = launch(os.environ['SIM_UDID'], os.environ['APP'], Path('artifacts'))
    raise SystemExit(0 if result['status'] == 'alive' else 1)
