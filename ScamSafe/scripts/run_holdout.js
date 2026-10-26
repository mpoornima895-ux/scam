#!/usr/bin/env node
/**
 * HOLDOUT runner: measures the on-device engine on REAL messages the developer pasted in later.
 *
 *   node scripts/run_holdout.js                 -> reads test/holdout_template.json
 *   node scripts/run_holdout.js path/to/file.json
 *
 * File format: a JSON array. Every item has the same fields as test/dev_set_200.json:
 *   { "id": "H-001", "category": "Bank phishing", "text": "<the SMS>", "expected": "High" | "Low" }
 *   expected "High" = it IS a scam,  "Low" = it is a genuine message.
 *   (optional extra field "note" is ignored.)
 *
 * Counts: caught = scam flagged High/Medium, missed = scam rated Low, false alarm = genuine flagged High/Medium.
 *
 * RULES FOR HONEST USE
 *  - Do NOT tune the rules using these messages. If you change a rule to fix a holdout mistake,
 *    the message is no longer a holdout; put it in test/dev_set_200.json and collect new holdout messages.
 *  - Remove OTPs, card/account/Aadhaar numbers and phone numbers before pasting real SMS here.
 */
const fs = require('fs');
const path = require('path');

const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'test', 'holdout_template.json'));
const apiPath = path.join(__dirname, '..', '.test-build', 'src', 'api.js');

if (!fs.existsSync(apiPath)) {
  console.error('Compiled engine not found. Run: npm run build:test');
  process.exit(2);
}
const { analyzeOfflineFallback } = require(apiPath);

let items;
try {
  items = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`Cannot read ${file}: ${e.message}`);
  process.exit(2);
}
if (!Array.isArray(items)) {
  console.error('Holdout file must be a JSON array.');
  process.exit(2);
}
if (items.length === 0) {
  console.log(`Holdout file is empty (${file}).`);
  console.log('Paste REAL messages in it (fields: id, category, text, expected "High"|"Low"), then run this again.');
  process.exit(0);
}

let caught = 0, missed = 0, falseAlarm = 0, correctGenuine = 0, invalid = 0;
const mistakes = [];

for (const [index, item] of items.entries()) {
  const label = item && item.id ? item.id : `#${index + 1}`;
  if (!item || typeof item.text !== 'string' || !item.text.trim() || (item.expected !== 'High' && item.expected !== 'Low')) {
    invalid += 1;
    mistakes.push({ kind: 'INVALID ENTRY', id: label, text: JSON.stringify(item), detail: 'needs text (string) and expected "High" or "Low"' });
    continue;
  }
  const result = analyzeOfflineFallback(item.text);
  const flagged = result.risk_level === 'High' || result.risk_level === 'Medium';
  if (item.expected === 'High') {
    if (flagged) caught += 1;
    else { missed += 1; mistakes.push({ kind: 'MISSED SCAM', id: label, category: item.category, text: item.text, detail: `got ${result.risk_level} (${result.risk_score})` }); }
  } else if (flagged) {
    falseAlarm += 1;
    mistakes.push({ kind: 'FALSE ALARM', id: label, category: item.category, text: item.text, detail: `got ${result.risk_level} (${result.risk_score}); signals: ${result.scam_signals.join('; ')}` });
  } else {
    correctGenuine += 1;
  }
}

const scams = caught + missed;
const genuine = correctGenuine + falseAlarm;
console.log('======================================================');
console.log('HOLDOUT RESULTS (real messages, rules NOT tuned on them)');
console.log('======================================================');
console.log(`File:                 ${file}`);
console.log(`Scams in set:         ${scams}`);
console.log(`  caught:             ${caught}`);
console.log(`  missed:             ${missed}`);
console.log(`Genuine in set:       ${genuine}`);
console.log(`  false alarms:       ${falseAlarm}`);
if (invalid) console.log(`Invalid entries:      ${invalid}`);
if (scams < 30 || genuine < 30) console.log('NOTE: fewer than 30 scam or 30 genuine messages. These counts are too small to trust.');
console.log('======================================================');

if (mistakes.length > 0) {
  console.log(`\nEvery mistake (${mistakes.length}):`);
  for (const m of mistakes) {
    console.log(`- [${m.kind}] ${m.id}${m.category ? ' | ' + m.category : ''} | ${m.detail}\n    "${m.text}"`);
  }
} else {
  console.log('\nNo mistakes on this holdout set.');
}
