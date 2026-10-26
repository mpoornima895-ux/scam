/**
 * ScamSafe configuration.
 *
 * IMPORTANT: no AI provider key may ever live in this app. The optional cloud check
 * goes through our own backend (see backend/analyze.js), which holds the provider key
 * as a server-side secret.
 */

// URL of the deployed backend, e.g. 'https://scamsafe-analyze.<account>.workers.dev'.
// Leave EMPTY to ship the on-device engine only: in that case no text ever leaves the phone.
export const ANALYZE_URL: string = 'https://scamsafe-analyze.scam-safe.workers.dev';

// Link opened by Settings -> "Privacy policy". Replace with the hosted PRIVACY_POLICY.md.
export const PRIVACY_URL: string = 'https://example.com/scamsafe/privacy';

// Cloud call limits. The backend enforces the same max length independently.
export const ANALYZE_TIMEOUT_MS = 10_000;
export const ANALYZE_MAX_CHARS = 1000;

export const CLOUD_ENABLED: boolean = ANALYZE_URL.trim().length > 0;
