/**
 * Pre-submission checklist for Google Play. Run:  npm run playcheck
 * Prints PASS / FAIL for things you can check in the code. It cannot check Play Console settings
 * (declaration form, data safety, closed test) - those are in PLAY_SUBMISSION_PACK.md.
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const results = [];
const check = (name, ok, hint) => results.push({ name, ok, hint });

const config = read('src/config.ts');
const policy = read('PRIVACY_POLICY.md');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const appJson = JSON.parse(read('app.json'));
let privacyHtml = '';
try { privacyHtml = fs.readFileSync(path.join(root, '..', 'privacy.html'), 'utf8'); } catch (e) { /* missing */ }

check('Privacy URL is not a placeholder', !/example\.com/.test(config), 'Set PRIVACY_URL in src/config.ts to your hosted privacy page.');
check('privacy.html exists at the repo root', privacyHtml.length > 500, 'Host privacy.html (GitHub Pages) and open the URL in a browser.');
check('Privacy policy has your real name and email', !/\[YOUR /.test(policy) && !/\[YOUR /.test(privacyHtml), 'Replace [YOUR NAME OR COMPANY] and [YOUR SUPPORT EMAIL] in PRIVACY_POLICY.md and privacy.html.');
check('Inbox SMS is never sent to the cloud (CLOUD_FOR_SMS_SCANS=false)', /CLOUD_FOR_SMS_SCANS:\s*boolean\s*=\s*false/.test(config), 'Keep this false for the Play build.');
check('Only the SMS permissions Google reviews are requested', JSON.stringify(appJson.expo.android.permissions) === JSON.stringify(['android.permission.READ_SMS', 'android.permission.RECEIVE_SMS']), 'app.json permissions must be exactly READ_SMS and RECEIVE_SMS.');
check('No storage / overlay permissions in the manifest', !/<uses-permission android:name="android.permission.(READ|WRITE)_EXTERNAL_STORAGE"(?![^>]*tools:node="remove")/.test(manifest) && !/SYSTEM_ALERT_WINDOW"(?![^>]*tools:node="remove")/.test(manifest), 'Remove extra permissions in AndroidManifest.xml.');
check('Cleartext (http) traffic is disabled', /usesCleartextTraffic="false"/.test(manifest), 'Add android:usesCleartextTraffic="false" to <application>.');
check('App backup is disabled (SMS history must not be backed up)', /allowBackup="false"/.test(manifest));
check('Package name chosen on purpose', appJson.expo.android.package !== 'com.scamsafe.app', 'INFO: the package name cannot be changed after the first Play upload. Change it now if you want another one (e.g. com.yourname.scamsafe).');

let failed = 0;
for (const r of results) {
  const tag = r.ok ? 'PASS' : 'FAIL';
  if (!r.ok) failed += 1;
  console.log(`${tag}  ${r.name}${r.ok || !r.hint ? '' : '\n      -> ' + r.hint}`);
}
console.log(`\n${results.length - failed}/${results.length} checks pass.`);
process.exit(failed ? 1 : 0);
