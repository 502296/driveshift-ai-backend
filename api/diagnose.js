export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ result: "Method not allowed" });
  }

  try {
    const { issue, answers, language } = req.body;
    const lang = language === "es" ? "es" : "en";

    const safeIssue = String(issue || "").trim();
    const answerList = Array.isArray(answers) ? answers : [];

    const possibleObdCode = safeIssue.match(/\b[PCBU][0-9A-F]{4}\b/i);
    const hasObdCode = Boolean(possibleObdCode);
    const obdCode = hasObdCode ? possibleObdCode[0].toUpperCase() : "";

    const realAnswerCount = countUserAnswers(answerList);
    const shouldAskFollowUp = !hasObdCode && realAnswerCount < 3;

    const userInput =
      answerList.length > 0
        ? answerList
            .map((a, index) => {
              const q = String(a.question || `Question ${index + 1}`).trim();
              const ans = String(a.answer || "").trim();
              return `${q}: ${ans}`;
            })
            .join("\n")
        : "No additional answers.";

    const prompt = `
You are DriveShift Doctor, a calm senior automotive diagnostic mechanic.

You are not a chatbot.
You are a diagnostic guide.
Your job is to lead the driver step by step before giving a final diagnosis.

Language: ${lang === "es" ? "Spanish" : "English"}

Original problem:
${safeIssue}

Conversation so far:
${userInput}

Detected OBD code:
${hasObdCode ? obdCode : "None"}

User answer count:
${realAnswerCount}

Mode:
${shouldAskFollowUp ? "follow_up" : "final"}

Critical behavior:
If mode is follow_up, you must NOT give a report.
If mode is follow_up, you must NOT give a likely cause.
If mode is follow_up, you must ask exactly ONE practical mechanic question.
The question must be different from previous questions.
The question must narrow the diagnosis.
The question should ask about timing, speed, acceleration, braking, idle, warning lights, noise, smell, temperature, or where the vibration is felt.
Do not mention possible causes during follow_up.
Do not say "not confirmed yet" in a lazy way except in the Likely issue field.
If mode is final, give the most likely issue, why it fits, and practical next steps.

Style:
Calm, premium, short, human.
No markdown.
No bullets.
No numbered lists.
No scary language.
Do not mention AI.
Do not say "Based on the information".

Output exactly this format:

Diagnosis status: ${shouldAskFollowUp ? "follow_up" : "final"}

Voice summary:
[short natural mechanic speech]

Confidence:
[number 0-100]

Risk level:
[High or Medium or Low]

Likely issue:
[if follow_up: Still narrowing the issue. If final: short likely issue]

Why it fits:
[if follow_up: Explain why the next question matters in one short sentence. If final: short logic]

What to do next:
[if follow_up: one clear follow-up question only. If final: practical next steps]

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
        model: "gpt-4o",
        input: prompt,
        temperature: 0.12,
        max_output_tokens: 520,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        result: fallback(lang, shouldAskFollowUp),
      });
    }

    let text = extractText(data).trim();

    if (!text) {
      return res.status(200).json({
        result: fallback(lang, shouldAskFollowUp),
      });
    }

    text = normalizeStatusLine(text, shouldAskFollowUp);
    text = ensureRequiredFormat(text, lang, shouldAskFollowUp);

    return res.status(200).json({ result: text });
  } catch (error) {
    return res.status(500).json({
      result: fallback("en", true),
    });
  }
}

function countUserAnswers(answerList) {
  if (!Array.isArray(answerList)) return 0;

  return answerList.filter((item) => {
    const ans = String(item?.answer || "").trim();
    return ans.length > 0;
  }).length;
}

function extractText(data) {
  if (data.output_text) return data.output_text;

  let text = "";

  if (Array.isArray(data.output)) {
    for (const block of data.output) {
      if (Array.isArray(block?.content)) {
        for (const c of block.content) {
          if (c?.text) text += c.text + "\n";
        }
      }
    }
  }

  return text;
}

function normalizeStatusLine(text, shouldAskFollowUp) {
  if (!text) return "";

  const wanted = shouldAskFollowUp ? "follow_up" : "final";

  text = text.replace(
    /Diagnosis status:\s*\n\s*(follow_up|final)/i,
    "Diagnosis status: $1"
  );

  if (!/Diagnosis status:\s*(follow_up|final)/i.test(text)) {
    text = `Diagnosis status: ${wanted}\n\n${text}`;
  }

  if (shouldAskFollowUp) {
    text = text.replace(/Diagnosis status:\s*final/i, "Diagnosis status: follow_up");
  } else {
    text = text.replace(/Diagnosis status:\s*follow_up/i, "Diagnosis status: final");
  }

  return text.trim();
}

function ensureRequiredFormat(text, lang, shouldAskFollowUp) {
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

  const ok = required.every((label) =>
    text.toLowerCase().includes(label.toLowerCase())
  );

  if (ok) return text;

  return fallback(lang, shouldAskFollowUp);
}

function fallback(lang = "en", shouldAskFollowUp = true) {
  const status = shouldAskFollowUp ? "follow_up" : "final";

  if (lang === "es") {
    return `
Diagnosis status: ${status}

Voice summary:
Voy a reducir esto paso a paso antes de confirmar la causa.

Confidence:
55

Risk level:
Medium

Likely issue:
${shouldAskFollowUp ? "Still narrowing the issue." : "A drivability issue is likely."}

Why it fits:
The next detail will help separate engine load, braking, and speed-related behavior.

What to do next:
Does it happen more during acceleration, braking, idling, going uphill, or at a steady speed?

When to stop driving:
Stop driving if the vehicle shakes badly, loses power, overheats, smokes, or feels unsafe.
`;
  }

  return `
Diagnosis status: ${status}

Voice summary:
I’ll narrow this down step by step before calling the cause.

Confidence:
55

Risk level:
Medium

Likely issue:
${shouldAskFollowUp ? "Still narrowing the issue." : "A drivability issue is likely."}

Why it fits:
The next detail will help separate engine load, braking, and speed-related behavior.

What to do next:
Does it happen more during acceleration, braking, idling, going uphill, or at a steady speed?

When to stop driving:
Stop driving if the vehicle shakes badly, loses power, overheats, smokes, or feels unsafe.
`;
}
