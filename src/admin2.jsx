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
  if (!u) return <button className="btn ghost sm" onClick={show}>View document and selfie (1-hour link)</button>;
  return <div className="row gap wrap"><a href={u[a.doc_path]} target="_blank" rel="noopener noreferrer">Document</a><a href={u[a.selfie_path]} target="_blank" rel="noopener noreferrer">Selfie</a></div>;
}
function VerifyQueue() {
  const [st, setSt] = useState('pending');
  const [rows, err, load] = useRows(() => cloud.adminVerifications(st), [st]);
  const act = async (a, ok) => {
    const note = ok ? '' : window.prompt('Rejection reason (the user will see this):') || '';
    if (!ok && !note) return;
    try { await cloud.adminReviewVerification(a.id, ok, note); toast(ok ? 'Identity approved.' : 'Rejected.'); load(); } catch (e) { toast(e.message); }
  };
  return (
    <>
      <Seg v={st} set={setSt} items={[['pending', 'Pending'], ['identity_approved', 'ID approved'], ['approved', 'Approved'], ['rejected', 'Rejected']]} />
      <Err e={err} />{rows && !rows.length && <Empty title="No applications" />}
      {(rows || []).map((a) => (
        <article className="card pad" key={a.id}>
          <b>{a.page_id ? 'Page: ' + a.page_name : '@' + a.username}</b> <small className="muted">{a.doc_type} · {timeAgo(T(a.created_at))} · account age {a.account_age_days} days</small>
          <p>Name on document: <b>{a.full_name}</b> · Profile name: {a.account_name}</p>
          {a.name_clash && <p className="form-err">⚠ Another verified account already uses this name — could be impersonation, review carefully.</p>}
          <DocLinks a={a} />
          {a.status === 'pending' && <div className="row gap wrap"><button className="btn sm primary" onClick={() => act(a, true)}>Approve identity</button><button className="btn sm ghost" onClick={() => act(a, false)}>Reject</button></div>}
          {a.admin_note && <small className="muted">Note: {a.admin_note}</small>}
        </article>
      ))}
    </>
  );
}
function Grants() {
  const [q, setQ] = useState(''); const [users, setUsers] = useState([]); const [reason, setReason] = useState('');
  const [hist, herr, loadH] = useRows(cloud.adminBadgeHistory, []);
  useEffect(() => { if (q.trim().length < 2) { setUsers([]); return undefined; } const t = setTimeout(() => cloud.adminUsers(q.trim()).then(setUsers).catch(() => {}), 300); return () => clearTimeout(t); }, [q]);
  const run = async (fn, m) => { if (reason.trim().length < 5) return toast('Enter a reason (at least 5 characters).'); try { await fn(); toast(m); setReason(''); loadH(); } catch (e) { toast(e.message); } };
  return (
    <>
      <section className="card pad"><b>Special badge (no payment)</b>
        <p className="muted">A reason is required; who, to whom, when and why are all kept in the history. To give a badge to a page, use the page ID.</p>
        <input className="input" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <input className="input" type="search" placeholder="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
        {users.slice(0, 6).map((u) => (
          <div className="person" key={u.id}><div className="grow"><b>{u.name}</b> <small className="muted">@{u.username}</small></div>
            <button className="btn sm primary" onClick={() => run(() => cloud.adminGrantBadge(u.id, null, reason), 'Badge granted.')}>Grant</button>
            <button className="btn sm ghost" onClick={() => run(() => cloud.adminRevokeBadge(u.id, null, reason), 'Badge revoked.')}>Revoke</button></div>
        ))}
      </section>
      <section className="card pad"><b>Badge history</b><Err e={herr} />
        {hist && !hist.length && <p className="muted">Nothing here.</p>}
        {(hist || []).map((h) => <div className="person" key={h.id}><Badge on /><div className="grow"><b>{h.recipient}</b> <small className="muted">({h.recipient_kind}) · {h.kind} · by @{h.granted_by_username} · {timeAgo(T(h.created_at))}</small><small className="muted">Reason: {h.reason}{h.revoked_at ? ' · revoked: ' + h.revoke_reason : ''}</small></div></div>)}
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
    const label = { reject: 'Reject (no action)', warn: 'Send warning', remove: 'Remove content', suspend: 'Suspend' }[d];
    if (!window.confirm(label + ' — are you sure?')) return;
    try { await cloud.adminDecideCase(c.id, d, msgs[c.id] ?? c.draft_warning, ''); toast('Done.'); load(); } catch (e) { toast(e.message); }
  };
  return (
    <>
      <section className="card pad"><small className="muted">AI Guardian only does rule-based detection and gives recommendations. No warning, removal or suspension happens without your approval. Private messages are not read (only reported messages).</small></section>
      <Seg v={st} set={setSt} items={[['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']]} />
      <Err e={err} />{rows && !rows.length && <Empty title="No cases" />}
      {(rows || []).map((c) => (
        <article className="card pad report" key={c.id}>
          <b>{c.kind}</b> <small className="muted">· {c.source === 'auto' ? 'Auto-detected' : 'Report'} · Risk: {c.risk} · Reports {c.report_count} · @{c.target_username || '?'} · {timeAgo(T(c.created_at))}</small>
          <p>Rule violated: <b>{c.rule_violated || '—'}</b> · Recommended: <b>{c.recommended}</b></p>
          <blockquote className="rp-target"><small className="muted">Evidence</small><p>{typeof c.evidence === 'string' ? c.evidence : (c.evidence?.text || c.evidence?.snapshot || JSON.stringify(c.evidence))}</p></blockquote>
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
          ) : <small className="muted">Decision: {c.decision} {c.decision_note}</small>}
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
      <section className="card pad"><b>Suspicious accounts (signals only — not proof)</b>
        {sus && !sus.length && <p className="muted">None.</p>}
        {(sus || []).map((u) => <div className="person" key={u.id}><div className="grow"><b>@{u.username}</b><small className="muted">{(u.signals || []).join(' · ')}</small></div><small className="muted">{timeAgo(T(u.created_at))}</small></div>)}
      </section>
      <section className="card pad"><b>Warning history</b>
        {warn && !warn.length && <p className="muted">No warnings sent.</p>}
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
    if (!m.enabled && !m.integration_ready) return toast('The provider for this method is not connected yet — integration is needed first.');
    try { await cloud.adminSetPayment(m.id, !m.enabled); toast(m.enabled ? 'Turned off.' : 'Turned on.'); load(); } catch (e) { toast(e.message); }
  };
  const savePlan = async () => { try { const d = ['JPY', 'KRW', 'VND'].includes(cur) ? 1 : 100; await cloud.adminUpsertPlan(cur, Math.round(parseFloat(amt) * d)); toast('Price saved.'); setAmt(''); loadP(); } catch (e) { toast(e.message); } };
  const saveSet = async (k) => { try { await cloud.adminSetSetting(k, cf[k] ?? g(k)); toast('Saved.'); loadS(); } catch (e) { toast(e.message); } };
  const gl = (sets || []).find((x) => x.key === 'payments_enabled')?.value === 'true';
  return (
    <>
      <section className="card pad"><b>Global payment switch: {gl ? 'ON' : 'OFF'}</b><p className="muted">This cannot be turned on from the app — a developer will turn it on in the Supabase SQL editor once the merchant account and integration are ready. Each method can be turned on/off separately, but it will not turn on unless it is &quot;integration ready&quot;.</p></section>
      <Err e={err} />
      <section className="card pad"><b>Payment methods</b>
        {(rows || []).map((m) => (
          <div className="person" key={m.id}><div className="grow"><b>{m.name}</b><small className="muted">{m.direction} · {m.countries.length ? m.countries.join(',') : 'worldwide'} · Required: {m.config_required}</small><small className="muted">{m.integration_ready ? 'integration ready' : 'provider not connected'}</small></div>
            <button className={'btn sm ' + (m.enabled ? 'primary' : 'ghost')} onClick={() => toggle(m)}>{m.enabled ? 'Enabled' : 'Disabled'}</button></div>
        ))}
      </section>
      <section className="card pad"><b>FYNZA Verified monthly price</b>
        {(plans || []).map((p) => <div className="person" key={p.id}><b className="grow">{p.currency}</b><span>{money(p.amount_minor, p.currency)}</span></div>)}
        <div className="row gap"><select className="input sel" value={cur} onChange={(e) => setCur(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select><input className="input" inputMode="decimal" placeholder="Amount" value={amt} onChange={(e) => setAmt(e.target.value)} /><button className="btn sm" disabled={!amt} onClick={savePlan}>Save</button></div>
      </section>
      <section className="card pad"><b>Creator eligibility rules</b>
        {[['creator_min_followers', 'Minimum followers'], ['creator_min_account_days', 'Minimum account age (days)'], ['creator_min_posts', 'Minimum posts'], ['creator_revenue_share_percent', 'Revenue share % (empty = not decided yet)']].map(([k, l]) => (
          <div className="row gap" key={k}><label className="grow">{l}<input className="input" inputMode="numeric" value={cf[k] ?? g(k)} onChange={(e) => setCf({ ...cf, [k]: e.target.value })} /></label><button className="btn sm" onClick={() => saveSet(k)}>Save</button></div>
        ))}
      </section>
    </>
  );
}

// ----- Ads & creators review -----
function Business() {
  const [ads, e1, l1] = useRows(() => cloud.adminAds('pending_review'), []);
  const [cr, e2, l2] = useRows(() => cloud.adminCreatorApps('pending'), []);
  const reviewAd = async (c, ok) => { const r = ok ? '' : window.prompt('Rejection reason:') || ''; if (!ok && !r) return; try { await cloud.adminReviewAd(c.id, ok, r); toast('Done.'); l1(); } catch (e) { toast(e.message); } };
  const reviewCr = async (u, ok) => { const n = ok ? '' : window.prompt('Reason:') || ''; if (!ok && !n) return; try { await cloud.adminReviewCreator(u.user_id, ok, n); toast('Done.'); l2(); } catch (e) { toast(e.message); } };
  return (
    <>
      <Err e={e1 || e2} />
      <section className="card pad"><b>Ad review</b><p className="muted">Even if approved, ads do not go live unless payments are enabled.</p>
        {ads && !ads.length && <p className="muted">Nothing here.</p>}
        {(ads || []).map((c) => <div className="card pad" key={c.id}><b>{c.name}</b> <small className="muted">@{c.owner_username} · {money(c.budget_minor, c.currency)}</small><p>{c.headline}</p><p className="muted">{c.body}</p><div className="row gap"><button className="btn sm primary" onClick={() => reviewAd(c, true)}>Approve</button><button className="btn sm ghost" onClick={() => reviewAd(c, false)}>Reject</button></div></div>)}
      </section>
      <section className="card pad"><b>Creator applications</b>
        {cr && !cr.length && <p className="muted">Nothing here.</p>}
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
