// DriveShift Dominant Symptom Lock Engine v2
// Purpose:
// Keep the diagnostic direction stable so DriveShift does not drift away
// from the strongest symptom after follow-up answers.

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
    scores[system] = { score: 0, reasons: [] };
  }

  scores[system].score += points;

  if (reason) {
    scores[system].reasons.push(reason);
  }
}

function hasCoolingDenial(raw = "") {
  return hasAnyText(raw, [
    "no overheating",
    "temperature normal",
    "temperature stays normal",
    "temp stays normal",
    "no coolant loss",
    "no steam",
    "no sweet smell",
  ]);
}

function hasConfirmedCooling(raw = "") {
  return hasAnyText(raw, [
    "overheating",
    "overheats",
    "temperature high",
    "temp gauge rises",
    "temperature gauge rises",
    "steam",
    "coolant loss",
    "losing coolant",
    "sweet smell",
    "coolant smell",
  ]);
}

function buildSystemScores({
  extracted_signals = {},
  dominant_systems = [],
  risk_flags = [],
  dominant_signals = [],
  raw_input = "",
}) {
  const scores = {};
  const raw = String(raw_input || "").toLowerCase();

  const coolingDenied = hasCoolingDenial(raw);
  const coolingConfirmed = hasConfirmedCooling(raw);

  const blackSmoke = hasAnyText(raw, ["black smoke", "dark smoke", "humo negro"]);
  const fuelSmell = hasAnyText(raw, [
    "fuel smell",
    "gas smell",
    "raw fuel",
    "gasoline smell",
    "smells like gas",
    "strong fuel",
    "unburned fuel",
  ]);

  const flashingCel = hasAnyText(raw, [
    "flashing check engine",
    "check engine light flashes",
    "cel flashes",
    "flashing cel",
  ]);

  const loadMisfire = hasAnyText(raw, [
    "under load",
    "heavy throttle",
    "uphill",
    "accelerating",
    "shaking under acceleration",
    "rough under load",
    "loses power",
    "loss of power",
    "hesitating",
  ]);

  if (blackSmoke && fuelSmell) {
    scoreSystem(
      scores,
      "fuel_combustion",
      18,
      "Black smoke with raw fuel odor strongly locks the case to rich combustion, overfueling, injector leakage, fuel control error, or ignition burn failure."
    );
    scoreSystem(
      scores,
      "ignition_misfire",
      6,
      "Raw fuel smell can also come from a cylinder that is being fueled but not burned cleanly."
    );
  }

  if (flashingCel && (fuelSmell || loadMisfire)) {
    scoreSystem(
      scores,
      "ignition_misfire",
      14,
      "Flashing check-engine behavior with fuel/load symptoms strongly supports active misfire or combustion breakdown."
    );
    scoreSystem(
      scores,
      "fuel_combustion",
      8,
      "Misfire with fuel odor can send raw fuel into the exhaust and damage the catalyst."
    );
  }

  if (hasSignal(extracted_signals, "smoke")) {
    scoreSystem(scores, "fuel_combustion", 5, "Smoke indicates abnormal combustion or exhaust output.");
  }

  if (hasSignal(extracted_signals, "fuel_smell")) {
    scoreSystem(scores, "fuel_combustion", 6, "Fuel odor suggests raw fuel, rich running, or incomplete combustion.");
  }

  if (includesAny(dominant_signals, ["black smoke", "rich running", "raw fuel", "overfueling"])) {
    scoreSystem(scores, "fuel_combustion", 8, "Dominant signal language supports rich/raw-fuel combustion.");
  }

  if (includesAny(dominant_signals, ["raw fuel combustion failure", "rich combustion"])) {
    scoreSystem(scores, "fuel_combustion", 10, "Smoke plus fuel odor locks toward raw-fuel combustion failure.");
  }

  if (hasSignal(extracted_signals, "rough_idle")) {
    scoreSystem(scores, "ignition_misfire", 4, "Rough idle supports misfire or unstable combustion.");
  }

  if (includesAny(dominant_signals, ["misfire", "shaking", "combustion breakdown"])) {
    scoreSystem(scores, "ignition_misfire", 7, "Misfire or shaking points toward unstable cylinder contribution.");
  }

  if (loadMisfire) {
    scoreSystem(scores, "ignition_misfire", 6, "Load-sensitive failure often exposes weak spark or combustion instability under cylinder pressure.");
  }

  if (hasSignal(extracted_signals, "overheating") && !coolingDenied) {
    scoreSystem(scores, "cooling_overheat", 10, "Overheating is a high-priority engine damage risk.");
  }

  if (coolingConfirmed && !coolingDenied) {
    scoreSystem(scores, "cooling_overheat", 10, "Confirmed coolant, steam, or temperature rise supports cooling-system priority.");
  }

  if (coolingDenied && scores.cooling_overheat) {
    scores.cooling_overheat.score -= 10;
    scores.cooling_overheat.reasons.push(
      "Cooling path reduced because the user denied overheating, coolant loss, steam, or sweet coolant smell."
    );
  }

  if (hasSignal(extracted_signals, "braking_issue")) {
    scoreSystem(scores, "brake_safety", 12, "Brake symptoms require safety-first handling.");
  }

  if (includesAny(dominant_signals, ["brake safety", "brake"])) {
    scoreSystem(scores, "brake_safety", 10, "Brake safety risk must remain above comfort or drivability guesses.");
  }

  if (hasAnyText(raw, ["no brakes", "pedal goes to floor", "brake fluid leak", "red brake light"])) {
    scoreSystem(scores, "brake_safety", 18, "Critical brake language requires immediate brake-system lock.");
  }

  if (includesAny(dominant_systems, ["electrical"])) {
    scoreSystem(scores, "electrical_starting", 5, "Electrical system was detected as a likely direction.");
  }

  if (hasAnyText(raw, ["no crank", "starter clicks", "only clicks", "battery light", "alternator", "charging"])) {
    scoreSystem(scores, "electrical_starting", 8, "No-crank, clicking, or charging language supports electrical/starting logic.");
  }

  if (hasAnyText(raw, ["cranks but won't start", "cranks but does not start", "crank no start", "turns over but won't start"])) {
    scoreSystem(scores, "electrical_starting", 6, "Crank-no-start must be separated from no-crank before fuel or ignition conclusions.");
    scoreSystem(scores, "ignition_misfire", 4, "Crank-no-start can involve spark, fuel, compression, injector pulse, or RPM signal.");
  }

  if (includesAny(dominant_signals, ["transmission", "drivability"])) {
    scoreSystem(scores, "transmission_drivetrain", 6, "Transmission or drivability signals indicate power delivery involvement.");
  }

  if (hasSignal(extracted_signals, "vibration") && hasSignal(extracted_signals, "load_sensitive")) {
    scoreSystem(scores, "transmission_drivetrain", 7, "Load-sensitive vibration supports drivetrain or torque delivery behavior.");
  }

  if (hasAnyText(raw, ["transmission", "slipping", "hard shift", "flare", "flared", "atf", "torque converter"])) {
    scoreSystem(scores, "transmission_drivetrain", 9, "Transmission language supports pressure, clutch apply, torque converter, or driveline behavior.");
  }

  if (includesAny(dominant_signals, ["can", "module communication"]) ||
      hasAnyText(raw, ["u-code", "u code", "can bus", "no communication", "60 ohms", "oscilloscope"])) {
    scoreSystem(scores, "network_modules", 12, "Network/module language requires communication-system reasoning.");
  }

  if (includesAny(dominant_signals, ["srs", "airbag"]) || hasAnyText(raw, ["airbag", "srs"])) {
    scoreSystem(scores, "safety_restraint", 12, "SRS or airbag warnings require safety-focused lock behavior.");
  }

  if (includesAny(dominant_signals, ["eps", "steering"]) ||
      hasAnyText(raw, ["eps", "steering rack", "torque sensor", "zero-point reset", "steering angle"])) {
    scoreSystem(scores, "steering_eps", 10, "EPS or steering calibration symptoms require steering-system priority.");
  }

  if (includesAny(risk_flags, ["raw_fuel_dumping", "raw_fuel", "catalytic"])) {
    scoreSystem(scores, "fuel_combustion", 7, "Risk flags confirm raw fuel or catalyst-damage concern.");
    scoreSystem(scores, "ignition_misfire", 4, "Raw fuel risk may come from ignition breakdown under load.");
  }

  if (includesAny(risk_flags, ["engine_damage"]) && !coolingDenied) {
    scoreSystem(scores, "cooling_overheat", 6, "Engine damage risk increases cooling/overheat priority.");
  }

  if (includesAny(risk_flags, ["brake_safety"])) {
    scoreSystem(scores, "brake_safety", 8, "Brake safety risk overrides lower-priority drivability guesses.");
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
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

function determineLockLevel(topScore, severity = "low", riskFlags = []) {
  if (
    severity === "high" ||
    topScore >= 16 ||
    includesAny(riskFlags, ["engine_damage", "raw_fuel", "catalytic", "brake_safety"])
  ) {
    return LOCK_LEVELS.CRITICAL;
  }

  if (topScore >= 10) return LOCK_LEVELS.STRONG;
  if (topScore >= 5) return LOCK_LEVELS.MODERATE;

  return LOCK_LEVELS.WEAK;
}

function buildLockedDirection(topSystem, rankedSystems = []) {
  const secondary = rankedSystems.slice(1, 3).map((item) => item.system);

  const map = {
    fuel_combustion: {
      title: "Fuel / combustion failure direction",
      primary_focus:
        "Keep diagnosis centered on rich running, raw fuel, injector leakage, fuel pressure regulation, fuel control error, sensor feedback skew, ignition burn failure, and combustion instability.",
      avoid_drift:
        "Do not drift into vacuum leak, cooling system, wheel/suspension, or random sensor guesses unless new evidence clearly overpowers the fuel/smoke pattern.",
    },

    ignition_misfire: {
      title: "Ignition / misfire direction",
      primary_focus:
        "Keep diagnosis centered on unstable spark, cylinder contribution, misfire under load, plug gap, coil/boot behavior, fuel-fouled plugs, and combustion breakdown under cylinder pressure.",
      avoid_drift:
        "Do not treat the case as generic maintenance or simple fuel delivery until load, spark, cylinder, and raw-fuel behavior are separated.",
    },

    cooling_overheat: {
      title: "Cooling / overheating danger direction",
      primary_focus:
        "Keep diagnosis centered on overheating risk, coolant loss, airflow, thermostat, water pump, fan operation, radiator flow, pressure cap, head-gasket indicators, and engine damage prevention.",
      avoid_drift:
        "Do not minimize overheating or shift to comfort symptoms while temperature, coolant, or steam risk is present.",
    },

    brake_safety: {
      title: "Brake safety direction",
      primary_focus:
        "Keep diagnosis centered on braking safety, hydraulic integrity, pedal feel, stopping distance, rotor runout, pad transfer, caliper drag, ABS behavior, and immediate driving risk.",
      avoid_drift:
        "Do not treat brake symptoms as normal vibration or tire balance before braking-system risk is separated.",
    },

    electrical_starting: {
      title: "Electrical / starting direction",
      primary_focus:
        "Keep diagnosis centered on crank/no-crank separation, battery voltage, starter draw, voltage drop, grounds, relays, ignition switch logic, charging behavior, and security authorization.",
      avoid_drift:
        "Do not jump to fuel, sensors, or engine mechanical failure before crank behavior and voltage behavior are separated.",
    },

    transmission_drivetrain: {
      title: "Transmission / drivetrain behavior direction",
      primary_focus:
        "Keep diagnosis centered on load-sensitive vibration, slipping, shift timing, line pressure, torque converter behavior, driveline load, mounts, axles, speed dependency, and RPM dependency.",
      avoid_drift:
        "Do not treat load-sensitive drivability as generic wheel balance unless speed-only behavior clearly supports it.",
    },

    network_modules: {
      title: "CAN / module communication direction",
      primary_focus:
        "Keep diagnosis centered on network integrity, U-codes, bus resistance, module wake-up, power/ground to modules, wiring, termination, and oscilloscope-level signal behavior.",
      avoid_drift:
        "Do not reduce network symptoms into random sensor or module replacement without communication and power/ground validation.",
    },

    safety_restraint: {
      title: "SRS / restraint safety direction",
      primary_focus:
        "Keep diagnosis centered on airbag/SRS safety, module communication, crash sensor circuits, seat occupancy, pretensioners, clock spring, low-voltage history, and restraint-system warnings.",
      avoid_drift:
        "Do not suggest cosmetic or comfort fixes while SRS safety status is unresolved.",
    },

    steering_eps: {
      title: "EPS / steering safety direction",
      primary_focus:
        "Keep diagnosis centered on steering angle, torque sensor calibration, rack replacement behavior, EPS module logic, alignment, tire pull, voltage integrity, and steering safety.",
      avoid_drift:
        "Do not treat steering symptoms as generic suspension noise until EPS calibration, angle, torque zero, voltage, and alignment are separated.",
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
      "Confirm smoke color and whether fuel smell increases after acceleration or while idling.",
      "Separate overfueling, injector leakage, fuel pressure regulation, ignition burn failure, and sensor feedback skew.",
    ],

    ignition_misfire: [
      "Separate idle misfire from load misfire.",
      "Ask whether the check engine light flashes under acceleration.",
      "Confirm whether vibration follows RPM, load, or vehicle speed.",
    ],

    cooling_overheat: [
      "Ask whether temperature rises at idle, highway speed, with A/C, or after coolant loss.",
      "Confirm coolant loss, steam, sweet smell, heater output, fan operation, and pressure behavior.",
      "Separate fan/airflow, thermostat/flow, radiator restriction, water pump, pressure cap, and head-gasket indicators.",
    ],

    brake_safety: [
      "Ask whether symptoms happen only while braking.",
      "Confirm pedal feel, grinding, pulling, ABS light, and stopping distance.",
      "Separate rotor/pad behavior from hydraulic, ABS, tire, or suspension vibration.",
    ],

    electrical_starting: [
      "Separate no-crank from crank-no-start.",
      "Ask whether lights dim, starter clicks, security light appears, or battery voltage drops.",
      "Confirm battery, ground, starter, alternator, relay, crank signal, and immobilizer behavior.",
    ],

    transmission_drivetrain: [
      "Separate RPM flare from vehicle-speed vibration.",
      "Ask whether symptoms worsen uphill, under throttle, cold, hot, or after ATF temperature rises.",
      "Confirm shift timing, slipping, shudder, mounts, axles, torque converter, and line-pressure behavior.",
    ],

    network_modules: [
      "Ask whether multiple modules are offline or only one system reports U-codes.",
      "Confirm battery voltage, grounds, bus resistance, termination, module wake-up, and scan-tool communication.",
      "Separate wiring/network failure from module-specific failure.",
    ],

    safety_restraint: [
      "Ask whether the SRS light is constant or intermittent.",
      "Confirm exact SRS code and recent seat, steering wheel, battery, or crash-related work.",
      "Avoid repair certainty until codes and circuit data are known.",
    ],

    steering_eps: [
      "Ask whether steering effort changes, sticks near center, pulls, or shows warning lights.",
      "Confirm recent rack, alignment, battery, or calibration work.",
      "Separate mechanical bind from EPS torque-sensor calibration and steering angle learning.",
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

  const lockLevel = determineLockLevel(top.score, severity, risk_flags);
  const lockedDirection = buildLockedDirection(top.system, ranked);

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
      "Use this lock as the diagnostic compass. Explain behavior like a master mechanic. Do not claim confirmed failed parts unless the user provided measurements, scan data, inspection evidence, or repeatable behavior.",

    drift_protection:
      "If the original symptom includes black smoke, raw fuel smell, flashing check-engine light, severe brake behavior, overheating, SRS, steering lock, no-crank, or CAN/network symptoms, that signal must remain above generic follow-up answers.",
  };
}
