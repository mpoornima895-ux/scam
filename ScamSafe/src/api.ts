import { AI_PROVIDER, GROQ_API_KEY, GROQ_MODEL, GEMINI_API_KEY, OPENAI_API_KEY } from './config';

export type ApiResult = {
  risk_level: 'High' | 'Medium' | 'Low';
  risk_score: number;
  scam_type: string;
  explanation: string;
  scam_signals: string[];
  recommended_action: string;
  confidence: number;
  if_already_sent?: string;
};

const SYSTEM_PROMPT = `You are ScamSafe AI, an expert cybersecurity scanner that detects SMS scams, smishing, phishing links, bank fraud, OTP theft, fake job offers, lottery scams, and impersonation.
Analyze the given SMS message text and respond ONLY with a raw JSON object matching this schema:
{
  "risk_level": "High" | "Medium" | "Low",
  "risk_score": <number between 0 and 100>,
  "scam_type": "<e.g. Bank Impersonation / Phishing Link / Fake Delivery / Job Scam / Legitimate>",
  "explanation": "<1-2 concise, clear sentences explaining why>",
  "scam_signals": ["<list of 1-4 short detected red flags or safe indicators>"],
  "recommended_action": "<actionable advice for the user>",
  "confidence": <decimal between 0.50 and 0.99>
}
Risk thresholds:
- High (risk_score 75-100): Phishing URLs, urgent account suspensions, OTP requests, fake payment notices.
- Medium (risk_score 40-74): Unsolicited marketing with suspicious shortlinks, suspicious offers, unclear sender.
- Low (risk_score 0-39): Standard 2FA codes requested by user, carrier notifications, personal messages, legitimate receipts.
Return ONLY valid JSON. No markdown backticks, no extra text.`;

/**
 * Primary entry point called by App.tsx.
 * Routes to the configured AI provider (Groq, Gemini, OpenAI, or Offline Fallback).
 */
export async function analyzeMessage(message: string): Promise<ApiResult | null> {
  const text = (message || '').trim();
  if (!text) {
    return {
      risk_level: 'Low',
      risk_score: 0,
      scam_type: 'Empty Message',
      explanation: 'The message body was empty.',
      scam_signals: ['Empty content'],
      recommended_action: 'No action needed.',
      confidence: 0.99
    };
  }

  try {
    if (AI_PROVIDER === 'groq' && GROQ_API_KEY && !GROQ_API_KEY.includes('YOUR_GROQ_API_KEY')) {
      const groqRes = await analyzeWithGroq(text);
      if (groqRes) return groqRes;
    } else if (AI_PROVIDER === 'gemini' && GEMINI_API_KEY && !GEMINI_API_KEY.includes('YOUR_API_KEY')) {
      const geminiRes = await analyzeWithGemini(text);
      if (geminiRes) return geminiRes;
    } else if (AI_PROVIDER === 'openai' && OPENAI_API_KEY && !OPENAI_API_KEY.includes('YOUR_API_KEY')) {
      const openaiRes = await analyzeWithOpenAI(text);
      if (openaiRes) return openaiRes;
    }
  } catch (error) {
    console.warn('[ScamSafe AI] Cloud API request failed, falling back to local engine:', error);
  }

  // Graceful offline fallback: Never leave the user hanging without a verdict
  return analyzeOfflineFallback(text);
}

/**
 * Groq LPU API Integration (Ultra-fast, 100% Free tier)
 * Endpoint: https://api.groq.com/openai/v1/chat/completions
 */
async function analyzeWithGroq(message: string): Promise<ApiResult | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY.trim()}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Analyze this SMS:\n"${message}"` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 450
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[Groq Error ${response.status}]:`, errText);
      return null;
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) return null;

    return parseAiJson(rawContent);
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn('[Groq Request Failed]:', err);
    return null;
  }
}

/**
 * Google Gemini API Integration (Free Tier)
 */
async function analyzeWithGemini(message: string): Promise<ApiResult | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY.trim()}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: `${SYSTEM_PROMPT}\n\nAnalyze this SMS message:\n"${message}"` }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    if (!response.ok) return null;

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return null;

    return parseAiJson(rawText);
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

/**
 * OpenAI API Integration
 */
async function analyzeWithOpenAI(message: string): Promise<ApiResult | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY.trim()}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Analyze this SMS:\n"${message}"` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    if (!response.ok) return null;

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;
    if (!rawContent) return null;

    return parseAiJson(rawContent);
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

/**
 * Parse & sanitize raw AI JSON into guaranteed ApiResult shape
 */
function parseAiJson(raw: string): ApiResult | null {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const obj = JSON.parse(cleaned);

    const score = Math.max(0, Math.min(100, typeof obj.risk_score === 'number' ? obj.risk_score : 50));
    let level: 'High' | 'Medium' | 'Low' = 'Low';
    if (score >= 70 || obj.risk_level === 'High') level = 'High';
    else if (score >= 40 || obj.risk_level === 'Medium') level = 'Medium';

    return {
      risk_level: level,
      risk_score: score,
      scam_type: typeof obj.scam_type === 'string' && obj.scam_type ? obj.scam_type : (level === 'High' ? 'Suspicious Phishing' : 'Legitimate / Informational'),
      explanation: typeof obj.explanation === 'string' ? obj.explanation : 'Analysis completed.',
      scam_signals: Array.isArray(obj.scam_signals) ? obj.scam_signals.map(String) : [],
      recommended_action: typeof obj.recommended_action === 'string' ? obj.recommended_action : 'Verify with sender before tapping links or sharing information.',
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.88,
      if_already_sent: typeof obj.if_already_sent === 'string' ? obj.if_already_sent : undefined
    };
  } catch {
    return null;
  }
}

/**
 * Built-in Heuristic Offline Engine
 * Used when no API key is provided or when offline/network failure occurs.
 */
function analyzeOfflineFallback(message: string): ApiResult {
  const lower = message.toLowerCase();
  const signals: string[] = [];
  let score = 5;

  const urlRegex = /(https?:\/\/[^\s]+|bit\.ly\/[^\s]+|tinyurl\.com\/[^\s]+|t\.co\/[^\s]+|is\.gd\/[^\s]+|cutt\.ly\/[^\s]+)/i;
  const hasUrl = urlRegex.test(message);

  if (hasUrl) {
    signals.push('Contains external hyperlink');
    score += 30;
    if (/bit\.ly|tinyurl|is\.gd|cutt\.ly|t\.co|ow\.ly|rb\.gy/i.test(message)) {
      signals.push('Shortened URL obfuscating actual destination');
      score += 25;
    }
  }

  if (/suspended|blocked|deactivated|expire|urgent|immediately|within 24 hours|action required/i.test(lower)) {
    signals.push('High-pressure urgency tactic');
    score += 25;
  }

  if (/otp|one-time password|verification code|do not share|security code/i.test(lower)) {
    if (hasUrl || /click|login|verify/i.test(lower)) {
      signals.push('Suspicious OTP verification request with link');
      score += 40;
    } else {
      signals.push('Standard 2FA / OTP security code message');
      score = Math.max(0, score - 20);
    }
  }

  if (/won|lottery|prize|claim|reward|free gift|gift card|\$\d+|\₹\d+|selected for/i.test(lower)) {
    signals.push('Unrealistic prize or reward promise');
    score += 35;
  }

  if (/package|delivery|parcel|customs|dhl|fedex|ups|usps|postal|redelivery/i.test(lower) && hasUrl) {
    signals.push('Fake postal/delivery tracking link');
    score += 35;
  }

  if (/bank|sbi|hdfc|icici|chase|wells fargo|paypal|account number|kyc|pan card/i.test(lower) && hasUrl) {
    signals.push('Financial / Bank credential harvest attempt');
    score += 40;
  }

  score = Math.min(100, Math.max(5, score));
  let level: 'High' | 'Medium' | 'Low' = 'Low';
  let scamType = 'Legitimate / Safe';
  let action = 'No suspicious indicators found. Safe to read.';

  if (score >= 70) {
    level = 'High';
    scamType = hasUrl ? 'Phishing / Fraud Smishing' : 'High-Risk Impersonation Scam';
    action = "DO NOT CLICK any links. Never share OTPs or personal details. Block this sender.";
  } else if (score >= 40) {
    level = 'Medium';
    scamType = 'Suspicious / Unsolicited Promotion';
    action = 'Exercise caution. Verify the sender identity through official channels before clicking.';
  }

  return {
    risk_level: level,
    risk_score: score,
    scam_type: scamType,
    explanation: signals.length > 0
      ? `Flagged due to: ${signals.join('; ')}.`
      : 'No standard scam patterns or phishing signatures detected in this text.',
    scam_signals: signals.length > 0 ? signals : ['No suspicious keywords detected'],
    recommended_action: action,
    confidence: 0.85
  };
}
