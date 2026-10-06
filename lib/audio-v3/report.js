import {text} from './contract.js';

const choices = [
  'no_fault_supported',
  'verification_needed',
  'insufficient_evidence',
];

function omitSpeedStatements(value) {
  // Preserve decimal timestamps such as 0.7 seconds.
  const sentences =
    text(value, 500).match(
      /.+?(?:[!?]+|(?<!\d)\.+|\.(?!\d)|$)/g
    ) || [];

  const speed =
    /\b(?:rpms?|engine[ -]speed|shaft[ -]speed|engine[ -]orders?|order[ -]tracking|revoluciones|velocidad (?:del motor|del eje)|[oó]rdenes del motor)\b/i;

  const kept = sentences.filter(
    sentence => !speed.test(sentence)
  );

  return {
    value: kept.join(' ').replace(/\s+/g, ' ').trim(),
    omitted: kept.length !== sentences.length,
  };
}

export function normalizeReport(raw, input) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    !choices.includes(raw.assessment) ||
    typeof raw.soundObservation !== 'string' ||
    !raw.soundObservation.trim() ||
    raw.soundObservation.length > 500 ||
    !Array.isArray(raw.supportingEvidenceIds) ||
    raw.supportingEvidenceIds.length > 16 ||
    raw.supportingEvidenceIds.some(
      id => typeof id !== 'string' || !input.ids.has(id)
    )
  ) {
    throw new Error('Invalid report contract');
  }

  // Supplemental checks, not complete semantic validation.
  const unsafe =
    /(?:\b(?:healthy|fault[- ]free|safe to drive|confirmed (?:fault|failure|knock)|measured rpm|order tracking)\b|motor sano|sin aver[ií]as|seguro conducir|fallo confirmado)/i;

  if (
    unsafe.test(raw.soundObservation) ||
    unsafe.test(String(raw.audibleConcern || ''))
  ) {
    throw new Error('Unsupported report claim');
  }

  const observation = omitSpeedStatements(
    raw.soundObservation
  );

  const audibleConcern = omitSpeedStatements(
    raw.audibleConcern || ''
  );

  const omittedSpeed =
    observation.omitted || audibleConcern.omitted;

  let assessment = raw.assessment;

  // Missing local detections do not veto an audible concern.
  if (
    assessment === 'verification_needed' &&
    !audibleConcern.value
  ) {
    assessment = 'insufficient_evidence';
  }

  if (!observation.value) {
    assessment = 'insufficient_evidence';
  }

  const checkedText = (value, max) => {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > 2000
    ) {
      throw new Error('Invalid reasoning field');
    }

    if (unsafe.test(value)) {
      throw new Error('Unsupported report claim');
    }

    const clean = value.replace(/\s+/g, ' ').trim();

    if (clean.length <= max) {
      return clean;
    }

    // Normalize a verbose response instead of rejecting it
    // solely for exceeding the requested character limit.
    const prefix = clean.slice(0, max - 1);
    const space = prefix.lastIndexOf(' ');

    return (
      space > max / 2
        ? prefix.slice(0, space)
        : prefix
    ) + '…';
  };

  if (
    raw.hypotheses !== undefined &&
    (
      !Array.isArray(raw.hypotheses) ||
      raw.hypotheses.length > 2
    )
  ) {
    throw new Error('Invalid hypotheses');
  }

  const hypotheses = (raw.hypotheses || []).map(h => {
    if (
      !h ||
      typeof h !== 'object' ||
      !Array.isArray(h.supportingEvidenceIds) ||
      h.supportingEvidenceIds.length > 8 ||
      h.supportingEvidenceIds.some(
        id => typeof id !== 'string' || !input.ids.has(id)
      )
    ) {
      throw new Error('Invalid hypothesis evidence');
    }

    return {
      title: checkedText(h.title, 50),
      reason: checkedText(h.reason, 95),
      verification: checkedText(h.verification, 145),
      supportingEvidenceIds: [
        ...new Set(h.supportingEvidenceIds),
      ],
    };
  });

  if (
    assessment !== 'verification_needed' &&
    hypotheses.length
  ) {
    throw new Error('Hypotheses conflict with assessment');
  }

  const modelMeaning =
    raw.interpretation === undefined ||
    raw.interpretation === ''
      ? ''
      : checkedText(raw.interpretation, 100);

  const modelStep =
    raw.nextStep === undefined ||
    raw.nextStep === ''
      ? ''
      : checkedText(raw.nextStep, 160);

  const es = input.language === 'es';

  const tr = (english, spanish) =>
    es ? spanish : english;

  const title = {
    no_fault_supported: tr(
      'No fault hypothesis supported',
      'No hay una hipótesis de avería respaldada'
    ),
    verification_needed: tr(
      'A sound needs verification',
      'Un sonido necesita verificación'
    ),
    insufficient_evidence: tr(
      'Sound review has limits',
      'La revisión del sonido tiene límites'
    ),
  }[assessment];

  const soundObservation =
    observation.value || tr(
      'The AI description could not be retained without unsupported engine-speed statements.',
      'No se pudo conservar la descripción de la IA sin afirmaciones no respaldadas sobre la velocidad del motor.'
    );

  const defaultInterpretation = {
    no_fault_supported: tr(
      'This review does not support a specific fault hypothesis. That does not confirm the vehicle is healthy.',
      'Esta revisión no respalda una hipótesis específica de avería. Esto no confirma que el vehículo esté en buen estado.'
    ),
    verification_needed: tr(
      'The described sound warrants a targeted check; its cause remains unconfirmed.',
      'El sonido descrito requiere una comprobación específica; su causa no está confirmada.'
    ),
    insufficient_evidence: tr(
      'This recording does not characterize the relevant sound clearly enough to identify a cause.',
      'Esta grabación no permite caracterizar el sonido relevante con suficiente claridad para identificar una causa.'
    ),
  }[assessment];

  // Show hypothesis reasons once, without another cause summary.
  const interpretation = hypotheses.length
    ? hypotheses.map(
        (h, i) => `${i + 1}. ${h.title}: ${h.reason}`
      ).join('\n\n')
    : modelMeaning || defaultInterpretation;

  const sourceLimit =
    input.context.origin === 'userReportedSpeakerPlayback'
      ? tr(
          'Speaker playback may change the sound; possibilities refer to this recording and require verification on the vehicle.',
          'La reproducción por altavoz puede alterar el sonido; las posibilidades requieren verificación en el vehículo.'
        )
      : input.context.origin !== 'userReportedDirectVehicleRecording'
        ? tr(
            'Recording origin is not confirmed. Confirm whether this was recorded directly from the vehicle.',
            'El origen no está confirmado. Confirma si se grabó directamente del vehículo.'
          )
        : '';

  const defaultStep = tr(
    'Describe when the sound occurs, whether it is new, and any warning lights or other symptoms so the next check can be targeted.',
    'Describe cuándo ocurre, si es nuevo y si hay testigos u otros síntomas para orientar la siguiente comprobación.'
  );

  const contextQuestion =
    modelStep &&
    (
      /[?¿]/.test(modelStep) ||
      /^(?:ask (?:the )?user\s*:|preguntar al usuario\s*:)/i
        .test(modelStep)
    );

  // Keep a context question, then show each verification once.
  const nextStep = hypotheses.length
    ? [
        contextQuestion ? modelStep : '',
        ...hypotheses.map(
          (h, i) => `${i + 1}. ${h.verification}`
        ),
      ].filter(Boolean).join('\n\n')
    : modelStep || defaultStep;

  const supportingEvidenceIds = [
    ...new Set([
      ...raw.supportingEvidenceIds,
      ...hypotheses.flatMap(h => h.supportingEvidenceIds),
    ]),
  ].slice(0, 16);

  const limitations = [
    ...(sourceLimit ? [sourceLimit] : []),
    tr(
      'AI sound descriptions are interpretations; audio alone does not establish a mechanical fault.',
      'Las descripciones de la IA son interpretaciones; el audio por sí solo no establece una avería mecánica.'
    ),
    tr(
      'Digital changes and overlapping measurements are not independent knocks or fault probabilities.',
      'Los cambios digitales y las mediciones superpuestas no son golpes independientes ni probabilidades de avería.'
    ),
    tr(
      'Recording origin and throttle behavior are user reports. No synchronized RPM is available.',
      'El origen de la grabación y el comportamiento del acelerador son informes del usuario. No hay RPM sincronizadas disponibles.'
    ),
    ...(omittedSpeed
      ? [
          tr(
            'Speed-related statements were omitted because synchronized RPM was not supplied.',
            'Se omitieron afirmaciones sobre la velocidad porque no se proporcionaron RPM sincronizadas.'
          ),
        ]
      : []),
  ];

  return {
    contract: 'audio_v3_report_v1',
    assessment,
    title,
    soundObservation: text(soundObservation, 500),
    interpretation,
    nextStep,
    hypotheses,
    audibleConcern: audibleConcern.value,
    supportingEvidenceIds,
    limitations,
  };
}
