/* ============================================================
   DRIVESHIFT — DETERMINISTIC CONFIDENCE ENGINE v1.0
   ============================================================

   Purpose:
   - Convert diagnostic evidence quality into a deterministic
     confidence classification.
   - Prevent model-generated confidence from overriding evidence.
   - Preserve uncertainty when evidence is observational only.
   - Reward independent converging evidence.
   - Penalize contradictions and weak traceability.
   - Never convert diagnostic confidence into component certainty.

   Output contract:

   {
     level: "HIGH" | "MODERATE" | "LOW",
     score: number,
     evidenceScore: number,
     contradictionPenalty: number,
     verificationScore: number,
     traceabilityScore: number,
     reasons: string[],
     constraints: string[]
   }

   Important:
   Confidence describes the strength of the current diagnostic
   DIRECTION.

   It does NOT mean:
   - the component is confirmed failed,
   - the repair is authorized,
   - probability has been mathematically calculated.
   ============================================================ */

const CONFIDENCE_LEVELS = Object.freeze({
  HIGH: "HIGH",
  MODERATE: "MODERATE",
  LOW: "LOW",
});

const EVIDENCE_STRENGTH_POINTS = Object.freeze({
  HIGH: 9,
  MODERATE: 5,
  LOW: 2,
});

const EVIDENCE_STATUS_POINTS = Object.freeze({
  CONFIRMED: 7,
  OBSERVED: 4,
  INFERRED: 1,
});

const SOURCE_RELIABILITY_POINTS = Object.freeze({
  live_data: 7,
  obd: 6,
  follow_up: 5,
  user_observation: 4,
  vehicle_profile: 2,
  system_context: 1,
});

const MAX_CONFIDENCE_SCORE = 100;

/* ============================================================
   PUBLIC API
   ============================================================ */

export function buildDiagnosticConfidence({
  evidence = [],
  hypotheses = [],
  primaryHypothesisId = "",
  verificationPath = [],
  diagnosticContext = {},
} = {}) {
  const normalizedEvidence =
    normalizeEvidence(
      evidence
    );

  const normalizedHypotheses =
    normalizeHypotheses(
      hypotheses
    );

  const primaryHypothesis =
    resolvePrimaryHypothesis({
      hypotheses:
        normalizedHypotheses,

      primaryHypothesisId,
    });

  const evidenceResult =
    scoreEvidence(
      normalizedEvidence
    );

  const traceabilityResult =
    scoreTraceability({
      evidence:
        normalizedEvidence,

      hypothesis:
        primaryHypothesis,
    });

  const contradictionResult =
    scoreContradictions({
      evidence:
        normalizedEvidence,

      hypothesis:
        primaryHypothesis,

      diagnosticContext,
    });

  const verificationResult =
    scoreVerification({
      hypothesis:
        primaryHypothesis,

      verificationPath,
    });

  const convergenceResult =
    scoreEvidenceConvergence({
      evidence:
        normalizedEvidence,

      hypothesis:
        primaryHypothesis,
    });

  const uncertaintyPenalty =
    calculateUncertaintyPenalty({
      evidence:
        normalizedEvidence,

      hypothesis:
        primaryHypothesis,
    });

  let score =
    evidenceResult.score +
    traceabilityResult.score +
    verificationResult.score +
    convergenceResult.score -
    contradictionResult.penalty -
    uncertaintyPenalty;

  score =
    clamp(
      Math.round(
        score
      ),
      0,
      MAX_CONFIDENCE_SCORE
    );

  const level =
    determineConfidenceLevel({
      score,
      evidence:
        normalizedEvidence,

      hypothesis:
        primaryHypothesis,

      contradictionPenalty:
        contradictionResult.penalty,

      traceabilityScore:
        traceabilityResult.score,
    });

  return {
    level,

    score,

    evidenceScore:
      evidenceResult.score,

    contradictionPenalty:
      contradictionResult.penalty,

    verificationScore:
      verificationResult.score,

    traceabilityScore:
      traceabilityResult.score,

    convergenceScore:
      convergenceResult.score,

    uncertaintyPenalty,

    reasons: [
      ...evidenceResult.reasons,
      ...traceabilityResult.reasons,
      ...convergenceResult.reasons,
      ...verificationResult.reasons,
      ...contradictionResult.reasons,
    ],

    constraints:
      buildConfidenceConstraints({
        level,
        evidence:
          normalizedEvidence,

        hypothesis:
          primaryHypothesis,

        contradictionPenalty:
          contradictionResult.penalty,
      }),
  };
}

/* ============================================================
   EVIDENCE SCORING
   ============================================================ */

function scoreEvidence(
  evidence
) {
  if (
    !evidence.length
  ) {
    return {
      score:
        0,

      reasons: [
        "No structured diagnostic evidence is available.",
      ],
    };
  }

  let score =
    0;

  const reasons =
    [];

  let confirmedCount =
    0;

  let observedCount =
    0;

  let inferredCount =
    0;

  const independentSources =
    new Set();

  for (
    const item of evidence
  ) {
    const strengthPoints =
      EVIDENCE_STRENGTH_POINTS[
        item.strength
      ] || 0;

    const statusPoints =
      EVIDENCE_STATUS_POINTS[
        item.status
      ] || 0;

    const sourcePoints =
      SOURCE_RELIABILITY_POINTS[
        item.source
      ] || 0;

    /*
     * Evidence score is intentionally conservative.
     *
     * We do not fully add all dimensions because that would
     * over-reward one single evidence item.
     */
    const itemScore =
      strengthPoints +
      Math.round(
        statusPoints * 0.7
      ) +
      Math.round(
        sourcePoints * 0.5
      );

    score +=
      itemScore;

    if (
      item.status ===
      "CONFIRMED"
    ) {
      confirmedCount++;
    } else if (
      item.status ===
      "OBSERVED"
    ) {
      observedCount++;
    } else if (
      item.status ===
      "INFERRED"
    ) {
      inferredCount++;
    }

    if (
      item.source
    ) {
      independentSources.add(
        item.source
      );
    }
  }

  /*
   * Cap raw evidence contribution.
   *
   * Otherwise four mediocre evidence items could falsely create
   * very high confidence.
   */
  score =
    Math.min(
      score,
      42
    );

  if (
    confirmedCount > 0
  ) {
    reasons.push(
      `${confirmedCount} confirmed evidence item${confirmedCount === 1 ? "" : "s"} strengthens the current diagnostic direction.`
    );
  }

  if (
    observedCount > 0
  ) {
    reasons.push(
      `${observedCount} directly observed evidence item${observedCount === 1 ? "" : "s"} support the current direction.`
    );
  }

  if (
    inferredCount >
    observedCount +
      confirmedCount
  ) {
    reasons.push(
      "The evidence set contains more inferred context than direct observation, which limits confidence."
    );
  }

  if (
    independentSources.size >=
    2
  ) {
    reasons.push(
      "Evidence is supported by more than one source category."
    );
  }

  return {
    score,
    reasons,
  };
}

/* ============================================================
   TRACEABILITY
   ============================================================ */

function scoreTraceability({
  evidence,
  hypothesis,
}) {
  if (
    !hypothesis
  ) {
    return {
      score:
        0,

      reasons: [
        "No primary hypothesis is available for evidence traceability.",
      ],
    };
  }

  const validEvidenceIds =
    new Set(
      evidence.map(
        (item) =>
          item.id
      )
    );

  const supporting =
    hypothesis
      .supportingEvidenceIds
      .filter(
        (id) =>
          validEvidenceIds.has(
            id
          )
      );

  const contradicting =
    hypothesis
      .contradictingEvidenceIds
      .filter(
        (id) =>
          validEvidenceIds.has(
            id
          )
      );

  let score =
    0;

  const reasons =
    [];

  if (
    supporting.length ===
    0
  ) {
    reasons.push(
      "The leading hypothesis has no valid supporting evidence references."
    );

    return {
      score:
        0,

      reasons,
    };
  }

  score +=
    Math.min(
      supporting.length * 5,
      15
    );

  if (
    supporting.length >=
    2
  ) {
    score +=
      3;

    reasons.push(
      "The leading hypothesis is linked to multiple supporting evidence items."
    );
  }

  if (
    contradicting.length ===
    0
  ) {
    score +=
      2;
  }

  return {
    score:
      Math.min(
        score,
        18
      ),

    reasons,
  };
}

/* ============================================================
   CONTRADICTIONS
   ============================================================ */

function scoreContradictions({
  evidence,
  hypothesis,
  diagnosticContext,
}) {
  let penalty =
    0;

  const reasons =
    [];

  if (
    !hypothesis
  ) {
    return {
      penalty:
        10,

      reasons: [
        "No primary hypothesis exists, so confidence must remain limited.",
      ],
    };
  }

  const evidenceById =
    new Map(
      evidence.map(
        (item) => [
          item.id,
          item,
        ]
      )
    );

  for (
    const id of
      hypothesis
        .contradictingEvidenceIds
  ) {
    const item =
      evidenceById.get(
        id
      );

    if (!item) {
      continue;
    }

    if (
      item.strength ===
      "HIGH"
    ) {
      penalty +=
        12;
    } else if (
      item.strength ===
      "MODERATE"
    ) {
      penalty +=
        7;
    } else {
      penalty +=
        3;
    }
  }

  const negativeSignals =
    diagnosticContext
      ?.negated_signals ||
    {};

  const negativeCount =
    Object.keys(
      negativeSignals
    ).filter(
      (key) =>
        Boolean(
          negativeSignals[
            key
          ]
        )
    ).length;

  /*
   * We do not automatically punish negative evidence merely for
   * existing.
   *
   * Negative observations are often useful discriminators.
   *
   * A small penalty is used only when the report already contains
   * explicit contradiction references.
   */
  if (
    negativeCount > 0 &&
    hypothesis
      .contradictingEvidenceIds
      .length >
      0
  ) {
    penalty +=
      Math.min(
        negativeCount,
        3
      );
  }

  if (
    penalty > 0
  ) {
    reasons.push(
      "Contradicting evidence reduces confidence in the leading diagnostic direction."
    );
  }

  return {
    penalty:
      Math.min(
        penalty,
        28
      ),

    reasons,
  };
}

/* ============================================================
   VERIFICATION QUALITY
   ============================================================ */

function scoreVerification({
  hypothesis,
  verificationPath,
}) {
  let score =
    0;

  const reasons =
    [];

  if (
    hypothesis &&
    hypothesis.confirmationTest
  ) {
    score +=
      5;

    reasons.push(
      "The leading hypothesis includes a defined confirmation test."
    );
  }

  const steps =
    Array.isArray(
      verificationPath
    )
      ? verificationPath
      : [];

  const meaningfulSteps =
    steps.filter(
      (item) =>
        String(
          item?.action ||
          ""
        ).trim() &&
        String(
          item?.purpose ||
          ""
        ).trim()
    );

  if (
    meaningfulSteps.length >=
    1
  ) {
    score +=
      3;
  }

  if (
    meaningfulSteps.length >=
    2
  ) {
    score +=
      2;
  }

  if (
    meaningfulSteps.length >=
    3
  ) {
    score +=
      1;
  }

  return {
    score:
      Math.min(
        score,
        11
      ),

    reasons,
  };
}

/* ============================================================
   EVIDENCE CONVERGENCE
   ============================================================ */

function scoreEvidenceConvergence({
  evidence,
  hypothesis,
}) {
  if (
    !hypothesis
  ) {
    return {
      score:
        0,

      reasons:
        [],
    };
  }

  const supportingIds =
    new Set(
      hypothesis
        .supportingEvidenceIds
    );

  const supporting =
    evidence.filter(
      (item) =>
        supportingIds.has(
          item.id
        )
    );

  if (
    supporting.length <
    2
  ) {
    return {
      score:
        0,

      reasons:
        [],
    };
  }

  const sources =
    new Set(
      supporting.map(
        (item) =>
          item.source
      )
    );

  const highStrengthCount =
    supporting.filter(
      (item) =>
        item.strength ===
        "HIGH"
    ).length;

  const directCount =
    supporting.filter(
      (item) =>
        item.status ===
          "OBSERVED" ||
        item.status ===
          "CONFIRMED"
    ).length;

  let score =
    0;

  const reasons =
    [];

  if (
    supporting.length >=
    2
  ) {
    score +=
      4;
  }

  if (
    sources.size >=
    2
  ) {
    score +=
      4;

    reasons.push(
      "Independent evidence sources converge on the leading diagnostic direction."
    );
  }

  if (
    highStrengthCount >=
    2
  ) {
    score +=
      4;

    reasons.push(
      "Multiple high-strength evidence items support the same direction."
    );
  }

  if (
    directCount ===
    supporting.length
  ) {
    score +=
      2;
  }

  return {
    score:
      Math.min(
        score,
        14
      ),

    reasons,
  };
}

/* ============================================================
   UNCERTAINTY PENALTY
   ============================================================ */

function calculateUncertaintyPenalty({
  evidence,
  hypothesis,
}) {
  let penalty =
    0;

  if (
    !hypothesis
  ) {
    return 15;
  }

  const supporting =
    new Set(
      hypothesis
        .supportingEvidenceIds
    );

  const relevantEvidence =
    evidence.filter(
      (item) =>
        supporting.has(
          item.id
        )
    );

  if (
    relevantEvidence.length ===
    1
  ) {
    penalty +=
      7;
  }

  const inferredOnly =
    relevantEvidence.length >
      0 &&
    relevantEvidence.every(
      (item) =>
        item.status ===
        "INFERRED"
    );

  if (
    inferredOnly
  ) {
    penalty +=
      14;
  }

  const lowStrengthOnly =
    relevantEvidence.length >
      0 &&
    relevantEvidence.every(
      (item) =>
        item.strength ===
        "LOW"
    );

  if (
    lowStrengthOnly
  ) {
    penalty +=
      10;
  }

  if (
    !hypothesis
      .confirmationTest
  ) {
    penalty +=
      5;
  }

  return Math.min(
    penalty,
    24
  );
}

/* ============================================================
   FINAL LEVEL
   ============================================================ */

function determineConfidenceLevel({
  score,
  evidence,
  hypothesis,
  contradictionPenalty,
  traceabilityScore,
}) {
  if (
    !hypothesis ||
    !evidence.length
  ) {
    return CONFIDENCE_LEVELS.LOW;
  }

  const supportingIds =
    new Set(
      hypothesis
        .supportingEvidenceIds
    );

  const supporting =
    evidence.filter(
      (item) =>
        supportingIds.has(
          item.id
        )
    );

  const directSupporting =
    supporting.filter(
      (item) =>
        item.status ===
          "OBSERVED" ||
        item.status ===
          "CONFIRMED"
    );

  const highStrengthSupporting =
    supporting.filter(
      (item) =>
        item.strength ===
        "HIGH"
    );

  /*
   * HIGH requires more than a numerical threshold.
   *
   * This prevents score accumulation from converting weak,
   * inferred evidence into false certainty.
   */
  const qualifiesForHigh =
    score >=
      68 &&
    supporting.length >=
      2 &&
    directSupporting.length >=
      2 &&
    highStrengthSupporting.length >=
      1 &&
    contradictionPenalty <=
      7 &&
    traceabilityScore >=
      10;

  if (
    qualifiesForHigh
  ) {
    return CONFIDENCE_LEVELS.HIGH;
  }

  const qualifiesForModerate =
    score >=
      40 &&
    supporting.length >=
      1 &&
    directSupporting.length >=
      1 &&
    contradictionPenalty <=
      18;

  if (
    qualifiesForModerate
  ) {
    return CONFIDENCE_LEVELS.MODERATE;
  }

  return CONFIDENCE_LEVELS.LOW;
}

/* ============================================================
   CONSTRAINTS
   ============================================================ */

function buildConfidenceConstraints({
  level,
  evidence,
  hypothesis,
  contradictionPenalty,
}) {
  const constraints =
    [];

  if (
    level ===
    CONFIDENCE_LEVELS.HIGH
  ) {
    constraints.push(
      "HIGH confidence applies to the diagnostic direction only; component failure still requires direct verification unless already confirmed."
    );
  }

  if (
    level ===
    CONFIDENCE_LEVELS.MODERATE
  ) {
    constraints.push(
      "The leading diagnostic direction is supported, but verification is required before repair authorization."
    );
  }

  if (
    level ===
    CONFIDENCE_LEVELS.LOW
  ) {
    constraints.push(
      "Current evidence is insufficient for a strong diagnostic lock; do not authorize component replacement from confidence alone."
    );
  }

  if (
    contradictionPenalty >
    0
  ) {
    constraints.push(
      "Contradicting evidence must remain visible in hypothesis ranking and must not be silently discarded."
    );
  }

  const confirmedEvidence =
    evidence.filter(
      (item) =>
        item.status ===
        "CONFIRMED"
    );

  if (
    confirmedEvidence.length ===
    0
  ) {
    constraints.push(
      "No direct confirmed evidence is present; the report must preserve suspicion-versus-confirmation language."
    );
  }

  if (
    hypothesis &&
    hypothesis
      .supportingEvidenceIds
      .length ===
      1
  ) {
    constraints.push(
      "The leading hypothesis depends on a single supporting evidence item and should not be presented as definitive."
    );
  }

  return constraints;
}

/* ============================================================
   NORMALIZATION
   ============================================================ */

function normalizeEvidence(
  evidence
) {
  if (
    !Array.isArray(
      evidence
    )
  ) {
    return [];
  }

  return evidence
    .map(
      (
        item,
        index
      ) => ({
        id:
          String(
            item?.id ||
            `E${String(
              index + 1
            ).padStart(
              2,
              "0"
            )}`
          ).trim(),

        source:
          normalizeEnum(
            item?.source,
            Object.keys(
              SOURCE_RELIABILITY_POINTS
            ),
            "system_context"
          ),

        status:
          normalizeEnum(
            item?.status,
            Object.keys(
              EVIDENCE_STATUS_POINTS
            ),
            "INFERRED"
          ),

        observation:
          String(
            item?.observation ||
            ""
          ).trim(),

        diagnosticMeaning:
          String(
            item?.diagnosticMeaning ||
            ""
          ).trim(),

        strength:
          normalizeEnum(
            item?.strength,
            Object.keys(
              EVIDENCE_STRENGTH_POINTS
            ),
            "LOW"
          ),
      })
    )
    .filter(
      (item) =>
        item.id &&
        item.observation
    )
    .slice(
      0,
      8
    );
}

function normalizeHypotheses(
  hypotheses
) {
  if (
    !Array.isArray(
      hypotheses
    )
  ) {
    return [];
  }

  return hypotheses
    .map(
      (
        item,
        index
      ) => ({
        id:
          String(
            item?.id ||
            `H${String(
              index + 1
            ).padStart(
              2,
              "0"
            )}`
          ).trim(),

        title:
          String(
            item?.title ||
            ""
          ).trim(),

        likelihood:
          normalizeEnum(
            item?.likelihood,
            [
              "HIGH",
              "MODERATE",
              "LOW",
            ],
            "LOW"
          ),

        supportingEvidenceIds:
          normalizeStringList(
            item
              ?.supportingEvidenceIds
          ),

        contradictingEvidenceIds:
          normalizeStringList(
            item
              ?.contradictingEvidenceIds
          ),

        whyItFits:
          String(
            item?.whyItFits ||
            ""
          ).trim(),

        confirmationTest:
          String(
            item?.confirmationTest ||
            ""
          ).trim(),
      })
    )
    .filter(
      (item) =>
        item.id &&
        item.title
    )
    .slice(
      0,
      5
    );
}

function resolvePrimaryHypothesis({
  hypotheses,
  primaryHypothesisId,
}) {
  if (
    !hypotheses.length
  ) {
    return null;
  }

  const requestedId =
    String(
      primaryHypothesisId ||
      ""
    ).trim();

  if (
    requestedId
  ) {
    const match =
      hypotheses.find(
        (item) =>
          item.id ===
          requestedId
      );

    if (
      match
    ) {
      return match;
    }
  }

  /*
   * The structured report contract ranks strongest first.
   */
  return hypotheses[0];
}

function normalizeStringList(
  value
) {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  return [
    ...new Set(
      value
        .map(
          (item) =>
            String(
              item ||
              ""
            ).trim()
        )
        .filter(
          Boolean
        )
    ),
  ];
}

function normalizeEnum(
  value,
  allowed,
  fallback
) {
  const normalized =
    String(
      value ||
      ""
    )
      .trim();

  const exact =
    allowed.find(
      (candidate) =>
        candidate.toLowerCase() ===
        normalized.toLowerCase()
    );

  return exact ||
    fallback;
}

/* ============================================================
   SMALL HELPERS
   ============================================================ */

function clamp(
  value,
  min,
  max
) {
  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}
