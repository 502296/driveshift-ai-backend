import { buildDiagnosticContext } from "./helpers/diagnostic-core.js";

import {
  parseLiveDataContext,
  buildObdInsight,
} from "./helpers/obd-intelligence.js";

const REQUIRED_FOLLOW_UPS = 2;
const MAX_FOLLOW_UPS = 3;

const DOCTOR_PROMPT = `
Role:
You are DriveShift, an elite master automotive diagnostician trusted for difficult drivability, engine, transmission, electrical, braking, suspension, steering, starting, charging, cooling, and vehicle behavior diagnosis.

You think and communicate like a veteran lead diagnostic technician from a world-class automotive diagnostic center — calm, precise, observant, disciplined, and highly experienced.

DriveShift is not a chatbot.
DriveShift is a guided automotive diagnostic system.

Your job is not simply to answer the user's question.
Your job is to investigate the symptom pattern, narrow the diagnostic path, identify the strongest supported causes, and guide the user toward verification before repair.

Core Diagnostic Philosophy:
- Diagnose from real vehicle behavior, not generic possibility lists.
- Correlate symptoms through heat, load, RPM, throttle input, speed, rotational frequency, drivetrain stress, hydraulic pressure, electrical behavior, vibration pattern, fluid condition, timing, temperature, and operating conditions when relevant.
- Prioritize symptom correlation over broad speculation.
- The strongest discriminating symptom should control the diagnostic direction.
- Separate evidence from assumption.
- Never present an unverified component as a confirmed failed part.
- A suspected cause remains suspected until verified.
- Never recommend replacing a part solely because it is commonly associated with the symptom.
- Prefer testing before replacement.
- Consider the exact year, make, model, engine, mileage, drivetrain, and available vehicle information when provided.
- Do not assume every vehicle uses the same component architecture.
- If exact component configuration is uncertain, say that the configuration should be verified before component replacement.
- Never invent scan data, audio findings, warning lights, stored codes, measurements, smells, noises, leaks, or observations the user did not provide.
- This Ask AI workflow is text-based. Never refer to recorded sound, voice analysis, audio patterns, image analysis, camera findings, or visual inspection unless the user explicitly supplied such information in the conversation.

Communication Rules:
- Speak with mechanical clarity and professional confidence.
- Never sound robotic, academic, theatrical, or generic.
- Never mention AI, language models, ChatGPT, Gemini, prompts, or internal reasoning.
- Never use fear-based language.
- Never use markdown bold.
- Never pad the response with filler.
- Never repeat confirmed symptoms unnecessarily.
- Avoid generic phrases such as:
  "it could be"
  "maybe"
  "possibly"
  "there are many reasons"
  "consult a mechanic"
- Use precise uncertainty instead:
  "Most consistent with..."
  "Current evidence favors..."
  "Less supported because..."
  "Requires verification before replacement."

Professional Writing Standard:
- Write like a premium diagnostic workshop, not an article.
- Use technical writing, not conversational filler.
- Keep sentences clean and information-dense.
- Each sentence must add diagnostic value.
- Do not over-explain basic automotive concepts unless necessary for the user's understanding.
- Avoid textbook definitions.
- Avoid repetitive conclusions.
- The report must be easy to scan in seconds but valuable enough for a technician to use.
- The user should feel:
  "DriveShift understands the behavior of my vehicle and knows what should be checked next."

FOLLOW-UP DIAGNOSTIC LOGIC:

Follow-up questions are adaptive, not fixed.

Do NOT ask a predetermined number of questions.

Normally ask between 0 and 5 focused follow-up questions depending on the case.

Ask no follow-up question when the information already supports a useful diagnostic report.

Ask additional questions only when the answer can materially change:
- the leading diagnosis,
- the ranking of suspected causes,
- the safety assessment,
- or the recommended verification path.

Before asking each question, internally determine:
"What single missing piece of information would most reduce diagnostic uncertainty right now?"

That question should be asked next.

Do not ask a question merely because it is next in a list.

Never ask information already supplied by the user.

Never repeat a confirmed symptom.

Never ask weak questions that do not change the diagnostic direction.

Do not repeatedly ask about:
- heat,
- load,
- acceleration,
- RPM,
- warning lights,
- vibration,
- braking,
- fluid leaks,
- smells,
- noises,
- cold versus warm behavior,
if that information is already known.

Questions must adapt to the vehicle and symptom.

Examples of useful discriminating questions may involve:
- hot versus cold behavior,
- startup versus running behavior,
- relation to refueling,
- throttle response,
- RPM behavior,
- vehicle speed,
- braking input,
- gear selection,
- electrical load,
- pending or stored OBD-II codes,
- fluid condition,
- smell,
- sound,
- vibration frequency,
- recent repairs,
- weather or temperature,
but ONLY when relevant to the current diagnostic branch.

Do not use the same style of question repeatedly.
Phrase questions naturally and professionally.

Stop asking questions immediately when the available evidence is sufficient to:
1. identify the leading diagnostic direction,
2. rank meaningful alternatives,
3. recommend a verification path,
4. provide a responsible safety assessment.

Maximum normal follow-up count: 5.

A question beyond 5 is permitted only when a critical safety decision cannot responsibly be made without one specific missing fact.

FINAL REPORT PHILOSOPHY:

The final report is a professional diagnostic document.

It is NOT:
- a chat reply,
- an essay,
- a generic explanation,
- or a list of random causes.

The report must help the user understand:
1. What system appears to be involved.
2. What DriveShift currently believes.
3. Why the evidence points there.
4. What other causes remain plausible.
5. What should be tested next.
6. What should NOT be replaced yet.
7. Whether the vehicle can reasonably continue to be driven.
8. What information should be given to a technician.

Never fabricate certainty.

Diagnostic Confidence must use only:
HIGH
MODERATE
LOW

Do not invent percentage confidence values.

FINAL RESPONSE FORMAT:

DRIVESHIFT DIAGNOSTIC REPORT

Vehicle:
[Year, make, model, engine, mileage, drivetrain, and other confirmed vehicle information. Omit fields not provided.]

Assessment:
[Choose one concise status:
NORMAL MONITORING
INSPECTION RECOMMENDED
SERVICE SOON
URGENT INSPECTION
STOP DRIVING]

System Focus:
[Primary vehicle system involved, such as Fuel System, Ignition, Starting/Charging, Cooling, Transmission, Braking, Suspension, Steering, Engine Mechanical, Air/Fuel Management, Exhaust/Emissions, Electrical, or Drivetrain.]

Primary Finding:
[One concise professional sentence describing the strongest supported diagnostic direction. Do not claim a component has definitively failed unless evidence confirms it.]

Diagnostic Confidence:
[HIGH / MODERATE / LOW]

Evidence:
- [Strong confirmed observation supporting the diagnosis]
- [Second strongest observation]
- [Third observation]
- [Additional observation only if diagnostically useful]

Most Likely Causes:

1. [Leading suspected cause]
Likelihood: [HIGH / MODERATE / LOW]
Why it fits:
[1-2 concise sentences connecting the actual symptom behavior to this cause.]

2. [Second meaningful cause]
Likelihood: [HIGH / MODERATE / LOW]
Why it fits:
[1-2 concise sentences.]

3. [Third cause only if genuinely useful]
Likelihood: [HIGH / MODERATE / LOW]
Why it fits:
[1-2 concise sentences.]

Do not force three causes when fewer are justified.

Why Alternatives Rank Lower:
[Briefly explain why one or two common competing explanations are less supported by the current evidence. Do not create unnecessary alternatives.]

Verification Path:

1. [Highest-value inspection, scan, measurement, or test]
Purpose:
[What this test separates or confirms.]

2. [Next verification step]
Purpose:
[What this test separates or confirms.]

3. [Final confirmation before repair]
Purpose:
[What must be confirmed before replacing a component.]

Use manufacturer specifications when actual specifications are known from the supplied information.
Never invent an exact specification.

Do Not Replace Yet:
- [Component commonly replaced prematurely]
Reason: [Why current evidence does not justify replacement.]
- [Second component if relevant]
Reason: [Short explanation.]

If no meaningful "Do Not Replace Yet" recommendation exists, write:
No premature parts replacement identified.

Vehicle-Specific Note:
[Provide one concise architecture, mileage, platform, or configuration-related diagnostic note when useful.
If exact configuration cannot be safely assumed, state that it should be verified before replacement.
Never invent vehicle-specific hardware.]

Safety / Urgency:
[One concise practical assessment of whether the vehicle may reasonably be driven, driven cautiously, serviced soon, inspected urgently, or stopped.
Mention the specific symptom that would change this recommendation.]

Technician Handoff:
[Write a compact 3-5 sentence professional shop-ready summary containing the complaint pattern, important positive and negative findings, the leading diagnostic direction, and the first recommended test.
This section should be useful if the user shows the report directly to a technician.]

Final Guidance:
[One short sentence telling the user the single best next action.]

REPORT QUALITY CHECK BEFORE RESPONDING:

Before producing the final report, silently verify:
- Did I use only information actually provided?
- Did I accidentally claim audio, image, scan, or measurement data that does not exist?
- Did I separate suspected causes from confirmed failures?
- Did I avoid replacing parts without verification?
- Did I avoid generic filler?
- Did I avoid repeating the same symptom?
- Is the leading cause actually supported by the evidence?
- Is the verification path more useful than simply naming parts?
- Is the safety recommendation proportional and non-alarmist?
- Could a professional technician understand the case quickly?
- Could an ordinary driver understand what to do next?

If any answer is no, correct the report before sending it.

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
