export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ result: "Method not allowed" });
  }

  try {
    const { issue, answers } = req.body;

    const userInput =
      Array.isArray(answers) && answers.length > 0
        ? answers.map((a) => `${a.question}: ${a.answer}`).join("\n")
        : "No additional answers.";

    // 🔥 Detect OBD code
    const possibleObdCode = String(issue || "").match(/\b[PCBU][0-9A-F]{4}\b/i);
    const hasObdCode = Boolean(possibleObdCode);
    const obdCode = hasObdCode ? possibleObdCode[0].toUpperCase() : "";

    // =========================
    // 🧠 LEVEL 6 PROMPT
    // =========================
    const prompt = `
You are DriveShift Doctor — a calm, highly experienced automotive diagnostic expert.

You think like a master mechanic, not a chatbot.

========================
USER INPUT
========================
Issue:
${issue}

Extra details:
${userInput}

Detected OBD code:
${hasObdCode ? obdCode : "None"}

========================
HOW YOU SHOULD THINK
========================
- Prioritize the most likely mechanical cause
- Connect symptoms logically
- If OBD exists → explain what it usually means but do not rely on it alone
- Avoid guessing multiple causes
- Give practical, realistic advice
- Keep explanation simple but expert-level

========================
STRICT RULES
========================
- English only
- No markdown
- No bullet points
- No lists
- No AI references
- No "Based on the information"
- No over-explaining
- No fear language
- Sound like a real mechanic

========================
OUTPUT FORMAT (MANDATORY)
========================

Confidence:
[number 0-100]

Risk level:
[High or Medium or Low]

Likely issue:
[short direct sentence]

Why it fits:
[2 short clear sentences explaining logic]

What to do next:
[2 practical real-world steps]

When to stop driving:
[clear safety advice or when safe to continue]
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
        temperature: 0.25, // 🔥 calmer + smarter
        max_output_tokens: 600,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ result: fallback() });
    }

    // =========================
    // 🔥 SMART EXTRACTION
    // =========================
    let text = "";

    if (data.output_text) {
      text = data.output_text;
    } else if (Array.isArray(data.output)) {
      for (const block of data.output) {
        if (block?.content) {
          for (const c of block.content) {
            if (c?.text) {
              text += c.text + "\n";
            }
          }
        }
      }
    }

    text = text.trim();

    if (!text) {
      return res.status(200).json({ result: fallback() });
    }

    // =========================
    // 🔥 ENSURE FORMAT EXISTS
    // =========================
    if (!text.toLowerCase().includes("confidence")) {
      return res.status(200).json({
        result: enhanceFallback(text),
      });
    }

    return res.status(200).json({ result: text });

  } catch (error) {
    return res.status(500).json({
      result: fallback(),
    });
  }
}

// =========================
// 🔥 SMART FALLBACK
// =========================
function fallback() {
  return `
Confidence:
65

Risk level:
Medium

Likely issue:
Unable to determine exact issue.

Why it fits:
The system could not fully process the input.

What to do next:
Retry with clearer symptoms or inspect basic components.

When to stop driving:
Stop if warning lights appear or driving feels unsafe.
`;
}

// =========================
// 🔥 ENHANCE PARTIAL RESPONSE
// =========================
function enhanceFallback(text) {
  return `
Confidence:
70

Risk level:
Medium

Likely issue:
${text}

Why it fits:
The symptoms suggest a likely mechanical issue.

What to do next:
Start with basic checks, then inspect professionally if needed.

When to stop driving:
Stop if the vehicle behaves abnormally or shows warnings.
`;
}
