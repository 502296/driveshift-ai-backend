// api/audio-diagnose.js

const REQUIRED_AUDIO_FOLLOWUPS = 0;

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
      audioFollowUpAnswers,
    } = req.body || {};

    const lang = language === "es" ? "es" : "en";
    const format = normalizeAudioFormat(audioFormat);
    const audioBase64 = String(audio || "").trim();
    const duration = Number(durationSeconds || 0);
    const answers = Array.isArray(audioFollowUpAnswers)
      ? audioFollowUpAnswers
      : [];

    if (!audioBase64 || audioBase64.length < 1000) {
      return res.status(200).json({
        result: buildNoAudioResponse(lang),
      });
    }

    const mode =
      answers.length < REQUIRED_AUDIO_FOLLOWUPS ? "follow_up" : "analysis";

    const prompt = buildPrompt({
      mode,
      lang,
      selectedSoundPattern,
      durationSeconds: duration,
      vehicleProfile,
      answers,
    });

    const aiText = await requestAudioDiagnosis({
      prompt,
      audioBase64,
      audioFormat: format,
    });

    const result = cleanAndFinalize({
      text: aiText,
      mode,
      lang,
    });

    return res.status(200).json({ result });
  } catch (error) {
    console.log("AUDIO HANDLER ERROR:", error);

    const lang = req.body?.language === "es" ? "es" : "en";
    return res.status(200).json({
      result: buildSafeErrorResponse(lang),
    });
  }
}

function buildPrompt({
  mode,
  lang,
  selectedSoundPattern,
  durationSeconds,
  vehicleProfile,
  answers,
}) {
  const isEs = lang === "es";
  const vehicleText = buildVehicleText(vehicleProfile);
  const answerText = buildAnswersText(answers);

  const outputFormat =
    mode === "follow_up"
      ? `
Output exactly this format:

Diagnosis status: audio_follow_up

Voice summary:
[one short mechanic sentence showing that you heard the recording]

Audio direction:
[short direction based on the sound and selected area]

Question 1:
[one confirmation question that helps verify the sound behavior]

Answer options 1:
[option 1]
[option 2]
[option 3]
[option 4]

Question 2:
[one confirmation question that helps verify the sound character]

Answer options 2:
[option 1]
[option 2]
[option 3]
[option 4]
`
      : `
Output exactly this format:

Diagnosis status: analysis

Voice summary:
[a calm mechanic-style observation that immediately reflects the sound behavior and what an experienced technician would notice first]

Risk level:
[High or Medium or Low]

Likely issue:
Most likely: [strongest cause]
Secondary possibility: [second cause]
Less likely: [third cause]

Why it fits:
[explain the mechanical behavior behind the sound like a senior diagnostic technician inspecting the vehicle in person. Mention how RPM, heat, load, speed, braking, or vibration behavior affects the suspected system]

What to inspect next:
[describe the exact inspection path a professional workshop technician would follow to isolate the sound source]

What to do next:
[give calm professional guidance that balances mechanical risk, drivability, and urgency without sounding dramatic]

Answer options:
None

When to stop driving:
[clear safety advice]
`;

  return `
You are DriveShift Doctor, a premium automotive sound diagnostic system.

You are listening to a real vehicle audio recording.
Do not mention AI.
Do not say the recording is unclear unless the audio is truly empty.
Do not ask the user to record again unless the audio is missing.
Do not produce generic advice.
Do not recommend replacing parts immediately unless evidence is strong.

Important:
The follow-up questions are only confirmation questions.
They must feel like the scanner already listened to the sound.
Do not make the user feel the diagnosis depends only on button answers.

Language:
${isEs ? "Spanish only" : "English only"}

Mode:
${mode}

Vehicle profile:
${vehicleText}

Recording duration:
${durationSeconds || "Unknown"} seconds

Selected sound source / pattern:
${selectedSoundPattern || "Not selected"}

Previous confirmation answers:
${answerText || "None"}

Diagnostic rules:
- If selected area is engine bay, prioritize RPM-linked engine, valvetrain, injector, lifter, belt, pulley, exhaust leak, or knock.
- If selected area is wheel area, prioritize speed-linked wheel bearing, tire, hub, brake drag, CV axle, or suspension noise.
- If selected area is under car or exhaust, prioritize exhaust leak, heat shield, flex pipe, catalytic converter shield, loose bracket, or driveline vibration.
- If sound follows RPM, raise engine-side causes.
- If sound follows vehicle speed, raise wheel/drivetrain causes.
- If braking changes the sound, raise brake causes.
- If sound is fast ticking from engine bay, raise injector tick, lifter tap, valve train tick, or small exhaust leak.
- If sound is deep metallic knock from engine bay, raise internal knock, flexplate, pulley impact, or engine mount movement.
- If sound is squeal/chirp, raise belt, tensioner, idler pulley, alternator pulley, or A/C pulley.
- If sound is scraping/grinding, raise brake, dust shield, rotor/pad contact, pulley contact, or metal rubbing.

Reasoning style:

You are not a chatbot.
You are a world-class diagnostic mechanic inside a premium scan system.

Your reports must sound like an elite master technician inspecting a real vehicle in a high-end professional workshop.

Think mechanically.
Prioritize real-world mechanical reasoning over generic advice.

Do not overreact.
Do not guess randomly.
Do not recommend replacing parts unless the evidence supports it.

The report must feel:
- calm
- intelligent
- technical
- trustworthy
- experience-driven
- like a real technician inspected the vehicle personally
- like someone experienced actually listened to the sound
- natural and observant

The technician should sound observant and mechanically experienced.
The report should feel like someone actually listened to the vehicle carefully.
Each section should introduce new mechanical insight instead of repeating the same wording.
Avoid repeating the same cause too many times unless the evidence is extremely strong.

When analyzing sounds:
- connect RPM behavior to engine/internal rotating components
- connect speed-related noise to wheels, bearings, tires, axles, or driveline
- connect braking behavior to brake hardware or rotor issues
- connect metallic ticking to lifters, injectors, exhaust leaks, pulleys, or valvetrain depending on evidence
- connect deep knocking carefully to internal engine risk only if evidence supports it

Explain WHY the sound matches the suspected system.
Mention patterns a real mechanic would notice.

Avoid robotic phrases.
Do not repeat the same wording across sections.
Each section should feel naturally written by an experienced mechanic.
The Voice summary should sound like a real first impression after hearing the vehicle.

Avoid generic repair-shop language.
Avoid sounding like customer support.

The final report should feel like:
"A senior diagnostic technician inspected the vehicle personally."

No markdown bullets.
No confidence percentage.

${outputFormat}
`;
}

async function requestAudioDiagnosis({ prompt, audioBase64, audioFormat }) {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
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
        temperature: 0.05,
        max_tokens: 1400,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log("OPENAI AUDIO ERROR:", response.status, errorText);
      return "";
    }

    const data = await response.json();
    console.log("OPENAI AUDIO RESPONSE:", JSON.stringify(data, null, 2));

    return data?.choices?.[0]?.message?.content || "";
  } catch (error) {
    console.log("OPENAI AUDIO REQUEST FAILED:", error);
    return "";
  }
}

function cleanAndFinalize({ text, mode, lang }) {
  let clean = String(text || "").trim();

  if (!clean || clean.length < 40) {
    if (mode === "follow_up") {
      return buildEmergencyFollowUp(lang);
    }

    return buildSafeErrorResponse(lang);
  }

  clean = clean
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/Confidence:\s*[\s\S]*?(?=\n[A-Z][A-Za-z ]+:|$)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (mode === "follow_up") {
    clean = clean.replace(
      /Diagnosis status:\s*(follow_up|analysis|final|audio_follow_up)/i,
      "Diagnosis status: audio_follow_up"
    );

    if (!/Diagnosis status:\s*audio_follow_up/i.test(clean)) {
      clean = `Diagnosis status: audio_follow_up\n\n${clean}`;
    }

    return clean.trim();
  }

  clean = clean.replace(
    /Diagnosis status:\s*(follow_up|audio_follow_up|final|analysis)/i,
    "Diagnosis status: analysis"
  );

  if (!/Diagnosis status:/i.test(clean)) {
    clean = `Diagnosis status: analysis\n\n${clean}`;
  }

  if (/Answer options:/i.test(clean)) {
    clean = clean.replace(
      /Answer options:\s*[\s\S]*?(?=When to stop driving:|$)/i,
      "Answer options:\nNone\n\n"
    );
  } else {
    clean += "\n\nAnswer options:\nNone";
  }

  return clean.trim();
}

function normalizeAudioFormat(format) {
  const f = String(format || "").toLowerCase().trim();

  if (f.includes("wav")) return "wav";
  if (f.includes("mp3")) return "mp3";

  return "wav";
}

function buildVehicleText(profile) {
  if (!profile || typeof profile !== "object") return "Unknown vehicle.";

  const parts = [];

  if (profile.year) parts.push(`Year: ${profile.year}`);
  if (profile.make) parts.push(`Make: ${profile.make}`);
  if (profile.model) parts.push(`Model: ${profile.model}`);
  if (profile.engine) parts.push(`Engine: ${profile.engine}`);
  if (profile.mileage) parts.push(`Mileage: ${profile.mileage}`);

  return parts.length ? parts.join(", ") : "Unknown vehicle.";
}

function buildAnswersText(answers) {
  if (!Array.isArray(answers) || !answers.length) return "";

  return answers
    .map((item, index) => {
      const q = String(item?.question || `Question ${index + 1}`).trim();
      const a = String(item?.answer || "").trim();
      return `${index + 1}. ${q}: ${a}`;
    })
    .join("\n");
}

function buildEmergencyFollowUp(lang) {
  if (lang === "es") {
    return `Diagnosis status: audio_follow_up

Voice summary:
Escuché el sonido del vehículo y voy a confirmar dos detalles para cerrar el diagnóstico.

Audio direction:
Engine-side sound behavior needs confirmation.

Question 1:
¿El sonido cambia más con RPM o con movimiento del vehículo?

Answer options 1:
RPM
Velocidad
Freno
Giro

Question 2:
¿Qué carácter se parece más al sonido grabado?

Answer options 2:
Tick rápido
Golpe profundo
Chirrido
Rattle metálico`;
  }

  return `Diagnosis status: audio_follow_up

Voice summary:
I heard the vehicle sound and need two quick confirmations before the final diagnosis.

Audio direction:
Engine-side sound behavior needs confirmation.

Question 1:
Does the sound change more with RPM or vehicle movement?

Answer options 1:
RPM
Speed
Braking
Turning

Question 2:
Which character best matches the recorded sound?

Answer options 2:
Fast ticking
Deep knock
Belt squeal
Metallic rattle`;
}

function buildNoAudioResponse(lang) {
  if (lang === "es") {
    return `Diagnosis status: analysis

Voice summary:
No recibí una grabación útil para analizar el sonido.

Risk level:
Medium

Likely issue:
Most likely: Audio recording was missing or too short
Secondary possibility: Microphone permission or upload issue
Less likely: Confirmed mechanical failure from this recording

Why it fits:
The uploaded audio was not long enough or strong enough to analyze.

What to inspect next:
Record 7 to 10 seconds close to the sound source with no talking in the background.

What to do next:
Try the audio scan again.

Answer options:
None

When to stop driving:
Deja de manejar si el sonido es fuerte, metálico profundo, aparece humo, olor a quemado, sobrecalentamiento, pérdida de potencia o una luz roja.`;
  }

  return `Diagnosis status: analysis

Voice summary:
I did not receive a usable recording to analyze the sound.

Risk level:
Medium

Likely issue:
Most likely: Audio recording was missing or too short
Secondary possibility: Microphone permission or upload issue
Less likely: Confirmed mechanical failure from this recording

Why it fits:
The uploaded audio was not long enough or strong enough to analyze.

What to inspect next:
Record 7 to 10 seconds close to the sound source with no talking in the background.

What to do next:
Try the audio scan again.

Answer options:
None

When to stop driving:
Stop driving if the sound is loud, deep metallic, smoke appears, you smell burning, the engine overheats, power drops, or a red warning light comes on.`;
}

function buildSafeErrorResponse(lang) {
  if (lang === "es") {
    return `Diagnosis status: analysis

Voice summary:
The sound was received, but the final audio analysis did not complete.

Risk level:
Medium

Likely issue:
Most likely: Audio analysis connection issue
Secondary possibility: Unsupported audio format
Less likely: Confirmed mechanical failure from this attempt

Why it fits:
The recording reached the backend, but the audio model did not return a final diagnostic response.

What to inspect next:
Try the scan again once. If the sound is engine-side, compare whether it follows RPM, cold start, idle, or acceleration.

What to do next:
Repeat the scan with 7 to 10 seconds near the sound source.

Answer options:
None

When to stop driving:
Deja de manejar si el sonido se vuelve fuerte, metálico, aparece humo, olor a quemado, sobrecalentamiento, pérdida de potencia o una luz roja.`;
  }

  return `Diagnosis status: analysis

Voice summary:
The sound was received, but the final audio analysis did not complete.

Risk level:
Medium

Likely issue:
Most likely: Audio analysis connection issue
Secondary possibility: Unsupported audio format
Less likely: Confirmed mechanical failure from this attempt

Why it fits:
The recording reached the backend, but the audio model did not return a final diagnostic response.

What to inspect next:
Try the scan again once. If the sound is engine-side, compare whether it follows RPM, cold start, idle, or acceleration.

What to do next:
Repeat the scan with 7 to 10 seconds near the sound source.

Answer options:
None

When to stop driving:
Stop driving if the sound becomes loud, metallic, smoke appears, you smell burning, the engine overheats, power drops, or a red warning light comes on.`;
}
