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
    const readiness = detectDiagnosticReadiness(
      safeIssue,
      answerList,
      dominantSignals,
      complexity
    );

    const minimumQuestions = hasObdCode ? 0 : readiness.minimumQuestions;
    const shouldAskFollowUp =
      !hasObdCode &&
      !readiness.readyForAnalysis &&
      realAnswerCount < minimumQuestions;

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
you ask focused diagnostic questions, preserve the strongest symptom direction, and stop asking once the pattern is clear.

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
${readiness.reason}

Required minimum answered questions before final report:
${minimumQuestions}

Current answered questions:
${realAnswerCount}

Current mode:
${shouldAskFollowUp ? "follow_up" : "analysis"}

Speed rule:
Respond quickly. Keep follow-up questions short. Keep final analysis concise but useful.

Critical diagnostic rules:
If black smoke, fuel smell, raw fuel smell, strong fuel odor, or rich running is present, keep overfueling, injector leak, fuel pressure, MAF/MAP data, oxygen sensor feedback, or ignition misfire with unburned fuel as higher priority than vacuum leak unless strong evidence says otherwise.
If overheating, coolant loss, steam, temperature gauge high, or red temperature warning is present, keep cooling-system risk high priority.
If burning smell, smoke from engine bay, oil smell, electrical burning, or brake smell is present, treat it as safety-sensitive.
If brake warning, low brake pedal, grinding brakes, or brake fluid leak is present, prioritize brake safety.
If stall while driving, severe power loss, red warning light, oil pressure light, or battery/charging warning while driving is present, clearly advise caution.
Do not let later minor symptoms override the strongest dangerous symptom.
Do not jump to exotic causes before simple high-probability checks.

Mechanic question strategy:
Ask only one question per turn.
Each question must separate likely causes.
Never repeat a question already asked.
Do not ask checklist-style questions.
Do not ask generic questions like "When does it happen?" if timing or context is already known.
Prefer questions that separate fuel, ignition, air/vacuum, sensor, cooling, charging, starter, transmission, or brake causes.
A good question should help choose between two or three mechanical causes.

Final decision rule:
If the pattern is already clear, stop asking and give analysis.
Do not keep asking only to satisfy a question count.
In analysis mode, never say "Still narrowing the issue."
In analysis mode, Answer options must be None.

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

Rules for analysis mode:
Give a professional diagnosis report.
Do not pretend certainty.
Give the most likely issue first.
Explain why it fits the user's symptoms.
Give practical next checks.
Give clear safety advice.
If multiple systems could be involved, mention the top 2 possibilities calmly.
Do not mention AI.
Do not say "as an AI".

Style:
Calm, practical, premium, human mechanic.
Short but useful.
No markdown.
No bullets.
No numbered lists.

Voice summary rules:
Voice summary must be one short natural mechanic sentence.

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
[if follow_up: four options. If analysis: None]

When to stop driving:
[clear safety advice]
`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2800);

    let response;
    let data;

    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.DRIVESHIFT_MODEL || "gpt-4o-mini",
          input: prompt,
          temperature: 0.05,
          max_output_tokens: shouldAskFollowUp ? 260 : 520,
        }),
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return res.status(200).json({
          result: buildFastLocalResult({
            lang,
            shouldAskFollowUp,
            issue: safeIssue,
            answers: answerList,
            dominantSignals,
            realAnswerCount,
            minimumQuestions,
          }),
        });
      }

      data = await response.json();
    } catch (_) {
      clearTimeout(timeout);

      return res.status(200).json({
        result: buildFastLocalResult({
          lang,
          shouldAskFollowUp,
          issue: safeIssue,
          answers: answerList,
          dominantSignals,
          realAnswerCount,
          minimumQuestions,
        }),
      });
    }

    let text = extractText(data).trim();

    if (!text) {
      return res.status(200).json({
        result: buildFastLocalResult({
          lang,
          shouldAskFollowUp,
          issue: safeIssue,
          answers: answerList,
          dominantSignals,
          realAnswerCount,
          minimumQuestions,
        }),
      });
    }

    text = normalizeStatusLine(text, shouldAskFollowUp);
    text = ensureRequiredFormat(text, lang, shouldAskFollowUp);
    text = enforceAnswerOptionCount(text, lang, shouldAskFollowUp);

    return res.status(200).json({ result: text });
  } catch (_) {
    return res.status(200).json({
      result: fallbackFollowUp("en"),
    });
  }
}

function buildFastLocalResult({
  lang,
  shouldAskFollowUp,
  issue,
  answers,
  dominantSignals,
  realAnswerCount,
  minimumQuestions,
}) {
  if (shouldAskFollowUp) {
    return buildFastFollowUp(lang, issue, answers, dominantSignals);
  }

  return buildFastAnalysis(lang, issue, dominantSignals, realAnswerCount, minimumQuestions);
}

function buildFastFollowUp(lang, issue, answers, dominantSignals) {
  const text = [
    String(issue || ""),
    ...(Array.isArray(answers)
      ? answers.map((a) => `${a?.question || ""} ${a?.answer || ""}`)
      : []),
  ]
    .join(" ")
    .toLowerCase();

  const asked = Array.isArray(answers)
    ? answers.map((a) => String(a?.question || "").toLowerCase()).join(" ")
    : "";

  const hasFuel = includesAny(text, ["fuel smell", "gas smell", "raw fuel", "smells like gas"]);
  const hasSmoke = includesAny(text, ["black smoke", "dark smoke", "smoke"]);
  const hasNoStart = includesAny(text, ["won't start", "no start", "does not start", "click", "crank"]);
  const hasOverheat = includesAny(text, ["overheat", "overheating", "coolant", "steam"]);
  const hasBrake = includesAny(text, ["brake", "pedal", "brake fluid", "grinding"]);
  const hasShake = includesAny(text, ["shake", "shaking", "rough idle", "vibration", "misfire"]);

  if (lang === "es") {
    if (hasNoStart && !asked.includes("crank")) {
      return followUpEs(
        "Necesito separar batería, starter o alimentación eléctrica.",
        "Cuando intentas encender, ¿el motor gira o solo hace click?",
        ["Gira normal", "Solo hace click", "No hace nada", "No sé"]
      );
    }

    if (hasOverheat && !asked.includes("coolant")) {
      return followUpEs(
        "Necesito confirmar si el sistema de enfriamiento está perdiendo refrigerante.",
        "¿Has notado pérdida de coolant, vapor o temperatura subiendo rápido?",
        ["Pierde coolant", "Sale vapor", "Sube rápido", "No sé"]
      );
    }

    if (hasBrake && !asked.includes("pedal")) {
      return followUpEs(
        "Necesito separar desgaste de frenos de una falla hidráulica.",
        "¿Cómo se siente el pedal de freno?",
        ["Muy suave", "Duro", "Vibra o raspa", "No sé"]
      );
    }

    if ((hasFuel || hasSmoke) && !asked.includes("acceler")) {
      return followUpEs(
        "Necesito confirmar si el problema aparece bajo carga.",
        "¿El olor a gasolina o humo empeora cuando aceleras?",
        ["Sí, al acelerar", "También en idle", "Solo a veces", "No sé"]
      );
    }

    if (hasShake && !asked.includes("warm")) {
      return followUpEs(
        "Necesito separar falla de encendido de soporte de motor o mezcla.",
        "¿El motor tiembla más cuando está frío o cuando ya está caliente?",
        ["Más frío", "Más caliente", "Igual siempre", "No sé"]
      );
    }

    return followUpEs(
      "Necesito un detalle más para separar las causas probables.",
      "¿Qué cambia más cuando aparece el problema?",
      ["Ruido", "Olor", "Vibración", "Pérdida de potencia"]
    );
  }

  if (hasNoStart && !asked.includes("crank")) {
    return followUpEn(
      "I need to separate battery, starter, or electrical power.",
      "When you try to start it, does the engine crank or only click?",
      ["Cranks normally", "Only one click", "No sound", "Not sure"]
    );
  }

  if (hasOverheat && !asked.includes("coolant")) {
    return followUpEn(
      "I need to confirm if the cooling system is losing coolant.",
      "Have you noticed coolant loss, steam, or the temperature rising fast?",
      ["Coolant loss", "Steam", "Temp rises fast", "Not sure"]
    );
  }

  if (hasBrake && !asked.includes("pedal")) {
    return followUpEn(
      "I need to separate brake wear from a hydraulic brake issue.",
      "How does the brake pedal feel?",
      ["Very soft", "Hard", "Grinding or vibration", "Not sure"]
    );
  }

  if ((hasFuel || hasSmoke) && !asked.includes("acceler")) {
    return followUpEn(
      "I need to confirm if the issue happens under load.",
      "Does the fuel smell or smoke get worse when you accelerate?",
      ["Yes, under acceleration", "Also at idle", "Only sometimes", "Not sure"]
    );
  }

  if (hasShake && !asked.includes("warm")) {
    return followUpEn(
      "I need to separate ignition misfire from mount or mixture issues.",
      "Does the engine shake more when it is cold or after it warms up?",
      ["More when cold", "More when warm", "Same all the time", "Not sure"]
    );
  }

  return followUpEn(
    "I need one more detail to separate the likely causes.",
    "What changes the most when the problem appears?",
    ["Noise", "Smell", "Vibration", "Power loss"]
  );
}

function followUpEn(summary, question, options) {
  return `Diagnosis status: follow_up

Voice summary:
${summary}

Confidence:
55

Risk level:
Medium

Likely issue:
Still narrowing the issue.

Why it fits:
The current symptoms need one more targeted detail before a reliable diagnosis.

What to do next:
${question}

Answer options:
${options[0]}
${options[1]}
${options[2]}
${options[3]}

When to stop driving:
Stop driving if the car feels unsafe, overheats, smells like burning, loses strong power, or shows a red warning light.`;
}

function followUpEs(summary, question, options) {
  return `Diagnosis status: follow_up

Voice summary:
${summary}

Confidence:
55

Risk level:
Medium

Likely issue:
Still narrowing the issue.

Why it fits:
Los síntomas actuales necesitan un detalle más antes de un diagnóstico confiable.

What to do next:
${question}

Answer options:
${options[0]}
${options[1]}
${options[2]}
${options[3]}

When to stop driving:
Deja de manejar si el auto se siente inseguro, se sobrecalienta, huele a quemado, pierde mucha potencia, o aparece una luz roja.`;
}

function buildFastAnalysis(lang, issue, dominantSignals, realAnswerCount, minimumQuestions) {
  const text = String(issue || "").toLowerCase();
  const hasFuel = includesAny(text, ["fuel", "gas smell", "raw fuel"]);
  const hasSmoke = includesAny(text, ["black smoke", "smoke"]);
  const hasNoStart = includesAny(text, ["won't start", "no start", "click"]);
  const hasOverheat = includesAny(text, ["overheat", "coolant", "steam"]);
  const hasBrake = includesAny(text, ["brake"]);

  if (lang === "es") {
    const likely = hasNoStart
      ? "Possible weak battery, starter, or power connection issue."
      : hasOverheat
      ? "Possible cooling system fault."
      : hasBrake
      ? "Possible brake system safety issue."
      : hasFuel || hasSmoke
      ? "Possible rich-running, injector, fuel pressure, or ignition misfire issue."
      : "Possible vehicle system fault that needs inspection.";

    return `Diagnosis status: analysis

Voice summary:
DriveShift encontró una dirección probable y conviene confirmarla con una revisión básica.

Confidence:
65

Risk level:
Medium

Likely issue:
${likely}

Why it fits:
Los síntomas y las respuestas apuntan a un sistema principal, pero todavía conviene confirmar con una revisión práctica.

What to do next:
Haz un escaneo OBD, revisa luces de advertencia, olores, fugas, vibración y pérdida de potencia. Si el síntoma continúa, pide una inspección profesional.

Answer options:
None

When to stop driving:
Deja de manejar si el auto se siente inseguro, se sobrecalienta, vibra fuerte, huele a quemado, pierde mucha potencia, o aparece una luz roja.`;
  }

  const likely = hasNoStart
    ? "Possible weak battery, starter, or power connection issue."
    : hasOverheat
    ? "Possible cooling system fault."
    : hasBrake
    ? "Possible brake system safety issue."
    : hasFuel || hasSmoke
    ? "Possible rich-running, injector, fuel pressure, or ignition misfire issue."
    : "Possible vehicle system fault that needs inspection.";

  return `Diagnosis status: analysis

Voice summary:
DriveShift found a likely direction and it should be confirmed with basic checks.

Confidence:
65

Risk level:
Medium

Likely issue:
${likely}

Why it fits:
The symptoms and answers point toward one main system, but it should still be confirmed with practical checks.

What to do next:
Run an OBD scan, check warning lights, smell, leaks, vibration, and power loss. If the symptom continues, get a professional inspection.

Answer options:
None

When to stop driving:
Stop driving if the car feels unsafe, overheats, shakes badly, smells like burning, loses strong power, or shows a red warning light.`;
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

function detectComplexity(issue, dominantSignals, answers) {
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

function detectDiagnosticReadiness(issue, answers, dominantSignals, complexity) {
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

function includesAny(text, words) {
  return words.some((w) => text.includes(w));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
  const lower = text.toLowerCase();

  if (!shouldAskFollowUp) {
    if (!lower.includes("answer options:")) {
      return `${text.trim()}\n\nAnswer options:\nNone`;
    }

    return text.replace(
      /Answer options:\s*([\s\S]*?)(?=When to stop driving:)/i,
      "Answer options:\nNone\n\n"
    );
  }

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
Necesito separar la causa probable con una pregunta más.

Confidence:
50

Risk level:
Medium

Likely issue:
Still narrowing the issue.

Why it fits:
La información actual todavía no es suficiente para separar las causas principales.

What to do next:
¿El motor tiembla más cuando está frío o cuando ya está caliente?

Answer options:
Más cuando está frío
Más cuando está caliente
Tiembla igual todo el tiempo
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
The current information is not enough yet to separate the main causes.

What to do next:
Does the engine shake more when it is cold or after it warms up?

Answer options:
More when cold
More when warm
It shakes the same all the time
Not sure

When to stop driving:
Stop driving if the car feels unsafe, overheats, smells like burning, loses strong power, or shows a red warning light.`;
}

function fallbackAnalysis(lang) {
  if (lang === "es") {
    return `Diagnosis status: analysis

Voice summary:
DriveShift encontró una dirección probable, pero conviene confirmarla con una revisión básica.

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
