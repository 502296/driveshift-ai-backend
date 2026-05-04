export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ result: "Method not allowed" });
  }

  try {
    const {
      imageBase64,
      mimeType,
      detectedText,
      isEnglish
    } = req.body;

    const language = isEnglish ? "English" : "Spanish";

    const prompt = `
You are DriveShift, an expert automotive diagnostic system.

You are analyzing a REAL dashboard warning light image from a car.

Detected OCR text (may be wrong):
${detectedText || "None"}

Instructions:
- Identify the warning light from the IMAGE (not just text).
- If text is unclear, rely on visual reasoning.
- Be practical, calm, and precise.
- Focus on the most likely issue.
- Do not guess randomly.
- Do not mention AI or uncertainty.

Respond in ${language}.

Format exactly:

Likely issue:
[one short sentence]

Why it fits:
[2-3 short sentences]

What to do next:
[2-3 practical steps]

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
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: prompt,
              },
              {
                type: "input_image",
                image_base64: imageBase64,
                mime_type: mimeType || "image/jpeg",
              },
            ],
          },
        ],
        temperature: 0.2,
        max_output_tokens: 600,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        result:
          language === "English"
            ? "DriveShift could not analyze the image right now."
            : "DriveShift no pudo analizar la imagen ahora.",
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
