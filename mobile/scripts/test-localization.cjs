const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, filename);
const {resolveLanguage, translate} = require('../src/i18n/core.ts');
assert.equal(resolveLanguage('system', 'zh-CN'), 'zh');
assert.equal(resolveLanguage('system', 'zh-Hant-TW'), 'zh');
assert.equal(resolveLanguage('system', 'en-US'), 'en');
assert.equal(resolveLanguage('system', 'fr-FR'), 'en');
assert.equal(resolveLanguage('en', 'zh-CN'), 'en');
assert.equal(resolveLanguage('zh', 'en-US'), 'zh');
assert.equal(translate('en', '设置'), 'Settings');
assert.equal(translate('zh', '设置'), '设置');
assert.equal(translate('en', '删除 {0}？', {'0':'设置 $& {1}'}), 'Delete 设置 $& {1}?');
assert.equal(translate('en', '服务器原文'), '服务器原文');
assert.equal(translate('en', '配对码错误或已过期，请在服务器上重新生成。'), 'The pairing code is wrong or has expired. Generate a new one on the server.');
const {localizeDemo} = require('../src/i18n/demo.ts');
const sample = {bots: [], threads: [], messages: {demo: [{id: 'sample', from: 'user', text: '设置'}]}};
const view = {bots: [], threads: [], messages: {demo: [...sample.messages.demo, {id: 'typed', from: 'user', text: '设置'}]}};
const translated = localizeDemo(view, sample, key => translate('en', key));
assert.equal(translated.messages.demo[0].text, 'Settings');
assert.equal(translated.messages.demo[1].text, '设置');
assert.equal(view.messages.demo[0].text, '设置', 'Localizing must not mutate stored messages');
// Every source-owned Chinese literal/template must have an English entry.
const {english} = require('../src/i18n/translations.ts');
const root=path.resolve(__dirname,'../src');
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):/\.tsx?$/.test(e.name)?[path.join(d,e.name)]:[]);
const missing=[];
for(const f of walk(root).filter(f=>!f.includes(path.sep+'i18n'+path.sep)&&!f.endsWith('bloubFrames.ts'))){
 const s=fs.readFileSync(f,'utf8'),tree=ts.createSourceFile(f,s,ts.ScriptTarget.Latest,true);
 function visit(n){if(ts.isStringLiteral(n)&&/[\u3400-\u9fff]/.test(n.text)&&!['简体中文','语言 / Language'].includes(n.text)&&!Object.hasOwn(english,n.text))missing.push(path.relative(root,f)+': '+n.text);ts.forEachChild(n,visit)}visit(tree);
}
assert.deepEqual(missing,[],'Untranslated source-owned text');
console.log('PASS: locale selection, switching keys, interpolation, raw text, pairing error and translation coverage');
