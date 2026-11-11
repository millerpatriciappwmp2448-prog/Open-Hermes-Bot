const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server.cjs');

test('host API authenticates, keeps configuration secrets private and accepts only fixed operations', async t => {
  let starts = 0, pauses = 0;
  const sent = [];
  const sidebar = { threads: [{ id: 'chat', title: 'Work', cwd: 'D:\\Code\\Atlas', projectId: 'p1', updatedAt: 1000, pinnedIndex: null, isUnread: false, summary: '', status: { type: 'idle' } }],
    sections: [{ id: 'threads', name: 'Projects', items: ['codex:project:p1'] }], projects: [{ id: 'p1', label: 'Atlas', path: 'D:\\Code\\Atlas' }],
    sorting: { chats: 'updated_at', projects: 'updated_at' } };
  const server = createServer({ token: 'test-only-secret', desktop: {
    sidebar: async () => sidebar,
    send: async (id, prompt, host) => { sent.push([id, prompt, host]); if (prompt === 'lost') throw Object.assign(new Error('timeout'), { ambiguous: true }); return { status: 'sent' }; },
    read: async () => ({ page: { order: 'newest_first' }, thread: { status: { type: 'idle' } }, turns: [{ status: 'completed', items: [
      { type: 'userMessage', content: [{ type: 'text', text: 'Check it [hermes-supervisor:00000000-0000-0000-0000-000000000000]' }] },
      { type: 'commandExecution', command: 'ls' },
      { type: 'agentMessage', phase: 'final_answer', text: 'Done.' },
    ] }] }) },
    supervisor: { status: () => ({ enabled: false, state: 'stopped' }), start: async spec => { starts++; return { spec }; }, pause: () => { pauses++; return { enabled: false }; } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${url}/status`)).status, 401);
  const headers = { Authorization: 'Bearer test-only-secret', 'Content-Type': 'application/json' };
  const status = await fetch(`${url}/status`, { headers });
  assert.equal(status.status, 200); assert.equal((await status.text()).includes('test-only-secret'), false);
  assert.deepEqual(await (await fetch(`${url}/threads`, { headers })).json(), sidebar);
  const messages = await (await fetch(`${url}/messages`, { method: 'POST', headers, body: JSON.stringify({ threadId: 'chat' }) })).json();
  assert.deepEqual(messages, { status: 'idle', turnStatus: 'completed', messages: [
    { role: 'user', phase: 'prompt', content: 'Check it' },
    { role: 'assistant', phase: 'final', content: 'Done.' },
  ] });
  assert.equal((await fetch(`${url}/messages`, { method: 'POST', headers, body: JSON.stringify({ threadId: '../x' }) })).status, 400);
  await fetch(`${url}/watch`, { method: 'POST', headers, body: JSON.stringify({ threadId: 'chat' }) });
  await fetch(`${url}/pause`, { method: 'POST', headers, body: '{}' });
  assert.equal(starts, 1); assert.equal(pauses, 1);
  assert.equal((await fetch(`${url}/send`, { method: 'POST', headers, body: '{}' })).status, 400);
  assert.equal((await fetch(`${url}/send`, { method: 'POST', headers, body: JSON.stringify({ threadId: 'chat', prompt: '   ' }) })).status, 400);
  assert.equal((await fetch(`${url}/send`, { method: 'POST', headers, body: JSON.stringify({ threadId: 'chat', prompt: 'x', model: 'y' }) })).status, 400);
  assert.equal((await fetch(`${url}/send`, { method: 'POST', headers, body: JSON.stringify({ threadId: 'chat', prompt: 'x'.repeat(8001) }) })).status, 400);
  assert.deepEqual(await (await fetch(`${url}/send`, { method: 'POST', headers, body: JSON.stringify({ threadId: 'chat', prompt: '  继续  ' }) })).json(), { status: 'sent' });
  assert.deepEqual(await (await fetch(`${url}/send`, { method: 'POST', headers, body: JSON.stringify({ threadId: 'chat', prompt: 'lost' }) })).json(), { status: 'ambiguous' });
  assert.deepEqual(sent, [['chat', '继续', 'local'], ['chat', 'lost', 'local']]);
  assert.equal((await fetch(`${url}/delete`, { method: 'POST', headers, body: '{}' })).status, 404);
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
