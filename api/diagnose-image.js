export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ result: "Method not allowed" });
  }

  try {
    const {
      image,
      detectedText,
      language,
      vehicleProfile,
      inspectionType,
    } = req.body;

    const lang = language === "es" ? "es" : "en";
    const type = String(inspectionType || "Camera Inspection").trim();
    const text = String(detectedText || "").trim();
    const profile = vehicleProfile || {};

    if (!image) {
      return res.status(200).json({
        result: debugResult("No image received from Flutter."),
      });
    }

    const vehicleText = buildVehicleText(profile);

    const prompt = `
You are DriveShift Visual Mechanic, a calm senior automotive diagnostic expert.

Language:
${lang === "es" ? "Spanish" : "English"}

Inspection type:
${type}

Special dashboard warning interpretation rules:
Dashboard warning icons are valid diagnostic evidence even if no text is visible.
If the image shows a red oil can symbol, identify it as an engine oil pressure warning.
If the image shows a yellow tire horseshoe shape with an exclamation mark, identify it as a TPMS / low tire pressure warning.
If the image shows a battery symbol, identify it as a charging system or alternator warning.
If the image shows a thermometer symbol, identify it as an engine temperature or overheating warning.
If the image shows ABS letters, identify it as an ABS braking system warning.
If the image shows a check engine symbol, identify it as a check engine / emissions warning.
If the image shows an airbag seated person icon, identify it as an SRS / airbag warning.
If the image shows a red brake circle or PARK/BRAKE symbol, identify it as a brake system or parking brake warning.

If the dashboard warning symbol is large, centered, and clearly illuminated, do not say the image needs clearer inspection. Diagnose the visible warning symbol.

Vehicle profile:
${vehicleText}

OCR / detected text:
${text || "No readable text detected."}

Analyze the uploaded image using visible evidence only.
Do not invent details.
Do not claim certainty from image alone.
Do not mention AI.
No markdown.
No bullets.
No numbered lists.

Output exactly this format:

Diagnosis status: analysis

Voice summary:
[one short natural mechanic sentence]

Confidence:
[number 0-100]

Risk level:
[High or Medium or Low]

Likely issue:
[short visual finding]

Why it fits:
[what visible evidence supports this]

What to do next:
[practical next checks]

Answer options:
None

When to stop driving:
[clear safety advice]
`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    let response;

    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.DRIVESHIFT_VISION_MODEL || "gpt-4o-mini",
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
                  image_url: `data:image/jpeg;base64,${image}`,
                },
              ],
            },
          ],
          temperature: 0.03,
          max_output_tokens: 420,
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response) {
      return res.status(200).json({
        result: debugResult("No response object returned from OpenAI."),
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(200).json({
        result: debugResult(
          `OpenAI response not OK. Status: ${response.status}. Body: ${errorText}`
        ),
      });
    }

    const data = await response.json();
    let result = extractText(data).trim();

    if (!result) {
      return res.status(200).json({
        result: debugResult(
          `OpenAI returned JSON but no readable text. Raw: ${JSON.stringify(data).slice(0, 1200)}`
        ),
      });
    }

    result = normalizeImageReport(result);

    return res.status(200).json({ result });
  } catch (e) {
    return res.status(200).json({
      result: debugResult(`Backend exception: ${String(e)}`),
    });
  }
}

function buildVehicleText(profile) {
  if (!profile || typeof profile !== "object") {
    return "Unknown vehicle.";
  }

  const year = String(profile.year || "").trim();
  const make = String(profile.make || "").trim();
  const model = String(profile.model || "").trim();
  const mileage = String(profile.mileage || "").trim();

  const parts = [];

  if (year) parts.push(`Year: ${year}`);
  if (make) parts.push(`Make: ${make}`);
  if (model) parts.push(`Model: ${model}`);
  if (mileage) parts.push(`Mileage: ${mileage}`);

  return parts.length ? parts.join(", ") : "Unknown vehicle.";
}

function extractText(data) {
  try {
    if (typeof data.output_text === "string") {
      return data.output_text;
    }

    if (Array.isArray(data.output)) {
      return data.output
        .map((item) => {
          if (!item.content) return "";

          return item.content
            .map((c) => {
              if (typeof c.text === "string") return c.text;

              if (c.type === "output_text" && typeof c.text === "string") {
                return c.text;
              }

              return "";
            })
            .join("\n");
        })
        .join("\n")
        .trim();
    }

    return "";
  } catch (_) {
    return "";
  }
}

function normalizeImageReport(text) {
  let clean = String(text || "").trim();

  clean = clean
    .replaceAll("**", "")
    .replaceAll("__", "")
    .replaceAll("`", "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (/Diagnosis status:/i.test(clean)) {
    clean = clean.replace(
      /Diagnosis status:\s*(follow_up|analysis|final)/i,
      "Diagnosis status: analysis"
    );
  } else {
    clean = `Diagnosis status: analysis\n\n${clean}`;
  }

  if (/Answer options:/i.test(clean)) {
    clean = clean.replace(
      /Answer options:\s*([\s\S]*?)(?=When to stop driving:)/i,
      "Answer options:\nNone\n\n"
    );
  } else {
    clean = `${clean}\n\nAnswer options:\nNone`;
  }

  return clean.trim();
}

function debugResult(message) {
  return `Diagnosis status: analysis

Voice summary:
DriveShift debug mode found a backend issue.

Confidence:
1

Risk level:
Low

Likely issue:
Server debug mode

Why it fits:
${message}

What to do next:
Send this debug message to the developer and check the Vercel/OpenAI request.

Answer options:
None

When to stop driving:
No driving safety advice from debug mode.`;
}
