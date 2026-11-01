const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, filename);
const {parseTodos, countTodos, dockVisible, currentTodo, todoDepth, sameTodos} = require('../src/taskDock.ts');

// Malformed rows are dropped, unknown states wait, a step cannot be its own parent.
assert.deepEqual(parseTodos(null), []);
assert.deepEqual(parseTodos({id: '1'}), []);
const list = parseTodos([
  {id: '1', content: ' 查资料 ', status: 'completed'},
  null,
  'text',
  {id: '2', content: '', status: 'pending'},
  {id: '3', content: '写摘要', status: 'in_progress', parent: '1'},
  {id: '4', content: '推送', status: 'weird', parent: '4'},
  {id: '5', content: '放弃', status: 'cancelled'},
]);
assert.deepEqual(list.map(item => item.id), ['1', '3', '4', '5']);
assert.equal(list[0].content, '查资料');
assert.equal(list[2].status, 'pending');
assert.equal(list[2].parent, undefined);

// Cancelled counts as settled; the dock hides once nothing is open.
assert.deepEqual(countTodos(list), {done: 2, total: 4});
assert.equal(dockVisible(list), true);
assert.equal(dockVisible([]), false);
assert.equal(dockVisible(undefined), false);
assert.equal(dockVisible(parseTodos([{id: 'a', content: 'x', status: 'completed'}, {id: 'b', content: 'y', status: 'cancelled'}])), false);

// The running step is named first, else the next waiting one.
assert.equal(currentTodo(list).id, '3');
assert.equal(currentTodo(parseTodos([{id: 'a', content: 'x', status: 'completed'}, {id: 'b', content: 'y', status: 'pending'}])).id, 'b');
assert.equal(currentTodo(parseTodos([{id: 'a', content: 'x', status: 'completed'}])), undefined);

// Nesting follows parents, survives cycles and stops at three levels.
assert.equal(todoDepth(list, list[1]), 1);
const loop = parseTodos([{id: 'a', content: 'x', parent: 'b'}, {id: 'b', content: 'y', parent: 'a'}]);
assert.equal(todoDepth(loop, loop[0]), 1);
const deep = parseTodos(['a', 'b', 'c', 'd', 'e'].map((id, index, ids) => ({id, content: id, parent: ids[index - 1]})));
assert.equal(todoDepth(deep, deep[4]), 3);

assert.equal(sameTodos(list, parseTodos(JSON.parse(JSON.stringify(list)))), true);
assert.equal(sameTodos(list, list.map((item, index) => (index ? item : {...item, status: 'pending'}))), false);
assert.equal(sameTodos(undefined, []), false);
console.log('PASS: task dock parsing, counts, visibility, current step, nesting and equality');
