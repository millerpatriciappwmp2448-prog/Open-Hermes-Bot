"""Exercise the diagnostic runner without an Apple runtime."""

import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    'smoke', Path(__file__).with_name('ios_sim_smoke.py'))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class SmokeTests(unittest.TestCase):
    def exercise(self, fail_stage=None, disappear=False):
        calls = []

        def execute(command, *, stdout, stderr, timeout, **kwargs):
            calls.append(command)
            if 'install' in command:
                stage = 'install'
            elif 'launch' in command:
                stage = 'launch'
                stdout.write('com.hermesbot.mobile: 1234\n')
                stdout.flush()
            elif command[0] == 'ps':
                stage = 'process'
                stdout.write('1234 /tmp/HermesBot.app/HermesBot\n' if not disappear else '')
                stdout.flush()
            else:
                stage = 'screenshot'
            if stage == fail_stage:
                raise subprocess.TimeoutExpired(command, timeout)
            return subprocess.CompletedProcess(command, 1 if disappear and stage == 'process' else 0)

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            result = smoke.launch('device', '/tmp/HermesBot.app', out,
                                  execute=execute, sleep=lambda _: None)
            saved = json.loads((out / 'sim-result.json').read_text())
        self.assertEqual(result, saved)
        return result, calls

    def test_survival_uses_actual_executable_and_original_pid(self):
        result, calls = self.exercise()
        self.assertEqual(result['status'], 'alive')
        self.assertEqual(result['pid'], 1234)
        self.assertTrue(any(c[:3] == ['ps', '-p', '1234'] for c in calls))

    def test_install_timeout_records_stage_without_claiming_app_crashed(self):
        result, calls = self.exercise(fail_stage='install')
        self.assertEqual(result['status'], 'infrastructure_error')
        self.assertEqual(result['stage'], 'install')
        self.assertFalse(any('launch' in c for c in calls))

    def test_launch_timeout_is_inconclusive_even_if_pid_was_printed(self):
        result, _ = self.exercise(fail_stage='launch')
        self.assertEqual(result['status'], 'inconclusive')
        self.assertEqual(result['stage'], 'launch')

    def test_process_disappearance_is_not_mistaken_for_survival(self):
        result, _ = self.exercise(disappear=True)
        self.assertEqual(result['status'], 'exited')

    def test_screenshot_timeout_does_not_erase_process_evidence(self):
        result, _ = self.exercise(fail_stage='screenshot')
        self.assertEqual(result['status'], 'alive')
        self.assertEqual(result['screenshot'], 'timeout')


if __name__ == '__main__':
    unittest.main()
