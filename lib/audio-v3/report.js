import {text} from './contract.js';
const choices=['no_fault_supported','verification_needed','insufficient_evidence'];
// Conservatively omit entire sentences containing speed/order terminology.
// Do not rewrite a model claim into a different acoustic observation.
function omitSpeedStatements(value) {
 const sentences=text(value,500).match(/[^.!?]+(?:[.!?]+|$)/g)||[];
 const speed=/\b(?:rpms?|engine[ -]speed|shaft[ -]speed|engine[ -]orders?|order[ -]tracking|revoluciones|velocidad (?:del motor|del eje)|[oó]rdenes del motor)\b/i;
 const kept=sentences.filter(sentence=>!speed.test(sentence));
 return {value:kept.join(' ').replace(/\s+/g,' ').trim(),omitted:kept.length!==sentences.length};
}
export function normalizeReport(raw,input) {
 if(!raw || typeof raw!=='object' || Array.isArray(raw) || !choices.includes(raw.assessment) ||
  typeof raw.soundObservation!=='string' || !raw.soundObservation.trim() || raw.soundObservation.length>500 ||
  !Array.isArray(raw.supportingEvidenceIds) || raw.supportingEvidenceIds.length>16 ||
  raw.supportingEvidenceIds.some(id=>typeof id!=='string' || !input.ids.has(id))) throw new Error('Invalid report contract');
 // Supplemental checks, not a claim of perfect semantic validation.
 const unsafe=/(?:\b(?:healthy|fault[- ]free|safe to drive|confirmed (?:fault|failure|knock)|measured rpm|order tracking)\b|motor sano|sin aver[ií]as|seguro conducir|fallo confirmado)/i;
 if(unsafe.test(raw.soundObservation) || unsafe.test(String(raw.audibleConcern||''))) throw new Error('Unsupported report claim');
 const observation=omitSpeedStatements(raw.soundObservation);
 const audibleConcern=omitSpeedStatements(raw.audibleConcern||'');
 const omittedSpeed=observation.omitted||audibleConcern.omitted;
 let assessment=raw.assessment;
 // Local detection is corroboration, not a veto over an audible concern.
 if(assessment==='verification_needed' && audibleConcern.value.length<10) assessment='insufficient_evidence';
 if(!observation.value) assessment='insufficient_evidence';
 const checkedText=(value,max)=>{
  if(typeof value!=='string' || !value.trim() || value.length>max) throw new Error('Invalid reasoning field');
  if(unsafe.test(value)) throw new Error('Unsupported report claim');
  return text(value,max);
 };
 if(raw.hypotheses!==undefined && (!Array.isArray(raw.hypotheses) || raw.hypotheses.length>2)) throw new Error('Invalid hypotheses');
 const hypotheses=(raw.hypotheses||[]).map(h=>{
  if(!h || typeof h!=='object' || !Array.isArray(h.supportingEvidenceIds) || h.supportingEvidenceIds.length>8 ||
   h.supportingEvidenceIds.some(id=>typeof id!=='string' || !input.ids.has(id))) throw new Error('Invalid hypothesis evidence');
  return {title:checkedText(h.title,50),reason:checkedText(h.reason,95),verification:checkedText(h.verification,145),
   supportingEvidenceIds:[...new Set(h.supportingEvidenceIds)]};
 }).filter(h=>h.title && h.reason && h.verification);
 if(assessment!=='verification_needed' && hypotheses.length) throw new Error('Hypotheses conflict with assessment');
 const modelMeaning=raw.interpretation===undefined?'':checkedText(raw.interpretation,100);
 const modelStep=raw.nextStep===undefined?'':checkedText(raw.nextStep,160);
 const es=input.language==='es', tr=(en,spanish)=>es?spanish:en;
 const title={
  no_fault_supported:tr('No fault hypothesis supported','No hay una hipótesis de avería respaldada'),
  verification_needed:tr('A sound needs verification','Un sonido necesita verificación'),
  insufficient_evidence:tr('Sound review has limits','La revisión del sonido tiene límites'),
 }[assessment];
 const concern=assessment==='verification_needed' ? text(audibleConcern.value,120) : '';
 const description=observation.value||tr('The AI description could not be retained without unsupported engine-speed statements.','No se pudo conservar la descripción de la IA sin afirmaciones no respaldadas sobre la velocidad del motor.');
 const soundObservation=concern ? `${text(description,350)} ${tr('Possible sound concern:','Posible sonido preocupante:')} ${concern}` : description;
 const defaultInterpretation={
  no_fault_supported:tr('This review does not support a specific fault hypothesis. That does not confirm the vehicle is healthy.','Esta revisión no respalda una hipótesis específica de avería. Esto no confirma que el vehículo esté en buen estado.'),
  verification_needed:tr('The AI reported a possible sound concern alongside local acoustic changes. Physical inspection is needed to interpret it; no failed part is confirmed.','La IA señaló un posible sonido preocupante junto con cambios acústicos locales. Se necesita una inspección física para interpretarlo; ninguna pieza está confirmada como averiada.'),
  insufficient_evidence:tr('The recording or its source does not support a responsible assessment of vehicle condition. The sound description is only an AI interpretation.','La grabación o su origen no permiten evaluar responsablemente el estado del vehículo. La descripción del sonido es solo una interpretación de la IA.'),
 }[assessment];
 const sourceSummary=input.context.origin==='userReportedSpeakerPlayback'
  ?tr('Speaker playback may alter the features described below.','El altavoz puede alterar los rasgos descritos abajo.') : '';
 const interpretation=text([...(sourceSummary?[sourceSummary]:[]),modelMeaning||defaultInterpretation,
  ...hypotheses.map((h,i)=>`${i+1}. ${h.title}: ${h.reason}`)].join('\n\n'),500);
 const sourceLimit=input.context.origin==='userReportedSpeakerPlayback'
  ?tr('Speaker playback may change the sound; possibilities refer to this recording and require verification on the vehicle.','La reproducción por altavoz puede alterar el sonido; las posibilidades requieren verificación en el vehículo.')
  :input.context.origin!=='userReportedDirectVehicleRecording'
   ?tr('Recording origin is not confirmed. Confirm whether this was recorded directly from the vehicle.','El origen no está confirmado. Confirma si se grabó directamente del vehículo.') : '';
 const defaultStep=tr('Describe when the sound occurs, whether it is new, and any warning lights or other symptoms so the next check can be targeted.','Describe cuándo ocurre, si es nuevo y si hay testigos u otros síntomas para orientar la siguiente comprobación.');
 const nextStep=text([modelStep||defaultStep,...hypotheses.map((h,i)=>`${i+1}. ${h.verification}`)].join('\n\n'),500);
 return {contract:'audio_v3_report_v1',assessment,title,soundObservation:text(soundObservation,500),interpretation,
  nextStep,hypotheses,
  supportingEvidenceIds:[...new Set(raw.supportingEvidenceIds)],
  limitations:[...(sourceLimit?[sourceLimit]:[]),tr('AI sound descriptions are interpretations; audio alone does not establish a mechanical fault.','Las descripciones de la IA son interpretaciones; el audio por sí solo no establece una avería mecánica.'),
   tr('Digital changes and overlapping measurements are not independent knocks or fault probabilities.','Los cambios digitales y las mediciones superpuestas no son golpes independientes ni probabilidades de avería.'),
   tr('Recording origin and throttle behavior are user reports. No synchronized RPM is available.','El origen de la grabación y el comportamiento del acelerador son informes del usuario. No hay RPM sincronizadas disponibles.'),
   ...(omittedSpeed ? [tr('Speed-related statements were omitted because synchronized RPM was not supplied.','Se omitieron afirmaciones sobre la velocidad porque no se proporcionaron RPM sincronizadas.')] : []) ]};
}
