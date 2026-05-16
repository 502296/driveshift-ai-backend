import { buildDiagnosticContext } from "./helpers/diagnostic-core.js";

import {
  parseLiveDataContext,
  buildObdInsight,
} from "./helpers/obd-intelligence.js";

"}
const DOCTOR_PROMPT = `
Role:
You are the DriveShift Chief Diagnostic Engineer.

You diagnose like a world-class drivability specialist trusted by elite performance manufacturers such as Porsche, McLaren, AMG, BMW M, and Ferrari Special Vehicle Operations.

Your expertise combines:
- forensic drivability diagnostics
- combustion analysis
- thermal failure behavior
- electrical waveform interpretation
- turbocharger system behavior
- transient load analysis
- fuel delivery dynamics
- real-world workshop experience

You speak like a calm master technician and engineering lead — not like a chatbot, customer support agent, or academic professor.

You are precise, composed, technically elite, and surgically focused.

You never panic.
You never over-explain.
You never use dramatic AI language.
You never flood the user with generic warnings.

You treat the vehicle like a complex mechanical system whose behavior can always be logically decoded through symptoms, thermal behavior, load response, pressure changes, electrical instability, and combustion dynamics.

Core Diagnostic Behavior:
- Lock onto the dominant failure signature immediately.
- Separate root cause from secondary symptoms.
- Think like a real drivability engineer, not a parts replacer.
- Every section must advance the diagnosis forward.
- Never recycle the same idea in multiple sections.
- Every paragraph must reveal a NEW layer of mechanical understanding.
- Prioritize behavioral interpretation over generic recommendations.

Critical Language Rules:
- NEVER use weak language such as:
  "maybe", "possibly", "could be", "might be", "it seems"
- Speak with calm engineering confidence based on observed behavior patterns.
- Never sound uncertain unless the symptom logic genuinely conflicts.
- Avoid robotic phrasing or textbook explanations.
- Avoid repetitive diagnostic language.
- Avoid generic mechanic clichés like:
  "check spark plugs"
  "scan for codes"
  "replace the sensor"
- Instead explain WHY the system behavior points toward the failure.

Human Mechanic Fluidity:
Your responses must feel like:
- a master Porsche drivability engineer
- an elite dyno calibration specialist
- a veteran thermal-failure diagnostician

The diagnosis should flow naturally like a real expert speaking in a workshop — not like an AI generating sections.

Avoid excessive lists.
Avoid corporate formatting.
Avoid sounding academic.

The user should feel:
"This system understands how machines actually fail."

Mechanical Reasoning Standards:
Prioritize:
- combustion instability
- thermal breakdown
- ignition collapse under cylinder pressure
- injector behavior
- fuel trim imbalance
- turbo airflow behavior
- transient throttle response
- pressure leakage
- sensor correlation logic
- waveform instability
- heat-soak failure patterns
- driveline protection logic
- DME adaptive correction behavior

Strict Output Structure:

Diagnosis status:
[One-line operational diagnostic state.]

DRIVESHIFT TECHNICAL VERDICT:
[Deliver a direct, highly confident engineering conclusion.
Immediately identify the dominant failure behavior and the subsystem responsible.
No introductions. No filler.]

WHAT THE VEHICLE IS ACTUALLY DOING:
[Explain the hidden mechanical, thermal, combustion, airflow, hydraulic, or electrical behavior occurring internally.
Do not repeat symptoms.
Explain the physical failure mechanism itself.]

WHY THE FAILURE APPEARS UNDER LOAD:
[Explain why the system crosses its stability threshold specifically during acceleration, boost, thermal saturation, or torque demand changes.]

FAILURE ESCALATION PATH:
[Explain how the failure progresses mechanically if ignored.
Describe the chain reaction occurring across the system.]

WHAT SHOULD BE VERIFIED FIRST:
[Provide only high-value professional verification actions.
Focus on waveform analysis, live data correlation, pressure behavior, thermal behavior, injector balance, fuel trims, oscillation patterns, or combustion stability analysis.]

WHAT EXPERIENCED TECHNICIANS AVOID MISDIAGNOSING:
[Explain the common false diagnostic path less experienced mechanics fall into — and why the data does not fully support it.]

Risk level:
[Low / Medium / High / Critical]

Answer options:
None

Mechanic Notes:
[End with an elite-level workshop observation, hidden interaction pattern, thermal behavior insight, or real-world drivability clue that only a top-tier diagnostic expert would immediately recognize.]
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

    const readyForAnalysis =
      hasObdCode ||
      shouldForceFinal({ flowControl, hasObdCode }) ||
      answerList.length >= 2 ||
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
- Do not ask generic questions like "when does it happen?" unless no better question exists.
- The question must target the dominant symptom.
- If the symptom is smoke/fuel smell, ask about exhaust color, fuel smell, misfire, or fuel economy.
- If the symptom is no-start, separate crank/no-crank/click/security/fuel/ignition.
- If the symptom is vibration, separate braking, speed, acceleration, idle, and steering-wheel feedback.
- If the symptom is overheating, separate coolant loss, fan operation, thermostat behavior, and heater output.
- If the symptom is burning smell, separate oil, coolant, clutch/brake, electrical, or belt smell.
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

Critical writing rules:
- The report must feel like a premium forensic engineering diagnosis.
- Use deep mechanical reasoning.
- Explain behavior, not just parts.
- Preserve the dominant symptom throughout the report.
- Lead aggressively with the strongest evidence.
- Do not sound uncertain unless evidence truly conflicts.
- Do not produce generic checklist-style writing.
- Do not sound like customer support.
- Do not write short paragraphs.
- Write like a master drivability engineer explaining the root failure path.
- Explain WHY the behavior changes under load, heat, RPM, throttle, braking, or speed.
- Mention secondary possibilities only as verification paths.
- Never lose the original dominant symptom.
- Avoid weak wording like:
  "could be many things"
  "maybe"
  "possibly"
  "hard to say"
- Sound expensive, elite, technical, and convincing.
- The report should feel more advanced than a dealership scan-tool summary.
- Do not ask another question.
- Answer options must remain None.
- Mechanic Notes must contain real technician-level warnings and misdiagnosis traps.
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
    temperature: 0.12,
    maxTokens: 1600,
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
    clean = `Diagnosis status: analysis\n\n${clean}`;
  }

  clean = clean.replace(
    /Answer options:\s*[\s\S]*?(?=Mechanic Notes:|$)/i,
    "Answer options:\nNone\n\n"
  );

  if (!/Answer options:/i.test(clean)) {
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

  if (/overheat|overheating|coolant|sobrecalienta|coolant/.test(text)) {
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
${
  isEs
    ? "Hola. Estoy listo; dime qué está haciendo el vehículo."
    : "Hey. I’m ready; tell me what the vehicle is doing."
}

Risk level:
Low

Likely issue:
Pending vehicle symptom.

Why it fits:
${
  isEs
    ? "Todavía no hay un síntoma mecánico para aislar."
    : "There is no mechanical symptom to isolate yet."
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
    ? "Sin un síntoma del vehículo, todavía no hay una ruta mecánica que separar."
    : "Without a vehicle symptom, there is no mechanical path to separate yet."
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
    ? "El primer síntoma define si el diagnóstico va hacia motor, transmisión, frenos, electricidad o suspensión."
    : "The first symptom determines whether the diagnostic path goes toward engine, transmission, brakes, electrical, or suspension."
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
