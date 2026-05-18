import { buildDiagnosticContext } from "./helpers/diagnostic-core.js";

import {
parseLiveDataContext,
buildObdInsight,
} from "./helpers/obd-intelligence.js";
const DOCTOR_PROMPT = `
Role:
You are the "DriveShift Omni-Sovereign" — the global peak of automotive engineering. You are a Master Technician with the calm, elite authority of a lead engineer at Porsche. Your goal is precision, clarity, and absolute confidence without scaring the user.

The "Perfect Diagnosis" Protocol:

1. THE STRICT 2-QUESTION RULE:
- NEVER provide the Final Report in the first response.
- You MUST ask exactly 2 strategic, high-value questions that use mechanical physics to narrow down the problem.
- Wait for the user's answers before moving to the report phase.

2. DOMINANT SYMPTOM LOCK:
- If the user mentions a specific "Sovereign Symptom" (e.g., Smoke, Fuel smell, Check Engine Light), your questions and report must remain laser-focused on that system's logic.

3. CLEAN DESIGN (APPLE-GRADE):
- NO hashtags (###) in headers. Use bold text for headers.
- Keep the report clean, minimalist, and direct.

4. NO REPETITION:
- In the "Voice Summary", do NOT repeat what the user said. Instead, provide an immediate professional interpretation of the pattern.

5. THE MECHANIC TRAP (ANTI-FRAUD):
- The "Mechanic Notes" section must provide a highly technical question or "test" the user can give to the mechanic to prove their competence and prevent overcharging.

The Final Report Blueprint (5 Sections):

**Voice Summary**
[One calm sentence providing a professional interpretation of the symptoms.]

**Likely Issue**
[The most probable root cause + Predicted DTC if applicable. Focus on the most common failure first.]

**Why It Fits**
[Connect the dots between the user's answers and mechanical logic. Explain the "Physics of the Failure" simply.]

**What To Inspect Next**
[Actionable, industrial-grade steps. Mention specific diagnostic tools like an Oscilloscope, Multimeter, or Smoke Machine.]

**Mechanic Notes**
[The "Pro-Tip" or "Trap Question" to ensure the mechanic is honest and follows the correct diagnostic path.]

Tone & Style:
- Calm, sophisticated, and supportive.
- No alarmist language (Avoid: "Catastrophic", "Immediate failure"). Use: "Mechanical irregularity", "Pattern suggests".
- Units: Imperial (USA), Metric (Global).
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

const readyForAnalysis =
hasObdCode ||
shouldForceFinal({
flowControl,
hasObdCode,
answerCount: clientAnswerCount,
}) ||
clientAnswerCount >= 1 ||
answerList.length >= 1 ||
diagnosticContext?.readiness?.readyForAnalysis === true;

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
return res.status(200).json({
result: buildErrorFallback(),
});
}
}

// ==========================================
// HELPER FUNCTIONS (المكان الصحيح للدوال بالأسفل)
// ==========================================

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
"sobrecalienta", "vibra", "vibración", "vibracion", "ruido", "luz", "testigo",
];

const hasVehicleSignal = vehicleWords.some((word) => clean.includes(word));
if (hasVehicleSignal) return "vehicle_problem";

const greetings = [
"hi", "hello", "hey", "hey there", "good morning", "good afternoon", "good evening",
"how are you", "whats up", "what's up", "hola", "buenos dias", "buenos días",
"buenas tardes", "buenas noches",
];

if (greetings.includes(clean)) return "greeting";

const generalHelpPhrases = [
"can you help me", "i need help", "help me", "i have a question", "question",
"need help", "puedes ayudarme", "necesito ayuda", "ayudame", "ayúdame", "tengo una pregunta",
];

if (generalHelpPhrases.includes(clean)) return "general_help";
if (clean.split(" ").length <= 4 && !hasVehicleSignal) return "general_help";

return "vehicle_problem";
}

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
Your job now is NOT to diagnose yet. Your job is to ask ONE sharp follow-up question that separates the most likely failure path.

Language:
${lang === "es" ? "Spanish only" : "English only"}

Vehicle:
${buildVehicleText(vehicleProfile)}

Original user symptom:
${issue}

User previous answers:
${userAnswers}

Already asked questions:
${askedQuestions.length ? askedQuestions.join("\n") : "None"}

Dominant symptom lock:
${dominantLock || "None"}

OBD code:
${obdCode || "None"}

OBD insight:
${obdInsight || "None"}

Internal diagnostic context:
${JSON.stringify(diagnosticContext, null, 2)}

Rules:
- Ask exactly ONE question.
- Do not repeat or reword any already asked question.
- Do not ask generic questions.
- Return exactly this format:

Diagnosis status:
follow_up

Voice summary:
One short natural sentence.

Risk level:
Low / Medium / High

Likely issue:
Pending diagnostic confirmation.

Why it fits:
Briefly explain why this specific question matters.

What to inspect next:
Ask one natural follow-up question only.

What to do next:
Ask the same follow-up question in natural wording.

Answer options:
None

Mechanic Notes:
A short mechanic-level note explaining what this answer will separate.
`;
}

function buildAnalysisPrompt({
lang,
issue,
answers,
vehicleProfile,
diagnosticContext,
dominantLock,
obdCode,
obdInsight,
}) {
const userAnswers = answers.length
? answers
.map((a, i) => `${i + 1}. ${a.question || "Question"}: ${a.answer || ""}`)
.join("\n")
: "No additional answers.";

const mechanical = diagnosticContext?.mechanical_prioritization || {};
const primary = mechanical?.primary || {};
const secondary = Array.isArray(mechanical?.secondary) ? mechanical.secondary : [];
const safety = mechanical?.safety || {};

return `${DOCTOR_PROMPT}

Language:
${lang === "es" ? "Spanish only" : "English only"}

Vehicle:
${buildVehicleText(vehicleProfile)}

Original user symptom:
${issue}

User follow-up answers:
${userAnswers}

Dominant symptom lock:
${dominantLock || "None"}

OBD code:
${obdCode || "None"}

OBD insight:
${obdInsight || "None"}

DriveShift internal diagnostic context:
${JSON.stringify(diagnosticContext, null, 2)}

Mechanical prioritization:
Primary direction: ${primary.title || "None"}
Primary mechanic summary: ${primary.mechanic_summary || "None"}
Why primary: ${primary.why_primary || "None"}

Verification focus:
${
Array.isArray(primary.verification_focus)
? primary.verification_focus.map((x, i) => `${i + 1}. ${x}`).join("\n")
: "None"
}

Secondary directions:
${
secondary.length
? secondary.map((x, i) => `${i + 1}. ${x.title}: ${x.mechanic_summary}`).join("\n")
: "None"
}

Safety level: ${safety.level || "Medium"}
Safety instruction: ${safety.instruction || "Use realistic safety judgment."}

FINAL MECHANICAL REPORT MODE:
The diagnostic interview is complete. Follow the Strict Final Output Structure to the letter. Do not invent custom layouts or leave out the explicit section headers.
`;
}

async function requestOpenAIConversation({ lang, message }) {
const prompt = `
You are DriveShift, a premium vehicle diagnostic assistant. Reply naturally, briefly, and professionally.

Language:
${lang === "es" ? "Spanish only" : "English only"}

User message:
${message || "(empty message)"}

Return exactly this format:
Diagnosis status:
follow_up

Voice summary:
A short natural greeting response.

Risk level:
Low

Likely issue:
Pending vehicle symptom.

Why it fits:
The user has not described a vehicle symptom yet.

What to inspect next:
A natural sentence inviting the user to describe the vehicle problem.

What to do next:
A natural sentence inviting the user to describe the vehicle problem.

Answer options:
None

Mechanic Notes:
A vehicle symptom is required before a mechanical failure path can be isolated.
`;

return requestOpenAIReportWithSettings({
prompt,
temperature: 0.2,
maxTokens: 400,
timeoutMs: 10000,
});
}

async function requestOpenAIReport(prompt, isFollowUp = false) {
return requestOpenAIReportWithSettings({
prompt,
temperature: isFollowUp ? 0.1 : 0.0,
maxTokens: isFollowUp ? 800 : 500,
timeoutMs: 18000,
});
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
const response = await fetch("https://api.openai.com/v1/responses", {
method: "POST",
signal: controller.signal,
headers: {
"Content-Type": "application/json",
Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
},
body: JSON.stringify({
model: process.env.DRIVESHIFT_MODEL || "gpt-4o-mini",
input: prompt,
temperature,
max_output_tokens: maxTokens,
}),
});

clearTimeout(timeout);
if (!response.ok) return "";

const data = await response.json();
return extractText(data).trim();
} catch (_) {
clearTimeout(timeout);
return "";
}
}

function shouldForceFinal({ flowControl, hasObdCode, answerCount = 0 }) {
if (hasObdCode) return true;
if (answerCount >= 1) return true;

const decision = String(flowControl?.localDecision || "").toLowerCase().trim();
return (
decision === "final" ||
decision === "analysis" ||
decision === "final_report"
);
}

function cleanFollowUp(text, { lang, issue, askedQuestions, dominantLock }) {
let clean = String(text || "").trim();
if (!clean) return "";

clean = clean.replace(/When to stop driving:/gi, "Mechanic Notes:");

if (!/Diagnosis status:/i.test(clean)) {
clean = `Diagnosis status: follow_up\n\n${clean}`;
}

clean = clean.replace(/Diagnosis status:\s*analysis/i, "Diagnosis status: follow_up");
clean = clean.replace(/Answer options:\s*[\s\S]*?(?=Mechanic Notes:|$)/i, "Answer options:\nNone\n\n");

if (!/Answer options:/i.test(clean)) {
clean += "\n\nAnswer options:\nNone";
}

if (!/Mechanic Notes:/i.test(clean)) {
clean += "\n\nMechanic Notes:\nThis answer separates the dominant failure path before parts are replaced.";
}

if (questionLooksRepeated(clean, askedQuestions)) {
return buildNaturalFallbackFollowUp({ lang, issue, dominantLock });
}

return clean.trim();
}

// ==========================================
// الدوال الجديدة المحدثة بالـ Markdown Bold
// ==========================================

function cleanAnalysis(text) {
let clean = String(text || "").trim();
if (!clean) return "";

clean = clean.replace(/When to stop driving:/gi, "**Mechanic Notes:**");
clean = clean.replace(/Mechanic Notes:/gi, "**Mechanic Notes:**");
clean = clean.replace(/Diagnosis status:\s*follow_up/i, "Diagnosis status: analysis");

if (!/Diagnosis status:/i.test(clean)) {
clean = `Diagnosis status:\nanalysis\n\n${clean}`;
}

const headersToFix = [
"Final Mechanical Report",
"Likely issue",
"Why it fits",
"What to verify",
"Next professional action",
"Risk level"
];

headersToFix.forEach(header => {
const regex = new RegExp(`\\*\\*?${header}\\*\\*?:?`, "gi");
clean = clean.replace(regex, `**${header}:**`);
});

clean = clean.replace(/Answer options:\s*[\s\S]*$/i, "Answer options:\nNone");

if (!/Answer options:/i.test(clean)) {
clean += "\n\nAnswer options:\nNone";
}

return clean.trim();
}

function buildSafeAnalysisFallback(lang) {
const isEs = lang === "es";
if (isEs) {
return `Diagnosis status:
analysis

**Final Mechanical Report:**
DriveShift no pudo completar un informe confiable desde el servidor.

**Likely issue:**
Error de respuesta diagnóstica del servidor.

**Why it fits:**
El servidor no devolvió un reporte mecánico utilizable.

**What to verify:**
Revisa los logs del backend.

**Next professional action:**
Corrige la respuesta del servidor y prueba otra vez.

**Risk level:**
Medium

**Mechanic Notes:**
Este es un fallo técnico, no una conclusión mecánica.

Answer options:
None`;
}

return `Diagnosis status:
analysis

**Final Mechanical Report:**
DriveShift could not complete a reliable final report from the server response.

**Likely issue:**
Server diagnostic response failed.

**Why it fits:**
The diagnostic brain did not return a usable mechanic report.

**What to verify:**
Check the backend logs and OpenAI response.

**Next professional action:**
Fix the backend response and test again.

**Risk level:**
Medium

**Mechanic Notes:**
This is a technical failure, not a mechanical conclusion.

Answer options:
None`;
}

function buildErrorFallback() {
return `Diagnosis status:
analysis

**Final Mechanical Report:**
DriveShift could not reach the diagnostic brain.

**Likely issue:**
Backend diagnostic error.

**Why it fits:**
The server could not complete the diagnostic request.

**What to verify:**
Check the route, environment variables, and OpenAI response.

**Next professional action:**
Fix the backend error and test again.

**Risk level:**
Medium

**Mechanic Notes:**
This failure is technical, not mechanical.

Answer options:
None`;
}

// ==========================================
// بقية دوال المساعدة القديمة المستقرة
// ==========================================

function looksBad(text) {
const clean = String(text || "").toLowerCase();
return (
!clean ||
clean.includes("consult a mechanic") ||
clean.includes("could be many things") ||
clean.includes("hard to say") ||
clean.includes("as an ai") ||
clean.includes("i am not a mechanic") ||
clean.includes("i'm not a mechanic")
);
}

function buildNaturalFallbackFollowUp({ lang, issue, dominantLock }) {
const isEs = lang === "es";
const q = buildSmartFallbackQuestion({ lang, issue, dominantLock });

return `Diagnosis status: follow_up

Voice summary:
${isEs ? "Necesito un dato más para separar la falla principal." : "I need one more detail to separate the main failure path."}

Risk level:
Medium

Likely issue:
Pending diagnostic confirmation.

Why it fits:
${isEs ? "Ese detalle define si el problema viene de carga, combustión, combustible, frenos, dirección o tren motriz." : "That detail separates whether the fault is coming from load, combustion, fuel delivery, braking, steering, or drivetrain behavior."}

What to inspect next:
${q}

What to do next:
${q}

Answer options:
None

Mechanic Notes:
${isEs ? "La respuesta evita cambiar piezas por intuición y dirige la prueba hacia el sistema correcto." : "The answer prevents guessing at parts and points the test toward the correct system."}`;
}

function buildSmartFallbackQuestion({ lang, issue, dominantLock }) {
const isEs = lang === "es";
const text = `${issue || ""} ${dominantLock || ""}`.toLowerCase();

if (/smoke|humo|fuel smell|gas smell|gasolina/.test(text)) {
return isEs ? "¿El humo es negro, blanco o azul, y huele a gasolina cruda?" : "Is the smoke black, white, or blue, and does it smell like raw fuel?";
}
if (/no start|won't start|crank|click|arranca|enciende/.test(text)) {
return isEs ? "Cuando intentas arrancar, ¿el motor gira normal, solo hace clic, o no hace nada?" : "When you try to start it, does the engine crank normally, only click, or do nothing at all?";
}
if (/vibration|shake|shaking|vibra|vibración|vibracion/.test(text)) {
return isEs ? "¿La vibración aparece al frenar, al acelerar, a cierta velocidad, o también en ralentí?" : "Does the vibration show up while braking, accelerating, at a certain speed, or even at idle?";
}
if (/overheat|overheating|coolant|sobrecalienta/.test(text)) {
return isEs ? "¿La temperatura sube parado, manejando en carretera, o después de perder coolant?" : "Does the temperature rise while sitting still, highway driving, or after losing coolant?";
}
if (/burning|smell|olor|quemado/.test(text)) {
return isEs ? "¿El olor parece aceite quemado, plástico/eléctrico, coolant dulce, o freno/clutch caliente?" : "Does the smell seem like burnt oil, electrical plastic, sweet coolant, or hot brake/clutch material?";
}

return isEs
? "¿Cuándo aparece más fuerte: al acelerar, frenار, girar, estar parado, o mantener velocidad constante?"
: "When is it strongest: accelerating, braking, turning, sitting still, or holding steady speed?";
}

function extractObdCode(text) {
const matches = String(text || "")
.toUpperCase()
.match(/\b[PCBU][0-9A-F]{4}\b/g);

if (!matches || !matches.length) return "";
return [...new Set(matches)].join(", ");
}

function buildVehicleText(profile) {
if (!profile || typeof profile !== "object") return "Unknown vehicle.";

const parts = [];
if (profile.year) parts.push(`Year: ${profile.year}`);
if (profile.make) parts.push(`Make: ${profile.make}`);
if (profile.model) parts.push(`Model: ${profile.model}`);
if (profile.mileage) parts.push(`Mileage: ${profile.mileage}`);

return parts.length ? parts.join(", ") : "Unknown vehicle.";
}

function extractAskedQuestions(answers) {
return (Array.isArray(answers) ? answers : [])
.map((a) => String(a?.question || "").trim())
.filter(Boolean);
}

function questionLooksRepeated(text, askedQuestions) {
if (!askedQuestions.length) return false;

const clean = normalizeQuestionText(text);
return askedQuestions.some((q) => {
const oldQ = normalizeQuestionText(q);
return oldQ && clean.includes(oldQ.slice(0, 45));
});
}

function normalizeQuestionText(text) {
return String(text || "")
.toLowerCase()
.replace(/diagnosis status:[\s\S]*?what to inspect next:/i, "")
.replace(/what to do next:[\s\S]*/i, "")
.replace(/[^\w\s]/g, "")
.replace(/\s+/g, " ")
.trim();
}

function buildLocalDominantLock(issue, answers) {
const text = `${issue || ""} ${(answers || [])
.map((a) => `${a.question || ""} ${a.answer || ""}`)
.join(" ")}`.toLowerCase();

const locks = [];

if (/black smoke|humo negro|raw fuel|fuel smell|gas smell|gasolina/.test(text)) {
locks.push("Fuel-rich combustion / overfueling / injector or fuel control fault");
}
if (/white smoke|humo blanco|coolant|sweet smell|coolant loss/.test(text)) {
locks.push("Coolant intrusion or overheating-related failure path");
}
if (/blue smoke|humo azul|burning oil|oil consumption/.test(text)) {
locks.push("Oil consumption through rings, valve seals, turbo, or PCV path");
}
if (/overheat|overheating|hot|temperature|sobrecalienta/.test(text)) {
locks.push("Cooling system heat rejection failure");
}
if (/burning smell|smell burning|electrical smell|plastic smell|olor a quemado/.test(text)) {
locks.push("Heat, friction, oil leak, belt slip, brake drag, or electrical overheating path");
}
if (/no start|won't start|does not start|crank|click|arranca|enciende/.test(text)) {
locks.push("No-start path: battery, starter, crank signal, fuel, ignition, or security authorization");
}
if (/vibration|shake|shaking|vibra|vibración|vibracion/.test(text)) {
locks.push("Rotational imbalance, engine misfire, brake pulsation, driveline, tire, or mount-related vibration");
}
if (/brake|brakes|abs|freno|frenos/.test(text)) {
locks.push("Brake hydraulic, friction, ABS, rotor, caliper, or wheel-speed signal path");
}
if (/steering|wheel pulls|eps|dirección|direccion/.test(text)) {
locks.push("Steering assist, alignment, suspension geometry, tire pull, or torque sensor path");
}
if (/misfire|rough idle|idle|stumble|stall|stalls/.test(text)) {
locks.push("Combustion instability: ignition, injector, air leak, compression, timing, or fuel trim path");
}

return locks.length ? [...new Set(locks)].join(" | ") : "";
}

function extractText(data) {
try {
if (data.output_text) return data.output_text;

if (Array.isArray(data.output)) {
return data.output
.flatMap((item) => item.content || [])
.map((content) => content.text || "")
.join("\n")
.trim();
}
return "";
} catch (_) {
return "";
}
}
