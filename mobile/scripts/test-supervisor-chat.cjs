const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const harness = require('./helpers/native-screen-harness.cjs');
const { ChatScreen } = require('../src/screens/ChatScreen.tsx');
const { Composer } = require('../src/components/Composer.tsx');
const { t } = require('../src/i18n');
const { SupervisorChatStatus } = require('../src/components/SupervisorChatStatus.tsx');
const { SupervisorWatchPicker } = require('../src/components/SupervisorWatchPicker.tsx');
const { CodexChatPicker } = require('../src/components/CodexChatPicker.tsx');
const { PrimaryButton } = require('../src/components/UI.tsx');
const { mergeCodexSidebar, orderCodexSidebar } = require('../src/codexSupervisor.ts');
const textOf = tree => JSON.stringify(tree.toJSON());
const sidebar = {
  projects: [{ id: 'p2', label: 'Same name', path: 'D:/B' }, { id: 'p1', label: 'Same name', path: 'D:/A' }],
  sections: [{ id: 'threads', name: 'Projects', items: ['codex:project:p1', 'codex:project:p2'] }],
  threads: [{ id: 'recent', projectId: 'p1', title: 'Recent task', updatedAt: 200 },
    { id: 'solo', projectId: null, cwd: 'D:/A', title: 'Independent task', updatedAt: 100 }],
  nextCursor: 'page2',
};

test('dedicated supervisor uses the normal chat and exposes host watch status and model review', async () => {
  const bot = { id: 'supervisor', name: 'Codex supervisor', capabilities: ['codex-supervisor'] };
  const thread = { id: 'bot:supervisor', kind: 'bot', botId: bot.id, name: bot.name, threadModel: 'chosen' };
  let reads = 0, sent, destination;
  harness.setStore({ bots: [bot], threads: [thread], messages: {}, chatPreferences: {}, connection: { status: 'connected', url: 'https://bridge' },
    botById: () => bot, threadById: () => thread, markRead() {}, setViewingThread() {}, loadTodos: async () => {},
    send: (id, message) => { sent = [id, message]; },
    loadCodexStatus: async () => { reads++; return { enabled: true, state: 'backoff', attempts: 12,
      spec: { profile: bot.id, goal: 'Finish and verify' }, observed: { title: 'Existing active task' },
      review: { status: 'ready', analysis: 'The required integration check is missing.' } }; },
  });
  let tree;
  await act(async () => { tree = create(React.createElement(ChatScreen, {
    route: { params: { threadId: thread.id } }, navigation: { navigate: name => { destination = name; } },
  }), { createNodeMock: harness.createNodeMock }); });
  try {
    assert.ok(reads > 0, 'the dedicated chat reads actual host state');
    const content = JSON.stringify(tree.toJSON());
    assert.ok(content.includes(t('告诉我需要监督的 Codex 会话和目标，我会持续跟进、自动续做并检查工作。')));
    assert.ok(content.includes(t('等待自动重试')));
    assert.ok(content.includes('Existing active task'));
    assert.ok(content.includes('The required integration check is missing.'));
    assert.ok(content.includes(t('自动续做次数：{0}', { '0': 12 })));
    await act(async () => { tree.root.findByType(Composer).props.onSend({ text: 'Pause supervision' }); });
    assert.equal(sent[0], thread.id);
    assert.equal(sent[1].text, 'Pause supervision');
    await act(async () => { tree.root.findByProps({ accessibilityLabel: t('查看监督详情') }).props.onPress(); });
    assert.equal(destination, 'CodexSupervisor');
  } finally { await act(async () => tree.unmount()); }
});

test('sidebar retains every project, desktop order, duplicate labels and independent chats sharing a project cwd', () => {
  const groups = orderCodexSidebar(sidebar);
  assert.deepEqual(groups.map(g => g.id), ['project:p1', 'project:p2', 'standalone']);
  assert.deepEqual(groups.map(g => g.chats.map(c => c.id)), [['recent'], [], ['solo']]);
  const next = { threads: [
    { id: 'recent', title: 'Stale title', projectId: 'p1' },
    ...Array.from({ length: 60 }, (_, i) => ({ id: `old${i}`, title: `Older task ${i}`, projectId: 'p2' })),
  ], projects: [], sections: [], nextCursor: null };
  const merged = mergeCodexSidebar(sidebar, next, true);
  assert.equal(merged.threads.length, 62);
  assert.equal(merged.threads[0].title, 'Recent task');
  assert.equal(merged.nextCursor, null);
  assert.deepEqual(merged.projects, sidebar.projects);
  assert.equal(orderCodexSidebar(merged)[1].chats.length, 60);
  assert.equal(mergeCodexSidebar(merged, sidebar), sidebar, 'refresh discards obsolete rows and resets pagination');
});

test('chat picker expands projects, searches loaded chats, appends older results and keeps rows on a failed refresh', async () => {
  const cursors = [], selected = [];
  let fail = false;
  harness.setStore({ connection: { url: 'https://bridge', status: 'connected' }, loadCodexChats: async cursor => {
    cursors.push(cursor); if (fail) throw new Error('Temporary list failure');
    return cursor ? { projects: [], sections: [], nextCursor: null, threads: [{ id: 'old', projectId: 'p2', title: 'Older task' }] } : sidebar;
  } });
  let tree;
  await act(async () => { tree = create(React.createElement(CodexChatPicker, { value: '', onSelect: chat => selected.push(chat.id) })); });
  try {
    const pressText = label => tree.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => text.props.children === t(label)));
    assert.equal(tree.root.findAllByProps({ testID: 'codex-choice:recent' }).length, 0);
    await act(async () => tree.root.findByProps({ testID: 'codex-group:project:p1' }).props.onPress());
    assert.ok(tree.root.findByProps({ testID: 'codex-choice:recent' }));
    await act(async () => pressText('加载更多会话').props.onPress());
    assert.deepEqual(cursors, [undefined, 'page2']);
    await act(async () => tree.root.findByType('TextInput').props.onChangeText('Older'));
    assert.ok(textOf(tree).includes('Older task'));
    assert.ok(!textOf(tree).includes('Recent task'));
    await act(async () => tree.root.findByProps({ testID: 'codex-choice:old' }).props.onPress());
    assert.deepEqual(selected, ['old']);
    fail = true;
    await act(async () => pressText('刷新').props.onPress());
    assert.ok(textOf(tree).includes('Older task'));
    assert.ok(textOf(tree).includes('Temporary list failure'));
  } finally { await act(async () => tree.unmount()); }
});

test('supervisor chat opens the picker and starts only after an explicit goal and confirmation', async () => {
  let host = { enabled: false, state: 'stopped' };
  let finish;
  const starts = [];
  harness.setStore({ connection: { url: 'https://bridge', status: 'connected' }, modelPicks: { supervisor: { model: 'chosen', provider: 'provider' } },
    loadCodexChats: async () => sidebar, loadCodexStatus: async () => host,
    startCodexWatch: spec => { starts.push(spec); return new Promise(resolve => { finish = () => { host = { enabled: true, state: 'watching', spec, observed: { title: 'Independent task' } }; resolve(host); }; }); },
  });
  let tree;
  await act(async () => { tree = create(React.createElement(SupervisorChatStatus, { botId: 'supervisor', onDetails() {}, revision: 'one' })); });
  try {
    await act(async () => tree.root.findByProps({ accessibilityLabel: t('选择 Codex 会话') }).props.onPress());
    assert.ok(textOf(tree).includes(t('搜索项目或会话')));
    await act(async () => tree.root.findByProps({ testID: 'codex-choice:solo' }).props.onPress());
    assert.deepEqual(starts, []);
    let start = tree.root.findByType(PrimaryButton);
    assert.equal(start.props.disabled, true);
    await act(async () => tree.root.findByProps({ accessibilityLabel: t('目标与监督指令') }).props.onChangeText('Finish and verify'));
    start = tree.root.findByType(PrimaryButton);
    assert.equal(start.props.disabled, false);
    await act(async () => { start.props.onPress(); start.props.onPress(); });
    assert.equal(starts.length, 1);
    assert.deepEqual(starts[0], { threadId: 'solo', hostId: 'local', profile: 'supervisor', goal: 'Finish and verify', reviewEnabled: true, model: 'chosen', provider: 'provider' });
    await act(async () => finish());
    assert.ok(textOf(tree).includes('Independent task'));
    assert.ok(textOf(tree).includes('Finish and verify'));
    assert.equal(tree.root.findAllByType('Modal').filter(node => node.props.visible).length, 0);
  } finally { await act(async () => tree.unmount()); }
});

test('switching targets preserves the saved review settings and closing a draft does not save', async () => {
  const calls = [], saved = [];
  let closed = 0;
  harness.setStore({ connection: { url: 'https://bridge', status: 'connected' }, modelPicks: { supervisor: { model: 'different' } },
    loadCodexChats: async () => sidebar,
    loadCodexStatus: async () => ({ enabled: true, state: 'watching', observed: { title: 'Original' },
      spec: { threadId: 'recent', goal: 'Original goal', profile: 'supervisor', reviewEnabled: false, model: 'saved-model', provider: 'saved-provider' } }),
    startCodexWatch: async spec => { calls.push(spec); return { enabled: true, state: 'watching', spec }; },
  });
  let tree;
  await act(async () => { tree = create(React.createElement(SupervisorWatchPicker, { botId: 'supervisor', onClose() { closed++; }, onSaved: result => saved.push(result) })); });
  try {
    await act(async () => tree.root.findByProps({ testID: 'codex-choice:solo' }).props.onPress());
    assert.equal(tree.root.findByType('TextInput').props.value, 'Original goal');
    await act(async () => tree.root.findByProps({ accessibilityLabel: t('关闭') }).props.onPress());
    assert.equal(closed, 1); assert.deepEqual(calls, []);
    await act(async () => tree.root.findByType(PrimaryButton).props.onPress());
    assert.equal(calls[0].threadId, 'solo');
    assert.equal(calls[0].model, 'saved-model');
    assert.equal(calls[0].provider, 'saved-provider');
    assert.equal(calls[0].reviewEnabled, false);
    assert.equal(saved.length, 1);
  } finally { await act(async () => tree.unmount()); }
});

test('picker ignores a late page from the previous server', async () => {
  let finishOld;
  harness.setStore({ connection: { url: 'https://old', status: 'connected' }, loadCodexChats: () => new Promise(resolve => { finishOld = resolve; }) });
  let tree;
  const element = () => React.createElement(CodexChatPicker, { value: '', onSelect() {} });
  await act(async () => { tree = create(element()); });
  try {
    harness.setStore({ connection: { url: 'https://new', status: 'connected' }, loadCodexChats: async () => ({ projects: [], sections: [], threads: [{ id: 'new', title: 'New server chat' }] }) });
    await act(async () => tree.update(element()));
    await act(async () => finishOld(sidebar));
    assert.ok(textOf(tree).includes('New server chat'));
    assert.ok(!textOf(tree).includes('Independent task'));
  } finally { await act(async () => tree.unmount()); }
});
