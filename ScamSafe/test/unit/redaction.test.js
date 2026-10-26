// redactSensitiveData: OTP, card, Aadhaar, phone, account (Item 3 / 5).
const test = require('node:test');
const assert = require('node:assert/strict');
const { redactSensitiveData } = require('../../.test-build/src/redaction.js');

test('OTP after the keyword', () => {
  const r = redactSensitiveData('Your OTP is 482913. Do not share.');
  assert.ok(!r.sanitized.includes('482913'));
  assert.ok(r.redactedTypes.includes('OTP / Security Code'));
});

test('OTP BEFORE the keyword ("123456 is your OTP")', () => {
  for (const t of ['123456 is your OTP for login', 'Use 482913 as verification code', '482913 is the one time password']) {
    const r = redactSensitiveData(t);
    assert.ok(!/\d{4,}/.test(r.sanitized), t + ' -> ' + r.sanitized);
  }
});

test('16-digit card number (spaces and dashes)', () => {
  for (const t of ['Card 4111 1111 1111 1111 used', 'Card 4111-1111-1111-1111 used', 'Card 4111111111111111 used']) {
    const r = redactSensitiveData(t);
    assert.ok(!r.sanitized.includes('4111'), r.sanitized);
    assert.ok(r.redactedTypes.includes('Card Number'));
  }
});

test('12-digit Aadhaar number', () => {
  const r = redactSensitiveData('Aadhaar 1234 5678 9012 linked');
  assert.ok(!r.sanitized.includes('5678'));
  assert.ok(r.redactedTypes.includes('Aadhaar Number'));
});

test('Indian phone numbers in common formats', () => {
  for (const t of ['Call 9812345678 now', 'Call +91 98123 45678 now', 'Call +919812345678 now', 'Call 098123 45678 now']) {
    const r = redactSensitiveData(t);
    assert.ok(!/\d{5}/.test(r.sanitized), t + ' -> ' + r.sanitized);
    assert.ok(r.redactedTypes.length > 0, t); // "+91" + 10 digits is 12 digits, so the Aadhaar rule may label it; it is masked either way
  }
  assert.ok(redactSensitiveData('Call 98123 45678 now').redactedTypes.includes('Phone Number'));
});

test('bank account number', () => {
  const r = redactSensitiveData('Acct 00112233445566 credited');
  assert.ok(!r.sanitized.includes('00112233445566'));
  assert.ok(r.redactedTypes.includes('Bank Account'));
});

test('ordinary amounts and masked short account endings are kept', () => {
  const r = redactSensitiveData('Rs 5000 debited from a/c XX1234 at 10:30');
  assert.equal(r.sanitized, 'Rs 5000 debited from a/c XX1234 at 10:30');
  assert.deepEqual(r.redactedTypes, []);
});

test('empty input', () => {
  assert.deepEqual(redactSensitiveData(''), { sanitized: '', redactedTypes: [] });
});
