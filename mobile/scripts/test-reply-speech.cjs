const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./helpers/native-screen-harness.cjs');
const { createReplySpeaker, speechChunks } = require('../src/replySpeech.ts');
const reply = { host: 'https://host.invalid', botId: 'atlas', threadId: 'bot:atlas', sessionId: 's1', requestId: 'r1', text: '完整回复。' };
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
function setup() {
  const state = { enabled: true, foreground: true, viewingThread: 'bot:atlas', host: reply.host };
  const calls = []; let stops = 0, fail = false, stopFailure = false;
  const speaker = createReplySpeaker({ state: () => state, maxLength: 18,
    speak: (text, callbacks) => { if (fail) throw Error('native TTS unavailable'); calls.push({ text, callbacks }); },
    stop: async () => { stops++; if (stopFailure) throw Error('cannot stop'); },
  });
  return { state, calls, speaker, get stops() { return stops; }, fail: () => { fail = true; }, stopFailure: () => { stopFailure = true; } };
}
test('only opted-in, visible, foreground replies are spoken once', async () => {
  for (const state of [{ enabled: false }, { foreground: false }, { viewingThread: null }, { host: 'https://other.invalid' }]) {
    const f = setup(); Object.assign(f.state, state);
    await f.speaker.complete(reply); await flush(); assert.equal(f.calls.length, 0);
    Object.assign(f.state, { enabled: true, foreground: true, viewingThread: reply.threadId, host: reply.host });
    await f.speaker.complete(reply); await flush(); assert.equal(f.calls.length, 0, 'no replay after returning');
  }
  const f = setup(); await Promise.all([f.speaker.complete(reply), f.speaker.complete(reply)]); await flush();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].text, reply.text);
});
test('long replies are read in bounded chunks without losing text or splitting emoji', async () => {
  const text = '先看今天的新闻。😀 Here is the full reply. ' .repeat(8);
  const parts = speechChunks(text, 18);
  assert.equal(parts.join(''), text);
  for (const part of parts) {
    assert.ok(part.length <= 18);
    assert.ok(!/[\uD800-\uDBFF]$/.test(part));
    assert.ok(!/^[\uDC00-\uDFFF]/.test(part));
  }
  const f = setup(); await f.speaker.complete({ ...reply, text }); await flush();
  for (let i = 0; i < parts.length; i++) {
    assert.equal(f.calls[i]?.text, parts[i]);
    f.calls[i].callbacks.onDone(); await flush();
  }
  assert.equal(f.calls.length, parts.length);
});
test('navigation, mute, host changes and background cancel all remaining speech', async () => {
  for (const change of [{ viewingThread: null }, { enabled: false }, { host: 'https://other.invalid' }, { foreground: false }]) {
    const f = setup(); await f.speaker.complete({ ...reply, text: 'A long reply that needs several chunks.' }); await flush();
    assert.equal(f.calls.length, 1);
    const before = f.stops;
    Object.assign(f.state, change); f.speaker.reconcile(); await flush();
    assert.ok(f.stops > before);
    f.calls[0].callbacks.onDone(); await flush(); assert.equal(f.calls.length, 1);
  }
});
test('pending completion cannot start after cancellation and late native callbacks cannot restart speech', async () => {
  const f = setup(); const first = f.speaker.complete(reply); f.speaker.cancel(); await first; await flush();
  assert.equal(f.calls.length, 0);
  await f.speaker.complete({ ...reply, requestId: 'r2', text: 'A long reply that needs several chunks.' }); await flush();
  const old = f.calls[0];
  await f.speaker.complete({ ...reply, requestId: 'r3', text: 'new reply' }); await flush();
  old.callbacks.onDone(); old.callbacks.onStopped(); await flush();
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].text, 'new reply');
});
test('a repeated native completion callback cannot skip or overlap chunks', async () => {
  const f = setup(); const text = 'One sentence. Two sentences. Three sentences.';
  await f.speaker.complete({ ...reply, text }); await flush();
  const first = f.calls[0]; first.callbacks.onDone(); first.callbacks.onDone(); await flush();
  assert.equal(f.calls.length, 2, 'advance exactly once for each utterance');
  first.callbacks.onStopped(); f.calls[1].callbacks.onDone(); await flush();
  assert.equal(f.calls.length, 3, 'an old stop cannot cancel the following chunk');
});
test('native failure or interruption ends speech without rejecting a completed Hermes reply', async () => {
  const f = setup(); f.fail(); await assert.doesNotReject(f.speaker.complete(reply));
  const g = setup(); g.stopFailure(); await assert.doesNotReject(g.speaker.complete(reply));
  for (const event of ['onStopped', 'onError']) {
    const h = setup(); await h.speaker.complete({ ...reply, text: 'A long reply that needs several chunks.' }); await flush();
    h.calls[0].callbacks[event](Error('interrupted')); h.calls[0].callbacks.onDone(); await flush();
    assert.equal(h.calls.length, 1);
  }
});
