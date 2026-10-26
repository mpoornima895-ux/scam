# ScamSafe Privacy Policy

_Last updated: 26 October 2026. Placeholder contact: replace `privacy@example.com` with your real address before publishing._

ScamSafe checks your SMS messages for scam patterns. This page says exactly what it reads, where it is processed,
what is stored, and how to delete it.

## What ScamSafe reads
- Your SMS messages, through the Android permissions **READ_SMS** and **RECEIVE_SMS**.
- Android only asks for these **after** you tap **I agree** on the "Before you start" screen. If you tap **No thanks**,
  nothing is read or sent.
- When you scan, it reads up to your 10 most recent messages from the last 7 days. While Auto-Scan is on, it also
  checks new messages as they arrive and when you open the app.
- A message you paste into "Manual Text Check" is processed the same way.

## Where the checking happens
- The scam rules run **on your phone**. Scanning does not need the internet.

## Cloud check (only if enabled in the build)
- The default build has **no cloud address configured and sends nothing**.
- If the developer enables the cloud check, then for each message you scan:
  - **Masked first, on your phone:** card numbers, OTP / verification codes, Aadhaar numbers, phone numbers and bank
    account numbers are replaced with placeholders before anything is sent.
  - **Not masked:** other text, such as names, amounts, UPI IDs and links, is sent as written.
  - Up to **1000 characters** of the masked text are sent to the ScamSafe server (not directly to any AI provider).
    The sender's number is not sent.
  - A random **install id** (not linked to your phone, SIM, or account) is sent with the request, and the server
    sees your IP address, only to limit abuse (rate limiting).
  - The server forwards the masked text to an AI provider (currently Groq) to produce the verdict. The ScamSafe
    server does not write message text to logs or a database. The AI provider's own terms apply to what it does with
    that text.
  - If the cloud service fails or takes longer than 10 seconds, your phone's own result is used.
  - The cloud answer can only make a result **more** cautious, never less.
- Each result shows how it was checked: **"Checked on your phone only"** or **"Checked with cloud AI (personal numbers hidden)"**.

## What is stored on your phone
- Your scan history: the **full original message text**, sender, time and the result. It is kept in the app's private
  storage on this phone, is not backed up to Google (backup is disabled), and is not uploaded anywhere.
- Your settings (Auto-Scan on/off), the record that you agreed, and, only if the cloud check is enabled, the random install id.

## Nothing is sold or shared
- We do not sell your data and we do not share it with advertisers or data brokers.
- The only other party that can receive text is the AI provider described above, and only when the cloud check is enabled,
  only after masking, and only to produce your result.

## Deleting your data
- In the app: open the menu (top left) → **Delete all my data**. This removes the scan history, settings, your consent and
  the install id from the phone, and shows "Before you start" again.
- You can delete one scan from History, or use **Clear** to remove all scans.
- To remove the SMS permission: Android Settings → Apps → ScamSafe → Permissions. Uninstalling the app removes all
  local data.
- Because the server stores no message text, there is nothing to delete there.

## Limits
- ScamSafe can miss scams and can flag genuine messages. It is not a guarantee of safety. If money or an OTP is involved,
  call your bank.

## Changes and contact
If this policy changes, the new version will be published at the Privacy policy link in the app (menu → Privacy policy).
Contact: privacy@example.com
