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
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url)) return { error: 'URL ঠিক নয়। এমন হতে হবে: https://xxxxxxxx.supabase.co' };
  if (/^sb_secret_/.test(key) || jwtRole(key) === 'service_role') return { error: 'এটি SECRET (service_role) কী — এটি এখানে কখনও দেবেন না! শুধু "anon public" বা "publishable" কী দিন।' };
  if (key.length < 20) return { error: 'কী ঠিক নয়। "anon public" বা "publishable" কী কপি করুন।' };
  return { url, key };
}
export function saveConfig(url, key) { localStorage.setItem(CFG_KEY, JSON.stringify({ url, key })); }
export function clearConfig() { localStorage.removeItem(CFG_KEY); localStorage.removeItem(SES_KEY); }

// ---------- low-level request ----------
async function call(path, { method = 'GET', body, token, headers = {}, cfg = getConfig() } = {}) {
  if (!cfg) throw new Error('ডাটাবেস কানেক্ট করা নেই।');
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
    if (e.name === 'AbortError') throw new Error('ইন্টারনেট ধীর বা সার্ভার সাড়া দিচ্ছে না। আবার চেষ্টা করুন।');
    if (e instanceof TypeError) throw new Error('সার্ভারে পৌঁছানো যাচ্ছে না। ইন্টারনেট ও URL চেক করুন।');
    throw e;
  } finally { clearTimeout(timer); }
}

function friendly(d, status) {
  const code = d?.error_code || d?.code || '';
  const msg = String(d?.msg || d?.message || d?.error_description || d?.error || '');
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'ইমেইল বা পাসওয়ার্ড ভুল।';
  if (code === 'user_already_exists' || /already registered|already been registered/i.test(msg)) return 'এই ইমেইল দিয়ে আগেই অ্যাকাউন্ট আছে।';
  if (code === 'email_not_confirmed' || /not confirmed/i.test(msg)) return 'আগে ইমেইল ভেরিফাই করুন (ইনবক্স/স্প্যাম দেখুন)।';
  if (code === 'weak_password' || /password should be/i.test(msg)) return 'পাসওয়ার্ড দুর্বল। কমপক্ষে ৮ অক্ষর দিন।';
  if (/account suspended/i.test(msg)) return 'আপনার অ্যাকাউন্ট সাসপেন্ড করা হয়েছে।';
  if (/too many requests/i.test(msg)) return 'অনেক বেশি অনুরোধ হয়েছে — কিছুক্ষণ পর আবার চেষ্টা করুন।';
  if (/admin needs 2fa/i.test(msg)) return 'অ্যাডমিন কাজের জন্য আগে 2FA (Settings → Security) চালু করে আবার লগইন করুন।';
  if (/admin only/i.test(msg)) return 'শুধু অ্যাডমিন এটি করতে পারেন।';
  if (/invalid totp|invalid.*code|mfa.*(verif|challenge)/i.test(msg) || code === 'mfa_verification_failed') return '২FA কোড ভুল বা মেয়াদ শেষ। আবার চেষ্টা করুন।';
  if (/reauth|nonce/i.test(msg)) return 'নিরাপত্তার জন্য লগ আউট করে আবার লগইন করে তারপর পাসওয়ার্ড বদলান।';
  if (code === 'same_password' || /different from the old/i.test(msg)) return 'নতুন পাসওয়ার্ড আগেরটির মতো হতে পারবে না।';
  if (/document missing|selfie missing/i.test(msg)) return 'ডকুমেন্ট বা সেলফি আপলোড হয়নি।';
  if (/already pending|already used/i.test(msg)) return 'এই আবেদন বা পেমেন্ট আগেই ব্যবহার হয়েছে বা অপেক্ষমাণ আছে।';
  if (/already verified/i.test(msg)) return 'এটি আগেই ভেরিফায়েড।';
  if (/payment not found/i.test(msg)) return 'পেমেন্ট পাওয়া যায়নি বা সম্পন্ন হয়নি।';
  if (/confirm the payment/i.test(msg)) return 'আগে পেমেন্ট নিশ্চিত করুন।';
  if (/own application/i.test(msg)) return 'নিজের আবেদন নিজে অনুমোদন করা যায় না। "Special grant" ব্যবহার করুন (কারণসহ)।';
  if (/reason/i.test(msg) && /required|write/i.test(msg)) return 'কারণ লিখুন (কমপক্ষে ১০ অক্ষর, বাতিলের ক্ষেত্রে যেকোনো কারণ)।';
  if (/case not pending/i.test(msg)) return 'এই কেসের সিদ্ধান্ত আগেই নেওয়া হয়েছে।';
  if (code === 'over_email_send_rate_limit' || status === 429) return 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।';
  if (code === 'email_address_invalid' || /invalid.*email/i.test(msg)) return 'ইমেইল ঠিক নয়।';
  if (status === 401 || /invalid api key|jwt/i.test(msg)) return 'কী (API key) ঠিক নয় বা মেয়াদ শেষ।';
  if (status === 404 && /rpc/i.test(d?.hint || '') ) return 'ডাটাবেস স্কিমা এখনও চালানো হয়নি (schema.sql)।';
  return msg || 'অজানা সমস্যা (' + status + ')';
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
export async function cloudSignUp({ email, password, name, username }) {
  const r = await call('/auth/v1/signup', { method: 'POST', body: { email, password, data: { name, username } } });
  if (r?.access_token) return { session: putSession(r), needsConfirm: false };
  return { session: null, needsConfirm: true };
}
export async function cloudSignIn(email, password) {
  const lockMsg = (sec) => 'অনেকবার ভুল চেষ্টা হয়েছে। নিরাপত্তার জন্য ' + Math.max(1, Math.ceil(sec / 60)) + ' মিনিট পর আবার চেষ্টা করুন।';
  const anon = (fn, body) => call('/rest/v1/rpc/' + fn, { method: 'POST', body }).catch(() => 0);
  const left = Number(await anon('login_status', { p_email: email })) || 0;
  if (left > 0) throw new Error(lockMsg(left));
  let r;
  try { r = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }); }
  catch (e) {
    if (e.raw && (e.raw.error_code === 'invalid_credentials' || /invalid login/i.test(String(e.raw.msg || e.raw.message || '')))) {
      const l = Number(await anon('login_failed', { p_email: email })) || 0;
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
  if (r !== true) throw new Error('ডাটাবেস সাড়া দিয়েছে কিন্তু স্কিমা ঠিক নেই।');
  return true;
}
export async function fetchMyProfile() {
  const s = await validSession(); if (!s) return null;
  const rows = await call('/rest/v1/profiles?select=*&id=eq.' + s.user.id, { token: s.access_token });
  return rows?.[0] || null;
}
export async function patchMyProfile(patch) {
  const s = await validSession(); if (!s) throw new Error('লগইন নেই।');
  const rows = await call('/rest/v1/profiles?id=eq.' + s.user.id, { method: 'PATCH', token: s.access_token, headers: { Prefer: 'return=representation' }, body: patch });
  if (!rows?.length) throw new Error('প্রোফাইল সেভ হয়নি।');
  return rows[0];
}

// ---------- generic REST + Storage helpers (used by cloud.js) ----------
export async function rest(path, opts = {}) {
  const s = await validSession();
  if (!s) throw new Error('লগইন নেই। আবার লগইন করুন।');
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
  if (!s) throw new Error('লগইন নেই। আবার লগইন করুন।');
  // check the REAL file content (not just the name/type the phone reports)
  let ctype = (blob.type || 'application/octet-stream').split(';')[0];
  if (/^(image|video)\//.test(ctype) || ctype === 'application/pdf') {
    const real = await sniff(blob);
    if (!real) throw new Error('ফাইলটি সঠিক ছবি/ভিডিও/PDF নয় বা নষ্ট — আপলোড করা হয়নি।');
    if (/^image\//.test(ctype) && !/^image\//.test(real)) throw new Error('ফাইলের ভেতরের ধরন ও এক্সটেনশন মিলছে না — আপলোড বন্ধ।');
    if (ctype === 'application/pdf' && real !== ctype) throw new Error('ফাইলের ভেতরের ধরন ও এক্সটেনশন মিলছে না — আপলোড বন্ধ।');
    if (/^video\//.test(ctype) && !/^video\//.test(real)) throw new Error('ফাইলের ভেতরের ধরন ও এক্সটেনশন মিলছে না — আপলোড বন্ধ।');
    ctype = real === 'video/quicktime' && ctype === 'video/mp4' ? 'video/mp4' : real;
  }
  let res;
  try {
    res = await fetch(`${cfg.url}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST', body: blob,
      headers: { apikey: cfg.key, Authorization: 'Bearer ' + s.access_token, 'Content-Type': ctype, 'x-upsert': 'false' },
    });
  } catch (e) { throw new Error('আপলোড হয়নি — ইন্টারনেট চেক করুন।'); }
  if (!res.ok) {
    let d = null; try { d = await res.json(); } catch (e) { /* ignore */ }
    if (res.status === 413) throw new Error('ফাইল বেশি বড় (বিনামূল্যের প্ল্যানে সর্বোচ্চ ৫০MB)।');
    throw new Error(friendly(d, res.status) || 'আপলোড হয়নি।');
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
export function passwordProblems(pw) {
  const p = [];
  if (pw.length < 10) p.push('কমপক্ষে ১০ অক্ষর');
  if (!/[a-z]/.test(pw)) p.push('একটি ছোট হাতের অক্ষর (a-z)');
  if (!/[A-Z]/.test(pw)) p.push('একটি বড় হাতের অক্ষর (A-Z)');
  if (!/[0-9]/.test(pw)) p.push('একটি সংখ্যা');
  if (/^(password|12345678|qwerty|fynza|letmein|iloveyou|admin)/i.test(pw)) p.push('খুব পরিচিত পাসওয়ার্ড চলবে না');
  return p;
}
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
  const bad = passwordProblems(newPassword); if (bad.length) throw new Error('পাসওয়ার্ডে লাগবে: ' + bad.join(', '));
  const s = await validSession(); if (!s) throw new Error('লগইন নেই।');
  await call('/auth/v1/user', { method: 'PUT', token: s.access_token, body: { password: newPassword } });
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
  const s = await validSession(); if (!s) throw new Error('লগইন নেই।');
  for (const f of await mfaFactors()) if (f.status !== 'verified') { try { await call('/auth/v1/factors/' + f.id, { method: 'DELETE', token: s.access_token }); } catch (e) { /* ignore */ } }
  return call('/auth/v1/factors', { method: 'POST', token: s.access_token, body: { factor_type: 'totp', friendly_name: 'FYNZA ' + Date.now(), issuer: 'FYNZA' } });
}
export async function mfaFinishEnroll(factorId, code) {
  const s = await validSession(); if (!s) throw new Error('লগইন নেই।');
  const ch = await call('/auth/v1/factors/' + factorId + '/challenge', { method: 'POST', token: s.access_token, body: {} });
  const r = await call('/auth/v1/factors/' + factorId + '/verify', { method: 'POST', token: s.access_token, body: { challenge_id: ch.id, code: String(code).trim() } });
  putSession(r); logEvent('mfa_enabled');
}
export async function mfaDisable(factorId) {
  const s = await validSession(); if (!s) throw new Error('লগইন নেই।');
  await call('/auth/v1/factors/' + factorId, { method: 'DELETE', token: s.access_token });
  logEvent('mfa_disabled');
}
export async function callFunction(name, body) {
  const s = await validSession(); const cfg = getConfig(); if (!s) throw new Error('লগইন নেই।');
  const res = await fetch(cfg.url + '/functions/v1/' + name, { method: 'POST', headers: { apikey: cfg.key, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  let d = null; try { d = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok) throw new Error(d?.error || (res.status === 404 ? 'পেমেন্ট সার্ভিস এখনও চালু করা হয়নি।' : 'অনুরোধ ব্যর্থ (' + res.status + ')'));
  return d;
}
