import {text} from './contract.js';

const choices=['no_fault_supported','verification_needed','insufficient_evidence'];
const starterCause=/\b(?:starter|flywheel|ring gear|starter motor|starter drive)\b/i;
const misfireCause=/\bmisfire\b/i;
const recordingArtifactCause=/\b(?:microphone|mic|phone) handling\b|\bhandling (?:noise|artifact)\b|\b(?:recording|playback) artifact\b/i;

// Conservatively omit entire sentences containing speed/order terminology.
// Do not rewrite a model claim into a different acoustic observation.
function omitSpeedStatements(value) {
 // A decimal point is not a sentence boundary (for example, 0.7 seconds).
 const sentences=text(value,500).match(/.+?(?:[!?]+|(?<!\d)\.+|\.(?!\d)|$)/g)||[];
 const speed=/\b(?:rpms?|engine[ -]speed|shaft[ -]speed|engine[ -]orders?|order[ -]tracking|revoluciones|velocidad (?:del motor|del eje)|[oó]rdenes del motor)\b/i;
 const speedLimitation=/(?:\b(?:no|without)\s+(?:(?:synchronized|measured)\s+)?(?:rpm|engine speed|shaft speed|order tracking)|\b(?:rpm|engine speed|shaft speed)\s+(?:(?:is|was|measurement is)\s+)?(?:unavailable|not (?:available|measured|supplied))|\bsin\s+(?:rpm|revoluciones)|\b(?:rpm|revoluciones)\s+no\s+(?:disponibles?|medidas?))\b/i;
 const userReport=/\b(?:user reports?|user-reported|reported by (?:the )?user|seg[uú]n el usuario|el usuario indica)\b/i;
 const kept=sentences.filter(sentence=>!speed.test(sentence) || speedLimitation.test(sentence) || userReport.test(sentence));
 return {value:kept.join(' ').replace(/\s+/g,' ').trim(),omitted:kept.length!==sentences.length};
}

function unsupportedClaim(value) {
 const claims=/(?:\b(?:healthy|fault[- ]free|safe to drive|confirmed (?:fault|failure|knock)|measured rpm|order tracking)\b|motor sano|sin aver[ií]as|seguro conducir|fallo confirmado)/gi;
 const negative=/(?:not|never|cannot|can't|no|no evidence (?:of|that)|does not (?:prove|confirm|establish)|no confirma|no demuestra|no se confirma)\s+(?:(?:the|a|an|engine|vehicle|motor|vehículo|is|be|being|it|has|there|está|es|el)\s+){0,6}$/i;
 for(const match of value.matchAll(claims)) {
  const prefix=value.slice(0,match.index).split(/[.!?;,]|\bbut\b|\bhowever\b/i).at(-1).trim()+' ';
  if(!negative.test(prefix)) return true;
 }
 return false;
}

export function normalizeReport(raw,input) {
 if(!raw || typeof raw!=='object' || Array.isArray(raw) || !choices.includes(raw.assessment) ||
  typeof raw.soundObservation!=='string' || !raw.soundObservation.trim() || raw.soundObservation.length>500 ||
  !Array.isArray(raw.supportingEvidenceIds) || raw.supportingEvidenceIds.length>16 ||
  raw.supportingEvidenceIds.some(id=>typeof id!=='string' || !input.ids.has(id))) throw new Error('Invalid report contract');

 const sessionStatus=raw.sessionStatus==='follow_up'?'follow_up':'complete';
 let followUpQuestion=null;
 if(sessionStatus==='follow_up') {
  const q=raw.followUpQuestion;
  if(!q || typeof q!=='object' || typeof q.question!=='string' || !q.question.trim() || q.question.length>180 ||
   !Array.isArray(q.options) || q.options.length<2 || q.options.length>4 ||
   q.options.some(x=>typeof x!=='string' || !x.trim() || x.length>48) ||
   !q.options.some(x=>/not sure|unsure|no s[eé]|no estoy seguro/i.test(x))) throw new Error('Invalid follow-up question');
  followUpQuestion={question:text(q.question,180),options:q.options.map(x=>text(x,48))};
 }

 // Supplemental checks, not a claim of perfect semantic validation.
 if(unsupportedClaim(raw.soundObservation) || unsupportedClaim(String(raw.audibleConcern||''))) throw new Error('Unsupported report claim');
 const observation=omitSpeedStatements(raw.soundObservation);
 const audibleConcern=omitSpeedStatements(raw.audibleConcern||'');
 const omittedSpeed=observation.omitted||audibleConcern.omitted;
 let assessment=raw.assessment;

 // Local detection is corroboration, not a veto over an audible concern.
 if(assessment==='verification_needed' && !audibleConcern.value) assessment='insufficient_evidence';
 if(!observation.value) assessment='insufficient_evidence';

 const checkedText=(value,max,field='reasoning')=>{
  const invalid=()=>{const error=new Error('Invalid reasoning field');error.field=field;throw error;};
  if(typeof value!=='string' || !value.trim() || value.length>2000) invalid();
  if(unsupportedClaim(value)) throw new Error('Unsupported report claim');
  const clean=value.replace(/\s+/g,' ').trim();
  if(clean.length<=max) return clean;
  // Request a bounded repair rather than cut evidence or uncertainty.
  invalid();
 };

 if(raw.hypotheses!==undefined && (!Array.isArray(raw.hypotheses) || raw.hypotheses.length>2)) throw new Error('Invalid hypotheses');

 // A hypothesis with an unknown evidence ID is omitted. This keeps the
 // report usable without accepting a citation that the request did not supply.
 let invalidHypothesisEvidence=false;
 const proposed=(raw.hypotheses||[]).map(h=>{
  if(!h || typeof h!=='object' || !Array.isArray(h.supportingEvidenceIds) || h.supportingEvidenceIds.length>8)
   throw new Error('Invalid hypotheses');

  if(h.supportingEvidenceIds.some(id=>typeof id!=='string' || !input.ids.has(id))) {
   invalidHypothesisEvidence=true;
   return null;
  }

  return {
   title:checkedText(h.title,50,'hypothesis.title'),
   reason:checkedText(h.reason,140,'hypothesis.reason'),
   verification:checkedText(h.verification,145,'hypothesis.verification'),
   supportingEvidenceIds:[...new Set(h.supportingEvidenceIds)],
  };
 }).filter(h=>h && h.title && h.reason && h.verification);

 const contextText=`${input.context.description||''} ${input.context.rpmBehavior||''}`;
 const reportedCranking=input.context.engineState==='starting' ||
  /\b(?:crank(?:ing)?|engine start(?:ing)?|start-up|starting (?:the )?engine)\b|arranc(?:ando|ar|anque)/i.test(contextText);
 const reportedRunning=input.context.engineState==='running' ||
  ['changes_with_rpm','idle_only'].includes(input.context.rpmBehavior);
 const reportedMisfire=/\b(?:misfire|engine stumbles?|rough idle|uneven firing|cylinder misfire|engine cuts? out)\b/i.test(contextText);
 const reportedHandling=/\b(?:phone|microphone|mic) (?:was )?(?:moved|handled|bumped|touched|dropped)\b|\b(?:moved|handled|bumped|dropped) (?:the )?(?:phone|microphone|mic)\b/i.test(contextText);
 const regularPattern=/\b(?:steady|regular|even|consistent)\b/i.test(observation.value) &&
  !/\b(?:irregular|uneven|stumble|misfire|hesitat|cuts? out)\b/i.test(observation.value);

 // Context-dependent parts are not emitted from a transient alone. This is a
 // targeted plausibility gate; it leaves other audible, supported hypotheses intact.
 const filteredHypotheses=proposed.filter(h=>{
  const claim=`${h.title} ${h.reason}`;
  if(starterCause.test(claim) && !reportedCranking) return false;
  if(misfireCause.test(claim) && regularPattern && !reportedMisfire) return false;
  if(recordingArtifactCause.test(claim) && !reportedHandling) return false;
  return true;
 });

 const rejectedContextualCause=filteredHypotheses.length!==proposed.length;
 let hypotheses=filteredHypotheses;

 if(rejectedContextualCause && hypotheses.length===0 && assessment==='verification_needed')
  assessment='no_fault_supported';

 if(invalidHypothesisEvidence && hypotheses.length===0 && assessment==='verification_needed')
  assessment='insufficient_evidence';

 if(assessment!=='verification_needed' && hypotheses.length)
  throw new Error('Hypotheses conflict with assessment');

 // If a hypothesis was removed for an invalid citation, do not reuse the
 // model's prose that may still describe that unsupported hypothesis.
 let modelMeaning=invalidHypothesisEvidence
  ? ''
  : (raw.interpretation===undefined || raw.interpretation===''?'':checkedText(raw.interpretation,100,'interpretation'));
 let modelStep=invalidHypothesisEvidence
  ? ''
  : (raw.nextStep===undefined || raw.nextStep===''?'':checkedText(raw.nextStep,160,'nextStep'));

 if(rejectedContextualCause) {
  const rejected=/\b(?:starter|flywheel|ring gear|misfire)\b|\b(?:microphone|mic|phone) handling\b|\bhandling (?:noise|artifact)\b|\b(?:recording|playback) artifact\b/i;
  if(rejected.test(modelMeaning)) modelMeaning='';
  if(rejected.test(modelStep)) modelStep='';
 }

 const es=input.language==='es', tr=(en,spanish)=>es?spanish:en;
 const title={
  no_fault_supported:tr('No fault hypothesis supported','No hay una hipótesis de avería respaldada'),
  verification_needed:tr('A sound needs verification','Un sonido necesita verificación'),
  insufficient_evidence:tr('Sound review has limits','La revisión del sonido tiene límites'),
 }[assessment];

 const description=observation.value||tr(
  'The AI description could not be retained without unsupported engine-speed statements.',
  'No se pudo conservar la descripción de la IA sin afirmaciones no respaldadas sobre la velocidad del motor.'
 );

 // Keep the listening description separate from the concern and hypotheses.
 const soundObservation=description;
 const defaultInterpretation=({
  no_fault_supported:tr(
   'This review does not support a specific fault hypothesis. That does not confirm the vehicle is healthy.',
   'Esta revisión no respalda una hipótesis específica de avería. Esto no confirma que el vehículo esté en buen estado.'
  ),
  verification_needed:tr(
   'The described sound warrants a targeted check; its cause remains unconfirmed.',
   'El sonido descrito requiere una comprobación específica; su causa no está confirmada.'
  ),
  insufficient_evidence:tr(
   'This recording does not characterize the relevant sound clearly enough to identify a cause.',
   'Esta grabación no permite caracterizar el sonido con suficiente claridad para identificar una causa.'
  ),
 }[assessment]);

 // Existing Flutter clients render prose fields. When hypotheses exist, show
 // their rationale once rather than prepend a second summary of the causes.
 const key=value=>value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const distinctMeaning=modelMeaning &&
  !hypotheses.some(h=>key(modelMeaning)===key(h.title) ||
   key(modelMeaning)===key(h.reason) ||
   key(modelMeaning)===key(`${h.title}: ${h.reason}`));
 const interpretation=distinctMeaning?modelMeaning:defaultInterpretation;

 const defaultStep=rejectedContextualCause
  ? tr(
   'When does the sound occur: during engine starting, at idle, or only while driving? This separates a start-up event from a running-engine sound.',
   '¿Cuándo ocurre el sonido: al arrancar, en ralentí o solo al conducir? Esto distingue un evento de arranque de un sonido con el motor en marcha.'
  )
  : tr(
   'Describe when the sound occurs, whether it is new, and any warning lights or other symptoms so the next check can be targeted.',
   'Describe cuándo ocurre, si es nuevo y si hay testigos u otros síntomas para orientar la siguiente comprobación.'
  );

 // Preserve a distinct action or question; remove only exact duplicates.
 const plan=hypotheses.map(h=>h.verification);
 const nextStep=modelStep || plan[0] || defaultStep;
 if(interpretation.length>500 || nextStep.length>500) throw new Error('Invalid reasoning field');

 return {
  contract:'audio_v3_report_v1',
  sessionStatus,
  followUpQuestion,
  assessment,
  title,
  soundObservation:text(soundObservation,500),
  interpretation,
  nextStep,
  hypotheses,
  audibleConcern:audibleConcern.value,
  supportingEvidenceIds:[...new Set([
   ...raw.supportingEvidenceIds,
   ...hypotheses.flatMap(h=>h.supportingEvidenceIds),
  ])].slice(0,16),
  limitations:[
   tr(
    'These are diagnostic possibilities, not confirmed failures. Verify the leading possibility before repair.',
    'Son posibilidades de diagnóstico, no fallas confirmadas. Verifica la posibilidad principal antes de reparar.'
   ),
   ...(omittedSpeed ? [
    tr(
     'Speed-related statements were omitted because synchronized RPM was not supplied.',
     'Se omitieron afirmaciones sobre la velocidad porque no se proporcionaron RPM sincronizadas.'
    )
   ] : []),
  ],
 };
}
