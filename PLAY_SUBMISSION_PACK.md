# ScamSafe: Google Play submission pack (SMS permission)

_Written 1 Nov 2026. Based on Google's current Play policy pages (links at the bottom). Nothing here guarantees approval._

## 1. Honest status

**What Google decides.** ScamSafe is not the default SMS app, so it can only use READ_SMS / RECEIVE_SMS through an
exception. The exception row that fits is **"Anti-SMS phishing (smishing)"**. Google's wording: *"You must have a track
record of significant protection for users"*, shown through *"analyst reports, benchmark test results, industry
publications, and other credible sources"*, and there must be *"no alternative method"* for the core function.
Exceptions are *"subject to Google Play review and approval"* and granted *"case-by-case"*.

**What code can and cannot do.** The code changes in this pack remove avoidable reasons for rejection (privacy,
disclosure, unneeded data, unneeded permissions). They do **not** create the track record. Encryption does not
prove protection; HTTPS is already used for everything that leaves the phone. The track record has to come from
evidence collected outside the code (section 3).

**Likely outcome.** A brand-new app with no outside evidence is unlikely to be approved on the first try. A rejection is
not a ban: you can improve the evidence and submit again, and the share/paste version (no SMS permission) can ship
meanwhile.

## 2. What was changed in the code (already in the patch)
| Change | Why it matters for review |
|---|---|
| SMS from the inbox is **checked on the phone only** (`CLOUD_FOR_SMS_SCANS = false`). Only text the user pastes into Manual Text Check can go to the cloud. | Google's Spyware policy prohibits taking SMS data that is not needed for the allowed feature. Removing upload of the inbox removes the biggest risk. |
| Consent screen now states purpose in plain words and says inbox messages are never uploaded; the cloud note is shown only for pasted text; manual-check box shows the same note. | User Data policy: disclosure inside the app, before the permission request, with a tap to agree. |
| Privacy policy rewritten and a hosted page `privacy.html` added. | Play needs a public, non-PDF URL with developer name and a contact. **You must fill in your name and email.** |
| Removed storage permissions; blocked cleartext (http) traffic. | Fewer permissions to explain; encrypted transport enforced. |
| CI now also builds the Play bundle (`.aab`) and prints the target SDK. | Play takes bundles, and new apps must target Android 16 (API 36) from 31 Aug 2026. |
| `npm run playcheck` | Lists what is still unfinished in the code. |
| Tests for the "inbox never goes to the cloud" rule. | Proves the rule keeps holding. |

**Trade-off you accept:** inbox scans now use the on-device rules only (about 60 to 80% on unseen wordings), not the
cloud AI. Pasted text still gets the cloud second opinion.

## 3. The evidence plan (this is the real gate)
Do these in order. Each one is something a reviewer can check.
1. **Collect real messages.** Ask 20+ people for scam and genuine SMS they actually received (names and numbers removed,
   with their OK). Target 500+. Two people label each message independently; keep only agreed labels.
2. **Run the benchmark and publish everything.** Use `npm run holdout`. Publish the method, the numbers, the misses and
   the false alarms on a public page (GitHub). Include the unseen-wording result (60.8% on 3,573 messages) next to the
   real-message result. Honest numbers are more credible than a perfect-looking one.
3. **Get an outside party to run it.** A university cybersecurity group, an independent security researcher, or a
   consumer/cyber-safety organisation runs your app on their own messages and writes a short signed report. Ask more than
   one; you decide nothing about their numbers.
4. **Show real use.** From the pilot (installed with Play Protect steps): how many people, for how many weeks, how many scam
   messages were flagged, and testimonials that users confirm were real scams. Add an in-app "was this correct?" button
   if you want hard numbers (not built yet).
5. **Get it written about.** A blog article, a local news story, a talk at a meet-up, a listing on a government or
   consumer cyber-awareness page. Industry publications are named in Google's text.

Keep all links in one document; you will paste them into the declaration form.

## 4. Timeline and costs (from Google's pages)
- Developer account: **US$25** one-time, identity checks. (Account fee and checks are Google's, not mine.)
- **New personal accounts** must run a closed test with **at least 12 testers opted in, for 14 days in a row** before they
  can ask for production access. Start recruiting now: friends and pilot testers can join by an invite link/e-mail list.
- The production application asks: how testers used the app, feedback, what you changed.
- The **Permissions Declaration Form** needs a **video demonstration** (YouTube link is easiest) and test credentials if
  sign-in is needed (ScamSafe has no sign-in). Review can take **several weeks**; the app waits in "pending publication".
- New apps and updates must target **Android 16 (API 36)** from 31 Aug 2026 (extension was possible to 1 Nov 2026). The
  CI step now prints the real target SDK of your APK; check it says 36 or higher.

## 5. Steps in order
1. Fill in your name and email in `ScamSafe/PRIVACY_POLICY.md` and `privacy.html`. Commit.
2. Decide the package name now (`com.scamsafe.app` is permanent after the first upload). Change it in `app.json`,
   `android/app/build.gradle` (`applicationId`) and the Kotlin package paths only if you want another one; otherwise keep.
3. Turn on GitHub Pages for the repo and open `https://mpoornima895-ux.github.io/scam/privacy.html`. It must load.
4. Run `npm run playcheck`; fix every FAIL.
5. Push; take the `.aab` from the GitHub Actions run (artifact **ScamSafe-release-aab-for-Play**).
6. Create the Play developer account; create the app; complete App content (privacy policy URL, data safety, content rating, target audience).
7. Upload the `.aab` to a **closed testing** track; add 12+ testers; keep them 14 days.
8. In **Policy > App content > Sensitive app permissions** submit the SMS declaration (section 6) with your evidence links and video.
9. When the closed test is done, apply for production access.
10. Note: Play re-signs your app. The signature of a Play install differs from your pilot APK, so pilot testers must uninstall the APK before installing from Play.

## 6. Permissions Declaration Form: draft answers
(Edit with your own facts. Pick the use case that matches "Anti-SMS phishing (smishing)" if the form lists it.)
- **Core functionality:** "ScamSafe is a scam-SMS protection app. It reads incoming and recent SMS messages to detect smishing
  (phishing, fake bank KYC, UPI/OTP theft, fake delivery and lottery scams) and warns the user before they tap a link or share a code."
- **Why READ_SMS / RECEIVE_SMS are required:** "The app must see the text of messages as they arrive and in the inbox in order to
  classify them. The Share/paste alternatives only protect messages the user remembers to submit; they cannot warn before the user acts on an incoming scam."
- **Data handling:** "Messages from the inbox are analysed on the device and are not uploaded. Results are stored on the device only.
  No SMS data is sold or shared. The user can delete all data in the app."
- **Track record:** links from section 3 (benchmark page, outside report, pilot numbers, articles).
- **Video (about 1 minute):** (1) open app, show consent screen with "Before you start"; (2) tap I agree, show the Android permission prompt;
  (3) show a scan with a scam test message flagged High with the explanation; (4) show "Checked on your phone only";
  (5) show Delete all my data and the privacy policy link.

## 7. Data safety form: draft answers
- **Inbox SMS:** processed on-device only, not collected (Google: data processed only on the device does not need to be declared).
- **Pasted text (Manual Text Check):** declare **Messages > SMS or MMS** as **collected**, purpose **App functionality**, **not shared**
  (the AI provider acts as a service provider), **not required** (optional feature), **encrypted in transit: yes**.
  Check with your AI provider's terms that it does not keep or train on the text; if it does, it must be declared as shared.
- **Install id:** a random app-generated id used for rate limiting: declare **Device or other IDs**, collected, purpose **Security, fraud prevention**.
- **Deletion:** users can delete everything on the phone in the app; the server keeps no message text; give your support e-mail.

## 8. Store listing: safe wording
- Title: "ScamSafe: SMS Scam Checker". Short description: "Checks your SMS for scam and phishing messages on your phone."
- Do **not** write "100% safe", "blocks all scams", "AI-powered protection guaranteed" or any claim you cannot show evidence for.
- Include one honest line: "ScamSafe can miss scams and can flag genuine messages. If money or a code is involved, call your bank."
- State that auto-scan works while the app is running (the SMS listener is not a background service yet).

## 9. Plan B if the SMS exception is refused
Ship a version without SMS permission: the user shares a message to ScamSafe (Android Share menu) or pastes it, and the same
engine checks it. Play Protect does not block that kind of install, and the SMS policy does not apply. Keep collecting
evidence and ask Google again later.

## Sources
- Use of SMS or Call Log permission groups: https://support.google.com/googleplay/android-developer/answer/10208820
- Permissions Declaration Form: https://support.google.com/googleplay/android-developer/answer/9214102
- User Data policy (disclosure, privacy policy, secure handling): https://support.google.com/googleplay/android-developer/answer/10144311
- Data safety form: https://support.google.com/googleplay/android-developer/answer/10787469
- Testing requirements for new personal accounts: https://support.google.com/googleplay/android-developer/answer/14151465
- Target API level requirement: https://support.google.com/googleplay/android-developer/answer/11926878
