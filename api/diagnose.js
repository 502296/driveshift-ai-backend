export default async function handler(req, res) {
if (req.method !== "POST") {
return res.status(405).json({ result: "Method not allowed" });
}

try {
const { issue, answers, language, vehicleProfile } = req.body;

const lang = language === "es" ? "es" : "en";
const safeIssue = String(issue || "").trim();
const answerList = Array.isArray(answers) ? answers : [];
const profile = vehicleProfile || {};

if (!safeIssue) {
return res.status(200).json({ result: fallbackFollowUp(lang) });
}

const possibleObdCode = safeIssue.match(/\b[PCBU][0-9A-F]{4}\b/i);
const hasObdCode = Boolean(possibleObdCode);
const obdCode = hasObdCode ? possibleObdCode[0].toUpperCase() : "";

const realAnswerCount = countUserAnswers(answerList);
const dominantSignals = detectDominantSignals(safeIssue, answerList);
const complexity = detectComplexity(safeIssue, dominantSignals, answerList);

const minimumQuestions = hasObdCode ? 0 : complexity.minimumQuestions;
const shouldAskFollowUp = !hasObdCode && realAnswerCount < minimumQuestions;

const userInput =
answerList.length > 0
? answerList
.map((a, index) => {
const q = String(a.question || `Question ${index + 1}`).trim();
const ans = String(a.answer || "").trim();
return `${index + 1}. ${q}: ${ans}`;
})
.join("\n")
: "No additional answers yet.";

const vehicleText = buildVehicleText(profile);
const dominantText = dominantSignals.length
? dominantSignals.join(", ")
: "None detected yet";

const prompt = `
You are DriveShift Doctor, a calm senior automotive diagnostic mechanic.

You are not a chatbot.
You behave like a real diagnostic mechanic:
you ask focused questions first, preserve the strongest symptom direction, and only give a final report when enough information exists.

Language:
${lang === "es" ? "Spanish" : "English"}

Original problem:
${safeIssue}

Vehicle profile:
${vehicleText}

Conversation so far:
${userInput}

Detected OBD code:
${hasObdCode ? obdCode : "None"}

Dominant symptom lock:
${dominantText}

Diagnostic complexity:
${complexity.level}

Question depth reason:
${complexity.reason}

Required minimum answered questions before final report:
${minimumQuestions}

Current answered questions:
${realAnswerCount}

Current mode:
${shouldAskFollowUp ? "follow_up" : "analysis"}

Critical diagnostic rules:
If dominant symptom lock includes black smoke, fuel smell, raw fuel smell, strong fuel odor, or rich running, you must keep overfueling, injector leak, fuel pressure, MAF/MAP data, oxygen sensor feedback, or ignition misfire with unburned fuel as higher priority than vacuum leak unless the user gives strong evidence otherwise.
If dominant symptom lock includes overheating, coolant loss, steam, temperature gauge high, or red temperature warning, you must keep cooling-system risk high priority.
If dominant symptom lock includes burning smell, smoke from engine bay, oil smell, electrical burning, or brake smell, you must treat it as safety-sensitive.
If dominant symptom lock includes brake warning, low brake pedal, grinding brakes, or brake fluid leak, you must prioritize brake safety.
If dominant symptom lock includes stall while driving, severe power loss, red warning light, oil pressure light, or battery/charging warning while driving, you must clearly advise caution.
Do not let later minor symptoms override the strongest dangerous symptom.
Do not jump to exotic causes before simple high-probability checks.

Question strategy:
Ask only one question per turn.
Each question must remove uncertainty.
Never repeat a question already asked.
Do not ask random generic questions.
For safety-sensitive symptoms, ask enough questions to understand severity, timing, warning lights, smell/smoke/leaks, and drivability.
For simple symptoms, keep the flow short and fast.

Rules for follow_up mode:
Ask exactly ONE smart mechanic question.
The question must be specific to the user's problem and dominant signals.
Do not repeat previous questions.
Do not diagnose yet.
Do not give repair steps yet.
You MUST provide exactly 4 short answer options.
The 4 answer options must match the question exactly.
The answer options must be practical driver observations, not repair instructions.
Do not include safety advice inside the question.
Make the question feel like a real mechanic is narrowing the issue.
Do not ask generic questions like "When does it happen?" if the user's symptoms already include timing or context.
Always prefer a diagnostic question that directly narrows a mechanical cause (misfire, fuel, air, ignition, cooling, etc).
Avoid broad or vague questions unless the problem is unclear.

Rules for analysis mode:
Give a professional diagnosis report.
Do not pretend certainty.
Give the most likely issue first.
Explain why it fits the user's symptoms.
Give practical next checks.
Give clear safety advice.
If multiple systems could be involved, mention the top 2 possibilities calmly.
Do not bury the dominant symptom.
Do not write a generic answer.
Do not mention AI.
Do not say "as an AI".

Style:
Calm, practical, premium, human mechanic.
Short but useful.
No markdown.
No bullets.
No numbered lists.
Do not over-scare the driver.

Voice summary rules:
Voice summary must be one short natural sentence.
It should sound like a calm mechanic speaking.
It must not list many items.
It must not include the full report.

Output exactly this format:

Diagnosis status: ${shouldAskFollowUp ? "follow_up" : "analysis"}

Voice summary:
[one short natural mechanic sentence]

Confidence:
[number 0-100]

Risk level:
[High or Medium or Low]

Likely issue:
[if follow_up: Still narrowing the issue. If analysis: short likely issue]

Why it fits:
[if follow_up: Need one more detail before a reliable diagnosis. If analysis: short explanation]

What to do next:
[if follow_up: one clear follow-up question only. If analysis: practical next steps]

Answer options:
[option 1]
[option 2]
[option 3]
[option 4]

When to stop driving:
[clear safety advice]
`;

const response = await fetch("https://api.openai.com/v1/responses", {
method: "POST",
headers: {
"Content-Type": "application/json",
Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
},
body: JSON.stringify({
model: process.env.DRIVESHIFT_MODEL || "gpt-4o",
input: prompt,
temperature: 0.08,
max_output_tokens: shouldAskFollowUp ? 460 : 860,
}),
});

const data = await response.json();

if (!response.ok) {
return res.status(500).json({
result: shouldAskFollowUp
? fallbackFollowUp(lang)
: fallbackAnalysis(lang),
});
}

let text = extractText(data).trim();

if (!text) {
return res.status(200).json({
result: shouldAskFollowUp
? fallbackFollowUp(lang)
: fallbackAnalysis(lang),
});
}

text = normalizeStatusLine(text, shouldAskFollowUp);
text = ensureRequiredFormat(text, lang, shouldAskFollowUp);
text = enforceAnswerOptionCount(text, lang, shouldAskFollowUp);

return res.status(200).json({ result: text });
} catch (error) {
return res.status(500).json({
result: fallbackFollowUp("en"),
});
}
}

function countUserAnswers(answers) {
if (!Array.isArray(answers)) return 0;

return answers.filter((item) => {
const answer = String(item?.answer || "").trim();
const question = String(item?.question || "").toLowerCase();

if (!answer) return false;
if (question.includes("vehicle profile")) return false;

return true;
}).length;
}

function detectDominantSignals(issue, answers) {
const combined = [
String(issue || ""),
...(Array.isArray(answers)
? answers.map((a) => `${a?.question || ""} ${a?.answer || ""}`)
: []),
]
.join(" ")
.toLowerCase();

const signals = [];

const rules = [
{
label: "black smoke / rich running",
words: ["black smoke", "dark smoke", "rich", "running rich"],
},
{
label: "fuel smell / raw fuel",
words: [
"fuel smell",
"gas smell",
"raw fuel",
"smells like gas",
"gasoline smell",
"strong fuel",
],
},
{
label: "overheating / cooling risk",
words: [
"overheat",
"overheating",
"temperature high",
"temp gauge",
"steam",
"coolant",
],
},
{
label: "burning smell / smoke safety risk",
words: [
"burning smell",
"smells burnt",
"burnt smell",
"smoke from engine",
"electrical burning",
],
},
{
label: "brake safety risk",
words: [
"brake",
"brakes",
"low brake pedal",
"brake fluid",
"grinding brakes",
],
},
{
label: "stalling while driving",
words: ["stall while driving", "dies while driving", "shuts off while driving"],
},
{
label: "severe power loss",
words: [
"loss of power",
"no power",
"limp mode",
"won't accelerate",
"slow acceleration",
],
},
{
label: "misfire / shaking",
words: ["misfire", "shaking", "rough idle", "vibration", "jerking"],
},
{
label: "turbo / boost issue",
words: ["turbo", "boost", "whistle", "underboost", "boost leak"],
},
{
label: "electrical / charging issue",
words: ["battery light", "alternator", "charging", "electrical", "no crank"],
},
{
label: "oil pressure risk",
words: ["oil pressure", "red oil light", "oil light"],
},
{
label: "transmission / drivability issue",
words: ["transmission", "gear", "shifting", "slipping", "hard shift"],
},
{
label: "starting system issue",
words: ["no start", "won't start", "does not start", "crank", "starter"],
},
];

for (const rule of rules) {
if (rule.words.some((word) => combined.includes(word))) {
signals.push(rule.label);
}
}

return [...new Set(signals)];
}

function detectComplexity(issue, dominantSignals, answers) {
const text = String(issue || "").toLowerCase();
const answerText = Array.isArray(answers)
? answers.map((a) => `${a?.question || ""} ${a?.answer || ""}`).join(" ").toLowerCase()
: "";

const allText = `${text} ${answerText}`;

const highRiskWords = [
"smoke",
"burning",
"overheat",
"overheating",
"brake",
"oil pressure",
"airbag",
"srs",
"stall",
"dies while driving",
"red warning",
"fuel smell",
"gas smell",
"raw fuel",
"no brakes",
"steering locked",
];

const complexWords = [
"ac",
"a/c",
"air conditioning",
"compressor",
"cuts out",
"intermittent",
"module",
"airbag",
"srs",
"water",
"leak",
"roof",
"sunroof",
"electrical",
"misfire",
"transmission",
"overheating",
"stall",
"dies",
"shakes",
"vibration",
"turbo",
"boost",
"black smoke",
"whistle",
"semi",
"truck",
];

const simpleWords = [
"maintenance",
"oil change",
"tire pressure",
"wiper",
"washer fluid",
"light bulb",
"gas cap",
];

const signalCount = Array.isArray(dominantSignals) ? dominantSignals.length : 0;
const isHighRiskWord = highRiskWords.some((w) => allText.includes(w));
const isComplexWord = complexWords.some((w) => allText.includes(w));
const isSimpleWord = simpleWords.some((w) => allText.includes(w));

if (isSimpleWord && !isHighRiskWord && signalCount === 0) {
return {
level: "simple low-risk symptom",
minimumQuestions: 2,
reason: "simple maintenance-style concern",
};
}

if (signalCount >= 4) {
return {
level: "very high complexity multi-signal case",
minimumQuestions: 6,
reason: "multiple dominant symptoms need deeper narrowing before a reliable report",
};
}

if (signalCount === 3) {
return {
level: "high complexity multi-signal case",
minimumQuestions: 5,
reason: "several strong symptom signals are present",
};
}

if (isHighRiskWord || signalCount === 2) {
return {
level: "high complexity or safety-sensitive",
minimumQuestions: 4,
reason: "safety-sensitive symptoms require controlled questioning",
};
}

if (isComplexWord || signalCount === 1) {
return {
level: "complex symptom",
minimumQuestions: 3,
reason: "the issue needs a few targeted mechanic questions",
};
}

return {
level: "standard symptom",
minimumQuestions: 2,
reason: "standard issue with enough room for quick narrowing",
};
}

function buildVehicleText(profile) {
if (!profile || typeof profile !== "object") return "Unknown vehicle.";

const year = String(profile.year || "").trim();
const make = String(profile.make || "").trim();
const model = String(profile.model || "").trim();
const mileage = String(profile.mileage || "").trim();

const parts = [];
if (year) parts.push(`Year: ${year}`);
if (make) parts.push(`Make: ${make}`);
if (model) parts.push(`Model: ${model}`);
if (mileage) parts.push(`Mileage: ${mileage}`);

return parts.length ? parts.join(", ") : "Unknown vehicle.";
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
} catch {
return "";
}
}

function normalizeStatusLine(text, shouldAskFollowUp) {
const desired = shouldAskFollowUp
? "Diagnosis status: follow_up"
: "Diagnosis status: analysis";

let clean = String(text || "").trim();

if (/Diagnosis status:/i.test(clean)) {
clean = clean.replace(
/Diagnosis status:\s*(follow_up|analysis|final)/i,
desired
);
} else {
clean = `${desired}\n\n${clean}`;
}

return clean.trim();
}

function ensureRequiredFormat(text, lang, shouldAskFollowUp) {
const clean = String(text || "").trim();

const required = [
"Diagnosis status:",
"Voice summary:",
"Confidence:",
"Risk level:",
"Likely issue:",
"Why it fits:",
"What to do next:",
"When to stop driving:",
];

if (shouldAskFollowUp) required.push("Answer options:");

const hasAll = required.every((label) =>
clean.toLowerCase().includes(label.toLowerCase())
);

if (hasAll) return clean;

return shouldAskFollowUp ? fallbackFollowUp(lang) : fallbackAnalysis(lang);
}

function enforceAnswerOptionCount(text, lang, shouldAskFollowUp) {
if (!shouldAskFollowUp) return text;

const lower = text.toLowerCase();
const marker = "answer options:";
const stopMarker = "when to stop driving:";

const start = lower.indexOf(marker);
const stop = lower.indexOf(stopMarker);

if (start === -1 || stop === -1 || stop <= start) {
return fallbackFollowUp(lang);
}

const before = text.substring(0, start + marker.length).trimEnd();
const optionsRaw = text.substring(start + marker.length, stop).trim();
const after = text.substring(stop).trimStart();

const options = optionsRaw
.split("\n")
.map((line) => line.replace(/^\s*[-•\d.)]+\s*/, "").trim())
.filter((line) => line && line.toLowerCase() !== "none")
.slice(0, 4);

if (options.length !== 4) {
return fallbackFollowUp(lang);
}

return `${before}\n${options.join("\n")}\n\n${after}`.trim();
}

function fallbackFollowUp(lang) {
if (lang === "es") {
return `Diagnosis status: follow_up

Voice summary:
Necesito un detalle más para separar las causas probables.

Confidence:
50

Risk level:
Medium

Likely issue:
Still narrowing the issue.

Why it fits:
La información actual todavía no es suficiente para separar las causas posibles.

What to do next:
¿Cuándo ocurre exactamente el problema?

Answer options:
Al encender
Mientras manejo
Al frenar o acelerar
No sé

When to stop driving:
Deja de manejar si el auto se siente inseguro, se sobrecalienta, huele a quemado, pierde potencia fuerte, o aparece una luz roja de advertencia.`;
}

return `Diagnosis status: follow_up

Voice summary:
I need one more detail to separate the likely causes.

Confidence:
50

Risk level:
Medium

Likely issue:
Still narrowing the issue.

Why it fits:
The current information is not enough yet to separate the possible causes.

What to do next:
When exactly does the problem happen?

Answer options:
At startup
While driving
When braking or accelerating
Not sure

When to stop driving:
Stop driving if the car feels unsafe, overheats, smells like burning, loses strong power, or shows a red warning light.`;
}

function fallbackAnalysis(lang) {
if (lang === "es") {
return `Diagnosis status: analysis

Voice summary:
DriveShift encontró una causa probable, pero conviene confirmar con una revisión básica.

Confidence:
60

Risk level:
Medium

Likely issue:
Possible vehicle system fault that needs inspection.

Why it fits:
Los síntomas indican que un sistema del vehículo no está funcionando de forma normal.

What to do next:
Revisa luces, sonidos, olores, fugas, pérdida de potencia o vibración. Si continúa, haz un escaneo OBD y una inspección profesional.

Answer options:
None

When to stop driving:
Deja de manejar si el auto se siente inseguro, se sobrecalienta, vibra fuerte, huele a quemado, o aparece una luz roja de advertencia.`;
}

return `Diagnosis status: analysis

Voice summary:
DriveShift found a likely direction, but it should be confirmed with basic checks.

Confidence:
60

Risk level:
Medium

Likely issue:
Possible vehicle system fault that needs inspection.

Why it fits:
The symptoms suggest one vehicle system is not behaving normally.

What to do next:
Check for warning lights, sounds, smells, leaks, power loss, or vibration. If it continues, get an OBD scan and a professional inspection.

Answer options:
None

When to stop driving:
Stop driving if the car feels unsafe, overheats, shakes badly, smells like burning, or shows a red warning light.`;
}
