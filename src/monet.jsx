import { useCallback, useEffect, useState } from 'react';
import { IoShieldCheckmark, IoLockClosed, IoMegaphone, IoCash, IoRibbon, IoTime } from 'react-icons/io5';
import { useStore, me, timeAgo, logout, report } from './store.js';
import * as cloud from './cloud.js';
import { isOnline, uploadFile, passwordProblems, changePassword, logoutAllDevices, mfaFactors, mfaStartEnroll, mfaFinishEnroll, mfaDisable, sessionAal } from './supabase.js';
import { toast, Empty, Sheet, go, Badge } from './ui.jsx';
import { Head } from './more.jsx';

// ---------- shared helpers ----------
export const COUNTRIES = 'BD US GB IN PK CA AU DE FR IT ES NL BE PL SE NO DK FI IE PT CH AT JP CN HK SG MY PH ID TH VN KR AE SA TR EG NG KE TZ ZA BR MX AR CO CL'.split(' ');
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'BDT', 'INR', 'PKR', 'CAD', 'AUD', 'JPY', 'SGD', 'AED', 'BRL', 'KES', 'PHP', 'PLN', 'CHF', 'SEK', 'NOK', 'DKK'];
const ZERO_DEC = ['JPY', 'KRW', 'VND'];
let dn = null; try { dn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { /* old browser */ }
export const countryName = (c) => { try { return dn?.of(c) || c; } catch (e) { return c; } };
export const money = (minor, cur) => {
  const d = ZERO_DEC.includes(cur) ? 1 : 100;
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(Number(minor) / d); } catch (e) { return (Number(minor) / d).toFixed(2) + ' ' + cur; }
};
const toMinor = (v, cur) => Math.round(parseFloat(v) * (ZERO_DEC.includes(cur) ? 1 : 100));

function useLoad(fn, deps = []) {
  const [data, setData] = useState(null); const [err, setErr] = useState('');
  const load = useCallback(() => { setErr(''); Promise.resolve().then(fn).then(setData).catch((e) => setErr(e.message || 'Error')); }, deps); // eslint-disable-line
  useEffect(load, [load]);
  return [data, err, load];
}

function NeedOnline({ children }) {
  const s = useStore(); const user = me(s);
  if (!isOnline() || !user?.cloud) return (<div className="stack"><Head title="FYNZA" /><section className="card pad"><b>Online account required</b><p className="muted">This feature works with the real database. Connect the database in Settings and log in to an online account.</p><a className="btn" href="#/settings">Settings</a></section></div>);
  return children(user);
}

const NOTICE = 'The payment system is temporarily off. No money is being collected, and no subscriptions or withdrawals are active. It will be enabled once business approval and a payment provider are in place.';
const Notice = () => <p className="card pad" style={{ background: '#FFF7E6', borderColor: '#F5C26B' }}><IoLockClosed /> <b>Coming Soon · Temporarily Unavailable.</b> {NOTICE}</p>;

export function PayOptions({ country, direction = 'pay' }) {
  const [rows, err] = useLoad(() => cloud.paymentOptions(country, direction), [country, direction]);
  if (err) return <p className="form-err">{err}</p>;
  if (!rows) return <p className="muted">Loading…</p>;
  if (!rows.length) return <p className="muted">No methods are listed for this country yet.</p>;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {rows.map((m) => (
        <div key={m.id} className="person" style={{ opacity: m.live ? 1 : 0.65 }}>
          <IoCash size={22} />
          <div className="grow"><b>{m.name}</b><small className="muted">{m.countries.length ? m.countries.join(', ') : 'Worldwide'}{m.currencies.length ? ' · ' + m.currencies.join(', ') : ''}</small></div>
          <small className="muted" style={{ textAlign: 'right' }}>{m.status_note}</small>
          <button className="btn ghost sm" disabled title={m.status_note}>{m.live ? 'Select' : 'Unavailable'}</button>
        </div>
      ))}
    </div>
  );
}

// ---------- Security settings ----------
function PasswordBox() {
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [busy, setBusy] = useState(false);
  const bad = a ? passwordProblems(a) : [];
  const save = async () => {
    if (a !== b) return toast('The two passwords do not match.');
    setBusy(true);
    try { await changePassword(a); toast('Password changed.'); setA(''); setB(''); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <section className="card pad"><b>Change password</b>
      <input className="input" type="password" autoComplete="new-password" placeholder="New password" value={a} onChange={(e) => setA(e.target.value)} />
      {bad.length > 0 && <small className="muted">Needs: {bad.join(', ')}</small>}
      <input className="input" type="password" autoComplete="new-password" placeholder="Re-enter" value={b} onChange={(e) => setB(e.target.value)} />
      <button className="btn" disabled={busy || !a || bad.length > 0} onClick={save}>Save password</button>
    </section>
  );
}

export function TwoFactor({ onDone }) {
  const [list, , reload] = useLoad(mfaFactors, []);
  const [enr, setEnr] = useState(null); const [code, setCode] = useState('');
  const verified = (list || []).filter((f) => f.status === 'verified');
  const start = async () => { try { setEnr(await mfaStartEnroll()); setCode(''); } catch (e) { toast(e.message); } };
  const finish = async () => { try { await mfaFinishEnroll(enr.id, code); toast('2FA enabled.'); setEnr(null); reload(); onDone && onDone(); } catch (e) { toast(e.message); } };
  const off = async (id) => { if (!confirm('Turn off 2FA? Your account will be less secure.')) return; try { await mfaDisable(id); toast('2FA turned off.'); reload(); } catch (e) { toast(e.message); } };
  return (
    <section className="card pad"><b>Two-factor (2FA)</b>
      <p className="muted">A 6-digit code from an app like Google Authenticator / Authy. Anyone can turn it on themselves — no admin permission needed.</p>
      {verified.length > 0 ? (
        <>
          <p><IoShieldCheckmark color="#16A34A" /> 2FA is on (this session: {sessionAal()}).</p>
          {verified.map((f) => <button key={f.id} className="btn ghost danger" onClick={() => off(f.id)}>Turn off 2FA</button>)}
        </>
      ) : enr ? (
        <>
          <p>1) Scan this QR in your authenticator app (or type the key):</p>
          {enr.totp?.qr_code && <img alt="2FA QR" src={enr.totp.qr_code} width={180} height={180} style={{ background: '#fff', padding: 6 }} />}
          {enr.totp?.secret && <code style={{ wordBreak: 'break-all' }}>{enr.totp.secret}</code>}
          <p>2) Enter the 6-digit code from the app:</p>
          <input className="input" inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <button className="btn" disabled={code.length !== 6} onClick={finish}>Confirm</button>
        </>
      ) : <button className="btn" onClick={start}>Turn on 2FA</button>}
    </section>
  );
}

function Devices() {
  const [rows, err] = useLoad(cloud.mySecurityEvents, []);
  const L = { login: 'Login', login_failed: 'Failed login', logout_all: 'Logout from all devices', password_changed: 'Password changed', mfa_enabled: '2FA enabled', mfa_disabled: '2FA disabled', new_device: 'New device' };
  return (
    <section className="card pad"><b>Login and security history</b>
      {err && <p className="form-err">{err}</p>}
      {rows && !rows.length && <p className="muted">Nothing yet.</p>}
      {(rows || []).map((r, i) => <div className="person" key={i}><IoTime /><div className="grow"><b>{L[r.kind] || r.kind}</b><small className="muted">{r.device || ''}</small></div><small className="muted">{timeAgo(r.created_at)}</small></div>)}
    </section>
  );
}

function DataBox() {
  const [del, setDel] = useState(false); const [txt, setTxt] = useState('');
  const exp = async () => {
    try {
      const d = await cloud.exportMyData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'fynza-my-data.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { toast(e.message); }
  };
  const doDelete = async () => { try { await cloud.deleteMyAccount(); toast('Account deleted.'); logout(); go('#/'); } catch (e) { toast(e.message); } };
  return (
    <section className="card pad"><b>My data</b>
      <button className="btn ghost" onClick={exp}>Download my data (JSON)</button>
      <button className="btn ghost danger" onClick={() => setDel(true)}>Delete account permanently</button>
      {del && <Sheet title="Delete account" onClose={() => setDel(false)}>
        <p>This cannot be undone. Your posts, messages and data will be deleted. If you are sure, type <b>DELETE</b> below.</p>
        <input className="input" value={txt} onChange={(e) => setTxt(e.target.value)} />
        <button className="btn danger" disabled={txt !== 'DELETE'} onClick={doDelete}>Delete permanently</button>
      </Sheet>}
    </section>
  );
}

export function SecurityPage() {
  return (
    <NeedOnline>{() => (
      <div className="stack">
        <Head title="Security" />
        <section className="card pad"><b>Your security</b><p className="muted">Passwords are hashed in Supabase Auth; we never see them. 5 wrong login attempts lock the account for 15 minutes. Private messages are encrypted in transit (HTTPS) and protected by access control in the database — but end-to-end encryption is not available yet.</p></section>
        <PasswordBox />
        <TwoFactor />
        <section className="card pad"><b>Logout from all devices</b><p className="muted">If you suspect someone has accessed your account, press this, then change your password.</p>
          <button className="btn ghost danger" onClick={async () => { try { await logoutAllDevices(); logout(); go('#/'); } catch (e) { toast(e.message); } }}>Logout from all devices</button></section>
        <Devices />
        <DataBox />
      </div>
    )}</NeedOnline>
  );
}

// ---------- FYNZA Verified ----------
const ST = { pending: 'Awaiting review', identity_approved: 'Identity approved — badge will activate once payments are enabled', approved: 'Approved', rejected: 'Rejected', expired: 'Expired' };

function ApplyForm({ user, pages, onDone }) {
  const [target, setTarget] = useState('me'); const [fullName, setFullName] = useState(user.name || '');
  const [docType, setDocType] = useState('national_id'); const [country, setCountry] = useState(user.country || '');
  const [doc, setDoc] = useState(null); const [selfie, setSelfie] = useState(null); const [busy, setBusy] = useState(false);
  const mine = pages.filter((p) => p.owner === user.id && !p.verified);
  const send = async () => {
    if (!doc || !selfie) return toast('Provide both a document and a selfie.');
    setBusy(true);
    try {
      const t = Date.now(); const ext = (f) => (f.type === 'application/pdf' ? 'pdf' : f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg');
      const dp = await uploadFile('verify', `${user.id}/${t}-doc.${ext(doc)}`, doc);
      const sp = await uploadFile('verify', `${user.id}/${t}-selfie.${ext(selfie)}`, selfie);
      await cloud.submitVerification({ page: target === 'me' ? null : target, fullName, docType, docPath: dp, selfiePath: sp, country });
      toast('Application submitted. An admin will review it.'); onDone();
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <section className="card pad"><b>Verification application</b>
      <p className="muted">Identity is verified first. The document and selfie are kept in private storage; only authorized admins can view them.</p>
      <label>Applying for<select className="input sel" value={target} onChange={(e) => setTarget(e.target.value)}><option value="me">My profile</option>{mine.map((p) => <option key={p.id} value={p.id}>Page: {p.name}</option>)}</select></label>
      <input className="input" placeholder="Full name as on the document" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      <label>Document type<select className="input sel" value={docType} onChange={(e) => setDocType(e.target.value)}><option value="national_id">National ID</option><option value="passport">Passport</option><option value="driver_license">Driving licence</option><option value="other">Other government document</option></select></label>
      <label>Country<select className="input sel" value={country} onChange={(e) => setCountry(e.target.value)}><option value="">— Select —</option>{COUNTRIES.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}</select></label>
      <label>Document photo/PDF (max 5MB)<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setDoc(e.target.files[0] || null)} /></label>
      <label>Your selfie<input type="file" accept="image/jpeg,image/png,image/webp" capture="user" onChange={(e) => setSelfie(e.target.files[0] || null)} /></label>
      <button className="btn" disabled={busy || fullName.trim().length < 3 || !doc || !selfie} onClick={send}>{busy ? 'Sending…' : 'Submit application'}</button>
    </section>
  );
}

export function VerifyPage() {
  const s = useStore();
  return (
    <NeedOnline>{(user) => <VerifyInner user={user} pages={s.pages || []} />}</NeedOnline>
  );
}
function VerifyInner({ user, pages }) {
  const [apps, err, reload] = useLoad(cloud.myVerification, []);
  const [plans] = useLoad(cloud.verifiedPlans, []);
  const [country, setCountry] = useState(user.country || '');
  const pending = (apps || []).some((a) => a.status === 'pending' || a.status === 'identity_approved');
  return (
    <div className="stack">
      <Head title="FYNZA Verified" />
      <section className="card pad"><b>FYNZA Verified <Badge on size={20} /></b>
        <p className="muted">The blue badge shows your identity has been verified. Available for both profiles and pages. Monthly fee; the badge stays even if you change your name, unless it is revoked or expires.</p>
        {user.verified && <p><IoRibbon color="#1D4ED8" /> Your profile is verified.</p>}
      </section>
      <Notice />
      <section className="card pad"><b>Monthly price</b>
        {plans && !plans.length && <p className="muted">The admin has not set any price yet.</p>}
        {(plans || []).map((p) => <div className="person" key={p.id}><b className="grow">{p.currency}</b><span>{money(p.amount_minor, p.currency)} / month</span></div>)}
        <small className="muted">The auto-renew framework is ready, but no subscription or auto-renew is active until payments are enabled. Renewal reminders and failed/expired payment handling will work once payments are on.</small>
      </section>
      <section className="card pad"><b>Payment methods (by your country)</b>
        <select className="input sel" value={country} onChange={(e) => setCountry(e.target.value)}><option value="">All countries</option>{COUNTRIES.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}</select>
        <PayOptions country={country || null} />
      </section>
      {err && <p className="form-err">{err}</p>}
      {!pending && !user.verified && <ApplyForm user={user} pages={pages} onDone={reload} />}
      <section className="card pad"><b>My applications</b>
        {apps && !apps.length && <p className="muted">No applications.</p>}
        {(apps || []).map((a) => <div className="person" key={a.id}><div className="grow"><b>{a.page_id ? 'Page' : 'Profile'} · {a.doc_type}</b><small className="muted">{ST[a.status] || a.status}{a.admin_note ? ' — ' + a.admin_note : ''}</small></div><small className="muted">{timeAgo(a.created_at)}</small></div>)}
      </section>
      <section className="card pad"><b>Payment history</b><p className="muted">No payments yet — payments are still off.</p></section>
    </div>
  );
}

// ---------- Ads (advertiser dashboard) ----------
const CAMP_ST = { draft: 'Draft', pending_review: 'In review', approved: 'Approved', rejected: 'Rejected', paused: 'Paused', active: 'Active', ended: 'Ended' };

function Stats({ id }) {
  const [st] = useLoad(() => cloud.campaignStats(id), [id]);
  if (!st) return null;
  return <small className="muted">Impressions {st.impressions} · Clicks {st.clicks} · CTR {Number(st.ctr || 0).toFixed(2)}% · Spend {st.spend_minor}</small>;
}

function CampaignForm({ onDone }) {
  const [f, setF] = useState({ name: '', objective: 'awareness', headline: '', body: '', link: '', currency: 'USD', budget: '', daily: '', start: '', end: '', countries: '', minAge: '', maxAge: '', interests: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try {
      const targeting = {};
      const cs = f.countries.split(',').map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)); if (cs.length) targeting.countries = cs;
      if (f.minAge) targeting.min_age = +f.minAge; if (f.maxAge) targeting.max_age = +f.maxAge;
      const it = f.interests.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10); if (it.length) targeting.interests = it;
      await cloud.createCampaign({ name: f.name, objective: f.objective, headline: f.headline, body: f.body, link: f.link, currency: f.currency, budget: toMinor(f.budget || 0, f.currency), daily: toMinor(f.daily || 0, f.currency), start: f.start, end: f.end, targeting });
      toast('Draft campaign saved.'); onDone();
    } catch (e) { toast(e.message); }
  };
  return (
    <Sheet title="New campaign (draft)" onClose={onDone}>
      <input className="input" placeholder="Campaign name" value={f.name} onChange={set('name')} />
      <select className="input sel" value={f.objective} onChange={set('objective')}><option value="awareness">Awareness</option><option value="traffic">Traffic</option><option value="engagement">Engagement</option></select>
      <input className="input" maxLength={80} placeholder="Headline" value={f.headline} onChange={set('headline')} />
      <textarea className="input" maxLength={300} placeholder="Ad text" value={f.body} onChange={set('body')} />
      <input className="input" placeholder="Link (https://…)" value={f.link} onChange={set('link')} />
      <select className="input sel" value={f.currency} onChange={set('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
      <input className="input" inputMode="decimal" placeholder="Total budget" value={f.budget} onChange={set('budget')} />
      <input className="input" inputMode="decimal" placeholder="Daily budget" value={f.daily} onChange={set('daily')} />
      <label>Start<input className="input" type="date" value={f.start} onChange={set('start')} /></label>
      <label>End<input className="input" type="date" value={f.end} onChange={set('end')} /></label>
      <b>Targeting</b>
      <input className="input" placeholder="Country codes (e.g. BD, US, GB)" value={f.countries} onChange={set('countries')} />
      <input className="input" inputMode="numeric" placeholder="Minimum age" value={f.minAge} onChange={set('minAge')} />
      <input className="input" inputMode="numeric" placeholder="Maximum age" value={f.maxAge} onChange={set('maxAge')} />
      <input className="input" placeholder="Interests (comma-separated)" value={f.interests} onChange={set('interests')} />
      <button className="btn" disabled={f.name.trim().length < 3} onClick={save}>Save draft</button>
    </Sheet>
  );
}

export function AdsPage() {
  return <NeedOnline>{() => <AdsInner />}</NeedOnline>;
}
function AdsInner() {
  const [rows, err, reload] = useLoad(cloud.myCampaigns, []);
  const [adding, setAdding] = useState(false);
  const act = async (fn, m) => { try { await fn(); toast(m); reload(); } catch (e) { toast(e.message); } };
  return (
    <div className="stack">
      <Head title="Advertiser dashboard" />
      <section className="card pad"><b><IoMegaphone /> Ads and Sponsored Posts</b><p className="muted">Create campaigns, set budget and targeting, and send them for admin review. Running ads (Launch) is possible only after payments are enabled — they cannot be launched now and no earnings/spend is shown.</p></section>
      <Notice />
      <button className="btn" onClick={() => setAdding(true)}>+ New campaign</button>
      {adding && <CampaignForm onDone={() => { setAdding(false); reload(); }} />}
      {err && <p className="form-err">{err}</p>}
      {rows && !rows.length && <Empty title="No campaigns" />}
      {(rows || []).map((c) => (
        <section className="card pad" key={c.id}>
          <b>{c.name}</b> <small className="muted">· {CAMP_ST[c.status] || c.status} · {c.objective}</small>
          <p>{c.headline}</p><p className="muted">Budget {money(c.budget_minor, c.currency)} (daily {money(c.daily_budget_minor, c.currency)})</p>
          {c.reject_reason && <p className="form-err">{c.reject_reason}</p>}
          <Stats id={c.id} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {(c.status === 'draft' || c.status === 'rejected') && <button className="btn ghost sm" onClick={() => act(() => cloud.submitCampaign(c.id), 'Sent for review.')}>Send for review</button>}
            {c.status === 'approved' && <button className="btn ghost sm" disabled title="Available once payments are enabled">Launch — Coming Soon</button>}
            {(c.status === 'draft' || c.status === 'rejected') && <button className="btn ghost danger sm" onClick={() => act(() => cloud.deleteCampaign(c.id), 'Deleted.')}>Delete</button>}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------- Creator dashboard ----------
export function CreatorPage() {
  return <NeedOnline>{(user) => <CreatorInner user={user} />}</NeedOnline>;
}
function CreatorInner({ user }) {
  const [el, err, reload] = useLoad(cloud.creatorEligibility, []);
  const [app, , reloadApp] = useLoad(cloud.myCreatorApp, []);
  const [sum] = useLoad(cloud.creatorSummary, []);
  const [earn] = useLoad(cloud.myEarnings, []);
  const [wd] = useLoad(cloud.myWithdrawals, []);
  const [gifts] = useLoad(cloud.giftCatalog, []);
  const [country, setCountry] = useState(user.country || '');
  const a = app?.[0];
  const ok = el && el.length && el.every((r) => r.ok);
  const apply = async () => { try { await cloud.applyCreator(); toast('Application submitted.'); reloadApp(); reload(); } catch (e) { toast(e.message); } };
  return (
    <div className="stack">
      <Head title="Creator dashboard" />
      <section className="card pad"><b>Creator Monetization</b><p className="muted">The framework for Reels, videos, eligible posts, Stars/Gifts, live gifts and ad-revenue share is built. Earnings calculation and withdrawals start after payments are enabled — all balances are genuinely zero right now.</p></section>
      <Notice />
      <section className="card pad"><b>Eligibility (from real data)</b>
        {err && <p className="form-err">{err}</p>}
        {(el || []).map((r) => <div className="person" key={r.key}><span>{r.ok ? '✅' : '⬜'}</span><b className="grow">{r.label}</b><small className="muted">{r.have} / {r.need}</small></div>)}
        {a ? <p>Application status: <b>{a.status === 'pending' ? 'In review' : a.status === 'approved' ? 'Approved' : 'Rejected'}</b>{a.note ? ' — ' + a.note : ''}</p>
          : <button className="btn" disabled={!ok} onClick={apply}>Apply to the Creator program</button>}
      </section>
      <section className="card pad"><b>Earnings</b>
        <div className="admin-stats"><div className="card pad stat"><b>{sum?.pending_minor ?? 0}</b><small className="muted">Pending</small></div><div className="card pad stat"><b>{sum?.available_minor ?? 0}</b><small className="muted">Available</small></div><div className="card pad stat"><b>{sum?.paid_minor ?? 0}</b><small className="muted">Paid</small></div></div>
        {earn && !earn.length && <p className="muted">No earnings.</p>}
        {(earn || []).map((e) => <div className="person" key={e.id}><b className="grow">{e.kind}</b><span>{money(e.amount_minor, e.currency)}</span><small className="muted">{e.status}</small></div>)}
      </section>
      <section className="card pad"><b>Withdrawal</b>
        <p className="muted">Withdrawals are off right now. Once enabled, methods for your country will appear here.</p>
        <select className="input sel" value={country} onChange={(e) => setCountry(e.target.value)}><option value="">All countries</option>{COUNTRIES.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}</select>
        <PayOptions country={country || null} direction="payout" />
        <button className="btn ghost" disabled>Request withdrawal — Coming Soon</button>
        {wd && wd.length > 0 && wd.map((w) => <div className="person" key={w.id}><b className="grow">{w.method_id}</b><span>{money(w.amount_minor, w.currency)}</span><small className="muted">{w.status}</small></div>)}
      </section>
      <section className="card pad"><b>Stars and Virtual Gifts</b>
        <p className="muted">Buying Stars and sending gifts will be available after payments are enabled. List:</p>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>{(gifts || []).map((g) => <span key={g.id} className="chip">{g.emoji} {g.name} · {g.stars}★</span>)}</div>
      </section>
      <section className="card pad"><b>Payment history</b><p className="muted">No transactions.</p></section>
    </div>
  );
}

// ---------- Hub + page insights ----------
export function MoneyHub() {
  const items = [['#/verify', 'FYNZA Verified', 'Apply for the blue badge and check status', IoShieldCheckmark], ['#/ads', 'Advertiser dashboard', 'Campaigns, budget, analytics', IoMegaphone], ['#/creator', 'Creator dashboard', 'Eligibility, earnings, withdrawals', IoCash], ['#/security', 'Security', 'Password, 2FA, devices', IoLockClosed]];
  return (
    <div className="stack">
      <Head title="Verified, Ads & Creators" />
      <Notice />
      {items.map(([h, t, d, I]) => <a key={h} className="card pad person" href={h}><I size={26} /><div className="grow"><b>{t}</b><small className="muted">{d}</small></div></a>)}
    </div>
  );
}

export function PageInsights({ id }) {
  const [a, err] = useLoad(() => cloud.pageAnalytics(id), [id]);
  if (err) return null;
  if (!a) return null;
  return (
    <section className="card pad"><b>Page insights</b>
      <div className="admin-stats">{[['Followers', a.followers], ['Posts', a.posts], ['Reactions', a.reactions], ['Comments', a.comments], ['Shares', a.shares]].map(([l, v]) => <div className="card pad stat" key={l}><b>{v ?? 0}</b><small className="muted">{l}</small></div>)}</div>
    </section>
  );
}

export function SponsoredSlot({ country }) {
  const [ads] = useLoad(() => cloud.feedAds(country), [country]);
  if (!ads || !ads.length) return null;
  return <>{ads.map((a) => <section className="card pad" key={a.id}><small className="muted">Sponsored</small><b>{a.headline}</b><p>{a.body}</p>{a.link_url && <a className="btn ghost sm" href={a.link_url} target="_blank" rel="noopener noreferrer nofollow">Learn more</a>}</section>)}</>;
}

// ---------- Report dialog (reason + details) ----------
let setRep = null;
export const askReport = (kind, target) => setRep && setRep({ kind, target });
const REASONS = [['spam', 'Spam / scam / fraud'], ['harassment', 'Harassment or threats'], ['hate', 'Hate speech'], ['sexual', 'Nudity / sexual content'], ['violence', 'Violence / harmful content'], ['fake', 'Fake account / impersonation'], ['other', 'Other']];
export function ReportLayer() {
  const [r, setR] = useState(null); const [reason, setReason] = useState('spam'); const [text, setText] = useState('');
  useEffect(() => { setRep = setR; return () => { setRep = null; }; }, []);
  if (!r) return null;
  const send = () => { report(r.kind, r.target, reason + (text.trim() ? ': ' + text.trim().slice(0, 500) : '')); toast('Report submitted. An admin will review it — thank you.'); setR(null); setText(''); };
  return (
    <Sheet title="Report" onClose={() => setR(null)}>
      {REASONS.map(([k, l]) => <label key={k} className="toggle-row"><span>{l}</span><input type="radio" name="rr" checked={reason === k} onChange={() => setReason(k)} /></label>)}
      <textarea className="input" maxLength={500} placeholder="Add details (optional)" value={text} onChange={(e) => setText(e.target.value)} />
      <small className="muted">Reports are seen only by authorized admins. Please do not file false reports.</small>
      <button className="btn danger" onClick={send}>Send report</button>
    </Sheet>
  );
}
