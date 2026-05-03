export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { issue, answers, isEnglish } = req.body;

    const userInput = answers
      .map(a => `${a.question}: ${a.answer}`)
      .join(" | ");

    const prompt = `
You are an expert AI car diagnostic assistant.

User issue: ${issue}
Answers: ${userInput}

Give a clear, professional diagnosis.

Rules:
- Be calm and expert
- No bullet points
- No technical overload
- Explain simply
- Suggest next step
`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a professional car diagnostic AI." },
          { role: "user", content: prompt }
        ],
        temperature: 0.6
      })
    });

    const data = await response.json();

    const result =
      data.choices?.[0]?.message?.content ||
      "Unable to analyze right now.";

    res.status(200).json({ result });

  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
}
