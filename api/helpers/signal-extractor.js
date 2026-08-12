/* ============================================================
   DRIVESHIFT — SIGNAL EXTRACTOR
   ============================================================

   Purpose:
   - Convert raw owner language into conservative mechanical signals.
   - Detect meaningful positive observations.
   - Detect local negation such as:
       "no smoke"
       "not overheating"
       "doesn't shake"
       "without fuel smell"
   - Avoid treating negated symptoms as present.
   - Preserve compatibility with existing DriveShift helpers.
   - Provide traceable signal metadata for later confidence logic.

   IMPORTANT:
   This module does NOT diagnose a failed component.

   It extracts behavioral signals only.

   A detected signal is:
   OBSERVED LANGUAGE EVIDENCE
   not
   CONFIRMED MECHANICAL FAILURE.
   ============================================================ */

/* ============================================================
   SIGNAL DEFINITIONS
   ============================================================ */

const SIGNAL_DEFINITIONS = Object.freeze({
  /* ----------------------------------------------------------
     SMOKE
     ---------------------------------------------------------- */

  smoke: {
    patterns: [
      "smoke",
      "smoking",
      "heavy smoke",
      "lots of smoke",
      "visible smoke",
    ],
  },

  black_smoke: {
    patterns: [
      "black smoke",
      "dark smoke",
      "sooty smoke",
    ],
  },

  white_smoke: {
    patterns: [
      "white smoke",
      "thick white smoke",
    ],
  },

  blue_smoke: {
    patterns: [
      "blue smoke",
      "bluish smoke",
      "blue-gray smoke",
      "blue grey smoke",
    ],
  },

  severe_smoke: {
    patterns: [
      "heavy smoke",
      "thick smoke",
      "cloud of smoke",
      "lots of smoke",
      "smoke pouring out",
      "smoke everywhere",
    ],
  },

  /* ----------------------------------------------------------
     ODOR / FUEL
     ---------------------------------------------------------- */

  fuel_smell: {
    patterns: [
      "fuel smell",
      "smells like fuel",
      "smell of fuel",
      "gas smell",
      "smells like gas",
      "gasoline smell",
      "smells like gasoline",
      "raw fuel smell",
      "strong fuel odor",
      "strong gasoline odor",
    ],
  },

  /* ----------------------------------------------------------
     COOLING / TEMPERATURE
     ---------------------------------------------------------- */

  overheating: {
    patterns: [
      "overheating",
      "overheats",
      "running hot",
      "runs hot",
      "temperature is high",
      "temperature gets high",
      "temperature goes high",
      "temperature rises",
      "temperature climbs",
      "temp rises",
      "temp climbs",
      "high temperature",
      "high temp",
      "coolant boiling",
      "coolant boils",
      "engine gets hot",
      "engine is too hot",
      "temperature gauge in red",
      "temperature gauge goes red",
    ],
  },

  coolant_loss: {
    patterns: [
      "losing coolant",
      "loses coolant",
      "coolant loss",
      "coolant disappearing",
      "coolant level drops",
      "coolant keeps dropping",
      "coolant leak",
      "leaking coolant",
    ],
  },

  heat_related: {
    patterns: [
      "after warming up",
      "once warmed up",
      "when hot",
      "when engine is hot",
      "when the engine is hot",
      "after driving",
      "only when warm",
      "only when hot",
      "after 20 minutes",
      "after twenty minutes",
      "after it warms up",
    ],
  },

  cold_related: {
    patterns: [
      "when cold",
      "only when cold",
      "cold start",
      "first start of the day",
      "when engine is cold",
      "when the engine is cold",
    ],
  },

  /* ----------------------------------------------------------
     VIBRATION / ROUGHNESS
     ---------------------------------------------------------- */

  vibration: {
    patterns: [
      "vibration",
      "vibrating",
      "vibrates",
      "shaking",
      "shakes",
      "vehicle shakes",
      "car shakes",
      "engine shakes",
      "steering wheel shakes",
    ],
  },

  rough_idle: {
    patterns: [
      "rough idle",
      "idles rough",
      "idle is rough",
      "unstable idle",
      "idle fluctuates",
      "idle hunts",
      "misfire at idle",
      "engine shakes at idle",
      "shakes at idle",
    ],
  },

  /* ----------------------------------------------------------
     PERFORMANCE / ACCELERATION
     ---------------------------------------------------------- */

  acceleration_issue: {
    patterns: [
      "hesitation",
      "hesitates",
      "hesitates accelerating",
      "hesitates on acceleration",
      "loss of power",
      "loses power",
      "low power",
      "poor acceleration",
      "slow acceleration",
      "bogging",
      "bogs down",
      "stumbles",
      "stumbles on acceleration",
      "won't accelerate",
      "will not accelerate",
      "doesn't accelerate",
      "does not accelerate",
    ],
  },

  load_sensitive: {
    patterns: [
      "under load",
      "when accelerating",
      "during acceleration",
      "while accelerating",
      "going uphill",
      "uphill",
      "under heavy throttle",
      "at higher rpm",
      "higher rpm",
      "gets worse accelerating",
      "worse under load",
      "only under load",
    ],
  },

  speed_sensitive: {
    patterns: [
      "at highway speed",
      "highway speed",
      "at higher speed",
      "at high speed",
      "with vehicle speed",
      "gets worse with speed",
      "worse with speed",
      "only at speed",
    ],
  },

  /* ----------------------------------------------------------
     BRAKES
     ---------------------------------------------------------- */

  braking_issue: {
    patterns: [
      "brake vibration",
      "vibration while braking",
      "vibrates while braking",
      "brake shake",
      "shakes when braking",
      "steering wheel shakes when braking",
      "pulls when braking",
      "pulls to one side when braking",
      "brake pulsation",
      "brake pedal pulsates",
      "brake pedal pulses",
    ],
  },

  critical_braking_issue: {
    patterns: [
      "no brakes",
      "brakes failed",
      "brake failure",
      "lost brakes",
      "lost braking",
      "brake pedal goes to floor",
      "pedal goes to the floor",
      "brake pedal sinks to floor",
      "cannot stop",
      "can't stop",
      "car won't stop",
      "vehicle won't stop",
    ],
  },

  /* ----------------------------------------------------------
     STARTING
     ---------------------------------------------------------- */

  startup_issue: {
    patterns: [
      "hard start",
      "hard to start",
      "difficult to start",
      "won't start",
      "will not start",
      "doesn't start",
      "does not start",
      "crank no start",
      "cranks but won't start",
      "cranks but does not start",
      "long crank",
      "long cranking",
      "slow start",
      "starts then dies",
      "starts and dies",
    ],
  },

  no_crank: {
    patterns: [
      "no crank",
      "won't crank",
      "will not crank",
      "doesn't crank",
      "does not crank",
      "nothing happens when i turn the key",
      "nothing happens when i press start",
      "starter does not turn",
      "starter doesn't turn",
    ],
  },

  slow_crank: {
    patterns: [
      "slow crank",
      "cranks slowly",
      "cranking slowly",
      "starter turns slowly",
      "engine turns over slowly",
    ],
  },

  /* ----------------------------------------------------------
     INTERMITTENCY
     ---------------------------------------------------------- */

  intermittent: {
    patterns: [
      "sometimes",
      "intermittent",
      "intermittently",
      "randomly",
      "occasionally",
      "comes and goes",
      "not every time",
      "once in a while",
    ],
  },

  /* ----------------------------------------------------------
     AIRFLOW / VEHICLE MOTION
     ---------------------------------------------------------- */

  improves_with_speed: {
    patterns: [
      "gets better when driving",
      "improves when driving",
      "temperature drops when driving",
      "temperature comes down when moving",
      "cools down when moving",
      "better at highway speed",
      "normal on highway",
      "normal while driving",
      "only overheats at idle",
      "only overheats when stopped",
    ],
  },

  idle_or_stopped_related: {
    patterns: [
      "at idle",
      "while idling",
      "when idling",
      "when stopped",
      "while stopped",
      "sitting in traffic",
      "in traffic",
      "at a stop light",
      "at a stoplight",
    ],
  },
});

/* ============================================================
   NEGATION LANGUAGE
   ============================================================ */

const NEGATION_PATTERNS = Object.freeze([
  "no",
  "not",
  "never",
  "without",
  "none",
  "neither",
  "nor",

  "don't",
  "doesn't",
  "didn't",
  "isn't",
  "wasn't",
  "weren't",
  "hasn't",
  "haven't",
  "hadn't",
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
  "had not",
]);

/*
 * These expressions often terminate the semantic scope of a prior
 * statement and start a contrasting clause.
 */
const CLAUSE_BREAK_PATTERN =
  /\b(?:but|however|although|though|except|yet)\b|[.!?;,\n]/gi;

/* ============================================================
   NORMALIZATION
   ============================================================ */

function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForComparison(value = "") {
  return normalizeText(value)
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ============================================================
   CLAUSE SPLITTING
   ============================================================ */

function splitIntoClauses(text = "") {
  const normalized = normalizeText(text);

  if (!normalized) {
    return [];
  }

  return normalized
    .split(CLAUSE_BREAK_PATTERN)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

/* ============================================================
   PHRASE MATCHING
   ============================================================ */

function containsPhrase(clause, phrase) {
  const cleanClause = normalizeForComparison(clause);
  const cleanPhrase = normalizeForComparison(phrase);

  if (!cleanClause || !cleanPhrase) {
    return false;
  }

  /*
   * Boundary-aware matching prevents weak substring collisions.
   *
   * Example:
   * "hot" should not match an unrelated longer token.
   */
  const pattern = new RegExp(
    `(^|\\s)${escapeRegExp(cleanPhrase)}(?=\\s|$)`,
    "i",
  );

  return pattern.test(cleanClause);
}

/* ============================================================
   NEGATION DETECTION
   ============================================================ */

function isPatternNegated(clause, phrase) {
  const cleanClause = normalizeForComparison(clause);
  const cleanPhrase = normalizeForComparison(phrase);

  if (!cleanClause || !cleanPhrase) {
    return false;
  }

  const phraseIndex = cleanClause.indexOf(cleanPhrase);

  if (phraseIndex < 0) {
    return false;
  }

  /*
   * Inspect a limited lexical window before the symptom phrase.
   *
   * We intentionally avoid treating any negation anywhere in the
   * sentence as controlling the symptom.
   *
   * Example:
   * "No warning lights but the engine is overheating"
   *
   * After clause splitting:
   * - "no warning lights"
   * - "the engine is overheating"
   *
   * The second clause remains positive.
   */
  const before = cleanClause
    .slice(0, phraseIndex)
    .trim();

  if (!before) {
    return false;
  }

  const words = before
    .split(/\s+/)
    .filter(Boolean);

  const recentWords = words
    .slice(-5)
    .join(" ");

  return NEGATION_PATTERNS.some((negation) => {
    const normalizedNegation =
      normalizeForComparison(negation);

    if (!normalizedNegation) {
      return false;
    }

    const negationPattern =
      new RegExp(
        `(^|\\s)${escapeRegExp(
          normalizedNegation
        )}(?=\\s|$)`,
        "i"
      );

    return negationPattern.test(recentWords);
  });
}

/* ============================================================
   SIGNAL DETECTION
   ============================================================ */

function detectSignalFromClauses(
  signal,
  definition,
  clauses
) {
  const positiveMatches = [];
  const negatedMatches = [];

  for (const clause of clauses) {
    for (const pattern of definition.patterns) {
      if (!containsPhrase(clause, pattern)) {
        continue;
      }

      const match = {
        signal,
        pattern,
        clause,
      };

      if (isPatternNegated(clause, pattern)) {
        negatedMatches.push(match);
      } else {
        positiveMatches.push(match);
      }
    }
  }

  /*
   * Positive evidence wins when both positive and negative clauses
   * exist in the same session.
   *
   * Example:
   * "It doesn't smoke at idle, but it smokes under acceleration."
   *
   * Smoke is present under one condition, so signal = true.
   */
  return {
    detected: positiveMatches.length > 0,
    positiveMatches,
    negatedMatches,
  };
}

function detectSignals(text = "") {
  const clauses = splitIntoClauses(text);

  const signals = {};
  const evidence = {};
  const negatedSignals = {};

  for (
    const [signal, definition]
    of Object.entries(SIGNAL_DEFINITIONS)
  ) {
    const result =
      detectSignalFromClauses(
        signal,
        definition,
        clauses
      );

    signals[signal] =
      result.detected;

    if (result.positiveMatches.length) {
      evidence[signal] =
        result.positiveMatches;
    }

    if (
      !result.detected &&
      result.negatedMatches.length
    ) {
      negatedSignals[signal] =
        result.negatedMatches;
    }
  }

  /*
   * Smoke compatibility:
   *
   * A color-specific smoke observation must also activate the
   * broad legacy "smoke" signal even when the word pattern matched
   * only a specific subtype.
   */
  if (
    signals.black_smoke ||
    signals.white_smoke ||
    signals.blue_smoke ||
    signals.severe_smoke
  ) {
    signals.smoke = true;
  }

  return {
    signals,
    evidence,
    negatedSignals,
  };
}

/* ============================================================
   DOMINANT SYSTEM HEURISTICS
   ============================================================ */

function determineDominantSystems(signals) {
  const scoredSystems = new Map();

  const add = (system, weight = 1) => {
    scoredSystems.set(
      system,
      (scoredSystems.get(system) || 0) +
        weight
    );
  };

  /*
   * Fuel / combustion direction.
   */
  if (signals.black_smoke) {
    add("fuel", 3);
    add("engine_performance", 2);
  }

  if (signals.fuel_smell) {
    add("fuel", 3);
  }

  if (signals.acceleration_issue) {
    add("engine_performance", 2);
    add("fuel", 1);
    add("ignition", 1);
  }

  /*
   * White smoke is intentionally NOT routed directly to fuel.
   *
   * White exhaust smoke may require cooling/combustion
   * discrimination.
   */
  if (signals.white_smoke) {
    add("cooling", 2);
    add("engine_performance", 1);
  }

  /*
   * Blue smoke suggests an oil-consumption / internal-engine
   * direction rather than fuel delivery.
   */
  if (signals.blue_smoke) {
    add("engine_performance", 3);
  }

  /*
   * Generic smoke without color remains non-specific.
   */
  if (
    signals.smoke &&
    !signals.black_smoke &&
    !signals.white_smoke &&
    !signals.blue_smoke
  ) {
    add("engine_performance", 1);
  }

  /*
   * Ignition / starting.
   */
  if (signals.rough_idle) {
    add("ignition", 2);
    add("engine_performance", 2);
    add("fuel", 1);
  }

  if (signals.startup_issue) {
    add("starting_charging", 1);
    add("ignition", 1);
    add("fuel", 1);
  }

  if (
    signals.no_crank ||
    signals.slow_crank
  ) {
    add("starting_charging", 4);
  }

  /*
   * Cooling.
   */
  if (signals.overheating) {
    add("cooling", 4);
  }

  if (signals.coolant_loss) {
    add("cooling", 3);
  }

  if (
    signals.heat_related &&
    signals.overheating
  ) {
    add("cooling", 2);
  }

  if (
    signals.improves_with_speed &&
    signals.overheating
  ) {
    add("cooling", 3);
  }

  /*
   * Brakes.
   */
  if (
    signals.braking_issue ||
    signals.critical_braking_issue
  ) {
    add("brakes", 4);
  }

  /*
   * Vibration / drivetrain.
   */
  if (
    signals.vibration &&
    signals.load_sensitive
  ) {
    add("drivetrain", 2);
  }

  if (
    signals.vibration &&
    signals.speed_sensitive
  ) {
    add("drivetrain", 2);
  }

  /*
   * Return strongest systems first.
   *
   * Keep only systems with real supporting weight.
   */
  return [...scoredSystems.entries()]
    .sort(
      (a, b) =>
        b[1] - a[1]
    )
    .map(([system]) => system)
    .slice(0, 4);
}

/* ============================================================
   SEVERITY HEURISTICS
   ============================================================ */

function determineSeverity(signals) {
  /*
   * HIGH is reserved for language that reasonably suggests
   * immediate damage or control risk.
   */
  if (
    signals.critical_braking_issue
  ) {
    return "high";
  }

  if (
    signals.overheating &&
    (
      signals.coolant_loss ||
      signals.severe_smoke
    )
  ) {
    return "high";
  }

  if (
    signals.severe_smoke &&
    signals.fuel_smell
  ) {
    return "high";
  }

  /*
   * MEDIUM:
   * Important diagnostic symptoms that generally deserve
   * inspection but are not automatically treated as an
   * immediate-stop condition.
   */
  if (
    signals.overheating ||
    signals.braking_issue ||
    signals.severe_smoke ||
    signals.acceleration_issue ||
    signals.startup_issue ||
    signals.no_crank ||
    signals.slow_crank ||
    signals.vibration
  ) {
    return "medium";
  }

  return "low";
}

/* ============================================================
   RISK FLAGS
   ============================================================ */

function buildRiskFlags(signals) {
  const risks = [];

  if (signals.overheating) {
    risks.push(
      "engine_overheat_damage_risk"
    );
  }

  if (
    signals.overheating &&
    signals.coolant_loss
  ) {
    risks.push(
      "cooling_system_loss_risk"
    );
  }

  if (
    signals.severe_smoke &&
    signals.fuel_smell
  ) {
    risks.push(
      "possible_unburned_fuel_risk"
    );
  }

  if (
    signals.black_smoke &&
    signals.fuel_smell
  ) {
    risks.push(
      "possible_rich_combustion_risk"
    );
  }

  if (
    signals.critical_braking_issue
  ) {
    risks.push(
      "critical_brake_control_risk"
    );
  } else if (
    signals.braking_issue
  ) {
    risks.push(
      "brake_inspection_required"
    );
  }

  return [...new Set(risks)];
}

/* ============================================================
   SIGNAL RELATIONSHIPS
   ============================================================ */

function buildBehaviorRelationships(signals) {
  const relationships = [];

  if (
    signals.overheating &&
    signals.idle_or_stopped_related &&
    signals.improves_with_speed
  ) {
    relationships.push(
      "airflow_dependent_cooling_pattern"
    );
  }

  if (
    signals.vibration &&
    signals.load_sensitive
  ) {
    relationships.push(
      "load_sensitive_vibration_pattern"
    );
  }

  if (
    signals.vibration &&
    signals.speed_sensitive
  ) {
    relationships.push(
      "vehicle_speed_sensitive_vibration_pattern"
    );
  }

  if (
    signals.rough_idle &&
    signals.acceleration_issue
  ) {
    relationships.push(
      "idle_and_load_engine_performance_pattern"
    );
  }

  if (
    signals.startup_issue &&
    signals.heat_related
  ) {
    relationships.push(
      "hot_start_pattern"
    );
  }

  if (
    signals.startup_issue &&
    signals.cold_related
  ) {
    relationships.push(
      "cold_start_pattern"
    );
  }

  return relationships;
}

/* ============================================================
   PUBLIC API
   ============================================================ */

export function extractSignals(
  userInput = ""
) {
  const {
    signals,
    evidence,
    negatedSignals,
  } = detectSignals(userInput);

  return {
    /*
     * Backward-compatible boolean signal map.
     */
    signals,

    /*
     * Ordered heuristic system focus.
     *
     * This is contextual routing only.
     * It is NOT a confirmed diagnosis.
     */
    dominant_systems:
      determineDominantSystems(signals),

    /*
     * Conservative heuristic severity.
     */
    severity:
      determineSeverity(signals),

    /*
     * Safety / damage flags used as context only.
     */
    risk_flags:
      buildRiskFlags(signals),

    /*
     * Mechanical relationships extracted from combinations
     * of observed behavior.
     */
    behavior_relationships:
      buildBehaviorRelationships(signals),

    /*
     * Traceability metadata.
     *
     * These fields allow downstream logic to know exactly what
     * phrase activated a signal.
     */
    signal_evidence:
      evidence,

    /*
     * Explicitly negated observations are preserved rather than
     * silently discarded.
     *
     * Example:
     * "No smoke" can become useful negative evidence later.
     */
    negated_signals:
      negatedSignals,
  };
}

/* ============================================================
   SMALL HELPERS
   ============================================================ */

function escapeRegExp(value = "") {
  return String(value)
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );
}
