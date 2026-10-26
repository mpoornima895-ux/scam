// Cloud path of analyzeMessage (Item 3 / 6): redact-before-send, raise-only, fallback, timeout.
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeMessage, analyzeOfflineFallback, mergeVerdicts, setInstallId } = require('../../.test-build/src/api.js');

const URL_ = 'https://analyze.example.test';
const okResponse = verdict => async () => ({ ok: true, text: async () => JSON.stringify(verdict) });
const cloudVerdict = (score, extra = {}) => ({
  risk_score: score, scam_type: 'Cloud Type', explanation: 'cloud says', scam_signals: ['cloud signal'], recommended_action: 'act', ...extra
});

const BENIGN = 'Hi, are we still meeting at 5 pm tomorrow near the station?';
const SCAM = 'Enter your UPI PIN to receive Rs 5000 cashback on PhonePe now.';

test('empty analyzeUrl: on-device only, fetch is never called', async () => {
  let called = false;
  const r = await analyzeMessage(BENIGN, { analyzeUrl: '', fetchImpl: async () => { called = true; return {}; } });
  assert.equal(called, false);
  assert.equal(r.engine, 'on_device_rules');
});

test('redaction runs BEFORE anything is sent; body is only {text}; max 1000 chars', async () => {
  let sent;
  const msg = 'Your OTP is 482913. 770011 is your verification code. Call 9812345678 or +91 98123 45678. Card 4111 1111 1111 1111. Aadhaar 1234 5678 9012. A/c 00112233445566. ' + 'x'.repeat(3000);
  await analyzeMessage(msg, { analyzeUrl: URL_, fetchImpl: async (url, init) => { sent = { url, init }; return { ok: true, text: async () => JSON.stringify(cloudVerdict(10)) }; } });
  assert.equal(sent.url, URL_);
  const body = JSON.parse(sent.init.body);
  assert.deepEqual(Object.keys(body), ['text']);
  assert.ok(body.text.length <= 1000);
  for (const secret of ['482913', '770011', '9812345678', '98123 45678', '4111', '5678 9012', '00112233445566']) {
    assert.ok(!body.text.includes(secret), 'leaked: ' + secret);
  }
  assert.ok(!JSON.stringify(sent.init.headers).toLowerCase().includes('authorization'), 'app must not send any provider key');
});

test('install id is sent as a header for rate limiting', async () => {
  let headers;
  setInstallId('abcd1234efgh');
  await analyzeMessage(BENIGN, { analyzeUrl: URL_, fetchImpl: async (u, init) => { headers = init.headers; return okResponse(cloudVerdict(5))(); } });
  assert.equal(headers['X-Install-Id'], 'abcd1234efgh');
  setInstallId('');
});

test('cloud can RAISE the on-device score', async () => {
  const local = analyzeOfflineFallback(BENIGN);
  const r = await analyzeMessage(BENIGN, { analyzeUrl: URL_, fetchImpl: okResponse(cloudVerdict(90)) });
  assert.ok(r.risk_score > local.risk_score);
  assert.equal(r.risk_score, 90);
  assert.equal(r.risk_level, 'High');
  assert.equal(r.engine, 'cloud_ai');
});

test('cloud can NEVER lower the on-device score', async () => {
  const local = analyzeOfflineFallback(SCAM);
  assert.ok(local.risk_score >= 75);
  const r = await analyzeMessage(SCAM, { analyzeUrl: URL_, fetchImpl: okResponse(cloudVerdict(0, { risk_level: 'Low' })) });
  assert.equal(r.risk_score, local.risk_score);
  assert.equal(r.risk_level, 'High');
  assert.equal(r.scam_type, local.scam_type);
  assert.equal(r.engine, 'cloud_ai'); // the redacted text did leave the phone, so the label must say so
});

test('mergeVerdicts: final level and score are never below the on-device ones', () => {
  const local = analyzeOfflineFallback(SCAM);
  const lowCloud = { ...local, risk_level: 'Low', risk_score: 1, scam_signals: [] };
  const m = mergeVerdicts(local, lowCloud);
  assert.equal(m.risk_score, local.risk_score);
  assert.equal(m.risk_level, 'High');
});

test('network error -> on-device result', async () => {
  const r = await analyzeMessage(SCAM, { analyzeUrl: URL_, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(r.engine, 'on_device_rules');
  assert.equal(r.risk_level, 'High');
});

test('HTTP error and bad JSON -> on-device result', async () => {
  const a = await analyzeMessage(SCAM, { analyzeUrl: URL_, fetchImpl: async () => ({ ok: false, text: async () => 'x' }) });
  assert.equal(a.engine, 'on_device_rules');
  const b = await analyzeMessage(SCAM, { analyzeUrl: URL_, fetchImpl: async () => ({ ok: true, text: async () => 'garbage' }) });
  assert.equal(b.engine, 'on_device_rules');
});

test('timeout -> on-device result (request that never answers)', async () => {
  const started = Date.now();
  const r = await analyzeMessage(SCAM, { analyzeUrl: URL_, timeoutMs: 60, fetchImpl: () => new Promise(() => {}) });
  assert.ok(Date.now() - started < 2000);
  assert.equal(r.engine, 'on_device_rules');
  assert.equal(r.risk_level, 'High');
});

test('honest confidence: null when no signal, derived from score otherwise', async () => {
  const none = await analyzeMessage(BENIGN, { analyzeUrl: '' });
  assert.equal(none.confidence, null);
  const hit = await analyzeMessage(SCAM, { analyzeUrl: '' });
  assert.equal(hit.confidence, Math.min(0.99, hit.risk_score / 100));
  assert.notEqual(hit.confidence, 0.85);
});
