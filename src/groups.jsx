import { useEffect, useRef, useState } from 'react';
import { IoAdd, IoPeopleCircle, IoFlag, IoImage, IoArrowBack } from 'react-icons/io5';
import {
  useStore, me, createGroup, createGroupOnline, toggleGroup, createPage, createPageOnline, togglePage, addPost, addPostOnline, compressImage,
  refreshGroups, refreshFeed, addGroupMemberOnline, areFriends,
} from './store.js';
import { PageInsights } from './monet.jsx';
import { Avatar, Sheet, toast, go, back, Empty, Badge } from './ui.jsx';
import { PostCard, canSee } from './feed.jsx';
import { Head } from './more.jsx';
import * as G from './groupsApi.js';
import { IoLockClosed, IoGlobe, IoPin, IoEllipsisHorizontal, IoCamera } from 'react-icons/io5';

const useCloudSync = (user) => useEffect(() => { if (user.cloud) { refreshGroups(); refreshFeed(); } }, []); // eslint-disable-line

// ---------- Groups list ----------
function LocalGroups() {
  const s = useStore();
  const user = me(s);
  useCloudSync(user);
  const [tab, setTab] = useState('your');
  const [make, setMake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: '', desc: '', privacy: 'public' });
  const all = s.groups.filter((g) => !!g.cloud === !!user.cloud);
  const mine = all.filter((g) => g.members.includes(user.id));
  const disc = all.filter((g) => !g.members.includes(user.id) && g.privacy === 'public');
  const list = tab === 'discover' ? disc : mine;
  const create = async () => {
    if (f.name.trim().length < 3) return toast('Name must be at least 3 characters.');
    setBusy(true);
    const err = user.cloud ? await createGroupOnline(f.name.trim(), f.desc.trim(), f.privacy) : (createGroup(f.name.trim(), f.desc.trim(), f.privacy), null);
    setBusy(false);
    if (err) return toast('Could not create group: ' + err);
    setMake(false); setF({ name: '', desc: '', privacy: 'public' }); setTab('your'); toast('Group created.');
  };
  return (
    <div className="stack">
      <Head title="Groups" noBack right={<button className="btn primary sm" onClick={() => setMake(true)}><IoAdd /> Create</button>} />
      <div className="tabs card" role="tablist">{[['your', 'Your Groups'], ['discover', 'Discover']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      <section className="card pad">
        {list.length === 0 && <p className="muted">{tab === 'discover' ? 'No new public groups.' : 'You are not in any group yet — join one from Discover or create your own.'}</p>}
        {list.map((g) => {
          const joined = g.members.includes(user.id);
          return (
            <div className="person" key={g.id}>
              <a className="g-icon" href={'#/group/' + g.id} aria-label={g.name}><IoPeopleCircle size={30} /></a>
              <a className="grow" href={'#/group/' + g.id}><b>{g.name}</b><small className="muted">{g.members.length} members · {g.privacy}</small>{g.desc && <small className="muted">{g.desc}</small>}</a>
              {!(joined && g.owner === user.id) && <button className={'btn sm ' + (joined ? 'ghost' : 'primary')} onClick={() => toggleGroup(g.id)}>{joined ? 'Leave' : 'Join'}</button>}
            </div>
          );
        })}
      </section>
      {make && (
        <Sheet title="Create group" onClose={() => setMake(false)}>
          <input className="input" placeholder="Group name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Group name" />
          <textarea className="input" rows={2} placeholder="Description" maxLength={300} value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} aria-label="Description" />
          <select className="input" value={f.privacy} onChange={(e) => setF({ ...f, privacy: e.target.value })} aria-label="Privacy"><option value="public">Public — anyone can see and join</option><option value="private">Private — only members can see (the owner adds friends)</option></select>
          <button className="btn primary big" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create group'}</button>
        </Sheet>
      )}
    </div>
  );
}

// small composer for group / page posts
function MiniComposer({ placeholder, groupId, pageId }) {
  const s = useStore();
  const user = me(s);
  const [text, setText] = useState('');
  const [img, setImg] = useState('');
  const [busy, setBusy] = useState(false);
  const fi = useRef();
  const post = async () => {
    if (!text.trim() && !img) return toast('Add some text or a photo.');
    setBusy(true);
    const aud = 'public';
    const err = user.cloud ? await addPostOnline({ text: text.trim(), imgDataUrl: img, aud, groupId, pageId }) : (addPost({ text: text.trim(), img, aud, groupId, pageId }), null);
    setBusy(false);
    if (err) return toast('Post failed: ' + err);
    setText(''); setImg(''); toast('Post published.');
  };
  return (
    <section className="card pad composer">
      <textarea className="comp-input" rows={2} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} aria-label={placeholder} />
      {img && <img className="comp-prev" src={img} alt="" />}
      <div className="row gap">
        <button className="btn ghost sm" onClick={() => fi.current.click()}><IoImage /> Photo</button>
        <input ref={fi} hidden type="file" accept="image/*" onChange={async (e) => { const f = e.target.files[0]; if (f) setImg(await compressImage(f, 1000)); e.target.value = ''; }} />
        <span className="grow" />
        <button className="btn primary sm" disabled={busy} onClick={post}>{busy ? 'Posting…' : 'Post'}</button>
      </div>
    </section>
  );
}

// ---------- One group ----------
function LocalGroupPage({ id }) {
  const s = useStore();
  const user = me(s);
  useCloudSync(user);
  const [inv, setInv] = useState(false);
  const g = s.groups.find((x) => x.id === id);
  if (!g) return <Empty title="Group not found" text="This group does not exist, or it is private."><a className="btn primary sm" href="#/groups">Groups</a></Empty>;
  const joined = g.members.includes(user.id);
  const canAdd = g.owner === user.id;
  const posts = s.posts.filter((p) => p.groupId === id && canSee(s, p));
  const members = g.members.map((m) => s.users[m]).filter(Boolean);
  const invitable = Object.values(s.users).filter((u) => !!u.cloud === !!g.cloud && u.id !== user.id && !g.members.includes(u.id) && areFriends(s, user.id, u.id));
  return (
    <div className="stack">
      <div className="page-head"><button className="icon-btn" aria-label="Back" onClick={() => back('#/groups')}><IoArrowBack size={22} /></button><b>{g.name}</b></div>
      <section className="card pad">
        <div className="person"><span className="g-icon"><IoPeopleCircle size={34} /></span>
          <div className="grow"><b>{g.name}</b><small className="muted">{g.members.length} members · {g.privacy}</small>{g.desc && <small className="muted">{g.desc}</small>}</div>
          {!(joined && g.owner === user.id) && <button className={'btn sm ' + (joined ? 'ghost' : 'primary')} onClick={() => toggleGroup(g.id)}>{joined ? 'Leave' : 'Join'}</button>}
        </div>
        {canAdd && g.cloud && <button className="btn ghost sm" onClick={() => setInv(true)}><IoAdd /> Add a friend</button>}
      </section>
      {joined ? <MiniComposer placeholder="Write something in the group…" groupId={id} /> : <p className="local-note">Join the group first to post.</p>}
      {posts.length ? posts.map((p) => <PostCard key={p.id} post={p} />) : <Empty title="No posts yet" />}
      <section className="card pad"><b>Members ({members.length})</b>
        {members.map((m) => <a key={m.id} className="person" href={'#/profile/' + m.id}><Avatar user={m} size={40} /><b>{m.name}</b>{m.id === g.owner && <small className="muted">Owner</small>}</a>)}
      </section>
      {inv && (
        <Sheet title="Add a friend" onClose={() => setInv(false)}>
          {invitable.length === 0 && <p className="muted">No friends to add (only friends can be added).</p>}
          {invitable.map((u) => (
            <div className="person" key={u.id}><Avatar user={u} size={40} /><b className="grow">{u.name}</b>
              <button className="btn primary sm" onClick={async () => { const err = await addGroupMemberOnline(g.id, u.id); toast(err ? err : u.name + ' was added to the group.'); }}>Add</button></div>
          ))}
        </Sheet>
      )}
    </div>
  );
}

// ---------- Pages ----------
export function Pages() {
  const s = useStore();
  const user = me(s);
  useCloudSync(user);
  const [make, setMake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: '', kind: 'Creator', desc: '' });
  const pages = s.pages.filter((p) => !!p.cloud === !!user.cloud);
  const create = async () => {
    if (f.name.trim().length < 3) return toast('Name must be at least 3 characters.');
    setBusy(true);
    const err = user.cloud ? await createPageOnline(f.name.trim(), f.kind, f.desc.trim()) : (createPage(f.name.trim(), f.kind, f.desc.trim()), null);
    setBusy(false);
    if (err) return toast('Could not create page: ' + err);
    setMake(false); setF({ name: '', kind: 'Creator', desc: '' }); toast('Page created.');
  };
  return (
    <div className="stack">
      <Head title="Pages" right={<button className="btn primary sm" onClick={() => setMake(true)}><IoAdd /> Create</button>} />
      <section className="card pad">
        {pages.length === 0 && <p className="muted">No pages yet. Create your first Business or Creator Page.</p>}
        {pages.map((p) => (
          <div className="person" key={p.id}>
            <a className="g-icon" href={'#/page/' + p.id} aria-label={p.name}><IoFlag size={26} /></a>
            <a className="grow" href={'#/page/' + p.id}><b>{p.name}<Badge on={p.verified} /></b><small className="muted">{p.kind} · {p.followers.length} followers{p.owner === user.id ? ' · Your page' : ''}</small>{p.desc && <small className="muted">{p.desc}</small>}</a>
            {p.owner !== user.id && <button className={'btn sm ' + (p.followers.includes(user.id) ? 'ghost' : 'primary')} onClick={() => togglePage(p.id)}>{p.followers.includes(user.id) ? 'Following' : 'Follow'}</button>}
          </div>
        ))}
      </section>
      {make && (
        <Sheet title="Create page" onClose={() => setMake(false)}>
          <input className="input" placeholder="Page name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Page name" />
          <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="Page type"><option>Creator</option><option>Business</option></select>
          <textarea className="input" rows={2} placeholder="About this page" maxLength={300} value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} aria-label="About" />
          <button className="btn primary big" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create page'}</button>
        </Sheet>
      )}
    </div>
  );
}

// ---------- One page ----------
export function PagePage({ id }) {
  const s = useStore();
  const user = me(s);
  useCloudSync(user);
  const p = s.pages.find((x) => x.id === id);
  if (!p) return <Empty title="Page not found"><a className="btn primary sm" href="#/pages">Pages</a></Empty>;
  const own = p.owner === user.id;
  const posts = s.posts.filter((x) => x.pageId === id && canSee(s, x));
  return (
    <div className="stack">
      <div className="page-head"><button className="icon-btn" aria-label="Back" onClick={() => back('#/pages')}><IoArrowBack size={22} /></button><b>{p.name}</b></div>
      <section className="card pad">
        <div className="person"><span className="g-icon"><IoFlag size={30} /></span>
          <div className="grow"><b>{p.name}<Badge on={p.verified} /></b><small className="muted">{p.kind} · {p.followers.length} followers</small>{p.desc && <small className="muted">{p.desc}</small>}</div>
          {!own && <button className={'btn sm ' + (p.followers.includes(user.id) ? 'ghost' : 'primary')} onClick={() => togglePage(p.id)}>{p.followers.includes(user.id) ? 'Following' : 'Follow'}</button>}
        </div>
      </section>
      {own && <MiniComposer placeholder="Post something on the page…" pageId={id} />}
      {own && p.cloud && <PageInsights id={id} />}
      {posts.length ? posts.map((x) => <PostCard key={x.id} post={x} />) : <Empty title="No posts on this page yet" />}
    </div>
  );
}

// ======================= Online groups v2 =======================
const RANK = { owner: 4, admin: 3, moderator: 2, member: 1 };
const rk = (r) => RANK[r] || 0;
const isStaff = (r) => rk(r) >= 2;
const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', moderator: 'Moderator' };
const fmtTime = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const pickImage = async (e, max) => { const f = e.target.files[0]; e.target.value = ''; return f ? compressImage(f, max) : ''; };

function GImg({ src, kind, size }) {
  if (src) return <img className={kind === 'cover' ? 'gv2-cover-img' : 'gv2-av'} src={src} alt="" style={size ? { width: size, height: size } : undefined} />;
  return kind === 'cover' ? <div className="gv2-cover-img gv2-cover-ph" /> : <span className="gv2-av gv2-av-ph" style={size ? { width: size, height: size } : undefined}><IoPeopleCircle size={(size || 48) * 0.7} /></span>;
}
const PrivBadge = ({ p }) => <span className="gv2-badge">{p === 'private' ? <><IoLockClosed /> Private</> : <><IoGlobe /> Public</>}</span>;

function JoinButton({ g, onChanged, size = 'sm' }) {
  const [ask, setAsk] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => { setBusy(true); const r = await G.wrap(fn); setBusy(false); if (r.error) toast(r.error); else if (ok) toast(typeof ok === 'function' ? ok(r.data) : ok); setAsk(false); onChanged && onChanged(); };
  const role = g.my_role;
  if (role) return null;
  if (g.request_status === 'pending') return <button className={'btn ghost ' + size} disabled={busy} onClick={() => run(() => G.cancelJoin(g.id), 'Request cancelled.')}>Requested · Cancel</button>;
  const needs = g.privacy === 'private' || g.approval_required;
  return (
    <>
      <button className={'btn primary ' + size} disabled={busy} onClick={() => (needs ? setAsk(true) : run(() => G.requestJoin(g.id, ''), (d) => (d === 'requested' ? 'Request sent.' : 'You joined the group.')))}>{needs ? 'Request to join' : 'Join'}</button>
      {ask && (
        <Sheet title="Request to join" onClose={() => setAsk(false)}>
          <p className="muted">The group admins will review your request.</p>
          <textarea className="input" rows={3} maxLength={300} placeholder="Message to the admins (optional)" value={msg} onChange={(e) => setMsg(e.target.value)} aria-label="Message" />
          <button className="btn primary big" disabled={busy} onClick={() => run(() => G.requestJoin(g.id, msg.trim()), (d) => (d === 'joined' ? 'You joined the group.' : 'Request sent.'))}>{busy ? 'Sending…' : 'Send request'}</button>
        </Sheet>
      )}
    </>
  );
}

function CreateGroupSheet({ onClose, userId }) {
  const [f, setF] = useState({ name: '', description: '', rules: '', privacy: 'public' });
  const [cover, setCover] = useState('');
  const [busy, setBusy] = useState(false);
  const fi = useRef();
  const create = async () => {
    if (f.name.trim().length < 3) return toast('Name must be at least 3 characters.');
    setBusy(true);
    const r = await G.wrap(() => G.createGroup(userId, { ...f, name: f.name.trim(), description: f.description.trim(), rules: f.rules.trim(), coverDataUrl: cover }));
    setBusy(false);
    if (r.error) return toast('Could not create group: ' + r.error);
    toast('Group created.'); refreshGroups(); onClose(); if (r.data) go('#/group/' + r.data);
  };
  return (
    <Sheet title="Create group" onClose={onClose}>
      <input className="input" placeholder="Group name" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Group name" />
      <select className="input" value={f.privacy} onChange={(e) => setF({ ...f, privacy: e.target.value })} aria-label="Privacy"><option value="public">Public: anyone can see and join</option><option value="private">Private: members only, join by request</option></select>
      <textarea className="input" rows={2} maxLength={300} placeholder="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} aria-label="Description" />
      <textarea className="input" rows={2} maxLength={800} placeholder="Group rules (optional)" value={f.rules} onChange={(e) => setF({ ...f, rules: e.target.value })} aria-label="Rules" />
      {cover && <img className="comp-prev" src={cover} alt="Cover preview" />}
      <button className="btn ghost sm" onClick={() => fi.current.click()}><IoImage /> {cover ? 'Change cover photo' : 'Add cover photo (optional)'}</button>
      <input ref={fi} hidden type="file" accept="image/*" onChange={async (e) => setCover(await pickImage(e, 1200))} />
      <button className="btn primary big" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create group'}</button>
    </Sheet>
  );
}

function RequestRow({ r, who, onDecide, name }) {
  return (
    <div className="gv2-req">
      <div className="person">{who ? <Avatar user={who} size={40} /> : <span className="g-icon"><IoPeopleCircle size={30} /></span>}
        <div className="grow"><b>{who ? who.name : name}</b>{name && who && <small className="muted">wants to join {name}</small>}</div></div>
      {r.message && <p className="gv2-msg">{r.message}</p>}
      {onDecide && <div className="row gap"><button className="btn primary sm" onClick={() => onDecide(r, true)}>Approve</button><button className="btn ghost sm" onClick={() => onDecide(r, false)}>Decline</button></div>}
    </div>
  );
}

function OnlineGroups() {
  const s = useStore();
  const user = me(s);
  const [tab, setTab] = useState('your');
  const [make, setMake] = useState(false);
  const [mine, setMine] = useState(null);
  const [disc, setDisc] = useState(null);
  const [reqs, setReqs] = useState([]);
  const [who, setWho] = useState({});
  const [err, setErr] = useState('');
  const load = async () => {
    try {
      const [a, b] = await Promise.all([G.listGroups('mine'), G.listGroups('discover')]);
      setMine(a); setDisc(b); setErr('');
      const staffIds = a.filter((g) => isStaff(g.my_role)).map((g) => g.id);
      const rq = await G.pendingRequests(staffIds).catch(() => []);
      setReqs(rq); setWho(await G.profilesById(rq.map((x) => x.user_id)));
    } catch (e) { setErr(G.friendlyError(e)); setMine((m) => m || []); setDisc((d) => d || []); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line
  const decide = async (r, ok) => { const x = await G.wrap(() => G.decideRequest(r.id, ok)); toast(x.error || (ok ? 'Request approved.' : 'Request declined.')); load(); };
  const nameOf = (id) => [...(mine || []), ...(disc || [])].find((g) => g.id === id)?.name || 'a group';
  const myPending = (disc || []).filter((g) => g.request_status === 'pending');
  const Row = ({ g }) => (
    <div className="person">
      <a href={'#/group/' + g.id}><GImg src={g.avatar_url} size={46} /></a>
      <a className="grow" href={'#/group/' + g.id}><b>{g.name}</b><small className="muted">{g.member_count} members · {g.privacy}{g.my_role && ROLE_LABEL[g.my_role] ? ' · ' + ROLE_LABEL[g.my_role] : ''}</small>{g.description && <small className="muted">{g.description}</small>}</a>
      {!g.my_role && <JoinButton g={g} onChanged={load} />}
    </div>
  );
  const loading = mine === null || disc === null;
  const tabs = [['your', 'Your groups'], ['discover', 'Discover'], ['requests', 'Requests' + (reqs.length + myPending.length ? ` (${reqs.length + myPending.length})` : '')]];
  return (
    <div className="stack">
      <Head title="Groups" noBack right={<button className="btn primary sm" onClick={() => setMake(true)}><IoAdd /> Create</button>} />
      <div className="tabs card" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {err && <p className="local-note">{err} <button className="btn ghost sm" onClick={load}>Retry</button></p>}
      <section className="card pad">
        {loading && <p className="muted">Loading…</p>}
        {!loading && tab === 'your' && (mine.length ? mine.map((g) => <Row key={g.id} g={g} />) : <p className="muted">You are not in any group yet. Join one from Discover or create your own.</p>)}
        {!loading && tab === 'discover' && (disc.length ? disc.map((g) => <Row key={g.id} g={g} />) : <p className="muted">No new groups to discover.</p>)}
        {!loading && tab === 'requests' && (
          <>
            <b>Requests to your groups</b>
            {reqs.length === 0 && <p className="muted">No pending requests.</p>}
            {reqs.map((r) => <RequestRow key={r.id} r={r} who={who[r.user_id]} name={nameOf(r.group_id)} onDecide={decide} />)}
            <b className="gv2-h">Your pending requests</b>
            {myPending.length === 0 && <p className="muted">You have no pending requests.</p>}
            {myPending.map((g) => <div className="person" key={g.id}><a className="grow" href={'#/group/' + g.id}><b>{g.name}</b><small className="muted">Waiting for approval</small></a>
              <button className="btn ghost sm" onClick={async () => { const x = await G.wrap(() => G.cancelJoin(g.id)); toast(x.error || 'Request cancelled.'); load(); }}>Cancel</button></div>)}
          </>
        )}
      </section>
      {make && <CreateGroupSheet userId={user.id} onClose={() => { setMake(false); load(); }} />}
    </div>
  );
}

function MemberActions({ g, m, u, actor, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const a = rk(actor); const t = rk(m.role);
  const muted = m.muted_until && new Date(m.muted_until) > new Date();
  const run = async (fn, ok) => { setBusy(true); const r = await G.wrap(fn); setBusy(false); toast(r.error || ok); onDone(); if (!r.error) onClose(); };
  const items = [];
  if (actor === 'owner' && m.role !== 'admin') items.push(['Make admin', () => G.setRole(g.id, m.user_id, 'admin'), 'Now an admin.']);
  if (a >= 3 && a > t && m.role !== 'moderator') items.push(['Make moderator', () => G.setRole(g.id, m.user_id, 'moderator'), 'Now a moderator.']);
  if (a >= 3 && a > t && m.role !== 'member') items.push(['Make regular member', () => G.setRole(g.id, m.user_id, 'member'), 'Now a regular member.']);
  if (a >= 2 && a > t) items.push(muted ? ['Unmute', () => G.muteMember(g.id, m.user_id, 0), 'Member unmuted.'] : ['Mute for 24 hours', () => G.muteMember(g.id, m.user_id, 24), 'Member muted for 24 hours.']);
  if (a >= 2 && a > t) items.push(['Remove from group', () => G.removeMember(g.id, m.user_id, false), 'Member removed.', true]);
  if (a >= 3 && a > t) items.push(['Remove and ban', () => G.removeMember(g.id, m.user_id, true), 'Member removed and banned.', true]);
  return (
    <Sheet title={u ? u.name : 'Member'} onClose={onClose}>
      {items.map(([l, fn, ok, danger]) => <button key={l} disabled={busy} className={'menu-item' + (danger ? ' danger' : '')} onClick={() => run(fn, ok)}>{l}</button>)}
      {!items.length && <p className="muted">No actions available.</p>}
    </Sheet>
  );
}

function ManageSheet({ g, user, onClose, onDone, friends }) {
  const [f, setF] = useState({ name: g.name, description: g.description || '', rules: g.rules || '', privacy: g.privacy, approval: !!g.approval_required });
  const [cover, setCover] = useState(''); const [avatar, setAvatar] = useState('');
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const [add, setAdd] = useState(false);
  const [banned, setBanned] = useState([]); const [bw, setBw] = useState({});
  const cf = useRef(); const af = useRef();
  useEffect(() => { G.bans(g.id).then(async (b) => { setBanned(b || []); setBw(await G.profilesById((b || []).map((x) => x.user_id))); }); }, [g.id]);
  const save = async () => {
    if (f.name.trim().length < 3) return toast('Name must be at least 3 characters.');
    setBusy(true);
    const r = await G.wrap(async () => {
      const o = { name: f.name.trim(), description: f.description.trim(), rules: f.rules.trim(), privacy: f.privacy, approval: f.privacy === 'private' ? true : f.approval };
      if (cover) o.cover = await G.uploadGroupImage(user.id, 'cover', cover);
      if (avatar) o.avatar = await G.uploadGroupImage(user.id, 'avatar', avatar);
      return G.updateGroup(g.id, o);
    });
    setBusy(false);
    toast(r.error || 'Group updated.'); if (!r.error) { onDone(); onClose(); }
  };
  const doDelete = async () => { setBusy(true); const r = await G.wrap(() => G.deleteGroup(g.id)); setBusy(false); if (r.error) return toast(r.error); toast('Group deleted.'); refreshGroups(); go('#/groups'); };
  return (
    <Sheet title="Manage group" onClose={onClose}>
      <label>Name</label><input className="input" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <label>Description</label><textarea className="input" rows={2} maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <label>Rules</label><textarea className="input" rows={3} maxLength={800} value={f.rules} onChange={(e) => setF({ ...f, rules: e.target.value })} />
      <label>Privacy</label><select className="input" value={f.privacy} onChange={(e) => setF({ ...f, privacy: e.target.value })}><option value="public">Public</option><option value="private">Private</option></select>
      <label className="gv2-check"><input type="checkbox" checked={f.privacy === 'private' || f.approval} disabled={f.privacy === 'private'} onChange={(e) => setF({ ...f, approval: e.target.checked })} /> Require approval to join{f.privacy === 'private' ? ' (always on for private groups)' : ''}</label>
      <div className="row gap">
        <button className="btn ghost sm" onClick={() => cf.current.click()}><IoImage /> {cover ? 'Cover selected' : 'Change cover'}</button>
        <button className="btn ghost sm" onClick={() => af.current.click()}><IoCamera /> {avatar ? 'Avatar selected' : 'Change avatar'}</button>
      </div>
      <input ref={cf} hidden type="file" accept="image/*" onChange={async (e) => setCover(await pickImage(e, 1200))} />
      <input ref={af} hidden type="file" accept="image/*" onChange={async (e) => setAvatar(await pickImage(e, 400))} />
      <button className="btn primary big" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
      <button className="btn ghost big" onClick={() => setAdd(!add)}><IoAdd /> Add friend to group</button>
      {add && (friends.length === 0 ? <p className="muted">No friends to add (only friends who are not members can be added).</p> : friends.map((u) => (
        <div className="person" key={u.id}><Avatar user={u} size={36} /><b className="grow">{u.name}</b>
          <button className="btn primary sm" onClick={async () => { const r = await G.wrap(() => G.addMember(g.id, u.id)); toast(r.error || u.name + ' was added.'); onDone(); }}>Add</button></div>
      )))}
      {banned.length > 0 && <><label>Banned users</label>{banned.map((b) => (
        <div className="person" key={b.user_id}><b className="grow">{bw[b.user_id]?.name || 'User'}</b>
          <button className="btn ghost sm" onClick={async () => { const r = await G.wrap(() => G.unban(g.id, b.user_id)); toast(r.error || 'Unbanned.'); setBanned(banned.filter((x) => x.user_id !== b.user_id)); }}>Unban</button></div>
      ))}</>}
      {g.my_role === 'owner' && (del
        ? <div className="gv2-danger"><p>Delete this group and all its memberships? This cannot be undone.</p><div className="row gap"><button className="btn ghost sm" onClick={() => setDel(false)}>Cancel</button><button className="btn danger sm" disabled={busy} onClick={doDelete}>Yes, delete</button></div></div>
        : <button className="menu-item danger" onClick={() => setDel(true)}>Delete group</button>)}
    </Sheet>
  );
}

function OnlineGroupPage({ id }) {
  const s = useStore();
  const user = me(s);
  const [g, setG] = useState(undefined);
  const [tab, setTab] = useState('posts');
  const [members, setMembers] = useState([]);
  const [who, setWho] = useState({});
  const [reqs, setReqs] = useState([]);
  const [pins, setPins] = useState([]);
  const [menu, setMenu] = useState(false);
  const [manage, setManage] = useState(false);
  const [mem, setMem] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const load = async () => {
    try {
      const d = await G.groupDetail(id);
      setG(d || null);
      if (d && d.can_see) {
        const [m, pn, rq] = await Promise.all([G.groupMembers(id).catch(() => []), G.pinnedIds(id).catch(() => []), isStaff(d.my_role) ? G.pendingForGroup(id).catch(() => []) : []]);
        setMembers(m); setPins(pn); setReqs(rq);
        setWho(await G.profilesById([...m.map((x) => x.user_id), ...rq.map((x) => x.user_id)]));
      }
    } catch (e) { toast(G.friendlyError(e)); setG((x) => (x === undefined ? null : x)); }
  };
  useEffect(() => { setG(undefined); load(); refreshFeed(); }, [id]); // eslint-disable-line
  if (g === undefined) return <div className="stack"><p className="muted pad">Loading…</p></div>;
  if (!g) return <Empty title="Group not found" text="This group does not exist, or you cannot see it."><a className="btn primary sm" href="#/groups">Groups</a></Empty>;
  const role = g.my_role; const staff = isStaff(role); const admin = rk(role) >= 3;
  const mutedUntil = g.muted_until && new Date(g.muted_until) > new Date() ? g.muted_until : null;
  const refresh = () => { load(); refreshFeed(); };
  const posts = s.posts.filter((p) => p.groupId === id && canSee(s, p)).slice().sort((a, b) => (pins.includes(b.id) ? 1 : 0) - (pins.includes(a.id) ? 1 : 0));
  const act = async (fn, ok) => { const r = await G.wrap(fn); toast(r.error || ok); refresh(); };
  const doLeave = async () => { const r = await G.wrap(() => G.leave(id)); if (r.error) return toast(r.error); toast('You left the group.'); refreshGroups(); setLeaving(false); load(); };
  const friends = Object.values(s.users).filter((u) => u.cloud && u.id !== user.id && !members.some((m) => m.user_id === u.id) && areFriends(s, user.id, u.id));
  const nameOf = (uid) => (who[uid] || s.users[uid] || {}).name || 'User';
  const tabs = [['posts', 'Posts'], ['members', 'Members'], ['about', 'About']];
  if (staff) tabs.push(['requests', 'Requests' + (reqs.length ? ` (${reqs.length})` : '')]);
  if (admin) tabs.push(['manage', 'Manage']);
  return (
    <div className="stack">
      <div className="page-head"><button className="icon-btn" aria-label="Back" onClick={() => back('#/groups')}><IoArrowBack size={22} /></button><b>{g.name}</b></div>
      <section className="card gv2-head">
        <GImg kind="cover" src={g.cover_url} />
        <div className="gv2-info">
          <GImg src={g.avatar_url} size={64} />
          <div className="grow"><h2>{g.name}</h2><div className="gv2-meta"><PrivBadge p={g.privacy} /><span>{g.member_count} members</span></div></div>
        </div>
        <div className="gv2-actions">
          {role ? <button className="btn ghost sm" onClick={() => setMenu(true)}>Joined <IoEllipsisHorizontal /></button> : <JoinButton g={g} onChanged={load} />}
        </div>
      </section>
      {!g.can_see ? (
        <section className="card pad"><p>{g.description || 'No description.'}</p><p className="muted"><IoLockClosed /> This group is private. Request to join to see its posts and members.</p></section>
      ) : (
        <>
          <div className="tabs card gv2-tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => (k === 'manage' ? setManage(true) : setTab(k))}>{l}</button>)}</div>
          {tab === 'posts' && (
            <>
              {role && (mutedUntil ? <p className="local-note">You are muted until {fmtTime(mutedUntil)}.</p> : <MiniComposer placeholder="Write something in the group…" groupId={id} />)}
              {!role && <p className="local-note">Join the group to post.</p>}
              {posts.length ? posts.map((p) => (
                <div key={p.id} className="gv2-post">
                  {pins.includes(p.id) && <div className="gv2-pin"><IoPin /> Pinned post</div>}
                  <PostCard post={p} />
                  {staff && <div className="gv2-pa">
                    {admin && <button className="btn ghost sm" onClick={() => act(() => G.pinPost(p.id, !pins.includes(p.id)), pins.includes(p.id) ? 'Post unpinned.' : 'Post pinned.')}>{pins.includes(p.id) ? 'Unpin' : 'Pin'}</button>}
                    <button className="btn ghost sm" onClick={() => { if (confirm('Remove this post from the group?')) act(() => G.deletePost(p.id), 'Post removed.'); }}>Remove post</button>
                  </div>}
                </div>
              )) : <Empty title="No posts yet" />}
            </>
          )}
          {tab === 'members' && (
            <section className="card pad"><b>Members ({members.length})</b>
              {members.map((m) => {
                const u = who[m.user_id] || s.users[m.user_id];
                const can = rk(role) >= 2 && rk(role) > rk(m.role) && m.user_id !== user.id;
                const mu = m.muted_until && new Date(m.muted_until) > new Date();
                return (
                  <div className="person" key={m.user_id}>
                    <a href={'#/profile/' + m.user_id}><Avatar user={u || { id: m.user_id, name: '?' }} size={40} /></a>
                    <a className="grow" href={'#/profile/' + m.user_id}><b>{u ? u.name : 'User'}</b>{(ROLE_LABEL[m.role] || mu) && <small className="muted">{ROLE_LABEL[m.role] ? <span className={'gv2-role ' + m.role}>{ROLE_LABEL[m.role]}</span> : null}{mu ? ' Muted' : ''}</small>}</a>
                    {can && <button className="icon-btn" aria-label="Member actions" onClick={() => setMem(m)}><IoEllipsisHorizontal size={20} /></button>}
                  </div>
                );
              })}
            </section>
          )}
          {tab === 'about' && (
            <section className="card pad">
              <b>Description</b><p>{g.description || 'No description.'}</p>
              <b>Rules</b><p className="gv2-rules">{g.rules || 'This group has no rules yet.'}</p>
              <b>Admins</b>
              {members.filter((m) => rk(m.role) >= 3).map((m) => <a key={m.user_id} className="person" href={'#/profile/' + m.user_id}><Avatar user={who[m.user_id] || s.users[m.user_id] || { id: m.user_id, name: '?' }} size={36} /><b className="grow">{nameOf(m.user_id)}</b><small className="muted">{ROLE_LABEL[m.role]}</small></a>)}
            </section>
          )}
          {tab === 'requests' && staff && (
            <section className="card pad"><b>Join requests</b>
              {reqs.length === 0 && <p className="muted">No pending requests.</p>}
              {reqs.map((r) => <RequestRow key={r.id} r={r} who={who[r.user_id]} name="" onDecide={async (x, ok) => { const res = await G.wrap(() => G.decideRequest(x.id, ok)); toast(res.error || (ok ? 'Request approved.' : 'Request declined.')); load(); }} />)}
            </section>
          )}
        </>
      )}
      {menu && (
        <Sheet title="Group" onClose={() => { setMenu(false); setLeaving(false); }}>
          {role === 'owner' ? <p className="muted">You are the owner. To leave, delete the group from Manage.</p>
            : leaving ? <><p>Leave this group?</p><button className="menu-item danger" onClick={() => { setMenu(false); doLeave(); }}>Yes, leave group</button></>
              : <button className="menu-item danger" onClick={() => setLeaving(true)}>Leave group</button>}
        </Sheet>
      )}
      {mem && <MemberActions g={g} m={mem} u={who[mem.user_id] || s.users[mem.user_id]} actor={role} onClose={() => setMem(null)} onDone={load} />}
      {manage && <ManageSheet g={g} user={user} friends={friends} onClose={() => setManage(false)} onDone={refresh} />}
    </div>
  );
}

// ---------- entry points: online uses v2, local mode keeps the original ----------
export function Groups() { const s = useStore(); return me(s).cloud ? <OnlineGroups /> : <LocalGroups />; }
export function GroupPage({ id }) { const s = useStore(); return me(s).cloud ? <OnlineGroupPage id={id} /> : <LocalGroupPage id={id} />; }
