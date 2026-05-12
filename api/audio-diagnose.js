// api/audio-diagnose.js

const REQUIRED_AUDIO_FOLLOWUPS = 2;

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

    const signal = analyzeAudioSignal({
      audioBase64,
      audioFormat: format,
      durationSeconds: duration,
    });

    const mode =
      answers.length < REQUIRED_AUDIO_FOLLOWUPS ? "follow_up" : "analysis";

    const prompt = buildPrompt({
      mode,
      lang,
      selectedSoundPattern,
      durationSeconds: duration,
      vehicleProfile,
      answers,
      signal,
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
  signal,
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
[one short mechanic sentence about what the sound seems to suggest]

Audio direction:
[short sound direction, not a final diagnosis]

Question 1:
[ask one smart follow-up question only]

Answer options 1:
[option 1]
[option 2]
[option 3]
[option 4]
`
      : `
Output exactly this format:

Diagnosis status: analysis

Voice summary:
[one short natural mechanic sentence specific to the sound]

Risk level:
[High or Medium or Low]

Likely issue:
Most likely: [strongest cause]
Secondary possibility: [second cause]
Less likely: [third cause]

Why it fits:
[explain why the sound, signal metrics, selected pattern, and answers point there]

What to inspect next:
[specific checks in order]

What to do next:
[driver-friendly next action]

Answer options:
None

When to stop driving:
[clear safety advice]
`;

  return `
You are DriveShift Doctor, a premium automotive sound diagnostic system.

You are listening to a real vehicle audio recording.
Do not guess randomly.
Do not mention that you are an AI.
Do not produce generic advice.
Do not recommend replacing parts immediately unless the evidence is strong.
Use the selected sound pattern and follow-up answers as major diagnostic context.
If the sound location is engine bay, do not jump to brakes or wheels unless the user's answers clearly prove speed/braking behavior.
If the sound follows RPM, prioritize engine, valvetrain, injector, lifter, belt, pulley, exhaust leak, or internal knock.
If the sound follows vehicle speed, prioritize wheel bearing, tire, hub, brake drag, CV axle, or driveline.
If the sound changes while braking, prioritize brake pad, rotor, caliper, dust shield, or brake hardware.
If the sound is under the car, prioritize exhaust leak, heat shield, flex pipe, catalytic converter shield, loose bracket, or driveline vibration.
If the recording is unclear, still give the best mechanical direction, but clearly say what would confirm it.

Language:
${isEs ? "Spanish only" : "English only"}

Mode:
${mode}

Vehicle profile:
${vehicleText}

Recording duration:
${durationSeconds || "Unknown"} seconds

User selected sound pattern:
${selectedSoundPattern || "Not selected"}

Previous follow-up answers:
${answerText || "None"}

Local signal notes:
${formatSignal(signal)}

Reasoning style:
Write like a calm senior mechanic explaining the sound to a driver.
Be specific, practical, and safety-aware.
No markdown bullets.
No confidence percentage.

${outputFormat}
`;
}

async function requestAudioDiagnosis({ prompt, audioBase64, audioFormat }) {
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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
        temperature: 0.05,
        max_output_tokens: 1200,
      }),
    });

    if (!response.ok) return "";

    const data = await response.json();
    return extractText(data);
  } catch (_) {
    return "";
  }
}

function analyzeAudioSignal({ audioBase64, audioFormat, durationSeconds }) {
  try {
    if (normalizeAudioFormat(audioFormat) !== "wav") {
      return {
        available: false,
        note: "Local signal metrics skipped because the file is not WAV.",
      };
    }

    const decoded = decodeWavPcm16(audioBase64);
    if (!decoded) {
      return {
        available: false,
        note: "Could not decode WAV PCM audio.",
      };
    }

    const { samples, sampleRate } = decoded;
    const maxSamples = Math.min(samples.length, sampleRate * 10);
    const segment = samples.slice(0, maxSamples);

    let sumSq = 0;
    let peak = 0;
    let zeroCrossings = 0;

    for (let i = 0; i < segment.length; i++) {
      const v = segment[i];
      sumSq += v * v;
      peak = Math.max(peak, Math.abs(v));

      if (i > 0) {
        const p = segment[i - 1];
        if ((p >= 0 && v < 0) || (p < 0 && v >= 0)) zeroCrossings++;
      }
    }

    const rms = Math.sqrt(sumSq / Math.max(1, segment.length));
    const zcr = zeroCrossings / Math.max(1, segment.length);
    const envelope = buildEnvelope(segment, sampleRate);
    const pulse = analyzePulseEnvelope(
      envelope,
      Number(durationSeconds || segment.length / sampleRate || 0)
    );
    const spectral = analyzeSpectralBands(segment, sampleRate);

    const hints = [];

    if (rms < 0.012) hints.push("very quiet recording");
    else if (rms < 0.035) hints.push("quiet but usable recording");
    else hints.push("usable recording strength");

    if (peak > 0.75) hints.push("strong peaks or possible clipping");
    if (pulse.pulseRate >= 3 && pulse.pulseRate <= 18) {
      hints.push("repeating rhythmic pulse detected");
    }
    if (spectral.lowRatio > 0.45) hints.push("low-frequency mechanical energy");
    if (spectral.highRatio > 0.35) hints.push("high-frequency squeal/hiss texture");
    if (spectral.midHighRatio > 0.5) hints.push("mid/high ticking or metallic texture");

    return {
      available: true,
      sampleRate,
      duration: round(durationSeconds || segment.length / sampleRate),
      rms: round(rms),
      peak: round(peak),
      zcr: round(zcr),
      pulseRate: round(pulse.pulseRate),
      pulseRegularity: round(pulse.regularity),
      lowRatio: round(spectral.lowRatio),
      midRatio: round(spectral.midRatio),
      highRatio: round(spectral.highRatio),
      midHighRatio: round(spectral.midHighRatio),
      hints,
    };
  } catch (_) {
    return {
      available: false,
      note: "Local signal analysis failed safely.",
    };
  }
}

function decodeWavPcm16(audioBase64) {
  const buffer = Buffer.from(audioBase64, "base64");

  if (buffer.length < 44) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buffer.toString("ascii", 8, 12) !== "WAVE") return null;

  let offset = 12;
  let audioFormat = null;
  let channels = null;
  let sampleRate = null;
  let bitsPerSample = null;
  let dataOffset = null;
  let dataSize = null;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;

    if (id === "fmt ") {
      audioFormat = buffer.readUInt16LE(start);
      channels = buffer.readUInt16LE(start + 2);
      sampleRate = buffer.readUInt32LE(start + 4);
      bitsPerSample = buffer.readUInt16LE(start + 14);
    }

    if (id === "data") {
      dataOffset = start;
      dataSize = size;
      break;
    }

    offset = start + size + (size % 2);
  }

  if (!dataOffset || !dataSize) return null;
  if (audioFormat !== 1 || bitsPerSample !== 16 || !channels) return null;

  const samples = [];
  const frameSize = channels * 2;
  const frames = Math.floor(dataSize / frameSize);

  for (let i = 0; i < frames; i++) {
    const frameOffset = dataOffset + i * frameSize;
    let mixed = 0;

    for (let ch = 0; ch < channels; ch++) {
      mixed += buffer.readInt16LE(frameOffset + ch * 2) / 32768;
    }

    samples.push(mixed / channels);
  }

  return { samples, sampleRate };
}

function buildEnvelope(samples, sampleRate) {
  const frameSize = Math.max(256, Math.floor(sampleRate * 0.04));
  const envelope = [];

  for (let i = 0; i < samples.length; i += frameSize) {
    let sum = 0;
    let count = 0;

    for (let j = i; j < Math.min(samples.length, i + frameSize); j++) {
      sum += samples[j] * samples[j];
      count++;
    }

    envelope.push(Math.sqrt(sum / Math.max(1, count)));
  }

  return envelope;
}

function analyzePulseEnvelope(envelope, durationSeconds) {
  if (!envelope.length || !durationSeconds) {
    return { pulseRate: 0, regularity: 0 };
  }

  const avg =
    envelope.reduce((sum, value) => sum + value, 0) /
    Math.max(1, envelope.length);

  const threshold = avg * 1.45;
  const peaks = [];

  for (let i = 1; i < envelope.length - 1; i++) {
    if (
      envelope[i] > threshold &&
      envelope[i] > envelope[i - 1] &&
      envelope[i] >= envelope[i + 1]
    ) {
      peaks.push(i);
    }
  }

  const pulseRate = peaks.length / Math.max(1, durationSeconds);

  let regularity = 0;
  if (peaks.length >= 3) {
    const gaps = [];

    for (let i = 1; i < peaks.length; i++) {
      gaps.push(peaks[i] - peaks[i - 1]);
    }

    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const variance =
      gaps.reduce((s, g) => s + Math.pow(g - mean, 2), 0) / gaps.length;

    const std = Math.sqrt(variance);
    regularity = mean > 0 ? Math.max(0, 1 - std / mean) : 0;
  }

  return { pulseRate, regularity };
}

function analyzeSpectralBands(samples, sampleRate) {
  const targetLength = Math.min(samples.length, 12000);
  const step = Math.max(1, Math.floor(samples.length / targetLength));
  const segment = [];

  for (let i = 0; i < samples.length && segment.length < targetLength; i += step) {
    segment.push(samples[i]);
  }

  const adjustedRate = sampleRate / step;
  const low = goertzelEnergy(segment, adjustedRate, 90) +
    goertzelEnergy(segment, adjustedRate, 160);

  const mid = goertzelEnergy(segment, adjustedRate, 350) +
    goertzelEnergy(segment, adjustedRate, 800) +
    goertzelEnergy(segment, adjustedRate, 1400);

  const high = goertzelEnergy(segment, adjustedRate, 2600) +
    goertzelEnergy(segment, adjustedRate, 4200) +
    goertzelEnergy(segment, adjustedRate, 6500);

  const total = low + mid + high || 1;

  return {
    lowRatio: low / total,
    midRatio: mid / total,
    highRatio: high / total,
    midHighRatio: (mid + high) / total,
  };
}

function goertzelEnergy(samples, sampleRate, targetFreq) {
  const n = samples.length;
  if (!n || targetFreq >= sampleRate / 2) return 0;

  const k = Math.round((n * targetFreq) / sampleRate);
  const omega = (2 * Math.PI * k) / n;
  const coeff = 2 * Math.cos(omega);

  let q0 = 0;
  let q1 = 0;
  let q2 = 0;

  for (const sample of samples) {
    q0 = coeff * q1 - q2 + sample;
    q2 = q1;
    q1 = q0;
  }

  return q1 * q1 + q2 * q2 - coeff * q1 * q2;
}

function cleanAndFinalize({ text, mode, lang }) {
  let clean = String(text || "").trim();

  if (!clean || clean.length < 40) {
    return buildSafeErrorResponse(lang);
  }

  clean = clean
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/Confidence:\s*[\s\S]*?(?=\n[A-Z][A-Za-z ]+:|$)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (mode === "follow_up") {
    if (!/Diagnosis status:\s*audio_follow_up/i.test(clean)) {
      clean = `Diagnosis status: audio_follow_up\n\n${clean}`;
    }

    clean = clean.replace(
      /Diagnosis status:\s*(follow_up|analysis|final|audio_follow_up)/i,
      "Diagnosis status: audio_follow_up"
    );

    return clean;
  }

  if (!/Diagnosis status:/i.test(clean)) {
    clean = `Diagnosis status: analysis\n\n${clean}`;
  }

  clean = clean.replace(
    /Diagnosis status:\s*(follow_up|audio_follow_up|final|analysis)/i,
    "Diagnosis status: analysis"
  );

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

function formatSignal(signal) {
  if (!signal?.available) {
    return signal?.note || "No local signal metrics available.";
  }

  return `
RMS: ${signal.rms}
Peak: ${signal.peak}
Zero crossing rate: ${signal.zcr}
Pulse rate: ${signal.pulseRate}
Pulse regularity: ${signal.pulseRegularity}
Low frequency ratio: ${signal.lowRatio}
Mid frequency ratio: ${signal.midRatio}
High frequency ratio: ${signal.highRatio}
Mid/high ratio: ${signal.midHighRatio}
Hints: ${signal.hints.join(", ")}
`.trim();
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
No pude completar el análisis de sonido en este intento.

Risk level:
Medium

Likely issue:
Most likely: Audio analysis connection issue
Secondary possibility: Unsupported audio format
Less likely: Confirmed mechanical failure from this attempt

Why it fits:
The audio could not be processed reliably in this request.

What to inspect next:
Try again with a clear 7 to 10 second recording near the sound source.

What to do next:
Record again and avoid speaking during the recording.

Answer options:
None

When to stop driving:
Deja de manejar si el sonido se vuelve fuerte, metálico, aparece humo, olor a quemado, sobrecalentamiento, pérdida de potencia o una luz roja.`;
  }

  return `Diagnosis status: analysis

Voice summary:
I could not complete the sound analysis on this attempt.

Risk level:
Medium

Likely issue:
Most likely: Audio analysis connection issue
Secondary possibility: Unsupported audio format
Less likely: Confirmed mechanical failure from this attempt

Why it fits:
The audio could not be processed reliably in this request.

What to inspect next:
Try again with a clear 7 to 10 second recording near the sound source.

What to do next:
Record again and avoid speaking during the recording.

Answer options:
None

When to stop driving:
Stop driving if the sound becomes loud, metallic, smoke appears, you smell burning, the engine overheats, power drops, or a red warning light comes on.`;
}

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}
