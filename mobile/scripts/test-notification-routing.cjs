const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const harness = require('./helpers/native-screen-harness.cjs');
const { ReplyNotificationRouter } = require('../src/components/ReplyNotificationRouter.tsx');
const run = { kind: 'hermes-reply', host: 'https://host.test', botId: 'atlas', threadId: 'bot:atlas', sessionId: 's1', requestId: 'r1', name: 'Atlas' };
const trees = new Set();
afterEach(async () => { for (const tree of trees) await act(async () => tree.unmount()); trees.clear(); });
test('notification tap waits for connection restore and opens the matching session exactly once', async () => {
  const calls = [];
  const navigation = { isReady: () => true, navigate: (...args) => calls.push(args) };
  const store = { connection: { status: 'connecting', url: run.host }, threads: [] };
  harness.setStore(store);
  const element = () => React.createElement(ReplyNotificationRouter, { navigation, ready: true });
  let tree;
  await act(async () => { tree = create(element()); }); trees.add(tree);
  const tap = async notice => { await act(async () => harness.notificationCalls.listener({
    actionIdentifier: 'default', notification: { request: { content: { data: notice } } },
  })); };
  await tap(run);
  assert.equal(calls.length, 0);
  store.connection = { status: 'connected', url: run.host };
  store.threads = [{ id: run.threadId, botId: run.botId, sessionId: run.sessionId, name: 'Atlas' }];
  await act(async () => tree.update(element()));
  assert.deepEqual(calls, [['Chat', { threadId: run.threadId }]]);
  await tap(run);
  assert.equal(calls.length, 1);
  await tap({ ...run, requestId: 'r2', sessionId: 'old-session' });
  assert.deepEqual(calls.at(-1), ['SessionTranscript', { botId: 'atlas', sessionId: 'old-session', title: 'Atlas' }]);
  await tap({ ...run, host: 'https://other.test', requestId: 'wrong-host' });
  assert.equal(calls.length, 2, 'a notification for another paired host cannot open this host');
  await tap({ ...run, threadId: 'bot:deleted', botId: 'deleted', requestId: 'gone' });
  assert.equal(calls.length, 2, 'removed agents do not crash or navigate');
  await act(async () => tree.unmount()); trees.delete(tree);
  assert.equal(harness.notificationCalls.listener, undefined, 'listener released on unmount');
});
