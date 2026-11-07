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
    libraries = []
    symtab = None
    for _ in range(commands):
        if offset + 8 > len(data):
            raise ValueError(f'{name}: malformed load command')
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
        elif command in (0xc, 0x80000018, 0x8000001f, 0x80000023, 0x20):
            # LOAD_DYLIB, LOAD_WEAK_DYLIB, REEXPORT_DYLIB, LOAD_UPWARD_DYLIB,
            # LAZY_LOAD_DYLIB. Their order is the nlist library ordinal.
            if size < 24:
                raise ValueError(f'{name}: malformed dylib command')
            start = struct.unpack_from('<I', data, offset + 8)[0]
            end = data.find(b'\0', offset + start, offset + size)
            if not 24 <= start < size or end < 0:
                raise ValueError(f'{name}: malformed dylib name')
            libraries.append(data[offset + start:end].decode('utf-8'))
        elif command == 2:  # LC_SYMTAB
            if size < 24:
                raise ValueError(f'{name}: malformed symbol table command')
            symtab = struct.unpack_from('<4I', data, offset + 8)
        offset += size
    if minimum is None or minimum > (17, 0, 0):
        raise ValueError(f'{name}: requires {minimum}, incompatible with iOS 17.0')
    check_ios17_imports(data, name, libraries, symtab)
    return {'path': name, 'architecture': 'arm64',
            'minimum_ios': version_text(minimum), 'mach_o_type': file_type}


def check_ios17_imports(data, name, libraries, symtab):
    """Reject the RN prebuilt library's known iOS 17 dyld incompatibility.

    These symbols exist in iOS 17's libc++abi, but libc++ does not reexport
    them until a later OS. A low LC_BUILD_VERSION does not make that import
    valid. Check the owning library, including lazy imports, not just names.
    This is a targeted regression gate, not a complete system-symbol audit.
    """
    if symtab is None:
        return
    symoff, count, stroff, strsize = symtab
    if symoff + count * 16 > len(data) or stroff + strsize > len(data):
        raise ValueError(f'{name}: malformed symbol table')
    incompatible = {'___cxa_increment_exception_refcount',
                    '___cxa_decrement_exception_refcount'}
    for index in range(count):
        string, kind, _, desc, _ = struct.unpack_from('<IBBHQ', data, symoff + index * 16)
        if kind & 0xe0 or kind & 0x0e or desc & 0x40:
            continue  # Debug/local definition or optional weak import.
        ordinal = desc >> 8
        if not 0 < ordinal <= len(libraries):
            continue
        if libraries[ordinal - 1] != '/usr/lib/libc++.1.dylib':
            continue
        if string >= strsize:
            raise ValueError(f'{name}: malformed symbol table string')
        end = data.find(b'\0', stroff + string, stroff + strsize)
        if end < 0:
            raise ValueError(f'{name}: malformed symbol table string')
        symbol = data[stroff + string:end].decode('utf-8')
        if symbol in incompatible:
            raise ValueError(f'{name}: iOS 17 cannot resolve {symbol} from libc++.1; '
                             'build RN dependencies from source to link libc++abi')


def exported_symbols(data, name, offset, size):
    """Read dyld's export trie; stripped nlist tables need not list exports."""
    if offset + size > len(data):
        raise ValueError(f'{name}: malformed export trie')
    trie = data[offset:offset + size]
    if not trie:
        return set()

    def uleb(cursor):
        result = 0
        for shift in range(0, 70, 7):
            if cursor >= len(trie):
                break
            byte = trie[cursor]
            cursor += 1
            result |= (byte & 0x7f) << shift
            if not byte & 0x80:
                return result, cursor
        raise ValueError(f'{name}: malformed export trie integer')

    exports = set()
    pending = [(0, '', frozenset())]
    while pending:
        node, prefix, ancestors = pending.pop()
        if node in ancestors or len(ancestors) > 512:
            raise ValueError(f'{name}: cyclic or excessive export trie')
        terminal_size, cursor = uleb(node)
        terminal_end = cursor + terminal_size
        if terminal_end >= len(trie):
            raise ValueError(f'{name}: malformed export trie node')
        if terminal_size:
            exports.add(prefix)
        cursor = terminal_end
        children = trie[cursor]
        cursor += 1
        for _ in range(children):
            end = trie.find(b'\0', cursor)
            if end < 0:
                raise ValueError(f'{name}: malformed export trie edge')
            suffix = trie[cursor:end].decode('utf-8')
            child, cursor = uleb(end + 1)
            pending.append((child, prefix + suffix, ancestors | {node}))
    return exports


def loader_symbols(data, name):
    libraries, reexports, imports, definitions = [], [], [], set()
    identity, symtab, exports = None, None, None
    cursor = 32
    for _ in range(struct.unpack_from('<I', data, 16)[0]):
        command, size = struct.unpack_from('<II', data, cursor)
        if size < 8 or cursor + size > len(data):
            raise ValueError(f'{name}: malformed load command')
        if command in (0xc, 0x80000018, 0x8000001f, 0x80000023, 0x20, 0xd):
            start = struct.unpack_from('<I', data, cursor + 8)[0]
            end = data.find(b'\0', cursor + start, cursor + size)
            if not 24 <= start < size or end < 0:
                raise ValueError(f'{name}: malformed dylib name')
            library = data[cursor + start:end].decode('utf-8')
            if command == 0xd:  # LC_ID_DYLIB
                identity = library
            else:
                libraries.append(library)
                if command == 0x8000001f:
                    reexports.append(library)
        elif command == 2:
            symtab = struct.unpack_from('<4I', data, cursor + 8)
        elif command == 0x80000033:  # LC_DYLD_EXPORTS_TRIE
            exports = struct.unpack_from('<II', data, cursor + 8)
        elif command in (0x22, 0x80000022):  # LC_DYLD_INFO[_ONLY]
            exports = struct.unpack_from('<II', data, cursor + 40)
        cursor += size
    if symtab is not None:
        symoff, count, stroff, strsize = symtab
        if symoff + count * 16 > len(data) or stroff + strsize > len(data):
            raise ValueError(f'{name}: malformed symbol table')
        for index in range(count):
            string, kind, _, desc, _ = struct.unpack_from('<IBBHQ', data, symoff + index * 16)
            if kind & 0xe0 or not kind & 1 or not string:
                continue
            if string >= strsize:
                raise ValueError(f'{name}: malformed symbol table string')
            end = data.find(b'\0', stroff + string, stroff + strsize)
            if end < 0:
                raise ValueError(f'{name}: malformed symbol table string')
            symbol = data[stroff + string:end].decode('utf-8')
            if kind & 0x0e:
                definitions.add(symbol)
            elif not desc & 0x40:
                ordinal = desc >> 8
                if 0 < ordinal <= len(libraries):
                    imports.append((libraries[ordinal - 1], symbol))
    if exports is not None:
        definitions = exported_symbols(data, name, *exports)
    return identity, definitions, imports, reexports


def check_bundled_framework_imports(images):
    """Catch mismatched packaged frameworks before dyld aborts on the phone.

    Only bundled providers are checked. System-library availability and flat
    namespace lookups are outside this gate.
    """
    parsed = {name: loader_symbols(data, name) for name, data in images.items()}
    providers = {item[0]: name for name, item in parsed.items() if item[0]}

    def provides(library, symbol, visited):
        if library not in providers or library in visited:
            return False
        _, definitions, _, reexports = parsed[providers[library]]
        return symbol in definitions or any(
            provides(child, symbol, visited | {library}) for child in reexports)

    checked = 0
    for name, (_, _, imports, _) in parsed.items():
        for library, symbol in imports:
            if library not in providers:
                continue
            checked += 1
            if not provides(library, symbol, set()):
                raise ValueError(f'{name}: missing bundled symbol {symbol} in {library}')
    return checked


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
        interface_style = info.get('UIUserInterfaceStyle', 'Automatic')
        if interface_style != 'Automatic':
            raise ValueError(f'Native appearance is forced to {interface_style}')
        photo_permission = info.get('NSPhotoLibraryUsageDescription', '')
        camera_permission = info.get('NSCameraUsageDescription', '')
        if not photo_permission.strip() or not camera_permission.strip():
            raise ValueError('Missing photo library or camera permission description')
        microphone_permission = info.get('NSMicrophoneUsageDescription', '')
        speech_permission = info.get('NSSpeechRecognitionUsageDescription', '')
        if not microphone_permission.strip() or not speech_permission.strip():
            raise ValueError('Missing microphone or speech recognition permission description')
        root = plists[0].rsplit('/', 1)[0] + '/'
        main = root + info['CFBundleExecutable']
        if not archive.read(root + 'main.jsbundle'):
            raise ValueError('Missing bundled JavaScript')
        binaries = []
        images = {}
        for item in archive.infolist():
            if item.is_dir() or not item.filename.startswith(root):
                continue
            with archive.open(item) as entry:
                magic = entry.read(4)
            if magic in (b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe',
                         b'\xbe\xba\xfe\xca', b'\xfe\xed\xfa\xcf'):
                data = archive.read(item)
                binaries.append(inspect_macho(data, item.filename))
                images[item.filename] = data
        bundled_imports_checked = check_bundled_framework_imports(images)
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
            'interface_style': interface_style,
            'photo_permission': photo_permission,
            'camera_permission': camera_permission,
            'microphone_permission': microphone_permission,
            'speech_permission': speech_permission,
            'javascript_bundled': True,
            'ios17_libcxx_imports_checked': True,
            'bundled_framework_imports_checked': bundled_imports_checked,
            'binaries': binaries,
        }


if __name__ == '__main__':
    print(json.dumps(verify(pathlib.Path(sys.argv[1])), indent=2))
