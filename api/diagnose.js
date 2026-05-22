import { buildDiagnosticContext } from "./helpers/diagnostic-core.js";

import {
  parseLiveDataContext,
  buildObdInsight,
} from "./helpers/obd-intelligence.js";

const REQUIRED_FOLLOW_UPS = 2;
const MAX_FOLLOW_UPS = 3;

const DOCTOR_PROMPT = `
Role:
You are DriveShift, an elite master automotive diagnostician trusted for difficult drivability, transmission, suspension, and engine failure analysis.

You speak like a veteran lead technician from a premium diagnostic shop — calm, sharp, observant, and highly experienced.

Your reports must feel expensive, intelligent, and mechanically convincing from the first read.

Core Diagnostic Philosophy:
- Diagnose using real mechanical behavior, not generic AI assumptions.
- Connect symptoms through load, heat, RPM, throttle input, drivetrain stress, rotational frequency, hydraulic pressure, vibration behavior, fluid condition, and thermal changes.
- Think like a real drivability specialist investigating the root mechanical behavior behind the complaint.
- Prioritize symptom correlation over random possibility lists.
- The strongest symptom always controls the diagnosis direction.
- Speak with confidence and mechanical clarity.
- Never sound robotic, academic, or overly technical for no reason.
- Never use fear-based language.
- Never mention AI.
- Never use markdown bold.
- Never repeat confirmed symptoms back to the user unnecessarily.
- Avoid generic phrases like:
  "it could be"
  "possibly"
  "maybe"
  "consult a mechanic"

Professional Style Rules:
- Your tone must feel premium, expensive, and real.
- The report should sound like it came from a top-tier diagnostic foreman or transmission specialist.
- Every section must feel observational and experience-based.
- Avoid textbook explanations.
- Avoid sounding like ChatGPT.
- Do not overload the report with unnecessary detail.
- Do not make the report too short.
- Keep the flow smooth, intelligent, and highly readable.
- The user should feel:
  "This system truly understands vehicle behavior."

Follow-Up Rules:
- Never ask more than 2 focused follow-up questions normally.
- A 3rd question is allowed only if the case is genuinely unclear.
- After 3 answers maximum, you MUST stop and generate the final report.
- Never repeat a confirmed symptom.
- Never re-ask about load, heat, acceleration, uphill driving, RPM behavior, flashing lights, vibration, braking behavior, or fluid leaks once already confirmed.
- Every follow-up question must narrow the diagnosis meaningfully.
- Weak or repetitive questions are forbidden.

Final Response Rules:
- The final report must ALWAYS include ALL required sections.
- Every section must provide real diagnostic value.
- Do not generate shallow one-line explanations.
- Explain WHY the mechanical behavior matches the suspected failure.
- Explain WHY weaker explanations were ruled out.
- Reports should feel structured, premium, and convincing.

Final response format:

Primary Verdict:
[One strong professional sentence identifying the most likely mechanical failure.]

Voice Summary:
[3-5 natural premium technician-style sentences explaining the situation calmly and professionally.]

Failure Behavior Analysis:
[Explain the actual mechanical behavior causing the symptoms. Connect heat, load, RPM, vibration, fluid behavior, rotational stress, or pressure loss to the failure.]

Why The Logic Holds:
[Explain why the user's answers strongly support this diagnosis over weaker alternatives.]

Recommended Verification Path:
1. [Most important inspection or scan step]
2. [Specific mechanical confirmation test]
3. [Critical verification before replacing parts]

Mechanic Insight:
[One high-level technician insight, hidden symptom, or experienced-based observation related to this failure.]

Answer options:
None
`;

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(200).json({
        result: buildGeneralHelpResponse("en"),
      });
    }

    const { issue, answers, language, vehicleProfile } = req.body || {};

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

    // IMPORTANT:
    // Do not trust Flutter flowControl count.
    // The backend must count real saved answers only.
    const answerCount = answerList.length;

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
      answerCount >= REQUIRED_FOLLOW_UPS ||
      answerCount >= MAX_FOLLOW_UPS;

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
        answerCount,
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
    "car", "vehicle", "engine", "transmission", "brake", "brakes", "tire", "tires",
    "battery", "alternator", "starter", "noise", "sound", "shake", "shaking",
    "vibration", "vibrates", "smoke", "fuel", "gas", "oil", "coolant", "overheat",
    "overheating", "warning", "light", "check engine", "abs", "airbag", "steering",
    "suspension", "idle", "rpm", "start", "starts", "starting", "won't start",
    "no start", "misfire", "stall", "stalls", "stalled", "dies", "leak", "leaking",
    "burning", "smell", "throttle", "acceleration", "accelerating", "crank", "click",
    "clunk", "grind", "grinding", "coche", "carro", "auto", "motor", "freno", "frenos",
    "batería", "bateria", "arranca", "enciende", "humo", "gasolina", "aceite",
    "sobrecalienta", "vibra", "vibración", "vibracion", "ruido", "luz", "testigo"
  ];

  const hasVehicleSignal = vehicleWords.some((word) => clean.includes(word));
  if (hasVehicleSignal) return "vehicle_problem";

  const greetings = [
    "hi", "hello", "hey", "hey there", "good morning", "good afternoon",
    "good evening", "how are you", "whats up", "what's up", "hola", "buenos dias",
    "buenos días", "buenas tardes", "buenas noches"
  ];

  if (greetings.includes(clean)) return "greeting";

  const generalHelpPhrases = [
    "can you help me", "i need help", "help me", "i have a question", "question",
    "need help", "puedes ayudarme", "necesito ayuda", "ayudame", "ayúdame", "tengo una pregunta"
  ];

  if (generalHelpPhrases.includes(clean)) return "general_help";
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
  answerCount,
}) {
  const userAnswers = answers.length
    ? answers
        .map((a, i) => `${i + 1}. ${a.question || "Question"}: ${a.answer || ""}`)
        .join("\n")
    : "No additional answers yet.";

  return `
You are DriveShift, a premium mechanic-level diagnostic brain.

Ask ONE short, focused follow-up question only.

Language:
${lang === "es" ? "Spanish only" : "English only"}

Original user symptom:
${issue}

Previous answers:
${userAnswers}

Already asked questions:
${askedQuestions.length ? askedQuestions.join("\n") : "None"}

Current answer count:
${answerCount}

Hard rules:
- Ask exactly ONE question.
- Do not diagnose yet.
- Do not repeat any previous question.
- Do not ask about a symptom already confirmed by the user.
- If the user already confirmed load, heat, acceleration, uphill, RPM, flashing light, braking, vibration, or throttle behavior, do not ask about that same signal again.
- The next question must reduce uncertainty, not repeat the case.
- Keep the question short and natural.
- Return only this format:

Diagnosis status:
follow_up

Question:
[question]
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

  return `
${DOCTOR_PROMPT}

Language:
${lang === "es" ? "Spanish only" : "English only"}

Vehicle:
${buildVehicleText(vehicleProfile)}

Original symptom:
${issue}

Follow-up answers:
${userAnswers}

OBD code:
${obdCode || "None"}

Final report rules:
- INTERVIEW COMPLETE.
- DO NOT ask another question.
- GENERATE A FULL PROFESSIONAL MECHANICAL REPORT.
- You are not allowed to return only Primary Verdict.
- Include ALL headers:
Primary Verdict:
Voice Summary:
Failure Behavior Analysis:
Why The Logic Holds:
Recommended Verification Path:
Mechanic Insight:
Answer options:
- Each section must contain useful diagnostic detail.
- Voice Summary must be 3-4 sentences.
- Failure Behavior Analysis must explain the mechanical behavior.
- Recommended Verification Path must contain exactly 3 numbered steps.
- Answer options must be None.
`;
}

async function requestOpenAIReport(prompt, isFollowUp = false) {
  return requestOpenAIReportWithSettings({
    prompt,
    temperature: isFollowUp ? 0.12 : 0.08,
    maxTokens: isFollowUp ? 220 : 1500,
    timeoutMs: 25000,
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
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.DRIVESHIFT_MODEL || "gpt-4o",
        messages: [{ role: "system", content: prompt }],
        temperature,
        max_tokens: maxTokens,
      }),
    });

    clearTimeout(timeout);

    const data = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() || "";
  } catch (_) {
    clearTimeout(timeout);
    return "";
  }
}

function cleanFollowUp(text, { lang, issue, askedQuestions, dominantLock }) {
  let clean = String(text || "").trim();
  if (!clean) return "";

  clean = clean.replace(/\*\*/g, "");

  const questionMatch = clean.match(/Question:\s*([\s\S]*)/i);
  let question = questionMatch ? questionMatch[1].trim() : clean;

  question = question
    .replace(/Diagnosis status:\s*follow_up/gi, "")
    .replace(/Question:/gi, "")
    .trim();

  if (!question || question.length < 8) return "";

  return `Diagnosis status:\nfollow_up\n\nQuestion:\n${question}`;
}

function cleanAnalysis(text) {
  let clean = String(text || "").trim();
  if (!clean) return "";

  clean = clean.replace(/\*\*/g, "");
  clean = clean.replace(/^analysis\s*/i, "").trim();

  if (!/Primary Verdict:/i.test(clean)) {
    return "";
  }

  const requiredHeaders = [
    "Primary Verdict:",
    "Voice Summary:",
    "Failure Behavior Analysis:",
    "Why The Logic Holds:",
    "Recommended Verification Path:",
    "Mechanic Insight:",
    "Answer options:",
  ];

  for (const header of requiredHeaders) {
    if (!new RegExp(header.replace(":", "\\s*:"), "i").test(clean)) {
      clean += `\n\n${header}\n${header === "Answer options:" ? "None" : "Not provided."}`;
    }
  }

  if (!/Diagnosis status:/i.test(clean)) {
    clean = `Diagnosis status:\nanalysis\n\n${clean}`;
  }

  return clean.trim();
}

function buildSafeAnalysisFallback(lang) {
  return `Diagnosis status:\nanalysis\n\nPrimary Verdict:\nThe evidence points to a vehicle system fault that needs a structured inspection.\n\nVoice Summary:\nDriveShift could not complete the full advanced report, but the symptom pattern still needs a professional diagnostic path. The issue should be verified through inspection rather than guessing at parts. The safest next step is to confirm the system involved before replacing anything.\n\nFailure Behavior Analysis:\nThe reported behavior suggests the fault appears under operating conditions rather than at rest. That usually means the affected component is reacting to load, heat, pressure, speed, or vibration.\n\nWhy The Logic Holds:\nBecause the symptom changes during use, the concern should be diagnosed by reproducing the condition and watching how the vehicle reacts.\n\nRecommended Verification Path:\n1. Reproduce the symptom under the same driving condition.\n2. Inspect the most related system physically and with scan data if available.\n3. Confirm the failure before replacing parts.\n\nMechanic Insight:\nThe most reliable repair path is to verify the behavior under the same condition that triggers the symptom.\n\nAnswer options:\nNone`;
}

function buildErrorFallback() {
  return `Diagnosis status:\nanalysis\n\nPrimary Verdict:\nCould not reach diagnostic brain.\n\nVoice Summary:\nThe diagnostic request did not complete successfully. Please try again with the same symptom. No parts should be replaced from this failed response.\n\nFailure Behavior Analysis:\nThe system could not process the mechanical evidence.\n\nWhy The Logic Holds:\nNo complete diagnosis was generated.\n\nRecommended Verification Path:\n1. Try again with the same symptom.\n2. Include when the issue happens.\n3. Include any warning lights or noises.\n\nMechanic Insight:\nA complete report requires the symptom and at least one clear driving condition.\n\nAnswer options:\nNone`;
}

function buildEmptyFollowUp(lang) {
  return `Diagnosis status:\nfollow_up\n\nQuestion:\nWhat is the main symptom your vehicle is having?`;
}

function buildGreetingResponse(lang) {
  return `Diagnosis status:\nfollow_up\n\nQuestion:\nHello! What car problem are you facing today?`;
}

function buildGeneralHelpResponse(lang) {
  return `Diagnosis status:\nfollow_up\n\nQuestion:\nHow can I help you diagnose your vehicle today?`;
}

function buildNaturalFallbackFollowUp({ lang, issue, dominantLock }) {
  return `Diagnosis status:\nfollow_up\n\nQuestion:\nWhen does this symptom happen most clearly?`;
}

function looksBad(text) {
  const clean = String(text || "").toLowerCase();
  return (
    !clean ||
    clean.includes("as an ai") ||
    clean.includes("i am not a mechanic") ||
    clean.includes("consult a mechanic") ||
    clean.length < 350
  );
}

function extractObdCode(text) {
  const matches = String(text || "")
    .toUpperCase()
    .match(/\b[PCBU][0-9A-F]{4}\b/g);

  return matches ? [...new Set(matches)].join(", ") : "";
}

function buildVehicleText(profile) {
  if (!profile) return "Unknown vehicle.";
  return `${profile.year || ""} ${profile.make || ""} ${profile.model || ""}`.trim() || "Unknown vehicle.";
}

function extractAskedQuestions(answers) {
  return (Array.isArray(answers) ? answers : [])
    .map((a) => String(a?.question || "").trim())
    .filter(Boolean);
}

function buildLocalDominantLock(issue, answers) {
  return "";
}
