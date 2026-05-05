export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ result: "Method not allowed" });
  }

  try {
    const { issue, answers, language, vehicleProfile } = req.body;

    const lang = language === "es" ? "es" : "en";
    const safeIssue = String(issue || "").trim();
    const answerList = Array.isArray(answers) ? answers : [];
    const profile = vehicleProfile || {};

    if (!safeIssue) {
      return res.status(200).json({
        result: fallbackFollowUp(lang),
      });
    }

    const possibleObdCode = safeIssue.match(/\b[PCBU][0-9A-F]{4}\b/i);
    const hasObdCode = Boolean(possibleObdCode);
    const obdCode = hasObdCode ? possibleObdCode[0].toUpperCase() : "";

    const realAnswerCount = countUserAnswers(answerList);
    const complexity = detectComplexity(safeIssue);
    const minimumQuestions = hasObdCode ? 0 : complexity.minimumQuestions;

    const shouldAskFollowUp = !hasObdCode && realAnswerCount < minimumQuestions;

    const userInput =
      answerList.length > 0
        ? answerList
            .map((a, index) => {
              const q = String(a.question || `Question ${index + 1}`).trim();
              const ans = String(a.answer || "").trim();
              return `${index + 1}. ${q}: ${ans}`;
            })
            .join("\n")
        : "No additional answers yet.";

    const vehicleText = buildVehicleText(profile);

    const prompt = `
You are DriveShift Doctor, a calm senior automotive diagnostic mechanic.

You are not a chatbot. You behave like a real diagnostic mechanic:
you ask the right questions first, then give a careful report only when enough information exists.

Language:
${lang === "es" ? "Spanish" : "English"}

Original problem:
${safeIssue}

Vehicle profile:
${vehicleText}

Conversation so far:
${userInput}

Detected OBD code:
${hasObdCode ? obdCode : "None"}

Diagnostic complexity:
${complexity.level}

Required minimum answered questions before final report:
${minimumQuestions}

Current answered questions:
${realAnswerCount}

Current mode:
${shouldAskFollowUp ? "follow_up" : "analysis"}

Rules for follow_up mode:
Ask exactly ONE smart mechanic question.
The question must be specific to the user's problem.
Do not repeat previous questions.
Do not diagnose yet.
Do not give likely causes yet.
Do not give repair steps yet.
If the problem involves AC, ask about idle, compressor engagement, cooling performance, belt noise, RPM drop, or when it cuts out.
If the problem involves airbag/SRS/module, ask about warning light behavior, recent battery work, water intrusion, scan codes, seat connectors, or collision history.
If the problem involves water leaks, ask where water appears, rain/car wash timing, sunroof/drain area, windshield, roof seam, or floor location.
If the problem involves shaking, ask when it happens: idle, braking, acceleration, speed, turning, AC on/off.
If the problem involves warning lights, ask whether steady/flashing and how the vehicle drives.
If the problem involves starting, ask about click/crank/dashboard lights/battery age.

Rules for analysis mode:
Give a professional diagnosis report.
Do not pretend certainty.
Give the most likely issue first.
Explain why it fits the user's symptoms.
Give practical next checks.
Give clear safety advice.
If multiple systems could be involved, mention the top 2 possibilities calmly.

Style:
Calm, practical, premium, human mechanic.
No markdown.
No bullets.
No numbered lists.
Do not mention AI.
Do not say "as an AI".
Do not over-scare the driver.

Output exactly this format:

Diagnosis status: ${shouldAskFollowUp ? "follow_up" : "analysis"}

Voice summary:
[short natural mechanic speech]

Confidence:
[number 0-100]

Risk level:
[High or Medium or Low]

Likely issue:
[if follow_up: Still narrowing the issue. If analysis: short likely issue]

Why it fits:
[if follow_up: Need one more detail before a reliable diagnosis. If analysis: short explanation]

What to do next:
[if follow_up: one clear follow-up question only. If analysis: practical next steps]

When to stop driving:
[clear safety advice]
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.DRIVESHIFT_MODEL || "gpt-4o",
        input: prompt,
        temperature: 0.15,
        max_output_tokens: shouldAskFollowUp ? 360 : 700,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        result: shouldAskFollowUp ? fallbackFollowUp(lang) : fallbackAnalysis(lang),
      });
    }

    let text = extractText(data).trim();

    if (!text) {
      return res.status(200).json({
        result: shouldAskFollowUp ? fallbackFollowUp(lang) : fallbackAnalysis(lang),
      });
    }

    text = normalizeStatusLine(text, shouldAskFollowUp);
    text = ensureRequiredFormat(text, lang, shouldAskFollowUp);

    return res.status(200).json({ result: text });
  } catch (error) {
    return res.status(500).json({
      result: fallbackFollowUp("en"),
    });
  }
}

function countUserAnswers(answers) {
  if (!Array.isArray(answers)) return 0;

  return answers.filter((item) => {
    const answer = String(item?.answer || "").trim().toLowerCase();

    if (!answer) return false;
    if (answer === "not sure") return true;
    if (answer === "no sé") return true;

    return answer.length > 0;
  }).length;
}

function detectComplexity(issue) {
  const text = String(issue || "").toLowerCase();

  const complexWords = [
    "ac",
    "a/c",
    "air conditioning",
    "air conditioner",
    "compressor",
    "cuts out",
    "cutting out",
    "intermittent",
    "sometimes",
    "module",
    "airbag",
    "srs",
    "water",
    "leak",
    "roof",
    "sunroof",
    "electrical",
    "short",
    "misfire",
    "transmission",
    "overheating",
    "stall",
    "dies",
    "shakes",
    "vibration",
  ];

  const highRiskWords = [
    "smoke",
    "burning",
    "overheat",
    "overheating",
    "brake",
    "oil pressure",
    "airbag",
    "srs",
    "stall",
    "dies while driving",
  ];

  const isComplex = complexWords.some((w) => text.includes(w));
  const isHighRisk = highRiskWords.some((w) => text.includes(w));

  if (isHighRisk) {
    return {
      level: "high complexity or safety-sensitive",
      minimumQuestions: 4,
    };
  }

  if (isComplex) {
    return {
      level: "complex symptom",
      minimumQuestions: 4,
    };
  }

  return {
    level: "standard symptom",
    minimumQuestions: 3,
  };
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
  } catch {
    return "";
  }
}

function normalizeStatusLine(text, shouldAskFollowUp) {
  const desired = shouldAskFollowUp
    ? "Diagnosis status: follow_up"
    : "Diagnosis status: analysis";

  let clean = String(text || "").trim();

  if (/Diagnosis status:/i.test(clean)) {
    clean = clean.replace(/Diagnosis status:\s*(follow_up|analysis|final)/i, desired);
  } else {
    clean = `${desired}\n\n${clean}`;
  }

  return clean.trim();
}

function ensureRequiredFormat(text, lang, shouldAskFollowUp) {
  let clean = String(text || "").trim();

  const required = [
    "Diagnosis status:",
    "Voice summary:",
    "Confidence:",
    "Risk level:",
    "Likely issue:",
    "Why it fits:",
    "What to do next:",
    "When to stop driving:",
  ];

  const hasAll = required.every((label) =>
    clean.toLowerCase().includes(label.toLowerCase())
  );

  if (hasAll) return clean;

  return shouldAskFollowUp ? fallbackFollowUp(lang) : fallbackAnalysis(lang);
}

function fallbackFollowUp(lang) {
  if (lang === "es") {
    return `Diagnosis status: follow_up

Voice summary:
Necesito un detalle más antes de darte un diagnóstico confiable.

Confidence:
50

Risk level:
Medium

Likely issue:
Still narrowing the issue.

Why it fits:
La información actual todavía no es suficiente para separar las causas posibles.

What to do next:
¿Cuándo ocurre exactamente el problema: al encender, al manejar, al frenar, al acelerar, o cuando el auto está detenido?

When to stop driving:
Deja de manejar si el auto se siente inseguro, se sobrecalienta, huele a quemado, pierde potencia fuerte, o aparece una luz roja de advertencia.`;
  }

  return `Diagnosis status: follow_up

Voice summary:
I need one more detail before giving you a reliable diagnosis.

Confidence:
50

Risk level:
Medium

Likely issue:
Still narrowing the issue.

Why it fits:
The current information is not enough yet to separate the possible causes.

What to do next:
When exactly does the problem happen: at startup, while driving, when braking, when accelerating, or while the car is sitting still?

When to stop driving:
Stop driving if the car feels unsafe, overheats, smells like burning, loses strong power, or shows a red warning light.`;
}

function fallbackAnalysis(lang) {
  if (lang === "es") {
    return `Diagnosis status: analysis

Voice summary:
DriveShift encontró una posible causa, pero conviene revisar lo básico primero.

Confidence:
60

Risk level:
Medium

Likely issue:
Possible vehicle system fault that needs inspection.

Why it fits:
Los síntomas indican que un sistema del vehículo no está funcionando de forma normal.

What to do next:
Revisa si hay luces en el tablero, sonidos, olores, fugas, pérdida de potencia o vibración. Si continúa, haz un escaneo OBD y una inspección profesional.

When to stop driving:
Deja de manejar si el auto se siente inseguro, se sobrecalienta, vibra fuerte, huele a quemado, o aparece una luz roja de advertencia.`;
  }

  return `Diagnosis status: analysis

Voice summary:
DriveShift found a possible issue, but start with the basic checks first.

Confidence:
60

Risk level:
Medium

Likely issue:
Possible vehicle system fault that needs inspection.

Why it fits:
The symptoms suggest one vehicle system is not behaving normally.

What to do next:
Check for warning lights, sounds, smells, leaks, power loss, or vibration. If it continues, get an OBD scan and a professional inspection.

When to stop driving:
Stop driving if the car feels unsafe, overheats, shakes badly, smells like burning, or shows a red warning light.`;
}
