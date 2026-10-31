const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, filename);
const { profileNameFor, PROFILE_NAME } = require('../src/botNames.ts');

const fixed = () => 0.25;
assert.equal(profileNameFor('Atlas', []), 'atlas');
assert.equal(profileNameFor('Code Review  Bot!', []), 'code-review-bot');
assert.equal(profileNameFor('Café Noir', []), 'cafe-noir');
assert.equal(profileNameFor('Atlas', ['atlas']), 'atlas-2', 'An existing profile must not be overwritten');
assert.equal(profileNameFor('Atlas', ['ATLAS', 'atlas-2']), 'atlas-3');
assert.equal(profileNameFor('写作助手', [], fixed), 'bot-4000', 'Chinese names get an ASCII profile name');
assert.equal(profileNameFor('', [], fixed), 'bot-4000');
assert.equal(profileNameFor('Hermes', [], fixed), 'hermes-2', 'Reserved names are avoided');
assert.equal(profileNameFor('default', [], fixed), 'default-2');
assert.equal(profileNameFor('---', [], fixed), 'bot-4000');
let calls = 0;
const sequence = () => [0.25, 0.25, 0.5][Math.min(calls++, 2)];
assert.equal(profileNameFor('助手', ['bot-4000'], sequence), 'bot-8000', 'Random fallback retries collisions');
const long = profileNameFor('a'.repeat(120), []);
assert.ok(long.length <= 64 && PROFILE_NAME.test(long));
for (const label of ['总助', 'June', '研发 Dev', '__x__', '9lives', 'Ünïcødé', '🙂']) {
  assert.ok(PROFILE_NAME.test(profileNameFor(label, [])), `valid profile for ${label}`);
}
console.log('PASS: bot profile names are valid, unique, ASCII and avoid reserved Hermes names');
