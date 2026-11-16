import { authorize, request, headers } from '../../lib/admin/supabase.js';
export function summarize(events) {
  const groups = {};
  let errors = 0, totalMs = 0;
  for (const e of events) {
    const key = e.endpoint;
    groups[key] ??= { requests: 0, errors: 0, totalMs: 0 };
    const failed = e.http_status >= 400 || e.outcome === 'error';
    groups[key].requests++; groups[key].errors += Number(failed); groups[key].totalMs += e.duration_ms;
    errors += Number(failed); totalMs += e.duration_ms;
  }
  return { requests: events.length, errors, averageMs: events.length ? Math.round(totalMs/events.length) : 0,
    endpoints: Object.entries(groups).map(([endpoint, g]) => ({ endpoint, requests: g.requests, errors: g.errors, averageMs: Math.round(g.totalMs/g.requests) })) };
}
export function summarizeAppEvents(events) {
  const steps = new Map();
  const countries = new Map();
  for (const event of events) {
    const key = [event.feature, event.stage, event.version].join('/');
    const row = steps.get(key) ?? {
      feature: event.feature, stage: event.stage, version: event.version,
      open: 0, start: 0, complete: 0, failed: 0,
    };
    row[event.event]++;
    steps.set(key, row);
    if (event.feature === 'app' && event.event === 'open' && event.country) {
      countries.set(event.country, (countries.get(event.country) ?? 0) + 1);
    }
  }
  return {
    steps: [...steps.values()].sort((a, b) => b.open - a.open || b.start - a.start),
    countries: Object.fromEntries([...countries].sort((a, b) => b[1] - a[1])),
  };
}

export default async function handler(req, res) {
  headers(res);
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' }); }
  try {
    const member = await authorize(req);
    if (!member) return res.status(403).json({ error: 'ADMIN_ACCESS_REQUIRED' });
    const since = new Date(Date.now() - 24*60*60*1000).toISOString();
    // Fetch one extra row to detect truncation; report exactly the displayed sample.
    const rows = await request(`/rest/v1/driveshift_request_events?created_at=gte.${encodeURIComponent(since)}&select=endpoint,http_status,duration_ms,outcome&order=created_at.desc,id.desc&limit=1001`);
    const enabled = process.env.DRIVESHIFT_APP_ANALYTICS_ENABLED === 'true';
    let appAnalytics = { enabled };
    if (enabled) {
      const appRows = await request(`/rest/v1/driveshift_app_events?created_at=gte.${encodeURIComponent(since)}&select=feature,event,stage,version,country&order=created_at.desc,id.desc&limit=1000`).catch(() => null);
      appAnalytics = appRows === null
        ? { enabled, unavailable: true }
        : { enabled, sampled: appRows.length === 1000, ...summarizeAppEvents(appRows) };
    }
    return res.status(200).json({ member, since, appAnalytics, sampled: rows.length >= 1000, telemetryEnabled: process.env.DRIVESHIFT_TELEMETRY_ENABLED === 'true', ...summarize(rows.slice(0,1000)) });
  } catch { return res.status(503).json({ error: 'ADMIN_UNAVAILABLE' }); }
}
