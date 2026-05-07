import { includesAny } from "./diagnostic-core.js";

export function buildSmartFollowUp({ lang, issue, answers }) {
  const isEs = lang === "es";

  const text = [
    String(issue || ""),
    ...(Array.isArray(answers)
      ? answers.map((a) => `${a?.question || ""} ${a?.answer || ""}`)
      : []),
  ]
    .join(" ")
    .toLowerCase();

  const asked = Array.isArray(answers)
    ? answers.map((a) => String(a?.question || "").toLowerCase()).join(" ")
    : "";

  const used = (keys) => keys.some((k) => asked.includes(k));

  const hasFuel = includesAny(text, ["fuel smell", "gas smell", "raw fuel", "smells like gas"]);
  const hasSmoke = includesAny(text, ["black smoke", "dark smoke", "smoke"]);
  const hasNoStart = includesAny(text, ["won't start", "no start", "does not start", "click", "crank"]);
  const hasOverheat = includesAny(text, ["overheat", "overheating", "coolant", "steam"]);
  const hasBrake = includesAny(text, ["brake", "pedal", "brake fluid", "grinding"]);
  const hasShake = includesAny(text, ["shake", "shaking", "rough idle", "vibration", "misfire"]);

  if (hasSmoke || hasFuel) {
    if (!used(["accelerate", "aceleras"])) {
      return block({
        isEs,
        summary: isEs
          ? "Ese patrón apunta más a mezcla rica o combustible sin quemar."
          : "That pattern points more toward rich fuel mixture or unburned fuel.",
        question: isEs
          ? "¿El humo u olor a gasolina empeora cuando aceleras?"
          : "Does the smoke or fuel smell get worse when you accelerate?",
        options: isEs
          ? ["Sí, al acelerar", "También en idle", "Solo al encender", "No sé"]
          : ["Yes, under acceleration", "Also at idle", "Only at startup", "Not sure"],
      });
    }

    if (!used(["rough", "misfire", "tiembla", "falla"])) {
      return block({
        isEs,
        summary: isEs
          ? "Ahora necesito separar injector, mezcla rica o misfire."
          : "Now I need to separate injector, rich mixture, or misfire.",
        question: isEs
          ? "¿El motor tiembla o falla cuando aparece el humo u olor?"
          : "Does the engine shake or misfire when the smoke or smell appears?",
        options: isEs
          ? ["Sí, tiembla", "Sí, falla al acelerar", "No, trabaja normal", "No sé"]
          : ["Yes, it shakes", "Yes, misfires on acceleration", "No, runs smooth", "Not sure"],
      });
    }
  }

  if (hasNoStart) {
    if (!used(["crank", "gira"])) {
      return block({
        isEs,
        summary: isEs
          ? "Primero separo batería, starter o alimentación."
          : "First I need to separate battery, starter, or power supply.",
        question: isEs
          ? "Cuando intentas encender, ¿el motor gira o solo hace click?"
          : "When you try to start it, does the engine crank or only click?",
        options: isEs
          ? ["Gira normal", "Solo hace click", "No hace nada", "No sé"]
          : ["Cranks normally", "Only clicks", "No sound", "Not sure"],
      });
    }
  }

  if (hasOverheat) {
    if (!used(["coolant", "refrigerante", "steam", "vapor"])) {
      return block({
        isEs,
        summary: isEs
          ? "El sobrecalentamiento necesita confirmación rápida del sistema de enfriamiento."
          : "Overheating needs a quick cooling-system confirmation.",
        question: isEs
          ? "¿Has notado pérdida de coolant, vapor o temperatura subiendo rápido?"
          : "Have you noticed coolant loss, steam, or the temperature rising fast?",
        options: isEs
          ? ["Pierde coolant", "Sale vapor", "Sube rápido", "No sé"]
          : ["Coolant loss", "Steam", "Temp rises fast", "Not sure"],
      });
    }
  }

  if (hasBrake) {
    if (!used(["pedal"])) {
      return block({
        isEs,
        summary: isEs
          ? "Los frenos necesitan separar desgaste de una falla hidráulica."
          : "Brake symptoms need to separate wear from a hydraulic issue.",
        question: isEs
          ? "¿Cómo se siente el pedal de freno?"
          : "How does the brake pedal feel?",
        options: isEs
          ? ["Muy suave", "Duro", "Vibra o raspa", "No sé"]
          : ["Very soft", "Hard", "Grinding or vibration", "Not sure"],
      });
    }
  }

  if (hasShake) {
    if (!used(["cold", "warm", "frío", "caliente"])) {
      return block({
        isEs,
        summary: isEs
          ? "La vibración necesita separar misfire, mezcla o soporte de motor."
          : "The shaking needs to separate misfire, mixture, or engine mount.",
        question: isEs
          ? "¿Tiembla más cuando está frío o cuando ya está caliente?"
          : "Does it shake more when cold or after it warms up?",
        options: isEs
          ? ["Más frío", "Más caliente", "Igual siempre", "No sé"]
          : ["More when cold", "More when warm", "Same all the time", "Not sure"],
      });
    }
  }

  return block({
    isEs,
    summary: isEs
      ? "Necesito un detalle final para separar las causas probables."
      : "I need one final detail to separate the likely causes.",
    question: isEs
      ? "¿Qué cambia más cuando aparece el problema?"
      : "What changes the most when the problem appears?",
    options: isEs
      ? ["Ruido", "Olor", "Vibración", "Pérdida de potencia"]
      : ["Noise", "Smell", "Vibration", "Power loss"],
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
