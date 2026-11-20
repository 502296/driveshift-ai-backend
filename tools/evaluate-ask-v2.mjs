// Synthetic cases only. Live calls are explicitly opt-in and consume API usage.
import { readFile, writeFile } from 'node:fs/promises';
import handler from '../api/diagnose.js';

const cases = JSON.parse(await readFile(new URL('../test/fixtures/ask-evaluation.json', import.meta.url), 'utf8'));
if (!process.argv.includes('--live')) {
  console.log(`${cases.length} synthetic cases ready. No model calls made.\nRun with --live and OPENAI_API_KEY against this local checkout, never the production URL.\nOptional: --case=chirp-stationary --output=/tmp/ask-evaluation.json`);
  process.exit(0);
}
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for explicitly requested live evaluation.');
// Operational telemetry from synthetic evaluations must not pollute real usage.
process.env.DRIVESHIFT_TELEMETRY_ENABLED = 'false';
const selected = process.argv.find(v => v.startsWith('--case='))?.slice(7);
const output = process.argv.find(v => v.startsWith('--output='))?.slice(9) || '/tmp/ask-evaluation.json';
const results = [];
for (const fixture of cases.filter(c => !selected || c.id === selected)) {
  let statusCode = 200, body;
  const start = Date.now();
  const res = { setHeader() {}, status(v) { statusCode = v; return this; }, json(v) { body = v; return v; } };
  await handler({ method: 'POST', headers: {}, body: { issue: fixture.issue, answers: fixture.answers, experienceVersion: 2 } }, res);
  const checks = {
    available: statusCode === 200 && ['follow_up', 'analysis'].includes(body?.status),
    expectedStage: !fixture.expect || fixture.expect === body?.status,
    urgentAction: !fixture.urgent || (body?.status === 'analysis' && ['URGENT_INSPECTION', 'STOP_DRIVING'].includes(body?.report?.assessment)),
    noConfidenceLabels: body?.status !== 'analysis' || (!('confidence' in body.report) && body.report.hypotheses.every(h => !('likelihood' in h))),
  };
  results.push({ id: fixture.id, elapsedMs: Date.now() - start, checks, review: fixture.review, response: body });
  console.log(`${fixture.id}: ${Object.values(checks).every(Boolean) ? 'contract PASS' : 'REVIEW/FAIL'} (${body?.status}, ${Date.now() - start} ms)`);
  await writeFile(output, JSON.stringify({ note: 'Automated contract checks are not a clinical/mechanical accuracy score. Expert review is required.', results }, null, 2));
}
if (!results.length) throw new Error('No matching case ID.');
if (results.some(r => !Object.values(r.checks).every(Boolean))) process.exitCode = 1;
