import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from hermes_bridge.config import Config
from hermes_bridge import media


class TranscriptionRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.home = self.root / 'data'
        self.home.mkdir()
        self.config = Config(hermes_home=self.home)
        self.source = self.root / 'hermes'
        self.source.mkdir()
        tools = self.source / 'tools'
        tools.mkdir()
        (tools / '__init__.py').write_text('')
        (tools / 'transcription_tools.py').write_text('''
import os
def _load_stt_config(): return {}
def is_stt_enabled(config): return True
def _get_provider(config): return 'fixture'
def transcribe_audio(path):
    assert open(path, 'rb').read() == b'audio-bytes'
    assert os.environ['HERMES_HOME'].endswith('data')
    return {'success': True, 'transcript': '每天查看新闻'}
''', encoding='utf-8')
        self.audio = self.home / 'recording.m4a'
        self.audio.write_bytes(b'audio-bytes')

    def test_explicit_source_outside_data_home_uses_hermes_environment(self):
        with patch.dict(os.environ, {'HERMES_AGENT_HOME': str(self.source)}):
            self.assertEqual(media.transcribe(self.config, self.audio), '每天查看新闻')
            self.assertEqual(media.voice_status(self.config), {'available': True, 'provider': 'fixture'})

    def test_legacy_source_under_home_still_works(self):
        legacy = self.home / 'hermes-agent'
        self.source.rename(legacy)
        with patch.dict(os.environ, {'HERMES_AGENT_HOME': ''}):
            self.assertEqual(media.transcribe(self.config, self.audio), '每天查看新闻')

    def test_virtualenv_python_is_used_without_resolving_away_the_venv(self):
        interpreter = self.source / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
        interpreter.parent.mkdir(parents=True)
        interpreter.touch()
        answer = subprocess.CompletedProcess([], 0, json.dumps({'success': True, 'transcript': 'hello'}).encode(), b'')
        with patch.dict(os.environ, {'HERMES_AGENT_HOME': str(self.source)}), patch('hermes_bridge.media.subprocess.run', return_value=answer) as run:
            self.assertEqual(media.transcribe(self.config, self.audio), 'hello')
        args, kwargs = run.call_args
        self.assertEqual(args[0][0], str(interpreter))
        self.assertEqual(kwargs['env']['HERMES_HOME'], str(self.home))
        self.assertEqual(kwargs['cwd'], str(self.source))

    def test_missing_local_backend_reports_unavailable_without_transcribing(self):
        tools = self.source / 'tools/transcription_tools.py'
        tools.write_text('''
def _load_stt_config(): return {'provider': 'local'}
def is_stt_enabled(config): return True
def _get_provider(config): return 'none'
def transcribe_audio(path): raise AssertionError('must not install dependencies or transcribe')
''')
        with patch.dict(os.environ, {'HERMES_AGENT_HOME': str(self.source)}):
            self.assertEqual(media.voice_status(self.config), {'available': False, 'provider': 'none'})
            with self.assertRaises(media.MediaError) as caught:
                media.transcribe(self.config, self.audio)
            self.assertEqual(caught.exception.code, 'no_transcription')

    def test_missing_tools_is_an_honest_capability_result(self):
        with patch.dict(os.environ, {'HERMES_AGENT_HOME': str(self.root / 'missing')}):
            self.assertEqual(media.voice_status(self.config)['available'], False)
            with self.assertRaises(media.MediaError) as caught:
                media.transcribe(self.config, self.audio)
            self.assertEqual(caught.exception.status, 501)
