const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { watchTurn } = require('../src/turnRecovery.ts');

test('a suspended/failed phone connection resumes the SAME run, without failing or duplicating deltas', async () => {
  let starts = 0, reads = 0, fail = true;
  const snapshots = [], errors = [], done = [];
  const timers = new Map(); let tid = 0;
  const handle = watchTurn({
    start: async () => { starts++; return { status: 'running', text: '' }; },
    read: async () => { reads++; if (fail) throw { code: 'unreachable', status: 0 }; return { status: 'completed', text: 'full reply' }; },
    stop: async () => {},
  }, { snapshot: x => snapshots.push(x.text), done: x => done.push(x), error: x => errors.push(x) }, {
    later: fn => { timers.set(++tid, fn); return tid; }, cancel: id => timers.delete(id),
  });
  await new Promise(setImmediate);
  const tick = async () => { const [id, fn] = timers.entries().next().value; timers.delete(id); fn(); await new Promise(setImmediate); };
  await tick();
  assert.equal(errors.length, 0, 'a phone transport failure is not an agent failure');
  handle.pause();
  assert.equal(timers.size, 0);
  fail = false;
  handle.resume();
  await new Promise(setImmediate);
  assert.deepEqual(done, ['full reply']);
  assert.equal(starts, 1);
  assert.equal(reads, 2);
  assert.equal(timers.size, 0);
  assert.equal(errors.length, 0);
});

test('lost acceptance retries start with the same request identity; detach never stops server work', async () => {
  let starts = 0, stopped = 0;
  const timers = [];
  const handle = watchTurn({
    start: async () => { if (++starts === 1) throw { code: 'timeout' }; return { status: 'running', text: '' }; },
    read: async () => ({ status: 'running', text: '' }), stop: async () => { stopped++; },
  }, { snapshot() {}, done() {}, error() { assert.fail('transient'); } }, { later: fn => { timers.push(fn); return 1; }, cancel() {} });
  await new Promise(setImmediate);
  timers.shift()(); await new Promise(setImmediate);
  assert.equal(starts, 2);
  handle.detach();
  assert.equal(stopped, 0);
});

test('explicit stop calls host; permanent rejection is reported once', async () => {
  let stopped = 0, errors = 0;
  const handle = watchTurn({ start: async () => ({ status: 'running' }), read: async () => ({ status: 'running' }), stop: async () => { stopped++; } },
    { snapshot() {}, done() {}, error() {} });
  await new Promise(setImmediate);
  handle.stop(); await new Promise(setImmediate);
  assert.equal(stopped, 1);
  watchTurn({ start: async () => { throw { status: 401, code: 'unauthorized' }; }, read() {}, stop() {} },
    { snapshot() {}, done() {}, error() { errors++; } });
  await new Promise(setImmediate);
  assert.equal(errors, 1);
});

test('cancelled and completed runs keep distinct outcomes for reply notifications', async () => {
  const outcomes = [];
  for (const status of ['cancelled', 'completed']) {
    watchTurn({ start: async () => ({ status, text: 'partial' }), read() {}, stop() {} },
      { snapshot() {}, done: (text, state) => outcomes.push([text, state]), error() { assert.fail(); } });
    await new Promise(setImmediate);
  }
  assert.deepEqual(outcomes, [['partial', 'cancelled'], ['partial', 'completed']]);
});
