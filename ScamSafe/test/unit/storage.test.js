// storage: add / remove (+ pin and clear) against an in-memory AsyncStorage.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const mem = new Map();
const fakeAsyncStorage = {
  getItem: async k => (mem.has(k) ? mem.get(k) : null),
  setItem: async (k, v) => { mem.set(k, v); },
  removeItem: async k => { mem.delete(k); }
};
const resolved = require.resolve('@react-native-async-storage/async-storage', { paths: [path.join(__dirname, '../..')] });
require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, default: fakeAsyncStorage } };

const storage = require('../../.test-build/src/storage.js');

const entry = (id, over = {}) => ({
  id, text: 'hello ' + id, sender: 'AX-TEST', time: 1, pinned: false, autoDeleted: false,
  risk_level: 'Low', risk_score: 5, scam_type: 'No known scam pattern found', explanation: '', scam_signals: [],
  recommended_action: '', confidence: null, engine: 'on_device_rules', ...over
});

test('add then remove', async () => {
  mem.clear();
  assert.deepEqual(await storage.getAll(), []);
  let list = await storage.addEntry(entry('a'));
  list = await storage.addEntry(entry('b'));
  assert.deepEqual(list.map(e => e.id), ['b', 'a']);
  assert.equal((await storage.getAll()).length, 2);

  list = await storage.remove('a');
  assert.deepEqual(list.map(e => e.id), ['b']);
  assert.deepEqual((await storage.getAll()).map(e => e.id), ['b']);
  list = await storage.remove('does-not-exist');
  assert.equal(list.length, 1);
});

test('adding the same id replaces instead of duplicating', async () => {
  mem.clear();
  await storage.addEntry(entry('a', { risk_score: 5 }));
  const list = await storage.addEntry(entry('a', { risk_score: 30 }));
  assert.equal(list.length, 1);
  assert.equal(list[0].risk_score, 30);
});

test('high-risk entries are auto-pinned; pin toggles; confidence null survives a round trip', async () => {
  mem.clear();
  const list = await storage.addEntry(entry('h', { risk_level: 'High', risk_score: 90, confidence: 0.9 }));
  assert.equal(list[0].pinned, true);
  const toggled = await storage.pinToggle('h');
  assert.equal(toggled[0].pinned, false);
  await storage.addEntry(entry('n'));
  assert.equal((await storage.getAll()).find(e => e.id === 'n').confidence, null);
});

test('clearAll empties the store', async () => {
  mem.clear();
  await storage.addEntry(entry('a'));
  assert.deepEqual(await storage.clearAll(), []);
  assert.deepEqual(await storage.getAll(), []);
});

test('corrupt stored data does not crash', async () => {
  mem.clear();
  mem.set('scamsafe_v1', '{not json');
  assert.deepEqual(await storage.getAll(), []);
});
