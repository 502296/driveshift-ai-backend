export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ result: "Method not allowed" });
  }

  try {
    const { image } = req.body;

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
              {
                type: "input_text",
                text: `
You are DriveShift Vision AI.

Analyze this car dashboard image.

1. Identify the warning light visually (even without text).
2. Name the issue clearly.
3. Explain briefly why.
4. Give 2-3 practical steps.
5. Give safety advice.

Respond EXACTLY in this format:

Likely issue:
...

Why it fits:
...

What to do next:
...

When to stop driving:
...
`
              },
              {
                type: "input_image",
                image_url: `data:image/jpeg;base64,${image}`
              }
            ]
          }
        ],
        temperature: 0.2,
        max_output_tokens: 500
      })
    });

    const data = await response.json();

    const text =
      data.output?.[0]?.content?.[0]?.text ||
      data.output_text ||
      "No diagnosis returned.";

    return res.status(200).json({ result: text });

  } catch (error) {
    return res.status(500).json({
      result: "DriveShift Vision failed. Try again."
    });
  }
}
