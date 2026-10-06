import {text} from './contract.js';
const choices=['no_fault_supported','verification_needed','insufficient_evidence'];
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
 // Supplemental checks, not a claim of perfect semantic validation.
 if(unsupportedClaim(raw.soundObservation) || unsupportedClaim(String(raw.audibleConcern||''))) throw new Error('Unsupported report claim');
 const observation=omitSpeedStatements(raw.soundObservation);
 const audibleConcern=omitSpeedStatements(raw.audibleConcern||'');
 const omittedSpeed=observation.omitted||audibleConcern.omitted;
 let assessment=raw.assessment;
 // Local detection is corroboration, not a veto over an audible concern.
 if(assessment==='verification_needed' && !audibleConcern.value) assessment='insufficient_evidence';
 if(!observation.value) assessment='insufficient_evidence';
 const checkedText=(value,max)=>{
  if(typeof value!=='string' || !value.trim() || value.length>2000) throw new Error('Invalid reasoning field');
  if(unsupportedClaim(value)) throw new Error('Unsupported report claim');
  const clean=value.replace(/\s+/g,' ').trim();
  if(clean.length<=max) return clean;
  // Request a bounded repair rather than cut evidence or uncertainty.
  throw new Error('Invalid reasoning field');
 };
 if(raw.hypotheses!==undefined && (!Array.isArray(raw.hypotheses) || raw.hypotheses.length>2)) throw new Error('Invalid hypotheses');
 const hypotheses=(raw.hypotheses||[]).map(h=>{
  if(!h || typeof h!=='object' || !Array.isArray(h.supportingEvidenceIds) || h.supportingEvidenceIds.length>8 ||
   h.supportingEvidenceIds.some(id=>typeof id!=='string' || !input.ids.has(id))) throw new Error('Invalid hypothesis evidence');
  return {title:checkedText(h.title,50),reason:checkedText(h.reason,140),verification:checkedText(h.verification,145),
   supportingEvidenceIds:[...new Set(h.supportingEvidenceIds)]};
 }).filter(h=>h.title && h.reason && h.verification);
 if(assessment!=='verification_needed' && hypotheses.length) throw new Error('Hypotheses conflict with assessment');
 const modelMeaning=raw.interpretation===undefined || raw.interpretation===''?'':checkedText(raw.interpretation,100);
 const modelStep=raw.nextStep===undefined || raw.nextStep===''?'':checkedText(raw.nextStep,160);
 const es=input.language==='es', tr=(en,spanish)=>es?spanish:en;
 const title={
  no_fault_supported:tr('No fault hypothesis supported','No hay una hipótesis de avería respaldada'),
  verification_needed:tr('A sound needs verification','Un sonido necesita verificación'),
  insufficient_evidence:tr('Sound review has limits','La revisión del sonido tiene límites'),
 }[assessment];
 const description=observation.value||tr('The AI description could not be retained without unsupported engine-speed statements.','No se pudo conservar la descripción de la IA sin afirmaciones no respaldadas sobre la velocidad del motor.');
 // Keep the listening description separate from the concern and hypotheses.
 const soundObservation=description;
 const defaultInterpretation={
  no_fault_supported:tr('This review does not support a specific fault hypothesis. That does not confirm the vehicle is healthy.','Esta revisión no respalda una hipótesis específica de avería. Esto no confirma que el vehículo esté en buen estado.'),
  verification_needed:tr('The described sound warrants a targeted check; its cause remains unconfirmed.','El sonido descrito requiere una comprobación específica; su causa no está confirmada.'),
  insufficient_evidence:tr('This recording does not characterize the relevant sound clearly enough to identify a cause.','Esta grabación no permite caracterizar el sonido relevante con suficiente claridad para identificar una causa.'),
 }[assessment];
 // Existing Flutter clients render prose fields. When hypotheses exist, show
 // their rationale once rather than prepend a second summary of the causes.
 const key=value=>value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const distinctMeaning=modelMeaning && !hypotheses.some(h=>key(modelMeaning)===key(h.title) || key(modelMeaning)===key(h.reason) || key(modelMeaning)===key(`${h.title}: ${h.reason}`));
 const interpretation=[distinctMeaning?modelMeaning:(!hypotheses.length?defaultInterpretation:''),
  ...hypotheses.map((h,i)=>`${i+1}. ${h.title}: ${h.reason}`)].filter(Boolean).join('\n\n');
 const sourceLimit=input.context.origin==='userReportedSpeakerPlayback'
  ?tr('Speaker playback may change the sound; possibilities refer to this recording and require verification on the vehicle.','La reproducción por altavoz puede alterar el sonido; las posibilidades requieren verificación en el vehículo.')
  :input.context.origin!=='userReportedDirectVehicleRecording'
   ?tr('Recording origin is not confirmed. Confirm whether this was recorded directly from the vehicle.','El origen no está confirmado. Confirma si se grabó directamente del vehículo.') : '';
 const defaultStep=tr('Describe when the sound occurs, whether it is new, and any warning lights or other symptoms so the next check can be targeted.','Describe cuándo ocurre, si es nuevo y si hay testigos u otros síntomas para orientar la siguiente comprobación.');
 // Preserve a distinct action or question; remove only exact duplicates.
 const plan=hypotheses.map(h=>h.verification);
 const uniqueStep=modelStep && !plan.some(step=>key(step)===key(modelStep));
 const nextStep=[uniqueStep?modelStep:'',...plan.map((step,i)=>`${i+1}. ${step}`)].filter(Boolean).join('\n\n') || defaultStep;
 if(interpretation.length>500 || nextStep.length>500) throw new Error('Invalid reasoning field');
 return {contract:'audio_v3_report_v1',assessment,title,soundObservation:text(soundObservation,500),interpretation,
  nextStep,hypotheses,audibleConcern:audibleConcern.value,
  supportingEvidenceIds:[...new Set([...raw.supportingEvidenceIds,...hypotheses.flatMap(h=>h.supportingEvidenceIds)])].slice(0,16),
  limitations:[...(sourceLimit?[sourceLimit]:[]),tr('AI sound descriptions are interpretations; audio alone does not establish a mechanical fault.','Las descripciones de la IA son interpretaciones; el audio por sí solo no establece una avería mecánica.'),
   tr('Digital changes and overlapping measurements are not independent knocks or fault probabilities.','Los cambios digitales y las mediciones superpuestas no son golpes independientes ni probabilidades de avería.'),
   tr('Recording origin and throttle behavior are user reports. No synchronized RPM is available.','El origen de la grabación y el comportamiento del acelerador son informes del usuario. No hay RPM sincronizadas disponibles.'),
   ...(omittedSpeed ? [tr('Speed-related statements were omitted because synchronized RPM was not supplied.','Se omitieron afirmaciones sobre la velocidad porque no se proporcionaron RPM sincronizadas.')] : []) ]};
}
