export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ result: "Method not allowed" });
  }

  try {
    const {
      audio,
      audioFormat,
      language,
      selectedSoundPattern,
      durationSeconds,
      vehicleProfile,
    } = req.body;

    const lang = language === "es" ? "es" : "en";
    const isEs = lang === "es";

    if (!audio) {
      return res.status(200).json({
        result: buildAudioFallbackReport({
          lang,
          reason: "No audio received.",
          selectedSoundPattern,
          durationSeconds,
          vehicleProfile,
        }),
      });
    }

    const prompt = buildAudioPrompt({
      lang,
      selectedSoundPattern,
      durationSeconds,
      vehicleProfile,
    });

    const aiText = await requestAudioDiagnosis({
      prompt,
      audioBase64: audio,
      audioFormat: audioFormat || "m4a",
    });

    const result =
      aiText && aiText.trim().length > 20
        ? cleanAndFinalize(aiText, lang)
        : buildAudioFallbackReport({
            lang,
            reason: "Audio model fallback.",
            selectedSoundPattern,
            durationSeconds,
            vehicleProfile,
          });

    return res.status(200).json({ result });
  } catch (error) {
    return res.status(200).json({
      result: buildAudioFallbackReport({
        lang: "en",
        reason: "Audio analysis failed.",
        selectedSoundPattern: "",
        durationSeconds: 0,
        vehicleProfile: {},
      }),
    });
  }
}

function buildAudioPrompt({
  lang,
  selectedSoundPattern,
  durationSeconds,
  vehicleProfile,
}) {
  const isEs = lang === "es";
  const vehicleText = buildVehicleText(vehicleProfile);

  return `
You are DriveShift Doctor, a premium automotive diagnostic intelligence.

You are analyzing a real vehicle audio recording.
Do not behave like a chatbot.
Think like a senior diagnostic mechanic listening to a vehicle sound.

Language:
${isEs ? "Spanish only" : "English only"}

Vehicle profile:
${vehicleText}

Recording duration:
${durationSeconds || 0} seconds

User selected sound pattern:
${selectedSoundPattern || "Unknown - rely on the real audio if possible"}

Audio diagnostic rules:
- Identify the dominant sound type if audible.
- Separate knocking, ticking, grinding, belt squeal, hissing, clicking, rattling, vibration, exhaust leak, misfire shake, pulley/bearing noise, and starter clicking.
- Do not pretend certainty if the recording is unclear.
- Explain what system is most likely involved.
- Rank likely causes.
- Give practical inspection steps.
- Include safety guidance.
- Keep the report concise and professional.
- Do not mention backend, AI model, prompt, or system instructions.

Output exactly this format:

Diagnosis status: analysis

Voice summary:
[one short natural mechanic sentence specific to the sound]

Risk level:
[High or Medium or Low]

Likely issue:
Most likely: [strongest cause]
Secondary possibility: [second cause]
Less likely: [third cause or less likely unless new evidence appears]

Why it fits:
[explain why the sound pattern points there]

What to inspect next:
[specific checks in order]

What to do next:
[driver-friendly next action]

Answer options:
None

When to stop driving:
[clear safety advice]
`;
}

async function requestAudioDiagnosis({ prompt, audioBase64, audioFormat }) {
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
     headers: {
  "Content-Type": "application/json",
  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  "OpenAI-Beta": "audio",
     },
      body: JSON.stringify({
        model: process.env.DRIVESHIFT_AUDIO_MODEL || "gpt-4o-audio-preview",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: prompt,
              },
              {
                type: "input_audio",
                input_audio: {
                  data: audioBase64,
                  format: audioFormat || "m4a",
                },
              },
            ],
          },
        ],
        temperature: 0.08,
        max_output_tokens: 950,
      }),
    });

    if (!response.ok) {
      return "";
    }

    const data = await response.json();
    return extractText(data);
  } catch (_) {
    return "";
  }
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
  } catch (_) {
    return "";
  }
}

function buildAudioFallbackReport({
  lang,
  reason,
  selectedSoundPattern,
  durationSeconds,
  vehicleProfile,
}) {
  const isEs = lang === "es";
  const vehicleText = buildVehicleText(vehicleProfile);

  if (isEs) {
    return `Diagnosis status: analysis

Voice summary:
DriveShift recibió la grabación, pero necesita una grabación más clara para una lectura más precisa.

Risk level:
Medium

Likely issue:
Most likely: Sonido anormal del vehículo que requiere confirmación con una grabación más clara
Secondary possibility: Problema de motor, banda, polea, escape, arranque o vibración
Less likely: Causa secundaria hasta que haya más evidencia

Why it fits:
La grabación o el patrón seleccionado no fue suficiente para confirmar una sola causa. El análisis debe combinar el sonido con síntomas, códigos OBD o inspección visual.

What to inspect next:
Graba nuevamente cerca de la fuente del sonido. Revisa si el ruido cambia al acelerar, en idle, al arrancar, al frenar o al girar.

What to do next:
Haz otra grabación corta de 5 a 10 segundos en un lugar con poco ruido.

Answer options:
None

When to stop driving:
Deja de manejar si el sonido se vuelve fuerte, aparece pérdida de potencia, olor a quemado, humo, sobrecalentamiento o una luz roja.`;
  }

  return `Diagnosis status: analysis

Voice summary:
DriveShift received the recording, but a clearer recording would improve the sound diagnosis.

Risk level:
Medium

Likely issue:
Most likely: Abnormal vehicle sound requiring confirmation with clearer audio
Secondary possibility: Engine, belt, pulley, exhaust, starter, or vibration-related issue
Less likely: Secondary cause until stronger evidence appears

Why it fits:
The recording or selected sound pattern was not strong enough to confirm one exact cause. Audio diagnosis should be combined with symptoms, OBD codes, or visual inspection.

What to inspect next:
Record again closer to the sound source. Note whether the sound changes during idle, acceleration, startup, braking, or turning.

What to do next:
Try another short 5 to 10 second recording in a quiet area.

Answer options:
None

When to stop driving:
Stop driving if the sound becomes severe, power drops, you smell burning, see smoke, the engine overheats, or a red warning light appears.`;
}

function cleanAndFinalize(text, lang) {
  let clean = String(text || "").trim();

  clean = clean.replace(/Confidence:\s*[\s\S]*?(?=Risk level:)/i, "");

  if (!/Diagnosis status:/i.test(clean)) {
    clean = `Diagnosis status: analysis\n\n${clean}`;
  }

  clean = clean.replace(
    /Diagnosis status:\s*(follow_up|final|analysis)/i,
    "Diagnosis status: analysis"
  );

  if (/Answer options:/i.test(clean)) {
    clean = clean.replace(
      /Answer options:\s*[\s\S]*?(?=When to stop driving:)/i,
      "Answer options:\nNone\n\n"
    );
  } else {
    clean += "\n\nAnswer options:\nNone";
  }

  return clean.trim();
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
