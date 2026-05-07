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
    const expertQuestion = buildAdvancedQuestion({ isEs, text, system, used });
    if (expertQuestion) return expertQuestion;
  }

  const systemQuestion = buildSystemQuestion({ isEs, text, system, used });
  if (systemQuestion) return systemQuestion;

  return buildGeneralQuestion({ isEs, text, used });
}

function buildAdvancedQuestion({ isEs, system, used }) {
  if (system === "network_can" && !used(["module isolation", "isolated", "disconnect", "bus load"])) {
    return block({
      isEs,
      summary: isEs ? "Esto parece un problema avanzado de comunicación CAN." : "This looks like an advanced CAN communication fault.",
      question: isEs
        ? "¿La señal mejora si aíslas módulos uno por uno o sigue clipping con todos conectados?"
        : "Does the CAN waveform improve when modules are isolated one by one, or does clipping remain with all modules connected?",
      options: isEs
        ? ["Mejora al aislar un módulo", "Sigue igual", "Solo falla en caliente", "No lo probé"]
        : ["Improves when one module is isolated", "Clipping stays the same", "Only fails when warm", "Not tested yet"],
    });
  }

  if (system === "transmission" && !used(["line pressure", "pressure test", "slip data", "clutch volume"])) {
    return block({
      isEs,
      summary: isEs ? "El patrón por temperatura apunta a presión hidráulica o sellado interno." : "A temperature-dependent flare points toward hydraulic pressure control or internal sealing.",
      question: isEs
        ? "¿La presión de línea o el slip del clutch cambian cuando el ATF pasa de 190°F?"
        : "Does line pressure or clutch slip data change once ATF temperature passes 190°F?",
      options: isEs
        ? ["Cae la presión", "Sube el slip", "Datos normales", "No medido"]
        : ["Line pressure drops", "Clutch slip increases", "Data stays normal", "Not measured"],
    });
  }

  if (system === "fuel" && !used(["injector balance", "o2 switching", "bank 1", "bank 2"])) {
    return block({
      isEs,
      summary: isEs ? "El lean en un solo banco necesita comparar O2 e inyectores entre bancos." : "A one-bank lean condition needs O2 and injector comparison between banks.",
      question: isEs
        ? "¿Bank 1 tiene switching del O2 o balance de inyectores diferente a Bank 2?"
        : "Does Bank 1 show different upstream O2 switching or injector balance compared with Bank 2?",
      options: isEs
        ? ["O2 diferente", "Injector balance diferente", "Ambos normales", "No probado"]
        : ["O2 behavior differs", "Injector balance differs", "Both look normal", "Not tested"],
    });
  }

  if (system === "suspension" && !used(["calibration", "zero point", "torque sensor", "scan tool"])) {
    return block({
      isEs,
      summary: isEs ? "Después de cambiar steering rack, puede ser calibración EPS." : "After steering rack replacement, this may be EPS calibration.",
      question: isEs
        ? "¿Se hizo torque sensor zero-point reset o calibración EPS con scanner?"
        : "Was an EPS torque sensor zero-point reset or steering calibration performed with a scan tool?",
      options: isEs
        ? ["Sí, calibrado", "No se hizo", "Falló la calibración", "No sé"]
        : ["Yes, calibrated", "No, not performed", "Calibration failed", "Not sure"],
    });
  }

  if (system === "engine_noise" && !used(["load", "oil pressure", "rpm", "frequency"])) {
    return block({
      isEs,
      summary: isEs ? "El tapping con RPM necesita separar valvetrain de wrist pin." : "RPM-related tapping needs to separate valvetrain noise from wrist pin or lower-end noise.",
      question: isEs
        ? "¿El tapping cambia con carga del motor o solo con RPM sin carga?"
        : "Does the tapping change with engine load, or only with RPM when unloaded?",
      options: isEs
        ? ["Solo con RPM", "Cambia bajo carga", "Desaparece bajo carga", "No sé"]
        : ["Only follows RPM", "Changes under load", "Disappears under load", "Not sure"],
    });
  }

  if (system === "brakes" && !used(["rotor runout", "wheel bearing", "front rear", "highway"])) {
    return block({
      isEs,
      summary: isEs ? "La vibración al frenar en highway necesita separar rotor, hub o suspensión." : "Highway brake vibration needs to separate rotor runout, hub/bearing, or suspension movement.",
      question: isEs
        ? "¿La vibración se siente más en el volante, el pedal, o todo el vehículo?"
        : "Is the vibration felt more in the steering wheel, brake pedal, or the whole vehicle?",
      options: isEs
        ? ["Volante", "Pedal", "Todo el vehículo", "No sé"]
        : ["Steering wheel", "Brake pedal", "Whole vehicle", "Not sure"],
    });
  }

  if (system === "airbags_srs" && !used(["code", "clock spring", "seat", "connector"])) {
    return block({
      isEs,
      summary: isEs ? "Una luz SRS necesita código específico antes de culpar sensores o módulo." : "An SRS light needs the exact module code before blaming sensors or the module.",
      question: isEs
        ? "¿El código SRS apunta a clock spring, sensor de asiento, pretensioner o módulo?"
        : "Does the SRS code point to the clock spring, seat sensor, pretensioner, or control module?",
      options: isEs
        ? ["Clock spring", "Sensor de asiento", "Pretensioner", "No tengo código"]
        : ["Clock spring", "Seat sensor", "Pretensioner", "No code yet"],
    });
  }

  return null;
}

function buildSystemQuestion({ isEs, text, system, used }) {
  if (system === "engine_drivability") {
    if (!used(["uphill", "under load", "heavy throttle", "idle"])) {
      return block({
        isEs,
        summary: isEs
          ? "La pérdida de potencia con check engine flashing apunta a misfire bajo carga."
          : "Power loss with a flashing check engine light points toward a misfire under load.",
        question: isEs
          ? "¿La falla aparece más al acelerar fuerte, subir una loma, o también en idle?"
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
          ? "Ahora necesito saber si el fallo depende de temperatura."
          : "Now I need to know whether the fault is temperature-related.",
        question: isEs
          ? "¿El problema aparece solo después de calentarse o también con el motor frío?"
          : "Does the problem appear only after warming up, or also when the engine is cold?",
        options: isEs
          ? ["Solo caliente", "También frío", "Va y viene", "No sé"]
          : ["Only when warm", "Also when cold", "Comes and goes", "Not sure"],
      });
    }

    if (!used(["coil", "plug", "injector", "fuel trim", "scanner"])) {
      return block({
        isEs,
        summary: isEs
          ? "El siguiente paso separa ignition, inyector o mezcla bajo carga."
          : "The next step separates ignition breakdown, injector delivery, or mixture under load.",
        question: isEs
          ? "¿Tienes código de misfire, fuel trims, o datos del scanner durante la falla?"
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
        summary: isEs ? "Fuel trim alto necesita separar aire falso, fuel delivery o sensor skew." : "High fuel trim needs to separate unmetered air, fuel delivery, or sensor skew.",
        question: isEs ? "¿El fuel trim alto está en un banco o en ambos bancos?" : "Is the high fuel trim on one bank only or both banks?",
        options: isEs ? ["Solo Bank 1", "Solo Bank 2", "Ambos bancos", "No sé"] : ["Bank 1 only", "Bank 2 only", "Both banks", "Not sure"],
      });
    }

    if (!used(["o2", "injector balance", "switching", "restricted injector"])) {
      return block({
        isEs,
        summary: isEs ? "Como fuel pressure y smoke test no condenan la causa, compara O2 e inyector." : "Since fuel pressure and smoke test do not prove the cause, compare O2 and injector behavior.",
        question: isEs ? "¿El O2 upstream y el injector balance de ese banco se ven diferentes?" : "Do the upstream O2 signal and injector balance on that bank look different?",
        options: isEs ? ["O2 diferente", "Injector diferente", "Ambos normales", "No probado"] : ["O2 differs", "Injector differs", "Both normal", "Not tested"],
      });
    }

    if (!used(["load", "idle", "rpm", "snap throttle"])) {
      return block({
        isEs,
        summary: isEs ? "Necesito saber si el lean aparece solo bajo carga o también en idle." : "I need to know whether the lean condition appears only under load or also at idle.",
        question: isEs ? "¿El fuel trim sube bajo carga فقط أو también en idle?" : "Does the fuel trim rise only under load, or also at idle?",
        options: isEs ? ["Solo bajo carga", "También en idle", "Solo al calentar", "No sé"] : ["Only under load", "Also at idle", "Only when warm", "Not sure"],
      });
    }
  }

  if (system === "airbags_srs" && !used(["srs code", "airbag code", "code"])) {
    return block({
      isEs,
      summary: isEs ? "La luz de airbag necesita código SRS para evitar adivinar." : "An airbag light needs the SRS code to avoid guessing.",
      question: isEs ? "¿Tienes el código del sistema SRS o solo aparece la luz?" : "Do you have the SRS/airbag code, or is it only the warning light?",
      options: isEs ? ["Tengo código", "Solo luz", "Después de reparación", "No sé"] : ["I have a code", "Only the light", "After a repair", "Not sure"],
    });
  }

  if (system === "network_can" && !used(["battery voltage", "voltage", "charging"])) {
    return block({
      isEs,
      summary: isEs ? "Muchas fallas CAN empiezan con voltaje bajo o mala tierra." : "Many CAN faults start with low voltage or a bad ground.",
      question: isEs ? "¿El voltaje de batería y carga fue probado primero?" : "Was battery voltage and charging output checked first?",
      options: isEs ? ["Voltaje bajo", "Carga normal", "No probado", "Problema intermitente"] : ["Voltage is low", "Charging is normal", "Not checked", "Intermittent issue"],
    });
  }

  if (system === "transmission" && !used(["hot", "cold", "temperature", "atf"])) {
    return block({
      isEs,
      summary: isEs ? "La transmisión necesita separar falla fría, caliente o por presión." : "Transmission symptoms need to separate cold behavior, hot behavior, and pressure control.",
      question: isEs ? "¿El problema aparece en frío, en caliente, o solo después de manejar?" : "Does the shift problem happen cold, hot, or only after driving for a while?",
      options: isEs ? ["En frío", "En caliente", "Después de manejar", "Siempre"] : ["When cold", "When hot", "After driving awhile", "All the time"],
    });
  }

  if (system === "brakes" && !used(["speed", "highway", "pedal", "steering"])) {
    return block({
      isEs,
      summary: isEs ? "La vibración de frenos cambia mucho حسب velocidad y dónde se siente." : "Brake vibration changes meaning depending on speed and where it is felt.",
      question: isEs ? "¿La vibración aparece más al frenar en alta velocidad?" : "Does the vibration happen mostly when braking at highway speed?",
      options: isEs ? ["Sí, alta velocidad", "A baja velocidad", "Siempre", "No sé"] : ["Yes, highway speed", "Low speed", "Every time", "Not sure"],
    });
  }

  return null;
}

function buildGeneralQuestion({ isEs, text, used }) {
  const noSmoke = hasNegation(text, ["smoke", "visible smoke"]);
  const noFuel = hasNegation(text, ["fuel smell", "gas smell", "raw fuel"]);

  const hasPowerLoss = includesAny(text, ["loss of power", "loses power", "weak acceleration", "won't accelerate", "rough when accelerating", "hesitating", "hesitates"]);
  const hasFlashingCel = includesAny(text, ["flashing check engine", "check engine light flashes", "cel flashes", "flashes briefly"]);
  const hasUnderLoad = includesAny(text, ["uphill", "under load", "heavy throttle", "accelerating uphill", "hard acceleration"]);
  const hasShake = includesAny(text, ["shake", "shaking", "rough idle", "vibration", "misfire", "rough under load", "engine feels rough"]);
  const hasDriveabilityPattern = hasPowerLoss || hasFlashingCel || hasUnderLoad || hasShake;

  const hasFuel = !noFuel && includesAny(text, ["fuel smell", "gas smell", "raw fuel", "smells like gas"]);
  const hasSmoke = !noSmoke && includesAny(text, ["black smoke", "dark smoke", "visible smoke", "smoke"]);

  const hasNoStart = !hasDriveabilityPattern && isTrueNoStart(text);
  const hasOverheat = includesAny(text, ["overheat", "overheating", "coolant", "steam"]);
  const hasBrake = includesAny(text, ["brake", "pedal", "brake fluid", "grinding"]);

  if (hasDriveabilityPattern && !used(["flashing", "misfire", "under load", "uphill", "heavy throttle"])) {
    return block({
      isEs,
      summary: isEs ? "La pérdida de potencia con check engine flashing apunta más a misfire bajo carga." : "Power loss with a flashing check engine light points more toward a misfire under load.",
      question: isEs ? "¿La falla aparece más al acelerar fuerte, subir una loma, o también en idle?" : "Does it happen mostly under hard acceleration/uphill, or also at idle?",
      options: isEs ? ["Acelerando/subida", "También en idle", "Después de calentarse", "No sé"] : ["Acceleration/uphill", "Also at idle", "After it warms up", "Not sure"],
    });
  }

  if ((hasSmoke || hasFuel) && !used(["accelerate", "aceleras"])) {
    return block({
      isEs,
      summary: isEs ? "Ese patrón apunta más a mezcla rica o combustible sin quemar." : "That pattern points more toward rich fuel mixture or unburned fuel.",
      question: isEs ? "¿El humo u olor a gasolina empeora cuando aceleras?" : "Does the smoke or fuel smell get worse when you accelerate?",
      options: isEs ? ["Sí, al acelerar", "También en idle", "Solo al encender", "No sé"] : ["Yes, under acceleration", "Also at idle", "Only at startup", "Not sure"],
    });
  }

  if (hasNoStart && !used(["crank", "gira", "start"])) {
    return block({
      isEs,
      summary: isEs ? "Primero separo batería, starter o alimentación." : "First I need to separate battery, starter, or power supply.",
      question: isEs ? "Cuando intentas encender, ¿el motor gira o solo hace click?" : "When you try to start it, what exactly happens?",
      options: isEs ? ["Gira normal", "Solo hace click", "No hace nada", "No sé"] : ["It cranks normally", "Only one click", "No sound at all", "Not sure"],
    });
  }

  if (hasOverheat && !used(["coolant", "refrigerante", "steam", "vapor"])) {
    return block({
      isEs,
      summary: isEs ? "El sobrecalentamiento necesita confirmación rápida del sistema de enfriamiento." : "Overheating needs a quick cooling-system confirmation.",
      question: isEs ? "¿Has notado pérdida de coolant, vapor o temperatura subiendo rápido?" : "Have you noticed coolant loss, steam, or the temperature rising fast?",
      options: isEs ? ["Pierde coolant", "Sale vapor", "Sube rápido", "No sé"] : ["Coolant loss", "Steam", "Temp rises fast", "Not sure"],
    });
  }

  if (hasBrake && !used(["pedal"])) {
    return block({
      isEs,
      summary: isEs ? "Los frenos necesitan separar desgaste de una falla hidráulica." : "Brake symptoms need to separate wear from a hydraulic issue.",
      question: isEs ? "¿Cómo se siente el pedal de freno?" : "How does the brake pedal feel?",
      options: isEs ? ["Muy suave", "Duro", "Vibra o raspa", "No sé"] : ["Very soft", "Hard", "Grinding or vibration", "Not sure"],
    });
  }

  return block({
    isEs,
    summary: isEs ? "Necesito un detalle final para separar las causas probables." : "I need one final detail to separate the likely causes.",
    question: isEs ? "¿Qué cambia más cuando aparece el problema?" : "What changes the most when the problem appears?",
    options: isEs ? ["Ruido", "Olor", "Vibración", "Pérdida de potencia"] : ["Noise", "Smell", "Vibration", "Power loss"],
  });
}

function block({ isEs, summary, question, options }) {
  return `Diagnosis status: follow_up

Voice summary:
${summary}

Confidence:
55

Risk level:
Medium

Likely issue:
Still narrowing the issue.

Why it fits:
${isEs ? "Necesito una respuesta específica antes del reporte final." : "I need one specific answer before the final report."}

What to do next:
${question}

Answer options:
${options.join("\n")}

When to stop driving:
${isEs
  ? "Deja de manejar si el auto se siente inseguro, se sobrecalienta, huele a quemado, pierde mucha potencia, o aparece una luz roja."
  : "Stop driving if the car feels unsafe, overheats, smells like burning, loses strong power, or shows a red warning light."}`;
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
