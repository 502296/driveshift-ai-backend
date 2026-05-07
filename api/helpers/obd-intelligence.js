export function parseLiveDataContext(text) {
  const raw = String(text || "");

  const rpmMatch = raw.match(/RPM:\s*([0-9]+)/i);
  const coolantMatch = raw.match(/Coolant Temp:\s*([0-9]+)/i);
  const batteryMatch = raw.match(/Battery:\s*([0-9.]+)/i);
  const speedMatch = raw.match(/Vehicle Speed:\s*([0-9]+)/i);

  return {
    rpm: rpmMatch ? Number(rpmMatch[1]) : null,
    coolant: coolantMatch ? Number(coolantMatch[1]) : null,
    battery: batteryMatch ? Number(batteryMatch[1]) : null,
    speed: speedMatch ? Number(speedMatch[1]) : null,
  };
}

export function buildObdInsight({ code, liveData }) {
  if (!code) {
    return "No confirmed OBD diagnostic code.";
  }

  const rpm = liveData?.rpm;
  const coolant = liveData?.coolant;
  const battery = liveData?.battery;
  const speed = liveData?.speed;

  let insight = "";

  switch (String(code).toUpperCase()) {
    case "P0012":
      insight =
        "Camshaft timing is over-retarded. Possible VVT solenoid, oil flow, timing actuator, or timing chain issue.";
      break;

    case "P0300":
      insight =
        "Random engine misfire detected. Possible ignition, fuel delivery, or compression issue.";
      break;

    case "P0171":
      insight =
        "Engine running lean. Possible vacuum leak, MAF issue, fuel delivery weakness, or intake leak.";
      break;

    case "P0172":
      insight =
        "Engine running rich. Possible injector leak, fuel pressure issue, oxygen sensor feedback issue, or airflow problem.";
      break;

    case "P0420":
      insight =
        "Catalyst efficiency below threshold. Possible catalytic converter wear or upstream engine efficiency issue.";
      break;

    default:
      insight =
        "OBD code detected. Additional live data and symptoms are required.";
      break;
  }

  if (battery !== null && battery < 11.8) {
    insight +=
      " Battery voltage appears low, which may affect sensors and starting performance.";
  }

  if (coolant !== null && coolant > 110) {
    insight +=
      " Engine temperature appears dangerously high, suggesting possible overheating risk.";
  }

  if (rpm !== null && rpm === 0 && speed === 0) {
    insight +=
      " Engine currently appears OFF during the scan.";
  }

  if (rpm !== null && rpm > 600) {
    insight +=
      " Engine was running during live-data capture.";
  }

  return insight;
}
