// DriveShift Behavior Reasoning Engine v1.1 - [INTELLIGENCE EVOLUTION UPDATE]
// Purpose:
// Understand how the failure behaves over time and REFINES diagnosis after the final report.
// Added: Post-diagnostic refinement logic for "Ask AI" feature.

function textIncludes(raw = "", words = []) {
const text = String(raw || "").toLowerCase();
return words.some((word) => text.includes(String(word).toLowerCase()));
}

function addBehavior(list, item) {
if (!item?.key) return;
if (!list.some((x) => x.key === item.key)) {
list.push(item);
}
}

// --- START: NEW REFINEMENT LOGIC (ASK AI FEATURE) ---
/**
* Detects if the user is providing repair history or technical measurement updates
* to refine the existing diagnosis instead of starting over.
*/
function detectRefinementBehavior(rawInput = "", context = {}) {
const refinements = [];

// 1. Repair History / Part Replacement (The "I already replaced..." logic)
if (textIncludes(rawInput, ["replaced", "changed", "new part", "already did", "fixed that", "swapped"])) {
addBehavior(refinements, {
key: "repair_history_update",
label: "Repair History Refinement",
meaning: "The user has already attempted repairs on specific components.",
diagnostic_value: "Crucial: This eliminates primary suspects and forces the logic into second-tier diagnostics (wiring, modules, or deep mechanical failure).",
follow_up_priority: "Pivot away from the replaced part and check its control circuit or related sensors."
});
}

// 2. Technical Data Injection (The "Mechanic Mode" detector)
if (textIncludes(rawInput, ["ohm", "volt", "multimeter", "oscilloscope", "psi", "bar", "trim", "duty cycle", "ms", "resistance"])) {
addBehavior(refinements, {
key: "technical_data_refinement",
label: "Technical Measurement Data",
meaning: "The user is providing actual measurements instead of just symptoms.",
diagnostic_value: "High: Shift reasoning from 'possibility' to 'hard data verification'.",
follow_up_priority: "Compare the provided value against standard operating specs for this system."
});
}

// 3. Disagreement/Alternative Theory
if (textIncludes(rawInput, ["don't think so", "not sure if", "could it be", "what about", "are you sure"])) {
addBehavior(refinements, {
key: "hypothesis_pivot",
label: "Diagnostic Pivot Request",
meaning: "The user is challenging the current theory or suggesting another direction.",
diagnostic_value: "Medium: Requires re-evaluating the current dominant lock and explaining why it was chosen or exploring the alternative.",
follow_up_priority: "Explain the link between the symptoms and the user's proposed theory."
});
}

return refinements;
}
// --- END: NEW REFINEMENT LOGIC ---

function detectTimeAndTemperatureBehavior(rawInput = "", signals = {}) {
const behaviors = [];
if (
signals.heat_related ||
textIncludes(rawInput, [
"when hot", "after warming up", "after warm up", "after driving",
"after 10 minutes", "after 15 minutes", "after 20 minutes", "after 30 minutes",
"only when warm", "heat soaked", "hot restart", "starts again after cooling", "works when cold",
])
) {
addBehavior(behaviors, {
key: "thermal_failure_pattern",
label: "Thermal failure pattern",
meaning: "The symptom changes after heat builds up.",
diagnostic_value: "High value because heat-related failures separate electrical breakdown from static faults.",
follow_up_priority: "Ask whether the symptom improves after the vehicle cools down.",
});
}

if (textIncludes(rawInput, ["cold start", "only cold", "first start", "morning start", "starts rough cold", "cold idle"])) {
addBehavior(behaviors, {
key: "cold_start_pattern",
label: "Cold-start pattern",
meaning: "The failure is strongest before the engine reaches operating temperature.",
diagnostic_value: "Useful for fuel enrichment and vacuum leak separation.",
follow_up_priority: "Ask if the symptom disappears once the engine warms up.",
});
}
return behaviors;
}

function detectLoadBehavior(rawInput = "", signals = {}) {
const behaviors = [];
if (
signals.load_sensitive ||
textIncludes(rawInput, [
"under load", "uphill", "going uphill", "when accelerating", "during acceleration",
"hard acceleration", "wide open throttle", "passing", "merging", "higher rpm",
"heavy throttle", "towing", "with ac on",
])
) {
addBehavior(behaviors, {
key: "load_sensitive_failure",
label: "Load-sensitive failure",
meaning: "The symptom becomes worse when producing more torque.",
diagnostic_value: "Very high: exposes weak ignition, fuel restriction, or transmission slip.",
follow_up_priority: "Ask whether the symptom disappears when releasing the throttle.",
});
}

if (textIncludes(rawInput, ["loses power uphill", "bogs uphill", "no power uphill", "shakes uphill", "worse uphill"])) {
addBehavior(behaviors, {
key: "grade_load_dependency",
label: "Uphill / grade-load dependency",
meaning: "The issue appears against road grade.",
diagnostic_value: "Separates powertrain load from road-speed vibration.",
follow_up_priority: "Ask if RPM rises while vehicle speed struggles.",
});
}
return behaviors;
}

function detectSpeedRpmBehavior(rawInput = "") {
const behaviors = [];
if (textIncludes(rawInput, ["highway speed", "at 40 mph", "at 50 mph", "at 60 mph", "at 70 mph", "only at speed", "specific speed", "above 40", "above 50", "above 60"])) {
addBehavior(behaviors, {
key: "vehicle_speed_dependency",
label: "Vehicle-speed dependency",
meaning: "Symptom follows road speed.",
diagnostic_value: "Separates tires/bearings from engine behavior.",
follow_up_priority: "Ask if symptom changes in Neutral at speed.",
});
}

if (textIncludes(rawInput, ["rpm", "higher rpm", "low rpm", "around 2000 rpm", "around 3000 rpm", "revving", "rev", "engine speed"])) {
addBehavior(behaviors, {
key: "engine_rpm_dependency",
label: "Engine-RPM dependency",
meaning: "Symptom follows engine speed.",
diagnostic_value: "Separates misfire/accessories from road-speed vibration.",
follow_up_priority: "Ask if symptom happens in Park/Neutral when revving.",
});
}
return behaviors;
}

function detectBrakeBehavior(rawInput = "", signals = {}) {
const behaviors = [];
if (signals.braking_issue || textIncludes(rawInput, ["when braking", "while braking", "brake vibration", "brake shake", "pedal pulsation", "steering wheel shakes when braking", "grinding brakes", "soft brake pedal", "low brake pedal"])) {
addBehavior(behaviors, {
key: "braking_only_pattern",
label: "Braking-only pattern",
meaning: "Symptom tied to braking force.",
diagnostic_value: "High safety value: separates rotor/pad issues from tires/suspension.",
follow_up_priority: "Ask if steering shakes or pedal pulses.",
});
}
return behaviors;
}

function detectIdleStartupBehavior(rawInput = "", signals = {}) {
const behaviors = [];
if (signals.rough_idle || textIncludes(rawInput, ["rough idle", "idle rough", "shakes at idle", "misfire at idle", "unstable idle", "idle drops", "almost stalls at idle"])) {
addBehavior(behaviors, {
key: "idle_quality_pattern",
label: "Idle-quality pattern",
meaning: "Issue visible without road load.",
diagnostic_value: "Useful for vacuum leaks, throttle body, or engine mounts.",
follow_up_priority: "Ask if idle smooths out when RPM is raised.",
});
}

if (signals.startup_issue || textIncludes(rawInput, ["won't start", "no start", "crank no start", "no crank", "starter clicks", "long crank", "hard start", "starts then dies"])) {
addBehavior(behaviors, {
key: "starting_sequence_pattern",
label: "Starting-sequence pattern",
meaning: "Distinguishing starting behaviors.",
diagnostic_value: "Very high: each starting pattern points to a different system.",
follow_up_priority: "Ask if engine cranks normally or only clicks.",
});
}
return behaviors;
}

function detectIntermittentProgression(rawInput = "", signals = {}) {
const behaviors = [];
if (signals.intermittent || textIncludes(rawInput, ["sometimes", "randomly", "intermittent", "comes and goes"])) {
addBehavior(behaviors, {
key: "intermittent_failure_pattern",
label: "Intermittent failure pattern",
meaning: "Failure is not constant.",
diagnostic_value: "Fault involves heat, vibration, or wiring.",
follow_up_priority: "Ask what reliably triggers the symptom.",
});
}

if (textIncludes(rawInput, ["getting worse", "worse now", "progressively worse"])) {
addBehavior(behaviors, {
key: "progressive_failure_pattern",
label: "Progressive failure pattern",
meaning: "Fault worsening over time.",
diagnostic_value: "Identifies wear or thermal degradation.",
follow_up_priority: "Ask what changed first.",
});
}
return behaviors;
}

function detectSmokeSmellBehavior(rawInput = "", signals = {}) {
const behaviors = [];
if (signals.smoke || textIncludes(rawInput, ["smoke"])) {
addBehavior(behaviors, {
key: "exhaust_smoke_pattern",
label: "Exhaust smoke pattern",
meaning: "Smoke color/timing value.",
diagnostic_value: "Black (rich), Blue (oil), White (coolant).",
follow_up_priority: "Ask for smoke color and timing.",
});
}

if (signals.fuel_smell || textIncludes(rawInput, ["fuel smell", "gas smell", "raw fuel"])) {
addBehavior(behaviors, {
key: "fuel_odor_pattern",
label: "Fuel-odor pattern",
meaning: "Suggests leak or rich combustion.",
diagnostic_value: "Combines with fire risk awareness.",
follow_up_priority: "Ask where smell is strongest.",
});
}
return behaviors;
}

function buildBehaviorSummary(behaviors = []) {
const keys = behaviors.map((b) => b.key);

// New Refinement Summaries
if (keys.includes("repair_history_update")) {
return "The user provided repair history. The system must now pivot to deeper diagnostics and stop suggesting already-replaced components.";
}
if (keys.includes("technical_data_refinement")) {
return "Live technical data detected. The system should now prioritize hard measurements over symptom observation.";
}

if (keys.includes("thermal_failure_pattern") && keys.includes("load_sensitive_failure")) {
return "The symptom is both heat-related and load-sensitive, suggesting a thermal/mechanical stress pattern.";
}
if (keys.includes("braking_only_pattern")) {
return "The symptom is tied to braking force; prioritize brake safety separation.";
}
if (keys.includes("starting_sequence_pattern")) {
return "The starting behavior must be classified to separate fuel from electrical/cranking issues.";
}
if (behaviors.length > 0) {
return "Recognizable behavior patterns detected; proceed with behavior-based reasoning.";
}
return "No strong pattern detected yet; identify conditions where the symptom appears.";
}

function buildNextBestQuestionGoal(behaviors = [], dominantLock = {}) {
const keys = behaviors.map((b) => b.key);
const lockedSystem = dominantLock?.locked_system || "general";

// Post-Report Refinement Questions
if (keys.includes("repair_history_update")) {
return "Analyze the circuit or secondary systems related to the replaced part.";
}
if (keys.includes("technical_data_refinement")) {
return "Interpret the provided measurement against manufacturer specifications.";
}

if (keys.includes("thermal_failure_pattern")) return "Confirm if issue improves after cooling.";
if (keys.includes("load_sensitive_failure")) return "Confirm if symptom disappears when throttle is released.";
if (keys.includes("starting_sequence_pattern")) return "Separate no-crank from crank-no-start.";

if (lockedSystem === "transmission_drivetrain") return "Separate RPM flare from road-speed vibration.";
return "Ask a single high-value question to narrow system direction.";
}

function buildReasoningGuardrails(behaviors = [], dominantLock = {}) {
const guardrails = [
"Do not treat the user's symptom as a generic complaint. Preserve the strongest behavior pattern.",
"If a part was replaced, DO NOT suggest it as a primary cause in the next response."
];

if (dominantLock?.locked) {
guardrails.push(`Respect the locked direction: ${dominantLock.locked_title}.`);
}

for (const behavior of behaviors) {
guardrails.push(`${behavior.label}: ${behavior.diagnostic_value}`);
}

guardrails.push("Do not claim confirmed measurements unless provided.", "Ask only one follow-up question.");
return guardrails;
}

export function buildBehaviorReasoning(context = {}) {
const rawInput = context.raw_input || "";
const signals = context.extracted_signals || {};
const dominantLock = context.dominant_lock || {};

const behaviors = [
...detectTimeAndTemperatureBehavior(rawInput, signals),
...detectLoadBehavior(rawInput, signals),
...detectSpeedRpmBehavior(rawInput),
...detectBrakeBehavior(rawInput, signals),
...detectIdleStartupBehavior(rawInput, signals),
...detectIntermittentProgression(rawInput, signals),
...detectSmokeSmellBehavior(rawInput, signals),
...detectRefinementBehavior(rawInput, context), // New injection
];

const behaviorSummary = buildBehaviorSummary(behaviors);
const nextBestQuestionGoal = buildNextBestQuestionGoal(behaviors, dominantLock);

return {
detected_behaviors: behaviors,
behavior_summary: behaviorSummary,
next_best_question_goal: nextBestQuestionGoal,
reasoning_guardrails: buildReasoningGuardrails(behaviors, dominantLock),
mechanic_instruction:
"Use behavior evolution: prioritize repair history and technical measurements to refine existing diagnosis instead of restarting.",
};
}
