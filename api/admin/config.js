import { config, headers } from '../../lib/admin/supabase.js';
export default function handler(req, res) {
  headers(res);
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' }); }
  try { const c = config(); return res.status(200).json({ url: c.url, publishableKey: c.publicKey }); }
  catch { return res.status(503).json({ error: 'ADMIN_NOT_CONFIGURED' }); }
}
