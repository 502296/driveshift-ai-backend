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
  const danger = detectDangerSignal(text);

  if (advanced) {
    const expert = buildAdvancedQuestion({ isEs, text, system, used, danger });
    if (expert) return expert;
  }

  const dominant = buildDominantQuestion({ isEs, text, used, danger });
  if (dominant) return dominant;

  const systemQuestion = buildSystemQuestion({ isEs, text, system, used, danger });
  if (systemQuestion) return systemQuestion;

  return buildGeneralQuestion({ isEs, text, used, danger });
}

function buildAdvancedQuestion({ isEs, text, system, used, danger }) {
  if (system === "network_can") {
    if (!used(["module isolation", "isolated", "disconnect", "bus load", "waveform"])) {
      return block({
        isEs,
        risk: danger || "High",
        summary: isEs
          ? "El patrón parece una red CAN contaminada por carga, módulo o caída de voltaje."
          : "This pattern looks like a CAN network being corrupted by load, module behavior, or voltage drop.",
        question: isEs
          ? "Cuando falla, ¿la forma de onda CAN queda deformada, baja de amplitud, o mejora al aislar módulos uno por uno?"
          : "When it fails, does the CAN waveform distort, lose amplitude, or improve when modules are isolated one by one?",
        options: isEs
          ? ["Mejora al aislar módulo", "Se deforma la señal", "Cae amplitud", "No probado"]
          : ["Improves isolating module", "Signal distorts", "Amplitude drops", "Not tested"],
        note: isEs
          ? "Un DTC de comunicación no siempre significa módulo malo; primero se separa bus cargado, alimentación, tierra y terminación."
          : "A communication DTC does not automatically mean a bad module; bus load, power, ground, and termination must be separated first.",
      });
    }

    if (!used(["power", "ground", "termination", "splice", "voltage drop"])) {
      return block({
        isEs,
        risk: danger || "High",
        summary: isEs
          ? "Ahora hay que separar módulo corrupto de alimentación, tierra o terminación."
          : "Now the split is corrupt module versus power, ground, or termination integrity.",
        question: isEs
          ? "¿Power, ground, voltage drop y resistencia de terminación fueron medidos en el módulo sospechoso bajo carga?"
          : "Were power, ground, voltage drop, and termination resistance measured at the suspect module under load?",
        options: isEs
          ? ["Power/ground OK", "Caída de voltaje", "Terminación mal", "No medido"]
          : ["Power/ground OK", "Voltage drop found", "Termination wrong", "Not measured"],
        note: isEs
          ? "Muchos módulos se culpan por error cuando la falla real es una tierra débil o un splice con alta resistencia."
          : "Many modules get blamed when the real fault is a weak ground or high-resistance splice.",
      });
    }
  }

  if (system === "fuel") {
    if (!used(["injector balance", "o2", "switching", "bank 1", "bank 2"])) {
      return block({
        isEs,
        risk: danger || "Medium",
        summary: isEs
          ? "Una mezcla lean/rich por banco necesita comparar O2, trim e injector balance."
          : "A bank-specific mixture fault needs O2, trim, and injector balance comparison.",
        question: isEs
          ? "¿El banco afectado muestra O2 switching, fuel trim o injector balance diferente al otro banco?"
          : "Does the affected bank show different O2 switching, fuel trim, or injector balance compared with the other bank?",
        options: isEs
          ? ["O2 diferente", "Trim diferente", "Injector diferente", "No probado"]
          : ["O2 differs", "Trim differs", "Injector differs", "Not tested"],
        note: isEs
          ? "Si smoke test y fuel pressure son normales, el siguiente sospechoso serio es sensor skew o inyector restringido/fugando."
          : "If smoke test and fuel pressure are normal, the serious next split is sensor skew versus restricted or leaking injector behavior.",
      });
    }

    if (!used(["load", "idle", "rpm", "warm", "fuel pressure"])) {
      return block({
        isEs,
        risk: danger || "Medium",
        summary: isEs
          ? "El momento en que cambia el fuel trim separa aire falso de falta de combustible."
          : "When fuel trim changes separates unmetered air from fuel delivery loss.",
        question: isEs
          ? "¿El fuel trim se dispara en idle, bajo carga, o solo después de calentarse?"
          : "Does the fuel trim spike at idle, under load, or only after the engine warms up?",
        options: isEs
          ? ["En idle", "Bajo carga", "Solo caliente", "No sé"]
          : ["At idle", "Under load", "Only warm", "Not sure"],
        note: isEs
          ? "Lean en idle suele apuntar a aire falso; lean bajo carga suele apuntar más a volumen/presión de combustible."
          : "Lean at idle often points toward unmetered air; lean under load points harder toward fuel volume or pressure.",
      });
    }
  }

  if (system === "transmission") {
    if (!used(["line pressure", "slip", "clutch", "pressure test", "atf temperature"])) {
      return block({
        isEs,
        risk: danger || "Medium",
        summary: isEs
          ? "Un flare que depende de temperatura apunta a presión hidráulica, sellos internos o clutch apply."
          : "A temperature-dependent flare points toward hydraulic pressure, internal sealing, or clutch apply control.",
        question: isEs
          ? "Cuando el ATF pasa de 190°F, ¿sube el slip, cae la presión de línea, o cambia el tiempo de cambio?"
          : "When ATF temperature passes 190°F, does slip increase, line pressure drop, or shift timing change?",
        options: isEs
          ? ["Sube slip", "Cae presión", "Cambia timing", "No medido"]
          : ["Slip increases", "Pressure drops", "Timing changes", "Not measured"],
        note: isEs
          ? "No se condena una transmisión sin separar presión real, comando del solenoide y fuga interna caliente."
          : "Do not condemn a transmission before separating real pressure, solenoid command, and hot internal leakage.",
      });
    }
  }

  if (system === "suspension") {
    if (!used(["calibration", "zero point", "torque sensor", "scan tool", "rack"])) {
      return block({
        isEs,
        risk: danger || "Medium",
        summary: isEs
          ? "Después de rack o suspensión, una calibración EPS puede cambiar todo el diagnóstico."
          : "After rack or suspension work, EPS calibration can completely change the diagnosis.",
        question: isEs
          ? "¿Se hizo steering angle, torque sensor zero-point reset o EPS calibration con scanner después del trabajo?"
          : "Was steering angle, torque sensor zero-point reset, or EPS calibration performed with a scan tool after the repair?",
        options: isEs
          ? ["Sí calibrado", "No se hizo", "Falló calibración", "No sé"]
          : ["Yes calibrated", "Not performed", "Calibration failed", "Not sure"],
        note: isEs
          ? "Un volante raro después de rack no siempre es pieza defectuosa; muchas veces es cero de torque o ángulo no aprendido."
          : "Odd steering after rack work is not always a bad part; often the torque or steering angle zero was never learned.",
      });
    }
  }

  if (system === "engine_noise") {
    if (!used(["load", "rpm", "oil pressure", "frequency", "cold", "warm"])) {
      return block({
        isEs,
        risk: danger || "Medium",
        summary: isEs
          ? "El ruido de motor se separa por frecuencia, carga, temperatura y presión de aceite."
          : "Engine noise is separated by frequency, load, temperature, and oil pressure behavior.",
        question: isEs
          ? "¿El tapping cambia bajo carga, cambia con temperatura, o solo sigue las RPM?"
          : "Does the tapping change under load, change with temperature, or only follow RPM?",
        options: isEs
          ? ["Solo sigue RPM", "Cambia bajo carga", "Cambia caliente/frío", "No sé"]
          : ["Only follows RPM", "Changes under load", "Changes hot/cold", "Not sure"],
        note: isEs
          ? "Valvetrain, wrist pin y lower-end noise no se separan por volumen; se separan por carga, frecuencia y presión de aceite."
          : "Valvetrain, wrist pin, and lower-end noise are not separated by loudness; they are separated by load, frequency, and oil pressure behavior.",
      });
    }
  }

  return null;
}

function buildDominantQuestion({ isEs, text, used, danger }) {
  const noSmoke = hasNegation(text, ["smoke", "visible smoke"]);
  const noFuel = hasNegation(text, ["fuel smell", "gas smell", "raw fuel"]);

  const hasBlackSmoke = !noSmoke && includesAny(text, ["black smoke", "dark smoke", "humo negro"]);
  const hasWhiteSmoke = !noSmoke && includesAny(text, ["white smoke", "humo blanco", "sweet smell"]);
  const hasBlueSmoke = !noSmoke && includesAny(text, ["blue smoke", "humo azul", "burning oil"]);
  const hasFuelSmell = !noFuel && includesAny(text, ["fuel smell", "gas smell", "raw fuel", "smells like gas", "gasolina"]);

  if ((hasBlackSmoke || hasFuelSmell) && !used(["idle", "acceleration", "fuel economy", "misfire"])) {
    return block({
      isEs,
      risk: danger || "High",
      summary: isEs
        ? "Humo negro u olor a gasolina apunta a combustión rica o combustible sin quemar."
        : "Black smoke or raw fuel smell points toward rich combustion or unburned fuel entering the exhaust.",
      question: isEs
        ? "¿Empeora al acelerar, también pasa en idle, o el consumo de combustible cayó fuerte?"
        : "Does it get worse under acceleration, also happen at idle, or has fuel economy dropped sharply?",
      options: isEs
        ? ["Peor acelerando", "También en idle", "Consume mucho", "No sé"]
        : ["Worse accelerating", "Also at idle", "Fuel economy dropped", "Not sure"],
      note: isEs
        ? "Este patrón no se trata como vacuum leak primero; se protege la ruta dominante de sobrecombustible, inyector o control de mezcla."
        : "This pattern should not be treated as a vacuum leak first; the dominant path is overfueling, injector behavior, or mixture control.",
    });
  }

  if (hasWhiteSmoke && !used(["coolant loss", "steam", "startup", "temperature"])) {
    return block({
      isEs,
      risk: danger || "High",
      summary: isEs
        ? "Humo blanco persistente necesita separar vapor normal de coolant entrando a combustión."
        : "Persistent white smoke needs to separate normal vapor from coolant entering combustion.",
      question: isEs
        ? "¿Pierde coolant, huele dulce, sube temperatura, o el humo solo aparece al encender en frío?"
        : "Is coolant disappearing, does it smell sweet, does temperature rise, or is the smoke only on cold startup?",
      options: isEs
        ? ["Pierde coolant", "Huele dulce", "Sube temperatura", "Solo frío"]
        : ["Coolant loss", "Sweet smell", "Temp rises", "Only cold startup"],
      note: isEs
        ? "Coolant en combustión puede dañar catalizador y motor; no se ignora si baja el nivel."
        : "Coolant entering combustion can damage the catalyst and engine; it should not be ignored if the level drops.",
    });
  }

  if (hasBlueSmoke && !used(["startup", "deceleration", "boost", "pcv"])) {
    return block({
      isEs,
      risk: danger || "Medium",
      summary: isEs
        ? "Humo azul apunta a aceite entrando en combustión por sellos, rings, turbo o PCV."
        : "Blue smoke points to oil entering combustion through seals, rings, turbo, or PCV flow.",
      question: isEs
        ? "¿El humo azul aparece al encender, al desacelerar, bajo boost/carga, o todo el tiempo?"
        : "Does the blue smoke show on startup, deceleration, boost/load, or all the time?",
      options: isEs
        ? ["Al encender", "Desacelerando", "Bajo carga", "Todo el tiempo"]
        : ["Startup", "Deceleration", "Under load", "All the time"],
      note: isEs
        ? "El momento del humo separa valve seals, rings, turbo y PCV mejor que cambiar piezas por intuición."
        : "Smoke timing separates valve seals, rings, turbo, and PCV better than guessing at parts.",
    });
  }

  if (includesAny(text, ["overheat", "overheating", "temperature rising", "steam", "sobrecalienta"]) &&
      !used(["coolant", "fan", "heater", "thermostat"])) {
    return block({
      isEs,
      risk: danger || "High",
      summary: isEs
        ? "El sobrecalentamiento debe separarse entre pérdida de coolant, falta de flujo o falta de airflow."
        : "Overheating must be split between coolant loss, poor flow, and poor airflow.",
      question: isEs
        ? "¿Sube la temperatura parado, en carretera, con A/C, o después de perder coolant?"
        : "Does the temperature rise while sitting still, on the highway, with A/C on, or after coolant loss?",
      options: isEs
        ? ["Parado", "En carretera", "Con A/C", "Pierde coolant"]
        : ["Sitting still", "Highway", "With A/C", "Coolant loss"],
      note: isEs
        ? "Parado apunta más a fan/airflow; carretera apunta más a flujo, radiador, thermostat o head gasket bajo carga."
        : "Overheating at idle points more to fan/airflow; highway overheating points more to flow, radiator, thermostat, or load-related head gasket behavior.",
    });
  }

  if (includesAny(text, ["no start", "won't start", "will not start", "doesn't start", "cranks but", "only clicks", "starter clicks"]) &&
      !used(["crank", "click", "security", "fuel pump"])) {
    return block({
      isEs,
      risk: danger || "Medium",
      summary: isEs
        ? "No-start primero se divide entre no-crank, crank/no-start, seguridad, combustible e ignición."
        : "No-start must first be divided into no-crank, crank/no-start, security, fuel, and ignition paths.",
      question: isEs
        ? "Al girar la llave o presionar Start, ¿el motor gira normal, solo hace click, o no hace nada?"
        : "When you turn the key or press Start, does the engine crank normally, only click, or do nothing at all?",
      options: isEs
        ? ["Gira normal", "Solo click", "No hace nada", "Security light"]
        : ["Cranks normally", "Only clicks", "No sound", "Security light"],
      note: isEs
        ? "Esta sola respuesta evita confundir starter/batería con fuel pump, crank sensor o inmovilizador."
        : "This single answer prevents confusing battery/starter faults with fuel pump, crank sensor, or immobilizer faults.",
    });
  }

  return null;
}

function buildSystemQuestion({ isEs, text, system, used, danger }) {
  if (system === "engine_drivability") {
    if (!used(["uphill", "under load", "heavy throttle", "idle"])) {
      return block({
        isEs,
        risk: danger || "Medium",
        summary: isEs
          ? "La pérdida de potencia o sacudida bajo carga apunta a ruptura de combustión."
          : "Power loss or shaking under load points toward combustion breakdown.",
        question: isEs
          ? "¿La falla aparece más al acelerar fuerte/subir loma o también en idle?"
          : "Does it happen mostly under hard acceleration/uphill, or also at idle?",
        options: isEs
          ? ["Acelerando/subida", "También en idle", "Después de calentarse", "No sé"]
          : ["Acceleration/uphill", "Also at idle", "After it warms up", "Not sure"],
        note: isEs
          ? "Bajo carga favorece ignition breakdown, fuel delivery o mezcla; en idle abre más la puerta a vacuum leak, injector o compresión."
          : "Under load favors ignition breakdown, fuel delivery, or mixture control; at idle opens the door more to vacuum leak, injector, or compression.",
      });
    }

    if (!used(["warm", "cold", "temperature", "hot"])) {
      return block({
        isEs,
        risk: danger || "Medium",
        summary: isEs
          ? "La temperatura separa falla térmica de falla constante."
          : "Temperature separates heat-related failure from constant failure.",
        question: isEs
          ? "¿El problema aparece solo caliente, también frío, o va y viene sin patrón?"
          : "Does the problem appear only warm, also cold, or come and go without a clear pattern?",
        options: isEs
          ? ["Solo caliente", "También frío", "Intermitente", "No sé"]
          : ["Only warm", "Also cold", "Intermittent", "Not sure"],
        note: isEs
          ? "Fallas calientes suelen revelar coil, sensor, módulo, vapor lock, o componente eléctrico con ruptura térmica."
          : "Hot-only faults often expose coils, sensors, modules, vapor lock, or electrical components breaking down with heat.",
      });
    }
  }

  if (system === "airbags_srs" && !used(["srs code", "airbag code", "code"])) {
    return block({
      isEs,
      risk: "Medium",
      summary: isEs
        ? "La luz airbag necesita código SRS; aquí adivinar es mala práctica."
        : "An airbag light needs the SRS code; guessing here is bad practice.",
      question: isEs
        ? "¿Tienes código SRS exacto, o solo aparece la luz de airbag?"
        : "Do you have the exact SRS/airbag code, or only the airbag warning light?",
      options: isEs
        ? ["Tengo código", "Solo luz", "Después de reparación", "No sé"]
        : ["I have a code", "Only the light", "After a repair", "Not sure"],
      note: isEs
        ? "SRS puede ser clock spring, sensor, seat occupancy, pretensioner, wiring o bajo voltaje; el código manda."
        : "SRS can be clock spring, sensor, seat occupancy, pretensioner, wiring, or low voltage; the code controls the path.",
    });
  }

  if (system === "transmission" && !used(["hot", "cold", "temperature", "atf"])) {
    return block({
      isEs,
      risk: danger || "Medium",
      summary: isEs
        ? "Transmisión se diagnostica por temperatura, presión y momento exacto del cambio."
        : "Transmission diagnosis depends on temperature, pressure, and exact shift timing.",
      question: isEs
        ? "¿El problema aparece en frío, caliente, después de manejar, o todo el tiempo?"
        : "Does the shift issue happen cold, hot, after driving awhile, or all the time?",
      options: isEs
        ? ["En frío", "En caliente", "Después de manejar", "Siempre"]
        : ["Cold", "Hot", "After driving awhile", "All the time"],
      note: isEs
        ? "Un síntoma caliente suele indicar presión, sellado interno, solenoide o fluido; frío puede apuntar a viscosidad o control inicial."
        : "A hot symptom often points to pressure, internal sealing, solenoid, or fluid behavior; cold symptoms can point to viscosity or initial control.",
    });
  }

  if (system === "brakes" && !used(["speed", "highway", "pedal", "steering"])) {
    return block({
      isEs,
      risk: danger || "Medium",
      summary: isEs
        ? "La vibración de freno cambia según velocidad y dónde se siente."
        : "Brake vibration changes diagnosis by speed and where the vibration is felt.",
      question: isEs
        ? "¿La vibración aparece principalmente al frenar en highway y se siente en volante o pedal?"
        : "Does the vibration happen mainly while braking at highway speed, and is it felt in the steering wheel or pedal?",
      options: isEs
        ? ["Volante", "Pedal", "Todo el carro", "No es al frenar"]
        : ["Steering wheel", "Pedal", "Whole car", "Not while braking"],
      note: isEs
        ? "Volante apunta más a rotor/front-end; pedal puede revelar rotor runout, ABS event o hydraulic feedback."
        : "Steering wheel points more to rotor/front-end behavior; pedal feedback can expose rotor runout, ABS event, or hydraulic feedback.",
    });
  }

  return null;
}

function buildGeneralQuestion({ isEs, text, used, danger }) {
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

  if (hasVibration && hasHighway && !used(["steering wheel", "seat", "floor", "pedal"])) {
    return block({
      isEs,
      risk: danger || "Medium",
      summary: isEs
        ? "La vibración a velocidad alta se diagnostica por el punto donde entra al chasis."
        : "High-speed vibration is diagnosed by where it enters the chassis.",
      question: isEs
        ? "¿Dónde se siente más: volante, asiento/piso, pedal de freno, o todo el carro?"
        : "Where is it felt most: steering wheel, seat/floor, brake pedal, or the whole car?",
      options: isEs
        ? ["Volante", "Asiento/piso", "Pedal", "Todo el carro"]
        : ["Steering wheel", "Seat/floor", "Pedal", "Whole car"],
      note: isEs
        ? "Volante apunta a frente/llanta/rotor; asiento apunta más a trasero/driveline; pedal apunta a freno."
        : "Steering wheel points front tire/rotor; seat points rear/driveline; pedal points brake system.",
    });
  }

  if (hasVibration && !hasBrakeWords && !used(["braking", "accelerating", "coasting", "steady speed"])) {
    return block({
      isEs,
      risk: danger || "Medium",
      summary: isEs
        ? "La vibración se separa por carga: acelerar, frenar, coast o velocidad constante."
        : "Vibration is separated by load: acceleration, braking, coast, or steady speed.",
      question: isEs
        ? "¿Aparece acelerando, frenando, soltando acelerador, o manteniendo velocidad constante?"
        : "Does it happen while accelerating, braking, coasting, or holding steady speed?",
      options: isEs
        ? ["Acelerando", "Frenando", "Coasting", "Velocidad constante"]
        : ["Accelerating", "Braking", "Coasting", "Steady speed"],
      note: isEs
        ? "Acelerando apunta a motor/mount/axle; frenando a rotor/caliper; constante a tire balance o driveline."
        : "Acceleration points to engine/mount/axle; braking to rotor/caliper; steady speed to tire balance or driveline.",
    });
  }

  if (hasSteeringWords && !used(["left", "right", "pull", "alignment", "tire balance"])) {
    return block({
      isEs,
      risk: danger || "Medium",
      summary: isEs
        ? "Si entra por el volante, separo tire balance de alignment, rack o suspensión."
        : "If it enters through the steering wheel, I separate tire balance from alignment, rack, or suspension.",
      question: isEs
        ? "¿El volante solo vibra, se jala a un lado, o empeora al subir velocidad?"
        : "Does the steering wheel only vibrate, pull to one side, or get worse as speed rises?",
      options: isEs
        ? ["Solo vibra", "Jala a un lado", "Peor con velocidad", "No sé"]
        : ["Only vibrates", "Pulls to one side", "Worse with speed", "Not sure"],
      note: isEs
        ? "Pull y vibration no son la misma falla; pull habla de geometry/tire conicity, vibration habla de imbalance/runout."
        : "Pull and vibration are not the same fault; pull speaks to geometry/tire conicity, vibration to imbalance or runout.",
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

  const hasNoStart = !hasDriveabilityPattern && isTrueNoStart(text);
  const hasOverheat = includesAny(text, ["overheat", "overheating", "coolant", "steam"]);
  const hasBrake = includesAny(text, ["brake", "pedal", "brake fluid", "grinding"]);

  if (hasDriveabilityPattern && !used(["uphill", "under load", "idle", "heavy throttle"])) {
    return block({
      isEs,
      risk: danger || (hasFlashingCel ? "High" : "Medium"),
      summary: isEs
        ? "Esto se comporta como ruptura de combustión bajo presión de cilindro."
        : "This behaves like combustion breaking down under cylinder pressure.",
      question: isEs
        ? "¿La falla aparece más al acelerar fuerte/subir loma o también en idle?"
        : "Does it happen mostly under hard acceleration/uphill, or also at idle?",
      options: isEs
        ? ["Acelerando/subida", "También idle", "Solo caliente", "No sé"]
        : ["Acceleration/uphill", "Also idle", "Only warm", "Not sure"],
      note: isEs
        ? "Bajo carga se revelan coils débiles, plugs abiertos, fuel delivery pobre o mezcla que no sostiene combustión."
        : "Under load exposes weak coils, worn plugs, poor fuel delivery, or mixture that cannot sustain combustion.",
    });
  }

  if (hasNoStart && !used(["crank", "gira", "click", "start"])) {
    return block({
      isEs,
      risk: danger || "Medium",
      summary: isEs
        ? "Primero separo electrical no-crank de crank/no-start."
        : "First I separate electrical no-crank from crank/no-start.",
      question: isEs
        ? "Cuando intentas encender, ¿el motor gira normal, solo hace click, o no hace nada?"
        : "When you try to start it, does the engine crank normally, only click, or do nothing at all?",
      options: isEs
        ? ["Gira normal", "Solo click", "No hace nada", "No sé"]
        : ["Cranks normally", "Only clicks", "No sound", "Not sure"],
      note: isEs
        ? "Si gira, el camino es fuel/spark/compression/signal; si no gira, el camino es battery/starter/relay/ground/security."
        : "If it cranks, the path is fuel/spark/compression/signal; if it does not crank, the path is battery/starter/relay/ground/security.",
    });
  }

  if (hasOverheat && !used(["coolant", "refrigerante", "steam", "vapor", "fan"])) {
    return block({
      isEs,
      risk: danger || "High",
      summary: isEs
        ? "El sobrecalentamiento exige separar pérdida de coolant, fan, flujo y presión."
        : "Overheating requires separating coolant loss, fan control, flow, and pressure.",
      question: isEs
        ? "¿Pierde coolant, sale vapor, sube rápido en tráfico, o sube más en carretera?"
        : "Is it losing coolant, steaming, rising fast in traffic, or rising more on the highway?",
      options: isEs
        ? ["Pierde coolant", "Sale vapor", "Tráfico", "Carretera"]
        : ["Coolant loss", "Steam", "Traffic", "Highway"],
      note: isEs
        ? "No se cambia thermostat a ciegas hasta saber si el problema es flujo, presión, airflow o combustión entrando al coolant."
        : "Do not blindly replace the thermostat until flow, pressure, airflow, and combustion gas intrusion are separated.",
    });
  }

  if (hasBrake && !used(["pedal", "soft", "hard", "abs"])) {
    return block({
      isEs,
      risk: danger || "High",
      summary: isEs
        ? "Frenos se separan por pedal, ruido, vibración y presión hidráulica."
        : "Brake faults are separated by pedal feel, noise, vibration, and hydraulic pressure.",
      question: isEs
        ? "¿Cómo se siente el pedal: suave, duro, vibra, se hunde, o raspa al frenar?"
        : "How does the brake pedal feel: soft, hard, vibrating, sinking, or grinding when braking?",
      options: isEs
        ? ["Suave", "Duro", "Vibra", "Se hunde/raspa"]
        : ["Soft", "Hard", "Vibrates", "Sinks/grinds"],
      note: isEs
        ? "Pedal suave apunta hidráulico; pedal duro apunta booster/vacuum; vibración apunta rotor/runout; grinding apunta fricción dañada."
        : "Soft pedal points hydraulic; hard pedal points booster/vacuum; vibration points rotor/runout; grinding points damaged friction material.",
    });
  }

  return block({
    isEs,
    risk: danger || "Medium",
    summary: isEs
      ? "Necesito ubicar cuándo el sistema falla bajo carga real."
      : "I need to locate when the system fails under real operating load.",
    question: isEs
      ? "¿Cuándo aparece más fuerte: acelerando, frenando, girando, en idle, o manteniendo velocidad constante?"
      : "When is it strongest: accelerating, braking, turning, at idle, or holding steady speed?",
    options: isEs
      ? ["Acelerando", "Frenando", "Girando", "Idle/velocidad constante"]
      : ["Accelerating", "Braking", "Turning", "Idle/steady speed"],
    note: isEs
      ? "El momento exacto del síntoma es lo que separa motor, transmisión, frenos, suspensión, dirección y electricidad."
      : "The exact moment of the symptom separates engine, transmission, brakes, suspension, steering, and electrical paths.",
  });
}

function block({ isEs, risk, summary, question, options, note }) {
  return `Diagnosis status:
follow_up

Voice summary:
${summary}

Risk level:
${risk || "Medium"}

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

Mechanic Notes:
${note || (isEs
  ? "Esta respuesta separa la ruta dominante antes de cambiar piezas."
  : "This answer separates the dominant failure path before parts are replaced.")}`;
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

function detectDangerSignal(text) {
  const clean = String(text || "").toLowerCase();

  if (
    includesAny(clean, [
      "red warning",
      "brake warning",
      "no brakes",
      "pedal goes to floor",
      "overheating badly",
      "steam",
      "fuel leak",
      "strong fuel smell",
      "burning electrical",
      "burning plastic",
      "severe power loss",
      "flashing check engine",
      "airbag deployed",
      "steering locked",
    ])
  ) {
    return "Critical";
  }

  if (
    includesAny(clean, [
      "overheat",
      "overheating",
      "burning smell",
      "fuel smell",
      "black smoke",
      "white smoke",
      "brake",
      "airbag",
      "abs",
      "stalling",
      "dies while driving",
      "shakes badly",
    ])
  ) {
    return "High";
  }

  return "";
}
