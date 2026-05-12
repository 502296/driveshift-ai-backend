import {
  countUserAnswers,
  detectDominantSignals,
  detectComplexity,
  detectDiagnosticReadiness,
} from "./helpers/diagnostic-core.js";

import { detectSystem } from "./helpers/knowledge-router.js";

import {
  parseLiveDataContext,
  buildObdInsight,
} from "./helpers/obd-intelligence.js";

const REQUIRED_FOLLOW_UPS = 2;

const DOCTOR_PROMPT = `
You are DriveShift Doctor, a premium automotive diagnostic intelligence.

You are not a chatbot.
You speak like a calm senior diagnostic mechanic.

Your job:
- Understand the exact symptom pattern.
- Protect the dominant symptom.
- Use the user's answers as evidence.
- Rank real mechanical causes.
- Never give vague filler.
- Never say "targeted inspection needed".
- Never say "related electrical, sensor, mechanical, or fluid issue".
- Never say "start with the system most connected".
- Always name real vehicle systems and components.
- Explain why the symptom mechanically points there.
- Be decisive, practical, and safe without pretending certainty.

Important:
If the user gives flashing check engine light + fuel smell + jerking under load/uphill,
the report must strongly consider:
- ignition coil breakdown under load
- spark plug misfire
- cylinder misfire
- unburned fuel from incomplete combustion
- possible injector/fuel mixture issue
- catalytic converter risk

If the user gives ticking/tapping from engine area,
the report must strongly consider:
- injector tick
- lifter tap
- rocker arm / valvetrain tick
- cam follower noise
- small exhaust manifold leak
- pulley/tensioner noise

Output only this format:

Diagnosis status: analysis

Voice summary:
[one short natural mechanic sentence specific to this case]

Risk level:
[High or Medium or Low]

Likely issue:
Most likely: [specific strongest cause]
Secondary possibility: [specific second cause]
Less likely: [specific third cause]

Why it fits:
[specific explanation tied directly to the user's symptoms and answers]

What to inspect next:
[specific ordered checks]

What to do next:
[driver-friendly next action]

Answer options:
None

When to stop driving:
[specific safety advice]
`;

const STRONG_PATTERNS = [
  {
    name: "flashing_cel_fuel_smell_heavy_load",
    triggers: [
      "flashing check engine",
      "check engine light flashes",
      "cel flashes",
      "flashes briefly",
      "fuel smell",
      "gas smell",
      "raw fuel",
      "smells like fuel",
      "smells like gas",
      "heavy load",
      "under load",
      "uphill",
      "accelerating",
      "jerks",
      "jerking",
      "hesitating",
      "hesitates",
      "loses power",
      "loss of power",
      "weak acceleration",
      "rough under load",
      "misfire code",
    ],
    minimumHits: 3,
    prioritize: [
      {
        key: "ignition_misfire",
        label: "Ignition coil breakdown, spark plug misfire, or cylinder misfire under heavy load",
        boost: 70,
        evidence:
          "flashing check engine light with jerking under load strongly points toward active misfire",
      },
      {
        key: "unburned_fuel",
        label: "Unburned fuel from incomplete combustion during misfire",
        boost: 50,
        evidence:
          "fuel smell fits raw fuel leaving the cylinder when combustion breaks down",
      },
      {
        key: "injector_or_fuel_control",
        label: "Leaking injector, rich mixture, or fuel control fault",
        boost: 24,
        evidence:
          "fuel smell can also come from overfueling or injector leakage",
      },
      {
        key: "catalyst_risk",
        label: "Catalytic converter overheating risk from repeated misfire",
        boost: 18,
        evidence:
          "flashing check engine light means catalyst damage risk is possible",
      },
    ],
    suppress: [
      {
        key: "lean_condition",
        reason:
          "vacuum leak should not outrank misfire when flashing CEL, fuel smell, and load jerking are present",
        penalty: 90,
      },
    ],
  },
  {
    name: "black_smoke_fuel_smell_power_loss",
    triggers: [
      "black smoke",
      "dark smoke",
      "fuel smell",
      "raw fuel",
      "gas smell",
      "smells like fuel",
      "smells like gas",
      "power loss",
      "loses power",
      "poor acceleration",
    ],
    minimumHits: 2,
    prioritize: [
      {
        key: "rich_fuel_condition",
        label: "Rich fuel condition, leaking injector, or fuel pressure regulation fault",
        boost: 60,
        evidence:
          "black smoke with fuel smell strongly points toward overfueling",
      },
      {
        key: "ignition_misfire",
        label: "Ignition misfire leaving fuel unburned",
        boost: 30,
        evidence:
          "misfire can leave raw fuel smell and reduce power",
      },
    ],
  },
  {
    name: "brake_pedal_vibration",
    triggers: [
      "brake",
      "braking",
      "brake pedal",
      "pedal vibration",
      "pulsation",
      "pulsing",
      "rotor",
      "stopping",
      "vibration when braking",
    ],
    minimumHits: 2,
    prioritize: [
      {
        key: "brake_system",
        label: "Brake rotor runout, pad transfer, caliper drag, or hub runout",
        boost: 60,
        evidence:
          "vibration tied to braking points first toward brake rotor, hub, or caliper behavior",
      },
    ],
  },
  {
    name: "highway_vibration_not_braking",
    triggers: [
      "highway",
      "freeway",
      "interstate",
      "high speed",
      "65 mph",
      "70 mph",
      "steering wheel",
      "seat",
      "floor",
      "vibration",
      "shaking",
      "wobble",
    ],
    minimumHits: 3,
    prioritize: [
      {
        key: "wheel_tire_suspension",
        label: "Wheel balance issue, tire defect, bent wheel, hub runout, or loose suspension component",
        boost: 50,
        evidence:
          "steady-speed highway vibration usually comes from rotating wheel, tire, hub, or suspension parts",
      },
    ],
  },
  {
    name: "overheat_coolant_loss",
    triggers: [
      "overheat",
      "overheating",
      "coolant loss",
      "low coolant",
      "coolant",
      "steam",
      "temperature light",
      "temp gauge",
      "coolant smell",
    ],
    minimumHits: 2,
    prioritize: [
      {
        key: "cooling_system",
        label: "Cooling system leak, pressure loss, thermostat fault, fan issue, or water pump problem",
        boost: 70,
        evidence:
          "overheating with coolant symptoms is a high-priority cooling-system pattern",
      },
    ],
  },
  {
    name: "white_smoke_coolant_overheat",
    triggers: [
      "white smoke",
      "sweet smell",
      "coolant smell",
      "coolant loss",
      "low coolant",
      "overheating",
      "overheat",
      "rough start",
    ],
    minimumHits: 3,
    prioritize: [
      {
        key: "head_gasket_or_internal_coolant_leak",
        label: "Possible head gasket leak or internal coolant intrusion",
        boost: 75,
        evidence:
          "white smoke, coolant loss, sweet smell, and overheating together raise concern for internal coolant entry",
      },
    ],
  },
  {
    name: "no_crank_clicking",
    triggers: [
      "no crank",
      "single click",
      "rapid click",
      "clicking",
      "only clicks",
      "starter clicks",
      "lights dim",
      "battery",
    ],
    minimumHits: 2,
    prioritize: [
      {
        key: "starting_system",
        label: "Weak battery, voltage drop, starter motor, relay, or main power connection fault",
        boost: 60,
        evidence:
          "clicking or no-crank behavior points toward starting power and starter control",
      },
    ],
  },
  {
    name: "crank_no_start",
    triggers: [
      "cranks but won't start",
      "cranks but does not start",
      "crank no start",
      "cranks normally",
      "turns over",
      "won't fire",
      "no start",
    ],
    minimumHits: 2,
    prioritize: [
      {
        key: "crank_no_start_path",
        label: "Fuel delivery, spark, injector pulse, compression, crank sensor, or immobilizer issue",
        boost: 58,
        evidence:
          "normal cranking separates this from battery/starter failure and moves diagnosis toward fuel, spark, compression, or security",
      },
    ],
  },
];

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
    const diagnosticIdentity = detectDiagnosticIdentity(safeIssue, answerList);

    const patternMemory = applyPatternMemory({
      issue: safeIssue,
      answers: answerList,
      dominantSignals,
      obdCode,
      obdInsight,
      diagnosticIdentity,
    });

    const localRanking = buildDominantCauseRanking({
      issue: safeIssue,
      answers: answerList,
      dominantSignals,
      obdCode,
      obdInsight,
      patternMemory,
      diagnosticIdentity,
    });

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
      diagnosticIdentity,
      localRanking,
      patternMemory,
      complexity,
      readiness,
      obdCode,
      hasObdCode,
      obdInsight,
      realAnswerCount,
    });

    const aiText = await requestOpenAIReport(prompt);
    let result = aiText ? cleanAndFinalize(aiText, lang) : "";

    if (!result || looksLikeFollowUp(result) || looksGeneric(result)) {
      result =
        localDraft ||
        buildMechanicAnalysis({
          lang,
          issue: safeIssue,
          answers: answerList,
          dominantSignals,
          diagnosticIdentity,
          localRanking,
          patternMemory,
          obdCode,
          obdInsight,
        });
    }

    result = cleanAndFinalize(result, lang);

    if (looksGeneric(result)) {
      result = buildMechanicAnalysis({
        lang,
        issue: safeIssue,
        answers: answerList,
        dominantSignals,
        diagnosticIdentity,
        localRanking,
        patternMemory,
        obdCode,
        obdInsight,
      });
    }

    return res.status(200).json({ result });
  } catch (_) {
    return res.status(200).json({
      result: buildMechanicAnalysis({
        lang: "en",
        issue: "The vehicle has a symptom that needs diagnostic review.",
        answers: [],
        dominantSignals: [],
        diagnosticIdentity: null,
        localRanking: null,
        patternMemory: null,
        obdCode: "",
        obdInsight: "",
      }),
    });
  }
}

function buildMechanicAnalysis({
  lang,
  issue,
  answers,
  dominantSignals,
  diagnosticIdentity,
  localRanking,
  patternMemory,
  obdCode,
  obdInsight,
}) {
  const text = buildCombinedText(issue, answers);

  const ranking =
    localRanking ||
    buildDominantCauseRanking({
      issue,
      answers,
      dominantSignals,
      obdCode,
      obdInsight,
      patternMemory,
      diagnosticIdentity,
    });

  const likely = ranking?.mostLikely || "Mechanical fault pattern detected";
  const secondary =
    ranking?.secondary || "Secondary related system possibility";
  const lessLikely =
    ranking?.lessLikely || "Lower probability causes remain secondary";

  const highRisk = includesAny(text, [
    "flashing check engine",
    "check engine light flashes",
    "overheat",
    "overheating",
    "burning smell",
    "smoke",
    "fuel smell",
    "brake failure",
    "red warning",
  ]);

  const risk = highRisk ? "High" : "Medium";

  let why = "";
  let inspect = "";
  let next = "";
  let stop = "";

  // =========================
  // MISFIRE / LOAD / FUEL
  // =========================

  if (
    includesAny(text, [
      "flashing check engine",
      "fuel smell",
      "uphill",
      "under load",
      "heavy load",
      "jerking",
      "hesitating",
      "misfire",
    ])
  ) {
    why = `
The symptom pattern strongly behaves like an active combustion breakdown under load. 
Jerking during acceleration combined with a flashing check engine light usually points toward a cylinder misfire severe enough to affect combustion stability. 
The fuel smell fits unburned fuel leaving the cylinder when ignition becomes weak under load. 
Ignition coils and spark plugs often fail first during high cylinder pressure situations such as uphill acceleration or heavy throttle demand.
`.trim();

    inspect = `
Start by checking stored misfire codes and live misfire counters. 
Inspect ignition coils, spark plugs, plug condition, coil boots, and cylinder-specific fuel trims. 
Look for one cylinder behaving differently under load. 
If fuel smell is strong, inspect injector leakage and fuel pressure behavior. 
Check for catalyst overheating signs if the flashing check engine light continues.
`.trim();

    next = `
Avoid heavy acceleration until the fault is confirmed. 
The strongest direction currently points toward ignition breakdown or an active cylinder misfire under load. 
Diagnose the misfire before replacing random parts.
`.trim();

    stop = `
Stop driving if the flashing check engine light becomes constant, the engine shakes heavily, power drops sharply, fuel smell becomes strong, or the catalytic converter begins overheating.
`.trim();
  }

  // =========================
  // ENGINE TICK
  // =========================

  else if (
    includesAny(text, [
      "tick",
      "ticking",
      "tap",
      "tapping",
      "valvetrain",
      "lifter",
      "injector tick",
      "rocker",
    ])
  ) {
    why = `
The sound pattern behaves more like an engine-speed-related mechanical tick than a driveline or brake issue. 
Injector pulse can create a light rhythmic ticking sound, while lifters, rocker arms, or cam followers create sharper top-end ticking when clearance or oil control changes. 
A small exhaust manifold leak can also produce a ticking noise, especially near cold start or light acceleration.
`.trim();

    inspect = `
Use a mechanic's stethoscope to compare injector noise, valve cover area, tensioner pulleys, and exhaust manifold areas. 
Inspect oil level and oil condition. 
Look for one injector louder than the others or signs of exhaust soot near the manifold.
`.trim();

    next = `
Drive gently until the sound source is confirmed. 
If the sound stays light and stable, inspect it soon without panic. 
If it becomes deeper, metallic, or louder with RPM, inspect immediately.
`.trim();

    stop = `
Stop driving if the ticking becomes a deep knock, oil pressure warning appears, smoke develops, overheating starts, or power loss becomes severe.
`.trim();
  }

  // =========================
  // BRAKE VIBRATION
  // =========================

  else if (
    includesAny(text, [
      "brake vibration",
      "pedal vibration",
      "vibration while braking",
      "pulsation",
      "rotor",
    ])
  ) {
    why = `
The vibration pattern is directly connected to brake application, which points first toward rotor runout, uneven pad transfer, hub runout, or caliper behavior. 
Brake-related vibration behaves differently from tire imbalance because it changes during brake pressure application.
`.trim();

    inspect = `
Inspect rotor surfaces, hub runout, caliper movement, pad deposits, and wheel bearing play. 
Compare vibration strength between light and heavy braking.
`.trim();

    next = `
Avoid aggressive braking until the brake system is inspected. 
The strongest direction currently points toward brake hardware or rotor-related behavior.
`.trim();

    stop = `
Stop driving if braking distance increases, the pedal becomes soft, grinding develops, or the steering becomes unstable during braking.
`.trim();
  }

  // =========================
  // OVERHEAT
  // =========================

  else if (
    includesAny(text, [
      "overheat",
      "overheating",
      "coolant",
      "steam",
      "temperature",
    ])
  ) {
    why = `
The pattern points toward cooling-system pressure loss, coolant circulation failure, airflow problems, or internal coolant leakage. 
Coolant loss combined with overheating is considered safety-relevant until proven otherwise.
`.trim();

    inspect = `
Pressure test the cooling system. 
Inspect coolant level, radiator flow, thermostat operation, cooling fan behavior, water pump circulation, and external leaks.
`.trim();

    next = `
Avoid driving the vehicle hot. 
Continued overheating can quickly damage head gaskets, cylinder heads, and internal engine components.
`.trim();

    stop = `
Stop driving immediately if steam appears, coolant temperature climbs rapidly, coolant empties quickly, or the engine begins losing power.
`.trim();
  }

  // =========================
  // GENERIC BUT STILL MECHANICAL
  // =========================

  else {
    why = `
The symptom pattern currently points toward the strongest ranked mechanical direction based on the user's answers, dominant symptom behavior, and operating conditions. 
The leading cause remains ahead because it matches the way the symptom changes under load, speed, idle, heat, sound behavior, vibration behavior, or system response.
`.trim();

    inspect = `
Inspect the highest-ranked system first using live data, visual inspection, stored codes, sound location, connector condition, leak checks, and operating-condition testing.
`.trim();

    next = `
Focus on confirming the strongest mechanical direction before replacing parts. 
Avoid random part replacement without verification.
`.trim();

    stop = `
Stop driving if the symptom becomes severe, unsafe, produces smoke or burning smell, creates strong vibration, overheats, or triggers a red warning light.
`.trim();
  }

  return `Diagnosis status: analysis

Voice summary:
The symptom pattern leans most toward ${likely}.

Risk level:
${risk}

Likely issue:
Most likely: ${likely}
Secondary possibility: ${secondary}
Less likely: ${lessLikely}

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

function buildAnalysisPrompt({
  lang,
  issue,
  answers,
  vehicleProfile,
  dominantSignals,
  diagnosticIdentity,
  localRanking,
  patternMemory,
  complexity,
  readiness,
  obdCode,
  hasObdCode,
  obdInsight,
  realAnswerCount,
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

  return `
${DOCTOR_PROMPT}

Language:
${lang === "es" ? "Spanish only" : "English only"}

Original problem:
${issue}

Vehicle profile:
${vehicleText}

User answers:
${userInput}

OBD code:
${hasObdCode ? obdCode : "None"}

OBD insight:
${obdInsight || "None"}

Dominant signals:
${dominantSignals.join(", ") || "None"}

Diagnostic identity:
${diagnosticIdentity?.label || "None"}

Local ranking:
Most likely: ${localRanking?.mostLikely || "None"}
Secondary: ${localRanking?.secondary || "None"}
Less likely: ${localRanking?.lessLikely || "None"}

Complexity:
${complexity?.level || "standard"}

Readiness:
${readiness?.reason || "ready"}

Answered questions:
${realAnswerCount}

Final instructions:
- Sound like a real senior mechanic.
- Do not sound like AI.
- Never use vague filler language.
- Always explain WHY mechanically.
- Always mention real systems/components.
- Keep the dominant symptom protected.
- Never flatten all causes equally.
- Never output generic inspection wording.
`;
}

function cleanAndFinalize(text, lang) {
  let clean = String(text || "").trim();

  clean = normalizeStatus(clean);
  clean = ensureAnswerOptionsNone(clean);
  clean = removeGenericLanguage(clean);
  clean = removeFollowUpLanguage(clean);

  return clean.trim();
}

function removeGenericLanguage(text) {
  return String(text || "")
    .replace(/targeted inspection needed/gi, "")
    .replace(/related electrical, sensor, mechanical, or fluid issue/gi, "")
    .replace(/start with the system most connected/gi, "")
    .replace(/main symptom and the user’s answers point/gi, "")
    .replace(/strongest mechanical direction/gi, "")
    .replace(/related issue/gi, "")
    .replace(/mechanical direction/gi, "")
    .trim();
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
    .replace(/need one more detail/gi, "")
    .replace(/still narrowing/gi, "")
    .replace(/before i can diagnose/gi, "")
    .replace(/could be many things/gi, "")
    .trim();
}

function looksGeneric(text) {
  const clean = String(text || "").toLowerCase();

  const bad = [
    "targeted inspection needed",
    "related electrical",
    "main symptom points",
    "strongest mechanical direction",
    "related issue",
    "system most connected",
  ];

  return bad.some((x) => clean.includes(x));
}

function looksLikeFollowUp(text) {
  const clean = String(text || "").toLowerCase();

  return (
    clean.includes("diagnosis status: follow_up") ||
    clean.includes("answer options: yes") ||
    clean.includes("what exactly happens")
  );
}

function applyPatternMemory({
  issue,
  answers,
  dominantSignals,
  obdCode,
  obdInsight,
  diagnosticIdentity,
}) {
  const text = [
    buildCombinedText(issue, answers),
    Array.isArray(dominantSignals) ? dominantSignals.join(" ") : "",
    String(obdCode || ""),
    String(obdInsight || ""),
    diagnosticIdentity?.label || "",
  ]
    .join(" ")
    .toLowerCase();

  const matched = [];

  for (const pattern of STRONG_PATTERNS) {
    const hits = pattern.triggers.filter((trigger) =>
      text.includes(trigger.toLowerCase())
    );

    if (hits.length >= pattern.minimumHits) {
      matched.push({
        name: pattern.name,
        hits,
        prioritize: pattern.prioritize || [],
        suppress: pattern.suppress || [],
      });
    }
  }

  return {
    matched,
    hasMatches: matched.length > 0,
  };
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

function includesAny(text, words) {
  const clean = String(text || "").toLowerCase();
  return words.some((w) => clean.includes(String(w).toLowerCase()));
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
    "crank no start",
    "turns over but won't start",
  ];

  return phrases.some((p) => clean.includes(p));
}
