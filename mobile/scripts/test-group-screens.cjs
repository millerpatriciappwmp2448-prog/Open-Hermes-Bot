const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const harness = require('./helpers/native-screen-harness.cjs');
const { NewAgentSheet } = require('../src/screens/NewAgentSheet.tsx');
const { GroupDetailsSheet } = require('../src/screens/GroupDetailsSheet.tsx');
const { ChatModelScreen } = require('../src/screens/ChatModelScreen.tsx');
const { ChatScreen } = require('../src/screens/ChatScreen.tsx');
const { ServerModelPicker } = require('../src/components/ServerModelPicker.tsx');
const { ConfirmBlock } = require('../src/components/UI.tsx');
const { t } = require('../src/i18n');
const bots = [{ id: 'a', name: 'Alpha', shape: 'cercle', color: '#8b5cf6' }, { id: 'b', name: 'Beta', shape: 'capsule', color: '#4f9d8f' }];
const thread = { id: 'g-work', groupId: 'g-work', kind: 'group', name: 'Work', members: ['a', 'b'], memberSessions: { a: 'ga', b: 'gb' } };
const button = (tree, label) => tree.root.findAllByType('Pressable').find(n =>
  n.props.accessibilityLabel === label || n.findAllByType('Text').some(text => text.props.children === label));
function store(extra = {}) { harness.setStore({ bots, prefs: {}, connection: { status: 'connected' }, modelOptions: {}, modelPicks: {},
  botById: id => bots.find(bot => bot.id === id), threadById: () => thread, refreshModels: async () => {}, ...extra }); }
async function mount(Component, props) { let tree; await act(async () => { tree = create(React.createElement(Component, props), { createNodeMock: harness.createNodeMock }); }); return tree; }

test('group creation uses actual agents and waits for acceptance before closing', async () => {
  let accept, closed = 0, navigated, calls = 0;
  store({ addGroup: input => { calls++; assert.deepEqual(input.members, ['a', 'b']); return new Promise(resolve => { accept = resolve; }); } });
  const tree = await mount(NewAgentSheet, { visible: true, onClose: () => closed++, onCreated: id => { navigated = id; } });
  try {
    await act(async () => button(tree, t('群组')).props.onPress());
    await act(async () => { button(tree, t('创建群组')).props.onPress(); button(tree, t('创建群组')).props.onPress(); });
    assert.equal(calls, 1); assert.equal(closed, 0);
    await act(async () => accept('host-group'));
    assert.equal(closed, 1); assert.equal(navigated, 'host-group');
  } finally { await act(async () => tree.unmount()); }
});

test('a failed member removal stays visible and keeps the group sheet open', async () => {
  let closed = 0, attempts = 0;
  store({ updateGroup: async () => { attempts++; throw Error('Member is busy'); } });
  const tree = await mount(GroupDetailsSheet, { visible: true, threadId: thread.id, onClose: () => closed++, onLeave() {}, onModel() {} });
  try {
    await act(async () => button(tree, 'Beta').props.onPress());
    await act(async () => tree.root.findByType(ConfirmBlock).props.onConfirm());
    assert.equal(attempts, 1); assert.equal(closed, 0);
    assert.ok(JSON.stringify(tree.toJSON()).includes('Member is busy'));
  } finally { await act(async () => tree.unmount()); }
});

test('real group models pick a member then reuse the existing server picker', async () => {
  store({ modelPicks: { a: { model: 'model-a' }, b: { model: 'model-b' } } });
  const tree = await mount(ChatModelScreen, { route: { params: { threadId: thread.id } }, navigation: { goBack() {} } });
  try {
    assert.ok(JSON.stringify(tree.toJSON()).includes('model-b'));
    await act(async () => button(tree, 'Beta').props.onPress());
    assert.equal(tree.root.findByType(ServerModelPicker).props.botId, 'b');
  } finally { await act(async () => tree.unmount()); }
});

test('group rename waits for the host and hands the new group ID back to the chat route', async () => {
  let accept, updated, calls = 0;
  store({ updateGroup: (id, patch) => {
    calls++; assert.equal(id, thread.id); assert.deepEqual(patch, { name: 'Release team' });
    return new Promise(resolve => { accept = resolve; });
  } });
  const tree = await mount(GroupDetailsSheet, { visible: true, threadId: thread.id, onClose() {}, onLeave() {}, onModel() {}, onUpdated: id => { updated = id; } });
  try {
    await act(async () => button(tree, t('群组名称')).props.onPress());
    await act(async () => tree.root.findByType('TextInput').props.onChangeText('Release team'));
    await act(async () => { button(tree, t('保存更改')).props.onPress(); button(tree, t('保存更改')).props.onPress(); });
    assert.equal(calls, 1); assert.equal(updated, undefined);
    await act(async () => accept('g-renamed'));
    assert.equal(updated, 'g-renamed');
  } finally { await act(async () => tree.unmount()); }
});

test('group membership editor preserves selected agents after rejection and saves the accepted roster', async () => {
  const gamma = { id: 'c', name: 'Gamma', shape: 'cercle', color: '#ff9900' };
  let reject = true, received;
  store({ bots: [...bots, gamma], updateGroup: async (id, patch) => {
    received = patch; if (reject) throw Error('Host refused roster'); return id;
  } });
  const tree = await mount(GroupDetailsSheet, { visible: true, threadId: thread.id, onClose() {}, onLeave() {}, onModel() {} });
  try {
    await act(async () => button(tree, t('添加成员')).props.onPress());
    const choice = () => tree.root.findAllByType('Pressable').find(n => n.props.accessibilityRole === 'checkbox' && n.props.accessibilityLabel === 'Gamma');
    await act(async () => choice().props.onPress());
    await act(async () => button(tree, t('保存更改')).props.onPress());
    assert.deepEqual(received, { members: ['a', 'b', 'c'] });
    assert.equal(choice().props.accessibilityState.checked, true);
    assert.ok(JSON.stringify(tree.toJSON()).includes('Host refused roster'));
    reject = false;
    await act(async () => button(tree, t('保存更改')).props.onPress());
    assert.equal(tree.root.findAllByType('Pressable').filter(n => n.props.accessibilityRole === 'checkbox').length, 0);
  } finally { await act(async () => tree.unmount()); }
});

test('group protocol notices are localized neutral rows without avatar or message actions', async () => {
  store({ messages: { [thread.id]: [{ id: 'notice', from: 'b', text: 'Beta stayed silent.', notice: true, noticeKind: 'silent' }] },
    chatPreferences: {}, setViewingThread() {}, markRead() {}, loadTodos: async () => {} });
  const tree = await mount(ChatScreen, { route: { params: { threadId: thread.id } }, navigation: { goBack() {}, navigate() {}, setParams() {} } });
  try {
    const row = tree.root.findByProps({ testID: 'group-notice' });
    assert.equal(row.findAllByType('Pressable').length, 0);
    assert.ok(row.findAllByType('Text').some(text => text.props.children === t('{0} 未发言', { 0: 'Beta' })));
    const details = tree.root.findByType(GroupDetailsSheet);
    assert.equal(typeof details.props.onUpdated, 'function', 'renaming must update the current route');
  } finally { await act(async () => tree.unmount()); }
});
