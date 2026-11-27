import { useEffect, useRef, useState } from 'react';
import { IoArrowBack, IoEllipsisHorizontal, IoPersonAdd, IoChatbubbleEllipses, IoCamera, IoEye, IoCheckmark, IoLockClosed, IoAdd, IoPlay, IoBriefcase } from 'react-icons/io5';
import {
  useStore, me, updateProfile, recordVisit, areFriends, requestBetween, sendRequest, acceptRequest, declineRequest, unfriend, toggleFollow,
  isBlocked, blockUser, unblockUser, report, openChat, compressImage, mySettings, visitsOfMe, fullTime, fetchUserOnline, loadProfileExtras, openChatOnline, liveStories, getState,
} from './store.js';
import { askReport } from './monet.jsx';
import { Avatar, Sheet, toast, go, back, Empty, LocalNote, Badge, Video } from './ui.jsx';
import { PostCard, canSee } from './feed.jsx';
import * as api from './profileApi.js';

function EditProfile({ user, onClose }) {
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio || '');
  const [avatar, setAvatar] = useState(user.avatar || '');
  const [cover, setCover] = useState(user.cover || '');
  const a = useRef(); const c = useRef();
  const save = async () => {
    if (name.trim().length < 2) return toast('Name must be at least 2 characters.');
    const err = await updateProfile({ name: name.trim(), bio: bio.trim(), avatar, cover });
    if (err) toast('Could not save online: ' + err);
    else toast(user.cloud ? 'Profile saved online.' : 'Profile saved.');
    onClose();
  };
  return (
    <Sheet title="Edit profile" onClose={onClose}>
      <div className="edit-cover" style={cover ? { background: `center/cover url(${cover})` } : undefined}>
        <button className="btn ghost sm" onClick={() => c.current.click()}><IoCamera /> Cover photo</button>
        <input ref={c} hidden type="file" accept="image/*" onChange={async (e) => { const f = e.target.files[0]; if (f) setCover(await compressImage(f, 1200)); }} />
      </div>
      <div className="row gap"><Avatar user={{ ...user, avatar }} size={64} />
        <button className="btn ghost sm" onClick={() => a.current.click()}><IoCamera /> Profile photo</button>
        <input ref={a} hidden type="file" accept="image/*" onChange={async (e) => { const f = e.target.files[0]; if (f) setAvatar(await compressImage(f, 400)); }} />
        {avatar && <button className="btn ghost sm" onClick={() => setAvatar('')}>Remove</button>}
      </div>
      <label htmlFor="en">Name</label><input id="en" className="input" value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="eb">Bio</label><textarea id="eb" className="input" rows={3} maxLength={160} value={bio} onChange={(e) => setBio(e.target.value)} />
      <button className="btn primary big" onClick={save}>Save</button>
    </Sheet>
  );
}


const LocalOnly = ({ what }) => <div className="local-note">{what} is available with an online account only.</div>;

// ---------- details (About) ----------
const fmtBirthday = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return d; } };
function DetailsCard({ d, own, onEdit }) {
  const rows = d ? [['Works at', d.work], ['Studied at', d.education], ['Lives in', d.current_city], ['From', d.hometown], ['Relationship', d.relationship], ['Website', d.website], ['Birthday', d.birthday && fmtBirthday(d.birthday)]].filter((r) => r[1]) : [];
  if (!rows.length && !own) return null;
  return (
    <div className="card pad pv2-about">
      <div className="row between"><b>About</b>{own && <button className="btn ghost sm" onClick={onEdit}>Edit details</button>}</div>
      {rows.length ? rows.map(([k, v]) => (
        <p key={k} className="pv2-row"><span className="muted">{k}</span>{k === 'Website' && /^https?:\/\//i.test(v) ? <a href={v} target="_blank" rel="noopener noreferrer nofollow">{v.replace(/^https?:\/\//i, '')}</a> : <b>{v}</b>}</p>
      )) : <p className="muted">Add your work, education, city and more.</p>}
    </div>
  );
}
function VisSelect({ id, value, onChange }) {
  return <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>{api.VIS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
}
function EditDetails({ meId, d, onSaved, onClose }) {
  const [f, setF] = useState({ work: '', education: '', current_city: '', hometown: '', relationship: '', website: '', details_visibility: 'public', friends_visibility: 'public', ...(d || {}), birthday: d?.birthday || '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const w = api.cleanWebsite(f.website);
    if (w === null) return toast('Website must be a valid http or https address.');
    setBusy(true);
    try { const row = await api.saveDetails(meId, { ...f, website: w }); toast('Details saved.'); onSaved(row); onClose(); }
    catch (e) { toast('Could not save: ' + e.message); setBusy(false); }
  };
  return (
    <Sheet title="Edit details" onClose={onClose}>
      <label htmlFor="dw">Work</label><input id="dw" className="input" maxLength={80} value={f.work} onChange={set('work')} />
      <label htmlFor="de">Education</label><input id="de" className="input" maxLength={80} value={f.education} onChange={set('education')} />
      <label htmlFor="dc">Current city</label><input id="dc" className="input" maxLength={60} value={f.current_city} onChange={set('current_city')} />
      <label htmlFor="dh">Hometown</label><input id="dh" className="input" maxLength={60} value={f.hometown} onChange={set('hometown')} />
      <label htmlFor="dr">Relationship</label>
      <select id="dr" className="input" value={f.relationship} onChange={set('relationship')}>{api.REL.map((r) => <option key={r} value={r}>{r || 'Not set'}</option>)}</select>
      <label htmlFor="dp">Website</label><input id="dp" className="input" inputMode="url" maxLength={120} placeholder="https://example.com" value={f.website} onChange={set('website')} />
      <label htmlFor="db">Birthday</label><input id="db" type="date" className="input" value={f.birthday} onChange={set('birthday')} />
      <label htmlFor="dv">Who can see my details</label><VisSelect id="dv" value={f.details_visibility} onChange={(v) => setF({ ...f, details_visibility: v })} />
      <label htmlFor="df">Who can see my friends list</label><VisSelect id="df" value={f.friends_visibility} onChange={(v) => setF({ ...f, friends_visibility: v })} />
      <button className="btn primary big" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </Sheet>
  );
}
function ViewSettings({ meId, d, onSaved, onClose }) {
  const [dv, setDv] = useState(d?.details_visibility || 'public');
  const [fv, setFv] = useState(d?.friends_visibility || 'public');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const base = { work: '', education: '', current_city: '', hometown: '', relationship: '', website: '', birthday: '', ...(d || {}) };
      const row = await api.saveDetails(meId, { ...base, details_visibility: dv, friends_visibility: fv });
      toast('Profile view settings saved.'); onSaved(row); onClose();
    } catch (e) { toast('Could not save: ' + e.message); setBusy(false); }
  };
  return (
    <Sheet title="Profile view settings" onClose={onClose}>
      <label htmlFor="pv1">Who can see my friends list</label><VisSelect id="pv1" value={fv} onChange={setFv} />
      <label htmlFor="pv2">Who can see my details</label><VisSelect id="pv2" value={dv} onChange={setDv} />
      <p className="muted small">Visit tracking (who can see that you viewed profiles) is in <a href="#/settings" onClick={onClose}>Settings</a>.</p>
      <button className="btn primary big" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </Sheet>
  );
}

// ---------- professional mode ----------
function ProSheet({ meId, flags, onChange, onClose }) {
  const [cat, setCat] = useState(flags.cat || 'Creator');
  const [busy, setBusy] = useState(false);
  const apply = async (on) => {
    setBusy(true);
    try { await api.setPro(meId, on, cat); onChange({ ...flags, pro: on, cat: on ? cat : '' }); toast(on ? 'Professional mode is on.' : 'Professional mode is off.'); onClose(); }
    catch (e) { toast('Could not save: ' + e.message); setBusy(false); }
  };
  return (
    <Sheet title="Professional mode" onClose={onClose}>
      <p className="muted">Show a category on your profile and get quick access to Creator tools and Insights.</p>
      <label htmlFor="pc">Category</label>
      <select id="pc" className="input" value={cat} onChange={(e) => setCat(e.target.value)}>{api.PRO_CATS.map((c) => <option key={c}>{c}</option>)}</select>
      <button className="btn primary big" disabled={busy} onClick={() => apply(true)}>{flags.pro ? 'Save category' : 'Turn on Professional mode'}</button>
      {flags.pro && <button className="btn ghost big" disabled={busy} onClick={() => apply(false)}>Turn off Professional mode</button>}
    </Sheet>
  );
}

// ---------- highlights ----------
// Save one of my ACTIVE stories to a new or existing highlight. Used by the profile and by the feed's story viewer.
export function HighlightPicker({ story, onClose }) {
  const [list, setList] = useState(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const online = !!me(getState())?.cloud;
  useEffect(() => { if (!online) return; let on = true; api.loadHighlights(getState().me).then((x) => on && setList(x)).catch(() => on && setList([])); return () => { on = false; }; }, [online]);
  const add = async (hid, t) => {
    if (!hid && t.trim().length < 1) return toast('Enter a title for the new highlight.');
    setBusy(true);
    try { await api.addToHighlight(story.id, hid, t); toast('Saved to highlight.'); window.dispatchEvent(new Event('fynza-highlights')); onClose(); }
    catch (e) { toast(/story not found/.test(e.message) ? 'Only your own active stories can be saved.' : 'Could not save: ' + e.message); setBusy(false); }
  };
  return (
    <Sheet title="Save to highlight" onClose={onClose}>
      {!online ? <LocalOnly what="Story highlights" /> : list === null ? <p className="muted">Loading…</p> : (
        <>
          {list.length > 0 && <><b>Add to existing</b>{list.map((h) => <button key={h.id} disabled={busy} className="menu-item" onClick={() => add(h.id, '')}><span className="pv2-mini" style={h.cover ? { backgroundImage: `url(${h.cover})` } : undefined} />{h.title}<small className="muted"> · {h.items.length}</small></button>)}</>}
          <b>New highlight</b>
          <input className="input" aria-label="Highlight title" maxLength={30} placeholder="Highlight title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="btn primary big" disabled={busy} onClick={() => add(null, title)}>Create and save</button>
        </>
      )}
    </Sheet>
  );
}

function HighlightCreate({ onClose }) {
  const s = useStore();
  const mine = liveStories(s).filter((x) => x.author === s.me && x.cloud);
  const [pick, setPick] = useState(null);
  if (pick) return <HighlightPicker story={pick} onClose={onClose} />;
  return (
    <Sheet title="New highlight" onClose={onClose}>
      {mine.length ? <><p className="muted">Pick one of your active stories (last 24 hours) to save.</p>
        <div className="pv2-pick">{mine.map((x) => <button key={x.id} aria-label="Select story" className="pv2-tile" style={x.img ? { backgroundImage: `url(${x.img})` } : { background: x.bg || '#1F4FE0' }} onClick={() => setPick(x)}>{!x.img && <span>{x.text}</span>}</button>)}</div></>
        : <><b>No active stories</b><p className="muted">Post a story first, then come back to save it as a highlight. You can also use "Save to highlight" while viewing your story.</p></>}
    </Sheet>
  );
}

function HighlightViewer({ h, own, onClose, onChanged }) {
  const [i, setI] = useState(0);
  const [ren, setRen] = useState(false);
  const [title, setTitle] = useState(h.title);
  const items = h.items;
  const it = items[Math.min(i, items.length - 1)];
  const paused = ren;
  useEffect(() => {
    if (!items.length || paused) return undefined;
    const t = setTimeout(() => { if (i + 1 < items.length) setI(i + 1); else onClose(); }, 5000);
    return () => clearTimeout(t);
  }, [i, items.length, paused]); // eslint-disable-line
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const tap = (e) => { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX - r.left < r.width / 3) setI(Math.max(0, i - 1)); else if (i + 1 < items.length) setI(i + 1); else onClose(); };
  const rename = async () => { if (!title.trim()) return toast('Title cannot be empty.'); try { await api.renameHighlight(h.id, title); toast('Renamed.'); setRen(false); onChanged(); } catch (e) { toast('Could not rename: ' + e.message); } };
  const del = async () => { if (!window.confirm('Delete this highlight?')) return; try { await api.deleteHighlight(h.id); toast('Highlight deleted.'); onClose(); onChanged(); } catch (e) { toast('Could not delete: ' + e.message); } };
  const delItem = async () => { try { await api.deleteHighlightItem(it.id); toast('Removed from highlight.'); if (items.length <= 1) { await api.deleteHighlight(h.id); onClose(); } else setI(Math.max(0, i - 1)); onChanged(); } catch (e) { toast('Could not remove: ' + e.message); } };
  return (
    <div className="hl-view" role="dialog" aria-label={h.title}>
      <div className="hl-bars">{items.map((x, k) => <span key={x.id}><i className={k < i ? 'done' : k === i ? 'run' : ''} /></span>)}</div>
      <div className="hl-top"><b>{h.title}</b><span className="grow" />
        {own && <><button className="hl-btn" onClick={() => setRen(true)}>Rename</button><button className="hl-btn" onClick={delItem}>Remove story</button><button className="hl-btn" onClick={del}>Delete</button></>}
        <button className="hl-btn" aria-label="Close" onClick={onClose}>✕</button></div>
      {it && <div key={it.id} className="hl-body" onClick={tap} style={it.img ? undefined : { background: it.bg || 'linear-gradient(135deg,#1F4FE0,#0B1F6B)' }}>
        {it.img ? <img src={it.img} alt="" /> : <p className="story-text">{it.text}</p>}
        {it.img && it.text && <p className="hl-cap">{it.text}</p>}
      </div>}
      {ren && <Sheet title="Rename highlight" onClose={() => setRen(false)}><input className="input" aria-label="Title" maxLength={30} value={title} onChange={(e) => setTitle(e.target.value)} /><button className="btn primary big" onClick={rename}>Save</button></Sheet>}
    </div>
  );
}

function Highlights({ userId, own }) {
  const [list, setList] = useState(null);
  const [view, setView] = useState(null);
  const [create, setCreate] = useState(false);
  const reload = () => api.loadHighlights(userId).then(setList).catch(() => setList([]));
  useEffect(() => { setList(null); reload(); const h = () => reload(); window.addEventListener('fynza-highlights', h); return () => window.removeEventListener('fynza-highlights', h); }, [userId]); // eslint-disable-line
  if (!list || (!list.length && !own)) return null;
  const cur = view && list.find((x) => x.id === view);
  return (
    <div className="card pad pv2-hl">
      <div className="hl-row">
        {own && <button className="hl-item" onClick={() => setCreate(true)} aria-label="New highlight"><span className="hl-circ add"><IoAdd size={28} /></span><small>New</small></button>}
        {list.map((h) => <button key={h.id} className="hl-item" onClick={() => h.items.length ? setView(h.id) : toast('This highlight is empty.')}>
          <span className="hl-circ" style={h.cover ? { backgroundImage: `url(${h.cover})` } : { background: h.items[0]?.bg || '#1F4FE0' }}>{!h.cover && <IoPlay color="#fff" />}</span><small>{h.title}</small></button>)}
      </div>
      {cur && <HighlightViewer h={cur} own={own} onClose={() => setView(null)} onChanged={reload} />}
      {create && <HighlightCreate onClose={() => { setCreate(false); reload(); }} />}
    </div>
  );
}

const copyText = async (t) => {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* fallback */ }
  try { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); const ok = document.execCommand('copy'); a.remove(); return ok; } catch (e) { return false; }
};

function FriendsTab({ id, own, u, s, friends }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(false);
  const online = !!u.cloud;
  useEffect(() => {
    if (!online) return undefined;
    let on = true; setRows(null); setErr(false);
    api.loadFriends(id).then((r) => on && setRows(Array.isArray(r) ? r : [])).catch(() => on && setErr(true));
    return () => { on = false; };
  }, [id, online]);
  let list = friends;
  if (online) {
    if (err) return <Empty title="Friends list is private" text="This person has limited who can see their friends." />;
    if (rows === null) return <p className="muted pad">Loading…</p>;
    list = rows.map((r) => { const fid = r.id || r.user_id || r.friend_id; const k = s.users[fid]; return { id: fid, name: r.name || k?.name || 'User', username: r.username || k?.username, avatar: r.avatar_url || r.avatar || k?.avatar, cloud: true }; }).filter((x) => x.id);
  }
  if (!list.length) return <Empty title={own ? 'No friends yet' : 'Nothing to show'} text={online && !own ? 'No friends to show, or the list is private.' : undefined} />;
  return <div className="card pad">{list.map((f) => <a key={f.id} className="person" href={'#/profile/' + f.id}><Avatar user={f} size={44} /><b>{f.name}</b></a>)}</div>;
}

export function Profile({ id }) {
  const s = useStore();
  const user = me(s);
  const u = s.users[id];
  const own = id === user.id;
  const online = !!user.cloud && !!u?.cloud;
  const [tab, setTab] = useState('posts');
  const [edit, setEdit] = useState(false);
  const [menu, setMenu] = useState(false);
  const [editD, setEditD] = useState(false);
  const [viewSet, setViewSet] = useState(false);
  const [pro, setPro] = useState(false);
  const [flags, setFlags] = useState({ locked: false, pro: false, cat: '' });
  const [flagsOk, setFlagsOk] = useState(false);
  const [details, setDetails] = useState(null);

  useEffect(() => { if (!u) fetchUserOnline(id); else if (u.cloud) loadProfileExtras(id); }, [id, !!u]); // eslint-disable-line
  useEffect(() => { if (u && !own) recordVisit(id); }, [id, !!u]); // eslint-disable-line
  useEffect(() => {
    setFlagsOk(false); setFlags({ locked: false, pro: false, cat: '' }); setDetails(null);
    if (!online) { setFlagsOk(true); return undefined; }
    let on = true;
    api.loadFlags(id).then((f) => { if (on) { setFlags(f); setFlagsOk(true); } }).catch(() => on && setFlagsOk(true));
    api.loadDetails(id).then((d) => on && setDetails(d)).catch(() => {});
    return () => { on = false; };
  }, [id, online]);

  if (!u) return <Empty title="Profile not found" text="This user does not exist."><a className="btn primary sm" href="#/feed">Home</a></Empty>;
  if (!own && isBlocked(s, user.id, id)) {
    const iBlocked = s.blocks.some(([a, b]) => a === user.id && b === id);
    return <Empty title="This profile is not available">{iBlocked && <button className="btn primary sm" onClick={() => { unblockUser(id); toast('Unblocked.'); }}>Unblock {u.name}</button>}</Empty>;
  }

  const friend = areFriends(s, user.id, id);
  const req = requestBetween(s, user.id, id);
  const following = s.follows.some(([a, b]) => a === user.id && b === id);
  const locked = !own && !friend && online && flags.locked;
  const hidden = !own && mySettings(s, id).profilePublic === false && !friend;
  const posts = s.posts.filter((p) => p.author === id && canSee(s, p) && !p.groupId);
  const friends = s.friends.filter(([a, b]) => a === id || b === id).map(([a, b]) => s.users[a === id ? b : a]).filter(Boolean);
  const followers = s.follows.filter(([, b]) => b === id).length;
  const photos = posts.filter((p) => p.img);
  const reels = s.reels.filter((r) => r.author === id && !!r.cloud === !!user.cloud);
  const visits = own ? visitsOfMe(s).length : 0;
  const tabs = ['posts', 'about', 'friends', 'photos', 'reels'];
  const toggleLock = async () => {
    const next = !flags.locked;
    try { await api.setLock(next); setFlags({ ...flags, locked: next }); toast(next ? 'Profile locked.' : 'Profile unlocked.'); }
    catch (e) { toast('Could not change lock: ' + e.message); }
  };

  const actions = own ? (
    <>
      <button className="btn primary" onClick={() => setEdit(true)}>Edit profile</button>
      <a className="btn ghost" href="#/visitors"><IoEye /> Who viewed my profile{visits > 0 && <i className="count">{visits}</i>}</a>
    </>
  ) : (
    <>
      {friend ? <button className="btn ghost" onClick={() => { unfriend(id); toast('Removed from your friends list.'); }}><IoCheckmark /> Friends</button>
        : req && req.to === user.id ? <><button className="btn primary" onClick={() => acceptRequest(id)}>Confirm</button><button className="btn ghost" onClick={() => declineRequest(id)}>Delete</button></>
        : req ? <button className="btn ghost" onClick={() => { declineRequest(id); toast('Request cancelled.'); }}>Requested · Cancel</button>
        : <button className="btn primary" onClick={() => { sendRequest(id); toast('Friend request sent.'); }}><IoPersonAdd /> Add Friend</button>}
      {!locked && (u.cloud ? <button className="btn ghost" onClick={async () => { const r = await openChatOnline(id); if (r.error) toast(r.error); else go('#/chat/' + r.id); }}><IoChatbubbleEllipses /> Message</button> : <button className="btn ghost" onClick={() => { if (mySettings(s, id).whoCanMessage === 'friends' && !friend) return toast('This user only accepts messages from friends.'); go('#/chat/' + openChat(id)); }}><IoChatbubbleEllipses /> Message</button>)}
      {!locked && <button className="btn ghost" onClick={() => toggleFollow(id)}>{following ? 'Following' : 'Follow'}</button>}
    </>
  );

  return (
    <div className="stack">
      <div className="profile-head card">
        <div className="cover" style={u.cover ? { background: `center/cover url(${u.cover})` } : undefined}>
          <button className="icon-btn dark" aria-label="Back" onClick={() => back()}><IoArrowBack size={22} /></button>
          <button className="icon-btn dark right" aria-label="More" onClick={() => setMenu(true)}><IoEllipsisHorizontal size={22} /></button>
        </div>
        <div className="p-info">
          <div className="p-avatar"><Avatar user={u} size={112} /></div>
          <h1>{u.name}<Badge on={u.verified} size={22} />{online && flags.locked && <span className="pv2-lock"><IoLockClosed size={12} /> Locked</span>}</h1>
          <p className="muted">@{u.username}</p>
          {online && flags.pro && flags.cat && !locked && <p className="pv2-cat"><IoBriefcase size={13} /> {flags.cat}</p>}
          {!locked && u.bio && <p className="bio">{u.bio}</p>}
          <div className="p-actions">{actions}</div>
          {!locked && <div className="p-stats"><span><b>{posts.length}</b> Posts</span>{(own || !u.cloud) && <span><b>{friends.length}</b> Friends</span>}<span><b>{followers}</b> Followers</span></div>}
        </div>
        {!locked && <div className="tabs" role="tablist">
          {tabs.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
        </div>}
      </div>

      {locked ? <div className="card pad pv2-locked"><IoLockClosed size={28} /><b>This profile is locked</b><p className="muted">Only friends can see what {u.name} shares. Send a friend request to connect.</p></div>
        : hidden ? <Empty title="This profile is private" text="Only friends can see it." /> : (
          <>
            {online && flagsOk && <Highlights userId={id} own={own} />}
            {tab === 'posts' && (posts.length ? posts.map((p) => <PostCard key={p.id} post={p} />) : <Empty title="No posts" />)}
            {tab === 'about' && (
              <>
                <div className="card pad"><p><b>Name:</b> {u.name}</p><p><b>Username:</b> @{u.username}</p><p><b>Bio:</b> {u.bio || '—'}</p><p><b>Joined:</b> {fullTime(u.created)}</p></div>
                {online && <DetailsCard d={details} own={own} onEdit={() => setEditD(true)} />}
              </>
            )}
            {tab === 'friends' && <FriendsTab id={id} own={own} u={u} s={s} friends={friends} />}
            {tab === 'photos' && (photos.length ? <div className="photo-grid">{photos.map((p) => <img key={p.id} src={p.img} alt="" />)}</div> : <Empty title="No photos" />)}
            {tab === 'reels' && (reels.length ? <div className="pv2-reels">{reels.map((r) => <a key={r.id} className="pv2-reel" href={'#/reels/' + r.id}><Video vkey={r.videoKey} url={r.videoUrl} className="pv2-thumb" controls={false} muted preload="metadata" onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = 0.1; } catch (x) { /* ignore */ } }} /><IoPlay size={22} /><span>{r.caption || 'Reel'}</span></a>)}</div> : <Empty title="No reels" />)}
          </>
        )}

      {edit && <EditProfile user={u} onClose={() => setEdit(false)} />}
      {editD && <EditDetails meId={user.id} d={details} onSaved={setDetails} onClose={() => setEditD(false)} />}
      {viewSet && <ViewSettings meId={user.id} d={details} onSaved={setDetails} onClose={() => setViewSet(false)} />}
      {pro && <ProSheet meId={user.id} flags={flags} onChange={setFlags} onClose={() => setPro(false)} />}
      {menu && (
        <Sheet title={u.name} onClose={() => setMenu(false)}>
          {own ? (
            <>
              <button className="menu-item" onClick={() => { setMenu(false); setEdit(true); }}>Edit profile</button>
              {user.cloud ? (
                <>
                  <button className="menu-item" onClick={() => { setMenu(false); setEditD(true); }}>Edit details</button>
                  <button className="menu-item" onClick={() => { setMenu(false); toggleLock(); }}>{flags.locked ? 'Unlock profile' : 'Lock profile'}</button>
                  <button className="menu-item" onClick={() => { setMenu(false); setPro(true); }}>Professional mode: {flags.pro ? 'On' : 'Off'}</button>
                  <button className="menu-item" onClick={() => { setMenu(false); setViewSet(true); }}>Profile view settings</button>
                </>
              ) : <div className="pad"><LocalOnly what="Profile lock, Professional mode and details" /></div>}
              <a className="menu-item" href="#/privacy-checkup" onClick={() => setMenu(false)}>Privacy Checkup</a>
            </>
          ) : (
            <>
              <button className="menu-item" onClick={() => { setMenu(false); askReport('user', id); }}>Report profile</button>
              <button className="menu-item danger" onClick={() => { blockUser(id); setMenu(false); toast('Blocked.'); }}>Block {u.name}</button>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
