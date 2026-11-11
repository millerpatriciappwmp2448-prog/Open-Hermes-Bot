const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { createReplyNotifier, notificationTarget } = require('../src/replyNotifications.ts');

const run = { host: 'https://host.test', botId: 'atlas', threadId: 'bot:atlas', sessionId: 's1', requestId: 'r1', name: 'Atlas' };
function fixture() {
  const sent = [];
  const state = { enabled: true, foreground: true, viewingThread: null, allowed: true };
  const notifier = createReplyNotifier({
    state: () => state,
    allowed: async () => state.allowed,
    present: async value => { sent.push(value); },
  });
  return { notifier, sent, state };
}
test('a completed reply notifies once when viewing the list or another chat', async () => {
  const { notifier, sent, state } = fixture();
  assert.equal(await notifier.complete(run), 'sent');
  assert.equal(await notifier.complete(run), 'duplicate');
  state.viewingThread = 'bot:other';
  assert.equal(await notifier.complete({ ...run, requestId: 'r2' }), 'sent');
  assert.equal(sent.length, 2);
  assert.equal(sent[0].name, 'Atlas');
  assert.equal(notificationTarget(sent[0]).threadId, 'bot:atlas');
  assert.equal(notificationTarget(sent[0]).sessionId, 's1');
});
test('the current chat and muted agents stay quiet; other agents keep their own defaults', async () => {
  const { notifier, sent, state } = fixture();
  state.viewingThread = run.threadId;
  assert.equal(await notifier.complete(run), 'viewing');
  state.foreground = false;
  assert.equal(await notifier.complete({ ...run, requestId: 'background' }), 'sent');
  state.enabled = false;
  assert.equal(await notifier.complete({ ...run, requestId: 'muted' }), 'muted');
  state.enabled = true;
  assert.equal(await notifier.complete({ ...run, requestId: 'other', botId: 'june' }), 'sent');
  assert.equal(sent.length, 2);
});
test('permission is never requested by completion; denial and delivery failures do not break a reply', async () => {
  const { notifier, sent, state } = fixture();
  state.allowed = false;
  assert.equal(await notifier.complete(run), 'denied');
  assert.equal(sent.length, 0);
  const broken = createReplyNotifier({ state: () => state, allowed: async () => { throw Error('native module unavailable'); }, present() { assert.fail(); } });
  assert.equal(await broken.complete(run), 'failed');
  const refused = createReplyNotifier({ state: () => state, allowed: async () => true, present: async () => { throw Error('OS rejected notification'); } });
  assert.equal(await refused.complete(run), 'failed');
});
test('pending deliveries recheck focus/mute and share deduplication across simultaneous callbacks', async () => {
  const { state } = fixture();
  let release;
  const sent = [];
  const notifier = createReplyNotifier({ state: () => state, allowed: () => new Promise(r => { release = r; }), present: async value => sent.push(value) });
  const first = notifier.complete(run);
  assert.equal(await notifier.complete(run), 'duplicate');
  state.enabled = false;
  release(true);
  assert.equal(await first, 'muted');
  assert.equal(sent.length, 0);
});
test('response routing accepts only Hermes reply notifications with valid identifiers', () => {
  for (const invalid of [null, {}, [], { threadId: 'bot:x' }, { kind: 'hermes-reply', threadId: 'bot:x', botId: 'y', sessionId: 's' }]) {
    assert.equal(notificationTarget(invalid), null);
  }
});

test('group notification targets carry an explicit group ID rather than impersonating a private chat', () => {
  const group = { ...run, kind: 'hermes-reply', threadId: 'g-work', groupId: 'g-work' };
  assert.equal(notificationTarget(group)?.groupId, 'g-work');
  assert.equal(notificationTarget({ ...group, groupId: 'g-other' }), null);
  assert.equal(notificationTarget({ ...group, groupId: 'bot:atlas', threadId: 'bot:atlas' }), null);
  assert.equal(notificationTarget({ ...group, groupId: undefined }), null);
});
