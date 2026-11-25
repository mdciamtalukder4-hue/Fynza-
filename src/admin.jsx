import { useCallback, useEffect, useState } from 'react';
import { IoShieldCheckmark } from 'react-icons/io5';
import { useStore, me, timeAgo } from './store.js';
import * as cloud from './cloud.js';
import { toast, Empty } from './ui.jsx';
import { Head } from './more.jsx';
import { TwoFactor } from './monet.jsx';
import { sessionAal, mfaFactors, mfaLoginVerify, getSession } from './supabase.js';
import { AdminMore, MORE_TABS } from './admin2.jsx';

const KIND = { reel: 'Reel', listing: 'Listing', reel_comment: 'Reel comment', post: 'Post', comment: 'Comment', message: 'Message', user: 'User', group: 'Group', page: 'Page' };
const T = (x) => new Date(x).getTime();

function Overview() {
  const [st, setSt] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { cloud.adminStats().then(setSt).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="form-err">{err}</p>;
  if (!st) return <p className="muted">Loading…</p>;
  const cells = [['Users', st.users], ['New (7 days)', st.new_users_7d], ['Posts', st.posts], ['Open reports', st.open_reports], ['All reports', st.reports_total], ['Banned', st.banned]];
  return <div className="admin-stats">{cells.map(([l, v]) => <div className="card pad stat" key={l}><b>{v}</b><small className="muted">{l}</small></div>)}</div>;
}

function Reports() {
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => { setRows(null); cloud.adminReports(status).then(setRows).catch((e) => setErr(e.message)); }, [status]);
  useEffect(load, [load]);
  const act = async (fn, okMsg) => { try { await fn(); toast(okMsg); load(); } catch (e) { toast(e.message); } };
  return (
    <>
      <div className="tabs card" role="tablist">{[['open', 'Open'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed']].map(([k, l]) => <button key={k} role="tab" aria-selected={status === k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>)}</div>
      {err && <p className="form-err">{err}</p>}
      {rows === null && !err && <p className="muted">Loading…</p>}
      {rows && rows.length === 0 && <Empty title="No reports" />}
      {rows && rows.map((r) => (
        <article className="card pad report" key={r.id}>
          <div className="row gap"><b>{KIND[r.kind] || r.kind}</b><small className="muted grow">Reporter: @{r.reporter_username} · {timeAgo(T(r.created_at))}</small></div>
          {r.reason && <p>Reason: {r.reason}</p>}
          {r.target?.exists
            ? <blockquote className="rp-target">{r.target.author_username ? <small className="muted">@{r.target.author_username}</small> : null}<p>{r.target.text || '(no text)'}{r.target.has_media ? ' · [has photo/video]' : ''}</p></blockquote>
            : <p className="muted">This content no longer exists (deleted).</p>}
          {r.admin_note && <small className="muted">Note: {r.admin_note}</small>}
          {r.status === 'open' && (
            <div className="row gap wrap">
              {r.target?.exists && r.kind !== 'user' && <button className="btn danger sm" onClick={() => window.confirm('Delete this content?') && act(() => cloud.adminRemove(r.kind, r.target_id, 'removed after report'), 'Content deleted.')}>Remove content</button>}
              {r.target?.author_id && !r.target.banned && <button className="btn ghost sm" onClick={() => window.confirm('@' + r.target.author_username + ' — ban this user?') && act(() => cloud.adminBan(r.target.author_id, true, 'banned after report'), 'Banned.')}>Ban @{r.target.author_username}</button>}
              <button className="btn ghost sm" onClick={() => act(() => cloud.adminResolve(r.id, 'resolved', ''), 'Resolved.')}>Resolve</button>
              <button className="btn ghost sm" onClick={() => act(() => cloud.adminResolve(r.id, 'dismissed', ''), 'Dismissed.')}>Dismiss</button>
            </div>
          )}
        </article>
      ))}
    </>
  );
}

function Users() {
  const [q, setQ] = useState(''); const [rows, setRows] = useState(null); const [err, setErr] = useState('');
  const load = useCallback((term) => cloud.adminUsers(term).then(setRows).catch((e) => setErr(e.message)), []);
  useEffect(() => { const t = setTimeout(() => load(q.trim()), 300); return () => clearTimeout(t); }, [q, load]);
  const ban = async (u, on) => { if (!window.confirm((on ? 'Ban @' : 'Unban @') + u.username + '?')) return; try { await cloud.adminBan(u.id, on, on ? 'banned' : 'unbanned'); toast(on ? 'Banned.' : 'Unbanned.'); load(q.trim()); } catch (e) { toast(e.message); } };
  return (
    <>
      <input className="input" type="search" placeholder="Search by name or @username" aria-label="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
      {err && <p className="form-err">{err}</p>}
      <section className="card pad">
        {rows && rows.length === 0 && <p className="muted">No one found.</p>}
        {rows && rows.map((u) => (
          <div className="person" key={u.id}><div className="grow"><b>{u.name}</b> <small className="muted">@{u.username}{u.role === 'admin' ? ' · admin' : ''}{u.banned ? ' · BANNED' : ''}</small></div>
            {u.role !== 'admin' && <button className={'btn sm ' + (u.banned ? 'primary' : 'ghost')} onClick={() => ban(u, !u.banned)}>{u.banned ? 'Unban' : 'Ban'}</button>}
          </div>
        ))}
      </section>
    </>
  );
}

function Log() {
  const [rows, setRows] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { cloud.adminLog().then(setRows).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="form-err">{err}</p>;
  if (!rows) return <p className="muted">Loading…</p>;
  return <section className="card pad">{rows.length === 0 && <p className="muted">No actions yet.</p>}{rows.map((a) => <div className="person" key={a.id}><div className="grow"><b>{a.action}</b> <small className="muted">by @{a.admin_username} · {timeAgo(T(a.created_at))}</small>{a.note && <small className="muted"> · {a.note}</small>}</div></div>)}</section>;
}


// Admin actions are protected by 2FA on the server. This gate guides the owner step by step instead of showing "permission denied".
function AdminGate({ children }) {
  const [aal, setAal] = useState(sessionAal());
  const [factors, setFactors] = useState(null);
  const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { if (aal !== 'aal2') mfaFactors().then(setFactors).catch(() => setFactors([])); }, [aal]);
  if (aal === 'aal2') return children;
  const verified = (factors || []).find((f) => f.status === 'verified');
  const stepUp = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await mfaLoginVerify(verified.id, getSession().access_token, code); setAal(sessionAal()); toast('Admin tools unlocked.'); }
    catch (x) { setErr(/expired|invalid|incorrect/i.test(x.message) ? 'Wrong or expired code. Try again.' : x.message); }
    setBusy(false);
  };
  return (
    <div className="stack">
      <section className="card pad gate">
        <b>🔐 Unlock admin tools</b>
        <p className="muted">Admin actions (ban, remove content, grant badges, review cases) need a second security step, so nobody can use your admin account with only a stolen password.</p>
        {factors === null ? <p className="muted">Checking…</p> : verified ? (
          <form onSubmit={stepUp} className="form">
            <label htmlFor="adc">Enter the 6-digit code from your authenticator app</label>
            <input id="adc" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            {err && <div className="form-error" role="alert">{err}</div>}
            <button className="btn primary big" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Unlock admin tools'}</button>
          </form>
        ) : (<><p><b>Step 1.</b> Turn on 2FA below (Google Authenticator / Authy). Step 2 happens automatically.</p><TwoFactor onDone={() => setAal(sessionAal())} /></>)}
      </section>
    </div>
  );
}

export function Admin() {
  const s = useStore();
  const user = me(s);
  const [tab, setTab] = useState('overview');
  if (!user.cloud || user.role !== 'admin') return <Empty title="This page is for admins only" text="Log in with an admin account in online mode to see this."><a className="btn primary sm" href="#/feed">Home</a></Empty>;
  return (
    <AdminGate>
    <div className="stack">
      <Head title="Admin" />
      <div className="tabs card" role="tablist">{[['overview', 'Overview'], ['reports', 'Reports'], ['users', 'Users'], ...MORE_TABS, ['log', 'Log']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'overview' && <Overview />}{tab === 'reports' && <Reports />}{tab === 'users' && <Users />}{tab === 'log' && <Log />}<AdminMore tab={tab} />
    </div>
    </AdminGate>
  );
}
export const AdminIcon = IoShieldCheckmark;
