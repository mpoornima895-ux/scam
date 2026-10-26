/**
 * PII Redaction & Data Sanitization Module for ScamSafe
 *
 * Ensures sensitive data (OTPs, bank account numbers, credit/debit card numbers,
 * Aadhaar numbers, phone numbers) are redacted BEFORE any text leaves the device.
 *
 * NOTE: only the five types above are masked. Names, amounts, UPI IDs and links
 * are NOT masked. Do not claim otherwise in UI or policy text.
 */

export function redactSensitiveData(text: string): { sanitized: string; redactedTypes: string[] } {
  if (!text) return { sanitized: '', redactedTypes: [] };

  const redactedTypes: string[] = [];
  let sanitized = text;

  const apply = (label: string, regex: RegExp, replacer: string | ((...args: string[]) => string)): void => {
    const next = sanitized.replace(regex, replacer as never);
    if (next !== sanitized) {
      sanitized = next;
      redactedTypes.push(label);
    }
  };

  // 1. Redact 16-digit Card Numbers (with or without spaces/dashes)
  apply('Card Number', /\b(?:\d{4}[ -]?){3}\d{4}\b/g, '[CARD_NUMBER_REDACTED]');

  // 2. Redact 12-digit Indian Aadhaar Numbers
  apply('Aadhaar Number', /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, '[AADHAAR_REDACTED]');

  // 3a. OTPs / codes that FOLLOW a keyword:  "OTP is 123456", "code: 4821"
  const keywordThenCode = /(?:otp|code|pin|password|verification|one[- ]time password)[\s:is=-]+(\b\d{4,8}\b)/gi;
  // 3b. OTPs / codes that PRECEDE a keyword: "123456 is your OTP", "Use 4829 as verification code"
  const codeThenKeyword =
    /\b(\d{4,8})\b(?=\s*(?:is|as|:|-)?\s*(?:your|the|an?|ur)?\s*(?:one[- ]time\s+password|otp|verification\s+code|security\s+code|login\s+code|passcode|code|pin)\b)/gi;
  const beforeOtp = sanitized;
  sanitized = sanitized.replace(keywordThenCode, (match: string, code: string) => match.replace(code, '[OTP_REDACTED]'));
  sanitized = sanitized.replace(codeThenKeyword, '[OTP_REDACTED]');
  if (sanitized !== beforeOtp) {
    redactedTypes.push('OTP / Security Code');
  }

  // 4. Redact Bank Account Numbers (e.g. A/c 123456789012). Short masked forms (XX1234) are kept.
  apply('Bank Account', /(?:a\/c|account|acct)[\s#:]*(\d{8,18})/gi, (match: string, acct: string) =>
    match.replace(acct, '[ACCOUNT_REDACTED]')
  );

  // 5. Redact Indian mobile numbers (6-9 start), with optional +91 / 0 prefix and an optional space/dash
  //    after the first five digits ("98123 45678"). Leading group keeps us from matching inside longer digit runs.
  apply(
    'Phone Number',
    /(^|[^\d])((?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5})(?!\d)/g,
    (_m: string, lead: string) => `${lead}[PHONE_REDACTED]`
  );

  return { sanitized, redactedTypes };
}
