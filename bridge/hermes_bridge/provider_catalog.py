"""Explicit repair for Hermes bare-custom inventories that probe without a key.

Register the same endpoint as a named `custom` provider using the profile's
existing environment key. Hermes then uses that credential for discovery AND
inference. No credentials are copied from another profile or sent to the app.
"""
from __future__ import annotations

import json
import os
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import yaml

from .hermes import read_env_value


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # Never forward a provider credential to a redirect target.


def configure_custom_catalog(profile_dir: Path) -> dict:
    path = profile_dir / 'config.yaml'
    original = path.read_bytes()
    config = yaml.safe_load(original) or {}
    model = config.get('model')
    if not isinstance(model, dict) or model.get('provider') != 'custom':
        raise ValueError('This profile does not use the bare custom provider.')
    env = profile_dir / '.env'
    base = (read_env_value(env, 'CUSTOM_BASE_URL') or model.get('base_url') or '').strip().rstrip('/')
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or '@' in parsed.netloc or parsed.query or parsed.fragment:
        raise ValueError('The configured provider URL is invalid.')
    entry = {'name': 'Server provider', 'base_url': base, 'api_key_env': 'CUSTOM_API_KEY', 'discover_models': True}
    providers = config.get('providers') or {}
    if not isinstance(providers, dict):
        raise ValueError('The provider configuration is not a mapping.')
    existing = providers.get('custom')
    if existing == entry:
        return {'changed': False}
    if existing is not None:
        raise ValueError('The custom provider is already configured; review it before changing it.')
    key = read_env_value(env, 'CUSTOM_API_KEY')
    if not key:
        raise ValueError('This profile has no CUSTOM_API_KEY; no primary-profile fallback is allowed.')
    request = urllib.request.Request(base + '/models', headers={'Authorization': 'Bearer ' + key, 'Accept': 'application/json'})
    try:
        with urllib.request.build_opener(_NoRedirect).open(request, timeout=12) as response:
            raw = response.read(2 * 1024 * 1024 + 1)
    except urllib.error.HTTPError as exc:
        raise ValueError(f'The provider rejected catalog discovery: HTTP {exc.code}.') from None
    except (OSError, urllib.error.URLError):
        raise ValueError('The provider catalog is unreachable.') from None
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError('The provider catalog exceeds the size limit.')
    try:
        payload = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise ValueError('The provider did not return a JSON catalog.') from None
    rows = payload.get('data') if isinstance(payload, dict) else None
    ids = {row['id'].strip() for row in (rows or []) if isinstance(row, dict) and isinstance(row.get('id'), str) and row['id'].strip()}
    if not ids:
        raise ValueError('The provider returned no models; configuration was not changed.')
    if path.read_bytes() != original:
        raise ValueError('The profile changed during verification; retry against the current configuration.')
    backup = path.with_name(f'config.yaml.before-catalog-{time.time_ns()}')
    shutil.copy2(path, backup)
    backup.chmod(0o600)
    config['providers'] = {**providers, 'custom': entry}
    temporary = path.with_name(f'.config-catalog-{os.getpid()}-{time.time_ns()}.yaml')
    try:
        temporary.write_text(yaml.safe_dump(config, allow_unicode=True, sort_keys=False), encoding='utf-8')
        temporary.chmod(0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return {'changed': True, 'models': len(ids), 'backup': str(backup)}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('profile_directory', type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(configure_custom_catalog(args.profile_directory)))
    except ValueError as exc:
        parser.exit(1, str(exc) + '\n')
