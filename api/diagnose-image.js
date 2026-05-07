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
You are DriveShift Visual Mechanic, a calm senior automotive diagnostic mechanic.

Language:
${lang === "es" ? "Spanish" : "English"}

Inspection type:
${type}

Vehicle profile:
${vehicleText}

OCR / detected text:
${text || "No readable text detected."}

Analyze the image like a real mechanic would.
Do not pretend certainty from image alone.
Use visual evidence only.
If the image shows dashboard lights, identify likely warning category.
If it shows engine bay, look for leaks, loose hoses, corrosion, disconnected wires, belt issues, coolant/oil signs, or visible damage.
If it shows a leak, describe likely fluid type only if visual clues support it.
If it shows a battery, check corrosion, loose terminals, swelling, or cable condition.
If image is unclear, say it needs a clearer photo.

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
[what is visible or what the image suggests]

What to do next:
[practical next steps]

Answer options:
None

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
        model: process.env.DRIVESHIFT_VISION_MODEL || "gpt-4o-mini",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              {
                type: "input_image",
                image_url: `data:image/jpeg;base64,${image}`,
              },
            ],
          },
        ],
        temperature: 0.05,
        max_output_tokens: 650,
      }),
    });

    if (!response.ok) {
      return res.status(200).json({
        result: fallbackImageResult(lang),
      });
    }

    const data = await response.json();
    const result = extractText(data).trim();

    return res.status(200).json({
      result: result || fallbackImageResult(lang),
    });
  } catch (_) {
    return res.status(200).json({
      result: fallbackImageResult("en"),
    });
  }
}

function buildVehicleText(profile) {
  if (!profile || typeof profile !== "object") return "Unknown vehicle.";

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
    if (data.output_text) return data.output_text;

    if (Array.isArray(data.output)) {
      return data.output
        .flatMap((item) => item.content || [])
        .map((content) => content.text || "")
        .join("\n")
        .trim();
    }

    return "";
  } catch {
    return "";
  }
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
Toma otra foto con buena luz, enfoca la pieza o luz del tablero, y evita sombras o movimiento.

Answer options:
None

When to stop driving:
Deja de manejar si ves humo, fuga fuerte, olor a quemado, sobrecalentamiento, problema de frenos, o una luz roja.`;
  }

  return `Diagnosis status: analysis

Voice summary:
I need a clearer image before confirming a visual direction.

Confidence:
45

Risk level:
Medium

Likely issue:
Image needs clearer inspection.

Why it fits:
The image did not provide enough reliable visual detail to identify a specific cause.

What to do next:
Take another photo with good lighting, focus on the part or dashboard light, and avoid shadows or motion blur.

Answer options:
None

When to stop driving:
Stop driving if you see smoke, a fast leak, burning smell, overheating, brake problems, or a red warning light.`;
}
