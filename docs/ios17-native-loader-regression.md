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

## Build 24 follow-up

The build 24 IPA (`1f9d2c664b009de43681a28bda3e671e4b64504dd3c90f07f8a648d104a3110a`)
passes the loader gate, but the user still reports an immediate device exit.
That report remains unresolved; the gate is not a device acceptance test.

Simulator run `42310828739` compiled successfully for x86_64/iOS 26.2.
The eight-minute launch step included more than four minutes of first-boot
migration. `simctl launch` wrote a PID, but the job timed out before recording
process survival or a screenshot. No HermesBot crash report was collected.
It is an inconclusive launch test, not evidence of either a crash or success.

The diagnostic workflow now boots separately, records each launch stage,
bounds install/launch/process/screenshot queries, checks the original PID and
executable, and retains the compiled simulator app for retries. None of these
changes modifies the shipped application or resolves the reported device
failure. A current device `.ips` or a reproduced native exception is still
needed to identify the remaining cause.

## iOS 17 simulator replay (2026-11-07)

Run `42325046751` replayed the retained build 24 simulator application on
Apple's iOS 17.0 runtime (21A328). The original process, PID 17331, remained
alive after the 40-second observation period, and a screenshot was saved.
The diagnostic result is `alive`, stage `complete`. No HermesBot crash
report was collected. Artifact `13555975480` has SHA-256
`da9d802f1487af71e73b0b5861494e1dce418e910a63b112627346f5435d1361`.

This is an x86_64 simulator cold launch with clean app data. It does not
test the ARM64 IPA, TrollStore installation, saved device settings, language
switching, or opening a paired agent's conversation. The immediate device
exit is still unresolved, and no new device IPA was produced by the replay.

The earlier replay failure (`42323614838`) was a workflow error: the step
tried to read `SIM_UDID` before the value written to `GITHUB_ENV` became
available. Moving simulator boot to the next step fixed that diagnostic
error only; it was not an application crash fix.

The Windows Apple Mobile Device service responded to a read-only usbmux
device-list request, but reported no connected USB or network devices.
No new `.ips` or `.crash` file was found in Downloads, Desktop, Documents,
or Apple's local mobile crash-report directory. A current device report
is needed before making another runtime or signing change.

## Device report and installed-version check (2026-11-07)

The user supplied `HermesBot-2026-11-07-185224.ips`. It contains a one-line
JSON header followed by a separate JSON report. Parsing the whole file as
one JSON object fails with `Extra data`; parse the two objects separately.

This report is for **1.0.0 build 22**, on iOS 17.0 (21A329). dyld terminates
at launch because `ExpoFileSystem` imports the missing
`ExpoModulesCore.EventEmitter.eventRuntime(forEvent:)` symbol. The main
executable and the Expo framework UUIDs match the retained build 22 IPA
exactly. The faulting backtrace is a loader abort, before application code.

A read-only InstallationProxy query over the paired device's Wi-Fi
connection also returned installed version **1.0.0 build 22**. Keeping the
`com.apple.mobile.heartbeat` service running allowed this query to succeed;
previous service connections were reset without the heartbeat. The crash
report copy service still timed out, so no additional reports were obtained.

The retained **1.0.1 build 24** IPA has SHA-256
`1f9d2c664b009de43681a28bda3e671e4b64504dd3c90f07f8a648d104a3110a`.
Its main executable defines the exact symbol missing in the supplied
report. An audit of the bundled frameworks finds ten unresolved imports
in build 22 and zero in build 24 (278 bundled imports checked). This
confirms that build 24 removes this particular loader mismatch. It does
not establish successful installation or execution of build 24 on the
device. Earlier reports of continued failure cannot be attributed to
build 24 using this build 22 report.

The IPA verifier now resolves strong imports against each bundled
provider's dyld export trie, including bundled library reexports. This
rejects mismatched Expo frameworks instead of relying on their deployment
target alone. The existing libc++ gate remains. System-library exports,
flat namespace lookups, and runtime behavior are outside this new gate.
