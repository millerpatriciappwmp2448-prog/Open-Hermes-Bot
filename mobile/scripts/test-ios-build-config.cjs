// Exercise Expo's real plugin pipeline; ios/ is regenerated in CI.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const output = execFileSync(process.execPath, [
  require.resolve('expo/bin/cli'), 'config', '--type', 'introspect', '--json',
], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const config = JSON.parse(output);
const properties = config._internal.modResults.ios.podfileProperties;
assert.equal(properties['ios.buildReactNativeFromSource'], 'true',
  'RN and its third-party dependencies must be compiled for iOS 17');
assert.equal(properties.EXPO_USE_PRECOMPILED_MODULES, 'false',
  'Expo modules must use the same source-built React Native');
assert.equal(properties['ios.deploymentTarget'], '17.0');
console.log('PASS: Expo generates iOS 17 source-build properties');
