export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ result: "Method not allowed" });
  }

  try {
    const { issue, answers, language } = req.body;
    const lang = language === "es" ? "es" : "en";

    const safeIssue = String(issue || "").trim();
    const answerList = Array.isArray(answers) ? answers : [];
    const answerCount = answerList.length;

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

    const possibleObdCode = safeIssue.match(/\b[PCBU][0-9A-F]{4}\b/i);
    const hasObdCode = Boolean(possibleObdCode);
    const obdCode = hasObdCode ? possibleObdCode[0].toUpperCase() : "";

    const shouldAskFollowUp = !hasObdCode && answerCount < 3;

    const prompt = `
You are DriveShift Doctor, a calm senior automotive diagnostic mechanic.

You lead the driver like a real mechanic, not like a chatbot.

Language: ${lang === "es" ? "Spanish" : "English"}

Original problem:
${safeIssue}

Conversation so far:
${userInput}

Detected OBD code:
${hasObdCode ? obdCode : "None"}

Mode:
${shouldAskFollowUp ? "follow_up" : "final"}

Rules:
If mode is follow_up, do not diagnose yet. Ask exactly one strong mechanic question that narrows the cause. Do not give repair steps. Do not give a conclusion. Do not mention possible causes unless absolutely necessary.
If mode is final, give the most likely diagnosis, why it fits, and practical next steps.
Sound calm, practical, and human.
No markdown. No bullets. No numbered lists. No scary language. Do not mention AI.

Important:
The first line must be exactly:
Diagnosis status: ${shouldAskFollowUp ? "follow_up" : "final"}

Output exactly:

Diagnosis status: ${shouldAskFollowUp ? "follow_up" : "final"}

Voice summary:
[short natural mechanic speech]

Confidence:
[number 0-100]

Risk level:
[High or Medium or Low]

Likely issue:
[if follow_up: Not confirmed yet. If final: short likely issue]

Why it fits:
[if follow_up: One short sentence explaining why the question matters. If final: short logic]

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
        temperature: 0.16,
        max_output_tokens: 650,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        result: fallback(lang, shouldAskFollowUp),
      });
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

    text = normalizeStatusLine(text.trim(), shouldAskFollowUp);

    if (!text) {
      return res.status(200).json({
        result: fallback(lang, shouldAskFollowUp),
      });
    }

    if (!text.toLowerCase().includes("diagnosis status:")) {
      text = enhanceFallback(text, lang, shouldAskFollowUp);
    }

    return res.status(200).json({ result: text });
  } catch (error) {
    return res.status(500).json({
      result: fallback("en", true),
    });
  }
}

function normalizeStatusLine(text, shouldAskFollowUp) {
  if (!text) return "";

  const wanted = shouldAskFollowUp ? "follow_up" : "final";

  text = text.replace(
    /Diagnosis status:\s*\n\s*(follow_up|final)/i,
    `Diagnosis status: $1`
  );

  if (!/Diagnosis status:\s*(follow_up|final)/i.test(text)) {
    text = `Diagnosis status: ${wanted}\n\n${text}`;
  }

  if (shouldAskFollowUp) {
    text = text.replace(/Diagnosis status:\s*final/i, "Diagnosis status: follow_up");
  }

  return text.trim();
}

function fallback(lang = "en", shouldAskFollowUp = true) {
  const status = shouldAskFollowUp ? "follow_up" : "final";

  if (lang === "es") {
    return `
Diagnosis status: ${status}

Voice summary:
Necesito una respuesta más para reducir la causa correctamente.

Confidence:
55

Risk level:
Medium

Likely issue:
${shouldAskFollowUp ? "Not confirmed yet." : "A drivability issue is likely."}

Why it fits:
The pattern needs one more detail before confirming the cause.

What to do next:
Does it happen more during acceleration, braking, idling, going uphill, or at a steady speed?

When to stop driving:
Stop driving if the vehicle shakes badly, loses power, overheats, smokes, or feels unsafe.
`;
  }

  return `
Diagnosis status: ${status}

Voice summary:
I need one more answer to narrow this down properly.

Confidence:
55

Risk level:
Medium

Likely issue:
${shouldAskFollowUp ? "Not confirmed yet." : "A drivability issue is likely."}

Why it fits:
The pattern needs one more detail before confirming the cause.

What to do next:
Does it happen more during acceleration, braking, idling, going uphill, or at a steady speed?

When to stop driving:
Stop driving if the vehicle shakes badly, loses power, overheats, smokes, or feels unsafe.
`;
}

function enhanceFallback(text, lang = "en", shouldAskFollowUp = true) {
  const status = shouldAskFollowUp ? "follow_up" : "final";

  if (lang === "es") {
    return `
Diagnosis status: ${status}

Voice summary:
Voy a reducir la causa paso a paso.

Confidence:
60

Risk level:
Medium

Likely issue:
${shouldAskFollowUp ? "Not confirmed yet." : text}

Why it fits:
The symptom pattern matters before confirming the cause.

What to do next:
${
  shouldAskFollowUp
    ? "Does it happen more during acceleration, braking, idling, going uphill, or at a steady speed?"
    : "Start with the simple checks first, then inspect professionally if it continues."
}

When to stop driving:
Stop driving if the vehicle feels unsafe, loses power, overheats, smokes, or warning lights flash.
`;
  }

  return `
Diagnosis status: ${status}

Voice summary:
I’ll narrow this down step by step.

Confidence:
60

Risk level:
Medium

Likely issue:
${shouldAskFollowUp ? "Not confirmed yet." : text}

Why it fits:
The symptom pattern matters before confirming the cause.

What to do next:
${
  shouldAskFollowUp
    ? "Does it happen more during acceleration, braking, idling, going uphill, or at a steady speed?"
    : "Start with the simple checks first, then inspect professionally if it continues."
}

When to stop driving:
Stop driving if the vehicle feels unsafe, loses power, overheats, smokes, or warning lights flash.
`;
}
