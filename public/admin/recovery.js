'use strict';
const el = id => document.getElementById(id);
const show = text => { el('message').textContent = text; };
const fragment = new URLSearchParams(location.hash.slice(1));
let recoveryToken = fragment.get('type') === 'recovery' ? fragment.get('access_token') : null;
const linkError = fragment.get('error');
// Remove credentials from the address bar before any network request.
history.replaceState(null, '', location.pathname);
let config;
async function request(path, method, body, token) {
  const headers = { apikey: config.publishableKey, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(config.url + '/auth/v1/' + path, {
    method, headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('Request failed. Check your setup or request a fresh recovery link.');
}
el('request-form').addEventListener('submit', async event => {
  event.preventDefault(); el('send').disabled = true;
  try {
    await request('recover?redirect_to=' + encodeURIComponent(location.origin + location.pathname), 'POST', {email: el('email').value.trim()});
    show('If this account exists, a recovery email will arrive. Open the newest link.');
  } catch (error) { show(error.message); }
  finally { el('send').disabled = false; }
});
el('password-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!recoveryToken) return;
  if (el('password').value !== el('confirm').value) { show('Passwords do not match.'); return; }
  el('save').disabled = true;
  try {
    await request('user', 'PUT', {password: el('password').value}, recoveryToken);
    recoveryToken = null; el('password-form').reset(); el('password-form').hidden = true;
    show('Password updated. Return to sign in with your new password.');
  } catch (error) { show(error.message); el('save').disabled = false; }
});
(async () => {
  try {
    const response = await fetch('/api/admin/config', {cache: 'no-store'});
    if (!response.ok) throw new Error('Administrator configuration is unavailable.');
    config = await response.json();
    if (recoveryToken) {
      el('request-form').hidden = true; el('password-form').hidden = false; el('save').disabled = false;
      show('Choose a new password of at least 12 characters.');
    } else {
      el('send').disabled = false;
      show(linkError ? 'This recovery link is invalid or expired. Request a new link.' : 'Enter your administrator email to receive a recovery link.');
    }
  } catch (error) { recoveryToken = null; show(error.message); }
})();
