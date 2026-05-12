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
You are DriveShift Doctor, a premium senior automotive diagnostic mechanic.

Rules:
- Do not sound like a chatbot.
- Protect the dominant symptom.
- Rank real components, not vague systems.
- Never say "targeted inspection needed".
- Never say "related electrical, sensor, mechanical, or fluid issue".
- Never say "start with the system most connected".
- Explain WHY the symptom mechanically fits.
- Use calm, practical mechanic language.
- Do not mention AI, prompt, backend, or model.
- Do not ask another question in analysis mode.

Output exactly:

Diagnosis status: analysis

Voice summary:
[one short mechanic sentence]

Risk level:
[High or Medium or Low]

Likely issue:
Most likely: [specific cause]
Secondary possibility: [specific cause]
Less likely: [specific cause]

Why it fits:
[specific mechanical explanation]

What to inspect next:
[specific ordered checks]

What to do next:
[driver-friendly next step]

Answer options:
None

When to stop driving:
[specific safety advice]
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

    const ranking = buildRanking({
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
    let result = cleanFinal(aiText || "");

    if (!result || looksBad(result)) {
      result = buildLocalMechanicReport({
        lang,
        issue: safeIssue,
        answers: answerList,
        ranking,
        identity,
        obdCode,
        obdInsight,
      });
    }

    return res.status(200).json({ result: cleanFinal(result) });
  } catch (error) {
    return res.status(200).json({
      result: buildLocalMechanicReport({
        lang: "en",
        issue: "The vehicle has a symptom that needs diagnostic review.",
        answers: [],
        ranking: null,
        identity: null,
        obdCode: "",
        obdInsight: "",
      }),
    });
  }
}

function buildSmartFollowUp({ lang, issue, answers }) {
  const isEs = lang === "es";
  const text = buildCombinedText(issue, answers);
  const asked = getAskedText(answers);

  if (hasAny(text, ["tick", "ticking", "tap", "tapping", "lifter", "valvetrain"]) && !hasAny(asked, ["rpm", "idle", "cold", "warm"])) {
    return followUpBlock({
      isEs,
      summary: isEs ? "Necesito ubicar cuándo aparece el tick." : "I need to locate when the ticking shows up.",
      question: isEs ? "¿Cuándo se nota más el tick: acelerando, en idle, en frío o caliente?" : "When is the ticking most noticeable: accelerating, at idle, cold, or warm?",
      options: isEs ? ["Acelerando", "En idle", "En frío", "Caliente"] : ["Accelerating", "At idle", "Cold", "Warm"],
      stop: isEs ? "Deja de manejar si se vuelve golpe metálico profundo o aparece luz roja." : "Stop driving if it turns into a deep metallic knock or a red warning light appears.",
    });
  }

  if (hasAny(text, ["flashing check engine", "check engine light flashes", "fuel smell", "gas smell", "jerking", "uphill", "hesitating", "loses power"]) && !hasAny(asked, ["misfire", "fuel trim", "scan"])) {
    return followUpBlock({
      isEs,
      summary: isEs ? "La falla bajo carga puede apuntar a misfire o combustible." : "The load-related fault may point to misfire or fuel control.",
      question: isEs ? "¿Tienes código misfire, fuel trims altos o datos del scanner durante la falla?" : "Do you have a misfire code, high fuel trims, or scan data captured during the fault?",
      options: isEs ? ["Código misfire", "Fuel trims altos", "Sin datos", "No sé"] : ["Misfire code", "High fuel trims", "No scan data", "Not sure"],
      stop: isEs ? "Deja de manejar si la luz check engine parpadea o huele fuerte a combustible." : "Stop driving if the check engine light flashes or the fuel smell becomes strong.",
    });
  }

  if (isTrueNoStart(text) && !hasAny(asked, ["crank", "click", "sound"])) {
    return followUpBlock({
      isEs,
      summary: isEs ? "Primero separo batería, starter o crank-no-start." : "First I need to separate battery, starter, or crank-no-start.",
      question: isEs ? "Cuando intentas encender, ¿el motor gira, hace click o no hace nada?" : "When you try to start it, does the engine crank, click, or do nothing?",
      options: isEs ? ["Gira normal", "Solo click", "No hace nada", "No sé"] : ["Cranks normally", "Only clicks", "No sound", "Not sure"],
      stop: isEs ? "No sigas intentando si huele a quemado o sale humo." : "Do not keep trying if you smell burning or see smoke.",
    });
  }

  if (hasAny(text, ["vibration", "shaking", "wobble"]) && !hasAny(asked, ["steering", "seat", "brake pedal"])) {
    return followUpBlock({
      isEs,
      summary: isEs ? "La ubicación de la vibración cambia el diagnóstico." : "Where the vibration is felt changes the diagnosis.",
      question: isEs ? "¿Dónde se siente más: volante, asiento/piso o pedal de freno?" : "Where do you feel it most: steering wheel, seat/floor, or brake pedal?",
      options: isEs ? ["Volante", "Asiento/piso", "Pedal de freno", "Todo el carro"] : ["Steering wheel", "Seat/floor", "Brake pedal", "Whole car"],
      stop: isEs ? "Deja de manejar si el volante se siente inestable." : "Stop driving if the steering feels unstable.",
    });
  }

  return followUpBlock({
    isEs,
    summary: isEs ? "Necesito una condición específica." : "I need one specific condition.",
    question: isEs ? "¿Cuándo aparece más: acelerando, frenando, en idle o a velocidad constante?" : "When does it happen most: accelerating, braking, at idle, or steady speed?",
    options: isEs ? ["Acelerando", "Frenando", "En idle", "Velocidad constante"] : ["Accelerating", "Braking", "At idle", "Steady speed"],
    stop: isEs ? "Deja de manejar si se siente inseguro o aparece luz roja." : "Stop driving if the vehicle feels unsafe or shows a red warning light.",
  });
}

function buildSecondFollowUp({ lang, issue, answers }) {
  const isEs = lang === "es";
  const text = buildCombinedText(issue, answers);
  const system = detectSystem(issue);

  if (hasAny(text, ["tick", "ticking", "tap", "tapping", "lifter", "valvetrain"])) {
    return followUpBlock({
      isEs,
      summary: isEs ? "Ahora separo inyector normal de tren de válvulas." : "Now I need to separate injector tick from top-end mechanical tick.",
      question: isEs ? "¿El tick cambia con RPM o queda igual en idle?" : "Does the tick change with RPM, or stay about the same at idle?",
      options: isEs ? ["Cambia con RPM", "Igual en idle", "Más fuerte en frío", "No sé"] : ["Changes with RPM", "Same at idle", "Louder cold", "Not sure"],
      stop: isEs ? "Deja de manejar si se vuelve golpe profundo." : "Stop driving if it turns into a deep knock.",
    });
  }

  if (system === "engine_drivability" || hasAny(text, ["misfire", "uphill", "flashing", "fuel smell", "jerking"])) {
    return followUpBlock({
      isEs,
      summary: isEs ? "Ahora separo ignition breakdown de fuel delivery." : "Now I need to separate ignition breakdown from fuel delivery.",
      question: isEs ? "¿La falla aparece más bajo carga fuerte, en idle o después de calentarse?" : "Does it happen more under heavy load, at idle, or after warming up?",
      options: isEs ? ["Carga fuerte", "En idle", "Después de calentarse", "No sé"] : ["Heavy load", "At idle", "After warming up", "Not sure"],
      stop: isEs ? "Deja de manejar si la luz check engine sigue parpadeando." : "Stop driving if the check engine light keeps flashing.",
    });
  }

  if (system === "brakes") {
    return followUpBlock({
      isEs,
      summary: isEs ? "Ahora separo rotor, hub y caliper." : "Now I need to separate rotor, hub, and caliper behavior.",
      question: isEs ? "¿La vibración empeora cuando los frenos se calientan?" : "Does the vibration get worse as the brakes heat up?",
      options: isEs ? ["Peor caliente", "Igual siempre", "Solo highway", "No sé"] : ["Worse hot", "Same every time", "Only highway", "Not sure"],
      stop: isEs ? "Deja de manejar si el pedal se pone suave." : "Stop driving if the pedal gets soft.",
    });
  }

  return followUpBlock({
    isEs,
    summary: isEs ? "Necesito un dato final." : "I need one final detail.",
    question: isEs ? "¿Aparece bajo carga, al frenar, en idle o caliente?" : "Does it happen under load, while braking, at idle, or after warming up?",
    options: isEs ? ["Bajo carga", "Al frenar", "En idle", "Caliente"] : ["Under load", "While braking", "At idle", "After warming up"],
    stop: isEs ? "Deja de manejar si se siente inseguro." : "Stop driving if the vehicle feels unsafe.",
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

function buildRanking({ issue, answers, dominantSignals, obdCode, obdInsight, identity }) {
  const text = [
    buildCombinedText(issue, answers),
    Array.isArray(dominantSignals) ? dominantSignals.join(" ") : "",
    obdCode || "",
    obdInsight || "",
    identity?.label || "",
  ].join(" ").toLowerCase();

  const scores = [];

  const add = (key, label, points, evidence) => {
    const found = scores.find((x) => x.key === key);
    if (found) {
      found.score += points;
      found.evidence.push(evidence);
    } else {
      scores.push({ key, label, score: points, evidence: [evidence] });
    }
  };

  if (identity?.key === "engine_ticking") {
    add("engine_tick", "Injector tick, lifter tap, rocker arm tick, cam follower noise, small exhaust manifold leak, or pulley/tensioner tick", 80, "engine-side ticking identity");
  }

  if (hasAny(text, ["flashing check engine", "check engine light flashes", "cel flashes", "misfire", "p0300", "p0301", "p0302", "p0303", "p0304"])) {
    add("ignition_misfire", "Ignition coil breakdown, spark plug misfire, or cylinder misfire under load", 55, "flashing CEL or misfire evidence");
  }

  if (hasAny(text, ["uphill", "under load", "heavy load", "accelerating", "jerking", "hesitating", "weak acceleration"])) {
    add("ignition_misfire", "Ignition coil breakdown, spark plug misfire, or cylinder misfire under load", 35, "symptom appears under load");
    add("fuel_delivery", "Weak fuel pump, restricted filter, or fuel pressure drop under demand", 22, "load demand can expose fuel delivery weakness");
  }

  if (hasAny(text, ["fuel smell", "gas smell", "raw fuel", "smells like fuel", "smells like gas"])) {
    add("unburned_fuel", "Unburned fuel from incomplete combustion, rich mixture, or leaking injector", 40, "fuel smell is present");
  }

  if (hasAny(text, ["high fuel trim", "positive fuel trim", "p0171", "p0174", "lean code"])) {
    add("lean_condition", "Lean condition from vacuum leak, unmetered air, weak fuel delivery, or sensor error", 34, "fuel trim or lean code evidence");
  }

  if (hasAny(text, ["black smoke", "dark smoke"])) {
    add("rich_condition", "Rich fuel condition, leaking injector, or fuel pressure regulator fault", 55, "black smoke indicates overfueling");
  }

  if (hasAny(text, ["brake", "braking", "pedal vibration", "pulsation", "rotor", "grinding"])) {
    add("brake_system", "Brake rotor runout, pad transfer, caliper drag, hub runout, or brake hardware fault", 45, "brake-related symptom");
  }

  if (hasAny(text, ["highway", "65 mph", "70 mph", "steering wheel", "seat", "floor", "wobble", "vibration"])) {
    add("wheel_tire", "Wheel balance issue, tire defect, bent wheel, hub runout, or suspension looseness", 36, "speed/vibration pattern");
  }

  if (hasAny(text, ["overheat", "overheating", "coolant", "steam", "temperature light", "temp gauge"])) {
    add("cooling_system", "Cooling system leak, thermostat fault, fan issue, water pump problem, or pressure loss", 60, "overheating/coolant symptom");
  }

  if (isTrueNoStart(text)) {
    add("starting_or_crank_no_start", "Battery, starter, relay, fuel delivery, spark, crank sensor, immobilizer, or compression issue", 45, "no-start symptom");
  }

  if (obdCode) {
    add("obd_path", `OBD-confirmed diagnostic path for ${obdCode}`, 38, "OBD code present");
  }

  const valid = scores.filter((x) => x.score > 0).sort((a, b) => b.score - a.score);

  if (!valid.length) {
    return {
      mostLikely: "Primary symptom-based fault in the system matching the operating condition",
      secondary: "A second cause should be ranked only after codes, live data, or inspection",
      lessLikely: "Unrelated systems remain less likely unless new symptoms appear",
      evidence: [],
      raw: [],
    };
  }

  return {
    mostLikely: valid[0].label,
    secondary: valid[1]?.label || "Secondary cause not strong yet without more test data",
    lessLikely: valid[2]?.label || "Less likely unless new evidence appears",
    evidence: valid[0].evidence,
    raw: valid,
  };
}

function detectDiagnosticIdentity(issue, answers = []) {
  const text = buildCombinedText(issue, answers);

  if (hasAny(text, ["tick", "ticking", "tap", "tapping", "lifter", "valvetrain", "rocker", "injector tick"])) {
    return {
      key: "engine_ticking",
      label: "Engine-side ticking or tapping identity",
    };
  }

  if (hasAny(text, ["knock", "knocking", "rod knock", "deep knock"])) {
    return {
      key: "engine_knock",
      label: "Engine knock identity",
    };
  }

  if (hasAny(text, ["squeal", "chirp", "belt squeal"])) {
    return {
      key: "belt_squeal",
      label: "Belt or accessory-drive squeal identity",
    };
  }

  return { key: "general", label: "General diagnostic identity" };
}

function buildLocalMechanicReport({ lang, issue, answers, ranking, identity, obdCode, obdInsight }) {
  const text = buildCombinedText(issue, answers);
  const r = ranking || buildRanking({ issue, answers, dominantSignals: [], obdCode, obdInsight, identity });

  const risk = hasAny(text, [
    "flashing check engine",
    "check engine light flashes",
    "fuel smell",
    "overheat",
    "overheating",
    "burning smell",
    "smoke",
    "brake failure",
    "red warning",
  ])
    ? "High"
    : "Medium";

  let why;
  let inspect;
  let next;
  let stop;

  if (hasAny(text, ["flashing check engine", "fuel smell", "uphill", "under load", "heavy load", "jerking", "hesitating", "misfire"])) {
    why =
      "Jerking under acceleration or uphill load with a flashing check engine light behaves like an active misfire under high cylinder pressure. The fuel smell fits unburned fuel leaving the cylinder when combustion breaks down. Ignition coils and spark plugs often fail first under load, while injector leakage or rich fuel control remains a secondary possibility.";
    inspect =
      "Check stored P0300/P030x codes, live misfire counters, spark plugs, ignition coils, coil boots, plug gaps, injector leakage, fuel pressure, and cylinder-specific fuel trims. If the flashing light continues, inspect catalytic converter temperature and exhaust restriction risk.";
    next =
      "Avoid heavy acceleration and diagnose the misfire path first. Do not keep driving hard with a flashing check engine light because repeated misfire can damage the catalytic converter.";
    stop =
      "Stop driving if the check engine light keeps flashing, the engine shakes heavily, power drops sharply, fuel smell becomes strong, or the exhaust/catalyst area smells extremely hot.";
  } else if (identity?.key === "engine_ticking") {
    why =
      "The dominant symptom is an engine-side tick, which usually follows engine speed. Injector pulse can make a light rhythmic tick. Lifters, rocker arms, cam followers, or oil-control issues can create sharper top-end ticking. A small exhaust manifold leak can also tick, especially cold or under light load.";
    inspect =
      "Use a mechanic's stethoscope to compare injectors, valve cover area, belt tensioner, idler pulleys, alternator, and exhaust manifold. Check oil level and condition, listen for one injector louder than the others, and look for soot near the manifold.";
    next =
      "Drive gently until the sound source is confirmed. If the tick is light and stable, inspect soon. If it becomes deep, metallic, or louder with RPM, inspect immediately.";
    stop =
      "Stop driving if the tick turns into a deep knock, oil pressure warning appears, smoke develops, overheating starts, or power drops strongly.";
  } else if (hasAny(text, ["brake", "braking", "pedal vibration", "rotor", "grinding"])) {
    why =
      "A symptom tied to braking points first toward brake rotor runout, uneven pad transfer, caliper drag, hub runout, or brake hardware movement rather than engine or transmission causes.";
    inspect =
      "Inspect rotor surfaces, rotor runout, hub face runout, caliper slide movement, pad deposits, wheel bearing play, and whether the vibration changes with light versus hard braking.";
    next =
      "Avoid aggressive braking until the brake system is inspected.";
    stop =
      "Stop driving if braking distance increases, the pedal becomes soft, grinding develops, or the vehicle pulls hard while braking.";
  } else if (hasAny(text, ["overheat", "overheating", "coolant", "steam", "temperature"])) {
    why =
      "Overheating or coolant symptoms point toward pressure loss, poor coolant circulation, airflow failure, thermostat problems, water pump issues, or internal coolant leakage.";
    inspect =
      "Pressure test the cooling system, verify coolant level, inspect for leaks, test thermostat operation, cooling fan behavior, radiator flow, water pump circulation, and signs of exhaust gas in coolant.";
    next =
      "Do not drive the vehicle hot. Continued overheating can damage the head gasket, cylinder head, and internal engine components.";
    stop =
      "Stop driving immediately if steam appears, the temperature rises rapidly, coolant empties quickly, or the engine loses power.";
  } else {
    why =
      "The ranking is based on the strongest matching operating condition, symptom behavior, and user answers. The leading cause fits better than unrelated systems because it matches when and how the symptom appears.";
    inspect =
      "Check stored codes, live data, visual evidence, connectors, leaks, sound location, vibration location, and whether the symptom changes with load, idle, speed, braking, heat, or RPM.";
    next =
      "Confirm the leading cause before replacing parts.";
    stop =
      "Stop driving if the vehicle feels unsafe, overheats, smells like burning or fuel, loses strong power, shakes badly, or shows a red warning light.";
  }

  return `Diagnosis status: analysis

Voice summary:
The pattern leans most toward ${r.mostLikely}.

Risk level:
${risk}

Likely issue:
Most likely: ${r.mostLikely}
Secondary possibility: ${r.secondary}
Less likely: ${r.lessLikely}

Why it fits:
${why}

What to inspect next:
${inspect}

What to do next:
${next}

Answer options:
None

When to stop driving:
${stop}`;
}

function buildAnalysisPrompt({ lang, issue, answers, vehicleProfile, dominantSignals, identity, ranking, obdCode, obdInsight }) {
  const userAnswers = answers.length
    ? answers.map((a, i) => `${i + 1}. ${a.question || "Question"}: ${a.answer || ""}`).join("\n")
    : "No additional answers.";

  return `${DOCTOR_PROMPT}

Language:
${lang === "es" ? "Spanish only" : "English only"}

Vehicle:
${buildVehicleText(vehicleProfile)}

Original problem:
${issue}

User answers:
${userAnswers}

Dominant signals:
${Array.isArray(dominantSignals) ? dominantSignals.join(", ") : "None"}

Diagnostic identity:
${identity?.label || "None"}

OBD:
${obdCode || "None"}

OBD insight:
${obdInsight || "None"}

Local ranking:
Most likely: ${ranking?.mostLikely || "None"}
Secondary: ${ranking?.secondary || "None"}
Less likely: ${ranking?.lessLikely || "None"}

Produce the final report now.`;
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
        temperature: 0.06,
        max_output_tokens: 1050,
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
    clean = clean.replace(/Answer options:\s*[\s\S]*?(?=When to stop driving:)/i, "Answer options:\nNone\n\n");
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
