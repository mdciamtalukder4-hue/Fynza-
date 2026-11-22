import { useCallback, useEffect, useState } from 'react';
import { IoShieldCheckmark } from 'react-icons/io5';
import { useStore, me, timeAgo } from './store.js';
import * as cloud from './cloud.js';
import { toast, Empty } from './ui.jsx';
import { Head } from './more.jsx';
import { AdminMore, MORE_TABS } from './admin2.jsx';

const KIND = { post: 'পোস্ট', comment: 'কমেন্ট', message: 'মেসেজ', user: 'ইউজার', group: 'গ্রুপ', page: 'পেজ' };
const T = (x) => new Date(x).getTime();

function Overview() {
  const [st, setSt] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { cloud.adminStats().then(setSt).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="form-err">{err}</p>;
  if (!st) return <p className="muted">লোড হচ্ছে…</p>;
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
      {rows === null && !err && <p className="muted">লোড হচ্ছে…</p>}
      {rows && rows.length === 0 && <Empty title="কোনো রিপোর্ট নেই" />}
      {rows && rows.map((r) => (
        <article className="card pad report" key={r.id}>
          <div className="row gap"><b>{KIND[r.kind] || r.kind}</b><small className="muted grow">রিপোর্টার: @{r.reporter_username} · {timeAgo(T(r.created_at))}</small></div>
          {r.reason && <p>কারণ: {r.reason}</p>}
          {r.target?.exists
            ? <blockquote className="rp-target">{r.target.author_username ? <small className="muted">@{r.target.author_username}</small> : null}<p>{r.target.text || '(লেখা নেই)'}{r.target.has_media ? ' · [ছবি/ভিডিও আছে]' : ''}</p></blockquote>
            : <p className="muted">এই কনটেন্ট আর নেই (মুছে গেছে)।</p>}
          {r.admin_note && <small className="muted">নোট: {r.admin_note}</small>}
          {r.status === 'open' && (
            <div className="row gap wrap">
              {r.target?.exists && r.kind !== 'user' && <button className="btn danger sm" onClick={() => window.confirm('এই কনটেন্ট মুছে ফেলবেন?') && act(() => cloud.adminRemove(r.kind, r.target_id, 'removed after report'), 'কনটেন্ট মুছে ফেলা হয়েছে।')}>Remove content</button>}
              {r.target?.author_id && !r.target.banned && <button className="btn ghost sm" onClick={() => window.confirm('@' + r.target.author_username + ' কে ব্যান করবেন?') && act(() => cloud.adminBan(r.target.author_id, true, 'banned after report'), 'ব্যান করা হয়েছে।')}>Ban @{r.target.author_username}</button>}
              <button className="btn ghost sm" onClick={() => act(() => cloud.adminResolve(r.id, 'resolved', ''), 'Resolved।')}>Resolve</button>
              <button className="btn ghost sm" onClick={() => act(() => cloud.adminResolve(r.id, 'dismissed', ''), 'Dismissed।')}>Dismiss</button>
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
  const ban = async (u, on) => { if (!window.confirm((on ? 'ব্যান করবেন: @' : 'আনব্যান করবেন: @') + u.username + '?')) return; try { await cloud.adminBan(u.id, on, on ? 'banned' : 'unbanned'); toast(on ? 'ব্যান করা হয়েছে।' : 'আনব্যান করা হয়েছে।'); load(q.trim()); } catch (e) { toast(e.message); } };
  return (
    <>
      <input className="input" type="search" placeholder="নাম বা @ইউজারনেম খুঁজুন" aria-label="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
      {err && <p className="form-err">{err}</p>}
      <section className="card pad">
        {rows && rows.length === 0 && <p className="muted">কেউ নেই।</p>}
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
  if (!rows) return <p className="muted">লোড হচ্ছে…</p>;
  return <section className="card pad">{rows.length === 0 && <p className="muted">এখনও কোনো অ্যাকশন নেই।</p>}{rows.map((a) => <div className="person" key={a.id}><div className="grow"><b>{a.action}</b> <small className="muted">by @{a.admin_username} · {timeAgo(T(a.created_at))}</small>{a.note && <small className="muted"> · {a.note}</small>}</div></div>)}</section>;
}

export function Admin() {
  const s = useStore();
  const user = me(s);
  const [tab, setTab] = useState('overview');
  if (!user.cloud || user.role !== 'admin') return <Empty title="এই পাতা শুধু অ্যাডমিনদের জন্য" text="অনলাইন মোডে অ্যাডমিন অ্যাকাউন্ট দিয়ে লগইন করলে এটি দেখা যায়।"><a className="btn primary sm" href="#/feed">Home</a></Empty>;
  return (
    <div className="stack">
      <Head title="Admin" />
      <div className="tabs card" role="tablist">{[['overview', 'Overview'], ['reports', 'Reports'], ['users', 'Users'], ...MORE_TABS, ['log', 'Log']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'overview' && <Overview />}{tab === 'reports' && <Reports />}{tab === 'users' && <Users />}{tab === 'log' && <Log />}<AdminMore tab={tab} />
    </div>
  );
}
export const AdminIcon = IoShieldCheckmark;
