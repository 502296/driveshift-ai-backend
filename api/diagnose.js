import { buildDiagnosticContext } from "./helpers/diagnostic-core.js";

import {
parseLiveDataContext,
buildObdInsight,
} from "./helpers/obd-intelligence.js";

const DOCTOR_PROMPT = `
Role:
You are DriveShift, the elite forensic diagnostic authority. You operate with "Surgical Precision." You don't explain basics; you solve complex mechanical puzzles. Your tone is calm, authoritative, and strictly technical.

STRICT OPERATING PROTOCOLS:

1. THE "NO REPETITION" RULE:
- Once a diagnostic fact (e.g., Load-sensitivity) is established, do not repeat it. Move to the *consequence*.
- If the user confirmed the Neutral test, use that result to close a door and never mention it again as a "suggestion."

2. ELITE VERIFICATION (REAL-WORLD STEPS):
- Do NOT suggest tests the user has already performed during the chat.
- Recommended steps MUST be mechanical "Deep Dives" (e.g., Inner CV joints, Transmission Mounts, Torque Converter Lock-up, Fuel Trim behavior).
- Only suggest a "Lab Scope" if the failure physics points strictly to intermittent electrical or secondary ignition breakdowns.

3. DECISIVE DIAGNOSIS:
- Eliminate hedging (might, could, possibly).
- Use Verdict Language: "The physics isolates the failure to [System]," "The behavior confirms torque-induced instability."

4. SYSTEM COMPATIBILITY FORMATTING:
- Headers MUST use Colons (:) and NO Markdown bolding.
- Ensure the output is dense but scannable for mobile users.

FINAL RESPONSE STRUCTURE:

Primary Verdict:
[One decisive sentence identifying the most likely failure mode. No fluff.]

Voice Summary:
[Max 2 sentences. Connect the forensic evidence to the mechanical root cause.]

Failure Behavior Analysis:
[Brief technical observation: Why the specific interaction (Load/Speed/Neutral) confirms the verdict.]

Why The Logic Holds:
[The "Genius" moment: Explain why the exclusion of previous parts or test results makes this the only remaining logical path.]

Recommended Verification Path:
1. [Physical inspection point - specific and technical]
2. [Diagnostic tool parameter to monitor - e.g., Live Data/Fuel Trims]
3. [The "Smoking Gun" test to confirm replacement is needed]

Mechanic Insight:
[One high-level technician’s tip or a specific component "trap" to avoid. No generic advice.]

Answer options:
None

Units: Imperial (USA)
Language: English only
`;

export default async function handler(req, res) {
try {
if (req.method !== "POST") {
return res.status(200).json({
result: buildGeneralHelpResponse("en"),
});
}

const { issue, answers, language, vehicleProfile, flowControl } = req.body || {};

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

const forceFinal = shouldForceFinal({
flowControl,
hasObdCode,
answerCount: clientAnswerCount,
issue: safeIssue,
answers: answerList,
diagnosticContext,
});

const readyForAnalysis =
hasObdCode ||
forceFinal ||
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
Your job now is NOT to diagnose yet. Ask ONE sharp follow-up question.

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
- Do not repeat any already asked question.
- Do not ask generic questions.
- Use exactly this format:

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

Mechanic notes:
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
The diagnostic interview is complete.
Return only the exact final response format.
Do not use Markdown bold.
Do not invent custom headers.
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

Mechanic notes:
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
maxTokens: isFollowUp ? 800 : 900,
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

function shouldForceFinal({
flowControl,
hasObdCode,
answerCount = 0,
issue = "",
answers = [],
diagnosticContext,
}) {
if (hasObdCode) return true;

const combinedText = `${issue || ""} ${(answers || [])
.map((a) => `${a.question || ""} ${a.answer || ""}`)
.join(" ")}`.toLowerCase();

const hasFlashingCel =
/flashing|flashes|blinking|blink/.test(combinedText) &&
/check engine|cel|engine light|dashboard light/.test(combinedText);

const hasLoadSymptom =
/under load|accelerat|uphill|hill|merging|passing|heavy throttle|floor|towing|highway/.test(
combinedText
);

const hasSevereSymptom =
/shake|shaking|jitter|stumble|loss of power|misfire|rough/.test(combinedText);

const hasRepairHistory =
/replaced|changed|new|brand new|installed|swapped/.test(combinedText);

const noCodesScanned =
/haven't checked|not checked|no scan|not scanned|haven't scanned|didn't scan/.test(
combinedText
);

const enoughFactsForLoadMisfire =
hasFlashingCel && hasLoadSymptom && hasSevereSymptom;

const enoughFactsWithRepairHistory =
enoughFactsForLoadMisfire && hasRepairHistory;

if (enoughFactsForLoadMisfire || enoughFactsWithRepairHistory || noCodesScanned) {
return true;
}

if (diagnosticContext?.readiness?.readyForAnalysis === true) return true;

if (answerCount < 2) return false;

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

clean = clean.replace(/When to stop driving:/gi, "Mechanic notes:");
clean = clean.replace(/Mechanic Notes:/gi, "Mechanic notes:");

if (!/Diagnosis status:/i.test(clean)) {
clean = `Diagnosis status:\nfollow_up\n\n${clean}`;
}

clean = clean.replace(/Diagnosis status:\s*analysis/i, "Diagnosis status:\nfollow_up");
clean = clean.replace(
/Answer options:\s*[\s\S]*?(?=Mechanic notes:|Mechanic Notes:|$)/i,
"Answer options:\nNone\n\n"
);

if (!/Answer options:/i.test(clean)) {
clean += "\n\nAnswer options:\nNone";
}

if (!/Mechanic notes:/i.test(clean)) {
clean +=
"\n\nMechanic notes:\nThis answer separates the dominant failure path before parts are replaced.";
}

if (questionLooksRepeated(clean, askedQuestions)) {
return buildNaturalFallbackFollowUp({ lang, issue, dominantLock });
}

return clean.trim();
}

function cleanAnalysis(text) {
let clean = String(text || "").trim();
if (!clean) return "";

clean = clean.replace(/When to stop driving:/gi, "Mechanic notes:");
clean = clean.replace(/Mechanic Notes:/gi, "Mechanic notes:");
clean = clean.replace(/\*\*/g, "");
clean = clean.replace(/Diagnosis status:\s*follow_up/i, "Diagnosis status:\nanalysis");

if (!/Diagnosis status:/i.test(clean)) {
clean = `Diagnosis status:\nanalysis\n\n${clean}`;
}

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

Voice summary:
DriveShift no pudo completar un informe confiable desde la respuesta del servidor.

Risk level:
Medium

Likely issue:
Error de respuesta diagnóstica del servidor.

Why it fits:
El servidor no devolvió un reporte mecánico utilizable.

Evolutionary update:
No se pudo completar la actualización diagnóstica.

What to inspect next:
1. Revisa los logs del backend.
2. Verifica la respuesta de OpenAI.
3. Prueba nuevamente con una solicitud corta.

Mechanic notes:
Este es un fallo técnico, no una conclusión mecánica.

Answer options:
None`;
}

return `Diagnosis status:
analysis

Voice summary:
DriveShift could not complete a reliable final report from the server response.

Risk level:
Medium

Likely issue:
Server diagnostic response failed.

Why it fits:
The diagnostic brain did not return a usable mechanic report.

Evolutionary update:
No diagnostic refinement could be completed.

What to inspect next:
1. Check the backend logs.
2. Verify the OpenAI response.
3. Test again with a shorter request.

Mechanic notes:
This is a technical failure, not a mechanical conclusion.

Answer options:
None`;
}

function buildErrorFallback() {
return `Diagnosis status:
analysis

Voice summary:
DriveShift could not reach the diagnostic brain.

Risk level:
Medium

Likely issue:
Backend diagnostic error.

Why it fits:
The server could not complete the diagnostic request.

Evolutionary update:
No diagnostic refinement could be completed.

What to inspect next:
1. Check the API route.
2. Check environment variables.
3. Check the OpenAI response.

Mechanic notes:
This failure is technical, not mechanical.

Answer options:
None`;
}

function buildEmptyFollowUp(lang) {
const isEs = lang === "es";

return `Diagnosis status:
follow_up

Voice summary:
${isEs ? "Describe el síntoma del vehículo para comenzar." : "Describe the vehicle symptom to begin."}

Risk level:
Low

Likely issue:
Pending vehicle symptom.

Why it fits:
${isEs ? "Aún no hay un síntoma mecánico para analizar." : "There is no mechanical symptom to analyze yet."}

What to inspect next:
${isEs ? "Cuéntame qué hace el vehículo y cuándo ocurre." : "Tell me what the vehicle is doing and when it happens."}

What to do next:
${isEs ? "Escribe el síntoma principal del vehículo." : "Type the main vehicle symptom."}

Answer options:
None

Mechanic notes:
A vehicle symptom is required before a failure path can be isolated.`;
}

function buildGreetingResponse(lang) {
const isEs = lang === "es";

return `Diagnosis status:
follow_up

Voice summary:
${isEs ? "Estoy listo para ayudarte con el diagnóstico." : "I’m ready to help with the diagnosis."}

Risk level:
Low

Likely issue:
Pending vehicle symptom.

Why it fits:
${isEs ? "Todavía no se describió una falla del vehículo." : "No vehicle failure has been described yet."}

What to inspect next:
${isEs ? "Describe qué hace el vehículo y cuándo ocurre." : "Describe what the vehicle is doing and when it happens."}

What to do next:
${isEs ? "Escribe el síntoma principal." : "Type the main symptom."}

Answer options:
None

Mechanic notes:
A clear symptom starts the diagnostic path.`;
}

function buildGeneralHelpResponse(lang) {
const isEs = lang === "es";

return `Diagnosis status:
follow_up

Voice summary:
${isEs ? "Puedo ayudarte a aislar la falla paso a paso." : "I can help isolate the fault step by step."}

Risk level:
Low

Likely issue:
Pending vehicle symptom.

Why it fits:
${isEs ? "Necesito el síntoma del vehículo para empezar." : "I need the vehicle symptom to begin."}

What to inspect next:
${isEs ? "Dime qué pasa, cuándo ocurre y si hay luces en el tablero." : "Tell me what happens, when it happens, and whether any dashboard lights appear."}

What to do next:
${isEs ? "Describe el problema del vehículo." : "Describe the vehicle problem."}

Answer options:
None

Mechanic notes:
The strongest diagnosis starts with symptom timing and operating condition.`;
}

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

return `Diagnosis status:
follow_up

Voice summary:
${isEs ? "Necesito un dato más para separar la falla principal." : "I need one more detail to separate the main failure path."}

Risk level:
Medium

Likely issue:
Pending diagnostic confirmation.

Why it fits:
${isEs ? "Ese detalle define el sistema correcto." : "That detail points the test toward the correct system."}

What to inspect next:
${q}

What to do next:
${q}

Answer options:
None

Mechanic notes:
${isEs ? "La respuesta evita cambiar piezas por intuición." : "The answer prevents guessing at parts."}`;
}

function buildSmartFallbackQuestion({ lang, issue, dominantLock }) {
const isEs = lang === "es";
const text = `${issue || ""} ${dominantLock || ""}`.toLowerCase();

if (/smoke|humo|fuel smell|gas smell|gasolina/.test(text)) {
return isEs
? "¿El humo es negro, blanco o azul, y huele a gasolina cruda?"
: "Is the smoke black, white, or blue, and does it smell like raw fuel?";
}

if (/no start|won't start|crank|click|arranca|enciende/.test(text)) {
return isEs
? "Cuando intentas arrancar, ¿el motor gira normal, solo hace clic, o no hace nada?"
: "When you try to start it, does the engine crank normally, only click, or do nothing at all?";
}

if (/vibration|shake|shaking|vibra|vibración|vibracion/.test(text)) {
return isEs
? "¿La vibración aparece al frenar, al acelerar, a cierta velocidad, o también en ralentí?"
: "Does the vibration show up while braking, accelerating, at a certain speed, or even at idle?";
}

if (/overheat|overheating|coolant|sobrecalienta/.test(text)) {
return isEs
? "¿La temperatura sube parado, manejando en carretera, o después de perder coolant?"
: "Does the temperature rise while sitting still, highway driving, or after losing coolant?";
}

if (/burning|smell|olor|quemado/.test(text)) {
return isEs
? "¿El olor parece aceite quemado, plástico/eléctrico, coolant dulce, o freno/clutch caliente?"
: "Does the smell seem like burnt oil, electrical plastic, sweet coolant, or hot brake/clutch material?";
}

return isEs
? "¿Cuándo aparece más fuerte: al acelerar, frenar, girar, estar parado, o mantener velocidad constante?"
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

if (/flashing|flashes|blinking|check engine|cel/.test(text) && /shake|shaking|misfire|stumble|jitter/.test(text)) {
locks.push("Catalyst-damaging misfire / combustion instability under load");
}

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
