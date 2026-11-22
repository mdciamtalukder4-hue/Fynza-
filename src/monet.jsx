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
  const load = useCallback(() => { setErr(''); Promise.resolve().then(fn).then(setData).catch((e) => setErr(e.message || 'ত্রুটি')); }, deps); // eslint-disable-line
  useEffect(load, [load]);
  return [data, err, load];
}

function NeedOnline({ children }) {
  const s = useStore(); const user = me(s);
  if (!isOnline() || !user?.cloud) return (<div className="stack"><Head title="FYNZA" /><section className="card pad"><b>অনলাইন অ্যাকাউন্ট দরকার</b><p className="muted">এই ফিচারটি আসল ডাটাবেসের সাথে কাজ করে। Settings থেকে ডাটাবেস কানেক্ট করে অনলাইন অ্যাকাউন্টে লগইন করুন।</p><a className="btn" href="#/settings">Settings</a></section></div>);
  return children(user);
}

const NOTICE = 'পেমেন্ট সিস্টেম এখন সাময়িকভাবে বন্ধ। কোনো টাকা নেওয়া হচ্ছে না, কোনো সাবস্ক্রিপশন বা উইথড্র চালু নেই। ব্যবসায়িক অনুমোদন ও পেমেন্ট প্রোভাইডার চালু হলে এটি চালু হবে।';
const Notice = () => <p className="card pad" style={{ background: '#FFF7E6', borderColor: '#F5C26B' }}><IoLockClosed /> <b>Coming Soon · Temporarily Unavailable.</b> {NOTICE}</p>;

export function PayOptions({ country, direction = 'pay' }) {
  const [rows, err] = useLoad(() => cloud.paymentOptions(country, direction), [country, direction]);
  if (err) return <p className="form-err">{err}</p>;
  if (!rows) return <p className="muted">লোড হচ্ছে…</p>;
  if (!rows.length) return <p className="muted">এই দেশের জন্য এখনও কোনো পদ্ধতি তালিকাভুক্ত নেই।</p>;
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
    if (a !== b) return toast('দুটি পাসওয়ার্ড মেলেনি।');
    setBusy(true);
    try { await changePassword(a); toast('পাসওয়ার্ড বদলানো হয়েছে।'); setA(''); setB(''); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <section className="card pad"><b>পাসওয়ার্ড বদলান</b>
      <input className="input" type="password" autoComplete="new-password" placeholder="নতুন পাসওয়ার্ড" value={a} onChange={(e) => setA(e.target.value)} />
      {bad.length > 0 && <small className="muted">লাগবে: {bad.join(', ')}</small>}
      <input className="input" type="password" autoComplete="new-password" placeholder="আবার লিখুন" value={b} onChange={(e) => setB(e.target.value)} />
      <button className="btn" disabled={busy || !a || bad.length > 0} onClick={save}>পাসওয়ার্ড সেভ করুন</button>
    </section>
  );
}

function TwoFactor() {
  const [list, , reload] = useLoad(mfaFactors, []);
  const [enr, setEnr] = useState(null); const [code, setCode] = useState('');
  const verified = (list || []).filter((f) => f.status === 'verified');
  const start = async () => { try { setEnr(await mfaStartEnroll()); setCode(''); } catch (e) { toast(e.message); } };
  const finish = async () => { try { await mfaFinishEnroll(enr.id, code); toast('2FA চালু হয়েছে।'); setEnr(null); reload(); } catch (e) { toast(e.message); } };
  const off = async (id) => { if (!confirm('2FA বন্ধ করবেন? অ্যাকাউন্ট কম সুরক্ষিত হবে।')) return; try { await mfaDisable(id); toast('2FA বন্ধ করা হয়েছে।'); reload(); } catch (e) { toast(e.message); } };
  return (
    <section className="card pad"><b>টু-ফ্যাক্টর (2FA)</b>
      <p className="muted">Google Authenticator / Authy-এর মতো অ্যাপের ৬ সংখ্যার কোড। যে কেউ নিজে চালু করতে পারেন — অ্যাডমিনের অনুমতি লাগে না।</p>
      {verified.length > 0 ? (
        <>
          <p><IoShieldCheckmark color="#16A34A" /> 2FA চালু আছে (এই সেশন: {sessionAal()}).</p>
          {verified.map((f) => <button key={f.id} className="btn ghost danger" onClick={() => off(f.id)}>2FA বন্ধ করুন</button>)}
        </>
      ) : enr ? (
        <>
          <p>১) অথেনটিকেটর অ্যাপে এই QR স্ক্যান করুন (বা কী টাইপ করুন):</p>
          {enr.totp?.qr_code && <img alt="2FA QR" src={enr.totp.qr_code} width={180} height={180} style={{ background: '#fff', padding: 6 }} />}
          {enr.totp?.secret && <code style={{ wordBreak: 'break-all' }}>{enr.totp.secret}</code>}
          <p>২) অ্যাপের ৬ সংখ্যার কোড দিন:</p>
          <input className="input" inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <button className="btn" disabled={code.length !== 6} onClick={finish}>নিশ্চিত করুন</button>
        </>
      ) : <button className="btn" onClick={start}>2FA চালু করুন</button>}
    </section>
  );
}

function Devices() {
  const [rows, err] = useLoad(cloud.mySecurityEvents, []);
  const L = { login: 'লগইন', login_failed: 'ব্যর্থ লগইন', logout_all: 'সব ডিভাইস থেকে লগআউট', password_changed: 'পাসওয়ার্ড বদল', mfa_enabled: '2FA চালু', mfa_disabled: '2FA বন্ধ', new_device: 'নতুন ডিভাইস' };
  return (
    <section className="card pad"><b>লগইন ও নিরাপত্তা ইতিহাস</b>
      {err && <p className="form-err">{err}</p>}
      {rows && !rows.length && <p className="muted">এখনও কিছু নেই।</p>}
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
  const doDelete = async () => { try { await cloud.deleteMyAccount(); toast('অ্যাকাউন্ট মুছে ফেলা হয়েছে।'); logout(); go('#/'); } catch (e) { toast(e.message); } };
  return (
    <section className="card pad"><b>আমার তথ্য</b>
      <button className="btn ghost" onClick={exp}>আমার তথ্য ডাউনলোড (JSON)</button>
      <button className="btn ghost danger" onClick={() => setDel(true)}>অ্যাকাউন্ট চিরতরে মুছুন</button>
      {del && <Sheet title="অ্যাকাউন্ট মুছে ফেলা" onClose={() => setDel(false)}>
        <p>এটি ফেরানো যাবে না। আপনার পোস্ট, মেসেজ ও তথ্য মুছে যাবে। নিশ্চিত হলে নিচে <b>DELETE</b> লিখুন।</p>
        <input className="input" value={txt} onChange={(e) => setTxt(e.target.value)} />
        <button className="btn danger" disabled={txt !== 'DELETE'} onClick={doDelete}>চিরতরে মুছুন</button>
      </Sheet>}
    </section>
  );
}

export function SecurityPage() {
  return (
    <NeedOnline>{() => (
      <div className="stack">
        <Head title="Security" />
        <section className="card pad"><b>আপনার নিরাপত্তা</b><p className="muted">পাসওয়ার্ড Supabase Auth-এ হ্যাশ করা থাকে; আমরা কখনও দেখি না। ৫ বার ভুল লগইনে ১৫ মিনিট লক হয়। প্রাইভেট মেসেজ ট্রান্সপোর্টে এনক্রিপ্টেড (HTTPS) ও ডাটাবেসে অ্যাক্সেস-কন্ট্রোলে সুরক্ষিত — তবে এন্ড-টু-এন্ড এনক্রিপশন এখনও নেই।</p></section>
        <PasswordBox />
        <TwoFactor />
        <section className="card pad"><b>সব ডিভাইস থেকে লগআউট</b><p className="muted">কেউ আপনার অ্যাকাউন্টে ঢুকেছে সন্দেহ হলে চাপুন, তারপর পাসওয়ার্ড বদলান।</p>
          <button className="btn ghost danger" onClick={async () => { try { await logoutAllDevices(); logout(); go('#/'); } catch (e) { toast(e.message); } }}>সব ডিভাইস থেকে লগআউট</button></section>
        <Devices />
        <DataBox />
      </div>
    )}</NeedOnline>
  );
}

// ---------- FYNZA Verified ----------
const ST = { pending: 'রিভিউয়ের অপেক্ষায়', identity_approved: 'পরিচয় অনুমোদিত — পেমেন্ট চালু হলে ব্যাজ সক্রিয় হবে', approved: 'অনুমোদিত', rejected: 'বাতিল', expired: 'মেয়াদ শেষ' };

function ApplyForm({ user, pages, onDone }) {
  const [target, setTarget] = useState('me'); const [fullName, setFullName] = useState(user.name || '');
  const [docType, setDocType] = useState('national_id'); const [country, setCountry] = useState(user.country || '');
  const [doc, setDoc] = useState(null); const [selfie, setSelfie] = useState(null); const [busy, setBusy] = useState(false);
  const mine = pages.filter((p) => p.owner === user.id && !p.verified);
  const send = async () => {
    if (!doc || !selfie) return toast('ডকুমেন্ট ও সেলফি দুটোই দিন।');
    setBusy(true);
    try {
      const t = Date.now(); const ext = (f) => (f.type === 'application/pdf' ? 'pdf' : f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg');
      const dp = await uploadFile('verify', `${user.id}/${t}-doc.${ext(doc)}`, doc);
      const sp = await uploadFile('verify', `${user.id}/${t}-selfie.${ext(selfie)}`, selfie);
      await cloud.submitVerification({ page: target === 'me' ? null : target, fullName, docType, docPath: dp, selfiePath: sp, country });
      toast('আবেদন জমা হয়েছে। অ্যাডমিন রিভিউ করবেন।'); onDone();
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <section className="card pad"><b>ভেরিফিকেশনের আবেদন</b>
      <p className="muted">প্রথমে পরিচয় যাচাই। ডকুমেন্ট ও সেলফি প্রাইভেট স্টোরেজে থাকে; শুধু অনুমোদিত অ্যাডমিন দেখতে পারেন।</p>
      <label>কার জন্য<select className="input sel" value={target} onChange={(e) => setTarget(e.target.value)}><option value="me">আমার প্রোফাইল</option>{mine.map((p) => <option key={p.id} value={p.id}>পেজ: {p.name}</option>)}</select></label>
      <input className="input" placeholder="ডকুমেন্টে যে পূর্ণ নাম আছে" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      <label>ডকুমেন্টের ধরন<select className="input sel" value={docType} onChange={(e) => setDocType(e.target.value)}><option value="national_id">National ID</option><option value="passport">Passport</option><option value="driver_license">Driving licence</option><option value="other">অন্য সরকারি ডকুমেন্ট</option></select></label>
      <label>দেশ<select className="input sel" value={country} onChange={(e) => setCountry(e.target.value)}><option value="">— বেছে নিন —</option>{COUNTRIES.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}</select></label>
      <label>ডকুমেন্টের ছবি/PDF (সর্বোচ্চ ৫MB)<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setDoc(e.target.files[0] || null)} /></label>
      <label>আপনার সেলফি<input type="file" accept="image/jpeg,image/png,image/webp" capture="user" onChange={(e) => setSelfie(e.target.files[0] || null)} /></label>
      <button className="btn" disabled={busy || fullName.trim().length < 3 || !doc || !selfie} onClick={send}>{busy ? 'পাঠানো হচ্ছে…' : 'আবেদন জমা দিন'}</button>
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
        <p className="muted">নীল ব্যাজ দেখায় আপনার পরিচয় যাচাই হয়েছে। প্রোফাইল ও পেজ — দুটোতেই পাওয়া যায়। মাসিক ফি; ব্যাজ বাতিল/মেয়াদ শেষ না হলে আপনার নাম বদলালেও থাকে।</p>
        {user.verified && <p><IoRibbon color="#1D4ED8" /> আপনার প্রোফাইল ভেরিফায়েড।</p>}
      </section>
      <Notice />
      <section className="card pad"><b>মাসিক মূল্য</b>
        {plans && !plans.length && <p className="muted">অ্যাডমিন এখনও কোনো মূল্য নির্ধারণ করেননি।</p>}
        {(plans || []).map((p) => <div className="person" key={p.id}><b className="grow">{p.currency}</b><span>{money(p.amount_minor, p.currency)} / মাস</span></div>)}
        <small className="muted">অটো-রিনিউ কাঠামো প্রস্তুত, কিন্তু পেমেন্ট চালু না হওয়া পর্যন্ত কোনো সাবস্ক্রিপশন বা অটো-রিনিউ সক্রিয় নয়। রিনিউয়ের রিমাইন্ডার ও ব্যর্থ/মেয়াদোত্তীর্ণ পেমেন্ট ব্যবস্থাপনা পেমেন্ট চালুর সাথে কাজ করবে।</small>
      </section>
      <section className="card pad"><b>পেমেন্ট পদ্ধতি (আপনার দেশ অনুযায়ী)</b>
        <select className="input sel" value={country} onChange={(e) => setCountry(e.target.value)}><option value="">সব দেশ</option>{COUNTRIES.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}</select>
        <PayOptions country={country || null} />
      </section>
      {err && <p className="form-err">{err}</p>}
      {!pending && !user.verified && <ApplyForm user={user} pages={pages} onDone={reload} />}
      <section className="card pad"><b>আমার আবেদন</b>
        {apps && !apps.length && <p className="muted">কোনো আবেদন নেই।</p>}
        {(apps || []).map((a) => <div className="person" key={a.id}><div className="grow"><b>{a.page_id ? 'পেজ' : 'প্রোফাইল'} · {a.doc_type}</b><small className="muted">{ST[a.status] || a.status}{a.admin_note ? ' — ' + a.admin_note : ''}</small></div><small className="muted">{timeAgo(a.created_at)}</small></div>)}
      </section>
      <section className="card pad"><b>পেমেন্ট ইতিহাস</b><p className="muted">কোনো পেমেন্ট হয়নি — পেমেন্ট এখনও বন্ধ।</p></section>
    </div>
  );
}

// ---------- Ads (advertiser dashboard) ----------
const CAMP_ST = { draft: 'খসড়া', pending_review: 'রিভিউয়ে', approved: 'অনুমোদিত', rejected: 'বাতিল', paused: 'বিরতি', active: 'চালু', ended: 'শেষ' };

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
      toast('খসড়া ক্যাম্পেইন সেভ হয়েছে।'); onDone();
    } catch (e) { toast(e.message); }
  };
  return (
    <Sheet title="নতুন ক্যাম্পেইন (খসড়া)" onClose={onDone}>
      <input className="input" placeholder="ক্যাম্পেইনের নাম" value={f.name} onChange={set('name')} />
      <select className="input sel" value={f.objective} onChange={set('objective')}><option value="awareness">Awareness</option><option value="traffic">Traffic</option><option value="engagement">Engagement</option></select>
      <input className="input" maxLength={80} placeholder="হেডলাইন" value={f.headline} onChange={set('headline')} />
      <textarea className="input" maxLength={300} placeholder="বিজ্ঞাপনের লেখা" value={f.body} onChange={set('body')} />
      <input className="input" placeholder="লিংক (https://…)" value={f.link} onChange={set('link')} />
      <select className="input sel" value={f.currency} onChange={set('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
      <input className="input" inputMode="decimal" placeholder="মোট বাজেট" value={f.budget} onChange={set('budget')} />
      <input className="input" inputMode="decimal" placeholder="দৈনিক বাজেট" value={f.daily} onChange={set('daily')} />
      <label>শুরু<input className="input" type="date" value={f.start} onChange={set('start')} /></label>
      <label>শেষ<input className="input" type="date" value={f.end} onChange={set('end')} /></label>
      <b>টার্গেটিং</b>
      <input className="input" placeholder="দেশ কোড (যেমন BD, US, GB)" value={f.countries} onChange={set('countries')} />
      <input className="input" inputMode="numeric" placeholder="সর্বনিম্ন বয়স" value={f.minAge} onChange={set('minAge')} />
      <input className="input" inputMode="numeric" placeholder="সর্বোচ্চ বয়স" value={f.maxAge} onChange={set('maxAge')} />
      <input className="input" placeholder="আগ্রহ (কমা দিয়ে)" value={f.interests} onChange={set('interests')} />
      <button className="btn" disabled={f.name.trim().length < 3} onClick={save}>খসড়া সেভ করুন</button>
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
      <section className="card pad"><b><IoMegaphone /> বিজ্ঞাপন ও Sponsored Posts</b><p className="muted">ক্যাম্পেইন বানান, বাজেট ও টার্গেটিং ঠিক করুন, অ্যাডমিন রিভিউয়ে পাঠান। বিজ্ঞাপন চালানো (Launch) পেমেন্ট চালু হওয়ার পরে সম্ভব — এখন চালু করা যায় না এবং কোনো আয়/খরচ দেখানো হয় না।</p></section>
      <Notice />
      <button className="btn" onClick={() => setAdding(true)}>+ নতুন ক্যাম্পেইন</button>
      {adding && <CampaignForm onDone={() => { setAdding(false); reload(); }} />}
      {err && <p className="form-err">{err}</p>}
      {rows && !rows.length && <Empty title="কোনো ক্যাম্পেইন নেই" />}
      {(rows || []).map((c) => (
        <section className="card pad" key={c.id}>
          <b>{c.name}</b> <small className="muted">· {CAMP_ST[c.status] || c.status} · {c.objective}</small>
          <p>{c.headline}</p><p className="muted">বাজেট {money(c.budget_minor, c.currency)} (দৈনিক {money(c.daily_budget_minor, c.currency)})</p>
          {c.reject_reason && <p className="form-err">{c.reject_reason}</p>}
          <Stats id={c.id} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {(c.status === 'draft' || c.status === 'rejected') && <button className="btn ghost sm" onClick={() => act(() => cloud.submitCampaign(c.id), 'রিভিউয়ে পাঠানো হয়েছে।')}>রিভিউয়ে পাঠান</button>}
            {c.status === 'approved' && <button className="btn ghost sm" disabled title="পেমেন্ট চালু হলে">Launch — Coming Soon</button>}
            {(c.status === 'draft' || c.status === 'rejected') && <button className="btn ghost danger sm" onClick={() => act(() => cloud.deleteCampaign(c.id), 'মুছে ফেলা হয়েছে।')}>মুছুন</button>}
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
  const apply = async () => { try { await cloud.applyCreator(); toast('আবেদন জমা হয়েছে।'); reloadApp(); reload(); } catch (e) { toast(e.message); } };
  return (
    <div className="stack">
      <Head title="Creator dashboard" />
      <section className="card pad"><b>Creator Monetization</b><p className="muted">Reels, ভিডিও, যোগ্য পোস্ট, Stars/Gifts, লাইভ গিফট ও বিজ্ঞাপন-রেভিনিউ শেয়ারের কাঠামো তৈরি। আয় গণনা ও উইথড্র পেমেন্ট চালুর পরে শুরু হবে — এখন সব ব্যালেন্স আসলেই শূন্য।</p></section>
      <Notice />
      <section className="card pad"><b>যোগ্যতা (আসল তথ্য থেকে)</b>
        {err && <p className="form-err">{err}</p>}
        {(el || []).map((r) => <div className="person" key={r.key}><span>{r.ok ? '✅' : '⬜'}</span><b className="grow">{r.label}</b><small className="muted">{r.have} / {r.need}</small></div>)}
        {a ? <p>আবেদনের অবস্থা: <b>{a.status === 'pending' ? 'রিভিউয়ে' : a.status === 'approved' ? 'অনুমোদিত' : 'বাতিল'}</b>{a.note ? ' — ' + a.note : ''}</p>
          : <button className="btn" disabled={!ok} onClick={apply}>Creator প্রোগ্রামে আবেদন</button>}
      </section>
      <section className="card pad"><b>আয় (Earnings)</b>
        <div className="admin-stats"><div className="card pad stat"><b>{sum?.pending_minor ?? 0}</b><small className="muted">Pending</small></div><div className="card pad stat"><b>{sum?.available_minor ?? 0}</b><small className="muted">Available</small></div><div className="card pad stat"><b>{sum?.paid_minor ?? 0}</b><small className="muted">Paid</small></div></div>
        {earn && !earn.length && <p className="muted">কোনো আয় নেই।</p>}
        {(earn || []).map((e) => <div className="person" key={e.id}><b className="grow">{e.kind}</b><span>{money(e.amount_minor, e.currency)}</span><small className="muted">{e.status}</small></div>)}
      </section>
      <section className="card pad"><b>Withdrawal (উইথড্র)</b>
        <p className="muted">উইথড্র এখন বন্ধ। চালু হলে আপনার দেশের পদ্ধতি এখানে দেখা যাবে।</p>
        <select className="input sel" value={country} onChange={(e) => setCountry(e.target.value)}><option value="">সব দেশ</option>{COUNTRIES.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}</select>
        <PayOptions country={country || null} direction="payout" />
        <button className="btn ghost" disabled>Request withdrawal — Coming Soon</button>
        {wd && wd.length > 0 && wd.map((w) => <div className="person" key={w.id}><b className="grow">{w.method_id}</b><span>{money(w.amount_minor, w.currency)}</span><small className="muted">{w.status}</small></div>)}
      </section>
      <section className="card pad"><b>Stars ও Virtual Gifts</b>
        <p className="muted">Stars কেনা ও গিফট পাঠানো পেমেন্ট চালুর পরে। তালিকা:</p>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>{(gifts || []).map((g) => <span key={g.id} className="chip">{g.emoji} {g.name} · {g.stars}★</span>)}</div>
      </section>
      <section className="card pad"><b>পেমেন্ট ইতিহাস</b><p className="muted">কোনো লেনদেন নেই।</p></section>
    </div>
  );
}

// ---------- Hub + page insights ----------
export function MoneyHub() {
  const items = [['#/verify', 'FYNZA Verified', 'নীল ব্যাজের আবেদন ও অবস্থা', IoShieldCheckmark], ['#/ads', 'Advertiser dashboard', 'ক্যাম্পেইন, বাজেট, অ্যানালিটিক্স', IoMegaphone], ['#/creator', 'Creator dashboard', 'যোগ্যতা, আয়, উইথড্র', IoCash], ['#/security', 'Security', 'পাসওয়ার্ড, 2FA, ডিভাইস', IoLockClosed]];
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
  return <>{ads.map((a) => <section className="card pad" key={a.id}><small className="muted">Sponsored</small><b>{a.headline}</b><p>{a.body}</p>{a.link_url && <a className="btn ghost sm" href={a.link_url} target="_blank" rel="noopener noreferrer nofollow">আরও দেখুন</a>}</section>)}</>;
}

// ---------- Report dialog (reason + details) ----------
let setRep = null;
export const askReport = (kind, target) => setRep && setRep({ kind, target });
const REASONS = [['spam', 'Spam / scam / fraud'], ['harassment', 'Harassment or threats'], ['hate', 'Hate speech'], ['sexual', 'Nudity / sexual content'], ['violence', 'Violence / harmful content'], ['fake', 'Fake account / impersonation'], ['other', 'Other']];
export function ReportLayer() {
  const [r, setR] = useState(null); const [reason, setReason] = useState('spam'); const [text, setText] = useState('');
  useEffect(() => { setRep = setR; return () => { setRep = null; }; }, []);
  if (!r) return null;
  const send = () => { report(r.kind, r.target, reason + (text.trim() ? ': ' + text.trim().slice(0, 500) : '')); toast('রিপোর্ট জমা হয়েছে। অ্যাডমিন দেখবেন — ধন্যবাদ।'); setR(null); setText(''); };
  return (
    <Sheet title="রিপোর্ট করুন" onClose={() => setR(null)}>
      {REASONS.map(([k, l]) => <label key={k} className="toggle-row"><span>{l}</span><input type="radio" name="rr" checked={reason === k} onChange={() => setReason(k)} /></label>)}
      <textarea className="input" maxLength={500} placeholder="বিস্তারিত লিখুন (ঐচ্ছিক)" value={text} onChange={(e) => setText(e.target.value)} />
      <small className="muted">রিপোর্ট শুধু অনুমোদিত অ্যাডমিনরা দেখেন। মিথ্যা রিপোর্ট করবেন না।</small>
      <button className="btn danger" onClick={send}>রিপোর্ট পাঠান</button>
    </Sheet>
  );
}
