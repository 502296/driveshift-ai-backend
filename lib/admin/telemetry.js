import { waitUntil } from '@vercel/functions';
import { request } from './supabase.js';
// Aggregate operational data only. No request body, report, image, IP or user identifier.
export function withTelemetry(handler, endpoint) {
  return async function (req, res) {
    const flag = process.env.DRIVESHIFT_TELEMETRY_ENABLED;
    res.setHeader?.('X-DriveShift-Telemetry', flag?.trim().toLowerCase() === 'true' ? 'enabled' : flag ? 'disabled' : 'unset');
    res.setHeader?.('X-DriveShift-Telemetry-Version', 'diag-1');
    if (req.method !== 'POST') return handler(req, res);
    if (process.env.DRIVESHIFT_TELEMETRY_ENABLED?.trim().toLowerCase() !== 'true') {
      console.warn('DriveShift telemetry disabled', { endpoint, flagPresent: Boolean(process.env.DRIVESHIFT_TELEMETRY_ENABLED) });
      return handler(req, res);
    }
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
        outcome: status >= 400 ? 'error' : outcomes.has(payload?.status) ? payload.status : 'response',
      }}).catch((e) => { console.warn('DriveShift telemetry write failed', { endpoint, status: e.status || null, configurationError: e.message === 'ADMIN_NOT_CONFIGURED' }); });
      waitUntil(pending);
    }
    res.json = function (payload) {
      record(res.statusCode || 200, payload);
      return original.call(this, payload);
    };
    try {
      const result = await handler(req, res);
      if (!recorded) record(res.statusCode || 200, result);
      return result;
    }
    catch (e) { record(500, { status: 'error' }); throw e; }
    finally { res.json = original; if (pending) await pending; }
  };
}
