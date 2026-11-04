const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const Module = require('node:module');
const harness = require('./helpers/native-screen-harness.cjs');
const appEvents = new (require('node:events').EventEmitter)();
harness.native.AppState.addEventListener = (name, fn) => { appEvents.on(name, fn); return { remove: () => appEvents.off(name, fn) }; };
harness.native.AppState.currentState = 'active';
const api = require('../src/api.ts');
let latest, factories = 0, starts = 0, reads = 0, stops = 0, runStatus = 'running', reachable = true;
let prefs = { picks: { default: { model: 'preserved' } } }, pending = [], ensured = 0;
const supervisor = { id: 'supervisor', profile: 'supervisor', name: 'Codex supervisor', capabilities: ['codex-supervisor'], primary: false };
const fake = {
  baseUrl: 'https://host.invalid', token: 'test',
  ensureCodexAgent: async () => { ensured++; prefs.mobilePinnedBots = { ...prefs.mobilePinnedBots, supervisor: true }; return supervisor; },
  bots: async () => [{ id: 'default', profile: 'default', name: 'Agent', primary: true }, ...(ensured ? [supervisor] : [])],
  sessions: async () => [{ bot: 'default', id: 's1', lastActive: 1, messageCount: 0 }],
  prefs: async () => structuredClone(prefs),
  models: async () => ({ current: 'test-model', currentProvider: 'custom', providers: [] }),
  messages: async () => [], health: async () => ({ ok: true }), devices: async () => [],
  activeTurns: async () => pending,
  pinBot: async (id, pinned) => { prefs.mobilePinnedBots = { ...prefs.mobilePinnedBots, [id]: pinned }; },
  startTurn: async input => { starts++; return { ...input, status: runStatus, text: '' }; },
  readTurn: async () => { reads++; if (!reachable) throw new api.BridgeError('offline', 'unreachable'); return { status: runStatus, text: runStatus === 'completed' ? 'Recovered answer' : 'Partial' }; },
  stopTurn: async () => { stops++; },
};
const load = Module._load;
Module._load = function(request, parent, main) {
  if (request === './api' && parent?.filename.endsWith('store.tsx')) return { ...api, createBridgeClient: () => { factories++; return fake; } };
  return load.call(this, request, parent, main);
};
const { StoreProvider, useStore } = require('../src/store.tsx');
function Probe() { latest = useStore(); return null; }
const flush = async () => { await act(async () => { await new Promise(setImmediate); }); };
const event = async value => { await act(async () => { harness.native.AppState.currentState = value; appEvents.emit('change', value); }); await flush(); };
async function mount() { let tree; await act(async () => { tree = create(React.createElement(StoreProvider, null, React.createElement(Probe))); }); await flush(); return tree; }

test('real StoreProvider persists pins; refresh/navigation/background cannot cancel or duplicate a Hermes run', async () => {
  harness.savedPreferences.set('hermes.bridge', JSON.stringify({ url: fake.baseUrl, token: fake.token, device: 'test' }));
  const tree = await mount();
  try {
    assert.equal(latest.connection.status, 'connected');
    assert.ok(ensured > 0, 'a connected host must provision its dedicated supervisor before listing');
    assert.deepEqual(latest.botById('supervisor').capabilities, ['codex-supervisor']);
    assert.equal(latest.threads.find(row => row.botId === 'supervisor')?.pinned, true);
    await act(async () => { await latest.togglePin('bot:default'); });
    assert.equal(prefs.mobilePinnedBots?.default, true, 'pin must be written to host');
    await act(async () => { await latest.refresh(); });
    assert.equal(latest.threads[0].pinned, true, 'refresh restores the saved pin');
    await act(async () => { latest.send('bot:default', { text: 'slow request' }); });
    await flush();
    assert.equal(starts, 1, 'use durable start, not the phone-owned SSE stream');
    assert.equal(latest.threads[0].typing, true);
    await act(async () => { await latest.refresh(); });
    assert.equal(factories, 1, 'same host refresh must retain active client identity');
    assert.equal(latest.threads[0].typing, true);
    assert.ok(latest.messages['bot:default'].some(m => m.text === 'slow request'));
    reachable = false;
    await event('background');
    reachable = true; runStatus = 'completed';
    await event('active');
    assert.equal(starts, 1, 'foreground must never resubmit user message');
    assert.equal(stops, 0, 'leaving the UI is not stop');
    assert.equal(latest.threads[0].typing, false);
    assert.ok(latest.messages['bot:default'].some(m => m.text === 'Recovered answer'));
    assert.ok(latest.messages['bot:default'].every(m => !m.failed));
  } finally { await act(async () => tree.unmount()); }
  runStatus = 'running'; pending = [{ bot: 'default', sessionId: 's1', requestId: 'existing', status: 'running', text: '' }];
  const reopened = await mount();
  try {
    assert.equal(latest.threads[0].pinned, true, 'pins survive StoreProvider restart');
    assert.equal(latest.threads[0].typing, true, 'discover server run after app restart');
    assert.equal(starts, 1, 'recovered run uses read, never start');
    runStatus = 'completed';
    await event('background'); await event('active');
    assert.ok(latest.messages['bot:default'].some(m => m.text === 'Recovered answer'));
  } finally { await act(async () => reopened.unmount()); }
});
