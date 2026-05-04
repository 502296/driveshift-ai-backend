export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ result: "Method not allowed" });
  }

  try {
    const { imageBase64 } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ result: "No image provided" });
    }

    const prompt = `
You are DriveShift, an expert automotive diagnostic AI.

Analyze this dashboard warning light image.

Identify:
- What warning light is shown
- What it usually means
- The most likely cause
- What the driver should do next

Respond in this format:

Likely issue:
[short answer]

Why it fits:
[clear explanation]

What to do next:
[practical steps]

When to stop driving:
[safety advice]
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              {
                type: "input_image",
                image_url: `data:image/jpeg;base64,${imageBase64}`,
              },
            ],
          },
        ],
        max_output_tokens: 500,
      }),
    });

    const data = await response.json();

    const text =
      data.output?.[0]?.content?.[0]?.text ||
      data.output_text ||
      "No diagnosis returned.";

    return res.status(200).json({ result: text });
  } catch (err) {
    return res.status(500).json({
      result: "DriveShift image analysis failed.",
    });
  }
}
