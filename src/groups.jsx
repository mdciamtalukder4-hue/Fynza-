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

const useCloudSync = (user) => useEffect(() => { if (user.cloud) { refreshGroups(); refreshFeed(); } }, []); // eslint-disable-line

// ---------- Groups list ----------
export function Groups() {
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
export function GroupPage({ id }) {
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
