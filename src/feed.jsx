import { useRef, useState, useEffect } from 'react';
import { IoImage, IoVideocam, IoEllipsisHorizontal, IoThumbsUp, IoThumbsUpOutline, IoChatbubbleOutline, IoShareSocialOutline, IoBookmark, IoBookmarkOutline, IoGlobeOutline, IoPeopleOutline, IoLockClosedOutline, IoAdd, IoSend, IoAlbumsOutline, IoTimeOutline, IoLinkOutline, IoPaperPlaneOutline } from 'react-icons/io5';
import {
  useStore, me, uid, timeAgo, addPost, addPostOnline, refreshFeed, sameWorld, deletePost, react, addComment, sharePost, toggleSave, addStory, addStoryOnline, deleteStory, liveStories,
  areFriends, isBlocked, compressImage, saveVideo, sendRequest, acceptRequest, declineRequest, requestBetween, report, blockUser, mySettings, saveError,
  fullTime, loadMoreFeed, openPostOnline, ensureUsers, deleteComment, toggleCommentLike, publishNow, openChatOnline, openChat, sendMessage,
} from './store.js';
import { askReport, SponsoredSlot } from './monet.jsx';
import { Avatar, Scene, Video, Sheet, toast, Empty, go, Badge, useHash } from './ui.jsx';

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
const STORY_MS = 6000;

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {
    try { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e2) { return false; }
  }
}
const postLink = (id) => location.href.split('#')[0] + '#/post/' + id;
const pad2 = (n) => String(n).padStart(2, '0');
const localInput = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

function Stories({ creating, setCreating }) {
  const s = useStore();
  const user = me(s);
  const [view, setView] = useState(null);
  const visible = liveStories(s).filter((x) => !!x.cloud === !!user.cloud && !isBlocked(s, user.id, x.author));
  const authors = [...new Set(visible.map((x) => x.author))];
  const ordered = authors.flatMap((au) => visible.filter((x) => x.author === au).sort((p, q) => p.time - q.time));
  return (
    <>
      <div className="stories" aria-label="Stories">
        <button className="story add" onClick={() => setCreating(true)} aria-label="Create story">
          <Avatar user={user} size={64} /><i className="plus"><IoAdd size={16} /></i><span>Create Story</span>
        </button>
        {authors.map((au) => {
          const a = s.users[au];
          const first = ordered.find((x) => x.author === au);
          return (
            <button key={au} className="story" onClick={() => setView(ordered.indexOf(first))}>
              <Avatar user={a} size={58} ring /><span>{au === user.id ? 'Your story' : a?.name.split(' ')[0]}</span>
            </button>
          );
        })}
      </div>
      {creating && <StoryCreate onClose={() => setCreating(false)} />}
      {view !== null && <StoryView list={ordered} start={view} onClose={() => setView(null)} />}
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
    if (!text.trim() && !img) return toast('Add some text or a photo.');
    setBusy(true);
    const err = cloudMe() ? await addStoryOnline({ text: text.trim(), img, bg }) : (addStory({ text: text.trim(), img, bg }), null);
    setBusy(false);
    if (err) return toast('Story failed: ' + err);
    toast('Story posted — it will stay for 24 hours.'); onClose();
  };
  return (
    <Sheet title="Create Story" onClose={onClose}>
      <div className="story-preview" style={{ background: img ? `center/cover url(${img})` : bg }}>{text || 'Your text will appear here'}</div>
      <textarea className="input" rows={2} maxLength={140} placeholder="Write something…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Story text" />
      <div className="row gap">
        {BGS.map((b) => <button key={b} aria-label="Background" className={'swatch' + (bg === b && !img ? ' on' : '')} style={{ background: b }} onClick={() => { setBg(b); setImg(''); }} />)}
        <button className="btn ghost sm" onClick={() => file.current.click()}><IoImage /> Photo</button>
        <input ref={file} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files[0]; if (f) setImg(await compressImage(f, 800)); }} />
      </div>
      <button className="btn primary big" disabled={busy} onClick={post}>{busy ? 'Uploading…' : 'Share to Story'}</button>
    </Sheet>
  );
}

function StoryView({ list, start, onClose }) {
  const s = useStore();
  const [i, setI] = useState(start);
  const [pct, setPct] = useState(0);
  const paused = useRef(false);
  const down = useRef(0);
  const st = list[i];
  const group = list.map((x, k) => [x, k]).filter(([x]) => x.author === st?.author).map(([, k]) => k);
  const next = () => (i < list.length - 1 ? (setI(i + 1), setPct(0)) : onClose());
  const prev = () => (i > 0 && list[i - 1].author === st.author ? (setI(i - 1), setPct(0)) : setPct(0));
  useEffect(() => {
    let raf; let last = performance.now();
    const tick = (t) => { if (!paused.current) setPct((p) => p + ((t - last) / STORY_MS) * 100); last = t; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [i]);
  useEffect(() => { if (pct >= 100) next(); }); // eslint-disable-line
  if (!st) return null;
  const a = s.users[st.author];
  const pos = group.indexOf(i);
  const onDown = () => { paused.current = true; down.current = Date.now(); };
  const onUp = (e) => {
    paused.current = false;
    if (Date.now() - down.current < 250) { const r = e.currentTarget.getBoundingClientRect(); (e.clientX - r.left < r.width * 0.35 ? prev : next)(); }
  };
  return (
    <div className="story-view" style={{ background: st.img ? `#000 center/contain no-repeat url(${st.img})` : st.bg }}>
      <div className="story-tap" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { paused.current = false; }} onContextMenu={(e) => e.preventDefault()} aria-label="Story: tap right for next, left for previous, hold to pause" />
      <div className="story-bars">{group.map((k, n) => <div key={k} className="story-bar2"><i style={{ width: (n < pos ? 100 : n === pos ? Math.min(100, pct) : 0) + '%' }} /></div>)}</div>
      <div className="story-who"><Avatar user={a} size={36} /><b>{a?.name}</b><small>{timeAgo(st.time)}</small></div>
      <button className="icon-btn story-x" aria-label="Close story" onClick={onClose}>✕</button>
      {st.text && <p className="story-text">{st.text}</p>}
      {st.author === s.me && <button className="btn ghost sm story-del" onClick={() => { deleteStory(st.id); onClose(); toast('Story deleted.'); }}>Delete</button>}
    </div>
  );
}

// ---------- Welcome card ----------
function WelcomeCard() {
  const s = useStore();
  const user = me(s);
  const key = 'fynza_welcome_off_' + user.id;
  const [off, setOff] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch (e) { return false; } });
  if (off || !user.cloud || !user.created || Date.now() - user.created > 7 * 86400000) return null;
  const hasPhoto = !!user.avatar;
  const hasFriend = s.friends.some(([x, y]) => x === user.id || y === user.id);
  const hasPost = s.posts.some((p) => p.author === user.id && p.cloud && !p.groupId);
  const items = [[hasPhoto, 'Add a profile photo', '#/profile/' + user.id], [hasFriend, 'Add a friend', '#/friends'], [hasPost, 'Share your first post', '#/feed']];
  const done = items.filter((i) => i[0]).length;
  const dismiss = () => { setOff(true); try { localStorage.setItem(key, '1'); } catch (e) { /* ignore */ } };
  return (
    <section className="card pad welcome-card" aria-label="Welcome">
      <div className="row gap"><b className="grow">Welcome to FYNZA, {user.name.split(' ')[0]}!</b><button className="icon-btn" aria-label="Dismiss welcome card" onClick={dismiss}>✕</button></div>
      <p className="muted">{done} of 3 done. Finish these steps to get started.</p>
      {items.map(([ok, label, href]) => (
        <a key={label} className={'wc-item' + (ok ? ' ok' : '')} href={href}><span className="wc-tick">{ok ? '✓' : ''}</span>{label}</a>
      ))}
    </section>
  );
}

// ---------- Composer ----------
export function Composer({ onStory }) {
  const s = useStore();
  const user = me(s);
  const [text, setText] = useState('');
  const [img, setImg] = useState('');
  const [vid, setVid] = useState(null);
  const [aud, setAud] = useState(mySettings(s).postAudience);
  const [busy, setBusy] = useState(false);
  const [sched, setSched] = useState(false);
  const [when, setWhen] = useState('');
  const imgRef = useRef(); const vidRef = useRef();
  const minV = () => localInput(new Date(Date.now() + 60000));
  const maxV = () => localInput(new Date(Date.now() + 365 * 86400000));
  const post = async () => {
    if (!text.trim() && !img && !vid) return;
    let publishAt = null;
    if (user.cloud && sched) {
      const t = Date.parse(when);
      if (!when || !t) return toast('Pick a date and time to schedule.');
      if (t < Date.now() + 55000) return toast('Choose a time at least 1 minute from now.');
      if (t > Date.now() + 365 * 86400000) return toast('You can schedule up to 1 year ahead.');
      publishAt = t;
    }
    setBusy(true);
    try {
      if (user.cloud) {
        const err = await addPostOnline({ text: text.trim(), imgDataUrl: img, videoFile: vid, aud, publishAt });
        if (err) { toast('Post failed: ' + err); setBusy(false); return; }
        setText(''); setImg(''); setVid(null); setSched(false); setWhen(''); toast(publishAt ? 'Post scheduled.' : 'Post published online.');
      } else {
        const videoKey = vid ? await saveVideo(vid) : '';
        addPost({ text: text.trim(), img, videoKey, aud });
        setText(''); setImg(''); setVid(null); toast('Post published.');
        if (saveError) toast(saveError);
      }
    } catch (e) { toast('Could not post. Please try again.'); }
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
      <div className="comp-quick">
        <button className="btn ghost sm" onClick={() => imgRef.current.click()}><IoImage color="#16A34A" /> Photo</button>
        <button className="btn ghost sm" onClick={() => vidRef.current.click()}><IoVideocam color="#DB2777" /> Video</button>
        <button className="btn ghost sm" onClick={onStory}><IoAlbumsOutline color="#7C3AED" /> Story</button>
        {user.cloud && <button className={'btn ghost sm' + (sched ? ' on' : '')} aria-pressed={sched} onClick={() => { setSched(!sched); if (!sched && !when) setWhen(minV()); }}><IoTimeOutline color="#EA580C" /> Schedule</button>}
        <input ref={imgRef} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files[0]; if (f) setImg(await compressImage(f)); e.target.value = ''; }} />
        <input ref={vidRef} type="file" accept="video/*" hidden onChange={(e) => { const f = e.target.files[0]; if (f) { if (f.size > (user.cloud ? 45e6 : 60e6)) toast('Video must be under ' + (user.cloud ? '45' : '60') + ' MB.'); else setVid(f); } e.target.value = ''; }} />
      </div>
      {user.cloud && sched && (
        <div className="sched-row"><label>Publish on <input type="datetime-local" className="input" value={when} min={minV()} max={maxV()} onChange={(e) => setWhen(e.target.value)} aria-label="Schedule date and time" /></label>
          <small className="muted">Time Capsule: only you can see it until then (up to 1 year ahead).</small></div>
      )}
      <div className="comp-actions">
        <select className="aud" value={aud} onChange={(e) => setAud(e.target.value)} aria-label="Audience">
          <option value="public">🌐 Public</option><option value="friends">👥 Friends</option><option value="me">🔒 Only me</option>
        </select>
        <button className="btn primary sm" disabled={busy || (!text.trim() && !img && !vid)} onClick={post}>{user.cloud && sched ? 'Schedule' : 'Post'}</button>
      </div>
    </section>
  );
}

// ---------- Comments ----------
function Comments({ post }) {
  const s = useStore();
  const [t, setT] = useState('');
  const [reply, setReply] = useState(null); // top-level comment id
  const [showAll, setShowAll] = useState(false);
  const [openReplies, setOpenReplies] = useState({});
  const send = (e) => { e.preventDefault(); if (!t.trim()) return; addComment(post.id, t.trim(), reply); if (reply) setOpenReplies((o) => ({ ...o, [reply]: true })); setT(''); setReply(null); };
  const one = (c, top, sub) => {
    const a = s.users[c.author];
    const likes = c.likes || [];
    const liked = likes.includes(s.me);
    return (
      <div key={c.id} className={'comment' + (sub ? ' sub' : '')}>
        <Avatar user={a} size={sub ? 28 : 34} />
        <div><div className="bubble"><b>{a?.name || 'Unknown'}</b><p>{c.text}</p>{likes.length > 0 && <span className="c-likes" aria-label={likes.length + ' likes'}>👍 {likes.length}</span>}</div>
          <small>{timeAgo(c.time)} · <button className={'link-btn' + (liked ? ' on' : '')} onClick={() => toggleCommentLike(post.id, c.id)}>{liked ? 'Liked' : 'Like'}</button> · <button className="link-btn" onClick={() => setReply(top.id)}>Reply</button>
            {c.author === s.me && <> · <button className="link-btn danger" onClick={() => { deleteComment(post.id, c.id); toast('Comment deleted.'); }}>Delete</button></>}</small></div>
      </div>
    );
  };
  const all = post.comments;
  const shown = showAll ? all : all.slice(-3);
  const target = reply && all.find((c) => c.id === reply);
  return (
    <div className="comments">
      {all.length > shown.length && <button className="link-btn" onClick={() => setShowAll(true)}>View {all.length - shown.length} more comments</button>}
      {shown.map((c) => {
        const open = openReplies[c.id];
        const reps = open ? c.replies : c.replies.slice(0, 1);
        return (<div key={c.id}>{one(c, c)}{reps.map((r) => one(r, c, true))}
          {c.replies.length > 1 && !open && <button className="link-btn reply-more" onClick={() => setOpenReplies((o) => ({ ...o, [c.id]: true }))}>View {c.replies.length - 1} more {c.replies.length - 1 === 1 ? 'reply' : 'replies'}</button>}</div>);
      })}
      <form className="row gap" onSubmit={send}>
        <input className="input" aria-label="Write a comment" placeholder={reply ? 'Write a reply…' : 'Write a comment…'} value={t} onChange={(e) => setT(e.target.value)} />
        <button className="icon-btn send" aria-label="Send comment"><IoSend size={20} /></button>
      </form>
      {reply && <small className="muted">Replying to {s.users[target?.author]?.name || 'comment'} · <button className="link-btn" onClick={() => setReply(null)}>Cancel</button></small>}
    </div>
  );
}

// ---------- Reactions list ----------
function ReactorsSheet({ post, onClose }) {
  const s = useStore();
  const [tab, setTab] = useState('all');
  const ids = Object.keys(post.reactions);
  useEffect(() => { ensureUsers(ids); }, []); // eslint-disable-line
  const types = Object.keys(REACTIONS).filter((k) => ids.some((u) => post.reactions[u] === k));
  const rows = ids.filter((u) => tab === 'all' || post.reactions[u] === tab);
  return (
    <Sheet title="People who reacted" onClose={onClose}>
      <div className="rx-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All {ids.length}</button>
        {types.map((k) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{REACTIONS[k]} {ids.filter((u) => post.reactions[u] === k).length}</button>)}
      </div>
      {rows.map((u) => { const x = s.users[u]; return (
        <div className="person" key={u}><Avatar user={x} size={40} /><div className="grow"><a className="name" href={'#/profile/' + u} onClick={onClose}>{x?.name || 'FYNZA user'}<Badge on={x?.verified} /></a></div><span className="rx-emoji">{REACTIONS[post.reactions[u]]}</span></div>
      ); })}
    </Sheet>
  );
}

// ---------- Post ----------
export function PostCard({ post, embedded }) {
  const s = useStore();
  const user = me(s);
  const a = s.users[post.author];
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(false);
  const [share, setShare] = useState(false);
  const [rxList, setRxList] = useState(false);
  const timer = useRef();
  const mine = post.reactions[user.id];
  const counts = Object.values(post.reactions);
  const top = Object.entries(counts.reduce((m, t) => ({ ...m, [t]: (m[t] || 0) + 1 }), {})).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([t]) => REACTIONS[t]).join('');
  const saved = (s.saved[user.id] || []).includes(post.id);
  const orig = post.shareOf && s.posts.find((p) => p.id === post.shareOf);
  const commentsN = post.comments.reduce((n, c) => n + 1 + c.replies.length, 0);
  const sharesN = Math.max(post.shares || 0, s.posts.filter((p) => p.shareOf === post.id).length);
  const [audLabel, AudIcon] = AUD[post.aud] || AUD.public;
  const press = () => { timer.current = setTimeout(() => setPicker(true), 450); };
  const release = () => clearTimeout(timer.current);
  const own = post.author === user.id;

  return (
    <article className={'card post' + (embedded ? ' embedded' : '')} id={embedded ? undefined : 'post-' + post.id}>
      <div className="post-head">
        <Avatar user={a} size={44} onClick={() => go('#/profile/' + post.author)} />
        <div className="grow"><a className="name" href={'#/profile/' + post.author}>{a?.name || 'Unknown'}<Badge on={a?.verified} /></a>
          <small className="muted">{timeAgo(post.time)}{post.pageId && s.pages.find((x) => x.id === post.pageId) ? <> · <a href={'#/page/' + post.pageId}>📄 {s.pages.find((x) => x.id === post.pageId).name}</a></> : null} · <AudIcon size={12} style={{ verticalAlign: '-1px' }} aria-label={audLabel} /></small></div>
        {!embedded && <button className="icon-btn" aria-label="More" onClick={() => setMenu(true)}><IoEllipsisHorizontal size={20} /></button>}
      </div>
      {post.sched && own && !embedded && (
        <div className="sched-label"><IoTimeOutline /> <span>Scheduled for {fullTime(post.sched)}</span>
          <button className="btn primary sm" onClick={async () => { const e = await publishNow(post.id); toast(e ? 'Could not publish: ' + e : 'Post published.'); }}>Publish now</button>
          <button className="btn ghost sm" onClick={() => { deletePost(post.id); toast('Scheduled post cancelled.'); }}>Cancel</button></div>
      )}
      {post.text && <p className="post-text">{post.text}</p>}
      {post.scene && <Scene kind={post.scene} />}
      {post.img && <img className="post-img" src={post.img} alt="" loading="lazy" />}
      {post.videoKey && <Video vkey={post.videoKey} className="post-video" />}
      {post.videoUrl && <Video url={post.videoUrl} className="post-video" />}
      {post.shareOf && (orig && canSee(s, orig) ? <PostCard post={orig} embedded /> : <div className="muted pad">This post is no longer available.</div>)}
      {!embedded && !post.sched && (
        <>
          <div className="post-stats">
            <span>{counts.length > 0 && <button className="link-btn rx-sum" aria-label="See who reacted" onClick={() => setRxList(true)}>{top} {counts.length}</button>}</span>
            <span>{commentsN > 0 && <button className="link-btn" onClick={() => setOpen(!open)}>{commentsN} {commentsN === 1 ? 'comment' : 'comments'}</button>}{sharesN > 0 && <span> · {sharesN} {sharesN === 1 ? 'share' : 'shares'}</span>}</span>
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
            <button className={saved ? 'on' : ''} onClick={() => { toggleSave(post.id); toast(saved ? 'Removed from saved.' : 'Saved.'); }}>{saved ? <IoBookmark size={20} /> : <IoBookmarkOutline size={20} />} Save</button>
          </div>
          {open && <Comments post={post} />}
        </>
      )}
      {menu && (
        <Sheet title="Post options" onClose={() => setMenu(false)}>
          <button className="menu-item" onClick={async () => { setMenu(false); toast((await copyText(postLink(post.id))) ? 'Link copied.' : postLink(post.id)); }}>Copy link</button>
          {own ? (
            <button className="menu-item danger" onClick={() => { deletePost(post.id); setMenu(false); toast('Post deleted.'); }}>Delete post</button>
          ) : (
            <>
              <button className="menu-item" onClick={() => { setMenu(false); askReport('post', post.id); }}>Report post</button>
              <button className="menu-item danger" onClick={() => { blockUser(post.author); setMenu(false); toast(a?.name + ' blocked.'); }}>Block {a?.name}</button>
            </>
          )}
        </Sheet>
      )}
      {share && <ShareSheet post={post} onClose={() => setShare(false)} />}
      {rxList && <ReactorsSheet post={post} onClose={() => setRxList(false)} />}
    </article>
  );
}

function ShareSheet({ post, onClose }) {
  const s = useStore();
  const user = me(s);
  const [t, setT] = useState('');
  const [pick, setPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const link = postLink(post.shareOf || post.id);
  const friends = s.friends.filter(([x, y]) => x === user.id || y === user.id).map(([x, y]) => s.users[x === user.id ? y : x]).filter((u) => u && sameWorld(s, u) && !isBlocked(s, user.id, u.id));
  const sendTo = async (u) => {
    setBusy(true);
    let id;
    if (user.cloud) { const r = await openChatOnline(u.id); if (r.error) { setBusy(false); return toast(r.error); } id = r.id; } else id = openChat(u.id);
    await sendMessage(id, (t.trim() ? t.trim() + ' ' : '') + link);
    setBusy(false); onClose(); toast('Sent to ' + u.name.split(' ')[0] + '.');
  };
  if (pick) return (
    <Sheet title="Send in a message" onClose={onClose}>
      {friends.length === 0 && <p className="muted">Add a friend first to send posts in messages.</p>}
      {friends.map((u) => <button key={u.id} className="menu-item person-btn" disabled={busy} onClick={() => sendTo(u)}><Avatar user={u} size={34} /> {u.name}</button>)}
      <button className="btn ghost" onClick={() => setPick(false)}>Back</button>
    </Sheet>
  );
  return (
    <Sheet title="Share post" onClose={onClose}>
      <textarea className="input" rows={2} placeholder="Say something (optional)…" value={t} onChange={(e) => setT(e.target.value)} aria-label="Share caption" />
      <button className="btn primary big" onClick={() => { sharePost(post.shareOf || post.id, t.trim()); onClose(); toast('Shared to your feed.'); }}>Share now to your feed</button>
      <button className="menu-item" onClick={() => setPick(true)}><IoPaperPlaneOutline /> Send in a message</button>
      <button className="menu-item" onClick={async () => { toast((await copyText(link)) ? 'Link copied.' : link); onClose(); }}><IoLinkOutline /> Copy link</button>
    </Sheet>
  );
}

// ---------- Single post page (#/post/<id>) ----------
export function PostPage({ id: idProp }) {
  const s = useStore();
  const hash = useHash();
  const id = idProp || decodeURIComponent((hash.match(/^#\/post\/([^/?]+)/) || [])[1] || '');
  const [tried, setTried] = useState(false);
  useEffect(() => { let on = true; setTried(false); openPostOnline(id).finally(() => on && setTried(true)); return () => { on = false; }; }, [id]);
  const p = s.posts.find((x) => x.id === id);
  return (
    <div className="stack">
      <a className="btn ghost sm" href="#/feed" style={{ alignSelf: 'flex-start' }}>← Back to feed</a>
      {p && canSee(s, p) ? <PostCard post={p} /> : tried ? <Empty title="Post not available" text="It may have been deleted, scheduled for later, or you may not have permission to see it." /> : <div className="muted pad">Loading…</div>}
    </div>
  );
}

// ---------- Feed ----------
export function Feed() {
  const s = useStore();
  const user = me(s);
  const [creating, setCreating] = useState(false);
  const [more, setMore] = useState(false);
  const posts = s.posts.filter((p) => canSee(s, p) && !p.groupId && !p.extra);
  return (
    <div className="stack">
      {user.cloud ? <div className="local-note">☁️ Online mode: posts, likes, comments, saves and stories are all stored in the database.<button className="btn ghost sm" onClick={() => refreshFeed()}>↻ Refresh</button></div> : null}
      <WelcomeCard />
      <Composer onStory={() => setCreating(true)} />
      <Stories creating={creating} setCreating={setCreating} />
      {posts.length === 0 && <Empty title="Your feed is empty" text="Write your first post above, or find friends."><a className="btn primary sm" href="#/friends">Find friends</a></Empty>}
      {user.cloud && <SponsoredSlot country={user.country} />}
      {posts.map((p) => <PostCard key={p.id} post={p} />)}
      {user.cloud && s.feedMore && <button className="btn ghost big" disabled={more} onClick={async () => { setMore(true); await loadMoreFeed(); setMore(false); }}>{more ? 'Loading…' : 'Load more'}</button>}
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
        {reqs.length === 0 && <p className="muted">No new requests.</p>}
        {reqs.map((r) => { const u = s.users[r.from]; return u && (
          <div className="person" key={r.from}><Avatar user={u} size={40} /><div className="grow"><a className="name" href={'#/profile/' + u.id}>{u.name}</a>
            <div className="row gap"><button className="btn primary sm" onClick={() => acceptRequest(u.id)}>Confirm</button><button className="btn ghost sm" onClick={() => declineRequest(u.id)}>Delete</button></div></div></div>); })}
      </section>
      <section className="card pad"><b>People you may know</b>
        {sug.length === 0 && <p className="muted">No suggestions right now.</p>}
        {sug.map((u) => (<div className="person" key={u.id}><Avatar user={u} size={40} /><div className="grow"><a className="name" href={'#/profile/' + u.id}>{u.name}</a></div>
          <button className="btn primary sm" onClick={() => { sendRequest(u.id); toast('Request sent.'); }}>Add</button></div>))}
      </section>
    </div>
  );
}
