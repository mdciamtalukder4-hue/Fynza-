import { useState } from 'react';
import { IoArrowBack, IoEye, IoEyeOff } from 'react-icons/io5';
import { register, login, loginMfa, cancelMfa, confirmPhoneCode, resendPhoneCode } from './store.js';
import { isOnline, getConfig, validateConfig, testConnection, saveConfig, clearConfig, requestPasswordReset, finishRecovery, passwordProblems, requestPhoneReset, verifyPhoneOtp, normalizePhone, looksLikePhone, MIN_PW } from './supabase.js';
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
    try { await testConnection(v); saveConfig(v.url, v.key); toast('Database connected ✓'); setTimeout(() => location.reload(), 600); }
    catch (e) { setMsg(e.message); }
    setBusy(false);
  };
  return (
    <Sheet title="Connect database (Supabase)" onClose={onClose}>
      <p className="muted">Enter your Supabase project <b>Project URL</b> and <b>anon public</b> (or publishable) key. <b>Never enter a secret / service_role key.</b></p>
      <label htmlFor="cu">Project URL</label>
      <input id="cu" className="input" inputMode="url" autoCapitalize="none" placeholder="https://xxxxxxxx.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} />
      <label htmlFor="ck">anon public key</label>
      <textarea id="ck" className="input" rows={3} autoCapitalize="none" placeholder="eyJ... or sb_publishable_..." value={key} onChange={(e) => setKey(e.target.value)} />
      {msg && <div className="form-error" role="alert">{msg}</div>}
      <button className="btn primary big" disabled={busy || !url || !key} onClick={save}>{busy ? 'Testing…' : 'Test & save'}</button>
      {cfg && !cfg.fromFile && <button className="btn ghost danger" onClick={() => { clearConfig(); toast('Database connection removed.'); setTimeout(() => location.reload(), 500); }}>Disconnect</button>}
    </Sheet>
  );
}

function Skyline() {
  const bl = [[8,70,22,90],[34,48,18,112],[56,78,26,82],[88,58,16,102],[300,64,22,96],[326,36,20,124],[350,70,26,90],[374,54,18,106]];
  return (
    <svg className="skyline" viewBox="0 0 400 190" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="skg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6B5BE0" stopOpacity="0" /><stop offset="1" stopColor="#7A63E8" stopOpacity=".55" /></linearGradient>
        <linearGradient id="bld" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4A4FC4" /><stop offset="1" stopColor="#2A2F9E" /></linearGradient>
      </defs>
      <rect width="400" height="190" fill="url(#skg)" />
      <g fill="url(#bld)" opacity=".85">
        {bl.map(([x, y, w, h], i) => <rect key={i} x={x} y={y + 30} width={w} height={h} />)}
        <rect x="190" y="40" width="14" height="150" /><rect x="120" y="86" width="20" height="110" /><rect x="268" y="80" width="22" height="110" />
      </g>
      <g fill="#C9C4FF" opacity=".55">
        {bl.flatMap(([x, y, w], i) => [0, 1, 2].map((k) => <rect key={i + '-' + k} x={x + 4} y={y + 44 + k * 18} width={w - 8} height="3" />))}
      </g>
      <g fill="#0F1A6E">
        <circle cx="146" cy="104" r="10" /><path d="M127 190v-46a19 19 0 0138 0v46z" />
        <circle cx="206" cy="92" r="12" /><path d="M182 190v-54a24 24 0 0148 0v54z" />
        <circle cx="258" cy="106" r="9" /><path d="M241 190v-42a17 17 0 0134 0v42z" />
      </g>
    </svg>
  );
}

export function Welcome() {
  const [conn, setConn] = useState(false);
  return (
    <div className="welcome">
      <div className="welcome-top">
        <LogoMark size={92} flat />
        <Wordmark color="#fff" size={54} />
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

function PwInput({ id, value, onChange, auto = 'current-password', placeholder, strength }) {
  const [show, setShow] = useState(false);
  const lvl = strength ? (value.length >= 12 ? 3 : value.length >= 8 ? 2 : value.length >= 5 ? 1 : 0) : 0;
  return (
    <>
      <div className="pw-wrap">
        <input id={id} type={show ? 'text' : 'password'} autoComplete={auto} placeholder={placeholder} value={value} onChange={onChange} required />
        <button type="button" className="pw-toggle" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>{show ? <IoEyeOff size={20} /> : <IoEye size={20} />}{show ? 'Hide' : 'Show'}</button>
      </div>
      {strength && value && <small className={'pw-meter l' + lvl}>{['Too short', 'OK (5+ characters) — longer is safer', 'Good', 'Strong'][lvl]}</small>}
    </>
  );
}
function Seg({ value, onChange, items }) {
  return <div className="seg" role="tablist">{items.map(([k, l]) => <button type="button" key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
}
function OtpStep({ phone, onDone, onBack, onVerify }) {
  const [code, setCode] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [note, setNote] = useState('');
  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(''); const r = await onVerify(code); setBusy(false); if (r) setErr(r); else onDone(); };
  const resend = async () => { setErr(''); setNote(''); const r = await resendPhoneCode(phone); if (r) setErr(r); else setNote('A new code was sent.'); };
  return (
    <form onSubmit={submit} className="form">
      <label htmlFor="otp">6-digit code sent by SMS to {phone}</label>
      <input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
      {err && <div className="form-error" role="alert">{err}</div>}
      {note && <div className="form-ok" role="status">{note}</div>}
      <button className="btn primary big" disabled={busy || code.length < 4}>{busy ? 'Please wait…' : 'Verify'}</button>
      <button type="button" className="btn link" onClick={resend}>Resend code</button>
      <button type="button" className="btn link" onClick={onBack}>Change number</button>
    </form>
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
    <AuthFrame title="Two-step verification" sub="Enter the 6-digit code from your Authenticator app.">
      <form onSubmit={submit} className="form">
        <label htmlFor="mfc">Code</label>
        <input id="mfc" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn primary big" disabled={busy || code.length !== 6}>{busy ? 'Please wait…' : 'Verify'}</button>
        <button type="button" className="btn link" onClick={() => { cancelMfa(); setMfa(false); setCode(''); }}>Cancel</button>
      </form>
    </AuthFrame>
  );
  return (
    <AuthFrame title="Welcome back" sub="Log in to your FYNZA account.">
      <form onSubmit={submit} className="form">
        <label htmlFor="lid">{isOnline() ? 'Email or phone number' : 'Email, phone or username'}</label>
        <input id="lid" autoComplete="username" placeholder="you@example.com or +14155550123" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} required />
        <label htmlFor="lpw">Password</label>
        <PwInput id="lpw" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} />
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn primary big" disabled={busy}>{busy ? 'Please wait…' : 'Log in'}</button>
      </form>
      {isOnline() && <p className="center"><a href="#/forgot">Forgot your password?</a></p>}
      <p className="center">New to FYNZA? <a href="#/register">Create account</a></p>
    </AuthFrame>
  );
}

export function Forgot() {
  const [mode, setMode] = useState('email');
  const [email, setEmail] = useState(''); const [phone, setPhone] = useState(''); const [code, setCode] = useState(''); const [pw, setPw] = useState('');
  const [step, setStep] = useState(1); const [done, setDone] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const bad = passwordProblems(pw);
  const sendEmail = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await requestPasswordReset(email); setDone(true); } catch (x) { setErr(x.status === 429 ? 'Too many attempts. Try again in a while.' : x.message); } setBusy(false); };
  const sendSms = async (e) => {
    e.preventDefault(); setErr('');
    const ph = normalizePhone(phone); if (!ph) return setErr('Enter your phone number with country code, e.g. +14155550123.');
    setBusy(true); try { await requestPhoneReset(ph); setPhone(ph); setStep(2); } catch (x) { setErr(x.message); } setBusy(false);
  };
  const finishSms = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await verifyPhoneOtp(phone, code); await finishRecovery(pw); toast('Password changed. Log in with your new password.'); go('#/login'); }
    catch (x) { setErr(x.message); }
    setBusy(false);
  };
  return (
    <AuthFrame title="Reset password" sub="Choose how to recover your account.">
      <Seg value={mode} onChange={(m) => { setMode(m); setErr(''); setDone(false); setStep(1); }} items={[['email', 'Email'], ['phone', 'Phone (SMS)']]} />
      {mode === 'email' ? (done ? <div className="form-ok" role="status">If an account exists for this email, a reset link has been sent. Check your email. <a href="#/login">Log in</a></div> : (
        <form onSubmit={sendEmail} className="form">
          <label htmlFor="fe">Email</label>
          <input id="fe" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {err && <div className="form-error" role="alert">{err}</div>}
          <button className="btn primary big" disabled={busy}>{busy ? 'Please wait…' : 'Send reset link'}</button>
        </form>)) : step === 1 ? (
        <form onSubmit={sendSms} className="form">
          <label htmlFor="fp">Phone number (with country code)</label>
          <input id="fp" type="tel" autoComplete="tel" placeholder="+14155550123" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          {err && <div className="form-error" role="alert">{err}</div>}
          <button className="btn primary big" disabled={busy}>{busy ? 'Please wait…' : 'Send SMS code'}</button>
        </form>) : (
        <form onSubmit={finishSms} className="form">
          <label htmlFor="fc">Code sent by SMS to {phone}</label>
          <input id="fc" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
          <label htmlFor="fnp">New password</label>
          <PwInput id="fnp" auto="new-password" value={pw} onChange={(e) => setPw(e.target.value)} strength />
          {pw && bad.length > 0 && <small className="muted">Needs: {bad.join(', ')}</small>}
          {err && <div className="form-error" role="alert">{err}</div>}
          <button className="btn primary big" disabled={busy || bad.length > 0 || code.length < 4}>{busy ? 'Please wait…' : 'Change password'}</button>
        </form>)}
      <p className="center"><a href="#/login">Back to log in</a></p>
    </AuthFrame>
  );
}

export function ResetPassword() {
  const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const bad = passwordProblems(pw);
  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await finishRecovery(pw); toast('Password changed. Log in with your new password.'); go('#/login'); } catch (x) { setErr(x.message); } setBusy(false); };
  return (
    <AuthFrame title="New password" sub={'Enter a new password (at least ' + MIN_PW + ' characters).'}>
      <form onSubmit={submit} className="form">
        <label htmlFor="np">New password</label>
        <PwInput id="np" auto="new-password" value={pw} onChange={(e) => setPw(e.target.value)} strength />
        {pw && bad.length > 0 && <small className="muted">Needs: {bad.join(', ')}</small>}
        {err && <div className="form-error" role="alert">{err}</div>}
        <button className="btn primary big" disabled={busy || bad.length > 0}>{busy ? 'Please wait…' : 'Change password'}</button>
      </form>
    </AuthFrame>
  );
}

export function Register() {
  const [f, setF] = useState({ name: '', username: '', email: '', phone: '', password: '' });
  const [by, setBy] = useState('email');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');
  const [otp, setOtp] = useState('');
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await register({ ...f, email: by === 'email' ? f.email : '', phone: by === 'phone' ? f.phone : '' }); setBusy(false);
    if (r?.otp) setOtp(r.otp); else if (r?.info) setInfo(r.info); else if (r) setErr(r); else go('#/feed');
  };
  if (otp) return (
    <AuthFrame title="Verify your phone" sub="Enter the code we sent you by SMS.">
      <OtpStep phone={otp} onVerify={(c) => confirmPhoneCode(c, otp)} onDone={() => go('#/feed')} onBack={() => setOtp('')} />
    </AuthFrame>
  );
  return (
    <AuthFrame title="Create your account" sub="Join people who connect, share and belong.">
      <form onSubmit={submit} className="form">
        <label htmlFor="rn">Full name</label>
        <input id="rn" autoComplete="name" value={f.name} onChange={up('name')} required />
        <label htmlFor="ru">Username</label>
        <input id="ru" autoComplete="username" placeholder="yourname" value={f.username} onChange={up('username')} required />
        <Seg value={by} onChange={setBy} items={[['email', 'Email'], ['phone', 'Phone number']]} />
        {by === 'email' ? (<>
          <label htmlFor="re">Email</label>
          <input id="re" type="email" autoComplete="email" value={f.email} onChange={up('email')} required />
        </>) : (<>
          <label htmlFor="rph">Phone number (with country code)</label>
          <input id="rph" type="tel" autoComplete="tel" placeholder="+14155550123" value={f.phone} onChange={up('phone')} required />
          <small className="muted">We will text you a code to verify this number.</small>
        </>)}
        <label htmlFor="rp">Password</label>
        <PwInput id="rp" auto="new-password" placeholder={'At least ' + MIN_PW + ' characters'} value={f.password} onChange={up('password')} strength />
        {err && <div className="form-error" role="alert">{err}</div>}
        {info && <div className="form-ok" role="status">{info} <a href="#/login">Log in</a></div>}
        <button className="btn primary big" disabled={busy}>{busy ? 'Please wait…' : 'Sign up'}</button>
      </form>
      <p className="center">Already a member? <a href="#/login">Log in</a></p>
    </AuthFrame>
  );
}
