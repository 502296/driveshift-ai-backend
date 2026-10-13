export function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publicKey || !secretKey) throw new Error('ADMIN_NOT_CONFIGURED');
  if (new URL(url).protocol !== 'https:') throw new Error('ADMIN_NOT_CONFIGURED');
  return { url, publicKey, secretKey };
}
export async function request(path, { method = 'GET', body, token, timeout = 5000 } = {}) {
  const c = config();
  const headers = { apikey: token ? c.publicKey : c.secretKey };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; headers.Prefer = 'return=minimal'; }
  const r = await fetch(c.url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  if (!r.ok) { const e = new Error('SUPABASE_REQUEST_FAILED'); e.status = r.status; throw e; }
  return r.status === 204 || headers.Prefer ? null : r.json();
}
export async function authorize(req) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string' || !/^Bearer [^\s]+$/.test(header)) return null;
  let user;
  try { user = await request('/auth/v1/user', { token: header.slice(7) }); }
  catch (e) { if (e.status === 401 || e.status === 403) return null; throw e; }
  if (!user?.id || !/^[0-9a-f-]{36}$/i.test(user.id)) return null;
  const rows = await request(`/rest/v1/driveshift_admin_members?user_id=eq.${user.id}&active=eq.true&select=role&limit=1`);
  const role = rows?.[0]?.role;
  if (!['owner', 'admin', 'viewer'].includes(role)) return null;
  return { id: user.id, email: user.email, role };
}
export function headers(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}
