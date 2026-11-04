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
  harness.setStore({ connection: { status: 'connected', url: 'http://bridge' }, bots: [{ id: 'default', name: 'Reviewer' }], modelPicks: {},
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
  assert.equal(calls.length, 1); assert.equal(calls[0].threadId, 'chat'); assert.equal(calls[0].profile, 'default');
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
    spec: { threadId: 'chat', goal: 'Keep working', profile: 'default', reviewEnabled: true, model: 'chosen', provider: 'provider' },
    outbox: { status: 'planned', dueAt: Date.now() + 10000 }, review: { status: 'ready', analysis: 'Tests still fail', recommendation: 'Fix the failing assertion' } }) });
  const tree = await mount(); assert.equal(tree.root.findByType('TextInput').props.value, 'Keep working');
  for (const value of ['chosen', 'Tests still fail', 'Fix the failing assertion', t('等待自动重试')]) assert.ok(textOf(tree).includes(value), value);
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
