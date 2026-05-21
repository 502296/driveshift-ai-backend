import { buildDiagnosticContext } from "./helpers/diagnostic-core.js";

import {
  parseLiveDataContext,
  buildObdInsight,
} from "./helpers/obd-intelligence.js";

const REQUIRED_FOLLOW_UPS = 2;

const DOCTOR_PROMPT = `
Role:
You are DriveShift, a premium mechanic-level diagnostic system. Your tone is calm, precise, practical, and human. Do not scare the user. Do not sound robotic.

Core rules:
- Give a clear mechanical direction.
- Do not use fear-based language.
- Do not show Risk Level.
- Do not mention AI.
- Do not say "consult a mechanic" as a generic escape.
- Do not use Markdown bold.
- Headers must use colons.

Final response format:

Primary Verdict:
[One clear sentence identifying the most likely failure direction.]

Voice Summary:
[One or two natural sentences a master mechanic would say.]

Failure Behavior Analysis:
[Explain why the symptom behavior points to this system.]

Why The Logic Holds:
[Explain what the answers ruled in or ruled out.]

Recommended Verification Path:
1. [Specific inspection or test]
2. [Specific diagnostic observation]
3. [Confirmation point before replacing parts]

Mechanic Insight:
[One useful technician-level note.]

Answer options:
None

Units: Imperial (USA)
`;

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(200).json({
        result: buildGeneralHelpResponse("en"),
      });
    }

    const { issue, answers, language, vehicleProfile, flowControl } =
      req.body || {};

    const lang = language === "es" ? "es" : "en";
    const safeIssue = String(issue || "").trim();
    const answerList = Array.isArray(answers) ? answers : [];

    if (!safeIssue) {
      return res.status(200).json({
        result: buildEmptyFollowUp(lang),
      });
    }

    const simpleIntent = detectSimpleIntent(safeIssue);

    if (simpleIntent === "greeting" || simpleIntent === "general_help") {
      return res.status(200).json({
        result:
          simpleIntent === "greeting"
            ? buildGreetingResponse(lang)
            : buildGeneralHelpResponse(lang),
      });
    }

    const obdCode = extractObdCode(safeIssue);
    const hasObdCode = Boolean(obdCode);

    const answerCount = Number(
      flowControl?.answerCount ?? answerList.length ?? 0
    );

    const liveDataContext = parseLiveDataContext(safeIssue);

    const obdInsight = buildObdInsight({
      code: obdCode || "",
      liveData: liveDataContext,
    });

    const diagnosticContext = buildDiagnosticContext(safeIssue, answerList);
    const askedQuestions = extractAskedQuestions(answerList);
    const dominantLock = buildLocalDominantLock(safeIssue, answerList);

    const readyForAnalysis = hasObdCode || answerCount >= REQUIRED_FOLLOW_UPS;

    if (!readyForAnalysis) {
      const followUpPrompt = buildAIFollowUpPrompt({
        lang,
        issue: safeIssue,
        answers: answerList,
        vehicleProfile,
        diagnosticContext,
        dominantLock,
        askedQuestions,
        obdCode,
        obdInsight,
      });

      const aiFollowUp = await requestOpenAIReport(followUpPrompt, true);

      const cleanedFollowUp =
        cleanFollowUp(aiFollowUp, {
          lang,
          issue: safeIssue,
          askedQuestions,
          dominantLock,
        }) ||
        buildNaturalFallbackFollowUp({
          lang,
          issue: safeIssue,
          dominantLock,
        });

      return res.status(200).json({
        result: cleanedFollowUp,
      });
    }

    const prompt = buildAnalysisPrompt({
      lang,
      issue: safeIssue,
      answers: answerList,
      vehicleProfile,
      diagnosticContext,
      dominantLock,
      obdCode,
      obdInsight,
    });

    const aiText = await requestOpenAIReport(prompt, false);
    const result = cleanAnalysis(aiText);

    if (!result || looksBad(result)) {
      return res.status(200).json({
        result: buildSafeAnalysisFallback(lang),
      });
    }

    return res.status(200).json({ result });
  } catch (_) {
    return res.status(200).json({
      result: buildErrorFallback(),
    });
  }
}

function detectSimpleIntent(text) {
  const raw = String(text || "").trim();
  const clean = raw
    .toLowerCase()
    .replace(/[.,!?؟،]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return "empty";
  if (extractObdCode(clean)) return "vehicle_problem";

  const vehicleWords = [
    "car",
    "vehicle",
    "engine",
    "transmission",
    "brake",
    "brakes",
    "tire",
    "tires",
    "battery",
    "alternator",
    "starter",
    "noise",
    "sound",
    "shake",
    "shaking",
    "vibration",
    "vibrates",
    "smoke",
    "fuel",
    "gas",
    "oil",
    "coolant",
    "overheat",
    "overheating",
    "warning",
    "light",
    "check engine",
    "abs",
    "airbag",
    "steering",
    "suspension",
    "idle",
    "rpm",
    "start",
    "starts",
    "starting",
    "won't start",
    "no start",
    "misfire",
    "stall",
    "stalls",
    "stalled",
    "dies",
    "leak",
    "leaking",
    "burning",
    "smell",
    "throttle",
    "acceleration",
    "accelerating",
    "crank",
    "click",
    "clunk",
    "grind",
    "grinding",
    "coche",
    "carro",
    "auto",
    "motor",
    "freno",
    "frenos",
    "batería",
    "bateria",
    "arranca",
    "enciende",
    "humo",
    "gasolina",
    "aceite",
    "sobrecalienta",
    "vibra",
    "vibración",
    "vibracion",
    "ruido",
    "luz",
    "testigo",
  ];

  const hasVehicleSignal = vehicleWords.some((word) => clean.includes(word));
  if (hasVehicleSignal) return "vehicle_problem";

  const greetings = [
    "hi",
    "hello",
    "hey",
    "hey there",
    "good morning",
    "good afternoon",
    "good evening",
    "how are you",
    "whats up",
    "what's up",
    "hola",
    "buenos dias",
    "buenos días",
    "buenas tardes",
    "buenas noches",
  ];

  if (greetings.includes(clean)) return "greeting";

  const generalHelpPhrases = [
    "can you help me",
    "i need help",
    "help me",
    "i have a question",
    "question",
    "need help",
    "puedes ayudarme",
    "necesito ayuda",
    "ayudame",
    "ayúdame",
    "tengo una pregunta",
  ];

  if (generalHelpPhrases.includes(clean)) return "general_help";
  if (clean.split(" ").length <= 4 && !hasVehicleSignal) return "general_help";

  return "vehicle_problem";
}

function buildAIFollowUpPrompt({
  lang,
  issue,
  answers,
  vehicleProfile,
  diagnosticContext,
  dominantLock,
  askedQuestions,
  obdCode,
  obdInsight,
}) {
  const userAnswers = answers.length
    ? answers
        .map((a, i) => `${i + 1}. ${a.question || "Question"}: ${a.answer || ""}`)
        .join("\n")
    : "No additional answers yet.";

  return `
You are DriveShift, a premium mechanic-level diagnostic brain.

Your job now:
Ask ONE short, sharp follow-up question.
Do NOT diagnose yet.

Language:
${lang === "es" ? "Spanish only" : "English only"}

Vehicle:
${buildVehicleText(vehicleProfile)}

Original user symptom:
${issue}

User previous answers:
${userAnswers}

Already asked questions:
${askedQuestions.length ? askedQuestions.join("\n") : "None"}

Dominant symptom lock:
${dominantLock || "None"}

OBD code:
${obdCode || "None"}

OBD insight:
${obdInsight || "None"}

Internal diagnostic context:
${JSON.stringify(diagnosticContext, null, 2)}

Rules:
- Ask exactly ONE question.
- The question must help separate systems, not sound generic.
- Do not repeat any already asked question.
- Do not include Risk level.
- Do not include Likely issue.
- Do not include Why it fits.
- Do not include Mechanic notes.
- Do not include Answer options.
- Do not include a report.
- Return only this exact format:

Diagnosis status:
follow_up

Question:
[one short mechanic-level question]
`;
}

function buildAnalysisPrompt({
  lang,
  issue,
  answers,
  vehicleProfile,
  diagnosticContext,
  dominantLock,
  obdCode,
  obdInsight,
}) {
  const userAnswers = answers.length
    ? answers
        .map((a, i) => `${i + 1}. ${a.question || "Question"}: ${a.answer || ""}`)
        .join("\n")
    : "No additional answers.";

  const mechanical = diagnosticContext?.mechanical_prioritization || {};
  const primary = mechanical?.primary || {};
  const secondary = Array.isArray(mechanical?.secondary)
    ? mechanical.secondary
    : [];

  return `${DOCTOR_PROMPT}

Language:
${lang === "es" ? "Spanish only" : "English only"}

Vehicle:
${buildVehicleText(vehicleProfile)}

Original user symptom:
${issue}

User follow-up answers:
${userAnswers}

Dominant symptom lock:
${dominantLock || "None"}

OBD code:
${obdCode || "None"}

OBD insight:
${obdInsight || "None"}

DriveShift internal diagnostic context:
${JSON.stringify(diagnosticContext, null, 2)}

Primary direction:
${primary.title || "None"}

Primary mechanic summary:
${primary.mechanic_summary || "None"}

Why primary:
${primary.why_primary || "None"}

Verification focus:
${
  Array.isArray(primary.verification_focus)
    ? primary.verification_focus.map((x, i) => `${i + 1}. ${x}`).join("\n")
    : "None"
}

Secondary directions:
${
  secondary.length
    ? secondary.map((x, i) => `${i + 1}. ${x.title}: ${x.mechanic_summary}`).join("\n")
    : "None"
}

Final report rules:
- The diagnostic interview is complete.
- Do not ask another question.
- Do not include Risk level.
- Do not include fear-based wording.
- Do not include "Pending diagnostic confirmation."
- Return only the exact final response format.
`;
}

async function requestOpenAIReport(prompt, isFollowUp = false) {
  return requestOpenAIReportWithSettings({
    prompt,
    temperature: isFollowUp ? 0.12 : 0.05,
    maxTokens: isFollowUp ? 220 : 900,
    timeoutMs: 18000,
  });
}

async function requestOpenAIReportWithSettings({
  prompt,
  temperature,
  maxTokens,
  timeoutMs,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
        temperature,
        max_output_tokens: maxTokens,
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

function cleanFollowUp(text, { lang, issue, askedQuestions, dominantLock }) {
  let clean = String(text || "").trim();

  if (!clean) return "";

  clean = clean.replace(/Diagnosis status:\s*analysis/gi, "Diagnosis status:\nfollow_up");

  const questionMatch = clean.match(/Question:\s*([\s\S]*)/i);
  let question = questionMatch ? questionMatch[1].trim() : "";

  if (!question) {
    const lines = clean
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

    question = lines.find((line) => line.includes("?")) || "";
  }

  if (!question || questionLooksRepeated(question, askedQuestions)) {
    return buildNaturalFallbackFollowUp({ lang, issue, dominantLock });
  }

  question = question
    .replace(/Risk level:.*/gi, "")
    .replace(/Likely issue:.*/gi, "")
    .replace(/Why it fits:.*/gi, "")
    .replace(/Mechanic notes:.*/gi, "")
    .replace(/Answer options:.*/gi, "")
    .replace(/None/gi, "")
    .trim();

  return `Diagnosis status:
follow_up

Question:
${question}`;
}

function cleanAnalysis(text) {
  let clean = String(text || "").trim();
  if (!clean) return "";

  clean = clean.replace(/\*\*/g, "");
  clean = clean.replace(/Diagnosis status:\s*follow_up/i, "Diagnosis status:\nanalysis");

  clean = clean
    .split("\n")
    .filter((line) => {
      const lower = line.trim().toLowerCase();
      if (lower.startsWith("risk level:")) return false;
      if (lower === "low" || lower === "medium" || lower === "high") return false;
      if (lower.includes("pending diagnostic confirmation")) return false;
      return true;
    })
    .join("\n")
    .trim();

  if (!/Diagnosis status:/i.test(clean)) {
    clean = `Diagnosis status:\nanalysis\n\n${clean}`;
  }

  if (!/Answer options:/i.test(clean)) {
    clean += "\n\nAnswer options:\nNone";
  }

  return clean.trim();
}

function buildSafeAnalysisFallback(lang) {
  const isEs = lang === "es";

  if (isEs) {
    return `Diagnosis status:
analysis

Primary Verdict:
No se pudo completar un informe confiable desde la respuesta del servidor.

Voice Summary:
DriveShift necesita una respuesta más estable del servidor para completar el diagnóstico.

Failure Behavior Analysis:
La respuesta técnica no fue suficiente para producir un informe mecánico confiable.

Why The Logic Holds:
Esto parece un fallo técnico de respuesta, no una conclusión mecánica.

Recommended Verification Path:
1. Revisa los logs del backend.
2. Verifica la respuesta de OpenAI.
3. Prueba otra vez con una descripción corta.

Mechanic Insight:
Este resultado indica un problema técnico, no una falla confirmada del vehículo.

Answer options:
None`;
  }

  return `Diagnosis status:
analysis

Primary Verdict:
DriveShift could not complete a reliable final report from the server response.

Voice Summary:
The diagnostic brain did not return a stable mechanic-level report.

Failure Behavior Analysis:
The response was not usable enough to produce a confident mechanical direction.

Why The Logic Holds:
This is a technical response problem, not a vehicle conclusion.

Recommended Verification Path:
1. Check the backend logs.
2. Verify the OpenAI response.
3. Test again with a shorter request.

Mechanic Insight:
This result indicates a technical failure, not a confirmed vehicle fault.

Answer options:
None`;
}

function buildErrorFallback() {
  return `Diagnosis status:
analysis

Primary Verdict:
DriveShift could not reach the diagnostic brain.

Voice Summary:
The request did not complete successfully.

Failure Behavior Analysis:
The server could not complete the diagnostic request.

Why The Logic Holds:
This is a backend connection or API failure.

Recommended Verification Path:
1. Check the API route.
2. Check environment variables.
3. Check the OpenAI response.

Mechanic Insight:
This failure is technical, not mechanical.

Answer options:
None`;
}

function buildEmptyFollowUp(lang) {
  const isEs = lang === "es";

  return `Diagnosis status:
follow_up

Question:
${isEs ? "¿Qué síntoma principal está haciendo el vehículo?" : "What is the main symptom the vehicle is showing?"}`;
}

function buildGreetingResponse(lang) {
  const isEs = lang === "es";

  return `Diagnosis status:
follow_up

Question:
${isEs ? "¿Qué está haciendo el vehículo y cuándo ocurre?" : "What is the vehicle doing, and when does it happen?"}`;
}

function buildGeneralHelpResponse(lang) {
  const isEs = lang === "es";

  return `Diagnosis status:
follow_up

Question:
${isEs ? "Describe el problema principal del vehículo y cuándo aparece." : "Describe the main vehicle problem and when it happens."}`;
}

function buildNaturalFallbackFollowUp({ lang, issue, dominantLock }) {
  const q = buildSmartFallbackQuestion({ lang, issue, dominantLock });

  return `Diagnosis status:
follow_up

Question:
${q}`;
}

function buildSmartFallbackQuestion({ lang, issue, dominantLock }) {
  const isEs = lang === "es";
  const text = `${issue || ""} ${dominantLock || ""}`.toLowerCase();

  if (/smoke|humo|fuel smell|gas smell|gasolina/.test(text)) {
    return isEs
      ? "¿El humo es negro, blanco o azul, y huele a gasolina cruda?"
      : "Is the smoke black, white, or blue, and does it smell like raw fuel?";
  }

  if (/no start|won't start|crank|click|arranca|enciende/.test(text)) {
    return isEs
      ? "Cuando intentas arrancar, ¿el motor gira normal, solo hace clic, o no hace nada?"
      : "When you try to start it, does the engine crank normally, only click, or do nothing at all?";
  }

  if (/vibration|shake|shaking|vibra|vibración|vibracion/.test(text)) {
    return isEs
      ? "¿La vibración aparece al frenar, al acelerar, a cierta velocidad, o también en ralentí?"
      : "Does the vibration show up while braking, accelerating, at a certain speed, or even at idle?";
  }

  if (/overheat|overheating|coolant|sobrecalienta/.test(text)) {
    return isEs
      ? "¿La temperatura sube parado, manejando en carretera, o después de perder coolant?"
      : "Does the temperature rise while sitting still, highway driving, or after losing coolant?";
  }

  if (/burning|smell|olor|quemado/.test(text)) {
    return isEs
      ? "¿El olor parece aceite quemado, plástico/eléctrico, coolant dulce, o freno/clutch caliente?"
      : "Does the smell seem like burnt oil, electrical plastic, sweet coolant, or hot brake/clutch material?";
  }

  return isEs
    ? "¿Cuándo aparece más fuerte: al acelerar, frenar, girar, estar parado, o mantener velocidad constante?"
    : "When is it strongest: accelerating, braking, turning, sitting still, or holding steady speed?";
}

function looksBad(text) {
  const clean = String(text || "").toLowerCase();

  return (
    !clean ||
    clean.includes("consult a mechanic") ||
    clean.includes("could be many things") ||
    clean.includes("hard to say") ||
    clean.includes("as an ai") ||
    clean.includes("i am not a mechanic") ||
    clean.includes("i'm not a mechanic")
  );
}

function extractObdCode(text) {
  const matches = String(text || "")
    .toUpperCase()
    .match(/\b[PCBU][0-9A-F]{4}\b/g);

  if (!matches || !matches.length) return "";
  return [...new Set(matches)].join(", ");
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

function extractAskedQuestions(answers) {
  return (Array.isArray(answers) ? answers : [])
    .map((a) => String(a?.question || "").trim())
    .filter(Boolean);
}

function questionLooksRepeated(text, askedQuestions) {
  if (!askedQuestions.length) return false;

  const clean = normalizeQuestionText(text);

  return askedQuestions.some((q) => {
    const oldQ = normalizeQuestionText(q);
    return oldQ && clean.includes(oldQ.slice(0, 45));
  });
}

function normalizeQuestionText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/diagnosis status:[\s\S]*?question:/i, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildLocalDominantLock(issue, answers) {
  const text = `${issue || ""} ${(answers || [])
    .map((a) => `${a.question || ""} ${a.answer || ""}`)
    .join(" ")}`.toLowerCase();

  const locks = [];

  if (
    /flashing|flashes|blinking|check engine|cel/.test(text) &&
    /shake|shaking|misfire|stumble|jitter/.test(text)
  ) {
    locks.push("Catalyst-damaging misfire / combustion instability under load");
  }

  if (/black smoke|humo negro|raw fuel|fuel smell|gas smell|gasolina/.test(text)) {
    locks.push("Fuel-rich combustion / overfueling / injector or fuel control fault");
  }

  if (/white smoke|humo blanco|coolant|sweet smell|coolant loss/.test(text)) {
    locks.push("Coolant intrusion or overheating-related failure path");
  }

  if (/blue smoke|humo azul|burning oil|oil consumption/.test(text)) {
    locks.push("Oil consumption through rings, valve seals, turbo, or PCV path");
  }

  if (/overheat|overheating|hot|temperature|sobrecalienta/.test(text)) {
    locks.push("Cooling system heat rejection failure");
  }

  if (/burning smell|smell burning|electrical smell|plastic smell|olor a quemado/.test(text)) {
    locks.push("Heat, friction, oil leak, belt slip, brake drag, or electrical overheating path");
  }

  if (/no start|won't start|does not start|crank|click|arranca|enciende/.test(text)) {
    locks.push("No-start path: battery, starter, crank signal, fuel, ignition, or security authorization");
  }

  if (/misfire|rough idle|idle|stumble|stall|stalls/.test(text)) {
    locks.push("Combustion instability: ignition, injector, air leak, compression, timing, or fuel trim path");
  }

  return locks.length ? [...new Set(locks)].join(" | ") : "";
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
