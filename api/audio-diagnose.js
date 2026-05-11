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
    const normalizedFormat = normalizeAudioFormat(audioFormat);

    const signal = analyzeAudioSignal({
      audioBase64: audio,
      audioFormat: normalizedFormat,
      durationSeconds: duration,
    });

    const audioIntelligence = buildAudioIntelligence({
      selectedSoundPattern,
      durationSeconds: duration,
      audioSize,
      vehicleProfile,
      lang,
      signal,
    });

    const followUp = buildAudioFollowUpQuestion(audioIntelligence);

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
      signal,
      followUp,
    });

    const aiText = await requestAudioDiagnosis({
      prompt,
      audioBase64: audio,
      audioFormat: normalizedFormat,
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
    const lang = req.body?.language === "es" ? "es" : "en";

    return res.status(200).json({
      result: buildAudioFallbackReport({
        lang,
        durationSeconds: req.body?.durationSeconds || 0,
        audioIntelligence: buildAudioIntelligence({
          selectedSoundPattern: req.body?.selectedSoundPattern || "",
          durationSeconds: req.body?.durationSeconds || 0,
          audioSize: 0,
          vehicleProfile: req.body?.vehicleProfile || {},
          lang,
          signal: null,
        }),
      }),
    });
  }
}

function analyzeAudioSignal({ audioBase64, audioFormat, durationSeconds }) {
  try {
    if (!audioBase64 || normalizeAudioFormat(audioFormat) !== "wav") {
      return {
        available: false,
        reason: "Signal analysis skipped because audio is not WAV.",
      };
    }

    const decoded = decodeWavPcm16(audioBase64);
    if (!decoded || !decoded.samples?.length) {
      return {
        available: false,
        reason: "Could not decode WAV PCM samples.",
      };
    }

    const { samples, sampleRate } = decoded;
    const duration = Number(durationSeconds || samples.length / sampleRate || 0);

    const maxSamples = Math.min(samples.length, sampleRate * 12);
    const segment = samples.slice(0, maxSamples);

    let sumSq = 0;
    let peak = 0;
    let zeroCrossings = 0;

    for (let i = 0; i < segment.length; i++) {
      const v = segment[i];
      sumSq += v * v;
      peak = Math.max(peak, Math.abs(v));

      if (i > 0) {
        const prev = segment[i - 1];
        if ((prev >= 0 && v < 0) || (prev < 0 && v >= 0)) zeroCrossings++;
      }
    }

    const rms = Math.sqrt(sumSq / Math.max(1, segment.length));
    const zcr = zeroCrossings / Math.max(1, segment.length);

    const envelope = buildEnvelope(segment, sampleRate);
    const pulse = analyzePulseEnvelope(envelope, duration);
    const spectral = analyzeSpectralBands(segment, sampleRate);

    const hints = [];
    const evidence = [];

    if (rms < 0.012) {
      hints.push("very_quiet_recording");
      evidence.push("The recorded signal appears very quiet.");
    } else if (rms < 0.035) {
      hints.push("quiet_recording");
      evidence.push("The recorded signal is usable but relatively quiet.");
    } else {
      hints.push("usable_signal_strength");
      evidence.push("The recording has usable signal strength.");
    }

    if (peak > 0.75) {
      hints.push("possible_clipping_or_very_loud_signal");
      evidence.push("The recording has high peaks that may include sharp noise or clipping.");
    }

    if (pulse.pulseRate >= 3 && pulse.pulseRate <= 18 && pulse.regularity > 0.32) {
      hints.push("rhythmic_repeating_pulse");
      evidence.push(`Repeating pulse pattern detected around ${pulse.pulseRate.toFixed(1)} pulses/sec.`);
    }

    if (spectral.lowRatio > 0.42 && rms > 0.02) {
      hints.push("low_frequency_knock_or_heavy_vibration");
      evidence.push("Low-frequency energy is dominant, which may fit knock or heavy vibration.");
    }

    if (spectral.highRatio > 0.38 && zcr > 0.08) {
      hints.push("high_frequency_squeal_hiss_or_sharp_noise");
      evidence.push("High-frequency energy and zero crossings suggest squeal, hiss, or sharp metallic noise.");
    }

    if (spectral.midHighRatio > 0.34 && pulse.pulseRate > 5) {
      hints.push("ticking_or_metallic_rattle_possible");
      evidence.push("Mid/high rhythmic content may fit ticking, tapping, or metallic rattling.");
    }

    if (zcr > 0.16 && spectral.highRatio > 0.30) {
      hints.push("hissing_air_noise_possible");
      evidence.push("Noisy high-frequency texture may fit hissing, air leak, or exhaust leak.");
    }

    const advanced = buildAdvancedAcousticProfile({
      signalHints: hints,
      rms,
      peak,
      zcr,
      pulseRate: pulse.pulseRate,
      pulseRegularity: pulse.regularity,
      lowRatio: spectral.lowRatio,
      midRatio: spectral.midRatio,
      highRatio: spectral.highRatio,
      midHighRatio: spectral.midHighRatio,
    });

    return {
      available: true,
      sampleRate,
      sampleCount: segment.length,
      duration,
      rms: round(rms),
      peak: round(peak),
      zcr: round(zcr),
      pulseRate: round(pulse.pulseRate),
      pulseRegularity: round(pulse.regularity),
      lowRatio: round(spectral.lowRatio),
      midRatio: round(spectral.midRatio),
      highRatio: round(spectral.highRatio),
      midHighRatio: round(spectral.midHighRatio),
      advancedProfile: advanced.profile,
      advancedSignatures: advanced.signatures,
      hints,
      evidence,
    };
  } catch (_) {
    return {
      available: false,
      reason: "Signal analysis failed safely.",
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
    const chunkStart = offset + 8;

    if (id === "fmt ") {
      audioFormat = buffer.readUInt16LE(chunkStart);
      channels = buffer.readUInt16LE(chunkStart + 2);
      sampleRate = buffer.readUInt32LE(chunkStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
    }

    if (id === "data") {
      dataOffset = chunkStart;
      dataSize = size;
      break;
    }

    offset = chunkStart + size + (size % 2);
  }

  if (!dataOffset || !dataSize || audioFormat !== 1 || bitsPerSample !== 16) {
    return null;
  }

  const samples = [];
  const frameSize = channels * 2;
  const frames = Math.floor(dataSize / frameSize);

  for (let i = 0; i < frames; i++) {
    const frameOffset = dataOffset + i * frameSize;
    let mixed = 0;

    for (let ch = 0; ch < channels; ch++) {
      const sample = buffer.readInt16LE(frameOffset + ch * 2);
      mixed += sample / 32768;
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
    envelope.reduce((sum, value) => sum + value, 0) / Math.max(1, envelope.length);

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
    for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i] - peaks[i - 1]);

    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const variance =
      gaps.reduce((s, g) => s + Math.pow(g - mean, 2), 0) / gaps.length;

    const std = Math.sqrt(variance);
    regularity = mean > 0 ? Math.max(0, 1 - std / mean) : 0;
  }

  return { pulseRate, regularity };
}

function analyzeSpectralBands(samples, sampleRate) {
  const targetLength = Math.min(samples.length, 16000);
  const step = Math.max(1, Math.floor(samples.length / targetLength));
  const segment = [];

  for (let i = 0; i < samples.length && segment.length < targetLength; i += step) {
    segment.push(samples[i]);
  }

  const freqs = [80, 150, 300, 700, 1200, 2500, 4200, 6500];
  const energies = {};

  for (const f of freqs) {
    energies[f] = goertzelEnergy(segment, sampleRate / step, f);
  }

  const low = energies[80] + energies[150];
  const mid = energies[300] + energies[700] + energies[1200];
  const high = energies[2500] + energies[4200] + energies[6500];
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

  for (let i = 0; i < n; i++) {
    q0 = coeff * q1 - q2 + samples[i];
    q2 = q1;
    q1 = q0;
  }

  return q1 * q1 + q2 * q2 - coeff * q1 * q2;
}

function buildAudioIntelligence({
  selectedSoundPattern,
  durationSeconds,
  audioSize,
  vehicleProfile,
  lang,
  signal,
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

  if (signal?.available) {
    hints.push(...signal.hints);

    if (signal.advancedProfile) {
      hints.push(
        `Advanced acoustic profile: ${JSON.stringify(signal.advancedProfile)}`
      );
    }

    if (Array.isArray(signal.advancedSignatures)) {
      for (const sig of signal.advancedSignatures.slice(0, 3)) {
        add(sig.key, sig.label, sig.confidence, sig.why);
      }
    }

    hints.push(
      `Signal metrics: rms=${signal.rms}, peak=${signal.peak}, zcr=${signal.zcr}, pulseRate=${signal.pulseRate}, lowRatio=${signal.lowRatio}, highRatio=${signal.highRatio}`
    );

    if (signal.hints.includes("low_frequency_knock_or_heavy_vibration")) {
      add(
        "engine_knock_or_heavy_vibration",
        "Low-frequency knock, heavy engine vibration, mount issue, or rotating mechanical load",
        44,
        "WAV signal shows dominant low-frequency energy"
      );
    }

    if (signal.hints.includes("ticking_or_metallic_rattle_possible")) {
      add(
        "ticking_or_rattle",
        "Rhythmic ticking, tapping, valvetrain noise, injector tick, heat shield rattle, or pulley rattle",
        42,
        "WAV signal shows rhythmic mid/high pulse behavior"
      );
    }

    if (signal.hints.includes("high_frequency_squeal_hiss_or_sharp_noise")) {
      add(
        "squeal_hiss_or_sharp_noise",
        "Belt squeal, pulley bearing noise, hissing leak, or sharp metallic contact",
        40,
        "WAV signal shows high-frequency energy"
      );
    }

    if (signal.hints.includes("hissing_air_noise_possible")) {
      add(
        "air_or_exhaust_leak",
        "Vacuum leak, intake leak, exhaust leak, boost leak, or pressure leak",
        34,
        "WAV signal has noisy high-frequency texture"
      );
    }

    if (
      signal.lowRatio > 0.65 &&
      signal.peak > 0.65 &&
      signal.pulseRate >= 0.5 &&
      signal.pulseRate <= 4
    ) {
      add(
        "rod_knock_or_heavy_knock",
        "Rod knock, deep internal knock, heavy engine vibration, or rotating mechanical impact",
        70,
        "low-frequency energy with strong impact peaks and slow pulse behavior"
      );
    }

    if (
      signal.midHighRatio > 0.55 &&
      signal.pulseRate >= 4 &&
      signal.pulseRate <= 18
    ) {
      add(
        "injector_tick_or_lifter_tap",
        "Injector tick, lifter tapping, valve train tick, or small exhaust tick",
        62,
        "rhythmic mid/high pulse pattern suggests ticking or tapping"
      );
    }

    if (
      signal.highRatio > 0.35 &&
      signal.zcr > 0.12 &&
      signal.pulseRate < 3
    ) {
      add(
        "belt_chirp_or_squeal",
        "Belt chirp, belt squeal, weak tensioner, pulley bearing, or accessory belt slip",
        64,
        "high-frequency energy with sharp texture fits chirp or squeal"
      );
    }

    if (
      signal.lowRatio > 0.45 &&
      signal.zcr < 0.18 &&
      signal.pulseRate < 2
    ) {
      add(
        "rotational_hum_or_wheel_bearing",
        "Wheel bearing growl, rotational hum, tire noise, or drivetrain bearing noise",
        58,
        "low steady energy with low pulse behavior fits rotational hum"
      );
    }

    if (
      signal.midHighRatio > 0.45 &&
      signal.peak > 0.55 &&
      signal.zcr > 0.18
    ) {
      add(
        "brake_grind_or_metal_contact",
        "Brake grind, dust shield contact, rotor/pad contact, or metallic scraping",
        60,
        "sharp mid/high energy with strong peaks fits grinding or metal contact"
      );
    }

    if (
      signal.zcr > 0.20 &&
      signal.highRatio > 0.22 &&
      signal.pulseRate < 5
    ) {
      add(
        "exhaust_or_air_leak_puff",
        "Exhaust leak puff, vacuum leak, intake leak, or pressure leak",
        54,
        "noisy high-frequency texture can fit air leak or exhaust leak"
      );
    }

    if (
      signal.peak > 0.75 &&
      signal.midHighRatio > 0.35 &&
      signal.pulseRate >= 2
    ) {
      add(
        "metallic_rattle_or_loose_component",
        "Metallic rattle, loose heat shield, loose bracket, pulley rattle, or timing chain rattle",
        57,
        "sharp peaks with rhythmic mid/high energy fit metallic rattle"
      );
    }

    if (
      duration <= 12 &&
      signal.lowRatio > 0.55 &&
      signal.peak > 0.55
    ) {
      add(
        "cold_start_slap_or_startup_knock",
        "Cold start slap, startup knock, engine mount movement, or early-start mechanical noise",
        46,
        "short recording with low-frequency impact may fit startup slap or knock"
      );
    }
  } else {
    hints.push(signal?.reason || "No local WAV signal metrics available.");
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
      "no clear preselected sound pattern and weak local signal hints"
    );
    add(
      "rotational_or_engine_noise",
      "Engine, belt, pulley, exhaust, starter, brake, wheel, or vibration-related noise",
      12,
      "audio received but exact family is unclear"
    );
  }

  ranked.sort((a, b) => b.score - a.score);

  const metricsText = signal?.available
    ? `rms=${signal.rms}, peak=${signal.peak}, zcr=${signal.zcr}, pulseRate=${signal.pulseRate}, lowRatio=${signal.lowRatio}, highRatio=${signal.highRatio}`
    : "No signal metrics";

  let signalClassification = "balanced_signal";

  if (signal?.lowRatio > 0.7) {
    signalClassification = "low_frequency_mechanical_pattern";
  }

  if (signal?.peak > 0.78) {
    signalClassification += ", strong_impact_or_knock_energy";
  }

  if (signal?.zcr < 0.12) {
    signalClassification += ", deep_rotational_pattern";
  }

  return {
    hints,
    ranked,
    metricsText,
    signalClassification,
    mostLikely: ranked[0]?.label || "Abnormal vehicle sound",
    secondary:
      ranked[1]?.label ||
      "Related belt, pulley, exhaust, starter, brake, wheel, or engine noise",
    lessLikely:
      ranked[2]?.label ||
      "Severe internal failure unless the sound becomes louder, rhythmic, or comes with strong symptoms",
  };
}

function buildAudioFollowUpQuestion(audioIntelligence) {
  const primary = String(audioIntelligence?.mostLikely || "").toLowerCase();

  if (
    primary.includes("rod knock") ||
    primary.includes("lifter") ||
    primary.includes("injector") ||
    primary.includes("valve train")
  ) {
    return {
      question:
        "Does the sound become faster or louder when engine RPM increases?",
      options: [
        "Yes, clearly with RPM",
        "Only during cold start",
        "Mostly at idle",
        "No noticeable change",
      ],
    };
  }

  if (
    primary.includes("wheel bearing") ||
    primary.includes("rotational") ||
    primary.includes("brake") ||
    primary.includes("scrape")
  ) {
    return {
      question: "Does the sound change with vehicle speed or braking?",
      options: [
        "Changes with speed",
        "Changes while braking",
        "Only during acceleration",
        "No change",
      ],
    };
  }

  if (
    primary.includes("belt") ||
    primary.includes("chirp") ||
    primary.includes("squeal")
  ) {
    return {
      question: "When is the sound strongest?",
      options: [
        "Cold startup",
        "Wet weather",
        "Hard acceleration",
        "Constant all the time",
      ],
    };
  }

  return null;
}

function buildAudioPrompt({
  lang,
  selectedSoundPattern,
  durationSeconds,
  vehicleProfile,
  audioIntelligence,
  signal,
  followUp,
}) {
  const isEs = lang === "es";
  const vehicleText = buildVehicleText(vehicleProfile);
  const duration = Number(durationSeconds || 0);

  return `
You are DriveShift Doctor, a premium automotive diagnostic intelligence.

You are analyzing a real vehicle audio recording plus local WAV signal metrics.
Think like a senior mechanic listening to a car sound.

Language:
${isEs ? "Spanish only" : "English only"}

Vehicle profile:
${vehicleText}

Recording duration:
${duration} seconds

User selected sound pattern:
${selectedSoundPattern || "Unknown - rely on audio and signal metrics"}

Local WAV signal analysis:
${signal?.available ? JSON.stringify(signal, null, 2) : signal?.reason || "No signal metrics"}

DriveShift audio intelligence:
Most likely direction: ${audioIntelligence.mostLikely}
Secondary direction: ${audioIntelligence.secondary}
Less likely direction: ${audioIntelligence.lessLikely}

Mechanic clarification that would improve certainty:
${followUp ? `${followUp.question} Options: ${followUp.options.join(" / ")}` : "No extra clarification needed."}

Audio hints:
${audioIntelligence.hints.join("\n")}

Raw audio metrics:
${audioIntelligence.metricsText || "No metrics"}

Dominant signal classification:
${audioIntelligence.signalClassification || "Unknown"}

Ranked audio candidates:
${audioIntelligence.ranked
  .map(
    (x, i) =>
      `${i + 1}. ${x.label} — score ${x.score}. Evidence: ${x.evidence.join("; ")}`
  )
  .join("\n")}

Important reasoning:
- Use the local WAV signal metrics as diagnostic clues, not absolute proof.
- Do not hide behind "unclear" unless the signal is truly unusable.
- Even if confidence is limited, give the strongest diagnostic direction.
- If low-frequency energy dominates, consider knock, heavy vibration, engine mount, rotational load, or deep mechanical sound.
- If rhythmic mid/high pulses appear, consider ticking, tapping, injector tick, valvetrain, exhaust tick, pulley rattle, or metallic rattle.
- If high-frequency energy and high zero-crossing appear, consider belt squeal, hissing, sharp metal contact, or air/exhaust leak.
- If pulse rate is regular, explain why rhythm matters.
- If the clarification question would help, mention it briefly in What to inspect next, but do not ask a separate follow-up question.
- Do not recommend replacing parts immediately unless evidence is strong.

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
[explain why the sound and signal metrics point there]

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
        temperature: 0.025,
        max_output_tokens: 1100,
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
DriveShift recibió la grabación y detectó una dirección mecánica inicial usando el patrón de señal.

Risk level:
Medium

Likely issue:
Most likely: ${audioIntelligence.mostLikely}
Secondary possibility: ${audioIntelligence.secondary}
Less likely: ${audioIntelligence.lessLikely}

Why it fits:
La grabación de ${duration} segundos no confirma una sola pieza, pero la señal permite orientar la inspección hacia la familia de ruido dominante. El comportamiento debe compararse con RPM, arranque, aceleración, A/C, dirección, freno o movimiento.

What to inspect next:
Localiza primero el área más fuerte: motor, banda/polea, rueda/freno, escape o arranque. Después compara si el sonido cambia con idle, aceleración suave, A/C, dirección, frenado o movimiento.

What to do next:
Graba otra vez cerca de la fuente y compara tres grabaciones cortas: idle, aceleración suave y el área donde el sonido es más fuerte.

Answer options:
None

When to stop driving:
Deja de manejar si el sonido se vuelve fuerte, metálico profundo, aparece pérdida de potencia, olor a quemado, humo, sobrecalentamiento, grinding fuerte o una luz roja.`);
  }

  return cleanAndFinalize(`Diagnosis status: analysis

Voice summary:
DriveShift received the recording and detected an initial mechanical direction from the signal pattern.

Risk level:
Medium

Likely issue:
Most likely: ${audioIntelligence.mostLikely}
Secondary possibility: ${audioIntelligence.secondary}
Less likely: ${audioIntelligence.lessLikely}

Why it fits:
The ${duration} second recording does not confirm one exact part, but the signal pattern is enough to guide inspection toward the dominant sound family. The behavior should be compared against RPM, startup, acceleration, A/C load, steering load, braking, or movement.

What to inspect next:
First locate the loudest area: engine, belt/pulley area, wheel/brake area, exhaust, or starter. Then check whether the sound changes at idle, with light revving, A/C load, steering load, braking, or movement.

What to do next:
Record again close to the source and compare three short recordings: idle, light revving, and the area where the sound is loudest.

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

function buildAdvancedAcousticProfile({
  signalHints,
  rms,
  peak,
  zcr,
  pulseRate,
  pulseRegularity,
  lowRatio,
  midRatio,
  highRatio,
  midHighRatio,
}) {
  const signatures = [];

  const addSig = (key, label, confidence, why) => {
    signatures.push({ key, label, confidence, why });
  };

  const rhythmic = pulseRegularity > 0.35 && pulseRate >= 2;
  const slowPulse = pulseRate > 0.4 && pulseRate < 4;
  const fastPulse = pulseRate >= 4 && pulseRate <= 18;
  const sharpTransient = peak > 0.72;
  const verySharp = peak > 0.82 || zcr > 0.26;
  const lowDominant = lowRatio > 0.55;
  const highTexture = highRatio > 0.22 || zcr > 0.20;
  const midHighDominant = midHighRatio > 0.48;
  const steadyLow = lowRatio > 0.45 && pulseRate < 2;
  const scrapeLike = zcr > 0.22 && midHighRatio > 0.42 && peak > 0.55;
  const quietButUsable = rms > 0.015 && rms < 0.06;

  if (lowDominant && sharpTransient && slowPulse) {
    addSig(
      "rod_knock_signature",
      "Rod knock / deep mechanical knock signature",
      82,
      "Low-frequency dominance with strong transient impacts and slow repeating pulse behavior."
    );
  }

  if (fastPulse && rhythmic && midHighDominant) {
    addSig(
      "injector_lifter_tick_signature",
      "Injector tick / lifter tap / valvetrain ticking signature",
      78,
      "Regular fast pulse rhythm with mid-high frequency content."
    );
  }

  if (highTexture && zcr > 0.24 && pulseRate < 5) {
    addSig(
      "belt_chirp_hiss_signature",
      "Belt chirp / squeal / hissing leak signature",
      70,
      "High zero-crossing texture and high-frequency energy suggest squeal, chirp, or air leak."
    );
  }

  if (steadyLow && !verySharp) {
    addSig(
      "rotational_hum_signature",
      "Wheel bearing growl / rotational hum signature",
      66,
      "Steady low-frequency energy with weak pulse behavior suggests rotational hum or bearing noise."
    );
  }

  if (scrapeLike) {
    addSig(
      "brake_grind_scrape_signature",
      "Brake grind / rotor-pad scrape / dust shield contact signature",
      76,
      "Sharp mid-high texture with transient peaks suggests scraping or metallic contact."
    );
  }

  if (zcr > 0.18 && highRatio > 0.18 && pulseRate >= 1 && pulseRate <= 7) {
    addSig(
      "exhaust_puff_signature",
      "Exhaust leak puff / pressure leak signature",
      63,
      "Noisy high-frequency texture with mild pulse behavior can fit exhaust or pressure leak."
    );
  }

  if (sharpTransient && midHighDominant && rhythmic) {
    addSig(
      "metallic_rattle_signature",
      "Metallic rattle / loose heat shield / timing chain rattle signature",
      72,
      "Sharp transient peaks with rhythmic mid-high content suggest rattling metal."
    );
  }

  if (lowDominant && quietButUsable && pulseRate < 2) {
    addSig(
      "idle_instability_signature",
      "Idle instability / engine mount / rough vibration signature",
      58,
      "Low-frequency energy with limited repetition can fit idle vibration or mount movement."
    );
  }

  signatures.sort((a, b) => b.confidence - a.confidence);

  const profile = {
    pulseBehavior: rhythmic
      ? "rhythmic_repetition_detected"
      : slowPulse
      ? "slow_pulse_detected"
      : "weak_or_irregular_pulse",
    cyclicRhythm: pulseRegularity > 0.5 ? "regular_cycle" : "irregular_cycle",
    transientSpikes: sharpTransient ? "strong_transient_spikes" : "mild_transients",
    frequencyBalance: lowDominant
      ? "low_frequency_dominant"
      : highTexture
      ? "high_texture_dominant"
      : midHighDominant
      ? "mid_high_energy_dominant"
      : "balanced_or_unclear",
    scrapeModulation: scrapeLike ? "scrape_like_texture_detected" : "not_scrape_dominant",
    idleInstability: lowDominant && pulseRate < 2 ? "possible_idle_or_mount_vibration" : "not_primary",
    topSignature: signatures[0]?.label || "No strong acoustic signature",
  };

  return { profile, signatures };
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
La grabación de ${duration} segundos no confirmó una sola pieza, pero sí permite iniciar por la familia de ruido dominante usando la señal de audio.

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
The ${duration} second recording did not confirm one exact part, but it is enough to start with the dominant sound family using the audio signal pattern.

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

  clean = clean.replace(
    /Debug signal:[\s\S]*?(?=\n\s*What to inspect next:|\n\s*What to do next:|\n\s*When to stop driving:|\n\s*Safety:|$)/i,
    ""
  );

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

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}
