const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, filename);
const { readChatPreferences, withChatPreferences, sessionsForBot } = require('../src/chatPreferences.ts');
const saved = {
  picks: { worker: { model: 'chosen', provider: 'private' } },
  hidden: ['keep'],
  mobileChatPreferences: { worker: { tapbacks: false, future: 'preserve' }, default: { tapbacks: true } },
};
assert.equal(readChatPreferences(saved, 'worker').tapbacks, false);
assert.equal(readChatPreferences(saved, 'default').tapbacks, true);
assert.equal(readChatPreferences(saved, 'new').tapbacks, true);
assert.equal(readChatPreferences(saved, 'new').notifications, true, 'notifications default on for every agent');
assert.equal(readChatPreferences(saved, 'new').readAloud, false, 'speech is opt-in for every agent');
assert.equal(readChatPreferences({ mobileChatPreferences: { worker: { readAloud: true } } }, 'worker').readAloud, true);
assert.equal(readChatPreferences({ mobileChatPreferences: { worker: { readAloud: 'true' } } }, 'worker').readAloud, false);
assert.equal(readChatPreferences({ mobileChatPreferences: { worker: { notifications: false } } }, 'worker').notifications, false);
assert.equal(readChatPreferences({ mobileChatPreferences: { worker: { notifications: 'false' } } }, 'worker').notifications, true);
assert.equal(readChatPreferences({ mobileChatPreferences: { worker: { tapbacks: 'false' } } }, 'worker').tapbacks, true);
for (const invalid of [null, [], 'invalid', 1]) {
  assert.equal(readChatPreferences({ mobileChatPreferences: invalid }, 'worker').tapbacks, true);
}
const changed = withChatPreferences(saved, 'worker', { tapbacks: true });
assert.deepEqual(changed.picks, saved.picks);
assert.deepEqual(changed.hidden, saved.hidden);
assert.equal(changed.mobileChatPreferences.worker.future, 'preserve');
assert.deepEqual(changed.mobileChatPreferences.default, saved.mobileChatPreferences.default);
assert.equal(saved.mobileChatPreferences.worker.tapbacks, false, 'Do not mutate the server snapshot');
assert.equal(readChatPreferences(changed, 'worker').tapbacks, true);
const muted = withChatPreferences(saved, 'worker', { notifications: false });
assert.equal(readChatPreferences(muted, 'worker').tapbacks, false, 'notification edits preserve reactions');
assert.equal(readChatPreferences(muted, 'worker').notifications, false);
assert.equal(readChatPreferences(muted, 'default').notifications, true, 'muting one agent leaves the other on');
const reactionEdit = withChatPreferences(muted, 'worker', { tapbacks: true });
assert.equal(readChatPreferences(reactionEdit, 'worker').notifications, false, 'reaction edits preserve mute');
assert.equal(reactionEdit.mobileChatPreferences.worker.future, 'preserve');
const spoken = withChatPreferences(reactionEdit, 'worker', { readAloud: true });
assert.equal(readChatPreferences(spoken, 'worker').readAloud, true);
assert.equal(readChatPreferences(spoken, 'default').readAloud, false);
assert.equal(readChatPreferences(spoken, 'worker').notifications, false);
assert.equal(readChatPreferences(withChatPreferences(spoken, 'worker', { tapbacks: false }), 'worker').readAloud, true);
const rows = [
  { id: 'older', bot: 'worker', lastActive: 10, archived: false },
  { id: 'other-bot', bot: 'default', lastActive: 99, archived: false },
  { id: 'newer', bot: 'worker', lastActive: 20, archived: true },
];
assert.deepEqual(sessionsForBot(rows, 'worker').map(row => row.id), ['newer', 'older']);
assert.deepEqual(rows.map(row => row.id), ['older', 'other-bot', 'newer']);
assert.deepEqual(sessionsForBot(rows, 'missing'), []);
console.log('PASS: per-bot chat preferences, preservation, invalid saved values, isolated sorted session history');
