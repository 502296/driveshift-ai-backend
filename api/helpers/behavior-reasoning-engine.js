/* ============================================================
   DRIVESHIFT — BEHAVIOR REASONING ENGINE
   ============================================================

   Purpose:
   - Describe HOW a symptom behaves across operating conditions.
   - Preserve the difference between observation, context, and proof.
   - Convert signal combinations into high-value behavioral patterns.
   - Support the adaptive interview without forcing question count.
   - Protect the diagnostic path from unsafe or overconfident inferences.

   This engine does NOT:
   - diagnose a failed component,
   - calculate final diagnostic confidence,
   - treat a replaced part as proven good,
   - treat a user theory/disagreement as mechanical evidence,
   - invent manufacturer specifications,
   - turn reported measurements into confirmed facts automatically.
   ============================================================ */

const BEHAVIOR_ENGINE_VERSION = "2.0";

/* ============================================================
   PUBLIC API
   ============================================================ */

export function buildBehaviorReasoning(context = {}) {
  /*
   * raw_input may contain:
   *
   * Question: Does it smoke?
   * Answer: No.
   *
   * A DriveShift-generated question is NOT vehicle evidence.
   * We therefore remove question lines before performing any
   * additional raw-language behavior detection in this module.
   */
  const rawInput =
    extractUserEvidenceText(
      context.raw_input || ""
    );

  const signals =
    context.extracted_signals || {};

  const dominantLock =
    context.dominant_lock || {};

  const negatedSignals =
    context.negated_signals || {};

  const behaviorRelationships =
    Array.isArray(
      context.behavior_relationships
    )
      ? context.behavior_relationships
      : [];

  const signalEvidence =
    context.signal_evidence || {};

  const behaviors = [];

  addBehaviors(
    behaviors,
    detectThermalBehavior({
      rawInput,
      signals,
      behaviorRelationships,
    })
  );

  addBehaviors(
    behaviors,
    detectLoadBehavior({
      rawInput,
      signals,
      behaviorRelationships,
    })
  );

  addBehaviors(
    behaviors,
    detectSpeedAndRpmBehavior({
      rawInput,
      signals,
      behaviorRelationships,
    })
  );

  addBehaviors(
    behaviors,
    detectCoolingAirflowBehavior({
      signals,
      behaviorRelationships,
    })
  );

  addBehaviors(
    behaviors,
    detectBrakeBehavior({
      rawInput,
      signals,
    })
  );

  addBehaviors(
    behaviors,
    detectIdleAndStartingBehavior({
      rawInput,
      signals,
      behaviorRelationships,
    })
  );

  addBehaviors(
    behaviors,
    detectIntermittentAndProgressionBehavior({
      rawInput,
      signals,
    })
  );

  addBehaviors(
    behaviors,
    detectSmokeAndOdorBehavior({
      signals,
    })
  );

  addBehaviors(
    behaviors,
    detectSessionContextBehavior({
      rawInput,
    })
  );

  const behaviorSummary =
    buildBehaviorSummary({
      behaviors,
      signals,
      behaviorRelationships,
    });

  const nextBestQuestionGoal =
    buildNextBestQuestionGoal({
      behaviors,
      signals,
      dominantLock,
    });

  return {
    behavior_engine_version:
      BEHAVIOR_ENGINE_VERSION,

    detected_behaviors:
      behaviors,

    behavior_summary:
      behaviorSummary,

    next_best_question_goal:
      nextBestQuestionGoal,

    behavior_relationships: [
      ...behaviorRelationships,
    ],

    /*
     * Preserve explicit negative observations.
     *
     * Examples:
     * - no smoke
     * - no overheating
     * - no fuel smell
     */
    negative_behavior_evidence:
      Object.keys(
        negatedSignals
      ),

    signal_evidence:
      signalEvidence,

    reasoning_guardrails:
      buildReasoningGuardrails({
        behaviors,
        dominantLock,
        negatedSignals,
      }),

    mechanic_instruction:
      "Use behavior patterns as diagnostic discriminators, not as component confirmation. Preserve direct observations, explicit negative evidence, operating conditions, and verified measurements above generic failure assumptions.",
  };
}

/* ============================================================
   BEHAVIOR COLLECTION
   ============================================================ */

function addBehaviors(
  target,
  items
) {
  for (
    const item of items || []
  ) {
    addBehavior(
      target,
      item
    );
  }
}

function addBehavior(
  list,
  item
) {
  if (
    !item?.key
  ) {
    return;
  }

  const existing =
    list.find(
      (entry) =>
        entry.key ===
        item.key
    );

  if (
    !existing
  ) {
    list.push(
      item
    );

    return;
  }

  /*
   * Merge evidence without duplicating the behavior.
   */
  existing.evidence = [
    ...new Set([
      ...(
        Array.isArray(
          existing.evidence
        )
          ? existing.evidence
          : []
      ),

      ...(
        Array.isArray(
          item.evidence
        )
          ? item.evidence
          : []
      ),
    ]),
  ];
}

function behavior({
  key,
  label,
  meaning,
  diagnosticValue,
  followUpPriority,
  evidence = [],
  category = "behavior",
  epistemicStatus = "OBSERVED_PATTERN",
}) {
  return {
    key,

    label,

    meaning,

    /*
     * Retained field names preserve compatibility with
     * downstream DriveShift helpers.
     */
    diagnostic_value:
      diagnosticValue,

    follow_up_priority:
      followUpPriority,

    category,

    epistemic_status:
      epistemicStatus,

    evidence: [
      ...new Set(
        evidence.filter(
          Boolean
        )
      ),
    ],
  };
}

/* ============================================================
   THERMAL BEHAVIOR
   ============================================================ */

function detectThermalBehavior({
  rawInput,
  signals,
  behaviorRelationships,
}) {
  const behaviors = [];

  if (
    signals.heat_related ||
    behaviorRelationships.includes(
      "hot_start_pattern"
    )
  ) {
    addBehavior(
      behaviors,
      behavior({
        key:
          "thermal_failure_pattern",

        label:
          "Thermal dependency",

        meaning:
          "The symptom changes after heat builds in the vehicle or powertrain.",

        diagnosticValue:
          "High information value because temperature dependency can separate heat-sensitive electrical, fluid, pressure, control, and mechanical behaviors.",

        followUpPriority:
          "If still unresolved, determine whether the symptom improves after cooling and which operating condition reliably reproduces it.",

        evidence: [
          "heat_related",
        ],
      })
    );
  }

  if (
    signals.cold_related ||
    behaviorRelationships.includes(
      "cold_start_pattern"
    ) ||
    hasAffirmedAny(
      rawInput,
      [
        "starts rough cold",
        "rough when cold",
        "cold idle",
      ]
    )
  ) {
    addBehavior(
      behaviors,
      behavior({
        key:
          "cold_start_pattern",

        label:
          "Cold-start dependency",

        meaning:
          "The symptom is strongest before the vehicle or engine reaches normal operating temperature.",

        diagnosticValue:
          "Useful because a cold-only pattern can distinguish temperature-dependent mixture, airflow, ignition, sensor, and mechanical behavior.",

        followUpPriority:
          "If still unresolved, determine whether the symptom fades, remains, or worsens as the vehicle warms.",

        evidence: [
          "cold_related",
        ],
      })
    );
  }

  return behaviors;
}

/* ============================================================
   LOAD BEHAVIOR
   ============================================================ */

function detectLoadBehavior({
  rawInput,
  signals,
  behaviorRelationships,
}) {
  const behaviors = [];

  if (
    signals.load_sensitive ||
    behaviorRelationships.includes(
      "load_sensitive_vibration_pattern"
    )
  ) {
    addBehavior(
      behaviors,
      behavior({
        key:
          "load_sensitive_failure",

        label:
          "Load-sensitive behavior",

        meaning:
          "The symptom changes when powertrain load or torque demand increases.",

        diagnosticValue:
          "Very high information value because load sensitivity can separate engine-RPM, combustion, torque-delivery, mount, axle, and drivetrain paths from speed-only faults.",

        followUpPriority:
          "If still unresolved, determine whether the symptom decreases when throttle/load is reduced while vehicle speed is similar.",

        evidence: [
          "load_sensitive",
        ],
      })
    );
  }

  if (
    hasAffirmedAny(
      rawInput,
      [
        "loses power uphill",
        "bogs uphill",
        "no power uphill",
        "shakes uphill",
        "worse uphill",
      ]
    )
  ) {
    addBehavior(
      behaviors,
      behavior({
        key:
          "grade_load_dependency",

        label:
          "Grade-load dependency",

        meaning:
          "The symptom becomes more apparent against road grade or increased propulsion demand.",

        diagnosticValue:
          "Useful for separating load-sensitive powertrain behavior from faults driven mainly by road speed.",

        followUpPriority:
          "If still unresolved, compare engine RPM behavior with vehicle acceleration under the same load condition.",

        evidence: [
          "reported_uphill_dependency",
        ],
      })
    );
  }

  return behaviors;
}

/* ============================================================
   VEHICLE-SPEED / ENGINE-RPM BEHAVIOR
   ============================================================ */

function detectSpeedAndRpmBehavior({
  rawInput,
  signals,
  behaviorRelationships,
}) {
  const behaviors = [];

  if (
    signals.speed_sensitive ||
    behaviorRelationships.includes(
      "vehicle_speed_sensitive_vibration_pattern"
    )
  ) {
    addBehavior(
      behaviors,
      behavior({
        key:
          "vehicle_speed_dependency",

        label:
          "Vehicle-speed dependency",

        meaning:
          "The symptom changes primarily with road speed.",

        diagnosticValue:
          "High information value for separating rotating wheel-end or driveline behavior from engine-load/RPM behavior.",

        followUpPriority:
          "If still unresolved, determine whether the symptom follows vehicle speed even when engine load changes.",

        evidence: [
          "speed_sensitive",
        ],
      })
    );
  }

  if (
    hasAffirmedAny(
      rawInput,
      [
        "follows rpm",
        "changes with rpm",
        "worse at higher rpm",
        "worse at low rpm",
        "around 2000 rpm",
        "around 3000 rpm",
        "engine speed changes it",
        "happens when revving",
      ]
    )
  ) {
    addBehavior(
      behaviors,
      behavior({
        key:
          "engine_rpm_dependency",

        label:
          "Engine-RPM dependency",

        meaning:
          "The symptom changes with engine speed rather than being described only by vehicle speed.",

        diagnosticValue:
          "High information value because RPM dependency can redirect vibration, noise, or performance reasoning toward engine, accessory, ignition, or torque-related paths.",

        followUpPriority:
          "If still unresolved, determine whether the RPM relationship remains repeatable under another safe operating condition; do not request hazardous on-road maneuvers.",

        evidence: [
          "reported_rpm_dependency",
        ],
      })
    );
  }

  return behaviors;
}

/* ============================================================
   COOLING AIRFLOW RELATIONSHIP
   ============================================================ */

function detectCoolingAirflowBehavior({
  signals,
  behaviorRelationships,
}) {
  const behaviors = [];

  if (
    behaviorRelationships.includes(
      "airflow_dependent_cooling_pattern"
    ) ||
    (
      signals.overheating &&
      signals.idle_or_stopped_related &&
      signals.improves_with_speed
    )
  ) {
    addBehavior(
      behaviors,
      behavior({
        key:
          "airflow_dependent_cooling_pattern",

        label:
          "Airflow-dependent cooling pattern",

        meaning:
          "Temperature rises more in low-airflow conditions and improves as vehicle motion increases airflow.",

        diagnosticValue:
          "Very high information value because this pattern raises the priority of airflow/fan-control and heat-rejection verification without proving a fan component has failed.",

        followUpPriority:
          "Use safe observation or technician testing to separate fan command, fan operation, airflow restriction, and broader coolant-flow causes.",

        evidence: [
          "overheating",
          "idle_or_stopped_related",
          "improves_with_speed",
        ],
      })
    );
  }

  return behaviors;
}

/* ============================================================
   BRAKE BEHAVIOR
   ============================================================ */

function detectBrakeBehavior({
  rawInput,
  signals,
}) {
  const behaviors = [];

  if (
    signals.braking_issue ||
    signals.critical_braking_issue
  ) {
    addBehavior(
      behaviors,
      behavior({
        key:
          "braking_only_pattern",

        label:
          "Braking-related behavior",

        meaning:
          "The reported symptom is tied to braking input or stopping behavior.",

        diagnosticValue:
          signals.critical_braking_issue
            ? "Critical safety value because stopping-control loss takes priority over ordinary comfort or drivability reasoning."
            : "High safety and diagnostic value because braking-specific timing separates brake-system behavior from many speed-only vibration causes.",

        followUpPriority:
          signals.critical_braking_issue
            ? "Do not delay safety guidance for additional interview depth."
            : "If still unresolved, separate pedal behavior, steering feedback, pull, pulsation, noise, and stopping performance without requesting hazardous testing.",

        evidence: [
          signals.critical_braking_issue
            ? "critical_braking_issue"
            : "braking_issue",
        ],
      })
    );
  } else if (
    hasAffirmedAny(
      rawInput,
      [
        "soft brake pedal",
        "hard brake pedal",
        "brake noise",
        "grinding brakes",
        "abs activation",
      ]
    )
  ) {
    addBehavior(
      behaviors,
      behavior({
        key:
          "braking_only_pattern",

        label:
          "Braking-related behavior",

        meaning:
          "The complaint contains braking-specific behavior requiring safety-aware separation.",

        diagnosticValue:
          "High safety value because brake-specific observations should remain above generic vibration or comfort assumptions.",

        followUpPriority:
          "If still unresolved, clarify the exact brake input, pedal feel, stopping effect, and warning behavior.",

        evidence: [
          "reported_braking_behavior",
        ],
      })
    );
  }

  return behaviors;
}

/* ============================================================
   IDLE / STARTING BEHAVIOR
   ============================================================ */

function detectIdleAndStartingBehavior({
  rawInput,
  signals,
  behaviorRelationships,
}) {
  const behaviors = [];

  if (
    signals.rough_idle ||
    hasAffirmedAny(
      rawInput,
      [
        "idle drops",
        "almost stalls at idle",
        "idle hunts",
      ]
    )
  ) {
    addBehavior(
      behaviors,
      behavior({
        key:
          "idle_quality_pattern",

        label:
          "Idle-quality pattern",

        meaning:
          "The symptom is present at little or no road load.",

        diagnosticValue:
          "Useful because idle behavior can separate engine, combustion, control, or mount-related paths from road-speed-dependent faults.",

        followUpPriority:
          "If still unresolved, determine whether the symptom changes as engine RPM rises modestly without adding a hazardous test request.",

        evidence: [
          "rough_idle",
        ],
      })
    );
  }

  if (
    signals.startup_issue ||
    signals.no_crank ||
    signals.slow_crank ||
    behaviorRelationships.includes(
      "hot_start_pattern"
    ) ||
    behaviorRelationships.includes(
      "cold_start_pattern"
    )
  ) {
    const startEvidence =
      [];

    if (
      signals.no_crank
    ) {
      startEvidence.push(
        "no_crank"
      );
    }

    if (
      signals.slow_crank
    ) {
      startEvidence.push(
        "slow_crank"
      );
    }

    if (
      signals.startup_issue
    ) {
      startEvidence.push(
        "startup_issue"
      );
    }

    addBehavior(
      behaviors,
      behavior({
        key:
          "starting_sequence_pattern",

        label:
          "Starting-sequence pattern",

        meaning:
          "The starting sequence contains diagnostically important crank-state behavior.",

        diagnosticValue:
          "Very high information value because no-crank, slow-crank, and normal-crank/no-start belong to different diagnostic branches.",

        followUpPriority:
          "If crank state is still unclear, separate no-crank, slow-crank, and normal-crank/no-start before ranking components.",

        evidence:
          startEvidence,
      })
    );
  }

  return behaviors;
}

/* ============================================================
   INTERMITTENCY / PROGRESSION
   ============================================================ */

function detectIntermittentAndProgressionBehavior({
  rawInput,
  signals,
}) {
  const behaviors = [];

  if (
    signals.intermittent
  ) {
    addBehavior(
      behaviors,
      behavior({
        key:
          "intermittent_failure_pattern",

        label:
          "Intermittent pattern",

        meaning:
          "The symptom is not present continuously.",

        diagnosticValue:
          "High information value when a repeatable trigger can be identified; intermittency alone does not identify a component or failure type.",

        followUpPriority:
          "If still unresolved, identify the condition that most reliably triggers or clears the symptom.",

        evidence: [
          "intermittent",
        ],
      })
    );
  }

  if (
    hasAffirmedAny(
      rawInput,
      [
        "getting worse",
        "getting progressively worse",
        "progressively worse",
        "worse now",
        "more frequent now",
        "happening more often",
      ]
    )
  ) {
    addBehavior(
      behaviors,
      behavior({
        key:
          "progressive_failure_pattern",

        label:
          "Progressive pattern",

        meaning:
          "The user reports that the symptom is becoming stronger or more frequent over time.",

        diagnosticValue:
          "Useful trend evidence, but progression alone does not prove wear, thermal degradation, or any particular failed component.",

        followUpPriority:
          "If still unresolved, identify which aspect changed first: frequency, severity, operating condition, warning behavior, or performance.",

        evidence: [
          "reported_progression",
        ],
      })
    );
  }

  return behaviors;
}

/* ============================================================
   SMOKE / ODOR BEHAVIOR
   ============================================================ */

function detectSmokeAndOdorBehavior({
  signals,
}) {
  const behaviors = [];

  const smokeTypes =
    [];

  if (
    signals.black_smoke
  ) {
    smokeTypes.push(
      "black_smoke"
    );
  }

  if (
    signals.white_smoke
  ) {
    smokeTypes.push(
      "white_smoke"
    );
  }

  if (
    signals.blue_smoke
  ) {
    smokeTypes.push(
      "blue_smoke"
    );
  }

  if (
    signals.smoke ||
    smokeTypes.length > 0
  ) {
    addBehavior(
      behaviors,
      behavior({
        key:
          "exhaust_smoke_pattern",

        label:
          "Smoke / exhaust-output pattern",

        meaning:
          buildSmokeMeaning(
            smokeTypes
          ),

        diagnosticValue:
          "High information value when smoke color, source, timing, operating condition, and duration are known. Smoke color narrows a failure family but does not confirm a component.",

        followUpPriority:
          smokeTypes.length === 0
            ? "If still unresolved, clarify smoke color, source, timing, and the operating condition that produces it."
            : "If still unresolved, clarify when the observed smoke appears and whether it is continuous, transient, exhaust-related, or from another vehicle area.",

        evidence:
          smokeTypes.length > 0
            ? smokeTypes
            : [
                "smoke",
              ],
      })
    );
  }

  if (
    signals.fuel_smell
  ) {
    addBehavior(
      behaviors,
      behavior({
        key:
          "fuel_odor_pattern",

        label:
          "Fuel-odor pattern",

        meaning:
          "A fuel odor is reported, but the source is not established by odor alone.",

        diagnosticValue:
          "High information and safety value because fuel odor can reflect vapor or liquid leakage, rich operation, or unburned fuel and therefore requires source verification.",

        followUpPriority:
          "If still unresolved, identify where and when the odor is strongest without instructing the user to approach an active leak or hot engine area.",

        evidence: [
          "fuel_smell",
        ],
      })
    );
  }

  return behaviors;
}

function buildSmokeMeaning(
  smokeTypes
) {
  if (
    smokeTypes.includes(
      "black_smoke"
    )
  ) {
    return "Black smoke supports a rich-combustion or incomplete-burn direction, but does not identify the failed component.";
  }

  if (
    smokeTypes.includes(
      "blue_smoke"
    )
  ) {
    return "Blue smoke supports an oil-consumption or combustion direction, but does not identify the source without verification.";
  }

  if (
    smokeTypes.includes(
      "white_smoke"
    )
  ) {
    return "White smoke requires source, temperature, duration, and coolant-versus-condensation discrimination before any cooling or internal-engine conclusion.";
  }

  return "Smoke is reported, but color, source, or timing are not yet specific enough to assign a failure family.";
}

/* ============================================================
   SESSION CONTEXT
   REPAIR HISTORY / MEASUREMENTS
   ============================================================ */

function detectSessionContextBehavior({
  rawInput,
}) {
  const behaviors = [];

  /*
   * A replacement is HISTORY, not proof.
   *
   * A previously replaced component may still be:
   * - incorrectly installed,
   * - incorrect for the vehicle,
   * - defective,
   * - affected by wiring/control problems,
   * - unrelated to the true cause.
   */
  if (
    hasAffirmedAny(
      rawInput,
      [
        "i replaced",
        "already replaced",
        "i changed",
        "already changed",
        "i swapped",
        "already swapped",
        "installed a new",
        "new part installed",
        "was replaced",
        "has been replaced",
      ]
    )
  ) {
    addBehavior(
      behaviors,
      behavior({
        key:
          "repair_history_update",

        label:
          "Reported repair history",

        meaning:
          "The session contains a reported prior repair or component replacement.",

        diagnosticValue:
          "Contextual evidence only. A replacement may change prior probability, but it does not prove the component, installation, connector, wiring, control circuit, calibration, or replacement part is good.",

        followUpPriority:
          "If the repair is relevant to the leading path, determine whether the symptom changed after the repair and what was actually verified before or after replacement.",

        evidence: [
          "reported_repair_history",
        ],

        category:
          "session_context",

        epistemicStatus:
          "REPORTED_HISTORY",
      })
    );
  }

  /*
   * Technical values are potentially powerful evidence,
   * but only when test point, units, operating state, and
   * reference range are meaningful.
   */
  if (
    containsTechnicalMeasurementEvidence(
      rawInput
    )
  ) {
    addBehavior(
      behaviors,
      behavior({
        key:
          "technical_data_refinement",

        label:
          "Reported technical measurement",

        meaning:
          "The session contains a user-reported technical value, test method, or instrument observation.",

        diagnosticValue:
          "Potentially high value when the measurement, units, test location, operating condition, and reference range are known. A reported number is not automatically a confirmed diagnosis.",

        followUpPriority:
          "If the measurement materially affects ranking, preserve the exact value and unit and clarify test condition or reference source rather than inventing a manufacturer specification.",

        evidence: [
          "reported_measurement_or_test",
        ],

        category:
          "technical_context",

        epistemicStatus:
          "REPORTED_MEASUREMENT",
      })
    );
  }

  /*
   * We intentionally DO NOT create a behavior for:
   *
   * "Could it be the fuel pump?"
   * "What about the thermostat?"
   * "Are you sure?"
   *
   * A user's theory or disagreement is not vehicle evidence.
   */

  return behaviors;
}

function containsTechnicalMeasurementEvidence(
  rawInput
) {
  const text =
    normalizeText(
      rawInput
    );

  if (
    !text
  ) {
    return false;
  }

  /*
   * Require an actual number + diagnostic unit where possible.
   *
   * This prevents a sentence such as:
   * "Do I need a multimeter?"
   *
   * from being treated as a measurement.
   */
  const unitPattern =
    /\b\d+(?:\.\d+)?\s*(?:v|volt|volts|mv|amp|amps|a|ma|ohm|ohms|psi|bar|kpa|mpa|rpm|hz|khz|ms|%|degrees?|°f|°c)\b/i;

  if (
    unitPattern.test(
      text
    )
  ) {
    return true;
  }

  return hasAffirmedAny(
    text,
    [
      "multimeter reading",
      "voltage drop measured",
      "oscilloscope reading",
      "scope pattern",
      "fuel pressure reading",
      "compression reading",
      "resistance measured",
      "duty cycle measured",
      "fuel trim reading",
      "short term fuel trim",
      "long term fuel trim",
    ]
  );
}

/* ============================================================
   BEHAVIOR SUMMARY
   ============================================================ */

function buildBehaviorSummary({
  behaviors,
  signals,
  behaviorRelationships,
}) {
  const keys =
    new Set(
      behaviors.map(
        (item) =>
          item.key
      )
    );

  if (
    signals.critical_braking_issue
  ) {
    return "The session contains critical braking behavior. Safety priority must remain separate from diagnostic certainty, and additional interview depth must not delay appropriate stop-driving guidance.";
  }

  if (
    keys.has(
      "airflow_dependent_cooling_pattern"
    )
  ) {
    return "Temperature behavior changes with airflow or vehicle motion. This is a high-value cooling discriminator, but it does not by itself confirm a fan, relay, module, thermostat, radiator, or pump failure.";
  }

  if (
    keys.has(
      "thermal_failure_pattern"
    ) &&
    keys.has(
      "load_sensitive_failure"
    )
  ) {
    return "The symptom is both temperature-dependent and load-sensitive, creating a high-information operating-condition pattern that should guide verification before component ranking.";
  }

  if (
    keys.has(
      "vehicle_speed_dependency"
    ) &&
    keys.has(
      "engine_rpm_dependency"
    )
  ) {
    return "Both vehicle-speed and engine-RPM relationships are reported. The next diagnostic step should determine which relationship remains when load and speed conditions are separated.";
  }

  if (
    keys.has(
      "starting_sequence_pattern"
    )
  ) {
    return "Starting-sequence behavior is diagnostically important. Crank state must remain explicit before individual starting, fuel, ignition, or engine-signal components are ranked.";
  }

  if (
    keys.has(
      "exhaust_smoke_pattern"
    ) ||
    keys.has(
      "fuel_odor_pattern"
    )
  ) {
    return "Smoke or fuel-odor evidence is present. Source, color, timing, and operating condition should guide the diagnostic branch without converting the observation into a confirmed component failure.";
  }

  if (
    behaviorRelationships.length >
      0 ||
    behaviors.length >
      0
  ) {
    return "Meaningful operating-condition patterns are present. Use them as discriminators while preserving direct observations, negative evidence, and verification requirements.";
  }

  return "No strong operating-condition pattern is established yet. Additional questioning is useful only if one answer can materially change diagnostic ranking, verification, or safety.";
}

/* ============================================================
   NEXT-BEST-QUESTION GOAL
   ============================================================ */

function buildNextBestQuestionGoal({
  behaviors,
  signals,
  dominantLock,
}) {
  const keys =
    new Set(
      behaviors.map(
        (item) =>
          item.key
      )
    );

  /*
   * Safety outranks interview completeness.
   */
  if (
    signals.critical_braking_issue
  ) {
    return "Do not delay safety guidance for routine questioning; only ask another question if it is necessary to clarify immediate stopping-control risk.";
  }

  if (
    keys.has(
      "starting_sequence_pattern"
    ) &&
    !signals.no_crank &&
    !signals.slow_crank
  ) {
    return "If crank state remains unclear, separate no-crank, slow-crank, and normal-crank/no-start.";
  }

  if (
    keys.has(
      "vehicle_speed_dependency"
    ) &&
    keys.has(
      "engine_rpm_dependency"
    )
  ) {
    return "Determine whether the symptom primarily follows vehicle speed, engine RPM, or load using a safe owner-observable distinction.";
  }

  if (
    keys.has(
      "load_sensitive_failure"
    )
  ) {
    return "If unresolved, determine whether reducing throttle or load changes the symptom while avoiding hazardous test instructions.";
  }

  if (
    keys.has(
      "thermal_failure_pattern"
    )
  ) {
    return "If unresolved, determine whether cooling down changes the symptom and which temperature state reliably reproduces it.";
  }

  if (
    keys.has(
      "exhaust_smoke_pattern"
    ) &&
    !signals.black_smoke &&
    !signals.white_smoke &&
    !signals.blue_smoke
  ) {
    return "If unresolved, clarify smoke color, source, timing, and the operating condition that produces it.";
  }

  if (
    keys.has(
      "fuel_odor_pattern"
    )
  ) {
    return "If unresolved, clarify when and where the fuel odor is strongest without directing the user toward a suspected leak or hot component.";
  }

  if (
    keys.has(
      "technical_data_refinement"
    )
  ) {
    return "Use the reported measurement only if its exact value, units, test point, and operating condition can materially change the ranking; do not invent a reference specification.";
  }

  if (
    dominantLock?.locked_system ===
    "transmission_drivetrain"
  ) {
    return "If unresolved, separate shift or RPM behavior from vehicle-speed and load-sensitive vibration.";
  }

  return "Ask one additional question only if it can materially separate the leading diagnostic branches, verification path, or safety assessment.";
}

/* ============================================================
   REASONING GUARDRAILS
   ============================================================ */

function buildReasoningGuardrails({
  behaviors,
  dominantLock,
  negatedSignals,
}) {
  const guardrails = [
    "Treat behavior patterns as discriminators, not component confirmation.",

    "Preserve direct user observations and explicit negative evidence above derived labels or common-failure assumptions.",

    "A reported part replacement does not prove that part, its connector, wiring, control circuit, calibration, installation, or replacement unit is good.",

    "A reported measurement is not automatically verified; preserve its exact value, units, test point, and operating condition, and do not invent manufacturer specifications.",

    "User disagreement, a suggested theory, or a question such as 'could it be X?' is not mechanical evidence by itself.",

    "Do not ask the user to perform hazardous checks involving moving components, hot or pressurized cooling systems, unsupported vehicles, brake-risk driving, or high-voltage hybrid/EV systems.",

    "Ask no more than one follow-up at a time, and ask it only when the answer has real diagnostic information value.",
  ];

  if (
    dominantLock?.locked
  ) {
    guardrails.push(
      `Current routing anchor: ${dominantLock.locked_title}. Preserve it only while it remains supported by the strongest evidence; stronger contradictory evidence must be allowed to change the ranking.`
    );
  }

  const negativeKeys =
    Object.keys(
      negatedSignals || {}
    );

  if (
    negativeKeys.length
  ) {
    guardrails.push(
      `Explicit negative evidence is present for: ${negativeKeys.join(
        ", "
      )}. Do not silently convert these denied observations into positive evidence.`
    );
  }

  for (
    const item of behaviors
  ) {
    /*
     * Session context does not need to be repeated as a
     * mechanical behavior guardrail.
     */
    if (
      item.category ===
        "session_context" ||
      item.category ===
        "technical_context"
    ) {
      continue;
    }

    guardrails.push(
      `${item.label}: ${item.diagnostic_value}`
    );
  }

  return [
    ...new Set(
      guardrails
    ),
  ];
}

/* ============================================================
   USER-EVIDENCE EXTRACTION
   ============================================================ */

/*
 * raw_input may contain lines such as:
 *
 * Question: Does it smoke?
 * Answer: No.
 *
 * The question was created by DriveShift.
 * It is not an observation from the vehicle.
 *
 * We therefore remove question lines from raw-language pattern
 * matching performed inside this engine.
 */
function extractUserEvidenceText(
  rawInput = ""
) {
  return String(
    rawInput || ""
  )
    .split(
      /\r?\n/
    )
    .map(
      (line) =>
        line.trim()
    )
    .filter(
      Boolean
    )
    .filter(
      (line) =>
        !line
          .toLowerCase()
          .startsWith(
            "question:"
          )
    )
    .map(
      (line) =>
        line
          .toLowerCase()
          .startsWith(
            "answer:"
          )
          ? line
              .slice(
                line.indexOf(
                  ":"
                ) + 1
              )
              .trim()
          : line
    )
    .filter(
      Boolean
    )
    .join(
      "\n"
    )
    .toLowerCase();
}

/* ============================================================
   NEGATION-AWARE RAW PHRASE MATCHING
   ============================================================ */

function hasAffirmedAny(
  text = "",
  phrases = []
) {
  const clauses =
    splitClauses(
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
    normalizeForMatch(
      clause
    );

  const cleanPhrase =
    normalizeForMatch(
      phrase
    );

  if (
    !cleanClause ||
    !cleanPhrase
  ) {
    return false;
  }

  const pattern =
    new RegExp(
      `(^|\\s)${escapeRegex(
        cleanPhrase
      )}(?=\\s|$)`,
      "i"
    );

  const match =
    pattern.exec(
      cleanClause
    );

  if (
    !match
  ) {
    return false;
  }

  /*
   * "no crank" is a positive fault state,
   * so an intentional phrase beginning with "no"
   * is not treated as grammatical negation here.
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
    phraseIndex <=
    0
  ) {
    return true;
  }

  const precedingWords =
    cleanClause
      .slice(
        0,
        phraseIndex
      )
      .trim()
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

  if (
    !precedingWords
  ) {
    return true;
  }

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

  return !negations.some(
    (negation) => {
      const cleanNegation =
        normalizeForMatch(
          negation
        );

      const negationPattern =
        new RegExp(
          `(^|\\s)${escapeRegex(
            cleanNegation
          )}(?=\\s|$)`,
          "i"
        );

      return negationPattern.test(
        precedingWords
      );
    }
  );
}

function splitClauses(
  text = ""
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

function normalizeText(
  value = ""
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
      /\s+/g,
      " "
    )
    .trim();
}

function normalizeForMatch(
  value = ""
) {
  return normalizeText(
    value
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

function escapeRegex(
  value = ""
) {
  return String(
    value
  ).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}
