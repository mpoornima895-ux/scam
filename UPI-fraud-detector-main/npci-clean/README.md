# NPCI Fraud Guard

AI-powered fraud detection for Indian digital payments. Instant verdict on any suspicious SMS, UPI request, or WhatsApp message.

**Covers all 8 NPCI payment systems:** UPI · IMPS · RuPay · NACH · AePS · NFS/ATM · NETC/FASTag · CTS

---

## Features

- **Instant AI verdict** — High / Medium / Low risk with confidence score
- **Plain-language signals** — exactly what triggered the flag
- **Action advice** — one clear sentence on what to do
- **Hindi/Hinglish support** — responds in the same language as the input
- **8 sample messages** — try examples instantly
- **WhatsApp share** — forward results to warn family
- **Rate limited** — 10 req/min per IP (requires Upstash)
- **No auth, no DB** — fully stateless

---

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/npci-fraud-guard
cd npci-fraud-guard
npm install
```

### 2. Set environment variables

```bash
cp .env.local.example .env.local
# Then edit .env.local with your keys
```

Required:
```env
ANTHROPIC_API_KEY=sk-ant-...
```

Optional (rate limiting via Upstash — free tier works):
```env
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
```

> If Upstash vars are not set, rate limiting is simply skipped. Fine for local dev.

### 3. Run

```bash
npm run dev
# Open http://localhost:3000
```

---

## Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Set `ANTHROPIC_API_KEY` (and optionally Upstash vars) in Vercel → Project Settings → Environment Variables.

---

## Project Structure

```
npci-fraud-guard/
├── app/
│   ├── api/
│   │   └── check/
│   │       └── route.ts        ← POST /api/check (backend)
│   ├── globals.css             ← Dark terminal theme
│   ├── layout.tsx              ← Root layout + fonts + SEO metadata
│   └── page.tsx                ← Main page UI (React client component)
├── lib/
│   ├── prompt.ts               ← NPCI-aware Claude system prompt
│   └── schema.ts               ← Zod validation + TypeScript types
├── .env.local.example          ← Template for env vars
├── next.config.js
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

---

## API Contract

### `POST /api/check`

**Request:**
```json
{ "message": "Your SBI account is blocked..." }
```

**Success (200):**
```json
{
  "success": true,
  "data": {
    "risk_score": 87,
    "risk_level": "High",
    "scam_type": "KYC fraud",
    "scam_signals": [
      "Threatens account block within 2 hours to create panic",
      "Impersonates SBI — real banks never send KYC links via SMS",
      "Shortened URL (bit.ly) hides the real destination"
    ],
    "recommended_action": "Do not click the link. Delete this message and block the number immediately.",
    "language": "en",
    "confidence": 94
  }
}
```

**Errors:**
- `400` — message too short/long
- `429` — rate limit exceeded (10 req/min)
- `500` — Claude API error

---

## Fraud Patterns Detected

| Pattern | Description |
|---------|-------------|
| KYC fraud | Fake account-block threats demanding KYC via link |
| UPI collect scam | Asking user to enter PIN to "receive" money |
| Prize / lottery scam | Fake NPCI lucky draws, BSNL/Jio lotteries |
| Impersonation | Fake SBI, HDFC, NPCI, Amazon, Paytm, police |
| Phishing | bit.ly, misspelled domains, unofficial TLDs |
| Fake urgency | "2 hours", "account permanently closed" |
| PIN / OTP harvesting | Any request for UPI PIN, CVV, Aadhaar OTP |
| Advance fee fraud | Pay small amount to unlock large reward |
| Remote access scam | AnyDesk/TeamViewer install requests |
| NACH fraud | Fake auto-debit cancellation links |
| AePS / Aadhaar fraud | Fake Aadhaar OTP requests |
| FASTag / NETC scam | Fake FASTag KYC blocked links |
| ATM / NFS fraud | Fake card-skimming / unblock alerts |
| QR code scam | QR codes that debit instead of credit |

---

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14 (App Router), React 18, Tailwind CSS |
| Backend | Next.js API Routes (same repo) |
| AI | Anthropic Claude Sonnet (`claude-sonnet-4-20250514`) |
| Rate Limiting | Upstash Redis + `@upstash/ratelimit` (optional) |
| Validation | Zod |
| Fonts | Syne + DM Mono (Google Fonts) |
| Deploy | Vercel (recommended) |

---

## Estimated Monthly Cost (1,000 daily users)

| Item | Cost |
|------|------|
| Claude API (~30M tokens/month) | ₹800–1,200 |
| Upstash Redis (free tier: 10k req/day) | ₹0 |
| Vercel (free tier) | ₹0 |
| **Total** | **₹800–1,200/month** |

---

## License

MIT — free to use, modify, and deploy.
