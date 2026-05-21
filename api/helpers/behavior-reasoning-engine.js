// DriveShift Behavior Reasoning Engine v1.2



// Purpose:



// Understand how the failure behaves over time and refine diagnosis safely.



// Updated:



// - Better flashing CEL / misfire protection



// - Avoid drivetrain/transmission pivots when flashing CEL is present



// - Better repair-history exclusion logic



// - Follow-up guardrail only when still needed



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



function hasFlashingCel(rawInput = "", signals = {}) {



  const text = String(rawInput || "").toLowerCase();



  return Boolean(



    signals.flashing_cel ||



      signals.misfire ||



      (



        textIncludes(text, ["flashing", "flashes", "blinking", "blink"]) &&



        textIncludes(text, ["check engine", "cel", "engine light", "dashboard light"])



      )



  );



}



// --- REFINEMENT LOGIC ---



function detectRefinementBehavior(rawInput = "", context = {}) {



  const refinements = [];



  if (



    textIncludes(rawInput, [



      "replaced",



      "changed",



      "new part",



      "brand new",



      "already did",



      "fixed that",



      "swapped",



      "installed",



    ])



  ) {



    addBehavior(refinements, {



      key: "repair_history_update",



      label: "Repair History Refinement",



      meaning: "The user has already attempted repairs on specific components.",



      diagnostic_value:



        "Crucial: recently replaced parts should drop in probability unless there is evidence of wrong part, poor installation, damaged connector, defective new part, or cylinder-specific data pointing back to that part.",



      follow_up_priority:



        "Do not recommend the replaced part as the primary fix. Pivot toward the next logical subsystem.",



    });



  }



  if (



    textIncludes(rawInput, [



      "ohm",



      "volt",



      "multimeter",



      "oscilloscope",



      "psi",



      "bar",



      "trim",



      "duty cycle",



      "ms",



      "resistance",



      "ltft",



      "stft",



      "fuel pressure",



      "backpressure",



      "misfire counter",



      "misfire counts",



    ])



  ) {



    addBehavior(refinements, {



      key: "technical_data_refinement",



      label: "Technical Measurement Data",



      meaning: "The user is providing actual measurements instead of only symptoms.",



      diagnostic_value:



        "High: prioritize the provided measurements over generic symptom guessing.",



      follow_up_priority:



        "Interpret the provided value against expected operating behavior.",



    });



  }



  if (



    textIncludes(rawInput, [



      "don't think so",



      "not sure if",



      "could it be",



      "what about",



      "are you sure",



    ])



  ) {



    addBehavior(refinements, {



      key: "hypothesis_pivot",



      label: "Diagnostic Pivot Request",



      meaning: "The user is challenging the current theory or suggesting another direction.",



      diagnostic_value:



        "Medium: re-evaluate the dominant lock and explain whether the alternative fits the symptom pattern.",



      follow_up_priority:



        "Explain the link between the symptoms and the user's proposed theory.",



    });



  }



  return refinements;



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



      meaning: "The symptom changes after heat builds up.",



      diagnostic_value:



        "High value because heat-related failures separate electrical breakdown, fuel pressure fade, and mechanical expansion faults from static faults.",



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



      meaning: "The failure is strongest before the engine reaches operating temperature.",



      diagnostic_value:



        "Useful for fuel enrichment, vacuum leak, purge valve, and cold combustion separation.",



      follow_up_priority:



        "Ask if the symptom disappears once the engine warms up.",



    });



  }



  return behaviors;



}



function detectLoadBehavior(rawInput = "", signals = {}) {



  const behaviors = [];



  const flashingCel = hasFlashingCel(rawInput, signals);



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



      "floor the gas",



    ])



  ) {



    addBehavior(behaviors, {



      key: "load_sensitive_failure",



      label: "Load-sensitive failure",



      meaning: "The symptom becomes worse when the engine is asked to produce more torque.",



      diagnostic_value: flashingCel



        ? "Very high: with a flashing check engine light, this points first to combustion misfire under cylinder pressure. Prioritize injector flow, fuel delivery under load, compression leakage, exhaust restriction, air metering, or ignition breakdown only if not already excluded."



        : "Very high: exposes torque-demand failures such as fuel restriction, ignition weakness, exhaust restriction, engine load control faults, or driveline behavior if no misfire evidence exists.",



      follow_up_priority: flashingCel



        ? "Confirm misfire data with scan codes and live misfire counters under load."



        : "Ask whether the symptom disappears when releasing the throttle.",



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



      meaning: "The issue appears against road grade.",



      diagnostic_value: flashingCel



        ? "Strong combustion-load clue: uphill demand increases cylinder pressure and exposes misfire, fuel delivery, injector, compression, or exhaust restriction faults."



        : "Separates engine torque load from road-speed vibration.",



      follow_up_priority: flashingCel



        ? "Ask for stored/pending misfire codes and live misfire counters."



        : "Ask if RPM rises while vehicle speed struggles.",



    });



  }



  return behaviors;



}



function detectSpeedRpmBehavior(rawInput = "", signals = {}) {



  const behaviors = [];



  const flashingCel = hasFlashingCel(rawInput, signals);



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



      meaning: "Symptom appears at road speed.",



      diagnostic_value: flashingCel



        ? "Use caution: flashing CEL keeps the primary focus on combustion misfire, not tires or drivetrain, unless the light behavior is unrelated."



        : "Separates tires, bearings, driveline, and road-speed vibration from engine behavior.",



      follow_up_priority: flashingCel



        ? "Confirm whether the flashing light appears with engine load rather than road speed alone."



        : "Ask if symptom changes in Neutral at speed.",



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



      meaning: "Symptom follows engine speed.",



      diagnostic_value:



        "Useful for separating combustion, accessory, and engine-speed-related faults from road-speed vibration.",



      follow_up_priority:



        "Ask if symptom happens in Park/Neutral when revving only if no flashing CEL/load-misfire pattern is already clear.",



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



      meaning: "Symptom is tied to braking force.",



      diagnostic_value:



        "High safety value: separates rotor, pad, caliper, hydraulic, ABS, and tire/suspension behavior.",



      follow_up_priority:



        "Ask if steering shakes or pedal pulses.",



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



      meaning: "Issue is visible without road load.",



      diagnostic_value:



        "Useful for vacuum leaks, injector imbalance, throttle control, purge faults, compression issues, or engine mounts if no CEL/misfire evidence exists.",



      follow_up_priority:



        "Ask if idle smooths out when RPM is raised.",



    });



  }



  if (



    signals.startup_issue ||



    textIncludes(rawInput, [



      "won't start",



      "no start",



      "crank no start",



      "no crank",



      "starter clicks",



      "long crank",



      "hard start",



      "starts then dies",



    ])



  ) {



    addBehavior(behaviors, {



      key: "starting_sequence_pattern",



      label: "Starting-sequence pattern",



      meaning: "The starting behavior must be classified.",



      diagnostic_value:



        "Very high: each starting pattern points to a different system.",



      follow_up_priority:



        "Ask if engine cranks normally or only clicks.",



    });



  }



  return behaviors;



}



function detectIntermittentProgression(rawInput = "", signals = {}) {



  const behaviors = [];



  if (



    signals.intermittent ||



    textIncludes(rawInput, ["sometimes", "randomly", "intermittent", "comes and goes"])



  ) {



    addBehavior(behaviors, {



      key: "intermittent_failure_pattern",



      label: "Intermittent failure pattern",



      meaning: "Failure is not constant.",



      diagnostic_value:



        "Fault may involve heat, vibration, wiring, sensor dropout, fuel pressure fade, or load-specific failure.",



      follow_up_priority:



        "Ask what reliably triggers the symptom.",



    });



  }



  if (textIncludes(rawInput, ["getting worse", "worse now", "progressively worse"])) {



    addBehavior(behaviors, {



      key: "progressive_failure_pattern",



      label: "Progressive failure pattern",



      meaning: "Fault is worsening over time.",



      diagnostic_value:



        "Identifies wear, restriction, heat degradation, or a worsening mechanical/electrical fault.",



      follow_up_priority:



        "Ask what changed first.",



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



      meaning: "Smoke color and timing provide high diagnostic value.",



      diagnostic_value:



        "Black suggests rich fuel, blue suggests oil burning, white may suggest coolant or condensation depending on behavior.",



      follow_up_priority:



        "Ask for smoke color and timing.",



    });



  }



  if (signals.fuel_smell || textIncludes(rawInput, ["fuel smell", "gas smell", "raw fuel"])) {



    addBehavior(behaviors, {



      key: "fuel_odor_pattern",



      label: "Fuel-odor pattern",



      meaning: "Suggests fuel leak, rich combustion, injector issue, or evaporative/fuel system concern.",



      diagnostic_value:



        "Important for both diagnostic direction and fire-risk awareness.",



      follow_up_priority:



        "Ask where the smell is strongest.",



    });



  }



  return behaviors;



}



function buildBehaviorSummary(behaviors = []) {



  const keys = behaviors.map((b) => b.key);



  if (keys.includes("repair_history_update")) {



    return "The user provided repair history. Reduce probability on already-replaced parts and pivot to deeper diagnostics without recommending those parts again as the primary fix.";



  }



  if (keys.includes("technical_data_refinement")) {



    return "Technical data detected. Prioritize measured values over generic symptom guessing.";



  }



  if (keys.includes("load_sensitive_failure") && keys.includes("grade_load_dependency")) {



    return "The symptom is strongly load-sensitive and grade-dependent, pointing toward torque-demand combustion, fuel delivery, air metering, compression, or exhaust restriction analysis.";



  }



  if (keys.includes("thermal_failure_pattern") && keys.includes("load_sensitive_failure")) {



    return "The symptom is both heat-related and load-sensitive, suggesting a stress-related failure pattern.";



  }



  if (keys.includes("braking_only_pattern")) {



    return "The symptom is tied to braking force; prioritize brake safety separation.";



  }



  if (keys.includes("starting_sequence_pattern")) {



    return "The starting behavior must be classified to separate electrical, fuel, ignition, security, and mechanical no-start paths.";



  }



  if (behaviors.length > 0) {



    return "Recognizable behavior patterns detected; proceed with behavior-based reasoning.";



  }



  return "No strong pattern detected yet; identify the condition where the symptom appears.";



}



function buildNextBestQuestionGoal(behaviors = [], dominantLock = {}) {



  const keys = behaviors.map((b) => b.key);



  const lockedSystem = dominantLock?.locked_system || "general";



  if (keys.includes("repair_history_update")) {



    return "Respect the repair history and pivot away from already-replaced parts unless evidence points to installation, wiring, connector, or defective-new-part failure.";



  }



  if (keys.includes("technical_data_refinement")) {



    return "Interpret the provided measurement against expected operating behavior.";



  }



  if (keys.includes("load_sensitive_failure") && keys.includes("grade_load_dependency")) {



    return "Confirm misfire codes, live misfire counters, fuel trim/load behavior, injector contribution, compression/leakdown, and exhaust backpressure before suggesting more parts.";



  }



  if (keys.includes("thermal_failure_pattern")) {



    return "Confirm if the issue improves after cooling.";



  }



  if (keys.includes("load_sensitive_failure")) {



    return "Confirm whether the symptom disappears when throttle is released.";



  }



  if (keys.includes("starting_sequence_pattern")) {



    return "Separate no-crank from crank-no-start.";



  }



  if (lockedSystem === "transmission_drivetrain") {



    return "Separate combustion misfire under load from non-combustion vibration only if there is no flashing check engine light.";



  }



  return "Ask a single high-value question to narrow the system direction only if more information is truly needed.";



}



function buildReasoningGuardrails(behaviors = [], dominantLock = {}) {



  const guardrails = [



    "Do not treat the user's symptom as a generic complaint. Preserve the strongest behavior pattern.",



    "If a part was replaced, do not suggest it as the primary cause unless there is evidence of incorrect installation, damaged connector, defective new part, or cylinder-specific data pointing back to it.",



  ];



  if (dominantLock?.locked) {



    guardrails.push(`Respect the locked direction: ${dominantLock.locked_title}.`);



  }



  const keys = behaviors.map((b) => b.key);



  if (keys.includes("load_sensitive_failure")) {



    guardrails.push(



      "Load-sensitive symptoms should prioritize torque-demand failure behavior before generic vibration explanations."



    );



  }



  if (keys.includes("repair_history_update")) {



    guardrails.push(



      "Repair history is a probability shift, not proof. Lower the replaced part probability but do not claim it is impossible."



    );



  }



  for (const behavior of behaviors) {



    guardrails.push(`${behavior.label}: ${behavior.diagnostic_value}`);



  }



  guardrails.push(



    "Do not claim confirmed measurements unless provided.",



    "Ask only one follow-up question only when the system is still in follow-up mode. If the case already has enough facts, move to final analysis.",



    "For flashing check engine light with shaking under load, do not pivot to mounts, axles, tires, suspension, steering, or drivetrain as the primary explanation."



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



    ...detectSpeedRpmBehavior(rawInput, signals),



    ...detectBrakeBehavior(rawInput, signals),



    ...detectIdleStartupBehavior(rawInput, signals),



    ...detectIntermittentProgression(rawInput, signals),



    ...detectSmokeSmellBehavior(rawInput, signals),



    ...detectRefinementBehavior(rawInput, context),



  ];



  const behaviorSummary = buildBehaviorSummary(behaviors);



  const nextBestQuestionGoal = buildNextBestQuestionGoal(behaviors, dominantLock);



  return {



    detected_behaviors: behaviors,



    behavior_summary: behaviorSummary,



    next_best_question_goal: nextBestQuestionGoal,



    reasoning_guardrails: buildReasoningGuardrails(behaviors, dominantLock),



    mechanic_instruction:



      "Use behavior evolution carefully: prioritize repair history and technical measurements, but do not restart diagnosis or suggest already-replaced parts as the primary fix. For flashing CEL with load-related shaking, stay inside combustion/fuel/air/compression/exhaust logic.",



  };



}
