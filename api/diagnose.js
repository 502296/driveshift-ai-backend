import { buildDiagnosticContext } from "./helpers/diagnostic-core.js";

import {
  parseLiveDataContext,
  buildObdInsight,
} from "./helpers/obd-intelligence.js";

const DOCTOR_PROMPT = `
Role:
You are DriveShift Doctor Mechanic — an elite world-class automotive diagnostic specialist.

You are not a chatbot.
You are not a generic assistant.
You are a diagnostic brain that reasons from vehicle behavior.

Your job:
Use the internal DriveShift diagnostic context as the main source of reasoning:
- extracted signals
- dominant symptom lock
- behavior reasoning
- risk flags
- OBD insight
- user answers
- vehicle profile

You must protect the dominant symptom.
Do not drift away from the locked diagnostic direction unless the user's later answers clearly contradict it.

Think like a master drivability technician:
- When does it happen?
- Hot or cold?
- Under load or idle?
- Road speed or RPM?
- Braking or acceleration?
- Intermittent or constant?
- Smoke, smell, vibration, overheating, warning lights?
- What system is being stressed?

Voice:
Calm.
Premium.
Sharp.
Human.
Mechanically intelligent.
No filler.

Avoid weak language:
Do not overuse:
"maybe"
"could be"
"several possibilities"
"consult a mechanic"
"hard to say"

Use stronger but honest language:
"The symptom pattern points to..."
"The behavior strongly matches..."
"The locked direction keeps this centered on..."
"Heat and load are exposing..."
"The failure behavior fits..."

Truth rule:
Do not invent measurements.
Do not invent scan data.
Do not claim confirmed failed parts.
Only use data the user provided.

Follow-up rule:
If the diagnostic context says more data is needed, ask exactly one high-value question.
Do not ask generic questions.
Do not repeat earlier questions.

Final report rule:
If ready for analysis, produce a mechanic-level final report.

Strict output format:

Diagnosis status:
follow_up or analysis

Voice summary:
One short mechanic sentence.

Risk level:
Low / Medium / High

Likely issue:
Short mechanic-level diagnosis.

Why it fits:
Explain the behavior, not textbook theory.

What to inspect next:
Practical inspection path.

What to do next:
Clear action.

Answer options:
If follow_up, give exactly 4 short answer options.
If analysis, write None.

When to stop driving:
Clear safety instruction.
`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ result: "Method not allowed" });
  }

  try {
    const {
      issue,
      answers,
      language,
      vehicleProfile,
      flowControl,
    } = req.body;

    const lang = language === "es" ? "es" : "en";
    const safeIssue = String(issue || "").trim();
    const answerList = Array.isArray(answers) ? answers : [];

    if (!safeIssue) {
      return res.status(200).json({
        result: buildEmptyFollowUp(lang),
      });
    }

    const obdCode = extractObdCode(safeIssue);
    const hasObdCode = Boolean(obdCode);

    const liveDataContext = parseLiveDataContext(safeIssue);
    const obdInsight = buildObdInsight({
      code: obdCode || "",
      liveData: liveDataContext,
    });

    const diagnosticContext = buildDiagnosticContext(
      safeIssue,
      answerList
    );

    const forcedFinal = shouldForceFinal({
      flowControl,
      hasObdCode,
      diagnosticContext,
    });

    const readyForAnalysis =
      hasObdCode ||
      forcedFinal ||
      diagnosticContext?.readiness?.readyForAnalysis === true;

    const prompt = buildPrompt({
      lang,
      issue: safeIssue,
      answers: answerList,
      vehicleProfile,
      diagnosticContext,
      obdCode,
      obdInsight,
      readyForAnalysis,
    });

    const aiText = await requestOpenAIReport(prompt);
    const result = cleanResult(aiText, readyForAnalysis);

    if (!result || looksBad(result)) {
      return res.status(200).json({
        result: buildSafeFallback(lang, readyForAnalysis),
      });
    }

    return res.status(200).json({ result });
  } catch (error) {
    return res.status(200).json({
      result: buildErrorFallback(),
    });
  }
}

function buildPrompt({
  lang,
  issue,
  answers,
  vehicleProfile,
  diagnosticContext,
  obdCode,
  obdInsight,
  readyForAnalysis,
}) {
  const userAnswers = answers.length
    ? answers
        .map(
          (a, i) =>
            `${i + 1}. ${a.question || "Question"}: ${a.answer || ""}`
        )
        .join("\n")
    : "No additional answers yet.";

  return `${DOCTOR_PROMPT}

Language:
${lang === "es" ? "Spanish only" : "English only"}

Mode:
${readyForAnalysis ? "analysis" : "follow_up"}

Vehicle:
${buildVehicleText(vehicleProfile)}

Original user symptom:
${issue}

User follow-up answers:
${userAnswers}

OBD code:
${obdCode || "None"}

OBD insight:
${obdInsight || "None"}

DriveShift internal diagnostic context:
${JSON.stringify(diagnosticContext, null, 2)}

Important:
- Use the dominant_lock as your diagnostic compass.
- Use behavior_reasoning to decide the next best question or final reasoning.
- If Mode is follow_up, ask exactly one question based on behavior_reasoning.next_best_question_goal.
- If Mode is analysis, do not ask another question.
- Do not expose JSON to the user.
- Do not mention "internal context", "dominant lock engine", or "behavior engine" to the user.
- Sound like a real master mechanic.
`;
}

async function requestOpenAIReport(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);

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
        max_output_tokens: 1500,
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

function shouldForceFinal({ flowControl, hasObdCode, diagnosticContext }) {
  if (hasObdCode) return true;

  const decision = String(flowControl?.localDecision || "").toLowerCase();

  if (decision === "final" || decision === "analysis") return true;

  const lockLevel = diagnosticContext?.dominant_lock?.lock_level;
  const severity = diagnosticContext?.severity;

  if (severity === "high" && lockLevel === "critical") {
    return false;
  }

  return false;
}

function cleanResult(text, readyForAnalysis) {
  let clean = String(text || "").trim();
  if (!clean) return "";

  if (!/Diagnosis status:/i.test(clean)) {
    clean = `Diagnosis status: ${
      readyForAnalysis ? "analysis" : "follow_up"
    }\n\n${clean}`;
  }

  if (readyForAnalysis) {
    clean = clean.replace(
      /Diagnosis status:\s*follow_up/i,
      "Diagnosis status: analysis"
    );

    if (/Answer options:/i.test(clean)) {
      clean = clean.replace(
        /Answer options:\s*[\s\S]*?(?=When to stop driving:)/i,
        "Answer options:\nNone\n\n"
      );
    } else {
      clean += "\n\nAnswer options:\nNone";
    }
  }

  return clean.trim();
}

function looksBad(text) {
  const clean = String(text || "").toLowerCase();

  return (
    !clean ||
    clean.includes("consult a mechanic") ||
    clean.includes("could be many things") ||
    clean.includes("hard to say") ||
    clean.includes("as an ai") ||
    clean.includes("i am not a mechanic")
  );
}

function buildEmptyFollowUp(lang) {
  const isEs = lang === "es";

  return `Diagnosis status: follow_up

Voice summary:
${isEs ? "Necesito el síntoma principal del vehículo." : "I need the vehicle’s main symptom first."}

Risk level:
Medium

Likely issue:
Pending symptom input.

Why it fits:
${isEs ? "No hay suficiente información para iniciar el diagnóstico." : "There is not enough information to start the diagnostic path."}

What to inspect next:
${isEs ? "Describe qué está haciendo el vehículo." : "Describe what the vehicle is doing."}

What to do next:
${isEs ? "Escribe el síntoma principal." : "Enter the main symptom."}

Answer options:
${isEs ? "No enciende\nVibra\nHuele a combustible\nLuz de advertencia" : "Won’t start\nShaking\nFuel smell\nWarning light"}

When to stop driving:
${isEs ? "Deja de manejar si el vehículo se siente inseguro." : "Stop driving if the vehicle feels unsafe."}`;
}

function buildSafeFallback(lang, readyForAnalysis) {
  const isEs = lang === "es";

  if (!readyForAnalysis) {
    return `Diagnosis status: follow_up

Voice summary:
${isEs ? "Necesito una condición más para separar el sistema correcto." : "I need one more condition to separate the right system."}

Risk level:
Medium

Likely issue:
Pending diagnostic confirmation.

Why it fits:
${isEs ? "El síntoma necesita una condición de carga, temperatura, velocidad o idle." : "The symptom needs one condition: load, temperature, speed, or idle behavior."}

What to inspect next:
${isEs ? "¿Cuándo aparece más el problema?" : "When does the problem show up most?"}

What to do next:
${isEs ? "Elige la condición más cercana." : "Choose the closest condition."}

Answer options:
${isEs ? "Acelerando\nFrenando\nDespués de calentarse\nEn idle" : "Accelerating\nBraking\nAfter warming up\nAt idle"}

When to stop driving:
${isEs ? "Deja de manejar si hay humo, olor a combustible, sobrecalentamiento o luz roja." : "Stop driving if there is smoke, fuel smell, overheating, or a red warning light."}`;
  }

  return `Diagnosis status: analysis

Voice summary:
DriveShift could not complete a reliable diagnostic report from the server response.

Risk level:
Medium

Likely issue:
Server diagnostic response failed.

Why it fits:
The diagnostic brain did not return a usable mechanic report.

What to inspect next:
Try the request again with the same symptom.

What to do next:
If this repeats, check the backend logs.

Answer options:
None

When to stop driving:
Stop driving if the vehicle feels unsafe, overheats, smells like fuel or burning, loses strong power, shakes badly, or shows a red warning light.`;
}

function buildErrorFallback() {
  return `Diagnosis status: analysis

Voice summary:
DriveShift could not reach the diagnostic brain.

Risk level:
Medium

Likely issue:
Backend diagnostic error.

Why it fits:
The server could not complete the diagnostic request.

What to inspect next:
Check the Vercel logs for the exact error.

What to do next:
Fix the backend error and try again.

Answer options:
None

When to stop driving:
Stop driving if the vehicle feels unsafe, overheats, smells like fuel or burning, loses strong power, shakes badly, or shows a red warning light.`;
}

function extractObdCode(text) {
  const match = String(text || "").match(/\b[PCBU][0-9A-F]{4}\b/i);
  return match ? match[0].toUpperCase() : "";
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
