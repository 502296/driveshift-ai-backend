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

    if (!audio || String(audio).trim().length < 1000) {
      return res.status(200).json({
        result: buildAudioFallbackReport({
          lang,
          reason: "No usable audio received.",
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
      audioFormat: normalizeAudioFormat(audioFormat),
    });

    const result =
      aiText && aiText.trim().length > 40
        ? cleanAndFinalize(aiText)
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
        lang: req.body?.language === "es" ? "es" : "en",
        reason: "Audio analysis failed.",
        selectedSoundPattern: req.body?.selectedSoundPattern || "",
        durationSeconds: req.body?.durationSeconds || 0,
        vehicleProfile: req.body?.vehicleProfile || {},
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
  const duration = Number(durationSeconds || 0);

  return `
You are DriveShift Doctor, a premium automotive diagnostic intelligence.

You are analyzing a real vehicle audio recording.
Think like a senior mechanic listening to a real car sound.

Language:
${isEs ? "Spanish only" : "English only"}

Vehicle profile:
${vehicleText}

Recording duration:
${duration} seconds

User selected sound pattern:
${selectedSoundPattern || "Unknown - rely on the real audio if possible"}

Important audio reasoning:
- The recording may be imperfect. Do not invent certainty.
- If the sound is too quiet, unclear, or mostly background noise, say that clearly.
- If you can hear a pattern, identify the dominant sound character.
- Separate these sound families:
  1. Rhythmic ticking / tapping
  2. Deep knocking
  3. Metallic rattling
  4. Belt squeal / chirp
  5. Grinding / bearing roughness
  6. Hissing / vacuum or exhaust leak
  7. Starter clicking / rapid clicking
  8. Misfire shake / uneven idle
  9. Exhaust leak puffing
  10. Wheel / brake / suspension noise

Mechanic logic:
- Ticking that follows RPM may point toward valve train, lifter, injector tick, exhaust leak, or low oil.
- Deep knocking that follows RPM is more serious and may point toward rod bearing, piston slap, or severe internal engine wear.
- Belt squeal often changes with cold start, steering load, A/C, alternator load, or wet belt.
- Hissing may point toward vacuum leak, intake leak, exhaust leak, or pressure leak.
- Grinding near wheels or when braking points toward brakes, wheel bearing, dust shield, or rotor/pad contact.
- Rapid clicking during start points toward weak battery, poor connection, starter relay, or voltage drop.
- Rhythmic shaking with uneven exhaust note may point toward misfire.
- Do not recommend replacing parts immediately unless the evidence is strong.

Report style:
- Premium, calm, mechanic-like.
- Concise but useful.
- Rank causes clearly.
- Do not mention AI, backend, model, prompt, or system instructions.
- Do not ask another question.
- Do not output markdown tables.

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
[explain why the sound pattern points there, or say the recording is not clear enough]

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
                  format: audioFormat,
                },
              },
            ],
          },
        ],
        temperature: 0.04,
        max_output_tokens: 1000,
      }),
    });

    if (!response.ok) return "";

    const data = await response.json();
    return extractText(data);
  } catch (_) {
    return "";
  }
}

function normalizeAudioFormat(format) {
  const f = String(format || "").toLowerCase().trim();

  if (f.includes("wav")) return "wav";
  if (f.includes("mp3")) return "mp3";
  if (f.includes("webm")) return "webm";
  if (f.includes("mp4")) return "mp4";
  if (f.includes("m4a")) return "m4a";
  if (f.includes("aac")) return "m4a";

  return "m4a";
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
  const duration = Number(durationSeconds || 0);

  if (isEs) {
    return `Diagnosis status: analysis

Voice summary:
DriveShift recibió la grabación, pero el sonido no fue lo bastante claro para identificar una sola causa.

Risk level:
Medium

Likely issue:
Most likely: Sonido anormal que necesita una grabación más clara cerca de la fuente
Secondary possibility: Ruido de motor, banda, polea, escape, arranque, freno, rueda o vibración
Less likely: Causa interna severa hasta que el sonido sea más claro o aparezcan síntomas fuertes

Why it fits:
La grabación de ${duration} segundos no dio una señal suficientemente fuerte para separar con seguridad entre ruido de motor, banda, polea, escape, arranque o vibración. El audio debe combinarse con síntomas, códigos OBD o inspección visual.

What to inspect next:
Graba otra vez de 7 a 10 segundos cerca de la fuente del sonido. Haz una grabación en idle, otra al acelerar suavemente, y otra cerca del área donde se escucha más fuerte.

What to do next:
Intenta grabar en un lugar tranquilo. No hables durante la grabación. Mantén el teléfono estable y cerca del motor, rueda, banda o zona del ruido.

Answer options:
None

When to stop driving:
Deja de manejar si el sonido se vuelve fuerte, aparece pérdida de potencia, olor a quemado, humo, sobrecalentamiento, grinding fuerte, o una luz roja.`;
  }

  return `Diagnosis status: analysis

Voice summary:
DriveShift received the recording, but the sound was not clear enough to identify one confident cause.

Risk level:
Medium

Likely issue:
Most likely: Abnormal sound that needs a clearer recording near the source
Secondary possibility: Engine, belt, pulley, exhaust, starter, brake, wheel, or vibration-related noise
Less likely: Severe internal failure unless the sound becomes louder, rhythmic, or comes with strong symptoms

Why it fits:
The ${duration} second recording did not provide a strong enough sound pattern to safely separate engine, belt, pulley, exhaust, starter, brake, wheel, or vibration noise. Audio diagnosis should be combined with symptoms, OBD codes, or visual inspection.

What to inspect next:
Record again for 7 to 10 seconds close to the sound source. Try one recording at idle, one during light revving, and one near the area where the sound is loudest.

What to do next:
Record in a quiet area. Do not speak during the recording. Hold the phone steady and close to the engine, wheel, belt area, or source of the noise.

Answer options:
None

When to stop driving:
Stop driving if the sound becomes severe, power drops, you smell burning, see smoke, the engine overheats, you hear heavy grinding, or a red warning light appears.`;
}

function cleanAndFinalize(text) {
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

  clean = clean
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return clean;
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
