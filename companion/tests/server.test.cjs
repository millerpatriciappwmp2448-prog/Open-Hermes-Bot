const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server.cjs');

test('host API authenticates, keeps configuration secrets private and accepts only fixed operations', async t => {
  let starts = 0, pauses = 0;
  const server = createServer({ token: 'test-only-secret', desktop: { list: async () => [{ id: 'chat', title: 'Work' }] },
    supervisor: { status: () => ({ enabled: false, state: 'stopped' }), start: async spec => { starts++; return { spec }; }, pause: () => { pauses++; return { enabled: false }; } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${url}/status`)).status, 401);
  const headers = { Authorization: 'Bearer test-only-secret', 'Content-Type': 'application/json' };
  const status = await fetch(`${url}/status`, { headers });
  assert.equal(status.status, 200); assert.equal((await status.text()).includes('test-only-secret'), false);
  assert.deepEqual((await (await fetch(`${url}/threads`, { headers })).json()).threads, [{ id: 'chat', title: 'Work' }]);
  await fetch(`${url}/watch`, { method: 'POST', headers, body: JSON.stringify({ threadId: 'chat' }) });
  await fetch(`${url}/pause`, { method: 'POST', headers, body: '{}' });
  assert.equal(starts, 1); assert.equal(pauses, 1);
  assert.equal((await fetch(`${url}/send`, { method: 'POST', headers, body: '{}' })).status, 404);
  assert.equal((await fetch(`${url}/watch`, { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await fetch(`${url}/watch`, { method: 'POST', headers, body: JSON.stringify({ goal: 'x'.repeat(70000) }) })).status, 413);
});

test('bounded chat reads observe an active target without sending or starting work', async t => {
  const reads = [];
  const server = createServer({ token: 'private', desktop: { read: async (id, host) => {
    reads.push([id, host]);
    return { thread: { id, title: 'Current work', status: { type: 'active' } }, turns: [{ id: 'turn', status: 'inProgress', items: [] }] };
  } }, supervisor: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/read`;
  const headers = { Authorization: 'Bearer private', 'Content-Type': 'application/json' };
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ threadId: 'work' }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.observed.turnStatus, 'inProgress');
  assert.deepEqual(reads, [['work', 'local']]);
  assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ threadId: '../invalid' }) })).status, 400);
});
