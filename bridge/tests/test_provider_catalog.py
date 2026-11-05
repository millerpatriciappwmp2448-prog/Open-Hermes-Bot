"""Use each profile's existing endpoint/key for both discovery and inference."""
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import yaml

from hermes_bridge.provider_catalog import configure_custom_catalog


class CatalogTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.profile = Path(self.temp.name)
        self.requests = []
        requests = self.requests

        class Provider(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append((self.path, self.headers.get('Authorization')))
                valid = self.headers.get('Authorization') == 'Bearer profile-key'
                self.send_response(200 if valid else 401)
                self.end_headers()
                self.wfile.write(json.dumps({'data': [{'id': 'alpha'}, {'id': 'beta'}]} if valid else {}).encode())

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f'http://127.0.0.1:{self.server.server_port}/v1'
        self.original = {'model': {'provider': 'custom', 'base_url': self.base, 'default': 'alpha', 'api_key': 'stale-key'},
                         'agent': {'max_turns': 30}, 'providers': {'other': {'base_url': 'https://other.invalid'}}}
        (self.profile / 'config.yaml').write_text(yaml.safe_dump(self.original), encoding='utf-8')
        (self.profile / '.env').write_text('CUSTOM_API_KEY=profile-key\n', encoding='utf-8')

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def test_verified_catalog_uses_profile_env_and_preserves_other_settings(self):
        result = configure_custom_catalog(self.profile)
        saved = yaml.safe_load((self.profile / 'config.yaml').read_text())
        self.assertEqual(result['models'], 2)
        self.assertEqual(self.requests, [('/v1/models', 'Bearer profile-key')])
        self.assertEqual(saved['model'], self.original['model'])
        self.assertEqual(saved['agent'], self.original['agent'])
        self.assertEqual(saved['providers']['other'], self.original['providers']['other'])
        self.assertEqual(saved['providers']['custom'], {
            'name': 'Server provider', 'base_url': self.base, 'api_key_env': 'CUSTOM_API_KEY', 'discover_models': True})
        self.assertNotIn('profile-key', (self.profile / 'config.yaml').read_text())
        self.assertEqual(yaml.safe_load(Path(result['backup']).read_text()), self.original)
        self.assertFalse(configure_custom_catalog(self.profile)['changed'])

    def test_rejected_key_leaves_configuration_untouched(self):
        (self.profile / '.env').write_text('CUSTOM_API_KEY=wrong-key\n', encoding='utf-8')
        before = (self.profile / 'config.yaml').read_bytes()
        with self.assertRaisesRegex(ValueError, 'HTTP 401'):
            configure_custom_catalog(self.profile)
        self.assertEqual((self.profile / 'config.yaml').read_bytes(), before)

    def test_no_primary_key_fallback_and_no_overwriting_explicit_provider(self):
        (self.profile / '.env').write_text('', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'CUSTOM_API_KEY'):
            configure_custom_catalog(self.profile)
        self.assertEqual(self.requests, [])
        self.original['providers']['custom'] = {'base_url': 'https://different.invalid', 'api_key_env': 'OTHER_KEY'}
        (self.profile / 'config.yaml').write_text(yaml.safe_dump(self.original), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'already configured'):
            configure_custom_catalog(self.profile)
        self.assertEqual(self.requests, [])


if __name__ == '__main__':
    unittest.main()
