"""Check the packaged device binaries and deployment targets without Xcode."""

import hashlib
import json
import pathlib
import plistlib
import struct
import sys
import zipfile


def version(value):
    return (value >> 16, (value >> 8) & 255, value & 255)


def version_text(value):
    return '.'.join(str(part) for part in value)


def inspect_macho(data, name):
    """Accept thin arm64 iPhoneOS images, not simulator or macOS binaries."""
    if data[:4] != b'\xcf\xfa\xed\xfe':
        raise ValueError(f'{name}: expected a thin 64-bit Mach-O')
    _, cpu, _, file_type, commands, _, _, _ = struct.unpack_from('<8I', data)
    if cpu != 0x0100000C:
        raise ValueError(f'{name}: not ARM64')
    offset = 32
    minimum = None
    for _ in range(commands):
        command, size = struct.unpack_from('<II', data, offset)
        if size < 8 or offset + size > len(data):
            raise ValueError(f'{name}: malformed load command')
        if command == 0x32:  # LC_BUILD_VERSION
            platform, packed = struct.unpack_from('<II', data, offset + 8)
            if platform != 2:  # PLATFORM_IOS
                raise ValueError(f'{name}: platform {platform}, expected iPhoneOS')
            minimum = version(packed)
        elif command == 0x25:  # LC_VERSION_MIN_IPHONEOS
            minimum = version(struct.unpack_from('<I', data, offset + 8)[0])
        offset += size
    if minimum is None or minimum > (17, 0, 0):
        raise ValueError(f'{name}: requires {minimum}, incompatible with iOS 17.0')
    return {'path': name, 'architecture': 'arm64',
            'minimum_ios': version_text(minimum), 'mach_o_type': file_type}


def verify(path):
    with zipfile.ZipFile(path) as archive:
        invalid = archive.testzip()
        if invalid:
            raise ValueError(f'Corrupt ZIP member: {invalid}')
        plists = [name for name in archive.namelist()
                  if name.startswith('Payload/') and name.count('/') == 2
                  and name.endswith('.app/Info.plist')]
        if len(plists) != 1:
            raise ValueError('Expected exactly one Payload/*.app/Info.plist')
        info = plistlib.loads(archive.read(plists[0]))
        if info['MinimumOSVersion'] not in ('17.0', '17.0.0'):
            raise ValueError(f"Unexpected MinimumOSVersion: {info['MinimumOSVersion']}")
        if info['CFBundleSupportedPlatforms'] != ['iPhoneOS']:
            raise ValueError('This is not an iPhoneOS device app')
        root = plists[0].rsplit('/', 1)[0] + '/'
        main = root + info['CFBundleExecutable']
        if not archive.read(root + 'main.jsbundle'):
            raise ValueError('Missing bundled JavaScript')
        binaries = []
        for item in archive.infolist():
            if item.is_dir() or not item.filename.startswith(root):
                continue
            with archive.open(item) as entry:
                magic = entry.read(4)
            if magic in (b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe',
                         b'\xbe\xba\xfe\xca', b'\xfe\xed\xfa\xcf'):
                binaries.append(inspect_macho(archive.read(item), item.filename))
        if not any(item['path'] == main and item['mach_o_type'] == 2
                   for item in binaries):
            raise ValueError('Missing main ARM64 executable')
        return {
            'ipa': path.name,
            'bytes': path.stat().st_size,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'bundle_identifier': info['CFBundleIdentifier'],
            'version': info['CFBundleShortVersionString'],
            'build': info['CFBundleVersion'],
            'localizations': info.get('CFBundleLocalizations', []),
            'minimum_ios': info['MinimumOSVersion'],
            'javascript_bundled': True,
            'binaries': binaries,
        }


if __name__ == '__main__':
    print(json.dumps(verify(pathlib.Path(sys.argv[1])), indent=2))
