#!/usr/bin/env bash
# Run from mobile/ on macOS after expo prebuild and pod install.
set -euo pipefail

mkdir -p artifacts
project="$(find ios -maxdepth 1 -name '*.xcodeproj' -print -quit)"
test -n "$project"
scheme="$(basename "$project" .xcodeproj)"
workspace="ios/$scheme.xcworkspace"
test -d "$workspace"

xcodebuild \
  -workspace "$workspace" \
  -scheme "$scheme" \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath ios/build \
  ARCHS=arm64 \
  ONLY_ACTIVE_ARCH=NO \
  IPHONEOS_DEPLOYMENT_TARGET=17.0 \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY='' \
  build 2>&1 | tee artifacts/xcodebuild.log

app="ios/build/Build/Products/Release-iphoneos/$scheme.app"
test -d "$app"
test -s "$app/main.jsbundle"

# Give TrollStore a normal ad-hoc signature with an app-specific keychain group.
# No Apple developer certificate or provisioning profile is required.
python3 - "$app" artifacts/entitlements.plist <<'PY'
import pathlib
import plistlib
import sys

app = pathlib.Path(sys.argv[1])
info = plistlib.loads((app / 'Info.plist').read_bytes())
identifier = 'TROLLTROLL.' + info['CFBundleIdentifier']
with open(sys.argv[2], 'wb') as out:
    plistlib.dump({
        'application-identifier': identifier,
        'com.apple.developer.team-identifier': 'TROLLTROLL',
        'keychain-access-groups': [identifier],
    }, out)
PY

while IFS= read -r -d '' library; do
  codesign --force --sign - --timestamp=none "$library"
done < <(find "$app" -type f -name '*.dylib' -print0)
while IFS= read -r -d '' framework; do
  codesign --force --sign - --timestamp=none "$framework"
done < <(find "$app" -depth -type d -name '*.framework' -print0)
codesign --force --sign - --timestamp=none \
  --entitlements artifacts/entitlements.plist "$app"
codesign --verify --deep --strict --verbose=2 "$app"

staging="$(mktemp -d "$PWD/artifacts/package.XXXXXX")"
mkdir -p "$staging/Payload"
ditto "$app" "$staging/Payload/$(basename "$app")"
ipa="$PWD/artifacts/Hermes-Bot-iOS17-ZH-EN-TrollStore.ipa"
test ! -e "$ipa"
(cd "$staging" && /usr/bin/zip -qry "$ipa" Payload)
python3 scripts/verify-ios-ipa.py "$ipa" > artifacts/verification.json
cat artifacts/verification.json
