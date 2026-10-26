// Consent flag + "Delete all my data" wiring (Item 5).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const mem = new Map();
const fake = {
  getItem: async k => (mem.has(k) ? mem.get(k) : null),
  setItem: async (k, v) => { mem.set(k, v); },
  removeItem: async k => { mem.delete(k); },
  multiRemove: async keys => { keys.forEach(k => mem.delete(k)); }
};
const resolved = require.resolve('@react-native-async-storage/async-storage', { paths: [path.join(__dirname, '../..')] });
require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, default: fake } };

const consent = require('../../.test-build/src/consent.js');
const storage = require('../../.test-build/src/storage.js');

test('no consent until the user agrees', async () => {
  mem.clear();
  assert.equal(await consent.hasConsent(), false);
  await consent.grantConsent();
  assert.equal(await consent.hasConsent(), true);
  assert.equal(mem.get('scamsafe_consent_v1'), '1');
});

test('Delete all my data removes history, settings, consent and install id', async () => {
  mem.clear();
  await consent.grantConsent();
  mem.set(consent.AUTO_KEY, '1');
  mem.set(consent.INSTALL_ID_KEY, 'abc');
  await storage.addEntry({ id: 'x', text: 't', sender: 's', time: 1, pinned: false, autoDeleted: false, risk_level: 'High', risk_score: 90, scam_type: 'x', explanation: '', scam_signals: [], recommended_action: '', confidence: 0.9 });
  assert.equal((await storage.getAll()).length, 1);

  await consent.deleteAllUserData();

  assert.equal(mem.size, 0, 'keys left behind: ' + [...mem.keys()].join(','));
  assert.equal(await consent.hasConsent(), false);
  assert.deepEqual(await storage.getAll(), []);
});

test('install id exists only when the build has a cloud URL', async () => {
  mem.clear();
  const { CLOUD_ENABLED } = require('../../.test-build/src/config.js');
  const id = await consent.ensureInstallId();
  if (CLOUD_ENABLED) {
    assert.ok(id.length >= 8);
    assert.equal(mem.get(consent.INSTALL_ID_KEY), id);
  } else {
    assert.equal(id, '');
    assert.equal(mem.has(consent.INSTALL_ID_KEY), false);
  }
});
