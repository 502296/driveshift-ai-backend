/* ============================================================
   DRIVESHIFT — DOMINANT DIAGNOSTIC ANCHOR ENGINE
   ============================================================

   Purpose:
   - Keep the diagnostic path centered on the strongest evidence.
   - Prevent low-value follow-up answers from causing random drift.
   - Preserve negative evidence supplied by signal-extractor.js.
   - Rank internal diagnostic directions without declaring a part failed.
   - Keep safety priority separate from diagnostic certainty.

   IMPORTANT:
   This engine creates a ROUTING ANCHOR, not a diagnosis.

   "locked" means:
   "This direction currently has enough evidence to guide the next
   diagnostic step."

   It does NOT mean:
   - confirmed component failure,
   - final diagnostic confidence,
   - permission to replace a part,
   - permission to ignore stronger contradictory evidence later.
   ============================================================ */

const LOCK_LEVELS = Object.freeze({
  CRITICAL: "critical",
  STRONG: "strong",
  MODERATE: "moderate",
  WEAK: "weak",
});

const REPORT_SYSTEM_MAP = Object.freeze({
  fuel_combustion: "fuel",
  ignition_misfire: "ignition",
  engine_performance: "engine_performance",
  cooling_overheat: "cooling",
  brake_safety: "brakes",
  electrical_starting: "starting_charging",
  transmission_drivetrain: "transmission",
  network_modules: "network_can",
  safety_restraint: "general",
  steering_eps: "steering_suspension",
  general: "general",
});

/* ============================================================
   SMALL HELPERS
   ============================================================ */

function hasSignal(signals = {}, key) {
  return signals?.[key] === true;
}

function listIncludesAny(list = [], values = []) {
  if (!Array.isArray(list) || !Array.isArray(values)) {
    return false;
  }

  const normalized = list
    .map((item) => String(item || "").toLowerCase())
    .filter(Boolean);

  return values.some((value) => {
    const target = String(value || "").toLowerCase();

    if (!target) {
      return false;
    }

    return normalized.some((item) => item.includes(target));
  });
}

function hasRisk(riskFlags = [], values = []) {
  return listIncludesAny(
    riskFlags,
    values
  );
}

function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForMatching(value = "") {
  return normalizeText(value)
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value = "") {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function splitDiagnosticClauses(text = "") {
  return normalizeText(text)
    .split(
      /\b(?:but|however|although|though|except|yet)\b|[.!?;,\n]/i
    )
    .map((clause) => clause.trim())
    .filter(Boolean);
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
   * Phrases that intentionally begin with "no" describe a
   * positive fault state.
   *
   * Examples:
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

function hasAffirmedAny(
  text = "",
  phrases = []
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

/* ============================================================
   SYSTEM SCORE STORAGE
   ============================================================ */

function ensureSystemScore(
  scores,
  system
) {
  if (!scores[system]) {
    scores[system] = {
      score: 0,

      reasons: [],

      evidence_keys:
        new Set(),

      penalties: [],
    };
  }

  return scores[system];
}

function scoreSystem(
  scores,
  system,
  points,
  reason,
  evidenceKey
) {
  if (
    !system ||
    !Number.isFinite(points) ||
    points <= 0
  ) {
    return;
  }

  const entry =
    ensureSystemScore(
      scores,
      system
    );

  /*
   * Prevent the same underlying observation from being counted
   * twice merely because another helper derived the same idea.
   */
  if (
    evidenceKey &&
    entry.evidence_keys.has(
      evidenceKey
    )
  ) {
    return;
  }

  entry.score += points;

  if (reason) {
    entry.reasons.push(
      reason
    );
  }

  if (evidenceKey) {
    entry.evidence_keys.add(
      evidenceKey
    );
  }
}

function penalizeSystem(
  scores,
  system,
  points,
  reason,
  evidenceKey
) {
  if (
    !system ||
    !Number.isFinite(points) ||
    points <= 0
  ) {
    return;
  }

  const entry =
    ensureSystemScore(
      scores,
      system
    );

  const penaltyKey =
    evidenceKey
      ? `penalty:${evidenceKey}`
      : null;

  if (
    penaltyKey &&
    entry.evidence_keys.has(
      penaltyKey
    )
  ) {
    return;
  }

  entry.score -= points;

  if (reason) {
    entry.penalties.push(
      reason
    );
  }

  if (penaltyKey) {
    entry.evidence_keys.add(
      penaltyKey
    );
  }
}

/* ============================================================
   NEGATIVE EVIDENCE
   ============================================================ */

function hasNegatedSignal(
  negatedSignals = {},
  key
) {
  return Boolean(
    negatedSignals?.[key]
  );
}

function buildNegativeEvidence({
  extracted_signals = {},
  negated_signals = {},
}) {
  const coolingDenied =
    hasNegatedSignal(
      negated_signals,
      "overheating"
    ) &&
    !hasSignal(
      extracted_signals,
      "overheating"
    );

  const smokeDenied =
    hasNegatedSignal(
      negated_signals,
      "smoke"
    ) &&
    !hasSignal(
      extracted_signals,
      "smoke"
    );

  const fuelSmellDenied =
    hasNegatedSignal(
      negated_signals,
      "fuel_smell"
    ) &&
    !hasSignal(
      extracted_signals,
      "fuel_smell"
    );

  const vibrationDenied =
    hasNegatedSignal(
      negated_signals,
      "vibration"
    ) &&
    !hasSignal(
      extracted_signals,
      "vibration"
    );

  return {
    coolingDenied,
    smokeDenied,
    fuelSmellDenied,
    vibrationDenied,
  };
}

/* ============================================================
   SYSTEM SCORING
   ============================================================ */

function buildSystemScores({
  extracted_signals = {},
  dominant_systems = [],
  severity = "low",
  risk_flags = [],
  dominant_signals = [],
  raw_input = "",
  negated_signals = {},
  behavior_relationships = [],
}) {
  const scores = {};

  const negative =
    buildNegativeEvidence({
      extracted_signals,
      negated_signals,
    });

  /* ----------------------------------------------------------
     High-value raw observations not owned by
     signal-extractor.js
     ---------------------------------------------------------- */

  const flashingCel =
    hasAffirmedAny(
      raw_input,
      [
        "flashing check engine",
        "flashing check engine light",
        "check engine light flashes",
        "check engine light flashing",
        "cel flashes",
        "flashing cel",
      ]
    );

  const criticalBrakeLanguage =
    hasAffirmedAny(
      raw_input,
      [
        "no brakes",
        "lost brakes",
        "brakes failed",
        "brake pedal goes to floor",
        "pedal goes to the floor",
        "brake fluid leak",
        "cannot stop",
        "can't stop",
      ]
    );

  const networkEvidence =
    hasAffirmedAny(
      raw_input,
      [
        "u-code",
        "u code",
        "can bus",
        "no communication",
        "module offline",
        "60 ohms",
        "oscilloscope",
      ]
    );

  const srsEvidence =
    hasAffirmedAny(
      raw_input,
      [
        "airbag light",
        "airbag warning",
        "srs light",
        "srs warning",
      ]
    );

  const steeringEvidence =
    hasAffirmedAny(
      raw_input,
      [
        "eps light",
        "eps warning",
        "steering angle",
        "torque sensor",
        "zero-point reset",
        "zero point reset",
        "steering calibration",
      ]
    );

  const transmissionEvidence =
    hasAffirmedAny(
      raw_input,
      [
        "transmission slipping",
        "transmission slips",
        "hard shift",
        "harsh shift",
        "shift flare",
        "flaring between gears",
        "delayed engagement",
        "torque converter",
        "atf temperature",
      ]
    );

  /* ----------------------------------------------------------
     FUEL / COMBUSTION
     ---------------------------------------------------------- */

  if (
    hasSignal(
      extracted_signals,
      "black_smoke"
    )
  ) {
    scoreSystem(
      scores,

      "fuel_combustion",

      7,

      "Black smoke supports a rich-combustion or incomplete-burn direction.",

      "black_smoke"
    );
  }

  if (
    hasSignal(
      extracted_signals,
      "fuel_smell"
    )
  ) {
    scoreSystem(
      scores,

      "fuel_combustion",

      6,

      "Fuel odor supports raw-fuel, rich-mixture, leakage, or incomplete-combustion investigation.",

      "fuel_smell"
    );
  }

  if (
    hasSignal(
      extracted_signals,
      "black_smoke"
    ) &&
    hasSignal(
      extracted_signals,
      "fuel_smell"
    )
  ) {
    scoreSystem(
      scores,

      "fuel_combustion",

      4,

      "Black smoke together with fuel odor creates a stronger rich/raw-fuel combustion pattern.",

      "black_smoke_plus_fuel_smell"
    );
  }

  if (
    hasSignal(
      extracted_signals,
      "rough_idle"
    ) ||
    hasSignal(
      extracted_signals,
      "acceleration_issue"
    )
  ) {
    scoreSystem(
      scores,

      "engine_performance",

      3,

      "Roughness or acceleration loss supports a general engine-performance direction.",

      "engine_performance_behavior"
    );
  }

  /* ----------------------------------------------------------
     IGNITION / MISFIRE
     ---------------------------------------------------------- */

  if (
    hasSignal(
      extracted_signals,
      "rough_idle"
    )
  ) {
    scoreSystem(
      scores,

      "ignition_misfire",

      4,

      "Rough idle supports unstable cylinder contribution or combustion quality.",

      "rough_idle"
    );
  }

  if (
    hasSignal(
      extracted_signals,
      "vibration"
    ) &&
    hasSignal(
      extracted_signals,
      "load_sensitive"
    )
  ) {
    scoreSystem(
      scores,

      "ignition_misfire",

      3,

      "Load-sensitive shaking can expose ignition or combustion weakness under cylinder pressure.",

      "load_sensitive_shake"
    );
  }

  if (flashingCel) {
    scoreSystem(
      scores,

      "ignition_misfire",

      8,

      "A flashing check-engine warning strongly supports an active misfire/combustion-risk path.",

      "flashing_cel"
    );
  }

  if (
    flashingCel &&
    (
      hasSignal(
        extracted_signals,
        "fuel_smell"
      ) ||
      hasSignal(
        extracted_signals,
        "acceleration_issue"
      ) ||
      hasSignal(
        extracted_signals,
        "load_sensitive"
      )
    )
  ) {
    scoreSystem(
      scores,

      "ignition_misfire",

      3,

      "Flashing check-engine behavior combined with fuel or load symptoms strengthens the misfire path.",

      "flashing_cel_plus_load_or_fuel"
    );
  }

  /* ----------------------------------------------------------
     COOLING
     ---------------------------------------------------------- */

  if (
    hasSignal(
      extracted_signals,
      "overheating"
    )
  ) {
    scoreSystem(
      scores,

      "cooling_overheat",

      9,

      "Positive overheating behavior makes cooling-system verification a high-priority path.",

      "overheating"
    );
  }

  if (
    hasSignal(
      extracted_signals,
      "coolant_loss"
    )
  ) {
    scoreSystem(
      scores,

      "cooling_overheat",

      5,

      "Coolant loss materially strengthens the cooling-system direction.",

      "coolant_loss"
    );
  }

  if (
    Array.isArray(
      behavior_relationships
    ) &&
    behavior_relationships.includes(
      "airflow_dependent_cooling_pattern"
    )
  ) {
    scoreSystem(
      scores,

      "cooling_overheat",

      5,

      "Temperature behavior that improves with vehicle motion supports an airflow/fan-dependent cooling pattern.",

      "airflow_dependent_cooling_pattern"
    );
  }

  if (
    negative.coolingDenied
  ) {
    penalizeSystem(
      scores,

      "cooling_overheat",

      10,

      "Overheating is explicitly denied in the current session.",

      "overheating_denied"
    );
  }

  /* ----------------------------------------------------------
     BRAKES
     ---------------------------------------------------------- */

  if (
    hasSignal(
      extracted_signals,
      "braking_issue"
    )
  ) {
    scoreSystem(
      scores,

      "brake_safety",

      8,

      "A braking-specific symptom keeps the case on the brake-system path.",

      "braking_issue"
    );
  }

  if (
    hasSignal(
      extracted_signals,
      "critical_braking_issue"
    ) ||
    criticalBrakeLanguage
  ) {
    scoreSystem(
      scores,

      "brake_safety",

      15,

      "Critical brake-control language requires immediate safety priority.",

      "critical_brake_behavior"
    );
  }

  /* ----------------------------------------------------------
     STARTING / CHARGING
     ---------------------------------------------------------- */

  if (
    hasSignal(
      extracted_signals,
      "no_crank"
    )
  ) {
    scoreSystem(
      scores,

      "electrical_starting",

      10,

      "No-crank behavior prioritizes battery, cable, starter, relay, authorization, and control-path testing.",

      "no_crank"
    );
  }

  if (
    hasSignal(
      extracted_signals,
      "slow_crank"
    )
  ) {
    scoreSystem(
      scores,

      "electrical_starting",

      8,

      "Slow cranking supports battery, voltage-drop, cable, ground, or starter-load investigation.",

      "slow_crank"
    );
  }

  if (
    hasSignal(
      extracted_signals,
      "startup_issue"
    ) &&
    !hasSignal(
      extracted_signals,
      "no_crank"
    ) &&
    !hasSignal(
      extracted_signals,
      "slow_crank"
    )
  ) {
    scoreSystem(
      scores,

      "electrical_starting",

      3,

      "A starting complaint keeps crank-state separation active before individual component ranking.",

      "startup_issue"
    );
  }

  if (
    hasAffirmedAny(
      raw_input,
      [
        "cranks but won't start",
        "cranks but does not start",
        "crank no start",
        "turns over but won't start",
        "turns over but does not start",
      ]
    )
  ) {
    scoreSystem(
      scores,

      "engine_performance",

      4,

      "Crank-no-start behavior requires fuel, ignition, compression, injector-pulse, and engine-signal separation.",

      "crank_no_start"
    );
  }

  /* ----------------------------------------------------------
     TRANSMISSION / DRIVETRAIN
     ---------------------------------------------------------- */

  if (
    transmissionEvidence
  ) {
    scoreSystem(
      scores,

      "transmission_drivetrain",

      8,

      "Transmission-specific behavior supports shift, hydraulic, clutch, converter, or driveline verification.",

      "transmission_specific_behavior"
    );
  }

  if (
    hasSignal(
      extracted_signals,
      "vibration"
    ) &&
    hasSignal(
      extracted_signals,
      "load_sensitive"
    )
  ) {
    scoreSystem(
      scores,

      "transmission_drivetrain",

      4,

      "Load-sensitive vibration keeps axle, mount, driveline, and torque-delivery causes active.",

      "load_sensitive_vibration"
    );
  }

  if (
    hasSignal(
      extracted_signals,
      "vibration"
    ) &&
    hasSignal(
      extracted_signals,
      "speed_sensitive"
    )
  ) {
    scoreSystem(
      scores,

      "transmission_drivetrain",

      4,

      "Vehicle-speed-sensitive vibration supports wheel-end or driveline rotation-related investigation.",

      "speed_sensitive_vibration"
    );
  }

  /* ----------------------------------------------------------
     NETWORK / MODULES
     ---------------------------------------------------------- */

  if (
    networkEvidence
  ) {
    scoreSystem(
      scores,

      "network_modules",

      11,

      "Communication/U-code evidence requires network, power, ground, termination, and module-wake verification.",

      "network_communication_evidence"
    );
  }

  /* ----------------------------------------------------------
     SRS
     ---------------------------------------------------------- */

  if (
    srsEvidence
  ) {
    scoreSystem(
      scores,

      "safety_restraint",

      10,

      "SRS warning evidence requires restraint-system diagnostic priority.",

      "srs_warning"
    );
  }

  /* ----------------------------------------------------------
     STEERING / EPS
     ---------------------------------------------------------- */

  if (
    steeringEvidence
  ) {
    scoreSystem(
      scores,

      "steering_eps",

      9,

      "EPS or steering calibration evidence requires steering-system prioritization.",

      "steering_eps_evidence"
    );
  }

  /* ----------------------------------------------------------
     CANONICAL DOMINANT-SYSTEM HINTS

     These hints receive only small weight so they cannot
     overwhelm the underlying observations that created them.
     ---------------------------------------------------------- */

  if (
    listIncludesAny(
      dominant_systems,
      ["fuel"]
    )
  ) {
    scoreSystem(
      scores,

      "fuel_combustion",

      1,

      "Canonical signal routing also points toward fuel/combustion.",

      "dominant_system_fuel"
    );
  }

  if (
    listIncludesAny(
      dominant_systems,
      ["ignition"]
    )
  ) {
    scoreSystem(
      scores,

      "ignition_misfire",

      1,

      "Canonical signal routing also points toward ignition/combustion.",

      "dominant_system_ignition"
    );
  }

  if (
    listIncludesAny(
      dominant_systems,
      ["cooling"]
    )
  ) {
    scoreSystem(
      scores,

      "cooling_overheat",

      1,

      "Canonical signal routing also points toward cooling.",

      "dominant_system_cooling"
    );
  }

  if (
    listIncludesAny(
      dominant_systems,
      ["brakes"]
    )
  ) {
    scoreSystem(
      scores,

      "brake_safety",

      1,

      "Canonical signal routing also points toward brakes.",

      "dominant_system_brakes"
    );
  }

  if (
    listIncludesAny(
      dominant_systems,
      [
        "starting_charging",
        "electrical",
      ]
    )
  ) {
    scoreSystem(
      scores,

      "electrical_starting",

      1,

      "Canonical signal routing also points toward starting/charging.",

      "dominant_system_starting"
    );
  }

  /* ----------------------------------------------------------
     RISK FLAGS
     ---------------------------------------------------------- */

  if (
    hasRisk(
      risk_flags,
      [
        "possible_unburned_fuel_risk",
        "possible_rich_combustion_risk",
        "raw_fuel",
        "catalytic",
      ]
    )
  ) {
    scoreSystem(
      scores,

      "fuel_combustion",

      2,

      "Risk context supports continued fuel/combustion verification.",

      "fuel_risk_context"
    );
  }

  if (
    hasRisk(
      risk_flags,
      [
        "engine_overheat_damage_risk",
        "cooling_system_loss_risk",
        "engine_damage",
      ]
    ) &&
    !negative.coolingDenied
  ) {
    scoreSystem(
      scores,

      "cooling_overheat",

      2,

      "Risk context increases cooling-system priority.",

      "cooling_risk_context"
    );
  }

  if (
    hasRisk(
      risk_flags,
      [
        "critical_brake_control_risk",
        "brake_inspection_required",
        "brake_safety",
      ]
    )
  ) {
    scoreSystem(
      scores,

      "brake_safety",

      2,

      "Risk context preserves brake-system priority.",

      "brake_risk_context"
    );
  }

  /* ----------------------------------------------------------
     NEGATIVE EVIDENCE PROTECTION
     ---------------------------------------------------------- */

  if (
    negative.smokeDenied
  ) {
    penalizeSystem(
      scores,

      "fuel_combustion",

      2,

      "Smoke is explicitly denied and cannot support a smoke-driven fuel diagnosis.",

      "smoke_denied"
    );
  }

  if (
    negative.fuelSmellDenied
  ) {
    penalizeSystem(
      scores,

      "fuel_combustion",

      3,

      "Fuel odor is explicitly denied and cannot support a raw-fuel diagnosis.",

      "fuel_smell_denied"
    );
  }

  if (
    negative.vibrationDenied
  ) {
    penalizeSystem(
      scores,

      "transmission_drivetrain",

      2,

      "Vibration is explicitly denied and cannot support a vibration-driven drivetrain theory.",

      "vibration_denied"
    );
  }

  /* ----------------------------------------------------------
     COMPATIBILITY-ONLY CONTEXTUAL LABELS

     These are derived labels, not independent evidence.
     They receive only minimal weight.
     ---------------------------------------------------------- */

  if (
    listIncludesAny(
      dominant_signals,
      [
        "can / module communication",
        "module communication",
      ]
    )
  ) {
    scoreSystem(
      scores,

      "network_modules",

      1,

      "Derived diagnostic context also identifies network communication.",

      "dominant_signal_network"
    );
  }

  if (
    listIncludesAny(
      dominant_signals,
      [
        "srs",
        "airbag",
      ]
    )
  ) {
    scoreSystem(
      scores,

      "safety_restraint",

      1,

      "Derived diagnostic context also identifies SRS/restraint involvement.",

      "dominant_signal_srs"
    );
  }

  if (
    listIncludesAny(
      dominant_signals,
      [
        "steering",
        "eps",
      ]
    )
  ) {
    scoreSystem(
      scores,

      "steering_eps",

      1,

      "Derived diagnostic context also identifies steering/EPS involvement.",

      "dominant_signal_steering"
    );
  }

  return {
    scores,

    negative,

    safety_context: {
      critical_brake_language:
        criticalBrakeLanguage,

      severity,
    },
  };
}

/* ============================================================
   RANKING
   ============================================================ */

function rankSystems(
  scores = {}
) {
  return Object.entries(
    scores
  )
    .map(
      ([system, data]) => ({
        system,

        report_system:
          REPORT_SYSTEM_MAP[
            system
          ] ||
          "general",

        score:
          Math.max(
            0,
            data.score
          ),

        evidence_count:
          data.evidence_keys
            ? [
                ...data.evidence_keys,
              ].filter(
                (key) =>
                  !String(
                    key
                  ).startsWith(
                    "penalty:"
                  )
              ).length
            : 0,

        reasons: [
          ...new Set(
            data.reasons ||
              []
          ),
        ],

        penalties: [
          ...new Set(
            data.penalties ||
              []
          ),
        ],
      })
    )
    .filter(
      (item) =>
        item.score >
        0
    )
    .sort(
      (a, b) => {
        if (
          b.score !==
          a.score
        ) {
          return (
            b.score -
            a.score
          );
        }

        return (
          b.evidence_count -
          a.evidence_count
        );
      }
    );
}

/* ============================================================
   ROUTING STRENGTH
   ============================================================ */

function determineLockLevel({
  top,
  second,
  extractedSignals,
  riskFlags,
}) {
  const topScore =
    top?.score ||
    0;

  const lead =
    topScore -
    (
      second?.score ||
      0
    );

  const criticalSafety =
    hasSignal(
      extractedSignals,
      "critical_braking_issue"
    ) ||
    hasRisk(
      riskFlags,
      [
        "critical_brake_control_risk",
      ]
    );

  /*
   * CRITICAL describes routing / safety priority only.
   *
   * It does NOT mean diagnostic certainty.
   */
  if (
    criticalSafety
  ) {
    return LOCK_LEVELS.CRITICAL;
  }

  if (
    topScore >= 12 &&
    top.evidence_count >= 2 &&
    lead >= 4
  ) {
    return LOCK_LEVELS.STRONG;
  }

  if (
    topScore >= 6 &&
    top.evidence_count >= 1
  ) {
    return LOCK_LEVELS.MODERATE;
  }

  return LOCK_LEVELS.WEAK;
}

function shouldCreateAnchor(
  top,
  lockLevel
) {
  if (
    !top ||
    top.system === "general"
  ) {
    return false;
  }

  if (
    lockLevel ===
    LOCK_LEVELS.CRITICAL
  ) {
    return true;
  }

  return (
    top.score >=
    6
  );
}

/* ============================================================
   DIRECTION DESCRIPTIONS
   ============================================================ */

function buildLockedDirection(
  topSystem,
  rankedSystems = []
) {
  const secondary =
    rankedSystems
      .slice(
        1,
        3
      )
      .map(
        (item) =>
          item.system
      );

  const map = {
    fuel_combustion: {
      title:
        "Fuel / combustion diagnostic direction",

      primary_focus:
        "Prioritize mixture control, injector behavior, fuel pressure, raw-fuel evidence, sensor feedback, and combustion quality before unrelated systems.",

      avoid_drift:
        "Do not authorize injector, sensor, pump, or regulator replacement until testing isolates the failed branch.",
    },

    ignition_misfire: {
      title:
        "Ignition / combustion stability direction",

      primary_focus:
        "Prioritize cylinder contribution, spark quality, plug/coil behavior, load sensitivity, and misfire verification.",

      avoid_drift:
        "Do not convert a misfire pattern directly into a coil or spark-plug replacement without cylinder-level evidence.",
    },

    engine_performance: {
      title:
        "Engine-performance diagnostic direction",

      primary_focus:
        "Prioritize the operating condition that reproduces the performance loss and separate airflow, fuel, ignition, engine-signal, and mechanical causes.",

      avoid_drift:
        "Do not select a component merely because it is common for the symptom; verify the branch that fails under the reported condition.",
    },

    cooling_overheat: {
      title:
        "Cooling / heat-rejection diagnostic direction",

      primary_focus:
        "Prioritize coolant integrity, fan/airflow behavior, thermostat/flow, radiator heat rejection, pump performance, pressure retention, and combustion-gas verification where appropriate.",

      avoid_drift:
        "Do not minimize positive overheating evidence, but do not call any cooling component failed without direct verification.",
    },

    brake_safety: {
      title:
        "Brake-system safety direction",

      primary_focus:
        "Prioritize pedal behavior, hydraulic integrity, friction components, rotor behavior, ABS activity, wheel-end faults, and stopping-control risk.",

      avoid_drift:
        "Do not reclassify a braking-specific symptom as generic vibration until brake-system risk is separated.",
    },

    electrical_starting: {
      title:
        "Starting / electrical diagnostic direction",

      primary_focus:
        "Separate no-crank, slow-crank, and normal-crank/no-start behavior before ranking battery, cable, starter, relay, authorization, fuel, ignition, or engine-signal causes.",

      avoid_drift:
        "Do not jump from a starting complaint to battery or starter replacement without voltage, crank-state, and circuit evidence.",
    },

    transmission_drivetrain: {
      title:
        "Transmission / drivetrain diagnostic direction",

      primary_focus:
        "Separate shift behavior, RPM change, vehicle-speed dependency, load sensitivity, hydraulic behavior, mounts, axles, converter, and driveline rotation.",

      avoid_drift:
        "Do not label a vibration as transmission failure or wheel balance until RPM, load, braking, and vehicle-speed relationships are separated.",
    },

    network_modules: {
      title:
        "CAN / module communication diagnostic direction",

      primary_focus:
        "Prioritize network integrity, module power/ground, wake-up behavior, communication faults, termination, and wiring before module replacement.",

      avoid_drift:
        "Do not replace a control module merely because it reports or receives U-codes; validate network and module power/ground first.",
    },

    safety_restraint: {
      title:
        "SRS / restraint diagnostic direction",

      primary_focus:
        "Prioritize exact SRS fault codes, restraint circuits, power/ground history, clock spring, pretensioner, occupancy, sensor, and module communication evidence.",

      avoid_drift:
        "Do not clear or replace restraint components without exact fault-code and circuit verification.",
    },

    steering_eps: {
      title:
        "Steering / EPS diagnostic direction",

      primary_focus:
        "Prioritize steering effort, EPS warnings, torque/angle inputs, calibration state, voltage integrity, alignment, and mechanical binding.",

      avoid_drift:
        "Do not replace a rack, sensor, or module until calibration, power/ground, alignment, and mechanical conditions are separated.",
    },
  };

  const fallback = {
    title:
      "General diagnostic direction",

    primary_focus:
      "Keep diagnosis centered on the strongest observed behavior and use the next highest-value discriminator when evidence is incomplete.",

    avoid_drift:
      "Do not guess randomly or allow a generic follow-up answer to erase stronger earlier evidence.",
  };

  return {
    ...(
      map[topSystem] ||
      fallback
    ),

    secondary_systems:
      secondary,
  };
}

/* ============================================================
   FOLLOW-UP STRATEGY
   ============================================================ */

function buildFollowUpStrategy(
  topSystem
) {
  const strategy = {
    fuel_combustion: [
      "If unresolved, separate black-smoke/rich behavior from unburned-fuel odor and incomplete combustion.",

      "If unresolved, identify whether the symptom changes at idle, under load, or after warm-up.",

      "Use testing to separate injector leakage, fuel-pressure control, mixture feedback, and ignition burn quality.",
    ],

    ignition_misfire: [
      "If unresolved, separate idle misfire from load-dependent misfire.",

      "If available, use code/cylinder data rather than guessing a coil or plug.",

      "Confirm whether vibration follows engine RPM/load rather than vehicle speed.",
    ],

    engine_performance: [
      "Identify the operating condition that reproduces power loss most consistently.",

      "Separate RPM/load behavior from vehicle-speed behavior.",

      "Use the first test that can distinguish airflow, fuel, ignition, signal, or mechanical causes.",
    ],

    cooling_overheat: [
      "If unresolved, separate idle/stopped overheating from road-speed overheating.",

      "Confirm coolant loss, fan/airflow behavior, heater behavior, and when temperature returns toward normal.",

      "Use non-invasive testing before component replacement.",
    ],

    brake_safety: [
      "Clarify whether the symptom occurs only under braking.",

      "Separate pedal/hydraulic symptoms from rotor, ABS, wheel-end, or suspension effects.",

      "Escalate immediately when stopping control is reduced.",
    ],

    electrical_starting: [
      "Separate no-crank, slow-crank, and normal-crank/no-start first.",

      "Use voltage-drop, battery, starter, relay, authorization, or engine-signal testing according to crank state.",

      "Do not substitute parts for circuit verification.",
    ],

    transmission_drivetrain: [
      "Separate RPM flare from vehicle-speed vibration and load-sensitive shudder.",

      "Identify whether the event occurs during a specific shift, gear, throttle condition, or temperature state.",

      "Verify hydraulic/electronic transmission evidence before internal-failure conclusions.",
    ],

    network_modules: [
      "Determine whether communication loss affects one module or multiple modules.",

      "Verify battery voltage, module power/ground, bus resistance, and communication before replacing modules.",

      "Use network evidence to isolate wiring, termination, or module-specific faults.",
    ],

    safety_restraint: [
      "Obtain the exact SRS code before component conclusions.",

      "Consider recent battery, seat, steering-wheel, or collision-related work only when actually supplied.",

      "Treat restraint components as unconfirmed until circuit evidence supports them.",
    ],

    steering_eps: [
      "Clarify steering effort, warning behavior, pull, centering, and recent calibration/alignment work.",

      "Separate mechanical binding from EPS input/calibration problems.",

      "Verify voltage, angle/torque data, and calibration before component replacement.",
    ],
  };

  return (
    strategy[topSystem] ||
    [
      "Ask only the question that best separates the remaining diagnostic branches.",

      "Prioritize safety-critical uncertainty first.",

      "Do not repeat previously answered questions.",
    ]
  );
}

/* ============================================================
   PUBLIC API
   ============================================================ */

export function buildDominantLock(
  context = {}
) {
  const {
    extracted_signals = {},
    dominant_systems = [],
    severity = "low",
    risk_flags = [],
    dominant_signals = [],
    raw_input = "",
    negated_signals = {},
    behavior_relationships = [],
    signal_evidence = {},
  } = context;

  const scoring =
    buildSystemScores({
      extracted_signals,
      dominant_systems,
      severity,
      risk_flags,
      dominant_signals,
      raw_input,
      negated_signals,
      behavior_relationships,
    });

  const ranked =
    rankSystems(
      scoring.scores
    );

  const top =
    ranked[0] ||
    {
      system:
        "general",

      report_system:
        "general",

      score:
        0,

      evidence_count:
        0,

      reasons:
        [],

      penalties:
        [],
    };

  const second =
    ranked[1] ||
    {
      system:
        "general",

      report_system:
        "general",

      score:
        0,

      evidence_count:
        0,

      reasons:
        [],

      penalties:
        [],
    };

  const lockLevel =
    determineLockLevel({
      top,

      second,

      extractedSignals:
        extracted_signals,

      riskFlags:
        risk_flags,
    });

  const locked =
    shouldCreateAnchor(
      top,
      lockLevel
    );

  const lockedDirection =
    buildLockedDirection(
      top.system,
      ranked
    );

  const scoreLead =
    Math.max(
      0,
      top.score -
        second.score
    );

  return {
    /* --------------------------------------------------------
       BACKWARD-COMPATIBLE FIELDS
       -------------------------------------------------------- */

    locked,

    lock_level:
      lockLevel,

    locked_system:
      locked
        ? top.system
        : "general",

    locked_title:
      locked
        ? lockedDirection.title
        : "General diagnostic direction",

    primary_focus:
      lockedDirection.primary_focus,

    avoid_drift:
      lockedDirection.avoid_drift,

    secondary_systems:
      lockedDirection.secondary_systems,

    ranked_systems:
      ranked,

    follow_up_strategy:
      buildFollowUpStrategy(
        top.system
      ),

    /* --------------------------------------------------------
       NEW EXPLICIT SEMANTICS
       -------------------------------------------------------- */

    routing_anchor:
      locked
        ? top.system
        : "general",

    report_system:
      locked
        ? top.report_system
        : "general",

    routing_strength:
      lockLevel,

    top_score:
      top.score,

    score_lead:
      scoreLead,

    evidence_count:
      top.evidence_count,

    negative_evidence:
      scoring.negative,

    safety_priority:
      lockLevel ===
      LOCK_LEVELS.CRITICAL,

    signal_evidence,

    /* --------------------------------------------------------
       GUARDRAILS
       -------------------------------------------------------- */

    reasoning_guardrail:
      "Use this as a routing anchor, not a final diagnosis. Preserve the strongest evidence until later evidence genuinely contradicts it. A later generic answer must not erase a stronger earlier observation, but stronger contradictory evidence must be allowed to change the ranking.",

    mechanic_instruction:
      "This anchor guides diagnostic direction only. Do not describe a component as confirmed failed unless direct measurements, scan data, inspection evidence, or another explicit verification step proves the failure.",

    drift_protection:
      "Safety-critical or highly discriminating evidence must remain visible in ranking. Do not let derived labels, common-failure assumptions, or low-information follow-up answers outrank direct observed behavior.",

    confidence_boundary:
      "Routing strength is not user-facing diagnostic confidence. Final confidence must be calculated separately from evidence quality, independence, contradictions, and verification status.",
  };
}
