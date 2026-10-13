import { request } from './supabase.js';
// Aggregate operational data only. No request body, report, image, IP or user identifier.
export function withTelemetry(handler, endpoint) {
  return async function (req, res) {
    if (req.method !== 'POST' || process.env.DRIVESHIFT_TELEMETRY_ENABLED !== 'true') return handler(req, res);
    const start = Date.now();
    const original = res.json;
    let pending;
    let recorded = false;
    function record(status, payload) {
      if (recorded) return;
      recorded = true;
      const outcomes = new Set(['analysis', 'follow_up', 'explanation', 'error']);
      pending = request('/rest/v1/driveshift_request_events', { method: 'POST', timeout: 1200, body: {
        endpoint, http_status: status,
        duration_ms: Math.max(0, Date.now() - start),
        outcome: outcomes.has(payload?.status) ? payload.status : 'response',
      }}).catch(() => { console.warn('DriveShift telemetry write failed'); });
    }
    res.json = function (payload) {
      record(res.statusCode || 200, payload);
      return original.call(this, payload);
    };
    try { return await handler(req, res); }
    catch (e) { record(500, { status: 'error' }); throw e; }
    finally { res.json = original; if (pending) await pending; }
  };
}
