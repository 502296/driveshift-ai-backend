import { buildDiagnosticContext } from "./helpers/diagnostic-core.js";

import {
  parseLiveDataContext,
  buildObdInsight,
} from "./helpers/obd-intelligence.js";

const DOCTOR_PROMPT = `
Role:
You are the DriveShift Lead Forensic Engineer.

You are a technical authority with 100 years of cumulative mechanical wisdom. You do not speculate; you deduce based on mechanical laws. Your tone is dry, professional, and absolute.

Core Logic:
You analyze the "Failure Chain." You don't see a broken part; you see a breakdown in:
- Kinetic Transfer
- Fluid Dynamics
- Chemical Energy Conversion
- Electromagnetic Field Integrity
- Structural Resonance

Strict Output Format:

Diagnosis status:
analysis

Voice summary:
A clinical, high-level summary of the mechanical state.

Risk level:
Low / Medium / High / Critical

Likely issue:
The precise mechanical failure mechanism.

Why it fits:
Mechanical Correlation: Connect the user's symptoms to the underlying physical failure with zero fluff.

What to inspect next:
Professional-grade diagnostic steps.

What to do next:
The definitive corrective action path.

Answer options:
None

Mechanic Notes:
Professional mechanic observations, hidden failure patterns, verification advice, or critical diagnostic cautions that a skilled technician would mention before replacing parts.
`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ result: "Method not allowed" });
  }

  try {
    const { issue, answers, language, vehicleProfile, flowControl } = req.body;

    const lang = language === "es" ? "es" : "en";
    const safeIssue = String(issue || "").trim();
    const answerList = Array.isArray(answers) ? answers : [];

    if (!safeIssue) {
      const emptyText = await requestOpenAIConversation({ lang, message: "" });
      return res.status(200).json({
        result: emptyText || buildEmptyFollowUp(lang),
      });
    }

    const simpleIntent = detectSimpleIntent(safeIssue);

    if (simpleIntent === "greeting" || simpleIntent === "general_help") {
      const aiText = await requestOpenAIConversation({
        lang,
        message: safeIssue,
      });

      return res.status(200).json({
        result:
          aiText ||
          (simpleIntent === "greeting"
            ? buildGreetingResponse(lang)
            : buildGeneralHelpResponse(lang)),
      });
    }

    const obdCode = extractObdCode(safeIssue);
    const hasObdCode = Boolean(obdCode);

    const liveDataContext = parseLiveDataContext(safeIssue);
    const obdInsight = buildObdInsight({
      code: obdCode || "",
      liveData: liveDataContext,
    });

    const diagnosticContext = buildDiagnosticContext(safeIssue, answerList);

    const readyForAnalysis =
      hasObdCode ||
      shouldForceFinal({ flowControl, hasObdCode }) ||
      diagnosticContext?.readiness?.readyForAnalysis === true;

    if (!readyForAnalysis) {
      const followUpPrompt = buildAIFollowUpPrompt({
        lang,
        issue: safeIssue,
        answers: answerList,
        vehicleProfile,
        diagnosticContext,
        obdCode,
        obdInsight,
      });

      const aiFollowUp = await requestOpenAIReport(followUpPrompt);
      const cleanedFollowUp = cleanFollowUp(aiFollowUp);

      return res.status(200).json({
        result:
          cleanedFollowUp ||
          buildNaturalFallbackFollowUp({
            lang,
            issue: safeIssue,
          }),
      });
    }

    const prompt = buildAnalysisPrompt({
      lang,
      issue: safeIssue,
      answers: answerList,
      vehicleProfile,
      diagnosticContext,
      obdCode,
      obdInsight,
    });

    const aiText = await requestOpenAIReport(prompt);
    const result = cleanAnalysis(aiText);

    if (!result || looksBad(result)) {
      return res.status(200).json({
        result: buildSafeAnalysisFallback(lang),
      });
    }

    return res.status(200).json({ result });
  } catch (error) {
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

  if (clean.split(" ").length <= 4 && !hasVehicleSignal) {
    return "general_help";
  }

  return "vehicle_problem";
}

function buildAIFollowUpPrompt({
  lang,
  issue,
  answers,
  vehicleProfile,
  diagnosticContext,
  obdCode,
  obdInsight,
}) {
  const userAnswers = answers.length
    ? answers
        .map((a, i) => `${i + 1}. ${a.question || "Question"}: ${a.answer || ""}`)
        .join("\n")
    : "No additional answers yet.";

  return `
You are DriveShift, a premium mechanic-level diagnostic assistant.

Ask ONE natural, intelligent follow-up question.
Do not give answer buttons.
Do not mention AI.
Do not produce a final diagnosis yet.

Language:
${lang === "es" ? "Spanish only" : "English only"}

Vehicle:
${buildVehicleText(vehicleProfile)}

Original user symptom:
${issue}

User previous answers:
${userAnswers}

OBD code:
${obdCode || "None"}

OBD insight:
${obdInsight || "None"}

Internal diagnostic context:
${JSON.stringify(diagnosticContext, null, 2)}

Return exactly this format:

Diagnosis status:
follow_up

Voice summary:
One short natural sentence.

Risk level:
Low / Medium / High

Likely issue:
Pending diagnostic confirmation.

Why it fits:
A brief natural explanation of why this question matters.

What to inspect next:
Ask one natural follow-up question only.

What to do next:
Ask the same follow-up question in natural wording.

Answer options:
None

Mechanic Notes:
A short mechanic-level note explaining what this next answer will help separate.
`;
}

function buildAnalysisPrompt({
  lang,
  issue,
  answers,
  vehicleProfile,
  diagnosticContext,
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
  const safety = mechanical?.safety || {};

  return `${DOCTOR_PROMPT}

Language:
${lang === "es" ? "Spanish only" : "English only"}

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

Mechanical prioritization:
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
    ? secondary
        .map((x, i) => `${i + 1}. ${x.title}: ${x.mechanic_summary}`)
        .join("\n")
    : "None"
}

Safety level:
${safety.level || "Medium"}

Safety instruction:
${safety.instruction || "Use realistic safety judgment."}

Critical writing rules:
- Lead with the Primary direction.
- Do not write weak “A or B” language as the main diagnosis.
- Mention secondary paths only as verification or supporting alternatives.
- Keep the report compressed, premium, and mechanic-level.
- Do not ask another question.
- Answer options must be None.
- Mechanic Notes must be practical, sharp, and professional.
- Mechanic Notes should mention hidden failure patterns, verification cautions, or what not to replace too early.
- Do not mention internal engines, internal context, or prioritization engine.
`;
}

async function requestOpenAIConversation({ lang, message }) {
  const prompt = `
You are DriveShift, a premium vehicle diagnostic assistant.

Reply naturally, briefly, and professionally.
Do not ask mechanical diagnostic questions yet.
Do not mention AI.

Language:
${lang === "es" ? "Spanish only" : "English only"}

User message:
${message || "(empty message)"}

Return exactly this format:

Diagnosis status:
follow_up

Voice summary:
A short natural greeting response.

Risk level:
Low

Likely issue:
Pending vehicle symptom.

Why it fits:
The user has not described a vehicle symptom yet.

What to inspect next:
A natural sentence inviting the user to describe the vehicle problem.

What to do next:
A natural sentence inviting the user to describe the vehicle problem.

Answer options:
None

Mechanic Notes:
A vehicle symptom is required before a mechanical failure path can be isolated.
`;

  return requestOpenAIReportWithSettings({
    prompt,
    temperature: 0.35,
    maxTokens: 600,
    timeoutMs: 10000,
  });
}

async function requestOpenAIReport(prompt) {
  return requestOpenAIReportWithSettings({
    prompt,
    temperature: 0.08,
    maxTokens: 1500,
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

function shouldForceFinal({ flowControl, hasObdCode }) {
  if (hasObdCode) return true;

  const decision = String(flowControl?.localDecision || "").toLowerCase();
  return decision === "final" || decision === "analysis";
}

function cleanFollowUp(text) {
  let clean = String(text || "").trim();
  if (!clean) return "";

  clean = clean.replace(/When to stop driving:/gi, "Mechanic Notes:");

  if (!/Diagnosis status:/i.test(clean)) {
    clean = `Diagnosis status: follow_up\n\n${clean}`;
  }

  clean = clean.replace(
    /Diagnosis status:\s*analysis/i,
    "Diagnosis status: follow_up"
  );

  if (/Answer options:/i.test(clean)) {
    clean = clean.replace(
      /Answer options:\s*[\s\S]*?(?=Mechanic Notes:)/i,
      "Answer options:\nNone\n\n"
    );
  } else {
    clean += "\n\nAnswer options:\nNone";
  }

  if (!/Mechanic Notes:/i.test(clean)) {
    clean +=
      "\n\nMechanic Notes:\nThis symptom needs one more operating detail before the failure path can be separated cleanly.";
  }

  return clean.trim();
}

function cleanAnalysis(text) {
  let clean = String(text || "").trim();
  if (!clean) return "";

  clean = clean.replace(/When to stop driving:/gi, "Mechanic Notes:");

  clean = clean.replace(
    /Diagnosis status:\s*follow_up/i,
    "Diagnosis status: analysis"
  );

  if (!/Diagnosis status:/i.test(clean)) {
    clean = `Diagnosis status: analysis\n\n${clean}`;
  }

  if (/Answer options:/i.test(clean)) {
    clean = clean.replace(
      /Answer options:\s*[\s\S]*?(?=Mechanic Notes:)/i,
      "Answer options:\nNone\n\n"
    );
  } else {
    clean += "\n\nAnswer options:\nNone";
  }

  if (!/Mechanic Notes:/i.test(clean)) {
    clean +=
      "\n\nMechanic Notes:\nConfirm base mechanical integrity, voltage stability, and live data before replacing electronic components.";
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

function buildNaturalFallbackFollowUp({ lang, issue }) {
  const isEs = lang === "es";

  return `Diagnosis status: follow_up

Voice summary:
${
  isEs
    ? "Necesito un detalle más para separar la causa real."
    : "I need one more detail to separate the real failure path."
}

Risk level:
Medium

Likely issue:
Pending diagnostic confirmation.

Why it fits:
${
  isEs
    ? "El síntoma todavía necesita una condición de operación más para ubicar el sistema correcto."
    : "The symptom still needs one operating condition before the correct system can be isolated."
}

What to inspect next:
${
  isEs
    ? "Dime cuándo aparece con más claridad y qué cambia cuando aceleras, frenas o mantienes velocidad constante."
    : "Tell me when it shows up most clearly and what changes when you accelerate, brake, or hold steady speed."
}

What to do next:
${
  isEs
    ? "Dime cuándo aparece con más claridad y qué cambia cuando aceleras, frenas o mantienes velocidad constante."
    : "Tell me when it shows up most clearly and what changes when you accelerate, brake, or hold steady speed."
}

Answer options:
None

Mechanic Notes:
${
  isEs
    ? "Ese detalle separa una falla de carga, una falla de combustión, una falla de freno o una vibración de tren motriz antes de cambiar piezas."
    : "That detail separates a load-related fault, combustion fault, brake fault, or drivetrain vibration before parts are replaced."
}`;
}

function buildGreetingResponse(lang) {
  const isEs = lang === "es";

  return `Diagnosis status: follow_up

Voice summary:
${
  isEs
    ? "Hola. Estoy listo cuando quieras; dime qué está haciendo el vehículo."
    : "Hey. I’m ready whenever you are; tell me what the vehicle is doing."
}

Risk level:
Low

Likely issue:
Pending vehicle symptom.

Why it fits:
${
  isEs
    ? "El usuario saludó sin describir todavía un problema del vehículo."
    : "The user greeted DriveShift without describing a vehicle problem yet."
}

What to inspect next:
${isEs ? "Dime qué está haciendo el vehículo." : "Tell me what the vehicle is doing."}

What to do next:
${isEs ? "Dime qué está haciendo el vehículo." : "Tell me what the vehicle is doing."}

Answer options:
None

Mechanic Notes:
${
  isEs
    ? "Sin un síntoma del vehículo, todavía no hay una ruta mecánica que aislar."
    : "Without a vehicle symptom, there is no mechanical path to isolate yet."
}`;
}

function buildGeneralHelpResponse(lang) {
  const isEs = lang === "es";

  return `Diagnosis status: follow_up

Voice summary:
${
  isEs
    ? "Claro. Dime qué está haciendo el vehículo y empezamos."
    : "Of course. Tell me what the vehicle is doing and we’ll start."
}

Risk level:
Low

Likely issue:
Pending vehicle symptom.

Why it fits:
${
  isEs
    ? "El mensaje pide ayuda, pero todavía no incluye un síntoma mecánico específico."
    : "The message asks for help but does not include a specific mechanical symptom yet."
}

What to inspect next:
${isEs ? "Describe el síntoma principal." : "Describe the main symptom."}

What to do next:
${isEs ? "Describe el síntoma principal." : "Describe the main symptom."}

Answer options:
None

Mechanic Notes:
${
  isEs
    ? "El primer síntoma define si el diagnóstico debe ir hacia motor, transmisión, frenos, electricidad o suspensión."
    : "The first symptom determines whether the diagnostic path should go toward engine, transmission, brakes, electrical, or suspension."
}`;
}

function buildEmptyFollowUp(lang) {
  const isEs = lang === "es";

  return `Diagnosis status: follow_up

Voice summary:
${
  isEs
    ? "Estoy listo. Dime qué está haciendo el vehículo."
    : "I’m ready. Tell me what the vehicle is doing."
}

Risk level:
Low

Likely issue:
Pending vehicle symptom.

Why it fits:
${
  isEs
    ? "No hay suficiente información para iniciar el diagnóstico."
    : "There is not enough information to start the diagnostic path."
}

What to inspect next:
${isEs ? "Describe qué está haciendo el vehículo." : "Describe what the vehicle is doing."}

What to do next:
${isEs ? "Describe qué está haciendo el vehículo." : "Describe what the vehicle is doing."}

Answer options:
None

Mechanic Notes:
${
  isEs
    ? "Un diagnóstico útil empieza con el síntoma principal, cuándo ocurre y bajo qué condición."
    : "A useful diagnosis starts with the main symptom, when it happens, and under what operating condition."
}`;
}

function buildSafeAnalysisFallback(lang) {
  const isEs = lang === "es";

  if (isEs) {
    return `Diagnosis status: analysis

Voice summary:
DriveShift no pudo completar un informe confiable desde el servidor.

Risk level:
Medium

Likely issue:
Error de respuesta diagnóstica del servidor.

Why it fits:
El cerebro diagnóstico no devolvió un reporte mecánico utilizable.

What to inspect next:
Intenta enviar el mismo síntoma otra vez.

What to do next:
Si se repite, revisa los logs del backend.

Answer options:
None

Mechanic Notes:
Este es un fallo de respuesta del servidor, no una conclusión mecánica. Revisa los logs antes de cambiar la lógica del diagnóstico.`;
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

Mechanic Notes:
This is a server response failure, not a mechanical conclusion. Check backend logs before changing diagnostic logic.`;
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

Mechanic Notes:
This failure is technical, not mechanical. Confirm the backend route, environment variables, and OpenAI response before testing vehicle logic.`;
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
