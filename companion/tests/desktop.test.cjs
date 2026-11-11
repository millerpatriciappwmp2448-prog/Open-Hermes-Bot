const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function peer(t, answer) {
  const endpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\hermes-test-${randomUUID()}`
    : path.join(os.tmpdir(), `hermes-${randomUUID()}.sock`);
  const clients = new Set();
  const server = net.createServer(socket => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
        const length = buffer.readUInt32LE(0);
        const request = JSON.parse(buffer.subarray(4, length + 4));
        buffer = buffer.subarray(length + 4);
        const result = answer(request);
        if (result === null) { socket.destroy(); return; }
        if (result === undefined) continue;
        const body = Buffer.from(JSON.stringify({ id: request.id, jsonrpc: '2.0', ...result }));
        const frame = Buffer.alloc(4 + body.length);
        frame.writeUInt32LE(body.length); body.copy(frame, 4);
        socket.write(frame.subarray(0, 2));
        setImmediate(() => { if (!socket.destroyed) socket.write(frame.subarray(2)); });
      }
    });
  });
  await new Promise(resolve => server.listen(endpoint, resolve));
  t.after(() => { for (const client of clients) client.destroy(); server.close(); });
  return endpoint;
}

const catalog = { result: { tools: ['list_threads', 'read_thread', 'send_message_to_thread'].map(name => ({ name, namespace: 'codex_app' })) } };
const text = data => ({ result: { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(data) }] } });

test('desktop transport validates tools and reads the active chat across split frames', async t => {
  const { DesktopClient } = require('../desktop.cjs');
  const pipePath = await peer(t, request => {
    if (request.method === 'tools/list') return catalog;
    assert.equal(request.params.callerSource, 'codex');
    assert.equal(request.params.threadId, 'authorizing-chat');
    assert.equal(request.params.tool, 'read_thread');
    assert.equal(request.params.arguments.threadId, 'selected-chat');
    return text({ thread: { id: 'selected-chat', status: { type: 'active' } }, turns: [{ id: 't1', status: 'inProgress', error: null, items: [] }] });
  });
  const client = new DesktopClient({ pipePath, callerThreadId: 'authorizing-chat' });
  t.after(() => client.close());
  const value = await client.read('selected-chat');
  assert.equal(value.thread.status.type, 'active');
  assert.equal(value.turns[0].id, 't1');
});

test('desktop listing keeps Codex chats and sends without overriding model settings', async t => {
  const { DesktopClient } = require('../desktop.cjs');
  const pipePath = await peer(t, request => {
    if (request.method === 'tools/list') return catalog;
    if (request.params.tool === 'list_threads') return text({ pinnedThreads: [{ id: 'p', kind: 'codex' }], threads: [{ id: 'c', kind: 'codex' }, { id: 'g', kind: 'chatgpt' }] });
    assert.deepEqual(request.params.arguments, { threadId: 'c', hostId: 'local', prompt: 'Continue the task.' });
    return text({ status: 'sent' });
  });
  const client = new DesktopClient({ pipePath, callerThreadId: 'authorizing-chat' });
  t.after(() => client.close());
  assert.deepEqual((await client.list()).map(row => row.id), ['p', 'c']);
  assert.equal((await client.send('c', 'Continue the task.', 'local')).status, 'sent');
});

test('desktop listing normalizes live string statuses and preserves detailed attention flags', async t => {
  const { DesktopClient } = require('../desktop.cjs');
  const pipePath = await peer(t, request => {
    if (request.method === 'tools/list') return catalog;
    assert.equal(request.params.tool, 'list_threads');
    return text({
      pinnedThreads: [{ id: 'active', kind: 'codex', hostId: 'local', title: 'Running task', status: 'active' }],
      threads: [
        { id: 'active', kind: 'codex', status: 'active' },
        { id: 'idle', kind: 'codex', status: 'idle' },
        { id: 'approval', kind: 'codex', status: { type: 'needsAttention', activeFlags: ['waitingOnApproval'] } },
      ],
    });
  });
  const client = new DesktopClient({ pipePath, callerThreadId: 'authorizing-chat' });
  t.after(() => client.close());
  const chats = await client.list();
  assert.deepEqual(chats.map(chat => chat.status), [
    { type: 'active' }, { type: 'idle' }, { type: 'needsAttention', activeFlags: ['waitingOnApproval'] },
  ]);
  assert.equal(chats[0].title, 'Running task');
});

test('desktop listing includes pinned chats absent from history and keeps current metadata', async t => {
  const { DesktopClient } = require('../desktop.cjs');
  const pipePath = await peer(t, request => {
    if (request.method === 'tools/list') return catalog;
    assert.equal(request.params.tool, 'list_threads');
    if (request.params.arguments.mode === 'recent') return text({
      pinnedThreads: [{ id: 'pin', kind: 'codex', hostId: 'local', title: 'Pinned task', status: 'notLoaded' }],
      threads: [
        { id: 'running', kind: 'codex', hostId: 'local', title: 'Current title', status: 'active' },
        { id: 'remote', kind: 'codex', hostId: 'another-host', title: 'Remote task' },
        { id: 'chatgpt', kind: 'chatgpt', hostId: 'local', title: 'Other source' },
      ],
    });
    assert.equal(request.params.arguments.mode, 'history');
    return text({ threads: [
      { id: 'running', kind: 'codex', hostId: 'local', title: 'Old title', status: 'idle' },
      { id: 'older', kind: 'codex', hostId: 'local', title: 'Older task' },
    ] });
  });
  const client = new DesktopClient({ pipePath, callerThreadId: 'authorizing-chat' });
  t.after(() => client.close());
  const chats = await client.list();
  assert.deepEqual(chats.map(row => row.id), ['pin', 'running', 'older']);
  assert.equal(chats[1].title, 'Current title');
  assert.equal(chats[1].status.type, 'active');
});

for (const failedMode of ['recent', 'history']) {
  test(`desktop listing retains available chats when ${failedMode} fails`, async t => {
    const { DesktopClient } = require('../desktop.cjs');
    const pipePath = await peer(t, request => {
      if (request.method === 'tools/list') return catalog;
      if (request.params.arguments.mode === failedMode) return { result: {
        success: false, contentItems: [{ type: 'inputText', text: 'Temporary list failure' }],
      } };
      return text({ threads: [{ id: 'available', kind: 'codex', title: 'Available task' }] });
    });
    const client = new DesktopClient({ pipePath, callerThreadId: 'authorizing-chat' });
    t.after(() => client.close());
    assert.deepEqual((await client.list()).map(row => row.id), ['available']);
  });
}

test('desktop listing reports an error when neither source can be read', async t => {
  const { DesktopClient } = require('../desktop.cjs');
  const pipePath = await peer(t, request => request.method === 'tools/list' ? catalog : {
    result: { success: false, contentItems: [{ type: 'inputText', text: 'Desktop list unavailable' }] },
  });
  const client = new DesktopClient({ pipePath, callerThreadId: 'authorizing-chat' });
  t.after(() => client.close());
  await assert.rejects(client.list(), /Desktop list unavailable/);
});

test('missing required tools fail before sending anything', async t => {
  const { DesktopClient } = require('../desktop.cjs');
  const pipePath = await peer(t, request => {
    assert.equal(request.method, 'tools/list');
    return { result: { tools: [] } };
  });
  const client = new DesktopClient({ pipePath, callerThreadId: 'authorizing-chat' });
  t.after(() => client.close());
  await assert.rejects(client.send('chat', 'continue'), /required.*tools/i);
});

test('connection loss after dispatch is reported as ambiguous rather than resent', async t => {
  const { DesktopClient } = require('../desktop.cjs');
  let sends = 0;
  const pipePath = await peer(t, request => {
    if (request.method === 'tools/list') return catalog;
    sends += 1; return null;
  });
  const client = new DesktopClient({ pipePath, callerThreadId: 'authorizing-chat', timeoutMs: 100 });
  t.after(() => client.close());
  await assert.rejects(client.send('chat', 'continue'), error => error.ambiguous === true);
  assert.equal(sends, 1);
});

test('tool failure and stalled requests reject without leaving a pending connection', async t => {
  const { DesktopClient } = require('../desktop.cjs');
  let fail = true;
  const pipePath = await peer(t, request => {
    if (request.method === 'tools/list') return catalog;
    if (fail) { fail = false; return { result: { success: false, contentItems: [{ type: 'inputText', text: 'Chat unavailable' }] } }; }
  });
  const client = new DesktopClient({ pipePath, callerThreadId: 'authorizing-chat', timeoutMs: 100 });
  t.after(() => client.close());
  await assert.rejects(client.read('chat'), /Chat unavailable/);
  await assert.rejects(client.read('chat'), /timed out/);
});
