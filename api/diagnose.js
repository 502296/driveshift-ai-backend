export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ result: "Method not allowed" });
  }

  try {
    const { issue, answers, isEnglish } = req.body;

    const userInput = Array.isArray(answers) && answers.length > 0
      ? answers.map((a) => `${a.question}: ${a.answer}`).join("\n")
      : "No quick-question answers provided.";

    const language = isEnglish ? "English" : "Spanish";

    const possibleObdCode = String(issue || "").match(/\b[PCBU][0-9A-F]{4}\b/i);
    const hasObdCode = Boolean(possibleObdCode);
    const obdCode = hasObdCode ? possibleObdCode[0].toUpperCase() : "";

    const prompt = `
You are DriveShift, a calm expert automotive diagnostic assistant.

User input:
${issue}

Quick-question answers:
${userInput}

Detected OBD code:
${hasObdCode ? obdCode : "None"}

Respond in ${language} only.

If an OBD code is detected:
Explain what the code usually means, the most common causes, how serious it is, and the next practical step.
Do not treat the code alone as final proof. Explain that symptoms, vehicle model, and scan data still matter.

If no OBD code is detected:
Use the issue and answers to diagnose the most likely problem.

Style rules:
- Write like a professional mechanic and diagnostic engineer.
- Be calm, clear, and practical.
- Do not sound like ChatGPT.
- Do not say "Based on the information provided".
- Do not over-explain.
- Do not scare the driver.
- Do not mention AI, model, or system.
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
        temperature: 0.3,
        max_output_tokens: 500,
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

    const text =
      data.output?.[0]?.content?.[0]?.text ||
      data.output_text ||
      "No diagnosis returned.";

    return res.status(200).json({ result: text });
  } catch (error) {
    return res.status(500).json({
      result: "DriveShift had a connection issue. Please try again.",
    });
  }
}
