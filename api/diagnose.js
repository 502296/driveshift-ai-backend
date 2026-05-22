import { buildDiagnosticContext } from "./helpers/diagnostic-core.js";

import {
parseLiveDataContext,
buildObdInsight,
} from "./helpers/obd-intelligence.js";

const REQUIRED_FOLLOW_UPS = 2;
const DOCTOR_PROMPT = `
Role:
You are DriveShift, a high-end master automotive technician and forensic diagnostic expert. Your reasoning is surgical: you connect symptoms like a master mechanic, focusing on the physics of mechanical failure such as torque, load, and rotational frequency.

Diagnostic Logic (Internal Chain of Thought):
1. Load vs. Speed: If vibration changes with throttle (acceleration), prioritize Drivetrain, Inner CV-Joints, or Engine Mounts over Wheel Balance.
2. Location: If felt in the steering wheel, focus on Front Axle, Steering Rack, or Front Suspension. If felt in the seat/floor, focus on Rear Axle, Driveshaft, or Tires.
3. Contrast: Use the user's answers to rule out common culprits. If the symptom is load-dependent, explain why it is likely not a simple balance issue.

Core rules:
- Finalize the diagnosis and trigger the Final Report within 2 to 3 questions maximum.
- YOU MUST PROVIDE ALL SECTIONS of the Final response format. Do not skip any section.
- Be decisive and authoritative. Use phrases like: The evidence points to, or This behavior matches.
- Avoid hesitant language like: could be, maybe, or potential.
- Speak like a veteran lead technician: calm, professional, and direct.
- No fear-based language. Do not scare the user.
- Do not mention AI or use generic "consult a mechanic" escapes.
- Strictly no Markdown bold (no double asterisks).
- Headers must use colons.
- Units: Imperial (USA).

Final response format:

Primary Verdict:
[One short, confident sentence identifying the most likely mechanical failure.]

Voice Summary:
[A natural, detailed 3-4 sentence professional summary a master mechanic would say to a customer. Explain the gut feeling and the logic.]

Failure Behavior Analysis:
[A deep technical explanation of the mechanical physics. Why does the clicking at turns or shaking under load confirm this specific part is failing?]

Why The Logic Holds:
[Contrast the user's answers. Explain specifically why we ruled out balance, suspension, or brakes based on their feedback.]

Recommended Verification Path:
1. [Specific physical inspection step for the boot or joint]
2. [Specific diagnostic test like a "clunk test" or "play test"]
3. [The exact visual confirmation point before spending money on parts]

Mechanic Insight:
[One high-level technician-level "pro-tip" or a hidden symptom related to this specific failure that the user should look for.]

Answer options:
None
`;

export default async function handler(req, res) {
try {
if (req.method !== "POST") {
return res.status(200).json({
result: buildGeneralHelpResponse("en"),
});
}

const { issue, answers, language, vehicleProfile, flowControl } =
req.body || {};

const lang = language === "es" ? "es" : "en";
const safeIssue = String(issue || "").trim();
const answerList = Array.isArray(answers) ? answers : [];

if (!safeIssue) {
return res.status(200).json({
result: buildEmptyFollowUp(lang),
});
}

const simpleIntent = detectSimpleIntent(safeIssue);

if (simpleIntent === "greeting" || simpleIntent === "general_help") {
return res.status(200).json({
result:
simpleIntent === "greeting"
? buildGreetingResponse(lang)
: buildGeneralHelpResponse(lang),
});
}

const obdCode = extractObdCode(safeIssue);
const hasObdCode = Boolean(obdCode);

const answerCount = Number(
flowControl?.answerCount ?? answerList.length ?? 0
);

const liveDataContext = parseLiveDataContext(safeIssue);

const obdInsight = buildObdInsight({
code: obdCode || "",
liveData: liveDataContext,
});

const diagnosticContext = buildDiagnosticContext(safeIssue, answerList);
const askedQuestions = extractAskedQuestions(answerList);
const dominantLock = buildLocalDominantLock(safeIssue, answerList);

// التحقق من الجاهزية للتقرير النهائي
const readyForAnalysis = hasObdCode || answerCount >= REQUIRED_FOLLOW_UPS;

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

const cleanedFollowUp =
cleanFollowUp(aiFollowUp, {
lang,
issue: safeIssue,
askedQuestions,
dominantLock,
}) ||
buildNaturalFallbackFollowUp({
lang,
issue: safeIssue,
dominantLock,
});

return res.status(200).json({
result: cleanedFollowUp,
});
}

// مرحلة التقرير النهائي (Analysis)
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
} catch (_) {
return res.status(200).json({
result: buildErrorFallback(),
});
}
}

// --- Functions Below ---

function detectSimpleIntent(text) {
const raw = String(text || "").trim();
const clean = raw
.toLowerCase()
.replace(/[.,!?؟،]/g, "")
.replace(/\s+/g, " ")
.trim();

if (!clean) return "empty";
if (extractObdCode(clean)) return "vehicle_problem";

const vehicleWords = [
"car", "vehicle", "engine", "transmission", "brake", "brakes", "tire", "tires",
"battery", "alternator", "starter", "noise", "sound", "shake", "shaking",
"vibration", "vibrates", "smoke", "fuel", "gas", "oil", "coolant", "overheat",
"overheating", "warning", "light", "check engine", "abs", "airbag", "steering",
"suspension", "idle", "rpm", "start", "starts", "starting", "won't start",
"no start", "misfire", "stall", "stalls", "stalled", "dies", "leak", "leaking",
"burning", "smell", "throttle", "acceleration", "accelerating", "crank", "click",
"clunk", "grind", "grinding", "coche", "carro", "auto", "motor", "freno", "frenos",
"batería", "bateria", "arranca", "enciende", "humo", "gasolina", "aceite",
"sobrecalienta", "vibra", "vibración", "vibracion", "ruido", "luz", "testigo"
];

const hasVehicleSignal = vehicleWords.some((word) => clean.includes(word));
if (hasVehicleSignal) return "vehicle_problem";

const greetings = [
"hi", "hello", "hey", "hey there", "good morning", "good afternoon",
"good evening", "how are you", "whats up", "what's up", "hola", "buenos dias",
"buenos días", "buenas tardes", "buenas noches"
];

if (greetings.includes(clean)) return "greeting";

const generalHelpPhrases = [
"can you help me", "i need help", "help me", "i have a question", "question",
"need help", "puedes ayudarme", "necesito ayuda", "ayudame", "ayúdame", "tengo una pregunta"
];

if (generalHelpPhrases.includes(clean)) return "general_help";
return "vehicle_problem";
}

function buildAIFollowUpPrompt({ lang, issue, answers, vehicleProfile, diagnosticContext, dominantLock, askedQuestions, obdCode, obdInsight }) {
const userAnswers = answers.length
? answers.map((a, i) => `${i + 1}. ${a.question || "Question"}: ${a.answer || ""}`).join("\n")
: "No additional answers yet.";

return `You are DriveShift, a premium mechanic-level diagnostic brain.
Ask ONE short, sharp follow-up question. Do NOT diagnose yet.
Language: ${lang === "es" ? "Spanish only" : "English only"}
Original user symptom: ${issue}
Previous answers: ${userAnswers}
Rules:
- Ask exactly ONE question.
- Do not repeat questions.
- Return only this format:
Diagnosis status:
follow_up

Question:
[question]`;
}

function buildAnalysisPrompt({ lang, issue, answers, vehicleProfile, diagnosticContext, dominantLock, obdCode, obdInsight }) {
const userAnswers = answers.length
? answers.map((a, i) => `${i + 1}. ${a.question || "Question"}: ${a.answer || ""}`).join("\n")
: "No additional answers.";

return `${DOCTOR_PROMPT}
Language: ${lang === "es" ? "Spanish only" : "English only"}
Vehicle: ${buildVehicleText(vehicleProfile)}
Original symptom: ${issue}
Follow-up answers: ${userAnswers}
OBD code: ${obdCode || "None"}

Final report rules:
- INTERVIEW COMPLETE. GENERATE FULL REPORT.
- Include ALL headers: Primary Verdict, Voice Summary, Failure Behavior Analysis, Why The Logic Holds, Recommended Verification Path, and Mechanic Insight.
- BE DETAILED. No short summaries.
`;
}

async function requestOpenAIReport(prompt, isFollowUp = false) {
return requestOpenAIReportWithSettings({
prompt,
temperature: isFollowUp ? 0.12 : 0.05,
maxTokens: isFollowUp ? 220 : 1200, // زيادة عدد التوكنز للتقرير الطويل
timeoutMs: 25000,
});
}

async function requestOpenAIReportWithSettings({ prompt, temperature, maxTokens, timeoutMs }) {
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);
try {
const response = await fetch("https://api.openai.com/v1/chat/completions", {
method: "POST",
signal: controller.signal,
headers: {
"Content-Type": "application/json",
Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
},
body: JSON.stringify({
model: process.env.DRIVESHIFT_MODEL || "gpt-4o",
messages: [{ role: "system", content: prompt }],
temperature,
max_tokens: maxTokens,
}),
});
clearTimeout(timeout);
const data = await response.json();
return data.choices[0].message.content.trim();
} catch (_) {
clearTimeout(timeout);
return "";
}
}

function cleanFollowUp(text, { lang, issue, askedQuestions, dominantLock }) {
let clean = String(text || "").trim();
if (!clean) return "";
const questionMatch = clean.match(/Question:\s*([\s\S]*)/i);
let question = questionMatch ? questionMatch[1].trim() : clean;
return `Diagnosis status:\nfollow_up\n\nQuestion:\n${question}`;
}

// الدالة المسؤولة عن تنظيف التقرير النهائي - تم تعديلها لتسمح بالتقرير الكامل
function cleanAnalysis(text) {
let clean = String(text || "").trim();
if (!clean) return "";

// حذف النجوم فقط للحفاظ على المظهر المطلوب
clean = clean.replace(/\*\*/g, "");

// إضافة الحالة إذا كانت مفقودة
if (!/Diagnosis status:/i.test(clean)) {
clean = `Diagnosis status:\nanalysis\n\n${clean}`;
}

return clean.trim();
}

// --- Remaining Fallback Functions (No changes needed) ---

function buildSafeAnalysisFallback(lang) {
return `Diagnosis status:\nanalysis\n\nPrimary Verdict:\nSystem error during report generation.`;
}

function buildErrorFallback() {
return `Diagnosis status:\nanalysis\n\nPrimary Verdict:\nCould not reach diagnostic brain.`;
}

function buildEmptyFollowUp(lang) {
return `Diagnosis status:\nfollow_up\n\nQuestion:\nWhat is the main symptom?`;
}

function buildGreetingResponse(lang) {
return `Diagnosis status:\nfollow_up\n\nQuestion:\nHello! What car problem are you facing today?`;
}

function buildGeneralHelpResponse(lang) {
return `Diagnosis status:\nfollow_up\n\nQuestion:\nHow can I help you diagnose your vehicle today?`;
}

function buildNaturalFallbackFollowUp({ lang, issue, dominantLock }) {
return `Diagnosis status:\nfollow_up\n\nQuestion:\nWhen does this symptom occur most frequently?`;
}

function looksBad(text) {
const clean = String(text || "").toLowerCase();
return !clean || clean.includes("as an ai") || clean.includes("i am not a mechanic");
}

function extractObdCode(text) {
const matches = String(text || "").toUpperCase().match(/\b[PCBU][0-9A-F]{4}\b/g);
return matches ? [...new Set(matches)].join(", ") : "";
}

function buildVehicleText(profile) {
if (!profile) return "Unknown vehicle.";
return `${profile.year || ""} ${profile.make || ""} ${profile.model || ""}`.trim();
}

function extractAskedQuestions(answers) {
return (Array.isArray(answers) ? answers : []).map((a) => String(a?.question || "").trim()).filter(Boolean);
}

function buildLocalDominantLock(issue, answers) {
return ""; // Simplified for now to avoid logic breakage
}
