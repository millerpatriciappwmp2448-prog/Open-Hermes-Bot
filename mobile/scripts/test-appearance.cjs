const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { createAppearanceStore } = require('../src/appearanceStore.ts');
const vm = require('node:vm');
const paletteModule = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/theme.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: paletteModule, require: () => ({}) });
function luminance(hex) {
  const [r, g, b] = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
function contrast(foreground, background) {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
for (const [name, { C, INK }] of Object.entries(paletteModule.palettes)) {
  for (const foreground of ['text', 'text2']) for (const background of ['bg', 'cardRaised', 'field', 'bubble']) {
    assert.ok(contrast(C[foreground], C[background]) >= 4.5, `${name}: ${foreground} on ${background}`);
  }
  assert.ok(contrast(INK.onPaper, C.paper) >= 4.5, `${name}: button label`);
  assert.ok(contrast(C.green, C.bg) >= 4.5, `${name}: accent text`);
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
(async () => {
  let saved = null;
  const storage = { read: async () => saved, write: async v => { saved = v; } };
  const app = createAppearanceStore(storage, 'light');
  await app.restore();
  assert.deepEqual(app.getSnapshot(), { preference: 'system', scheme: 'light', saveError: false, ready: true });
  app.updateSystem('dark'); assert.equal(app.getSnapshot().scheme, 'dark');
  await app.setPreference('light');
  app.updateSystem('light'); app.updateSystem('dark');
  assert.equal(app.getSnapshot().scheme, 'light', 'Explicit choice survives OS changes');
  const restarted = createAppearanceStore(storage, 'dark');
  await restarted.restore(); assert.equal(restarted.getSnapshot().scheme, 'light');
  await restarted.setPreference('system'); assert.equal(restarted.getSnapshot().scheme, 'dark');
  await restarted.setPreference('ivory'); assert.equal(restarted.getSnapshot().scheme, 'light');
  restarted.updateSystem('light'); restarted.updateSystem('dark');
  assert.equal(restarted.getSnapshot().preference, 'ivory');
  assert.equal(restarted.getSnapshot().scheme, 'light');
  const ivoryRestart = createAppearanceStore(storage, 'dark'); await ivoryRestart.restore();
  assert.equal(ivoryRestart.getSnapshot().preference, 'ivory');

  const read = deferred();
  const lateRead = createAppearanceStore({ read: () => read.promise, write: async () => {} }, 'light');
  const restoring = lateRead.restore(); await lateRead.setPreference('dark');
  read.resolve('light'); await restoring;
  assert.equal(lateRead.getSnapshot().scheme, 'dark', 'Late restore cannot overwrite a tap');

  const write = deferred(), calls = [];
  const rapid = createAppearanceStore({ read: async () => null, write: async v => { calls.push(v); if (v === 'dark') await write.promise; } }, 'dark');
  const first = rapid.setPreference('dark'), second = rapid.setPreference('light');
  await Promise.resolve(); assert.deepEqual(calls, ['dark']);
  assert.equal(rapid.getSnapshot().scheme, 'light', 'UI updates without waiting for storage');
  write.resolve(); await Promise.all([first, second]); assert.deepEqual(calls, ['dark', 'light']);

  let fail = true;
  const failure = createAppearanceStore({ read: async () => { throw Error('locked'); }, write: async () => { if (fail) throw Error('locked'); } }, 'light');
  await failure.restore().catch(() => {}); assert.equal(failure.getSnapshot().ready, true);
  await failure.setPreference('dark'); assert.equal(failure.getSnapshot().saveError, true);
  assert.equal(failure.getSnapshot().scheme, 'dark');
  fail = false; await failure.setPreference('dark'); assert.equal(failure.getSnapshot().saveError, false);
  saved = 'invalid'; const invalid = createAppearanceStore(storage, 'light'); await invalid.restore();
  assert.equal(invalid.getSnapshot().preference, 'system');
  console.log('PASS: three-palette text contrast, system changes, manual/ivory override, persisted restart, late restore, serialized rapid taps, storage failure/retry and invalid values');
})().catch(e => { console.error(e); process.exit(1); });
