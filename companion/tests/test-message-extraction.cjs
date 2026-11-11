const { strict: assert } = require('node:assert');
const { extractMessages, projectName } = require('../messages.cjs');

// Shape returned by Codex read_thread: newest turn first, items chronological.
const thread = {
  schemaVersion: 1,
  page: { order: 'newest_first' },
  turns: [
    { items: [
      { type: 'userMessage', text: '第二个问题' },
      { type: 'reasoning', text: '' },
      { type: 'commandExecution', command: 'npm test', output: 'ok' },
      { type: 'agentMessage', phase: 'commentary', text: '正在运行测试。' },
      { type: 'fileChange', changes: [{ path: 'a.ts' }] },
      { type: 'agentMessage', phase: 'final_answer', text: '测试已通过。' },
    ] },
    { items: [
      { type: 'userMessage', text: '第一个问题' },
      { type: 'agentMessage', phase: '', text: '  ' },
      { type: 'mcpToolCall', tool: 'x' },
      { type: 'agentMessage', phase: 'final_answer', text: '第一轮回答。' },
    ] },
  ],
};

assert.deepEqual(extractMessages(thread), [
  { role: 'assistant', phase: 'final', content: '第一轮回答。' },
  { role: 'assistant', phase: 'progress', content: '正在运行测试。' },
  { role: 'assistant', phase: 'final', content: '测试已通过。' },
]);

assert.deepEqual(extractMessages(null), []);
assert.deepEqual(extractMessages({ turns: [{ response: { items: [{ type: 'text', text: 'old' }] } }] }), []);

const many = { page: { order: 'newest_first' }, turns: Array.from({ length: 12 }, (_, i) => ({
  items: [{ type: 'agentMessage', phase: 'final_answer', text: `回答 ${12 - i}` }],
})) };
const limited = extractMessages(many);
assert.equal(limited.length, 8);
assert.equal(limited[0].content, '回答 5');
assert.equal(limited[7].content, '回答 12');

const long = extractMessages({ turns: [{ items: [{ type: 'agentMessage', text: 'x'.repeat(50) }] }] }, { maxChars: 10 });
assert.equal(long[0].content, `${'x'.repeat(10)}…`);

assert.equal(projectName('D:\\AI Projects\\Open-Hermes-Bot\\'), 'Open-Hermes-Bot');
assert.equal(projectName('/home/ubuntu/hermes'), 'hermes');
assert.equal(projectName(''), '');

console.log('message extraction: all checks passed');
