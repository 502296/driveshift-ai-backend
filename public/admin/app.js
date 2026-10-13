const $ = id => document.getElementById(id);
let settings, session;
const message = text => { $('message').textContent = text; };
async function auth(path, body, token) {
  const headers = { apikey: settings.publishableKey, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(settings.url + '/auth/v1/' + path, {method:'POST',headers,body:body ? JSON.stringify(body) : undefined,signal:AbortSignal.timeout(10000)});
  if (!r.ok) throw new Error('Sign-in failed. Check your account details and try again.');
  return r.status === 204 ? null : r.json();
}
function keep(data) { session = {...data, expiresAt: Date.now() + data.expires_in*1000}; }
function reset() { session = null; $('dashboard').hidden=true; $('logout').hidden=true; $('login').hidden=false; $('endpoints').replaceChildren(); $('password').value=''; }
async function overview() {
  if (!session) return;
  $('refresh').disabled = true;
  try {
    if (Date.now() >= session.expiresAt - 60000) keep(await auth('token?grant_type=refresh_token',{refresh_token:session.refresh_token}));
    const r = await fetch('/api/admin/overview', {headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store',signal:AbortSignal.timeout(12000)});
    if (r.status===403) { reset(); throw new Error('This account does not have active administrator access.'); }
    if (!r.ok) throw new Error('Overview unavailable. Check the database setup and Vercel configuration.');
    const data = await r.json();
    $('login').hidden=true; $('dashboard').hidden=false; $('logout').hidden=false;
    $('identity').textContent=`${data.member.email} · ${data.member.role}`;
    $('window').textContent=data.sampled ? 'Showing 1,000 recorded requests from the last 24 hours; additional requests may be omitted.' : 'Recorded requests in the last 24 hours.';
    $('requests').textContent=data.requests;
    $('errors').textContent=data.errors;
    $('latency').textContent=data.requests ? (data.averageMs/1000).toFixed(1)+' s' : '—';
    $('endpoints').replaceChildren();
    for (const row of data.endpoints) {
      const tr = document.createElement('tr');
      for (const value of [row.endpoint,row.requests,row.errors,(row.averageMs/1000).toFixed(1)+' s']) { const td=document.createElement('td');td.textContent=value;tr.append(td); }
      $('endpoints').append(tr);
    }
    message(data.telemetryEnabled ? (data.requests ? '' : 'No requests have been recorded yet. Run a diagnosis to verify telemetry.') : 'Telemetry is disabled. Set DRIVESHIFT_TELEMETRY_ENABLED=true on Vercel and redeploy to start recording.');
  } catch(e) { message(e.message); }
  finally { $('refresh').disabled=false; }
}
$('login-form').addEventListener('submit', async e => {
  e.preventDefault(); $('signin').disabled=true; message('Signing in…');
  try { keep(await auth('token?grant_type=password',{email:$('email').value.trim(),password:$('password').value})); $('password').value=''; await overview(); }
  catch(e) {reset(); message(e.message);}
  finally {$('signin').disabled=false;}
});
$('refresh').addEventListener('click',overview);
$('logout').addEventListener('click',async()=>{const token=session?.access_token;reset();message('Signed out.');try{if(token) await auth('logout',null,token);}catch{message('Local session cleared. Server sign-out unavailable.');}});
(async()=>{ $('signin').disabled=true;try{const r=await fetch('/api/admin/config',{cache:'no-store'});if(!r.ok)throw new Error();settings=await r.json();$('signin').disabled=false;}catch{message('Administrator setup is incomplete. Configure Supabase variables on Vercel and redeploy.');}})();
// Tokens stay in memory and are cleared on page reload; no localStorage persistence.
