// DriveShift Dominant Symptom Lock Engine v1
// Purpose:
// Keep the diagnostic direction stable so the AI does not drift away from the strongest symptom.
// This layer turns extracted signals into a locked diagnostic direction.

const LOCK_LEVELS = {
  CRITICAL: "critical",
  STRONG: "strong",
  MODERATE: "moderate",
  WEAK: "weak",
};

function hasSignal(signals = {}, key) {
  return signals[key] === true;
}

function hasAnyText(raw = "", words = []) {
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

function scoreSystem(scores, system, points, reason) {
  if (!scores[system]) {
    scores[system] = {
      score: 0,
      reasons: [],
    };
  }

  scores[system].score += points;

  if (reason) {
    scores[system].reasons.push(reason);
  }
}

function buildSystemScores({
  extracted_signals = {},
  dominant_systems = [],
  risk_flags = [],
  dominant_signals = [],
  raw_input = "",
}) {
  const scores = {};

  // Fuel / combustion direction
  if (hasSignal(extracted_signals, "smoke")) {
    scoreSystem(scores, "fuel_combustion", 5, "Smoke indicates abnormal combustion or exhaust output.");
  }

  if (hasSignal(extracted_signals, "fuel_smell")) {
    scoreSystem(scores, "fuel_combustion", 5, "Fuel odor suggests raw fuel, rich running, or incomplete combustion.");
  }

  if (includesAny(dominant_signals, ["black smoke", "rich running"])) {
    scoreSystem(scores, "fuel_combustion", 6, "Black smoke strongly supports rich combustion behavior.");
  }

  if (includesAny(dominant_signals, ["raw fuel combustion failure"])) {
    scoreSystem(scores, "fuel_combustion", 8, "Smoke plus fuel odor locks the case toward raw fuel combustion failure.");
  }

  // Ignition / misfire direction
  if (hasSignal(extracted_signals, "rough_idle")) {
    scoreSystem(scores, "ignition_misfire", 4, "Rough idle supports misfire or unstable combustion.");
  }

  if (hasSignal(extracted_signals, "startup_issue")) {
    scoreSystem(scores, "ignition_misfire", 3, "Starting difficulty can involve ignition, fuel delivery, or compression.");
  }

  if (includesAny(dominant_signals, ["misfire", "shaking"])) {
    scoreSystem(scores, "ignition_misfire", 6, "Misfire or shaking points toward unstable cylinder contribution.");
  }

  if (hasAnyText(raw_input, ["flashing check engine", "check engine light flashes", "cel flashes"])) {
    scoreSystem(scores, "ignition_misfire", 7, "A flashing check engine light is commonly tied to active misfire risk.");
  }

  // Cooling / overheating direction
  if (hasSignal(extracted_signals, "overheating")) {
    scoreSystem(scores, "cooling_overheat", 10, "Overheating is a high-priority engine damage risk.");
  }

  if (includesAny(dominant_signals, ["overheating", "cooling risk", "critical overheating"])) {
    scoreSystem(scores, "cooling_overheat", 8, "Cooling-risk language reinforces overheating as the dominant concern.");
  }

  // Brake safety direction
  if (hasSignal(extracted_signals, "braking_issue")) {
    scoreSystem(scores, "brake_safety", 10, "Brake vibration or brake symptoms require safety-first handling.");
  }

  if (includesAny(dominant_signals, ["brake safety"])) {
    scoreSystem(scores, "brake_safety", 8, "Brake safety risk must remain locked above comfort or drivability guesses.");
  }

  // Electrical / no-start direction
  if (includesAny(dominant_systems, ["electrical"])) {
    scoreSystem(scores, "electrical_starting", 5, "Electrical system was detected as a likely direction.");
  }

  if (hasAnyText(raw_input, ["no crank", "starter clicks", "battery light", "alternator", "charging"])) {
    scoreSystem(scores, "electrical_starting", 6, "No-crank, clicking, or charging language supports electrical/starting logic.");
  }

  // Transmission / drivetrain direction
  if (includesAny(dominant_signals, ["transmission", "drivability"])) {
    scoreSystem(scores, "transmission_drivetrain", 6, "Transmission or drivability signals indicate power delivery involvement.");
  }

  if (hasSignal(extracted_signals, "vibration") && hasSignal(extracted_signals, "load_sensitive")) {
    scoreSystem(scores, "transmission_drivetrain", 5, "Load-sensitive vibration supports drivetrain or power delivery behavior.");
  }

  if (includesAny(dominant_signals, ["load-sensitive drivetrain"])) {
    scoreSystem(scores, "transmission_drivetrain", 6, "Load-sensitive drivetrain behavior should not be treated as generic vibration.");
  }

  // Network / advanced diagnostic direction
  if (includesAny(dominant_signals, ["can", "module communication"])) {
    scoreSystem(scores, "network_modules", 8, "CAN/module communication language requires network-level diagnostic reasoning.");
  }

  if (hasAnyText(raw_input, ["u-code", "u code", "can bus", "no communication", "60 ohms", "oscilloscope"])) {
    scoreSystem(scores, "network_modules", 8, "Advanced network terms strongly indicate communication-system diagnosis.");
  }

  // SRS / steering safety
  if (includesAny(dominant_signals, ["srs", "airbag"])) {
    scoreSystem(scores, "safety_restraint", 9, "SRS or airbag warnings require safety-focused lock behavior.");
  }

  if (includesAny(dominant_signals, ["eps", "steering"])) {
    scoreSystem(scores, "steering_eps", 8, "EPS or steering calibration symptoms require steering-system priority.");
  }

  // Risk flag boosts
  if (includesAny(risk_flags, ["raw_fuel_dumping", "catalytic"])) {
    scoreSystem(scores, "fuel_combustion", 5, "Risk flags confirm raw fuel/catalyst damage concern.");
    scoreSystem(scores, "ignition_misfire", 3, "Raw fuel risk may come from ignition breakdown under load.");
  }

  if (includesAny(risk_flags, ["engine_damage"])) {
    scoreSystem(scores, "cooling_overheat", 6, "Engine damage risk increases cooling/overheat priority.");
  }

  if (includesAny(risk_flags, ["brake_safety"])) {
    scoreSystem(scores, "brake_safety", 6, "Brake safety risk overrides lower-priority drivability guesses.");
  }

  return scores;
}

function rankSystems(scores = {}) {
  return Object.entries(scores)
    .map(([system, data]) => ({
      system,
      score: data.score,
      reasons: [...new Set(data.reasons || [])],
    }))
    .sort((a, b) => b.score - a.score);
}

function determineLockLevel(topScore, severity = "low", riskFlags = []) {
  if (
    severity === "high" ||
    topScore >= 14 ||
    includesAny(riskFlags, [
      "engine_damage",
      "raw_fuel",
      "catalytic",
      "brake_safety",
    ])
  ) {
    return LOCK_LEVELS.CRITICAL;
  }

  if (topScore >= 9) return LOCK_LEVELS.STRONG;
  if (topScore >= 5) return LOCK_LEVELS.MODERATE;

  return LOCK_LEVELS.WEAK;
}

function buildLockedDirection(topSystem, rankedSystems = []) {
  const secondary = rankedSystems
    .slice(1, 3)
    .map((item) => item.system);

  const map = {
    fuel_combustion: {
      title: "Fuel / combustion failure direction",
      primary_focus:
        "Keep diagnosis centered on rich running, raw fuel, injector/fuel delivery, ignition breakdown under cylinder pressure, and combustion instability.",
      avoid_drift:
        "Do not drift into generic vacuum leak, wheel/suspension, or unrelated sensor guesses unless new evidence clearly supports it.",
    },

    ignition_misfire: {
      title: "Ignition / misfire direction",
      primary_focus:
        "Keep diagnosis centered on unstable spark, cylinder contribution, misfire under load, coil/plug behavior, and combustion breakdown.",
      avoid_drift:
        "Do not treat the case as generic maintenance or random fuel guess without load, spark, or cylinder behavior evidence.",
    },

    cooling_overheat: {
      title: "Cooling / overheating danger direction",
      primary_focus:
        "Keep diagnosis centered on overheating risk, coolant loss, airflow, thermostat, water pump, fan operation, head gasket indicators, and engine damage prevention.",
      avoid_drift:
        "Do not minimize overheating or shift to comfort symptoms while temperature risk is present.",
    },

    brake_safety: {
      title: "Brake safety direction",
      primary_focus:
        "Keep diagnosis centered on braking safety, rotor/pad/hydraulic issues, pedal feel, stopping distance, ABS warnings, and immediate driving risk.",
      avoid_drift:
        "Do not treat brake symptoms as normal vibration or tire balance before braking-system risk is separated.",
    },

    electrical_starting: {
      title: "Electrical / starting direction",
      primary_focus:
        "Keep diagnosis centered on battery, starter, alternator, voltage drop, grounds, relays, ignition switch logic, and crank/no-crank separation.",
      avoid_drift:
        "Do not jump to fuel or engine mechanical failure before crank behavior and voltage behavior are separated.",
    },

    transmission_drivetrain: {
      title: "Transmission / drivetrain behavior direction",
      primary_focus:
        "Keep diagnosis centered on load-sensitive vibration, slipping, shift behavior, torque converter behavior, driveline load, mounts, axles, and speed/RPM dependency.",
      avoid_drift:
        "Do not treat load-sensitive drivability as generic wheel balance unless speed-only behavior clearly supports it.",
    },

    network_modules: {
      title: "CAN / module communication direction",
      primary_focus:
        "Keep diagnosis centered on network integrity, module communication, U-codes, bus resistance, power/ground to modules, and oscilloscope-level signal behavior.",
      avoid_drift:
        "Do not reduce network symptoms into random sensor replacement without communication and power/ground validation.",
    },

    safety_restraint: {
      title: "SRS / restraint safety direction",
      primary_focus:
        "Keep diagnosis centered on airbag/SRS safety, module communication, crash sensor circuits, seat occupancy, clock spring, and restraint-system warnings.",
      avoid_drift:
        "Do not suggest cosmetic or comfort fixes while SRS safety status is unresolved.",
    },

    steering_eps: {
      title: "EPS / steering safety direction",
      primary_focus:
        "Keep diagnosis centered on steering angle, torque sensor calibration, rack replacement behavior, EPS module logic, alignment, and steering safety.",
      avoid_drift:
        "Do not treat steering symptoms as generic suspension noise until EPS calibration and safety behavior are separated.",
    },
  };

  const fallback = {
    title: "General diagnostic direction",
    primary_focus:
      "Keep diagnosis centered on the strongest detected symptom and ask one high-value question to separate systems.",
    avoid_drift:
      "Do not guess randomly; preserve symptom hierarchy until stronger evidence appears.",
  };

  return {
    ...(map[topSystem] || fallback),
    secondary_systems: secondary,
  };
}

function buildFollowUpStrategy(topSystem) {
  const strategy = {
    fuel_combustion: [
      "Separate idle-only from acceleration/load behavior.",
      "Confirm whether fuel smell increases after acceleration or while idling.",
      "Check whether smoke color is black, white, blue, or gray.",
    ],

    ignition_misfire: [
      "Separate idle misfire from load misfire.",
      "Ask whether the check engine light flashes under acceleration.",
      "Confirm if the vibration follows RPM or vehicle speed.",
    ],

    cooling_overheat: [
      "Ask whether temperature rises at idle, highway speed, or both.",
      "Confirm coolant loss, steam, sweet smell, or heater behavior.",
      "Separate fan, thermostat, coolant flow, and head-gasket indicators.",
    ],

    brake_safety: [
      "Ask whether vibration happens only while braking.",
      "Confirm pedal feel, grinding, pulling, ABS light, and stopping distance.",
      "Separate rotor/pad behavior from tire or suspension vibration.",
    ],

    electrical_starting: [
      "Separate no-crank from crank-no-start.",
      "Ask whether lights dim, starter clicks, or battery voltage drops.",
      "Confirm battery, ground, starter, alternator, and relay behavior.",
    ],

    transmission_drivetrain: [
      "Separate RPM flare from vehicle-speed vibration.",
      "Ask whether symptoms worsen uphill or under throttle.",
      "Confirm shift timing, slipping, shudder, mounts, axles, and torque converter behavior.",
    ],

    network_modules: [
      "Ask whether multiple modules are offline or only one system reports U-codes.",
      "Confirm battery voltage, grounds, bus resistance, and scan tool communication.",
      "Separate wiring/network failure from module-specific failure.",
    ],

    safety_restraint: [
      "Ask whether the SRS light is constant or intermittent.",
      "Confirm recent seat, steering wheel, battery, or crash-related work.",
      "Avoid repair certainty until codes and circuit data are known.",
    ],

    steering_eps: [
      "Ask whether steering effort changes, sticks near center, or warning lights appear.",
      "Confirm recent rack, alignment, battery, or calibration work.",
      "Separate mechanical bind from EPS torque-sensor calibration.",
    ],
  };

  return strategy[topSystem] || [
    "Ask one question that best separates system direction.",
    "Prioritize safety-critical symptoms first.",
    "Avoid repeating earlier questions.",
  ];
}

export function buildDominantLock(context = {}) {
  const {
    extracted_signals = {},
    dominant_systems = [],
    severity = "low",
    risk_flags = [],
    dominant_signals = [],
    raw_input = "",
  } = context;

  const scores = buildSystemScores({
    extracted_signals,
    dominant_systems,
    risk_flags,
    dominant_signals,
    raw_input,
  });

  const ranked = rankSystems(scores);

  const top = ranked[0] || {
    system: "general",
    score: 0,
    reasons: [],
  };

  const lockLevel = determineLockLevel(
    top.score,
    severity,
    risk_flags
  );

  const lockedDirection = buildLockedDirection(
    top.system,
    ranked
  );

  return {
    locked: top.system !== "general" && top.score > 0,

    lock_level: lockLevel,

    locked_system: top.system,

    locked_title: lockedDirection.title,

    primary_focus: lockedDirection.primary_focus,

    avoid_drift: lockedDirection.avoid_drift,

    secondary_systems: lockedDirection.secondary_systems,

    ranked_systems: ranked,

    follow_up_strategy: buildFollowUpStrategy(top.system),

    reasoning_guardrail:
      "Preserve this locked direction unless later answers provide stronger contradictory evidence. Do not let a later generic answer erase the original dominant symptom.",

    mechanic_instruction:
      "Use this lock as the diagnostic compass. Explain behavior like a master mechanic, but avoid claiming confirmed measurements unless the user provided them.",
  };
}
