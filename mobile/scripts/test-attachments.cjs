const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const load = Module._load;
Module._load = function (id, parent, ...args) {
  if (id === './i18n' && parent?.filename.endsWith('api.ts')) return { t: s => s };
  return load.call(this, id, parent, ...args);
};
const { createBridgeClient } = require('../src/api.ts');

(async () => {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const parts = [];
    for await (const part of req) parts.push(part);
    const bytes = Buffer.concat(parts);
    seen.push({ url: new URL(req.url, 'http://localhost'), headers: req.headers, bytes });
    res.setHeader('Content-Type', 'application/json');
    const name = seen.at(-1).url.searchParams.get('filename');
    if (name === 'fail.txt') { res.writeHead(413); res.end(JSON.stringify({ error: { code: 'too_large', message: 'too large' } })); return; }
    if (name === 'slow.txt') { await new Promise(r => setTimeout(r, 300)); }
    res.writeHead(201);
    res.end(JSON.stringify({ name, path: name === 'bad.txt' ? 'file:///phone/file.txt' : '/srv/hermes/attachments/upload.txt', bytes: bytes.length, mime: req.headers['content-type'] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = createBridgeClient(`http://127.0.0.1:${server.address().port}`, 'test-device');
    const bytes = Buffer.from('附件测试\nhello\u0000');
    const source = { kind: '文件', name: '新闻 空格.txt', size: '18 B', bytes: bytes.length, mimeType: 'text/plain', file: new Blob([bytes]), uri: 'file:///private/phone/file.txt' };
    const uploaded = await client.uploadAttachment(source);
    assert.equal(uploaded.path, '/srv/hermes/attachments/upload.txt');
    assert.equal(seen[0].url.pathname, '/v1/attachments');
    assert.equal(seen[0].url.searchParams.get('filename'), source.name);
    assert.equal(seen[0].headers.authorization, 'Bearer test-device');
    assert.equal(seen[0].headers['content-type'], 'text/plain');
    assert.deepEqual(seen[0].bytes, bytes, 'The bridge receives file bytes, not a URI or multipart envelope');
    await assert.rejects(client.uploadAttachment({ ...source, name: 'fail.txt' }), e => e.code === 'too_large' && e.status === 413);
    await assert.rejects(client.uploadAttachment({ ...source, name: 'bad.txt' }), e => e.code === 'bad_upload');
    const count = seen.length;
    for (const change of [{ bytes: 0 }, { bytes: 26 * 1024 * 1024 }, { file: undefined, uri: undefined }]) {
      await assert.rejects(client.uploadAttachment({ ...source, ...change }), e => e.code === 'bad_attachment');
    }
    assert.equal(seen.length, count, 'Invalid attachments never reach the network');
    const controller = new AbortController();
    const pending = client.uploadAttachment({ ...source, name: 'slow.txt' }, controller.signal);
    setTimeout(() => controller.abort(), 30);
    await assert.rejects(pending, e => e.code === 'cancelled');
    console.log('PASS: raw attachment transport, Unicode filename, authorization, size validation, server path validation, upload failure and cancellation');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
