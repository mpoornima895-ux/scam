// The three new message types and the "no Safe claim" wording (Item 4 e, f).
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeOfflineFallback, NO_PATTERN_LABEL } = require('../../.test-build/src/api.js');

const high = text => assert.equal(analyzeOfflineFallback(text).risk_level, 'High', text);
const low = text => assert.equal(analyzeOfflineFallback(text).risk_level, 'Low', text);

test('instant loan: no documents / no CIBIL / install app', () => {
  high('Instant loan Rs 50,000 in 5 minutes. No documents, no CIBIL check. Install app now.');
  high('Quick personal loan approved! Without documents or CIBIL. Download app: loanfast.top/apk');
  high('Aapka loan bina document aur bina CIBIL ke approved hai. Abhi app install karein http://cashnow.xyz/a');
});

test('fake police / CBI / cyber-crime: case registered, stay on video call, arrest', () => {
  high('Mumbai Cyber Crime: a case has been registered against your Aadhaar. Stay on video call or you will be arrested.');
  high('CBI Notice: FIR registered in your name. Do not disconnect the video call. Arrest warrant pending.');
  high('Police: case registered. Aap giraftar ho sakte hain. Video call par bane rahein.');
});

test('Hinglish KYC expire / account band ho jayega, even without a link', () => {
  high('Aapka KYC expire ho gaya hai. Account band ho jayega. Abhi update karein.');
  high('Dear customer, aapka bank account band ho jayega. Turant KYC update karein warna block.');
});

test('the new rules still fire when the word OTP appears (routine-OTP rule must not hide them)', () => {
  high('Aapka KYC expire ho gaya hai. Account band ho jayega. Abhi update karein, OTP share karein.');
});

test('genuine look-alikes are NOT flagged', () => {
  low('HDFC Bank: Pre-approved loan offer up to Rs 5 lakh. Visit your nearest branch.');
  low('Delhi Police: Your FIR No 1234 has been registered. Track status at https://delhipolice.gov.in');
  low('SBI: Your KYC is due. Please visit your home branch with documents.');
  low('Instant loan offers: apply at hdfcbank.com/loans, minimal documentation.');
  low('Your OTP is 482913. Do not share it with anyone. -HDFC Bank');
});

test('no signals => "No known scam pattern found", never "Safe"/"Legitimate", no confidence, no fixed 0.85', () => {
  const r = analyzeOfflineFallback('Hi, are we meeting at 5? Call me.');
  assert.equal(r.scam_type, NO_PATTERN_LABEL);
  assert.equal(r.confidence, null);
  assert.deepEqual(r.scam_signals, []);
  const text = JSON.stringify(r);
  assert.ok(!/legitimate|safe to read|safe informational/i.test(text), text);
});

test('no result ever carries the old "Legitimate" wording', () => {
  for (const t of ['Your Amazon order #123 is out for delivery today.', 'Rs 1,250.00 debited from a/c XX1234. Avl bal Rs 5,000.', 'Your OTP is 482913.']) {
    assert.ok(!/legitimate/i.test(analyzeOfflineFallback(t).scam_type), t);
  }
});

test('free hosting / forms link + money, job or refund => High (Google Sites refund, Google Forms registration fee)', () => {
  high('Income Tax Dept: your refund of Rs 18,540 is approved. Claim now: https://sites.google.com/view/it-refund-claim');
  high('Urgent hiring! Work from home, earn Rs 800/day. Pay Rs 500 registration fee and apply: https://forms.gle/Ab12Cd34');
  high('Part time job vacancy. Fill form docs.google.com/forms/d/e/1FAIpQLSf/viewform and pay Rs 500 registration');
  high('Your tax refund is pending. Verify at user.github.io/refund');
});

test('a hosting / forms link WITHOUT money, job or refund is not raised by this rule', () => {
  for (const m of ['School notice: please fill the parent survey https://forms.gle/Xy99 by Friday',
                   'Team lunch poll: docs.google.com/forms/d/e/abc, reply by 5pm',
                   'Photos from the trip: drive.google.com/drive/folders/1abc']) {
    const r = analyzeOfflineFallback(m);
    assert.equal(r.risk_level, 'Low', m);
    assert.ok(!/Free hosting/.test(r.scam_signals.join(' ')), m);
  }
});

test('money / job / refund words WITHOUT a hosting link are not raised by this rule', () => {
  const r = analyzeOfflineFallback('Your refund of Rs 540 has been credited to your account. Thank you for shopping.');
  assert.ok(!/Free hosting/.test(r.scam_signals.join(' ')));
});

// ---- v2 rules (OTP/PIN asks, remote access, advance fee, family emergency, investment, extortion) ----
test('v2: asking you to SHARE an OTP / PIN / CVV is flagged High', () => {
  high('Sir this is bank fraud department. Share the OTP you just received to block the transaction.');
  high('Your card reward is ready. Tell us your PIN and CVV to process cashback.');
});

test('v2: remote-access apps, advance fees, family emergency, investment, extortion', () => {
  high('Install AnyDesk so we can process your refund.');
  high('Pay Rs 20,000 visa processing fee to start your Dubai job.');
  high('Hi Mum this is my new number, my phone broke. Please send Rs 15,000 urgently.');
  high('Double your money in 15 days! Invest Rs 20,000 get Rs 40,000.');
  high('URGENT: your loan is overdue. We will send your photos to all your contacts, pay today.');
});

test('v2: warnings and real OTP messages are NOT flagged', () => {
  low('482913 is your OTP for HDFC NetBanking. Do not share it with anyone. Bank never asks for OTP.');
  low('Never share your OTP, PIN or CVV with anyone, even if they claim to be from the bank. -SBI');
  low('Uber: share OTP 4821 with the driver to start your ride.');
  low('Hi Mum, I reached home safely. Will call you in the evening.');
});

// ---- v3 rules (look-alike domains, job/bonus fees, Hinglish electricity, gift fee, police seminar) ----
test('v3: look-alike bank domain on a normal extension plus a verify request is High', () => {
  high('HDFC Bank: your account needs verification. Update now at https://hdfc-verify.co.in/login');
  high('Flipkart: your refund is ready. Claim it at https://flipkart-update.org/refund');
});

test('v3: job deposit, bonus tax, Hinglish electricity, gift fee, e-mail prize', () => {
  high('Work from home job offer. Pay Rs 2,000 joining deposit to start earning Rs 5000 daily.');
  high('Your Rs 10,000 bonus is ready. Pay Rs 500 tax to release the bonus.');
  high('Aapka bijli connection aaj raat kat jayega. Turant call karein 9876543210.');
  high('You have a gift parcel. Pay Rs 350 shipping fee to receive the gift.');
  high('Congratulations, you won a lottery of Rs 25 lakh. Email your details to claim@lottery-win.com to claim.');
});

test('v3: police-word seminar notice and real brand domains are NOT flagged', () => {
  low('Meeting with CBI officers scheduled for the college cyber safety seminar on Friday at 11 AM in the auditorium.');
  low('Amazon Pay: Rs 500 added to your wallet. View: https://www.amazonpay.in/wallet');
  low('Your SBI Card statement is ready. View at https://www.sbicard.com/statement');
});
