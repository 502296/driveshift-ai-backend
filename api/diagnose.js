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
        ? answerList.map((a, index) => {
            const q = String(a.question || `Question ${index + 1}`).trim();
            const ans = String(a.answer || "").trim();
            return `${q}: ${ans}`;
          }).join("\n")
        : "No additional answers.";

    const possibleObdCode = safeIssue.match(/\b[PCBU][0-9A-F]{4}\b/i);
    const hasObdCode = Boolean(possibleObdCode);
    const obdCode = hasObdCode ? possibleObdCode[0].toUpperCase() : "";

    // DriveShift should guide the user before final diagnosis.
    // 1st message = ask follow-up
    // 2nd answer = ask one more focused follow-up
    // 3rd answer = final diagnosis
    const shouldAskFollowUp = !hasObdCode && answerCount < 3;

    const prompt = `
You are DriveShift Doctor — a calm, senior automotive diagnostic mechanic.

You are not a chatbot.
You are not a generic AI assistant.
You are a digital mechanic that leads the driver through diagnosis.

LANGUAGE:
${lang === "es" ? "Spanish" : "English"}

ORIGINAL USER PROBLEM:
${safeIssue}

CONVERSATION SO FAR:
${userInput}

DETECTED OBD CODE:
${hasObdCode ? obdCode : "None"}

DIAGNOSTIC MODE:
${shouldAskFollowUp ? "Ask follow-up question" : "Final diagnosis"}

IMPORTANT BEHAVIOR:
If DIAGNOSTIC MODE is "Ask follow-up question":
Ask exactly ONE useful mechanic question.
The question must narrow the cause.
Do not repeat a question already asked.
Do not give repair steps yet.
Do not give a final diagnosis yet.
Do not say "More details are needed" in a lazy way.
Ask like a real mechanic.

If DIAGNOSTIC MODE is "Final diagnosis":
Give the most likely issue.
Explain why it fits.
Give practical next steps.
Be calm, clear, and useful.

STYLE RULES:
No markdown.
No bullet points.
No numbered lists.
No scary language.
No "Based on the information".
No "as an AI".
No long explanation.
Sound like a real mechanic.

OUTPUT FORMAT MUST BE EXACTLY:

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
        temperature: 0.18,
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

    text = text.trim();

    if (!text) {
      return res.status(200).json({
        result: fallback(lang, shouldAskFollowUp),
      });
    }

    if (!text.toLowerCase().includes("diagnosis status")) {
      text = enhanceFallback(text, lang, shouldAskFollowUp);
    }

    return res.status(200).json({ result: text });
  } catch (error) {
    return res.status(500).json({
      result: fallback("en", true),
    });
  }
}

function fallback(lang = "en", shouldAskFollowUp = true) {
  const status = shouldAskFollowUp ? "follow_up" : "final";

  if (lang === "es") {
    return `
Diagnosis status:
${status}

Voice summary:
Necesito una respuesta más para reducir la causa.

Confidence:
55

Risk level:
Medium

Likely issue:
${shouldAskFollowUp ? "The cause is not confirmed yet." : "A mechanical or drivability issue is likely."}

Why it fits:
The symptom needs one more detail to narrow the diagnosis.

What to do next:
Does it happen more during acceleration, braking, idling, going uphill, or at a steady speed?

When to stop driving:
Stop driving if the vehicle shakes badly, loses power, overheats, smokes, or feels unsafe.
`;
  }

  return `
Diagnosis status:
${status}

Voice summary:
I need one more answer to narrow this down properly.

Confidence:
55

Risk level:
Medium

Likely issue:
${shouldAskFollowUp ? "The cause is not confirmed yet." : "A mechanical or drivability issue is likely."}

Why it fits:
The symptom needs one more detail to narrow the diagnosis.

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
Diagnosis status:
${status}

Voice summary:
Voy a reducir la causa paso a paso.

Confidence:
60

Risk level:
Medium

Likely issue:
${shouldAskFollowUp ? "The cause is not confirmed yet." : text}

Why it fits:
The symptom suggests a vehicle issue, but the pattern matters.

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
Diagnosis status:
${status}

Voice summary:
I’ll narrow this down step by step.

Confidence:
60

Risk level:
Medium

Likely issue:
${shouldAskFollowUp ? "The cause is not confirmed yet." : text}

Why it fits:
The symptom suggests a vehicle issue, but the pattern matters.

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
