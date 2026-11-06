# iOS 17 native loader regression

The build 23 device IPA (`fc421951ae614b770702c0b36b60d231868d612b432b73f9e6b211a9b580caad`)
contains two incompatible strong imports in
`ReactNativeDependencies.framework/ReactNativeDependencies`:

- `___cxa_increment_exception_refcount`
- `___cxa_decrement_exception_refcount`

Both imports select `/usr/lib/libc++.1.dylib`. The iOS 17.0 SDK exports
these symbols from `/usr/lib/libc++abi.dylib`, but does not reexport them
through `libc++.1.dylib`. dyld cannot resolve the original imports on iOS 17.
The failure may happen at load time or at the first use of a lazy binding.
The framework's `LC_BUILD_VERSION` says iOS 12.0; checking that value alone
does not catch the incompatible imports.

The previous successful simulator launch used iOS 26.4 and only checked
process survival. It does not validate iOS 17 or interaction with saved
profiles. The older build 21 simulator crash also had a DYLD termination,
but for a different symbol (`ExpoModulesCore.EventEmitter.eventRuntime`);
the packaged build 23 Expo frameworks resolve that older symbol.

## Fix and release gate

Use Expo's `buildReactNativeFromSource` option and disable precompiled Expo
modules. This compiles React Native, its third-party dependencies, and Expo
modules together for the app's iOS 17 target. Retaining prebuilt React core
would retain its dependency on the incompatible prebuilt framework.

`test-ios-build-config.cjs` evaluates the actual Expo plugin pipeline to
check the generated CocoaPods properties. `test-ios-ipa.py` exercises the
Mach-O loader check, including correct libc++abi imports, library ordinals,
weak references, and definitions. `verify-ios-ipa.py` rejects these two
imports from libc++ in every packaged executable or framework. It rejects
the original build 23 IPA even though all its deployment targets pass.

This is a targeted compatibility gate, not an exhaustive audit of all
system symbols or proof of a crash-free app. A new device IPA must pass it.
