// DriveShift Mechanical Prioritization Engine v1
// Purpose:
// Convert signals + dominant lock + behavior reasoning into a mechanic-level priority order.
// This prevents weak "A or B" reports and gives the AI a clear diagnostic hierarchy.

function hasSignal(signals = {}, key) {
  return signals[key] === true;
}

function hasText(raw = "", words = []) {
  const text = String(raw || "").toLowerCase();
  return words.some((word) => text.includes(String(word).toLowerCase()));
}

function includesAny(list = [], values = []) {
  if (!Array.isArray(list)) return false;

  const normalized = list.map((x) => String(x).toLowerCase());

  return values.some((value) =>
    normalized.some((item) => item.includes(String(value).toLowerCase()))
  );
}

function addPriority(list, item) {
  if (!item?.key) return;

  const exists = list.some((x) => x.key === item.key);
  if (!exists) list.push(item);
}

function buildFuelCombustionPriority(context = {}) {
  const raw = context.raw_input || "";
  const signals = context.extracted_signals || {};
  const dominantSignals = context.dominant_signals || [];
  const behaviors =
    context.behavior_reasoning?.detected_behaviors?.map((b) => b.key) || [];

  const priorities = [];

  const hasSmoke = hasSignal(signals, "smoke") || hasText(raw, ["black smoke", "dark smoke"]);
  const hasFuelSmell =
    hasSignal(signals, "fuel_smell") ||
    hasText(raw, ["fuel smell", "gas smell", "raw fuel", "gasoline smell"]);

  const loadSensitive =
    hasSignal(signals, "load_sensitive") ||
    behaviors.includes("load_sensitive_failure") ||
    hasText(raw, ["heavy throttle", "under load", "uphill", "accelerating"]);

  const roughOrShake =
    hasSignal(signals, "vibration") ||
    hasSignal(signals, "rough_idle") ||
    hasText(raw, ["shaking", "misfire", "jerking", "rough"]);

  if (hasSmoke && hasFuelSmell && loadSensitive) {
    addPriority(priorities, {
      key: "rich_overfueling_under_load",
      rank: 1,
      title: "Rich overfueling under heavy load",
      mechanic_summary:
        "Black smoke and fuel odor under throttle keep this centered on excess fuel or fuel that is not being burned cleanly under load.",
      why_primary:
        "Black smoke is rich combustion behavior. Fuel smell means raw fuel is leaving the combustion event. Heavy-throttle worsening shows the failure appears when cylinder pressure and fuel demand rise.",
      verification_focus: [
        "Check misfire counters during load or snap-throttle testing.",
        "Inspect spark plugs for fuel fouling or wet/rich deposits.",
        "Verify fuel pressure behavior and injector leakage before replacing parts.",
      ],
      avoid:
        "Do not lead with generic fuel delivery weakness or random sensor guesses before separating overfueling from ignition breakdown.",
    });
  }

  if (hasSmoke && hasFuelSmell && roughOrShake) {
    addPriority(priorities, {
      key: "incomplete_combustion_raw_fuel",
      rank: 2,
      title: "Incomplete combustion leaving raw fuel",
      mechanic_summary:
        "The engine is showing signs of fuel entering the cylinders but not being burned cleanly.",
      why_primary:
        "Fuel odor plus shaking points toward combustion instability, where fuel is delivered but the burn event becomes weak or uneven.",
      verification_focus: [
        "Check cylinder-specific misfire data if available.",
        "Inspect plugs, coils, boots, and plug gap.",
        "Look for fuel-fouled plugs that identify the affected cylinder bank or cylinder.",
      ],
      avoid:
        "Do not call it a simple fuel smell without treating the misfire/catalyst risk seriously.",
    });
  }

  if (loadSensitive && roughOrShake) {
    addPriority(priorities, {
      key: "ignition_breakdown_under_cylinder_pressure",
      rank: 3,
      title: "Ignition breakdown under cylinder pressure",
      mechanic_summary:
        "Heavy throttle raises cylinder pressure, and weak spark components often fail exactly under that stress.",
      why_primary:
        "A coil, plug, boot, or excessive plug gap can fire at idle but break down when load increases cylinder pressure.",
      verification_focus: [
        "Check misfire counters under load.",
        "Swap suspect coils only after identifying a cylinder pattern.",
        "Inspect plug gap, plug condition, and coil boots for carbon tracking.",
      ],
      avoid:
        "Do not replace ignition parts blindly without confirming misfire behavior.",
    });
  }

  if (
    includesAny(dominantSignals, ["bank-specific fuel trim"]) ||
    hasText(raw, ["bank 1", "bank 2", "fuel trim", "o2 sensor", "restricted injector"])
  ) {
    addPriority(priorities, {
      key: "bank_specific_air_fuel_control",
      rank: 4,
      title: "Bank-specific air/fuel control fault",
      mechanic_summary:
        "Bank-specific data changes the path toward injector balance, oxygen sensor feedback, exhaust leak, or unmetered air on one side.",
      why_primary:
        "A bank-specific trim pattern is not the same as a general rich or lean complaint; it needs side-to-side comparison.",
      verification_focus: [
        "Compare short-term and long-term fuel trims by bank.",
        "Check oxygen sensor response and exhaust leaks before replacing sensors.",
        "Use injector balance or cylinder contribution testing if available.",
      ],
      avoid:
        "Do not replace oxygen sensors only because trim data is abnormal.",
    });
  }

  return priorities;
}

function buildCoolingPriority(context = {}) {
  const raw = context.raw_input || "";
  const signals = context.extracted_signals || {};
  const behaviors =
    context.behavior_reasoning?.detected_behaviors?.map((b) => b.key) || [];

  const priorities = [];

  const overheating =
    hasSignal(signals, "overheating") ||
    hasText(raw, ["overheating", "running hot", "temp gauge", "steam", "coolant"]);

  const thermal =
    hasSignal(signals, "heat_related") ||
    behaviors.includes("thermal_failure_pattern");

  if (overheating) {
    addPriority(priorities, {
      key: "cooling_system_overheat_risk",
      rank: 1,
      title: "Cooling system overheating risk",
      mechanic_summary:
        "Temperature rise must stay safety-priority because overheating can damage the engine quickly.",
      why_primary:
        "Overheating behavior points toward coolant loss, airflow failure, thermostat restriction, weak circulation, pressure loss, or internal coolant leakage.",
      verification_focus: [
        "Check coolant level and pressure-test the system cold.",
        "Verify fan operation and temperature behavior at idle versus highway speed.",
        "Confirm thermostat opening and coolant circulation before replacing parts.",
      ],
      avoid:
        "Do not continue driving into the red temperature range.",
    });
  }

  if (thermal && !overheating) {
    addPriority(priorities, {
      key: "heat_related_component_failure",
      rank: 2,
      title: "Heat-related component failure",
      mechanic_summary:
        "The symptom changes after heat builds, which points to a component failing once temperature or resistance rises.",
      why_primary:
        "Heat-related symptoms often expose ignition, sensor, relay, module, or pressure-related failures that may test normally when cold.",
      verification_focus: [
        "Confirm whether the symptom improves after cooling down.",
        "Test the affected system hot, not only cold.",
        "Look for heat-soak failure patterns in ignition, fuel pressure, sensors, or modules.",
      ],
      avoid:
        "Do not clear the fault just because it disappears after cooling.",
    });
  }

  return priorities;
}

function buildBrakePriority(context = {}) {
  const raw = context.raw_input || "";
  const signals = context.extracted_signals || {};
  const priorities = [];

  const braking =
    hasSignal(signals, "braking_issue") ||
    hasText(raw, ["when braking", "while braking", "brake vibration", "pedal pulsation", "soft brake pedal"]);

  if (braking) {
    addPriority(priorities, {
      key: "brake_system_safety_priority",
      rank: 1,
      title: "Brake-system safety priority",
      mechanic_summary:
        "Brake-related symptoms must be separated before treating the issue as ordinary vibration.",
      why_primary:
        "Vibration or pulsation under braking points toward rotor runout, pad transfer, hub runout, caliper drag, hydraulic concern, or ABS-related behavior.",
      verification_focus: [
        "Identify whether the shake is in the steering wheel, pedal, or whole vehicle.",
        "Inspect rotor condition, pad transfer, caliper movement, and hub runout.",
        "Check pedal feel and stopping distance before further driving.",
      ],
      avoid:
        "Do not dismiss brake vibration as tire balance until brake behavior is separated.",
    });
  }

  return priorities;
}

function buildStartingElectricalPriority(context = {}) {
  const raw = context.raw_input || "";
  const signals = context.extracted_signals || {};
  const priorities = [];

  const startup =
    hasSignal(signals, "startup_issue") ||
    hasText(raw, ["won't start", "no start", "no crank", "starter clicks", "crank no start"]);

  const electrical =
    hasText(raw, ["battery light", "alternator", "charging", "voltage", "clicking"]);

  if (startup) {
    addPriority(priorities, {
      key: "starting_sequence_first",
      rank: 1,
      title: "Starting-sequence classification",
      mechanic_summary:
        "The first diagnostic split is no-crank, crank-no-start, long-crank, or starts-then-dies.",
      why_primary:
        "Each starting behavior points to a different system: battery/starter, fuel, spark, compression, crank signal, immobilizer, or engine control.",
      verification_focus: [
        "Confirm whether the engine cranks normally, clicks, or does nothing.",
        "Check battery voltage and voltage drop during crank.",
        "If it cranks, verify spark, fuel pressure, injector pulse, and RPM signal.",
      ],
      avoid:
        "Do not jump to fuel or spark before confirming the exact starting behavior.",
    });
  }

  if (electrical) {
    addPriority(priorities, {
      key: "electrical_voltage_path",
      rank: 2,
      title: "Electrical voltage and charging path",
      mechanic_summary:
        "Voltage stability must be verified before chasing deeper control-system faults.",
      why_primary:
        "Weak battery, bad grounds, charging instability, or voltage drop can create misleading symptoms across multiple systems.",
      verification_focus: [
        "Check battery state and charging voltage.",
        "Perform voltage-drop testing on grounds and starter circuit.",
        "Confirm module power and ground before replacing components.",
      ],
      avoid:
        "Do not diagnose modules or sensors until voltage integrity is known.",
    });
  }

  return priorities;
}

function buildTransmissionDrivetrainPriority(context = {}) {
  const raw = context.raw_input || "";
  const signals = context.extracted_signals || {};
  const behaviors =
    context.behavior_reasoning?.detected_behaviors?.map((b) => b.key) || [];

  const priorities = [];

  const loadVibration =
    hasSignal(signals, "vibration") &&
    (hasSignal(signals, "load_sensitive") ||
      behaviors.includes("load_sensitive_failure"));

  const transmission =
    hasText(raw, ["transmission", "slipping", "hard shift", "flare", "flared", "torque converter"]);

  if (transmission || loadVibration) {
    addPriority(priorities, {
      key: "load_sensitive_drivetrain_path",
      rank: 1,
      title: "Load-sensitive drivetrain path",
      mechanic_summary:
        "A vibration that changes with throttle load should not be treated as simple tire balance first.",
      why_primary:
        "Throttle-load behavior points toward drivetrain load, mounts, axles, torque converter, transmission slip, or engine torque delivery.",
      verification_focus: [
        "Separate road-speed vibration from RPM-related vibration.",
        "Check whether the symptom changes when throttle is released.",
        "Compare behavior during acceleration, cruise, and deceleration.",
      ],
      avoid:
        "Do not lead with wheel balance unless the vibration follows road speed regardless of throttle.",
    });
  }

  return priorities;
}

function buildNetworkSafetyPriority(context = {}) {
  const raw = context.raw_input || "";
  const dominantSignals = context.dominant_signals || [];
  const priorities = [];

  if (
    includesAny(dominantSignals, ["CAN", "module communication"]) ||
    hasText(raw, ["can bus", "u-code", "u code", "no communication", "60 ohms", "oscilloscope"])
  ) {
    addPriority(priorities, {
      key: "network_module_diagnostic_path",
      rank: 1,
      title: "CAN/module communication path",
      mechanic_summary:
        "Network faults need power, ground, communication, and bus integrity verified before module replacement.",
      why_primary:
        "U-codes and communication faults often come from voltage, grounds, wiring, termination resistance, or network signal quality.",
      verification_focus: [
        "Check battery voltage and module power/grounds.",
        "Verify CAN resistance and communication at the DLC.",
        "Use scan-tool module presence and network scope data when available.",
      ],
      avoid:
        "Do not replace modules before validating network integrity.",
    });
  }

  if (
    includesAny(dominantSignals, ["SRS", "airbag"]) ||
    hasText(raw, ["airbag", "srs"])
  ) {
    addPriority(priorities, {
      key: "srs_safety_path",
      rank: 1,
      title: "SRS/restraint safety path",
      mechanic_summary:
        "Airbag/SRS faults are safety-system faults and should not be treated as cosmetic warnings.",
      why_primary:
        "SRS faults can disable restraint protection or indicate circuit/module faults that require code-based diagnosis.",
      verification_focus: [
        "Read SRS-specific codes with a capable scanner.",
        "Check recent seat, steering wheel, battery, or collision-related work.",
        "Do not probe airbag circuits carelessly.",
      ],
      avoid:
        "Do not clear SRS faults without confirming the circuit or module cause.",
    });
  }

  return priorities;
}

function buildSafetyTone(primary = {}, context = {}) {
  const severity = context.severity || "low";
  const raw = context.raw_input || "";
  const riskFlags = context.risk_flags || [];

  const hasFuelRisk =
    primary.key === "rich_overfueling_under_load" ||
    primary.key === "incomplete_combustion_raw_fuel" ||
    includesAny(riskFlags, ["raw_fuel", "catalytic"]);

  if (primary.key === "brake_system_safety_priority") {
    return {
      level: "High",
      instruction:
        "Limit driving and inspect the braking system immediately. Stop driving if pedal feel changes, stopping distance increases, grinding appears, or the vehicle pulls hard.",
    };
  }

  if (primary.key === "cooling_system_overheat_risk") {
    return {
      level: "High",
      instruction:
        "Stop driving if the temperature reaches the red zone, steam appears, coolant drops quickly, or the engine begins to lose power.",
    };
  }

  if (hasFuelRisk) {
    return {
      level: "Medium",
      instruction:
        "Limit driving until inspected. Avoid heavy throttle because raw fuel can overheat and damage the catalytic converter.",
    };
  }

  if (hasText(raw, ["flashing check engine", "check engine light flashes", "red warning"])) {
    return {
      level: "High",
      instruction:
        "Limit driving immediately and stop if the warning remains active, power drops hard, smoke increases, or the vehicle feels unstable.",
    };
  }

  if (severity === "high") {
    return {
      level: "High",
      instruction:
        "Limit driving until the system is inspected. Stop if the symptom worsens, the vehicle feels unsafe, or a red warning appears.",
    };
  }

  return {
    level: "Medium",
    instruction:
      "Vehicle may be moved carefully if it feels stable, but avoid stressing it until the cause is confirmed.",
  };
}

export function buildMechanicalPrioritization(context = {}) {
  const lock = context.dominant_lock || {};
  const lockedSystem = lock.locked_system || "general";

  let priorities = [];

  if (lockedSystem === "fuel_combustion" || lockedSystem === "ignition_misfire") {
    priorities = [
      ...priorities,
      ...buildFuelCombustionPriority(context),
    ];
  }

  if (lockedSystem === "cooling_overheat") {
    priorities = [
      ...priorities,
      ...buildCoolingPriority(context),
    ];
  }

  if (lockedSystem === "brake_safety") {
    priorities = [
      ...priorities,
      ...buildBrakePriority(context),
    ];
  }

  if (lockedSystem === "electrical_starting") {
    priorities = [
      ...priorities,
      ...buildStartingElectricalPriority(context),
    ];
  }

  if (lockedSystem === "transmission_drivetrain") {
    priorities = [
      ...priorities,
      ...buildTransmissionDrivetrainPriority(context),
    ];
  }

  if (
    lockedSystem === "network_modules" ||
    lockedSystem === "safety_restraint" ||
    lockedSystem === "steering_eps"
  ) {
    priorities = [
      ...priorities,
      ...buildNetworkSafetyPriority(context),
    ];
  }

  // Always add cross-check priorities when text strongly supports them.
  priorities = [
    ...priorities,
    ...buildFuelCombustionPriority(context),
    ...buildCoolingPriority(context),
    ...buildBrakePriority(context),
    ...buildStartingElectricalPriority(context),
    ...buildTransmissionDrivetrainPriority(context),
    ...buildNetworkSafetyPriority(context),
  ];

  const deduped = [];
  for (const item of priorities) {
    if (!deduped.some((x) => x.key === item.key)) deduped.push(item);
  }

  deduped.sort((a, b) => a.rank - b.rank);

  const primary = deduped[0] || {
    key: "general_behavior_path",
    rank: 1,
    title: "General behavior-based diagnostic path",
    mechanic_summary:
      "The next step is to preserve the strongest symptom behavior and avoid random part guessing.",
    why_primary:
      "There is not enough priority evidence yet to lock one system above the others.",
    verification_focus: [
      "Identify when the symptom happens.",
      "Separate load, idle, braking, speed, heat, and startup behavior.",
      "Use codes or live data only to confirm the behavior path.",
    ],
    avoid:
      "Do not guess parts without a behavior pattern.",
  };

  const secondary = deduped.filter((item) => item.key !== primary.key).slice(0, 2);
  const lowerPriority = deduped.filter(
    (item) => item.key !== primary.key && !secondary.some((s) => s.key === item.key)
  ).slice(0, 3);

  const safety = buildSafetyTone(primary, context);

  return {
    primary,
    secondary,
    lower_priority: lowerPriority,
    safety,

    report_instruction:
      "Write the final diagnosis using primary as the lead direction. Mention secondary only as supporting or alternate verification path. Do not write weak OR language unless two paths are truly tied.",

    wording_guardrail:
      "Prefer precise mechanic wording. Avoid 'fuel delivery or ignition breakdown' as the lead when a richer priority exists. Lead with the strongest behavior pattern.",

    verification_guardrail:
      "Give practical confirmation steps before replacement. Do not claim confirmed failed parts without measurements.",
  };
}
