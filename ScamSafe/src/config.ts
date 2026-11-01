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

// Link opened by Settings -> "Privacy policy" and used in Play Console. It is the hosted privacy.html at the
// root of this repo (GitHub Pages). Open it in a browser and make sure it loads BEFORE any Play submission.
export const PRIVACY_URL: string = 'https://mpoornima895-ux.github.io/scam/privacy.html';

// Play-policy setting. false = messages that come from the SMS inbox / incoming SMS are checked ON THE PHONE ONLY
// and are never uploaded. Only text the user pastes into "Manual Text Check" may go to the cloud check.
// Keep this false for any build that is submitted to Google Play.
export const CLOUD_FOR_SMS_SCANS: boolean = false;

// Cloud call limits. The backend enforces the same max length independently.
export const ANALYZE_TIMEOUT_MS = 10_000;
export const ANALYZE_MAX_CHARS = 1000;

export const CLOUD_ENABLED: boolean = ANALYZE_URL.trim().length > 0;
