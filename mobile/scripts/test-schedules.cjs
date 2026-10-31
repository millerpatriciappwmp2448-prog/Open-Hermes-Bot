const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, filename);

// schedules.ts reads `t` from ./i18n, which pulls in React Native. Use the pure
// translator in English so the test also proves every string has a translation.
const {translate} = require('../src/i18n/core.ts');
const i18nIndex = path.resolve(__dirname, '../src/i18n/index.ts');
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './i18n' && parent && parent.filename.endsWith('schedules.ts')) {
    return {t: (key, params) => translate('en', key, params)};
  }
  if (request === i18nIndex) return {t: (key, params) => translate('en', key, params)};
  return load.call(this, request, parent, isMain);
};
const s = require('../src/schedules.ts');

const NOW = Date.parse('2026-10-31T08:00:00Z');

// readSchedules: defensive shapes, state words, sorting.
const rows = s.readSchedules({jobs: [
  {name: 'no id', schedule: '0 9 * * *'},
  null,
  {id: 'news', name: 'Morning news', schedule: {kind: 'cron', expr: '0 9 * * *'}, state: 'scheduled', next_run_at: '2026-11-01T01:00:00Z'},
  {id: 'soon', prompt: 'Check the server\nand report', schedule: {minutes: 120}, state: 'scheduled', next_run_at: NOW / 1000 + 600},
  {id: 'off', name: 'Paused one', schedule: 'every 2h', state: 'scheduled', enabled: false},
  {id: 'bad', name: 'Broken', schedule_display: 'every day', state: 'scheduled', last_status: 'error', last_error: 'timeout', last_run_at: NOW / 1000 - 3600},
  {id: 'once', name: 'Once', schedule: {minutes: 2880}, state: 'completed', repeat: {times: 1, completed: 1}},
]});
assert.deepEqual(rows.map((row) => row.id), ['soon', 'news', 'off', 'bad', 'once'], 'Rows without an id are skipped; nearest run first, then paused, failed, done');
const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
assert.equal(byId.off.state, 'paused', 'enabled:false wins over the old state word');
assert.equal(byId.bad.state, 'failed', 'A scheduled job whose last run errored reads as failed');
assert.equal(byId.once.state, 'done');
assert.equal(byId.once.completed, 1);
assert.equal(byId.soon.name, 'Check the server', 'A nameless job is named by its first prompt line');
assert.equal(byId.soon.when, 'every 2h');
assert.equal(byId.once.when, 'every 2d');
assert.equal(byId.news.when, '0 9 * * *');
assert.equal(byId.news.expression, '0 9 * * *');
assert.equal(byId.bad.when, 'every day', 'The server display line is kept as written');
assert.equal(byId.soon.nextRun, NOW + 600_000, 'Seconds become milliseconds');
assert.deepEqual(s.readSchedules([{id: 'bare'}]).map((row) => row.state), ['unknown'], 'A bare array is accepted');
assert.deepEqual(s.readSchedules({nope: 1}), []);
assert.deepEqual(s.readSchedules(null), []);

// moment and distance.
assert.equal(s.moment(0), 0);
assert.equal(s.moment(-5), 0);
assert.equal(s.moment(1_700_000_000), 1_700_000_000_000);
assert.equal(s.moment(1_700_000_000_000), 1_700_000_000_000);
assert.equal(s.moment('not a date'), 0);
assert.equal(s.moment('2026-10-31T08:00:00Z'), NOW);
assert.equal(s.distance(0, NOW), '');
assert.equal(s.distance(NOW + 10_000, NOW), 'now');
assert.equal(s.distance(NOW + 12 * 60_000, NOW), 'in 12 min');
assert.equal(s.distance(NOW - 3 * 3_600_000, NOW), '3 h ago');
assert.equal(s.distance(NOW + 2 * 86_400_000, NOW), 'in 2 d');
assert.equal(s.nextRunText(byId.off, NOW), 'Paused');
assert.equal(s.lastRunText(byId.news, NOW), 'Never run');
assert.equal(s.lastRunText(byId.bad, NOW), 'Failed 1 h ago: timeout');

// runsByJob: only cron sessions, grouped by job, newest first, seconds to ms.
const runs = s.runsByJob([
  {id: 'cron_news_20261030_090000', title: 'News 30', lastActive: 1_793_350_800, messageCount: 4},
  {id: 'cron_news_20261031_090000', title: '', lastActive: 1_793_437_200, messageCount: 3},
  {id: 'cron_server_check_20261031_080000', title: 'Server', lastActive: 1_793_433_600},
  {id: 'api_server_chat_1', title: 'A chat', lastActive: 1_793_437_300},
  {id: 'cron_broken', title: 'No timestamp suffix'},
]);
assert.deepEqual(Object.keys(runs).sort(), ['news', 'server_check'], 'Chats and malformed ids are not runs; job names may contain underscores');
assert.deepEqual(runs.news.map((run) => run.id), ['cron_news_20261031_090000', 'cron_news_20261030_090000']);
assert.equal(runs.news[0].at, 1_793_437_200_000);
assert.equal(runs.news[0].title, 'A run', 'An untitled run gets a readable title');
assert.equal(runs.news[1].messages, 4);
assert.deepEqual(s.runsByJob(undefined), {});

// Drafts: the bridge limits, said before a round trip.
const draft = {name: 'Morning news', when: '0 9 * * *', prompt: 'Summarize the news', deliver: '', repeat: ''};
assert.equal(s.draftProblem(draft), '');
assert.match(s.draftProblem({...draft, name: '  '}), /name/i);
assert.match(s.draftProblem({...draft, name: 'x'.repeat(201)}), /200/);
assert.match(s.draftProblem({...draft, when: ''}), /cron/i);
assert.match(s.draftProblem({...draft, prompt: ''}), /bot/i);
assert.match(s.draftProblem({...draft, prompt: 'x'.repeat(5001)}), /5000/);
for (const repeat of ['0', '10001', '1.5', '-1', 'abc']) {
  assert.match(s.draftProblem({...draft, repeat}), /10000/, `repeat ${repeat} is rejected`);
}
assert.equal(s.draftProblem({...draft, repeat: '10000'}), '');
assert.deepEqual(s.draftBody(draft), {name: 'Morning news', schedule: '0 9 * * *', prompt: 'Summarize the news', deliver: 'local'}, 'Delivery defaults to local and repeat is omitted');
assert.deepEqual(s.draftBody({...draft, repeat: ' 3 ', deliver: 'bot-chat:worker'}).repeat, 3);
assert.equal(s.draftBody({...draft, deliver: 'bot-chat:worker'}).deliver, 'bot-chat:worker');
assert.equal(s.deliverText(''), 'Kept on the server');

// An overdue timestamp warrants a scheduler check, not a definite diagnosis.
const late = s.readSchedules({jobs: [
  {id: 'a', name: 'A', schedule: '0 9 * * *', state: 'scheduled', next_run_at: (NOW - 10 * 60_000) / 1000},
  {id: 'b', name: 'B', schedule: '0 9 * * *', state: 'scheduled', next_run_at: (NOW - 60_000) / 1000},
  {id: 'c', name: 'C', schedule: '0 9 * * *', state: 'scheduled', enabled: false, next_run_at: (NOW - 10 * 60_000) / 1000},
]});
assert.equal(s.schedulerStanding(late, NOW).late, 1, 'Two minutes of slack; paused jobs are not late');
assert.match(s.schedulerStanding(late, NOW).text, /scheduler/i);
assert.deepEqual(s.schedulerStanding(rows, NOW), {late: 0, text: ''});

console.log('PASS: job parsing, paused/failed states, sorting, run grouping by job, draft limits, delivery default and scheduler standing');
