import { includesAny } from "./diagnostic-core.js";
import { detectSystem, detectUserLevel } from "./knowledge-router.js";

export function buildSmartFollowUp({ lang, issue, answers }) {
  const isEs = lang === "es";
  const text = buildText(issue, answers);
  const asked = buildAskedText(answers);

  const system = detectSystem(issue);
  const userLevel = detectUserLevel(issue);
  const advanced = userLevel === "advanced_technician";

  const used = (keys) => keys.some((k) => asked.includes(k));

  if (advanced) {
    const expert = buildAdvancedQuestion({ isEs, system, used });
    if (expert) return expert;
  }

  const systemQuestion = buildSystemQuestion({ isEs, text, system, used });
  if (systemQuestion) return systemQuestion;

  return buildGeneralQuestion({ isEs, text, used });
}

function buildAdvancedQuestion({ isEs, system, used }) {
  if (system === "network_can") {
    if (!used(["module isolation", "isolated", "disconnect", "bus load"])) {
      return block({
        isEs,
        summary: isEs
          ? "El patrón apunta a una falla de comunicación CAN que necesita aislamiento por módulo."
          : "The pattern points to a CAN communication fault that needs module isolation.",
        question: isEs
          ? "¿La forma de onda CAN mejora al aislar módulos uno por uno?"
          : "Does the CAN waveform improve when modules are isolated one by one?",
        options: isEs
          ? ["Mejora con un módulo aislado", "Sigue igual", "Solo falla en caliente", "No probado"]
          : ["Improves with one module isolated", "Stays the same", "Only fails when warm", "Not tested"],
      });
    }

    if (!used(["power", "ground", "termination", "splice"])) {
      return block({
        isEs,
        summary: isEs
          ? "El siguiente paso es separar módulo corrupto de power, ground o terminación."
          : "The next step is separating a corrupt module from power, ground, or termination issues.",
        question: isEs
          ? "¿Power, ground y terminación fueron verificados en el módulo sospechoso?"
          : "Were power, ground, and termination checked at the suspected module?",
        options: isEs
          ? ["Power/ground OK", "Terminación incorrecta", "Caída de voltaje", "No probado"]
          : ["Power/ground OK", "Termination incorrect", "Voltage drop found", "Not tested"],
      });
    }
  }

  if (system === "fuel") {
    if (!used(["injector balance", "o2", "switching", "bank 1", "bank 2"])) {
      return block({
        isEs,
        summary: isEs
          ? "Un lean en un banco necesita comparar O2 e injector balance entre bancos."
          : "A one-bank lean condition needs O2 and injector balance comparison between banks.",
        question: isEs
          ? "¿Bank 1 muestra O2 switching o injector balance diferente a Bank 2?"
          : "Does Bank 1 show different O2 switching or injector balance than Bank 2?",
        options: isEs
          ? ["O2 diferente", "Injector balance diferente", "Ambos normales", "No probado"]
          : ["O2 differs", "Injector balance differs", "Both normal", "Not tested"],
      });
    }

    if (!used(["load", "idle", "rpm", "warm"])) {
      return block({
        isEs,
        summary: isEs
          ? "Ahora necesito saber cuándo aparece el lean."
          : "Now I need to know when the lean condition appears.",
        question: isEs
          ? "¿El fuel trim sube solo bajo carga o también en idle?"
          : "Does the fuel trim rise only under load, or also at idle?",
        options: isEs
          ? ["Solo bajo carga", "También en idle", "Solo caliente", "No sé"]
          : ["Only under load", "Also at idle", "Only when warm", "Not sure"],
      });
    }
  }

  if (system === "transmission") {
    if (!used(["line pressure", "slip", "clutch", "pressure test"])) {
      return block({
        isEs,
        summary: isEs
          ? "El flare dependiente de temperatura apunta a presión hidráulica o sellado interno."
          : "A temperature-dependent flare points toward hydraulic pressure or internal sealing.",
        question: isEs
          ? "¿La presión de línea o el clutch slip cambia cuando el ATF pasa de 190°F?"
          : "Does line pressure or clutch slip change once ATF temperature passes 190°F?",
        options: isEs
          ? ["Cae la presión", "Sube el slip", "Datos normales", "No medido"]
          : ["Line pressure drops", "Slip increases", "Data stays normal", "Not measured"],
      });
    }
  }

  if (system === "suspension") {
    if (!used(["calibration", "zero point", "torque sensor", "scan tool"])) {
      return block({
        isEs,
        summary: isEs
          ? "Después de cambiar steering rack, EPS calibration puede ser clave."
          : "After steering rack replacement, EPS calibration may be the key issue.",
        question: isEs
          ? "¿Se hizo torque sensor zero-point reset o steering calibration con scanner?"
          : "Was a torque sensor zero-point reset or steering calibration performed with a scan tool?",
        options: isEs
          ? ["Sí, calibrado", "No se hizo", "Falló la calibración", "No sé"]
          : ["Yes, calibrated", "Not performed", "Calibration failed", "Not sure"],
      });
    }
  }

  if (system === "engine_noise") {
    if (!used(["load", "rpm", "oil pressure", "frequency"])) {
      return block({
        isEs,
        summary: isEs
          ? "El tapping con RPM necesita separar valvetrain de wrist pin."
          : "RPM-related tapping needs to separate valvetrain noise from wrist pin or lower-end noise.",
        question: isEs
          ? "¿El tapping cambia con carga del motor o solo sigue las RPM?"
          : "Does the tapping change with engine load, or does it only follow RPM?",
        options: isEs
          ? ["Solo sigue RPM", "Cambia bajo carga", "Desaparece bajo carga", "No sé"]
          : ["Only follows RPM", "Changes under load", "Disappears under load", "Not sure"],
      });
    }
  }

  return null;
}

function buildSystemQuestion({ isEs, text, system, used }) {
  if (system === "engine_drivability") {
    if (!used(["uphill", "under load", "heavy throttle", "idle"])) {
      return block({
        isEs,
        summary: isEs
          ? "La pérdida de potencia o sacudida bajo carga apunta a misfire o combustión inestable."
          : "Power loss or shaking under load points toward misfire or unstable combustion.",
        question: isEs
          ? "¿La falla aparece más al acelerar fuerte/subir loma o también en idle?"
          : "Does it happen mostly under hard acceleration/uphill, or also at idle?",
        options: isEs
          ? ["Acelerando/subida", "También en idle", "Después de calentarse", "No sé"]
          : ["Acceleration/uphill", "Also at idle", "After it warms up", "Not sure"],
      });
    }

    if (!used(["warm", "cold", "temperature", "hot"])) {
      return block({
        isEs,
        summary: isEs
          ? "Ahora separo falla térmica de falla constante."
          : "Now I’m separating a heat-related fault from a constant fault.",
        question: isEs
          ? "¿El problema aparece solo después de calentarse o también con motor frío?"
          : "Does the problem appear only after warming up, or also when cold?",
        options: isEs
          ? ["Solo caliente", "También frío", "Va y viene", "No sé"]
          : ["Only when warm", "Also when cold", "Comes and goes", "Not sure"],
      });
    }

    if (!used(["coil", "plug", "injector", "fuel trim", "scanner", "code"])) {
      return block({
        isEs,
        summary: isEs
          ? "El último dato separa ignition, injector o mezcla bajo carga."
          : "The final detail separates ignition breakdown, injector delivery, or mixture under load.",
        question: isEs
          ? "¿Tienes código de misfire, fuel trims o datos del scanner durante la falla?"
          : "Do you have a misfire code, fuel trims, or scan data captured during the fault?",
        options: isEs
          ? ["Código misfire", "Fuel trims altos", "Sin datos", "No sé"]
          : ["Misfire code", "High fuel trims", "No scan data", "Not sure"],
      });
    }
  }

  if (system === "fuel") {
    if (!used(["bank", "trim", "fuel pressure", "smoke test"])) {
      return block({
        isEs,
        summary: isEs
          ? "Fuel trim alto necesita separar aire falso, fuel delivery o sensor skew."
          : "High fuel trim needs to separate unmetered air, fuel delivery, or sensor skew.",
        question: isEs
          ? "¿El fuel trim alto está en un banco o en ambos bancos?"
          : "Is the high fuel trim on one bank only or both banks?",
        options: isEs
          ? ["Solo Bank 1", "Solo Bank 2", "Ambos bancos", "No sé"]
          : ["Bank 1 only", "Bank 2 only", "Both banks", "Not sure"],
      });
    }

    if (!used(["o2", "injector balance", "switching", "restricted injector"])) {
      return block({
        isEs,
        summary: isEs
          ? "Como fuel pressure y smoke test están bien, falta comparar O2 e inyectores."
          : "Since fuel pressure and smoke test look good, O2 and injector behavior need comparison.",
        question: isEs
          ? "¿El O2 upstream o injector balance del banco afectado se ve diferente?"
          : "Does the upstream O2 or injector balance on the affected bank look different?",
        options: isEs
          ? ["O2 diferente", "Injector diferente", "Ambos normales", "No probado"]
          : ["O2 differs", "Injector differs", "Both normal", "Not tested"],
      });
    }
  }

  if (system === "airbags_srs" && !used(["srs code", "airbag code", "code"])) {
    return block({
      isEs,
      summary: isEs
        ? "La luz airbag necesita código SRS para evitar adivinar."
        : "An airbag light needs the SRS code to avoid guessing.",
      question: isEs
        ? "¿Tienes código SRS o solo aparece la luz?"
        : "Do you have the SRS/airbag code, or only the warning light?",
      options: isEs
        ? ["Tengo código", "Solo luz", "Después de reparación", "No sé"]
        : ["I have a code", "Only the light", "After a repair", "Not sure"],
    });
  }

  if (system === "network_can" && !used(["battery voltage", "voltage", "charging"])) {
    return block({
      isEs,
      summary: isEs
        ? "Muchas fallas CAN empiezan con voltaje bajo o mala tierra."
        : "Many CAN faults start with low voltage or a bad ground.",
      question: isEs
        ? "¿Voltaje de batería y carga fueron probados primero?"
        : "Were battery voltage and charging output checked first?",
      options: isEs
        ? ["Voltaje bajo", "Carga normal", "No probado", "Intermitente"]
        : ["Voltage is low", "Charging is normal", "Not checked", "Intermittent"],
    });
  }

  if (system === "transmission" && !used(["hot", "cold", "temperature", "atf"])) {
    return block({
      isEs,
      summary: isEs
        ? "La transmisión necesita separar falla fría, caliente o por presión."
        : "Transmission symptoms need to separate cold, hot, and pressure-control behavior.",
      question: isEs
        ? "¿El problema aparece en frío, caliente o después de manejar?"
        : "Does the shift issue happen cold, hot, or only after driving awhile?",
      options: isEs
        ? ["En frío", "En caliente", "Después de manejar", "Siempre"]
        : ["When cold", "When hot", "After driving awhile", "All the time"],
    });
  }

  if (system === "brakes" && !used(["speed", "highway", "pedal", "steering"])) {
    return block({
      isEs,
      summary: isEs
        ? "La vibración de frenos depende de la velocidad y de dónde se siente."
        : "Brake vibration depends on speed and where it is felt.",
      question: isEs
        ? "¿La vibración aparece más al frenar en highway?"
        : "Does the vibration happen mostly when braking at highway speed?",
      options: isEs
        ? ["Sí, alta velocidad", "Baja velocidad", "Siempre", "No sé"]
        : ["Yes, highway speed", "Low speed", "Every time", "Not sure"],
    });
  }

  return null;
}

function buildGeneralQuestion({ isEs, text, used }) {
  const noSmoke = hasNegation(text, ["smoke", "visible smoke"]);
  const noFuel = hasNegation(text, ["fuel smell", "gas smell", "raw fuel"]);

  const hasHighway = includesAny(text, [
    "highway",
    "freeway",
    "interstate",
    "at speed",
    "high speed",
    "60 mph",
    "65 mph",
    "70 mph",
  ]);

  const hasSlowsDown = includesAny(text, [
    "slows down",
    "slow down",
    "when i slow",
    "goes away when i slow",
    "stops when i slow",
    "stops shaking when i slow",
  ]);

  const hasVibration = includesAny(text, [
    "vibration",
    "vibrate",
    "vibrates",
    "shake",
    "shakes",
    "shaking",
    "wobble",
    "wobbles",
  ]);

  const hasBrakeWords = includesAny(text, [
    "brake",
    "braking",
    "when braking",
    "brake pedal",
    "pedal",
  ]);

  const hasSteeringWords = includesAny(text, [
    "steering",
    "steering wheel",
    "wheel shakes",
    "front end",
  ]);

  if (
    hasVibration &&
    (hasHighway || hasSlowsDown) &&
    !used(["steering wheel", "seat", "floor", "pedal", "where do you feel"])
  ) {
    return block({
      isEs,
      summary: isEs
        ? "La vibración a velocidad alta cambia mucho según dónde se siente."
        : "High-speed vibration changes diagnosis depending on where you feel it.",
      question: isEs
        ? "¿Dónde sientes más la vibración: volante, asiento/piso, o pedal de freno?"
        : "Where do you feel the vibration most: steering wheel, seat/floor, or brake pedal?",
      options: isEs
        ? ["Volante", "Asiento/piso", "Pedal de freno", "Todo el carro"]
        : ["Steering wheel", "Seat/floor", "Brake pedal", "Whole car"],
    });
  }

  if (
    hasVibration &&
    !hasBrakeWords &&
    !used(["braking", "accelerating", "coasting", "steady speed"])
  ) {
    return block({
      isEs,
      summary: isEs
        ? "La vibración necesita separarse entre rueda/llanta, eje, motor o frenos."
        : "Vibration needs to be separated between wheel/tire, axle, engine, or brake-related causes.",
      question: isEs
        ? "¿La vibración aparece al mantener velocidad, al acelerar, al frenar o al soltar el acelerador?"
        : "Does the vibration happen while holding speed, accelerating, braking, or coasting?",
      options: isEs
        ? ["Manteniendo velocidad", "Acelerando", "Frenando", "Soltando acelerador"]
        : ["Holding speed", "Accelerating", "Braking", "Coasting"],
    });
  }

  if (
    hasSteeringWords &&
    !used(["left", "right", "pull", "alignment", "tire balance"])
  ) {
    return block({
      isEs,
      summary: isEs
        ? "Si se siente en el volante, primero se separa tire balance de suspensión o alineación."
        : "If it is felt in the steering wheel, the first split is tire balance versus suspension or alignment.",
      question: isEs
        ? "¿El volante también se jala a un lado o solo vibra?"
        : "Does the steering wheel also pull to one side, or only vibrate?",
      options: isEs
        ? ["Solo vibra", "Jala a un lado", "Empeora con velocidad", "No sé"]
        : ["Only vibrates", "Pulls to one side", "Worse with speed", "Not sure"],
    });
  }

  const hasPowerLoss = includesAny(text, [
    "loss of power",
    "loses power",
    "weak acceleration",
    "won't accelerate",
    "rough when accelerating",
    "hesitating",
    "hesitates",
  ]);

  const hasFlashingCel = includesAny(text, [
    "flashing check engine",
    "check engine light flashes",
    "cel flashes",
    "flashes briefly",
  ]);

  const hasUnderLoad = includesAny(text, [
    "uphill",
    "under load",
    "heavy throttle",
    "accelerating uphill",
    "hard acceleration",
  ]);

  const hasShake = includesAny(text, [
    "rough idle",
    "misfire",
    "rough under load",
    "engine feels rough",
  ]);

  const hasDriveabilityPattern =
    hasPowerLoss || hasFlashingCel || hasUnderLoad || hasShake;

  const hasFuel =
    !noFuel &&
    includesAny(text, ["fuel smell", "gas smell", "raw fuel", "smells like gas"]);

  const hasSmoke =
    !noSmoke &&
    includesAny(text, ["black smoke", "dark smoke", "visible smoke", "smoke"]);

  const hasNoStart = !hasDriveabilityPattern && isTrueNoStart(text);
  const hasOverheat = includesAny(text, ["overheat", "overheating", "coolant", "steam"]);
  const hasBrake = includesAny(text, ["brake", "pedal", "brake fluid", "grinding"]);

  if (hasDriveabilityPattern && !used(["uphill", "under load", "idle", "heavy throttle"])) {
    return block({
      isEs,
      summary: isEs
        ? "Los síntomas apuntan a misfire o combustión inestable bajo carga."
        : "The symptoms point toward misfire or combustion breakdown under load.",
      question: isEs
        ? "¿La falla aparece más al acelerar fuerte/subir loma o también en idle?"
        : "Does it happen mostly under hard acceleration/uphill, or also at idle?",
      options: isEs
        ? ["Acelerando/subida", "También en idle", "Después de calentarse", "No sé"]
        : ["Acceleration/uphill", "Also at idle", "After it warms up", "Not sure"],
    });
  }

  if ((hasSmoke || hasFuel) && !used(["accelerate", "aceleras"])) {
    return block({
      isEs,
      summary: isEs
        ? "El patrón apunta a mezcla rica o combustible sin quemar."
        : "The pattern points toward rich mixture or unburned fuel.",
      question: isEs
        ? "¿El humo u olor a gasolina empeora cuando aceleras?"
        : "Does the smoke or fuel smell get worse when you accelerate?",
      options: isEs
        ? ["Sí, al acelerar", "También en idle", "Solo al encender", "No sé"]
        : ["Yes, under acceleration", "Also at idle", "Only at startup", "Not sure"],
    });
  }

  if (hasNoStart && !used(["crank", "gira", "start"])) {
    return block({
      isEs,
      summary: isEs
        ? "Primero separo batería, starter o alimentación."
        : "First I need to separate battery, starter, or power supply.",
      question: isEs
        ? "Cuando intentas encender, ¿el motor gira o solo hace click?"
        : "When you try to start it, what exactly happens?",
      options: isEs
        ? ["Gira normal", "Solo click", "No hace nada", "No sé"]
        : ["It cranks normally", "Only one click", "No sound at all", "Not sure"],
    });
  }

  if (hasOverheat && !used(["coolant", "refrigerante", "steam", "vapor"])) {
    return block({
      isEs,
      summary: isEs
        ? "El sobrecalentamiento necesita confirmar pérdida de coolant o vapor."
        : "Overheating needs confirmation of coolant loss or steam.",
      question: isEs
        ? "¿Has notado pérdida de coolant, vapor o temperatura subiendo rápido?"
        : "Have you noticed coolant loss, steam, or the temperature rising fast?",
      options: isEs
        ? ["Pierde coolant", "Sale vapor", "Sube rápido", "No sé"]
        : ["Coolant loss", "Steam", "Temp rises fast", "Not sure"],
    });
  }

  if (hasBrake && !used(["pedal"])) {
    return block({
      isEs,
      summary: isEs
        ? "Los frenos necesitan separar desgaste de falla hidráulica."
        : "Brake symptoms need to separate wear from a hydraulic issue.",
      question: isEs
        ? "¿Cómo se siente el pedal de freno?"
        : "How does the brake pedal feel?",
      options: isEs
        ? ["Muy suave", "Duro", "Vibra/raspa", "No sé"]
        : ["Very soft", "Hard", "Grinding/vibration", "Not sure"],
    });
  }

  return block({
    isEs,
    summary: isEs
      ? "Necesito un detalle específico para separar el sistema afectado."
      : "I need one specific detail to separate the affected system.",
    question: isEs
      ? "¿Cuándo aparece más el problema: acelerando, frenando, en idle o a velocidad constante?"
      : "When does the problem happen most: accelerating, braking, at idle, or holding steady speed?",
    options: isEs
      ? ["Acelerando", "Frenando", "En idle", "Velocidad constante"]
      : ["Accelerating", "Braking", "At idle", "Steady speed"],
  });
}

function block({ isEs, summary, question, options }) {
  return `Diagnosis status: follow_up

Voice summary:
${summary}

Risk level:
Medium

Likely issue:
${isEs ? "Pendiente de confirmación diagnóstica." : "Pending diagnostic confirmation."}

Why it fits:
${summary}

What to inspect next:
${question}

What to do next:
${question}

Answer options:
${options.join("\n")}

When to stop driving:
${
  isEs
    ? "Deja de manejar si el vehículo se siente inseguro, se sobrecalienta, huele a quemado, pierde mucha potencia, vibra fuerte, o aparece una luz roja."
    : "Stop driving if the vehicle feels unsafe, overheats, smells like burning, loses strong power, shakes badly, or shows a red warning light."
}`;
}

function buildText(issue, answers) {
  return [
    String(issue || ""),
    ...(Array.isArray(answers)
      ? answers.map((a) => `${a?.question || ""} ${a?.answer || ""}`)
      : []),
  ]
    .join(" ")
    .toLowerCase();
}

function buildAskedText(answers) {
  return Array.isArray(answers)
    ? answers.map((a) => String(a?.question || "").toLowerCase()).join(" ")
    : "";
}

function hasNegation(text, terms) {
  const clean = String(text || "").toLowerCase();

  return terms.some((term) => {
    return (
      clean.includes(`no ${term}`) ||
      clean.includes(`no visible ${term}`) ||
      clean.includes(`without ${term}`) ||
      clean.includes(`not seeing ${term}`) ||
      clean.includes(`doesn't have ${term}`) ||
      clean.includes(`does not have ${term}`)
    );
  });
}

function isTrueNoStart(text) {
  const clean = String(text || "").toLowerCase();

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

  return trueNoStartPhrases.some((phrase) => clean.includes(phrase));
}
