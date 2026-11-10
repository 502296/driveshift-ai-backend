// V2 spends generation time on diagnostic content, not server-owned identity,
// hidden confidence labels or repeated handoff prose. V1 stays unchanged.
export function compactReportSchema(base) {
  const schema = structuredClone(base);
  const omit = (node, keys) => {
    for (const key of keys) delete node.properties[key];
    node.required = node.required.filter(key => !keys.includes(key));
  };
  omit(schema, ['schemaVersion', 'vehicle', 'confidence',
    'technicianHandoff', 'whyAlternativesRankLower']);
  omit(schema.properties.evidence.items, ['strength']);
  omit(schema.properties.hypotheses.items, ['likelihood']);
  const limits = {
    primaryFinding: 320, finalGuidance: 300, vehicleSpecificNote: 240,
    label: 100, observation: 160, diagnosticMeaning: 160,
    title: 120, whyItFits: 200, confirmationTest: 220,
    action: 240, purpose: 140, requiredTool: 90,
    component: 100, reason: 160, drivingRecommendation: 300,
    limitation: 180, stopCondition: 220,
  };
  function bound(node, key = '') {
    if (node.type === 'string' && !node.enum && limits[key]) node.maxLength = limits[key];
    for (const [name, child] of Object.entries(node.properties ?? {})) bound(child, name);
    if (node.items) bound(node.items);
  }
  bound(schema);
  return schema;
}

export const COMPACT_REPORT_POLICY = `
V2 CONCISE REPORT: retain the diagnostic distinctions, measured evidence and
specific safety action. Write one short sentence per supporting field, no
repeated preamble or repeated disclaimers. State the conclusion directly and
give one discriminating next check. Explain an essential technical term in
plain language. Use a second hypothesis only when materially distinct.
Do not generate server-owned vehicle identity, schema version, confidence,
likelihood, evidence strength, or a duplicate technician handoff.
`;
