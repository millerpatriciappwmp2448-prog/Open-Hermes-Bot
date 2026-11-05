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
  savePrefs: async value => { prefs = structuredClone(value); },
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

test('StoreProvider saves notification choices per profile and notifies completion outside the visible chat', async () => {
  pending = []; runStatus = 'running';
  harness.notificationCalls.presented.length = 0;
  const tree = await mount();
  try {
    assert.equal(latest.chatPreferences.default.notifications, true);
    await act(async () => { await latest.saveChatPreferences('default', { notifications: false }); });
    await act(async () => { await latest.saveChatPreferences('default', { tapbacks: false }); });
    assert.equal(latest.chatPreferences.default.notifications, false);
    assert.equal(prefs.mobileChatPreferences.default.notifications, false);
    assert.equal(latest.chatPreferences.supervisor.notifications, true);
    await act(async () => { await latest.refresh(); });
    assert.equal(latest.chatPreferences.default.notifications, false);
    async function reply(visible) {
      runStatus = 'running';
      await act(async () => { latest.setViewingThread(visible); latest.send('bot:default', { text: 'finish me' }); });
      await flush();
      await event('background'); runStatus = 'completed'; await event('active');
    }
    await reply(null);
    assert.equal(harness.notificationCalls.presented.length, 0, 'muted agents stay quiet');
    await act(async () => { await latest.saveChatPreferences('default', { notifications: true }); });
    await reply('bot:default');
    assert.equal(harness.notificationCalls.presented.length, 0, 'visible conversation stays quiet');
    await reply('bot:supervisor');
    assert.equal(harness.notificationCalls.presented.length, 1, 'another screen receives the alert');
    const notice = harness.notificationCalls.presented[0];
    assert.equal(notice.content.data.threadId, 'bot:default');
    assert.equal(notice.content.data.sessionId, 's1');
    assert.ok(!JSON.stringify(notice).includes('Recovered answer'), 'lock screen does not expose reply text');
    assert.equal(harness.notificationCalls.permissionRequests, 0, 'authorized devices do not get permission prompts');
  } finally { await act(async () => tree.unmount()); }
});

test('StoreProvider speaks fresh visible replies only and stops on navigation, background, mute and disconnect', async () => {
  pending = []; runStatus = 'running';
  harness.speechCalls.spoken.length = 0;
  const tree = await mount();
  try {
    assert.equal(latest.chatPreferences.default.readAloud, false);
    await act(async () => { await latest.saveChatPreferences('default', { readAloud: true }); });
    assert.equal(prefs.mobileChatPreferences.default.readAloud, true);
    assert.equal(latest.chatPreferences.supervisor.readAloud, false);
    async function reply(visible) {
      runStatus = 'running';
      await act(async () => { latest.setViewingThread(visible); latest.send('bot:default', { text: 'speak this reply' }); });
      await flush();
      // Request is still running; only the successful final answer is spoken.
      await event('background'); runStatus = 'completed'; await event('active');
      await flush();
    }
    await reply(null);
    assert.equal(harness.speechCalls.spoken.length, 0, 'another screen stays quiet');
    await reply('bot:default');
    assert.equal(harness.speechCalls.spoken.length, 1);
    assert.equal(harness.speechCalls.spoken[0].text, 'Recovered answer');
    let stopped = harness.speechCalls.stops;
    await act(async () => latest.setViewingThread(null)); await flush();
    assert.ok(harness.speechCalls.stops > stopped, 'leaving chat stops speech');
    await reply('bot:default');
    stopped = harness.speechCalls.stops;
    await event('background');
    assert.ok(harness.speechCalls.stops > stopped, 'background stops speech');
    await event('active'); await flush();
    assert.equal(harness.speechCalls.spoken.length, 2, 'foreground does not replay an old reply');
    await reply('bot:default');
    stopped = harness.speechCalls.stops;
    await act(async () => { await latest.saveChatPreferences('default', { readAloud: false }); }); await flush();
    assert.ok(harness.speechCalls.stops > stopped, 'disabling the agent stops speech');
    await reply('bot:default');
    assert.equal(harness.speechCalls.spoken.length, 3);
    await act(async () => { await latest.saveChatPreferences('default', { readAloud: true }); });
    for (const status of ['cancelled', 'failed']) {
      const spoken = harness.speechCalls.spoken.length;
      runStatus = 'running';
      await act(async () => latest.send('bot:default', { text: 'must not read failed reply' })); await flush();
      await event('background'); runStatus = status; await event('active'); await flush();
      assert.equal(harness.speechCalls.spoken.length, spoken, status + ' runs never speak');
    }
    await reply('bot:default');
    stopped = harness.speechCalls.stops;
    await act(async () => { await latest.disconnect(); }); await flush();
    assert.ok(harness.speechCalls.stops > stopped, 'disconnect stops speech');
  } finally { await act(async () => tree.unmount()); }
});

test('restored server runs do not read historical replies aloud', async () => {
  prefs.mobileChatPreferences.default.readAloud = true;
  pending = [{ bot: 'default', sessionId: 's1', requestId: 'historical', status: 'running' }];
  runStatus = 'running';
  const before = harness.speechCalls.spoken.length;
  const tree = await mount();
  try {
    latest.setViewingThread('bot:default');
    await event('background'); runStatus = 'completed'; await event('active'); await flush();
    assert.equal(harness.speechCalls.spoken.length, before);
  } finally { await act(async () => tree.unmount()); }
});

test('unmounting StoreProvider stops any reply speech', async () => {
  pending = []; runStatus = 'running';
  const tree = await mount();
  await act(async () => { await latest.saveChatPreferences('default', { readAloud: true }); latest.setViewingThread('bot:default'); });
  await act(async () => latest.send('bot:default', { text: 'speak before teardown' })); await flush();
  await event('background'); runStatus = 'completed'; await event('active'); await flush();
  const stopped = harness.speechCalls.stops;
  await act(async () => tree.unmount()); await flush();
  assert.ok(harness.speechCalls.stops > stopped);
});
