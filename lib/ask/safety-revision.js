// A newly reported stop-driving hazard must replace the visible assessment in
// the same response. Do not wait for a second diagnostic model call or retain
// obsolete hypotheses as if they had incorporated the new observation.
export function makeSafetyRevision({ message, observation, vehicle, language }) {
  const es = language === 'es';
  const guidance = message.trim() || (es
    ? 'No conduzcas. Solicita asistencia en carretera o remolque para una inspección profesional.'
    : 'Do not drive. Arrange roadside assistance or towing for professional inspection.');
  return {
    schemaVersion: '2.0', vehicle,
    assessment: 'STOP_DRIVING',
    systemFocus: { id: 'general', label: es ? 'Actualización de seguridad' : 'Safety update',
      schematicKey: 'general_v1', affectedNodes: [] },
    primaryFinding: guidance,
    missingInformation: [],
    evidence: [{ id: 'E01', source: 'user_observation', status: 'OBSERVED',
      observation,
      diagnosticMeaning: es
        ? 'Nueva información del usuario; no es una inspección independiente.'
        : 'New owner-reported information; not an independent inspection.' }],
    hypotheses: [], whyAlternativesRankLower: '', verificationPath: [],
    doNotReplaceYet: [], vehicleSpecificNote: '',
    safety: { triageStatus: 'red_flags_reported', alertLevel: 'CRITICAL',
      drivingRecommendation: guidance,
      limitation: es ? 'El origen y alcance del daño necesitan una inspección profesional.'
        : 'The cause and extent of the reported hazard require professional inspection.',
      stopCondition: es ? 'No reanudes la marcha hasta que se haya atendido el peligro indicado.'
        : 'Do not resume driving until the reported hazard has been addressed.' },
    technicianHandoff: observation,
    finalGuidance: guidance, learningTopic: 'none',
  };
}
