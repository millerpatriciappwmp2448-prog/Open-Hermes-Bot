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
const rows = [
  { id: 'older', bot: 'worker', lastActive: 10, archived: false },
  { id: 'other-bot', bot: 'default', lastActive: 99, archived: false },
  { id: 'newer', bot: 'worker', lastActive: 20, archived: true },
];
assert.deepEqual(sessionsForBot(rows, 'worker').map(row => row.id), ['newer', 'older']);
assert.deepEqual(rows.map(row => row.id), ['older', 'other-bot', 'newer']);
assert.deepEqual(sessionsForBot(rows, 'missing'), []);
console.log('PASS: per-bot chat preferences, preservation, invalid saved values, isolated sorted session history');
