// The initial listening pass starts the interview; it is not the final report.
export function startInterview(raw, input) {
 if (!input.interviewRequired || raw?.sessionStatus === 'follow_up') return raw;
 const es=input.language==='es', tr=(en,spanish)=>es?spanish:en;
 const timingKnown=input.context.engineState!=='unknown' || input.context.rpmBehavior!=='unknown';
 // Used only if the provider ignores the required interview instruction.
 const question=timingKnown ? {
  target:'associated_symptoms',
  question:tr('Besides this sound, what have you noticed when it happens?', 'Además de este sonido, ¿qué has notado cuando ocurre?'),
  options:es?['Solo el sonido','Vibración o funcionamiento irregular','Un testigo en el tablero','No estoy seguro']:['Only the sound','Vibration or rough running','A dashboard warning light','Not sure'],
 } : {
  target:'occurrence',
  question:tr('When have you noticed this sound?', '¿Cuándo has notado este sonido?'),
  options:es?['Al arrancar','Con el motor en marcha','Al conducir','No estoy seguro']:['During startup','While the engine is running','While driving','Not sure'],
 };
 return {...raw,sessionStatus:'follow_up',followUpQuestion:question};
}

export function recordingContext(value={}) {
 const choice=(key,allowed)=>allowed.includes(value?.[key])?value[key]:'unknown';
 return {contextClass:'user_reported',origin:'unknown',
  engineState:choice('engineState',['unknown','starting','running']),
  rpmBehavior:choice('rpmBehavior',['unknown','changes_with_rpm','no_clear_relation','idle_only']),
  description:typeof value?.description==='string'?value.description.trim().slice(0,500):'',
  supportsMeasuredRpmCorrelation:false};
}
