const SIGNAL_PATTERNS = {
  smoke: [
    "smoke",
    "black smoke",
    "white smoke",
    "blue smoke",
    "gray smoke",
    "grey smoke",
    "heavy smoke",
  ],

  fuel_smell: [
    "fuel smell",
    "gas smell",
    "gasoline smell",
    "raw fuel",
    "rich fuel",
    "strong fuel odor",
  ],

  overheating: [
    "overheating",
    "running hot",
    "temperature high",
    "coolant boiling",
    "engine hot",
    "high temp",
  ],

  vibration: [
    "vibration",
    "shaking",
    "shake",
    "vibrates",
    "vibrating",
    "rough",
  ],

  rough_idle: [
    "rough idle",
    "idle rough",
    "unstable idle",
    "misfire at idle",
    "engine shakes at idle",
  ],

  acceleration_issue: [
    "hesitation",
    "loss of power",
    "poor acceleration",
    "slow acceleration",
    "bogging",
    "stumbles",
  ],

  braking_issue: [
    "brake vibration",
    "vibration while braking",
    "brake shake",
    "steering wheel shakes when braking",
  ],

  startup_issue: [
    "hard start",
    "won't start",
    "crank no start",
    "long crank",
    "slow start",
    "starts then dies",
  ],

  heat_related: [
    "after warming up",
    "after 20 minutes",
    "when hot",
    "after driving",
    "only when warm",
    "heat related",
  ],

  load_sensitive: [
    "uphill",
    "under load",
    "during acceleration",
    "highway speed",
    "higher rpm",
    "gets worse accelerating",
  ],

  intermittent: [
    "sometimes",
    "intermittent",
    "randomly",
    "occasionally",
    "comes and goes",
  ],
};

function detectSignals(text = "") {
  const input = String(text).toLowerCase();

  const detected = {};

  for (const [signal, patterns] of Object.entries(SIGNAL_PATTERNS)) {
    detected[signal] = patterns.some((pattern) =>
      input.includes(pattern.toLowerCase())
    );
  }

  return detected;
}

function determineDominantSystems(signals) {
  const systems = [];

  if (
    signals.smoke ||
    signals.fuel_smell ||
    signals.acceleration_issue
  ) {
    systems.push("fuel");
  }

  if (
    signals.rough_idle ||
    signals.startup_issue
  ) {
    systems.push("ignition");
  }

  if (
    signals.overheating ||
    signals.heat_related
  ) {
    systems.push("cooling");
  }

  if (
    signals.braking_issue
  ) {
    systems.push("brakes");
  }

  if (
    signals.vibration &&
    signals.load_sensitive
  ) {
    systems.push("drivetrain");
  }

  return [...new Set(systems)];
}

function determineSeverity(signals) {
  if (
    signals.overheating ||
    signals.smoke ||
    signals.braking_issue
  ) {
    return "high";
  }

  if (
    signals.vibration ||
    signals.acceleration_issue
  ) {
    return "medium";
  }

  return "low";
}

function buildRiskFlags(signals) {
  const risks = [];

  if (signals.overheating) {
    risks.push("engine_damage_risk");
  }

  if (signals.smoke && signals.fuel_smell) {
    risks.push("raw_fuel_dumping");
    risks.push("catalytic_converter_damage");
  }

  if (signals.braking_issue) {
    risks.push("brake_safety_risk");
  }

  return risks;
}

export function extractSignals(userInput = "") {
  const signals = detectSignals(userInput);

  return {
    signals,

    dominant_systems: determineDominantSystems(signals),

    severity: determineSeverity(signals),

    risk_flags: buildRiskFlags(signals),
  };
}
