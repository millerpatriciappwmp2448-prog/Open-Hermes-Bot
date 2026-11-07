"""Exercise the iOS 17 loader regression without requiring macOS."""

import importlib.util
import pathlib
import struct
import unittest

spec = importlib.util.spec_from_file_location(
    'verify_ios_ipa', pathlib.Path(__file__).with_name('verify-ios-ipa.py'))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


def macho(library, symbol, *, weak=False, defined=False, extra_libraries=()):
    """Small ARM64 dylib with a real load-command and nlist_64 layout."""
    commands = [struct.pack('<6I', 0x32, 24, 2, 12 << 16, 26 << 16, 0)]
    for lib in (*extra_libraries, library):
        name = lib.encode() + b'\0'
        size = (24 + len(name) + 7) & ~7
        commands.append(struct.pack('<6I', 0xc, size, 24, 0, 0, 0)
                        + name + bytes(size - 24 - len(name)))
    symoff = 32 + sum(map(len, commands)) + 24
    strings = b'\0' + symbol.encode() + b'\0'
    commands.append(struct.pack('<6I', 2, 24, symoff, 1, symoff + 16, len(strings)))
    header = struct.pack('<8I', 0xfeedfacf, 0x0100000c, 0, 6,
                         len(commands), sum(map(len, commands)), 0, 0)
    desc = ((len(extra_libraries) + 1) << 8) | (0x40 if weak else 0)
    entry = struct.pack('<IBBHQ', 1, 0xf if defined else 1,
                        1 if defined else 0, desc, 1 if defined else 0)
    return header + b''.join(commands) + entry + strings


def framework(install_name, symbols, *, reexports=()):
    """A provider with a dyld export trie, independent of its nlist table."""
    encoded_name = install_name.encode() + b'\0'
    size = (24 + len(encoded_name) + 7) & ~7
    identity = (struct.pack('<6I', 0xd, size, 24, 0, 0, 0)
                + encoded_name + bytes(size - 24 - len(encoded_name)))
    # Fixtures use short symbols so every child offset fits one ULEB128 byte.
    root_size = 2 + sum(len(s.encode()) + 2 for s in symbols)
    children = b''
    edges = b''
    for symbol in symbols:
        edges += symbol.encode() + b'\0' + bytes([root_size + len(children)])
        children += b'\x02\x00\x01\x00'  # regular export, address 1, no children
    trie = b'\x00' + bytes([len(symbols)]) + edges + children
    dependencies = b''
    for library in reexports:
        encoded = library.encode() + b'\0'
        length = (24 + len(encoded) + 7) & ~7
        dependencies += (struct.pack('<6I', 0x8000001f, length, 24, 0, 0, 0)
                         + encoded + bytes(length - 24 - len(encoded)))
    offset = 32 + len(identity) + len(dependencies) + 16
    commands = identity + dependencies + struct.pack('<4I', 0x80000033, 16, offset, len(trie))
    header = struct.pack('<8I', 0xfeedfacf, 0x0100000c, 0, 6,
                         2 + len(reexports), len(commands), 0, 0)
    return header + commands + trie


class BundledFrameworkImportsTest(unittest.TestCase):
    library = '@rpath/ExpoModulesCore.framework/ExpoModulesCore'

    def test_rejects_symbol_missing_from_bundled_provider(self):
        images = {
            'ExpoFileSystem': macho(self.library, '_eventRuntime'),
            'ExpoModulesCore': framework(self.library, ['_olderAPI']),
        }
        with self.assertRaisesRegex(ValueError, 'ExpoFileSystem.*_eventRuntime.*ExpoModulesCore'):
            verifier.check_bundled_framework_imports(images)

    def test_accepts_matching_framework_exports(self):
        images = {
            'ExpoFileSystem': macho(self.library, '_eventRuntime'),
            'ExpoModulesCore': framework(self.library, ['_eventRuntime']),
        }
        self.assertEqual(verifier.check_bundled_framework_imports(images), 1)

    def test_ignores_optional_imports_and_system_libraries(self):
        images = {
            'OptionalModule': macho(self.library, '_eventRuntime', weak=True),
            'SystemConsumer': macho('/usr/lib/libSystem.B.dylib', '_malloc'),
            'ExpoModulesCore': framework(self.library, []),
        }
        self.assertEqual(verifier.check_bundled_framework_imports(images), 0)

    def test_does_not_mistake_a_local_definition_for_an_import(self):
        images = {
            'Consumer': macho(self.library, '_eventRuntime', defined=True),
            'ExpoModulesCore': framework(self.library, []),
        }
        self.assertEqual(verifier.check_bundled_framework_imports(images), 0)

    def test_rejects_malformed_export_trie(self):
        provider = framework(self.library, ['_eventRuntime'])[:-2]
        with self.assertRaisesRegex(ValueError, 'export trie'):
            verifier.check_bundled_framework_imports({'ExpoModulesCore': provider})

    def test_resolves_bundled_library_reexports(self):
        dependency = '@rpath/Dependency.framework/Dependency'
        images = {
            'Consumer': macho(self.library, '_eventRuntime'),
            'ExpoModulesCore': framework(self.library, [], reexports=(dependency,)),
            'Dependency': framework(dependency, ['_eventRuntime']),
        }
        self.assertEqual(verifier.check_bundled_framework_imports(images), 1)

    def test_reexport_cycle_cannot_hide_a_missing_symbol(self):
        dependency = '@rpath/Dependency.framework/Dependency'
        images = {
            'Consumer': macho(self.library, '_eventRuntime'),
            'ExpoModulesCore': framework(self.library, [], reexports=(dependency,)),
            'Dependency': framework(dependency, [], reexports=(self.library,)),
        }
        with self.assertRaisesRegex(ValueError, 'missing bundled symbol'):
            verifier.check_bundled_framework_imports(images)


class Ios17ImportsTest(unittest.TestCase):
    def test_rejects_refcount_imports_from_libcxx_despite_low_deployment_target(self):
        for symbol in ('___cxa_increment_exception_refcount',
                       '___cxa_decrement_exception_refcount'):
            with self.subTest(symbol=symbol):
                binary = macho('/usr/lib/libc++.1.dylib', symbol)
                with self.assertRaisesRegex(ValueError, 'iOS 17.*' + symbol):
                    verifier.inspect_macho(binary, 'ReactNativeDependencies')

    def test_accepts_refcount_imports_from_libcxxabi(self):
        verifier.inspect_macho(macho('/usr/lib/libc++abi.dylib',
            '___cxa_increment_exception_refcount'), 'SourceBuild')

    def test_uses_symbol_library_ordinal_not_library_presence(self):
        verifier.inspect_macho(macho('/usr/lib/libc++abi.dylib',
            '___cxa_increment_exception_refcount',
            extra_libraries=('/usr/lib/libc++.1.dylib',)), 'SourceBuild')

    def test_accepts_weak_imports_and_local_definitions(self):
        for flags in ({'weak': True}, {'defined': True}):
            verifier.inspect_macho(macho('/usr/lib/libc++.1.dylib',
                '___cxa_increment_exception_refcount', **flags), 'OptionalImport')

    def test_accepts_existing_libcxx_symbols(self):
        verifier.inspect_macho(macho('/usr/lib/libc++.1.dylib',
            '___cxa_throw'), 'CompatibleBuild')

    def test_rejects_truncated_symbol_table(self):
        binary = macho('/usr/lib/libc++.1.dylib', '___cxa_throw')
        with self.assertRaisesRegex(ValueError, 'symbol table'):
            verifier.inspect_macho(binary[:-6], 'Truncated')


if __name__ == '__main__':
    unittest.main()
