// api/audio-diagnose.js

const AUDIO_MODEL =
  process.env.OPENAI_AUDIO_MODEL ||
  "gpt-audio";

const HARMONIC_SOURCE_ID =
  "audio_fft_harmonic_analysis_v1";

const HARMONIC_FUNDAMENTAL_ID =
  "HARM_ESTIMATED_FUNDAMENTAL_HZ";

const HARMONICITY_ID =
  "HARM_HARMONICITY_SCORE";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      result: "Method not allowed",
    });
  }

  const lang =
    req.body?.language === "es"
      ? "es"
      : "en";

  try {
    const {
      audio,
      audioFormat,
      selectedSoundPattern,
      durationSeconds,
      vehicleProfile,
      audioFollowUpAnswers,
      audioEvidence,
    } = req.body || {};

    const audioBase64 =
      String(audio || "").trim();

    const format =
      normalizeAudioFormat(
        audioFormat,
      );

    /*
     * Normalize and validate every evidence layer
     * before it reaches diagnostic reasoning.
     */
    const evidence =
      normalizeAudioEvidence(
        audioEvidence,
      );

    const soundFocus =
      resolveSoundFocus({
        lang,
        evidence,
        selectedSoundPattern,
      });

    if (
      !audioBase64 ||
      audioBase64.length < 1000
    ) {
      return sendDiagnosis(
        res,
        buildInsufficientResult({
          lang,
          soundFocus,

          limitation:
            lang === "es"
              ? "No se recibió una grabación utilizable."
              : "No usable audio recording was received.",

          technicalDetails:
            buildTechnicalDetails(
              evidence,
              lang,
            ),
        }),
        lang,
      );
    }

    if (!format) {
      return sendDiagnosis(
        res,
        buildInsufficientResult({
          lang,
          soundFocus,

          limitation:
            lang === "es"
              ? "El análisis directo requiere audio WAV o MP3."
              : "Direct audio analysis requires WAV or MP3 audio.",

          technicalDetails:
            buildTechnicalDetails(
              evidence,
              lang,
            ),
        }),
        lang,
      );
    }

    if (
      evidence?.quality?.state ===
      "unusable"
    ) {
      return sendDiagnosis(
        res,
        buildInsufficientResult({
          lang,
          soundFocus,

          limitation:
            lang === "es"
              ? "La validación local marcó la grabación como no utilizable para interpretación acústica."
              : "Local validation marked the recording as unusable for acoustic interpretation.",

          technicalDetails:
            buildTechnicalDetails(
              evidence,
              lang,
            ),
        }),
        lang,
      );
    }

    const prompt =
      buildPrompt({
        lang,
        soundFocus,
        durationSeconds,
        vehicleProfile,
        audioFollowUpAnswers,
        evidence,
      });

    const raw =
      await requestDirectAudioDiagnosis({
        prompt,
        audioBase64,
        format,
      });

    const diagnosis =
      normalizeDiagnosis({
        raw,
        lang,
        soundFocus,
        evidence,
      });

    return sendDiagnosis(
      res,
      diagnosis,
      lang,
    );
  } catch (error) {
    console.log(
      "AUDIO HANDLER ERROR:",
      error,
    );

    return sendDiagnosis(
      res,
      buildInsufficientResult({
        lang,

        soundFocus:
          lang === "es"
            ? "No confirmado"
            : "Unconfirmed",

        limitation:
          lang === "es"
            ? "El análisis de audio no pudo completarse de forma verificable."
            : "The audio analysis could not be completed in a verifiable way.",
      }),
      lang,
    );
  }
}

// ============================================================
// Response
// ============================================================

function sendDiagnosis(
  res,
  diagnosis,
  lang,
) {
  return res.status(200).json({
    diagnosis,

    /*
     * Temporary compatibility channel for the old
     * DriveShift audio response path.
     */
    result:
      buildLegacyResult(
        diagnosis,
        lang,
      ),
  });
}

// ============================================================
// Diagnostic prompt
// ============================================================

function buildPrompt({
  lang,
  soundFocus,
  durationSeconds,
  vehicleProfile,
  audioFollowUpAnswers,
  evidence,
}) {
  return `
You are the diagnostic reasoning layer for DriveShift Audio Diagnostics.

LANGUAGE
${lang === "es" ? "Spanish only." : "English only."}

CAPTURE CONTEXT
Sound focus: ${soundFocus}
Recording duration: ${Number(durationSeconds || 0)} seconds
Vehicle profile: ${safeJson(vehicleProfile)}
Confirmed follow-up answers: ${safeJson(audioFollowUpAnswers)}

VERIFIED AUDIO EVIDENCE
${evidence ? safeJson(evidence) : "None supplied."}

EVIDENCE LAYERS

1. MEASURED EVIDENCE

Directly measured signal quantities such as:
- RMS level
- peak level
- clipping ratio
- zero-crossing rate
- dominant frequency
- spectral centroid

2. OBSERVED EVIDENCE

Acoustic descriptions derived from measured evidence.

These describe signal behavior.
They do NOT identify confirmed failed components.

3. INFERRED ACOUSTIC EVIDENCE

Mathematically derived acoustic structures such as:
- estimated acoustic fundamental
- harmonicity
- harmonic peaks

These are not direct sensor measurements.

4. CONFIRMED USER CONTEXT

Answers explicitly supplied by the user about operating behavior, for example:
- noise changes with engine RPM
- noise changes when A/C is switched on or off
- noise changes with steering input
- noise appears only cold or warm

These answers may help separate hypotheses.

They are NOT measured sensor evidence.

5. DIAGNOSTIC HYPOTHESES

Possible vehicle causes.

These are never measurements and never confirmed failures without independent verification.

GENERAL EVIDENCE CONTRACT

- The original audio is acoustic input, not automatic proof of a failed component.

- Capture location describes only where the phone was placed.

- Preserve measured evidence names, values, units, IDs, and meaning.

- Never invent frequencies.

- Never invent dBFS values.

- Never invent clipping values.

- Never invent RPM.

- Never invent rotational speed.

- Never invent measurements.

- Never invent evidence IDs.

- Never invent RPM or speed correlations.

- Never convert an acoustic measurement into a confirmed failed part.

- Entries marked "observed" are descriptions, not failures.

- Entries marked "inferred" are derived evidence, not direct measurements.

- User follow-up answers are confirmed user context, not measured sensor values.

- Causes are diagnostic hypotheses only.

- supportingEvidenceIds may contain only IDs actually supplied in VERIFIED AUDIO EVIDENCE.

- Do not use HIGH confidence merely because a capture location was selected.

- Do not recommend replacing a component from audio evidence alone.

- Every cause must include a practical verification direction.

- If the evidence cannot support a responsible diagnostic direction, return insufficient_evidence.

- If one or two behavioral questions would materially separate plausible causes, return follow_up_required.

HARMONIC EVIDENCE CONTRACT

If VERIFIED AUDIO EVIDENCE contains a "harmonics" object:

- Harmonic evidence is mathematically derived acoustic evidence.

- "Estimated acoustic fundamental" is an acoustic frequency estimate only.

- NEVER rename estimated acoustic fundamental as:
  - engine RPM
  - crankshaft speed
  - pulley speed
  - bearing speed
  - shaft speed
  - component rotational speed

- NEVER calculate RPM simply by multiplying an acoustic fundamental by 60.

- NEVER claim a specific engine order from harmonic evidence alone.

- A future independent RPM/order-tracking layer is required before acoustic frequency can be associated with measured rotational speed.

- Harmonicity score measures consistency of harmonic structure only.

- Harmonicity score is NOT:
  - diagnostic confidence
  - failure probability
  - severity
  - component health

- A harmonic peak's relativeDb is relative only to the strongest harmonic included in that detected harmonic pattern.

- relativeDb is NOT dBFS.

- relativeDb is NOT sound-pressure level.

- Linear harmonic magnitude is NOT dBFS.

- Harmonic evidence can support descriptions such as:
  - periodic acoustic content
  - harmonically structured acoustic content
  - repeating spectral structure
  - a sound consistent with a periodic mechanical process

- Harmonic evidence BY ITSELF must NOT be used to attribute the sound to:
  - the accessory drive
  - alternator
  - A/C compressor
  - power-steering pump
  - water pump
  - tensioner
  - pulley
  - bearing
  - crankshaft
  - camshaft
  - transmission
  - wheel bearing
  - exhaust component
  - or any other specific physical component or subsystem

- A specific component or subsystem attribution requires independent supporting context in addition to harmonic evidence.

- Independent supporting context may include:
  - non-harmonic measured evidence
  - non-harmonic acoustic observations
  - confirmed user operating-condition answers
  - verified vehicle configuration
  - future verified OBD/RPM/order evidence

- When explaining a hypothesis, make the provenance clear.

- Do not write wording that implies:
  "harmonics prove this is an accessory-drive component."

- Prefer wording such as:
  "The harmonic structure supports a periodic acoustic source. Combined with the confirmed change under accessory load, an accessory-drive source becomes a plausible hypothesis."

- Harmonic evidence alone cannot identify the physical vehicle component producing the sound.

- Harmonic evidence alone cannot justify HIGH diagnostic confidence.

- If harmonic evidence is insufficient_evidence or unavailable, do not use it diagnostically.

- Do not invent missing harmonic peaks.

- Do not invent missing harmonic orders.

VEHICLE CONFIGURATION CONTRACT

- Never assume that a vehicle contains a specific component merely because that component is common on some vehicles.

- Vehicle year, make, and model alone do not automatically prove the presence of every optional or configuration-dependent component.

- Before naming a configuration-dependent component as a cause, verify that its presence is supported by the supplied vehicle profile or other explicit evidence.

- Examples of configuration-dependent components include:
  - hydraulic power-steering pump
  - electric power-steering hardware
  - belt-driven water pump
  - electric water pump
  - mechanically driven cooling fan
  - turbocharger
  - supercharger
  - selectable transfer-case hardware
  - specific hybrid accessories

- If the vehicle configuration does not establish that a component exists, do NOT present that component as a primary named cause.

- Instead use the narrowest valid generic category.

Examples:

Instead of:
"Power steering pump bearing noise"

when the steering system type is unknown, use:
"Belt-driven accessory or pulley noise"

Instead of:
"Mechanical water-pump bearing"

when pump type is unknown, use:
"Accessory-drive rotating component"

- "If equipped" wording may be used when a configuration-dependent component is genuinely relevant but its presence is not verified.

- Do not fabricate vehicle configuration details.

- Do not infer component presence solely from the acoustic recording.

- The diagnostic report must never recommend inspecting or replacing a component that may not exist on the vehicle without clearly acknowledging the configuration uncertainty.

COMPONENT ATTRIBUTION CONTRACT

- Separate acoustic characterization from physical-source attribution.

First ask:
"What does the signal show?"

Examples:
- high-frequency weighted content
- periodic structure
- harmonic pattern
- impulsive behavior
- broadband noise

Then ask:
"What independent evidence changes with vehicle operation?"

Examples:
- RPM behavior
- A/C engagement
- accessory electrical load
- steering input
- vehicle speed
- braking
- cold/warm condition

Only after combining those layers may you form a physical-source hypothesis.

BAD reasoning:
"Harmonics are present, therefore the alternator bearing is noisy."

GOOD reasoning:
"The recording contains harmonically structured acoustic content. The user also reports that the noise changes with accessory load. A belt-driven accessory is therefore a plausible source, but the individual component remains unconfirmed."

FOLLOW-UP QUESTION CONTRACT

- Ask no more than two questions.

- Ask only questions that materially separate plausible causes.

- Questions must be answerable by a normal vehicle owner without specialized equipment.

- Do not force certainty.

- Every follow-up question must permit the user to answer "Not sure" or the Spanish equivalent.

- A user answer is confirmed user context, not a measured sensor value.

- Never describe a user-reported RPM range as measured RPM unless RPM came from a verified sensor or OBD evidence source.

- Prefer operating-condition questions that directly separate hypotheses.

- Do not ask for a component-specific behavior if the vehicle may not contain that component unless the question explicitly says "if equipped."

SAFETY CONTRACT

- Do not instruct a general user to touch, manually rotate, reach toward, or place tools near moving belts, pulleys, fans, shafts, or other rotating components while the engine is running.

- Do not instruct a general user to place a mechanic's stethoscope or another physical probe near moving engine components while the engine is running.

- If engine-running localization near rotating components would normally require a technician procedure, recommend inspection by a qualified technician using appropriate diagnostic methods.

- Visual inspection of belts, pulleys, wiring, hoses, and similar engine-bay components must be described as engine-off unless the task specifically and safely requires otherwise.

- Keep safety guidance proportional and concise.

REPORT WRITING CONTRACT

- Keep measured facts separate from interpretation.

- Use "shows", "measured", or "recorded" only for actual evidence.

- Use "suggests", "supports", "consistent with", "plausible", or "may" for hypotheses.

- Do not write that acoustic structure "indicates" a particular component unless independent evidence supports that attribution.

- Do not imply that a component is confirmed because its behavior is acoustically plausible.

- When several component-specific causes cannot be distinguished responsibly, prefer one broader cause category rather than creating a list of speculative parts.

- Prefer fewer well-supported causes over more weakly supported causes.

Return ONE JSON object only.

No markdown.
No code fences.
No text before or after the JSON.

Use exactly this structure:

{
  "status": "complete | follow_up_required | insufficient_evidence",
  "soundFocus": "string",
  "directionConfidence": "high | medium | low | unknown",
  "diagnosticTitle": "string",
  "diagnosticSummary": "string",
  "causes": [
    {
      "title": "string",
      "description": "string",
      "confidence": "high | medium | low | unknown",
      "supportingEvidenceIds": ["existing evidence IDs only"],
      "verification": "string"
    }
  ],
  "nextStepTitle": "string",
  "nextStepBody": "string",
  "doNotReplaceTitle": "string",
  "doNotReplaceBody": "string",
  "followUpQuestions": [
    {
      "question": "string",
      "options": [
        "option 1",
        "option 2",
        "option 3",
        "Not sure"
      ]
    }
  ],
  "limitations": ["string"]
}

Use 1-3 causes for complete results.

Use no more than 2 follow-up questions.

Keep the report concise, technical, calm, and evidence-driven.
`;
}

// ============================================================
// OpenAI direct audio
// ============================================================

async function requestDirectAudioDiagnosis({
  prompt,
  audioBase64,
  format,
}) {
  const response =
    await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          Authorization:
            `Bearer ${process.env.OPENAI_API_KEY}`,
        },

        body:
          JSON.stringify({
            model:
              AUDIO_MODEL,

            messages: [
              {
                role:
                  "system",

                content:
                  "You are DriveShift's evidence-constrained automotive audio diagnostic engine. Strictly separate measured evidence, observations, inferred acoustic evidence, diagnostic hypotheses, and verification. Never invent measurements, RPM relationships, rotational correlations, or confirmed failures.",
              },
              {
                role:
                  "user",

                content: [
                  {
                    type:
                      "text",

                    text:
                      prompt,
                  },
                  {
                    type:
                      "input_audio",

                    input_audio: {
                      data:
                        audioBase64,

                      format,
                    },
                  },
                ],
              },
            ],

            temperature:
              0.05,

            max_tokens:
              1800,
          }),
      },
    );

  if (!response.ok) {
    const errorText =
      await response.text();

    console.log(
      "OPENAI DIRECT AUDIO ERROR:",
      response.status,
      errorText,
    );

    throw new Error(
      `Direct audio request failed: ${response.status}`,
    );
  }

  const data =
    await response.json();

  const content =
    data?.choices?.[0]?.message?.content;

  const text =
    typeof content === "string"
      ? content.trim()
      : "";

  if (!text) {
    throw new Error(
      "Direct audio response was empty.",
    );
  }

  return parseJsonObject(
    text,
  );
}

// ============================================================
// Diagnosis normalization
// ============================================================

function normalizeDiagnosis({
  raw,
  lang,
  soundFocus,
  evidence,
}) {
  const allowedIds =
    collectEvidenceIds(
      evidence,
    );

  let status =
    normalizeStatus(
      raw?.status,
    );

  const causes =
    Array.isArray(
      raw?.causes,
    )
      ? raw.causes
          .slice(
            0,
            3,
          )
          .map(
            (item) => {
              const supportingEvidenceIds =
                normalizeStringArray(
                  item?.supportingEvidenceIds,
                  12,
                ).filter(
                  (id) =>
                    allowedIds.has(
                      id,
                    ),
                );

              return {
                title:
                  cleanText(
                    item?.title,
                    180,
                  ),

                description:
                  cleanText(
                    item?.description,
                    500,
                  ),

                confidence:
                  normalizeCauseConfidence({
                    value:
                      item?.confidence,

                    supportingEvidenceIds,
                  }),

                supportingEvidenceIds,

                verification:
                  cleanText(
                    item?.verification,
                    500,
                  ),
              };
            },
          )
          .filter(
            (item) =>
              item.title,
          )
      : [];

  const followUpQuestions =
    Array.isArray(
      raw?.followUpQuestions,
    )
      ? raw.followUpQuestions
          .slice(
            0,
            2,
          )
          .map(
            (item) => ({
              question:
                cleanText(
                  item?.question,
                  260,
                ),

              /*
               * The backend enforces an uncertainty option.
               *
               * The user must never be forced to invent
               * an observation.
               */
              options:
                normalizeFollowUpOptions(
                  item?.options,
                  lang,
                ),
            }),
          )
          .filter(
            (item) =>
              item.question &&
              item.options.length >= 2,
          )
      : [];

  const limitations =
    normalizeStringArray(
      raw?.limitations,
      8,
    );

  if (
    status === "complete" &&
    causes.length === 0
  ) {
    status =
      "insufficient_evidence";
  }

  if (
    status ===
      "follow_up_required" &&
    followUpQuestions.length === 0
  ) {
    status =
      "insufficient_evidence";
  }

  return {
    status,

    soundFocus,

    directionConfidence:
      normalizeConfidence(
        raw?.directionConfidence,
      ),

    diagnosticTitle:
      cleanText(
        raw?.diagnosticTitle,
        180,
      ) ||
      defaultTitle(
        status,
        lang,
      ),

    diagnosticSummary:
      cleanText(
        raw?.diagnosticSummary,
        700,
      ) ||
      defaultSummary(
        status,
        lang,
      ),

    causes:
      status === "complete"
        ? causes
        : [],

    nextStepTitle:
      cleanText(
        raw?.nextStepTitle,
        180,
      ) ||
      (
        lang === "es"
          ? "Verificar antes de reemplazar"
          : "Verify before replacing"
      ),

    nextStepBody:
      cleanText(
        raw?.nextStepBody,
        700,
      ) ||
      (
        lang === "es"
          ? "Realiza una comprobación dirigida antes de reemplazar piezas."
          : "Perform a targeted verification before replacing parts."
      ),

    doNotReplaceTitle:
      cleanText(
        raw?.doNotReplaceTitle,
        180,
      ) ||
      (
        lang === "es"
          ? "Ningún componente está confirmado todavía"
          : "No component is confirmed failed yet"
      ),

    doNotReplaceBody:
      cleanText(
        raw?.doNotReplaceBody,
        700,
      ) ||
      (
        lang === "es"
          ? "El audio puede orientar el diagnóstico, pero no confirma por sí solo una pieza defectuosa."
          : "Audio can guide diagnosis, but it does not by itself confirm a failed part."
      ),

    technicalDetails:
      buildTechnicalDetails(
        evidence,
        lang,
      ),

    followUpQuestions:
      status ===
        "follow_up_required"
        ? followUpQuestions
        : [],

    limitations,
  };
}

/*
 * HIGH cause confidence must never be produced from
 * harmonic evidence alone.
 */
function normalizeCauseConfidence({
  value,
  supportingEvidenceIds,
}) {
  const confidence =
    normalizeConfidence(
      value,
    );

  if (
    confidence !== "high"
  ) {
    return confidence;
  }

  if (
    supportingEvidenceIds.length === 0
  ) {
    return "medium";
  }

  const onlyHarmonicEvidence =
    supportingEvidenceIds.every(
      (id) =>
        isHarmonicEvidenceId(
          id,
        ),
    );

  if (
    onlyHarmonicEvidence
  ) {
    return "medium";
  }

  return confidence;
}

// ============================================================
// Audio evidence normalization
// ============================================================

function normalizeAudioEvidence(
  value,
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const recording =
    value.recording || {};

  const quality =
    value.quality || {};

  // ----------------------------------------------------------
  // Measured signals
  // ----------------------------------------------------------

  const signals =
    Array.isArray(
      value.signals,
    )
      ? value.signals
          .slice(
            0,
            32,
          )
          .map(
            (item) => ({
              id:
                cleanText(
                  item?.id,
                  100,
                ),

              name:
                cleanText(
                  item?.name,
                  160,
                ),

              numericValue:
                normalizeNumber(
                  item?.numericValue,
                ),

              displayValue:
                cleanText(
                  item?.displayValue,
                  160,
                ),

              unit:
                cleanText(
                  item?.unit,
                  40,
                ),

              status:
                normalizeEvidenceStatus(
                  item?.status,
                ),

              source:
                cleanText(
                  item?.source,
                  120,
                ),
            }),
          )
          .filter(
            (item) =>
              item.id,
          )
      : [];

  const signalIds =
    new Set(
      signals
        .map(
          (item) =>
            item.id,
        )
        .filter(Boolean),
    );

  // ----------------------------------------------------------
  // Acoustic observations
  // ----------------------------------------------------------

  const observations =
    Array.isArray(
      value.observations,
    )
      ? value.observations
          .slice(
            0,
            32,
          )
          .map(
            (item) => ({
              id:
                cleanText(
                  item?.id,
                  100,
                ),

              label:
                cleanText(
                  item?.label,
                  180,
                ),

              description:
                cleanText(
                  item?.description,
                  500,
                ),

              status:
                normalizeEvidenceStatus(
                  item?.status,
                ),

              supportingSignalIds:
                normalizeStringArray(
                  item?.supportingSignalIds,
                  16,
                ).filter(
                  (id) =>
                    signalIds.has(
                      id,
                    ),
                ),
            }),
          )
          .filter(
            (item) =>
              item.id,
          )
      : [];

  const observationIds =
    new Set(
      observations
        .map(
          (item) =>
            item.id,
        )
        .filter(Boolean),
    );

  /*
   * Harmonic evidence can reference only existing
   * base evidence IDs.
   */
  const baseEvidenceIds =
    new Set([
      ...signalIds,
      ...observationIds,
    ]);

  const harmonics =
    normalizeHarmonicEvidence({
      value:
        value.harmonics,

      allowedSupportingIds:
        baseEvidenceIds,
    });

  return {
    recording: {
      sourceZone:
        cleanText(
          recording.sourceZone,
          80,
        ),

      durationMilliseconds:
        normalizeNumber(
          recording.durationMilliseconds,
        ),

      sampleRateHz:
        normalizeNumber(
          recording.sampleRateHz,
        ),

      channelCount:
        normalizeNumber(
          recording.channelCount,
        ),

      format:
        cleanText(
          recording.format,
          30,
        ),
    },

    quality: {
      state:
        normalizeQualityState(
          quality.state,
        ),

      signalLevel:
        normalizeNumber(
          quality.signalLevel,
        ),

      clippingRatio:
        normalizeNumber(
          quality.clippingRatio,
        ),

      noiseRatio:
        normalizeNumber(
          quality.noiseRatio,
        ),

      limitations:
        normalizeStringArray(
          quality.limitations,
          10,
        ),
    },

    signals,

    observations,

    /*
     * Invalid / absent harmonic data is omitted.
     */
    ...(harmonics
      ? {
          harmonics,
        }
      : {}),

    capturedAt:
      cleanText(
        value.capturedAt,
        80,
      ),
  };
}

// ============================================================
// Harmonic evidence normalization
// ============================================================

function normalizeHarmonicEvidence({
  value,
  allowedSupportingIds,
}) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const state =
    normalizeHarmonicEvidenceState(
      value.state,
    );

  const source =
    cleanText(
      value.source,
      120,
    );

  const limitations =
    normalizeStringArray(
      value.limitations,
      12,
    );

  /*
   * Unknown implementations are not allowed to
   * masquerade as DriveShift Harmonic V1 evidence.
   */
  if (
    source !==
    HARMONIC_SOURCE_ID
  ) {
    return {
      state:
        "unavailable",

      source:
        HARMONIC_SOURCE_ID,

      estimatedFundamental:
        null,

      harmonicity:
        null,

      detectedHarmonicCount:
        0,

      peaks:
        [],

      limitations: [
        ...limitations,
        "Harmonic evidence source did not match the validated DriveShift harmonic contract.",
      ].slice(
        0,
        12,
      ),
    };
  }

  /*
   * Insufficient / unavailable evidence must not carry
   * stale acoustic values into reasoning.
   */
  if (
    state !== "available"
  ) {
    return {
      state,

      source:
        HARMONIC_SOURCE_ID,

      estimatedFundamental:
        null,

      harmonicity:
        null,

      detectedHarmonicCount:
        0,

      peaks:
        [],

      limitations,
    };
  }

  const fundamental =
    normalizeHarmonicScalar({
      value:
        value.estimatedFundamental,

      expectedId:
        HARMONIC_FUNDAMENTAL_ID,

      min:
        0.000001,

      max:
        null,

      allowedSupportingIds,
    });

  const harmonicity =
    normalizeHarmonicScalar({
      value:
        value.harmonicity,

      expectedId:
        HARMONICITY_ID,

      min:
        0.0,

      max:
        1.0,

      allowedSupportingIds,
    });

  const peaks =
    Array.isArray(
      value.peaks,
    )
      ? value.peaks
          .slice(
            0,
            16,
          )
          .map(
            (item) =>
              normalizeHarmonicPeak({
                value:
                  item,

                allowedSupportingIds,
              }),
          )
          .filter(Boolean)
      : [];

  /*
   * Repeat app-side protection at the backend
   * trust boundary.
   */
  if (
    !fundamental ||
    !harmonicity ||
    peaks.length < 3
  ) {
    return {
      state:
        "insufficient_evidence",

      source:
        HARMONIC_SOURCE_ID,

      estimatedFundamental:
        null,

      harmonicity:
        null,

      detectedHarmonicCount:
        0,

      peaks:
        [],

      limitations: [
        ...limitations,
        "Harmonic evidence did not pass backend contract validation.",
      ].slice(
        0,
        12,
      ),
    };
  }

  return {
    state:
      "available",

    source:
      HARMONIC_SOURCE_ID,

    estimatedFundamental:
      fundamental,

    harmonicity,

    /*
     * Never trust a client-supplied count.
     */
    detectedHarmonicCount:
      peaks.length,

    peaks,

    limitations,
  };
}

// ============================================================
// Harmonic scalar normalization
// ============================================================

function normalizeHarmonicScalar({
  value,
  expectedId,
  min,
  max,
  allowedSupportingIds,
}) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const id =
    cleanText(
      value.id,
      100,
    );

  if (
    id !== expectedId
  ) {
    return null;
  }

  const numericValue =
    normalizeNumber(
      value.numericValue,
    );

  if (
    numericValue === null
  ) {
    return null;
  }

  if (
    min !== null &&
    numericValue < min
  ) {
    return null;
  }

  if (
    max !== null &&
    numericValue > max
  ) {
    return null;
  }

  const status =
    normalizeEvidenceStatus(
      value.status,
    );

  /*
   * Harmonic scalar evidence must remain inferred.
   */
  if (
    status !== "inferred"
  ) {
    return null;
  }

  const source =
    cleanText(
      value.source,
      120,
    );

  if (
    source !==
    HARMONIC_SOURCE_ID
  ) {
    return null;
  }

  return {
    id,

    name:
      cleanText(
        value.name,
        180,
      ),

    numericValue,

    displayValue:
      cleanText(
        value.displayValue,
        120,
      ),

    unit:
      cleanText(
        value.unit,
        30,
      ),

    status:
      "inferred",

    source:
      HARMONIC_SOURCE_ID,

    derivation:
      cleanText(
        value.derivation,
        500,
      ),

    supportingEvidenceIds:
      normalizeStringArray(
        value.supportingEvidenceIds,
        16,
      ).filter(
        (id) =>
          allowedSupportingIds.has(
            id,
          ),
      ),

    limitations:
      normalizeStringArray(
        value.limitations,
        10,
      ),
  };
}

// ============================================================
// Harmonic peak normalization
// ============================================================

function normalizeHarmonicPeak({
  value,
  allowedSupportingIds,
}) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const id =
    cleanText(
      value.id,
      100,
    );

  if (
    !/^HARM_PEAK_\d{2}$/.test(
      id,
    )
  ) {
    return null;
  }

  const harmonicNumber =
    normalizeInteger(
      value.harmonicNumber,
    );

  const expectedFrequencyHz =
    normalizeNumber(
      value.expectedFrequencyHz,
    );

  const detectedFrequencyHz =
    normalizeNumber(
      value.detectedFrequencyHz,
    );

  const magnitude =
    normalizeNumber(
      value.magnitude,
    );

  const relativeDb =
    normalizeNumber(
      value.relativeDb,
    );

  const frequencyDeviationHz =
    normalizeNumber(
      value.frequencyDeviationHz,
    );

  if (
    harmonicNumber === null ||
    harmonicNumber <= 0 ||
    expectedFrequencyHz === null ||
    expectedFrequencyHz <= 0 ||
    detectedFrequencyHz === null ||
    detectedFrequencyHz <= 0 ||
    magnitude === null ||
    magnitude < 0 ||
    relativeDb === null ||
    frequencyDeviationHz === null ||
    frequencyDeviationHz < 0
  ) {
    return null;
  }

  const expectedId =
    `HARM_PEAK_${String(
      harmonicNumber,
    ).padStart(
      2,
      "0",
    )}`;

  if (
    id !== expectedId
  ) {
    return null;
  }

  const status =
    normalizeEvidenceStatus(
      value.status,
    );

  if (
    status !== "inferred"
  ) {
    return null;
  }

  const source =
    cleanText(
      value.source,
      120,
    );

  if (
    source !==
    HARMONIC_SOURCE_ID
  ) {
    return null;
  }

  return {
    id,

    harmonicNumber,

    expectedFrequencyHz,

    detectedFrequencyHz,

    /*
     * Linear spectrum magnitude.
     * NOT dBFS.
     */
    magnitude,

    /*
     * Relative only to the strongest harmonic
     * within this pattern.
     */
    relativeDb,

    frequencyDeviationHz,

    status:
      "inferred",

    source:
      HARMONIC_SOURCE_ID,

    derivation:
      cleanText(
        value.derivation,
        500,
      ),

    supportingEvidenceIds:
      normalizeStringArray(
        value.supportingEvidenceIds,
        16,
      ).filter(
        (supportingId) =>
          allowedSupportingIds.has(
            supportingId,
          ),
      ),

    limitations:
      normalizeStringArray(
        value.limitations,
        10,
      ),
  };
}

// ============================================================
// Technical details
// ============================================================

function buildTechnicalDetails(
  evidence,
  lang,
) {
  if (!evidence) {
    return [];
  }

  const details =
    [];

  if (
    evidence.quality?.state
  ) {
    details.push({
      label:
        lang === "es"
          ? "Calidad de grabación"
          : "Recording quality",

      value:
        evidence.quality.state,
    });
  }

  for (
    const signal
    of evidence.signals || []
  ) {
    if (
      signal.status !== "measured"
    ) {
      continue;
    }

    if (
      !signal.name ||
      !signal.displayValue
    ) {
      continue;
    }

    details.push({
      label:
        signal.name,

      value:
        signal.displayValue,
    });
  }

  /*
   * Harmonic quantities are displayed only as
   * derived acoustic data.
   *
   * Nothing here is called RPM or component speed.
   */
  if (
    evidence.harmonics?.state ===
    "available"
  ) {
    const fundamental =
      evidence
        .harmonics
        .estimatedFundamental;

    const harmonicity =
      evidence
        .harmonics
        .harmonicity;

    if (
      fundamental?.displayValue
    ) {
      details.push({
        label:
          lang === "es"
            ? "Fundamental acústica estimada"
            : "Estimated acoustic fundamental",

        value:
          fundamental.displayValue,
      });
    }

    if (
      harmonicity?.displayValue
    ) {
      details.push({
        label:
          lang === "es"
            ? "Índice de harmonicidad acústica"
            : "Acoustic harmonicity score",

        value:
          harmonicity.displayValue,
      });
    }

    details.push({
      label:
        lang === "es"
          ? "Armónicos detectados"
          : "Detected harmonic peaks",

      value:
        String(
          evidence
            .harmonics
            .detectedHarmonicCount ||
          0,
        ),
    });
  }

  return details.slice(
    0,
    14,
  );
}

// ============================================================
// Evidence ID registry
// ============================================================

function collectEvidenceIds(
  evidence,
) {
  const ids =
    new Set();

  for (
    const item
    of evidence?.signals || []
  ) {
    if (item.id) {
      ids.add(
        item.id,
      );
    }
  }

  for (
    const item
    of evidence?.observations || []
  ) {
    if (item.id) {
      ids.add(
        item.id,
      );
    }
  }

  if (
    evidence?.harmonics?.state ===
    "available"
  ) {
    const fundamental =
      evidence
        .harmonics
        .estimatedFundamental;

    const harmonicity =
      evidence
        .harmonics
        .harmonicity;

    if (
      fundamental?.id
    ) {
      ids.add(
        fundamental.id,
      );
    }

    if (
      harmonicity?.id
    ) {
      ids.add(
        harmonicity.id,
      );
    }

    for (
      const peak
      of evidence
        .harmonics
        .peaks || []
    ) {
      if (peak.id) {
        ids.add(
          peak.id,
        );
      }
    }
  }

  return ids;
}

function isHarmonicEvidenceId(
  id,
) {
  return (
    id ===
      HARMONIC_FUNDAMENTAL_ID ||
    id ===
      HARMONICITY_ID ||
    /^HARM_PEAK_\d{2}$/.test(
      String(id || ""),
    )
  );
}

// ============================================================
// Sound focus
// ============================================================

function resolveSoundFocus({
  lang,
  evidence,
  selectedSoundPattern,
}) {
  const zone =
    String(
      evidence
        ?.recording
        ?.sourceZone ||
        "",
    ).toLowerCase();

  if (
    zone === "enginebay"
  ) {
    return lang === "es"
      ? "Área del motor"
      : "Engine bay";
  }

  if (
    zone === "wheelarea"
  ) {
    return lang === "es"
      ? "Área de rueda"
      : "Wheel area";
  }

  if (
    zone ===
    "undervehicleexhaust"
  ) {
    return lang === "es"
      ? "Debajo / escape"
      : "Under vehicle / exhaust";
  }

  const legacy =
    String(
      selectedSoundPattern ||
        "",
    ).toLowerCase();

  if (
    legacy.includes(
      "engine",
    ) ||
    legacy.includes(
      "motor",
    )
  ) {
    return lang === "es"
      ? "Área del motor"
      : "Engine bay";
  }

  if (
    legacy.includes(
      "wheel",
    ) ||
    legacy.includes(
      "rueda",
    )
  ) {
    return lang === "es"
      ? "Área de rueda"
      : "Wheel area";
  }

  if (
    legacy.includes(
      "under",
    ) ||
    legacy.includes(
      "exhaust",
    ) ||
    legacy.includes(
      "debajo",
    ) ||
    legacy.includes(
      "escape",
    )
  ) {
    return lang === "es"
      ? "Debajo / escape"
      : "Under vehicle / exhaust";
  }

  return lang === "es"
    ? "No confirmado"
    : "Unconfirmed";
}

// ============================================================
// Insufficient evidence
// ============================================================

function buildInsufficientResult({
  lang,
  soundFocus,
  limitation,
  technicalDetails = [],
}) {
  return {
    status:
      "insufficient_evidence",

    soundFocus,

    directionConfidence:
      "unknown",

    diagnosticTitle:
      lang === "es"
        ? "Se necesita más evidencia de audio"
        : "More audio evidence is needed",

    diagnosticSummary:
      lang === "es"
        ? "La evidencia disponible no permite una dirección diagnóstica responsable sin adivinar."
        : "The available evidence does not support a responsible diagnostic direction without guessing.",

    causes:
      [],

    nextStepTitle:
      lang === "es"
        ? "Verificar antes de reemplazar"
        : "Verify before replacing",

    nextStepBody:
      lang === "es"
        ? "Repite o complementa la comprobación con una condición de funcionamiento que ayude a confirmar el origen."
        : "Repeat or supplement the check under an operating condition that can help confirm the source.",

    doNotReplaceTitle:
      lang === "es"
        ? "Ningún componente está confirmado todavía"
        : "No component is confirmed failed yet",

    doNotReplaceBody:
      lang === "es"
        ? "No reemplaces piezas basándote únicamente en esta grabación."
        : "Do not replace parts based on this recording alone.",

    technicalDetails,

    followUpQuestions:
      [],

    limitations:
      limitation
        ? [
            limitation,
          ]
        : [],
  };
}

// ============================================================
// Legacy compatibility
// ============================================================

function buildLegacyResult(
  diagnosis,
  lang,
) {
  if (
    diagnosis.status ===
    "follow_up_required"
  ) {
    const lines = [
      "Diagnosis status: audio_follow_up",
      "",
      "Voice summary:",
      diagnosis.diagnosticSummary,
      "",
      "Audio direction:",
      diagnosis.diagnosticTitle,
    ];

    diagnosis
      .followUpQuestions
      .forEach(
        (
          item,
          index,
        ) => {
          const n =
            index + 1;

          lines.push(
            "",
            `Question ${n}:`,
            item.question,
            "",
            `Answer options ${n}:`,
            ...item.options,
          );
        },
      );

    return lines.join(
      "\n",
    );
  }

  const causes =
    diagnosis.causes.length > 0
      ? diagnosis.causes
      : [
          {
            title:
              lang === "es"
                ? "Evidencia insuficiente"
                : "Insufficient evidence",

            description:
              diagnosis.diagnosticSummary,

            verification:
              diagnosis.nextStepBody,
          },
        ];

  return `Diagnosis status: analysis

Voice summary:
${diagnosis.diagnosticSummary}

Likely issue:
Most likely: ${causes[0]?.title || "Unconfirmed"}
Secondary possibility: ${causes[1]?.title || "Unconfirmed"}
Less likely: ${causes[2]?.title || "Unconfirmed"}

Why it fits:
${causes.map((item) => item.description).filter(Boolean).join(" ")}

What to inspect next:
${causes.map((item) => item.verification).filter(Boolean).join(" ")}

What to do next:
${diagnosis.nextStepBody}

Answer options:
None`;
}

// ============================================================
// Audio format
// ============================================================

function normalizeAudioFormat(
  format,
) {
  const value =
    String(
      format || "",
    )
      .trim()
      .toLowerCase();

  if (
    value.includes("wav")
  ) {
    return "wav";
  }

  if (
    value.includes("mp3") ||
    value.includes("mpeg")
  ) {
    return "mp3";
  }

  return null;
}

// ============================================================
// Diagnosis states
// ============================================================

function normalizeStatus(
  value,
) {
  const status =
    String(
      value || "",
    )
      .trim()
      .toLowerCase();

  if (
    status === "complete"
  ) {
    return "complete";
  }

  if (
    status ===
    "follow_up_required"
  ) {
    return "follow_up_required";
  }

  return "insufficient_evidence";
}

function normalizeConfidence(
  value,
) {
  const confidence =
    String(
      value || "",
    )
      .trim()
      .toLowerCase();

  if (
    confidence === "high"
  ) {
    return "high";
  }

  if (
    confidence === "medium" ||
    confidence === "moderate"
  ) {
    return "medium";
  }

  if (
    confidence === "low"
  ) {
    return "low";
  }

  return "unknown";
}

// ============================================================
// Evidence states
// ============================================================

function normalizeEvidenceStatus(
  value,
) {
  const status =
    String(
      value || "",
    )
      .trim()
      .toLowerCase();

  if (
    status === "measured"
  ) {
    return "measured";
  }

  if (
    status === "observed"
  ) {
    return "observed";
  }

  if (
    status === "inferred"
  ) {
    return "inferred";
  }

  return "unverified";
}

function normalizeQualityState(
  value,
) {
  const state =
    String(
      value || "",
    )
      .trim()
      .toLowerCase();

  if (
    state === "usable"
  ) {
    return "usable";
  }

  if (
    state === "marginal"
  ) {
    return "marginal";
  }

  if (
    state === "unusable"
  ) {
    return "unusable";
  }

  return "unknown";
}

function normalizeHarmonicEvidenceState(
  value,
) {
  const state =
    String(
      value || "",
    )
      .trim()
      .toLowerCase()
      .replace(
        /[_\-\s]/g,
        "",
      );

  if (
    state === "available"
  ) {
    return "available";
  }

  if (
    state ===
    "insufficientevidence"
  ) {
    return "insufficient_evidence";
  }

  return "unavailable";
}

// ============================================================
// Follow-up options
// ============================================================

function normalizeFollowUpOptions(
  value,
  lang,
) {
  const notSure =
    lang === "es"
      ? "No estoy seguro"
      : "Not sure";

  let options =
    normalizeStringArray(
      value,
      4,
    );

  const seen =
    new Set();

  options =
    options.filter(
      (item) => {
        const key =
          item
            .toLowerCase()
            .trim();

        if (
          seen.has(key)
        ) {
          return false;
        }

        seen.add(key);

        return true;
      },
    );

  const hasUncertaintyOption =
    options.some(
      (item) => {
        const normalized =
          item
            .toLowerCase()
            .trim();

        return (
          normalized ===
            "not sure" ||
          normalized ===
            "unsure" ||
          normalized ===
            "i don't know" ||
          normalized ===
            "i do not know" ||
          normalized ===
            "no estoy seguro" ||
          normalized ===
            "no estoy segura" ||
          normalized ===
            "no sé"
        );
      },
    );

  if (
    !hasUncertaintyOption
  ) {
    if (
      options.length >= 4
    ) {
      options = [
        ...options.slice(
          0,
          3,
        ),
        notSure,
      ];
    } else {
      options.push(
        notSure,
      );
    }
  }

  return options.slice(
    0,
    4,
  );
}

// ============================================================
// Primitive normalization
// ============================================================

function normalizeStringArray(
  value,
  maxItems,
) {
  if (
    !Array.isArray(value)
  ) {
    return [];
  }

  return value
    .slice(
      0,
      maxItems,
    )
    .map(
      (item) =>
        cleanText(
          item,
          400,
        ),
    )
    .filter(Boolean);
}

function normalizeNumber(
  value,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(
    number,
  )
    ? number
    : null;
}

function normalizeInteger(
  value,
) {
  const number =
    normalizeNumber(
      value,
    );

  if (
    number === null ||
    !Number.isInteger(number)
  ) {
    return null;
  }

  return number;
}

function cleanText(
  value,
  maxLength,
) {
  return String(
    value ?? "",
  )
    .replace(
      /\s+/g,
      " ",
    )
    .trim()
    .slice(
      0,
      maxLength,
    );
}

// ============================================================
// JSON parser
// ============================================================

function parseJsonObject(
  text,
) {
  let clean =
    String(
      text || "",
    ).trim();

  clean =
    clean
      .replace(
        /^```(?:json)?\s*/i,
        "",
      )
      .replace(
        /\s*```$/i,
        "",
      )
      .trim();

  try {
    const parsed =
      JSON.parse(clean);

    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parsed;
    }
  } catch (_) {}

  const start =
    clean.indexOf("{");

  const end =
    clean.lastIndexOf("}");

  if (
    start !== -1 &&
    end > start
  ) {
    const parsed =
      JSON.parse(
        clean.slice(
          start,
          end + 1,
        ),
      );

    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parsed;
    }
  }

  throw new Error(
    "Audio model did not return valid JSON.",
  );
}

function safeJson(
  value,
) {
  try {
    return JSON.stringify(
      value ?? null,
    );
  } catch (_) {
    return "null";
  }
}

// ============================================================
// Defaults
// ============================================================

function defaultTitle(
  status,
  lang,
) {
  if (
    status ===
    "follow_up_required"
  ) {
    return lang === "es"
      ? "Se necesita una confirmación rápida"
      : "A quick confirmation is needed";
  }

  if (
    status === "complete"
  ) {
    return lang === "es"
      ? "Dirección diagnóstica de audio"
      : "Audio diagnostic direction";
  }

  return lang === "es"
    ? "Evidencia de audio insuficiente"
    : "Insufficient audio evidence";
}

function defaultSummary(
  status,
  lang,
) {
  if (
    status ===
    "follow_up_required"
  ) {
    return lang === "es"
      ? "La grabación aporta información útil, pero una respuesta adicional ayudaría a separar las causas plausibles."
      : "The recording provides useful information, but one additional answer would help separate plausible causes.";
  }

  if (
    status === "complete"
  ) {
    return lang === "es"
      ? "La evidencia permite una dirección diagnóstica preliminar que todavía requiere verificación física."
      : "The evidence supports a preliminary diagnostic direction that still requires physical verification.";
  }

  return lang === "es"
    ? "La evidencia disponible no permite una conclusión responsable sin más verificación."
    : "The available evidence does not support a responsible conclusion without further verification.";
}
