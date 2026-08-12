// DriveShift Mechanical Prioritization Engine v3
// Purpose:
// Build a conservative mechanic-level hierarchy from canonical user evidence.
// Protect dominant behavior without allowing raw keyword matches to resurrect
// negated symptoms or turn heuristic context into confirmed component failure.

const SAFETY_PRIORITY = Object.freeze({
  CRITICAL: 30,
  CAUTION: 12,
  NORMAL: 0,
});

function hasSignal(signals = {}, key) {
  return signals?.[key] === true;
}

function hasNegatedSignal(context = {}, key) {
  const value = context?.negated_signals?.[key];

  if (value === true) return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;

  return false;
}

function includesAny(list = [], values = []) {
  if (!Array.isArray(list)) return false;

  const normalized = list.map((item) => normalizeForMatching(item));

  return values.some((value) => {
    const wanted = normalizeForMatching(value);

    return normalized.some((item) =>
      item.includes(wanted)
    );
  });
}

function getBehaviorKeys(context = {}) {
  const detected =
    context?.behavior_reasoning?.detected_behaviors;

  if (!Array.isArray(detected)) {
    return [];
  }

  return detected
    .map((item) =>
      String(item?.key || "").trim()
    )
    .filter(Boolean);
}

function addPriority(list, item) {
  if (!item?.key) return;

  const existingIndex =
    list.findIndex(
      (entry) =>
        entry.key === item.key
    );

  if (existingIndex < 0) {
    list.push(item);
    return;
  }

  const existing =
    list[existingIndex];

  /*
   * Preserve the strongest version if the same deterministic
   * priority was created by more than one path.
   */
  if (
    (item.evidence_score || 0) >
    (existing.evidence_score || 0)
  ) {
    list[existingIndex] =
      item;
  }
}

/* ============================================================
   NEGATION-AWARE RAW MATCHING
   ============================================================ */

function hasAffirmedAny(
  raw = "",
  phrases = []
) {
  const clauses =
    splitDiagnosticClauses(
      raw
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
   * Phrases such as:
   * - no communication
   * - no boost
   *
   * describe a positive fault state.
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

    "dont",
    "doesnt",
    "didnt",
    "isnt",
    "wasnt",
    "werent",
    "hasnt",
    "havent",
    "hadnt",
    "cant",

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

    "sin",
    "no hay",
    "nunca",
  ];

  return !negations.some(
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
}

function splitDiagnosticClauses(
  raw = ""
) {
  return String(
    raw || ""
  )
    .toLowerCase()
    .replace(
      /[’‘]/g,
      "'"
    )
    .split(
      /\b(?:but|however|although|though|except|yet|pero|aunque|sin embargo)\b|[.!?;،,\n]/i
    )
    .map(
      (item) =>
        item.trim()
    )
    .filter(
      Boolean
    );
}

function normalizeForMatching(
  value = ""
) {
  return String(
    value || ""
  )
    .toLowerCase()
    .normalize(
      "NFD"
    )
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
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

/* ============================================================
   PRIORITY CONSTRUCTION
   ============================================================ */

function makePriority({
  key,
  title,
  mechanic_summary,
  why_primary,
  verification_focus,
  avoid,
  system_families = [],
  evidence_score = 0,
  safety_priority = "NORMAL",
}) {
  return {
    key,
    title,
    mechanic_summary,
    why_primary,
    verification_focus,
    avoid,
    system_families,
    evidence_score,
    safety_priority,
  };
}

/* ============================================================
   FUEL / COMBUSTION
   ============================================================ */

function buildFuelCombustionPriority(
  context = {}
) {
  const raw =
    context.raw_input || "";

  const signals =
    context.extracted_signals || {};

  const dominantSignals =
    context.dominant_signals || [];

  const behaviors =
    getBehaviorKeys(
      context
    );

  const priorities =
    [];

  const blackSmoke =
    hasSignal(
      signals,
      "black_smoke"
    ) ||
    (
      !hasNegatedSignal(
        context,
        "black_smoke"
      ) &&
      hasAffirmedAny(
        raw,
        [
          "black smoke",
          "dark smoke",
          "humo negro",
        ]
      )
    );

  const fuelSmell =
    hasSignal(
      signals,
      "fuel_smell"
    ) ||
    (
      !hasNegatedSignal(
        context,
        "fuel_smell"
      ) &&
      hasAffirmedAny(
        raw,
        [
          "fuel smell",
          "gas smell",
          "raw fuel",
          "gasoline smell",
          "smells like gas",
          "strong fuel odor",
          "unburned fuel",

          "olor a gasolina",
          "olor a combustible",
        ]
      )
    );

  const loadSensitive =
    hasSignal(
      signals,
      "load_sensitive"
    ) ||
    behaviors.includes(
      "load_sensitive_failure"
    ) ||
    hasAffirmedAny(
      raw,
      [
        "heavy throttle",
        "under load",
        "uphill",
        "when accelerating",
        "during acceleration",
        "worse accelerating",

        "al acelerar",
        "cuesta arriba",
      ]
    );

  const roughOrMisfire =
    hasSignal(
      signals,
      "rough_idle"
    ) ||
    hasSignal(
      signals,
      "vibration"
    ) ||
    hasAffirmedAny(
      raw,
      [
        "misfire",
        "engine shakes",
        "shaking under acceleration",
        "rough idle",
        "rough under load",
        "jerking",
        "stumble",

        "falla de encendido",
        "tiembla al acelerar",
      ]
    );

  const flashingCel =
    hasAffirmedAny(
      raw,
      [
        "flashing check engine",
        "check engine light flashes",
        "check engine light flashing",
        "flashing cel",
        "cel flashes",

        "luz check engine parpadea",
      ]
    );

  const bankSpecific =
    includesAny(
      dominantSignals,
      [
        "bank-specific fuel trim",
      ]
    ) ||
    hasAffirmedAny(
      raw,
      [
        "bank 1",
        "bank 2",
        "fuel trim",
        "fuel trims",
        "upstream o2",
        "injector balance",
      ]
    );

  if (
    blackSmoke &&
    fuelSmell
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "rich_raw_fuel_exhaust_priority",

        title:
          "Rich raw-fuel exhaust pattern",

        mechanic_summary:
          "Black smoke with a raw-fuel odor strongly supports an over-rich or incomplete-combustion direction, but it does not identify the failed component by itself.",

        why_primary:
          "Black exhaust indicates excessive fuel relative to available air or poor burn quality. Fuel odor adds evidence that part of the delivered fuel may be leaving the combustion event unburned. The first branch should separate injector leakage or excessive pressure from control-input error and ignition burn failure.",

        verification_focus: [
          "Review fuel trims, upstream oxygen or air-fuel feedback, and misfire data before authorizing parts.",

          "Inspect spark plugs for wet fuel, carbon loading, or a cylinder-specific pattern.",

          "Verify fuel pressure behavior and injector leakage or balance when appropriate.",
        ],

        avoid:
          "Do not jump directly to injectors, oxygen sensors, or a fuel-pressure component without isolating whether the mixture is being commanded rich or simply failing to burn.",

        system_families: [
          "fuel",
          "ignition",
          "engine_performance",
        ],

        evidence_score:
          20,

        safety_priority:
          flashingCel
            ? "CAUTION"
            : "NORMAL",
      })
    );
  }

  if (
    blackSmoke &&
    loadSensitive
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "rich_or_incomplete_combustion_under_load",

        title:
          "Rich or incomplete combustion under load",

        mechanic_summary:
          "The failure becomes stronger as cylinder pressure and fuel demand rise.",

        why_primary:
          "Black smoke that worsens with throttle load keeps the diagnosis on mixture control, fuel-pressure behavior, injector delivery, airflow measurement, and ignition authority under cylinder pressure.",

        verification_focus: [
          "Compare misfire behavior and mixture feedback at idle versus loaded acceleration.",

          "Verify fuel pressure response under load rather than relying only on an idle reading.",

          "Inspect plug and coil condition if the symptom behaves like load-sensitive misfire.",
        ],

        avoid:
          "Do not label the complaint as weak fuel delivery until overfueling and ignition breakdown have been separated.",

        system_families: [
          "fuel",
          "ignition",
          "engine_performance",
        ],

        evidence_score:
          fuelSmell
            ? 18
            : 14,

        safety_priority:
          flashingCel
            ? "CAUTION"
            : "NORMAL",
      })
    );
  }

  if (
    fuelSmell &&
    (
      flashingCel ||
      roughOrMisfire
    )
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "misfire_with_unburned_fuel_risk",

        title:
          "Misfire / incomplete burn with unburned-fuel risk",

        mechanic_summary:
          "Fuel odor together with active misfire behavior suggests that fuel may be delivered to a cylinder without being burned cleanly.",

        why_primary:
          "A flashing check-engine warning or strong shake makes active combustion failure more important than a generic rich-mixture guess. This can increase exhaust and catalyst temperature if sustained.",

        verification_focus: [
          "Read cylinder-specific misfire counters and freeze-frame data if available.",

          "Verify plug, coil, boot, injector, and cylinder contribution on the affected cylinder or bank.",

          "Determine whether the fuel odor comes from the exhaust or an external leak before extending the test.",
        ],

        avoid:
          "Do not treat a flashing misfire warning with fuel odor as a routine emissions-light complaint.",

        system_families: [
          "ignition",
          "fuel",
          "engine_performance",
        ],

        evidence_score:
          flashingCel
            ? 21
            : 15,

        safety_priority:
          "CAUTION",
      })
    );
  }

  if (
    loadSensitive &&
    roughOrMisfire
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "load_sensitive_combustion_breakdown",

        title:
          "Load-sensitive combustion breakdown",

        mechanic_summary:
          "A combustion fault that is mild at idle but worsens under load commonly exposes ignition, fueling, or cylinder-contribution weakness.",

        why_primary:
          "Higher cylinder pressure makes a marginal spark path harder to fire and also exposes fuel-delivery or cylinder-contribution weaknesses. The behavior is more useful than guessing a part from a generic vibration complaint.",

        verification_focus: [
          "Compare misfire counters at idle and under controlled load.",

          "Inspect plug condition and gap, coil boots, and evidence of carbon tracking.",

          "If ignition checks pass, compare injector contribution and fuel-pressure behavior.",
        ],

        avoid:
          "Do not replace coils, plugs, or injectors blindly without identifying the failing cylinder or branch.",

        system_families: [
          "ignition",
          "fuel",
          "engine_performance",
        ],

        evidence_score:
          12,

        safety_priority:
          flashingCel
            ? "CAUTION"
            : "NORMAL",
      })
    );
  }

  if (
    bankSpecific
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "bank_specific_air_fuel_control",

        title:
          "Bank-specific air/fuel control path",

        mechanic_summary:
          "A bank-specific mixture pattern should be compared side-to-side rather than converted into an automatic oxygen-sensor replacement.",

        why_primary:
          "One-bank trim or feedback behavior can come from injector imbalance, an exhaust leak, sensor-feedback skew, localized unmetered air, or cylinder-contribution differences.",

        verification_focus: [
          "Compare short-term and long-term fuel trims by bank under the same operating condition.",

          "Check upstream feedback response and exhaust integrity before replacing a sensor.",

          "Use injector balance or cylinder-contribution testing when available.",
        ],

        avoid:
          "Do not replace an oxygen or air-fuel sensor only because fuel-trim data is abnormal.",

        system_families: [
          "fuel",
          "engine_performance",
        ],

        evidence_score:
          11,
      })
    );
  }

  return priorities;
}

/* ============================================================
   SMOKE TYPE
   ============================================================ */

function buildSmokeTypePriority(
  context = {}
) {
  const signals =
    context.extracted_signals || {};

  const priorities =
    [];

  if (
    hasSignal(
      signals,
      "white_smoke"
    )
  ) {
    const coolingSupport =
      hasSignal(
        signals,
        "overheating"
      ) ||
      hasSignal(
        signals,
        "coolant_loss"
      );

    addPriority(
      priorities,
      makePriority({
        key:
          "white_smoke_source_verification",

        title:
          "White-smoke source verification",

        mechanic_summary:
          coolingSupport
            ? "White exhaust smoke with cooling-system evidence raises concern for coolant entering the combustion or exhaust stream, but the leak path still requires confirmation."
            : "White exhaust smoke needs source verification before it is labeled as coolant intrusion; condensation and fuel-related causes remain possible depending on temperature and duration.",

        why_primary:
          coolingSupport
            ? "White smoke plus coolant loss or overheating is mechanically different from black rich smoke and should keep cooling-system integrity high in the verification plan."
            : "Smoke color alone does not prove a head-gasket or coolant-entry failure. Duration, odor, coolant level, temperature behavior, and combustion-gas evidence are needed.",

        verification_focus: [
          "Confirm whether the smoke persists after full warm-up or only appears during cold condensation.",

          "Check for verified coolant loss and cooling-system pressure loss with the engine cold.",

          "Use combustion-gas or cylinder-leakage testing only when cooling evidence supports it.",
        ],

        avoid:
          "Do not diagnose a head gasket from white smoke alone.",

        system_families: [
          "cooling",
          "engine_performance",
        ],

        evidence_score:
          coolingSupport
            ? 17
            : 8,

        safety_priority:
          hasSignal(
            signals,
            "overheating"
          )
            ? "CAUTION"
            : "NORMAL",
      })
    );
  }

  if (
    hasSignal(
      signals,
      "blue_smoke"
    )
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "blue_smoke_oil_consumption_path",

        title:
          "Blue-smoke oil-consumption path",

        mechanic_summary:
          "Blue exhaust smoke points toward oil entering the combustion or exhaust stream rather than a generic rich-fuel condition.",

        why_primary:
          "The timing of blue smoke—startup, deceleration, idle, or load—helps separate valve-seal, ring/blow-by, turbocharger, PCV, and other oil-entry paths.",

        verification_focus: [
          "Confirm when blue smoke is strongest: startup, idle, deceleration, or acceleration.",

          "Check actual oil consumption and PCV/crankcase behavior.",

          "Use compression, leak-down, or turbo inspection only when the behavior supports those branches.",
        ],

        avoid:
          "Do not route blue smoke into a rich-fuel diagnosis without separate fuel evidence.",

        system_families: [
          "engine_performance",
        ],

        evidence_score:
          12,
      })
    );
  }

  return priorities;
}

/* ============================================================
   COOLING
   ============================================================ */

function buildCoolingPriority(
  context = {}
) {
  const raw =
    context.raw_input || "";

  const signals =
    context.extracted_signals || {};

  const behaviors =
    getBehaviorKeys(
      context
    );

  const relationships =
    Array.isArray(
      context.behavior_relationships
    )
      ? context.behavior_relationships
      : [];

  const priorities =
    [];

  const overheating =
    hasSignal(
      signals,
      "overheating"
    );

  const coolantLoss =
    hasSignal(
      signals,
      "coolant_loss"
    );

  const overheatDenied =
    hasNegatedSignal(
      context,
      "overheating"
    ) &&
    !overheating;

  const thermal =
    hasSignal(
      signals,
      "heat_related"
    ) ||
    behaviors.includes(
      "thermal_failure_pattern"
    ) ||
    hasAffirmedAny(
      raw,
      [
        "only when hot",
        "when hot",
        "after warming up",
        "after driving",
        "heat soak",

        "cuando esta caliente",
        "despues de calentarse",
      ]
    );

  const airflowDependent =
    relationships.includes(
      "airflow_dependent_cooling_pattern"
    ) ||
    (
      hasSignal(
        signals,
        "idle_or_stopped_related"
      ) &&
      hasSignal(
        signals,
        "improves_with_speed"
      )
    );

  if (
    overheating
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "cooling_system_overheat_risk",

        title:
          "Cooling-system heat-rejection failure",

        mechanic_summary:
          "A confirmed overheating behavior remains a safety-sensitive engine-protection priority.",

        why_primary:
          "Temperature rise can result from coolant loss, airflow failure, thermostat or circulation restriction, radiator restriction, pressure loss, water-pump weakness, or combustion-gas intrusion. The behavior must be split before parts are replaced.",

        verification_focus: [
          "With the engine fully cold, verify coolant level and inspect or pressure-test for loss when appropriate.",

          "Compare temperature behavior at idle versus road speed and note whether airflow changes the symptom.",

          "Verify fan command/operation, thermostat or flow behavior, radiator temperature distribution, and pressure retention as appropriate.",
        ],

        avoid:
          "Do not open a hot cooling system or replace a thermostat, fan, pump, or radiator without isolating the failed heat-rejection branch.",

        system_families: [
          "cooling",
        ],

        evidence_score:
          coolantLoss
            ? 21
            : 18,

        safety_priority:
          "CAUTION",
      })
    );
  }

  if (
    coolantLoss &&
    !overheating
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "coolant_loss_without_confirmed_overheat",

        title:
          "Cooling-system loss / pressure-integrity path",

        mechanic_summary:
          "Coolant loss is important even when overheating has not been observed because loss can precede temperature rise.",

        why_primary:
          "The first task is to determine whether coolant is leaving externally, internally, through the cap/overflow path, or only appears low because of service history or trapped air.",

        verification_focus: [
          "Verify coolant level only with the engine fully cold.",

          "Inspect for external residue and pressure loss before assuming an internal leak.",

          "Escalate to combustion-gas or internal-leak testing only if evidence supports it.",
        ],

        avoid:
          "Do not call coolant loss a head-gasket failure without confirming the leak path.",

        system_families: [
          "cooling",
        ],

        evidence_score:
          13,

        safety_priority:
          "CAUTION",
      })
    );
  }

  if (
    airflowDependent &&
    !overheatDenied
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "airflow_dependent_cooling_path",

        title:
          "Airflow-dependent cooling path",

        mechanic_summary:
          "A temperature problem that is worse stopped and improves with vehicle speed strongly favors an airflow or low-speed heat-rejection branch.",

        why_primary:
          "Road speed adds natural airflow through the heat exchanger. Improvement with movement therefore raises fan command, fan motor, shroud/airflow, condenser/radiator obstruction, and low-speed airflow efficiency above unrelated cooling guesses.",

        verification_focus: [
          "Compare fan command with actual fan operation while the symptom is present.",

          "Inspect airflow restriction and fan/shroud condition.",

          "Confirm that temperature improvement truly follows vehicle airflow rather than engine RPM alone.",
        ],

        avoid:
          "Do not condemn the thermostat or water pump solely from an idle-only temperature rise that improves with road speed.",

        system_families: [
          "cooling",
        ],

        evidence_score:
          overheating
            ? 19
            : 10,

        safety_priority:
          overheating
            ? "CAUTION"
            : "NORMAL",
      })
    );
  }

  if (
    thermal &&
    !overheating &&
    !coolantLoss
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "heat_related_component_failure",

        title:
          "Heat-related component breakdown",

        mechanic_summary:
          "A symptom that appears only after heat builds should be tested hot instead of being mislabeled as overheating.",

        why_primary:
          "Heat can change electrical resistance, sensor behavior, relay/module operation, ignition strength, and fuel pressure. The affected system should be reproduced at operating temperature before it is cleared.",

        verification_focus: [
          "Confirm whether the symptom improves after cooling down.",

          "Test the affected system while hot, not only after a cold restart.",

          "Compare the relevant voltage, signal, pressure, or misfire behavior cold versus hot when tools are available.",
        ],

        avoid:
          "Do not turn a heat-related symptom into a cooling-system diagnosis unless actual temperature or coolant evidence supports overheating.",

        system_families: [
          "engine_performance",
          "electrical",
          "fuel",
          "ignition",
        ],

        evidence_score:
          8,
      })
    );
  }

  return priorities;
}

/* ============================================================
   BRAKES
   ============================================================ */

function buildBrakePriority(
  context = {}
) {
  const raw =
    context.raw_input || "";

  const signals =
    context.extracted_signals || {};

  const priorities =
    [];

  const critical =
    hasSignal(
      signals,
      "critical_braking_issue"
    ) ||
    hasAffirmedAny(
      raw,
      [
        "no brakes",
        "pedal goes to floor",
        "brake pedal goes to floor",
        "brake fluid leak",
        "major brake fluid leak",
        "red brake warning",

        "sin frenos",
        "pedal de freno se va al piso",
      ]
    );

  const braking =
    critical ||
    hasSignal(
      signals,
      "braking_issue"
    ) ||
    hasAffirmedAny(
      raw,
      [
        "when braking",
        "while braking",
        "brake vibration",
        "brake shake",
        "pedal pulsation",
        "soft brake pedal",
        "hard brake pedal",
        "grinding brakes",

        "al frenar",
        "vibracion al frenar",
        "pedal de freno blando",
      ]
    );

  if (
    critical
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "critical_brake_control_path",

        title:
          "Critical brake-control / hydraulic integrity path",

        mechanic_summary:
          "Loss of braking authority or hydraulic integrity requires immediate safety priority before any comfort or drivability diagnosis.",

        why_primary:
          "A pedal-to-floor, no-brake, or active fluid-loss complaint can indicate loss of hydraulic pressure or braking control and must outrank vibration or noise diagnosis.",

        verification_focus: [
          "Do not continue normal driving; arrange inspection or transport appropriate to the severity.",

          "Inspect hydraulic fluid loss, pedal behavior, master-cylinder/brake circuit integrity, and affected wheel circuits.",

          "Use ABS hydraulic and electronic diagnostics only after basic hydraulic integrity is established.",
        ],

        avoid:
          "Do not treat loss of braking authority as a rotor, pad, tire-balance, or ordinary vibration complaint.",

        system_families: [
          "brakes",
        ],

        evidence_score:
          25,

        safety_priority:
          "CRITICAL",
      })
    );

    return priorities;
  }

  if (
    braking
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "brake_system_safety_priority",

        title:
          "Brake-system diagnostic priority",

        mechanic_summary:
          "A symptom tied to braking force should remain in the brake/wheel-end diagnostic path until braking-system risk is separated.",

        why_primary:
          "Pulsation, vibration, grinding, pull, or pedal change under braking can come from friction, rotor/hub runout, caliper behavior, hydraulic pressure, ABS activity, or wheel-end faults.",

        verification_focus: [
          "Identify whether the symptom is felt in the steering wheel, brake pedal, or whole vehicle.",

          "Inspect friction surfaces, caliper movement, rotor/hub runout, and hydraulic condition as appropriate.",

          "Confirm pedal feel, pull, warning lights, and stopping performance before ranking comfort-related causes.",
        ],

        avoid:
          "Do not dismiss braking-only vibration as tire balance before the brake and wheel-end path is checked.",

        system_families: [
          "brakes",
        ],

        evidence_score:
          15,

        safety_priority:
          "CAUTION",
      })
    );
  }

  return priorities;
}

/* ============================================================
   STARTING / ELECTRICAL
   ============================================================ */

function buildStartingElectricalPriority(
  context = {}
) {
  const raw =
    context.raw_input || "";

  const signals =
    context.extracted_signals || {};

  const priorities =
    [];

  const noCrank =
    hasSignal(
      signals,
      "no_crank"
    ) ||
    hasAffirmedAny(
      raw,
      [
        "no crank",
        "does not crank",
        "doesn't crank",
        "only clicks",
        "starter clicks",
        "nothing happens when starting",

        "no gira el motor",
        "solo hace clic",
      ]
    );

  const slowCrank =
    hasSignal(
      signals,
      "slow_crank"
    ) ||
    hasAffirmedAny(
      raw,
      [
        "slow crank",
        "cranks slowly",
        "turns over slowly",

        "gira lento al arrancar",
      ]
    );

  const explicitCrankNoStart =
    hasAffirmedAny(
      raw,
      [
        "cranks but won't start",
        "cranks but will not start",
        "cranks but does not start",
        "cranks but doesn't start",
        "crank no start",
        "turns over but won't start",

        "gira pero no arranca",
      ]
    );

  const startup =
    hasSignal(
      signals,
      "startup_issue"
    ) ||
    noCrank ||
    slowCrank ||
    explicitCrankNoStart;

  const chargingEvidence =
    hasAffirmedAny(
      raw,
      [
        "battery light",
        "charging warning",
        "alternator",
        "low charging voltage",
        "battery not charging",

        "luz de bateria",
        "no esta cargando",
      ]
    );

  if (
    startup
  ) {
    let key =
      "starting_sequence_first";

    let title =
      "Starting-sequence classification";

    let summary =
      "The first diagnostic split is no-crank, slow-crank, crank-no-start, long-crank, or starts-then-dies.";

    if (
      noCrank
    ) {
      key =
        "no_crank_electrical_path";

      title =
        "No-crank power / starter / authorization path";

      summary =
        "The engine is not being rotated, so battery delivery, voltage drop, starter control, grounds, and start authorization move ahead of fuel or combustion guesses.";
    } else if (
      slowCrank
    ) {
      key =
        "slow_crank_voltage_load_path";

      title =
        "Slow-crank voltage / cable / starter-load path";

      summary =
        "Slow cranking makes available voltage, cable loss, grounds, battery state, starter draw, and mechanical drag the first verification branch.";
    } else if (
      explicitCrankNoStart
    ) {
      key =
        "crank_no_start_path";

      title =
        "Crank-no-start fuel / ignition / engine-signal path";

      summary =
        "The engine rotates but does not fire, so the diagnostic path moves away from a basic no-crank tree and toward spark, fuel, injector command, compression, RPM signal, and authorization.";
    }

    addPriority(
      priorities,
      makePriority({
        key,

        title,

        mechanic_summary:
          summary,

        why_primary:
          "Starting complaints cannot be ranked correctly until crank behavior is classified because no-crank, slow-crank, and normal-crank/no-start are different electrical and mechanical trees.",

        verification_focus: [
          "Confirm exact crank behavior and whether cranking speed is normal.",

          "Verify battery voltage and voltage drop during the start attempt when appropriate.",

          explicitCrankNoStart
            ? "If cranking is normal, verify spark, fuel pressure, injector pulse, compression, RPM signal, and authorization as applicable."
            : "If cranking is absent or slow, verify battery delivery, grounds, starter control, and starter current/load before deeper engine diagnosis.",
        ],

        avoid:
          "Do not replace a starter, battery, fuel pump, or sensor before the starting sequence and relevant branch are isolated.",

        system_families: [
          "starting_charging",
          "electrical",
          "ignition",
          "fuel",
        ],

        evidence_score:
          noCrank ||
          slowCrank ||
          explicitCrankNoStart
            ? 17
            : 11,
      })
    );
  }

  if (
    chargingEvidence
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "electrical_voltage_integrity_path",

        title:
          "Electrical voltage and charging integrity path",

        mechanic_summary:
          "Voltage stability should be verified before deeper module or sensor theories are trusted.",

        why_primary:
          "Low system voltage, charging instability, poor grounds, or cable voltage drop can create misleading faults across multiple modules and actuators.",

        verification_focus: [
          "Check battery state and charging behavior under the condition that produces the complaint.",

          "Perform voltage-drop testing on relevant positive and ground paths.",

          "Verify module or load power and ground before authorizing replacement.",
        ],

        avoid:
          "Do not diagnose modules or sensors from low-voltage symptoms until power and ground integrity are known.",

        system_families: [
          "electrical",
          "starting_charging",
        ],

        evidence_score:
          12,
      })
    );
  }

  return priorities;
}

/* ============================================================
   TRANSMISSION / DRIVETRAIN
   ============================================================ */

function buildTransmissionDrivetrainPriority(
  context = {}
) {
  const raw =
    context.raw_input || "";

  const signals =
    context.extracted_signals || {};

  const behaviors =
    getBehaviorKeys(
      context
    );

  const priorities =
    [];

  const vibration =
    hasSignal(
      signals,
      "vibration"
    ) ||
    hasAffirmedAny(
      raw,
      [
        "vibration",
        "shaking",
        "wobble",

        "vibracion",
        "tiembla",
      ]
    );

  const loadSensitive =
    hasSignal(
      signals,
      "load_sensitive"
    ) ||
    behaviors.includes(
      "load_sensitive_failure"
    ) ||
    hasAffirmedAny(
      raw,
      [
        "under load",
        "accelerating",
        "uphill",

        "al acelerar",
        "cuesta arriba",
      ]
    );

  const speedSensitive =
    hasSignal(
      signals,
      "speed_sensitive"
    ) ||
    behaviors.includes(
      "vehicle_speed_dependency"
    ) ||
    hasAffirmedAny(
      raw,
      [
        "highway speed",
        "at speed",
        "high speed",
        "60 mph",
        "65 mph",
        "70 mph",

        "a alta velocidad",
      ]
    );

  const transmission =
    hasAffirmedAny(
      raw,
      [
        "transmission slipping",
        "transmission slips",
        "hard shift",
        "harsh shift",
        "shift flare",
        "flaring between gears",
        "delayed engagement",
        "torque converter shudder",
        "line pressure",
        "atf temperature",

        "transmision patina",
        "cambio brusco",
      ]
    );

  if (
    transmission
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "transmission_pressure_or_apply_path",

        title:
          "Transmission pressure / apply-control path",

        mechanic_summary:
          "Slip, flare, harsh engagement, or delayed apply should be separated by commanded gear, temperature, pressure/control behavior, and internal apply integrity before the unit is condemned.",

        why_primary:
          "Transmission behavior changes with fluid temperature, commanded gear, hydraulic pressure, clutch apply, solenoid command, and internal sealing. Those relationships are more useful than a generic 'bad transmission' conclusion.",

        verification_focus: [
          "Verify fluid level/condition only using the correct procedure for the vehicle configuration.",

          "Compare commanded gear, input/output speed or slip data, and pressure-related data if available.",

          "Separate cold-only, hot-only, load-related, and gear-specific behavior.",
        ],

        avoid:
          "Do not condemn the entire transmission before separating fluid condition, control command, hydraulic pressure, solenoid behavior, and internal leakage.",

        system_families: [
          "transmission",
          "drivetrain",
        ],

        evidence_score:
          16,
      })
    );
  }

  if (
    vibration &&
    loadSensitive
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "load_sensitive_drivetrain_path",

        title:
          "Load-sensitive drivetrain / torque-delivery path",

        mechanic_summary:
          "A vibration that changes with throttle load should not be treated as simple wheel balance first.",

        why_primary:
          "Throttle changes engine torque without necessarily changing road speed. That points toward engine torque delivery, mounts, axles/CV joints, driveline angles, torque converter, or transmission load behavior.",

        verification_focus: [
          "Compare acceleration, steady cruise, and throttle-release behavior at similar vehicle speed.",

          "Separate engine-RPM dependency from road-speed dependency.",

          "Inspect mount, axle/CV, driveline, and torque-converter branches only after reproducing the load relationship.",
        ],

        avoid:
          "Do not lead with wheel balance if the vibration changes primarily with throttle rather than vehicle speed.",

        system_families: [
          "drivetrain",
          "transmission",
          "engine_performance",
        ],

        evidence_score:
          13,
      })
    );
  }

  if (
    vibration &&
    speedSensitive &&
    !loadSensitive
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "speed_related_wheel_tire_driveline_path",

        title:
          "Vehicle-speed-related wheel / tire / driveline path",

        mechanic_summary:
          "A vibration that follows road speed more than engine RPM raises rotating wheel-end or driveline causes above engine-combustion causes.",

        why_primary:
          "Road-speed vibration can enter through wheel/tire imbalance or structure, hub runout, wheel bearings, axles, or driveshaft components depending on where it is felt and whether load changes it.",

        verification_focus: [
          "Identify whether the vibration is strongest in the steering wheel, seat/floor, or pedal.",

          "Inspect tire structure/balance, wheel and hub runout, and wheel-bearing condition.",

          "Re-rank axle or driveshaft causes if throttle load changes the vibration at the same road speed.",
        ],

        avoid:
          "Do not label a road-speed vibration as engine vibration merely because engine RPM changes during acceleration.",

        system_families: [
          "drivetrain",
          "steering_suspension",
        ],

        evidence_score:
          11,
      })
    );
  }

  return priorities;
}

/* ============================================================
   NETWORK / SRS / STEERING
   ============================================================ */

function buildNetworkSafetyPriority(
  context = {}
) {
  const raw =
    context.raw_input || "";

  const dominantSignals =
    context.dominant_signals || [];

  const priorities =
    [];

  const networkEvidence =
    includesAny(
      dominantSignals,
      [
        "can",
        "module communication",
      ]
    ) ||
    hasAffirmedAny(
      raw,
      [
        "can bus",
        "u-code",
        "u code",
        "module offline",
        "no communication",
        "communication fault",
        "60 ohms",
        "oscilloscope",

        "sin comunicacion",
      ]
    );

  const srsEvidence =
    includesAny(
      dominantSignals,
      [
        "srs",
        "airbag",
      ]
    ) ||
    hasAffirmedAny(
      raw,
      [
        "airbag light",
        "srs light",
        "airbag warning",
        "srs warning",

        "luz de airbag",
      ]
    );

  const steeringEvidence =
    includesAny(
      dominantSignals,
      [
        "eps",
        "steering",
      ]
    ) ||
    hasAffirmedAny(
      raw,
      [
        "eps light",
        "steering angle",
        "torque sensor",
        "zero-point reset",
        "zero point reset",
        "steering calibration",
        "steering rack",

        "luz eps",
        "angulo de direccion",
      ]
    );

  if (
    networkEvidence
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "network_module_diagnostic_path",

        title:
          "CAN / module communication path",

        mechanic_summary:
          "Network faults require power, ground, communication, and bus integrity to be verified before module replacement.",

        why_primary:
          "U-codes and communication faults can be caused by low voltage, poor grounds, wiring faults, termination issues, module wake-up problems, or network-signal distortion. A missing module does not automatically mean that module has failed.",

        verification_focus: [
          "Verify battery voltage and affected-module power/grounds under load.",

          "Check network resistance or signal integrity using the correct procedure for the architecture.",

          "Compare scan-tool module presence and communication behavior before isolating a module.",
        ],

        avoid:
          "Do not replace a control module until network, power, ground, and connector integrity are verified.",

        system_families: [
          "network_can",
          "electrical",
        ],

        evidence_score:
          16,
      })
    );
  }

  if (
    srsEvidence
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "srs_safety_path",

        title:
          "SRS / restraint diagnostic path",

        mechanic_summary:
          "An SRS warning is a restraint-system fault and should be diagnosed from dedicated codes and circuit evidence rather than cleared as a cosmetic light.",

        why_primary:
          "The warning can involve sensor, pretensioner, occupancy, clock-spring, wiring, voltage-history, or module faults. The exact code and service history determine the correct branch.",

        verification_focus: [
          "Read SRS-specific codes with a capable scan tool.",

          "Review recent seat, steering-wheel, battery, or collision-related work.",

          "Follow manufacturer-safe circuit procedures rather than probing deployment circuits casually.",
        ],

        avoid:
          "Do not clear an SRS warning or replace restraint components without code and circuit verification.",

        system_families: [
          "srs",
          "electrical",
          "network_can",
        ],

        evidence_score:
          17,

        safety_priority:
          "CAUTION",
      })
    );
  }

  if (
    steeringEvidence
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "eps_steering_calibration_path",

        title:
          "EPS / steering verification path",

        mechanic_summary:
          "Electric steering complaints should separate mechanical bind from voltage, steering-angle, torque-sensor, calibration, and rack-control behavior.",

        why_primary:
          "EPS operation depends on power integrity, learned center, steering angle, torque input, alignment, tire forces, and rack mechanics. A calibration issue can mimic a component fault, but calibration should not be assumed without evidence.",

        verification_focus: [
          "Read EPS codes and compare steering-angle and torque-sensor data with the vehicle centered.",

          "Verify system voltage and recent rack/alignment/calibration history.",

          "Separate tire/alignment pull and mechanical bind from electronic assist behavior.",
        ],

        avoid:
          "Do not condemn a steering rack before voltage, codes, calibration data, alignment, and mechanical freedom are verified.",

        system_families: [
          "steering_suspension",
          "electrical",
          "network_can",
        ],

        evidence_score:
          14,

        safety_priority:
          "CAUTION",
      })
    );
  }

  return priorities;
}

/* ============================================================
   CRITICAL WARNING PATHS
   ============================================================ */

function buildCriticalWarningPriority(
  context = {}
) {
  const raw =
    context.raw_input || "";

  const priorities =
    [];

  const oilPressure =
    hasAffirmedAny(
      raw,
      [
        "oil pressure warning",
        "low oil pressure",
        "red oil light",
        "oil pressure light",

        "luz roja de aceite",
        "baja presion de aceite",
      ]
    );

  const burningElectrical =
    hasAffirmedAny(
      raw,
      [
        "electrical burning",
        "burning plastic",
        "smoke under hood",
        "smoke from engine bay",

        "olor a plastico quemado",
        "humo debajo del capo",
      ]
    );

  const stallingDriving =
    hasAffirmedAny(
      raw,
      [
        "stalls while driving",
        "dies while driving",
        "shuts off while driving",
        "engine dies while driving",

        "se apaga conduciendo",
        "se apaga mientras manejo",
      ]
    );

  if (
    oilPressure
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "oil_pressure_engine_protection_path",

        title:
          "Oil-pressure engine-protection path",

        mechanic_summary:
          "A genuine low-oil-pressure warning can indicate immediate lubrication risk and must be separated from a sender or circuit fault before continued operation.",

        why_primary:
          "Lubrication pressure protects bearings and rotating components. The warning therefore outranks non-safety drivability complaints until actual pressure versus electrical indication is established.",

        verification_focus: [
          "Stop the engine if a red oil-pressure warning remains on with the engine running or is accompanied by mechanical noise.",

          "Verify oil level with the vehicle safely parked and engine off, then use mechanical pressure testing when appropriate.",

          "Separate true low pressure from sender, wiring, or instrument indication before repair authorization.",
        ],

        avoid:
          "Do not continue driving on a persistent red oil-pressure warning while assuming it is only a sensor.",

        system_families: [
          "engine_performance",
          "electrical",
        ],

        evidence_score:
          26,

        safety_priority:
          "CRITICAL",
      })
    );
  }

  if (
    burningElectrical
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "burning_electrical_thermal_path",

        title:
          "Burning / electrical thermal-risk path",

        mechanic_summary:
          "Burning-plastic odor or smoke from the engine bay requires the heat source to be isolated before normal driving continues.",

        why_primary:
          "Electrical resistance, shorting, overheated wiring, fluid on a hot surface, belt/accessory friction, or another thermal source can create escalating fire or component-damage risk.",

        verification_focus: [
          "Stop and inspect safely if active smoke or a strong burning odor persists.",

          "Identify whether the source is electrical, fluid-on-hot-surface, belt/accessory, or exhaust-related.",

          "Verify affected power circuits and heat-damaged wiring before replacing downstream components.",
        ],

        avoid:
          "Do not keep driving through active smoke or a strong burning-plastic odor while treating it as an ordinary warning-light complaint.",

        system_families: [
          "electrical",
          "engine_performance",
        ],

        evidence_score:
          24,

        safety_priority:
          "CRITICAL",
      })
    );
  }

  if (
    stallingDriving
  ) {
    addPriority(
      priorities,
      makePriority({
        key:
          "stalling_while_driving_path",

        title:
          "Stalling-while-driving control path",

        mechanic_summary:
          "An engine that shuts off while the vehicle is moving creates a control and road-safety concern even when it restarts afterward.",

        why_primary:
          "The failure can involve power supply, crank/cam signal, fuel delivery, ignition, security/control logic, or module/network interruption. Trigger conditions are more important than random component replacement.",

        verification_focus: [
          "Document whether the stall follows heat, bumps, electrical load, deceleration, or low fuel level.",

          "Review codes, RPM signal, voltage, fuel-pressure behavior, and module communication around the event when data is available.",

          "Inspect power and ground interruptions before replacing modules or sensors.",
        ],

        avoid:
          "Do not treat repeated stalling in traffic as a low-priority drivability inconvenience.",

        system_families: [
          "engine_performance",
          "electrical",
          "fuel",
          "ignition",
          "network_can",
        ],

        evidence_score:
          20,

        safety_priority:
          "CAUTION",
      })
    );
  }

  return priorities;
}

/* ============================================================
   DOMINANT-LOCK ALIGNMENT
   ============================================================ */

function lockFamilies(
  lockedSystem = "general"
) {
  switch (
    lockedSystem
  ) {
    case "fuel_combustion":
      return [
        "fuel",
        "engine_performance",
      ];

    case "ignition_misfire":
      return [
        "ignition",
        "engine_performance",
      ];

    case "cooling_overheat":
      return [
        "cooling",
      ];

    case "brake_safety":
      return [
        "brakes",
      ];

    case "electrical_starting":
      return [
        "starting_charging",
        "electrical",
      ];

    case "transmission_drivetrain":
      return [
        "transmission",
        "drivetrain",
      ];

    case "network_modules":
      return [
        "network_can",
        "electrical",
      ];

    case "safety_restraint":
      return [
        "srs",
      ];

    case "steering_eps":
      return [
        "steering_suspension",
      ];

    default:
      return [];
  }
}

/* ============================================================
   PRIORITY RANKING
   ============================================================ */

function rankPriorities(
  priorities = [],
  context = {}
) {
  const lock =
    context.dominant_lock || {};

  const lockedSystem =
    lock.locked_system ||
    "general";

  const favoredFamilies =
    lockFamilies(
      lockedSystem
    );

  const ranked =
    priorities.map(
      (
        item,
        index
      ) => {
        const families =
          Array.isArray(
            item.system_families
          )
            ? item.system_families
            : [];

        const lockAligned =
          Boolean(
            lock.locked
          ) &&
          favoredFamilies.some(
            (family) =>
              families.includes(
                family
              )
          );

        const safetyBonus =
          SAFETY_PRIORITY[
            item.safety_priority
          ] || 0;

        const lockBonus =
          lockAligned
            ? 10
            : 0;

        const evidenceScore =
          Number(
            item.evidence_score ||
            0
          );

        return {
          ...item,

          _sourceOrder:
            index,

          _sortScore:
            evidenceScore +
            safetyBonus +
            lockBonus,

          lock_aligned:
            lockAligned,
        };
      }
    );

  ranked.sort(
    (
      a,
      b
    ) => {
      if (
        b._sortScore !==
        a._sortScore
      ) {
        return (
          b._sortScore -
          a._sortScore
        );
      }

      if (
        b.evidence_score !==
        a.evidence_score
      ) {
        return (
          b.evidence_score -
          a.evidence_score
        );
      }

      return (
        a._sourceOrder -
        b._sourceOrder
      );
    }
  );

  return ranked.map(
    (
      item,
      index
    ) => {
      const {
        _sourceOrder,
        _sortScore,
        ...publicItem
      } =
        item;

      return {
        ...publicItem,

        rank:
          index + 1,
      };
    }
  );
}

/* ============================================================
   SAFETY
   ============================================================ */

function buildSafetyTone(
  primary = {},
  context = {}
) {
  const raw =
    context.raw_input || "";

  const signals =
    context.extracted_signals || {};

  const riskFlags =
    Array.isArray(
      context.risk_flags
    )
      ? context.risk_flags
      : [];

  const criticalBrake =
    hasSignal(
      signals,
      "critical_braking_issue"
    ) ||
    includesAny(
      riskFlags,
      [
        "critical_brake_control_risk",
      ]
    );

  const activeOverheat =
    hasSignal(
      signals,
      "overheating"
    );

  const oilPressure =
    hasAffirmedAny(
      raw,
      [
        "oil pressure warning",
        "low oil pressure",
        "red oil light",
        "oil pressure light",

        "baja presion de aceite",
      ]
    );

  const activeBurningSmoke =
    hasAffirmedAny(
      raw,
      [
        "electrical burning",
        "burning plastic",
        "smoke under hood",
        "smoke from engine bay",
      ]
    );

  if (
    primary.safety_priority ===
      "CRITICAL" ||
    criticalBrake ||
    oilPressure ||
    activeBurningSmoke
  ) {
    return {
      /*
       * Retained for compatibility with existing diagnostic
       * context consumers.
       */
      level:
        "High",

      /*
       * Exact report-contract-compatible safety classification.
       */
      alert_level:
        "CRITICAL",

      instruction:
        "Treat the active safety condition as the first priority. Stop normal driving when the reported condition indicates loss of braking authority, persistent low oil pressure, active smoke/burning, or another immediate control risk, and arrange appropriate inspection or transport.",
    };
  }

  if (
    activeOverheat
  ) {
    return {
      level:
        "High",

      alert_level:
        "CAUTION",

      instruction:
        "Avoid continued operation while temperature is rising. Stop driving if the gauge reaches the red zone, steam appears, coolant is rapidly lost, or the engine begins to lose power.",
    };
  }

  if (
    primary.safety_priority ===
      "CAUTION" ||
    includesAny(
      riskFlags,
      [
        "possible_unburned_fuel_risk",
        "possible_rich_combustion_risk",
        "brake_inspection_required",
        "cooling_system_loss_risk",
      ]
    )
  ) {
    return {
      level:
        "Medium",

      alert_level:
        "CAUTION",

      instruction:
        "Limit vehicle stress and avoid extended or heavy-load driving until the leading safety-sensitive branch is checked. Stop if the symptom escalates, vehicle control changes, or a red warning appears.",
    };
  }

  return {
    level:
      "Low",

    alert_level:
      "NORMAL",

    instruction:
      "No immediate stop-driving condition is established from the supplied evidence. Continue only within normal safe operation and verify the leading diagnostic path before replacing parts.",
  };
}

/* ============================================================
   REPAIR HISTORY / TECHNICAL DATA GUARDRAILS
   ============================================================ */

function buildSessionGuardrails(
  context = {}
) {
  const behaviors =
    getBehaviorKeys(
      context
    );

  const guardrails =
    [];

  if (
    behaviors.includes(
      "repair_history_update"
    )
  ) {
    guardrails.push(
      "A previously replaced component is not automatically proven good or bad. Verify installation, connector/circuit integrity, calibration, and the replacement part itself only when current evidence still points to that branch. Do not recommend replacing the same part again without new confirmation."
    );
  }

  if (
    behaviors.includes(
      "technical_data_refinement"
    )
  ) {
    guardrails.push(
      "User-supplied measurements should outrank generic symptom guesses, but compare them only with known or vehicle-appropriate specifications. Do not invent manufacturer limits."
    );
  }

  if (
    behaviors.includes(
      "hypothesis_pivot"
    )
  ) {
    guardrails.push(
      "A user-proposed alternative should be evaluated against the evidence hierarchy; do not promote or reject it merely because the user suggested it."
    );
  }

  if (
    context.negated_signals
  ) {
    guardrails.push(
      "Explicitly negated symptoms remain negative evidence and must not be resurrected by raw keyword matching."
    );
  }

  return guardrails;
}

/* ============================================================
   PUBLIC ENGINE
   ============================================================ */

export function buildMechanicalPrioritization(
  context = {}
) {
  const collected =
    [];

  /*
   * Every builder receives the same canonical evidence context.
   *
   * Safety-critical evidence is collected like any other
   * mechanical path, then receives explicit ranking weight.
   */
  const builders = [
    buildCriticalWarningPriority,
    buildBrakePriority,
    buildCoolingPriority,
    buildFuelCombustionPriority,
    buildSmokeTypePriority,
    buildStartingElectricalPriority,
    buildTransmissionDrivetrainPriority,
    buildNetworkSafetyPriority,
  ];

  for (
    const builder of builders
  ) {
    const items =
      builder(
        context
      );

    for (
      const item of items
    ) {
      addPriority(
        collected,
        item
      );
    }
  }

  const ranked =
    rankPriorities(
      collected,
      context
    );

  const primary =
    ranked[0] || {
      key:
        "general_behavior_path",

      rank:
        1,

      title:
        "General behavior-based diagnostic path",

      mechanic_summary:
        "The available evidence does not yet justify locking a specific failed component or subsystem.",

      why_primary:
        "The safest diagnostic direction is to preserve the strongest operating-condition relationship and use one discriminating observation or test to separate the remaining system families.",

      verification_focus: [
        "Identify the exact condition that reproduces the symptom most reliably.",

        "Separate engine RPM, vehicle speed, load, braking, temperature, and startup relationships.",

        "Use scan data or measurements to confirm the behavior path rather than to replace the behavior evidence.",
      ],

      avoid:
        "Do not guess a component from a generic symptom when the system direction is still unresolved.",

      system_families: [
        "general",
      ],

      evidence_score:
        0,

      safety_priority:
        "NORMAL",

      lock_aligned:
        false,
    };

  const secondary =
    ranked
      .filter(
        (item) =>
          item.key !==
          primary.key
      )
      .slice(
        0,
        2
      );

  const secondaryKeys =
    new Set(
      secondary.map(
        (item) =>
          item.key
      )
    );

  const lowerPriority =
    ranked
      .filter(
        (item) =>
          item.key !==
            primary.key &&
          !secondaryKeys.has(
            item.key
          )
      )
      .slice(
        0,
        3
      );

  const safety =
    buildSafetyTone(
      primary,
      context
    );

  const sessionGuardrails =
    buildSessionGuardrails(
      context
    );

  return {
    primary,

    secondary,

    lower_priority:
      lowerPriority,

    safety,

    session_guardrails:
      sessionGuardrails,

    report_instruction:
      "Lead with the highest-ranked evidence-supported direction. Use secondary paths only when they remain mechanically plausible and explain what test separates them. Do not convert a priority into a confirmed failed component without direct verification.",

    wording_guardrail:
      "Explain the physical relationship between symptom and system. Avoid weak filler such as 'could be many things', but preserve real uncertainty when evidence does not isolate a component.",

    verification_guardrail:
      "Prefer non-invasive, high-information verification before removal or replacement. Measurements, scan data, and repeatable behavior outrank guess-based parts replacement.",

    evidence_guardrail:
      "Use canonical extracted signals and explicit user evidence. Negated symptoms are negative evidence. A keyword inside a denied statement must not create a positive priority.",
  };
}
