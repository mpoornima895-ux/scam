/**
 * ScamSafe AI Configuration
 *
 * Groq is 100% FREE, extremely fast (LPU inference), and requires no credit card.
 * Get your free Groq API key in 30 seconds at: https://console.groq.com/keys
 */

export type AIProvider = 'groq' | 'gemini' | 'openai' | 'offline';

// ============================================================
// ⚙️ CHOOSE YOUR AI PROVIDER:
// 'groq'   -> Recommended (Free, ultra-fast, handles 10+ msgs effortlessly)
// 'gemini' -> Free tier via Google AI Studio
// 'openai' -> Requires paid OpenAI account
// 'offline'-> Uses built-in rule engine (works offline without any API key)
// ============================================================
export const AI_PROVIDER: AIProvider = 'groq';

// ============================================================
// 🔑 SET YOUR GROQ API KEY HERE
// Create a free key at: https://console.groq.com/keys (starts with gsk_...)
// ============================================================
export const GROQ_API_KEY: string = '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';

// Groq Model options:
// - 'llama-3.3-70b-versatile' : Best reasoning & highest scam detection accuracy (Recommended)
// - 'llama-3.1-8b-instant'     : Ultra-low latency (~200ms per message)
export const GROQ_MODEL = 'llama-3.3-70b-versatile';

// ============================================================
// (Optional) Other Provider Keys:
// ============================================================
export const GEMINI_API_KEY: string = '';
export const OPENAI_API_KEY: string = '';
