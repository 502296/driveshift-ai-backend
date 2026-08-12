import { extractSignals } from "./signal-extractor.js";
import { buildDominantLock } from "./dominant-lock-engine.js";
import { buildBehaviorReasoning } from "./behavior-reasoning-engine.js";
import { buildMechanicalPrioritization } from "./mechanical-prioritization-engine.js";

/* ============================================================
   DRIVESHIFT — DIAGNOSTIC CORE
   ============================================================

   Purpose:
   - Build disciplined structured context from the current session.
   - Consume signal-extractor.js as the canonical signal source.
   - Build higher-order mechanical patterns without re-inventing
     symptom detection.
   - Preserve negative evidence.
   - Avoid fixed-question diagnostic gates.
   - Provide downstream reasoning engines with traceable context.

   This module does NOT:
   - decide the final diagnosis,
   - confirm a failed component,
   - assign the final user-facing confidence,
   - force a fixed number of interview questions,
   - override stronger raw evidence.

   Diagnostic interview readiness is owned by /api/diagnose.js.
   ============================================================ */

const CONTEXT_VERSION = "2.0";

const MAX_NORMAL_FOLLOW_UPS = 5;

/* ============================================================
   ANSWER COUNT
   ============================================================ */

/*
 * Count only actual answered diagnostic follow-ups.
 *
 * Legacy metadata entries are ignored defensively even though
 * the current Flutter client no longer inserts them.
 */
export function countUserAnswers(answers) {
  if (!Array.isArray(answers)) {
    return 0;
  }

  return answers.filter((item) => {
    const answer =
      String(item?.answer || "").trim();

    const question =
      String(item?.question || "")
        .toLowerCase()
        .trim();

    if (!answer) {
      return false;
    }

    if (
      question.includes("vehicle profile") ||
      question.includes("driveshift flow control")
    ) {
      return false;
    }

    return true;
  }).length;
}

/* ============================================================
   DOMINANT SIGNAL SUMMARY
   ============================================================ */

export function detectDominantSignals(
  issue,
  answers = []
) {
  const combined =
    buildCombinedText(
      issue,
      answers
    );

  const extracted =
    extractSignals(combined);

  const rawEvidence =
    buildRawEvidenceFlags(
      combined
    );

  const locks =
    buildDiagnosticLocks({
      text: combined,
      extracted,
      rawEvidence,
    });

  const signals = [];

  /* ----------------------------------------------------------
     Combustion / fuel
     ---------------------------------------------------------- */

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

  /* ----------------------------------------------------------
     Starting
     ---------------------------------------------------------- */

  if (
    locks.noStart.locked
  ) {
    signals.push(
      locks.noStart.label
    );
  }

  /* ----------------------------------------------------------
     Vibration
     ---------------------------------------------------------- */

  if (
    locks.vibration.locked
  ) {
    signals.push(
      locks.vibration.label
    );
  }

  /* ----------------------------------------------------------
     Brakes
     ---------------------------------------------------------- */

  if (
    locks.brake.locked
  ) {
    signals.push(
      locks.brake.critical
        ? "critical braking-control complaint"
        : "brake-system diagnostic path"
    );
  }

  /* ----------------------------------------------------------
     Cooling
     ---------------------------------------------------------- */

  if (
    locks.overheat.locked
  ) {
    signals.push(
      "active overheating / heat-rejection pattern"
    );
  }

  if (
    extracted.behavior_relationships?.includes(
      "airflow_dependent_cooling_pattern"
    )
  ) {
    signals.push(
      "airflow-dependent cooling behavior"
    );
  }

  /* ----------------------------------------------------------
     Performance
     ---------------------------------------------------------- */

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

  /* ----------------------------------------------------------
     Raw high-value observations not covered by base extractor
     ---------------------------------------------------------- */

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

  /*
   * The output is contextual evidence only.
   *
   * It must never be interpreted downstream as confirmation of
   * a failed component.
   */
  return [
    ...new Set(
      signals
    ),
  ];
}

/* ============================================================
   COMPLEXITY
   ============================================================ */

/*
 * Complexity is descriptive only.
 *
 * It no longer imposes a fixed question minimum.
 *
 * /api/diagnose.js owns the adaptive interview and asks another
 * question only when that answer has material diagnostic value.
 */
export function detectComplexity(
  issue,
  dominantSignals = [],
  answers = []
) {
  const text =
    buildCombinedText(
      issue,
      answers
    );

  const extracted =
    extractSignals(text);

  const rawEvidence =
    buildRawEvidenceFlags(
      text
    );

  const locks =
    buildDiagnosticLocks({
      text,
      extracted,
      rawEvidence,
    });

  const signalCount =
    Array.isArray(
      dominantSignals
    )
      ? dominantSignals.length
      : 0;

  if (
    isAdvancedCase(text)
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
        "Critical braking language is present. Safety direction takes priority over interview length.",
    };
  }

  if (
    locks.overheat.locked ||
    locks.brake.locked
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
        "Cooling or braking evidence is present. Ask only questions that improve immediate safety or fault isolation.",
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
        "Strong combustion-related evidence exists. Further questions should discriminate between competing failure families rather than repeat generic symptom checks.",
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
        "Starting evidence is present. Additional questions should separate crank, no-crank, power, authorization, fuel, ignition, and signal paths only when unresolved.",
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
        "Multiple meaningful signals are present. Ask only the discriminator most likely to change diagnostic ranking.",
    };
  }

  if (
    isSimpleLowRisk(text) &&
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
      "Interview depth is determined by diagnostic information value rather than a fixed question count.",
  };
}

/* ============================================================
   READINESS
   ============================================================ */

/*
 * IMPORTANT:
 *
 * This function is retained for compatibility with existing code,
 * but it is no longer a hard diagnostic gate.
 *
 * The adaptive interview decision belongs to diagnose.js.
 */
export function detectDiagnosticReadiness(
  issue,
  answers = [],
  dominantSignals = [],
  complexity = null
) {
  const answerCount =
    countUserAnswers(
      answers
    );

  const text =
    buildCombinedText(
      issue,
      answers
    );

  const extracted =
    extractSignals(text);

  const rawEvidence =
    buildRawEvidenceFlags(
      text
    );

  const hasMeaningfulSignal =
    Object.values(
      extracted.signals || {}
    ).some(Boolean);

  const hasBehaviorRelationship =
    Array.isArray(
      extracted.behavior_relationships
    ) &&
    extracted.behavior_relationships.length >
      0;

  const hasHighValueRawEvidence =
    Object.values(
      rawEvidence
    ).some(Boolean);

  const hasDominantContext =
    Array.isArray(
      dominantSignals
    ) &&
    dominantSignals.length >
      0;

  return {
    mode:
      "adaptive_backend_owned",

    minimumQuestions:
      0,

    maximumQuestions:
      MAX_NORMAL_FOLLOW_UPS,

    answerCount,

    /*
     * Null is intentional.
     *
     * No helper module should override the adaptive interview
     * decision made by /api/diagnose.js.
     */
    readyForAnalysis:
      null,

    evidenceAvailable:
      hasMeaningfulSignal ||
      hasBehaviorRelationship ||
      hasHighValueRawEvidence ||
      hasDominantContext,

    complexity:
      complexity?.level ||
      "unknown",

    reason:
      "Readiness is decided by the adaptive interview in /api/diagnose.js based on whether another answer would materially improve diagnosis, verification, or safety.",
  };
}

/* ============================================================
   MASTER DIAGNOSTIC CONTEXT
   ============================================================ */

export function buildDiagnosticContext(
  issue,
  answers = []
) {
  const combined =
    buildCombinedText(
      issue,
      answers
    );

  const extracted =
    extractSignals(
      combined
    );

  const rawEvidence =
    buildRawEvidenceFlags(
      combined
    );

  const locks =
    buildDiagnosticLocks({
      text: combined,
      extracted,
      rawEvidence,
    });

  const dominantSignals =
    detectDominantSignals(
      issue,
      answers
    );

  const complexity =
    detectComplexity(
      issue,
      dominantSignals,
      answers
    );

  const readiness =
    detectDiagnosticReadiness(
      issue,
      answers,
      dominantSignals,
      complexity
    );

  /* ----------------------------------------------------------
     Existing downstream engines
     ---------------------------------------------------------- */

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

      raw_input:
        combined,

      /*
       * New context fields.
       *
       * Existing helper functions may safely ignore unknown keys.
       */
      negated_signals:
        extracted.negated_signals,

      behavior_relationships:
        extracted.behavior_relationships,

      signal_evidence:
        extracted.signal_evidence,
    });

  const behaviorReasoning =
    buildBehaviorReasoning({
      raw_input:
        combined,

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
      raw_input:
        combined,

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
     * Raw session evidence.
     */
    raw_input:
      combined,

    /*
     * Canonical signal extractor output.
     */
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

    /*
     * Positive signal traceability.
     */
    signal_evidence:
      extracted.signal_evidence ||
      {},

    /*
     * Negative observations are preserved explicitly.
     *
     * Example:
     * "no smoke"
     * must remain usable negative evidence.
     */
    negated_signals:
      extracted.negated_signals ||
      {},

    observed_negative_signals:
      Object.keys(
        extracted.negated_signals ||
        {}
      ),

    /*
     * Additional high-value phrases not represented as primary
     * base signals.
     */
    raw_evidence_flags:
      rawEvidence,

    /*
     * Human-readable diagnostic context.
     */
    dominant_signals:
      dominantSignals,

    complexity,

    readiness,

    /*
     * Existing reasoning layers.
     */
    dominant_lock:
      dominantLock,

    behavior_reasoning:
      behaviorReasoning,

    mechanical_prioritization:
      mechanicalPrioritization,

    /*
     * Conservative higher-order locks.
     *
     * These guide prioritization only.
     * They do not confirm a component.
     */
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
        text,
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
  text,
  extracted,
  rawEvidence,
}) {
  const signals =
    extracted.signals || {};

  let score =
    0;

  let independentEvidenceCount =
    0;

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
    score +=
      8;

    independentEvidenceCount++;
  }

  if (
    evidence.blackSmoke
  ) {
    score +=
      7;

    independentEvidenceCount++;
  }

  if (
    evidence.fuelSmell
  ) {
    score +=
      6;

    independentEvidenceCount++;
  }

  if (
    evidence.roughIdle
  ) {
    score +=
      3;

    independentEvidenceCount++;
  }

  if (
    evidence.accelerationIssue
  ) {
    score +=
      3;

    independentEvidenceCount++;
  }

  if (
    evidence.loadSensitive
  ) {
    score +=
      2;
  }

  if (
    evidence.heatRelated
  ) {
    score +=
      1;
  }

  /*
   * Require more than one meaningful observation.
   *
   * One symptom alone must not create an aggressive diagnostic
   * lock.
   */
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

  let score =
    0;

  if (
    evidence.blackSmoke
  ) {
    score +=
      8;
  }

  if (
    evidence.fuelSmell
  ) {
    score +=
      6;
  }

  if (
    evidence.roughIdle
  ) {
    score +=
      2;
  }

  if (
    evidence.accelerationIssue
  ) {
    score +=
      2;
  }

  /*
   * Do not lock merely because generic smoke exists.
   *
   * White and blue smoke deliberately remain outside this
   * rich-fuel lock.
   */
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

/*
 * These observations are useful but do not belong in the core
 * signal extractor's broad behavioral taxonomy.
 *
 * Matching is local-negation-aware.
 */
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
  const constraints =
    [];

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
      "Smoke is explicitly denied in the supplied session and must remain negative evidence."
    );
  }

  if (
    extracted.negated_signals
      ?.fuel_smell &&
    !extracted.signals
      ?.fuel_smell
  ) {
    constraints.push(
      "Fuel odor is explicitly denied and must not be used as supporting evidence for a rich-fuel diagnosis."
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
      "Do not assign a vibration to wheel balance, mounts, axles, brakes, or driveline without matching the operating condition and vibration location."
    );
  }

  if (
    locks.brake.locked
  ) {
    constraints.push(
      "Brake-related evidence is safety-sensitive; diagnostic ranking must preserve hydraulic and vehicle-control risk until ruled out."
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
   ADVANCED CASE DETECTION
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

/*
 * This matcher is intentionally smaller than signal-extractor.js.
 *
 * It exists only for high-value phrases that are not part of the
 * base signal taxonomy.
 */

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

  if (
    !match
  ) {
    return false;
  }

  /*
   * The phrase itself may intentionally contain "no":
   * - no communication
   * - no boost
   *
   * In that case the phrase describes the positive fault state
   * and must not be treated as a negated observation.
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

  if (
    !before
  ) {
    return true;
  }

  const recentWords =
    before
      .split(
        /\s+/
      )
      .filter(
        Boolean
      )
      .slice(
        -5
      )
      .join(
        " "
      );

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
    .replace(
      /[’‘]/g,
      "'"
    )
    .split(
      /\b(?:but|however|although|though|except|yet)\b|[.!?;,\n]/i
    )
    .map(
      (clause) =>
        clause.trim()
    )
    .filter(
      Boolean
    );
}

function normalizeForMatching(
  value
) {
  return String(
    value || ""
  )
    .toLowerCase()
    .replace(
      /[’‘]/g,
      "'"
    )
    .replace(
      /[–—]/g,
      "-"
    )
    .replace(
      /[^a-z0-9'\s-]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
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
   SESSION TEXT
   ============================================================ */

function buildCombinedText(
  issue,
  answers
) {
  const parts = [
    String(
      issue || ""
    ).trim(),
  ];

  if (
    Array.isArray(
      answers
    )
  ) {
    for (
      const item of answers
    ) {
      const question =
        String(
          item?.question || ""
        ).trim();

      const answer =
        String(
          item?.answer || ""
        ).trim();

      if (
        question
      ) {
        parts.push(
          `Question: ${question}`
        );
      }

      if (
        answer
      ) {
        parts.push(
          `Answer: ${answer}`
        );
      }
    }
  }

  return parts
    .filter(
      Boolean
    )
    .join(
      "\n"
    )
    .toLowerCase();
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
