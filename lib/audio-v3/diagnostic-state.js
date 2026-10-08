// A small interview ledger. Facts remain user reports, never sound measurements.
const targets=new Set(['occurrence','start_phase','recurrence','temperature','trigger','associated_symptoms','location','other']);
export function questionTarget(question={}) {
 const q=String(question.question||'');
 if(/\bcranking\b|before.*(?:fires|starts)|after.*fires|girando.*(?:arranque|motor)|antes.*encienda/i.test(q)) return 'start_phase';
 if(/(?:continue|stop|fade|persist).*(?:running|starts|startup)|only.*(?:startup|starting)|when.*(?:hear|notice).*sound|(?:contin[uú]a|desaparece|se detiene).*(?:marcha|arrancar)/i.test(q)) return 'occurrence';
 return targets.has(question.target)?question.target:'other';
}
export function interviewLedger(input) {
 const answered=new Set((input.answers||[]).map(row=>questionTarget({question:row.question,target:row.target})));
 if((input.context?.engineState && input.context.engineState!=='unknown') || ['changes_with_rpm','idle_only'].includes(input.context?.rpmBehavior)) answered.add('occurrence');
 const description=input.context?.description||'';
 if(!/not sure|unknown|no estoy seguro|no s[eé]/i.test(description)) {
  if(/\b(?:during cranking|after (?:the )?engine fires)\b/i.test(description)) answered.add('start_phase');
  if(/\b(?:cold|warm|temperature)\b|fr[ií]o|caliente|temperatura/i.test(description)) answered.add('temperature');
 }
 return {knownOrAlreadyAsked:[...answered].filter(x=>x!=='other'),
  originalContext:input.context,
  answers:(input.answers||[]).map(row=>({...row,provenance:'user_report',uncertain:/^(?:not sure|unsure|no estoy seguro|no s[eé])$/i.test(row.answer)})),
  remainingQuestions:Math.max(0,3-(input.answers?.length||0))};
}
export function assertNextQuestion(question,input) {
 const target=questionTarget(question);
 if(target!=='other' && interviewLedger(input).knownOrAlreadyAsked.includes(target)) {
  const error=new Error('Redundant follow-up question');error.field=`question.target:${target}`;throw error;
 }
 return target;
}

// Targeted completion gate for two startup mechanisms that share the same timing.
// Ask the model to generate the missing discriminator; never inject a diagnosis.
export function assertCompletionSupported(raw,input) {
 if(raw.decision!=='complete' || !input.interviewRequired || input.answers.length>=3) return;
 const ledger=interviewLedger(input);
 if(ledger.knownOrAlreadyAsked.includes('start_phase')) return;
 const context=input.context?.description||'';
 if(/\b(?:during cranking|after (?:the )?engine fires)\b/i.test(context) && !/not sure|unknown/i.test(context)) return;
 const starting=input.context?.engineState==='starting' || input.answers.some(row=>/\b(?:only.*startup|during startup|only.*starting)\b/i.test(row.answer));
 if(!starting) return;
 const titles=(raw.report?.hypotheses||[]).map(h=>String(h?.title||''));
 const hasStarter=titles.some(t=>/starter|flywheel|motor de arranque/i.test(t));
 const hasAccessory=titles.some(t=>/accessory|serpentine|pulley|tensioner|accesorios|polea|tensor/i.test(t));
 if(hasStarter && hasAccessory) {
  const error=new Error('Missing diagnostic discriminator');error.field='question.target:start_phase';throw error;
 }
}
