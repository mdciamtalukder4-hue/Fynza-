import { useEffect, useRef, useState } from 'react';
import { IoArrowBack, IoEllipsisHorizontal, IoPersonAdd, IoChatbubbleEllipses, IoCamera, IoEye, IoCheckmark } from 'react-icons/io5';
import {
  useStore, me, updateProfile, recordVisit, areFriends, requestBetween, sendRequest, acceptRequest, declineRequest, unfriend, toggleFollow,
  isBlocked, blockUser, unblockUser, report, openChat, compressImage, mySettings, visitsOfMe, fullTime, fetchUserOnline, loadProfileExtras, openChatOnline,
} from './store.js';
import { askReport } from './monet.jsx';
import { Avatar, Sheet, toast, go, back, Empty, LocalNote, Badge } from './ui.jsx';
import { PostCard, canSee } from './feed.jsx';

function EditProfile({ user, onClose }) {
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio || '');
  const [avatar, setAvatar] = useState(user.avatar || '');
  const [cover, setCover] = useState(user.cover || '');
  const a = useRef(); const c = useRef();
  const save = async () => {
    if (name.trim().length < 2) return toast('নাম কমপক্ষে ২ অক্ষর হতে হবে।');
    const err = await updateProfile({ name: name.trim(), bio: bio.trim(), avatar, cover });
    if (err) toast('অনলাইনে সেভ হয়নি: ' + err);
    else toast(user.cloud ? 'প্রোফাইল অনলাইনে সেভ হয়েছে।' : 'প্রোফাইল সেভ হয়েছে।');
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

export function Profile({ id }) {
  const s = useStore();
  const user = me(s);
  const u = s.users[id];
  const own = id === user.id;
  const [tab, setTab] = useState('posts');
  const [edit, setEdit] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => { if (!u) fetchUserOnline(id); else if (u.cloud) loadProfileExtras(id); }, [id, !!u]); // eslint-disable-line
  useEffect(() => { if (u && !own) recordVisit(id); }, [id, !!u]); // eslint-disable-line

  if (!u) return <Empty title="প্রোফাইল পাওয়া যায়নি" text="এই ব্যবহারকারী নেই।"><a className="btn primary sm" href="#/feed">Home</a></Empty>;
  if (!own && isBlocked(s, user.id, id)) {
    const iBlocked = s.blocks.some(([a, b]) => a === user.id && b === id);
    return <Empty title="এই প্রোফাইল দেখা যাচ্ছে না">{iBlocked && <button className="btn primary sm" onClick={() => { unblockUser(id); toast('আনব্লক করা হয়েছে।'); }}>Unblock {u.name}</button>}</Empty>;
  }

  const friend = areFriends(s, user.id, id);
  const req = requestBetween(s, user.id, id);
  const following = s.follows.some(([a, b]) => a === user.id && b === id);
  const hidden = !own && mySettings(s, id).profilePublic === false && !friend;
  const posts = s.posts.filter((p) => p.author === id && canSee(s, p) && !p.groupId);
  const friends = s.friends.filter(([a, b]) => a === id || b === id).map(([a, b]) => s.users[a === id ? b : a]).filter(Boolean);
  const followers = s.follows.filter(([, b]) => b === id).length;
  const photos = posts.filter((p) => p.img);
  const visits = own ? visitsOfMe(s).length : 0;

  return (
    <div className="stack">
      <div className="profile-head card">
        <div className="cover" style={u.cover ? { background: `center/cover url(${u.cover})` } : undefined}>
          <button className="icon-btn dark" aria-label="Back" onClick={() => back()}><IoArrowBack size={22} /></button>
          {!own && <button className="icon-btn dark right" aria-label="More" onClick={() => setMenu(true)}><IoEllipsisHorizontal size={22} /></button>}
        </div>
        <div className="p-info">
          <div className="p-avatar"><Avatar user={u} size={112} /></div>
          <h1>{u.name}<Badge on={u.verified} size={22} /></h1>
          <p className="muted">@{u.username}</p>
          {u.bio && <p className="bio">{u.bio}</p>}
          <div className="p-actions">
            {own ? (
              <>
                <button className="btn primary" onClick={() => setEdit(true)}>Edit profile</button>
                <a className="btn ghost" href="#/visitors"><IoEye /> Who viewed my profile{visits > 0 && <i className="count">{visits}</i>}</a>
              </>
            ) : (
              <>
                {friend ? <button className="btn ghost" onClick={() => { unfriend(id); toast('বন্ধু তালিকা থেকে সরানো হয়েছে।'); }}><IoCheckmark /> Friends</button>
                  : req && req.to === user.id ? <><button className="btn primary" onClick={() => acceptRequest(id)}>Confirm</button><button className="btn ghost" onClick={() => declineRequest(id)}>Delete</button></>
                  : req ? <button className="btn ghost" onClick={() => { declineRequest(id); toast('অনুরোধ বাতিল।'); }}>Requested · Cancel</button>
                  : <button className="btn primary" onClick={() => { sendRequest(id); toast('বন্ধুত্বের অনুরোধ পাঠানো হয়েছে।'); }}><IoPersonAdd /> Add Friend</button>}
                {u.cloud ? <button className="btn ghost" onClick={async () => { const r = await openChatOnline(id); if (r.error) toast(r.error); else go('#/chat/' + r.id); }}><IoChatbubbleEllipses /> Message</button> : <button className="btn ghost" onClick={() => { if (mySettings(s, id).whoCanMessage === 'friends' && !friend) return toast('এই ব্যবহারকারী শুধু বন্ধুদের মেসেজ নেন।'); go('#/chat/' + openChat(id)); }}><IoChatbubbleEllipses /> Message</button>}
                <button className="btn ghost" onClick={() => toggleFollow(id)}>{following ? 'Following' : 'Follow'}</button>
              </>
            )}
          </div>
          <div className="p-stats"><span><b>{posts.length}</b> Posts</span>{(own || !u.cloud) && <span><b>{friends.length}</b> Friends</span>}<span><b>{followers}</b> Followers</span></div>
        </div>
        <div className="tabs" role="tablist">
          {['posts', 'about', 'friends', 'photos'].map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
        </div>
      </div>

      {hidden ? <Empty title="এই প্রোফাইল প্রাইভেট" text="শুধু বন্ধুরা এটি দেখতে পারেন।" /> : (
        <>
          {tab === 'posts' && (posts.length ? posts.map((p) => <PostCard key={p.id} post={p} />) : <Empty title="কোনো পোস্ট নেই" />)}
          {tab === 'about' && <div className="card pad"><p><b>Name:</b> {u.name}</p><p><b>Username:</b> @{u.username}</p><p><b>Bio:</b> {u.bio || '—'}</p><p><b>Joined:</b> {fullTime(u.created)}</p></div>}
          {tab === 'friends' && (u.cloud && !own ? <Empty title="বন্ধু তালিকা প্রাইভেট" text="অনলাইনে অন্যের বন্ধু তালিকা দেখা যায় না।" /> : friends.length ? <div className="card pad">{friends.map((f) => <a key={f.id} className="person" href={'#/profile/' + f.id}><Avatar user={f} size={44} /><b>{f.name}</b></a>)}</div> : <Empty title="এখনও কোনো বন্ধু নেই" />)}
          {tab === 'photos' && (photos.length ? <div className="photo-grid">{photos.map((p) => <img key={p.id} src={p.img} alt="" />)}</div> : <Empty title="কোনো ছবি নেই" />)}
        </>
      )}

      {edit && <EditProfile user={u} onClose={() => setEdit(false)} />}
      {menu && (
        <Sheet title={u.name} onClose={() => setMenu(false)}>
          <button className="menu-item" onClick={() => { setMenu(false); askReport('user', id); }}>Report profile</button>
          <button className="menu-item danger" onClick={() => { blockUser(id); setMenu(false); toast('ব্লক করা হয়েছে।'); }}>Block {u.name}</button>
        </Sheet>
      )}
    </div>
  );
}
