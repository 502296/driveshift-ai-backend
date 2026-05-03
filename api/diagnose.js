export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ result: "Method not allowed" });
  }

  try {
    const { issue, answers, isEnglish } = req.body;

    const userInput = Array.isArray(answers)
      ? answers.map((a) => `${a.question}: ${a.answer}`).join("\n")
      : "No answers provided";

    const language = isEnglish ? "English" : "Spanish";

    const prompt = `
You are DriveShift AI, a calm expert automotive diagnostic assistant.

The user selected this issue:
${issue}

The user answered:
${userInput}

Respond in ${language} only.

Write like a professional mechanic and diagnostic engineer, not like ChatGPT.

Rules:
- Keep it clear and practical.
- Do not over-explain.
- Do not scare the driver.
- Do not say "Based on the information provided".
- Do not use long paragraphs.
- Do not mention AI, model, or system.
- Give a confident but careful diagnosis.
- If it may be unsafe, say so calmly.
- Focus on the most likely cause first.
- Explain why in simple terms.
- Give the next best action.

Format exactly like this:

Likely issue:
[one short sentence]

Why it fits:
[2-3 short sentences]

What to do next:
[2-3 practical steps]

When to stop driving:
[short safety advice if needed, otherwise say what to monitor]
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: prompt,
        temperature: 0.35,
        max_output_tokens: 450,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        result:
          language === "English"
            ? "DriveShift could not complete the diagnosis right now. Please try again."
            : "DriveShift no pudo completar el diagnóstico ahora. Inténtalo de nuevo.",
      });
    }

    return res.status(200).json({
      result: data.output_text || "No diagnosis returned.",
    });
  } catch (error) {
    return res.status(500).json({
      result: "DriveShift had a connection issue. Please try again.",
    });
  }
}
