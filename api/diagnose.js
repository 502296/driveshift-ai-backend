import { buildDiagnosticContext } from "./helpers/diagnostic-core.js";

import {
  parseLiveDataContext,
  buildObdInsight,
} from "./helpers/obd-intelligence.js";

const DOCTOR_PROMPT = `
Role:
You are the DriveShift Chief Diagnostic Engineer. You diagnose like a senior forensic drivability and systems engineer trusted by Porsche, Mercedes-Benz AMG, BMW M, Audi RS, and Ferrari Special Vehicle Operations.

Your tone is cold, surgical, ultra-precise, technical, and highly authoritative.

You strictly do NOT sound like:
- A chatbot or generic AI assistant.
- Customer support or an academic textbook.
- A generic mechanic guessing parts or a racing commentator.

You speak like a master German engineering director inside a clean-room premium workshop.

Core Diagnostic Rules (The Genius Layer):
- Absolute Precision: Lock onto the singular dominant mechanical/electronic failure path immediately based on the fluid, thermal, electrical, or load behavior described.
- Forensic Analysis: Interpret how physics, temperature, and hydraulic pressure changes interact to cause the specific symptom.
- Zero Fluff: Eliminate any textbook filler or introductory sentences (e.g., do not start sections with "Based on the data..." or "This issue could happen because..."). Jump straight into the physical mechanism of the failure.
- Never repeat any concept, word, or diagnostic vector across different sections. Every single block must deliver brand-new engineering insight.

Strict Content Constraints:
- Length Constraint: The entire response must be exceptionally compact. The "Final Mechanical Report" section must NOT exceed 3 sentences. All other sections must be limited to 1 or 2 tight, high-impact lines.
- Avoid Melodrama: Never use dramatic warnings, exclamation marks, or patronizing safety lectures. State the technical risk cleanly.

Critical Language Rules:
- Prohibited Words: Never use "maybe", "possibly", "could be", "might be", "it seems", "likely", "potentially", or "suspect". State your diagnostic direction as absolute fact based on the current behavioral data.
- Prohibited Actions: Never give generic consumer advice like "check spark plugs", "scan for codes", "take it to a shop", or "replace the sensor".

Mechanical Reasoning Architecture:
- Treat thermal limits (>200°F/93°C) as fluid-viscosity and solenoid-coil resistance failures.
- Treat instant load-based changes as torque-applied or line-pressure stabilization failures.
- Differentiate clearly between standard automatic torque converters and dual-clutch (PDK/DCT) architecture based on the vehicle model.

Strict Final Output Structure (Do not alter headers):

Diagnosis status:
analysis

Final Mechanical Report:
[Maximum 3 premium sentences explaining exactly how the internal mechanical/hydraulic system is failing under the specific load or thermal conditions.]

Likely issue:
[One short, definitive technical conclusion naming the component or failure path. No fluff.]

Why it fits:
[Maximum 2 lines isolating the single strongest behavioral evidence from the user's data that mathematically or physically proves this failure path.]

What to verify:
[Maximum 2 lines specifying advanced, precise live-data parameters, pressure deltas, or resistance values to log on a high-tier scan tool. No generic checklists.]

Next professional action:
[One clear, advanced technical step such as physical fluid microscopy, specialized solenoid flow tests, or a targeted module adaptation procedure.]

Risk level:
[Low / Medium / High / Critical]

Mechanic Notes:
[One short, elite workshop observation on how this failure behaves or degrades if ignored.]

Answer options:
None
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
    const askedQuestions = extractAskedQuestions(answerList);
    const dominantLock = buildLocalDominantLock(safeIssue, answerList);

    const clientAnswerCount = Number(
      flowControl?.answerCount || answerList.length || 0
    );

    const readyForAnalysis =
      hasObdCode ||
      shouldForceFinal({
        flowControl,
        hasObdCode,
        answerCount: clientAnswerCount,
      }) ||
      clientAnswerCount >= 1 ||
      answerList.length >= 1 ||
      diagnosticContext?.readiness?.readyForAnalysis === true;

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

      const aiFollowUp = await requestOpenAIReport(followUpPrompt);
      const cleanedFollowUp = cleanFollowUp(aiFollowUp, {
        lang,
        issue: safeIssue,
        askedQuestions,
        dominantLock,
      });

      return res.status(200).json({
        result:
          cleanedFollowUp ||
          buildNaturalFallbackFollowUp({
            lang,
            issue: safeIssue,
            dominantLock,
          }),
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

Your job now is NOT to diagnose yet.
Your job is to ask ONE sharp follow-up question that separates the most likely failure path.

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
- Do not repeat or reword any already asked question.
- Do not ask generic questions.
- The question must target the dominant symptom.
- Do not give answer buttons.
- Do not mention AI.
- Do not produce a final diagnosis.

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
Briefly explain why this specific question matters.

What to inspect next:
Ask one natural follow-up question only.

What to do next:
Ask the same follow-up question in natural wording.

Answer options:
None

Mechanic Notes:
A short mechanic-level note explaining what this answer will separate.
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

Dominant symptom lock:
${dominantLock || "None"}

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

FINAL MECHANICAL REPORT MODE:
The diagnostic interview is complete.

Do NOT ask another question.
Do NOT write inspection-only instructions.
Do NOT tell the user to conduct a general inspection.
Do NOT continue follow-up mode.
Do NOT return a workshop checklist as the main answer.
Do NOT use DRIVESHIFT TECHNICAL VERDICT.
Do NOT use WHAT THE VEHICLE IS ACTUALLY DOING.
Do NOT use WHY THE FAILURE APPEARS UNDER LOAD.
Do NOT create a long engineering essay.

Start the response exactly with:

Diagnosis status:
analysis

Then write the final report using only this structure:

Final Mechanical Report:
Likely issue:
Why it fits:
What to verify:
Next professional action:
Risk level:
Mechanic Notes:
Answer options:
None

Critical writing rules:
- Keep the report compact, premium, and readable.
- Use deep mechanical reasoning without overexplaining.
- Lead with the strongest evidence.
- Preserve the dominant symptom throughout the report.
- Do not ask more questions.
- Do not write a generic checklist.
- Do not sound like customer support.
- Mention secondary possibilities only as verification paths.
- The report should feel more advanced than a dealership scan-tool summary.
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
    temperature: 0.3,
    maxTokens: 600,
    timeoutMs: 10000,
  });
}

async function requestOpenAIReport(prompt) {
  return requestOpenAIReportWithSettings({
    prompt,
    temperature: 0.08,
    maxTokens: 1200,
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

function shouldForceFinal({ flowControl, hasObdCode, answerCount = 0 }) {
  if (hasObdCode) return true;
  if (answerCount >= 1) return true;

  const decision = String(flowControl?.localDecision || "").toLowerCase().trim();

  return (
    decision === "final" ||
    decision === "analysis" ||
    decision === "final_report"
  );
}

function cleanFollowUp(text, { lang, issue, askedQuestions, dominantLock }) {
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

  clean = clean.replace(
    /Answer options:\s*[\s\S]*?(?=Mechanic Notes:|$)/i,
    "Answer options:\nNone\n\n"
  );

  if (!/Answer options:/i.test(clean)) {
    clean += "\n\nAnswer options:\nNone";
  }

  if (!/Mechanic Notes:/i.test(clean)) {
    clean +=
      "\n\nMechanic Notes:\nThis answer separates the dominant failure path before parts are replaced.";
  }

  if (questionLooksRepeated(clean, askedQuestions)) {
    return buildNaturalFallbackFollowUp({ lang, issue, dominantLock });
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
    clean = `Diagnosis status:\nanalysis\n\n${clean}`;
  }

  clean = clean.replace(
    /Answer options:\s*[\s\S]*$/i,
    "Answer options:\nNone"
  );

  if (!/Answer options:/i.test(clean)) {
    clean += "\n\nAnswer options:\nNone";
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
    clean.includes("i am not a mechanic") ||
    clean.includes("i'm not a mechanic")
  );
}

function buildNaturalFallbackFollowUp({ lang, issue, dominantLock }) {
  const isEs = lang === "es";
  const q = buildSmartFallbackQuestion({ lang, issue, dominantLock });

  return `Diagnosis status: follow_up

Voice summary:
${
  isEs
    ? "Necesito un dato más para separar la falla principal."
    : "I need one more detail to separate the main failure path."
}

Risk level:
Medium

Likely issue:
Pending diagnostic confirmation.

Why it fits:
${
  isEs
    ? "Ese detalle define si el problema viene de carga, combustión, combustible, frenos, dirección o tren motriz."
    : "That detail separates whether the fault is coming from load, combustion, fuel delivery, braking, steering, or drivetrain behavior."
}

What to inspect next:
${q}

What to do next:
${q}

Answer options:
None

Mechanic Notes:
${
  isEs
    ? "La respuesta evita cambiar piezas por intuición y dirige la prueba hacia el sistema correcto."
    : "The answer prevents guessing at parts and points the test toward the correct system."
}`;
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

function buildGreetingResponse(lang) {
  const isEs = lang === "es";

  return `Diagnosis status: follow_up

Voice summary:
${isEs ? "Hola. Estoy listo; dime qué está haciendo el vehículo." : "Hey. I’m ready; tell me what the vehicle is doing."}

Risk level:
Low

Likely issue:
Pending vehicle symptom.

Why it fits:
${isEs ? "Todavía no hay un síntoma mecánico para aislar." : "There is no mechanical symptom to isolate yet."}

What to inspect next:
${isEs ? "Dime qué está haciendo el vehículo." : "Tell me what the vehicle is doing."}

What to do next:
${isEs ? "Dime qué está haciendo el vehículo." : "Tell me what the vehicle is doing."}

Answer options:
None

Mechanic Notes:
${isEs ? "Sin un síntoma del vehículo, todavía no hay una ruta mecánica que separar." : "Without a vehicle symptom, there is no mechanical path to separate yet."}`;
}

function buildGeneralHelpResponse(lang) {
  const isEs = lang === "es";

  return `Diagnosis status: follow_up

Voice summary:
${isEs ? "Claro. Dime qué está haciendo el vehículo y empezamos." : "Of course. Tell me what the vehicle is doing and we’ll start."}

Risk level:
Low

Likely issue:
Pending vehicle symptom.

Why it fits:
${isEs ? "El mensaje pide ayuda, pero todavía no incluye un síntoma mecánico específico." : "The message asks for help but does not include a specific mechanical symptom yet."}

What to inspect next:
${isEs ? "Describe el síntoma principal." : "Describe the main symptom."}

What to do next:
${isEs ? "Describe el síntoma principal." : "Describe the main symptom."}

Answer options:
None

Mechanic Notes:
${isEs ? "El primer síntoma يحدد مسار التشخيص." : "The first symptom determines the diagnostic path."}`;
}

function buildEmptyFollowUp(lang) {
  const isEs = lang === "es";

  return `Diagnosis status: follow_up

Voice summary:
${isEs ? "Estoy listo. Dime qué está haciendo el vehículo." : "I’m ready. Tell me what the vehicle is doing."}

Risk level:
Low

Likely issue:
Pending vehicle symptom.

Why it fits:
${isEs ? "No hay suficiente información para iniciar el diagnóstico." : "There is not enough information to start the diagnostic path."}

What to inspect next:
${isEs ? "Describe qué está haciendo el vehículo." : "Describe what the vehicle is doing."}

What to do next:
${isEs ? "Describe qué está haciendo el vehículo." : "Describe what the vehicle is doing."}

Answer options:
None

Mechanic Notes:
${isEs ? "Un diagnóstico útil empieza con el síntoma principal." : "A useful diagnosis starts with the main symptom."}`;
}

function buildSafeAnalysisFallback(lang) {
  const isEs = lang === "es";

  if (isEs) {
    return `Diagnosis status:
analysis

Final Mechanical Report:
DriveShift no pudo completar un informe confiable desde el servidor.

Likely issue:
Error de respuesta diagnóstica del servidor.

Why it fits:
El servidor no devolvió un reporte mecánico utilizable.

What to verify:
Revisa los logs del backend.

Next professional action:
Corrige la respuesta del servidor y prueba otra vez.

Risk level:
Medium

Mechanic Notes:
Este es un fallo técnico, no una conclusión mecánica.

Answer options:
None`;
  }

  return `Diagnosis status:
analysis

Final Mechanical Report:
DriveShift could not complete a reliable final report from the server response.

Likely issue:
Server diagnostic response failed.

Why it fits:
The diagnostic brain did not return a usable mechanic report.

What to verify:
Check the backend logs and OpenAI response.

Next professional action:
Fix the backend response and test again.

Risk level:
Medium

Mechanic Notes:
This is a technical failure, not a mechanical conclusion.

Answer options:
None`;
}

function buildErrorFallback() {
  return `Diagnosis status:
analysis

Final Mechanical Report:
DriveShift could not reach the diagnostic brain.

Likely issue:
Backend diagnostic error.

Why it fits:
The server could not complete the diagnostic request.

What to verify:
Check the route, environment variables, Vercel logs, and OpenAI response.

Next professional action:
Fix the backend error and test again.

Risk level:
Medium

Mechanic Notes:
This failure is technical, not mechanical.

Answer options:
None`;
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
    .replace(/diagnosis status:[\s\S]*?what to inspect next:/i, "")
    .replace(/what to do next:[\s\S]*/i, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildLocalDominantLock(issue, answers) {
  const text = `${issue || ""} ${(answers || [])
    .map((a) => `${a.question || ""} ${a.answer || ""}`)
    .join(" ")}`.toLowerCase();

  const locks = [];

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

  if (/vibration|shake|shaking|vibra|vibración|vibracion/.test(text)) {
    locks.push("Rotational imbalance, engine misfire, brake pulsation, driveline, tire, or mount-related vibration");
  }

  if (/brake|brakes|abs|freno|frenos/.test(text)) {
    locks.push("Brake hydraulic, friction, ABS, rotor, caliper, or wheel-speed signal path");
  }

  if (/steering|wheel pulls|eps|dirección|direccion/.test(text)) {
    locks.push("Steering assist, alignment, suspension geometry, tire pull, or torque sensor path");
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
