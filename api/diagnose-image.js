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

Vehicle profile:
${vehicleText}

OCR / detected text:
${text || "No readable text detected."}

Your job:
Analyze the uploaded image using visible evidence only.
Do not invent details.
Do not claim certainty from image alone.
If the image is not automotive, say the image does not show a clear vehicle-related inspection target and ask for a clearer car-related photo.
If the image is blurry, dark, too close, or unclear, say exactly what needs to be clearer.

Look for these visual patterns when present:
battery corrosion, loose battery terminals, damaged battery cables, swollen battery case, leaking fluid, oil leak, coolant residue, coolant color, transmission fluid leak, brake fluid leak, cracked hose, loose hose, torn belt, frayed belt, missing belt ribs, overheating signs, steam residue, dried coolant crust, disconnected wiring, burnt wiring, damaged connector, fuse/relay area concern, engine bay damage, air intake issue, loose duct, body damage, bumper/fender damage, headlight/taillight damage, tire sidewall damage, tire bulge, uneven tire wear, brake damage, ABS/brake warning, airbag/SRS warning, dashboard warning light, check engine light, oil pressure light, battery/charging light, temperature warning, TPMS warning.

Visual reasoning rules:
If battery terminals show white/green/blue powdery buildup, identify likely battery terminal corrosion and explain possible starting/charging/intermittent electrical symptoms.
If fluid is dark brown/black and oily, describe possible oil leak only if visual evidence supports it.
If fluid is green/orange/pink/yellow watery residue near hoses/radiator/reservoir, describe possible coolant leak or coolant residue.
If red/pink fluid under vehicle or near transmission area is visible, mention possible transmission fluid or power steering fluid depending on location, but avoid certainty.
If clear/slippery fluid near wheels/brakes is visible, mention possible brake fluid only as safety-sensitive and recommend inspection.
If a belt is cracked, frayed, shiny, torn, or missing ribs, identify belt wear and explain risk.
If tire sidewall has bulge, cut, exposed cords, or deep crack, treat as High risk and advise not to drive far.
If airbag/SRS light or deployed airbag/damaged steering wheel area is visible, treat as safety system issue.
If dashboard warning lights are visible, identify category and recommend OBD scan or appropriate system inspection.
If image shows accident/body damage, describe visible body impact and mention hidden structural/sensor damage may need body shop inspection.
If image shows wiring damage, burnt connector, melted plastic, or exposed wires, treat as electrical safety concern.
If image shows normal-looking part and no clear defect, say no obvious visual defect is visible and recommend next check instead of inventing a failure.

Report quality:
Be realistic and mechanic-like.
Use strong practical language, but avoid exaggeration.
Make the report feel specific to the image.
Do not say "as an AI".
Do not mention model limitations unless the image is unclear.
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
[short visual finding based on image]

Why it fits:
[what visible evidence supports this, or say image is unclear]

What to do next:
[practical next checks a driver/mechanic/body shop should do]

Answer options:
None

When to stop driving:
[clear safety advice based on visible risk]
`;

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 12000);

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
{ type: "input_text", text: prompt },
{
type: "input_image",
image_url: `data:image/jpeg;base64,${image}`,
},
],
},
],
temperature: 0.03,
max_output_tokens: 760,
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
Toma otra foto con buena luz, enfoca la pieza, luz del tablero, fuga, batería, cable, llanta o daño visible, y evita sombras o movimiento.

Answer options:
None

When to stop driving:
Deja de manejar si ves humo, fuga fuerte, olor a quemado, sobrecalentamiento, problema de frenos, daño severo de llanta, luz roja, o advertencia de airbag/SRS.`;
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
The image did not provide enough reliable vehicle-related visual detail to identify a specific cause.

What to do next:
Take another photo with good lighting, focus on the part, dashboard light, leak, battery, wire, tire, or visible damage, and avoid shadows or motion blur.

Answer options:
None

When to stop driving:
Stop driving if you see smoke, a fast leak, burning smell, overheating, brake problems, severe tire damage, a red warning light, or an airbag/SRS warning.`;
}
