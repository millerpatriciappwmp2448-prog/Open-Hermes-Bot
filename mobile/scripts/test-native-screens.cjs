const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const harness = require('./helpers/native-screen-harness.cjs');
const { ChatScreen } = require('../src/screens/ChatScreen.tsx');
const { SettingsScreen } = require('../src/screens/SettingsScreen.tsx');
const { Composer } = require('../src/components/Composer.tsx');
const { t, localeTag } = require('../src/i18n/index.ts');

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
    send() {}, stop() {}, markRead() {}, setViewingThread() {}, loadTodos: async () => {},
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
  harness.resetDictation();
  harness.setFocused(true);
  harness.alerts.length = 0;
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

test('native composer wraps long drafts and only sends from the send button', async () => {
  fixture();
  const sent = [];
  const tree = await mount(React.createElement(Composer, {
    thread, bots: [bot], bottomInset: 0, onSend: (payload) => sent.push(payload),
  }));
  const field = () => tree.root.findByType('TextInput');
  assert.equal(field().props.multiline, true);
  assert.equal(field().props.scrollEnabled, true);
  assert.equal(field().props.onSubmitEditing, undefined);
  const style = Object.assign({}, ...[field().props.style].flat(Infinity).filter(Boolean));
  assert.ok(style.maxHeight >= 100, 'a long draft can grow over several lines');
  const draft = '这是一段很长的消息，需要在输入框里自动换行显示，而不是一直向右延伸。';
  await act(async () => { field().props.onChangeText(`${draft}\n第二行`); });
  assert.equal(sent.length, 0);
  await press(tree.root.findByProps({ accessibilityLabel: t('发送') }));
  assert.deepEqual(sent, [{ text: `${draft}\n第二行` }]);
  assert.equal(field().props.value, '');
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

const flush = () => act(async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }
});
const emitSpeech = (event, payload = {}) => act(async () => { harness.dictationNative.emit(event, payload); });
const heard = (transcript, isFinal = false) => emitSpeech('result', { isFinal, results: [{ transcript }] });
const button = (tree, label) => tree.root.findByProps({ accessibilityLabel: t(label) });
const hasButton = (tree, label) => tree.root.findAllByProps({ accessibilityLabel: t(label) }).length > 0;
const composer = (sent = []) => React.createElement(Composer, {
  thread, bots: [bot], bottomInset: 0, onSend: (payload) => sent.push(payload),
});
const draftOf = (tree) => tree.root.findByType('TextInput').props.value;

async function listen(tree) {
  await press(button(tree, '语音输入'));
  await flush();
  await emitSpeech('start');
}

test('dictation stops reply speech first and listens in the interface language', async () => {
  fixture();
  const tree = await mount(composer());
  const stopsBefore = harness.speechCalls.stops;
  await listen(tree);
  const [started] = harness.dictationNative.starts;
  assert.ok(started, 'the recognizer starts');
  assert.equal(started.opts.lang, localeTag());
  assert.equal(started.opts.interimResults, true);
  assert.ok(started.stopsAtStart > stopsBefore, 'a reply being read aloud stops before listening');
  assert.ok(tree.root.findAllByProps({ testID: 'dictation-dock' }).length > 0);
});

test('finishing dictation fills the draft and sends nothing until the user taps send', async () => {
  fixture();
  const sent = [];
  const tree = await mount(composer(sent));
  await listen(tree);
  await heard('每天早上推送新闻');
  assert.ok(textOf(tree).includes('每天早上推送新闻'), 'live words show while listening');
  await press(button(tree, '完成语音输入'));
  assert.equal(harness.dictationNative.stops, 1);
  await emitSpeech('end');
  assert.equal(tree.root.findAllByProps({ testID: 'dictation-dock' }).length, 0);
  assert.equal(draftOf(tree), '每天早上推送新闻');
  assert.deepEqual(sent, []);
  await press(button(tree, '发送'));
  assert.deepEqual(sent, [{ text: '每天早上推送新闻' }]);
});

test('cancelling dictation aborts the recognizer and keeps no words', async () => {
  fixture();
  const tree = await mount(composer());
  await listen(tree);
  await heard('不要这句');
  await press(button(tree, '取消语音输入'));
  assert.equal(harness.dictationNative.aborts, 1);
  assert.equal(tree.root.findAllByProps({ testID: 'dictation-dock' }).length, 0);
  assert.equal(draftOf(tree), '');
  assert.equal(harness.alerts.length, 0);
});

test('leaving the chat or backgrounding the app keeps the words heard so far', async () => {
  fixture();
  const tree = await mount(composer());
  await listen(tree);
  await heard('离开前说的话');
  harness.setFocused(false);
  await act(async () => { tree.update(composer()); });
  assert.equal(harness.dictationNative.stops, 1);
  await emitSpeech('end');
  assert.equal(draftOf(tree), '离开前说的话');

  harness.setFocused(true);
  await act(async () => { tree.update(composer()); });
  await listen(tree);
  await heard('切到后台');
  await act(async () => { harness.appStateEvents.emit('change', 'inactive'); });
  assert.equal(harness.dictationNative.stops, 1, 'a passing notification banner does not end dictation');
  await act(async () => { harness.appStateEvents.emit('change', 'background'); });
  assert.equal(harness.dictationNative.stops, 2);
  await emitSpeech('end');
  const separator = localeTag().startsWith('zh') ? '' : ' ';
  assert.equal(draftOf(tree), `离开前说的话${separator}切到后台`);
});

test('denied microphone permission explains itself and opens iPhone Settings', async () => {
  fixture();
  harness.dictationNative.permission = { granted: false, canAskAgain: false };
  const tree = await mount(composer());
  await press(button(tree, '语音输入'));
  await flush();
  assert.equal(harness.dictationNative.starts.length, 0);
  assert.equal(harness.dictationNative.permissionRequests, 0);
  assert.equal(harness.alerts.length, 1);
  const [title, message, buttons] = harness.alerts[0];
  assert.equal(title, t('无法使用语音输入'));
  assert.equal(message, t('请在系统设置中允许 Hermes Bot 使用麦克风和语音识别。'));
  const before = harness.settingsCalls();
  await act(async () => { buttons[1].onPress(); });
  assert.equal(harness.settingsCalls(), before + 1);
  assert.equal(tree.root.findAllByProps({ testID: 'dictation-dock' }).length, 0);
});

test('speech events after the chat closes are ignored without errors', async () => {
  fixture();
  const tree = await mount(composer());
  await listen(tree);
  await act(async () => { tree.unmount(); });
  trees.delete(tree);
  assert.equal(harness.dictationNative.aborts, 1);
  await assert.doesNotReject(async () => {
    await heard('迟到的结果');
    await emitSpeech('end');
  });
  assert.equal(harness.alerts.length, 0);
});

test('dictation appends to an existing draft and the microphone stays next to send', async () => {
  fixture();
  const tree = await mount(composer());
  await act(async () => { tree.root.findByType('TextInput').props.onChangeText('提醒我'); });
  assert.ok(hasButton(tree, '语音输入'), 'the microphone stays visible with a draft');
  assert.ok(hasButton(tree, '发送'));
  await listen(tree);
  await heard('明天九点开会', true);
  await press(button(tree, '完成语音输入'));
  await emitSpeech('end');
  const separator = localeTag().startsWith('zh') ? '' : ' ';
  assert.equal(draftOf(tree), `提醒我${separator}明天九点开会`);
});
