// ============================================================
// DriveShift Camera V2
// Evidence-Based Diagnostic Reasoning Endpoint
//
// PURPOSE:
//
// Validated Camera V2 evidence
//   +
// vehicle configuration context
//   ↓
// automotive diagnostic reasoning
//   ↓
// STRICT structured hypotheses
//   ↓
// server-side evidence validation
//   ↓
// Flutter CameraDiagnosisMapper
//
// IMPORTANT:
//
// This endpoint does NOT inspect the raw image.
// It reasons only from already-validated evidence.
// ============================================================

const OPENAI_RESPONSES_URL =
  "https://api.openai.com/v1/responses";

const DEFAULT_MODEL =
  process.env.DRIVESHIFT_CAMERA_DIAGNOSIS_MODEL ||
  "gpt-5.6-sol";

const MAX_HYPOTHESES = 5;
const MAX_VERIFICATION_STEPS = 8;

const VALID_DIAGNOSIS_STATES = new Set([
  "analysis_available",
  "insufficient_evidence",
  "verification_required",
]);

const VALID_CONFIDENCE = new Set([
  "low",
  "medium",
  "high",
]);

const VALID_URGENCY = new Set([
  "monitor",
  "inspection_recommended",
  "service_soon",
  "prompt_inspection",
  "stop_driving",
]);

const DIAGNOSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,

  properties: {
    state: {
      type: "string",
      enum: [
        "analysis_available",
        "insufficient_evidence",
        "verification_required",
      ],
    },

    summary: {
      type: "string",
    },

    hypotheses: {
      type: "array",

      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          id: {
            type: "string",
          },

          title: {
            type: "string",
          },

          reasoning: {
            type: "string",
          },

          confidence: {
            type: "string",
            enum: [
              "low",
              "medium",
              "high",
            ],
          },

          supportingEvidenceIds: {
            type: "array",
            items: {
              type: "string",
            },
          },

          limitations: {
            type: "array",
            items: {
              type: "string",
            },
          },
        },

        required: [
          "id",
          "title",
          "reasoning",
          "confidence",
          "supportingEvidenceIds",
          "limitations",
        ],
      },
    },

    verificationSteps: {
      type: "array",

      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          id: {
            type: "string",
          },

          description: {
            type: "string",
          },

          relatedHypothesisIds: {
            type: "array",
            items: {
              type: "string",
            },
          },

          requiresEngineOff: {
            type: "boolean",
          },

          professionalInspectionRecommended: {
            type: "boolean",
          },
        },

        required: [
          "id",
          "description",
          "relatedHypothesisIds",
          "requiresEngineOff",
          "professionalInspectionRecommended",
        ],
      },
    },

    /*
     * Structured Outputs always returns this object.
     *
     * present=false means no distinct safety guidance
     * beyond normal verification is justified.
     */
    safetyGuidance: {
      type: "object",
      additionalProperties: false,

      properties: {
        present: {
          type: "boolean",
        },

        urgency: {
          type: "string",
          enum: [
            "monitor",
            "inspection_recommended",
            "service_soon",
            "prompt_inspection",
            "stop_driving",
          ],
        },

        summary: {
          type: "string",
        },

        rationale: {
          type: "string",
        },
      },

      required: [
        "present",
        "urgency",
        "summary",
        "rationale",
      ],
    },

    limitations: {
      type: "array",
      items: {
        type: "string",
      },
    },
  },

  required: [
    "state",
    "summary",
    "hypotheses",
    "verificationSteps",
    "safetyGuidance",
    "limitations",
  ],
};

// ============================================================
// Main handler
// ============================================================

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendError(
      res,
      405,
      "METHOD_NOT_ALLOWED",
      "Only POST requests are supported."
    );
  }

  try {
    const body =
      req.body && typeof req.body === "object"
        ? req.body
        : {};

    const language =
      body.language === "es"
        ? "es"
        : "en";

    const rawCameraEvidence =
      body.cameraEvidence &&
      typeof body.cameraEvidence === "object"
        ? body.cameraEvidence
        : null;

    if (!rawCameraEvidence) {
      return sendError(
        res,
        400,
        "CAMERA_EVIDENCE_REQUIRED",
        "Validated Camera V2 evidence is required."
      );
    }

    // ========================================================
    // 1. Normalize evidence
    // ========================================================

    const cameraEvidence =
      normalizeCameraEvidence(
        rawCameraEvidence
      );

    if (!cameraEvidence) {
      return sendError(
        res,
        400,
        "INVALID_CAMERA_EVIDENCE",
        "The Camera V2 evidence contract is invalid."
      );
    }

    // ========================================================
    // 2. Evidence sufficiency gate
    // ========================================================

    if (
      cameraEvidence.imageQuality.state ===
      "unusable"
    ) {
      return res.status(200).json({
        ok: true,

        diagnosis: insufficientDiagnosis(
          language === "es"
            ? "La imagen no cumple con la calidad mínima necesaria para un razonamiento diagnóstico responsable."
            : "The image does not meet the minimum quality required for responsible diagnostic reasoning.",
          [
            language === "es"
              ? "Se necesita una nueva imagen antes de formular una hipótesis diagnóstica."
              : "A new image is required before forming a diagnostic hypothesis.",
          ]
        ),
      });
    }

    if (
      cameraEvidence.visualEvidence.state !==
        "available" ||
      cameraEvidence.visualEvidence.observations
        .length === 0
    ) {
      return res.status(200).json({
        ok: true,

        diagnosis: insufficientDiagnosis(
          language === "es"
            ? "La evidencia visual disponible no permite formular una hipótesis diagnóstica responsable."
            : "The available visual evidence does not support a responsible diagnostic hypothesis.",
          [
            language === "es"
              ? "No se identificó evidencia visual validada suficiente."
              : "No sufficient validated visual evidence was established.",
          ]
        ),
      });
    }

    // ========================================================
    // 3. Vehicle configuration context
    // ========================================================

    const vehicleProfile =
      normalizeVehicleProfile(
        body.vehicleProfile
      );

    // ========================================================
    // 4. Build evidence allow-list
    // ========================================================

    const allowedEvidenceIds =
      collectAllowedEvidenceIds(
        cameraEvidence
      );

    const diagnosticEvidenceIds =
      collectDiagnosticEvidenceIds(
        cameraEvidence
      );

    // ========================================================
    // 5. Build diagnostic prompt
    // ========================================================

    const prompt =
      buildDiagnosticPrompt({
        language,
        cameraEvidence,
        vehicleProfile,
        allowedEvidenceIds,
        diagnosticEvidenceIds,
      });

    // ========================================================
    // 6. OpenAI request
    // ========================================================

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () => controller.abort(),
        35000
      );

    let response;

    try {
      response =
        await fetch(
          OPENAI_RESPONSES_URL,
          {
            method: "POST",

            signal:
              controller.signal,

            headers: {
              "Content-Type":
                "application/json",

              Authorization:
                `Bearer ${process.env.OPENAI_API_KEY}`,
            },

            body: JSON.stringify({
              model:
                DEFAULT_MODEL,

              store:
                false,

              input: [
                {
                  role:
                    "developer",

                  content: [
                    {
                      type:
                        "input_text",

                      text:
                        "Follow the DriveShift Camera V2 diagnostic evidence contract exactly. Never promote a hypothesis beyond the supplied evidence.",
                    },
                  ],
                },

                {
                  role:
                    "user",

                  content: [
                    {
                      type:
                        "input_text",

                      text:
                        prompt,
                    },
                  ],
                },
              ],

              text: {
                format: {
                  type:
                    "json_schema",

                  name:
                    "driveshift_camera_diagnosis_v2",

                  strict:
                    true,

                  schema:
                    DIAGNOSIS_SCHEMA,
                },
              },

              max_output_tokens:
                2600,
            }),
          }
        );
    } catch (error) {
      if (
        error?.name ===
        "AbortError"
      ) {
        return sendError(
          res,
          504,
          "CAMERA_DIAGNOSIS_TIMEOUT",
          "Camera V2 diagnostic reasoning timed out."
        );
      }

      console.error(
        "Camera V2 diagnosis request failed:",
        safeErrorMessage(error)
      );

      return sendError(
        res,
        502,
        "CAMERA_DIAGNOSIS_CONNECTION_FAILED",
        "Camera V2 diagnostic reasoning could not reach the reasoning service."
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const upstreamText =
        await safeReadText(
          response
        );

      console.error(
        "Camera V2 diagnosis upstream error:",
        response.status,
        upstreamText.slice(0, 1000)
      );

      return sendError(
        res,
        502,
        "CAMERA_DIAGNOSIS_UPSTREAM_ERROR",
        "Camera V2 diagnostic reasoning could not be completed."
      );
    }

    // ========================================================
    // 7. Extract structured output
    // ========================================================

    const openAiData =
      await response.json();

    const outputText =
      extractResponseText(
        openAiData
      );

    if (!outputText) {
      return sendError(
        res,
        502,
        "EMPTY_CAMERA_DIAGNOSIS",
        "The reasoning service returned no structured Camera V2 diagnosis."
      );
    }

    let parsed;

    try {
      parsed =
        JSON.parse(
          outputText
        );
    } catch (_) {
      console.error(
        "Camera V2 invalid diagnosis JSON:",
        outputText.slice(0, 1000)
      );

      return sendError(
        res,
        502,
        "INVALID_CAMERA_DIAGNOSIS_JSON",
        "The reasoning service returned invalid structured diagnostic data."
      );
    }

    // ========================================================
    // 8. Server-side diagnostic contract
    // ========================================================

    const diagnosis =
      normalizeDiagnosis({
        raw:
          parsed,

        allowedEvidenceIds:
          new Set(
            allowedEvidenceIds
          ),

        diagnosticEvidenceIds:
          new Set(
            diagnosticEvidenceIds
          ),
      });

    return res.status(200).json({
      ok: true,
      diagnosis,
    });
  } catch (error) {
    console.error(
      "Camera V2 diagnosis backend exception:",
      safeErrorMessage(error)
    );

    return sendError(
      res,
      500,
      "CAMERA_DIAGNOSIS_FAILED",
      "DriveShift could not complete Camera V2 diagnostic reasoning."
    );
  }
}

// ============================================================
// Prompt
// ============================================================

function buildDiagnosticPrompt({
  language,
  cameraEvidence,
  vehicleProfile,
  allowedEvidenceIds,
  diagnosticEvidenceIds,
}) {
  const outputLanguage =
    language === "es"
      ? "Spanish"
      : "English";

  return `
You are the evidence-based automotive diagnostic reasoning layer for DriveShift Camera V2.

Your role begins AFTER visual evidence extraction.

You are NOT looking at the original image.

You may reason ONLY from the supplied validated evidence and vehicle configuration context.

OUTPUT LANGUAGE

Use ${outputLanguage} for human-readable text.

Machine IDs and enum values must remain exactly as required by the schema.

============================================================
EVIDENCE HIERARCHY
============================================================

The supplied evidence may contain:

MEASURED IMAGE-QUALITY EVIDENCE
Technical properties of the image.
These describe image quality only.

OCR OBSERVATIONS
Machine-read visible text.
OCR is probabilistic and must not be treated as guaranteed ground truth.

DIRECT VISUAL OBSERVATIONS
What was visibly present.

VISUAL INTERPRETATIONS
Cautious interpretations already linked to direct observations.

DIAGNOSTIC HYPOTHESES
Your layer.

VERIFICATION
How a hypothesis could be confirmed or rejected.

Do not collapse these layers.

============================================================
CORE DIAGNOSTIC LAW
============================================================

A diagnostic hypothesis is NOT a confirmed fault.

Every hypothesis must:

- be supported by valid evidence IDs
- remain proportional to that evidence
- include meaningful limitations when evidence is incomplete
- avoid claiming hidden mechanical conditions as visible facts
- avoid replacement recommendations without verification

Prefer fewer strong hypotheses over a speculative list.

If evidence does not responsibly support a mechanical hypothesis:
return insufficient_evidence.

============================================================
EVIDENCE ID CONTRACT
============================================================

You may reference ONLY these evidence IDs:

${JSON.stringify(allowedEvidenceIds)}

IDs considered automotive diagnostic evidence include:

${JSON.stringify(diagnosticEvidenceIds)}

Image-quality metrics may provide context about reliability.

However:

IMAGE-QUALITY METRICS ALONE MUST NEVER SUPPORT A VEHICLE-FAULT HYPOTHESIS.

Every diagnostic hypothesis must contain at least one automotive diagnostic evidence ID from the second list.

Never invent evidence IDs.

============================================================
VEHICLE CONFIGURATION CONTRACT
============================================================

Vehicle profile:

${JSON.stringify(vehicleProfile, null, 2)}

The vehicle profile is CONFIGURATION CONTEXT.

It is NOT fault evidence.

Do not claim a component exists merely because it is common on similar vehicles.

If the supplied profile does not establish the presence of a configuration-dependent component, do not name that component as the diagnosis.

Examples include:

- hydraulic power-steering pump
- electric power-steering hardware
- belt-driven water pump
- electric water pump
- turbocharger
- supercharger
- specific ADAS hardware
- specific battery chemistry
- specific suspension technology

Use the narrowest accurate system-level description when component configuration is uncertain.

Mileage may affect what is plausible in general, but mileage is NOT evidence that a component has failed.

============================================================
CAMERA-ONLY CONFIDENCE CONTRACT
============================================================

Diagnostic confidence means confidence in the HYPOTHESIS.

It is not:

- image quality
- visual clarity
- OCR confidence
- probability of failure
- severity

For this Camera-only stage:

HIGH must be exceptional.

Do NOT use HIGH merely because:

- the image is clear
- the visual observation is obvious
- a warning symbol is recognizable
- a deposit or crack-like feature is clearly visible

A clear observation can still have uncertain mechanical cause.

When mechanism or root cause requires a physical test, scan data, pressure measurement, voltage measurement, or operating correlation:
use LOW or MEDIUM.

The Flutter client independently applies an additional confidence ceiling.

============================================================
DASHBOARD WARNING CONTRACT
============================================================

A validated visual interpretation may support recognition of a warning indicator.

Recognition of the indicator does NOT prove the physical root cause.

Examples:

Oil-pressure indicator recognized:
Do NOT claim actual oil pressure is low unless measured independently.

Charging-system indicator recognized:
Do NOT claim alternator failure, battery failure, belt failure, or wiring failure from the light alone.

Check-engine indicator recognized:
Do NOT infer a specific DTC.

ABS indicator recognized:
Do NOT identify a specific ABS sensor or module without independent evidence.

SRS indicator recognized:
Do NOT identify the failed restraint component.

TPMS indicator recognized:
Do NOT infer a numeric tire pressure.

Brake / PARK indicator:
Do not decide between parking-brake application and brake-system fault unless evidence distinguishes them.

============================================================
LEAK / FLUID CONTRACT
============================================================

A wet-looking or stained area is not automatically an active leak.

Do not determine:

- fluid identity
- leak source
- leak rate
- internal pressure
- failed seal
- failed pump

unless independently established.

A responsible hypothesis may be:

"Possible fluid residue near the connection"

rather than:

"Water pump leak."

============================================================
BATTERY CONTRACT
============================================================

Visible terminal deposits may support:

"Possible terminal corrosion or residue"

They do NOT establish:

- battery voltage
- state of charge
- capacity
- alternator output
- charging-system performance
- battery replacement need

============================================================
BELT / HOSE CONTRACT
============================================================

Visible crack-like lines, fraying, deformation, discoloration, or residue may support an inspection hypothesis.

Do not infer internal structural condition beyond what can be visibly supported.

Engine-running verification must never instruct the user to:

- touch moving parts
- reach into belts or pulleys
- place tools near moving components
- manually rotate components while the engine runs

If close inspection of moving engine components is needed:
prefer engine-off inspection or qualified professional inspection.

============================================================
TIRE CONTRACT
============================================================

Visible cuts, bulges, crack-like lines, foreign objects, or deformation may support inspection hypotheses.

Do not infer numerical:

- tread depth
- pressure
- alignment
- internal belt condition

without independent measurement.

A clearly visible sidewall bulge or severe damage may justify stronger urgency, but safety guidance must still explain the visible evidence supporting that conclusion.

============================================================
SAFETY CONTRACT
============================================================

Safety guidance must be proportional.

Do not produce stop_driving merely because a warning symbol exists.

stop_driving requires evidence supporting a condition where continued operation could reasonably create immediate safety or severe damage risk.

Examples that may justify stronger caution depending on evidence:

- visibly severe tire structural deformation
- clearly serious brake-related evidence combined with relevant context
- severe overheating warning context
- severe oil-pressure warning context

But a dashboard indicator alone still does not confirm root cause.

When uncertainty is material:
state the limitation and recommend verification.

============================================================
VERIFICATION CONTRACT
============================================================

Verification steps must test an existing hypothesis.

Every verification step must reference one or more CAM_HYP IDs that actually exist.

Verification should distinguish:

- user-safe engine-off inspection
- simple non-invasive checks
- measured tests
- qualified professional inspection

Do not ask the user to perform hazardous engine-running contact inspection.

============================================================
OUTPUT ID CONTRACT
============================================================

Hypothesis IDs:

CAM_HYP_001
CAM_HYP_002
CAM_HYP_003

Verification IDs:

CAM_VER_001
CAM_VER_002
CAM_VER_003

Use sequential IDs.

============================================================
CURRENT VALIDATED CAMERA EVIDENCE
============================================================

${JSON.stringify(cameraEvidence, null, 2)}

============================================================
REPORT WRITING CONTRACT
============================================================

Write like a confident senior automotive diagnostician.

Be decisive about evidence that is clearly established.

Do NOT repeatedly hedge statements that are directly supported by validated visual evidence.

GOOD:
"The image shows heavy crusty buildup around the battery connection."

BAD:
"There may possibly appear to be some buildup around the battery connection."

GOOD:
"The visible buildup is consistent with corrosion or oxidation."

BAD:
"The visible buildup could perhaps possibly be related to corrosion."

Use uncertainty ONLY for facts the evidence cannot establish.

For example:

GOOD:
"The image shows substantial terminal-area buildup consistent with corrosion or oxidation. The image cannot determine battery voltage or connection resistance."

This is better than repeatedly saying:
"possible", "maybe", "may", "could", "appears", and "cannot confirm"
throughout every sentence.

Confidence in a visible observation is different from confidence in the hidden mechanical cause.

You may state a clearly visible condition firmly while remaining appropriately limited about root cause.

Example:

DIRECT VISUAL FACT:
"Heavy buildup is present around the battery connection."

SUPPORTED INTERPRETATION:
"The appearance is consistent with corrosion or oxidation."

UNVERIFIED MECHANICAL EFFECT:
"Whether the buildup is causing excessive electrical resistance requires testing."

Do not weaken the first two statements merely because the third requires verification.

============================================================
REPORT LENGTH CONTRACT
============================================================

Keep the final diagnostic result concise.

Prefer:

- one primary hypothesis when one explanation clearly dominates
- no more than two hypotheses unless genuinely necessary
- one short summary paragraph
- short reasoning for each hypothesis
- no more than two important hypothesis limitations
- normally one or two verification steps
- short proportional safety guidance

Do not repeat the same limitation in the summary, hypothesis, verification section, and safety section.

State each important limitation once in the most relevant place.

The summary should normally be 2 to 4 sentences.

Hypothesis reasoning should normally be 2 to 4 sentences.

Verification steps should be practical and concise.

The goal is:
clear, confident, evidence-based, and useful.

Not:
verbose, defensive, repetitive, or uncertain-sounding.

============================================================
DIAGNOSTIC COMMUNICATION STYLE
============================================================

When evidence strongly supports a visual condition, name that condition plainly.

For example, if substantial crusty material is clearly visible at a battery terminal:

Preferred:
"Significant terminal-area corrosion or oxidation buildup is visible."

Acceptable:
"Significant buildup consistent with terminal corrosion or oxidation is visible."

Avoid:
"There may be possible residue that could perhaps represent corrosion."

When the exact material composition is not known, do not let that uncertainty prevent a useful automotive conclusion when the visible pattern is strongly characteristic.

Instead separate the two:

"The visible buildup is consistent with terminal corrosion or oxidation. Its exact chemical composition cannot be determined from the image."

Do not present routine visual uncertainty in a way that makes DriveShift sound unable to recognize common automotive conditions.

============================================================
NORMAL CONDITION DIAGNOSTIC CONTRACT
============================================================

DriveShift must be capable of reaching three different kinds of useful outcomes:

1. ABNORMAL CONDITION SUPPORTED
2. NORMAL / EXPECTED CONDITION SUPPORTED
3. INSUFFICIENT EVIDENCE

Do NOT treat every case that lacks a visible fault as insufficient evidence.

A well-supported normal automotive condition is a legitimate diagnostic conclusion.

Examples include:

- likely normal exhaust condensation
- likely normal A/C evaporator drain water
- light brake-rotor surface oxidation after sitting
- ordinary road dust or surface residue
- normal tire molding marks
- normal factory seam sealer or protective coating

Use these only when the validated evidence and visual interpretation strongly support the pattern.

Do not manufacture a normal explanation merely to avoid insufficient_evidence.

============================================================
NORMAL CONDITION VS INSUFFICIENT EVIDENCE
============================================================

Use a NORMAL / EXPECTED conclusion when:

- the component or system is reasonably identified
- the visible pattern is characteristic of a known normal automotive phenomenon
- the visual interpretation supports that phenomenon
- no validated visual evidence materially conflicts with it

Use INSUFFICIENT EVIDENCE when:

- component identity remains too uncertain
- the visible pattern is ambiguous
- multiple materially different explanations remain unresolved
- the evidence does not support either a responsible abnormal hypothesis or a responsible normal-condition interpretation

Do not confuse uncertainty about exact chemistry or hidden mechanical condition with inability to recognize a common visual pattern.

Example:

If validated evidence shows:

- a recognizable exhaust outlet
- a clear/colorless-looking droplet
- a wet patch directly below the outlet
- a visual interpretation consistent with exhaust condensation
- no validated conflicting evidence such as oily-looking or strongly colored discharge

then it is appropriate to produce:

Title:
"Likely normal exhaust condensation"

Confidence:
MEDIUM

Reasoning:
"The visible clear moisture at the exhaust outlet is consistent with normal condensation produced by the exhaust system."

This does NOT require chemically proving that the droplet is water.

============================================================
NORMAL EXHAUST CONDENSATION DIAGNOSTIC CONTRACT
============================================================

When validated visual evidence supports normal exhaust condensation:

Prefer a concise conclusion such as:

"Likely normal exhaust condensation"

Do not call it:

"Unknown liquid discharge"

unless the visual evidence is genuinely ambiguous.

Do not call it:

"Exhaust leak"

because visible moisture at the tailpipe does not establish an exhaust-gas leak.

Do not infer:

- head-gasket failure
- coolant intrusion
- fuel contamination
- internal engine damage
- catalytic-converter failure

from clear tailpipe moisture alone.

A responsible result may state:

"Clear moisture at the exhaust outlet is most consistent with normal condensation. No immediate repair is indicated from the camera evidence alone."

Verification may include:

- observe whether the moisture decreases after normal warm-up
- seek further inspection if the discharge becomes colored, oily-looking, unusually heavy, persists with other symptoms, or accompanies abnormal smoke / coolant loss

Keep verification concise.

Normally one verification step is enough for a clearly normal-looking condition.

============================================================
NORMAL A/C DRAIN WATER CONTRACT
============================================================

If validated evidence clearly identifies an air-conditioning evaporator drain area and shows clear moisture beneath it, a normal A/C condensation interpretation may be appropriate.

Do not confuse clear A/C drain water with:

- coolant
- engine oil
- transmission fluid
- brake fluid

without independent evidence.

If component identity is uncertain, remain at the visual-pattern level.

============================================================
NORMAL CONDITION CONFIDENCE CONTRACT
============================================================

A normal-condition hypothesis may use MEDIUM confidence when:

- component identity is reasonably established
- the visible pattern is characteristic
- supporting visual evidence is coherent
- there is no meaningful conflicting visual evidence

Do not use HIGH merely because the image is clear.

LOW should be used when the normal explanation is plausible but component identity or pattern matching remains weak.

============================================================
FAULT BIAS PROHIBITION
============================================================

Do not assume the user opened Camera Inspection because something must be wrong.

The user's selected inspection target is context only.

A professional diagnostic system must be willing to say:

"This appears normal."

when the validated evidence supports that conclusion.

Do not invent a repair need to make the result sound more useful.

The correct useful answer may be:

- monitor
- no immediate repair indicated
- normal condition likely
- verify only if associated symptoms exist

============================================================
NEGATIVE VISUAL EVIDENCE CONTRACT
============================================================

Absence of a visible feature is weaker evidence than presence of a visible feature.

Use wording carefully.

GOOD:
"No oily-looking or strongly colored discharge is visible in the supplied image."

BAD:
"The fluid is definitely not oil or coolant."

GOOD:
"No obvious structural damage is visible in the photographed area."

BAD:
"The component is undamaged."

Do not turn "not visible" into "does not exist."

============================================================
COMPONENT RECOGNITION HANDOFF CONTRACT
============================================================

The visual evidence layer may already have responsibly identified a component.

If validated visual observations describe:

"exhaust outlet"

or a validated interpretation clearly references an exhaust outlet,

do not unnecessarily downgrade it back to:

"round pipe"

unless the evidence itself contains uncertainty.

Respect validated component identity from the visual layer.

Do not invent a more specific component identity than the validated evidence supports.

============================================================
NORMAL CONDITION SAFETY CONTRACT
============================================================

For a supported normal condition:

Prefer:

urgency = monitor

when no evidence supports a repair urgency.

Safety guidance should be short.

Example:

Summary:
"No immediate repair is indicated from the visible camera evidence."

Rationale:
"The clear moisture pattern at the exhaust outlet is consistent with normal condensation. Monitor for changes or accompanying symptoms."

Do NOT produce:

service_soon
prompt_inspection
stop_driving

merely because visible moisture exists.

Escalate only when the validated evidence or associated context supports escalation.

============================================================
COMMUNICATION CONTRACT FOR NORMAL RESULTS
============================================================

Do not sound evasive when the evidence supports a normal condition.

BAD:
"The liquid cannot be identified, so no conclusion can be reached."

BETTER:
"The visible clear moisture pattern is most consistent with normal exhaust condensation. The image alone does not chemically identify the liquid."

The first sentence gives the user the useful automotive conclusion.

The second sentence preserves the scientific boundary.

Always lead with the useful conclusion when it is responsibly supported.

============================================================
FINAL RULE
============================================================

If the evidence shows only an appearance but does not support a responsible automotive cause:
return insufficient_evidence rather than inventing a diagnosis.

Observations are evidence.
Interpretations are inference.
Hypotheses are possibilities.
Verification is what separates possibility from confirmation.
`;
}

// ============================================================
// Camera Evidence normalization
// ============================================================

function normalizeCameraEvidence(
  raw
) {
  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return null;
  }

  const capture =
    normalizeCapture(
      raw.capture
    );

  const imageQuality =
    normalizeImageQuality(
      raw.imageQuality
    );

  const ocr =
    normalizeOcr(
      raw.ocr
    );

  const visualEvidence =
    normalizeVisualEvidence(
      raw.visualEvidence
    );

  if (
    !capture ||
    !imageQuality ||
    !ocr ||
    !visualEvidence
  ) {
    return null;
  }

  return {
    capture,
    imageQuality,
    ocr,
    visualEvidence,

    limitations:
      normalizeStringList(
        raw.limitations,
        16,
        600
      ),
  };
}

function normalizeCapture(
  raw
) {
  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return null;
  }

  return {
    inspectionTarget:
      cleanShortText(
        raw.inspectionTarget,
        80
      ),

    format:
      cleanShortText(
        raw.format,
        20
      ),

    fileSizeBytes:
      positiveIntegerOrNull(
        raw.fileSizeBytes
      ),

    widthPixels:
      positiveIntegerOrNull(
        raw.widthPixels
      ),

    heightPixels:
      positiveIntegerOrNull(
        raw.heightPixels
      ),
  };
}

function normalizeImageQuality(
  raw
) {
  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return null;
  }

  const state =
    cleanShortText(
      raw.state,
      40
    );

  if (
    ![
      "unknown",
      "usable",
      "marginal",
      "unusable",
    ].includes(state)
  ) {
    return null;
  }

  const metrics = [];

  if (Array.isArray(raw.metrics)) {
    const usedIds =
      new Set();

    for (const item of raw.metrics) {
      if (
        metrics.length >= 20 ||
        !item ||
        typeof item !== "object"
      ) {
        continue;
      }

      const id =
        cleanEvidenceId(
          item.id
        );

      const numericValue =
        finiteNumberOrNull(
          item.numericValue
        );

      if (
        !id ||
        numericValue === null ||
        usedIds.has(id)
      ) {
        continue;
      }

      usedIds.add(id);

      metrics.push({
        id,

        name:
          cleanShortText(
            item.name,
            120
          ),

        numericValue,

        displayValue:
          cleanShortText(
            item.displayValue,
            120
          ),

        unit:
          cleanShortText(
            item.unit,
            30
          ),

        status:
          item.status === "measured"
            ? "measured"
            : "unverified",

        source:
          cleanShortText(
            item.source,
            100
          ),
      });
    }
  }

  return {
    state,
    metrics,

    limitations:
      normalizeStringList(
        raw.limitations,
        16,
        600
      ),
  };
}

function normalizeOcr(
  raw
) {
  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return null;
  }

  const blocks = [];
  const usedIds =
    new Set();

  if (Array.isArray(raw.blocks)) {
    for (const item of raw.blocks) {
      if (
        blocks.length >= 64 ||
        !item ||
        typeof item !== "object"
      ) {
        continue;
      }

      const id =
        cleanEvidenceId(
          item.id
        );

      const text =
        cleanLongText(
          item.text,
          1000
        );

      if (
        !id ||
        !/^OCR_TEXT_\d{3}$/.test(id) ||
        !text ||
        usedIds.has(id)
      ) {
        continue;
      }

      usedIds.add(id);

      blocks.push({
        id,
        text,
        status: "observed",
        source:
          "google_mlkit_text_recognition_v1",
      });
    }
  }

  return {
    state:
      cleanShortText(
        raw.state,
        50
      ),

    recognizedText:
      cleanLongText(
        raw.recognizedText,
        6000
      ),

    blocks,

    limitations:
      normalizeStringList(
        raw.limitations,
        12,
        500
      ),
  };
}

function normalizeVisualEvidence(
  raw
) {
  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return null;
  }

  const state =
    cleanShortText(
      raw.state,
      60
    );

  const observations = [];
  const observationIds =
    new Set();

  if (Array.isArray(raw.observations)) {
    for (const item of raw.observations) {
      if (
        observations.length >= 24 ||
        !item ||
        typeof item !== "object"
      ) {
        continue;
      }

      const id =
        cleanShortText(
          item.id,
          40
        );

      const description =
        cleanLongText(
          item.description,
          600
        );

      if (
        !/^VIS_OBS_\d{3}$/.test(id) ||
        !description ||
        observationIds.has(id)
      ) {
        continue;
      }

      observationIds.add(id);

      observations.push({
        id,

        kind:
          cleanShortText(
            item.kind,
            80
          ),

        description,

        status:
          "observed",

        source:
          "ai_visual_analysis_v1",

        supportingEvidenceIds:
          normalizeEvidenceReferenceList(
            item.supportingEvidenceIds
          ),

        region:
          normalizeRegion(
            item.region
          ),
      });
    }
  }

  const interpretations = [];
  const interpretationIds =
    new Set();

  if (
    Array.isArray(
      raw.interpretations
    )
  ) {
    for (
      const item of
      raw.interpretations
    ) {
      if (
        interpretations.length >= 12 ||
        !item ||
        typeof item !== "object"
      ) {
        continue;
      }

      const id =
        cleanShortText(
          item.id,
          40
        );

      const description =
        cleanLongText(
          item.description,
          700
        );

      if (
        !/^VIS_INT_\d{3}$/.test(id) ||
        !description ||
        interpretationIds.has(id)
      ) {
        continue;
      }

      const support =
        normalizeEvidenceReferenceList(
          item.supportingObservationIds
        ).filter(
          (observationId) =>
            observationIds.has(
              observationId
            )
        );

      if (support.length === 0) {
        continue;
      }

      interpretationIds.add(id);

      interpretations.push({
        id,
        description,
        status:
          "inferred",
        source:
          "ai_visual_analysis_v1",

        supportingObservationIds:
          support,

        limitations:
          normalizeStringList(
            item.limitations,
            8,
            500
          ),
      });
    }
  }

  return {
    state,
    observations,
    interpretations,

    limitations:
      normalizeStringList(
        raw.limitations,
        12,
        500
      ),
  };
}

// ============================================================
// Vehicle configuration
// ============================================================

function normalizeVehicleProfile(
  raw
) {
  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return {
      year: "",
      make: "",
      model: "",
      trim: "",
      engine: "",
      mileage: "",
    };
  }

  return {
    year:
      cleanShortText(
        raw.year,
        20
      ),

    make:
      cleanShortText(
        raw.make,
        80
      ),

    model:
      cleanShortText(
        raw.model,
        100
      ),

    trim:
      cleanShortText(
        raw.trim,
        100
      ),

    engine:
      cleanShortText(
        raw.engine,
        120
      ),

    mileage:
      cleanShortText(
        raw.mileage,
        40
      ),
  };
}

// ============================================================
// Evidence allow-lists
// ============================================================

function collectAllowedEvidenceIds(
  evidence
) {
  const ids =
    new Set();

  for (
    const metric of
    evidence.imageQuality.metrics
  ) {
    ids.add(metric.id);
  }

  for (
    const block of
    evidence.ocr.blocks
  ) {
    ids.add(block.id);
  }

  for (
    const observation of
    evidence.visualEvidence.observations
  ) {
    ids.add(observation.id);
  }

  for (
    const interpretation of
    evidence.visualEvidence.interpretations
  ) {
    ids.add(interpretation.id);
  }

  return Array.from(ids);
}

function collectDiagnosticEvidenceIds(
  evidence
) {
  const ids =
    new Set();

  /*
   * OCR can be relevant diagnostic evidence,
   * but remains probabilistic.
   */
  for (
    const block of
    evidence.ocr.blocks
  ) {
    ids.add(block.id);
  }

  for (
    const observation of
    evidence.visualEvidence.observations
  ) {
    ids.add(observation.id);
  }

  for (
    const interpretation of
    evidence.visualEvidence.interpretations
  ) {
    ids.add(interpretation.id);
  }

  return Array.from(ids);
}

// ============================================================
// Diagnosis normalization
// ============================================================

function normalizeDiagnosis({
  raw,
  allowedEvidenceIds,
  diagnosticEvidenceIds,
}) {
  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return insufficientDiagnosis(
      "The diagnostic response could not be validated.",
      [
        "No valid structured diagnostic reasoning was available.",
      ]
    );
  }

  const requestedState =
    VALID_DIAGNOSIS_STATES.has(
      String(raw.state || "")
    )
      ? String(raw.state)
      : "insufficient_evidence";

  const summary =
    cleanLongText(
      raw.summary,
      1000
    );

  const limitations =
    normalizeStringList(
      raw.limitations,
      12,
      600
    );

  if (
    requestedState ===
    "insufficient_evidence"
  ) {
    return {
      state:
        "insufficient_evidence",

      summary:
        summary ||
        "The available evidence does not support a responsible diagnostic hypothesis.",

      hypotheses: [],

      verificationSteps: [],

      safetyGuidance: null,

      limitations,
    };
  }

  const hypotheses =
    normalizeHypotheses({
      raw:
        raw.hypotheses,

      allowedEvidenceIds,

      diagnosticEvidenceIds,
    });

  if (hypotheses.length === 0) {
    return insufficientDiagnosis(
      summary ||
        "No diagnostic hypothesis survived evidence validation.",
      [
        ...limitations,
        "Every diagnostic hypothesis must be supported by validated automotive evidence.",
      ]
    );
  }

  const verificationSteps =
    normalizeVerificationSteps({
      raw:
        raw.verificationSteps,

      hypotheses,
    });

  const safetyGuidance =
    normalizeSafetyGuidance(
      raw.safetyGuidance
    );

  return {
    state:
      verificationSteps.length > 0
        ? "verification_required"
        : "analysis_available",

    summary:
      summary ||
      "Validated camera evidence supports one or more hypotheses that remain subject to verification.",

    hypotheses,

    verificationSteps,

    safetyGuidance,

    limitations,
  };
}

function normalizeHypotheses({
  raw,
  allowedEvidenceIds,
  diagnosticEvidenceIds,
}) {
  if (!Array.isArray(raw)) {
    return [];
  }

  const result = [];
  const usedIds =
    new Set();

  for (const item of raw) {
    if (
      result.length >=
      MAX_HYPOTHESES
    ) {
      break;
    }

    if (
      !item ||
      typeof item !== "object"
    ) {
      continue;
    }

    const id =
      cleanShortText(
        item.id,
        40
      );

    if (
      !/^CAM_HYP_\d{3}$/.test(id) ||
      usedIds.has(id)
    ) {
      continue;
    }

    const title =
      cleanShortText(
        item.title,
        180
      );

    const reasoning =
      cleanLongText(
        item.reasoning,
        1200
      );

    if (
      !title ||
      !reasoning
    ) {
      continue;
    }

    const support =
      normalizeEvidenceReferenceList(
        item.supportingEvidenceIds
      ).filter(
        (evidenceId) =>
          allowedEvidenceIds.has(
            evidenceId
          )
      );

    /*
     * Mechanical hypotheses cannot survive on
     * image-quality evidence alone.
     */
    const hasDiagnosticEvidence =
      support.some(
        (evidenceId) =>
          diagnosticEvidenceIds.has(
            evidenceId
          )
      );

    if (
      support.length === 0 ||
      !hasDiagnosticEvidence
    ) {
      continue;
    }

    let confidence =
      VALID_CONFIDENCE.has(
        String(item.confidence || "")
      )
        ? String(item.confidence)
        : "low";

    /*
     * Server-side camera-only ceiling.
     *
     * Flutter independently applies the same defensive ceiling.
     */
    if (confidence === "high") {
      confidence =
        "medium";
    }

    usedIds.add(id);

    result.push({
      id,
      title,
      reasoning,
      confidence,

      supportingEvidenceIds:
        Array.from(
          new Set(support)
        ),

      limitations:
        normalizeStringList(
          item.limitations,
          8,
          600
        ),
    });
  }

  return result;
}

function normalizeVerificationSteps({
  raw,
  hypotheses,
}) {
  if (!Array.isArray(raw)) {
    return [];
  }

  const hypothesisIds =
    new Set(
      hypotheses.map(
        (item) => item.id
      )
    );

  const result = [];
  const usedIds =
    new Set();

  for (const item of raw) {
    if (
      result.length >=
      MAX_VERIFICATION_STEPS
    ) {
      break;
    }

    if (
      !item ||
      typeof item !== "object"
    ) {
      continue;
    }

    const id =
      cleanShortText(
        item.id,
        40
      );

    if (
      !/^CAM_VER_\d{3}$/.test(id) ||
      usedIds.has(id)
    ) {
      continue;
    }

    const description =
      cleanLongText(
        item.description,
        800
      );

    if (!description) {
      continue;
    }

    const relatedHypothesisIds =
      normalizeEvidenceReferenceList(
        item.relatedHypothesisIds
      ).filter(
        (hypothesisId) =>
          hypothesisIds.has(
            hypothesisId
          )
      );

    if (
      relatedHypothesisIds.length ===
      0
    ) {
      continue;
    }

    usedIds.add(id);

    result.push({
      id,
      description,

      relatedHypothesisIds:
        Array.from(
          new Set(
            relatedHypothesisIds
          )
        ),

      requiresEngineOff:
        item.requiresEngineOff ===
        true,

      professionalInspectionRecommended:
        item.professionalInspectionRecommended ===
        true,
    });
  }

  return result;
}

function normalizeSafetyGuidance(
  raw
) {
  if (
    !raw ||
    typeof raw !== "object" ||
    raw.present !== true
  ) {
    return null;
  }

  const urgency =
    VALID_URGENCY.has(
      String(raw.urgency || "")
    )
      ? String(raw.urgency)
      : "monitor";

  const summary =
    cleanLongText(
      raw.summary,
      600
    );

  const rationale =
    cleanLongText(
      raw.rationale,
      800
    );

  if (
    !summary ||
    !rationale
  ) {
    return null;
  }

  return {
    urgency,
    summary,
    rationale,
  };
}

function insufficientDiagnosis(
  summary,
  limitations
) {
  return {
    state:
      "insufficient_evidence",

    summary,

    hypotheses: [],

    verificationSteps: [],

    safetyGuidance: null,

    limitations,
  };
}

// ============================================================
// Shared normalization helpers
// ============================================================

function normalizeRegion(
  raw
) {
  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return null;
  }

  const left =
    finiteNumberOrNull(
      raw.left
    );

  const top =
    finiteNumberOrNull(
      raw.top
    );

  const right =
    finiteNumberOrNull(
      raw.right
    );

  const bottom =
    finiteNumberOrNull(
      raw.bottom
    );

  if (
    left === null ||
    top === null ||
    right === null ||
    bottom === null
  ) {
    return null;
  }

  if (
    left < 0 ||
    left > 1 ||
    top < 0 ||
    top > 1 ||
    right < 0 ||
    right > 1 ||
    bottom < 0 ||
    bottom > 1 ||
    right <= left ||
    bottom <= top
  ) {
    return null;
  }

  return {
    left,
    top,
    right,
    bottom,
  };
}

function normalizeEvidenceReferenceList(
  raw
) {
  if (!Array.isArray(raw)) {
    return [];
  }

  const result = [];
  const seen =
    new Set();

  for (const value of raw) {
    if (result.length >= 32) {
      break;
    }

    const id =
      cleanEvidenceId(
        value
      );

    if (!id) {
      continue;
    }

    if (seen.add(id)) {
      result.push(id);
    }
  }

  return result;
}

function cleanEvidenceId(
  value
) {
  const cleaned =
    cleanShortText(
      value,
      80
    );

  if (
    !cleaned ||
    !/^[A-Z0-9_]+$/.test(
      cleaned
    )
  ) {
    return "";
  }

  return cleaned;
}

function normalizeStringList(
  raw,
  maxItems,
  maxLength
) {
  if (!Array.isArray(raw)) {
    return [];
  }

  const result = [];
  const seen =
    new Set();

  for (const value of raw) {
    if (
      result.length >=
      maxItems
    ) {
      break;
    }

    const cleaned =
      cleanLongText(
        value,
        maxLength
      );

    if (!cleaned) {
      continue;
    }

    if (seen.add(cleaned)) {
      result.push(cleaned);
    }
  }

  return result;
}

function cleanShortText(
  value,
  maxLength
) {
  return cleanLongText(
    value,
    maxLength
  ).replace(
    /\s+/g,
    " "
  );
}

function cleanLongText(
  value,
  maxLength
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  const cleaned =
    String(value)
      .replace(
        /\r\n/g,
        "\n"
      )
      .replace(
        /\r/g,
        "\n"
      )
      .replace(
        /[ \t]+/g,
        " "
      )
      .replace(
        /\n{3,}/g,
        "\n\n"
      )
      .trim();

  if (!cleaned) {
    return "";
  }

  if (
    cleaned.length <=
    maxLength
  ) {
    return cleaned;
  }

  return cleaned.slice(
    0,
    maxLength
  );
}

function finiteNumberOrNull(
  value
) {
  const number =
    typeof value === "number"
      ? value
      : Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return null;
  }

  return number;
}

function positiveIntegerOrNull(
  value
) {
  const number =
    Number(value);

  if (
    !Number.isInteger(number) ||
    number <= 0
  ) {
    return null;
  }

  return number;
}

// ============================================================
// OpenAI response extraction
// ============================================================

function extractResponseText(
  data
) {
  try {
    if (
      typeof data?.output_text ===
      "string"
    ) {
      return data.output_text.trim();
    }

    if (
      !Array.isArray(
        data?.output
      )
    ) {
      return "";
    }

    const parts = [];

    for (
      const outputItem of
      data.output
    ) {
      if (
        !Array.isArray(
          outputItem?.content
        )
      ) {
        continue;
      }

      for (
        const contentItem of
        outputItem.content
      ) {
        if (
          contentItem?.type ===
            "output_text" &&
          typeof contentItem.text ===
            "string"
        ) {
          parts.push(
            contentItem.text
          );
        }
      }
    }

    return parts
      .join("\n")
      .trim();
  } catch (_) {
    return "";
  }
}

// ============================================================
// Error helpers
// ============================================================

function sendError(
  res,
  status,
  code,
  message
) {
  return res.status(status).json({
    ok: false,

    error: {
      code,
      message,
    },
  });
}

async function safeReadText(
  response
) {
  try {
    return await response.text();
  } catch (_) {
    return "";
  }
}

function safeErrorMessage(
  error
) {
  try {
    return String(
      error?.message ||
      error ||
      "Unknown error"
    ).slice(
      0,
      1000
    );
  } catch (_) {
    return "Unknown error";
  }
}
