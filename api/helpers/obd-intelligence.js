export function parseLiveDataContext(text) {
  const raw = String(text || "");

  const rpmMatch = raw.match(/RPM:\s*([0-9]+)/i);
  const coolantMatch = raw.match(/Coolant Temp:\s*(-?[0-9]+)/i);
  const batteryMatch = raw.match(/Battery:\s*([0-9.]+)/i);
  const speedMatch = raw.match(/Vehicle Speed:\s*([0-9]+)/i);

  return {
    rpm: rpmMatch ? Number(rpmMatch[1]) : null,
    coolant: coolantMatch ? Number(coolantMatch[1]) : null,
    battery: batteryMatch ? Number(batteryMatch[1]) : null,
    speed: speedMatch ? Number(speedMatch[1]) : null,
  };
}

export function extractObdCodes(input) {
  const raw = String(input || "").toUpperCase();
  const matches = raw.match(/\b[PCBU][0-9A-F]{4}\b/g) || [];
  return [...new Set(matches)];
}

function getCodeFamily(code) {
  if (/^P03/.test(code)) return "misfire";
  if (/^P017|^P01/.test(code)) return "air_fuel";
  if (/^P04|^P0420|^P0430/.test(code)) return "emissions";
  if (/^P05|^P056/.test(code)) return "voltage_speed_idle";
  if (/^P07/.test(code)) return "transmission";
  if (/^U/.test(code)) return "network";
  if (/^C/.test(code)) return "chassis";
  if (/^B/.test(code)) return "body";
  return "general";
}

function getCodePriority(code) {
  if (/^P0562|^P0563/.test(code)) return 100;
  if (/^U/.test(code)) return 90;
  if (/^P0335|^P0340/.test(code)) return 88;
  if (/^P0300|^P030[1-8]/.test(code)) return 84;
  if (/^P0171|^P0172|^P0174|^P0175/.test(code)) return 82;
  if (/^P020/.test(code)) return 80;
  if (/^P0700|^P07/.test(code)) return 78;
  if (/^P0420|^P0430/.test(code)) return 62;
  if (/^P044/.test(code)) return 45;
  return 50;
}

function buildMultipleCodeRelationship(codes) {
  const families = codes.map(getCodeFamily);

  const hasMisfire = families.includes("misfire");
  const hasAirFuel = families.includes("air_fuel");
  const hasCatalyst = codes.some((c) => c === "P0420" || c === "P0430");
  const hasVoltage = codes.some((c) => c === "P0562" || c === "P0563");
  const hasNetwork = families.includes("network");
  const hasTransmission = families.includes("transmission");

  if (hasVoltage || hasNetwork) {
    return "Voltage or communication faults can trigger misleading secondary codes. Confirm battery, charging voltage, grounds, and module communication before replacing sensors.";
  }

  if (hasMisfire && hasAirFuel && hasCatalyst) {
    return "The codes form a connected chain: air/fuel imbalance can cause misfire, and repeated misfire or rich/lean operation can stress the catalytic converter. Diagnose fuel control and misfire before condemning the catalyst.";
  }

  if (hasMisfire && hasAirFuel) {
    return "The codes are likely related: fuel mixture imbalance can create misfire symptoms. Diagnose intake leaks, fuel delivery, ignition strength, injector function, and fuel trims as one combined condition.";
  }

  if (hasMisfire && hasCatalyst) {
    return "The catalyst code may be a result of repeated misfire or incomplete combustion. Fix the misfire path first before judging catalytic converter condition.";
  }

  if (hasAirFuel && hasCatalyst) {
    return "The catalyst code may be downstream damage or a reaction to long-term fuel control problems. Diagnose lean/rich condition, exhaust leaks, and oxygen sensor behavior first.";
  }

  if (hasTransmission) {
    return "Transmission codes should be handled as a separate system unless engine performance codes are also affecting torque, shifting, or limp mode.";
  }

  return "Multiple codes were detected. Treat them as one vehicle condition first, then separate them only if they point to unrelated systems.";
}

export function buildObdInsight({ code, liveData }) {
  const codes = extractObdCodes(code);
  const safeCode = codes[0] || String(code || "").toUpperCase().trim();

  if (!codes.length && !safeCode) {
    return "No confirmed OBD diagnostic code was detected. Live data should be used only as supporting context, not as a final diagnosis.";
  }

  const rpm = liveData?.rpm ?? null;
  const coolant = liveData?.coolant ?? null;
  const battery = liveData?.battery ?? null;
  const speed = liveData?.speed ?? null;

  const engineState = analyzeEngineState({ rpm, speed });
  const batteryState = analyzeBatteryState({ battery, rpm });
  const coolantState = analyzeCoolantState({ coolant });
  const movementState = analyzeMovementState({ speed });

  const contextNotes = [
    engineState,
    batteryState,
    coolantState,
    movementState,
  ].filter(Boolean);

  if (codes.length > 1) {
    const sortedCodes = [...codes].sort(
      (a, b) => getCodePriority(b) - getCodePriority(a)
    );

    const primaryCode = sortedCodes[0];
    const supportingCodes = sortedCodes.slice(1);

    const primaryInsight = getCodeInsight(primaryCode);
    const supportingInsights = supportingCodes
      .map((c) => `${c}: ${getCodeInsight(c)}`)
      .join(" ");

    const relationship = buildMultipleCodeRelationship(sortedCodes);

    return [
      `Confirmed multiple OBD codes detected: ${sortedCodes.join(", ")}.`,
      `Primary diagnostic direction: ${primaryCode}: ${primaryInsight}`,
      supportingCodes.length ? `Supporting codes: ${supportingInsights}` : "",
      `Code relationship: ${relationship}`,
      `Live-data context: ${contextNotes.join(" ")}`,
      "Analyze all codes together as one vehicle condition. Do not diagnose each code separately unless the systems are clearly unrelated. Identify the root or dominant fault first, then explain which codes may be secondary effects.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  const codeInsight = getCodeInsight(safeCode);

  return [
    `Confirmed OBD code ${safeCode}: ${codeInsight}`,
    `Live-data context: ${contextNotes.join(" ")}`,
    "Use the code as the main diagnostic direction, and use live data only to raise or lower confidence. Avoid replacing the OBD code meaning with unrelated symptoms unless the live data clearly shows a safety issue.",
  ].join(" ");
}

function getCodeInsight(code) {
  const map = {
    P0010:
      "Camshaft position actuator circuit fault. Prioritize VVT actuator wiring, oil control solenoid circuit, connector condition, and ECM command response.",
    P0011:
      "Intake camshaft timing is over-advanced. Prioritize VVT solenoid sticking, dirty or low oil, cam phaser issue, timing chain stretch, or oil flow restriction.",
    P0012:
      "Intake camshaft timing is over-retarded. Prioritize VVT oil control solenoid, dirty or low oil, oil flow restriction, cam phaser response, timing actuator, or timing chain stretch.",
    P0013:
      "Exhaust camshaft actuator circuit fault. Prioritize VVT solenoid circuit, wiring, connector, actuator resistance, and ECM control signal.",
    P0014:
      "Exhaust camshaft timing is over-advanced. Prioritize VVT solenoid sticking, oil quality, cam phaser issue, or timing control fault.",
    P0015:
      "Exhaust camshaft timing is over-retarded. Prioritize oil flow, VVT actuator response, cam phaser operation, and timing chain condition.",

    P0101:
      "Mass airflow sensor range or performance fault. Prioritize dirty MAF sensor, intake air leak, restricted air filter, wiring, or incorrect airflow measurement.",
    P0102:
      "Mass airflow sensor low input. Prioritize MAF wiring, sensor power/ground, unplugged sensor, or intake measurement failure.",
    P0103:
      "Mass airflow sensor high input. Prioritize MAF signal circuit, sensor failure, wiring short, or abnormal airflow signal.",
    P0113:
      "Intake air temperature sensor high input. Prioritize IAT sensor circuit, unplugged connector, wiring fault, or sensor failure.",
    P0117:
      "Engine coolant temperature sensor low input. Prioritize coolant temperature sensor circuit, wiring short, or sensor fault.",
    P0118:
      "Engine coolant temperature sensor high input. Prioritize unplugged ECT sensor, open circuit, wiring issue, or sensor failure.",

    P0128:
      "Coolant thermostat performance fault. Prioritize thermostat stuck open, low coolant temperature, coolant sensor accuracy, and warm-up behavior.",
    P0130:
      "Oxygen sensor circuit fault on Bank 1 Sensor 1. Prioritize upstream O2 sensor wiring, sensor response, exhaust leak, or fuel control issue.",
    P0133:
      "Oxygen sensor slow response. Prioritize aging upstream O2 sensor, exhaust leak, fuel trim issue, or sensor contamination.",
    P0135:
      "Oxygen sensor heater circuit fault. Prioritize O2 heater fuse, wiring, connector, or sensor heater failure.",
    P0141:
      "Oxygen sensor heater circuit fault after the catalytic converter. Prioritize downstream O2 heater wiring, fuse, connector, or sensor failure.",

    P0171:
      "System too lean on Bank 1. Prioritize vacuum leak, intake boot leak, weak fuel delivery, dirty MAF sensor, exhaust leak before upstream O2, or unmetered air.",
    P0172:
      "System too rich on Bank 1. Prioritize leaking injector, high fuel pressure, dirty MAF, stuck purge valve, oxygen sensor feedback issue, or restricted air intake.",
    P0174:
      "System too lean on Bank 2. Prioritize vacuum leak, intake leak, weak fuel delivery, MAF issue, or exhaust leak affecting that bank.",
    P0175:
      "System too rich on Bank 2. Prioritize fuel pressure, injector leak, airflow measurement issue, oxygen sensor feedback, or purge valve issue.",

    P0201:
      "Injector circuit fault on cylinder 1. Prioritize injector wiring, connector, injector coil resistance, or ECM driver issue.",
    P0202:
      "Injector circuit fault on cylinder 2. Prioritize injector wiring, connector, injector coil resistance, or ECM driver issue.",
    P0203:
      "Injector circuit fault on cylinder 3. Prioritize injector wiring, connector, injector coil resistance, or ECM driver issue.",
    P0204:
      "Injector circuit fault on cylinder 4. Prioritize injector wiring, connector, injector coil resistance, or ECM driver issue.",

    P0300:
      "Random or multiple-cylinder misfire detected. Prioritize ignition coils, spark plugs, vacuum leak, fuel delivery, compression, injector function, or engine mechanical condition.",
    P0301:
      "Cylinder 1 misfire detected. Prioritize spark plug, ignition coil, injector, compression, vacuum leak near that cylinder, or wiring.",
    P0302:
      "Cylinder 2 misfire detected. Prioritize spark plug, ignition coil, injector, compression, vacuum leak near that cylinder, or wiring.",
    P0303:
      "Cylinder 3 misfire detected. Prioritize spark plug, ignition coil, injector, compression, vacuum leak near that cylinder, or wiring.",
    P0304:
      "Cylinder 4 misfire detected. Prioritize spark plug, ignition coil, injector, compression, vacuum leak near that cylinder, or wiring.",
    P0305:
      "Cylinder 5 misfire detected. Prioritize spark plug, ignition coil, injector, compression, vacuum leak near that cylinder, or wiring.",
    P0306:
      "Cylinder 6 misfire detected. Prioritize spark plug, ignition coil, injector, compression, vacuum leak near that cylinder, or wiring.",

    P0325:
      "Knock sensor circuit fault. Prioritize knock sensor wiring, connector, sensor failure, or engine noise affecting knock detection.",
    P0335:
      "Crankshaft position sensor circuit fault. Prioritize crank sensor, wiring, connector, signal loss, no-start condition, or intermittent stall.",
    P0340:
      "Camshaft position sensor circuit fault. Prioritize cam sensor, wiring, connector, timing correlation, or sensor signal failure.",

    P0401:
      "EGR flow insufficient. Prioritize clogged EGR passage, stuck EGR valve, vacuum/control issue, or EGR sensor feedback.",
    P0402:
      "EGR flow excessive. Prioritize stuck-open EGR valve, control solenoid issue, or incorrect EGR feedback.",

    P0420:
      "Catalyst efficiency below threshold on Bank 1. Prioritize catalytic converter efficiency, upstream engine performance, exhaust leak, oxygen sensor behavior, or long-term misfire/rich condition.",
    P0430:
      "Catalyst efficiency below threshold on Bank 2. Prioritize catalytic converter efficiency, exhaust leak, oxygen sensor behavior, or engine performance issue on that bank.",

    P0440:
      "EVAP system fault. Prioritize loose gas cap, EVAP leak, purge valve, vent valve, or vapor line issue.",
    P0442:
      "Small EVAP leak detected. Prioritize gas cap seal, small vapor leak, EVAP hose, purge valve, or vent valve.",
    P0455:
      "Large EVAP leak detected. Prioritize loose/missing gas cap, disconnected EVAP hose, vent valve, purge valve, or large vapor leak.",
    P0456:
      "Very small EVAP leak detected. Prioritize gas cap seal, small vapor line leak, or minor EVAP system leak.",

    P0500:
      "Vehicle speed sensor fault. Prioritize speed sensor, ABS/wheel speed input, wiring, or module communication.",
    P0562:
      "System voltage low. Prioritize weak battery, alternator output, charging circuit, ground connection, or power supply issue.",
    P0563:
      "System voltage high. Prioritize alternator regulator fault, charging system issue, or voltage control problem.",

    P0700:
      "Transmission control system requested a warning. Prioritize reading transmission-specific codes, fluid condition, shift behavior, and TCM communication.",
    P0715:
      "Input/turbine speed sensor circuit fault. Prioritize transmission speed sensor, wiring, connector, or internal transmission signal issue.",
    P0730:
      "Incorrect gear ratio. Prioritize transmission slipping, low/dirty fluid, internal clutch issue, valve body issue, or speed sensor correlation.",
    P0740:
      "Torque converter clutch circuit fault. Prioritize TCC solenoid, wiring, fluid condition, valve body, or converter clutch operation.",

    P1101:
      "Airflow system performance fault. Prioritize MAF sensor reading, intake leak, throttle body condition, air filter restriction, or PCV system issue.",
    P2096:
      "Post-catalyst fuel trim system too lean. Prioritize exhaust leak, oxygen sensor feedback, fuel delivery weakness, or catalyst-area air leak.",
    P219A:
      "Bank 1 air-fuel ratio imbalance. Prioritize injector balance, vacuum leak, misfire, compression difference, or oxygen sensor feedback.",
  };

  if (map[code]) return map[code];

  if (/^P03\d\d$/.test(code)) {
    return "Misfire-related powertrain code. Prioritize ignition, fuel delivery, compression, injector operation, vacuum leaks, and whether the check engine light is flashing.";
  }

  if (/^P01\d\d$/.test(code)) {
    return "Air, fuel, or sensor performance-related powertrain code. Prioritize intake leaks, fuel control, airflow measurement, oxygen sensor feedback, and wiring.";
  }

  if (/^P04\d\d$/.test(code)) {
    return "Emissions-control related powertrain code. Prioritize EVAP, EGR, catalyst, oxygen sensor feedback, exhaust leaks, and fuel control context.";
  }

  if (/^P05\d\d$/.test(code)) {
    return "Vehicle speed, idle control, or system voltage related powertrain code. Prioritize charging voltage, idle behavior, speed signals, and module communication.";
  }

  if (/^P07\d\d$/.test(code)) {
    return "Transmission-related powertrain code. Prioritize transmission-specific scan data, fluid condition, shifting behavior, speed sensors, solenoids, and TCM communication.";
  }

  if (/^C/.test(code)) {
    return "Chassis-system code. Prioritize ABS, traction control, steering, brake system sensors, wheel speed sensors, wiring, and module communication.";
  }

  if (/^B/.test(code)) {
    return "Body-system code. Prioritize body electronics, comfort systems, airbag-related modules if applicable, wiring, switches, sensors, and module communication.";
  }

  if (/^U/.test(code)) {
    return "Network communication code. Prioritize module communication, CAN bus wiring, battery voltage stability, grounds, connectors, and whether multiple modules are offline.";
  }

  return "OBD code detected. Use manufacturer-specific service data, freeze-frame data, and live sensor data to narrow the fault before replacing parts.";
}

function analyzeEngineState({ rpm, speed }) {
  if (rpm === null) {
    return "Engine running state is unknown because RPM was not captured.";
  }

  if (rpm === 0 && (speed === null || speed === 0)) {
    return "Engine appears OFF during the scan, so running behavior, idle quality, and charging output still need confirmation with the engine running.";
  }

  if (rpm > 0 && rpm < 500) {
    return "RPM is unusually low, which may suggest near-stall behavior, unstable idle, or a scan captured during transition.";
  }

  if (rpm >= 500 && rpm <= 950) {
    return "RPM is in a normal idle range for many warm engines, so the engine was likely running at idle during the capture.";
  }

  if (rpm > 950 && rpm < 2500) {
    return "RPM shows the engine was running above idle, so the data may reflect light throttle or warm-up behavior.";
  }

  if (rpm >= 2500) {
    return "RPM was elevated during the capture, so readings should be interpreted as running or revving data, not idle data.";
  }

  return "Engine state could not be classified from RPM.";
}

function analyzeBatteryState({ battery, rpm }) {
  if (battery === null) {
    return "Battery voltage was not captured.";
  }

  if (rpm === 0 || rpm === null) {
    if (battery < 11.8) {
      return `Battery voltage is ${battery}V with the engine off, which is low and may affect modules, sensors, starting, and scan reliability.`;
    }

    if (battery >= 11.8 && battery < 12.2) {
      return `Battery voltage is ${battery}V with the engine off, which is borderline and should be confirmed with a proper battery test.`;
    }

    if (battery >= 12.2 && battery <= 12.8) {
      return `Battery voltage is ${battery}V with the engine off, which is generally acceptable for a resting battery.`;
    }

    return `Battery voltage is ${battery}V with the engine off, which is higher than expected and may reflect recent charging or measurement variation.`;
  }

  if (rpm > 400) {
    if (battery < 13.2) {
      return `Battery voltage is ${battery}V while the engine appears running, which may suggest weak alternator output, charging circuit issue, belt issue, or measurement timing problem.`;
    }

    if (battery >= 13.2 && battery <= 14.8) {
      return `Battery voltage is ${battery}V while the engine appears running, which is generally consistent with normal charging output.`;
    }

    return `Battery voltage is ${battery}V while the engine appears running, which is high and may suggest charging regulation concern.`;
  }

  return `Battery voltage is ${battery}V. Interpret it with engine state and charging conditions.`;
}

function analyzeCoolantState({ coolant }) {
  if (coolant === null) {
    return "Coolant temperature was not captured.";
  }

  if (coolant < 40) {
    return `Coolant temperature is ${coolant}°C, suggesting the engine may be cold or not fully warmed up.`;
  }

  if (coolant >= 40 && coolant < 75) {
    return `Coolant temperature is ${coolant}°C, suggesting the engine is warming up or was not fully at operating temperature.`;
  }

  if (coolant >= 75 && coolant <= 105) {
    return `Coolant temperature is ${coolant}°C, which is within a typical operating range for many vehicles.`;
  }

  if (coolant > 105 && coolant <= 110) {
    return `Coolant temperature is ${coolant}°C, which is warm and should be watched closely, especially if temperature keeps rising.`;
  }

  return `Coolant temperature is ${coolant}°C, which is high and should be treated as an overheating risk until proven otherwise.`;
}

function analyzeMovementState({ speed }) {
  if (speed === null) {
    return "Vehicle speed was not captured.";
  }

  if (speed === 0) {
    return "Vehicle speed is 0 mph, so the scan was captured while stationary.";
  }

  if (speed > 0 && speed < 10) {
    return `Vehicle speed is ${speed} mph, suggesting very low-speed movement during capture.`;
  }

  return `Vehicle speed is ${speed} mph, so the data was captured while the vehicle was moving.`;
}
