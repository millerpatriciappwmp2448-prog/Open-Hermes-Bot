const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./helpers/native-screen-harness.cjs');
const { createDictation } = require('../src/dictation.ts');

function setup(overrides = {}) {
  const listeners = new Map();
  const calls = { start: [], stop: 0, abort: 0, request: 0, text: [], errors: [], states: [] };
  let sequence = 0;
  const timers = new Map();
  const clock = {
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const recognizer = {
    isRecognitionAvailable: () => true,
    getPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
    requestPermissionsAsync: async () => { calls.request++; return { granted: true, canAskAgain: true }; },
    addListener(event, callback) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(callback);
      return { remove: () => listeners.get(event).delete(callback) };
    },
    start(options) { calls.start.push(options); },
    stop() { calls.stop++; },
    abort() { calls.abort++; },
    ...overrides,
  };
  const controller = createDictation({
    getRecognizer: async () => recognizer,
    onState: (state) => calls.states.push(state),
    onText: (text) => calls.text.push(text),
    onError: (error) => calls.errors.push(error),
    timers: clock,
  });
  return { controller, recognizer, calls,
    emit: (event, payload = {}) => [...(listeners.get(event) || [])].forEach(fn => fn(payload)),
    fire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } },
    last: () => calls.states.at(-1),
  };
}
const result = (transcript, isFinal = false) => ({ isFinal, results: [{ transcript }] });

test('dictation listens in the selected locale and inserts only after confirmation and native end', async () => {
  const s = setup();
  await s.controller.start('zh-CN');
  assert.equal(s.calls.start[0].lang, 'zh-CN');
  assert.equal(s.calls.start[0].interimResults, true);
  s.emit('start');
  s.emit('result', result('今天的新闻'));
  assert.equal(s.last().transcript, '今天的新闻');
  assert.deepEqual(s.calls.text, []);
  s.controller.finish();
  assert.equal(s.calls.stop, 1);
  assert.deepEqual(s.calls.text, []);
  s.emit('result', result('今天的新闻。', true));
  s.emit('end');
  s.emit('end');
  assert.deepEqual(s.calls.text, ['今天的新闻。']);
  assert.equal(s.last().phase, 'idle');
  s.controller.dispose();
});

test('final speech segments join without duplicating cumulative results', async () => {
  const s = setup();
  await s.controller.start('en-US');
  s.emit('result', result('Hello', true));
  s.emit('result', result('Hello world', true));
  s.emit('result', result('How are you?', true));
  s.controller.finish(); s.emit('end');
  assert.deepEqual(s.calls.text, ['Hello world How are you?']);
  s.controller.dispose();
  const zh = setup(); await zh.controller.start('zh-CN');
  zh.emit('result', result('你好。', true));
  zh.emit('result', result('今天好吗？', true));
  zh.controller.finish(); zh.emit('end');
  assert.deepEqual(zh.calls.text, ['你好。今天好吗？']);
  zh.controller.dispose();
});

test('cancel invalidates late speech callbacks and does not insert a cancelled transcript', async () => {
  const s = setup(); await s.controller.start('zh-CN');
  s.emit('result', result('不要发送'));
  s.controller.cancel();
  s.emit('result', result('迟到的结果', true)); s.emit('end');
  assert.deepEqual(s.calls.text, []);
  assert.equal(s.last().phase, 'idle');
  assert.equal(s.calls.abort, 1);
  await s.controller.start('en-US');
  assert.equal(s.calls.start.length, 2);
  s.controller.dispose();
});

test('cancel during permission request cannot start the microphone later', async () => {
  let resolve;
  const s = setup({ getPermissionsAsync: () => new Promise(r => { resolve = r; }) });
  const pending = s.controller.start('zh-CN');
  await Promise.resolve();
  s.controller.cancel();
  resolve({ granted: true, canAskAgain: true });
  await pending;
  assert.equal(s.calls.start.length, 0);
  assert.deepEqual(s.calls.text, []);
  s.controller.dispose();
});

test('permission denial and missing recognizer are recoverable errors', async () => {
  const s = setup({ getPermissionsAsync: async () => ({ granted: false, canAskAgain: false }) });
  await s.controller.start('zh-CN');
  assert.equal(s.calls.request, 0);
  assert.equal(s.calls.start.length, 0);
  assert.equal(s.calls.errors[0], 'permission');
  assert.equal(s.last().phase, 'idle');
  s.controller.dispose();
  const errors = [];
  const missing = createDictation({ getRecognizer: async () => null, onState() {}, onText() {}, onError: e => errors.push(e) });
  await missing.start('en-US');
  assert.deepEqual(errors, ['unavailable']);
  missing.dispose();
});

test('background preserves partial text while disposal discards it', async () => {
  const s = setup(); await s.controller.start('zh-CN');
  s.emit('result', result('保留草稿'));
  s.controller.background();
  s.emit('end');
  assert.deepEqual(s.calls.text, ['保留草稿']);
  s.controller.dispose();
  const gone = setup(); await gone.controller.start('en-US');
  gone.emit('result', result('Discard'));
  gone.controller.dispose(); gone.emit('end');
  assert.deepEqual(gone.calls.text, []);
});

test('finishing timeout preserves text once and drains old native session before restart', async () => {
  const s = setup(); await s.controller.start('en-US');
  s.emit('result', result('Keep me'));
  s.controller.finish(); s.fire(1200);
  assert.equal(s.calls.abort, 1);
  assert.deepEqual(s.calls.text, ['Keep me']);
  await s.controller.start('zh-CN');
  assert.equal(s.calls.start.length, 1);
  s.emit('result', result('Old callback'));
  s.emit('end');
  await s.controller.start('zh-CN');
  assert.equal(s.calls.start.length, 2);
  assert.deepEqual(s.calls.text, ['Keep me']);
  s.controller.dispose();
});

test('silence and network errors keep usable text and report a normalized error', async () => {
  const s = setup(); await s.controller.start('en-US');
  s.emit('result', result('Partial draft'));
  s.emit('error', { error: 'network', message: 'private native detail' });
  s.emit('end');
  assert.deepEqual(s.calls.text, ['Partial draft']);
  assert.deepEqual(s.calls.errors, ['network']);
  s.controller.dispose();
  const empty = setup(); await empty.controller.start('zh-CN'); empty.emit('nomatch'); empty.emit('end');
  assert.deepEqual(empty.calls.text, []);
  assert.deepEqual(empty.calls.errors, ['no-speech']);
  empty.controller.dispose();
});

test('volume is clamped and unexpected end preserves the draft', async () => {
  const s = setup(); await s.controller.start('en-US');
  s.emit('volumechange', { value: 20 }); assert.equal(s.last().volume, 1);
  s.emit('volumechange', { value: -2 }); assert.equal(s.last().volume, 0);
  s.emit('result', result('Unexpected stop')); s.emit('end');
  assert.deepEqual(s.calls.text, ['Unexpected stop']);
  s.controller.dispose();
});

test('Siri and dictation switched off is reported as unavailable, not as a denied permission', async () => {
  const s = setup(); await s.controller.start('zh-CN');
  s.emit('error', { error: 'service-not-allowed' });
  s.emit('end');
  assert.deepEqual(s.calls.errors, ['unavailable']);
  const denied = setup(); await denied.controller.start('zh-CN');
  denied.emit('error', { error: 'not-allowed' });
  denied.emit('end');
  assert.deepEqual(denied.calls.errors, ['permission']);
  s.controller.dispose(); denied.controller.dispose();
});
