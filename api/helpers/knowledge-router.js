export function detectUserLevel(issue) {
  const text = String(issue || "").toLowerCase();

  const expertWords = [
    "oscilloscope",
    "signal clipping",
    "60 ohms",
    "u-code",
    "u codes",
    "can bus",
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
    "hydraulic lifter",
    "wrist pin",
    "oil pressure readings",
    "injector balance",
    "smoke test",
    "upstream o2",
    "downstream o2",
  ];

  return expertWords.some((w) => text.includes(w))
    ? "advanced_technician"
    : "driver";
}

export function detectSystem(issue) {
  const text = String(issue || "").toLowerCase();

  if (
    includesAny(text, [
      "fuel trim",
      "fuel trims",
      "bank 1",
      "bank 2",
      "injector",
      "fuel pressure",
      "smoke test",
      "o2 sensor",
      "upstream o2",
      "downstream o2",
      "lean condition",
      "rich condition",
    ])
  ) {
    return "fuel";
  }

  if (
    includesAny(text, [
      "flashing check engine",
      "check engine light flashes",
      "cel flashes",
      "misfire",
      "rough under load",
      "engine feels rough",
      "hesitating",
      "loses power",
      "loss of power",
      "uphill",
      "heavy throttle",
      "under load",
      "rough when accelerating",
    ])
  ) {
    return "engine_drivability";
  }

  if (
    includesAny(text, [
      "can bus",
      "u-code",
      "u code",
      "module",
      "no communication",
      "60 ohms",
      "oscilloscope",
      "signal clipping",
    ])
  ) {
    return "network_can";
  }

  if (includesAny(text, ["airbag", "srs"])) {
    return "airbags_srs";
  }

  if (includesAny(text, ["brake", "pedal", "rotor"])) {
    return "brakes";
  }

  if (includesAny(text, ["transmission", "shift", "atf", "flared"])) {
    return "transmission";
  }

  if (
    includesAny(text, [
      "suspension",
      "clunk",
      "clicking in the rear",
      "rear clicking",
      "steering rack",
      "eps",
      "torque sensor",
      "zero-point",
    ])
  ) {
    return "suspension";
  }

  if (
    includesAny(text, [
      "hydraulic lifter",
      "wrist pin",
      "tapping",
      "knocking",
      "metallic tapping",
      "upper cylinder head",
    ])
  ) {
    return "engine_noise";
  }

  if (isTrueNoStart(text)) {
    return "starting";
  }

  return "general";
}

export function findKnowledgeMatches(issue) {
  return {
    system: detectSystem(issue),
    userLevel: detectUserLevel(issue),
    matches: [],
  };
}

function includesAny(text, words) {
  return words.some((w) => String(text || "").toLowerCase().includes(w));
}

function isTrueNoStart(text) {
  const trueNoStartPhrases = [
    "won't start",
    "will not start",
    "does not start",
    "doesn't start",
    "no start",
    "hard start",
    "cranks but won't start",
    "cranks but does not start",
    "no crank",
    "starter clicks",
    "only clicks",
  ];

  return trueNoStartPhrases.some((phrase) => text.includes(phrase));
}
