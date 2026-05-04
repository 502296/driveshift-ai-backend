export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ result: "Method not allowed" });
  }

  try {
    const { issue, answers, language } = req.body;

    const userInput =
      Array.isArray(answers) && answers.length > 0
        ? answers.map((a) => `${a.question}: ${a.answer}`).join("\n")
        : "No additional answers.";

    const possibleObdCode = String(issue || "").match(/\b[PCBU][0-9A-F]{4}\b/i);
    const hasObdCode = Boolean(possibleObdCode);
    const obdCode = hasObdCode ? possibleObdCode[0].toUpperCase() : "";

    const isFreeText =
      !hasObdCode &&
      String(issue || "").length > 8 &&
      (!answers || answers.length <= 1);

    const prompt = `
You are DriveShift Doctor — a calm, experienced digital mechanic.

You do NOT act like a chatbot.
You act like a real mechanic talking to a driver.

USER INPUT:
${issue}

EXTRA DETAILS:
${userInput}

DETECTED OBD CODE:
${hasObdCode ? obdCode : "None"}

LANGUAGE:
${language === "es" ? "Spanish" : "English"}

IMPORTANT BEHAVIOR:
- If the user only described a general symptom and details are missing, do NOT jump to a final diagnosis.
- First ask 1 or 2 smart follow-up questions like a real mechanic.
- If there is enough detail or an OBD code, give the diagnosis.
- Stay short, calm, confident, and practical.
- No markdown.
- No bullet points.
- No scary language.
- Do not say "Based on the information".
- Do not mention AI.

VOICE SUMMARY RULE:
Give a short spoken mechanic-style summary, not the whole report.

OUTPUT FORMAT:

Voice summary:
[short natural mechanic speech]

Confidence:
[number 0-100]

Risk level:
[High or Medium or Low]

Likely issue:
[If not enough info, say: More details are needed before a final diagnosis.]

Why it fits:
[short explanation]

What to do next:
[If details are missing, ask 1 or 2 clear follow-up questions. If enough detail, give practical steps.]

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
        temperature: 0.28,
        max_output_tokens: 650,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ result: fallback(language) });
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
      return res.status(200).json({ result: fallback(language) });
    }

    if (!text.toLowerCase().includes("voice summary")) {
      text = enhanceFallback(text, language);
    }

    return res.status(200).json({ result: text });
  } catch (error) {
    return res.status(500).json({
      result: fallback(req.body?.language),
    });
  }
}

function fallback(language = "en") {
  if (language === "es") {
    return `
Voice summary:
Bien, necesito un poco más de información antes de darte un diagnóstico final.

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
Voice summary:
Alright, I need a little more detail before calling this one.

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

function enhanceFallback(text, language = "en") {
  if (language === "es") {
    return `
Voice summary:
Bien, esto necesita más detalles antes de confirmar la causa.

Confidence:
65

Risk level:
Medium

Likely issue:
${text}

Why it fits:
The symptom suggests a possible vehicle issue, but more context is needed.

What to do next:
Describe when it happens and whether it changes with speed, braking, acceleration, or engine temperature.

When to stop driving:
Stop driving if the vehicle feels unsafe, loses power, overheats, smokes, or warning lights flash.
`;
  }

  return `
Voice summary:
Alright, this needs a little more detail before I call the exact cause.

Confidence:
65

Risk level:
Medium

Likely issue:
${text}

Why it fits:
The symptom suggests a possible vehicle issue, but more context is needed.

What to do next:
Describe when it happens and whether it changes with speed, braking, acceleration, or engine temperature.

When to stop driving:
Stop driving if the vehicle feels unsafe, loses power, overheats, smokes, or warning lights flash.
`;
}
