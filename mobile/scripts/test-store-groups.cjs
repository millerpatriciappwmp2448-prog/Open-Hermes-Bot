const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const Module = require('node:module');
const harness = require('./helpers/native-screen-harness.cjs');
const api = require('../src/api.ts');
let latest, groups, history, runs, calls, rejectChange, rejectHistory, rejectDiscovery, responded, historyGate;
const clone = value => structuredClone(value);
const members = [{ bot: 'a', name: 'Alpha', sessionId: 'ga' }, { bot: 'b', name: 'Beta', sessionId: 'gb' }];
const fake = {
  baseUrl: 'https://groups.invalid', token: 'test',
  ensureCodexAgent: async () => ({}),
  bots: async () => members.map((m, i) => ({ id: m.bot, profile: m.bot, name: m.name, primary: i === 0 })),
  sessions: async () => [
    { bot: 'a', id: 'private', title: 'Private', lastActive: 1, messageCount: 1 },
    { bot: 'a', id: 'ga', title: 'Group · Work · Alpha', lastActive: 100, messageCount: 3 },
  ],
  prefs: async () => ({ picks: { a: { model: 'model-a', provider: 'one' }, b: { model: 'model-b', provider: 'two' } } }),
  models: async () => ({ current: 'host-default', providers: [] }),
  messages: async (bot, session) => { calls.push(['private-history', session]); return []; },
  health: async () => ({ ok: true }), devices: async () => [],
  activeTurns: async () => [{ bot: 'a', sessionId: 'ga', requestId: 'group-internal', status: 'running' }],
  readTurn: async () => { throw Error('A group member must never resume as a private reply'); },
  groups: async () => { if (rejectDiscovery) throw Error('Group discovery offline'); return clone(groups); },
  groupMessages: async id => { if (rejectHistory) throw Error('Group history offline'); const rows = clone(history[id] || []); await historyGate; return rows; },
  activeGroupRounds: async () => clone(runs),
  createGroup: async input => {
    calls.push(['create', clone(input)]);
    if (rejectChange) throw Error('Group unavailable');
    const g = { id: 'g-new', name: input.name, members: members.filter(m => input.members.includes(m.bot)), lastActive: 100 };
    groups.push(g); history[g.id] = []; return clone(g);
  },
  updateGroup: async (id, input) => {
    if (rejectChange) throw Error('Group busy');
    const g = groups.find(g => g.id === id);
    const next = { ...g, id: input.name ? 'g-renamed' : id, name: input.name || g.name,
      members: input.members ? g.members.filter(m => input.members.includes(m.bot)) : g.members };
    groups = groups.map(g => g.id === id ? next : g); history[next.id] = history[id]; return clone(next);
  },
  deleteGroup: async id => { if (rejectChange) throw Error('Group busy'); groups = groups.filter(g => g.id !== id); },
  startGroupRound: async (id, requestId, message) => {
    calls.push(['start', id, requestId, message]);
    runs = [{ groupId: id, requestId, status: 'running' }];
    history[id] = [...(history[id] || []), { id: requestId, from: 'user', text: message }];
    return { ...runs[0], messages: clone(history[id]), failures: [] };
  },
  readGroupRound: async (id, requestId) => {
    calls.push(['read', id, requestId]);
    return { groupId: id, requestId, status: runs[0]?.status || 'completed', messages: clone(history[id]), responded: clone(responded), failures: [] };
  },
  stopGroupRound: async (id, requestId) => { calls.push(['stop', id, requestId]); runs = []; return { groupId: id, requestId, status: 'cancelled', messages: [] }; },
  uploadAttachment: async () => ({ path: '/host/file.txt' }),
};
const original = Module._load;
Module._load = function(request, parent, main) {
  if (request === './api' && parent?.filename.endsWith('store.tsx')) return { ...api, createBridgeClient: () => ({ ...fake }),
    bridgeHealth: fake.health, bridgePair: async () => ({ token: fake.token, device: { name: 'test' } }) };
  return original.call(this, request, parent, main);
};
const { StoreProvider, useStore } = require('../src/store.tsx');
function Probe() { latest = useStore(); return null; }
async function flush() { await act(async () => { await new Promise(setImmediate); }); }
async function mount() {
  harness.savedPreferences.set('hermes.bridge', JSON.stringify({ url: fake.baseUrl, token: fake.token, device: 'test' }));
  let tree; await act(async () => { tree = create(React.createElement(StoreProvider, null, React.createElement(Probe))); });
  await flush(); return tree;
}
function reset() {
  groups = [{ id: 'g-work', name: 'Work', members: clone(members), lastActive: 100 }];
  history = { 'g-work': [{ id: 'old', from: 'b', text: 'Existing group reply' }] };
  runs = []; calls = []; rejectChange = false; rejectHistory = false; rejectDiscovery = false; responded = []; historyGate = undefined;
  harness.notificationCalls.presented.length = 0;
}
async function appState(value) {
  await act(async () => { harness.native.AppState.currentState = value; harness.appStateEvents.emit('change', value); }); await flush();
}

test('host groups and transcripts restore without becoming a private session', async () => {
  reset(); const tree = await mount();
  try {
    assert.equal(latest.connection.status, 'connected');
    assert.equal(latest.threadById('bot:a').sessionId, 'private');
    assert.ok(!calls.some(c => c[0] === 'private-history' && c[1] === 'ga'));
    assert.equal(latest.threadById('g-work').groupId, 'g-work');
    assert.deepEqual(latest.threadById('g-work').members, ['a', 'b']);
    assert.equal(latest.messages['g-work'][0].text, 'Existing group reply');
  } finally { await act(async () => tree.unmount()); }
});

test('group completion notifies only current-round speakers and respects agent mute', async () => {
  reset(); const tree = await mount();
  try {
    await act(async () => latest.send('g-work', { text: 'Only Alpha replies this round' })); await flush();
    await appState('background');
    responded = ['a']; runs[0].status = 'completed';
    history['g-work'].push({ id: 'new-a', from: 'a', text: 'Fresh answer' });
    await appState('active');
    assert.deepEqual(harness.notificationCalls.presented.map(n => n.content.data.botId), ['a']);
    assert.equal(harness.notificationCalls.presented[0].content.data.threadId, 'g-work');
  } finally { await act(async () => tree.unmount()); }
});

test('accepted group creation and rename remain successful when history is temporarily unavailable', async () => {
  reset(); const tree = await mount();
  try {
    rejectHistory = true;
    let created, renamed;
    await act(async () => { created = await latest.addGroup({ name: 'New', members: ['a', 'b'], model: '' }); });
    assert.equal(created, 'g-new'); assert.ok(latest.threadById(created));
    await act(async () => { renamed = await latest.updateGroup('g-work', { name: 'Renamed' }); });
    assert.equal(renamed, 'g-renamed'); assert.equal(latest.threadById('g-work'), undefined);
    assert.equal(latest.messages[renamed][0].text, 'Existing group reply');
    assert.equal(calls.filter(c => c[0] === 'create').length, 1);
    rejectHistory = false;
    await act(async () => latest.refresh());
    assert.ok(latest.threadById(renamed));
  } finally { await act(async () => tree.unmount()); }
});

test('a temporary discovery failure preserves same-host groups but never copies them to a different host', async () => {
  reset(); const tree = await mount();
  const originalUrl = fake.baseUrl;
  try {
    rejectDiscovery = true;
    await act(async () => latest.refresh());
    assert.ok(latest.threadById('g-work'));
    fake.baseUrl = 'https://different-host.invalid';
    await act(async () => latest.connect(fake.baseUrl, 'TEST-CODE')); await flush();
    assert.equal(latest.threadById('g-work'), undefined);
    assert.equal(latest.messages['g-work'], undefined);
  } finally { fake.baseUrl = originalUrl; await act(async () => tree.unmount()); }
});

test('group send survives navigation and background without restarting, with member replies intact', async () => {
  reset(); const tree = await mount();
  try {
    await act(async () => { latest.send('g-work', { text: 'Discuss this' }); }); await flush();
    assert.equal(calls.filter(c => c[0] === 'start').length, 1);
    assert.equal(latest.threadById('g-work').typing, true);
    await act(async () => latest.setViewingThread('bot:a'));
    await appState('background');
    history['g-work'].push({ id: 'answer-a', from: 'a', text: 'Alpha answer' }, { id: 'answer-b', from: 'b', text: 'Beta answer' });
    runs[0].status = 'completed';
    await appState('active');
    assert.equal(calls.filter(c => c[0] === 'start').length, 1);
    assert.equal(calls.filter(c => c[0] === 'stop').length, 0);
    assert.equal(latest.threadById('g-work').typing, false);
    assert.deepEqual(latest.messages['g-work'].slice(-2).map(m => m.from), ['a', 'b']);
  } finally { await act(async () => tree.unmount()); }
});

test('active group round resumes read-only after store restart and stop keeps its transcript', async () => {
  reset(); runs = [{ groupId: 'g-work', requestId: 'existing', status: 'running' }];
  const tree = await mount();
  try {
    assert.equal(latest.threadById('g-work').typing, true);
    assert.equal(calls.filter(c => c[0] === 'start').length, 0);
    await act(async () => latest.stop('g-work')); await flush();
    assert.equal(calls.filter(c => c[0] === 'stop').length, 1);
    assert.equal(latest.threadById('g-work').typing, false);
    assert.equal(latest.messages['g-work'][0].text, 'Existing group reply');
  } finally { await act(async () => tree.unmount()); }
});

test('group stop preserves live state and retries when the host has not confirmed cancellation', async () => {
  reset(); runs = [{ groupId: 'g-work', requestId: 'existing', status: 'running' }];
  const stop = fake.stopGroupRound;
  let attempts = 0;
  fake.stopGroupRound = async (...args) => {
    if (++attempts === 1) throw new api.BridgeError('Lost stop response', 'unreachable');
    return stop(...args);
  };
  const tree = await mount();
  try {
    await act(async () => latest.stop('g-work')); await flush();
    assert.equal(latest.threadById('g-work').typing, true, 'unconfirmed stop must not enable another round');
    assert.equal(latest.messages['g-work'][0].text, 'Existing group reply');
    await appState('background'); await appState('active');
    assert.equal(attempts, 2);
    assert.equal(latest.threadById('g-work').typing, false);
    assert.equal(latest.messages['g-work'][0].text, 'Existing group reply');
    assert.deepEqual(harness.notificationCalls.presented, []);
  } finally { fake.stopGroupRound = stop; await act(async () => tree.unmount()); }
});

test('group CRUD waits for host acceptance, preserves failed edits and migrates renamed IDs', async () => {
  reset(); const tree = await mount();
  try {
    rejectChange = true;
    await assert.rejects(async () => { await act(async () => latest.addGroup({ name: 'New', members: ['a', 'b'], model: '' })); }, /unavailable/);
    assert.equal(latest.threads.filter(t => t.kind === 'group').length, 1);
    await assert.rejects(() => latest.updateGroup('g-work', { name: 'Renamed' }), /busy/);
    await assert.rejects(() => latest.leaveGroup('g-work'), /busy/);
    assert.ok(latest.threadById('g-work'));
    rejectChange = false;
    let id; await act(async () => { id = await latest.updateGroup('g-work', { name: 'Renamed' }); });
    assert.equal(id, 'g-renamed'); assert.equal(latest.threadById('g-work'), undefined);
    assert.equal(latest.messages[id][0].text, 'Existing group reply');
    await act(async () => { await latest.leaveGroup(id); });
    assert.equal(latest.threadById(id), undefined);
    await act(async () => { id = await latest.addGroup({ name: 'New', members: ['a', 'b'], model: 'ignored' }); });
    assert.equal(id, 'g-new'); assert.equal(latest.threadById(id).groupId, id);
    assert.deepEqual(calls.find(c => c[0] === 'create')[1], { name: 'New', members: ['a', 'b'] });
    await act(async () => latest.send(id, { text: 'Read file', kind: 'attachment', attachment: { name: 'file.txt' } })); await flush();
    assert.ok(calls.find(c => c[0] === 'start')[3].includes('Attached: /host/file.txt'));
  } finally { await act(async () => tree.unmount()); }
});

test('accepted group deletion ignores a late round snapshot without orphan messages or notifications', async () => {
  reset();
  const start = fake.startGroupRound;
  let finishOld;
  fake.startGroupRound = (groupId, requestId) => new Promise(resolve => { finishOld = () => resolve({
    groupId, requestId, status: 'completed', responded: ['a'], messages: [{ id: 'late', from: 'a', text: 'Deleted group reply' }],
  }); });
  const tree = await mount();
  try {
    await act(async () => latest.send('g-work', { text: 'Old group question' })); await flush();
    await act(async () => latest.leaveGroup('g-work'));
    await act(async () => finishOld()); await flush();
    assert.equal(latest.threadById('g-work'), undefined);
    assert.equal(latest.messages['g-work'], undefined);
    assert.deepEqual(harness.notificationCalls.presented, []);
  } finally { fake.startGroupRound = start; await act(async () => tree.unmount()); }
});

test('rejected group deletion keeps the round observer and accepts its final answer', async () => {
  reset();
  const start = fake.startGroupRound;
  let finishOld;
  fake.startGroupRound = (groupId, requestId) => new Promise(resolve => { finishOld = () => resolve({
    groupId, requestId, status: 'completed', responded: [], messages: [{ id: 'kept', from: 'a', text: 'Kept group reply' }],
  }); });
  const tree = await mount();
  try {
    await act(async () => latest.send('g-work', { text: 'Keep this' })); await flush();
    rejectChange = true;
    await assert.rejects(() => latest.leaveGroup('g-work'), /busy/);
    await act(async () => finishOld()); await flush();
    assert.equal(latest.messages['g-work'][0].text, 'Kept group reply');
    assert.equal(latest.threadById('g-work').typing, false);
  } finally { fake.startGroupRound = start; await act(async () => tree.unmount()); }
});

test('renaming a group detaches the old observer and ignores its late completion', async () => {
  reset();
  const start = fake.startGroupRound;
  let finishOld;
  fake.startGroupRound = (groupId, requestId) => new Promise(resolve => { finishOld = () => resolve({
    groupId, requestId, status: 'completed', responded: ['a'], messages: [{ id: 'late', from: 'a', text: 'Stale group snapshot' }],
  }); });
  const tree = await mount();
  try {
    await act(async () => latest.send('g-work', { text: 'Rename after the host finishes' })); await flush();
    let renamed;
    await act(async () => { renamed = await latest.updateGroup('g-work', { name: 'Renamed' }); });
    await act(async () => finishOld()); await flush();
    assert.equal(renamed, 'g-renamed');
    assert.equal(latest.threadById('g-work'), undefined);
    assert.equal(latest.messages['g-work'], undefined);
    assert.ok(latest.threadById(renamed));
    assert.ok(!latest.messages[renamed].some(row => row.text === 'Stale group snapshot'));
    assert.deepEqual(harness.notificationCalls.presented, []);
  } finally { fake.startGroupRound = start; await act(async () => tree.unmount()); }
});

test('a refresh begun before group deletion cannot restore the removed group', async () => {
  reset(); const tree = await mount();
  let releaseHistory;
  try {
    historyGate = new Promise(resolve => { releaseHistory = resolve; });
    let refreshing;
    await act(async () => { refreshing = latest.refresh(); }); await flush();
    await act(async () => latest.leaveGroup('g-work'));
    await act(async () => { releaseHistory(); await refreshing; }); await flush();
    assert.equal(latest.threadById('g-work'), undefined);
    assert.equal(latest.messages['g-work'], undefined);
  } finally { releaseHistory?.(); historyGate = undefined; await act(async () => tree.unmount()); }
});

test('accepted rename retires old observers before history returns and deletion wins over late history', async () => {
  reset();
  const start = fake.startGroupRound;
  let finishOld, releaseHistory, renaming;
  fake.startGroupRound = (groupId, requestId) => new Promise(resolve => { finishOld = () => resolve({
    groupId, requestId, status: 'completed', responded: ['a'], messages: [{ id: 'late', from: 'a', text: 'Obsolete round' }],
  }); });
  const tree = await mount();
  try {
    await act(async () => latest.send('g-work', { text: 'Rename after host acceptance' })); await flush();
    historyGate = new Promise(resolve => { releaseHistory = resolve; });
    await act(async () => { renaming = latest.updateGroup('g-work', { name: 'Renamed' }); }); await flush();
    assert.equal(latest.threadById('g-work'), undefined, 'accepted rename is visible before its history read completes');
    assert.ok(latest.threadById('g-renamed'));
    await act(async () => finishOld()); await flush();
    assert.equal(latest.messages['g-work'], undefined);
    assert.deepEqual(harness.notificationCalls.presented, []);
    await act(async () => latest.leaveGroup('g-renamed'));
    await act(async () => { releaseHistory(); await renaming; });
    assert.equal(latest.threadById('g-renamed'), undefined);
    assert.equal(latest.messages['g-renamed'], undefined, 'late rename history cannot undo accepted deletion');
    assert.equal(calls.filter(call => call[0] === 'stop').length, 0, 'retiring an accepted mutation must not stop a deleted host session');
  } finally {
    releaseHistory?.(); await renaming; historyGate = undefined; fake.startGroupRound = start;
    await act(async () => tree.unmount());
  }
});

test('accepted creation invalidates a refresh captured before the new group existed', async () => {
  reset(); const tree = await mount();
  let releaseHistory, refreshing;
  try {
    historyGate = new Promise(resolve => { releaseHistory = resolve; });
    await act(async () => { refreshing = latest.refresh(); }); await flush();
    historyGate = undefined;
    let created;
    await act(async () => { created = await latest.addGroup({ name: 'New', members: ['a', 'b'], model: '' }); });
    assert.equal(created, 'g-new');
    await act(async () => { releaseHistory(); await refreshing; });
    assert.ok(latest.threadById(created), 'the old refresh cannot erase an accepted creation');
    assert.deepEqual(latest.messages[created], []);
  } finally { releaseHistory?.(); await refreshing; historyGate = undefined; await act(async () => tree.unmount()); }
});
