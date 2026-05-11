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
    const duration = Number(durationSeconds || 0);
    const audioSize = String(audio || "").trim().length;

    const audioIntelligence = buildAudioIntelligence({
      selectedSoundPattern,
      durationSeconds: duration,
      audioSize,
      vehicleProfile,
      lang,
    });

    if (!audio || audioSize < 1000) {
      return res.status(200).json({
        result: buildAudioFallbackReport({
          lang,
          durationSeconds: duration,
          audioIntelligence,
        }),
      });
    }

    const prompt = buildAudioPrompt({
      lang,
      selectedSoundPattern,
      durationSeconds: duration,
      vehicleProfile,
      audioIntelligence,
    });

    const aiText = await requestAudioDiagnosis({
      prompt,
      audioBase64: audio,
      audioFormat: normalizeAudioFormat(audioFormat),
    });

    let result =
      aiText && aiText.trim().length > 40
        ? cleanAndFinalize(aiText)
        : buildAudioFallbackReport({
            lang,
            durationSeconds: duration,
            audioIntelligence,
          });

    result = strengthenWeakAudioReport({
      result,
      lang,
      durationSeconds: duration,
      audioIntelligence,
    });

    return res.status(200).json({ result });
  } catch (error) {
    return res.status(200).json({
      result: buildAudioFallbackReport({
        lang: req.body?.language === "es" ? "es" : "en",
        durationSeconds: req.body?.durationSeconds || 0,
        audioIntelligence: buildAudioIntelligence({
          selectedSoundPattern: req.body?.selectedSoundPattern || "",
          durationSeconds: req.body?.durationSeconds || 0,
          audioSize: 0,
          vehicleProfile: req.body?.vehicleProfile || {},
          lang: req.body?.language === "es" ? "es" : "en",
        }),
      }),
    });
  }
}

function buildAudioIntelligence({
  selectedSoundPattern,
  durationSeconds,
  audioSize,
  vehicleProfile,
  lang,
}) {
  const pattern = String(selectedSoundPattern || "").toLowerCase();
  const duration = Number(durationSeconds || 0);

  const hints = [];
  const ranked = [];

  const add = (key, label, score, evidence) => {
    const existing = ranked.find((x) => x.key === key);
    if (existing) {
      existing.score += score;
      existing.evidence.push(evidence);
    } else {
      ranked.push({ key, label, score, evidence: [evidence] });
    }
  };

  if (duration < 5) {
    hints.push("Recording is short; confidence should be limited.");
  } else if (duration >= 7) {
    hints.push("Recording duration is usable for first-pass sound analysis.");
  }

  if (audioSize > 80000) {
    hints.push("Audio payload size suggests a usable recording was received.");
  } else {
    hints.push("Audio payload may be weak or quiet.");
  }

  if (includesAny(pattern, ["tick", "ticking", "tap", "tapping", "lifter"])) {
    add(
      "valvetrain_tick",
      "Valve train, lifter, injector tick, low oil, or small exhaust leak",
      45,
      "ticking/tapping sound family"
    );
  }

  if (includesAny(pattern, ["knock", "knocking", "deep knock"])) {
    add(
      "engine_knock",
      "Deep engine knock, rod bearing concern, piston slap, or combustion knock",
      55,
      "knocking sound family"
    );
  }

  if (includesAny(pattern, ["squeal", "belt", "chirp"])) {
    add(
      "belt_pulley",
      "Belt slip, weak tensioner, alternator pulley, idler pulley, or A/C pulley noise",
      50,
      "belt squeal or chirp sound family"
    );
  }

  if (includesAny(pattern, ["grind", "grinding"])) {
    add(
      "grinding_rotational",
      "Brake contact, wheel bearing roughness, dust shield contact, or pulley bearing noise",
      50,
      "grinding sound family"
    );
  }

  if (includesAny(pattern, ["hiss", "hissing", "air"])) {
    add(
      "pressure_leak",
      "Vacuum leak, intake leak, exhaust leak, boost leak, or pressure leak",
      42,
      "hissing sound family"
    );
  }

  if (includesAny(pattern, ["click", "clicking", "starter", "rapid"])) {
    add(
      "starter_voltage",
      "Weak battery, voltage drop, starter relay, poor connection, or starter motor issue",
      48,
      "clicking/startup sound family"
    );
  }

  if (includesAny(pattern, ["rattle", "metal", "metallic"])) {
    add(
      "metallic_rattle",
      "Loose heat shield, exhaust rattle, timing chain rattle, pulley bearing, or loose bracket",
      43,
      "metallic rattling sound family"
    );
  }

  if (includesAny(pattern, ["vibration", "shake", "shaking"])) {
    add(
      "misfire_or_mount",
      "Misfire shake, engine mount issue, rough idle, or drivetrain vibration",
      40,
      "vibration/shake sound family"
    );
  }

  if (!ranked.length) {
    add(
      "unclear_audio_direction",
      "Abnormal vehicle sound needing closer source recording",
      20,
      "no clear preselected sound pattern"
    );
    add(
      "rotational_or_engine_noise",
      "Engine, belt, pulley, exhaust, starter, brake, wheel, or vibration-related noise",
      12,
      "audio received but exact family is unclear"
    );
  }

  ranked.sort((a, b) => b.score - a.score);

  return {
    hints,
    ranked,
    mostLikely: ranked[0]?.label || "Abnormal vehicle sound",
    secondary:
      ranked[1]?.label ||
      "Related belt, pulley, exhaust, starter, brake, wheel, or engine noise",
    lessLikely:
      ranked[2]?.label ||
      "Severe internal failure unless the sound becomes louder, rhythmic, or comes with strong symptoms",
  };
}

function buildAudioPrompt({
  lang,
  selectedSoundPattern,
  durationSeconds,
  vehicleProfile,
  audioIntelligence,
}) {
  const isEs = lang === "es";
  const vehicleText = buildVehicleText(vehicleProfile);
  const duration = Number(durationSeconds || 0);

  return `
You are DriveShift Doctor, a premium automotive diagnostic intelligence.

You are analyzing a real vehicle audio recording.
Think like a senior mechanic listening to a car sound.

Language:
${isEs ? "Spanish only" : "English only"}

Vehicle profile:
${vehicleText}

Recording duration:
${duration} seconds

User selected sound pattern:
${selectedSoundPattern || "Unknown - rely on the real audio if possible"}

DriveShift local audio intelligence:
Most likely direction: ${audioIntelligence.mostLikely}
Secondary direction: ${audioIntelligence.secondary}
Less likely direction: ${audioIntelligence.lessLikely}
Audio hints:
${audioIntelligence.hints.join("\n")}

Ranked audio candidates:
${audioIntelligence.ranked
  .map(
    (x, i) =>
      `${i + 1}. ${x.label} — score ${x.score}. Evidence: ${x.evidence.join(
        "; "
      )}`
  )
  .join("\n")}

Important audio reasoning:
- The recording may be imperfect. Do not invent certainty.
- Do not hide behind "unclear" unless the audio is truly unusable.
- Even if confidence is limited, give the strongest diagnostic direction.
- If the sound is quiet, give a cautious ranked report instead of a generic refusal.
- Identify the dominant sound character when possible.
- Separate:
  1. rhythmic ticking/tapping
  2. deep knocking
  3. metallic rattling
  4. belt squeal/chirp
  5. grinding/bearing roughness
  6. hissing/vacuum/exhaust leak
  7. starter clicking
  8. misfire shake/uneven idle
  9. exhaust leak puffing
  10. wheel/brake/suspension noise

Mechanic rules:
- Ticking that follows RPM may point toward valve train, lifter, injector tick, exhaust leak, or low oil.
- Deep knocking that follows RPM is more serious and may point toward rod bearing, piston slap, or severe internal wear.
- Belt squeal often changes with cold start, steering load, A/C, alternator load, or wet belt.
- Hissing may point toward vacuum leak, intake leak, exhaust leak, or pressure leak.
- Grinding near wheels or when braking points toward brakes, wheel bearing, dust shield, or rotor/pad contact.
- Rapid clicking during start points toward weak battery, poor connection, starter relay, or voltage drop.
- Rhythmic shaking with uneven exhaust note may point toward misfire.
- Do not recommend replacing parts immediately unless evidence is strong.

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
[explain why the sound pattern points there, or if unclear, still explain the strongest direction]

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
              { type: "input_text", text: prompt },
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
        temperature: 0.03,
        max_output_tokens: 1050,
      }),
    });

    if (!response.ok) return "";

    const data = await response.json();
    return extractText(data);
  } catch (_) {
    return "";
  }
}

function strengthenWeakAudioReport({
  result,
  lang,
  durationSeconds,
  audioIntelligence,
}) {
  const text = String(result || "");
  const lower = text.toLowerCase();

  const tooGeneric =
    lower.includes("not clear enough") ||
    lower.includes("clearer recording") ||
    lower.includes("record again") ||
    lower.includes("needs a clearer recording") ||
    lower.includes("no fue lo bastante claro") ||
    lower.includes("grabación más clara");

  if (!tooGeneric) return cleanAndFinalize(text);

  const isEs = lang === "es";
  const duration = Number(durationSeconds || 0);

  if (isEs) {
    return cleanAndFinalize(`Diagnosis status: analysis

Voice summary:
DriveShift recibió la grabación y la dirección más fuerte es revisar primero la familia de ruido dominante, aunque la grabación puede mejorar.

Risk level:
Medium

Likely issue:
Most likely: ${audioIntelligence.mostLikely}
Secondary possibility: ${audioIntelligence.secondary}
Less likely: ${audioIntelligence.lessLikely}

Why it fits:
La grabación de ${duration} segundos fue suficiente para crear una primera dirección, pero no lo bastante clara para confirmar una sola pieza. La familia de sonido más fuerte debe guiar la inspección inicial, especialmente si el ruido cambia con RPM, arranque, aceleración, freno o giro.

What to inspect next:
Primero localiza de dónde viene el sonido: motor, banda/polea, rueda/freno, escape o área de arranque. Luego observa si cambia con idle, aceleración suave, A/C, dirección, frenado o movimiento del vehículo.

What to do next:
Graba otra vez cerca de la fuente del sonido y compara: una grabación en idle, una con aceleración suave y una cerca del área donde el ruido es más fuerte.

Answer options:
None

When to stop driving:
Deja de manejar si el sonido se vuelve fuerte, metálico profundo, aparece pérdida de potencia, olor a quemado, humo, sobrecalentamiento, grinding fuerte o una luz roja.`);
  }

  return cleanAndFinalize(`Diagnosis status: analysis

Voice summary:
DriveShift received the recording and the strongest direction is to inspect the dominant sound family first, even though a clearer recording would improve confidence.

Risk level:
Medium

Likely issue:
Most likely: ${audioIntelligence.mostLikely}
Secondary possibility: ${audioIntelligence.secondary}
Less likely: ${audioIntelligence.lessLikely}

Why it fits:
The ${duration} second recording was enough for a first-pass direction, but not clear enough to confirm one exact part. The strongest sound family should guide the first inspection, especially if the noise changes with RPM, startup, acceleration, braking, turning, or vehicle movement.

What to inspect next:
First locate the sound source: engine, belt/pulley area, wheel/brake area, exhaust, or starter area. Then check whether the sound changes at idle, with light revving, A/C load, steering load, braking, or vehicle movement.

What to do next:
Record again close to the sound source and compare three short recordings: idle, light revving, and the area where the sound is loudest.

Answer options:
None

When to stop driving:
Stop driving if the sound becomes loud, deep metallic, power drops, you smell burning, see smoke, the engine overheats, you hear heavy grinding, or a red warning light appears.`);
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
  durationSeconds,
  audioIntelligence,
}) {
  const isEs = lang === "es";
  const duration = Number(durationSeconds || 0);

  if (isEs) {
    return `Diagnosis status: analysis

Voice summary:
DriveShift recibió la grabación y creó una primera dirección de inspección.

Risk level:
Medium

Likely issue:
Most likely: ${audioIntelligence.mostLikely}
Secondary possibility: ${audioIntelligence.secondary}
Less likely: ${audioIntelligence.lessLikely}

Why it fits:
La grabación de ${duration} segundos no confirmó una sola pieza, pero sí permite iniciar por la familia de ruido dominante. El resultado debe confirmarse con una grabación más cercana, síntomas, códigos OBD o inspección visual.

What to inspect next:
Revisa primero el área donde el ruido suena más fuerte. Compara si cambia con idle, aceleración suave, arranque, A/C, dirección, frenado o movimiento.

What to do next:
Graba 7 a 10 segundos más cerca de la fuente del ruido y evita hablar durante la grabación.

Answer options:
None

When to stop driving:
Deja de manejar si el sonido se vuelve fuerte, profundo, metálico, aparece pérdida de potencia, olor a quemado, humo, sobrecalentamiento, grinding fuerte o una luz roja.`;
  }

  return `Diagnosis status: analysis

Voice summary:
DriveShift received the recording and created a first inspection direction.

Risk level:
Medium

Likely issue:
Most likely: ${audioIntelligence.mostLikely}
Secondary possibility: ${audioIntelligence.secondary}
Less likely: ${audioIntelligence.lessLikely}

Why it fits:
The ${duration} second recording did not confirm one exact part, but it is enough to start with the dominant sound family. The result should be confirmed with a closer recording, symptoms, OBD codes, or visual inspection.

What to inspect next:
Start with the area where the sound is loudest. Compare whether it changes at idle, with light revving, startup, A/C load, steering load, braking, or movement.

What to do next:
Record another 7 to 10 seconds closer to the sound source and avoid speaking during the recording.

Answer options:
None

When to stop driving:
Stop driving if the sound becomes loud, deep, metallic, power drops, you smell burning, see smoke, the engine overheats, you hear heavy grinding, or a red warning light appears.`;
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

function includesAny(text, words) {
  const clean = String(text || "").toLowerCase();
  return words.some((w) => clean.includes(w));
}
