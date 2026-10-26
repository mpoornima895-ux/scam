// parseAiJson: bad JSON and missing fields (Item 3).
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAiJson, NO_PATTERN_LABEL } = require('../../.test-build/src/api.js');

test('bad JSON returns null', () => {
  for (const raw of ['', 'not json at all', '{"risk_score": ', '[]', 'null', '{broken}']) {
    assert.equal(parseAiJson(raw, 'cloud_ai'), null, JSON.stringify(raw));
  }
});

test('missing or non-numeric risk_score returns null (no invented verdict)', () => {
  assert.equal(parseAiJson('{"scam_type":"x"}', 'cloud_ai'), null);
  assert.equal(parseAiJson('{"risk_score":"abc"}', 'cloud_ai'), null);
  assert.equal(parseAiJson('{"risk_score":null}', 'cloud_ai'), null);
});

test('other missing fields get safe defaults and never say "Safe"', () => {
  const r = parseAiJson('{"risk_score": 10}', 'cloud_ai');
  assert.equal(r.risk_level, 'Low');
  assert.equal(r.scam_type, NO_PATTERN_LABEL);
  assert.deepEqual(r.scam_signals, []);
  assert.equal(r.engine, 'cloud_ai');
  assert.equal(typeof r.explanation, 'string');
  assert.equal(typeof r.recommended_action, 'string');
  assert.equal(r.confidence, null); // no signals -> no confidence number
});

test('good JSON, including markdown fences and surrounding text', () => {
  const body = '{"risk_level":"High","risk_score":90,"scam_type":"UPI Collect Scam","explanation":"e","scam_signals":["a","b"],"recommended_action":"x"}';
  for (const raw of [body, '```json\n' + body + '\n```', 'Here you go: ' + body]) {
    const r = parseAiJson(raw, 'cloud_ai');
    assert.equal(r.risk_level, 'High');
    assert.equal(r.risk_score, 90);
    assert.equal(r.confidence, 0.9); // from the real score, not a fixed number
  }
});

test('score is clamped and the claimed level cannot sit below its band', () => {
  assert.equal(parseAiJson('{"risk_score": 500}', 'cloud_ai').risk_score, 100);
  assert.equal(parseAiJson('{"risk_score": -5}', 'cloud_ai').risk_score, 0);
  const r = parseAiJson('{"risk_level":"High","risk_score":20,"scam_signals":["x"]}', 'cloud_ai');
  assert.equal(r.risk_level, 'High');
  assert.ok(r.risk_score >= 75);
});

test('oversized model text is capped', () => {
  const r = parseAiJson(JSON.stringify({ risk_score: 50, explanation: 'x'.repeat(5000), scam_signals: Array(50).fill('y'.repeat(900)) }), 'cloud_ai');
  assert.ok(r.explanation.length <= 400);
  assert.ok(r.scam_signals.length <= 6 && r.scam_signals.every(s => s.length <= 120));
});
