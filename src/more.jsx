import { useEffect, useRef, useState } from 'react';
import {
  IoPeople, IoPeopleCircle, IoFlag, IoPlayCircle, IoBookmark, IoStorefront, IoEye, IoSettings, IoHelpCircle, IoLogOut, IoChevronForward, IoAdd, IoSend, IoImage,
  IoHeart, IoHeartOutline, IoArrowBack, IoEyeOff, IoTrash, IoBan, IoSearch, IoVideocam, IoShieldCheckmark, IoPlay, IoVolumeHigh, IoVolumeMute, IoChatbubbleOutline, IoShareSocialOutline,
} from 'react-icons/io5';
import {
  useStore, me, timeAgo, fullTime, areFriends, isBlocked, requestBetween, sendRequest, acceptRequest, declineRequest, logout, clearDemo,
  createGroup, toggleGroup, createPage, togglePage, addReel, reactReel, addReelComment, deleteReelComment, countReelShare, saveVideo, openChat, createGroupChat, sendMessage, markNotifsRead,
  visitsOfMe, removeVisit, clearVisits, mySettings, updateSettings, blockUser, unblockUser, compressImage,
} from './store.js';
import { Avatar, Sheet, toast, go, back, Empty, Toggle, Video, LocalNote } from './ui.jsx';
import { sameWorld, searchPeopleOnline, suggestPeopleOnline, refreshAll, refreshMedia, addReelOnline, deleteReel, refreshChats, openChatOnline, createGroupChatOnline } from './store.js';
import { PostCard, canSee } from './feed.jsx';
import { ConnectSheet } from './auth.jsx';
import { isOnline } from './supabase.js';

export const Head = ({ title, right, noBack }) => (
  <div className="page-head">
    {!noBack && <button className="icon-btn" aria-label="Back" onClick={() => back()}><IoArrowBack size={22} /></button>}
    <h1>{title}</h1><div>{right}</div>
  </div>
);

// ---------- Friends ----------
export function Friends() {
  const s = useStore();
  const user = me(s);
  const reqs = s.requests.filter((r) => r.to === user.id);
  const mine = s.friends.filter(([a, b]) => a === user.id || b === user.id).map(([a, b]) => s.users[a === user.id ? b : a]).filter(Boolean);
  useEffect(() => { if (user.cloud) { suggestPeopleOnline(); refreshAll(); } }, []); // eslint-disable-line
  const sug = Object.values(s.users).filter((u) => sameWorld(s, u) && u.id !== user.id && !areFriends(s, user.id, u.id) && !isBlocked(s, user.id, u.id));
  return (
    <div className="stack">
      <Head title="Friends" noBack />
      <section className="card pad"><b>Friend requests ({reqs.length})</b>
        {reqs.length === 0 && <p className="muted">No new requests.</p>}
        {reqs.map((r) => { const u = s.users[r.from]; return u && (
          <div className="person" key={r.from}><Avatar user={u} size={52} /><div className="grow"><a className="name" href={'#/profile/' + u.id}>{u.name}</a><small className="muted">{timeAgo(r.time)}</small>
            <div className="row gap"><button className="btn primary sm" onClick={() => acceptRequest(u.id)}>Confirm</button><button className="btn ghost sm" onClick={() => declineRequest(u.id)}>Delete</button></div></div></div>); })}
      </section>
      <section className="card pad"><b>People you may know</b>
        {sug.length === 0 && <p className="muted">No suggestions right now.</p>}
        {sug.map((u) => { const rq = requestBetween(s, user.id, u.id); return (
          <div className="person" key={u.id}><Avatar user={u} size={48} /><div className="grow"><a className="name" href={'#/profile/' + u.id}>{u.name}</a><small className="muted">@{u.username}</small></div>
            {rq ? <button className="btn ghost sm" onClick={() => declineRequest(u.id)}>Cancel</button> : <button className="btn primary sm" onClick={() => { sendRequest(u.id); toast('Request sent.'); }}>Add</button>}</div>); })}
      </section>
      <section className="card pad"><b>Your friends ({mine.length})</b>
        {mine.length === 0 && <p className="muted">No friends yet.</p>}
        {mine.map((u) => <a className="person" key={u.id} href={'#/profile/' + u.id}><Avatar user={u} size={44} /><b>{u.name}</b></a>)}
      </section>
    </div>
  );
}

// ---------- Reels ----------
const RX = { like: '👍', love: '❤️', haha: '😂', wow: '😮', sad: '😢', angry: '😡' };
let reelSound = true; // sound preference for all reels (the video itself is NOT forced muted any more)
function ReelComments({ r, onClose }) {
  const s = useStore(); const user = me(s);
  const live = s.reels.find((x) => x.id === r.id) || r;
  const [t, setT] = useState(''); const [reply, setReply] = useState(null);
  const send = (e) => { e.preventDefault(); if (!t.trim()) return; addReelComment(r.id, t.trim(), reply?.id); setT(''); setReply(null); };
  const one = (c, sub, parentId) => {
    const a = s.users[c.author];
    return (
      <div key={c.id} className={'comment' + (sub ? ' sub' : '')}>
        <Avatar user={a} size={sub ? 28 : 34} />
        <div><div className="bubble"><b>{a?.name || 'Unknown'}</b><p>{c.text}</p></div>
          <small>{timeAgo(c.time)}{!sub && <> · <button className="link-btn" onClick={() => setReply(c)}>Reply</button></>}{(c.author === user.id || live.author === user.id) && <> · <button className="link-btn" onClick={() => deleteReelComment(r.id, c.id)}>Delete</button></>}</small></div>
      </div>
    );
  };
  const list = live.comments || [];
  return (
    <Sheet title={'Comments (' + list.reduce((n, c) => n + 1 + c.replies.length, 0) + ')'} onClose={onClose}>
      <div className="comments">
        {list.length === 0 && <p className="muted center">No comments yet. Start the conversation.</p>}
        {list.map((c) => (<div key={c.id}>{one(c)}{c.replies.map((x) => one(x, true))}</div>))}
        <form className="row gap" onSubmit={send}>
          <input className="input" aria-label="Write a comment" maxLength={1000} placeholder={reply ? 'Reply to ' + (s.users[reply.author]?.name || 'comment') + '…' : 'Write a comment…'} value={t} onChange={(e) => setT(e.target.value)} />
          <button className="icon-btn send" aria-label="Send comment"><IoSend size={20} /></button>
        </form>
        {reply && <small className="muted">Replying · <button className="link-btn" onClick={() => setReply(null)}>Cancel</button></small>}
      </div>
    </Sheet>
  );
}
function ReelItem({ r }) {
  const s = useStore();
  const user = me(s);
  const a = s.users[r.author];
  const ref = useRef();
  const [muted, setMuted] = useState(!reelSound);
  const [paused, setPaused] = useState(false);
  const [prog, setProg] = useState(0);
  const [picker, setPicker] = useState(false);
  const [cm, setCm] = useState(false);
  const [sh, setSh] = useState(false);
  const timer = useRef();
  const vid = () => ref.current?.querySelector('video');
  const playNow = (v) => {
    v.muted = !reelSound; setMuted(!reelSound);
    const p = v.play(); if (p) p.then(() => setPaused(false)).catch(() => { v.muted = true; setMuted(true); v.play().then(() => setPaused(false)).catch(() => setPaused(true)); }); // browser blocked sound autoplay: play muted, user can tap the speaker
  };
  useEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const io = new IntersectionObserver(([e]) => { const v = vid(); if (!v) return; if (e.isIntersecting) playNow(v); else { v.pause(); v.currentTime = 0; } }, { threshold: 0.6 });
    io.observe(el); return () => io.disconnect();
  }, []); // eslint-disable-line
  const toggleSound = (e) => { e.stopPropagation(); const v = vid(); reelSound = muted; setMuted(!reelSound); if (v) { v.muted = !reelSound; if (v.paused) v.play().catch(() => {}); } };
  const tapVideo = () => { const v = vid(); if (!v) return; if (v.paused) { v.play(); setPaused(false); } else { v.pause(); setPaused(true); } };
  const mine = r.reactions?.[user.id];
  const total = Object.keys(r.reactions || {}).length;
  const ncm = (r.comments || []).reduce((n, c) => n + 1 + c.replies.length, 0);
  const press = () => { timer.current = setTimeout(() => setPicker(true), 420); };
  const rel = () => clearTimeout(timer.current);
  const link = location.origin + location.pathname + '#/reels/' + r.id;
  const doShare = async (how) => {
    if (how === 'copy') { try { await navigator.clipboard.writeText(link); toast('Link copied.'); } catch (e) { toast(link); } }
    else if (navigator.share) { try { await navigator.share({ title: 'FYNZA reel', text: r.caption || 'Watch this reel on FYNZA', url: link }); } catch (e) { return; } }
    else { try { await navigator.clipboard.writeText(link); toast('Sharing is not supported here. Link copied.'); } catch (e) { toast(link); } }
    countReelShare(r.id); setSh(false);
  };
  return (
    <div className="reel" ref={ref} id={'reel-' + r.id}>
      <Video vkey={r.videoKey} url={r.videoUrl} className="reel-video" controls={false} loop playsInline onClick={tapVideo}
        onTimeUpdate={(e) => setProg(e.target.duration ? e.target.currentTime / e.target.duration : 0)} />
      {paused && <button className="reel-play" aria-label="Play" onClick={tapVideo}><IoPlay size={46} /></button>}
      <button className="reel-sound" aria-label={muted ? 'Turn sound on' : 'Turn sound off'} onClick={toggleSound}>{muted ? <IoVolumeMute size={22} /> : <IoVolumeHigh size={22} />}{muted && <span>Tap for sound</span>}</button>
      <div className="reel-side">
        {r.author === user.id && <button aria-label="Delete reel" onClick={() => { deleteReel(r.id); toast('Reel deleted.'); }}><IoTrash size={26} /></button>}
        <div className="reel-rx">
          {picker && <div className="reel-picker" onMouseLeave={() => setPicker(false)}>{Object.entries(RX).map(([k, e]) => <button key={k} aria-label={k} onClick={() => { reactReel(r.id, k); setPicker(false); }}>{e}</button>)}</div>}
          <button aria-label="React" onClick={() => (picker ? setPicker(false) : reactReel(r.id, mine || 'like'))} onContextMenu={(e) => { e.preventDefault(); setPicker(true); }} onTouchStart={press} onTouchEnd={rel} onMouseDown={press} onMouseUp={rel}>
            {mine ? <span className="reel-emoji">{RX[mine]}</span> : <IoHeartOutline size={32} />}<small>{total}</small></button>
        </div>
        <button aria-label="Comments" onClick={() => setCm(true)}><IoChatbubbleOutline size={29} /><small>{ncm}</small></button>
        <button aria-label="Share" onClick={() => setSh(true)}><IoShareSocialOutline size={29} /><small>{r.shares || 0}</small></button>
      </div>
      <div className="reel-info"><a href={'#/profile/' + r.author} className="row gap"><Avatar user={a} size={36} /><b>{a?.name}</b></a>{r.caption && <p>{r.caption}</p>}</div>
      <div className="reel-bar"><i style={{ width: prog * 100 + '%' }} /></div>
      {cm && <ReelComments r={r} onClose={() => setCm(false)} />}
      {sh && (
        <Sheet title="Share reel" onClose={() => setSh(false)}>
          <button className="btn ghost big" onClick={() => doShare('copy')}>Copy link</button>
          <button className="btn primary big" onClick={() => doShare('native')}>Share…</button>
        </Sheet>
      )}
    </div>
  );
}
export function Reels() {
  const s = useStore();
  useEffect(() => { if (me(s).cloud) refreshMedia(); }, []); // eslint-disable-line
  const reels = s.reels.filter((r) => !!r.cloud === !!me(s).cloud && !isBlocked(s, s.me, r.author));
  const want = (location.hash.match(/#\/reels\/([^/?]+)/) || [])[1];
  useEffect(() => { if (want) setTimeout(() => document.getElementById('reel-' + want)?.scrollIntoView(), 200); }, [want, reels.length]); // eslint-disable-line
  const [up, setUp] = useState(false);
  const [file, setFile] = useState(null);
  const [cap, setCap] = useState('');
  const [busy, setBusy] = useState(false);
  const fr = useRef();
  const post = async () => {
    setBusy(true);
    try {
      if (me(s).cloud) { const err = await addReelOnline(file, cap.trim()); if (err) throw new Error(err); } else addReel(await saveVideo(file), cap.trim());
      setUp(false); setFile(null); setCap(''); toast(me(s).cloud ? 'Reel posted online.' : 'Reel posted.');
    } catch (e) { toast('Could not save reel: ' + e.message); }
    setBusy(false);
  };
  return (
    <div className="reels">
      <div className="reels-head"><h1>Reels</h1><button className="icon-btn light" aria-label="Create reel" onClick={() => setUp(true)}><IoAdd size={26} /></button></div>
      {reels.length === 0 ? (
        <div className="reel empty-reel"><Empty title="No reels yet" text="Be the first to upload a short video."><button className="btn primary" onClick={() => setUp(true)}><IoVideocam /> Upload a reel</button></Empty></div>
      ) : reels.map((r) => <ReelItem key={r.id} r={r} />)}
      {up && (
        <Sheet title="New reel" onClose={() => setUp(false)}>
          <button className="btn ghost" onClick={() => fr.current.click()}><IoVideocam /> {file ? file.name : 'Choose a video'}</button>
          <input ref={fr} hidden type="file" accept="video/*" onChange={(e) => { const f = e.target.files[0]; if (f && f.size > 80e6) toast('Video must be under 80 MB.'); else if (f) setFile(f); }} />
          <input className="input" placeholder="Caption (optional)" maxLength={120} value={cap} onChange={(e) => setCap(e.target.value)} />
          <button className="btn primary big" disabled={!file || busy} onClick={post}>{busy ? 'Saving…' : 'Post reel'}</button>
        </Sheet>
      )}
    </div>
  );
}

// ---------- Menu ----------
export function MenuPage() {
  const s = useStore();
  const user = me(s);
  const reqs = s.requests.filter((r) => r.to === user.id).length;
  const items = [
    ['Friends', '#/friends', IoPeople, '#2563EB', reqs],
    ['Groups', '#/groups', IoPeopleCircle, '#2563EB'],
    ['Pages', '#/pages', IoFlag, '#E11D48'],
    ['Reels', '#/reels', IoPlayCircle, '#EA580C'],
    ['Marketplace', '#/market', IoStorefront, '#0891B2'],
    ['Saved', '#/saved', IoBookmark, '#4F46E5'],
    ['Privacy Checkup', '#/privacy-checkup', IoShieldCheckmark, '#16A34A'],
    ['Who viewed my profile', '#/visitors', IoEye, '#0EA5E9'],
    ...(user.cloud && user.role === 'admin' ? [['Admin dashboard', '#/admin', IoShieldCheckmark, '#7C3AED']] : []),
    ['Verified, Ads & Creators', '#/earn', IoShieldCheckmark, '#1D4ED8'],
    ['Security', '#/security', IoShieldCheckmark, '#16A34A'],
    ['Settings & Privacy', '#/settings', IoSettings, '#475569'],
    ['Help & Support', '#/help', IoHelpCircle, '#0891B2'],
  ];
  return (
    <div className="stack">
      <a className="card profile-row" href={'#/profile/' + user.id}><Avatar user={user} size={56} /><div className="grow"><b>{user.name}</b><small className="muted">View Profile</small></div><IoChevronForward /></a>
      <section className="card menu-list">
        {items.map(([l, h, I, c, n]) => <a key={l} href={h}><I size={26} color={c} /><span>{l}</span>{n > 0 && <i className="badge static">{n}</i>}<IoChevronForward className="chev" /></a>)}
        <button onClick={() => { logout(); go('#/'); }}><IoLogOut size={26} color="#475569" /><span>Log Out</span></button>
      </section>
    </div>
  );
}

// ---------- Notifications ----------
export function Notifications() {
  const s = useStore();
  const user = me(s);
  const list = s.notifs.filter((n) => n.to === user.id);
  const [seen] = useState(() => new Set(list.filter((n) => !n.read).map((n) => n.id)));
  useEffect(() => { markNotifsRead(); }, []);
  const text = (n) => ({ like: 'reacted to your post.', comment: 'commented on your post.', share: 'shared your post.', friend_request: 'sent you a friend request.', visit: 'viewed your profile.', friend_accept: 'accepted your friend request.', system: '' }[n.type] || n.text);
  return (
    <div className="stack">
      <Head title="Notifications" />
      <section className="card pad">
        {list.length === 0 && <p className="muted">No notifications.</p>}
        {list.map((n) => { const u = s.users[n.from]; return (
          <div key={n.id} className={'person notif' + (seen.has(n.id) ? ' new' : '')}>
            {u ? <Avatar user={u} size={48} /> : <span className="g-icon"><IoFlag size={24} /></span>}
            <div className="grow"><span>{u && <a className="name" href={'#/profile/' + u.id}>{u.name} </a>}{text(n)}</span><small className="muted">{timeAgo(n.time)}</small>
              {n.type === 'friend_request' && requestBetween(s, n.from, user.id) && <div className="row gap"><button className="btn primary sm" onClick={() => acceptRequest(n.from)}>Confirm</button><button className="btn ghost sm" onClick={() => declineRequest(n.from)}>Delete</button></div>}
            </div></div>); })}
      </section>
    </div>
  );
}

// ---------- Who viewed my profile ----------
export function Visitors() {
  const s = useStore();
  const user = me(s);
  const st = mySettings(s);
  const list = visitsOfMe(s);
  const DAY = 86400000;
  const t = Date.now();
  const last30 = list.filter((v) => t - v.time < 30 * DAY);
  const last7 = list.filter((v) => t - v.time < 7 * DAY);
  const unique = new Set(list.map((v) => v.visitor)).size;
  return (
    <div className="stack">
      <Head title="Who Viewed Your Profile?" />
      <section className="card pad center visitors-hero">
        <IoEye size={56} color="#1F4FE0" />
        <h2>{last30.length} {last30.length === 1 ? 'visit' : 'visits'} in the last 30 days</h2>
        <div className="p-stats center-stats">
          <span><b>{list.length}</b> Total visits</span><span><b>{unique}</b> Unique visitors</span><span><b>{last7.length}</b> Last 7 days</span>
        </div>
      </section>

      <section className="card pad">
        <b>Visitor history</b>
        {!st.keepVisitors && <p className="muted">Visitor log is off — new visits are not being recorded. Turn it on in Privacy controls below.</p>}
        {list.length === 0 && <p className="muted">No visitors yet.</p>}
        {list.map((v) => { const u = s.users[v.visitor]; return (
          <div className="person" key={v.id}>
            <Avatar user={u} size={46} />
            <div className="grow"><a className="name" href={'#/profile/' + u.id}>{u.name}</a><small className="muted" title={fullTime(v.time)}>{timeAgo(v.time)} · {fullTime(v.time)}</small></div>
            <button className="icon-btn" aria-label={'Remove ' + u.name + ' from history'} onClick={() => removeVisit(v.id)}><IoTrash size={20} /></button>
            <button className="icon-btn" aria-label={'Block ' + u.name} onClick={() => { blockUser(u.id); toast(u.name + ' blocked.'); }}><IoBan size={20} /></button>
          </div>); })}
        {list.length > 0 && <button className="btn ghost danger" onClick={() => { clearVisits(); toast('Visitor history cleared.'); }}>Clear all history</button>}
      </section>

      <section className="card pad">
        <b>Privacy controls</b>
        <Toggle on={st.keepVisitors} onChange={(v) => updateSettings({ keepVisitors: v })} label="Keep a visitors list for my profile" hint="If turned off, new visits to your profile will no longer be recorded." />
        <Toggle on={st.recordMyVisits} onChange={(v) => updateSettings({ recordMyVisits: v })} label="Let others see when I visit their profile" hint="If turned off (Private mode), others will not know when you visit their profile." />
        {me(s).cloud && <>
          <Toggle on={st.showLastSeen} onChange={(v) => updateSettings({ showLastSeen: v })} label="Show my online status & last seen" hint="If turned off, you will not see anyone's online/last seen status, and no one will see yours." />
          <Toggle on={st.showReadReceipts} onChange={(v) => updateSettings({ showReadReceipts: v })} label="Send read receipts (Seen)" hint="If turned off, others will not see 'Seen' when you read their messages." />
        </>}
        <label className="toggle-row"><span><b>Auto-delete visitor history</b><small>Old visits will be hidden automatically.</small></span>
          <select className="input sel" value={st.autoDeleteDays} onChange={(e) => updateSettings({ autoDeleteDays: +e.target.value })}><option value={0}>Never</option><option value={7}>After 7 days</option><option value={30}>After 30 days</option><option value={90}>After 90 days</option></select></label>
        <p className="muted"><IoEyeOff style={{ verticalAlign: '-2px' }} /> You can delete or block any visitor at any time.</p>
      </section>
    </div>
  );
}

// ---------- Saved ----------
export function Saved() {
  const s = useStore();
  const ids = s.saved[s.me] || [];
  const posts = s.posts.filter((p) => ids.includes(p.id) && canSee(s, p));
  return (<div className="stack"><Head title="Saved" />{posts.length === 0 ? <Empty title="No saved posts" text="Tap Save under a post." /> : posts.map((p) => <PostCard key={p.id} post={p} />)}</div>);
}

// ---------- Settings ----------
export function Settings() {
  const [conn, setConn] = useState(false);
  const s = useStore();
  const user = me(s);
  const st = mySettings(s);
  const blocked = s.blocks.filter(([a]) => a === user.id).map(([, b]) => s.users[b]).filter(Boolean);
  return (
    <div className="stack">
      <Head title="Settings & Privacy" />
      <section className="card pad"><b>Account</b><p>{user.name} · @{user.username}</p><p className="muted">{user.email}</p></section>
      <section className="card pad"><b>Privacy</b>
        <Toggle on={st.profilePublic} onChange={(v) => updateSettings({ profilePublic: v })} label="Public profile" hint="If turned off, only friends can see your posts and info." />
        <label className="toggle-row"><span><b>Default post audience</b></span><select className="input sel" value={st.postAudience} onChange={(e) => updateSettings({ postAudience: e.target.value })}><option value="public">Public</option><option value="friends">Friends</option><option value="me">Only me</option></select></label>
        <label className="toggle-row"><span><b>Who can message me</b></span><select className="input sel" value={st.whoCanMessage} onChange={(e) => updateSettings({ whoCanMessage: e.target.value })}><option value="everyone">Everyone</option><option value="friends">Friends only</option></select></label>
        <a className="btn ghost" href="#/visitors"><IoEye /> Profile visitor settings</a>
      </section>
      <section className="card pad"><b>Blocked people</b>
        {blocked.length === 0 && <p className="muted">No blocked users.</p>}
        {blocked.map((u) => <div className="person" key={u.id}><Avatar user={u} size={40} /><b className="grow">{u.name}</b><button className="btn ghost sm" onClick={() => unblockUser(u.id)}>Unblock</button></div>)}
      </section>
      <section className="card pad"><b>Database</b>
        <p className="muted">{isOnline() ? (user.cloud ? '● Online: your account, name and bio are saved to Supabase. Posts, photos, messages, etc. are still on this phone only (they will go online in Phase 4+).' : '● Online mode is on, but you are using a local account. Log out and create an online account.') : '○ Local mode: all data stays in this browser only. Connect the database to go online.'}</p>
        <button className="btn ghost" onClick={() => setConn(true)}>{isOnline() ? 'Database connection' : 'Connect database'}</button>
        {conn && <ConnectSheet onClose={() => setConn(false)} />}
      </section>
      <section className="card pad"><b>Data</b>
        <p className="muted">Demo users and posts are samples only.</p>
        {s.demoOn && <button className="btn ghost" onClick={() => { clearDemo(); toast('Demo data removed.'); }}>Remove demo people &amp; posts</button>}
        <button className="btn ghost danger" onClick={() => { logout(); go('#/'); }}>Log out</button>
      </section>
    </div>
  );
}

export function Help() {
  const q = [
    ['Is this data visible to everyone?', 'No. In Phase 2 all data is only in your browser. An online database arrives in Phase 3.'],
    ['How do I add a friend?', 'Tap Add Friend on the Friends page or on a profile.'],
    ['How do I see my profile visitors?', 'Menu → Who viewed my profile. It has history, total visits and privacy controls.'],
    ['How do I report or block someone?', 'From the ⋯ menu on their profile or post.'],
  ];
  return (<div className="stack"><Head title="Help & Support" /><section className="card pad">{q.map(([a, b]) => <div key={a} className="faq"><b>{a}</b><p className="muted">{b}</p></div>)}</section></div>);
}

// ---------- Search ----------
export function SearchPage() {
  const s = useStore();
  const user = me(s);
  const [q, setQ] = useState('');
  const k = q.trim().toLowerCase();
  useEffect(() => { if (user.cloud && k.length >= 2) { const t = setTimeout(() => searchPeopleOnline(k).catch(() => {}), 350); return () => clearTimeout(t); } return undefined; }, [k]); // eslint-disable-line
  const people = k ? Object.values(s.users).filter((u) => sameWorld(s, u) && u.id !== user.id && !isBlocked(s, user.id, u.id) && (u.name.toLowerCase().includes(k) || u.username.includes(k))) : [];
  const posts = k ? s.posts.filter((p) => canSee(s, p) && p.text.toLowerCase().includes(k)) : [];
  const groups = k ? s.groups.filter((g) => g.name.toLowerCase().includes(k) && (g.privacy === 'public' || g.members.includes(user.id))) : [];
  const pages = k ? s.pages.filter((p) => p.name.toLowerCase().includes(k)) : [];
  const none = k && !people.length && !posts.length && !groups.length && !pages.length;
  return (
    <div className="stack">
      <Head title="Search" />
      <div className="search-box"><IoSearch size={20} /><input autoFocus className="input" type="search" placeholder="Search people, posts, groups, pages" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></div>
      {none && <Empty title="Nothing found" text={`No results for "${q}".`} />}
      {people.length > 0 && <section className="card pad"><b>People</b>{people.map((u) => <a key={u.id} className="person" href={'#/profile/' + u.id}><Avatar user={u} size={44} /><div><b>{u.name}</b><small className="muted">@{u.username}</small></div></a>)}</section>}
      {groups.length > 0 && <section className="card pad"><b>Groups</b>{groups.map((g) => <a key={g.id} className="person" href="#/groups"><span className="g-icon"><IoPeopleCircle size={28} /></span><b>{g.name}</b></a>)}</section>}
      {pages.length > 0 && <section className="card pad"><b>Pages</b>{pages.map((p) => <a key={p.id} className="person" href="#/pages"><span className="g-icon"><IoFlag size={24} /></span><b>{p.name}</b></a>)}</section>}
      {posts.map((p) => <PostCard key={p.id} post={p} />)}
    </div>
  );
}
