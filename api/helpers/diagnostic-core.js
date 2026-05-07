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

  const signals = [];

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

  for (const rule of rules) {
    if (rule.words.some((word) => combined.includes(word))) {
      signals.push(rule.label);
    }
  }

  return [...new Set(signals)];
}

export function detectComplexity(issue, dominantSignals, answers) {
  const text = String(issue || "").toLowerCase();
  const answerText = Array.isArray(answers)
    ? answers.map((a) => `${a?.question || ""} ${a?.answer || ""}`).join(" ").toLowerCase()
    : "";

  const allText = `${text} ${answerText}`;
  const signalCount = Array.isArray(dominantSignals) ? dominantSignals.length : 0;

  const highRiskWords = [
    "smoke", "burning", "overheat", "overheating", "brake", "oil pressure",
    "airbag", "srs", "stall", "dies while driving", "red warning",
    "fuel smell", "gas smell", "raw fuel", "no brakes", "steering locked",
    "flashing check engine",
  ];

  const complexWords = [
    "ac", "a/c", "air conditioning", "compressor", "cuts out", "intermittent",
    "module", "airbag", "srs", "water", "leak", "roof", "sunroof",
    "electrical", "misfire", "transmission", "overheating", "stall", "dies",
    "shakes", "vibration", "turbo", "boost", "black smoke", "whistle",
    "semi", "truck",
  ];

  const simpleWords = [
    "maintenance", "oil change", "tire pressure", "wiper", "washer fluid",
    "light bulb", "gas cap",
  ];

  const isHighRiskWord = highRiskWords.some((w) => allText.includes(w));
  const isComplexWord = complexWords.some((w) => allText.includes(w));
  const isSimpleWord = simpleWords.some((w) => allText.includes(w));

  if (isSimpleWord && !isHighRiskWord && signalCount === 0) {
    return {
      level: "simple low-risk symptom",
      minimumQuestions: 3,
      reason: "simple issue, but DriveShift still asks a few useful questions",
    };
  }

  if (signalCount >= 4) {
    return {
      level: "very high complexity multi-signal case",
      minimumQuestions: 6,
      reason: "multiple dominant symptoms need deeper narrowing",
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
      minimumQuestions: 5,
      reason: "safety-sensitive symptoms require controlled questioning",
    };
  }

  if (isComplexWord || signalCount === 1) {
    return {
      level: "complex symptom",
      minimumQuestions: 4,
      reason: "the issue needs targeted mechanic questions",
    };
  }

  return {
    level: "standard symptom",
    minimumQuestions: 3,
    reason: "standard issue with three useful narrowing questions",
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

  const hasFuel = includesAny(text, ["fuel smell", "gas smell", "raw fuel", "strong fuel", "smells like gas"]);
  const hasSmoke = includesAny(text, ["black smoke", "dark smoke", "smoke"]);
  const hasRoughIdle = includesAny(text, ["rough idle", "shakes at idle", "shaking", "idle"]);
  const hasMisfire = includesAny(text, ["misfire", "flashing", "check engine"]);
  const hasWeakPower = includesAny(text, ["weak", "loss of power", "no power", "won't accelerate"]);
  const hasOverheat = includesAny(text, ["overheat", "overheating", "steam", "coolant"]);
  const hasNoStart = includesAny(text, ["no start", "won't start", "click", "crank"]);
  const hasBrake = includesAny(text, ["brake", "pedal", "grinding brakes", "brake fluid"]);

  let minimumQuestions = complexity.minimumQuestions;
  let readyForAnalysis = false;
  let reason = complexity.reason;

  if (hasFuel && hasRoughIdle) {
    minimumQuestions = Math.max(minimumQuestions, 4);
    reason = "fuel smell plus rough idle needs fuel and ignition separation";
  }

  if ((hasSmoke && hasFuel) || (hasSmoke && hasWeakPower)) {
    minimumQuestions = Math.max(minimumQuestions, 5);
    reason = "smoke plus fuel or power loss is a high-priority pattern";
  }

  if (hasOverheat) {
    minimumQuestions = Math.max(minimumQuestions, 5);
    reason = "overheating needs safety and cooling-system context";
  }

  if (hasNoStart) {
    minimumQuestions = Math.max(minimumQuestions, 4);
    reason = "no-start cases need crank/click/power/fuel separation";
  }

  if (hasBrake) {
    minimumQuestions = Math.max(minimumQuestions, 5);
    reason = "brake symptoms require safety-controlled questioning";
  }

  if (hasMisfire && hasRoughIdle) {
    minimumQuestions = Math.max(minimumQuestions, 4);
    reason = "rough idle plus misfire/check-engine context needs targeted narrowing";
  }

  if (answerCount >= minimumQuestions) {
    readyForAnalysis = true;
  }

  minimumQuestions = clamp(minimumQuestions, 3, 6);

  return {
    minimumQuestions,
    readyForAnalysis,
    reason,
  };
}

export function includesAny(text, words) {
  return words.some((w) => String(text || "").includes(w));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
