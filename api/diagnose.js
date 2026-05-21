import { buildDiagnosticContext } from "./helpers/diagnostic-core.js";

import {
parseLiveDataContext,
buildObdInsight,
} from "./helpers/obd-intelligence.js";

// التعديل هنا لدمج فلسفة "العقل المستمر" في البرومبت الأساسي
const DOCTOR_PROMPT = `
Role:
You are the "DriveShift Omni-Sovereign" — the global peak of automotive engineering intelligence. You function as a Lead Diagnostic Engineer.

STRICT OPERATING PROTOCOL (UNBREAKABLE):

1. THE CONTINUOUS INTELLIGENCE RULE:
- Once the Final Report is delivered, stay in "Refinement Mode."
- If the user provides new info (e.g., "I replaced the part"), ACKNOWLEDGE it and PIVOT the diagnosis immediately.
- Do NOT restart the case. Do NOT repeat previous questions.

2. THE 3-TURN RULE (FOR NEW CASES):
- TURN 1: Ask "Question 1".
- TURN 2: Ask "Question 2".
- TURN 3: Authorized to generate the Final Forensic Report.
- AFTER TURN 3: Enter "Post-Report Intelligence" where you answer questions and refine the case dynamically.

3. LOGIC FLOW:
- Prioritize sensors, fuses, and connectors before hardware.
- If a user says they replaced a part, ELIMINATE it from your logic and move to secondary causes (wiring, ECU, or mechanical tolerances).

4. FORMATTING & STYLE:
- Use ONLY Bold Markdown for headers.
- NO Colons (:), NO Hashtags (#).
- Numbered lists for steps.

The Final Report Blueprint:
**Voice Summary**
**Likely Issue**
**Why It Fits**
**What To Inspect Next**
**Mechanic Notes**

Language: English only for technical output. Units: Imperial (USA).
`;

export default async function handler(req, res) {
if (req.method !== "POST") {
return res.status(405).json({ result: "Method not allowed" });
}

try {
const { issue, answers, language, vehicleProfile, flowControl } = req.body;

const lang = language === "es" ? "es" : "en";
const safeIssue = String(issue || "").trim();
const answerList = Array.isArray(answers) ? answers : [];

if (!safeIssue) {
const emptyText = await requestOpenAIConversation({ lang, message: "" });
return res.status(200).json({
result: emptyText || buildEmptyFollowUp(lang),
});
}

const simpleIntent = detectSimpleIntent(safeIssue);

if (simpleIntent === "greeting" || simpleIntent === "general_help") {
const aiText = await requestOpenAIConversation({
lang,
message: safeIssue,
});

return res.status(200).json({
result:
aiText ||
(simpleIntent === "greeting"
? buildGreetingResponse(lang)
: buildGeneralHelpResponse(lang)),
});
}

const obdCode = extractObdCode(safeIssue);
const hasObdCode = Boolean(obdCode);

const liveDataContext = parseLiveDataContext(safeIssue);

const obdInsight = buildObdInsight({
code: obdCode || "",
liveData: liveDataContext,
});

const diagnosticContext = buildDiagnosticContext(safeIssue, answerList);
const askedQuestions = extractAskedQuestions(answerList);
const dominantLock = buildLocalDominantLock(safeIssue, answerList);

const clientAnswerCount = Number(
flowControl?.answerCount || answerList.length || 0
);

// تحسين منطق الجاهزية لدعم ميزة الاستمرار بعد التقرير
const readyForAnalysis =
hasObdCode ||
(clientAnswerCount >= 2 && (
shouldForceFinal({
flowControl,
hasObdCode,
answerCount: clientAnswerCount,
}) ||
diagnosticContext?.readiness?.readyForAnalysis === true
));

if (!readyForAnalysis) {
const followUpPrompt = buildAIFollowUpPrompt({
lang,
issue: safeIssue,
answers: answerList,
vehicleProfile,
diagnosticContext,
dominantLock,
askedQuestions,
obdCode,
obdInsight,
});

const aiFollowUp = await requestOpenAIReport(followUpPrompt, true);
const cleanedFollowUp = cleanFollowUp(aiFollowUp, {
lang,
issue: safeIssue,
askedQuestions,
dominantLock,
});

return res.status(200).json({
result:
cleanedFollowUp ||
buildNaturalFallbackFollowUp({
lang,
issue: safeIssue,
dominantLock,
}),
});
}

const prompt = buildAnalysisPrompt({
lang,
issue: safeIssue,
answers: answerList,
vehicleProfile,
diagnosticContext,
dominantLock,
obdCode,
obdInsight,
});

const aiText = await requestOpenAIReport(prompt, false);
const result = cleanAnalysis(aiText);

if (!result || looksBad(result)) {
return res.status(200).json({
result: buildSafeAnalysisFallback(lang),
});
}

return res.status(200).json({ result });
} catch (error) {
console.error("Diagnostic Engine Error:", error); // تسجيل الخطأ للمساعدة في Vercel logs
return res.status(200).json({
result: buildErrorFallback(),
});
}
}

// --- الهيلبرز المحدثة لضمان جودة الـ Markdown والذكاء المستمر ---

function buildAIFollowUpPrompt({
lang,
issue,
answers,
vehicleProfile,
diagnosticContext,
dominantLock,
askedQuestions,
obdCode,
obdInsight,
}) {
const userAnswers = answers.length
? answers
.map((a, i) => `${i + 1}. ${a.question || "Question"}: ${a.answer || ""}`)
.join("\n")
: "No additional answers yet.";

return `
You are DriveShift, a premium mechanic-level diagnostic brain.
If the user provides new info about a previous report, analyze it. Otherwise, ask ONE sharp follow-up question.

Language: ${lang === "es" ? "Spanish" : "English"}
Vehicle: ${buildVehicleText(vehicleProfile)}
Symptom: ${issue}
History: ${userAnswers}
Dominant lock: ${dominantLock}

Rules:
- Ask exactly ONE question if in diagnostic mode.
- If user updated repair info, acknowledge and update the theory.
- Return format:
Diagnosis status: follow_up
Voice summary: [Natural sentence]
Risk level: [Low/Med/High]
Likely issue: [Pending/Updated]
Why it fits: [Brief explanation]
What to inspect next: [The Question]
What to do next: [The Question]
Answer options: None
Mechanic Notes: [Technical insight]
`;
}

function cleanAnalysis(text) {
let clean = String(text || "").trim();
if (!clean) return "";

// ضمان وجود الترويسة الصحيحة للذكاء الاصطناعي في التطبيق
if (!/Diagnosis status:/i.test(clean)) {
clean = `Diagnosis status: analysis\n\n${clean}`;
}

// تحويل كافة العناوين إلى Bold Markdown حسب طلبك (Apple Style)
const headers = [
"Voice Summary",
"Likely Issue",
"Why It Fits",
"What To Inspect Next",
"Mechanic Notes",
"Final Mechanical Report",
"Risk level"
];

headers.forEach(h => {
const regex = new RegExp(`\\*\\*?${h}\\*\\*?:?`, "gi");
clean = clean.replace(regex, `**${h}**`);
});

return clean.trim();
}

async function requestOpenAIReportWithSettings({
prompt,
temperature,
maxTokens,
timeoutMs,
}) {
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
const response = await fetch("https://api.openai.com/v1/chat/completions", { // تصحيح الـ Endpoint لـ OpenAI
method: "POST",
signal: controller.signal,
headers: {
"Content-Type": "application/json",
Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
},
body: JSON.stringify({
model: process.env.DRIVESHIFT_MODEL || "gpt-4o-mini",
messages: [{ role: "system", content: prompt }], // استخدام Chat format
temperature,
max_tokens: maxTokens,
}),
});

clearTimeout(timeout);
if (!response.ok) return "";

const data = await response.json();
return data.choices[0].message.content.trim();
} catch (_) {
clearTimeout(timeout);
return "";
}
}

// بقية الدوال المساعدة (detectSimpleIntent, extractObdCode, etc.) تبقى كما هي لضمان عدم كسر الربط
