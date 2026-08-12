import { extractSignals } from "./signal-extractor.js";
import { buildDominantLock } from "./dominant-lock-engine.js";
import { buildBehaviorReasoning } from "./behavior-reasoning-engine.js";
import { buildMechanicalPrioritization } from "./mechanical-prioritization-engine.js";

/* ============================================================
   DRIVESHIFT — DIAGNOSTIC CORE
   ============================================================

   Core rules:
   - User-authored evidence is mechanically authoritative input.
   - DriveShift-generated questions are context, not evidence.
   - Short YES / NO answers are translated conservatively into
     semantic evidence only when the question clearly identifies
     a known signal.
   - Negative observations remain explicit negative evidence.
   - No fixed question count determines readiness.
   - Routing heuristics never confirm a failed component.
   ============================================================ */

const CONTEXT_VERSION = "2.1";
const MAX_NORMAL_FOLLOW_UPS = 5;

/* ============================================================
   CANONICAL SIGNAL PHRASES FOR SHORT YES / NO ANSWERS
   ============================================================ */

const SIGNAL_EVIDENCE_PHRASES = Object.freeze({
  smoke: {
    positive: "smoke",
    negative: "no smoke",
  },

  black_smoke: {
    positive: "black smoke",
    negative: "no black smoke",
  },

  white_smoke: {
    positive: "white smoke",
    negative: "no white smoke",
  },

  blue_smoke: {
    positive: "blue smoke",
    negative: "no blue smoke",
  },

  severe_smoke: {
    positive: "heavy smoke",
    negative: "no heavy smoke",
  },

  fuel_smell: {
    positive: "fuel smell",
    negative: "no fuel smell",
  },

  overheating: {
    positive: "overheating",
    negative: "no overheating",
  },

  coolant_loss: {
    positive: "coolant loss",
    negative: "no coolant loss",
  },

  heat_related: {
    positive: "heat related",
    negative: "not heat related",
  },

  cold_related: {
    positive: "only when cold",
    negative: "not only when cold",
  },

  vibration: {
    positive: "vibration",
    negative: "no vibration",
  },

  rough_idle: {
    positive: "rough idle",
    negative: "no rough idle",
  },

  acceleration_issue: {
    positive: "loss of power",
    negative: "no loss of power",
  },

  load_sensitive: {
    positive: "worse under load",
    negative: "not worse under load",
  },

  speed_sensitive: {
    positive: "worse with speed",
    negative: "not worse with speed",
  },

  braking_issue: {
    positive: "brake vibration",
    negative: "no brake vibration",
  },

  critical_braking_issue: {
    positive: "braking control lost",
    negative: "braking control not lost",
  },

  startup_issue: {
    positive: "starting issue",
    negative: "starts normally",
  },

  no_crank: {
    positive: "no crank",
    negative: "cranks normally",
  },

  slow_crank: {
    positive: "slow crank",
    negative: "cranks at normal speed",
  },

  intermittent: {
    positive: "intermittent",
    negative: "not intermittent",
  },

  improves_with_speed: {
    positive: "improves when driving",
    negative: "does not improve when driving",
  },

  idle_or_stopped_related: {
    positive: "at idle",
    negative: "not at idle",
  },
});

/* ============================================================
   ANSWER COUNT
   ============================================================ */

export function countUserAnswers(answers) {
  if (!Array.isArray(answers)) {
    return 0;
  }

  return answers.filter((item) => {
    const answer = String(item?.answer || "").trim();
    const question = String(item?.question || "").trim();

    if (!answer) {
      return false;
    }

    if (isLegacyMetadataQuestion(question)) {
      return false;
    }

    return true;
  }).length;
}

/* ============================================================
   USER EVIDENCE TEXT
   ============================================================ */

/*
 * This is the ONLY text that should be used for:
 * - signal extraction
 * - raw mechanical phrase detection
 * - system routing
 * - OBD/live-data extraction in diagnose.js
 *
 * DriveShift questions are never inserted directly.
 */
export function buildUserEvidenceText(
  issue,
  answers = []
) {
  return buildEvidenceEntries(
    issue,
    answers
  )
    .flatMap((entry) => entry.semantic_text)
    .filter(Boolean)
    .join("\n")
    .trim();
}

/* ============================================================
   INTERVIEW CONTEXT
   ============================================================ */

/*
 * Question + answer history remains useful to the reasoning model,
 * but it must stay separate from mechanical evidence extraction.
 */
export function buildInterviewContextText(
  issue,
  answers = []
) {
  const parts = [];

  const complaint = String(issue || "").trim();

  if (complaint) {
    parts.push(
      `Initial complaint: ${complaint}`
    );
  }

  if (!Array.isArray(answers)) {
    return parts.join("\n");
  }

  for (const item of answers) {
    const question = String(
      item?.question || ""
    ).trim();

    const answer = String(
      item?.answer || ""
    ).trim();

    if (!answer) {
      continue;
    }

    if (isLegacyMetadataQuestion(question)) {
      continue;
    }

    if (question) {
      parts.push(
        `Question: ${question}`
      );
    }

    parts.push(
      `Answer: ${answer}`
    );
  }

  return parts
    .filter(Boolean)
    .join("\n")
    .trim();
}

/* ============================================================
   EVIDENCE ENTRIES
   ============================================================ */

function buildEvidenceEntries(
  issue,
  answers = []
) {
  const entries = [];

  const complaint = String(issue || "").trim();

  if (complaint) {
    entries.push({
      source: "initial_complaint",
      question: "",
      answer: complaint,
      semantic_text: [
        complaint,
      ],
      interpretation:
        "direct_user_observation",
    });
  }

  if (!Array.isArray(answers)) {
    return entries;
  }

  for (const item of answers) {
    const question = String(
      item?.question || ""
    ).trim();

    const answer = String(
      item?.answer || ""
    ).trim();

    if (!answer) {
      continue;
    }

    if (isLegacyMetadataQuestion(question)) {
      continue;
    }

    const binary =
      classifyBinaryAnswer(
        answer
      );

    if (
      binary &&
      question
    ) {
      const semanticEvidence =
        buildBinaryAnswerEvidence(
          question,
          binary
        );

      if (
        semanticEvidence.length >
        0
      ) {
        entries.push({
          source: "follow_up",
          question,
          answer,
          semantic_text:
            semanticEvidence,
          interpretation:
            binary === "yes"
              ? "affirmed_question_signal"
              : "denied_question_signal",
        });

        continue;
      }
    }

    /*
     * Non-binary answers are user-authored evidence directly.
     *
     * Example:
     * "Only at idle."
     * "It shakes above 60 mph."
     * "P0302."
     */
    entries.push({
      source: "follow_up",
      question,
      answer,
      semantic_text: [
        answer,
      ],
      interpretation:
        "direct_follow_up_observation",
    });
  }

  return entries;
}

/* ============================================================
   SHORT YES / NO SEMANTIC TRANSLATION
   ============================================================ */

function classifyBinaryAnswer(
  value
) {
  const clean =
    normalizeShortAnswer(
      value
    );

  const yesAnswers =
    new Set([
      "yes",
      "yeah",
      "yep",
      "yup",
      "correct",
      "true",
      "it does",
      "yes it does",
      "yes it is",
      "yes it has",
      "sí",
      "si",
      "correcto",
    ]);

  const noAnswers =
    new Set([
      "no",
      "nope",
      "false",
      "not at all",
      "it does not",
      "it doesn't",
      "no it does not",
      "no it doesn't",
      "no it is not",
      "no it isn't",
      "no it has not",
      "no it hasn't",
      "nunca",
    ]);

  if (
    yesAnswers.has(
      clean
    )
  ) {
    return "yes";
  }

  if (
    noAnswers.has(
      clean
    )
  ) {
    return "no";
  }

  return null;
}

function normalizeShortAnswer(
  value
) {
  return String(value || "")
    .toLowerCase()
    .replace(/[.,!?¿¡]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildBinaryAnswerEvidence(
  question,
  binary
) {
  const questionSignals =
    extractSignals(
      question
    ).signals || {};

  let keys =
    Object.entries(
      questionSignals
    )
      .filter(
        ([, active]) =>
          active === true
      )
      .map(
        ([key]) =>
          key
      );

  /*
   * Prevent broad smoke from duplicating a specific smoke color.
   */
  if (
    keys.some((key) =>
      [
        "black_smoke",
        "white_smoke",
        "blue_smoke",
      ].includes(key)
    )
  ) {
    keys =
      keys.filter(
        (key) =>
          key !== "smoke"
      );
  }

  /*
   * Critical brake signal already contains the stronger meaning.
   */
  if (
    keys.includes(
      "critical_braking_issue"
    )
  ) {
    keys =
      keys.filter(
        (key) =>
          key !== "braking_issue"
      );
  }

  const phrases = [];

  for (const key of keys) {
    const definition =
      SIGNAL_EVIDENCE_PHRASES[
        key
      ];

    if (!definition) {
      continue;
    }

    const phrase =
      binary === "yes"
        ? definition.positive
        : definition.negative;

    if (phrase) {
      phrases.push(
        phrase
      );
    }
  }

  return [
    ...new Set(
      phrases
    ),
  ];
}

/* ============================================================
   EVIDENCE SNAPSHOT
   ============================================================ */

function buildEvidenceSnapshot(
  issue,
  answers = []
) {
  const userEvidenceText =
    buildUserEvidenceText(
      issue,
      answers
    );

  const interviewContext =
    buildInterviewContextText(
      issue,
      answers
    );

  const evidenceEntries =
    buildEvidenceEntries(
      issue,
      answers
    );

  const extracted =
    extractSignals(
      userEvidenceText
    );

  const rawEvidence =
    buildRawEvidenceFlags(
      userEvidenceText
    );

  const locks =
    buildDiagnosticLocks({
      text:
        userEvidenceText,

      extracted,

      rawEvidence,
    });

  return {
    userEvidenceText,
    interviewContext,
    evidenceEntries,
    extracted,
    rawEvidence,
    locks,
  };
}

/* ============================================================
   DOMINANT SIGNAL SUMMARY
   ============================================================ */

export function detectDominantSignals(
  issue,
  answers = []
) {
  const snapshot =
    buildEvidenceSnapshot(
      issue,
      answers
    );

  return buildDominantSignalSummary(
    snapshot
  );
}

function buildDominantSignalSummary(
  snapshot
) {
  const {
    extracted,
    rawEvidence,
    locks,
  } = snapshot;

  const signals = [];

  if (
    locks.ignitionFuel.locked
  ) {
    signals.push(
      "dominant combustion / ignition-fuel failure pattern"
    );
  }

  if (
    locks.smokeFuel.locked
  ) {
    signals.push(
      "rich combustion / raw-fuel exhaust pattern"
    );
  }

  if (
    locks.noStart.locked
  ) {
    signals.push(
      locks.noStart.label
    );
  }

  if (
    locks.vibration.locked
  ) {
    signals.push(
      locks.vibration.label
    );
  }

  if (
    locks.brake.locked
  ) {
    signals.push(
      locks.brake.critical
        ? "critical braking-control complaint"
        : "brake-system diagnostic path"
    );
  }

  if (
    locks.overheat.locked
  ) {
    signals.push(
      "active overheating / heat-rejection pattern"
    );
  }

  if (
    extracted.behavior_relationships
      ?.includes(
        "airflow_dependent_cooling_pattern"
      )
  ) {
    signals.push(
      "airflow-dependent cooling behavior"
    );
  }

  if (
    extracted.signals
      ?.acceleration_issue
  ) {
    signals.push(
      "acceleration / power-delivery complaint"
    );
  }

  if (
    extracted.signals
      ?.rough_idle
  ) {
    signals.push(
      "rough-idle combustion behavior"
    );
  }

  if (
    rawEvidence.flashingCheckEngine
  ) {
    signals.push(
      "flashing check-engine warning"
    );
  }

  if (
    rawEvidence.burningSmell
  ) {
    signals.push(
      "burning odor / thermal-electrical warning"
    );
  }

  if (
    rawEvidence.oilPressureWarning
  ) {
    signals.push(
      "oil-pressure warning"
    );
  }

  if (
    rawEvidence.stallingWhileDriving
  ) {
    signals.push(
      "stalling while driving"
    );
  }

  if (
    rawEvidence.turboBoost
  ) {
    signals.push(
      "turbo / boost-control complaint"
    );
  }

  if (
    rawEvidence.transmissionBehavior
  ) {
    signals.push(
      "transmission / shift-quality complaint"
    );
  }

  if (
    rawEvidence.networkCommunication
  ) {
    signals.push(
      "CAN / module communication complaint"
    );
  }

  if (
    rawEvidence.airbagSrs
  ) {
    signals.push(
      "SRS / airbag diagnostic path"
    );
  }

  if (
    rawEvidence.steeringCalibration
  ) {
    signals.push(
      "steering / EPS calibration path"
    );
  }

  if (
    rawEvidence.bankSpecificFuelTrim
  ) {
    signals.push(
      "bank-specific fuel-trim evidence"
    );
  }

  return [
    ...new Set(
      signals
    ),
  ];
}

/* ============================================================
   COMPLEXITY
   ============================================================ */

export function detectComplexity(
  issue,
  dominantSignals = [],
  answers = []
) {
  const snapshot =
    buildEvidenceSnapshot(
      issue,
      answers
    );

  return buildComplexityFromSnapshot(
    snapshot,
    dominantSignals
  );
}

function buildComplexityFromSnapshot(
  snapshot,
  dominantSignals
) {
  const {
    userEvidenceText,
    locks,
  } = snapshot;

  const signalCount =
    Array.isArray(
      dominantSignals
    )
      ? dominantSignals.length
      : 0;

  if (
    isAdvancedCase(
      userEvidenceText
    )
  ) {
    return {
      level:
        "advanced technician diagnostic case",

      questionPolicy:
        "adaptive",

      minimumQuestions:
        0,

      maximumQuestions:
        MAX_NORMAL_FOLLOW_UPS,

      reason:
        "Advanced technical evidence is present. Ask only discriminating questions that materially change ranking, verification, or safety.",
    };
  }

  if (
    locks.brake.critical
  ) {
    return {
      level:
        "critical safety-sensitive brake case",

      questionPolicy:
        "adaptive_safety_first",

      minimumQuestions:
        0,

      maximumQuestions:
        MAX_NORMAL_FOLLOW_UPS,

      reason:
        "Critical braking evidence is present. Safety guidance takes priority over interview length.",
    };
  }

  if (
    locks.overheat.locked ||
    locks.brake.locked ||
    isSafetySensitive(
      userEvidenceText
    )
  ) {
    return {
      level:
        "safety-sensitive system case",

      questionPolicy:
        "adaptive_safety_first",

      minimumQuestions:
        0,

      maximumQuestions:
        MAX_NORMAL_FOLLOW_UPS,

      reason:
        "Safety-sensitive evidence is present. Ask only questions that materially improve immediate safety or fault isolation.",
    };
  }

  if (
    locks.ignitionFuel.locked ||
    locks.smokeFuel.locked
  ) {
    return {
      level:
        "dominant combustion / fuel path",

      questionPolicy:
        "adaptive",

      minimumQuestions:
        0,

      maximumQuestions:
        MAX_NORMAL_FOLLOW_UPS,

      reason:
        "Strong combustion-related evidence exists. Further questions should separate competing failure families rather than repeat generic symptom checks.",
    };
  }

  if (
    locks.noStart.locked
  ) {
    return {
      level:
        "starting-system diagnostic case",

      questionPolicy:
        "adaptive",

      minimumQuestions:
        0,

      maximumQuestions:
        MAX_NORMAL_FOLLOW_UPS,

      reason:
        "Starting evidence is present. Additional questioning should separate crank state and the relevant electrical, authorization, fuel, ignition, or engine-signal branch only when unresolved.",
    };
  }

  if (
    signalCount >= 3
  ) {
    return {
      level:
        "multi-signal diagnostic case",

      questionPolicy:
        "adaptive",

      minimumQuestions:
        0,

      maximumQuestions:
        MAX_NORMAL_FOLLOW_UPS,

      reason:
        "Multiple meaningful signals are present. Ask only the discriminator most likely to change ranking.",
    };
  }

  if (
    isSimpleLowRisk(
      userEvidenceText
    ) &&
    signalCount === 0
  ) {
    return {
      level:
        "simple low-risk request",

      questionPolicy:
        "adaptive",

      minimumQuestions:
        0,

      maximumQuestions:
        MAX_NORMAL_FOLLOW_UPS,

      reason:
        "The request appears low-risk. Do not force follow-up questions unless one is necessary for useful guidance.",
    };
  }

  return {
    level:
      "standard diagnostic case",

    questionPolicy:
      "adaptive",

    minimumQuestions:
      0,

    maximumQuestions:
      MAX_NORMAL_FOLLOW_UPS,

    reason:
      "Interview depth is determined by information value rather than a fixed number of questions.",
  };
}

/* ============================================================
   READINESS
   ============================================================ */

/*
 * Compatibility metadata only.
 *
 * diagnose.js is the sole owner of the actual adaptive
 * ready-vs-follow-up decision.
 */
export function detectDiagnosticReadiness(
  issue,
  answers = [],
  dominantSignals = [],
  complexity = null
) {
  const snapshot =
    buildEvidenceSnapshot(
      issue,
      answers
    );

  return buildReadinessFromSnapshot(
    snapshot,
    answers,
    dominantSignals,
    complexity
  );
}

function buildReadinessFromSnapshot(
  snapshot,
  answers,
  dominantSignals,
  complexity
) {
  const answerCount =
    countUserAnswers(
      answers
    );

  const {
    extracted,
    rawEvidence,
  } = snapshot;

  const hasMeaningfulSignal =
    Object.values(
      extracted.signals || {}
    ).some(Boolean);

  const hasNegativeEvidence =
    Object.keys(
      extracted.negated_signals || {}
    ).length > 0;

  const hasBehaviorRelationship =
    Array.isArray(
      extracted.behavior_relationships
    ) &&
    extracted.behavior_relationships.length > 0;

  const hasHighValueRawEvidence =
    Object.values(
      rawEvidence
    ).some(Boolean);

  const hasDominantContext =
    Array.isArray(
      dominantSignals
    ) &&
    dominantSignals.length > 0;

  return {
    mode:
      "adaptive_backend_owned",

    minimumQuestions:
      0,

    maximumQuestions:
      MAX_NORMAL_FOLLOW_UPS,

    answerCount,

    readyForAnalysis:
      null,

    evidenceAvailable:
      hasMeaningfulSignal ||
      hasNegativeEvidence ||
      hasBehaviorRelationship ||
      hasHighValueRawEvidence ||
      hasDominantContext,

    complexity:
      complexity?.level ||
      "unknown",

    reason:
      "Readiness is decided by /api/diagnose.js according to whether another answer would materially improve diagnosis, verification, or safety.",
  };
}

/* ============================================================
   MASTER DIAGNOSTIC CONTEXT
   ============================================================ */

export function buildDiagnosticContext(
  issue,
  answers = []
) {
  const snapshot =
    buildEvidenceSnapshot(
      issue,
      answers
    );

  const {
    userEvidenceText,
    interviewContext,
    evidenceEntries,
    extracted,
    rawEvidence,
    locks,
  } = snapshot;

  const dominantSignals =
    buildDominantSignalSummary(
      snapshot
    );

  const complexity =
    buildComplexityFromSnapshot(
      snapshot,
      dominantSignals
    );

  const readiness =
    buildReadinessFromSnapshot(
      snapshot,
      answers,
      dominantSignals,
      complexity
    );

  const dominantLock =
    buildDominantLock({
      extracted_signals:
        extracted.signals,

      dominant_systems:
        extracted.dominant_systems,

      severity:
        extracted.severity,

      risk_flags:
        extracted.risk_flags,

      dominant_signals:
        dominantSignals,

      /*
       * IMPORTANT:
       * raw_input is evidence-only.
       */
      raw_input:
        userEvidenceText,

      negated_signals:
        extracted.negated_signals,

      behavior_relationships:
        extracted.behavior_relationships,

      signal_evidence:
        extracted.signal_evidence,
    });

  const behaviorReasoning =
    buildBehaviorReasoning({
      /*
       * Evidence only.
       * No DriveShift question text enters behavior detection.
       */
      raw_input:
        userEvidenceText,

      extracted_signals:
        extracted.signals,

      dominant_lock:
        dominantLock,

      negated_signals:
        extracted.negated_signals,

      behavior_relationships:
        extracted.behavior_relationships,

      signal_evidence:
        extracted.signal_evidence,
    });

  const mechanicalPrioritization =
    buildMechanicalPrioritization({
      /*
       * Evidence only.
       */
      raw_input:
        userEvidenceText,

      extracted_signals:
        extracted.signals,

      dominant_systems:
        extracted.dominant_systems,

      severity:
        extracted.severity,

      risk_flags:
        extracted.risk_flags,

      dominant_signals:
        dominantSignals,

      dominant_lock:
        dominantLock,

      behavior_reasoning:
        behaviorReasoning,

      negated_signals:
        extracted.negated_signals,

      behavior_relationships:
        extracted.behavior_relationships,

      signal_evidence:
        extracted.signal_evidence,
    });

  return {
    context_version:
      CONTEXT_VERSION,

    /*
     * BACKWARD-COMPATIBLE NAME:
     *
     * raw_input now means USER EVIDENCE ONLY.
     */
    raw_input:
      userEvidenceText,

    /*
     * Explicit modern name.
     */
    user_evidence_text:
      userEvidenceText,

    /*
     * Full Q/A history for reasoning/display only.
     *
     * Never use this field for raw symptom, DTC, or live-data
     * extraction.
     */
    interview_context:
      interviewContext,

    /*
     * Traceable evidence records.
     */
    evidence_entries:
      evidenceEntries,

    extracted_signals:
      extracted.signals,

    dominant_systems:
      extracted.dominant_systems,

    severity:
      extracted.severity,

    risk_flags:
      extracted.risk_flags,

    behavior_relationships:
      extracted.behavior_relationships ||
      [],

    signal_evidence:
      extracted.signal_evidence ||
      {},

    negated_signals:
      extracted.negated_signals ||
      {},

    observed_negative_signals:
      Object.keys(
        extracted.negated_signals ||
        {}
      ),

    raw_evidence_flags:
      rawEvidence,

    dominant_signals:
      dominantSignals,

    complexity,

    readiness,

    dominant_lock:
      dominantLock,

    behavior_reasoning:
      behaviorReasoning,

    mechanical_prioritization:
      mechanicalPrioritization,

    ignition_fuel_dominance:
      locks.ignitionFuel,

    smoke_fuel_dominance:
      locks.smokeFuel,

    no_start_dominance:
      locks.noStart,

    vibration_dominance:
      locks.vibration,

    brake_dominance:
      locks.brake,

    overheat_dominance:
      locks.overheat,

    diagnostic_constraints:
      buildDiagnosticConstraints({
        extracted,
        locks,
      }),
  };
}

/* ============================================================
   DIAGNOSTIC LOCK AGGREGATOR
   ============================================================ */

function buildDiagnosticLocks({
  text,
  extracted,
  rawEvidence,
}) {
  return {
    ignitionFuel:
      buildIgnitionFuelDominance({
        extracted,
        rawEvidence,
      }),

    smokeFuel:
      buildSmokeFuelDominance({
        extracted,
      }),

    noStart:
      buildNoStartDominance({
        text,
        extracted,
      }),

    vibration:
      buildVibrationDominance({
        text,
        extracted,
      }),

    brake:
      buildBrakeDominance({
        text,
        extracted,
      }),

    overheat:
      buildOverheatDominance({
        extracted,
      }),
  };
}

/* ============================================================
   IGNITION / FUEL DOMINANCE
   ============================================================ */

function buildIgnitionFuelDominance({
  extracted,
  rawEvidence,
}) {
  const signals =
    extracted.signals || {};

  let score = 0;
  let independentEvidenceCount = 0;

  const evidence = {
    flashingCheckEngine:
      Boolean(
        rawEvidence.flashingCheckEngine
      ),

    blackSmoke:
      Boolean(
        signals.black_smoke
      ),

    fuelSmell:
      Boolean(
        signals.fuel_smell
      ),

    roughIdle:
      Boolean(
        signals.rough_idle
      ),

    accelerationIssue:
      Boolean(
        signals.acceleration_issue
      ),

    loadSensitive:
      Boolean(
        signals.load_sensitive
      ),

    heatRelated:
      Boolean(
        signals.heat_related
      ),
  };

  if (
    evidence.flashingCheckEngine
  ) {
    score += 8;
    independentEvidenceCount++;
  }

  if (
    evidence.blackSmoke
  ) {
    score += 7;
    independentEvidenceCount++;
  }

  if (
    evidence.fuelSmell
  ) {
    score += 6;
    independentEvidenceCount++;
  }

  if (
    evidence.roughIdle
  ) {
    score += 3;
    independentEvidenceCount++;
  }

  if (
    evidence.accelerationIssue
  ) {
    score += 3;
    independentEvidenceCount++;
  }

  if (
    evidence.loadSensitive
  ) {
    score += 2;
  }

  if (
    evidence.heatRelated
  ) {
    score += 1;
  }

  const locked =
    score >= 10 &&
    independentEvidenceCount >= 2;

  return {
    locked,

    dominant_system:
      locked
        ? "ignition_fuel_combustion"
        : "undetermined",

    score,

    independent_evidence_count:
      independentEvidenceCount,

    evidence,

    mechanic_rule:
      locked
        ? "Current evidence supports prioritizing combustion, ignition, and fuel-control verification before unrelated systems. Do not authorize part replacement until the failed branch is isolated."
        : "No ignition/fuel dominance lock applied.",
  };
}

/* ============================================================
   SMOKE / FUEL DOMINANCE
   ============================================================ */

function buildSmokeFuelDominance({
  extracted,
}) {
  const signals =
    extracted.signals || {};

  const evidence = {
    blackSmoke:
      Boolean(
        signals.black_smoke
      ),

    fuelSmell:
      Boolean(
        signals.fuel_smell
      ),

    roughIdle:
      Boolean(
        signals.rough_idle
      ),

    accelerationIssue:
      Boolean(
        signals.acceleration_issue
      ),
  };

  let score = 0;

  if (
    evidence.blackSmoke
  ) {
    score += 8;
  }

  if (
    evidence.fuelSmell
  ) {
    score += 6;
  }

  if (
    evidence.roughIdle
  ) {
    score += 2;
  }

  if (
    evidence.accelerationIssue
  ) {
    score += 2;
  }

  const hasPrimaryEvidence =
    evidence.blackSmoke ||
    evidence.fuelSmell;

  const hasSupportingEvidence =
    (
      evidence.blackSmoke &&
      evidence.fuelSmell
    ) ||
    (
      evidence.blackSmoke &&
      (
        evidence.roughIdle ||
        evidence.accelerationIssue
      )
    ) ||
    (
      evidence.fuelSmell &&
      (
        evidence.roughIdle ||
        evidence.accelerationIssue
      )
    );

  const locked =
    hasPrimaryEvidence &&
    hasSupportingEvidence &&
    score >= 8;

  return {
    locked,

    score,

    dominant_system:
      locked
        ? "rich_combustion_or_raw_fuel_exhaust"
        : "undetermined",

    evidence,

    mechanic_rule:
      locked
        ? "Black-smoke or raw-fuel evidence supports testing mixture control, injector behavior, fuel pressure, and ignition burn quality before unrelated theories."
        : "No smoke/fuel dominance lock applied.",
  };
}

/* ============================================================
   NO-START DOMINANCE
   ============================================================ */

function buildNoStartDominance({
  text,
  extracted,
}) {
  const signals =
    extracted.signals || {};

  const hasNoCrank =
    Boolean(
      signals.no_crank
    );

  const hasSlowCrank =
    Boolean(
      signals.slow_crank
    );

  const hasStartupIssue =
    Boolean(
      signals.startup_issue
    );

  const hasExplicitCrankNoStart =
    hasAffirmedAny(
      text,
      [
        "cranks but won't start",
        "cranks but will not start",
        "cranks but does not start",
        "cranks but doesn't start",
        "crank no start",
        "cranks normally but won't start",
      ]
    );

  const hasNormalCrank =
    hasAffirmedAny(
      text,
      [
        "cranks normally",
        "cranks normal",
        "cranks at normal speed",
        "engine turns over normally",
        "turns over normally",
      ]
    );

  const locked =
    hasNoCrank ||
    hasSlowCrank ||
    hasStartupIssue ||
    hasExplicitCrankNoStart;

  let label =
    "starting-system diagnostic path";

  if (
    hasNoCrank
  ) {
    label =
      "no-crank power / starter / authorization path";
  } else if (
    hasSlowCrank
  ) {
    label =
      "slow-crank battery / cable / starter-load path";
  } else if (
    hasExplicitCrankNoStart ||
    (
      hasNormalCrank &&
      hasStartupIssue
    )
  ) {
    label =
      "crank-no-start fuel / ignition / engine-signal path";
  }

  return {
    locked,

    label,

    evidence: {
      hasNoCrank,
      hasSlowCrank,
      hasStartupIssue,
      hasExplicitCrankNoStart,
      hasNormalCrank,
    },

    mechanic_rule:
      locked
        ? "Starting diagnosis must first separate no-crank, slow-crank, and normal-crank/no-start behavior before ranking individual components."
        : "No starting-system dominance lock applied.",
  };
}

/* ============================================================
   VIBRATION DOMINANCE
   ============================================================ */

function buildVibrationDominance({
  text,
  extracted,
}) {
  const signals =
    extracted.signals || {};

  const hasVibration =
    Boolean(
      signals.vibration
    );

  const hasSpeedSensitive =
    Boolean(
      signals.speed_sensitive
    );

  const hasLoadSensitive =
    Boolean(
      signals.load_sensitive
    );

  const hasBraking =
    Boolean(
      signals.braking_issue ||
      signals.critical_braking_issue
    );

  const hasIdle =
    Boolean(
      signals.rough_idle
    ) ||
    hasAffirmedAny(
      text,
      [
        "vibrates at idle",
        "shakes at idle",
        "vibration at idle",
        "shaking while idling",
      ]
    );

  let label =
    "vibration diagnostic path";

  if (
    hasBraking
  ) {
    label =
      "braking-related vibration / pulsation path";
  } else if (
    hasSpeedSensitive
  ) {
    label =
      "vehicle-speed-sensitive wheel / tire / driveline vibration path";
  } else if (
    hasLoadSensitive
  ) {
    label =
      "load-sensitive engine / mount / axle / driveline vibration path";
  } else if (
    hasIdle
  ) {
    label =
      "idle vibration / combustion / mount path";
  }

  return {
    locked:
      hasVibration,

    label,

    evidence: {
      hasVibration,
      hasSpeedSensitive,
      hasLoadSensitive,
      hasBraking,
      hasIdle,
    },

    mechanic_rule:
      hasVibration
        ? "Vibration must be separated by operating condition and where it is felt before ranking wheel, tire, brake, engine, mount, axle, or driveline causes."
        : "No vibration dominance lock applied.",
  };
}

/* ============================================================
   BRAKE DOMINANCE
   ============================================================ */

function buildBrakeDominance({
  text,
  extracted,
}) {
  const signals =
    extracted.signals || {};

  const critical =
    Boolean(
      signals.critical_braking_issue
    );

  const specificBrakeBehavior =
    Boolean(
      signals.braking_issue
    );

  const generalBrakeComplaint =
    hasAffirmedAny(
      text,
      [
        "brake problem",
        "brakes problem",
        "brake issue",
        "braking issue",
        "soft brake pedal",
        "hard brake pedal",
        "brake noise",
        "grinding brakes",
        "brake warning light",
        "abs light",
      ]
    );

  const locked =
    critical ||
    specificBrakeBehavior ||
    generalBrakeComplaint;

  return {
    locked,

    critical,

    evidence: {
      criticalBrakeBehavior:
        critical,

      specificBrakeBehavior,

      generalBrakeComplaint,
    },

    mechanic_rule:
      locked
        ? "Brake complaints require safety-first separation of hydraulic integrity, pedal behavior, friction components, rotor behavior, ABS activity, and wheel-end faults."
        : "No brake-system dominance lock applied.",
  };
}

/* ============================================================
   OVERHEAT DOMINANCE
   ============================================================ */

function buildOverheatDominance({
  extracted,
}) {
  const signals =
    extracted.signals || {};

  const locked =
    Boolean(
      signals.overheating
    );

  const denied =
    Boolean(
      extracted.negated_signals
        ?.overheating
    ) &&
    !locked;

  return {
    locked,

    denied,

    evidence: {
      overheating:
        locked,

      coolantLoss:
        Boolean(
          signals.coolant_loss
        ),

      heatRelated:
        Boolean(
          signals.heat_related
        ),

      idleOrStoppedRelated:
        Boolean(
          signals.idle_or_stopped_related
        ),

      improvesWithSpeed:
        Boolean(
          signals.improves_with_speed
        ),
    },

    mechanic_rule:
      locked
        ? "Overheating diagnosis should separate coolant loss, airflow/fan control, thermostat/flow, radiator restriction, pump performance, pressure retention, and combustion-gas intrusion using verification evidence."
        : denied
            ? "Overheating is explicitly denied in the supplied evidence and should not be treated as present."
            : "No active overheating lock applied.",
  };
}

/* ============================================================
   RAW HIGH-VALUE EVIDENCE
   ============================================================ */

function buildRawEvidenceFlags(
  text
) {
  return {
    flashingCheckEngine:
      hasAffirmedAny(
        text,
        [
          "flashing check engine",
          "flashing check engine light",
          "check engine light flashes",
          "check engine light flashing",
          "cel flashes",
          "flashing cel",
        ]
      ),

    burningSmell:
      hasAffirmedAny(
        text,
        [
          "burning smell",
          "burnt smell",
          "smells burnt",
          "burning plastic",
          "electrical burning",
          "smoke from engine bay",
          "smoke under hood",
        ]
      ),

    oilPressureWarning:
      hasAffirmedAny(
        text,
        [
          "oil pressure warning",
          "low oil pressure",
          "red oil light",
          "oil pressure light",
          "oil warning light",
        ]
      ),

    stallingWhileDriving:
      hasAffirmedAny(
        text,
        [
          "stalls while driving",
          "stall while driving",
          "dies while driving",
          "shuts off while driving",
          "engine dies while driving",
        ]
      ),

    turboBoost:
      hasAffirmedAny(
        text,
        [
          "underboost",
          "overboost",
          "boost leak",
          "no boost",
          "low boost",
          "turbo problem",
          "turbo issue",
          "turbo whistle",
        ]
      ),

    transmissionBehavior:
      hasAffirmedAny(
        text,
        [
          "transmission slipping",
          "transmission slips",
          "hard shift",
          "harsh shift",
          "shift flare",
          "flaring between gears",
          "delayed engagement",
          "won't shift",
          "will not shift",
          "gear slipping",
        ]
      ),

    networkCommunication:
      hasAffirmedAny(
        text,
        [
          "can bus",
          "u-code",
          "u code",
          "module offline",
          "no communication",
          "communication fault",
          "60 ohms",
          "oscilloscope",
        ]
      ),

    airbagSrs:
      hasAffirmedAny(
        text,
        [
          "airbag light",
          "srs light",
          "airbag warning",
          "srs warning",
        ]
      ),

    steeringCalibration:
      hasAffirmedAny(
        text,
        [
          "eps light",
          "steering angle",
          "torque sensor",
          "zero point reset",
          "zero-point reset",
          "steering calibration",
        ]
      ),

    bankSpecificFuelTrim:
      hasAffirmedAny(
        text,
        [
          "fuel trim",
          "fuel trims",
          "bank 1",
          "bank 2",
          "upstream o2",
          "restricted injector",
          "injector balance",
        ]
      ),
  };
}

/* ============================================================
   DIAGNOSTIC CONSTRAINTS
   ============================================================ */

function buildDiagnosticConstraints({
  extracted,
  locks,
}) {
  const constraints = [];

  if (
    locks.overheat.denied
  ) {
    constraints.push(
      "Do not treat overheating as present unless new positive temperature or coolant evidence is supplied."
    );
  }

  if (
    extracted.negated_signals
      ?.smoke &&
    !extracted.signals
      ?.smoke
  ) {
    constraints.push(
      "Smoke is explicitly denied and must remain negative evidence."
    );
  }

  if (
    extracted.negated_signals
      ?.fuel_smell &&
    !extracted.signals
      ?.fuel_smell
  ) {
    constraints.push(
      "Fuel odor is explicitly denied and must not support a rich-fuel diagnosis."
    );
  }

  if (
    locks.smokeFuel.locked
  ) {
    constraints.push(
      "Rich-combustion direction is favored, but injector, ignition, fuel-pressure, and mixture-control branches remain unconfirmed until tested."
    );
  }

  if (
    locks.noStart.locked
  ) {
    constraints.push(
      "Do not rank individual starting components until crank behavior and the relevant power, authorization, fuel, ignition, or signal branch is isolated."
    );
  }

  if (
    locks.vibration.locked
  ) {
    constraints.push(
      "Do not assign vibration to wheel balance, mounts, axles, brakes, or driveline without matching operating condition and vibration location."
    );
  }

  if (
    locks.brake.locked
  ) {
    constraints.push(
      "Brake-related evidence is safety-sensitive; preserve hydraulic and vehicle-control risk until ruled out."
    );
  }

  return constraints;
}

/* ============================================================
   SAFETY-SENSITIVE DETECTION
   ============================================================ */

function isSafetySensitive(
  text
) {
  const extracted =
    extractSignals(
      text
    );

  const signals =
    extracted.signals || {};

  if (
    signals.critical_braking_issue ||
    signals.overheating ||
    (
      signals.severe_smoke &&
      signals.fuel_smell
    )
  ) {
    return true;
  }

  return hasAffirmedAny(
    text,
    [
      "burning smell",
      "burning plastic",
      "oil pressure warning",
      "red oil light",
      "stalls while driving",
      "dies while driving",
      "red warning light",
      "flashing check engine",
      "check engine light flashes",
      "major power loss",
    ]
  );
}

/* ============================================================
   ADVANCED CASE
   ============================================================ */

function isAdvancedCase(
  text
) {
  return hasAffirmedAny(
    text,
    [
      "oscilloscope",
      "signal clipping",
      "60 ohms",
      "can bus",
      "u-code",
      "u code",
      "fuel trims",
      "fuel trim",
      "bank 1",
      "bank 2",
      "atf temperature",
      "solenoid resistance",
      "valve body",
      "clutch pack",
      "torque sensor",
      "zero-point reset",
      "zero point reset",
      "hydraulic lifter",
      "wrist pin",
      "oil pressure readings",
      "injector balance",
      "smoke test",
      "upstream o2",
      "bidirectional control",
      "voltage drop test",
      "fuel pressure decay",
    ]
  );
}

/* ============================================================
   SIMPLE LOW-RISK REQUEST
   ============================================================ */

function isSimpleLowRisk(
  text
) {
  return hasAffirmedAny(
    text,
    [
      "maintenance question",
      "oil change interval",
      "tire pressure question",
      "washer fluid",
      "wiper replacement",
      "wiper blade",
      "light bulb replacement",
      "gas cap replacement",
    ]
  );
}

/* ============================================================
   NEGATION-AWARE RAW PHRASE MATCHING
   ============================================================ */

function hasAffirmedAny(
  text,
  phrases
) {
  const clauses =
    splitDiagnosticClauses(
      text
    );

  for (
    const clause of clauses
  ) {
    for (
      const phrase of phrases
    ) {
      if (
        phraseIsAffirmed(
          clause,
          phrase
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

function phraseIsAffirmed(
  clause,
  phrase
) {
  const cleanClause =
    normalizeForMatching(
      clause
    );

  const cleanPhrase =
    normalizeForMatching(
      phrase
    );

  if (
    !cleanClause ||
    !cleanPhrase
  ) {
    return false;
  }

  const phrasePattern =
    new RegExp(
      `(^|\\s)${escapeRegExp(
        cleanPhrase
      )}(?=\\s|$)`,
      "i"
    );

  const match =
    phrasePattern.exec(
      cleanClause
    );

  if (!match) {
    return false;
  }

  /*
   * Fault phrases intentionally beginning with "no":
   * - no communication
   * - no boost
   * - no crank
   */
  if (
    cleanPhrase.startsWith(
      "no "
    )
  ) {
    return true;
  }

  const phraseIndex =
    cleanClause.indexOf(
      cleanPhrase
    );

  if (
    phraseIndex <= 0
  ) {
    return true;
  }

  const before =
    cleanClause
      .slice(
        0,
        phraseIndex
      )
      .trim();

  if (!before) {
    return true;
  }

  const recentWords =
    before
      .split(/\s+/)
      .filter(Boolean)
      .slice(-5)
      .join(" ");

  const negations = [
    "no",
    "not",
    "never",
    "without",

    "don't",
    "doesn't",
    "didn't",
    "isn't",
    "wasn't",
    "weren't",
    "hasn't",
    "haven't",
    "can't",
    "cannot",

    "do not",
    "does not",
    "did not",
    "is not",
    "was not",
    "were not",
    "has not",
    "have not",
  ];

  const negated =
    negations.some(
      (negation) => {
        const cleanNegation =
          normalizeForMatching(
            negation
          );

        const pattern =
          new RegExp(
            `(^|\\s)${escapeRegExp(
              cleanNegation
            )}(?=\\s|$)`,
            "i"
          );

        return pattern.test(
          recentWords
        );
      }
    );

  return !negated;
}

function splitDiagnosticClauses(
  text
) {
  return String(
    text || ""
  )
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .split(
      /\b(?:but|however|although|though|except|yet)\b|[.!?;,\n]/i
    )
    .map(
      (clause) =>
        clause.trim()
    )
    .filter(Boolean);
}

function normalizeForMatching(
  value
) {
  return String(
    value || ""
  )
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(
      /[^a-z0-9'\s-]/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

/* ============================================================
   LEGACY METADATA FILTER
   ============================================================ */

function isLegacyMetadataQuestion(
  question
) {
  const clean =
    String(
      question || ""
    )
      .toLowerCase()
      .trim();

  return (
    clean.includes(
      "vehicle profile"
    ) ||
    clean.includes(
      "driveshift flow control"
    )
  );
}

/* ============================================================
   PUBLIC SMALL HELPERS
   ============================================================ */

export function includesAny(
  text,
  words
) {
  const raw =
    String(
      text || ""
    ).toLowerCase();

  return words.some(
    (word) =>
      raw.includes(
        String(
          word || ""
        ).toLowerCase()
      )
  );
}

export function clamp(
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

/* ============================================================
   REGEXP HELPER
   ============================================================ */

function escapeRegExp(
  value = ""
) {
  return String(
    value
  ).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}
