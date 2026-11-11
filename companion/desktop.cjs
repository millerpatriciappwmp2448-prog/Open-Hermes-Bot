const net = require('node:net');
const { randomUUID } = require('node:crypto');

const MAX_FRAME = 8 * 1024 * 1024;
const REQUIRED = ['list_threads', 'read_thread', 'send_message_to_thread'];

class DesktopClient {
  constructor({ pipePath, callerThreadId, timeoutMs = 20000 }) {
    if (!pipePath || !callerThreadId) throw new Error('Codex desktop pipe and authorizing chat are required.');
    this.pipePath = pipePath;
    this.callerThreadId = callerThreadId;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
  }

  async connect() {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const socket = net.createConnection(this.pipePath);
      const timer = setTimeout(() => socket.destroy(new Error('Codex desktop connection timed out.')), this.timeoutMs);
      socket.once('error', reject);
      socket.once('connect', () => {
        clearTimeout(timer);
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        socket.on('data', chunk => this.onData(socket, chunk));
        resolve();
      });
      socket.on('error', error => { clearTimeout(timer); this.disconnected(socket, error); });
      socket.on('close', () => { clearTimeout(timer); this.disconnected(socket, new Error('Codex desktop connection closed.')); });
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  disconnected(socket, error) {
    if (this.socket !== socket) return;
    this.socket = null;
    this.catalog = null;
    this.buffer = Buffer.alloc(0);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    socket.destroy();
  }

  onData(socket, chunk) {
    if (socket !== this.socket) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length === 0 || length > MAX_FRAME) {
        this.disconnected(socket, new Error('Invalid Codex desktop frame size.')); return;
      }
      if (this.buffer.length < length + 4) return;
      const payload = this.buffer.subarray(4, length + 4);
      this.buffer = this.buffer.subarray(length + 4);
      let message;
      try { message = JSON.parse(payload); }
      catch { this.disconnected(socket, new Error('Invalid Codex desktop response.')); return; }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(String(message.error.message || 'Codex desktop refused the request.')));
      else pending.resolve(message.result);
    }
  }

  async request(method, params, mutation = false) {
    await this.connect();
    const socket = this.socket;
    const id = this.nextId++;
    const body = Buffer.from(JSON.stringify({ id, jsonrpc: '2.0', method, params }));
    if (body.length > MAX_FRAME) throw new Error('Codex desktop request is too large.');
    const frame = Buffer.alloc(4 + body.length);
    frame.writeUInt32LE(body.length); body.copy(frame, 4);
    return new Promise((resolve, reject) => {
      let dispatched = false;
      const fail = error => {
        clearTimeout(timer);
        if (mutation && dispatched) error.ambiguous = true;
        reject(error);
      };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        fail(new Error('Codex desktop request timed out.'));
        this.disconnected(socket, new Error('Codex desktop request timed out.'));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: fail });
      dispatched = true;
      socket.write(frame, error => {
        if (error && this.pending.delete(id)) fail(error);
      });
    });
  }

  async tools() {
    if (!this.catalog) {
      this.catalog = this.request('tools/list', { threadStartKind: 'all' }).then(result => {
        const tools = result?.tools;
        if (!Array.isArray(tools) || REQUIRED.some(name => !tools.some(tool => tool.name === name && tool.namespace === 'codex_app'))) {
          throw new Error('Codex desktop is missing required app tools. Update or reconnect the desktop integration.');
        }
        return tools;
      }).catch(error => { this.catalog = null; throw error; });
    }
    return this.catalog;
  }

  async call(tool, args) {
    await this.tools();
    const result = await this.request('tools/call', {
      arguments: args,
      callerSource: 'codex',
      callId: randomUUID(),
      namespace: 'codex_app',
      threadId: this.callerThreadId,
      tool,
      turnId: randomUUID(),
    }, tool === 'send_message_to_thread');
    const text = result?.contentItems?.filter(item => item.type === 'inputText').map(item => item.text).join('\n');
    if (result?.success !== true) throw new Error(text || 'Codex desktop tool failed.');
    try { return JSON.parse(text); }
    catch {
      if (tool === 'send_message_to_thread') return { status: 'accepted', message: text };
      throw new Error('Codex desktop returned an unsupported chat response.');
    }
  }

  async list() {
    // History omits some pinned chats. The current sidebar includes them and
    // carries fresher titles/statuses; history adds older local conversations.
    const results = await Promise.allSettled([
      this.call('list_threads', { mode: 'recent', limit: 50 }),
      this.call('list_threads', { mode: 'history', source: 'codex', hostId: 'local', limit: 50 }),
    ]);
    if (results.every(result => result.status === 'rejected')) throw results[0].reason;
    const rows = results.flatMap(result => result.status === 'fulfilled'
      ? [...(result.value.pinnedThreads || []), ...(result.value.threads || [])] : []);
    const seen = new Set();
    return rows.filter(row => {
      if (!row || row.kind !== 'codex' || (row.hostId && row.hostId !== 'local') ||
          typeof row.id !== 'string' || !row.id || seen.has(row.id)) return false;
      seen.add(row.id); return true;
    })
      .map(({ id, kind, hostId, title, status, cwd }) => ({
        id, kind, hostId, title, cwd,
        status: typeof status === 'string' ? { type: status } : status,
      }));
  }

  read(threadId, hostId = 'local') {
    return this.call('read_thread', { threadId, hostId, turnLimit: 3, includeOutputs: true, maxOutputCharsPerItem: 3000 });
  }

  send(threadId, prompt, hostId = 'local') {
    return this.call('send_message_to_thread', { threadId, hostId, prompt });
  }

  close() {
    if (this.socket) this.disconnected(this.socket, new Error('Codex desktop client stopped.'));
  }
}

module.exports = { DesktopClient };
