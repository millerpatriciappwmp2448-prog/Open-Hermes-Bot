const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const harness = require('./helpers/native-screen-harness.cjs');
const { ChatScreen } = require('../src/screens/ChatScreen.tsx');
const { SettingsScreen } = require('../src/screens/SettingsScreen.tsx');
const { Composer } = require('../src/components/Composer.tsx');
const { t } = require('../src/i18n/index.ts');

const bot = { id: 'bot:main', name: 'Hermes', shape: 'cercle', color: '#22734e', role: 'Agent', session: 'main' };
const thread = { id: 'bot:main', botId: bot.id, kind: 'bot', name: bot.name, preview: '', time: '', threadModel: '' };
const trees = new Set();
function fixture(overrides = {}) {
  const store = {
    bots: [bot], threads: [thread], messages: {}, chatPreferences: {},
    connection: { status: 'demo', url: '' }, prefs: { host: '', voice: 'local' },
    toggles: { haptics: false }, toggle() {},
    botById: (id) => id === bot.id ? bot : undefined,
    threadById: (id) => id === thread.id ? thread : undefined,
    send() {}, stop() {}, markRead() {}, loadTodos: async () => {},
    ...overrides,
  };
  harness.setStore(store);
  return store;
}
async function mount(element) {
  let tree;
  await act(async () => { tree = create(element, { createNodeMock: harness.createNodeMock }); });
  trees.add(tree);
  return tree;
}
async function press(node) {
  await act(async () => { await node.props.onPress(); });
}
const chat = (id = thread.id) => React.createElement(ChatScreen, {
  route: { params: { threadId: id } }, navigation: harness.navigation,
});
const languageTrigger = (tree) => tree.root.findByProps({ 'aria-expanded': false });
const textOf = (tree) => JSON.stringify(tree.toJSON());

afterEach(async () => {
  await act(async () => { for (const tree of trees) tree.unmount(); });
  trees.clear();
  harness.native.Platform.OS = 'ios';
  delete global.addEventListener;
  delete global.removeEventListener;
  harness.keyboardEvents.emit('keyboardDidHide', {});
});

test('native chat mounts and follows keyboard visibility without leaking subscriptions', async () => {
  const reads = [];
  fixture({ markRead: (id) => reads.push(id) });
  const beforeShow = harness.keyboardEvents.listenerCount('keyboardWillShow');
  const beforeHide = harness.keyboardEvents.listenerCount('keyboardWillHide');
  const tree = await mount(chat());
  assert.deepEqual(reads, [thread.id]);
  assert.equal(tree.root.findByType(Composer).props.bottomInset, 34);
  await act(async () => { harness.keyboardEvents.emit('keyboardWillShow', {}); });
  assert.equal(tree.root.findByType(Composer).props.bottomInset, 0);
  await act(async () => { harness.keyboardEvents.emit('keyboardWillHide', {}); });
  assert.equal(tree.root.findByType(Composer).props.bottomInset, 34);
  await act(async () => { tree.unmount(); });
  trees.delete(tree);
  assert.equal(harness.keyboardEvents.listenerCount('keyboardWillShow'), beforeShow);
  assert.equal(harness.keyboardEvents.listenerCount('keyboardWillHide'), beforeHide);
});

test('native chat accounts for a keyboard already open when the screen mounts', async () => {
  fixture();
  harness.keyboardEvents.emit('keyboardDidShow', { endCoordinates: {} });
  const tree = await mount(chat());
  assert.equal(tree.root.findByType(Composer).props.bottomInset, 0);
});

test('a removed conversation renders a fallback and can return to the list', async () => {
  const store = fixture();
  const tree = await mount(chat());
  store.threadById = () => undefined;
  await act(async () => { tree.update(chat()); });
  assert.ok(textOf(tree).includes(t('此会话已不存在')));
  let returned = false;
  harness.navigation.goBack = () => { returned = true; };
  await press(tree.root.findByProps({ accessibilityLabel: t('返回') }));
  assert.equal(returned, true);
});

test('native language popup opens without DOM event APIs and switches both languages', async () => {
  fixture();
  assert.equal(window, globalThis);
  assert.equal(typeof window.addEventListener, 'undefined');
  const tree = await mount(React.createElement(SettingsScreen));
  for (const [label, language] of [['English', 'en'], ['\u7b80\u4f53\u4e2d\u6587', 'zh']]) {
    await press(languageTrigger(tree));
    await act(async () => { harness.flushFrames(); });
    assert.equal(tree.root.findByType('Modal').props.visible, true);
    const option = tree.root.findAllByType('Pressable').find((node) =>
      node.props.accessibilityRole === 'radio' && node.findAllByType('Text').some((text) => text.props.children === label));
    assert.ok(option, `${label} is selectable`);
    await press(option);
    assert.equal(tree.root.findByType('Modal').props.visible, false);
    assert.equal(harness.savedPreferences.get('hermes.interface.language'), language);
    assert.equal(languageTrigger(tree).props.accessibilityValue.text, label);
  }
});

test('native language popup closes from its backdrop and cancels measurement on unmount', async () => {
  fixture();
  const tree = await mount(React.createElement(SettingsScreen));
  await press(languageTrigger(tree));
  await act(async () => { harness.flushFrames(); });
  await press(tree.root.findByProps({ accessibilityLabel: t('关闭') }));
  assert.equal(tree.root.findByType('Modal').props.visible, false);
  await press(languageTrigger(tree));
  assert.equal(harness.pendingFrames(), 1);
  await act(async () => { tree.unmount(); });
  trees.delete(tree);
  assert.equal(harness.pendingFrames(), 0);
});

test('web language popup keeps Escape dismissal and removes its event listener', async () => {
  fixture();
  harness.native.Platform.OS = 'web';
  const events = new EventTarget();
  const listeners = new Set();
  global.addEventListener = (type, listener) => { events.addEventListener(type, listener); listeners.add(listener); };
  global.removeEventListener = (type, listener) => { events.removeEventListener(type, listener); listeners.delete(listener); };
  const tree = await mount(React.createElement(SettingsScreen));
  await press(languageTrigger(tree));
  await act(async () => { harness.flushFrames(); });
  assert.equal(listeners.size, 1);
  const escape = new Event('keydown');
  escape.key = 'Escape';
  await act(async () => { events.dispatchEvent(escape); });
  assert.equal(tree.root.findByType('Modal').props.visible, false);
  assert.equal(listeners.size, 0);
  await press(languageTrigger(tree));
  await act(async () => { tree.unmount(); });
  trees.delete(tree);
  assert.equal(listeners.size, 0);
});
