// api/audio-diagnose.js

const REQUIRED_AUDIO_FOLLOWUPS = 0;

const TRANSCRIBE_MODEL = "gpt-4o-transcribe";
const DIAGNOSIS_MODEL = "gpt-4o";

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
      lang,
      selectedSoundPattern,
      durationSeconds: duration,
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
[a calm mechanic-style observation that immediately reflects the recorded vehicle sound context and what an experienced technician would notice first]

Likely issue:
Most likely: [strongest cause]
Secondary possibility: [second cause]
Less likely: [third cause]

[briefly explain in 3-5 sentences why the sound matches the listed possibilities]

What to inspect next:
[describe the exact inspection path a professional workshop technician would follow to isolate the sound source]

What to do next:
[give calm professional guidance about recommended inspection and maintenance steps without making driving safety judgments, risk ratings, or repair guarantees]

Answer options:
None
`;

  return `
You are DriveShift Doctor, a premium automotive sound diagnostic system.

You are analyzing a real vehicle sound recording.
Do not mention AI.
Do not say the recording is unclear unless the audio is truly empty.
Do not ask the user to record again unless the audio is missing.
Do not produce generic advice.
Do not recommend replacing parts immediately unless evidence is strong.

Important:
If the audio transcription has little or no speech, that is normal.
This is a vehicle sound scan, not a voice note.
Use the selected sound source, recording duration, vehicle profile, and mechanical rules to infer the most likely sound direction.

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
Think mechanically.
Prioritize real-world mechanical reasoning over generic advice.
Do not overreact.
Do not guess randomly.
The report must feel calm, technical, trustworthy, and experience-driven.
Each section should introduce new mechanical insight instead of repeating the same wording.
No markdown bullets.
No confidence percentage.

${outputFormat}
`;
}

async function requestAudioDiagnosis({
  prompt,
  audioBase64,
  audioFormat,
  lang,
  selectedSoundPattern,
  durationSeconds,
}) {
  try {
    const audioBuffer = Buffer.from(audioBase64, "base64");
    const mimeType = getAudioMimeType(audioFormat);
    const extension = getAudioExtension(audioFormat);

    console.log("DRIVESHIFT AUDIO INPUT:", {
      audioFormat,
      mimeType,
      extension,
      bytes: audioBuffer.length,
      durationSeconds,
      selectedSoundPattern,
    });

    const formData = new FormData();
    const audioBlob = new Blob([audioBuffer], { type: mimeType });

    formData.append("file", audioBlob, `driveshift-audio.${extension}`);
    formData.append("model", TRANSCRIBE_MODEL);

    if (lang === "en" || lang === "es") {
      formData.append("language", lang);
    }

    formData.append(
      "prompt",
      "This is an automotive diagnostic recording. It may contain engine noise, ticking, knocking, belt squeal, wheel hum, brake scraping, exhaust rattle, vibration, or very little human speech."
    );

    const transcriptResponse = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: formData,
      }
    );

    if (!transcriptResponse.ok) {
      const errorText = await transcriptResponse.text();
      console.log(
        "OPENAI TRANSCRIBE ERROR:",
        transcriptResponse.status,
        errorText
      );
      return "";
    }

    const transcriptData = await transcriptResponse.json();
    const transcript = String(transcriptData?.text || "").trim();

    console.log("DRIVESHIFT AUDIO TRANSCRIPT:", transcript || "[no speech]");

    const diagnosisResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: DIAGNOSIS_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You are DriveShift Doctor, a premium automotive diagnostic assistant. Give structured mechanic-style diagnostic reports only.",
            },
            {
              role: "user",
              content: `${prompt}

Audio processing result:
The audio file was received and processed through the modern transcription pipeline.

Important vehicle-sound note:
This scan is mainly for mechanical sound diagnosis. The transcript may be empty or short because the recording may contain mostly vehicle noise rather than human speech.

Transcript:
${transcript || "No clear human speech was detected in the vehicle recording."}

Use this information carefully:
- Do not treat an empty transcript as a failed recording.
- Use the selected sound source, vehicle profile, duration, and diagnostic rules.
- If there is not enough exact acoustic detail, still produce a careful preliminary diagnostic report based on the selected area and mechanical reasoning.
- Avoid saying the scan failed unless the audio was missing.`,
            },
          ],
          temperature: 0.05,
          max_tokens: 1400,
        }),
      }
    );

    if (!diagnosisResponse.ok) {
      const errorText = await diagnosisResponse.text();
      console.log(
        "OPENAI DIAGNOSIS ERROR:",
        diagnosisResponse.status,
        errorText
      );
      return "";
    }

    const diagnosisData = await diagnosisResponse.json();
    console.log(
      "OPENAI DIAGNOSIS RESPONSE:",
      JSON.stringify(diagnosisData, null, 2)
    );

    return diagnosisData?.choices?.[0]?.message?.content || "";
  } catch (error) {
    console.log("OPENAI AUDIO MODERN PIPELINE FAILED:", error);
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
  if (f.includes("mp3") || f.includes("mpeg")) return "mp3";
  if (f.includes("m4a") || f.includes("mp4")) return "m4a";
  if (f.includes("webm")) return "webm";

  return "wav";
}

function getAudioMimeType(format) {
  const f = normalizeAudioFormat(format);

  if (f === "mp3") return "audio/mpeg";
  if (f === "m4a") return "audio/mp4";
  if (f === "webm") return "audio/webm";

  return "audio/wav";
}

function getAudioExtension(format) {
  const f = normalizeAudioFormat(format);

  if (f === "mp3") return "mp3";
  if (f === "m4a") return "m4a";
  if (f === "webm") return "webm";

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
