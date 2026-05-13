import { extractSignals } from "./signal-extractor.js";
import { buildDominantLock } from "./dominant-lock-engine.js";
import { buildBehaviorReasoning } from "./behavior-reasoning-engine.js";

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
  const signals = [];

  const rules = [
    { label: "black smoke / rich running", words: ["black smoke", "dark smoke", "running rich"] },
    { label: "fuel smell / raw fuel", words: ["fuel smell", "gas smell", "raw fuel", "smells like gas", "gasoline smell", "strong fuel"] },
    { label: "misfire / shaking", words: ["misfire", "rough under load", "engine feels rough", "rough idle", "shaking", "vibration", "jerking"] },
    { label: "severe power loss", words: ["loss of power", "loses power", "no power", "limp mode", "won't accelerate", "weak acceleration", "hesitating"] },
    { label: "flashing check engine", words: ["flashing check engine", "check engine light flashes", "cel flashes", "flashes briefly"] },
    { label: "overheating / cooling risk", words: ["overheat", "overheating", "temperature high", "temp gauge", "steam", "coolant"] },
    { label: "burning smell / smoke safety risk", words: ["burning smell", "smells burnt", "burnt smell", "smoke from engine", "electrical burning"] },
    { label: "brake safety risk", words: ["brake", "brakes", "low brake pedal", "soft brake pedal", "brake fluid", "grinding brakes"] },
    { label: "stalling while driving", words: ["stall while driving", "dies while driving", "shuts off while driving"] },
    { label: "turbo / boost issue", words: ["turbo", "boost", "whistle", "underboost", "boost leak"] },
    { label: "electrical / charging issue", words: ["battery light", "alternator", "charging", "electrical", "no crank"] },
    { label: "oil pressure risk", words: ["oil pressure", "red oil light", "oil light"] },
    { label: "transmission / drivability issue", words: ["transmission", "gear", "shifting", "slipping", "hard shift", "flared"] },
    { label: "starting system issue", words: ["won't start", "will not start", "does not start", "doesn't start", "no start", "no crank", "starter clicks"] },
    { label: "check engine light", words: ["check engine", "engine light", "cel", "service engine"] },
    { label: "CAN / module communication", words: ["can bus", "u-code", "u code", "module offline", "no communication", "60 ohms", "oscilloscope"] },
    { label: "SRS / airbag", words: ["airbag", "srs"] },
    { label: "EPS / steering calibration", words: ["eps", "steering rack", "torque sensor", "zero-point reset"] },
    { label: "bank-specific fuel trim", words: ["fuel trim", "bank 1", "bank 2", "restricted injector", "o2 sensor"] },
  ];

  for (const rule of rules) {
    if (rule.words.some((word) => combined.includes(word))) {
      signals.push(rule.label);
    }
  }

  if (extracted.signals.overheating) signals.push("critical overheating behavior");
  if (extracted.signals.smoke && extracted.signals.fuel_smell) signals.push("raw fuel combustion failure");
  if (extracted.signals.vibration && extracted.signals.load_sensitive) signals.push("load-sensitive drivetrain behavior");

  return [...new Set(signals)];
}

export function detectComplexity(issue, dominantSignals, answers) {
  const text = buildCombinedText(issue, answers);
  const signalCount = Array.isArray(dominantSignals) ? dominantSignals.length : 0;

  if (isAdvancedCase(text)) {
    return {
      level: "advanced technician diagnostic case",
      minimumQuestions: 3,
      reason: "advanced diagnostic cases need three focused technical questions before final analysis",
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
      minimumQuestions: 3,
      reason: "strong symptoms need three focused diagnostic questions before final analysis",
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

  let minimumQuestions = complexity?.minimumQuestions || 2;
  let reason = complexity?.reason || "standard diagnostic flow";

  const strongSignals = [
    "misfire",
    "rough under load",
    "engine feels rough",
    "loss of power",
    "loses power",
    "hesitating",
    "flashing check engine",
    "check engine light flashes",
    "brake",
    "overheating",
    "coolant",
    "burning smell",
    "oil pressure",
    "airbag",
    "srs",
    "can bus",
    "u-code",
    "u code",
    "transmission",
    "flared",
    "eps",
    "steering rack",
    "fuel trim",
  ];

  const hasStrongSignal = includesAny(text, strongSignals);

  const hasObviousFuelPattern =
    includesAny(text, ["black smoke"]) &&
    includesAny(text, ["fuel smell", "gas smell", "raw fuel", "smells like gas"]);

  const hasFlowControl = Array.isArray(answers)
    ? answers.some((a) =>
        String(a?.question || "")
          .toLowerCase()
          .includes("driveshift flow control")
      )
    : false;

  if (hasObviousFuelPattern) {
    minimumQuestions = 3;
    reason = "black smoke plus fuel smell needs fuel, ignition, and load separation";
  }

  if (isAdvancedCase(text)) {
    minimumQuestions = 3;
    reason = "advanced technician-level input needs three technical narrowing questions";
  }

  if (hasStrongSignal) {
    minimumQuestions = Math.max(minimumQuestions, 3);
    reason = "strong diagnostic signals need a real multi-step flow before final report";
  }

  minimumQuestions = clamp(minimumQuestions, 2, 3);

  return {
    minimumQuestions,
    readyForAnalysis: hasFlowControl || answerCount >= minimumQuestions,
    reason,
  };
}

export function buildDiagnosticContext(issue, answers = []) {
  const combined = buildCombinedText(issue, answers);
  const extracted = extractSignals(combined);

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
