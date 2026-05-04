export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ result: "Method not allowed" });
  }

  try {
    const { issue, answers, language } = req.body;

    const lang = language === "es" ? "es" : "en";

    const userInput =
      Array.isArray(answers) && answers.length > 0
        ? answers.map((a) => `${a.question}: ${a.answer}`).join("\n")
        : "No additional answers.";

    const possibleObdCode = String(issue || "").match(/\b[PCBU][0-9A-F]{4}\b/i);
    const hasObdCode = Boolean(possibleObdCode);
    const obdCode = hasObdCode ? possibleObdCode[0].toUpperCase() : "";

    const answerCount = Array.isArray(answers) ? answers.length : 0;
    const shouldAskFollowUp = !hasObdCode && answerCount <= 1;

    const prompt = `
You are DriveShift Doctor — a calm, experienced automotive mechanic.

You are not a chatbot. You talk like a real mechanic helping a driver.

LANGUAGE:
${lang === "es" ? "Spanish" : "English"}

USER PROBLEM:
${issue}

DETAILS:
${userInput}

DETECTED OBD CODE:
${hasObdCode ? obdCode : "None"}

CORE RULE:
If this is the first free-text symptom message and there is no OBD code, do NOT give a final diagnosis yet. Ask ONE smart mechanic follow-up question first.

SHOULD ASK FOLLOW-UP NOW:
${shouldAskFollowUp ? "YES" : "NO"}

IF SHOULD ASK FOLLOW-UP NOW = YES:
- Diagnosis status must be: follow_up
- Likely issue must be: More details are needed before a final diagnosis.
- What to do next must contain ONE clear follow-up question.
- Do not give final repair steps yet.

IF SHOULD ASK FOLLOW-UP NOW = NO:
- Diagnosis status must be: final
- Give the best diagnosis with confidence, risk, logic, and next steps.

STYLE RULES:
- No markdown.
- No bullet points.
- No lists.
- No scary language.
- Do not say "Based on the information".
- Do not mention AI.
- Keep it short, calm, and practical.

OUTPUT FORMAT:

Diagnosis status:
[follow_up or final]

Voice summary:
[short natural mechanic speech]

Confidence:
[number 0-100]

Risk level:
[High or Medium or Low]

Likely issue:
[short direct answer]

Why it fits:
[short explanation]

What to do next:
[one follow-up question if follow_up, or practical steps if final]

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
        temperature: 0.22,
        max_output_tokens: 650,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ result: fallback(lang) });
    }

    let text = "";

    if (data.output_text) {
      text = data.output_text;
    } else if (Array.isArray(data.output)) {
      for (const block of data.output) {
        if (block?.content) {
          for (const c of block.content) {
            if (c?.text) text += c.text + "\n";
          }
        }
      }
    }

    text = text.trim();

    if (!text) {
      return res.status(200).json({ result: fallback(lang) });
    }

    if (!text.toLowerCase().includes("diagnosis status")) {
      text = enhanceFallback(text, lang, shouldAskFollowUp);
    }

    return res.status(200).json({ result: text });
  } catch (error) {
    return res.status(500).json({
      result: fallback(req.body?.language === "es" ? "es" : "en"),
    });
  }
}

function fallback(lang = "en") {
  if (lang === "es") {
    return `
Diagnosis status:
follow_up

Voice summary:
Necesito un poco más de información antes de confirmar la causa.

Confidence:
55

Risk level:
Medium

Likely issue:
More details are needed before a final diagnosis.

Why it fits:
The symptom needs more context before narrowing the cause.

What to do next:
When does it happen, and does it change with speed, braking, or acceleration?

When to stop driving:
Stop driving if the vehicle shakes badly, loses power, overheats, smokes, or feels unsafe.
`;
  }

  return `
Diagnosis status:
follow_up

Voice summary:
I need a little more detail before calling the exact cause.

Confidence:
55

Risk level:
Medium

Likely issue:
More details are needed before a final diagnosis.

Why it fits:
The symptom needs more context before narrowing the cause.

What to do next:
When does it happen, and does it change with speed, braking, or acceleration?

When to stop driving:
Stop driving if the vehicle shakes badly, loses power, overheats, smokes, or feels unsafe.
`;
}

function enhanceFallback(text, lang = "en", shouldAskFollowUp = true) {
  const status = shouldAskFollowUp ? "follow_up" : "final";

  if (lang === "es") {
    return `
Diagnosis status:
${status}

Voice summary:
Necesito revisar un poco más antes de confirmar la causa.

Confidence:
60

Risk level:
Medium

Likely issue:
${shouldAskFollowUp ? "More details are needed before a final diagnosis." : text}

Why it fits:
The symptom suggests a possible vehicle issue, but context matters.

What to do next:
${
  shouldAskFollowUp
    ? "Does it happen when accelerating, braking, idling, or only at certain speeds?"
    : "Start with the simple checks first, then inspect professionally if it continues."
}

When to stop driving:
Stop driving if the vehicle feels unsafe, loses power, overheats, smokes, or warning lights flash.
`;
  }

  return `
Diagnosis status:
${status}

Voice summary:
I need to narrow this down a little more before calling the exact cause.

Confidence:
60

Risk level:
Medium

Likely issue:
${shouldAskFollowUp ? "More details are needed before a final diagnosis." : text}

Why it fits:
The symptom suggests a possible vehicle issue, but context matters.

What to do next:
${
  shouldAskFollowUp
    ? "Does it happen when accelerating, braking, idling, or only at certain speeds?"
    : "Start with the simple checks first, then inspect professionally if it continues."
}

When to stop driving:
Stop driving if the vehicle feels unsafe, loses power, overheats, smokes, or warning lights flash.
`;
}
