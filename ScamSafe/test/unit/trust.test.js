// Link checking: trusted-domain and look-alike cases (Item 4 b, c, d).
const test = require('node:test');
const assert = require('node:assert/strict');
const { isTrustedDomain, extractUrls, extractHost, registrableDomain, analyzeOfflineFallback } = require('../../.test-build/src/api.js');

test('real official links are trusted', () => {
  assert.equal(isTrustedDomain('https://www.amazon.in/gp/your-account/order-details?orderID=404-1'), true);
  assert.equal(isTrustedDomain('amazon.in'), true);
  assert.equal(isTrustedDomain('https://retail.onlinesbi.sbi/login'), true); // subdomain of a brand-owned base
  assert.equal(isTrustedDomain('https://www.hdfcbank.com'), true);
  assert.equal(isTrustedDomain('https://www.incometax.gov.in/iec/foportal'), true);
});

test('amazon.in.evil.top is NOT trusted (registrable domain, not "contains")', () => {
  assert.equal(isTrustedDomain('amazon.in.evil.top'), false);
  assert.equal(isTrustedDomain('https://amazon.in.refund-help.top/pay'), false);
  assert.equal(registrableDomain(extractHost('amazon.in.evil.top')), 'evil.top');
});

test('userinfo trick http://amazon.in@evil.com is NOT trusted', () => {
  assert.equal(extractHost('http://amazon.in@evil.com/x'), 'evil.com');
  assert.equal(isTrustedDomain('http://amazon.in@evil.com/x'), false);
});

test('hdfcbank-secure.com is NOT trusted', () => {
  assert.equal(isTrustedDomain('hdfcbank-secure.com'), false);
  assert.equal(isTrustedDomain('https://hdfcbank-secure.com/login'), false);
});

test('hosting / sharing domains are never trusted, even under google.com', () => {
  for (const u of [
    'sites.google.com/view/x', 'https://docs.google.com/forms/d/1', 'drive.google.com/file/d/1', 'forms.gle/abc',
    'forms.google.com/x', 'storage.googleapis.com/b/o', 'myapp.firebaseapp.com', 'myapp.web.app', 'user.github.io/p',
    'shop.wixsite.com/x', 'x.blogspot.com', 'x.notion.site', 'linktr.ee/x'
  ]) {
    assert.equal(isTrustedDomain(u), false, u);
  }
  assert.equal(isTrustedDomain('www.google.com'), true); // exact official host only
});

test('sbi-yono-update.com/login WITHOUT a scheme is detected and untrusted', () => {
  const urls = extractUrls('Dear customer update KYC now sbi-yono-update.com/login or account blocked');
  assert.deepEqual(urls, ['sbi-yono-update.com/login']);
  assert.equal(isTrustedDomain(urls[0]), false);
});

test('scheme-less shorteners and domains with a path are detected', () => {
  assert.deepEqual(extractUrls('Claim now bit.ly/xyz.'), ['bit.ly/xyz']);
  assert.deepEqual(extractUrls('see www.flipkart.com/orders and amzn.in/abc'), ['www.flipkart.com/orders', 'amzn.in/abc']);
});

test('ordinary text is not mistaken for a link', () => {
  assert.deepEqual(extractUrls('Rs.500/- debited at 10 a.m./p.m. T&C apply. e.g. i.e. etc.'), []);
  assert.deepEqual(extractUrls('mail help@sbi.co.in/x'), []);
});

test('a link nested inside a trusted URL is not reported separately', () => {
  assert.deepEqual(extractUrls('Visit https://www.amazon.in/gp/x?u=evil.top/x ok'), ['https://www.amazon.in/gp/x?u=evil.top/x']);
});

test('look-alike host with a brand word gets the +40 signal', () => {
  const r = analyzeOfflineFallback('Your account needs attention: sbi-yono-update.com/login');
  assert.ok(r.scam_signals.includes('Brand name inside unofficial website'));
  const real = analyzeOfflineFallback('Your order has shipped. Track: https://www.amazon.in/gp/css/order-details?orderId=123');
  assert.ok(!real.scam_signals.includes('Brand name inside unofficial website'));
  assert.equal(real.risk_level, 'Low');
});

test('trusted brand followed by another domain is treated as untrusted and flagged', () => {
  const r = analyzeOfflineFallback('Your parcel is held. Pay fee at amazon.in.refund-help.top/pay');
  assert.equal(r.risk_level, 'High');
  assert.ok(r.scam_signals.includes('Brand name inside unofficial website'));
});
