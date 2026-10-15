// Keep only inspection context; never forward account fields or arbitrary JSON.
const text = (v, n = 600) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const list = (v, n) => Array.isArray(v) ? v.slice(0, n) : [];
export function followupContext(bundle) {
  const d = bundle?.diagnosis || {};
  const v = bundle?.evidence?.visualEvidence || {};
  return {
    summary: text(d.summary, 1000),
    observations: list(v.observations, 8).map(o => text(o?.description)).filter(Boolean),
    parts: list(v.components, 6).map(c => ({name:text(c?.name,120), confidence:text(c?.confidence,20)})).filter(c => c.name),
    hypotheses: list(d.hypotheses, 3).map(h => ({title:text(h?.title,180), explanation:text(h?.explanation || h?.reasoning,800), confidence:text(h?.confidence,20), limitations:list(h?.limitations,3).map(x=>text(x,300))})),
    verification: list(d.verificationSteps, 4).map(s => text(s?.instruction || s?.description,600)).filter(Boolean),
    limitations: list(d.limitations,4).map(x=>text(x,300)),
    safety: {urgency:text(d.safetyGuidance?.urgency,40), summary:text(d.safetyGuidance?.summary,600)},
  };
}
export function followupHistory(history) {
  return list(Array.isArray(history) ? history.slice(-6) : [], 6)
    .filter(m => m && ['user','assistant'].includes(m.role) && text(m.text,1200))
    .map(m => ({role:m.role, text:text(m.text,1200)}));
}
export function outputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text.trim();
  return (data?.output || []).filter(o => o.type === 'message')
    .flatMap(o => o.content || []).filter(c => c.type === 'output_text')
    .map(c => c.text || '').join('\n').trim();
}
