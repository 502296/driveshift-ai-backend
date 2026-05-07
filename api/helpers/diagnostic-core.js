export function countUserAnswers(answers) {
  if (!Array.isArray(answers)) return 0;

  return answers.filter((item) => {
    const answer = String(item?.answer || "").trim();
    const question = String(item?.question || "").toLowerCase();

    if (!answer) return false;
    if (question.includes("vehicle profile")) return false;

    return true;
  }).length;
}

export function detectDominantSignals(issue, answers) {
  const combined = [
    String(issue || ""),
    ...(Array.isArray(answers)
      ? answers.map((a) => `${a?.question || ""} ${a?.answer || ""}`)
      : []),
  ]
    .join(" ")
    .toLowerCase();

  const rules = [
    { label: "black smoke / rich running", words: ["black smoke", "dark smoke", "rich", "running rich"] },
    { label: "fuel smell / raw fuel", words: ["fuel smell", "gas smell", "raw fuel", "smells like gas", "gasoline smell", "strong fuel"] },
    { label: "overheating / cooling risk", words: ["overheat", "overheating", "temperature high", "temp gauge", "steam", "coolant"] },
    { label: "burning smell / smoke safety risk", words: ["burning smell", "smells burnt", "burnt smell", "smoke from engine", "electrical burning"] },
    { label: "brake safety risk", words: ["brake", "brakes", "low brake pedal", "soft brake pedal", "brake fluid", "grinding brakes"] },
    { label: "stalling while driving", words: ["stall while driving", "dies while driving", "shuts off while driving"] },
    { label: "severe power loss", words: ["loss of power", "no power", "limp mode", "won't accelerate", "slow acceleration", "weak acceleration"] },
    { label: "misfire / shaking", words: ["misfire", "shaking", "rough idle", "vibration", "jerking", "shakes at idle"] },
    { label: "turbo / boost issue", words: ["turbo", "boost", "whistle", "underboost", "boost leak"] },
    { label: "electrical / charging issue", words: ["battery light", "alternator", "charging", "electrical", "no crank"] },
    { label: "oil pressure risk", words: ["oil pressure", "red oil light", "oil light"] },
    { label: "transmission / drivability issue", words: ["transmission", "gear", "shifting", "slipping", "hard shift"] },
    { label: "starting system issue", words: ["no start", "won't start", "does not start", "crank", "starter"] },
    { label: "check engine light", words: ["check engine", "engine light", "cel", "service engine"] },
  ];

  const signals = [];

  for (const rule of rules) {
    if (rule.words.some((word) => combined.includes(word))) {
      signals.push(rule.label);
    }
  }

  return [...new Set(signals)];
}

export function detectComplexity(issue, dominantSignals, answers) {
  const text = [
    String(issue || ""),
    ...(Array.isArray(answers)
      ? answers.map((a) => `${a?.question || ""} ${a?.answer || ""}`)
      : []),
  ]
    .join(" ")
    .toLowerCase();

  const signalCount = Array.isArray(dominantSignals) ? dominantSignals.length : 0;

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
    "flashing check engine",
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

  const isHighRisk = highRiskWords.some((w) => text.includes(w));
  const isSimple = simpleWords.some((w) => text.includes(w));

  if (isSimple && !isHighRisk && signalCount === 0) {
    return {
      level: "simple low-risk symptom",
      minimumQuestions: 1,
      reason: "simple issue needs only one confirmation question",
    };
  }

  if (isHighRisk || signalCount >= 2) {
    return {
      level: "safety-sensitive or multi-signal case",
      minimumQuestions: 3,
      reason: "strong symptoms need up to three focused diagnostic questions",
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

  const text = [
    String(issue || ""),
    ...(Array.isArray(answers)
      ? answers.map((a) => `${a?.question || ""} ${a?.answer || ""}`)
      : []),
  ]
    .join(" ")
    .toLowerCase();

  let minimumQuestions = complexity?.minimumQuestions || 2;
  let reason = complexity?.reason || "standard diagnostic flow";

  const hasObviousPattern =
    includesAny(text, ["black smoke"]) &&
    includesAny(text, ["fuel smell", "gas smell", "raw fuel", "smells like gas"]);

  const hasDangerPattern = includesAny(text, [
    "red oil light",
    "oil pressure",
    "overheating",
    "steam",
    "brake fluid leak",
    "no brakes",
    "burning smell",
    "electrical burning",
  ]);

  if (hasObviousPattern) {
    minimumQuestions = 2;
    reason = "black smoke plus fuel smell creates a strong dominant fuel pattern";
  }

  if (hasDangerPattern) {
    minimumQuestions = 2;
    reason = "safety-sensitive symptom should move to analysis quickly";
  }

  minimumQuestions = clamp(minimumQuestions, 1, 3);

  return {
    minimumQuestions,
    readyForAnalysis: answerCount >= minimumQuestions,
    reason,
  };
}

export function includesAny(text, words) {
  return words.some((w) => String(text || "").toLowerCase().includes(w));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
