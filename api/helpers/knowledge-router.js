import networkCan from "../data/network_can.json" assert { type: "json" };

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
  ];

  if (expertWords.some((w) => text.includes(w))) {
    return "advanced_technician";
  }

  return "driver";
}

export function detectSystem(issue) {
  const text = String(issue || "").toLowerCase();

  if (
    text.includes("can bus") ||
    text.includes("u-code") ||
    text.includes("u code") ||
    text.includes("module") ||
    text.includes("no communication") ||
    text.includes("60 ohms") ||
    text.includes("oscilloscope")
  ) {
    return "network_can";
  }

  if (text.includes("airbag") || text.includes("srs")) {
    return "airbags_srs";
  }

  if (text.includes("brake") || text.includes("pedal") || text.includes("rotor")) {
    return "brakes";
  }

  if (text.includes("transmission") || text.includes("shift") || text.includes("atf")) {
    return "transmission";
  }

  if (text.includes("suspension") || text.includes("clunk") || text.includes("steering rack") || text.includes("eps")) {
    return "suspension";
  }

  if (text.includes("fuel trim") || text.includes("injector") || text.includes("fuel pressure")) {
    return "fuel";
  }

  return "general";
}

export function findKnowledgeMatches(issue) {
  const system = detectSystem(issue);
  const text = String(issue || "").toLowerCase();

  let data = [];

  if (system === "network_can") {
    data = networkCan;
  }

  const matches = data.filter((item) => {
    return item.symptom_patterns?.some((p) => text.includes(String(p).toLowerCase()));
  });

  return {
    system,
    userLevel: detectUserLevel(issue),
    matches,
  };
}
