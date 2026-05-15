// DriveShift Mechanical Prioritization Engine v2
// Purpose:
// Build a strong mechanic-level diagnostic hierarchy.
// This file protects the dominant symptom, prevents weak "A or B" reports,
// and gives the final AI report a clear master-technician direction.

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

  const hasSmoke =
    hasSignal(signals, "smoke") ||
    hasText(raw, ["black smoke", "dark smoke", "humo negro"]);

  const hasBlackSmoke = hasText(raw, ["black smoke", "dark smoke", "humo negro"]);

  const hasFuelSmell =
    hasSignal(signals, "fuel_smell") ||
    hasText(raw, [
      "fuel smell",
      "gas smell",
      "raw fuel",
      "gasoline smell",
      "smells like gas",
      "strong fuel",
      "unburned fuel",
    ]);

  const loadSensitive =
    hasSignal(signals, "load_sensitive") ||
    behaviors.includes("load_sensitive_failure") ||
    hasText(raw, ["heavy throttle", "under load", "uphill", "accelerating", "acceleration"]);

  const roughOrShake =
    hasSignal(signals, "vibration") ||
    hasSignal(signals, "rough_idle") ||
    hasText(raw, ["shaking", "misfire", "jerking", "rough", "stumble", "hesitation"]);

  const flashingCel = hasText(raw, [
    "flashing check engine",
    "check engine light flashes",
    "flashing cel",
    "cel flashes",
  ]);

  if (hasBlackSmoke && hasFuelSmell) {
    addPriority(priorities, {
      key: "rich_raw_fuel_exhaust_priority",
      rank: 1,
      title: "Rich raw-fuel exhaust pattern",
      mechanic_summary:
        "Black smoke with raw fuel odor is a strong rich-combustion signature. The engine is either being overfueled or the delivered fuel is not being burned cleanly.",
      why_primary:
        "Black exhaust means excessive fuel or poor burn quality. Raw fuel smell confirms fuel is leaving the combustion event instead of being fully converted into power. This keeps the diagnostic path on injector leakage, fuel pressure regulation, fuel control error, ignition burn failure, or sensor feedback skew.",
      verification_focus: [
        "Check fuel trims and oxygen sensor behavior during idle and throttle snap.",
        "Inspect spark plugs for wet fuel, carbon loading, or cylinder-specific fouling.",
        "Check injector leakage, fuel pressure regulator behavior, and misfire counters before replacing sensors.",
      ],
      avoid:
        "Do not lead with vacuum leak or cooling-system theories when black smoke and fuel odor are present unless coolant loss or overheating is confirmed.",
    });
  }

  if (hasSmoke && hasFuelSmell && loadSensitive) {
    addPriority(priorities, {
      key: "rich_overfueling_under_load",
      rank: 2,
      title: "Rich overfueling under heavy load",
      mechanic_summary:
        "Throttle load makes the failure stronger, which means the fault shows up when cylinder pressure and fuel demand rise.",
      why_primary:
        "Heavy throttle increases cylinder pressure and fuel command. If smoke and fuel odor rise with load, the system is either adding too much fuel, losing ignition authority, or failing to burn the mixture cleanly under pressure.",
      verification_focus: [
        "Check misfire counters during load or snap-throttle testing.",
        "Verify fuel pressure behavior during acceleration.",
        "Inspect plug gap, coil boots, and fuel-fouled plugs before replacing major components.",
      ],
      avoid:
        "Do not call this simple fuel delivery weakness before separating overfueling from ignition breakdown.",
    });
  }

  if ((flashingCel || roughOrShake) && hasFuelSmell) {
    addPriority(priorities, {
      key: "misfire_raw_fuel_catalyst_risk",
      rank: 3,
      title: "Misfire with raw-fuel catalyst risk",
      mechanic_summary:
        "The combustion event is unstable enough that raw fuel may be entering the exhaust stream.",
      why_primary:
        "A flashing check-engine light or strong shake with fuel smell is a classic catalyst-risk pattern. Fuel is being injected, but one or more cylinders may not be burning it completely.",
      verification_focus: [
        "Read cylinder-specific misfire counters.",
        "Inspect plugs, coils, boots, and injector behavior on the affected cylinder or bank.",
        "Avoid extended driving under load until catalyst-damaging misfire is ruled out.",
      ],
      avoid:
        "Do not treat this as a harmless check-engine light if the engine is shaking or fuel odor is present.",
    });
  }

  if (loadSensitive && roughOrShake) {
    addPriority(priorities, {
      key: "ignition_breakdown_under_cylinder_pressure",
      rank: 4,
      title: "Ignition breakdown under cylinder pressure",
      mechanic_summary:
        "Weak ignition often survives idle but fails under heavy cylinder pressure.",
      why_primary:
        "Hard acceleration raises cylinder pressure. A weak coil, worn plug, damaged boot, carbon tracking, or excessive plug gap may fire at idle but fail when the mixture becomes harder to ignite.",
      verification_focus: [
        "Check misfire counters under load.",
        "Inspect plug gap, plug condition, and coil boots for carbon tracking.",
        "Swap coils only after identifying a cylinder pattern.",
      ],
      avoid:
        "Do not replace ignition parts blindly without confirming misfire behavior.",
    });
  }

  if (
    includesAny(dominantSignals, ["bank-specific fuel trim"]) ||
    hasText(raw, ["bank 1", "bank 2", "fuel trim", "o2 sensor", "restricted injector", "upstream o2"])
  ) {
    addPriority(priorities, {
      key: "bank_specific_air_fuel_control",
      rank: 5,
      title: "Bank-specific air/fuel control fault",
      mechanic_summary:
        "A bank-specific mixture fault needs side-to-side comparison, not random sensor replacement.",
      why_primary:
        "One-bank trim or O2 behavior points toward injector balance, exhaust leak, oxygen sensor feedback skew, restricted injector, or unmetered air on one side.",
      verification_focus: [
        "Compare short-term and long-term fuel trims by bank.",
        "Check upstream O2 response and exhaust leaks before replacing sensors.",
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
    hasText(raw, [
      "overheating",
      "overheat",
      "running hot",
      "temp gauge",
      "temperature gauge",
      "steam",
      "coolant loss",
      "losing coolant",
    ]);

  const denied = hasText(raw, [
    "no overheating",
    "temperature normal",
    "temperature stays normal",
    "temp stays normal",
    "no coolant loss",
    "no steam",
  ]);

  const thermal =
    hasSignal(signals, "heat_related") ||
    behaviors.includes("thermal_failure_pattern") ||
    hasText(raw, ["only when hot", "after warming up", "after driving", "heat soak"]);

  if (overheating && !denied) {
    addPriority(priorities, {
      key: "cooling_system_overheat_risk",
      rank: 1,
      title: "Cooling system heat-rejection failure",
      mechanic_summary:
        "A real temperature rise stays safety-priority because overheating can damage the engine quickly.",
      why_primary:
        "Overheating behavior points toward coolant loss, airflow failure, thermostat restriction, weak circulation, pressure loss, radiator restriction, water-pump weakness, or combustion gas intrusion.",
      verification_focus: [
        "Check coolant level cold and pressure-test the system.",
        "Compare temperature behavior at idle, highway speed, and with A/C on.",
        "Verify fan operation, thermostat opening, coolant circulation, and pressure-cap behavior.",
      ],
      avoid:
        "Do not keep driving into the red temperature range or replace the thermostat blindly before confirming flow and pressure.",
    });
  }

  if (thermal && !overheating) {
    addPriority(priorities, {
      key: "heat_related_component_failure",
      rank: 6,
      title: "Heat-related component breakdown",
      mechanic_summary:
        "The symptom changing after heat builds points to a component failing once temperature or electrical resistance rises.",
      why_primary:
        "Heat-related symptoms often expose ignition coils, crank sensors, relays, modules, fuel pressure loss, or electrical components that test normally when cold.",
      verification_focus: [
        "Confirm whether the symptom improves after cooling down.",
        "Test the affected system hot, not only cold.",
        "Look for heat-soak failure patterns in ignition, fuel pressure, sensors, and modules.",
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
    hasText(raw, [
      "when braking",
      "while braking",
      "brake vibration",
      "pedal pulsation",
      "soft brake pedal",
      "hard brake pedal",
      "brake pedal",
      "grinding brakes",
      "no brakes",
      "pedal goes to floor",
    ]);

  if (braking) {
    addPriority(priorities, {
      key: "brake_system_safety_priority",
      rank: 1,
      title: "Brake-system safety priority",
      mechanic_summary:
        "Brake-related symptoms must be separated before treating the issue as ordinary vibration.",
      why_primary:
        "Vibration, pulsation, grinding, or pedal change under braking points toward rotor runout, pad transfer, hub runout, caliper drag, hydraulic pressure loss, booster/vacuum failure, or ABS-related behavior.",
      verification_focus: [
        "Identify whether the shake is in the steering wheel, pedal, or whole vehicle.",
        "Inspect rotor condition, pad transfer, caliper movement, hub runout, and hydraulic leaks.",
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
    hasText(raw, [
      "won't start",
      "will not start",
      "does not start",
      "doesn't start",
      "no start",
      "no crank",
      "starter clicks",
      "only clicks",
      "crank no start",
      "cranks but won't start",
    ]);

  const noCrank = hasText(raw, [
    "no crank",
    "does not crank",
    "doesn't crank",
    "only clicks",
    "starter clicks",
    "nothing happens",
    "no sound",
  ]);

  const crankNoStart = hasText(raw, [
    "cranks but won't start",
    "cranks but does not start",
    "crank no start",
    "turns over but won't start",
  ]);

  const electrical =
    hasText(raw, ["battery light", "alternator", "charging", "voltage", "clicking", "low voltage"]);

  if (startup) {
    addPriority(priorities, {
      key: noCrank ? "no_crank_electrical_path" : crankNoStart ? "crank_no_start_path" : "starting_sequence_first",
      rank: 1,
      title: noCrank
        ? "No-crank electrical/starter path"
        : crankNoStart
        ? "Crank-no-start fuel/ignition/signal path"
        : "Starting-sequence classification",
      mechanic_summary:
        noCrank
          ? "The engine is not being rotated, so the first path is battery, starter, relay, ground, ignition switch, or security authorization."
          : crankNoStart
          ? "The engine rotates but does not fire, so the path moves to fuel pressure, spark, injector pulse, compression, RPM signal, or immobilizer."
          : "The first diagnostic split is no-crank, crank-no-start, long-crank, or starts-then-dies.",
      why_primary:
        "Starting complaints cannot be diagnosed correctly until the exact starting behavior is separated. No-crank and crank-no-start are completely different diagnostic trees.",
      verification_focus: [
        "Confirm whether the engine cranks normally, clicks, or does nothing.",
        "Check battery voltage and voltage drop during crank.",
        "If it cranks, verify spark, fuel pressure, injector pulse, compression, and RPM signal.",
      ],
      avoid:
        "Do not jump to fuel pump, starter, or sensors before confirming the exact starting behavior.",
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

  const hasVibration = hasSignal(signals, "vibration") || hasText(raw, [
    "vibration",
    "shake",
    "shaking",
    "wobble",
  ]);

  const loadVibration =
    hasVibration &&
    (hasSignal(signals, "load_sensitive") ||
      behaviors.includes("load_sensitive_failure") ||
      hasText(raw, ["accelerating", "under load", "uphill"]));

  const speedVibration =
    hasVibration &&
    hasText(raw, ["highway", "60 mph", "65 mph", "70 mph", "at speed", "high speed"]);

  const transmission =
    hasText(raw, [
      "transmission",
      "slipping",
      "hard shift",
      "flare",
      "flared",
      "torque converter",
      "atf",
      "line pressure",
    ]);

  if (transmission) {
    addPriority(priorities, {
      key: "transmission_pressure_or_apply_path",
      rank: 2,
      title: "Transmission pressure/apply control path",
      mechanic_summary:
        "Shift flare, slip, or harsh engagement points toward pressure control, clutch apply, valve body behavior, solenoid command, or internal sealing.",
      why_primary:
        "Transmission symptoms change with fluid temperature, load, commanded gear, and pressure. That makes pressure/apply behavior more important than guessing a whole transmission failure.",
      verification_focus: [
        "Check ATF level, condition, and temperature behavior.",
        "Compare commanded gear, slip speed, and line-pressure data if available.",
        "Separate cold-only, hot-only, and load-related shift symptoms.",
      ],
      avoid:
        "Do not condemn the transmission before separating fluid, pressure command, solenoid control, and internal leakage.",
    });
  }

  if (loadVibration) {
    addPriority(priorities, {
      key: "load_sensitive_drivetrain_path",
      rank: 3,
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

  if (speedVibration && !loadVibration) {
    addPriority(priorities, {
      key: "speed_related_wheel_tire_driveline_path",
      rank: 4,
      title: "Speed-related wheel/tire/driveline vibration path",
      mechanic_summary:
        "A vibration that follows road speed points first toward rotating mass, runout, balance, tire structure, wheel bearing, or driveline angle.",
      why_primary:
        "Road-speed vibration usually enters through the steering wheel, seat, floor, or pedal depending on which rotating assembly is exciting the chassis.",
      verification_focus: [
        "Identify whether it is felt in the steering wheel, seat/floor, or brake pedal.",
        "Inspect tire balance, tire separation, wheel runout, hub runout, and wheel bearings.",
        "Check driveshaft/CV/axle behavior if it changes under load.",
      ],
      avoid:
        "Do not call it engine vibration if it tracks vehicle speed instead of RPM.",
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
        "U-codes and communication faults often come from voltage, grounds, wiring, termination resistance, module wake-up issues, or network signal quality.",
      verification_focus: [
        "Check battery voltage and module power/grounds under load.",
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

  if (
    includesAny(dominantSignals, ["EPS", "steering"]) ||
    hasText(raw, ["eps", "steering rack", "torque sensor", "zero-point reset", "steering angle"])
  ) {
    addPriority(priorities, {
      key: "eps_steering_calibration_path",
      rank: 2,
      title: "EPS steering calibration path",
      mechanic_summary:
        "After steering or rack work, EPS calibration and torque-sensor zero point can create symptoms that look like a bad part.",
      why_primary:
        "Electric steering depends on learned center, torque input, steering angle, module power, and rack position. If those are not aligned, the system can feel notchy, pull, or fail to return correctly.",
      verification_focus: [
        "Check steering angle and torque sensor zero point with a capable scan tool.",
        "Confirm EPS codes and module voltage before replacing the rack.",
        "Verify alignment and tire pull after electronic calibration.",
      ],
      avoid:
        "Do not condemn a steering rack until calibration, angle, torque zero, voltage, and alignment are verified.",
    });
  }

  return priorities;
}

function buildSafetyTone(primary = {}, context = {}) {
  const severity = context.severity || "low";
  const raw = context.raw_input || "";
  const riskFlags = context.risk_flags || [];

  const hasFuelRisk =
    primary.key === "rich_raw_fuel_exhaust_priority" ||
    primary.key === "rich_overfueling_under_load" ||
    primary.key === "incomplete_combustion_raw_fuel" ||
    primary.key === "misfire_raw_fuel_catalyst_risk" ||
    includesAny(riskFlags, ["raw_fuel", "catalytic"]) ||
    hasText(raw, ["fuel smell", "raw fuel", "black smoke", "flashing check engine"]);

  if (primary.key === "brake_system_safety_priority") {
    return {
      level: "High",
      instruction:
        "Brake symptoms are safety-sensitive. Limit driving and inspect the braking system immediately, especially if pedal feel changes, stopping distance increases, grinding appears, or the vehicle pulls hard.",
    };
  }

  if (primary.key === "cooling_system_overheat_risk") {
    return {
      level: "High",
      instruction:
        "Overheating can damage the engine quickly. Stop driving if the temperature reaches the red zone, steam appears, coolant drops quickly, or the engine begins to lose power.",
    };
  }

  if (hasFuelRisk) {
    return {
      level: "High",
      instruction:
        "Limit driving and avoid heavy throttle until inspected. Raw fuel and misfire behavior can overheat and damage the catalytic converter.",
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
      "Move the vehicle carefully only if it feels stable, but avoid stressing it until the cause is confirmed.",
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
      "The strongest symptom behavior must be preserved before any part is guessed.",
    why_primary:
      "There is not enough priority evidence yet to lock one system above the others, so the safest path is to separate load, idle, braking, speed, heat, and startup behavior.",
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
      "Write the final diagnosis using primary as the lead direction. Mention secondary only as verification paths or lower-priority checks. Do not write weak OR language unless two paths are truly tied.",

    wording_guardrail:
      "Lead with the strongest behavior pattern. Use mechanic language that explains why the symptom happens physically. Avoid generic phrases such as 'could be many things', 'possibly', or 'consult a mechanic'.",

    verification_guardrail:
      "Give practical confirmation steps before replacement. Do not claim a confirmed failed part without measurements, scan data, inspection, or repeatable symptom behavior.",
  };
}
