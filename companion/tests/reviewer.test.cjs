const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createReviewer } = require('../reviewer.cjs');
const spec = { threadId: 'chat', goal: 'Fix the issue and run tests', profile: 'default', model: 'chosen-model', provider: 'chosen-provider' };
const evidence = { turnId: 't1', items: [{ type: 'agentMessage', text: 'Change applied, no tests yet.' }] };
const response = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const answers = values => ({ answers: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { noul: value }])) });

test('review uses Jev judgments and the chosen Hermes model and verifies instructions before approval', async () => {
  const calls = [];
  const review = createReviewer({ apiKey: 'test-only', bridgeUrl: 'http://localhost:8765', bridgeToken: 'paired-token', fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, body });
    if (calls.length === 1) {
      assert.equal(body.model, 'jev-latest'); assert.ok(body.questions.needsGuidance); assert.ok(body.questions.humanRequired);
      return response(answers({ needsGuidance: 0.99, humanRequired: 0.01, goalComplete: 0.01 }));
    }
    if (url.endsWith('/v1/codex/review')) {
      assert.equal(body.spec.model, 'chosen-model');
      assert.equal(body.spec.provider, 'chosen-provider');
      assert.equal(init.headers.Authorization, 'Bearer paired-token');
      return response({ action: 'continue', analysis: 'Tests were not run.', instruction: 'Run the relevant tests and report the results.' });
    }
    assert.ok(body.questions.supported); assert.ok(body.questions.withinGoal);
    return response(answers({ supported: 0.99, withinGoal: 0.99, humanRequired: 0.01, goalComplete: 0.01 }));
  } });
  const result = await review(spec, evidence);
  assert.equal(result.approved, true); assert.equal(result.action, 'continue'); assert.equal(calls.length, 3);
});

test('uncertain or unsupported guidance stays advice and human-required signal blocks automatic sending', async () => {
  let index = 0;
  const review = createReviewer({ apiKey: 'test-only', bridgeUrl: 'http://localhost:8765', bridgeToken: 'token', fetchImpl: async url => {
    index++;
    if (index === 1) return response(answers({ needsGuidance: 0.6, humanRequired: 0.1, goalComplete: 0.1 }));
    if (url.endsWith('/review')) return response({ action: 'correct', analysis: 'A possible issue.', instruction: 'Adjust the implementation.' });
    return response(answers({ supported: 0.7, withinGoal: 0.99, humanRequired: 0.6, goalComplete: 0.1 }));
  } });
  const result = await review(spec, evidence);
  assert.equal(result.approved, false); assert.equal(result.analysis, 'A possible issue.');
});

test('missing credentials and malformed model output fail explicitly without forwarding secrets', async () => {
  await assert.rejects(createReviewer({ apiKey: '' })(spec, evidence), /TYPESAFE_API_KEY/);
  let count = 0;
  const review = createReviewer({ apiKey: 'test-only', bridgeUrl: 'http://localhost:8765', bridgeToken: 'token', fetchImpl: async () => {
    if (++count === 1) return response(answers({ needsGuidance: 0.99, humanRequired: 0.01, goalComplete: 0.01 }));
    return response({ action: 'shell', analysis: 'run a command', instruction: 'arbitrary' });
  } });
  await assert.rejects(review(spec, evidence), /unsupported review/i);
});
