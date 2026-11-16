import { createHash } from 'node:crypto';
import { headers, request } from '../lib/admin/supabase.js';

const table = '/rest/v1/driveshift_app_events';
const features = new Set(['app', 'ask', 'obd', 'visual', 'maintenance', 'garage', 'reports', 'roadside']);
const events = new Set(['open', 'start', 'complete', 'failed']);
const stages = {
  obd: new Set(['connect', 'scan', 'report']),
  ask: new Set(['report']),
  visual: new Set(['report']),
};

export function parseEvent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      typeof body.installation !== 'string' || !/^[0-9a-f]{32}$/.test(body.installation)) return null;
  const installation = createHash('sha256').update(body.installation).digest('hex');
  if (body.action === 'delete') return { installation, remove: true };
  const { feature, event, language, version, stage = 'general' } = body;
  if (body.consent !== true || !features.has(feature) || !events.has(event) ||
      !['en', 'es'].includes(language) || typeof version !== 'string' ||
      !/^[0-9.]{1,24}(?:\+[0-9]{1,12})?$/.test(version) ||
      (stage !== 'general' && !stages[feature]?.has(stage))) return null;
  return { installation, feature, event, language, version, stage };
}

export default async function handler(req, res) {
  headers(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  const event = parseEvent(req.body);
  if (!event) return res.status(400).end();
  if (!event.remove && process.env.DRIVESHIFT_APP_ANALYTICS_ENABLED !== 'true') {
    return res.status(503).end();
  }
  try {
    if (event.remove) {
      await request(`${table}?installation=eq.${event.installation}`, { method: 'DELETE' });
    } else {
      const country = req.headers['x-vercel-ip-country'];
      const region = req.headers['x-vercel-ip-country-region'];
      await request(table, { method: 'POST', body: {
        ...event,
        country: typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? country : null,
        region: typeof region === 'string' && /^[A-Z0-9]{1,6}$/.test(region) ? region : null,
      }});
    }
    return res.status(204).end();
  } catch {
    return res.status(503).end();
  }
}
