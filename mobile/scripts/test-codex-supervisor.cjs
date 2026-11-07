const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const harness = require('./helpers/native-screen-harness.cjs');
const { CodexSupervisorScreen } = require('../src/screens/CodexSupervisorScreen.tsx');
const { PrimaryButton } = require('../src/components/UI.tsx');
const { t } = require('../src/i18n');
const trees = new Set();
const textOf = tree => JSON.stringify(tree.toJSON());
let calls;
function fixture(overrides = {}) {
  calls = [];
  harness.setStore({ connection: { status: 'connected', url: 'http://bridge' }, bots: [
    { id: 'default', name: 'Other agent' },
    { id: 'codex-supervisor', name: 'Codex reviewer', capabilities: ['codex-supervisor'] },
  ], modelPicks: {},
    loadCodexStatus: async () => ({ enabled: false, state: 'stopped', events: [] }),
    loadCodexChats: async () => [{ id: 'chat', title: 'Existing Codex task', status: { type: 'active' } }],
    startCodexWatch: async spec => { calls.push(spec); return { enabled: true, state: 'watching', spec }; },
    pauseCodexWatch: async () => { calls.push('pause'); return { enabled: false, state: 'paused' }; },
    ...overrides });
}
async function mount() {
  let tree;
  await act(async () => { tree = create(React.createElement(CodexSupervisorScreen), { createNodeMock: harness.createNodeMock }); });
  trees.add(tree); return tree;
}
afterEach(async () => { await act(async () => { for (const tree of trees) tree.unmount(); }); trees.clear(); });

test('native supervisor starts the selected active chat once and pauses without extra confirmation', async () => {
  fixture(); const tree = await mount();
  assert.ok(textOf(tree).includes('Existing Codex task'));
  const choice = tree.root.findAllByType('Pressable').find(node => textOf({ toJSON: () => node.findAllByType('Text').map(n => n.props.children) }).includes('Existing Codex task'));
  await act(async () => { choice.props.onPress(); });
  await act(async () => { tree.root.findByType('TextInput').props.onChangeText('Finish the fix and run tests'); });
  const start = tree.root.findAllByType(PrimaryButton).find(node => node.props.label === t('开始监督'));
  assert.equal(start.props.disabled, false);
  await act(async () => { await start.props.onPress(); });
  assert.equal(calls.length, 1); assert.equal(calls[0].threadId, 'chat'); assert.equal(calls[0].profile, 'codex-supervisor');
  assert.ok(!textOf(tree).includes('Other agent'), 'the supervisor does not ask for another agent');
  assert.equal(calls[0].goal, 'Finish the fix and run tests'); assert.equal(calls[0].reviewEnabled, true);
  const pause = tree.root.findAllByType(PrimaryButton).find(node => node.props.label === t('暂停监督'));
  await act(async () => { await pause.props.onPress(); });
  assert.equal(calls[1], 'pause'); assert.ok(textOf(tree).includes(t('已暂停')));
});

test('offline and failed companion connections show usable recovery without throwing', async () => {
  fixture({ connection: { status: 'offline', url: '' } });
  const offline = await mount(); assert.ok(textOf(offline).includes(t('连接服务器')));
  fixture({ loadCodexStatus: async () => { throw new Error('Companion is offline'); } });
  const failed = await mount(); assert.ok(textOf(failed).includes('Companion is offline'));
});

test('an existing watch restores its goal and model selection from the host', async () => {
  fixture({ loadCodexStatus: async () => ({ enabled: true, state: 'backoff', attempts: 7,
    spec: { threadId: 'chat', goal: 'Keep working', profile: 'codex-supervisor', reviewEnabled: true, model: 'chosen', provider: 'provider' },
    outbox: { status: 'planned', dueAt: Date.now() + 10000 }, review: { status: 'ready', analysis: 'Tests still fail', recommendation: 'Fix the failing assertion' } }) });
  const tree = await mount(); assert.equal(tree.root.findByType('TextInput').props.value, 'Keep working');
  for (const value of ['chosen', 'Tests still fail', 'Fix the failing assertion', t('等待自动重试')]) assert.ok(textOf(tree).includes(value), value);
});

test('a chat-list failure preserves the active watch and its pause control', async () => {
  fixture({ loadCodexStatus: async () => ({ enabled: true, state: 'watching',
    spec: { threadId: 'chat', goal: 'Keep working', profile: 'codex-supervisor', reviewEnabled: true } }),
    loadCodexChats: async () => { throw new Error('Desktop connection unavailable'); } });
  const tree = await mount();
  assert.ok(textOf(tree).includes('Desktop connection unavailable'));
  assert.equal(tree.root.findByType('TextInput').props.value, 'Keep working');
  assert.ok(tree.root.findAllByType(PrimaryButton).some(n => n.props.label === t('暂停监督')));
  assert.ok(!textOf(tree).includes(t('未读取到 Codex 会话，请启动电脑上的连接服务并刷新。')));
});

test('missing supervisor never silently uses the primary agent', async () => {
  fixture({ bots: [{ id: 'default', name: 'Other agent' }] });
  const tree = await mount();
  const start = tree.root.findAllByType(PrimaryButton).find(n => n.props.label === t('开始监督'));
  assert.equal(start.props.disabled, true);
  assert.ok(!textOf(tree).includes('Other agent'));
});

test('rapid start presses and unchanged saved settings cannot submit duplicate watches', async () => {
  let accept;
  let host = { enabled: false, state: 'stopped', events: [] };
  fixture({ loadCodexStatus: async () => host,
    startCodexWatch: spec => { calls.push(spec); return new Promise(resolve => { accept = () => { host = { ...host, enabled: true, state: 'watching', spec }; resolve(host); }; }); } });
  const tree = await mount();
  const choice = tree.root.findAllByType('Pressable').find(node => node.props.accessibilityRole === 'radio' && node.findAllByType('Text').some(text => text.props.children === 'Existing Codex task'));
  await act(async () => { choice.props.onPress(); tree.root.findByType('TextInput').props.onChangeText('Finish and check'); });
  const start = tree.root.findAllByType(PrimaryButton).find(node => node.props.label === t('开始监督'));
  await act(async () => { start.props.onPress(); start.props.onPress(); });
  assert.equal(calls.length, 1);
  await act(async () => { accept(); });
  const saved = tree.root.findAllByType(PrimaryButton).find(node => node.props.label === t('保存监督设置'));
  assert.equal(saved.props.disabled, true);
  await act(async () => { saved.props.onPress(); });
  assert.equal(calls.length, 1);
  await act(async () => { tree.root.findByType('TextInput').props.onChangeText('Finish and run the integration checks'); });
  assert.equal(tree.root.findAllByType(PrimaryButton).find(node => node.props.label === t('保存监督设置')).props.disabled, false);
});

test('chat polling recovers after the first failure without discarding the edited watch', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  let reads = 0;
  fixture({
    loadCodexStatus: async () => ({ enabled: false, state: 'paused',
      spec: { threadId: 'chat', goal: 'Original goal', profile: 'codex-supervisor', reviewEnabled: true } }),
    loadCodexChats: async () => {
      if (++reads === 1) throw new Error('Temporary tunnel failure');
      return [{ id: 'chat', title: 'Recovered Codex task' }];
    },
  });
  const tree = await mount();
  assert.ok(textOf(tree).includes('Temporary tunnel failure'));
  await act(async () => { tree.root.findByType('TextInput').props.onChangeText('Keep my edited goal'); });
  await act(async () => { context.mock.timers.tick(10000); });
  assert.equal(reads, 2);
  assert.ok(textOf(tree).includes('Recovered Codex task'));
  assert.ok(!textOf(tree).includes('Temporary tunnel failure'));
  assert.equal(tree.root.findByType('TextInput').props.value, 'Keep my edited goal');
  const choice = tree.root.findAllByType('Pressable').find(node => node.props.accessibilityRole === 'radio');
  assert.equal(choice.props.accessibilityState.selected, true);
  assert.deepEqual(calls, [], 'recovering the list must not start supervision');
});

test('a slow status request does not block the chat list or its later refresh', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  let finishStatus;
  let reads = 0;
  fixture({
    loadCodexStatus: () => new Promise(resolve => { finishStatus = resolve; }),
    loadCodexChats: async () => [{ id: 'chat', title: `Codex task ${++reads}` }],
  });
  const tree = await mount();
  assert.ok(textOf(tree).includes('Codex task 1'));
  await act(async () => { context.mock.timers.tick(10000); });
  assert.ok(textOf(tree).includes('Codex task 2'));
  await act(async () => { finishStatus({ enabled: false, state: 'stopped' }); });
  assert.deepEqual(calls, []);
});

test('a slow chat read does not block status polling or the pause control', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  let finishChats;
  let statusReads = 0, chatReads = 0;
  fixture({
    loadCodexStatus: async () => ({ enabled: true, state: 'watching', attempts: ++statusReads }),
    loadCodexChats: () => { chatReads++; return new Promise(resolve => { finishChats = resolve; }); },
  });
  const tree = await mount();
  await act(async () => { context.mock.timers.tick(10000); });
  assert.equal(statusReads, 2);
  assert.equal(chatReads, 1, 'polls must not duplicate a pending list request');
  const pause = tree.root.findAllByType(PrimaryButton).find(node => node.props.label === t('暂停监督'));
  await act(async () => { await pause.props.onPress(); });
  assert.deepEqual(calls, ['pause']);
  await act(async () => { finishChats([{ id: 'stale', title: 'Old pending chat' }]); });
  assert.ok(!textOf(tree).includes('Old pending chat'), 'a read started before the action must not replace the new state');
});

test('switching servers loads immediately and ignores replies from the old connection', async () => {
  let finishOldStatus, finishOldChats;
  fixture({
    loadCodexStatus: () => new Promise(resolve => { finishOldStatus = resolve; }),
    loadCodexChats: () => new Promise(resolve => { finishOldChats = resolve; }),
  });
  const tree = await mount();
  fixture({ connection: { status: 'connected', url: 'http://new-bridge' },
    loadCodexChats: async () => [{ id: 'new', title: 'New server task' }],
  });
  await act(async () => { tree.update(React.createElement(CodexSupervisorScreen)); });
  assert.ok(textOf(tree).includes('New server task'));
  await act(async () => {
    finishOldStatus({ enabled: true, state: 'watching', spec: {
      threadId: 'old', goal: 'Old server goal', profile: 'codex-supervisor', reviewEnabled: true,
    } });
    finishOldChats([{ id: 'old', title: 'Old server task' }]);
  });
  assert.ok(textOf(tree).includes('New server task'));
  assert.ok(!textOf(tree).includes('Old server task'));
  assert.equal(tree.root.findByType('TextInput').props.value, '');
});

test('a late saved status cannot overwrite a chat and goal the user already edited', async () => {
  let finishStatus;
  fixture({ loadCodexStatus: () => new Promise(resolve => { finishStatus = resolve; }) });
  const tree = await mount();
  await act(async () => {
    tree.root.findAllByType('Pressable').find(node => node.props.accessibilityRole === 'radio').props.onPress();
    tree.root.findByType('TextInput').props.onChangeText('New goal');
  });
  await act(async () => { finishStatus({ enabled: false, state: 'paused', spec: {
    threadId: 'old', goal: 'Saved old goal', profile: 'codex-supervisor', reviewEnabled: false,
  } }); });
  assert.equal(tree.root.findByType('TextInput').props.value, 'New goal');
  assert.equal(tree.root.findAllByType('Pressable').find(node => node.props.accessibilityRole === 'radio').props.accessibilityState.selected, true);
  assert.deepEqual(calls, []);
});

test('polling pauses offscreen and in background, and refreshes on return', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  let reads = 0;
  fixture({ loadCodexChats: async () => { reads++; return []; } });
  const tree = await mount();
  assert.equal(reads, 1);
  await act(async () => {
    harness.setFocused(false); tree.update(React.createElement(CodexSupervisorScreen));
  });
  await act(async () => { context.mock.timers.tick(20000); });
  assert.equal(reads, 1);
  await act(async () => {
    harness.setFocused(true); tree.update(React.createElement(CodexSupervisorScreen));
  });
  assert.equal(reads, 2);
  await act(async () => { harness.appStateEvents.emit('change', 'background'); });
  await act(async () => { context.mock.timers.tick(20000); });
  assert.equal(reads, 2);
  await act(async () => { harness.appStateEvents.emit('change', 'active'); });
  assert.equal(reads, 3);
  assert.deepEqual(calls, []);
});
