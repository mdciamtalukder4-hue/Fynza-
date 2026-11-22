import { useRef, useState, useEffect } from 'react';
import { IoImage, IoVideocam, IoEllipsisHorizontal, IoThumbsUp, IoThumbsUpOutline, IoChatbubbleOutline, IoShareSocialOutline, IoBookmark, IoBookmarkOutline, IoGlobeOutline, IoPeopleOutline, IoLockClosedOutline, IoAdd, IoSend } from 'react-icons/io5';
import {
  useStore, me, uid, timeAgo, addPost, addPostOnline, refreshFeed, sameWorld, deletePost, react, addComment, sharePost, toggleSave, addStory, addStoryOnline, deleteStory, liveStories,
  areFriends, isBlocked, compressImage, saveVideo, sendRequest, acceptRequest, declineRequest, requestBetween, report, blockUser, mySettings, saveError,
} from './store.js';
import { askReport, SponsoredSlot } from './monet.jsx';
import { Avatar, Scene, Video, Sheet, toast, Empty, go, Badge } from './ui.jsx';

export const REACTIONS = { like: '👍', love: '❤️', haha: '😂', wow: '😮', sad: '😢', angry: '😡' };
const AUD = { public: ['Public', IoGlobeOutline], friends: ['Friends', IoPeopleOutline], me: ['Only me', IoLockClosedOutline] };

export const canSee = (s, p) => {
  const u = s.me;
  if (!!p.cloud !== !!s.users[u]?.cloud) return false;
  if (isBlocked(s, u, p.author)) return false;
  if (p.author === u || p.aud === 'public') return true;
  return p.aud === 'friends' && areFriends(s, u, p.author);
};

// ---------- Stories ----------
const BGS = ['linear-gradient(160deg,#2E6BFF,#1A2BB8)', 'linear-gradient(160deg,#FF8F5A,#C2477B)', 'linear-gradient(160deg,#16A34A,#0E7490)', 'linear-gradient(160deg,#7C3AED,#DB2777)'];

function Stories() {
  const s = useStore();
  const user = me(s);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState(null);
  const stories = liveStories(s).filter((x) => !!x.cloud === !!user.cloud && !isBlocked(s, user.id, x.author));
  return (
    <>
      <div className="stories" aria-label="Stories">
        <button className="story add" onClick={() => setCreating(true)} aria-label="Create story">
          <Avatar user={user} size={64} /><i className="plus"><IoAdd size={16} /></i><span>Create Story</span>
        </button>
        {stories.map((st) => {
          const a = s.users[st.author];
          return (
            <button key={st.id} className="story" onClick={() => setView(st)}>
              <Avatar user={a} size={58} ring /><span>{st.author === user.id ? 'Your story' : a?.name.split(' ')[0]}</span>
            </button>
          );
        })}
      </div>
      {creating && <StoryCreate onClose={() => setCreating(false)} />}
      {view && <StoryView st={view} onClose={() => setView(null)} />}
    </>
  );
}

function StoryCreate({ onClose }) {
  const s0 = useStore();
  const [text, setText] = useState('');
  const [bg, setBg] = useState(BGS[0]);
  const [img, setImg] = useState('');
  const file = useRef();
  const [busy, setBusy] = useState(false);
  const cloudMe = () => me(s0).cloud;
  const post = async () => {
    if (!text.trim() && !img) return toast('লেখা বা ছবি দিন।');
    setBusy(true);
    const err = cloudMe() ? await addStoryOnline({ text: text.trim(), img, bg }) : (addStory({ text: text.trim(), img, bg }), null);
    setBusy(false);
    if (err) return toast('স্টোরি হয়নি: ' + err);
    toast('স্টোরি পোস্ট হয়েছে — ২৪ ঘণ্টা থাকবে।'); onClose();
  };
  return (
    <Sheet title="Create Story" onClose={onClose}>
      <div className="story-preview" style={{ background: img ? `center/cover url(${img})` : bg }}>{text || 'আপনার লেখা এখানে দেখাবে'}</div>
      <textarea className="input" rows={2} maxLength={140} placeholder="কিছু লিখুন…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Story text" />
      <div className="row gap">
        {BGS.map((b) => <button key={b} aria-label="Background" className={'swatch' + (bg === b && !img ? ' on' : '')} style={{ background: b }} onClick={() => { setBg(b); setImg(''); }} />)}
        <button className="btn ghost sm" onClick={() => file.current.click()}><IoImage /> ছবি</button>
        <input ref={file} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files[0]; if (f) setImg(await compressImage(f, 800)); }} />
      </div>
      <button className="btn primary big" disabled={busy} onClick={post}>{busy ? 'Uploading…' : 'Share to Story'}</button>
    </Sheet>
  );
}

function StoryView({ st, onClose }) {
  const s = useStore();
  const a = s.users[st.author];
  useEffect(() => { const t = setTimeout(onClose, 6000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className="story-view" onClick={onClose} style={{ background: st.img ? `#000 center/contain no-repeat url(${st.img})` : st.bg }}>
      <div className="story-bar"><i /></div>
      <div className="story-who"><Avatar user={a} size={36} /><b>{a?.name}</b><small>{timeAgo(st.time)}</small></div>
      {st.text && <p className="story-text">{st.text}</p>}
      {st.author === s.me && <button className="btn ghost sm story-del" onClick={(e) => { e.stopPropagation(); deleteStory(st.id); onClose(); toast('স্টোরি মুছে ফেলা হয়েছে।'); }}>Delete</button>}
    </div>
  );
}

// ---------- Composer ----------
export function Composer() {
  const s = useStore();
  const user = me(s);
  const [text, setText] = useState('');
  const [img, setImg] = useState('');
  const [vid, setVid] = useState(null);
  const [aud, setAud] = useState(mySettings(s).postAudience);
  const [busy, setBusy] = useState(false);
  const imgRef = useRef(); const vidRef = useRef();
  const post = async () => {
    if (!text.trim() && !img && !vid) return;
    setBusy(true);
    try {
      if (user.cloud) {
        const err = await addPostOnline({ text: text.trim(), imgDataUrl: img, videoFile: vid, aud });
        if (err) { toast('পোস্ট হয়নি: ' + err); setBusy(false); return; }
        setText(''); setImg(''); setVid(null); toast('পোস্ট অনলাইনে হয়েছে।');
      } else {
        const videoKey = vid ? await saveVideo(vid) : '';
        addPost({ text: text.trim(), img, videoKey, aud });
        setText(''); setImg(''); setVid(null); toast('পোস্ট হয়েছে।');
        if (saveError) toast(saveError);
      }
    } catch (e) { toast('পোস্ট করা যায়নি। আবার চেষ্টা করুন।'); }
    setBusy(false);
  };
  return (
    <section className="card composer">
      <div className="row gap">
        <Avatar user={user} size={44} onClick={() => go('#/profile/' + user.id)} />
        <textarea className="comp-input" rows={text.length > 60 ? 3 : 1} placeholder="What's on your mind?" value={text} onChange={(e) => setText(e.target.value)} aria-label="Write a post" />
      </div>
      {img && <div className="preview"><img src={img} alt="" /><button className="icon-btn x" aria-label="Remove photo" onClick={() => setImg('')}>✕</button></div>}
      {vid && <div className="preview"><span className="chip">🎬 {vid.name}</span><button className="icon-btn x" aria-label="Remove video" onClick={() => setVid(null)}>✕</button></div>}
      <div className="comp-actions">
        <button className="btn ghost sm" onClick={() => imgRef.current.click()}><IoImage color="#16A34A" /> Photo</button>
        <button className="btn ghost sm" onClick={() => vidRef.current.click()}><IoVideocam color="#DB2777" /> Video</button>
        <input ref={imgRef} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files[0]; if (f) setImg(await compressImage(f)); e.target.value = ''; }} />
        <input ref={vidRef} type="file" accept="video/*" hidden onChange={(e) => { const f = e.target.files[0]; if (f) { if (f.size > (user.cloud ? 45e6 : 60e6)) toast('ভিডিও ' + (user.cloud ? '৪৫' : '৬০') + 'MB-এর কম হতে হবে।'); else setVid(f); } e.target.value = ''; }} />
        <select className="aud" value={aud} onChange={(e) => setAud(e.target.value)} aria-label="Audience">
          <option value="public">🌐 Public</option><option value="friends">👥 Friends</option><option value="me">🔒 Only me</option>
        </select>
        <button className="btn primary sm" disabled={busy || (!text.trim() && !img && !vid)} onClick={post}>Post</button>
      </div>
    </section>
  );
}

// ---------- Post ----------
function Comments({ post }) {
  const s = useStore();
  const [t, setT] = useState('');
  const [reply, setReply] = useState(null);
  const send = (e) => { e.preventDefault(); if (!t.trim()) return; addComment(post.id, t.trim(), reply); setT(''); setReply(null); };
  const one = (c, sub) => {
    const a = s.users[c.author];
    return (
      <div key={c.id} className={'comment' + (sub ? ' sub' : '')}>
        <Avatar user={a} size={sub ? 28 : 34} />
        <div><div className="bubble"><b>{a?.name || 'Unknown'}</b><p>{c.text}</p></div>
          <small>{timeAgo(c.time)}{!sub && <> · <button className="link-btn" onClick={() => setReply(c.id)}>Reply</button></>}</small></div>
      </div>
    );
  };
  return (
    <div className="comments">
      {post.comments.map((c) => (<div key={c.id}>{one(c)}{c.replies.map((r) => one(r, true))}</div>))}
      <form className="row gap" onSubmit={send}>
        <input className="input" aria-label="Write a comment" placeholder={reply ? 'Write a reply…' : 'Write a comment…'} value={t} onChange={(e) => setT(e.target.value)} />
        <button className="icon-btn send" aria-label="Send comment"><IoSend size={20} /></button>
      </form>
      {reply && <small className="muted">উত্তর দিচ্ছেন · <button className="link-btn" onClick={() => setReply(null)}>বাতিল</button></small>}
    </div>
  );
}

export function PostCard({ post, embedded }) {
  const s = useStore();
  const user = me(s);
  const a = s.users[post.author];
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(false);
  const [share, setShare] = useState(false);
  const timer = useRef();
  const mine = post.reactions[user.id];
  const counts = Object.values(post.reactions);
  const saved = (s.saved[user.id] || []).includes(post.id);
  const orig = post.shareOf && s.posts.find((p) => p.id === post.shareOf);
  const commentsN = post.comments.reduce((n, c) => n + 1 + c.replies.length, 0);
  const [audLabel, AudIcon] = AUD[post.aud] || AUD.public;
  const press = () => { timer.current = setTimeout(() => setPicker(true), 450); };
  const release = () => clearTimeout(timer.current);

  return (
    <article className={'card post' + (embedded ? ' embedded' : '')}>
      <div className="post-head">
        <Avatar user={a} size={44} onClick={() => go('#/profile/' + post.author)} />
        <div className="grow"><a className="name" href={'#/profile/' + post.author}>{a?.name || 'Unknown'}<Badge on={a?.verified} /></a>
          <small className="muted">{timeAgo(post.time)}{post.pageId && s.pages.find((x) => x.id === post.pageId) ? <> · <a href={'#/page/' + post.pageId}>📄 {s.pages.find((x) => x.id === post.pageId).name}</a></> : null} · <AudIcon size={12} style={{ verticalAlign: '-1px' }} aria-label={audLabel} /></small></div>
        {!embedded && <button className="icon-btn" aria-label="More" onClick={() => setMenu(true)}><IoEllipsisHorizontal size={20} /></button>}
      </div>
      {post.text && <p className="post-text">{post.text}</p>}
      {post.scene && <Scene kind={post.scene} />}
      {post.img && <img className="post-img" src={post.img} alt="" loading="lazy" />}
      {post.videoKey && <Video vkey={post.videoKey} className="post-video" />}
      {post.videoUrl && <Video url={post.videoUrl} className="post-video" />}
      {post.shareOf && (orig && canSee(s, orig) ? <PostCard post={orig} embedded /> : <div className="muted pad">এই পোস্টটি আর পাওয়া যাচ্ছে না।</div>)}
      {!embedded && (
        <>
          <div className="post-stats">
            <span>{counts.length > 0 && <>{[...new Set(counts)].slice(0, 3).map((t) => REACTIONS[t]).join('')} {counts.length}</>}</span>
            <span>{commentsN > 0 && <button className="link-btn" onClick={() => setOpen(!open)}>{commentsN} comments</button>}</span>
          </div>
          <div className="post-actions">
            <div className="react-wrap">
              {picker && (
                <div className="picker" onMouseLeave={() => setPicker(false)}>
                  {Object.entries(REACTIONS).map(([k, e]) => <button key={k} aria-label={k} onClick={() => { react(post.id, k); setPicker(false); }}>{e}</button>)}
                </div>
              )}
              <button className={mine ? 'on' : ''} onClick={() => react(post.id, mine ? null : 'like')} onMouseEnter={() => setPicker(true)} onPointerDown={press} onPointerUp={release} onPointerLeave={release}>
                {mine ? <span>{REACTIONS[mine]}</span> : <IoThumbsUpOutline size={20} />} {mine ? mine[0].toUpperCase() + mine.slice(1) : 'Like'}
              </button>
            </div>
            <button onClick={() => setOpen(!open)}><IoChatbubbleOutline size={20} /> Comment</button>
            <button onClick={() => setShare(true)}><IoShareSocialOutline size={20} /> Share</button>
            <button className={saved ? 'on' : ''} onClick={() => { toggleSave(post.id); toast(saved ? 'সেভ থেকে সরানো হয়েছে।' : 'সেভ করা হয়েছে।'); }}>{saved ? <IoBookmark size={20} /> : <IoBookmarkOutline size={20} />} Save</button>
          </div>
          {open && <Comments post={post} />}
        </>
      )}
      {menu && (
        <Sheet title="Post options" onClose={() => setMenu(false)}>
          {post.author === user.id ? (
            <button className="menu-item danger" onClick={() => { deletePost(post.id); setMenu(false); toast('পোস্ট মুছে ফেলা হয়েছে।'); }}>Delete post</button>
          ) : (
            <>
              <button className="menu-item" onClick={() => { setMenu(false); askReport('post', post.id); }}>Report post</button>
              <button className="menu-item danger" onClick={() => { blockUser(post.author); setMenu(false); toast(a?.name + ' ব্লক করা হয়েছে।'); }}>Block {a?.name}</button>
            </>
          )}
        </Sheet>
      )}
      {share && <ShareSheet post={post} onClose={() => setShare(false)} />}
    </article>
  );
}

function ShareSheet({ post, onClose }) {
  const [t, setT] = useState('');
  return (
    <Sheet title="Share post" onClose={onClose}>
      <textarea className="input" rows={2} placeholder="কিছু বলুন (ঐচ্ছিক)…" value={t} onChange={(e) => setT(e.target.value)} />
      <button className="btn primary big" onClick={() => { sharePost(post.shareOf || post.id, t.trim()); onClose(); toast('আপনার ফিডে শেয়ার হয়েছে।'); }}>Share now</button>
    </Sheet>
  );
}

// ---------- Feed ----------
export function Feed() {
  const s = useStore();
  const posts = s.posts.filter((p) => canSee(s, p) && !p.groupId);
  return (
    <div className="stack">
      {me(s).cloud ? <div className="local-note">☁️ অনলাইন মোড: পোস্ট, লাইক, কমেন্ট, সেভ, স্টোরি — সব ডাটাবেসে জমা হয়।<button className="btn ghost sm" onClick={() => refreshFeed()}>↻ Refresh</button></div> : null}
      <Stories />
      <Composer />
      {posts.length === 0 && <Empty title="ফিড এখনও খালি" text="উপরে প্রথম পোস্টটি লিখুন, অথবা বন্ধু খুঁজুন।"><a className="btn primary sm" href="#/friends">Find friends</a></Empty>}
      {me(s).cloud && <SponsoredSlot country={me(s).country} />}
      {posts.map((p) => <PostCard key={p.id} post={p} />)}
    </div>
  );
}

// ---------- Right rail (desktop) ----------
export function SideRail() {
  const s = useStore();
  const user = me(s);
  const reqs = s.requests.filter((r) => r.to === user.id);
  const sug = Object.values(s.users).filter((u) => sameWorld(s, u) && u.id !== user.id && !areFriends(s, user.id, u.id) && !requestBetween(s, user.id, u.id) && !isBlocked(s, user.id, u.id)).slice(0, 4);
  return (
    <div className="stack">
      <section className="card pad"><b>Friend requests</b>
        {reqs.length === 0 && <p className="muted">কোনো নতুন অনুরোধ নেই।</p>}
        {reqs.map((r) => { const u = s.users[r.from]; return u && (
          <div className="person" key={r.from}><Avatar user={u} size={40} /><div className="grow"><a className="name" href={'#/profile/' + u.id}>{u.name}</a>
            <div className="row gap"><button className="btn primary sm" onClick={() => acceptRequest(u.id)}>Confirm</button><button className="btn ghost sm" onClick={() => declineRequest(u.id)}>Delete</button></div></div></div>); })}
      </section>
      <section className="card pad"><b>People you may know</b>
        {sug.length === 0 && <p className="muted">এখন কোনো সাজেশন নেই।</p>}
        {sug.map((u) => (<div className="person" key={u.id}><Avatar user={u} size={40} /><div className="grow"><a className="name" href={'#/profile/' + u.id}>{u.name}</a></div>
          <button className="btn primary sm" onClick={() => { sendRequest(u.id); toast('অনুরোধ পাঠানো হয়েছে।'); }}>Add</button></div>))}
      </section>
    </div>
  );
}
