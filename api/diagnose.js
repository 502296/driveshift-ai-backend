import {
  countUserAnswers,
  detectDominantSignals,
  detectComplexity,
  detectDiagnosticReadiness,
} from "./helpers/diagnostic-core.js";

import { buildSmartFollowUp } from "./helpers/question-brain.js";

import {
  parseLiveDataContext,
  buildObdInsight,
} from "./helpers/obd-intelligence.js";

const REQUIRED_FOLLOW_UPS = 2;

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
      return res.status(200).json({
        result: buildSmartFollowUp({
          lang,
          issue: "",
          answers: [],
        }),
      });
    }

    const possibleObdCode = safeIssue.match(/\b[PCBU][0-9A-F]{4}\b/i);
    const hasObdCode = Boolean(possibleObdCode);
    const obdCode = hasObdCode ? possibleObdCode[0].toUpperCase() : "";

    const liveDataContext = parseLiveDataContext(safeIssue);
    const obdInsight = buildObdInsight({
      code: obdCode,
      liveData: liveDataContext,
    });

    const realAnswerCount = countUserAnswers(answerList);
    const dominantSignals = detectDominantSignals(safeIssue, answerList);
    const complexity = detectComplexity(safeIssue, dominantSignals, answerList);
    const readiness = detectDiagnosticReadiness(
      safeIssue,
      answerList,
      dominantSignals,
      complexity
    );

    const hasFlowControl = answerList.some((a) =>
      String(a?.question || "").toLowerCase().includes("driveshift flow control")
    );

    const shouldAskFollowUp =
      !hasObdCode && !hasFlowControl && realAnswerCount < REQUIRED_FOLLOW_UPS;

    if (shouldAskFollowUp) {
      const followUp = buildSmartFollowUp({
        lang,
        issue: safeIssue,
        answers: answerList,
      });

      return res.status(200).json({ result: followUp });
    }

    const prompt = buildAnalysisPrompt({
      lang,
      issue: safeIssue,
      answers: answerList,
      vehicleProfile: profile,
      dominantSignals,
      complexity,
      readiness,
      obdCode,
      hasObdCode,
      obdInsight,
      realAnswerCount,
    });

    const aiText = await requestOpenAIReport(prompt);

    const result = aiText
      ? cleanAndFinalize(aiText, lang)
      : buildFastAnalysis({
          lang,
          issue: safeIssue,
          dominantSignals,
          obdCode,
          obdInsight,
        });

    return res.status(200).json({ result });
  } catch (_) {
    return res.status(200).json({
      result: buildFastAnalysis({
        lang: "en",
        issue: "",
        dominantSignals: [],
        obdCode: "",
        obdInsight: "",
      }),
    });
  }
}

function buildAnalysisPrompt({
  lang,
  issue,
  answers,
  vehicleProfile,
  dominantSignals,
  complexity,
  readiness,
  obdCode,
  hasObdCode,
  obdInsight,
  realAnswerCount,
}) {
  const vehicleText = buildVehicleText(vehicleProfile);

  const userInput =
    answers.length > 0
      ? answers
          .map((a, index) => {
            const q = String(a.question || `Question ${index + 1}`).trim();
            const ans = String(a.answer || "").trim();
            return `${index + 1}. ${q}: ${ans}`;
          })
          .join("\n")
      : "No additional answers.";

  const dominantText = dominantSignals.length
    ? dominantSignals.join(", ")
    : "None detected";

  return `
You are DriveShift Doctor, a calm senior automotive diagnostic mechanic.

You are not a chatbot.
You are a diagnostic system giving the final report after a short guided diagnostic flow.

Language:
${lang === "es" ? "Spanish" : "English"}

Original problem:
${issue}

Vehicle profile:
${vehicleText}

Conversation answers:
${userInput}

Detected OBD code:
${hasObdCode ? obdCode : "None"}

Dominant symptom lock:
${dominantText}

OBD intelligence insight:
${obdInsight || "None"}

Diagnostic complexity:
${complexity?.level || "standard"}

Readiness reason:
${readiness?.reason || "ready for final report"}

Answered questions:
${realAnswerCount}

Critical diagnostic rules:
Keep the strongest symptom as the main diagnostic direction.
Do not ask more questions.
Do not output follow_up.
Do not include Answer options except None.
Do not mention AI.
Do not say "as an AI".
Do not pretend certainty.
Give the most likely issue first.
Mention the top 1 or 2 likely systems only.

For fuel trim / Bank 1 / Bank 2 cases:
If one bank is lean while the other is stable, and smoke test plus fuel pressure are normal, prioritize bank-specific causes such as restricted injector, skewed upstream O2 sensor, exhaust leak near the upstream O2, wiring/connector issue, or bank-specific air/fuel measurement problem.

For flashing check engine / rough under load:
Prioritize misfire under load, ignition breakdown, injector delivery issue, or mixture control problem.

For no-start:
Only discuss no-start if the original issue clearly says the vehicle will not start.

For CAN / U-code:
Prioritize module isolation, power/ground checks, network waveform quality, termination, splice packs, and water intrusion.

For transmission:
Prioritize line pressure, valve body leakage, clutch seal leakage, solenoid control, and temperature-dependent hydraulic behavior.

For EPS / steering rack:
Prioritize torque sensor zero-point reset, steering angle calibration, EPS relearn, and scan-tool calibration before replacing parts.

Report style:
Premium mechanic tone.
Short, clear, practical.
No markdown.
No bullets.
No numbered list.

Output exactly this format:

Diagnosis status: analysis

Voice summary:
[one short natural mechanic sentence]

Risk level:
[High or Medium or Low]

Likely issue:
[short likely issue]

Why it fits:
[short explanation]

What to inspect next:
[practical inspection checks]

What to do next:
[driver-friendly next action]

Answer options:
None

When to stop driving:
[clear safety advice]
`;
}

async function requestOpenAIReport(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

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
        temperature: 0.08,
        max_output_tokens: 700,
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

function buildFastAnalysis({ lang, issue, dominantSignals, obdCode, obdInsight }) {
  const isEs = lang === "es";

  const text = [
    String(issue || ""),
    Array.isArray(dominantSignals) ? dominantSignals.join(" ") : "",
    String(obdInsight || ""),
  ]
    .join(" ")
    .toLowerCase();

  const hasObd = Boolean(obdCode);
  const hasFuelTrim = includesAny(text, ["fuel trim", "bank 1", "bank 2", "lean"]);
  const hasMisfire = includesAny(text, ["misfire", "flashing check engine", "rough under load", "hesitating", "loses power"]);
  const hasFuel = includesAny(text, ["fuel", "gas smell", "raw fuel", "black smoke", "rich"]);
  const hasNoStart = isTrueNoStart(text);
  const hasOverheat = includesAny(text, ["overheat", "coolant", "steam", "temperature"]);
  const hasBrake = includesAny(text, ["brake", "pedal", "brake fluid"]);
  const hasCharging = includesAny(text, ["battery", "alternator", "charging", "voltage"]);

  const risk =
    hasOverheat || hasBrake ? "High" : "Medium";

  const likely = hasObd
    ? obdInsight || `OBD-related fault ${obdCode}`
    : hasFuelTrim
    ? "Possible bank-specific lean condition from injector delivery, upstream O2 sensor skew, or bank-specific measurement issue."
    : hasMisfire
    ? "Possible ignition breakdown, injector delivery issue, or mixture problem under load."
    : hasOverheat
    ? "Possible cooling system fault or overheating risk."
    : hasBrake
    ? "Possible brake system safety issue."
    : hasNoStart
    ? "Possible weak battery, starter, or power connection issue."
    : hasFuel
    ? "Possible rich-running, injector, fuel pressure, or ignition misfire issue."
    : hasCharging
    ? "Possible battery, alternator, or charging system issue."
    : "Possible vehicle system fault that needs inspection.";

  if (isEs) {
    return `Diagnosis status: analysis

Voice summary:
DriveShift encontró una dirección probable y conviene confirmarla con una revisión básica.

Risk level:
${risk}

Likely issue:
${likely}

Why it fits:
Los síntomas apuntan a una dirección mecánica probable, pero todavía debe confirmarse con datos reales del vehículo.

What to inspect next:
Revisa códigos, fuel trims, datos OBD, conectores, sensores relacionados, fugas, olores, vibración y pérdida de potencia bajo carga.

What to do next:
Evita manejar fuerte hasta confirmar la causa. Haz una prueba con scanner durante la falla antes de reemplazar piezas.

Answer options:
None

When to stop driving:
Deja de manejar si el auto se siente inseguro, se sobrecalienta, huele a quemado, pierde mucha potencia, vibra fuerte, o aparece una luz roja.`;
  }

  return `Diagnosis status: analysis

Voice summary:
DriveShift found a likely diagnostic direction that should be confirmed with live checks.

Risk level:
${risk}

Likely issue:
${likely}

Why it fits:
The symptoms point toward a likely mechanical direction, but it still needs confirmation with live vehicle data.

What to inspect next:
Check codes, fuel trims, OBD data, related sensors, wiring connectors, leaks, smells, vibration, and power loss under load.

What to do next:
Avoid hard driving until the cause is confirmed. Capture scan data during the fault before replacing parts.

Answer options:
None

When to stop driving:
Stop driving if the car feels unsafe, overheats, smells like burning, loses strong power, shakes badly, or shows a red warning light.`;
}

function cleanAndFinalize(text, lang) {
  let clean = String(text || "").trim();

  clean = clean.replace(/Confidence:\s*[\s\S]*?(?=Risk level:)/i, "");
  clean = normalizeStatus(clean);
  clean = ensureAnalysisFormat(clean, lang);
  clean = ensureAnswerOptionsNone(clean);
  clean = removeFollowUpLanguage(clean);

  return clean.trim();
}

function normalizeStatus(text) {
  let clean = String(text || "").trim();

  if (/Diagnosis status:/i.test(clean)) {
    clean = clean.replace(
      /Diagnosis status:\s*(follow_up|analysis|final)/i,
      "Diagnosis status: analysis"
    );
  } else {
    clean = `Diagnosis status: analysis\n\n${clean}`;
  }

  return clean.trim();
}

function ensureAnalysisFormat(text, lang) {
  const clean = String(text || "").trim();

  const required = [
    "Diagnosis status:",
    "Voice summary:",
    "Risk level:",
    "Likely issue:",
    "Why it fits:",
    "What to inspect next:",
    "What to do next:",
    "Answer options:",
    "When to stop driving:",
  ];

  const hasAll = required.every((label) =>
    clean.toLowerCase().includes(label.toLowerCase())
  );

  if (hasAll) return clean;

  return buildFastAnalysis({
    lang,
    issue: "",
    dominantSignals: [],
    obdCode: "",
    obdInsight: "",
  });
}

function ensureAnswerOptionsNone(text) {
  if (/Answer options:/i.test(text)) {
    return text.replace(
      /Answer options:\s*[\s\S]*?(?=When to stop driving:)/i,
      "Answer options:\nNone\n\n"
    );
  }

  return `${text.trim()}\n\nAnswer options:\nNone`;
}

function removeFollowUpLanguage(text) {
  return String(text || "")
    .replace(/Still narrowing the issue\./gi, "Pending diagnostic confirmation.")
    .replace(/Need one more detail before a reliable diagnosis\./gi, "The pattern is now ready for final analysis.")
    .trim();
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
  } catch (_) {
    return "";
  }
}

function includesAny(text, words) {
  return words.some((w) => String(text || "").toLowerCase().includes(w));
}

function isTrueNoStart(text) {
  const clean = String(text || "").toLowerCase();

  const phrases = [
    "won't start",
    "will not start",
    "does not start",
    "doesn't start",
    "no start",
    "no crank",
    "cranks but won't start",
    "cranks but does not start",
    "starter clicks",
    "only clicks",
  ];

  return phrases.some((p) => clean.includes(p));
}
