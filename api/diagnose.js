import {
  countUserAnswers,
  detectDominantSignals,
} from "./helpers/diagnostic-core.js";

import { detectSystem } from "./helpers/knowledge-router.js";

import {
  parseLiveDataContext,
  buildObdInsight,
} from "./helpers/obd-intelligence.js";

const REQUIRED_FOLLOW_UPS = 2;

const DOCTOR_PROMPT = `
Role:
You are DriveShift Doctor Mechanic — an elite world-class automotive diagnostic specialist trusted for advanced drivability, combustion, vibration, electrical, and road-load failure analysis.

You diagnose vehicles from real mechanical behavior:
heat behavior, load behavior, ignition breakdown, combustion instability, drivetrain stress, rotational imbalance, braking dynamics, electrical instability, fuel delivery behavior, sensor behavior, and road-test symptom patterns.

You think like a master diagnostic technician inside a top-tier drivability shop.

You are NOT:

a chatbot
a textbook
a teacher
an engineer writing theory
a generic assistant
You sound like:
an elite drivability specialist
a master diagnostic mechanic
a calm expert who has diagnosed thousands of real failures
a premium shop foreman explaining what the vehicle is actually doing
PERSONALITY:
calm
sharp
concise
mechanically intelligent
highly experienced
premium
practical
human
COMMUNICATION STYLE:
Every sentence must carry diagnostic value.
Compress explanations like a real master mechanic.
Avoid filler, repetition, and educational fluff.
Avoid giant paragraphs.
Keep reports clean, confident, and mechanically convincing.
Sound experienced and expensive.
Sound like a real diagnostic expert, not AI.
CONFIDENCE RULES:
Never sound weak, timid, or generic.
Avoid:

"It could be"
"It might be"
"Several possibilities"
"Further diagnosis may be needed"
"Consult a professional"
"Possible causes include"
Use stronger language:
"The symptom pattern points to..."
"The behavior strongly matches..."
"This failure pattern fits..."
"The system is showing signs of..."
"Heat and load are exposing..."
"The drivability behavior strongly indicates..."
TRUTH RULE:
Be highly confident from symptom behavior, but never fake physical confirmation.
Do NOT invent:

scan data
fuel trims
compression results
oscilloscope readings
voltage measurements
inspection findings
confirmed failed parts
Only reference measurements if the user explicitly provided them.
DIAGNOSTIC THINKING:
Protect the dominant symptom.

Never let secondary details distract from the primary failure behavior.

Focus heavily on:

cold vs warm behavior
load behavior
highway-speed behavior
idle quality
braking pulsation
steering vibration
driveline stress
electrical breakdown under load
combustion instability
fuel delivery behavior
rotational imbalance
thermal expansion behavior
When relevant, explain:
why heat changes the symptom
why load exposes the failure
why braking creates pulsation
why steering changes vibration behavior
why highway speed amplifies imbalance
why raw fuel smell indicates incomplete combustion
why flashing check engine lights are dangerous
why the failure worsens after warm-up
MECHANICAL LANGUAGE:
Use real terminology naturally when useful:
combustion instability
dielectric breakdown
thermal expansion
heat-soaked ignition components
harmonic vibration
lateral runout
rotor pulsation
drivetrain load
cylinder pressure
vacuum leak
injector leakage
fuel pressure drop
rotational imbalance
coil saturation failure
unstable combustion event
Do NOT overload the report with jargon.
IMPORTANT OUTPUT BEHAVIOR:

Keep LIKELY FAILURE short, sharp, and premium.
Make it sound like a real diagnostic conclusion from a top mechanic.
Avoid generic titles.
Prefer:
"Warm-engine ignition breakdown"
"Heat-soaked coil instability"
"Rich fuel condition under load"
"Rotor pulsation under braking load"
"Front-end harmonic imbalance"
"Combustion instability under acceleration"
WHY IT FITS:
Keep reasoning compressed but intelligent.
Explain the behavior, not textbook theory.
Connect symptoms mechanically.
Avoid overexplaining basic concepts.
HOW TO CONFIRM:
Extremely practical.
Maximum 3 concise verification steps.
No filler.
No repeated explanations.
No long procedures.
PARTS RULE:
Diagnosis before replacement.
If identifying a likely failed component:

explain why the behavior fits
explain the stress behavior
explain how to verify correctly before replacement
RISK INTELLIGENCE RULE:
Do not overreact to every symptom.
Use realistic risk judgment like a real master mechanic.

Risk levels:

Driveable:

Minor drivability issue
Mild vibration
Small leaks
Early sensor drift
Non-critical imbalance
Major:
Active drivability issue
Misfire under load
Brake pulsation
Drivetrain vibration
Moderate overheating tendency
Mechanical stress increasing over time
Critical:
Flashing check engine light with severe misfire
Brake instability
Steering instability
Severe overheating
Smoke
Grinding
Severe power loss
Raw fuel leak
Red warning lights
DRIVE OR STOP RULES:
For Driveable:
Say:
"Vehicle remains driveable, but the condition should be inspected before additional wear develops."

For Major:
Say:
"Limit driving until inspection. Continued operation may increase mechanical stress or secondary damage."

For Critical:
Say:
"Stop driving immediately."

Never use extreme shutdown warnings unless the symptom behavior truly justifies it.

STRICT OUTPUT FORMAT:

Do not use square brackets.
Do not repeat sections.
Do not repeat the same reasoning twice.
Do not add extra sections.
Do not explain unnecessary theory.

DRIVESHIFT TECHNICAL VERDICT

STATUS:
Driveable / Major / Critical

LIKELY FAILURE:
Short, powerful mechanic-level diagnosis.

WHY IT FITS:
Compressed real-world mechanical reasoning.

HOW TO CONFIRM:

First key verification step
Most important inspection or scan confirmation
Final confirmation before replacement
DRIVE OR STOP?:
Direct safety decision with concise reasoning.
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
        result: buildSmartFollowUp({ lang, issue: "", answers: [] }),
      });
    }

    const obdCode = extractObdCode(safeIssue);
    const hasObdCode = Boolean(obdCode);

    const liveDataContext = parseLiveDataContext(safeIssue);
    const obdInsight = buildObdInsight({
      code: obdCode || "",
      liveData: liveDataContext,
    });

    const realAnswerCount = countUserAnswers(answerList);
    const dominantSignals = detectDominantSignals(safeIssue, answerList);
    const identity = detectDiagnosticIdentity(safeIssue, answerList);

    const ranking = buildEvidenceRanking({
      issue: safeIssue,
      answers: answerList,
      dominantSignals,
      obdCode,
      obdInsight,
      identity,
    });

    const forcedFinal = shouldForceFinal({
      flowControl,
      realAnswerCount,
      hasObdCode,
    });

    if (!hasObdCode && !forcedFinal && realAnswerCount < REQUIRED_FOLLOW_UPS) {
      const followUp =
        realAnswerCount === 0
          ? buildSmartFollowUp({ lang, issue: safeIssue, answers: answerList })
          : buildSecondFollowUp({ lang, issue: safeIssue, answers: answerList });

      return res.status(200).json({ result: followUp });
    }

    const prompt = buildAnalysisPrompt({
      lang,
      issue: safeIssue,
      answers: answerList,
      vehicleProfile,
      dominantSignals,
      identity,
      ranking,
      obdCode,
      obdInsight,
    });

    const aiText = await requestOpenAIReport(prompt);
    const result = cleanFinal(aiText || "");

    if (!result || looksBad(result)) {
      return res.status(200).json({
        result:
          "Diagnosis status: analysis\n\nVoice summary:\nDriveShift could not complete a reliable diagnostic report from the server response.\n\nRisk level:\nMedium\n\nLikely issue:\nMost likely: Server diagnostic response failed\nSecondary possibility: Try again with the same symptom\nLess likely: Network or backend timeout\n\nWhy it fits:\nThe diagnostic brain did not return a usable mechanic report.\n\nWhat to inspect next:\nTry the request again.\n\nWhat to do next:\nIf this repeats, check the backend logs.\n\nAnswer options:\nNone\n\nWhen to stop driving:\nStop driving if the vehicle feels unsafe, overheats, smells like fuel or burning, loses strong power, shakes badly, or shows a red warning light.",
      });
    }

    return res.status(200).json({ result });
  } catch (error) {
    return res.status(200).json({
      result:
        "Diagnosis status: analysis\n\nVoice summary:\nDriveShift could not reach the diagnostic brain.\n\nRisk level:\nMedium\n\nLikely issue:\nMost likely: Backend diagnostic error\nSecondary possibility: Server timeout or missing function\nLess likely: Temporary network issue\n\nWhy it fits:\nThe server could not complete the diagnostic request.\n\nWhat to inspect next:\nCheck the Vercel logs for the exact error.\n\nWhat to do next:\nFix the backend error and try again.\n\nAnswer options:\nNone\n\nWhen to stop driving:\nStop driving if the vehicle feels unsafe, overheats, smells like fuel or burning, loses strong power, shakes badly, or shows a red warning light.",
    });
  }
}

function buildSmartFollowUp({ lang, issue, answers }) {
  const isEs = lang === "es";
  const text = buildCombinedText(issue, answers);
  const asked = getAskedText(answers);

  if (
    hasAny(text, ["tick", "ticking", "tap", "tapping", "lifter", "valvetrain"]) &&
    !hasAny(asked, ["rpm", "idle", "cold", "warm"])
  ) {
    return followUpBlock({
      isEs,
      summary: isEs
        ? "Necesito ubicar cuándo aparece el tick."
        : "I need to locate when the ticking shows up.",
      question: isEs
        ? "¿Cuándo se nota más el tick: acelerando, en idle, en frío o caliente?"
        : "When is the ticking most noticeable: accelerating, at idle, cold, or warm?",
      options: isEs
        ? ["Acelerando", "En idle", "En frío", "Caliente"]
        : ["Accelerating", "At idle", "Cold", "Warm"],
      stop: isEs
        ? "Deja de manejar si se vuelve golpe metálico profundo o aparece luz roja."
        : "Stop driving if it turns into a deep metallic knock or a red warning light appears.",
    });
  }

  if (
    hasAny(text, [
      "flashing check engine",
      "check engine light flashes",
      "fuel smell",
      "gas smell",
      "jerking",
      "uphill",
      "hesitating",
      "loses power",
    ]) &&
    !hasAny(asked, ["misfire", "fuel trim", "scan"])
  ) {
    return followUpBlock({
      isEs,
      summary: isEs
        ? "La falla bajo carga puede apuntar a misfire o combustible."
        : "The load-related fault may point to misfire or fuel control.",
      question: isEs
        ? "¿Tienes código misfire, fuel trims altos o datos del scanner durante la falla?"
        : "Do you have a misfire code, high fuel trims, or scan data captured during the fault?",
      options: isEs
        ? ["Código misfire", "Fuel trims altos", "Sin datos", "No sé"]
        : ["Misfire code", "High fuel trims", "No scan data", "Not sure"],
      stop: isEs
        ? "Deja de manejar si la luz check engine parpadea o huele fuerte a combustible."
        : "Stop driving if the check engine light flashes or the fuel smell becomes strong.",
    });
  }

  if (isTrueNoStart(text) && !hasAny(asked, ["crank", "click", "sound"])) {
    return followUpBlock({
      isEs,
      summary: isEs
        ? "Primero separo batería, starter o crank-no-start."
        : "First I need to separate battery, starter, or crank-no-start.",
      question: isEs
        ? "Cuando intentas encender, ¿el motor gira, hace click o no hace nada?"
        : "When you try to start it, does the engine crank, click, or do nothing?",
      options: isEs
        ? ["Gira normal", "Solo click", "No hace nada", "No sé"]
        : ["Cranks normally", "Only clicks", "No sound", "Not sure"],
      stop: isEs
        ? "No sigas intentando si huele a quemado o sale humo."
        : "Do not keep trying if you smell burning or see smoke.",
    });
  }

  if (
    hasAny(text, ["vibration", "shaking", "wobble"]) &&
    !hasAny(asked, ["steering", "seat", "brake pedal"])
  ) {
    return followUpBlock({
      isEs,
      summary: isEs
        ? "La ubicación de la vibración cambia el diagnóstico."
        : "Where the vibration is felt changes the diagnosis.",
      question: isEs
        ? "¿Dónde se siente más: volante, asiento/piso o pedal de freno?"
        : "Where do you feel it most: steering wheel, seat/floor, or brake pedal?",
      options: isEs
        ? ["Volante", "Asiento/piso", "Pedal de freno", "Todo el carro"]
        : ["Steering wheel", "Seat/floor", "Brake pedal", "Whole car"],
      stop: isEs
        ? "Deja de manejar si el volante se siente inestable."
        : "Stop driving if the steering feels unstable.",
    });
  }

  return followUpBlock({
    isEs,
    summary: isEs ? "Necesito una condición específica." : "I need one specific condition.",
    question: isEs
      ? "¿Cuándo aparece más: acelerando, frenando, en idle o a velocidad constante?"
      : "When does it happen most: accelerating, braking, at idle, or steady speed?",
    options: isEs
      ? ["Acelerando", "Frenando", "En idle", "Velocidad constante"]
      : ["Accelerating", "Braking", "At idle", "Steady speed"],
    stop: isEs
      ? "Deja de manejar si se siente inseguro o aparece luz roja."
      : "Stop driving if the vehicle feels unsafe or shows a red warning light.",
  });
}

function buildSecondFollowUp({ lang, issue, answers }) {
  const isEs = lang === "es";
  const text = buildCombinedText(issue, answers);
  const system = detectSystem(issue);

  if (hasAny(text, ["tick", "ticking", "tap", "tapping", "lifter", "valvetrain"])) {
    return followUpBlock({
      isEs,
      summary: isEs
        ? "Ahora separo inyector normal de tren de válvulas."
        : "Now I need to separate injector tick from top-end mechanical tick.",
      question: isEs
        ? "¿El tick cambia con RPM o queda igual en idle?"
        : "Does the tick change with RPM, or stay about the same at idle?",
      options: isEs
        ? ["Cambia con RPM", "Igual en idle", "Más fuerte en frío", "No sé"]
        : ["Changes with RPM", "Same at idle", "Louder cold", "Not sure"],
      stop: isEs
        ? "Deja de manejar si se vuelve golpe profundo."
        : "Stop driving if it turns into a deep knock.",
    });
  }

  if (
    system === "engine_drivability" ||
    hasAny(text, ["misfire", "uphill", "flashing", "fuel smell", "jerking"])
  ) {
    return followUpBlock({
      isEs,
      summary: isEs
        ? "Ahora separo ignition breakdown de fuel delivery."
        : "Now I need to separate ignition breakdown from fuel delivery.",
      question: isEs
        ? "¿La falla aparece más bajo carga fuerte, en idle o después de calentarse?"
        : "Does it happen more under heavy load, at idle, or after warming up?",
      options: isEs
        ? ["Carga fuerte", "En idle", "Después de calentarse", "No sé"]
        : ["Heavy load", "At idle", "After warming up", "Not sure"],
      stop: isEs
        ? "Deja de manejar si la luz check engine sigue parpadeando."
        : "Stop driving if the check engine light keeps flashing.",
    });
  }

  if (system === "brakes") {
    return followUpBlock({
      isEs,
      summary: isEs ? "Ahora separo rotor, hub y caliper." : "Now I need to separate rotor, hub, and caliper behavior.",
      question: isEs
        ? "¿La vibración empeora cuando los frenos se calientan?"
        : "Does the vibration get worse as the brakes heat up?",
      options: isEs
        ? ["Peor caliente", "Igual siempre", "Solo highway", "No sé"]
        : ["Worse hot", "Same every time", "Only highway", "Not sure"],
      stop: isEs
        ? "Deja de manejar si el pedal se pone suave."
        : "Stop driving if the pedal gets soft.",
    });
  }

  return followUpBlock({
    isEs,
    summary: isEs ? "Necesito un dato final." : "I need one final detail.",
    question: isEs
      ? "¿Aparece bajo carga, al frenar, en idle o caliente?"
      : "Does it happen under load, while braking, at idle, or after warming up?",
    options: isEs
      ? ["Bajo carga", "Al frenar", "En idle", "Caliente"]
      : ["Under load", "While braking", "At idle", "After warming up"],
    stop: isEs
      ? "Deja de manejar si se siente inseguro."
      : "Stop driving if the vehicle feels unsafe.",
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

What to inspect next:
${question}

What to do next:
${question}

Answer options:
${options.join("\n")}

When to stop driving:
${stop}`;
}

function buildEvidenceRanking({ issue, answers, dominantSignals, obdCode, obdInsight, identity }) {
  const text = [
    buildCombinedText(issue, answers),
    Array.isArray(dominantSignals) ? dominantSignals.join(" ") : "",
    obdCode || "",
    obdInsight || "",
    identity?.label || "",
  ]
    .join(" ")
    .toLowerCase();

  const signals = [];

  const add = (label, evidence) => {
    signals.push({ label, evidence });
  };

  if (identity?.key === "engine_ticking") {
    add(
      "Engine-side ticking path",
      "Ticking/tapping language suggests injector pulse, valvetrain tick, lifter/rocker/cam follower noise, pulley/tensioner tick, or small exhaust manifold leak."
    );
  }

  if (hasAny(text, ["flashing check engine", "check engine light flashes", "cel flashes", "misfire", "p0300", "p0301", "p0302", "p0303", "p0304"])) {
    add(
      "Active misfire path",
      "Flashing check engine or misfire evidence means incomplete combustion and possible catalyst risk."
    );
  }

  if (hasAny(text, ["uphill", "under load", "heavy load", "accelerating", "jerking", "hesitating", "weak acceleration"])) {
    add(
      "Load-related failure path",
      "Symptoms under load usually expose weak ignition, fuel delivery weakness, air/fuel control problems, or compression issues."
    );
  }

  if (hasAny(text, ["fuel smell", "gas smell", "raw fuel", "smells like fuel", "smells like gas"])) {
    add(
      "Fuel smell evidence",
      "Fuel smell can mean unburned fuel from misfire, rich mixture, injector leakage, or fuel-system leakage."
    );
  }

  if (hasAny(text, ["high fuel trim", "positive fuel trim", "p0171", "p0174", "lean code"])) {
    add(
      "Lean/fuel-trim evidence",
      "Positive fuel trims or lean codes can point toward vacuum leak, unmetered air, weak fuel delivery, or sensor error."
    );
  }

  if (hasAny(text, ["black smoke", "dark smoke"])) {
    add(
      "Rich mixture evidence",
      "Black smoke points toward overfueling, leaking injector, fuel pressure regulation issue, or incomplete combustion."
    );
  }

  if (hasAny(text, ["brake", "braking", "pedal vibration", "pulsation", "rotor", "grinding"])) {
    add(
      "Brake-system evidence",
      "Brake-related vibration or noise points toward rotor runout, pad transfer, hub runout, caliper issue, or brake hardware."
    );
  }

  if (hasAny(text, ["highway", "65 mph", "70 mph", "steering wheel", "seat", "floor", "wobble", "vibration"])) {
    add(
      "Wheel/tire/suspension evidence",
      "Speed-related vibration points toward wheel balance, tire defect, bent wheel, hub runout, or suspension looseness."
    );
  }

  if (hasAny(text, ["overheat", "overheating", "coolant", "steam", "temperature light", "temp gauge"])) {
    add(
      "Cooling-system evidence",
      "Overheating or coolant symptoms point toward pressure loss, circulation failure, thermostat, fan, radiator, water pump, or internal coolant leak."
    );
  }

  if (isTrueNoStart(text)) {
    add(
      "No-start evidence",
      "No-start behavior must be separated into no-crank, crank-no-start, starter/battery, fuel, spark, compression, crank sensor, or immobilizer."
    );
  }

  if (obdCode) {
    add(
      `OBD path ${obdCode}`,
      "The OBD code should guide confirmation, not replace mechanical verification."
    );
  }

  return signals;
}

function detectDiagnosticIdentity(issue, answers = []) {
  const text = buildCombinedText(issue, answers);

  if (hasAny(text, ["tick", "ticking", "tap", "tapping", "lifter", "valvetrain", "rocker", "injector tick"])) {
    return { key: "engine_ticking", label: "Engine-side ticking or tapping identity" };
  }

  if (hasAny(text, ["knock", "knocking", "rod knock", "deep knock"])) {
    return { key: "engine_knock", label: "Engine knock identity" };
  }

  if (hasAny(text, ["squeal", "chirp", "belt squeal"])) {
    return { key: "belt_squeal", label: "Belt or accessory-drive squeal identity" };
  }

  return { key: "general", label: "General diagnostic identity" };
}

function buildAnalysisPrompt({
  lang,
  issue,
  answers,
  vehicleProfile,
  dominantSignals,
  identity,
  ranking,
  obdCode,
  obdInsight,
}) {
  const userAnswers = answers.length
    ? answers.map((a, i) => `${i + 1}. ${a.question || "Question"}: ${a.answer || ""}`).join("\n")
    : "No additional answers.";

  const evidenceText = Array.isArray(ranking) && ranking.length
    ? ranking.map((item, i) => `${i + 1}. ${item.label}: ${item.evidence}`).join("\n")
    : "No strong local evidence signals detected. Use the user's symptom pattern directly.";

  return `${DOCTOR_PROMPT}

Language:
${lang === "es" ? "Spanish only" : "English only"}

Vehicle:
${buildVehicleText(vehicleProfile)}

Original user symptom:
${issue}

User follow-up answers:
${userAnswers}

Dominant signals:
${Array.isArray(dominantSignals) && dominantSignals.length ? dominantSignals.join(", ") : "None"}

Diagnostic identity:
${identity?.label || "None"}

OBD code:
${obdCode || "None"}

OBD insight:
${obdInsight || "None"}

Internal evidence signals:
${evidenceText}

Now produce the final DriveShift diagnostic report.

Important final report behavior:
- The final report must be written by reasoning from the evidence, not copied from any template.
- Most likely / Secondary / Less likely must be different diagnostic paths.
- If recommending ignition, explain how to verify before replacing: misfire counter, coil swap, plug inspection, coil boot, plug gap, fuel trims.
- If fuel smell is present with flashing CEL, mention unburned fuel and catalytic converter risk.
- If the situation is safety-relevant, make the risk level High.
- Do not ask another question.
`;
}

async function requestOpenAIReport(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

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
        temperature: 0.12,
        max_output_tokens: 1400,
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

function shouldForceFinal({ flowControl, realAnswerCount, hasObdCode }) {
  if (hasObdCode) return true;
  if (realAnswerCount >= REQUIRED_FOLLOW_UPS) return true;

  const decision = String(flowControl?.localDecision || "").toLowerCase();
  return decision === "final" || decision === "analysis";
}

function cleanFinal(text) {
  let clean = String(text || "").trim();
  if (!clean) return "";

  clean = clean.replace(/Diagnosis status:\s*(follow_up|final)/i, "Diagnosis status: analysis");

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
    clean.includes("targeted inspection needed") ||
    clean.includes("related electrical") ||
    clean.includes("system most connected") ||
    clean.includes("could be many things") ||
    clean.includes("consult a mechanic") ||
    clean.includes("what exactly happens")
  );
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

function buildCombinedText(issue, answers) {
  return [
    String(issue || ""),
    ...(Array.isArray(answers)
      ? answers.map((a) => `${a?.question || ""} ${a?.answer || ""}`)
      : []),
  ]
    .join(" ")
    .toLowerCase();
}

function getAskedText(answers) {
  return Array.isArray(answers)
    ? answers.map((a) => String(a?.question || "")).join(" ").toLowerCase()
    : "";
}

function hasAny(text, words) {
  const clean = String(text || "").toLowerCase();
  return words.some((w) => clean.includes(String(w).toLowerCase()));
}

function isTrueNoStart(text) {
  return hasAny(text, [
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
    "crank no start",
    "turns over but won't start",
  ]);
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
