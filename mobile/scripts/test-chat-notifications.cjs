const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const harness = require('./helpers/native-screen-harness.cjs');
const { ChatSettingsScreen } = require('../src/screens/ChatSettingsScreen.tsx');
const { notificationAccess } = require('../src/notificationDevice.ts');
const { t } = require('../src/i18n/index.ts');
const thread = { id: 'bot:atlas', botId: 'atlas', kind: 'bot', name: 'Atlas' };
const trees = new Set();
afterEach(async () => { for (const tree of trees) await act(async () => tree.unmount()); trees.clear(); });
test('notification switch defaults on and changes only this agent with an actual save', async () => {
  const changes = [];
  const store = { threadById: () => thread, threads: [thread], botById: () => ({ id: 'atlas' }), messages: {},
    connection: { status: 'connected' }, chatPreferences: {}, saveChatPreferences: async (...args) => changes.push(args) };
  harness.setStore(store);
  let tree;
  await act(async () => { tree = create(React.createElement(ChatSettingsScreen, { route: { params: { threadId: thread.id } }, navigation: harness.navigation })); });
  trees.add(tree);
  const control = () => tree.root.findByProps({ accessibilityLabel: t('通知') });
  assert.equal(control().props.value, true);
  assert.equal(Boolean(control().props.disabled), false);
  await act(async () => { await control().props.onValueChange(false); });
  assert.deepEqual(changes, [['atlas', { notifications: false }]]);
});
test('permission reading accepts iOS provisional and never requests unless the user acts', async () => {
  const before = harness.notificationCalls.permissionRequests;
  harness.notificationNative.getPermissionsAsync = async () => ({ granted: false, canAskAgain: true, ios: { status: 0 } });
  assert.equal(await notificationAccess(), 'undetermined');
  assert.equal(harness.notificationCalls.permissionRequests, before);
  assert.equal(await notificationAccess(true), 'allowed');
  assert.equal(harness.notificationCalls.permissionRequests, before + 1);
  harness.notificationNative.getPermissionsAsync = async () => ({ granted: false, ios: { status: 3 } });
  assert.equal(await notificationAccess(), 'allowed');
  harness.notificationNative.getPermissionsAsync = async () => ({ granted: false, ios: { status: 1 } });
  assert.equal(await notificationAccess(true), 'denied');
  assert.equal(harness.notificationCalls.permissionRequests, before + 1, 'denial cannot be repeatedly prompted');
});

test('read aloud defaults off and saves only the current agent; failed saves keep the prior value', async () => {
  const changes = [];
  const store = { threadById: () => thread, threads: [thread], botById: () => ({ id: 'atlas' }), messages: {},
    connection: { status: 'connected' }, chatPreferences: {}, saveChatPreferences: async (...args) => { changes.push(args); } };
  harness.setStore(store);
  const element = () => React.createElement(ChatSettingsScreen, { route: { params: { threadId: thread.id } }, navigation: harness.navigation });
  let tree;
  await act(async () => { tree = create(element()); }); trees.add(tree);
  const advanced = tree.root.findAll(node => node.props.accessibilityLabel === t('高级') && typeof node.props.onPress === 'function')[0];
  assert.ok(advanced, 'advanced section toggle must be present');
  await act(async () => { advanced.props.onPress(); });
  const control = () => tree.root.findAllByType('Switch').find(node => node.props.accessibilityLabel === t('朗读回复'));
  assert.ok(control(), 'read aloud control must be present');
  assert.equal(control().props.value, false);
  await act(async () => { await control().props.onValueChange(true); });
  assert.deepEqual(changes, [['atlas', { readAloud: true }]]);
  store.chatPreferences = { atlas: { readAloud: true } };
  store.saveChatPreferences = async () => { throw new Error(''); };
  await act(async () => tree.update(element()));
  await act(async () => { await control().props.onValueChange(false); });
  assert.equal(control().props.value, true);
  assert.ok(JSON.stringify(tree.toJSON()).includes(t('设置未保存，请重试。')));
});
