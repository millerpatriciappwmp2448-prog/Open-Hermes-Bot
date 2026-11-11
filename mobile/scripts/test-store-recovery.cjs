const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
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

beforeEach(() => {
  harness.savedPreferences.set('hermes.bridge', JSON.stringify({ url: fake.baseUrl, token: fake.token, device: 'test' }));
});

test('real StoreProvider persists pins; refresh/navigation/background cannot cancel or duplicate a Hermes run', async () => {
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

test('accepted clear detaches an old run before its delayed reply and allows a new conversation', async () => {
  pending = []; runStatus = 'running';
  const previous = { startTurn: fake.startTurn, deleteSession: fake.deleteSession, createSession: fake.createSession };
  let finishOld, submitted = 0, deleted = 0;
  fake.startTurn = input => {
    submitted++;
    if (submitted === 1) return new Promise(resolve => { finishOld = () => resolve({ ...input, status: 'completed', text: 'Deleted reply' }); });
    return Promise.resolve({ ...input, status: 'completed', text: 'New reply' });
  };
  fake.deleteSession = async () => { deleted++; };
  fake.createSession = async () => ({ id: 'new-session' });
  harness.notificationCalls.presented.length = 0;
  const tree = await mount();
  try {
    await act(async () => latest.send('bot:default', { text: 'Old question' })); await flush();
    await act(async () => latest.clearThread('bot:default'));
    assert.equal(deleted, 1);
    assert.equal(latest.threadById('bot:default').sessionId, undefined);
    await act(async () => finishOld()); await flush();
    assert.deepEqual(latest.messages['bot:default'], [], 'an accepted deletion must not resurrect a late reply');
    assert.equal(latest.threadById('bot:default').sessionId, undefined);
    assert.deepEqual(harness.notificationCalls.presented, [], 'deleted replies cannot notify');
    await act(async () => latest.send('bot:default', { text: 'New question' })); await flush();
    assert.equal(submitted, 2, 'the old watch must not block the next conversation');
    assert.equal(latest.threadById('bot:default').sessionId, 'new-session');
    assert.ok(latest.messages['bot:default'].some(row => row.text === 'New reply'));
  } finally { await act(async () => tree.unmount()); Object.assign(fake, previous); }
});

test('accepted agent deletion cannot be undone by a delayed run completion', async () => {
  pending = []; runStatus = 'running';
  const previous = { startTurn: fake.startTurn, deleteBot: fake.deleteBot, createSession: fake.createSession };
  let finishOld;
  fake.startTurn = input => new Promise(resolve => { finishOld = () => resolve({ ...input, status: 'completed', text: 'Removed agent reply' }); });
  fake.deleteBot = async () => {};
  fake.createSession = async () => ({ id: 'supervisor-session' });
  harness.notificationCalls.presented.length = 0;
  const tree = await mount();
  try {
    await act(async () => latest.send('bot:supervisor', { text: 'Old question' })); await flush();
    await act(async () => latest.removeBot('supervisor'));
    await act(async () => finishOld()); await flush();
    assert.equal(latest.botById('supervisor'), undefined);
    assert.equal(latest.threadById('bot:supervisor'), undefined);
    assert.equal(latest.messages['bot:supervisor'], undefined, 'a removed agent cannot acquire orphan messages');
    assert.deepEqual(harness.notificationCalls.presented, []);
  } finally { await act(async () => tree.unmount()); Object.assign(fake, previous); }
});

test('rejected clear preserves observation and the original conversation', async () => {
  pending = []; runStatus = 'running';
  const previous = { startTurn: fake.startTurn, deleteSession: fake.deleteSession };
  let finishOld;
  fake.startTurn = input => new Promise(resolve => { finishOld = () => resolve({ ...input, status: 'completed', text: 'Kept reply' }); });
  fake.deleteSession = async () => { throw new Error('Host refused deletion'); };
  const tree = await mount();
  try {
    await act(async () => latest.send('bot:default', { text: 'Kept question' })); await flush();
    await assert.rejects(() => latest.clearThread('bot:default'), /refused/);
    assert.equal(latest.threadById('bot:default').typing, true);
    await act(async () => finishOld()); await flush();
    assert.ok(latest.messages['bot:default'].some(row => row.text === 'Kept reply'));
    assert.equal(latest.threadById('bot:default').sessionId, 's1');
  } finally { await act(async () => tree.unmount()); Object.assign(fake, previous); }
});

test('a refresh started before clear cannot restore the deleted session or resume its run', async () => {
  pending = []; runStatus = 'running';
  const previous = { messages: fake.messages, deleteSession: fake.deleteSession };
  let releaseHistory;
  const tree = await mount();
  try {
    fake.messages = () => new Promise(resolve => { releaseHistory = () => resolve([{ role: 'assistant', content: 'Stale history', timestamp: 1 }]); });
    fake.deleteSession = async () => {};
    let refreshing;
    await act(async () => { refreshing = latest.refresh(); }); await flush();
    assert.equal(typeof releaseHistory, 'function');
    await act(async () => latest.clearThread('bot:default'));
    await act(async () => { releaseHistory(); await refreshing; });
    assert.equal(latest.threadById('bot:default').sessionId, undefined);
    assert.deepEqual(latest.messages['bot:default'], []);
  } finally { await act(async () => tree.unmount()); Object.assign(fake, previous); }
});

test('clear during attachment preparation aborts the upload and cannot start a late run', async () => {
  pending = [];
  const previous = { uploadAttachment: fake.uploadAttachment, deleteSession: fake.deleteSession, startTurn: fake.startTurn };
  let finishUpload, signal, submitted = 0;
  fake.uploadAttachment = (_, value) => { signal = value; return new Promise(resolve => { finishUpload = () => resolve({ path: '/host/old.txt' }); }); };
  fake.deleteSession = async () => {};
  fake.startTurn = async () => { submitted++; return { status: 'running' }; };
  const tree = await mount();
  try {
    await act(async () => latest.send('bot:default', { text: 'Read file', kind: 'attachment', attachment: { name: 'old.txt' } })); await flush();
    assert.equal(signal.aborted, false);
    await act(async () => latest.clearThread('bot:default'));
    assert.equal(signal.aborted, true);
    await act(async () => finishUpload()); await flush();
    assert.equal(submitted, 0);
    assert.deepEqual(latest.messages['bot:default'], []);
    assert.equal(latest.threadById('bot:default').typing, false);
  } finally { await act(async () => tree.unmount()); Object.assign(fake, previous); }
});

test('a stale refresh cannot restore a removed agent or resume a deleted run', async () => {
  pending = [];
  const previous = { messages: fake.messages, activeTurns: fake.activeTurns, deleteBot: fake.deleteBot, readTurn: fake.readTurn };
  let releaseHistory, observed = 0;
  const tree = await mount();
  try {
    fake.activeTurns = async () => [{ bot: 'supervisor', sessionId: 'supervisor-session', requestId: 'old-run', status: 'running' }];
    fake.messages = async bot => bot === 'supervisor' ? new Promise(resolve => { releaseHistory = () => resolve([]); }) : [];
    fake.deleteBot = async () => {};
    fake.readTurn = async () => { observed++; return { status: 'completed', text: 'Deleted reply' }; };
    let refreshing;
    await act(async () => { refreshing = latest.refresh(); }); await flush();
    assert.equal(typeof releaseHistory, 'function');
    await act(async () => latest.removeBot('supervisor'));
    await act(async () => { releaseHistory(); await refreshing; }); await flush();
    assert.equal(latest.botById('supervisor'), undefined);
    assert.equal(latest.threadById('bot:supervisor'), undefined);
    assert.equal(latest.messages['bot:supervisor'], undefined);
    assert.equal(observed, 0);
  } finally { await act(async () => tree.unmount()); Object.assign(fake, previous); }
});

test('an accepted clear releases a pending refresh lock so fresh host state loads immediately', async () => {
  pending = [];
  const previous = { sessions: fake.sessions, messages: fake.messages, deleteSession: fake.deleteSession };
  let releaseOld, cleared = false, freshCompleted = false;
  const tree = await mount();
  let oldRefresh;
  try {
    fake.sessions = async () => cleared ? [] : [{ bot: 'default', id: 's1', lastActive: 1, messageCount: 1 }];
    fake.messages = () => new Promise(resolve => { releaseOld = () => resolve([{ role: 'assistant', content: 'Old snapshot' }]); });
    fake.deleteSession = async () => { cleared = true; };
    await act(async () => { oldRefresh = latest.refresh(); }); await flush();
    assert.equal(typeof releaseOld, 'function');
    await act(async () => latest.clearThread('bot:default'));
    await act(async () => { void latest.refresh().then(() => { freshCompleted = true; }); }); await flush();
    assert.equal(freshCompleted, true, 'the new refresh must not reuse the invalidated pending request');
    await act(async () => { releaseOld(); await oldRefresh; });
    assert.equal(latest.threadById('bot:default').sessionId, undefined);
    assert.deepEqual(latest.messages['bot:default'], []);
  } finally { releaseOld?.(); await oldRefresh; await act(async () => tree.unmount()); Object.assign(fake, previous); }
});

test('clear suppresses a completed reply whose native notification permission check is still pending', async () => {
  pending = []; runStatus = 'completed';
  const previous = { deleteSession: fake.deleteSession };
  const permission = harness.notificationNative.getPermissionsAsync;
  let releasePermission;
  harness.notificationCalls.presented.length = 0;
  harness.notificationNative.getPermissionsAsync = () => new Promise(resolve => {
    releasePermission = () => resolve({ granted: true, ios: { status: 2 } });
  });
  fake.deleteSession = async () => {};
  const tree = await mount();
  try {
    await act(async () => latest.send('bot:default', { text: 'Complete before clear' })); await flush();
    assert.equal(typeof releasePermission, 'function', 'the completed reply reached the native permission boundary');
    await act(async () => latest.clearThread('bot:default'));
    await act(async () => releasePermission()); await flush();
    assert.deepEqual(harness.notificationCalls.presented, []);
    assert.deepEqual(latest.messages['bot:default'], []);
  } finally {
    releasePermission?.(); harness.notificationNative.getPermissionsAsync = permission;
    await act(async () => tree.unmount()); Object.assign(fake, previous);
  }
});

for (const trigger of ['refresh', 'foreground']) test(`a stale ${trigger} authentication error cannot revoke a newer successful sync`, async () => {
  pending = [];
  const previous = { ensureCodexAgent: fake.ensureCodexAgent, deleteSession: fake.deleteSession };
  let rejectOld;
  const tree = await mount();
  let oldRefresh;
  try {
    fake.ensureCodexAgent = () => new Promise((_, reject) => { rejectOld = reject; });
    fake.deleteSession = async () => {};
    if (trigger === 'refresh') {
      await act(async () => { oldRefresh = latest.refresh().catch(() => {}); });
    } else {
      await event('background'); await event('active');
    }
    await flush();
    assert.equal(typeof rejectOld, 'function');
    await act(async () => latest.clearThread('bot:default'));
    fake.ensureCodexAgent = previous.ensureCodexAgent;
    await act(async () => latest.refresh());
    assert.equal(latest.connection.status, 'connected');
    const saved = harness.savedPreferences.get('hermes.bridge');
    assert.ok(saved, 'the phone starts with a saved pairing');
    await act(async () => {
      rejectOld(new api.BridgeError('Old token was rejected', 'unauthorized'));
      await oldRefresh;
    });
    await flush();
    assert.equal(latest.connection.status, 'connected', 'an obsolete failure must not disconnect the current host');
    assert.equal(latest.connection.error, undefined);
    assert.equal(harness.savedPreferences.get('hermes.bridge'), saved, 'the current pairing must remain saved');
  } finally {
    rejectOld?.(new Error('Test complete')); await oldRefresh;
    await act(async () => tree.unmount()); Object.assign(fake, previous);
  }
});

test('a current authentication rejection still disconnects and removes the revoked pairing', async () => {
  pending = [];
  const previous = fake.ensureCodexAgent;
  const tree = await mount();
  try {
    fake.ensureCodexAgent = async () => { throw new api.BridgeError('Current token was rejected', 'unauthorized'); };
    await act(async () => {
      await assert.rejects(() => latest.refresh(), error => error.code === 'unauthorized');
    });
    assert.equal(latest.connection.status, 'error');
    assert.equal(harness.savedPreferences.has('hermes.bridge'), false);
  } finally { fake.ensureCodexAgent = previous; await act(async () => tree.unmount()); }
});
