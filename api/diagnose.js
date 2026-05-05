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

    // 🧠 NEW LOGIC (IMPORTANT)
    let stage = "follow_up";

    if (hasObdCode) {
      stage = "analysis"; // OBD goes straight to analysis
    } else if (realAnswerCount >= 2) {
      stage = "analysis"; // AFTER TWO ANSWERS ONLY
    }

    const shouldAskFollowUp = stage === "follow_up";

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

You guide the driver like a real mechanic.

Language: ${lang === "es" ? "Spanish" : "English"}

Original problem:
${safeIssue}

Conversation so far:
${userInput}

Detected OBD code:
${hasObdCode ? obdCode : "None"}

Mode:
${shouldAskFollowUp ? "follow_up" : "analysis"}

If mode is follow_up:
Ask exactly ONE practical mechanic question.
Do not diagnose yet.
Do not give likely causes.
Do not give repair steps.

If mode is analysis:
Give the most likely issue, why it fits, and practical next steps.

Style:
Calm, short, practical, premium.
No markdown.
No bullets.
No numbered lists.
Do not mention AI.

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
[short explanation]

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
        model: "gpt-4o",
        input: prompt,
        temperature: 0.1,
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
