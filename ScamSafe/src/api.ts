import { ANALYZE_MAX_CHARS, ANALYZE_TIMEOUT_MS, ANALYZE_URL } from './config';
import { redactSensitiveData } from './redaction';

export type ApiResult = {
  risk_level: 'High' | 'Medium' | 'Low';
  risk_score: number;
  scam_type: string;
  explanation: string;
  scam_signals: string[];
  recommended_action: string;
  /** Derived from the real signal score. null when no signal was found (nothing to be "confident" about). */
  confidence: number | null;
  /** 'cloud_ai' only when the (redacted) text was actually sent to our backend and answered. */
  engine: 'cloud_ai' | 'on_device_rules';
  if_already_sent?: string;
};

// Standardized thresholds
export const RISK_THRESHOLDS = {
  HIGH: 75,
  MEDIUM: 40,
} as const;

/** Label used when nothing matched. No message can be proven safe, so we never say "Safe". */
export const NO_PATTERN_LABEL = 'No known scam pattern found';
const BASELINE_SCORE = 5;

// Anonymous per-install id (random, not derived from the phone) used only for backend rate limiting.
let installId = '';
export function setInstallId(id: string): void {
  installId = id;
}

/**
 * Confidence comes from the real signal score (score / 100, max 0.99).
 * If there are no scam signals at all, there is no confidence number.
 */
export function confidenceFromScore(score: number, hasSignals: boolean): number | null {
  if (!hasSignals || !(score > BASELINE_SCORE)) return null;
  return Math.min(0.99, Math.max(0.01, score / 100));
}

type AnalyzeOptions = {
  /** Override ANALYZE_URL (used by unit tests). '' = on-device only. */
  analyzeUrl?: string;
  /** Inject fetch (used by unit tests). */
  fetchImpl?: (url: string, init: any) => Promise<any>;
  timeoutMs?: number;
};

/**
 * Primary entry point called by App.tsx.
 *
 * 1. The on-device engine ALWAYS runs first (this is the floor of the verdict).
 * 2. If ANALYZE_URL is configured, the text is redacted (src/redaction.ts), cut to
 *    ANALYZE_MAX_CHARS and sent to OUR backend only. No AI provider key lives in the app.
 * 3. The cloud verdict can only RAISE the on-device score, never lower it.
 * 4. Any failure or a >10s wait falls back to the on-device result.
 */
export async function analyzeMessage(message: string, options: AnalyzeOptions = {}): Promise<ApiResult | null> {
  const text = (message || '').trim();
  if (!text) {
    return {
      risk_level: 'Low',
      risk_score: 0,
      scam_type: 'Empty Message',
      explanation: 'The message body was empty.',
      scam_signals: ['Empty content'],
      recommended_action: 'No action needed.',
      confidence: null,
      engine: 'on_device_rules'
    };
  }

  const local = analyzeOfflineFallback(text);

  const url = (options.analyzeUrl ?? ANALYZE_URL).trim();
  if (!url) {
    return local;
  }

  // Redact personal data BEFORE anything leaves the device, then enforce the length limit.
  const { sanitized } = redactSensitiveData(text);
  const payloadText = sanitized.slice(0, ANALYZE_MAX_CHARS);

  const cloud = await requestCloudVerdict(payloadText, url, options);
  if (!cloud) {
    return local;
  }
  return mergeVerdicts(local, cloud);
}

/** POST {text} to our backend. Resolves null on any error, bad status, bad JSON or timeout. */
function requestCloudVerdict(text: string, url: string, options: AnalyzeOptions): Promise<ApiResult | null> {
  const doFetch = options.fetchImpl ?? ((u: string, init: any) => fetch(u, init));
  const timeoutMs = options.timeoutMs ?? ANALYZE_TIMEOUT_MS;
  const controller = new AbortController();

  return new Promise<ApiResult | null>(resolve => {
    const timer = setTimeout(() => {
      try {
        controller.abort();
      } catch {
      }
      resolve(null);
    }, timeoutMs);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (installId) headers['X-Install-Id'] = installId;

    Promise.resolve()
      .then(() => doFetch(url, { method: 'POST', headers, body: JSON.stringify({ text }), signal: controller.signal }))
      .then((response: any) => (response && response.ok ? response.text() : null))
      .then((raw: string | null) => (raw ? parseAiJson(raw, 'cloud_ai') : null))
      .catch(() => null)
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      });
  });
}

const LEVEL_RANK = { Low: 0, Medium: 1, High: 2 } as const;

/**
 * Combine on-device and cloud verdicts. The cloud may only RAISE the score:
 * the final score/level is never below the on-device score/level.
 * engine is 'cloud_ai' whenever the cloud answered (the redacted text did leave the phone).
 */
export function mergeVerdicts(local: ApiResult, cloud: ApiResult): ApiResult {
  const cloudWins = cloud.risk_score > local.risk_score;
  const base = cloudWins ? cloud : local;
  const score = Math.max(local.risk_score, cloud.risk_score);
  const level = LEVEL_RANK[cloud.risk_level] > LEVEL_RANK[local.risk_level] ? cloud.risk_level : local.risk_level;

  return {
    ...base,
    risk_score: score,
    risk_level: level,
    confidence: confidenceFromScore(score, base.scam_signals.length > 0),
    engine: 'cloud_ai',
    if_already_sent: cloud.if_already_sent ?? local.if_already_sent
  };
}

const clip = (value: string, max: number): string => (value.length > max ? value.slice(0, max) : value);

/**
 * Parse & sanitize raw AI JSON into a guaranteed ApiResult shape.
 * - Bad JSON, or a missing / non-numeric risk_score  -> null (an unusable verdict is never invented).
 * - Other missing fields get safe, non-claiming defaults.
 * - Text fields are length-capped so a manipulated model reply cannot flood the UI.
 */
export function parseAiJson(raw: string, engine: 'cloud_ai' | 'on_device_rules'): ApiResult | null {
  try {
    const cleaned = String(raw).replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    if (!obj || typeof obj !== 'object') return null;

    const rawScore = typeof obj.risk_score === 'string' && obj.risk_score.trim() !== '' ? Number(obj.risk_score) : obj.risk_score;
    if (typeof rawScore !== 'number' || !Number.isFinite(rawScore)) return null;

    let score = Math.max(0, Math.min(100, rawScore));
    // A level claimed by the model can never sit below its own band.
    if (obj.risk_level === 'High') score = Math.max(score, RISK_THRESHOLDS.HIGH);
    else if (obj.risk_level === 'Medium') score = Math.max(score, RISK_THRESHOLDS.MEDIUM);

    let level: 'High' | 'Medium' | 'Low' = 'Low';
    if (score >= RISK_THRESHOLDS.HIGH) level = 'High';
    else if (score >= RISK_THRESHOLDS.MEDIUM) level = 'Medium';

    const signals: string[] = Array.isArray(obj.scam_signals)
      ? obj.scam_signals.slice(0, 6).map((s: unknown) => clip(String(s), 120))
      : [];

    return {
      risk_level: level,
      risk_score: score,
      scam_type:
        typeof obj.scam_type === 'string' && obj.scam_type
          ? clip(obj.scam_type, 80)
          : (level === 'High' ? 'Suspicious Phishing' : NO_PATTERN_LABEL),
      explanation: typeof obj.explanation === 'string' && obj.explanation ? clip(obj.explanation, 400) : 'Analysis completed.',
      scam_signals: signals,
      recommended_action:
        typeof obj.recommended_action === 'string' && obj.recommended_action
          ? clip(obj.recommended_action, 300)
          : 'Verify with sender before tapping links or sharing information.',
      confidence: confidenceFromScore(score, signals.length > 0),
      engine,
      if_already_sent: typeof obj.if_already_sent === 'string' ? clip(obj.if_already_sent, 300) : undefined
    };
  } catch {
    return null;
  }
}

// ============================================================
// LINK CHECKING
// ============================================================

/**
 * Hosting / sharing / user-content domains. ANYONE can publish a page here, so a link on one of
 * these is NEVER trusted, even if the parent brand (e.g. google.com) is otherwise official.
 */
export const UNTRUSTED_HOSTING_DOMAINS = [
  'sites.google.com', 'docs.google.com', 'drive.google.com', 'forms.gle', 'forms.google.com',
  'storage.googleapis.com', 'firebaseapp.com', 'web.app', 'github.io', 'wixsite.com',
  'blogspot.com', 'notion.site', 'linktr.ee'
];

/**
 * Exact official hosts ONLY (no subdomain trust). Used where the parent domain also hosts
 * user content or unrelated services (google.com), and for brand-owned link shorteners.
 */
const TRUSTED_EXACT_HOSTS = [
  'google.com', 'www.google.com', 'pay.google.com', 'accounts.google.com', 'g.co',
  'amzn.to', 'amzn.in', 'fkrt.it',
  'amazon.in', 'www.amazon.in', 'amazon.com', 'www.amazon.com',
  'flipkart.com', 'www.flipkart.com'
];

/**
 * Brand-owned registrable domains. Subdomains of THESE ONLY are trusted (e.g. retail.onlinesbi.sbi,
 * track.swiggy.com), because the brand itself controls every subdomain. Compared against the
 * registrable domain, never with "contains".
 */
const TRUSTED_BRAND_BASES = [
  'amazon.in', 'amazon.com', 'flipkart.com',
  'sbi.co.in', 'onlinesbi.sbi', 'hdfcbank.com', 'icicibank.com', 'axisbank.com', 'kotak.com', 'pnbindia.in',
  'apple.com', 'microsoft.com', 'whatsapp.com',
  'myntra.com', 'nykaa.com', 'meesho.com', 'ajio.com',
  'blinkit.com', 'zepto.com', 'tataplay.com', 'dishtv.in', 'bookmyshow.com', 'zerodha.com',
  'swiggy.com', 'zomato.com', 'uber.com', 'olacabs.com',
  'delhivery.com', 'bluedart.com',
  'airtel.in', 'jio.com', 'myvi.in',
  'paytm.com', 'phonepe.com',
  'irctc.co.in', 'makemytrip.com'
];

/** Government namespaces: only government bodies can register under these. */
const GOV_SUFFIXES = ['.gov.in', '.nic.in'];

/** Second-level public suffixes, so "sbi.co.in" is a registrable domain and "co.in" is not. */
const SECOND_LEVEL_SUFFIXES = [
  'co.in', 'gov.in', 'nic.in', 'org.in', 'net.in', 'ac.in', 'res.in', 'edu.in', 'firm.in', 'gen.in', 'ind.in',
  'co.uk', 'org.uk', 'com.au', 'co.za', 'com.br'
];

/** Known brand / bank words. An UNOFFICIAL host that contains one of these is a look-alike. */
export const BRAND_WORDS = [
  'sbi', 'hdfc', 'icici', 'axis', 'kotak', 'pnb', 'amazon', 'flipkart', 'paytm', 'phonepe', 'gpay',
  'irctc', 'uidai', 'aadhaar', 'incometax', 'epfo'
];

/** Host part of a URL with or without scheme, lower-cased; port, userinfo ("amazon.in@evil.com") and trailing dot removed. */
export function extractHost(url: string): string {
  let rest = String(url || '').trim().toLowerCase();
  rest = rest.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  rest = rest.split(/[\/?#]/)[0];
  if (rest.includes('@')) rest = rest.slice(rest.lastIndexOf('@') + 1);
  rest = rest.replace(/:\d*$/, '').replace(/\.+$/, '');
  return rest;
}

/** Registrable domain = last two labels (last three under a known second-level suffix such as co.in). */
export function registrableDomain(host: string): string {
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  return SECOND_LEVEL_SUFFIXES.includes(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

/**
 * True only for official hosts we list explicitly, or subdomains of brand-owned base domains.
 * "amazon.in.refund-help.top", "hdfcbank-secure.com" and "sites.google.com" are all NOT trusted.
 */
export function isTrustedDomain(url: string): boolean {
  try {
    const host = extractHost(url);
    if (!host || !host.includes('.')) return false;

    // Free hosting / sharing services are never trusted, whoever owns the parent domain.
    if (UNTRUSTED_HOSTING_DOMAINS.some(d => host === d || host.endsWith('.' + d))) return false;

    if (TRUSTED_EXACT_HOSTS.includes(host)) return true;
    if (GOV_SUFFIXES.some(suffix => host.endsWith(suffix))) return true;
    return TRUSTED_BRAND_BASES.includes(registrableDomain(host));
  } catch {
    return false;
  }
}

/** True when the link sits on a free hosting / sharing / forms site (anyone can publish there). */
export function isUntrustedHostingUrl(url: string): boolean {
  const host = extractHost(url);
  return UNTRUSTED_HOSTING_DOMAINS.some(d => host === d || host.endsWith('.' + d));
}

/** First brand word found inside the HOST of a URL (not the path), or null. */
export function brandWordInHost(url: string): string | null {
  const host = extractHost(url);
  return BRAND_WORDS.find(word => host.includes(word)) ?? null;
}

const HOST_LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
const SUSPICIOUS_BARE_TLDS = 'top|xyz|click|site|online|buzz|club|work|link|space|apk|app';
const URL_PATTERNS: RegExp[] = [
  /https?:\/\/[^\s]+/gi,                                                   // with scheme
  /\bwww\.[^\s]+/gi,                                                        // www.something
  new RegExp(`\\b(?:${HOST_LABEL}\\.)+[a-z]{2,24}\\/[^\\s]*`, 'gi'),         // ANY domain followed by a path (bit.ly/xyz, sbi-yono-update.com/login)
  new RegExp(`\\b(?:${HOST_LABEL}\\.)+(?:${SUSPICIOUS_BARE_TLDS})\\b(?:\\/[^\\s]*)?`, 'gi') // bare high-risk TLD domains
];

/** Every link-like thing in a message, with or without http/https. Nested/duplicate hits are collapsed. */
export function extractUrls(text: string): string[] {
  const found: { start: number; end: number; value: string }[] = [];

  for (const pattern of URL_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      if (m[0].length === 0) {
        pattern.lastIndex += 1;
        continue;
      }
      // skip e-mail addresses (user@domain.com/...)
      if (m.index > 0 && text[m.index - 1] === '@') continue;
      const value = m[0].replace(/[)\]}>.,;:!?'"]+$/, '');
      if (!value || !value.includes('.')) continue;
      found.push({ start: m.index, end: m.index + value.length, value });
    }
  }

  const kept = found.filter(
    (a, i) => !found.some((b, j) => j !== i && b.start <= a.start && b.end >= a.end && (b.end - b.start > a.end - a.start || (b.end - b.start === a.end - a.start && j < i)))
  );
  return Array.from(new Set(kept.map(k => k.value)));
}

/**
 * Advanced, Context-Aware On-Device Heuristic Engine
 * Specially calibrated for Indian cyber fraud patterns (UPI, Electricity, Digital Arrest, KYC, Part-time jobs)
 * and avoids false positives on routine e-commerce, banking, and OTP messages.
 * NOTE: no message can be proven safe; "Low" only means no known scam pattern was found.
 */
export function analyzeOfflineFallback(message: string): ApiResult {
  const text = message.trim();
  const lower = text.toLowerCase();
  const signals: string[] = [];
  let score = 5;
  let detectedType = NO_PATTERN_LABEL;

  // 1. URL Analysis
  const urlMatches = extractUrls(text);
  const hasUrl = urlMatches.length > 0;
  
  let allUrlsTrusted = false;
  let hasSuspiciousDomain = false;

  if (hasUrl) {
    allUrlsTrusted = urlMatches.every(url => isTrustedDomain(url));
    const suspiciousTld = /\.(top|xyz|click|site|online|buzz|club|work|link|space|tk|ml|ga|cf|gq|ngrok\.io|vercel\.app)\b/i;
    const urlShortener = /bit\.ly|tinyurl|is\.gd|cutt\.ly|t\.co|ow\.ly|rb\.gy/i;

    if (allUrlsTrusted) {
      signals.push('Contains official verified company link');
    } else {
      signals.push('Contains external unverified hyperlink');
      score += 25;

      // Look-alike: a NOT-trusted host that carries a known brand/bank word (e.g. sbi-yono-update.com)
      if (urlMatches.some(url => !isTrustedDomain(url) && brandWordInHost(url) !== null)) {
        signals.push('Brand name inside unofficial website');
        score += 40;
      }

      if (urlShortener.test(text)) {
        signals.push('Shortened URL masking actual destination');
        score += 20;
      }
      if (suspiciousTld.test(text)) {
        signals.push('High-risk suspicious domain extension');
        score += 35;
        hasSuspiciousDomain = true;
      }
    }
  }

  // 2. APK Download / Side-loading Scam
  if (/\.apk\b|download\s+app|install\s+(?:the\s+)?app|customer[- ]care\s+app|support\s+app/i.test(lower) && hasUrl) {
    signals.push('Prompts downloading an untrusted Android APK file');
    score += 55;
    detectedType = 'Malicious APK / Trojan Dropper';
  }

  // 3. UPI PIN Scam (You NEVER enter a UPI PIN to receive money!)
  const upiPinPattern = /(?:enter|type|input|enter\s+your|entering|using)(?:\s+your)?(?:\s+\d+\s+digit)?\s+(?:upi\s+)?pin|(?:accept|receive|claim|credit|get)\s+(?:money|payment|cashback|refund|amount|paisa|rupaye).*(?:upi\s+)?pin|approve\s+collect\s+request|collect\s+request.*(?:phonepe|gpay|paytm|bhim|pin)|(?:upi\s+)?pin\s+(?:daalein|enter\s+karein|bhejein|type\s+karein)|(?:paisa|money|amount|rupaye)\s+(?:receive|lene|paane|accept).*(?:upi\s+)?pin/i;
  if (upiPinPattern.test(lower)) {
    signals.push('FATAL: Asks for UPI PIN to receive money (UPI PIN is ONLY for paying out)');
    score += 85;
    detectedType = 'UPI PIN Theft / Collect Request Scam';
  }

  // 4. Electricity / Utility Disconnection Scam
  const electricityPattern = /(?:electricity|power|bijli).*(?:disconnect|disconnected|cut\s*off|suspended|cut)|disconnection\s+order|disconnection\s+in\s+progress|unpaid\s+bill\s+pending.*disconnection|bill\s+(?:not\s+updated|unpaid).*call\s+(?:officer|helpline|electricity)|officer\s+\d{10}|bijli\s+connection\s+kat/i;
  if (electricityPattern.test(lower)) {
    signals.push('Electricity disconnection extortion scam pattern');
    score += 75;
    detectedType = 'Electricity Bill Fraud / Extortion';
  }

  // 5. Digital Arrest / Law Enforcement / Customs Contraband Scam
  const digitalArrestPattern = /digital\s+arrest|cbi\s+(?:officer|warrant)|mumbai\s+crime\s+branch|narcotics\s+control|customs\s+(?:department|parcel|seized|detained)|detained\s+for\s+illegal|parcel\s+(?:contains|has)\s+(?:drugs|contraband|illegal|passport)|arrest\s+warrant\s+issued|trai.*(?:disconnected|illegal)|interpol.*notice|red\s+corner\s+notice|(?:delhi\s+police|cyber\s+crime|police).*complaint\s+registered.*report\s+to\s+(?:cyber\s+)?officer|connect\s+to\s+officer\s+via\s+video\s+call/i;
  if (digitalArrestPattern.test(lower)) {
    signals.push('Digital Arrest / Law Enforcement Impersonation Scam');
    score += 85;
    detectedType = 'Digital Arrest / Cyber Police Extortion';
  }

  // 6. Fake Part-Time Job / Telegram / YouTube Task Scam
  const jobScamPattern = /(?:earn|income|salary)\s+(?:rs\.?|₹|inr)?\s*\d{3,5}\s*(?:daily|per\s+day|per\s+hour|from\s+home|weekly)|part[- ]time.*(?:salary|earn|daily|review|work\s+from\s+home)|telegram:?\s*(?:t\.me|@)|join\s+telegram|t\.me\/[a-z0-9_]+|ghar\s+baithe\s+kamayein|rojana.*rupaye\s+kamayein|daily\s+payout\s*(?:rs\.?|₹)?\s*\d+|deposit.*registration\s+fee|make\s+money\s+online.*daily|review\s+job.*earn|like\s+(?:youtube\s+videos|hotels|videos)\s+and\s+(?:earn|get\s+paid)/i;
  if (jobScamPattern.test(lower)) {
    signals.push('High-return task / Telegram fake job fraud');
    score += 70;
    detectedType = 'Part-Time Job / Task Scam';
  }

  // 7. Bank Account Suspension / PAN / KYC Scam
  const kycBankPattern = /(?:sbi|hdfc|icici|axis|pnb|kotak|bob|canara|bank)\s+(?:account|a\/c)?\s*(?:will\s+be\s+)?(?:suspended|blocked|deactivated|closed|frozen)|(?:kyc|pan\s*card)\s*(?:not\s+updated|expired|link).*call\s+officer|account\s+will\s+be\s+blocked.*call\s+officer|pan\s*(?:card)?\s*(?:not\s+updated|expired|link)|update\s+(?:your\s+)?(?:kyc|pan)|yono\s+(?:account|reward)|khata\s+(?:block|band)/i;
  if (kycBankPattern.test(lower)) {
    if (hasUrl && !allUrlsTrusted) {
      signals.push('Fake Bank/KYC suspension threat with unverified link');
      score += 80;
      detectedType = 'Bank Phishing / KYC Harvest Scam';
    } else if (/call\s+(?:officer\s+at\s+)?\d{10}|whatsapp\s+(?:us\s+)?at/i.test(lower)) {
      signals.push('Fake Bank/KYC suspension threat prompting call/WhatsApp');
      score += 70;
      detectedType = 'Bank Impersonation Vishing';
    } else {
      score += 25;
    }
  }

  // 8. Lottery / Prize / Gift / Lucky Draw Scam
  const lotteryPattern = /(?:won|winner|lottery|prize|lucky\s+draw|kbc|cash\s+reward)\s*(?:of\s*)?(?:rs\.?|₹|\$)?\s*\d+|kbc.*lottery|\d+\s*lakh\s*(?:inr|rupaye|rs)|congratulations.*selected\s+for\s+(?:gift|prize|cash|reward)|lottery\s+lag\s+gayi|lucky\s+draw.*jeet\s+chuka/i;
  if (lotteryPattern.test(lower)) {
    signals.push('Unrealistic lottery or cash prize claim');
    score += 65;
    detectedType = 'Lottery / Prize Scam';
  }

  // 8b. Illegal Loan App / Extortion / Harassment Scam
  const loanExtortionPattern = /instant\s+personal\s+loan.*(?:approved|without\s+cibil|5\s+mins)|overdue\s+loan.*notice\s+to\s+your\s+family|morphed\s+photos.*shared|loan\s+recovery\s+agent\s+visiting/i;
  if (loanExtortionPattern.test(lower)) {
    signals.push('Illegal loan app / social extortion blackmail tactic');
    score += 85;
    detectedType = 'Loan App Extortion / Harassment';
  }

  // 9. High-pressure urgency tactics
  if (/immediately|within\s+24\s+hours|urgent|action\s+required|last\s+chance|today\s+only/i.test(lower)) {
    if (score >= 35) {
      signals.push('High-pressure psychological urgency tactic');
      score += 20;
    }
  }

  // 10. Legitimate E-Commerce / Delivery Handling (Amazon, Flipkart, etc.)
  const deliveryKeywords = /package|delivery|parcel|delivered|out\s+for\s+delivery|arriving\s+today|order\s+#/i;
  if (deliveryKeywords.test(lower) && score < 70) {
    if (hasUrl) {
      if (allUrlsTrusted) {
        signals.push('Confirmed official tracking link from trusted merchant');
        score = 10;
        detectedType = 'Routine Delivery Notification';
      } else {
        signals.push('Delivery message with unverified external link');
        score += 35;
        if (score >= 60) detectedType = 'Fake Delivery Smishing';
      }
    } else {
      score = Math.min(score, 15);
      detectedType = 'Routine Delivery Notification';
    }
  }

  // 11. Legitimate 2FA / OTP Handling
  const isOtpMessage = /otp|verification\s+code|one[- ]time\s+password|security\s+code/i.test(lower);
  if (isOtpMessage) {
    if (!hasUrl && !upiPinPattern.test(lower)) {
      signals.push('Standard 2FA / OTP security code (No external link detected)');
      score = 5;
      detectedType = 'Routine OTP / Security Code';
    } else if (hasUrl && !allUrlsTrusted) {
      signals.push('OTP message containing an unverified external link');
      score += 45;
      detectedType = 'OTP Interception / Phishing Link';
    }
  }

  // 12. Legitimate Bank Credit / Debit Transaction Handling
  const isBankTransaction = /(?:debited|credited|transferred|withdrawn|spent|paid)\s+(?:by|for|inr|rs\.?|₹)\s*\d+|a\/c\s+[x\d]+\s+(?:debited|credited)|avl\s+bal/i.test(lower);
  if (isBankTransaction && !hasUrl && !upiPinPattern.test(lower) && !kycBankPattern.test(lower)) {
    signals.push('Standard bank transactional debit/credit alert');
    score = 5;
    detectedType = 'Routine Bank Transaction Alert';
  }


  // ------------------------------------------------------------------
  // 13. NEW: Instant-loan app lure ("no documents, no CIBIL, install app")
  //     Applied after the routine-message rules above so they cannot reset it.
  // ------------------------------------------------------------------
  const instantLoanWord = /\bloans?\b/i.test(lower);
  const noDocsClaim = /(?:no|without|zero)\s+(?:any\s+)?(?:documents?|docs?|cibil|credit\s+(?:check|score)|income\s+proof|salary\s+slip|collateral|paperwork)|bina\s+(?:koi\s+)?(?:documents?|cibil|paperwork)/i.test(lower);
  const installAppPrompt = /(?:install|download)\s+(?:the\s+|our\s+)?(?:\w+\s+)?(?:app|apk)\b/i.test(lower);
  if (instantLoanWord && (noDocsClaim || (installAppPrompt && hasUrl && !allUrlsTrusted))) {
    signals.push('Instant loan lure: no documents / no CIBIL / install app');
    score = Math.max(score, 80);
    detectedType = 'Instant Loan App Scam';
  }

  // ------------------------------------------------------------------
  // 14. NEW: Fake police / CBI / cyber-crime ("case registered, stay on video call, arrest")
  // ------------------------------------------------------------------
  const lawEnforcementWord = /police|\bcbi\b|cyber\s*crime|crime\s+branch|\bncb\b|narcotics|enforcement\s+directorate|\bed\s+officer|customs|\btrai\b/i.test(lower);
  const caseRegistered = /(?:case|fir|complaint)\s+(?:has\s+been\s+|is\s+|was\s+)?(?:registered|filed|lodged)|(?:registered|filed|lodged)\s+(?:a\s+|an\s+|the\s+)?(?:case|fir|complaint)|case\s+(?:darj|register)/i.test(lower);
  const stayOnVideoCall = /(?:stay|remain|be|join|keep|rahein|rahna)\s+(?:on|in|connected\s+on)\s+(?:the\s+|this\s+)?(?:video|skype|whatsapp)\s+call|(?:do\s+not|don'?t|mat)\s+(?:disconnect|cut)|video\s+call\s+(?:par|pe|per)\s+(?:bane|rahein|rahe|judein)/i.test(lower);
  const arrestThreat = /arrest|giraft(?:a|ar)r?|in\s+custody|jail|detain/i.test(lower);
  const lawSignals = [caseRegistered, stayOnVideoCall, arrestThreat].filter(Boolean).length;
  if ((lawEnforcementWord && lawSignals >= 2) || (stayOnVideoCall && arrestThreat)) {
    signals.push('Fake police / CBI / cyber-crime case with arrest threat and video-call order');
    score = Math.max(score, 85);
    detectedType = 'Fake Police / Cyber-Crime Arrest Scam';
  }

  // ------------------------------------------------------------------
  // 15. NEW: Hinglish KYC-expiry / account-block threat (works even WITHOUT a link)
  // ------------------------------------------------------------------
  const kycWordHinglish = /\bkyc\b|\bpan\b|(?:bank\s+)?(?:account|khata|a\/c)/i.test(lower);
  const expiryOrBlock = /(?:kyc|account|khata|a\/c)[^.\n]{0,40}?(?:expire[sd]?|expiry|band\s+ho\s+jay(?:e|ega|enge)|block\s+ho\s+jay(?:e|ega|enge)|suspend\s+ho)|(?:expire|band\s+ho\s+jay|block\s+ho\s+jay)/i.test(lower);
  const updateNowHinglish = /(?:abhi|turant|jaldi|aaj\s+hi)\s+(?:\w+\s+)?update\s+kar(?:ein|en|o|iye)|update\s+kar(?:ein|en|o|iye)\s+(?:abhi|turant|warna|nahi\s+to)/i.test(lower);
  const hinglishMarker = /\b(?:karein|karen|kijiye|kariye|jayega|jayegi|ho\s+jay|abhi|turant|warna|aapka|aapke|apna|apka)\b/i.test(lower);
  if (kycWordHinglish && hinglishMarker && ((expiryOrBlock && updateNowHinglish) || (/\bkyc\b/i.test(lower) && expiryOrBlock) || (/band\s+ho\s+jay|block\s+ho\s+jay/i.test(lower) && updateNowHinglish))) {
    signals.push('Hinglish KYC-expiry / account-block threat demanding immediate update');
    score = Math.max(score, 80);
    detectedType = 'KYC Expiry / Account Block Scam (Hinglish)';
  }


  // ------------------------------------------------------------------
  // 16. NEW: link on a free hosting / forms site + asks for money, offers a job, or promises a refund
  //     (e.g. Google Sites "tax refund" page, Google Forms "pay Rs 500 registration" job scam).
  //     A hosting link alone stays as before; the extra signal is what raises it to High.
  // ------------------------------------------------------------------
  const hostingLink = urlMatches.some(url => isUntrustedHostingUrl(url));
  if (hostingLink) {
    const asksForMoney = /(?:pay|deposit|send|transfer)\s+(?:a\s+|the\s+|an\s+)?(?:rs\.?|₹|inr)?\s*\d|(?:registration|processing|joining|security|verification|refundable)\s+(?:fee|fees|charge|charges|amount|deposit)|(?:fee|charges?)\s+(?:of\s+)?(?:rs\.?|₹|inr)\s*\d|(?:rs\.?|₹|inr)\s*\d[\d,]*\s*(?:registration|fee|charges?|deposit)/i.test(lower);
    const jobOffer = /\b(?:hiring|vacancy|vacancies|recruitment|job\s+offer|work\s+from\s+home|part[- ]time|earn\s+(?:rs\.?|₹)?\s*\d|per\s+day|daily\s+income)\b/i.test(lower);
    const refundClaim = /(?:tax|income\s+tax|gst|itr)\s+refund|refund\s+(?:of|is|has\s+been|approved|pending|credited)|claim\s+(?:your\s+)?(?:refund|reward|prize|cashback)/i.test(lower);
    if (asksForMoney || jobOffer || refundClaim) {
      signals.push('Free hosting / forms-site link combined with a payment request, job offer or refund claim');
      score = Math.max(score, 80);
      detectedType = asksForMoney || jobOffer ? 'Fake Job / Registration-Fee Scam (hosted form)' : 'Fake Refund Link (hosted page)';
    }
  }

  // Boundary clipping & Final risk classification
  score = Math.min(100, Math.max(5, score));
  let level: 'High' | 'Medium' | 'Low' = 'Low';
  let action = 'No known scam pattern found. This does not prove the message is safe: never share an OTP or PIN, and check with your bank if money is involved.';

  if (score >= RISK_THRESHOLDS.HIGH) {
    level = 'High';
    if (detectedType === NO_PATTERN_LABEL) detectedType = 'High-Risk Cyber Fraud';
    action = "DO NOT CLICK any link. NEVER enter your UPI PIN or share OTPs. Block and report this sender.";
  } else if (score >= RISK_THRESHOLDS.MEDIUM) {
    level = 'Medium';
    if (detectedType === NO_PATTERN_LABEL) detectedType = 'Suspicious / Unsolicited Promotion';
    action = 'Exercise caution. Verify the sender through official app or customer care before taking action.';
  } else {
    level = 'Low';
  }

  // Confidence comes from the real signal score. No signal at all -> no confidence number.
  const confidence = confidenceFromScore(score, score > BASELINE_SCORE);

  return {
    risk_level: level,
    risk_score: score,
    scam_type: detectedType,
    explanation: signals.length > 0
      ? `Analysis verdict based on: ${signals.join('; ')}.`
      : 'No known scam pattern was found in this message. This does not prove it is safe.',
    scam_signals: signals,
    recommended_action: action,
    confidence,
    engine: 'on_device_rules'
  };
}
