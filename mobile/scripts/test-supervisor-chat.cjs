const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const harness = require('./helpers/native-screen-harness.cjs');
const { ChatScreen } = require('../src/screens/ChatScreen.tsx');
const { Composer } = require('../src/components/Composer.tsx');
const { t } = require('../src/i18n');

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
