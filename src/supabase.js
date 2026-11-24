// Minimal Supabase client (Auth + REST) using plain fetch — no extra packages needed.
// Only the PUBLIC key (anon / publishable) is ever used here. NEVER put a service_role / secret key in this app.

const CFG_KEY = 'fynza_cfg';
const SES_KEY = 'fynza_session';

// ---------- configuration ----------
export function getConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
    if (c?.url && c?.key) return c;
  } catch (e) { /* ignore */ }
  const w = typeof window !== 'undefined' && window.FYNZA_CONFIG;
  if (w?.supabaseUrl && w?.supabaseKey) return { url: w.supabaseUrl, key: w.supabaseKey, fromFile: true };
  return null;
}
export const isOnline = () => !!getConfig();

function jwtRole(key) {
  try { return JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role; } catch (e) { return null; }
}
export function validateConfig(url, key) {
  url = (url || '').trim().replace(/\/+$/, ''); key = (key || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url)) return { error: 'Invalid URL. It must look like: https://xxxxxxxx.supabase.co' };
  if (/^sb_secret_/.test(key) || jwtRole(key) === 'service_role') return { error: 'This is a SECRET (service_role) key. Never enter it here! Use only the "anon public" or "publishable" key.' };
  if (key.length < 20) return { error: 'Invalid key. Copy the "anon public" or "publishable" key.' };
  return { url, key };
}
export function saveConfig(url, key) { localStorage.setItem(CFG_KEY, JSON.stringify({ url, key })); }
export function clearConfig() { localStorage.removeItem(CFG_KEY); localStorage.removeItem(SES_KEY); }

// ---------- low-level request ----------
async function call(path, { method = 'GET', body, token, headers = {}, cfg = getConfig() } = {}) {
  if (!cfg) throw new Error('Database is not connected.');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(cfg.url + path, {
      method, signal: ctl.signal,
      headers: { apikey: cfg.key, Authorization: 'Bearer ' + (token || cfg.key), 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) { const err = new Error(friendly(data, res.status)); err.status = res.status; err.raw = data; throw err; }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Slow connection or the server is not responding. Please try again.');
    if (e instanceof TypeError) throw new Error('Cannot reach the server. Check your internet and the URL.');
    throw e;
  } finally { clearTimeout(timer); }
}

function friendly(d, status) {
  const code = d?.error_code || d?.code || '';
  const msg = String(d?.msg || d?.message || d?.error_description || d?.error || '');
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'Incorrect email/phone or password.';
  if (code === 'user_already_exists' || /already registered|already been registered/i.test(msg)) return 'An account with this email or phone number already exists.';
  if (code === 'phone_exists' || code === 'email_exists') return 'An account with this email or phone number already exists.';
  if (code === 'phone_not_confirmed') return 'Please verify your phone number with the SMS code first.';
  if (code === 'sms_send_failed' || code === 'phone_provider_disabled' || /unsupported phone provider|sms.*(disabled|not enabled)/i.test(msg)) return 'SMS codes are not available yet: the FYNZA owner must connect an SMS provider (e.g. Twilio) in Supabase. Please use email for now.';
  if (code === 'otp_expired' || /token has expired|otp.*expired/i.test(msg)) return 'That code is wrong or has expired. Request a new one.';
  if (code === 'email_not_confirmed' || /not confirmed/i.test(msg)) return 'Please verify your email first (check inbox/spam).';
  if (code === 'weak_password' || /password should be/i.test(msg)) return 'Password is too weak. Use at least 5 characters (longer is safer).';
  if (/account suspended/i.test(msg)) return 'Your account has been suspended.';
  if (/too many requests/i.test(msg)) return 'Too many requests. Please try again in a while.';
  if (/admin needs 2fa/i.test(msg)) return 'For admin actions, enable 2FA first (Settings → Security) and log in again.';
  if (/admin only/i.test(msg)) return 'Only admins can do this.';
  if (/invalid totp|invalid.*code|mfa.*(verif|challenge)/i.test(msg) || code === 'mfa_verification_failed') return '2FA code is wrong or expired. Please try again.';
  if (/reauth|nonce/i.test(msg)) return 'For security, log out, log in again, then change your password.';
  if (code === 'same_password' || /different from the old/i.test(msg)) return 'The new password cannot be the same as the old one.';
  if (/document missing|selfie missing/i.test(msg)) return 'Document or selfie was not uploaded.';
  if (/already pending|already used/i.test(msg)) return 'This application or payment was already used or is pending.';
  if (/already verified/i.test(msg)) return 'Already verified.';
  if (/payment not found/i.test(msg)) return 'Payment not found or not completed.';
  if (/confirm the payment/i.test(msg)) return 'Please confirm the payment first.';
  if (/own application/i.test(msg)) return 'You cannot approve your own application. Use "Special grant" (with a reason).';
  if (/reason/i.test(msg) && /required|write/i.test(msg)) return 'Enter a reason (at least 10 characters; any reason for cancellations).';
  if (/case not pending/i.test(msg)) return 'A decision on this case was already made.';
  if (code === 'over_email_send_rate_limit' || status === 429) return 'Too many attempts. Please try again in a while.';
  if (code === 'email_address_invalid' || /invalid.*email/i.test(msg)) return 'Invalid email.';
  if (status === 401 || /invalid api key|jwt/i.test(msg)) return 'Invalid or expired key (API key).';
  if (status === 404 && /rpc/i.test(d?.hint || '') ) return 'Database schema has not been run yet (schema.sql).';
  return msg || 'Unknown error (' + status + ')';
}

// ---------- session ----------
export const getSession = () => { try { return JSON.parse(localStorage.getItem(SES_KEY) || 'null'); } catch (e) { return null; } };
const putSession = (s) => {
  if (!s) return localStorage.removeItem(SES_KEY);
  const ses = { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), user: s.user };
  localStorage.setItem(SES_KEY, JSON.stringify(ses)); return ses;
};

export async function validSession() {
  let s = getSession();
  if (!s) return null;
  if (s.expires_at - 60 > Date.now() / 1000) return s;
  try {
    const r = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } });
    return putSession(r);
  } catch (e) {
    if (e.status === 400 || e.status === 401 || e.status === 403) { putSession(null); return null; } // refresh token no longer valid
    return s; // offline: keep old session for now
  }
}

// ---------- auth ----------
export async function cloudSignUp({ email, phone, password, name, username }) {
  const body = { password: authPw(password), data: { name, username } };
  if (phone) body.phone = phone; else body.email = email;
  const r = await call('/auth/v1/signup', { method: 'POST', body });
  if (r?.access_token) return { session: putSession(r), needsConfirm: false };
  return { session: null, needsConfirm: !phone, needsOtp: !!phone };
}
// SMS code check (sign-up confirmation and phone login/recovery). On success the session is saved.
export async function verifyPhoneOtp(phone, code, type = 'sms') {
  const r = await call('/auth/v1/verify', { method: 'POST', body: { type, phone, token: String(code).trim() } });
  const ses = putSession(r); afterLogin(); return ses;
}
export async function resendPhoneOtp(phone) {
  await call('/auth/v1/resend', { method: 'POST', body: { type: 'sms', phone } });
  return true;
}
export async function requestPhoneReset(phone) {
  try { await call('/auth/v1/otp', { method: 'POST', body: { phone, create_user: false } }); } catch (e) { if (e.status === 429 || e.raw?.error_code === 'sms_send_failed' || e.raw?.error_code === 'phone_provider_disabled') throw e; }
  return true; // same answer whether or not the number has an account
}
export async function cloudSignIn(id, password) {
  const lockMsg = (sec) => 'Too many failed attempts. For security, try again in ' + Math.max(1, Math.ceil(sec / 60)) + ' minutes.';
  const anon = (fn, body) => call('/rest/v1/rpc/' + fn, { method: 'POST', body }).catch(() => 0);
  const phone = looksLikePhone(id) ? normalizePhone(id) : null;
  const key = phone || id;
  const left = Number(await anon('login_status', { p_email: key })) || 0;
  if (left > 0) throw new Error(lockMsg(left));
  let r;
  try { r = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { [phone ? 'phone' : 'email']: key, password: authPw(password) } }); }
  catch (e) {
    if (e.raw && (e.raw.error_code === 'invalid_credentials' || /invalid login/i.test(String(e.raw.msg || e.raw.message || '')))) {
      const l = Number(await anon('login_failed', { p_email: key })) || 0;
      if (l > 0) throw new Error(lockMsg(l));
    }
    throw e;
  }
  const factor = (r.user?.factors || []).find((f) => f.factor_type === 'totp' && f.status === 'verified');
  if (factor) return { mfa: { factorId: factor.id, token: r.access_token } }; // session is NOT saved until the code is correct
  const ses = putSession(r); afterLogin(); return ses;
}
export async function mfaLoginVerify(factorId, token, code) {
  const ch = await call('/auth/v1/factors/' + factorId + '/challenge', { method: 'POST', token, body: {} });
  const r = await call('/auth/v1/factors/' + factorId + '/verify', { method: 'POST', token, body: { challenge_id: ch.id, code: String(code).trim() } });
  const ses = putSession(r); afterLogin(); return ses;
}
export async function cloudSignOut() {
  const s = getSession(); putSession(null);
  if (s) { try { await call('/auth/v1/logout', { method: 'POST', token: s.access_token }); } catch (e) { /* ignore */ } }
}

// ---------- data ----------
export async function usernameAvailable(u) {
  const r = await call('/rest/v1/rpc/username_available', { method: 'POST', body: { u } });
  return r === true;
}
export async function testConnection(cfg) {
  // Works only if schema.sql was run: the function exists and answers true/false.
  const r = await call('/rest/v1/rpc/username_available', { method: 'POST', body: { u: 'connection_test_' + Date.now() }, cfg });
  if (r !== true) throw new Error('Database responded but the schema is not correct.');
  return true;
}
export async function fetchMyProfile() {
  const s = await validSession(); if (!s) return null;
  const rows = await call('/rest/v1/profiles?select=*&id=eq.' + s.user.id, { token: s.access_token });
  return rows?.[0] || null;
}
export async function patchMyProfile(patch) {
  const s = await validSession(); if (!s) throw new Error('Not logged in.');
  const rows = await call('/rest/v1/profiles?id=eq.' + s.user.id, { method: 'PATCH', token: s.access_token, headers: { Prefer: 'return=representation' }, body: patch });
  if (!rows?.length) throw new Error('Profile was not saved.');
  return rows[0];
}

// ---------- generic REST + Storage helpers (used by cloud.js) ----------
export async function rest(path, opts = {}) {
  const s = await validSession();
  if (!s) throw new Error('Not logged in. Please log in again.');
  return call('/rest/v1/' + path, { ...opts, token: s.access_token });
}
export const publicUrl = (bucket, path) => `${getConfig().url}/storage/v1/object/public/${bucket}/${path}`;

async function sniff(blob) {
  const b = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const at = (i, str) => [...str].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && at(1, 'PNG')) return 'image/png';
  if (at(0, 'GIF8')) return 'image/gif';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  if (at(0, '%PDF')) return 'application/pdf';
  if (at(4, 'ftyp')) return /^(qt)/.test(String.fromCharCode(b[8], b[9])) ? 'video/quicktime' : 'video/mp4';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  return null;
}
export async function uploadFile(bucket, path, blob) {
  const s = await validSession(); const cfg = getConfig();
  if (!s) throw new Error('Not logged in. Please log in again.');
  // check the REAL file content (not just the name/type the phone reports)
  let ctype = (blob.type || 'application/octet-stream').split(';')[0];
  if (/^(image|video)\//.test(ctype) || ctype === 'application/pdf') {
    const real = await sniff(blob);
    if (!real) throw new Error('File is not a valid image/video/PDF or is corrupted. Not uploaded.');
    if (/^image\//.test(ctype) && !/^image\//.test(real)) throw new Error('File content type does not match its extension. Upload stopped.');
    if (ctype === 'application/pdf' && real !== ctype) throw new Error('File content type does not match its extension. Upload stopped.');
    if (/^video\//.test(ctype) && !/^video\//.test(real)) throw new Error('File content type does not match its extension. Upload stopped.');
    ctype = real === 'video/quicktime' && ctype === 'video/mp4' ? 'video/mp4' : real;
  }
  let res;
  try {
    res = await fetch(`${cfg.url}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST', body: blob,
      headers: { apikey: cfg.key, Authorization: 'Bearer ' + s.access_token, 'Content-Type': ctype, 'x-upsert': 'false' },
    });
  } catch (e) { throw new Error('Upload failed. Check your internet.'); }
  if (!res.ok) {
    let d = null; try { d = await res.json(); } catch (e) { /* ignore */ }
    if (res.status === 413) throw new Error('File too large (maximum 50MB on the free plan).');
    throw new Error(friendly(d, res.status) || 'Upload failed.');
  }
  return path;
}
export async function removeFiles(bucket, paths) {
  try { await call('/storage/v1/object/' + bucket, { method: 'DELETE', body: { prefixes: paths }, token: (await validSession())?.access_token }); } catch (e) { /* best effort */ }
}
const signCache = new Map(); // "bucket/path" -> {url, exp}
export async function signUrls(bucket, paths) {
  const cfg = getConfig(); const now = Date.now(); const out = {};
  const need = [];
  for (const p of new Set(paths)) { const c = signCache.get(bucket + '/' + p); if (c && c.exp > now + 60000) out[p] = c.url; else need.push(p); }
  if (need.length) {
    const r = await call('/storage/v1/object/sign/' + bucket, { method: 'POST', token: (await validSession())?.access_token, body: { expiresIn: 3600, paths: need } });
    for (const it of r || []) {
      if (it.signedURL && !it.error) {
        const url = cfg.url + '/storage/v1' + (it.signedURL.startsWith('/') ? '' : '/') + it.signedURL;
        signCache.set(bucket + '/' + it.path, { url, exp: now + 3500000 }); out[it.path] = url;
      }
    }
  }
  return out;
}


// ---------- Phase 10: account security ----------
export const MIN_PW = 5;
export function passwordProblems(pw) {
  const p = [];
  if (pw.length < MIN_PW) p.push('at least ' + MIN_PW + ' characters');
  if (/^(password|12345|123456|qwerty|fynza|letmein|iloveyou|admin|00000|11111)$/i.test(pw)) p.push('must not be a very common password');
  return p;
}
// Supabase Auth refuses passwords shorter than 6 characters by default. FYNZA allows 5, so a 5-character
// password is extended with a fixed suffix before it is sent (the user always types what they chose).
// Passwords of 6+ characters are sent unchanged. Longer passwords are always stronger - the app recommends them.
export const authPw = (pw) => (pw.length < 6 ? pw + '~fz' : pw);
export function normalizePhone(v) {
  const x = String(v || '').replace(/[\s\-().]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(x) ? x : null;
}
export const looksLikePhone = (v) => /^\+?[\d\s\-().]{8,}$/.test(String(v || '').trim()) && !/@/.test(v);
const deviceId = () => { try { let d = localStorage.getItem('fynza_device'); if (!d) { d = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); localStorage.setItem('fynza_device', d); } return d; } catch (e) { return 'unknown'; } };
export function deviceLabel() {
  const ua = navigator.userAgent || '';
  const b = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Edg\//.test(ua) ? 'Edge' : /Firefox/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Browser';
  const o = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Device';
  return b + ' · ' + o;
}
function afterLogin() {
  rest('rpc/login_reset', { method: 'POST', body: {} }).catch(() => {});
  logEvent('login');
}
export const logEvent = (kind) => rest('rpc/log_security_event', { method: 'POST', body: { p_kind: kind, p_device: deviceLabel(), p_device_id: deviceId() } }).catch(() => null);

export async function changePassword(newPassword) {
  const bad = passwordProblems(newPassword); if (bad.length) throw new Error('Password needs: ' + bad.join(', '));
  const s = await validSession(); if (!s) throw new Error('Not logged in.');
  await call('/auth/v1/user', { method: 'PUT', token: s.access_token, body: { password: authPw(newPassword) } });
  logEvent('password_changed');
}
export async function requestPasswordReset(email) {
  const redirect = encodeURIComponent(location.origin + location.pathname);
  try { await call('/auth/v1/recover?redirect_to=' + redirect, { method: 'POST', body: { email: String(email).trim() } }); } catch (e) { if (e.status === 429) throw e; }
  return true; // always the same answer: never reveal whether an e-mail has an account
}
// Handles links from e-mails (password reset / e-mail confirm). Returns 'recovery' | 'confirmed' | null
export async function consumeAuthHash() {
  const h = location.hash;
  if (!/access_token=|error_description=/.test(h)) return null;
  const p = new URLSearchParams(h.replace(/^#\/?/, ''));
  history.replaceState(null, '', location.pathname + location.search + '#/');
  const at = p.get('access_token'); if (!at) return null;
  const type = p.get('type');
  try {
    const user = await call('/auth/v1/user', { token: at });
    putSession({ access_token: at, refresh_token: p.get('refresh_token'), expires_in: Number(p.get('expires_in')) || 3600, user });
  } catch (e) { return null; }
  return type === 'recovery' ? 'recovery' : 'confirmed';
}
export async function finishRecovery(newPassword) {
  await changePassword(newPassword);
  await cloudSignOut();
}
export async function logoutAllDevices() {
  const s = await validSession(); if (!s) return;
  await logEvent('logout_all');
  await call('/auth/v1/logout?scope=global', { method: 'POST', token: s.access_token });
  putSession(null);
}
export function sessionAal() {
  try { const s = getSession(); return JSON.parse(atob(s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal || 'aal1'; } catch (e) { return 'aal1'; }
}
// 2FA (TOTP, e.g. Google Authenticator / Authy)
export async function mfaFactors() {
  const s = await validSession(); if (!s) return [];
  const u = await call('/auth/v1/user', { token: s.access_token });
  return u?.factors || [];
}
export async function mfaStartEnroll() {
  const s = await validSession(); if (!s) throw new Error('Not logged in.');
  for (const f of await mfaFactors()) if (f.status !== 'verified') { try { await call('/auth/v1/factors/' + f.id, { method: 'DELETE', token: s.access_token }); } catch (e) { /* ignore */ } }
  return call('/auth/v1/factors', { method: 'POST', token: s.access_token, body: { factor_type: 'totp', friendly_name: 'FYNZA ' + Date.now(), issuer: 'FYNZA' } });
}
export async function mfaFinishEnroll(factorId, code) {
  const s = await validSession(); if (!s) throw new Error('Not logged in.');
  const ch = await call('/auth/v1/factors/' + factorId + '/challenge', { method: 'POST', token: s.access_token, body: {} });
  const r = await call('/auth/v1/factors/' + factorId + '/verify', { method: 'POST', token: s.access_token, body: { challenge_id: ch.id, code: String(code).trim() } });
  putSession(r); logEvent('mfa_enabled');
}
export async function mfaDisable(factorId) {
  const s = await validSession(); if (!s) throw new Error('Not logged in.');
  await call('/auth/v1/factors/' + factorId, { method: 'DELETE', token: s.access_token });
  logEvent('mfa_disabled');
}
export async function callFunction(name, body) {
  const s = await validSession(); const cfg = getConfig(); if (!s) throw new Error('Not logged in.');
  const res = await fetch(cfg.url + '/functions/v1/' + name, { method: 'POST', headers: { apikey: cfg.key, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  let d = null; try { d = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok) throw new Error(d?.error || (res.status === 404 ? 'Payment service is not enabled yet.' : 'Request failed (' + res.status + ')'));
  return d;
}
