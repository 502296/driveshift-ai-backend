// DriveShift Behavior Reasoning Engine v1
// Purpose:
// Understand how the failure behaves over time, load, temperature, speed, RPM, braking, idle, and startup.
// This layer helps DriveShift think like a mechanic instead of reacting to keywords only.

function textIncludes(raw = "", words = []) {
  const text = String(raw || "").toLowerCase();
  return words.some((word) => text.includes(String(word).toLowerCase()));
}

function addBehavior(list, item) {
  if (!item?.key) return;
  if (!list.some((x) => x.key === item.key)) {
    list.push(item);
  }
}

function detectTimeAndTemperatureBehavior(rawInput = "", signals = {}) {
  const behaviors = [];

  if (
    signals.heat_related ||
    textIncludes(rawInput, [
      "when hot",
      "after warming up",
      "after warm up",
      "after driving",
      "after 10 minutes",
      "after 15 minutes",
      "after 20 minutes",
      "after 30 minutes",
      "only when warm",
      "heat soaked",
      "hot restart",
      "starts again after cooling",
      "works when cold",
    ])
  ) {
    addBehavior(behaviors, {
      key: "thermal_failure_pattern",
      label: "Thermal failure pattern",
      meaning:
        "The symptom changes after heat builds up, which often points to components failing when resistance, pressure, or temperature rises.",
      diagnostic_value:
        "High value because heat-related failures separate electrical breakdown, ignition failure, fuel pressure loss, cooling faults, and transmission behavior from simple static faults.",
      follow_up_priority:
        "Ask whether the symptom improves after the vehicle cools down.",
    });
  }

  if (
    textIncludes(rawInput, [
      "cold start",
      "only cold",
      "first start",
      "morning start",
      "starts rough cold",
      "cold idle",
    ])
  ) {
    addBehavior(behaviors, {
      key: "cold_start_pattern",
      label: "Cold-start pattern",
      meaning:
        "The failure is strongest before the engine reaches operating temperature.",
      diagnostic_value:
        "Useful for separating fuel enrichment, vacuum leaks, coolant temperature sensor logic, weak ignition, and idle control issues.",
      follow_up_priority:
        "Ask if the symptom disappears once the engine warms up.",
    });
  }

  return behaviors;
}

function detectLoadBehavior(rawInput = "", signals = {}) {
  const behaviors = [];

  if (
    signals.load_sensitive ||
    textIncludes(rawInput, [
      "under load",
      "uphill",
      "going uphill",
      "when accelerating",
      "during acceleration",
      "hard acceleration",
      "wide open throttle",
      "passing",
      "merging",
      "higher rpm",
      "heavy throttle",
      "towing",
      "with ac on",
    ])
  ) {
    addBehavior(behaviors, {
      key: "load_sensitive_failure",
      label: "Load-sensitive failure",
      meaning:
        "The symptom becomes worse when the engine or drivetrain is asked to produce more torque.",
      diagnostic_value:
        "Very high value because load exposes weak ignition, restricted fuel delivery, boost leaks, transmission slip, torque converter shudder, mounts, and driveline stress.",
      follow_up_priority:
        "Ask whether the symptom disappears when the driver releases the throttle.",
    });
  }

  if (
    textIncludes(rawInput, [
      "loses power uphill",
      "bogs uphill",
      "no power uphill",
      "shakes uphill",
      "worse uphill",
    ])
  ) {
    addBehavior(behaviors, {
      key: "grade_load_dependency",
      label: "Uphill / grade-load dependency",
      meaning:
        "The issue appears when the vehicle needs extra torque against road grade.",
      diagnostic_value:
        "Strongly separates powertrain load failure from simple road-speed vibration.",
      follow_up_priority:
        "Ask if RPM rises normally while vehicle speed struggles to increase.",
    });
  }

  return behaviors;
}

function detectSpeedRpmBehavior(rawInput = "") {
  const behaviors = [];

  if (
    textIncludes(rawInput, [
      "highway speed",
      "at 40 mph",
      "at 50 mph",
      "at 60 mph",
      "at 70 mph",
      "only at speed",
      "specific speed",
      "above 40",
      "above 50",
      "above 60",
    ])
  ) {
    addBehavior(behaviors, {
      key: "vehicle_speed_dependency",
      label: "Vehicle-speed dependency",
      meaning:
        "The symptom follows road speed more than engine load alone.",
      diagnostic_value:
        "Useful for separating wheel/tire balance, wheel bearings, driveline vibration, axles, brake rotor runout, and transmission/driveshaft behavior.",
      follow_up_priority:
        "Ask whether the symptom changes if the transmission is shifted to neutral at the same speed.",
    });
  }

  if (
    textIncludes(rawInput, [
      "rpm",
      "higher rpm",
      "low rpm",
      "around 2000 rpm",
      "around 3000 rpm",
      "revving",
      "rev",
      "engine speed",
    ])
  ) {
    addBehavior(behaviors, {
      key: "engine_rpm_dependency",
      label: "Engine-RPM dependency",
      meaning:
        "The symptom may follow engine speed rather than road speed.",
      diagnostic_value:
        "Useful for separating engine misfire, ignition breakdown, intake/exhaust restriction, accessory drive issues, and engine mount behavior.",
      follow_up_priority:
        "Ask whether the symptom happens in Park/Neutral when revving the engine.",
    });
  }

  return behaviors;
}

function detectBrakeBehavior(rawInput = "", signals = {}) {
  const behaviors = [];

  if (
    signals.braking_issue ||
    textIncludes(rawInput, [
      "when braking",
      "while braking",
      "brake vibration",
      "brake shake",
      "pedal pulsation",
      "steering wheel shakes when braking",
      "grinding brakes",
      "soft brake pedal",
      "low brake pedal",
    ])
  ) {
    addBehavior(behaviors, {
      key: "braking_only_pattern",
      label: "Braking-only pattern",
      meaning:
        "The symptom is tied to braking force rather than constant driving.",
      diagnostic_value:
        "High safety value because it separates brake rotor/pad/hydraulic issues from tires, suspension, wheel bearings, and drivetrain vibration.",
      follow_up_priority:
        "Ask whether the steering wheel shakes, the brake pedal pulses, or the whole vehicle shakes.",
    });
  }

  return behaviors;
}

function detectIdleStartupBehavior(rawInput = "", signals = {}) {
  const behaviors = [];

  if (
    signals.rough_idle ||
    textIncludes(rawInput, [
      "rough idle",
      "idle rough",
      "shakes at idle",
      "misfire at idle",
      "unstable idle",
      "idle drops",
      "almost stalls at idle",
    ])
  ) {
    addBehavior(behaviors, {
      key: "idle_quality_pattern",
      label: "Idle-quality pattern",
      meaning:
        "The issue is visible when the engine is not under road load.",
      diagnostic_value:
        "Useful for separating vacuum leaks, misfire, fuel trim problems, throttle body issues, engine mounts, and low-speed combustion instability.",
      follow_up_priority:
        "Ask whether the idle smooths out when RPM is raised slightly.",
    });
  }

  if (
    signals.startup_issue ||
    textIncludes(rawInput, [
      "won't start",
      "will not start",
      "does not start",
      "doesn't start",
      "no start",
      "crank no start",
      "no crank",
      "clicks",
      "starter clicks",
      "long crank",
      "hard start",
      "starts then dies",
    ])
  ) {
    addBehavior(behaviors, {
      key: "starting_sequence_pattern",
      label: "Starting-sequence pattern",
      meaning:
        "The failure must be separated into no-crank, crank-no-start, long-crank, or starts-then-dies behavior.",
      diagnostic_value:
        "Very high value because each starting pattern points to a different diagnostic path.",
      follow_up_priority:
        "Ask whether the engine cranks normally, clicks only, or cranks but never fires.",
    });
  }

  return behaviors;
}

function detectIntermittentProgression(rawInput = "", signals = {}) {
  const behaviors = [];

  if (
    signals.intermittent ||
    textIncludes(rawInput, [
      "sometimes",
      "randomly",
      "intermittent",
      "comes and goes",
      "occasionally",
      "not always",
      "every few days",
      "only sometimes",
    ])
  ) {
    addBehavior(behaviors, {
      key: "intermittent_failure_pattern",
      label: "Intermittent failure pattern",
      meaning:
        "The failure is not constant, so the diagnostic path must preserve conditions that trigger it.",
      diagnostic_value:
        "High value because intermittent faults often involve heat, vibration, wiring movement, module communication, weak relays, sensors, or marginal components.",
      follow_up_priority:
        "Ask what condition most reliably makes the symptom appear.",
    });
  }

  if (
    textIncludes(rawInput, [
      "getting worse",
      "worse now",
      "progressively worse",
      "used to be",
      "now it",
      "started small",
      "became worse",
      "more frequent",
    ])
  ) {
    addBehavior(behaviors, {
      key: "progressive_failure_pattern",
      label: "Progressive failure pattern",
      meaning:
        "The fault appears to be worsening over time rather than staying random.",
      diagnostic_value:
        "Useful for identifying wear, thermal degradation, restricted flow, worsening misfire, brake deterioration, or drivetrain stress.",
      follow_up_priority:
        "Ask what changed first and what symptom became worse most recently.",
    });
  }

  return behaviors;
}

function detectSmokeSmellBehavior(rawInput = "", signals = {}) {
  const behaviors = [];

  if (signals.smoke || textIncludes(rawInput, ["smoke"])) {
    addBehavior(behaviors, {
      key: "exhaust_smoke_pattern",
      label: "Exhaust smoke pattern",
      meaning:
        "Smoke color and timing carry major diagnostic value.",
      diagnostic_value:
        "Black smoke suggests rich combustion, blue smoke suggests oil burning, white smoke can suggest coolant/steam or condensation depending on persistence.",
      follow_up_priority:
        "Ask what color the smoke is and whether it appears at idle, acceleration, startup, or deceleration.",
    });
  }

  if (
    signals.fuel_smell ||
    textIncludes(rawInput, [
      "fuel smell",
      "gas smell",
      "gasoline smell",
      "raw fuel",
      "strong fuel odor",
    ])
  ) {
    addBehavior(behaviors, {
      key: "fuel_odor_pattern",
      label: "Fuel-odor pattern",
      meaning:
        "Fuel odor suggests unburned fuel, rich running, fuel leakage, evaporative fault, or misfire leaving raw fuel in the exhaust.",
      diagnostic_value:
        "High value because fuel odor combined with smoke or misfire raises fire/catalyst damage risk.",
      follow_up_priority:
        "Ask whether the smell is strongest near the engine bay, exhaust, or fuel tank area.",
    });
  }

  return behaviors;
}

function buildBehaviorSummary(behaviors = []) {
  const keys = behaviors.map((b) => b.key);

  if (keys.includes("thermal_failure_pattern") && keys.includes("load_sensitive_failure")) {
    return "The symptom is both heat-related and load-sensitive, which is a strong mechanical/electrical stress pattern rather than a random complaint.";
  }

  if (keys.includes("braking_only_pattern")) {
    return "The symptom is tied to braking force, so brake safety must be separated before treating it as normal vibration.";
  }

  if (keys.includes("starting_sequence_pattern")) {
    return "The starting behavior must be classified first because no-crank, crank-no-start, and starts-then-dies point to different systems.";
  }

  if (keys.includes("exhaust_smoke_pattern") && keys.includes("fuel_odor_pattern")) {
    return "Smoke combined with fuel odor should keep the diagnostic direction centered on raw fuel, rich combustion, misfire, or fuel delivery behavior.";
  }

  if (keys.includes("vehicle_speed_dependency") && keys.includes("engine_rpm_dependency")) {
    return "The case needs separation between road-speed behavior and engine-RPM behavior before a final conclusion.";
  }

  if (behaviors.length > 0) {
    return "The symptom has recognizable behavior patterns that should guide the next diagnostic question and final reasoning.";
  }

  return "No strong behavior pattern was detected yet; the next question should identify when, where, and under what condition the symptom appears.";
}

function buildNextBestQuestionGoal(behaviors = [], dominantLock = {}) {
  const keys = behaviors.map((b) => b.key);
  const lockedSystem = dominantLock?.locked_system || "general";

  if (keys.includes("thermal_failure_pattern")) {
    return "Confirm whether the issue improves after cooling down.";
  }

  if (keys.includes("load_sensitive_failure")) {
    return "Confirm whether the symptom disappears when throttle/load is removed.";
  }

  if (keys.includes("braking_only_pattern")) {
    return "Confirm whether vibration is in the steering wheel, brake pedal, or whole vehicle while braking.";
  }

  if (keys.includes("starting_sequence_pattern")) {
    return "Separate no-crank from crank-no-start and starts-then-dies.";
  }

  if (keys.includes("exhaust_smoke_pattern")) {
    return "Confirm smoke color and when it appears.";
  }

  if (keys.includes("fuel_odor_pattern")) {
    return "Confirm where the fuel smell is strongest.";
  }

  if (lockedSystem === "transmission_drivetrain") {
    return "Separate RPM flare, road-speed vibration, and throttle-load behavior.";
  }

  if (lockedSystem === "cooling_overheat") {
    return "Confirm when temperature rises and whether coolant loss or fan behavior is present.";
  }

  if (lockedSystem === "fuel_combustion") {
    return "Separate rich-running, misfire, fuel leak, and load-related combustion behavior.";
  }

  return "Ask the single question that best separates system direction without repeating earlier questions.";
}

function buildReasoningGuardrails(behaviors = [], dominantLock = {}) {
  const guardrails = [];

  guardrails.push(
    "Do not treat the user's symptom as a generic complaint. Preserve the strongest behavior pattern."
  );

  if (dominantLock?.locked) {
    guardrails.push(
      `Respect the locked direction: ${dominantLock.locked_title}.`
    );
  }

  for (const behavior of behaviors) {
    guardrails.push(
      `${behavior.label}: ${behavior.diagnostic_value}`
    );
  }

  guardrails.push(
    "Do not claim confirmed measurements unless the user provided them."
  );

  guardrails.push(
    "Ask only one high-value follow-up question when more data is needed."
  );

  return guardrails;
}

export function buildBehaviorReasoning(context = {}) {
  const rawInput = context.raw_input || "";
  const signals = context.extracted_signals || {};
  const dominantLock = context.dominant_lock || {};

  const behaviors = [
    ...detectTimeAndTemperatureBehavior(rawInput, signals),
    ...detectLoadBehavior(rawInput, signals),
    ...detectSpeedRpmBehavior(rawInput),
    ...detectBrakeBehavior(rawInput, signals),
    ...detectIdleStartupBehavior(rawInput, signals),
    ...detectIntermittentProgression(rawInput, signals),
    ...detectSmokeSmellBehavior(rawInput, signals),
  ];

  const behaviorSummary = buildBehaviorSummary(behaviors);
  const nextBestQuestionGoal = buildNextBestQuestionGoal(
    behaviors,
    dominantLock
  );

  return {
    detected_behaviors: behaviors,

    behavior_summary: behaviorSummary,

    next_best_question_goal: nextBestQuestionGoal,

    reasoning_guardrails: buildReasoningGuardrails(
      behaviors,
      dominantLock
    ),

    mechanic_instruction:
      "Use behavior first: when it happens, what load it needs, whether heat changes it, whether it follows RPM or road speed, and whether it creates safety risk.",
  };
}
