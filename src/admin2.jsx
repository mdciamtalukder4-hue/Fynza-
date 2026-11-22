import { useCallback, useEffect, useState } from 'react';
import { timeAgo } from './store.js';
import * as cloud from './cloud.js';
import { signUrls } from './supabase.js';
import { toast, Empty, Badge } from './ui.jsx';
import { CURRENCIES, money } from './monet.jsx';

const T = (x) => new Date(x).getTime();
function useRows(fn, deps) {
  const [rows, setRows] = useState(null); const [err, setErr] = useState('');
  const load = useCallback(() => { setErr(''); Promise.resolve().then(fn).then(setRows).catch((e) => setErr(e.message)); }, deps); // eslint-disable-line
  useEffect(load, [load]);
  return [rows, err, load];
}
const Err = ({ e }) => (e ? <p className="form-err">{e}</p> : null);
const Seg = ({ v, set, items }) => <div className="tabs card" role="tablist">{items.map(([k, l]) => <button key={k} role="tab" aria-selected={v === k} className={v === k ? 'on' : ''} onClick={() => set(k)}>{l}</button>)}</div>;

// ----- Verification queue + special grants -----
function DocLinks({ a }) {
  const [u, setU] = useState(null);
  const show = async () => { try { setU(await signUrls('verify', [a.doc_path, a.selfie_path])); } catch (e) { toast(e.message); } };
  if (!u) return <button className="btn ghost sm" onClick={show}>ডকুমেন্ট ও সেলফি দেখুন (১ ঘণ্টার লিংক)</button>;
  return <div className="row gap wrap"><a href={u[a.doc_path]} target="_blank" rel="noopener noreferrer">ডকুমেন্ট</a><a href={u[a.selfie_path]} target="_blank" rel="noopener noreferrer">সেলফি</a></div>;
}
function VerifyQueue() {
  const [st, setSt] = useState('pending');
  const [rows, err, load] = useRows(() => cloud.adminVerifications(st), [st]);
  const act = async (a, ok) => {
    const note = ok ? '' : window.prompt('বাতিলের কারণ (ব্যবহারকারী দেখবেন):') || '';
    if (!ok && !note) return;
    try { await cloud.adminReviewVerification(a.id, ok, note); toast(ok ? 'পরিচয় অনুমোদিত।' : 'বাতিল করা হয়েছে।'); load(); } catch (e) { toast(e.message); }
  };
  return (
    <>
      <Seg v={st} set={setSt} items={[['pending', 'Pending'], ['identity_approved', 'ID approved'], ['approved', 'Approved'], ['rejected', 'Rejected']]} />
      <Err e={err} />{rows && !rows.length && <Empty title="কোনো আবেদন নেই" />}
      {(rows || []).map((a) => (
        <article className="card pad" key={a.id}>
          <b>{a.page_id ? 'পেজ: ' + a.page_name : '@' + a.username}</b> <small className="muted">{a.doc_type} · {timeAgo(T(a.created_at))} · অ্যাকাউন্টের বয়স {a.account_age_days} দিন</small>
          <p>ডকুমেন্টের নাম: <b>{a.full_name}</b> · প্রোফাইল নাম: {a.account_name}</p>
          {a.name_clash && <p className="form-err">⚠ এই নামে আগে থেকেই অন্য ভেরিফায়েড অ্যাকাউন্ট আছে — ছদ্মবেশ হতে পারে, সতর্কভাবে দেখুন।</p>}
          <DocLinks a={a} />
          {a.status === 'pending' && <div className="row gap wrap"><button className="btn sm primary" onClick={() => act(a, true)}>পরিচয় অনুমোদন</button><button className="btn sm ghost" onClick={() => act(a, false)}>বাতিল</button></div>}
          {a.admin_note && <small className="muted">নোট: {a.admin_note}</small>}
        </article>
      ))}
    </>
  );
}
function Grants() {
  const [q, setQ] = useState(''); const [users, setUsers] = useState([]); const [reason, setReason] = useState('');
  const [hist, herr, loadH] = useRows(cloud.adminBadgeHistory, []);
  useEffect(() => { if (q.trim().length < 2) { setUsers([]); return undefined; } const t = setTimeout(() => cloud.adminUsers(q.trim()).then(setUsers).catch(() => {}), 300); return () => clearTimeout(t); }, [q]);
  const run = async (fn, m) => { if (reason.trim().length < 5) return toast('কারণ লিখুন (কমপক্ষে ৫ অক্ষর)।'); try { await fn(); toast(m); setReason(''); loadH(); } catch (e) { toast(e.message); } };
  return (
    <>
      <section className="card pad"><b>বিশেষ ব্যাজ (বিনা পেমেন্টে)</b>
        <p className="muted">কারণ বাধ্যতামূলক; কে, কাকে, কখন, কেন — সব ইতিহাসে থাকে। পেজে ব্যাজ দিতে পেজের আইডি ব্যবহার করুন।</p>
        <input className="input" placeholder="কারণ" value={reason} onChange={(e) => setReason(e.target.value)} />
        <input className="input" type="search" placeholder="ইউজার খুঁজুন" value={q} onChange={(e) => setQ(e.target.value)} />
        {users.slice(0, 6).map((u) => (
          <div className="person" key={u.id}><div className="grow"><b>{u.name}</b> <small className="muted">@{u.username}</small></div>
            <button className="btn sm primary" onClick={() => run(() => cloud.adminGrantBadge(u.id, null, reason), 'ব্যাজ দেওয়া হয়েছে।')}>Grant</button>
            <button className="btn sm ghost" onClick={() => run(() => cloud.adminRevokeBadge(u.id, null, reason), 'ব্যাজ সরানো হয়েছে।')}>Revoke</button></div>
        ))}
      </section>
      <section className="card pad"><b>ব্যাজ ইতিহাস</b><Err e={herr} />
        {hist && !hist.length && <p className="muted">কিছু নেই।</p>}
        {(hist || []).map((h) => <div className="person" key={h.id}><Badge on /><div className="grow"><b>{h.recipient}</b> <small className="muted">({h.recipient_kind}) · {h.kind} · by @{h.granted_by_username} · {timeAgo(T(h.created_at))}</small><small className="muted">কারণ: {h.reason}{h.revoked_at ? ' · সরানো হয়েছে: ' + h.revoke_reason : ''}</small></div></div>)}
      </section>
    </>
  );
}

// ----- AI Guardian cases (recommend only; admin decides) -----
function Cases() {
  const [st, setSt] = useState('pending');
  const [rows, err, load] = useRows(() => cloud.adminCases(st), [st]);
  const [msgs, setMsgs] = useState({});
  const decide = async (c, d) => {
    const label = { reject: 'বাতিল (কোনো ব্যবস্থা নয়)', warn: 'ওয়ার্নিং পাঠান', remove: 'কনটেন্ট মুছুন', suspend: 'সাসপেন্ড' }[d];
    if (!window.confirm(label + ' — নিশ্চিত?')) return;
    try { await cloud.adminDecideCase(c.id, d, msgs[c.id] ?? c.draft_warning, ''); toast('সম্পন্ন।'); load(); } catch (e) { toast(e.message); }
  };
  return (
    <>
      <section className="card pad"><small className="muted">AI Guardian শুধু নিয়মভিত্তিক শনাক্তকরণ করে ও সুপারিশ দেয়। আপনি অনুমোদন না দিলে কোনো ওয়ার্নিং, মোছা বা সাসপেন্ড হয় না। প্রাইভেট মেসেজ পড়া হয় না (শুধু রিপোর্ট করা মেসেজ)।</small></section>
      <Seg v={st} set={setSt} items={[['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']]} />
      <Err e={err} />{rows && !rows.length && <Empty title="কোনো কেস নেই" />}
      {(rows || []).map((c) => (
        <article className="card pad report" key={c.id}>
          <b>{c.kind}</b> <small className="muted">· {c.source === 'auto' ? 'স্বয়ংক্রিয় শনাক্ত' : 'রিপোর্ট'} · ঝুঁকি: {c.risk} · রিপোর্ট {c.report_count} · @{c.target_username || '?'} · {timeAgo(T(c.created_at))}</small>
          <p>লঙ্ঘিত নিয়ম: <b>{c.rule_violated || '—'}</b> · সুপারিশ: <b>{c.recommended}</b></p>
          <blockquote className="rp-target"><small className="muted">প্রমাণ</small><p>{typeof c.evidence === 'string' ? c.evidence : (c.evidence?.text || c.evidence?.snapshot || JSON.stringify(c.evidence))}</p></blockquote>
          {c.status === 'pending' ? (
            <>
              <textarea className="input" maxLength={500} value={msgs[c.id] ?? c.draft_warning} onChange={(e) => setMsgs({ ...msgs, [c.id]: e.target.value })} aria-label="Warning message" />
              <div className="row gap wrap">
                <button className="btn sm primary" onClick={() => decide(c, 'warn')}>Approve warning</button>
                {c.kind !== 'user' && <button className="btn sm ghost" onClick={() => decide(c, 'remove')}>Approve remove</button>}
                <button className="btn sm ghost" onClick={() => decide(c, 'suspend')}>Approve suspend</button>
                <button className="btn sm ghost" onClick={() => decide(c, 'reject')}>Reject</button>
              </div>
            </>
          ) : <small className="muted">সিদ্ধান্ত: {c.decision} {c.decision_note}</small>}
        </article>
      ))}
    </>
  );
}
function Safety() {
  const [sum, e1] = useRows(cloud.adminSecuritySummary, []);
  const [sus, e2] = useRows(cloud.adminSuspicious, []);
  const [warn, e3] = useRows(cloud.adminWarnings, []);
  const s = Array.isArray(sum) ? sum[0] : sum;
  return (
    <>
      <Err e={e1 || e2 || e3} />
      {s && <div className="admin-stats">{[['Locked logins', s.active_lockouts], ['New-device 24h', s.new_device_logins_24h], ['Open cases', s.open_cases], ['Pending verifications', s.pending_verifications], ['Admins w/o 2FA', s.admins_without_2fa]].map(([l, v]) => <div className="card pad stat" key={l}><b>{v}</b><small className="muted">{l}</small></div>)}</div>}
      <section className="card pad"><b>সন্দেহজনক অ্যাকাউন্ট (শুধু সংকেত — প্রমাণ নয়)</b>
        {sus && !sus.length && <p className="muted">নেই।</p>}
        {(sus || []).map((u) => <div className="person" key={u.id}><div className="grow"><b>@{u.username}</b><small className="muted">{(u.signals || []).join(' · ')}</small></div><small className="muted">{timeAgo(T(u.created_at))}</small></div>)}
      </section>
      <section className="card pad"><b>ওয়ার্নিং ইতিহাস</b>
        {warn && !warn.length && <p className="muted">কোনো ওয়ার্নিং পাঠানো হয়নি।</p>}
        {(warn || []).map((w) => <div className="person" key={w.id}><div className="grow"><b>@{w.username}</b> <small className="muted">{w.rule} · approved by @{w.approved_by_username}</small><small className="muted">{w.message}</small></div><small className="muted">{timeAgo(T(w.created_at))}</small></div>)}
      </section>
    </>
  );
}

// ----- Payments control (all off) -----
function Payments() {
  const [rows, err, load] = useRows(cloud.adminPaymentMethods, []);
  const [plans, , loadP] = useRows(() => cloud.verifiedPlans(), []);
  const [cur, setCur] = useState('USD'); const [amt, setAmt] = useState('');
  const [sets, , loadS] = useRows(cloud.adminSettings, []);
  const g = (k) => (sets || []).find((x) => x.key === k)?.value ?? '';
  const [cf, setCf] = useState({});
  const toggle = async (m) => {
    if (!m.enabled && !m.integration_ready) return toast('এই মেথডের প্রোভাইডার এখনও সংযুক্ত হয়নি — আগে ইন্টিগ্রেশন লাগবে।');
    try { await cloud.adminSetPayment(m.id, !m.enabled); toast(m.enabled ? 'বন্ধ করা হয়েছে।' : 'চালু করা হয়েছে।'); load(); } catch (e) { toast(e.message); }
  };
  const savePlan = async () => { try { const d = ['JPY', 'KRW', 'VND'].includes(cur) ? 1 : 100; await cloud.adminUpsertPlan(cur, Math.round(parseFloat(amt) * d)); toast('মূল্য সেভ হয়েছে।'); setAmt(''); loadP(); } catch (e) { toast(e.message); } };
  const saveSet = async (k) => { try { await cloud.adminSetSetting(k, cf[k] ?? g(k)); toast('সেভ হয়েছে।'); loadS(); } catch (e) { toast(e.message); } };
  const gl = (sets || []).find((x) => x.key === 'payments_enabled')?.value === 'true';
  return (
    <>
      <section className="card pad"><b>গ্লোবাল পেমেন্ট সুইচ: {gl ? 'চালু' : 'বন্ধ'}</b><p className="muted">এটি অ্যাপ থেকে চালু করা যায় না — Supabase SQL এডিটরে ডেভেলপার তখনই চালু করবেন যখন মার্চেন্ট অ্যাকাউন্ট ও ইন্টিগ্রেশন তৈরি হবে। প্রতিটি মেথড আলাদাভাবে চালু/বন্ধ করা যায়, তবে &quot;integration ready&quot; না হলে চালু হয় না।</p></section>
      <Err e={err} />
      <section className="card pad"><b>পেমেন্ট মেথড</b>
        {(rows || []).map((m) => (
          <div className="person" key={m.id}><div className="grow"><b>{m.name}</b><small className="muted">{m.direction} · {m.countries.length ? m.countries.join(',') : 'worldwide'} · প্রয়োজন: {m.config_required}</small><small className="muted">{m.integration_ready ? 'integration ready' : 'provider not connected'}</small></div>
            <button className={'btn sm ' + (m.enabled ? 'primary' : 'ghost')} onClick={() => toggle(m)}>{m.enabled ? 'Enabled' : 'Disabled'}</button></div>
        ))}
      </section>
      <section className="card pad"><b>FYNZA Verified মাসিক মূল্য</b>
        {(plans || []).map((p) => <div className="person" key={p.id}><b className="grow">{p.currency}</b><span>{money(p.amount_minor, p.currency)}</span></div>)}
        <div className="row gap"><select className="input sel" value={cur} onChange={(e) => setCur(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select><input className="input" inputMode="decimal" placeholder="পরিমাণ" value={amt} onChange={(e) => setAmt(e.target.value)} /><button className="btn sm" disabled={!amt} onClick={savePlan}>সেভ</button></div>
      </section>
      <section className="card pad"><b>Creator যোগ্যতার নিয়ম</b>
        {[['creator_min_followers', 'ন্যূনতম ফলোয়ার'], ['creator_min_account_days', 'ন্যূনতম অ্যাকাউন্ট বয়স (দিন)'], ['creator_min_posts', 'ন্যূনতম পোস্ট'], ['creator_revenue_share_percent', 'রেভিনিউ শেয়ার % (ফাঁকা = এখনও ঠিক হয়নি)']].map(([k, l]) => (
          <div className="row gap" key={k}><label className="grow">{l}<input className="input" inputMode="numeric" value={cf[k] ?? g(k)} onChange={(e) => setCf({ ...cf, [k]: e.target.value })} /></label><button className="btn sm" onClick={() => saveSet(k)}>সেভ</button></div>
        ))}
      </section>
    </>
  );
}

// ----- Ads & creators review -----
function Business() {
  const [ads, e1, l1] = useRows(() => cloud.adminAds('pending_review'), []);
  const [cr, e2, l2] = useRows(() => cloud.adminCreatorApps('pending'), []);
  const reviewAd = async (c, ok) => { const r = ok ? '' : window.prompt('বাতিলের কারণ:') || ''; if (!ok && !r) return; try { await cloud.adminReviewAd(c.id, ok, r); toast('সম্পন্ন।'); l1(); } catch (e) { toast(e.message); } };
  const reviewCr = async (u, ok) => { const n = ok ? '' : window.prompt('কারণ:') || ''; if (!ok && !n) return; try { await cloud.adminReviewCreator(u.user_id, ok, n); toast('সম্পন্ন।'); l2(); } catch (e) { toast(e.message); } };
  return (
    <>
      <Err e={e1 || e2} />
      <section className="card pad"><b>বিজ্ঞাপন রিভিউ</b><p className="muted">অনুমোদিত হলেও পেমেন্ট চালু না থাকলে বিজ্ঞাপন চালু হয় না।</p>
        {ads && !ads.length && <p className="muted">কিছু নেই।</p>}
        {(ads || []).map((c) => <div className="card pad" key={c.id}><b>{c.name}</b> <small className="muted">@{c.owner_username} · {money(c.budget_minor, c.currency)}</small><p>{c.headline}</p><p className="muted">{c.body}</p><div className="row gap"><button className="btn sm primary" onClick={() => reviewAd(c, true)}>Approve</button><button className="btn sm ghost" onClick={() => reviewAd(c, false)}>Reject</button></div></div>)}
      </section>
      <section className="card pad"><b>Creator আবেদন</b>
        {cr && !cr.length && <p className="muted">কিছু নেই।</p>}
        {(cr || []).map((u) => <div className="person" key={u.user_id}><div className="grow"><b>@{u.username}</b> <small className="muted">{u.country || ''}</small></div><button className="btn sm primary" onClick={() => reviewCr(u, true)}>Approve</button><button className="btn sm ghost" onClick={() => reviewCr(u, false)}>Reject</button></div>)}
      </section>
    </>
  );
}

export function AdminMore({ tab }) {
  return (
    <>
      {tab === 'verify' && <><VerifyQueue /><Grants /></>}
      {tab === 'guardian' && <Cases />}
      {tab === 'safety' && <Safety />}
      {tab === 'payments' && <Payments />}
      {tab === 'business' && <Business />}
    </>
  );
}
export const MORE_TABS = [['verify', 'Verified'], ['guardian', 'Guardian'], ['safety', 'Safety'], ['payments', 'Payments'], ['business', 'Ads/Creators']];
