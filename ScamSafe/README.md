# ScamSafe 🛡️

SMS scam checker for common Indian scams (UPI PIN / collect requests, electricity-disconnection threats,
fake police / CBI "digital arrest", KYC and bank-block threats, fake loan apps, part-time-job / Telegram tasks,
malicious APK links, lottery and delivery smishing). English, Hindi and Hinglish.

> **ScamSafe can miss scams.** If money or an OTP is involved, call your bank. No message can be proven safe, so the
> app never says "Safe"; the lowest result is **"No known scam pattern found"**.

## How it works (and what leaves your phone)

- **On-device engine (always runs):** rule-based checks in `src/api.ts`. Scanning happens on the phone.
- **Optional cloud check:** only if `ANALYZE_URL` in `src/config.ts` is set to your deployed backend
  (`backend/analyze.js`). It is **empty by default**, so a stock build sends nothing anywhere.
  When enabled:
  1. card, OTP, Aadhaar, phone and bank-account numbers are masked on the phone (`src/redaction.ts`) **before** sending
     (names, amounts and links are **not** masked),
  2. at most 1000 characters go to *your* backend, never to an AI provider directly,
  3. the AI key (`GROQ_API_KEY`) exists only as a server secret; **the APK contains no AI key**,
  4. the cloud answer can only **raise** the on-device score, never lower it,
  5. if the call fails or takes more than 10 s, the on-device result is used.
- Every result card says either **"Checked on your phone only"** or **"Checked with cloud AI (personal numbers hidden)"**.
- First launch shows a "Before you start" consent screen. SMS permission is asked only after **I agree**.
  Menu → **Delete all my data** wipes everything the app stored. See [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

## Tech stack
React Native 0.86 / Expo SDK 57, TypeScript (strict), Android Kotlin native module (`modules/sms-reader`),
AsyncStorage, Cloudflare Worker backend (optional).

## Getting started

```bash
npm install --legacy-peer-deps
npm run typecheck     # tsc --noEmit
npm test              # unit tests + development-set regression check
```

## Tests and what they mean

| Command | What it does |
|---|---|
| `npm test` | Compiles `src/*.ts`, runs the unit tests (links / look-alikes, redaction, AI-JSON parsing, storage, consent + delete-all, cloud merge / timeout, new scam types, backend) and then the development-set regression check. |
| `npm run bench` | Only the development-set check (`run_benchmark_200.js`). |
| `npm run holdout` | Measures the engine on **real** messages you collected (see below). |

### Development set is NOT proof of accuracy
`test/dev_set_200.json` (100 scam-style + 100 genuine-style messages) was **written by the developer while building
the rules**. Passing it only says "nothing regressed". It says nothing about how many real scams the app catches or how
many real messages it wrongly flags. Do not quote its percentage as the app's accuracy.

### Holdout set (honest measurement)
1. Paste **real** messages into `test/holdout_template.json` (a JSON array). Remove OTPs, card/account/Aadhaar numbers and phone numbers first.
   Each item has the same fields as the dev set:
   ```json
   { "id": "H-001", "category": "Bank phishing", "text": "<the SMS>", "expected": "High" }
   ```
   `expected` is `"High"` for a scam and `"Low"` for a genuine message.
2. Run `npm run holdout`. It prints caught / missed / false-alarm counts and lists every mistake.
3. **Do not tune the rules using the holdout messages.** If you fix a rule for one of them, move that message to the
   dev set and collect new holdout messages. Fewer than ~30 scams or ~30 genuine messages is too small to trust.

## Backend (optional cloud check)

`backend/analyze.js` is a Cloudflare Worker: `POST {text}` → JSON verdict. It enforces a 1000-character limit,
rate-limits per IP and per install id (in-memory per instance; add a Cloudflare Rate Limiting rule for a hard global
limit), wraps the SMS in delimiters, and tells the model that the SMS is untrusted data.

```bash
cd backend
npx wrangler secret put GROQ_API_KEY     # paste the key when prompted; never commit it
npx wrangler deploy                      # prints https://scamsafe-analyze.<account>.workers.dev
```
Then set `ANALYZE_URL` in `src/config.ts` to that URL and rebuild. To ship **on-device only**, leave it empty.
Also set `PRIVACY_URL` in `src/config.ts` to where you host `PRIVACY_POLICY.md`.

## Release signing

Release APKs are signed with **your own** key. The build **fails** with "Release keystore not configured" if the key is
missing; it never falls back to the public debug key (a debug-signed APK is what phone scanners flag).
Debug builds use Android's auto-generated debug key.

1. Create the keystore once (keep the file and passwords safe; if you lose them you cannot update the app):
   ```bash
   keytool -genkeypair -v -storetype PKCS12 -keystore scamsafe-release.jks \
     -alias scamsafe -keyalg RSA -keysize 2048 -validity 10000
   ```
   `keytool` asks for the passwords and your details. Never put them in a file in the repo.
2. Base64-encode it for GitHub: `base64 -w0 scamsafe-release.jks` (macOS: `base64 -i scamsafe-release.jks`).
3. In GitHub → Settings → Secrets and variables → Actions, add:

   | Secret | Value |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | the base64 text from step 2 |
   | `ANDROID_KEYSTORE_PASSWORD` | the store password you typed |
   | `ANDROID_KEY_ALIAS` | `scamsafe` (the alias you used) |
   | `ANDROID_KEY_PASSWORD` | the key password you typed |

4. Push to `main`. `.github/workflows/build.yml` runs `tsc`, `npm test`, builds `assembleRelease`, checks the APK is not
   debug-signed and uploads `app-release.apk`.

**Local release build:** create `android/keystore.properties` (git-ignored) with
`MYAPP_UPLOAD_STORE_FILE`, `MYAPP_UPLOAD_STORE_PASSWORD`, `MYAPP_UPLOAD_KEY_ALIAS`, `MYAPP_UPLOAD_KEY_PASSWORD`
(a relative store path is resolved from `android/`), then `cd android && ./gradlew assembleRelease`.

**App id:** the package is `com.scamsafe.app`. Change it to an id you own (reverse of a domain/handle you control)
in `app.json` (`expo.android.package`), `android/app/build.gradle` (`namespace`, `applicationId`) and the Kotlin
package folder / `package` lines, or edit `app.json` and run `npm run prebuild`. The `plugins/withReleaseSigning.js`
plugin re-applies the signing setup on every prebuild.
