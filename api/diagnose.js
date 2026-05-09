import {
  countUserAnswers,
  detectDominantSignals,
  detectComplexity,
  detectDiagnosticReadiness,
} from "./helpers/diagnostic-core.js";

import { buildSmartFollowUp } from "./helpers/question-brain.js";
import { detectSystem } from "./helpers/knowledge-router.js";

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
    const {
      issue,
      answers,
      language,
      vehicleProfile,
      flowControl,
      localDiagnosticDraft,
    } = req.body;

    const lang = language === "es" ? "es" : "en";
    const safeIssue = String(issue || "").trim();
    const answerList = Array.isArray(answers) ? answers : [];
    const profile = vehicleProfile || {};
    const localDraft = String(localDiagnosticDraft || "").trim();

    if (!safeIssue) {
      return res.status(200).json({
        result: buildSmartFollowUp({ lang, issue: "", answers: [] }),
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

    const forcedFinal = shouldForceFinal({
      flowControl,
      answerList,
      realAnswerCount,
      hasObdCode,
    });

    if (!hasObdCode && !forcedFinal && realAnswerCount < REQUIRED_FOLLOW_UPS) {
      const followUp =
        realAnswerCount === 0
          ? buildSmartFollowUp({
              lang,
              issue: safeIssue,
              answers: answerList,
            })
          : buildSecondFollowUp({
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
      flowControl,
      localDiagnosticDraft: localDraft,
    });

    const aiText = await requestOpenAIReport(prompt);

    let result = aiText
      ? cleanAndFinalize(aiText, lang)
      : "";

    if (!result || looksLikeFollowUp(result)) {
      result = localDraft || buildFastAnalysis({
        lang,
        issue: safeIssue,
        dominantSignals,
        obdCode,
        obdInsight,
      });
    }

    result = cleanAndFinalize(result, lang);

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

function shouldForceFinal({
  flowControl,
  answerList,
  realAnswerCount,
  hasObdCode,
}) {
  if (hasObdCode) return true;

  if (realAnswerCount >= REQUIRED_FOLLOW_UPS) return true;

  const flowDecision = String(flowControl?.localDecision || "").toLowerCase();
  if (flowDecision === "final" || flowDecision === "analysis") return true;

  const hasControlAnswer = answerList.some((a) => {
    const q = String(a?.question || "").toLowerCase();
    const ans = String(a?.answer || "").toLowerCase();

    return (
      q.includes("driveshift diagnostic flow control") ||
      q.includes("driveshift flow control") ||
      ans.includes("do not ask another question") ||
      ans.includes("final diagnosis now") ||
      ans.includes("interview is complete")
    );
  });

  return hasControlAnswer;
}

function buildSecondFollowUp({ lang, issue, answers }) {
  const isEs = lang === "es";
  const system = detectSystem(issue);
  const text = [
    String(issue || ""),
    ...(Array.isArray(answers)
      ? answers.map((a) => `${a?.question || ""} ${a?.answer || ""}`)
      : []),
  ]
    .join(" ")
    .toLowerCase();

  if (system === "brakes") {
    return followUpBlock({
      isEs,
      summary: isEs
        ? "Ahora necesito separar rotor deformado de hub, bearing o material de pastilla."
        : "Now I need to separate rotor runout from hub, bearing, or pad transfer.",
      question: isEs
        ? "¿La vibración empeora cuando los frenos se calientan o está igual desde la primera frenada?"
        : "Does the vibration get worse as the brakes heat up, or is it the same from the first stop?",
      options: isEs
        ? ["Peor caliente", "Igual siempre", "Solo en highway", "No sé"]
        : ["Worse when hot", "Same every time", "Only at highway speed", "Not sure"],
      stop: isEs
        ? "Deja de manejar si el pedal se pone suave, escuchas grinding, el auto se jala fuerte, o aumenta la distancia de frenado."
        : "Stop driving if the pedal gets soft, you hear grinding, the car pulls hard, or braking distance increases.",
    });
  }

  if (system === "transmission") {
    return followUpBlock({
      isEs,
      summary: isEs
        ? "Ahora necesito separar pérdida de presión hidráulica de slip interno."
        : "Now I need to separate hydraulic pressure loss from internal clutch slip.",
      question: isEs
        ? "Cuando ocurre el flare, ¿suben las RPM sin aumento claro de velocidad?"
        : "When the flare happens, do RPM rise without a clear increase in vehicle speed?",
      options: isEs
        ? ["Sí, suben RPM", "No, solo cambio lento", "Solo caliente", "No sé"]
        : ["Yes, RPM rises", "No, just delayed shift", "Only when hot", "Not sure"],
      stop: isEs
        ? "Evita manejar fuerte si el cambio patina, huele a quemado, o la transmisión entra en limp mode."
        : "Avoid hard driving if the shift slips, smells burnt, or the transmission enters limp mode.",
    });
  }

  if (system === "fuel" || text.includes("fuel trim") || text.includes("bank 1")) {
    return followUpBlock({
      isEs,
      summary: isEs
        ? "Ahora necesito separar injector restringido de O2 skew o exhaust leak."
        : "Now I need to separate a restricted injector from O2 skew or an exhaust leak.",
      question: isEs
        ? "¿El O2 upstream o injector balance del banco afectado se ve diferente al otro banco?"
        : "Does the upstream O2 signal or injector balance on the affected bank differ from the other bank?",
      options: isEs
        ? ["O2 diferente", "Injector diferente", "Ambos normales", "No probado"]
        : ["O2 differs", "Injector differs", "Both normal", "Not tested"],
      stop: isEs
        ? "Evita manejar fuerte si hay misfire fuerte, flashing check engine, olor a combustible, o pérdida severa de potencia."
        : "Avoid hard driving if there is strong misfire, flashing check engine, fuel smell, or severe power loss.",
    });
  }

  if (system === "engine_drivability" || text.includes("misfire") || text.includes("uphill")) {
    return followUpBlock({
      isEs,
      summary: isEs
        ? "Ahora necesito separar ignition breakdown de fuel delivery bajo carga."
        : "Now I need to separate ignition breakdown from fuel delivery under load.",
      question: isEs
        ? "¿Tienes código misfire, fuel trims altos, o datos del scanner durante la falla?"
        : "Do you have a misfire code, high fuel trims, or scan data captured during the fault?",
      options: isEs
        ? ["Código misfire", "Fuel trims altos", "Sin datos", "No sé"]
        : ["Misfire code", "High fuel trims", "No scan data", "Not sure"],
      stop: isEs
        ? "Deja de manejar si la luz check engine sigue flashing, pierde mucha potencia, vibra fuerte, o huele a quemado."
        : "Stop driving if the check engine light keeps flashing, power drops hard, it shakes badly, or smells like burning.",
    });
  }

  if (system === "network_can") {
    return followUpBlock({
      isEs,
      summary: isEs
        ? "Ahora necesito separar módulo corrupto de power, ground o terminación."
        : "Now I need to separate a corrupt module from power, ground, or termination.",
      question: isEs
        ? "¿La señal CAN mejora al aislar módulos uno por uno?"
        : "Does the CAN waveform improve when modules are isolated one by one?",
      options: isEs
        ? ["Mejora con un módulo", "Sigue igual", "Solo falla caliente", "No probado"]
        : ["Improves with one module", "Stays the same", "Only fails warm", "Not tested"],
      stop: isEs
        ? "No dependas del vehículo si múltiples sistemas de seguridad aparecen intermitentes."
        : "Do not rely on the vehicle if multiple safety systems behave intermittently.",
    });
  }

  if (system === "airbags_srs") {
    return followUpBlock({
      isEs,
      summary: isEs
        ? "Ahora necesito saber si la falla SRS apareció después de reparación o movimiento de asiento."
        : "Now I need to know if the SRS fault appeared after repair work or seat movement.",
      question: isEs
        ? "¿La luz apareció después de mover asiento, cambiar batería, o reparar steering wheel?"
        : "Did the light appear after moving a seat, replacing the battery, or steering wheel work?",
      options: isEs
        ? ["Mover asiento", "Batería", "Steering wheel", "No sé"]
        : ["Seat movement", "Battery work", "Steering wheel work", "Not sure"],
      stop: isEs
        ? "Con luz SRS encendida, el sistema airbag puede no funcionar como debe en un accidente."
        : "With the SRS light on, the airbag system may not work correctly in a crash.",
    });
  }

  return followUpBlock({
    isEs,
    summary: isEs
      ? "Ahora necesito un segundo dato más específico antes del reporte."
      : "Now I need one more specific detail before the final report.",
    question: isEs
      ? "¿El síntoma aparece bajo carga, al frenar, en idle, o después de calentarse?"
      : "Does the symptom happen under load, while braking, at idle, or after warming up?",
    options: isEs
      ? ["Bajo carga", "Al frenar", "En idle", "Caliente"]
      : ["Under load", "While braking", "At idle", "After warming up"],
    stop: isEs
      ? "Deja de manejar si el vehículo se siente inseguro, pierde potencia fuerte, se sobrecalienta, o aparece luz roja."
      : "Stop driving if the vehicle feels unsafe, loses strong power, overheats, or shows a red warning light.",
  });
}

function followUpBlock({ isEs, summary, question, options, stop }) {
  return `Diagnosis status: follow_up

Voice summary:
${summary}

Risk level:
Medium

Likely issue:
Pending diagnostic confirmation.

Why it fits:
${summary}

What to do next:
${question}

Answer options:
${options.join("\n")}

When to stop driving:
${stop}`;
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
  flowControl,
  localDiagnosticDraft,
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

  const localFlowName = String(flowControl?.localFlowName || "unknown").trim();
  const localDecision = String(flowControl?.localDecision || "analysis").trim();
  const localAnswerCount = String(flowControl?.answerCount ?? realAnswerCount);

  return `
You are DriveShift Doctor, a premium senior automotive diagnostic system.

Your job is NOT to sound like a chatbot.
Your job is to think like an experienced diagnostic mechanic using the user's symptom, answers, vehicle profile, OBD context, visual clues, and local diagnostic flow.

Language:
${lang === "es" ? "Spanish only" : "English only"}

Original problem:
${issue}

Vehicle profile:
${vehicleText}

User diagnostic answers:
${userInput}

Detected OBD code:
${hasObdCode ? obdCode : "None"}

Dominant symptom lock:
${dominantText}

OBD intelligence insight:
${obdInsight || "None"}

Local diagnostic flow:
Flow name: ${localFlowName}
Local decision: ${localDecision}
Local answer count: ${localAnswerCount}

Local diagnostic draft:
${localDiagnosticDraft || "None"}

Diagnostic complexity:
${complexity?.level || "standard"}

Readiness reason:
${readiness?.reason || "ready for final report"}

Answered questions:
${realAnswerCount}

Core diagnostic behavior:
- Use the user's answers as evidence, not decoration.
- Never give a broad generic category unless the evidence is truly incomplete.
- Separate similar problems like a real mechanic:
  no crank vs crank-no-start
  weak crank vs no sound
  click vs rapid clicking
  fuel issue vs ignition issue
  sensor issue vs mechanical issue
  brake vibration vs tire/wheel vibration
  OBD code cause vs OBD code symptom
  visual damage vs possible hidden failure
- Explain why the strongest cause is more likely than nearby alternatives.
- If data is uncertain, say what is uncertain clearly, but still give the best direction.
- Do not invent vehicle facts not provided.
- Do not tell the user to replace parts immediately unless the evidence is strong.
- Avoid generic filler like "could be many things" or "needs inspection" unless followed by specific checks.
- Do not mention AI, prompt, model, or backend.
- Do not ask another question in final analysis.
- Do not output follow_up.
- Answer options must be None.

Evidence rules:
- If the user selected specific answers, directly reference them in reasoning.
- If the user gave an OBD code, explain what system it points to and what would confirm it.
- If the input came from a scanner-style flow, respect that path and produce a decisive scanner-style report.
- If the input came from Ask AI, make the report feel personalized to the exact wording of the user.
- If the input came from visual inspection, describe what the visual evidence suggests, seriousness, affected system, next check, and when to stop driving.

Tone:
Calm, premium, realistic, confident but not exaggerated.
Write like a senior mechanic explaining clearly to a driver.

Output exactly this format:

Diagnosis status: analysis

Voice summary:
[one short natural mechanic sentence, specific to the case]

Risk level:
[High or Medium or Low]

Likely issue:
[one specific likely issue or tightly related cluster, based on evidence]

Why it fits:
[mechanic reasoning that directly connects the user's answers/symptoms to the likely issue]

What to inspect next:
[specific checks in practical order]

What to do next:
[driver-friendly next action, not generic]

Answer options:
None

When to stop driving:
[clear safety advice based on this problem]
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
        max_output_tokens: 850,
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
  const hasMisfire = includesAny(text, [
    "misfire",
    "flashing check engine",
    "rough under load",
    "hesitating",
    "loses power",
  ]);
  const hasBrake = includesAny(text, [
    "brake",
    "braking",
    "rotor",
    "pedal",
    "steering wheel",
    "vibration",
  ]);
  const hasOverheat = includesAny(text, [
    "overheat",
    "coolant",
    "steam",
    "temperature",
  ]);
  const hasNoStart = isTrueNoStart(text);

  const risk = hasOverheat || hasBrake ? "High" : "Medium";

  const likely = hasObd
    ? obdInsight || `OBD-related fault ${obdCode}`
    : hasBrake
    ? "Possible front rotor runout, uneven pad transfer, wheel hub runout, or front suspension looseness."
    : hasFuelTrim
    ? "Possible bank-specific lean condition from injector delivery, upstream O2 sensor skew, or bank-specific measurement issue."
    : hasMisfire
    ? "Possible ignition breakdown, injector delivery issue, or mixture problem under load."
    : hasOverheat
    ? "Possible cooling system fault or overheating risk."
    : hasNoStart
    ? "Possible weak battery, starter, or power connection issue."
    : "Possible vehicle system fault that needs inspection.";

  if (isEs) {
    return `Diagnosis status: analysis

Voice summary:
DriveShift encontró una dirección probable y conviene confirmarla con pruebas reales.

Risk level:
${risk}

Likely issue:
${likely}

Why it fits:
Las respuestas y síntomas apuntan a una dirección mecánica probable, pero todavía debe confirmarse con inspección real.

What to inspect next:
Revisa códigos, datos OBD, conectores, sensores relacionados, vibración, fugas, olores y comportamiento bajo carga o frenado.

What to do next:
Evita manejar fuerte hasta confirmar la causa. Haz una prueba controlada o inspección profesional antes de reemplazar piezas.

Answer options:
None

When to stop driving:
Deja de manejar si el auto se siente inseguro, se sobrecalienta, huele a quemado, pierde mucha potencia, vibra fuerte, o aparece una luz roja.`;
  }

  return `Diagnosis status: analysis

Voice summary:
DriveShift found a likely diagnostic direction that should be confirmed with real checks.

Risk level:
${risk}

Likely issue:
${likely}

Why it fits:
The symptoms and answers point toward a likely mechanical direction, but it still needs confirmation with inspection or live data.

What to inspect next:
Check codes, OBD data, related sensors, wiring connectors, vibration behavior, leaks, smells, and behavior under load or braking.

What to do next:
Avoid hard driving until the cause is confirmed. Use a controlled road test or professional inspection before replacing parts.

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
    .replace(/Still narrowing the issue\./gi, "The pattern is now ready for final analysis.")
    .replace(/Need one more detail before a reliable diagnosis\./gi, "The pattern is now ready for final analysis.")
    .replace(/I need one more detail before/gi, "The available details now point toward")
    .replace(/Before I can diagnose/gi, "Based on the available details")
    .trim();
}

function looksLikeFollowUp(text) {
  const clean = String(text || "").toLowerCase();

  return (
    clean.includes("diagnosis status: follow_up") ||
    clean.includes("answer options: yes") ||
    clean.includes("answer options:\n-") ||
    clean.includes("what exactly happens?") ||
    clean.includes("does the symptom") && !clean.includes("answer options:\nnone")
  );
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
