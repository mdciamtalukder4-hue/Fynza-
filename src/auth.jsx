import { useState } from 'react';
import { IoArrowBack } from 'react-icons/io5';
import { register, login, loginMfa, cancelMfa } from './store.js';
import { isOnline, getConfig, validateConfig, testConnection, saveConfig, clearConfig, requestPasswordReset, finishRecovery, passwordProblems } from './supabase.js';
import { LogoMark, Wordmark, go, Sheet, toast } from './ui.jsx';

// ---------- connect to the online database (Supabase) ----------
export function ConnectSheet({ onClose }) {
  const cfg = getConfig();
  const [url, setUrl] = useState(cfg?.url || '');
  const [key, setKey] = useState(cfg?.key || '');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setMsg(''); const v = validateConfig(url, key);
    if (v.error) return setMsg(v.error);
    setBusy(true);
    try { await testConnection(v); saveConfig(v.url, v.key); toast('ডাটাবেস কানেক্ট হয়েছে ✓'); setTimeout(() => location.reload(), 600); }
    catch (e) { setMsg(e.message); }
    setBusy(false);
  };
  return (
    <Sheet title="Connect database (Supabase)" onClose={onClose}>
      <p className="muted">Supabase প্রজেক্টের <b>Project URL</b> আর <b>anon public</b> (বা publishable) কী দিন। <b>secret / service_role কী কখনও দেবেন না।</b></p>
      <label htmlFor="cu">Project URL</label>
      <input id="cu" className="input" inputMode="url" autoCapitalize="none" placeholder="https://xxxxxxxx.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} />
      <label htmlFor="ck">anon public key</label>
      <textarea id="ck" className="input" rows={3} autoCapitalize="none" placeholder="eyJ... অথবা sb_publishable_..." value={key} onChange={(e) => setKey(e.target.value)} />
      {msg && <div className="form-error" role="alert">{msg}</div>}
      <button className="btn primary big" disabled={busy || !url || !key} onClick={save}>{busy ? 'Testing…' : 'Test & save'}</button>
      {cfg && !cfg.fromFile && <button className="btn ghost danger" onClick={() => { clearConfig(); toast('ডাটাবেস সংযোগ সরানো হয়েছে।'); setTimeout(() => location.reload(), 500); }}>Disconnect</button>}
    </Sheet>
  );
}

function Skyline() {
  return (
    <svg className="skyline" viewBox="0 0 400 140" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <g fill="#2A3FBF" opacity=".55">
        <rect x="10" y="60" width="26" height="80" /><rect x="40" y="40" width="22" height="100" /><rect x="66" y="70" width="30" height="70" />
        <rect x="300" y="50" width="24" height="90" /><rect x="328" y="30" width="26" height="110" /><rect x="358" y="64" width="32" height="76" />
      </g>
      <g fill="#14248F" opacity=".9">
        <circle cx="150" cy="72" r="11" /><path d="M132 140v-34a18 18 0 0136 0v34z" />
        <circle cx="200" cy="66" r="12" /><path d="M180 140v-38a20 20 0 0140 0v38z" />
        <circle cx="252" cy="74" r="11" /><path d="M234 140v-32a18 18 0 0136 0v32z" />
      </g>
    </svg>
  );
}

export function Welcome() {
  const [conn, setConn] = useState(false);
  return (
    <div className="welcome">
      <div className="welcome-top">
        <LogoMark size={96} flat />
        <Wordmark color="#fff" size={52} />
        <p>Connect. Share. Belong.</p>
      </div>
      <Skyline />
      <div className="welcome-card">
        <button className="btn primary big" onClick={() => go('#/register')}>Get Started</button>
        <button className="btn link" onClick={() => go('#/login')}>Log In</button>
        <button className="link-btn center" onClick={() => setConn(true)}>{isOnline() ? '● Online mode (Supabase) — change' : '○ Local mode (only this phone) — Connect database'}</button>
      </div>
      {conn && <ConnectSheet onClose={() => setConn(false)} />}
    </div>
  );
}

function AuthFrame({ title, sub, children }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <button className="icon-btn back" aria-label="Back" onClick={() => go('#/')}><IoArrowBack size={22} /></button>
        <div className="auth-brand"><LogoMark size={44} /><Wordmark size={30} /></div>
        <h1>{title}</h1>
        <p className="muted">{sub}</p>
        {children}
      </div>
    </div>
  );
}

export function Login() {
  const [f, setF] = useState({ id: '', pw: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [mfa, setMfa] = useState(false);
  const [code, setCode] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    const r = mfa ? await loginMfa(code) : await login(f.id, f.pw); setBusy(false);
    if (r && r.mfa) setMfa(true); else if (r) setErr(r); else go('#/feed');
  };
  if (mfa) return (
    <AuthFrame title="দুই-ধাপের যাচাই" sub="আপনার Authenticator অ্যাপের ৬ সংখ্যার কোড দিন।">
      <form onSubmit={submit} className="form">
        <label htmlFor="mfc">কোড</label>
        <input id="mfc" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn primary big" disabled={busy || code.length !== 6}>{busy ? 'Please wait…' : 'Verify'}</button>
        <button type="button" className="btn link" onClick={() => { cancelMfa(); setMfa(false); setCode(''); }}>বাতিল</button>
      </form>
    </AuthFrame>
  );
  return (
    <AuthFrame title="Welcome back" sub="Log in to your FYNZA account.">
      <form onSubmit={submit} className="form">
        <label htmlFor="lid">{isOnline() ? 'Email' : 'Email or username'}</label>
        <input id="lid" autoComplete="username" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} required />
        <label htmlFor="lpw">Password</label>
        <input id="lpw" type="password" autoComplete="current-password" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} required />
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn primary big" disabled={busy}>{busy ? 'Please wait…' : 'Log in'}</button>
      </form>
      {isOnline() && <p className="center"><a href="#/forgot">পাসওয়ার্ড ভুলে গেছেন?</a></p>}
      <p className="center">New to FYNZA? <a href="#/register">Create account</a></p>
    </AuthFrame>
  );
}

export function Forgot() {
  const [email, setEmail] = useState(''); const [done, setDone] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await requestPasswordReset(email); setDone(true); } catch (x) { setErr(x.status === 429 ? 'অনেকবার চেষ্টা হয়েছে, কিছুক্ষণ পর আবার করুন।' : x.message); } setBusy(false); };
  return (
    <AuthFrame title="পাসওয়ার্ড রিসেট" sub="আপনার ইমেইল দিন। অ্যাকাউন্ট থাকলে রিসেট লিংক পাঠানো হবে।">
      {done ? <div className="form-ok" role="status">যদি এই ইমেইলে অ্যাকাউন্ট থাকে, একটি রিসেট লিংক পাঠানো হয়েছে। ইমেইল দেখুন। <a href="#/login">Log in</a></div> : (
        <form onSubmit={submit} className="form">
          <label htmlFor="fe">Email</label>
          <input id="fe" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {err && <div className="form-error" role="alert">{err}</div>}
          <button className="btn primary big" disabled={busy}>{busy ? 'Please wait…' : 'রিসেট লিংক পাঠান'}</button>
        </form>)}
    </AuthFrame>
  );
}

export function ResetPassword() {
  const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const bad = passwordProblems(pw);
  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await finishRecovery(pw); toast('পাসওয়ার্ড বদলানো হয়েছে। নতুন পাসওয়ার্ড দিয়ে লগইন করুন।'); go('#/login'); } catch (x) { setErr(x.message); } setBusy(false); };
  return (
    <AuthFrame title="নতুন পাসওয়ার্ড" sub="একটি শক্তিশালী নতুন পাসওয়ার্ড দিন।">
      <form onSubmit={submit} className="form">
        <label htmlFor="np">New password</label>
        <input id="np" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        {pw && bad.length > 0 && <small className="muted">লাগবে: {bad.join(', ')}</small>}
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn primary big" disabled={busy || bad.length > 0}>{busy ? 'Please wait…' : 'পাসওয়ার্ড বদলান'}</button>
      </form>
    </AuthFrame>
  );
}

export function Register() {
  const [f, setF] = useState({ name: '', username: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await register(f); setBusy(false);
    if (r?.info) setInfo(r.info); else if (r) setErr(r); else go('#/feed');
  };
  return (
    <AuthFrame title="Create your account" sub="Join people who connect, share and belong.">
      <form onSubmit={submit} className="form">
        <label htmlFor="rn">Full name</label>
        <input id="rn" autoComplete="name" value={f.name} onChange={up('name')} required />
        <label htmlFor="ru">Username</label>
        <input id="ru" autoComplete="username" placeholder="yourname" value={f.username} onChange={up('username')} required />
        <label htmlFor="re">Email</label>
        <input id="re" type="email" autoComplete="email" value={f.email} onChange={up('email')} required />
        <label htmlFor="rp">Password</label>
        <input id="rp" type="password" autoComplete="new-password" placeholder={isOnline() ? "10+ chars, A-Z, a-z, 0-9" : "At least 8 characters"} value={f.password} onChange={up('password')} required />
        {err && <div className="form-error" role="alert">{err}</div>}
        {info && <div className="form-ok" role="status">{info} <a href="#/login">Log in</a></div>}
        <button className="btn primary big" disabled={busy}>{busy ? 'Please wait…' : 'Sign up'}</button>
      </form>
      <p className="center">Already a member? <a href="#/login">Log in</a></p>
    </AuthFrame>
  );
}
