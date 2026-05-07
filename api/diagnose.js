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

    const minimumQuestions = hasObdCode ? 0 : readiness.minimumQuestions;

    const shouldAskFollowUp =
      !hasObdCode &&
      !readiness.readyForAnalysis &&
      realAnswerCount < minimumQuestions;

    // Very important:
    // Follow-up questions are local now.
    // This makes Ask AI faster, prevents repeated weak AI questions,
    // and keeps OpenAI only for the final DriveShift report.
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
      minimumQuestions,
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
  minimumQuestions,
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
You are a diagnostic system that gives a clear mechanic-style report after a short guided interview.

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

Minimum questions:
${minimumQuestions}

Critical diagnostic rules:
Keep the strongest symptom as the main diagnostic direction.
Do not let minor later details override serious dominant signals.
If black smoke, fuel smell, raw fuel smell, or rich running is present, prioritize overfueling, injector leak, fuel pressure, MAF/MAP data, oxygen sensor feedback, or ignition misfire with unburned fuel before vacuum leak.
If overheating, coolant loss, steam, or red temperature warning is present, prioritize cooling-system risk.
If burning smell, smoke from engine bay, brake issue, oil pressure warning, severe power loss, or stalling while driving is present, treat it as safety-sensitive.
Do not jump to rare causes before simple high-probability checks.

OBD rules:
If an OBD code is present, use it as diagnostic context.
For P0012, prioritize camshaft timing, VVT solenoid, oil flow, timing actuator, timing chain stretch, or oil condition.
If RPM is 0 and speed is 0, mention that the engine appears off during the scan, so live running behavior may still need confirmation.
If battery voltage is low, mention that weak voltage can affect modules, sensors, starting, and scan accuracy.
If coolant temperature is high, treat it as a safety-sensitive overheating risk.

Report rules:
Give a professional final diagnosis report.
Do not ask more questions.
Do not mention AI.
Do not say "as an AI".
Do not pretend certainty.
Give the most likely issue first.
Mention the top 1 or 2 likely systems only.
Keep it practical and useful.
No markdown.
No bullets.
No numbered list.
Short premium mechanic tone.

Voice summary rules:
Voice summary must be one short natural mechanic sentence.

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

  // Increased from 2.8s because that was too aggressive
  // and caused weak fallback replies.
  const timeout = setTimeout(() => controller.abort(), 8000);

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
        max_output_tokens: 650,
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
  const hasFuel = includesAny(text, ["fuel", "gas smell", "raw fuel", "black smoke", "rich"]);
  const hasNoStart = includesAny(text, ["won't start", "no start", "click", "starter"]);
  const hasOverheat = includesAny(text, ["overheat", "coolant", "steam", "temperature"]);
  const hasBrake = includesAny(text, ["brake", "pedal", "brake fluid"]);
  const hasCharging = includesAny(text, ["battery", "alternator", "charging", "voltage"]);

  const risk =
    hasOverheat || hasBrake ? "High" : hasFuel || hasNoStart || hasCharging ? "Medium" : "Medium";

  const likely = hasObd
    ? obdInsight || `OBD-related fault ${obdCode}`
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
Los síntomas apuntan a una dirección mecánica probable, pero todavía debe confirmarse con una inspección real del vehículo.

What to inspect next:
Revisa luces de advertencia, fugas, olores, vibración, pérdida de potencia, conectores visibles, nivel de coolant, nivel de aceite y datos OBD si están disponibles.

What to do next:
Si el síntoma continúa, evita manejar fuerte y pide una inspección profesional para confirmar la causa antes de reemplazar piezas.

Answer options:
None

When to stop driving:
Deja de manejar si el auto se siente inseguro, se sobrecalienta, huele a quemado, pierde mucha potencia, vibra fuerte, o aparece una luz roja.`;
  }

  return `Diagnosis status: analysis

Voice summary:
DriveShift found a likely direction and it should be confirmed with basic checks.

Risk level:
${risk}

Likely issue:
${likely}

Why it fits:
The symptoms point toward a likely mechanical direction, but it still needs confirmation with a real vehicle inspection.

What to inspect next:
Check warning lights, leaks, smells, vibration, power loss, visible connectors, coolant level, oil level, and OBD data if available.

What to do next:
If the symptom continues, avoid hard driving and get a professional inspection before replacing parts.

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
