export const LEARNING_TOPICS = Object.freeze([
  'belt_noise', 'obd_codes', 'live_data', 'starting_battery', 'engine_misfire',
  'cooling', 'brakes', 'steering_suspension', 'transmission', 'maintenance', 'none',
  'tire_wheel', 'abs', 'brake_fluid',
]);

// Keep driving suitability separate from causal confidence. This does not diagnose.
export function applySafetyBoundary(report, lang = 'en') {
  if (report.safety?.triageStatus !== 'not_assessed' || report.safety.alertLevel === 'CRITICAL') return report;
  if (report.safety.alertLevel === 'NORMAL') report.safety.alertLevel = 'CAUTION';
  if (report.assessment === 'NORMAL_MONITORING') report.assessment = 'INSPECTION_RECOMMENDED';
  report.safety.drivingRecommendation = lang === 'es'
    ? 'No se ha determinado si es adecuado conducir con la información disponible. Verifica los síntomas y avisos indicados antes de decidir.'
    : 'Driving suitability has not been established from the available information. Check the relevant symptoms and warnings before deciding.';
  return report;
}

// Opt-in contract: the currently published iOS client still expects v1 categories.
// Never send missing/unknown enum values to that client just to hide a label.
export function presentReport(report, experienceVersion, language = 'en') {
  const result = structuredClone(report);
  if (experienceVersion !== 2) {
    delete result.missingInformation;
    delete result.learningTopic;
    delete result.safety?.triageStatus;
    return result;
  }
  result.schemaVersion = '2.0';
  delete result.confidence;
  for (const item of result.evidence ?? []) delete item.strength;
  for (const item of result.hypotheses ?? []) delete item.likelihood;
  const topic = result.safety?.alertLevel === 'CRITICAL' || result.assessment === 'STOP_DRIVING'
    ? 'none' : LEARNING_TOPICS.includes(result.learningTopic) ? result.learningTopic : 'none';
  result.learning = {
    topic,
    // Lazy retrieval: YouTube availability never holds up a diagnostic report.
    endpoint: topic === 'none' ? null : `/api/learning?topic=${encodeURIComponent(topic)}&language=${language === 'es' ? 'es' : 'en'}`,
    purpose: 'education_only',
  };
  delete result.learningTopic;
  return result;
}
