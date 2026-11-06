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
