import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/diagnose.js';
import learningHandler from '../api/learning.js';
import { buildUserEvidenceText, buildDiagnosticContext } from '../api/helpers/diagnostic-core.js';
import { applySafetyBoundary, presentReport } from '../lib/ask/report-presentation.js';
import { isUsableInterviewDecision } from '../lib/ask/policy.js';
import { createLearningService } from '../lib/ask/learning.js';

const reportFixture = () => ({
  schemaVersion: '1.0', vehicle: {}, assessment: 'INSPECTION_RECOMMENDED',
  systemFocus: { id: 'engine_performance', label: 'Accessory drive', schematicKey: 'engine_performance_v1', affectedNodes: ['Accessory belt'] },
  primaryFinding: 'The source of the reported chirp has not been isolated.', confidence: 'HIGH',
  evidence: [{ id: 'E01', source: 'user_observation', status: 'OBSERVED', observation: 'Chirp with the engine running while stationary.', diagnosticMeaning: 'Vehicle movement is not necessary.', strength: 'HIGH' }],
  hypotheses: [{ id: 'H01', title: 'Accessory belt tracking or contact noise', likelihood: 'HIGH', supportingEvidenceIds: ['E01'], contradictingEvidenceIds: [], whyItFits: 'An engine-driven source remains possible.', confirmationTest: 'A technician checks belt alignment; incorrect tracking supports this mechanism.' }],
  whyAlternativesRankLower: '', verificationPath: [{ step: 1, action: 'Have a technician localize the noise.', purpose: 'Distinguish belt contact from pulley bearing noise.', requiredTool: '' }],
  doNotReplaceYet: [{ component: 'Accessory belt', reason: 'Failure has not been verified.' }], vehicleSpecificNote: '',
  safety: { alertLevel: 'NORMAL', triageStatus: 'not_assessed', drivingRecommendation: 'Short local driving is reasonable.', limitation: 'Source not isolated.', stopCondition: 'A temperature or charging warning appears.' },
  technicianHandoff: 'Localize the stationary engine chirp before replacing parts.', finalGuidance: 'Arrange a targeted inspection.',
  missingInformation: ['Cold versus warm behavior', 'Relevant warning lights'], learningTopic: 'belt_noise',
});

const response = () => ({ statusCode: 200, headers: {}, body: null,
  setHeader(k, v) { this.headers[k] = v; },
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return value; },
});

async function runCase(body, replies, inspect = () => {}) {
  const saved = { fetch: globalThis.fetch, key: process.env.OPENAI_API_KEY, flag: process.env.DRIVESHIFT_TELEMETRY_ENABLED };
  process.env.OPENAI_API_KEY = 'test-only';
  process.env.DRIVESHIFT_TELEMETRY_ENABLED = 'false';
  let call = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const request = JSON.parse(options.body);
    inspect(request, call);
    assert.ok(call < replies.length, 'Unexpected extra model call');
    const next = replies[call++];
    return Response.json({ status: 'completed', output_text: JSON.stringify(next) });
  };
  try {
    const res = response();
    await handler({ method: 'POST', headers: {}, body }, res);
    assert.equal(call, replies.length);
    return res;
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [key, value] of [['OPENAI_API_KEY', saved.key], ['DRIVESHIFT_TELEMETRY_ENABLED', saved.flag]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('ambiguous yes to a compound question does not invent both observations', () => {
  const text = buildUserEvidenceText('There is an unusual noise.', [{ question: 'Is there overheating or coolant loss?', answer: 'Yes' }]);
  assert.equal(text, 'There is an unusual noise.\nYes');
  assert.ok(!text.includes('overheating'));
});

test('a single unambiguous negative remains negative evidence', () => {
  assert.match(buildUserEvidenceText('It is noisy.', [{ question: 'Is it overheating?', answer: 'No' }]), /no overheating/);
});

test('questions remain paired for model reasoning but never enter raw mechanical evidence', () => {
  const context = buildDiagnosticContext('Engine noise.', [{ question: 'Does P0300 appear on the scanner?', answer: 'No' }]);
  assert.match(context.interview_context, /P0300/);
  assert.ok(!context.user_evidence_text.includes('P0300'));
});

test('ready decision needs an explicit next verification and a coherent readiness state', () => {
  assert.equal(isUsableInterviewDecision({ status: 'ready', question: '' }), false);
  assert.equal(isUsableInterviewDecision({ status: 'ready', question: '', readiness: 'needs_observation', nextVerification: 'Inspect it professionally.', missingInformation: [] }), false);
  assert.equal(isUsableInterviewDecision({ status: 'ready', question: '', readiness: 'verification_needed', nextVerification: 'Retrieve stored trouble codes.', missingInformation: [] }), true);
});

test('unknown driving suitability cannot appear as normal or a driving clearance', () => {
  const report = reportFixture();
  report.assessment = 'NORMAL_MONITORING';
  applySafetyBoundary(report);
  assert.equal(report.safety.alertLevel, 'CAUTION');
  assert.equal(report.assessment, 'INSPECTION_RECOMMENDED');
  assert.match(report.safety.drivingRecommendation, /has not been established/);
});

test('safety boundary never downgrades an existing critical action', () => {
  const report = reportFixture();
  report.safety.alertLevel = 'CRITICAL';
  report.safety.drivingRecommendation = 'Stop safely and arrange assistance.';
  assert.equal(applySafetyBoundary(report).safety.drivingRecommendation, 'Stop safely and arrange assistance.');
});

test('v2 removes all categorical confidence without mutating the v1 report', () => {
  const original = reportFixture();
  const v2 = presentReport(original, 2, 'es');
  assert.equal(v2.schemaVersion, '2.0');
  assert.equal(v2.confidence, undefined);
  assert.equal(v2.hypotheses[0].likelihood, undefined);
  assert.equal(v2.evidence[0].strength, undefined);
  assert.match(v2.learning.endpoint, /language=es/);
  assert.equal(original.confidence, 'HIGH');
  const legacy = presentReport(original, 1);
  assert.equal(legacy.schemaVersion, '1.0');
  assert.equal(legacy.hypotheses[0].likelihood, 'HIGH');
  assert.equal(legacy.learning, undefined);
  assert.equal(legacy.safety.triageStatus, undefined);
});

test('short answer remains in its question context through the HTTP interview', async () => {
  const decision = { status: 'follow_up', question: 'Does the sound continue after the engine warms up?', readiness: 'needs_observation', missingInformation: ['Temperature relationship'], nextVerification: '' };
  const res = await runCase({ issue: 'A bird-like chirp from the engine.', answers: [{ question: 'Stationary or moving?', answer: 'Stationary' }] }, [decision], request => {
    assert.match(request.input, /Stationary or moving/);
    assert.match(request.instructions, /Do not stop just because a broad system/);
  });
  assert.equal(res.body.status, 'follow_up');
  assert.equal(res.body.question, decision.question);
});

test('three answers produce limited v2 report, not a forced certainty or another question', async () => {
  const res = await runCase({ experienceVersion: 2, issue: 'Engine chirp.', answers: [
    { question: 'Stationary or moving?', answer: 'Stationary' },
    { question: 'Cold or warm?', answer: 'I do not know' },
    { question: 'Any warning?', answer: 'I do not know' },
  ] }, [reportFixture()], request => {
    assert.equal(request.text.format.name, 'driveshift_diagnostic_report');
    assert.match(request.instructions, /Unknown suitability/);
    assert.match(request.input, /I do not know/);
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'analysis');
  assert.equal(res.body.report.schemaVersion, '2.0');
  assert.equal(res.body.report.safety.alertLevel, 'CAUTION');
  assert.equal(res.body.report.hypotheses[0].likelihood, undefined);
});

test('legacy request still receives v1 enum fields', async () => {
  const ready = { status: 'ready', question: '', readiness: 'verification_needed', nextVerification: 'Arrange a targeted professional inspection.', missingInformation: [] };
  const res = await runCase({ issue: 'A chirp at idle with warm engine.' }, [ready, reportFixture()]);
  assert.equal(res.body.report.schemaVersion, '1.0');
  assert.ok(res.body.report.hypotheses[0].likelihood);
  assert.equal(res.body.report.missingInformation, undefined);
});

test('saved-case regeneration cannot extract a DTC from an unanswered question premise', async () => {
  const res = await runCase({ experienceVersion: 2, issue: 'Noise at idle.', answers: [
    { question: 'Have you measured code P0300?', answer: 'No' },
    { question: '', answer: 'Update the report.' },
  ], continuation: { sessionId: 'fixture', reports: [reportFixture()], messages: [] } }, [
    { status: 'ready', message: '', question: '' }, reportFixture(),
  ], (request, index) => {
    if (index === 1) {
      assert.match(request.input, /OBD CODES\nNone/);
      assert.match(request.input, /PAIRED INTERVIEW HISTORY/);
    }
  });
  assert.equal(res.body.report.schemaVersion, '2.0');
});

test('unresolved saved-case observation can ask a follow-up after the initial ceiling', async () => {
  const res = await runCase({ issue: 'Engine noise.', answers: Array.from({ length: 4 }, (_, i) => ({ question: `Prior observation ${i}?`, answer: 'Unknown' })), continuation: { sessionId: 'fixture', reports: [reportFixture()], messages: [] } }, [
    { status: 'follow_up', message: '', question: 'Did the new noise begin immediately after the recent repair?' },
  ]);
  assert.equal(res.body.status, 'follow_up');
});

test('learning verifies a curated link, caches it, and never returns external HTML', async () => {
  let calls = 0;
  const get = createLearningService({ fetchImpl: async url => {
    calls++;
    assert.equal(new URL(url).hostname, 'www.youtube.com');
    return Response.json({ provider_name: 'YouTube', type: 'video', title: 'Codes', html: '<script>bad</script>' });
  } });
  const items = await get('obd_codes');
  assert.equal(items[0].url, 'https://www.youtube.com/watch?v=_qJymlwHcaU');
  assert.equal(items[0].html, undefined);
  items[0].url = 'tampered';
  assert.match((await get('obd_codes'))[0].url, /^https:\/\/www.youtube.com\/watch/);
  assert.equal(calls, 1);
});

test('removed videos and unsupported topics/languages are hidden without a model-generated fallback', async () => {
  let calls = 0;
  const get = createLearningService({ fetchImpl: async () => { calls++; return new Response('', { status: 404 }); } });
  assert.deepEqual(await get('obd_codes'), []);
  assert.deepEqual(await get('belt_noise'), []);
  assert.deepEqual(await get('obd_codes', 'es'), []);
  assert.deepEqual(await get('https://evil.example'), []);
  assert.equal(calls, 1);
});

test('learning failure is isolated and concurrent reads share one availability request', async () => {
  let calls = 0;
  const get = createLearningService({ fetchImpl: async () => { calls++; throw new Error('offline'); } });
  assert.deepEqual(await Promise.all([get('live_data'), get('live_data')]), [[], []]);
  assert.equal(calls, 1);
});

test('learning endpoint rejects arbitrary queries and writes', async () => {
  const a = response();
  await learningHandler({ method: 'GET', query: { topic: 'http://localhost' } }, a);
  assert.equal(a.statusCode, 400);
  const b = response();
  await learningHandler({ method: 'POST', query: {} }, b);
  assert.equal(b.statusCode, 405);
});

test('unknown RPM response is not re-asked as an idle-speed rhythm', async () => {
  const res = await runCase({ experienceVersion: 2,
    issue: 'Intermittent chirp while stationary with the engine idling.',
    answers: [{ question: 'Does it change when you raise engine speed?',
      answer: 'I have not checked whether it changes with engine speed.' }],
  }, [{ status: 'follow_up',
    question: 'Does the chirp recur in a pattern tied to the engine’s idle speed?',
    readiness: 'needs_observation', missingInformation: ['Rhythm'], nextVerification: '',
  }]);
  assert.equal(res.body.status, 'follow_up');
  assert.match(res.body.question, /dashboard warning lights/);
});

test('known stationary idling does not trigger the generic operating-condition fallback', async () => {
  const res = await runCase({ experienceVersion: 2,
    issue: 'An intermittent whistle while stationary with the engine idling.',
    answers: [{ question: 'Does the chirp change with engine speed?', answer: 'I do not know' }],
  }, [{ status: 'follow_up',
    question: 'Under what condition does the symptom happen most clearly?',
    readiness: 'needs_observation', missingInformation: ['Conditions'], nextVerification: '',
  }]);
  assert.equal(res.body.status, 'follow_up');
  assert.match(res.body.question, /dashboard warning lights/);
});
