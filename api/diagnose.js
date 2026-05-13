import { buildDiagnosticContext } from "./helpers/diagnostic-core.js";

import {
  parseLiveDataContext,
  buildObdInsight,
} from "./helpers/obd-intelligence.js";

const DOCTOR_PROMPT = `
Role:
You are DriveShift Doctor Mechanic.

You are not an assistant.
You are not an AI chatbot.
You are a world-class drivability and failure-analysis specialist trained to diagnose vehicles from behavioral evidence.

You think like:
- a master diagnostic technician
- a combustion specialist
- an electrical drivability expert
- a high-level dealership foreman
- a real-world mechanic with decades of pattern memory

Your intelligence comes from:
- symptom behavior
- load behavior
- thermal behavior
- cylinder pressure behavior
- combustion instability
- ignition stress behavior
- fuel delivery behavior
- vibration patterns
- smoke behavior
- odor behavior
- warning-light behavior
- OBD insight
- dominant symptom lock
- behavioral reasoning
- mechanical prioritization

You must protect the dominant symptom at all costs.

If black smoke + fuel smell are dominant:
stay centered on combustion failure, overfueling, ignition instability, injector behavior, or fuel pressure behavior.

If overheating is dominant:
stay centered on thermal failure behavior.

If vibration under load is dominant:
stay centered on cylinder pressure stress, ignition collapse, drivetrain instability, or fuel imbalance.

Never drift away from the locked mechanical direction unless the evidence strongly changes.

CRITICAL WRITING RULES:

Do NOT write generic AI explanations.

Do NOT say:
- "could be several things"
- "it may be"
- "possible issue"
- "fuel issue"
- "ignition issue"
- "consult a mechanic"

Instead write like a real diagnostic expert:

Examples of GOOD language:
- "Ignition breakdown under cylinder pressure"
- "Raw fuel is escaping the combustion event"
- "Combustion stability is collapsing under load"
- "The injector pattern suggests fuel over-delivery"
- "The ignition system is failing once cylinder demand rises"
- "The symptom pattern strongly matches load-sensitive misfire behavior"
- "Fuel saturation is occurring during throttle enrichment"
- "The engine is losing combustion efficiency under heavy acceleration"

Your job is NOT to sound careful.
Your job is to sound mechanically accurate.

Truth rules:
- Never invent scan data.
- Never invent measurements.
- Never claim confirmed failed parts.
- Only reason from evidence the user provided.
- Strong reasoning is allowed.
- Fake certainty is forbidden.

DriveShift reports must feel:
- premium
- dangerous-smart
- mechanically elite
- compressed
- highly technical
- human
- real

The report should sound like:
a master mechanic explaining the true failure behavior behind the symptoms.

Final report only.
Never ask another question in analysis mode.
Answer options must always be None.

Strict output format:

Diagnosis status:
analysis

Voice summary:
One short mechanic sentence.

Risk level:
Low / Medium / High

Likely issue:
Mechanic-level failure behavior diagnosis.

Why it fits:
Explain the mechanical behavior under real operating conditions.

What to inspect next:
High-value inspection direction only.

What to do next:
Professional mechanic action path.

Answer options:
None

When to stop driving:
Realistic safety shutdown guidance.
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

    const diagnosticContext = buildDiagnosticContext(safeIssue, answerList);

    const readyForAnalysis =
      hasObdCode ||
      shouldForceFinal({ flowControl, hasObdCode }) ||
      diagnosticContext?.readiness?.readyForAnalysis === true;

    // IMPORTANT:
    // Follow-up mode is handled locally, not by AI.
    // This prevents the AI from mixing a report with a question.
    if (!readyForAnalysis) {
      return res.status(200).json({
        result: buildFollowUpFromContext({
          lang,
          diagnosticContext,
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
        .map(
          (a, i) =>
            `${i + 1}. ${a.question || "Question"}: ${a.answer || ""}`
        )
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
    ? secondary.map((x, i) => `${i + 1}. ${x.title}: ${x.mechanic_summary}`).join("\n")
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
- Use the safety instruction exactly in meaning, but write it naturally.
- Keep the report compressed, premium, and mechanic-level.
- Do not over-explain.
- Do not ask another question.
- Answer options must be None.
- Do not expose JSON to the user.
- Do not mention internal engines, internal context, or prioritization engine.
- Sound like a real master mechanic.
`;
}
function buildFollowUpFromContext({ lang, diagnosticContext }) {
  const isEs = lang === "es";

  const lock = diagnosticContext?.dominant_lock || {};
  const behavior = diagnosticContext?.behavior_reasoning || {};
  const signals = diagnosticContext?.extracted_signals || {};
  const risk = diagnosticContext?.severity || "medium";

  const goal =
    behavior?.next_best_question_goal ||
    "Ask the single question that best separates system direction.";

  const lockedSystem = lock?.locked_system || "general";

  const questionPack = buildQuestionPack({
    isEs,
    lockedSystem,
    signals,
    goal,
  });

  return `Diagnosis status: follow_up

Voice summary:
${questionPack.summary}

Risk level:
${risk === "high" ? "High" : "Medium"}

Likely issue:
Pending diagnostic confirmation.

Why it fits:
${questionPack.why}

What to inspect next:
${questionPack.question}

What to do next:
${questionPack.question}

Answer options:
${questionPack.options.join("\n")}

When to stop driving:
${questionPack.stop}`;
}

function buildQuestionPack({ isEs, lockedSystem, signals, goal }) {
  if (lockedSystem === "fuel_combustion") {
    return {
      summary: isEs
        ? "El patrón apunta a combustión rica o combustible sin quemar."
        : "The pattern points toward rich combustion or unburned fuel behavior.",
      why: isEs
        ? "Humo, olor a combustible o falla bajo carga necesitan separar mezcla rica, misfire y entrega de combustible."
        : "Smoke, fuel odor, or load-related shaking needs separation between rich running, misfire, and fuel delivery.",
      question: isEs
        ? "¿El humo y el olor a combustible empeoran cuando aceleras, o también aparecen en idle?"
        : "Do the smoke and fuel smell get worse when you accelerate, or do they also happen at idle?",
      options: isEs
        ? ["Peor acelerando", "También en idle", "Solo al arrancar", "No sé"]
        : ["Worse accelerating", "Also at idle", "Only on startup", "Not sure"],
      stop: isEs
        ? "Deja de manejar si el olor a combustible es fuerte, la luz check engine parpadea o hay humo pesado."
        : "Stop driving if the fuel smell is strong, the check engine light flashes, or heavy smoke appears.",
    };
  }

  if (lockedSystem === "cooling_overheat") {
    return {
      summary: isEs
        ? "El patrón apunta a riesgo de sobrecalentamiento."
        : "The pattern points toward an overheating risk.",
      why: isEs
        ? "La temperatura y el comportamiento del coolant deciden si es flujo, presión, ventilador o pérdida interna."
        : "Temperature and coolant behavior separate flow, pressure, fan, and internal coolant-loss problems.",
      question: isEs
        ? "¿La temperatura sube en idle, en highway, o en ambos?"
        : "Does the temperature climb at idle, highway speed, or both?",
      options: isEs
        ? ["En idle", "En highway", "En ambos", "No sé"]
        : ["At idle", "At highway speed", "Both", "Not sure"],
      stop: isEs
        ? "Deja de manejar si la temperatura entra en rojo, sale vapor o baja el coolant rápido."
        : "Stop driving if the temperature reaches red, steam appears, or coolant drops quickly.",
    };
  }

  if (lockedSystem === "brake_safety") {
    return {
      summary: isEs
        ? "Primero hay que separar el riesgo de frenos."
        : "The brake-safety path needs to be separated first.",
      why: isEs
        ? "La vibración al frenar puede venir de rotor, pad, hub o problema hidráulico."
        : "Braking vibration can come from rotor, pad, hub, or hydraulic behavior.",
      question: isEs
        ? "¿La vibración se siente más en el volante, el pedal de freno o todo el carro?"
        : "Do you feel the vibration more in the steering wheel, brake pedal, or whole vehicle?",
      options: isEs
        ? ["Volante", "Pedal de freno", "Todo el carro", "No sé"]
        : ["Steering wheel", "Brake pedal", "Whole vehicle", "Not sure"],
      stop: isEs
        ? "Deja de manejar si el pedal se pone suave, el carro jala fuerte o aumenta la distancia de frenado."
        : "Stop driving if the pedal gets soft, the vehicle pulls hard, or stopping distance increases.",
    };
  }

  if (lockedSystem === "electrical_starting") {
    return {
      summary: isEs
        ? "Primero separo no-crank de crank-no-start."
        : "The starting path needs no-crank vs crank-no-start separation.",
      why: isEs
        ? "Click, silencio o crank normal cambian completamente el diagnóstico."
        : "Clicking, silence, or normal cranking changes the diagnostic path completely.",
      question: isEs
        ? "Cuando intentas encender, ¿hace click, gira normal, o no hace nada?"
        : "When you try to start it, does it click, crank normally, or do nothing?",
      options: isEs
        ? ["Solo click", "Gira normal", "No hace nada", "No sé"]
        : ["Only clicks", "Cranks normally", "No sound", "Not sure"],
      stop: isEs
        ? "No sigas intentando si huele a quemado o ves humo."
        : "Do not keep trying if you smell burning or see smoke.",
    };
  }

  if (lockedSystem === "transmission_drivetrain") {
    return {
      summary: isEs
        ? "El patrón apunta a carga, velocidad o tren motriz."
        : "The pattern points toward load, speed, or drivetrain behavior.",
      why: isEs
        ? "Hay que separar si sigue RPM, velocidad del vehículo o carga del acelerador."
        : "The next step is separating whether it follows RPM, vehicle speed, or throttle load.",
      question: isEs
        ? "¿La vibración cambia más con la velocidad del carro, las RPM, o al acelerar?"
        : "Does the vibration change more with vehicle speed, engine RPM, or throttle load?",
      options: isEs
        ? ["Velocidad", "RPM", "Acelerando", "No sé"]
        : ["Vehicle speed", "Engine RPM", "Throttle load", "Not sure"],
      stop: isEs
        ? "Deja de manejar si la vibración se vuelve fuerte o el carro pierde control."
        : "Stop driving if the vibration becomes severe or the vehicle feels unstable.",
    };
  }

  if (signals?.startup_issue) {
    return {
      summary: isEs
        ? "Primero necesito clasificar el arranque."
        : "I need to classify the starting behavior first.",
      why: isEs
        ? "No-crank, crank-no-start y arranca-se-apaga son rutas diferentes."
        : "No-crank, crank-no-start, and starts-then-dies are different diagnostic paths.",
      question: isEs
        ? "¿El motor gira normal, solo hace click, o arranca y se apaga?"
        : "Does the engine crank normally, only click, or start and then die?",
      options: isEs
        ? ["Gira normal", "Solo click", "Arranca y se apaga", "No sé"]
        : ["Cranks normally", "Only clicks", "Starts then dies", "Not sure"],
      stop: isEs
        ? "No sigas intentando si huele a quemado o sale humo."
        : "Do not keep trying if you smell burning or see smoke.",
    };
  }

  return {
    summary: isEs
      ? "Necesito una condición más para separar el sistema correcto."
      : "I need one more condition to separate the correct system.",
    why: isEs
      ? goal
      : goal,
    question: isEs
      ? "¿Cuándo aparece más: acelerando, frenando, en idle o después de calentarse?"
      : "When does it happen most: accelerating, braking, at idle, or after warming up?",
    options: isEs
      ? ["Acelerando", "Frenando", "En idle", "Después de calentarse"]
      : ["Accelerating", "Braking", "At idle", "After warming up"],
    stop: isEs
      ? "Deja de manejar si se siente inseguro o aparece luz roja."
      : "Stop driving if the vehicle feels unsafe or shows a red warning light.",
  };
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

function shouldForceFinal({ flowControl, hasObdCode }) {
  if (hasObdCode) return true;

  const decision = String(flowControl?.localDecision || "").toLowerCase();
  return decision === "final" || decision === "analysis";
}

function cleanAnalysis(text) {
  let clean = String(text || "").trim();
  if (!clean) return "";

  clean = clean.replace(
    /Diagnosis status:\s*follow_up/i,
    "Diagnosis status: analysis"
  );

  if (!/Diagnosis status:/i.test(clean)) {
    clean = `Diagnosis status: analysis\n\n${clean}`;
  }

  if (/Answer options:/i.test(clean)) {
    clean = clean.replace(
      /Answer options:\s*[\s\S]*?(?=When to stop driving:)/i,
      "Answer options:\nNone\n\n"
    );
  } else {
    clean += "\n\nAnswer options:\nNone";
  }

  return clean.trim();
}

function looksBad(text) {
  const clean = String(text || "").toLowerCase();

  return (
    !clean ||
    clean.includes("diagnosis status: follow_up") ||
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

When to stop driving:
Deja de manejar si el vehículo se siente inseguro, se sobrecalienta, huele a combustible o quemado, pierde potencia fuerte, vibra demasiado o muestra una luz roja.`;
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
