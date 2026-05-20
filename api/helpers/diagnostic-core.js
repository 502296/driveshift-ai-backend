import { extractSignals } from "./signal-extractor.js";
import { buildDominantLock } from "./dominant-lock-engine.js";
import { buildBehaviorReasoning } from "./behavior-reasoning-engine.js";
import { buildMechanicalPrioritization } from "./mechanical-prioritization-engine.js";

export function countUserAnswers(answers) {
if (!Array.isArray(answers)) return 0;

return answers.filter((item) => {
const answer = String(item?.answer || "").trim();
const question = String(item?.question || "").toLowerCase();

if (!answer) return false;
if (question.includes("vehicle profile")) return false;
if (question.includes("driveshift flow control")) return false;

return true;
}).length;
}

export function detectDominantSignals(issue, answers) {
const combined = buildCombinedText(issue, answers);
const extracted = extractSignals(combined);

const coolingDenied = includesAny(combined, [
"no overheating",
"temperature stays normal",
"temperature normal",
"temp stays normal",
"no coolant loss",
"no steam",
"no sweet smell",
]);

const signals = [];

const ignitionFuelLock = buildIgnitionFuelDominance(combined);
const smokeFuelLock = buildSmokeFuelDominance(combined);
const noStartLock = buildNoStartDominance(combined);
const vibrationLock = buildVibrationDominance(combined);
const brakeLock = buildBrakeDominance(combined);
const overheatLock = buildOverheatDominance(combined);

if (ignitionFuelLock.locked) {
signals.push("dominant ignition/fuel combustion failure");
signals.push("load-sensitive combustion breakdown");
}

if (smokeFuelLock.locked) {
signals.push("dominant rich combustion / raw fuel exhaust pattern");
signals.push("overfueling / injector / ignition burn failure path");
}

if (noStartLock.locked) {
signals.push(noStartLock.label);
}

if (vibrationLock.locked) {
signals.push(vibrationLock.label);
}

if (brakeLock.locked) {
signals.push("brake safety diagnostic path");
}

if (overheatLock.locked && !coolingDenied) {
signals.push("cooling system heat rejection failure");
}

const rules = [
{ label: "black smoke / rich running", words: ["black smoke", "dark smoke", "running rich"] },
{ label: "fuel smell / raw fuel", words: ["fuel smell", "gas smell", "raw fuel", "smells like gas", "gasoline smell", "strong fuel", "rich smell", "unburned fuel"] },
{ label: "misfire / shaking", words: ["misfire", "rough under load", "engine feels rough", "rough idle", "shaking", "vibration", "jerking", "shakes under acceleration", "shaking under acceleration"] },
{ label: "severe power loss", words: ["loss of power", "loses power", "no power", "limp mode", "won't accelerate", "weak acceleration", "hesitating", "loss of throttle response", "loses throttle response"] },
{ label: "flashing check engine", words: ["flashing check engine", "check engine light flashes", "cel flashes", "flashes briefly", "flashing cel"] },
{ label: "overheating / cooling risk", words: ["overheat", "overheating", "temperature high", "temp gauge", "steam", "coolant"] },
{ label: "burning smell / smoke safety risk", words: ["burning smell", "smells burnt", "burnt smell", "smoke from engine", "electrical burning", "burning plastic"] },
{ label: "brake safety risk", words: ["brake", "brakes", "low brake pedal", "soft brake pedal", "brake fluid", "grinding brakes", "pedal goes to floor"] },
{ label: "stalling while driving", words: ["stall while driving", "dies while driving", "shuts off while driving"] },
{ label: "turbo / boost issue", words: ["turbo", "boost", "whistle", "underboost", "boost leak"] },
{ label: "electrical / charging issue", words: ["battery light", "alternator", "charging", "electrical", "no crank"] },
{ label: "oil pressure risk", words: ["oil pressure", "red oil light", "oil light"] },
{ label: "transmission / drivability issue", words: ["transmission", "gear", "shifting", "slipping", "hard shift", "flared", "flare"] },
{ label: "starting system issue", words: ["won't start", "will not start", "does not start", "doesn't start", "no start", "no crank", "starter clicks", "only clicks"] },
{ label: "check engine light", words: ["check engine", "engine light", "cel", "service engine"] },
{ label: "CAN / module communication", words: ["can bus", "u-code", "u code", "module offline", "no communication", "60 ohms", "oscilloscope"] },
{ label: "SRS / airbag", words: ["airbag", "srs"] },
{ label: "EPS / steering calibration", words: ["eps", "steering rack", "torque sensor", "zero-point reset", "steering angle"] },
{ label: "bank-specific fuel trim", words: ["fuel trim", "bank 1", "bank 2", "restricted injector", "o2 sensor", "upstream o2"] },
];

for (const rule of rules) {
if (rule.words.some((word) => combined.includes(word))) {
signals.push(rule.label);
}
}

if (extracted.signals.overheating && !coolingDenied) {
signals.push("critical overheating behavior");
}

if (extracted.signals.smoke && extracted.signals.fuel_smell) {
signals.push("raw fuel combustion failure");
}

if (extracted.signals.vibration && extracted.signals.load_sensitive) {
signals.push("load-sensitive drivetrain behavior");
}

if (ignitionFuelLock.locked || smokeFuelLock.locked) {
signals.push("cooling-system drift suppressed unless overheating/coolant evidence is confirmed");
}

return [...new Set(signals)];
}

export function detectComplexity(issue, dominantSignals, answers) {
const text = buildCombinedText(issue, answers);
const signalCount = Array.isArray(dominantSignals) ? dominantSignals.length : 0;

const ignitionFuelLock = buildIgnitionFuelDominance(text);
const smokeFuelLock = buildSmokeFuelDominance(text);
const noStartLock = buildNoStartDominance(text);
const brakeLock = buildBrakeDominance(text);
const overheatLock = buildOverheatDominance(text);

if (isAdvancedCase(text)) {
return {
level: "advanced technician diagnostic case",
minimumQuestions: 3,
reason: "advanced diagnostic cases need three focused technical questions before final analysis",
};
}

if (ignitionFuelLock.locked || smokeFuelLock.locked) {
return {
level: "dominant combustion / fuel failure path",
minimumQuestions: 2,
reason: "strong fuel, smoke, misfire, or load-sensitive behavior creates a dominant combustion failure path",
};
}

if (noStartLock.locked) {
return {
level: "starting system diagnostic case",
minimumQuestions: 2,
reason: "no-start cases need crank/no-crank separation before final analysis",
};
}

if (brakeLock.locked || overheatLock.locked) {
return {
level: "safety-sensitive system case",
minimumQuestions: 2,
reason: "brake or overheating cases need fast safety-focused narrowing",
};
}

if (isSimpleLowRisk(text) && signalCount === 0) {
return {
level: "simple low-risk symptom",
minimumQuestions: 2,
reason: "simple issue still needs two confirmation questions for a useful report",
};
}

if (isSafetySensitive(text) || signalCount >= 2) {
return {
level: "safety-sensitive or multi-signal case",
minimumQuestions: 2,
reason: "strong symptoms need focused diagnostic narrowing before final report",
};
}

return {
level: "standard symptom",
minimumQuestions: 2,
reason: "standard issue needs two useful narrowing questions",
};
}

export function detectDiagnosticReadiness(issue, answers, dominantSignals, complexity) {
const answerCount = countUserAnswers(answers);
const text = buildCombinedText(issue, answers);

// الفرض الصارم لنظام السؤالين:
// الحد الأدنى الافتراضي هو 2، وللحالات المتقدمة 3.
let minimumQuestions = 2;

if (isAdvancedCase(text) || (complexity && complexity.minimumQuestions > 2)) {
minimumQuestions = 3;
}

const hasFlowControl = Array.isArray(answers)
? answers.some((a) =>
String(a?.question || "")
.toLowerCase()
.includes("driveshift flow control")
)
: false;

// التعليل البرمجي للجاهزية
const reason = answerCount < minimumQuestions
? `System requires ${minimumQuestions} answers to lock diagnostic direction. Currently at ${answerCount}.`
: "Sufficient diagnostic data captured for forensic analysis.";

return {
minimumQuestions,
// لا يسمح بالتحليل أبداً إلا إذا تحقق شرط عدد الإجابات
readyForAnalysis: hasFlowControl || answerCount >= minimumQuestions,
reason,
};
}

export function buildDiagnosticContext(issue, answers = []) {
const combined = buildCombinedText(issue, answers);
const extracted = extractSignals(combined);

const ignitionFuelLock = buildIgnitionFuelDominance(combined);
const smokeFuelLock = buildSmokeFuelDominance(combined);
const noStartLock = buildNoStartDominance(combined);
const vibrationLock = buildVibrationDominance(combined);
const brakeLock = buildBrakeDominance(combined);
const overheatLock = buildOverheatDominance(combined);

const dominantSignals = detectDominantSignals(issue, answers);
const complexity = detectComplexity(issue, dominantSignals, answers);

const readiness = detectDiagnosticReadiness(
issue,
answers,
dominantSignals,
complexity
);

const dominantLock = buildDominantLock({
extracted_signals: extracted.signals,
dominant_systems: extracted.dominant_systems,
severity: extracted.severity,
risk_flags: extracted.risk_flags,
dominant_signals: dominantSignals,
raw_input: combined,
});

const behaviorReasoning = buildBehaviorReasoning({
raw_input: combined,
extracted_signals: extracted.signals,
dominant_lock: dominantLock,
});

const mechanicalPrioritization = buildMechanicalPrioritization({
raw_input: combined,
extracted_signals: extracted.signals,
dominant_systems: extracted.dominant_systems,
severity: extracted.severity,
risk_flags: extracted.risk_flags,
dominant_signals: dominantSignals,
dominant_lock: dominantLock,
behavior_reasoning: behaviorReasoning,
});

return {
raw_input: combined,
extracted_signals: extracted.signals,
dominant_systems: extracted.dominant_systems,
severity: extracted.severity,
risk_flags: extracted.risk_flags,
dominant_signals: dominantSignals,
complexity,
readiness,
dominant_lock: dominantLock,
behavior_reasoning: behaviorReasoning,
mechanical_prioritization: mechanicalPrioritization,
ignition_fuel_dominance: ignitionFuelLock,
smoke_fuel_dominance: smokeFuelLock,
no_start_dominance: noStartLock,
vibration_dominance: vibrationLock,
brake_dominance: brakeLock,
overheat_dominance: overheatLock,
};
}

export function includesAny(text, words) {
return words.some((w) => String(text || "").toLowerCase().includes(w));
}

export function clamp(value, min, max) {
return Math.max(min, Math.min(max, value));
}

function buildCombinedText(issue, answers) {
return [
String(issue || ""),
...(Array.isArray(answers)
? answers.map((a) => `${a?.question || ""} ${a?.answer || ""}`)
: []),
]
.join(" ")
.toLowerCase();
}

function buildIgnitionFuelDominance(text) {
const raw = String(text || "").toLowerCase();

let ignitionFuelScore = 0;
let coolingScore = 0;

const hasFlashingCel = includesAny(raw, [
"flashing check engine",
"check engine light flashes",
"cel flashes",
"flashes briefly",
"flashing cel",
]);

const hasRichOrFuelSmell = includesAny(raw, [
"rich smell",
"smells rich",
"unburned fuel",
"raw fuel",
"fuel smell",
"gas smell",
"gasoline smell",
"smells like gas",
"strong fuel",
]);

const hasLoadSensitiveShake = includesAny(raw, [
"under load",
"heavy throttle",
"acceleration",
"accelerating",
"uphill",
"worse under acceleration",
"worse under load",
"shakes under acceleration",
"shaking under acceleration",
"rough under load",
"loses throttle response",
"loss of throttle response",
"hesitating",
]);

const hasMisfireBehavior = includesAny(raw, [
"misfire",
"shaking",
"engine shakes",
"rough idle",
"jerking",
"vibration",
]);

const hasWarmOnlyFailure = includesAny(raw, [
"after warming up",
"fully warms up",
"warm engine",
"when warm",
"after 20 minutes",
"after driving",
]);

const hasConfirmedOverheating = includesAny(raw, [
"overheating",
"overheats",
"temperature high",
"temp gauge rises",
"temperature gauge rises",
"steam",
"coolant loss",
"losing coolant",
"sweet smell",
"coolant smell",
]);

const hasCoolingNegation = includesAny(raw, [
"no overheating",
"temperature stays normal",
"temp stays normal",
"no coolant loss",
"no steam",
"no sweet smell",
]);

if (hasFlashingCel) ignitionFuelScore += 10;
if (hasRichOrFuelSmell) ignitionFuelScore += 8;
if (hasLoadSensitiveShake) ignitionFuelScore += 8;
if (hasMisfireBehavior) ignitionFuelScore += 6;
if (hasWarmOnlyFailure) ignitionFuelScore += 2;

if (hasConfirmedOverheating) coolingScore += 8;
if (hasCoolingNegation) coolingScore -= 8;

const locked =
ignitionFuelScore >= 16 &&
ignitionFuelScore >= coolingScore + 6;

const suppressCoolingBias =
locked &&
!hasConfirmedOverheating &&
hasCoolingNegation;

return {
locked,
dominant_system: locked ? "ignition_fuel_combustion_failure" : "undetermined",
ignition_fuel_score: ignitionFuelScore,
cooling_score: coolingScore,
suppressCoolingBias,
evidence: {
hasFlashingCel,
hasRichOrFuelSmell,
hasLoadSensitiveShake,
hasMisfireBehavior,
hasWarmOnlyFailure,
hasConfirmedOverheating,
hasCoolingNegation,
},
mechanic_rule: locked
? "Do not route this case toward cooling system unless overheating, coolant loss, steam, or sweet coolant smell is confirmed. Prioritize ignition breakdown under cylinder pressure, injector leakage, fuel control error, coil/plug failure, and misfire under load."
: "No ignition/fuel dominance lock applied.",
};
}

function buildSmokeFuelDominance(text) {
const raw = String(text || "").toLowerCase();

let score = 0;

const hasBlackSmoke = includesAny(raw, ["black smoke", "dark smoke", "humo negro"]);
const hasFuelSmell = includesAny(raw, [
"fuel smell",
"gas smell",
"gasoline smell",
"raw fuel",
"smells like gas",
"strong fuel",
"unburned fuel",
]);
const hasMisfire = includesAny(raw, ["misfire", "rough", "shaking", "jerking"]);
const hasPowerLoss = includesAny(raw, ["loss of power", "loses power", "weak acceleration", "hesitating"]);
const hasNoOverheat = includesAny(raw, ["no overheating", "temperature normal", "temp stays normal"]);

if (hasBlackSmoke) score += 10;
if (hasFuelSmell) score += 10;
if (hasMisfire) score += 4;
if (hasPowerLoss) score += 4;
if (hasNoOverheat) score += 2;

const locked = score >= 12;

return {
locked,
score,
dominant_system: locked ? "rich_combustion_or_raw_fuel_exhaust" : "undetermined",
evidence: {
hasBlackSmoke,
hasFuelSmell,
hasMisfire,
hasPowerLoss,
hasNoOverheat,
},
mechanic_rule: locked
? "Black smoke or raw fuel smell must keep diagnosis on rich mixture, injector leakage, fuel control, ignition burn failure, or fuel pressure regulation before vacuum leak or cooling theories."
: "No smoke/fuel dominance lock applied.",
};
}

function buildNoStartDominance(text) {
const raw = String(text || "").toLowerCase();

const hasNoStart = includesAny(raw, [
"won't start",
"will not start",
"does not start",
"doesn't start",
"no start",
"hard start",
"cranks but won't start",
"cranks but does not start",
]);

const hasNoCrank = includesAny(raw, [
"no crank",
"does not crank",
"doesn't crank",
"no sound",
"nothing happens",
"only clicks",
"starter clicks",
"single click",
]);

const hasCrank = includesAny(raw, [
"cranks",
"crank normally",
"engine turns over",
"turns over",
]);

const locked = hasNoStart || hasNoCrank || hasCrank;

let label = "starting system issue";
if (hasNoCrank) label = "no-crank electrical / starter authorization path";
if (hasCrank && hasNoStart) label = "crank-no-start fuel / ignition / signal path";

return {
locked,
label,
evidence: {
hasNoStart,
hasNoCrank,
hasCrank,
},
mechanic_rule: locked
? "No-start diagnosis must first separate no-crank electrical/starter/security from crank-no-start fuel, spark, compression, and crank/cam signal."
: "No no-start dominance lock applied.",
};
}

function buildVibrationDominance(text) {
const raw = String(text || "").toLowerCase();

const hasVibration = includesAny(raw, [
"vibration",
"vibrate",
"vibrates",
"shake",
"shakes",
"shaking",
"wobble",
"wobbles",
]);

const hasHighway = includesAny(raw, [
"highway",
"freeway",
"interstate",
"at speed",
"high speed",
"60 mph",
"65 mph",
"70 mph",
]);

const hasBraking = includesAny(raw, ["brake", "braking", "pedal"]);
const hasAcceleration = includesAny(raw, ["accelerating", "acceleration", "under load", "uphill"]);
const hasIdle = includesAny(raw, ["idle", "park", "neutral"]);

let label = "vibration diagnostic path";
if (hasHighway && !hasBraking) label = "speed-related tire / wheel / driveline vibration path";
if (hasBraking) label = "brake pulsation / rotor / caliper vibration path";
if (hasAcceleration) label = "load-related engine mount / axle / driveline vibration path";
if (hasIdle) label = "idle vibration / misfire / mount path";

return {
locked: hasVibration,
label,
evidence: {
hasVibration,
hasHighway,
hasBraking,
hasAcceleration,
hasIdle,
},
mechanic_rule: hasVibration
? "Vibration diagnosis must split by when it appears and where it is felt: steering wheel, seat/floor, pedal, acceleration, braking, coasting, or idle."
: "No vibration dominance lock applied.",
};
}

function buildBrakeDominance(text) {
const raw = String(text || "").toLowerCase();

const hasBrake = includesAny(raw, [
"brake",
"brakes",
"braking",
"brake pedal",
"pedal goes to floor",
"soft pedal",
"hard pedal",
"grinding brakes",
"abs",
]);

const criticalBrake = includesAny(raw, [
"no brakes",
"pedal goes to floor",
"brake fluid leak",
"red brake light",
"grinding brakes",
]);

return {
locked: hasBrake,
critical: criticalBrake,
evidence: {
hasBrake,
criticalBrake,
},
mechanic_rule: hasBrake
? "Brake symptoms must be treated as safety-sensitive and separated by pedal feel, hydraulic integrity, rotor runout, ABS activity, and friction material condition."
: "No brake dominance lock applied.",
};
}

function buildOverheatDominance(text) {
const raw = String(text || "").toLowerCase();

const hasOverheat = includesAny(raw, [
"overheat",
"overheating",
"temperature high",
"temp gauge rises",
"temperature gauge rises",
"steam",
"coolant loss",
"losing coolant",
"boiling coolant",
]);

const denied = includesAny(raw, [
"no overheating",
"temperature normal",
"temperature stays normal",
"temp stays normal",
"no coolant loss",
"no steam",
]);

return {
locked: hasOverheat && !denied,
denied,
evidence: {
hasOverheat,
denied,
},
mechanic_rule: hasOverheat && !denied
? "Overheating must be separated by coolant loss, fan/airflow, thermostat/flow, pressure cap, radiator restriction, water pump, and combustion gas intrusion."
: "No active overheating lock applied.",
};
}

function isSafetySensitive(text) {
return includesAny(text, [
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
"flashing check engine",
"check engine light flashes",
"loss of power",
"loses power",
]);
}

function isAdvancedCase(text) {
return includesAny(text, [
"oscilloscope",
"signal clipping",
"60 ohms",
"u-code",
"u codes",
"can bus",
"fuel trims",
"fuel trim",
"bank 1",
"bank 2",
"atf temperature",
"solenoid resistance",
"valve body",
"clutch pack",
"torque sensor",
"zero-point reset",
"hydraulic lifter",
"wrist pin",
"oil pressure readings",
"injector balance",
"smoke test",
"upstream o2",
]);
}

function isSimpleLowRisk(text) {
return includesAny(text, [
"maintenance",
"oil change",
"tire pressure",
"wiper",
"washer fluid",
"light bulb",
"gas cap",
]);
}
