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
        result: fallbackImageResult(lang),
      });
    }

    const vehicleText = buildVehicleText(profile);

    const prompt = `
You are DriveShift Visual Mechanic, a calm senior automotive diagnostic expert.

You inspect automotive images like a real mechanic, electrical technician, body shop estimator, and safety inspector.

Language:
${lang === "es" ? "Spanish" : "English"}

Inspection type:
${type}
Special dashboard warning interpretation rules:

If the image shows a red oil can symbol, identify it as an engine oil pressure warning.
If the image shows a battery symbol, identify it as a charging system or alternator warning.
If the image shows a thermometer symbol, identify it as an engine temperature or overheating warning.
If the image shows ABS letters, identify it as an ABS braking system warning.
If the image shows a check engine symbol, identify it as a check engine / emissions warning.
If the image shows a tire symbol with exclamation mark, identify it as a TPMS warning.
If the image shows an airbag seated person icon, identify it as an SRS / airbag warning.

Dashboard warning icons are important even if no text is visible.
Treat illuminated dashboard symbols as valid diagnostic evidence.

Vehicle profile:
${vehicleText}

OCR / detected text:
${text || "No readable text detected."}

Your job:
Analyze the uploaded image using visible evidence only.
Do not invent details.
Do not claim certainty from image alone.

If the image is blurry, dark, too close, or unclear, explain exactly what needs to be clearer.

Look for:
battery corrosion, leaking fluids, cracked hoses, damaged belts,
coolant residue, burnt wiring, damaged connectors, warning lights,
tire damage, overheating signs, dashboard warnings, body damage,
oil leaks, brake leaks, loose wiring, broken clips, and visible wear.

Rules:
Be realistic and mechanic-like.
No markdown.
No bullet points.
No numbered lists.
Do not mention AI.

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
          model:
              process.env.DRIVESHIFT_VISION_MODEL || "gpt-4o-mini",

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
                  image_url: {
                    url: `data:image/jpeg;base64,${image}`,
                  },
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

    if (!response || !response.ok) {
      return res.status(200).json({
        result: fallbackImageResult(lang),
      });
    }

    const data = await response.json();

    let result = extractText(data).trim();

    if (!result) {
      result = fallbackImageResult(lang);
    }

    result = normalizeImageReport(result, lang);

    return res.status(200).json({
      result,
    });
  } catch (_) {
    return res.status(200).json({
      result: fallbackImageResult("en"),
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
    if (data.output_text) {
      return data.output_text;
    }

    if (Array.isArray(data.output)) {
      return data.output
        .flatMap((item) => item.content || [])
        .map((content) => content.text || "")
        .join("\n")
        .trim();
    }

    return "";
  } catch (_) {
    return "";
  }
}

function normalizeImageReport(text, lang) {
  let clean = String(text || "").trim();

  clean = clean
    .replaceAll("**", "")
    .replaceAll("__", "")
    .replaceAll("`", "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const required = [
    "Diagnosis status:",
    "Voice summary:",
    "Confidence:",
    "Risk level:",
    "Likely issue:",
    "Why it fits:",
    "What to do next:",
    "Answer options:",
    "When to stop driving:",
  ];

  const hasAll = required.every((label) =>
    clean.toLowerCase().includes(label.toLowerCase())
  );

  if (!hasAll) {
    return fallbackImageResult(lang);
  }

  clean = clean.replace(
    /Diagnosis status:\s*(follow_up|analysis|final)/i,
    "Diagnosis status: analysis"
  );

  clean = clean.replace(
    /Answer options:\s*([\s\S]*?)(?=When to stop driving:)/i,
    "Answer options:\nNone\n\n"
  );

  return clean.trim();
}

function fallbackImageResult(lang) {
  if (lang === "es") {
    return `Diagnosis status: analysis

Voice summary:
Necesito una imagen más clara antes de confirmar una dirección visual.

Confidence:
45

Risk level:
Medium

Likely issue:
Image needs clearer inspection.

Why it fits:
La imagen no dio suficiente información visual confiable para identificar una causa específica.

What to do next:
Toma otra foto con buena luz y enfoca mejor la pieza o advertencia.

Answer options:
None

When to stop driving:
Deja de manejar si ves humo, olor a quemado, sobrecalentamiento o una luz roja.`;
  }

  return `Diagnosis status: analysis

Voice summary:
I need a clearer vehicle image before confirming a visual direction.

Confidence:
45

Risk level:
Medium

Likely issue:
Image needs clearer inspection.

Why it fits:
The image did not provide enough reliable vehicle detail.

What to do next:
Take another photo with better lighting and clearer focus on the affected area.

Answer options:
None

When to stop driving:
Stop driving if you see smoke, overheating, severe leaks, brake issues, or a red warning light.`;
}
