# ScamSafe Privacy Policy

_Last updated: 1 November 2026._

**Developer:** PremKumar.M  
**Privacy contact:** premkumarqu@gmail.com

ScamSafe is an Android app that reads your SMS messages to find scam and phishing messages and warn you. This page
says exactly what it reads, where it is processed, what is stored and how to delete it.

## What ScamSafe reads and why
- **SMS messages**, through the Android permissions **READ_SMS** and **RECEIVE_SMS**. They are used for one purpose
  only: to detect scam and phishing messages and show you a warning. They are not used for advertising, profiling,
  research or anything else.
- Android asks for these permissions only **after** you tap **I agree** on the "Before you start" screen. If you tap
  **No thanks**, nothing is read.
- When you scan, ScamSafe reads up to your 10 most recent messages from the last 7 days. While Auto-Scan is on and the
  app is running, it also checks new messages as they arrive.

## Where the checking happens
- **Messages from your inbox are checked on your phone only. They are never uploaded.** Scanning does not need the
  internet.

## Text you paste yourself (Manual Text Check)
- If you paste a message into **Manual Text Check**, a masked copy of that pasted text is also sent to our server for a
  second opinion from an AI model. This happens only for text you paste yourself.
  - **Masked first, on your phone:** card numbers, OTP / verification codes, Aadhaar numbers, phone numbers and bank
    account numbers are replaced with placeholders before anything is sent.
  - **Not masked:** other text, such as names, amounts, UPI IDs and links, is sent as written.
  - Up to **1000 characters** are sent over an encrypted HTTPS connection to the ScamSafe server (not directly to an AI
    provider). The sender's number is not sent.
  - A random **install id** (not linked to your phone, SIM or account) is sent with the request, and the server sees
    your IP address, only to limit abuse (rate limiting).
  - The server passes the masked text to an AI provider (currently Groq) to produce the verdict. The ScamSafe server does
    not write message text to logs or a database. The provider processes the text only to produce your result.
  - If the cloud service fails or takes longer than 10 seconds, your phone's own result is used.
  - The cloud answer can only make a result **more** cautious, never less.
- Each result shows how it was checked: **"Checked on your phone only"** or **"Checked with cloud AI (personal numbers hidden)"**.

## What is stored on your phone
- Your scan history: the **full original message text**, sender, time and the result. It is kept in the app's private
  storage on this phone, is not backed up (backup is disabled) and is not uploaded.
- Your settings (Auto-Scan on/off), the record that you agreed and a random install id.

## Nothing is sold or shared
- We do not sell your data, and we do not share it with advertisers or data brokers.
- The only other party that can receive text is the AI provider described above, only for text you paste, only after
  masking, and only to produce your result.

## Security
- Data sent to our server travels over HTTPS (TLS). The app contains no AI provider key; keys are kept only on our server.
- The server limits message length and the number of requests per user.

## Retention and deleting your data
- On your phone: open the menu (top left) → **Delete all my data**. This removes the scan history, settings, your consent
  and the install id, and shows "Before you start" again. You can also delete one scan from History, or use **Clear**.
- To remove the SMS permission: Android Settings → Apps → ScamSafe → Permissions. Uninstalling the app removes all local data.
- Our server does not store message text, so there is nothing to delete there. Server request counters used for rate
  limiting are short-lived and are not linked to your identity.

## Children
- ScamSafe is not directed at children under 13.

## Limits
- ScamSafe can miss scams and can flag genuine messages. It is not a guarantee of safety. If money or an OTP is involved,
  call your bank.

## Changes and contact
If this policy changes, the new version will be published at the Privacy policy link in the app (menu → Privacy policy).
Questions or deletion help: premkumarqu@gmail.com
