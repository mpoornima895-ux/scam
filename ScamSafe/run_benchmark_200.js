/**
 * DEVELOPMENT SET benchmark (test/dev_set_200.json).
 *
 * The 200 messages were written by the developer while building the rules. Passing them is a
 * REGRESSION CHECK ("did I break something?"), NOT proof of real-world accuracy.
 * For an honest number use real messages: test/holdout_template.json + scripts/run_holdout.js.
 *
 * This script only READS the dataset (it no longer regenerates / overwrites it).
 * It runs against code freshly compiled from src/*.ts (npm run build:test), never a stale copy.
 */
const fs = require('fs');
const path = require('path');

const datasetPath = path.join(__dirname, 'test', 'dev_set_200.json');
const fullDataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
fullDataset.totalMessages = fullDataset.messages.length;
fullDataset.scamCount = fullDataset.messages.filter(m => m.expected === 'High').length;
fullDataset.genuineCount = fullDataset.messages.length - fullDataset.scamCount;

const { analyzeOfflineFallback } = require('./.test-build/src/api.js');

let truePositives = 0;   // Scam correctly flagged as High/Medium
let falseNegatives = 0;  // Scam missed (flagged as Low)
let trueNegatives = 0;   // Genuine correctly flagged as Low
let falsePositives = 0;  // Genuine falsely flagged as High/Medium

const errors = [];

for (const msg of fullDataset.messages) {
  const result = analyzeOfflineFallback(msg.text);
  const isScam = msg.expected === 'High';
  const predictedHighOrMed = result.risk_level === 'High' || result.risk_level === 'Medium';

  if (isScam) {
    if (predictedHighOrMed) {
      truePositives++;
    } else {
      falseNegatives++;
      errors.push({ id: msg.id, category: msg.category, text: msg.text, expected: 'High', got: result.risk_level, score: result.risk_score });
    }
  } else {
    if (!predictedHighOrMed) {
      trueNegatives++;
    } else {
      falsePositives++;
      errors.push({ id: msg.id, category: msg.category, text: msg.text, expected: 'Low', got: result.risk_level, score: result.risk_score });
    }
  }
}

const accuracy = ((truePositives + trueNegatives) / fullDataset.totalMessages) * 100;
const precision = (truePositives / (truePositives + falsePositives)) * 100;
const recall = (truePositives / (truePositives + falseNegatives)) * 100;
const f1 = (2 * precision * recall) / (precision + recall);

console.log('\n======================================================');
console.log('📊 DEVELOPMENT SET RESULTS (developer-written; NOT proof of accuracy)');
console.log('======================================================');
console.log(`Total Samples:       ${fullDataset.totalMessages}`);
console.log(`Scams Tested:        ${fullDataset.scamCount}`);
console.log(`Genuine Tested:      ${fullDataset.genuineCount}`);
console.log('------------------------------------------------------');
console.log(`True Positives (Scams Caught):     ${truePositives}/${fullDataset.scamCount} (${Math.round((truePositives / fullDataset.scamCount) * 100)}%)`);
console.log(`False Negatives (Scams Missed):    ${falseNegatives}/${fullDataset.scamCount}`);
console.log(`True Negatives (Genuine not flagged): ${trueNegatives}/${fullDataset.genuineCount} (${Math.round((trueNegatives / fullDataset.genuineCount) * 100)}%)`);
console.log(`False Positives (Genuine Flagged): ${falsePositives}/${fullDataset.genuineCount}`);
console.log('------------------------------------------------------');
console.log(`Overall Accuracy:   ${accuracy.toFixed(1)}%`);
console.log(`Precision:          ${precision.toFixed(1)}%`);
console.log(`Recall:             ${recall.toFixed(1)}%`);
console.log(`F1 Score:           ${f1.toFixed(1)}%`);
console.log('======================================================');

if (errors.length > 0) {
  console.log(`\nDiscrepancies (${errors.length}):`);
  errors.forEach(e => console.log(`[${e.id}] ${e.category} | Exp: ${e.expected} Got: ${e.got} (Score: ${e.score}) | "${e.text}"`));
} else {
  console.log('\nNo regressions on the development set. This does NOT mean the app catches 100% of real scams.');
}

if (errors.length > 0) {
  process.exitCode = 1;
}
