// api/audio-diagnose.js

const AUDIO_MODEL = process.env.OPENAI_AUDIO_MODEL || "gpt-audio";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ result: "Method not allowed" });
  }

  const lang = req.body?.language === "es" ? "es" : "en";

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

    const audioBase64 = String(audio || "").trim();
    const format = normalizeAudioFormat(audioFormat);
    const evidence = normalizeAudioEvidence(audioEvidence);

    const soundFocus = resolveSoundFocus({
      lang,
      evidence,
      selectedSoundPattern,
    });

    if (!audioBase64 || audioBase64.length < 1000) {
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

function sendDiagnosis(
  res,
  diagnosis,
  lang,
) {
  return res.status(200).json({
    diagnosis,
    result:
        buildLegacyResult(
      diagnosis,
      lang,
    ),
  });
}

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

EVIDENCE CONTRACT

- The original audio is acoustic input, not automatic proof of a failed component.
- Capture location only describes where the phone was placed.
- Entries marked "measured" are measurements. Preserve their names, values, units, IDs, and meaning.
- Entries marked "observed" are derived acoustic descriptions, not confirmed failures.
- Never invent frequencies, dBFS values, clipping values, RPM correlation, speed correlation, measurements, or evidence IDs.
- Never convert an acoustic measurement into a confirmed failed part.
- Causes are hypotheses only.
- supportingEvidenceIds may contain only IDs supplied in VERIFIED AUDIO EVIDENCE.
- Do not use HIGH confidence merely because a location was selected.
- If the evidence cannot support a responsible direction, return insufficient_evidence.
- If one or two behavioral questions would materially separate plausible causes, return follow_up_required.
- Do not recommend replacing a component from audio evidence alone.
- Every cause must include a practical verification step.

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
        "option 4"
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
      body: JSON.stringify({
        model: AUDIO_MODEL,
        messages: [
          {
            role: "system",
            content:
                "You are DriveShift's evidence-constrained automotive audio diagnostic engine. Separate measured evidence, acoustic observations, hypotheses, and verification. Never invent measurements or confirmed failures.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt,
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
            1600,
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
              .slice(0, 3)
              .map((item) => ({
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
                    normalizeConfidence(
                  item?.confidence,
                ),
                supportingEvidenceIds:
                    normalizeStringArray(
                  item?.supportingEvidenceIds,
                  12,
                ).filter(
                  (id) =>
                      allowedIds.has(
                    id,
                  ),
                ),
                verification:
                    cleanText(
                  item?.verification,
                  500,
                ),
              }))
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
              .slice(0, 2)
              .map(
                (item) => ({
                  question:
                      cleanText(
                    item?.question,
                    260,
                  ),
                  options:
                      normalizeStringArray(
                    item?.options,
                    4,
                  ),
                }),
              )
              .filter(
                (item) =>
                    item.question &&
                    item.options.length >=
                        2,
              )
          : [];

  const limitations =
      normalizeStringArray(
    raw?.limitations,
    6,
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

    signals:
        Array.isArray(
          value.signals,
        )
            ? value.signals
                .slice(0, 32)
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
            : [],

    observations:
        Array.isArray(
          value.observations,
        )
            ? value.observations
                .slice(0, 32)
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
                    ),
                  }),
                )
            : [],

    capturedAt:
        cleanText(
      value.capturedAt,
      80,
    ),
  };
}

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
      signal.status !==
      "measured"
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

  return details.slice(
    0,
    12,
  );
}

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
      ids.add(item.id);
    }
  }

  for (
    const item
    of evidence?.observations || []
  ) {
    if (item.id) {
      ids.add(item.id);
    }
  }

  return ids;
}

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

    causes: [],

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

    followUpQuestions: [],

    limitations:
        limitation
            ? [limitation]
            : [],
  };
}

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
          (item, index) => {
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
                    diagnosis
                        .diagnosticSummary,
                verification:
                    diagnosis
                        .nextStepBody,
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
    value.includes(
      "wav",
    )
  ) {
    return "wav";
  }

  if (
    value.includes(
      "mp3",
    ) ||
    value.includes(
      "mpeg",
    )
  ) {
    return "mp3";
  }

  return null;
}

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
    status ===
    "complete"
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
    confidence ===
    "high"
  ) {
    return "high";
  }

  if (
    confidence ===
        "medium" ||
    confidence ===
        "moderate"
  ) {
    return "medium";
  }

  if (
    confidence ===
    "low"
  ) {
    return "low";
  }

  return "unknown";
}

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
    status ===
    "measured"
  ) {
    return "measured";
  }

  if (
    status ===
    "observed"
  ) {
    return "observed";
  }

  if (
    status ===
    "inferred"
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

function normalizeStringArray(
  value,
  maxItems,
) {
  if (
    !Array.isArray(
      value,
    )
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

function parseJsonObject(
  text,
) {
  let clean =
      String(
        text || "",
      ).trim();

  clean = clean
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
        JSON.parse(
      clean,
    );

    if (
      parsed &&
      typeof parsed ===
          "object" &&
      !Array.isArray(
        parsed,
      )
    ) {
      return parsed;
    }
  } catch (_) {}

  const start =
      clean.indexOf(
    "{",
  );

  const end =
      clean.lastIndexOf(
    "}",
  );

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
      typeof parsed ===
          "object" &&
      !Array.isArray(
        parsed,
      )
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
    status ===
    "complete"
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
    status ===
    "complete"
  ) {
    return lang === "es"
        ? "La evidencia permite una dirección diagnóstica preliminar que todavía requiere verificación física."
        : "The evidence supports a preliminary diagnostic direction that still requires physical verification.";
  }

  return lang === "es"
      ? "La evidencia disponible no permite una conclusión responsable sin más verificación."
      : "The available evidence does not support a responsible conclusion without further verification.";
}
