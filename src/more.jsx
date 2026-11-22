import { useEffect, useRef, useState } from 'react';
import {
  IoPeople, IoPeopleCircle, IoFlag, IoPlayCircle, IoBookmark, IoEye, IoSettings, IoHelpCircle, IoLogOut, IoChevronForward, IoAdd, IoSend, IoImage,
  IoHeart, IoHeartOutline, IoArrowBack, IoEyeOff, IoTrash, IoBan, IoSearch, IoVideocam, IoShieldCheckmark,
} from 'react-icons/io5';
import {
  useStore, me, timeAgo, fullTime, areFriends, isBlocked, requestBetween, sendRequest, acceptRequest, declineRequest, logout, clearDemo,
  createGroup, toggleGroup, createPage, togglePage, addReel, toggleReelLike, saveVideo, openChat, createGroupChat, sendMessage, markNotifsRead,
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
        {reqs.length === 0 && <p className="muted">কোনো নতুন অনুরোধ নেই।</p>}
        {reqs.map((r) => { const u = s.users[r.from]; return u && (
          <div className="person" key={r.from}><Avatar user={u} size={52} /><div className="grow"><a className="name" href={'#/profile/' + u.id}>{u.name}</a><small className="muted">{timeAgo(r.time)}</small>
            <div className="row gap"><button className="btn primary sm" onClick={() => acceptRequest(u.id)}>Confirm</button><button className="btn ghost sm" onClick={() => declineRequest(u.id)}>Delete</button></div></div></div>); })}
      </section>
      <section className="card pad"><b>People you may know</b>
        {sug.length === 0 && <p className="muted">এখন কোনো সাজেশন নেই।</p>}
        {sug.map((u) => { const rq = requestBetween(s, user.id, u.id); return (
          <div className="person" key={u.id}><Avatar user={u} size={48} /><div className="grow"><a className="name" href={'#/profile/' + u.id}>{u.name}</a><small className="muted">@{u.username}</small></div>
            {rq ? <button className="btn ghost sm" onClick={() => declineRequest(u.id)}>Cancel</button> : <button className="btn primary sm" onClick={() => { sendRequest(u.id); toast('অনুরোধ পাঠানো হয়েছে।'); }}>Add</button>}</div>); })}
      </section>
      <section className="card pad"><b>Your friends ({mine.length})</b>
        {mine.length === 0 && <p className="muted">এখনও কোনো বন্ধু নেই।</p>}
        {mine.map((u) => <a className="person" key={u.id} href={'#/profile/' + u.id}><Avatar user={u} size={44} /><b>{u.name}</b></a>)}
      </section>
    </div>
  );
}

// ---------- Reels ----------
function ReelItem({ r }) {
  const s = useStore();
  const user = me(s);
  const a = s.users[r.author];
  const ref = useRef();
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { const v = el.querySelector('video'); if (v) { if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); } }, { threshold: 0.6 });
    io.observe(el); return () => io.disconnect();
  }, []);
  const liked = r.likes.includes(user.id);
  return (
    <div className="reel" ref={ref}>
      <Video vkey={r.videoKey} url={r.videoUrl} className="reel-video" controls={false} loop muted autoPlay onClick={(e) => (e.target.paused ? e.target.play() : e.target.pause())} />
      <div className="reel-side">
        {r.author === user.id && <button aria-label="Delete reel" onClick={() => { deleteReel(r.id); toast('রিল মুছে ফেলা হয়েছে।'); }}><IoTrash size={26} /></button>}
        <button aria-label="Like" onClick={() => toggleReelLike(r.id)}>{liked ? <IoHeart size={32} color="#FF4D6D" /> : <IoHeartOutline size={32} />}<small>{r.likes.length}</small></button>
      </div>
      <div className="reel-info"><a href={'#/profile/' + r.author} className="row gap"><Avatar user={a} size={36} /><b>{a?.name}</b></a>{r.caption && <p>{r.caption}</p>}</div>
    </div>
  );
}
export function Reels() {
  const s = useStore();
  useEffect(() => { if (me(s).cloud) refreshMedia(); }, []); // eslint-disable-line
  const reels = s.reels.filter((r) => !!r.cloud === !!me(s).cloud && !isBlocked(s, s.me, r.author));
  const [up, setUp] = useState(false);
  const [file, setFile] = useState(null);
  const [cap, setCap] = useState('');
  const [busy, setBusy] = useState(false);
  const fr = useRef();
  const post = async () => {
    setBusy(true);
    try {
      if (me(s).cloud) { const err = await addReelOnline(file, cap.trim()); if (err) throw new Error(err); } else addReel(await saveVideo(file), cap.trim());
      setUp(false); setFile(null); setCap(''); toast(me(s).cloud ? 'রিল অনলাইনে পোস্ট হয়েছে।' : 'রিল পোস্ট হয়েছে।');
    } catch (e) { toast('রিল সেভ করা যায়নি: ' + e.message); }
    setBusy(false);
  };
  return (
    <div className="reels">
      <div className="reels-head"><h1>Reels</h1><button className="icon-btn light" aria-label="Create reel" onClick={() => setUp(true)}><IoAdd size={26} /></button></div>
      {reels.length === 0 ? (
        <div className="reel empty-reel"><Empty title="এখনও কোনো রিল নেই" text="প্রথম ছোট ভিডিওটি আপনিই আপলোড করুন।"><button className="btn primary" onClick={() => setUp(true)}><IoVideocam /> Upload a reel</button></Empty></div>
      ) : reels.map((r) => <ReelItem key={r.id} r={r} />)}
      {up && (
        <Sheet title="New reel" onClose={() => setUp(false)}>
          <button className="btn ghost" onClick={() => fr.current.click()}><IoVideocam /> {file ? file.name : 'Choose a video'}</button>
          <input ref={fr} hidden type="file" accept="video/*" onChange={(e) => { const f = e.target.files[0]; if (f && f.size > 80e6) toast('ভিডিও ৮০MB-এর কম হতে হবে।'); else if (f) setFile(f); }} />
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
    ['Saved', '#/saved', IoBookmark, '#4F46E5'],
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
        {list.length === 0 && <p className="muted">কোনো নোটিফিকেশন নেই।</p>}
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
        {!st.keepVisitors && <p className="muted">Visitor log বন্ধ আছে — নতুন ভিজিট রেকর্ড হচ্ছে না। নিচের Privacy controls থেকে চালু করুন।</p>}
        {list.length === 0 && <p className="muted">এখনও কোনো ভিজিটর নেই।</p>}
        {list.map((v) => { const u = s.users[v.visitor]; return (
          <div className="person" key={v.id}>
            <Avatar user={u} size={46} />
            <div className="grow"><a className="name" href={'#/profile/' + u.id}>{u.name}</a><small className="muted" title={fullTime(v.time)}>{timeAgo(v.time)} · {fullTime(v.time)}</small></div>
            <button className="icon-btn" aria-label={'Remove ' + u.name + ' from history'} onClick={() => removeVisit(v.id)}><IoTrash size={20} /></button>
            <button className="icon-btn" aria-label={'Block ' + u.name} onClick={() => { blockUser(u.id); toast(u.name + ' ব্লক করা হয়েছে।'); }}><IoBan size={20} /></button>
          </div>); })}
        {list.length > 0 && <button className="btn ghost danger" onClick={() => { clearVisits(); toast('ভিজিটর হিস্ট্রি মুছে ফেলা হয়েছে।'); }}>Clear all history</button>}
      </section>

      <section className="card pad">
        <b>Privacy controls</b>
        <Toggle on={st.keepVisitors} onChange={(v) => updateSettings({ keepVisitors: v })} label="Keep a visitors list for my profile" hint="বন্ধ করলে আপনার প্রোফাইলে নতুন ভিজিট আর রেকর্ড হবে না।" />
        <Toggle on={st.recordMyVisits} onChange={(v) => updateSettings({ recordMyVisits: v })} label="Let others see when I visit their profile" hint="বন্ধ করলে (Private mode) আপনি কারও প্রোফাইলে গেলে সে জানবে না।" />
        {me(s).cloud && <>
          <Toggle on={st.showLastSeen} onChange={(v) => updateSettings({ showLastSeen: v })} label="Show my online status & last seen" hint="বন্ধ করলে আপনি কারও অনলাইন/last seen দেখতে পাবেন না, কেউ আপনারটাও দেখবে না।" />
          <Toggle on={st.showReadReceipts} onChange={(v) => updateSettings({ showReadReceipts: v })} label="Send read receipts (Seen)" hint="বন্ধ করলে মেসেজ পড়লে অন্যজন 'Seen' দেখবে না।" />
        </>}
        <label className="toggle-row"><span><b>Auto-delete visitor history</b><small>পুরনো ভিজিট নিজে থেকে লুকানো হবে।</small></span>
          <select className="input sel" value={st.autoDeleteDays} onChange={(e) => updateSettings({ autoDeleteDays: +e.target.value })}><option value={0}>Never</option><option value={7}>After 7 days</option><option value={30}>After 30 days</option><option value={90}>After 90 days</option></select></label>
        <p className="muted"><IoEyeOff style={{ verticalAlign: '-2px' }} /> আপনি ইচ্ছামতো যেকোনো ভিজিটর মুছতে বা ব্লক করতে পারেন।</p>
      </section>
    </div>
  );
}

// ---------- Saved ----------
export function Saved() {
  const s = useStore();
  const ids = s.saved[s.me] || [];
  const posts = s.posts.filter((p) => ids.includes(p.id) && canSee(s, p));
  return (<div className="stack"><Head title="Saved" />{posts.length === 0 ? <Empty title="কোনো সেভ করা পোস্ট নেই" text="পোস্টের নিচে Save চাপুন।" /> : posts.map((p) => <PostCard key={p.id} post={p} />)}</div>);
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
        <Toggle on={st.profilePublic} onChange={(v) => updateSettings({ profilePublic: v })} label="Public profile" hint="বন্ধ করলে শুধু বন্ধুরা আপনার পোস্ট ও তথ্য দেখবে।" />
        <label className="toggle-row"><span><b>Default post audience</b></span><select className="input sel" value={st.postAudience} onChange={(e) => updateSettings({ postAudience: e.target.value })}><option value="public">Public</option><option value="friends">Friends</option><option value="me">Only me</option></select></label>
        <label className="toggle-row"><span><b>Who can message me</b></span><select className="input sel" value={st.whoCanMessage} onChange={(e) => updateSettings({ whoCanMessage: e.target.value })}><option value="everyone">Everyone</option><option value="friends">Friends only</option></select></label>
        <a className="btn ghost" href="#/visitors"><IoEye /> Profile visitor settings</a>
      </section>
      <section className="card pad"><b>Blocked people</b>
        {blocked.length === 0 && <p className="muted">কাউকে ব্লক করা নেই।</p>}
        {blocked.map((u) => <div className="person" key={u.id}><Avatar user={u} size={40} /><b className="grow">{u.name}</b><button className="btn ghost sm" onClick={() => unblockUser(u.id)}>Unblock</button></div>)}
      </section>
      <section className="card pad"><b>Database</b>
        <p className="muted">{isOnline() ? (user.cloud ? '● Online: আপনার অ্যাকাউন্ট, নাম ও বায়ো Supabase-এ সেভ হয়। পোস্ট, ছবি, মেসেজ ইত্যাদি এখনও শুধু এই ফোনে (Phase 4+ এ অনলাইনে যাবে)।' : '● Online mode চালু, কিন্তু আপনি লোকাল অ্যাকাউন্টে আছেন। লগ আউট করে অনলাইন অ্যাকাউন্ট বানান।') : '○ Local mode: সব তথ্য শুধু এই ব্রাউজারে। অনলাইনে নিতে ডাটাবেস কানেক্ট করুন।'}</p>
        <button className="btn ghost" onClick={() => setConn(true)}>{isOnline() ? 'Database connection' : 'Connect database'}</button>
        {conn && <ConnectSheet onClose={() => setConn(false)} />}
      </section>
      <section className="card pad"><b>Data</b>
        <p className="muted">ডেমো ব্যবহারকারী ও পোস্ট শুধু নমুনা।</p>
        {s.demoOn && <button className="btn ghost" onClick={() => { clearDemo(); toast('ডেমো তথ্য মুছে ফেলা হয়েছে।'); }}>Remove demo people &amp; posts</button>}
        <button className="btn ghost danger" onClick={() => { logout(); go('#/'); }}>Log out</button>
      </section>
    </div>
  );
}

export function Help() {
  const q = [
    ['এই ডেটা কি সবার কাছে দেখা যায়?', 'না। Phase 2-এ সব তথ্য শুধু আপনার ব্রাউজারে আছে। Phase 3-এ অনলাইন ডাটাবেস আসবে।'],
    ['কিভাবে বন্ধু যোগ করব?', 'Friends পেজে বা কারও প্রোফাইলে Add Friend চাপুন।'],
    ['কিভাবে প্রোফাইল ভিজিটর দেখব?', 'Menu → Who viewed my profile। সেখানে হিস্ট্রি, মোট ভিজিট ও প্রাইভেসি কন্ট্রোল আছে।'],
    ['কাউকে রিপোর্ট/ব্লক করব কীভাবে?', 'তার প্রোফাইল বা পোস্টের ⋯ মেনু থেকে।'],
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
      {none && <Empty title="কিছু পাওয়া যায়নি" text={`"${q}" এর জন্য কোনো ফলাফল নেই।`} />}
      {people.length > 0 && <section className="card pad"><b>People</b>{people.map((u) => <a key={u.id} className="person" href={'#/profile/' + u.id}><Avatar user={u} size={44} /><div><b>{u.name}</b><small className="muted">@{u.username}</small></div></a>)}</section>}
      {groups.length > 0 && <section className="card pad"><b>Groups</b>{groups.map((g) => <a key={g.id} className="person" href="#/groups"><span className="g-icon"><IoPeopleCircle size={28} /></span><b>{g.name}</b></a>)}</section>}
      {pages.length > 0 && <section className="card pad"><b>Pages</b>{pages.map((p) => <a key={p.id} className="person" href="#/pages"><span className="g-icon"><IoFlag size={24} /></span><b>{p.name}</b></a>)}</section>}
      {posts.map((p) => <PostCard key={p.id} post={p} />)}
    </div>
  );
}
