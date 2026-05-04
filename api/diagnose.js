export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ result: "Method not allowed" });
  }

  try {
    const { issue, answers } = req.body;

    const userInput = Array.isArray(answers) && answers.length > 0
      ? answers.map((a) => `${a.question}: ${a.answer}`).join("\n")
      : "No additional answers.";

    const possibleObdCode = String(issue || "").match(/\b[PCBU][0-9A-F]{4}\b/i);
    const hasObdCode = Boolean(possibleObdCode);
    const obdCode = hasObdCode ? possibleObdCode[0].toUpperCase() : "";

    const prompt = `
You are DriveShift — an elite automotive diagnostic intelligence system.

You speak like a calm, experienced master mechanic.

User issue:
${issue}

Extra details:
${userInput}

Detected OBD code:
${hasObdCode ? obdCode : "None"}

========================
CRITICAL RULES:
========================
- Always respond in English
- Never mention AI, system, or model
- Be calm, confident, and precise
- No markdown
- No bullet points
- No explanations about your reasoning
- No "Based on the information"
- Focus on the most likely cause first

========================
YOU MUST FOLLOW THIS FORMAT EXACTLY:
========================

Confidence:
[number from 0 to 100]

Risk level:
[High or Medium or Low]

Likely issue:
[one short clear sentence]

Why it fits:
[2 short simple sentences]

What to do next:
[2 simple practical steps]

When to stop driving:
[clear safety advice or when it's safe]
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o", // 🔥 upgraded
        input: prompt,
        temperature: 0.3,
        max_output_tokens: 600,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        result: fallback(),
      });
    }

    // 🔥 Extract safely
    const text =
      data.output?.[0]?.content?.[0]?.text ||
      data.output_text ||
      "";

    if (!text || text.trim().length === 0) {
      return res.status(200).json({ result: fallback() });
    }

    return res.status(200).json({ result: text });

  } catch (error) {
    return res.status(500).json({
      result: fallback(),
    });
  }
}

// 🔥 fallback always includes confidence + risk
function fallback() {
  return `
Confidence:
60

Risk level:
Medium

Likely issue:
Unable to determine exact issue at this time.

Why it fits:
The system could not process the request correctly.

What to do next:
Try again with clearer details or check the vehicle manually.

When to stop driving:
Stop driving if the vehicle shows unusual behavior or warning lights.
`;
}
