const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Supervisor, retryDelay } = require('../supervisor.cjs');

function snapshot(status = 'failed', error = { message: 'HTTP 429 Too Many Requests' }, id = 'turn-1') {
  return { thread: { id: 'chat', kind: 'codex', hostId: 'local', title: 'Work', status: { type: status === 'inProgress' ? 'active' : 'idle', activeFlags: [] } },
    turns: [{ id, status, error, items: [] }] };
}

function fixture(initial = snapshot(), review) {
  let now = 100000;
  let data = null;
  let current = initial;
  const sent = [];
  const store = { load: () => structuredClone(data), save: value => { data = structuredClone(value); } };
  const desktop = { read: async () => current, send: async (...args) => { sent.push(args); return { status: 'sent' }; } };
  const make = () => new Supervisor({ desktop, store, review, clock: () => now, random: () => 0.5 });
  const supervisor = make();
  return { supervisor, desktop, sent, make, set: value => { current = value; }, advance: ms => { now += ms; }, saved: () => data };
}

const spec = { threadId: 'chat', hostId: 'local', goal: 'Finish the requested change and run its checks.', profile: 'default', reviewEnabled: false };

test('active retries, approval waits, manual stops and auth/quota failures never auto-send', async () => {
  for (const state of [snapshot('inProgress'), snapshot('interrupted'), snapshot('failed', { message: 'HTTP 401 invalid_api_key' }),
    snapshot('failed', { message: 'HTTP 429 insufficient_quota' }), snapshot('failed', { willRetry: true, message: 'HTTP 429' })]) {
    const f = fixture(state); await f.supervisor.start(spec); await f.supervisor.tick(); f.advance(1000000); await f.supervisor.tick();
    assert.equal(f.sent.length, 0, JSON.stringify(state.turns[0]));
  }
  const waiting = snapshot('inProgress'); waiting.thread.status.activeFlags = ['waitingOnApproval'];
  const f = fixture(waiting); await f.supervisor.start(spec); await f.supervisor.tick();
  assert.equal(f.supervisor.status().state, 'attention');
});

test('429 retries persist a deadline and recheck before one send without overriding Codex settings', async () => {
  const f = fixture(); await f.supervisor.start(spec); await f.supervisor.tick();
  assert.equal(f.sent.length, 0); assert.equal(f.saved().outbox.status, 'planned');
  f.advance(30000); await f.supervisor.tick(); await f.supervisor.tick();
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0][0], 'chat');
  assert.match(f.sent[0][1], /hermes-supervisor:/); assert.match(f.sent[0][1], /Finish the requested/);
  assert.equal(f.supervisor.status().attempts, 1);
});

test('backoff respects Retry-After seconds and dates and does not impose a retry-count ceiling', async () => {
  assert.equal(retryDelay({ retryAfter: '120' }, 1, 100000, () => 0.5), 120000);
  assert.equal(retryDelay({ retryAfter: new Date(280000).toUTCString() }, 1, 100000, () => 0.5), 180000);
  const f = fixture(); await f.supervisor.start(spec);
  for (let index = 0; index < 24; index++) {
    f.set(snapshot('failed', { message: 'HTTP 429' }, `turn-${index}`));
    await f.supervisor.tick(); f.advance(1000000); await f.supervisor.tick();
  }
  assert.equal(f.sent.length, 24); assert.equal(f.supervisor.status().attempts, 24);
});

test('restart keeps pending deadlines and pause or a newly running turn cancels pending retries', async () => {
  const f = fixture(); await f.supervisor.start(spec); await f.supervisor.tick();
  const restarted = f.make(); f.advance(30000); f.set(snapshot('inProgress', null, 'new-turn'));
  await restarted.tick(); assert.equal(f.sent.length, 0);
  f.set(snapshot()); await restarted.tick(); restarted.pause(); f.advance(1000000); await restarted.tick();
  assert.equal(f.sent.length, 0); assert.equal(restarted.status().enabled, false);
});

test('pause during final recheck invalidates a send', async () => {
  const f = fixture(); await f.supervisor.start(spec); await f.supervisor.tick(); f.advance(30000);
  f.desktop.read = async () => { f.supervisor.pause(); return snapshot(); };
  await f.supervisor.tick(); assert.equal(f.sent.length, 0);
});

test('ambiguous delivery and crash after dispatch reconcile a marker instead of duplicating', async () => {
  const f = fixture(); await f.supervisor.start(spec); await f.supervisor.tick(); f.advance(30000);
  f.desktop.send = async (...args) => { f.sent.push(args); throw Object.assign(new Error('lost ack'), { ambiguous: true }); };
  await f.supervisor.tick(); assert.equal(f.supervisor.status().state, 'deliveryUnknown');
  const restarted = f.make(); f.advance(999999); await restarted.tick(); assert.equal(f.sent.length, 1);
  const seen = snapshot('inProgress', null, 'new'); seen.turns[0].items.push({ type: 'userMessage', content: [{ type: 'text', text: f.sent[0][1] }] });
  f.set(seen); await restarted.tick(); assert.equal(restarted.status().state, 'watching'); assert.equal(f.sent.length, 1);
});

test('review is evidence-bound, throttled and discarded when pause or a newer turn arrives', async () => {
  let finish;
  let reviews = 0;
  const f = fixture(snapshot('completed', null), () => { reviews++; return new Promise(resolve => { finish = resolve; }); });
  await f.supervisor.start({ ...spec, reviewEnabled: true });
  const pending = f.supervisor.tick();
  await new Promise(resolve => setImmediate(resolve));
  f.supervisor.pause(); finish({ action: 'continue', approved: true, instruction: 'Run the missing tests.', analysis: 'Checks remain.' });
  await pending; assert.equal(f.sent.length, 0); assert.equal(reviews, 1);
});

test('semantic service failure is visible and does not stop deterministic retries', async () => {
  const f = fixture(snapshot('completed', null), async () => { throw new Error('TypeSafe unavailable'); });
  await f.supervisor.start({ ...spec, reviewEnabled: true }); await f.supervisor.tick();
  assert.equal(f.supervisor.status().review.status, 'unavailable');
  f.set(snapshot('failed', { message: 'HTTP 429' }, 'next')); await f.supervisor.tick(); f.advance(30000); await f.supervisor.tick();
  assert.equal(f.sent.length, 1);
});

test('newer desktop evidence invalidates approved review guidance before sending', async () => {
  const f = fixture(snapshot('completed', null), async () => {
    f.set(snapshot('inProgress', null, 'newer-turn'));
    return { action: 'correct', approved: true, analysis: 'A check was omitted.', instruction: 'Run checks.' };
  });
  await f.supervisor.start({ ...spec, reviewEnabled: true }); await f.supervisor.tick();
  assert.equal(f.sent.length, 0);
});

test('dispatched messages are never reissued while a new watch is being selected', async () => {
  const f = fixture(); await f.supervisor.start(spec); await f.supervisor.tick(); f.advance(30000);
  let finish;
  f.desktop.send = async () => new Promise(resolve => { finish = resolve; });
  const pending = f.supervisor.tick(); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.supervisor.start(spec), /delivery/i);
  finish({ status: 'sent' }); await pending;
});

test('review never marks an active turn complete or repeats identical evidence', async () => {
  let count = 0;
  const f = fixture(snapshot('inProgress', null), async () => { count++; return { action: 'complete', approved: true, analysis: 'Looks done', instruction: '' }; });
  await f.supervisor.start({ ...spec, reviewEnabled: true }); await f.supervisor.tick();
  f.advance(61000); await f.supervisor.tick();
  assert.equal(f.supervisor.status().enabled, true); assert.equal(count, 1);
});

test('delivery reconciliation finds its user marker even after a long tool-filled turn', async () => {
  const f = fixture(); await f.supervisor.start(spec); await f.supervisor.tick(); f.advance(30000);
  f.desktop.send = async (...args) => { f.sent.push(args); throw Object.assign(new Error('lost ack'), { ambiguous: true }); };
  await f.supervisor.tick();
  const seen = snapshot('inProgress', null, 'new');
  seen.turns[0].items = [{ type: 'userMessage', content: [{ type: 'text', text: f.sent[0][1] }] },
    ...Array.from({ length: 100 }, () => ({ type: 'commandExecution', command: 'checks', status: 'completed', exitCode: 0 }))];
  f.set(seen); await f.supervisor.tick();
  assert.equal(f.supervisor.status().state, 'watching'); assert.equal(f.sent.length, 1);
});

test('a slow model review does not block recovery of a newer failed turn', async () => {
  let finish;
  const f = fixture(snapshot('inProgress', null), () => new Promise(resolve => { finish = resolve; }));
  await f.supervisor.start({ ...spec, reviewEnabled: true });
  const review = f.supervisor.tick(); await new Promise(resolve => setImmediate(resolve));
  f.set(snapshot('failed', { message: 'HTTP 429' }, 'newer-failure'));
  await f.supervisor.tick(); f.advance(30000); await f.supervisor.tick();
  const sends = f.sent.length;
  finish({ action: 'correct', approved: true, analysis: 'Old evidence', instruction: 'An outdated correction' });
  await review;
  assert.equal(sends, 1); assert.equal(f.sent.length, 1);
  assert.notEqual(f.supervisor.status().review.analysis, 'Old evidence');
});

test('a completion judgment cannot stop a newer active turn', async () => {
  const f = fixture(snapshot('completed', null), async () => {
    f.set(snapshot('inProgress', null, 'newer-turn'));
    return { action: 'complete', approved: true, analysis: 'The previous turn was done', instruction: '' };
  });
  await f.supervisor.start({ ...spec, reviewEnabled: true }); await f.supervisor.tick();
  assert.equal(f.supervisor.status().enabled, true);
  assert.notEqual(f.supervisor.status().state, 'completed');
});

test('a rejected guidance send respects its backoff before another attempt', async () => {
  const f = fixture(snapshot('completed', null), async () => ({ action: 'continue', approved: true, analysis: 'Checks missing', instruction: 'Run tests' }));
  f.desktop.send = async (...args) => { f.sent.push(args); throw new Error('Connection not ready'); };
  await f.supervisor.start({ ...spec, reviewEnabled: true }); await f.supervisor.tick();
  assert.equal(f.sent.length, 1);
  await f.supervisor.tick(); assert.equal(f.sent.length, 1);
  f.advance(30000); await f.supervisor.tick(); assert.equal(f.sent.length, 2);
});

test('resuming a paused uncertain delivery reconciles the same chat without resending', async () => {
  const f = fixture(); await f.supervisor.start(spec); await f.supervisor.tick(); f.advance(30000);
  f.desktop.send = async (...args) => { f.sent.push(args); throw Object.assign(new Error('lost ack'), { ambiguous: true }); };
  await f.supervisor.tick(); f.supervisor.pause();
  await assert.rejects(f.supervisor.start({ ...spec, threadId: 'other-chat' }), /delivery/i);
  const resumed = await f.supervisor.start(spec);
  assert.equal(resumed.enabled, true); assert.equal(resumed.state, 'deliveryUnknown');
  f.advance(1000000); await f.supervisor.tick(); assert.equal(f.sent.length, 1);
  const seen = snapshot('inProgress', null, 'accepted-turn');
  seen.turns[0].items.push({ type: 'userMessage', content: [{ type: 'text', text: f.sent[0][1] }] });
  f.set(seen); await f.supervisor.tick();
  assert.equal(f.supervisor.status().state, 'watching'); assert.equal(f.sent.length, 1);
});
