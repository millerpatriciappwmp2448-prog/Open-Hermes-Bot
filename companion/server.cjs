const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { DesktopClient } = require('./desktop.cjs');
const { Supervisor, observation } = require('./supervisor.cjs');
const { JsonStore } = require('./store.cjs');
const { createReviewer } = require('./reviewer.cjs');

const MAX_BODY = 64 * 1024;
const authorized = (actual, expected) => {
  const left = Buffer.from(actual || ''), right = Buffer.from(`Bearer ${expected}`);
  return left.length === right.length && timingSafeEqual(left, right);
};

function createServer({ token, desktop, supervisor }) {
  if (!token) throw new Error('A companion authentication token is required.');
  return http.createServer(async (request, response) => {
    function json(status, value) {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Connection: 'close' });
      response.end(JSON.stringify(value));
    }
    try {
      if (!authorized(request.headers.authorization, token)) { json(401, { error: { code: 'unauthorized', message: 'Companion authentication is required.' } }); return; }
      if (request.headers.origin) { json(403, { error: { code: 'origin', message: 'Use the paired Hermes bridge.' } }); return; }
      const route = `${request.method} ${request.url}`;
      if (route === 'GET /status') { json(200, supervisor.status()); return; }
      if (route === 'GET /threads') { json(200, { threads: await desktop.list() }); return; }
      if (!['POST /watch', 'POST /pause', 'POST /read'].includes(route)) { json(404, { error: { code: 'not_found', message: 'Unknown companion operation.' } }); return; }
      let raw = '';
      for await (const chunk of request) {
        raw += chunk.toString('utf8');
        if (Buffer.byteLength(raw) > MAX_BODY) { json(413, { error: { code: 'too_large', message: 'Request is too large.' } }); return; }
      }
      let body;
      try { body = JSON.parse(raw || '{}'); } catch { throw Object.assign(new Error('Send a JSON object.'), { status: 400 }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Send a JSON object.'), { status: 400 });
      if (route === 'POST /read') {
        if (typeof body.threadId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(body.threadId) ||
            Object.keys(body).some(key => key !== 'threadId')) throw Object.assign(new Error('Choose one local Codex chat.'), { status: 400 });
        json(200, { observed: observation(await desktop.read(body.threadId, 'local'), body.threadId) }); return;
      }
      json(200, route === 'POST /watch' ? await supervisor.start(body) : supervisor.pause());
    } catch (error) {
      const status = error.status || 502;
      json(status, { error: { code: status === 400 ? 'bad_watch' : 'companion_unavailable', message: status < 500 ? error.message : 'The Codex desktop connection is unavailable. Reconnect the local companion.' } });
    }
  });
}

function stateDirectory() {
  return process.env.HERMES_CODEX_HOME || path.join(process.env.HERMES_HOME || path.join(os.homedir(), '.hermes'), 'codex-supervisor');
}

function register(directory) {
  const pipePath = process.env.CODEX_APP_TOOLS_PIPE_PATH;
  const callerThreadId = process.env.CODEX_THREAD_ID;
  if (!pipePath || !callerThreadId) throw new Error('Run registration from a Codex desktop chat with app tools enabled.');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'connection.json'), JSON.stringify({ pipePath, callerThreadId }), { mode: 0o600 });
}

function readConnection(directory) {
  const connection = JSON.parse(fs.readFileSync(path.join(directory, 'connection.json'), 'utf8'));
  if (typeof connection.pipePath !== 'string' || typeof connection.callerThreadId !== 'string') throw new Error('Register the Codex desktop connection again.');
  return connection;
}

async function main() {
  const directory = stateDirectory();
  if (process.argv.includes('--register')) { register(directory); console.log('Codex desktop connection registered.'); return; }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.env.CODEX_APP_TOOLS_PIPE_PATH && process.env.CODEX_THREAD_ID) register(directory);
  const connection = readConnection(directory);
  const tokenFile = path.join(directory, 'token');
  if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  const desktop = new DesktopClient(connection);
  const review = createReviewer({ bridgeUrl: process.env.HERMES_CODEX_BRIDGE_URL,
    bridgeToken: process.env.HERMES_CODEX_BRIDGE_TOKEN });
  const supervisor = new Supervisor({ desktop, review, store: new JsonStore(directory) });
  const port = Number(process.env.HERMES_CODEX_PORT || 8770);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('HERMES_CODEX_PORT must be a valid local port.');
  const server = createServer({ token, desktop, supervisor });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const timer = setInterval(() => {
    try {
      const latest = readConnection(directory);
      if (latest.pipePath !== desktop.pipePath || latest.callerThreadId !== desktop.callerThreadId) {
        desktop.close(); desktop.pipePath = latest.pipePath; desktop.callerThreadId = latest.callerThreadId;
      }
    } catch { /* A transient registration write is retried on the next poll. */ }
    void supervisor.tick();
  }, 10000);
  const stop = () => { clearInterval(timer); desktop.close(); server.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  console.log(`Codex companion listening on 127.0.0.1:${port}. No watch is enabled automatically.`);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { createServer, register, stateDirectory };
