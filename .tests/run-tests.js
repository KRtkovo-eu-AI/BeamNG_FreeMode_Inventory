const fs = require('fs');
const path = require('path');

function xmlEscape(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapCdata(value) {
  return `<![CDATA[${value.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
}

const start = process.hrtime.bigint();
let failure = null;

try {
  require(path.join(__dirname, 'vehiclePartsPainting.test.js'));
} catch (error) {
  failure = error instanceof Error ? error : new Error(String(error));
}

const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
const reportsDir = path.resolve(__dirname, '../.reports');
fs.mkdirSync(reportsDir, { recursive: true });

const suiteName = 'vehiclePartsPainting';
const testName = 'vehiclePartsPainting';
const timestamp = new Date().toISOString();

const timeString = durationSeconds.toFixed(3);
const failureCount = failure ? 1 : 0;

let testCaseXml = `    <testcase classname="${suiteName}" name="${testName}" time="${timeString}">`;
if (failure) {
  const message = xmlEscape(failure.message || 'Test execution failed');
  const details = wrapCdata(failure.stack || String(failure));
  testCaseXml += `\n      <failure message="${message}">${details}</failure>\n    </testcase>`;
} else {
  testCaseXml += '</testcase>';
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="${suiteName}" tests="1" failures="${failureCount}" errors="0" skipped="0" timestamp="${timestamp}" time="${timeString}">\n${testCaseXml}\n  </testsuite>\n</testsuites>\n`;

fs.writeFileSync(path.join(reportsDir, 'junit.xml'), xml, 'utf8');

if (failure) {
  console.error(failure.stack || failure.message || failure);
  process.exit(1);
}
