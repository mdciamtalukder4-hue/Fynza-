import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IoAdd, IoSend, IoImage, IoArrowBack, IoCall, IoVideocam, IoMic, IoAttach, IoHappyOutline, IoClose, IoArrowUndo, IoCreate, IoTrash, IoCopy,
  IoEllipsisVertical, IoDocumentText, IoPlay, IoPause, IoMicOff, IoVideocamOff, IoNotifications, IoSearch, IoPeopleCircle, IoCheckmarkDone, IoCheckmark, IoFlag, IoBan, IoExit, IoPerson,
} from 'react-icons/io5';
import { askReport } from './monet.jsx';
import {
  useStore, me, timeAgo, fullTime, isBlocked, blockUser, unblockUser, report, compressImage, sendMessage, sendRich, createGroupChat, reactToMessage, editMessageOnline,
  deleteMessageOnline, markChatRead, leaveChatOnline, refreshChats, openChatOnline, createGroupChatOnline,
} from './store.js';
import { Avatar, Sheet, toast, go, back, Empty } from './ui.jsx';
import {
  useMx, isOnlineNow, lastSeenText, iAmTyping, typingTick, placeCall, acceptCall, declineCall, endCall, toggleMute, toggleCam, canNotify, notifyState, askNotify,
} from './msgx.js';

const REACTIONS = ['❤️', '😂', '😮', '😢', '😡', '👍'];
const EMOJI = '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😜 🤪 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤯 😳 🥵 🥶 😱 😨 😰 🤗 🤔 🤭 🤫 😶 😐 🙄 😬 😴 🤤 😷 🤒 🤕 🤢 🤮 🤧 😈 💀 👻 🤖 💩 👍 👎 👏 🙌 🙏 🤝 💪 ✌️ 🤞 👌 🤌 👋 🤙 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 💞 💯 🔥 ✨ 🎉 🎊 🎁 🎂 ☕ 🍕 🍔 🍟 🍫 ⚽ 🏏 🎮 🎧 📷 🌹 🌙 ☀️ ⭐ 🌈 ☔ 🚀'.split(' ');
const STICKERS = '🥳 😎 🤩 😭 😂 🥰 🤝 🙏 👏 🔥 💯 🎉 😴 🤔 😡 💔 🫶 🤗 😇 🤪 🥺 😱 👋 💪'.split(' ');
const MAX_FILE = 25 * 1024 * 1024;

const dayLabel = (t) => {
  const d = new Date(t); const n = new Date(); const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === n.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' });
};
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const preview = (m, mineId) => {
  if (!m) return 'Say hi 👋';
  const who = m.from === mineId ? 'You: ' : '';
  if (m.deleted) return who + 'Message removed';
  const k = m.kind || (m.img ? 'image' : 'text');
  return who + ({ image: '📷 Photo', video: '🎬 Video', voice: '🎤 Voice message', file: '📎 ' + (m.fileName || 'File'), sticker: m.text }[k] ?? m.text);
};

export const Dot = ({ on }) => <i className={'pdot' + (on ? ' on' : '')} />;

// ---------------------------------------------------------------- list
export function Messenger() {
  const s = useStore();
  const mx = useMx();
  const user = me(s);
  const [tab, setTab] = useState('chats');
  const [make, setMake] = useState(false);
  const [title, setTitle] = useState('');
  const [sel, setSel] = useState([]);
  const [q, setQ] = useState('');
  const [perm, setPerm] = useState(notifyState());
  const friends = s.friends.filter(([a, b]) => a === user.id || b === user.id).map(([a, b]) => s.users[a === user.id ? b : a]).filter(Boolean);
  useEffect(() => { if (!user.cloud) return undefined; refreshChats(); const t = setInterval(() => { if (!document.hidden) refreshChats(); }, 5000); return () => clearInterval(t); }, []); // eslint-disable-line
  const other = (c) => s.users[c.members.find((m) => m !== user.id)];
  const name = (c) => (c.group ? c.title : other(c)?.name || 'Unknown');
  const chats = s.chats.filter((c) => !!c.cloud === !!user.cloud && c.members.includes(user.id) && c.group === (tab === 'groups') && name(c).toLowerCase().includes(q.trim().toLowerCase()));
  const unread = (c) => { const r = c.reads?.[user.id]?.read || 0; return c.msgs.filter((m) => m.from !== user.id && !m.deleted && m.time > r).length; };
  const activeNow = user.cloud ? friends.filter((f) => isOnlineNow(f.id)) : [];
  const startWith = async (f) => { const r = await openChatOnline(f.id); if (r.error) toast(r.error); else go('#/chat/' + r.id); };
  return (
    <div className="mess">
      <div className="mess-head">
        <button className="icon-btn" aria-label="Back" onClick={() => back()}><IoArrowBack size={22} /></button>
        <h1>Message</h1>
        <div className="row">
          {user.cloud && canNotify() && perm === 'default' && <button className="icon-btn" aria-label="Turn on message alerts" title="Message alerts" onClick={() => askNotify().then(setPerm)}><IoNotifications size={22} /></button>}
          {tab === 'groups' && <button className="icon-btn" aria-label="New group" onClick={() => setMake(true)}><IoAdd size={26} /></button>}
        </div>
      </div>
      <div className="mess-search"><IoSearch size={18} /><input placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" /><a href="#/search" className="find-people">Find people</a></div>
      {activeNow.length > 0 && (
        <div className="active-strip" aria-label="Active now">
          {activeNow.map((f) => <button key={f.id} onClick={() => startWith(f)}><span className="av-wrap"><Avatar user={f} size={54} /><Dot on /></span><small className="clip">{f.name.split(' ')[0]}</small></button>)}
        </div>
      )}
      <div className="seg" role="tablist">{[['chats', 'Chats'], ['groups', 'Groups']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      <div className="conv-list">
        {chats.length === 0 && <p className="muted center pad">{q ? 'Nothing found।' : tab === 'chats' ? 'No chats yet. Tap Message on a profile.' : 'No group chats yet. Tap +.'}</p>}
        {chats.map((c) => {
          const last = c.msgs[c.msgs.length - 1]; const n = unread(c); const o = other(c); const typing = (mx.typing[c.id] || []).length > 0;
          return (
            <a key={c.id} className={'conv' + (n ? ' unread' : '')} href={'#/chat/' + c.id}>
              {c.group ? <span className="g-icon big"><IoPeopleCircle size={34} /></span> : <span className="av-wrap"><Avatar user={o} size={54} />{user.cloud && <Dot on={isOnlineNow(o?.id)} />}</span>}
              <div className="grow"><b className="clip">{name(c)}</b><small className={'clip ' + (typing ? 'typing-txt' : 'muted')}>{typing ? 'typing…' : preview(last, user.id)}</small></div>
              <div className="conv-meta">{last && <small className="muted">{timeAgo(last.time)}</small>}{n > 0 && <i className="badge">{n > 99 ? '99+' : n}</i>}</div>
            </a>
          );
        })}
      </div>
      {make && (
        <Sheet title="New group chat" onClose={() => setMake(false)}>
          <input className="input" placeholder="Group name" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Group name" />
          {friends.length === 0 && <p className="muted">Add friends first to start a group chat.</p>}
          {friends.map((f) => <label className="person" key={f.id}><input type="checkbox" checked={sel.includes(f.id)} onChange={(e) => setSel(e.target.checked ? [...sel, f.id] : sel.filter((x) => x !== f.id))} /><Avatar user={f} size={36} /><b>{f.name}</b></label>)}
          <button className="btn primary big" onClick={() => { if (!title.trim() || sel.length === 0) return toast('Enter a name and pick at least one friend.'); const mk = async () => { if (user.cloud) { const r = await createGroupChatOnline(title.trim(), sel); if (r.error) return toast(r.error); go('#/chat/' + r.id); } else { const id = createGroupChat(title.trim(), sel); go('#/chat/' + id); } setMake(false); setTitle(''); setSel([]); }; mk(); }}>Create group chat</button>
        </Sheet>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- voice
function VoicePlayer({ url, duration, mine }) {
  const a = useRef(); const [on, setOn] = useState(false); const [p, setP] = useState(0); const [d, setD] = useState(duration || 0);
  return (
    <div className={'voice' + (mine ? ' mine' : '')}>
      <button className="vbtn" aria-label={on ? 'Pause' : 'Play'} onClick={() => { const el = a.current; if (!el) return; if (el.paused) el.play(); else el.pause(); }}>{on ? <IoPause size={18} /> : <IoPlay size={18} />}</button>
      <div className="vbar" onClick={(e) => { const el = a.current; const r = e.currentTarget.getBoundingClientRect(); if (el && isFinite(el.duration)) el.currentTime = ((e.clientX - r.left) / r.width) * el.duration; }}><i style={{ width: (d ? Math.min(100, (p / d) * 100) : 0) + '%' }} /></div>
      <small>{mmss(on || p ? p : d)}</small>
      <audio ref={a} src={url} preload="metadata" onPlay={() => setOn(true)} onPause={() => setOn(false)} onEnded={() => { setOn(false); setP(0); }} onTimeUpdate={(e) => setP(e.target.currentTime)} onLoadedMetadata={(e) => { if (isFinite(e.target.duration) && e.target.duration > 0) setD(e.target.duration); }} />
    </div>
  );
}

function useRecorder(onDone) {
  const [rec, setRec] = useState(null); // { secs }
  const r = useRef({});
  const stopAll = () => { clearInterval(r.current.t); r.current.stream?.getTracks().forEach((t) => t.stop()); };
  useEffect(() => () => { r.current.cancel = true; try { r.current.mr?.stop(); } catch (e) { /* ignore */ } stopAll(); }, []);
  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return toast('Voice recording is not supported on this device.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported?.(m));
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = []; const t0 = Date.now();
      r.current = { mr, stream, chunks, cancel: false, t0 };
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = () => {
        stopAll(); setRec(null);
        if (r.current.cancel) return;
        const secs = (Date.now() - t0) / 1000;
        if (secs < 0.8) return toast('Voice message is too short.');
        onDone(new Blob(chunks, { type: (mr.mimeType || 'audio/webm').split(';')[0] }), secs);
      };
      mr.start(250);
      setRec({ secs: 0 });
      r.current.t = setInterval(() => { const s = (Date.now() - t0) / 1000; setRec({ secs: s }); if (s >= 300) mr.stop(); }, 250);
    } catch (e) { toast('Allow microphone access.'); }
  };
  const stop = (cancel) => { r.current.cancel = !!cancel; try { r.current.mr?.stop(); } catch (e) { stopAll(); setRec(null); } };
  return { rec, start, stop };
}

// ---------------------------------------------------------------- chat
export function Chat({ id }) {
  const s = useStore();
  const mx = useMx();
  const user = me(s);
  const c = s.chats.find((x) => x.id === id && x.members.includes(user.id));
  const cloud = !!c?.cloud;
  const [t, setT] = useState('');
  const [panel, setPanel] = useState(''); // '', 'emoji', 'sticker', 'attach'
  const [reply, setReply] = useState(null);
  const [edit, setEdit] = useState(null);
  const [act, setAct] = useState(null); // message in action sheet
  const [menu, setMenu] = useState(false);
  const [zoom, setZoom] = useState('');
  const box = useRef(); const end = useRef(); const photo = useRef(); const file = useRef(); const input = useRef();
  const stick = useRef(true);

  useEffect(() => {
    if (!cloud) return undefined;
    refreshChats(); typingTick();
    const a = setInterval(() => { if (!document.hidden) refreshChats(); }, 3000);
    const b = setInterval(typingTick, 2000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [id, cloud]);

  const lastOther = c?.msgs.filter((m) => m.from !== user.id && !m.deleted).at(-1)?.time || 0;
  useEffect(() => { if (cloud && lastOther) markChatRead(id).then(() => refreshChats()); }, [id, cloud, lastOther]); // eslint-disable-line
  useEffect(() => { if (cloud && !document.hidden) markChatRead(id); }, [id, cloud]);

  const n = c?.msgs.length || 0;
  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [n, (mx.typing[id] || []).length, panel, reply]);
  const onScroll = () => { const el = box.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140; };

  const rec = useRecorder((blob, secs) => { stick.current = true; sendRich(id, { kind: 'voice', blob, duration: secs, replyTo: reply?.id }); setReply(null); });

  if (!c) return <Empty title="Chat not found"><a className="btn primary sm" href="#/messenger">Message</a></Empty>;
  const o = s.users[c.members.find((m) => m !== user.id)];
  if (!c.group && o && isBlocked(s, user.id, o.id)) return <Empty title="This chat is closed" text="You cannot message a blocked user.">{o && <button className="btn primary sm" onClick={() => { unblockUser(o.id); toast('Unblocked.'); }}>Unblock</button>}</Empty>;

  const typers = (mx.typing[id] || []).filter((x) => x !== user.id);
  const byId = Object.fromEntries(c.msgs.map((m) => [m.id, m]));
  const nameOf = (uid) => (uid === user.id ? 'You' : s.users[uid]?.name || 'User');
  const others = c.members.filter((m) => m !== user.id);
  const send = (e) => {
    e?.preventDefault();
    const text = t.trim(); if (!text) return;
    stick.current = true;
    if (edit) { editMessageOnline(id, edit.id, text); setEdit(null); setT(''); return; }
    if (cloud) sendRich(id, { text, kind: 'text', replyTo: reply?.id }); else sendMessage(id, text);
    setT(''); setReply(null); setPanel('');
  };
  const sendSticker = (em) => { stick.current = true; sendRich(id, { text: em, kind: 'sticker', replyTo: reply?.id }); setReply(null); setPanel(''); };
  const pickFile = (e, kind) => {
    const f = e.target.files[0]; e.target.value = ''; setPanel('');
    if (!f) return;
    if (kind === 'photo') {
      stick.current = true;
      if (f.type.startsWith('image/')) compressImage(f, 1280).then((d) => (cloud ? sendRich(id, { kind: 'image', dataUrl: d, replyTo: reply?.id }) : sendMessage(id, '', d)));
      else if (f.type.startsWith('video/')) { if (f.size > MAX_FILE) return toast('Video is larger than 25 MB.'); sendRich(id, { kind: 'video', blob: f, replyTo: reply?.id }); }
      else toast('Choose a photo or video.');
    } else { if (f.size > MAX_FILE) return toast('File is larger than 25 MB.'); stick.current = true; sendRich(id, { kind: 'file', blob: f, fileName: f.name.slice(0, 120), replyTo: reply?.id }); }
    setReply(null);
  };
  const statusOf = (m) => {
    if (m.sending) return 'Sending…';
    const rs = others.map((x) => c.reads?.[x]); if (!rs.length || rs.some((r) => !r)) return 'Sent';
    if (rs.every((r) => r.read >= m.time)) return c.group ? 'Seen by all' : 'Seen';
    if (rs.every((r) => r.deliv >= m.time)) return 'Delivered';
    return 'Sent';
  };
  const lastMine = [...c.msgs].reverse().find((m) => m.from === user.id && !m.deleted);
  const subtitle = c.group ? `${c.members.length} members` : typers.length ? 'typing…' : isOnlineNow(o?.id) ? 'Active now' : lastSeenText(o?.id);
  const canCall = cloud && !c.group && o;

  const copy = (m) => { try { navigator.clipboard.writeText(m.text); toast('Copied.'); } catch (e) { toast('Could not copy.'); } setAct(null); };

  let lastDay = '';
  return (
    <div className="chat v2">
      <div className="chat-top">
        <button className="icon-btn" aria-label="Back" onClick={() => back('#/messenger')}><IoArrowBack size={22} /></button>
        {c.group ? <span className="g-icon"><IoPeopleCircle size={30} /></span> : <a className="av-wrap" href={'#/profile/' + o?.id}><Avatar user={o} size={40} />{cloud && <Dot on={isOnlineNow(o?.id)} />}</a>}
        <div className="grow"><b className="clip">{c.group ? c.title : o?.name}</b><small className={'clip ' + (typers.length ? 'typing-txt' : 'sub')}>{subtitle}</small></div>
        {canCall && <button className="icon-btn" aria-label="Voice call" onClick={() => placeCall(id, o.id, 'audio')}><IoCall size={22} /></button>}
        {canCall && <button className="icon-btn" aria-label="Video call" onClick={() => placeCall(id, o.id, 'video')}><IoVideocam size={24} /></button>}
        <button className="icon-btn" aria-label="More" onClick={() => setMenu(true)}><IoEllipsisVertical size={20} /></button>
      </div>

      <div className="msgs v2" ref={box} onScroll={onScroll} onClick={() => panel && setPanel('')}>
        {c.msgs.length === 0 && <p className="muted center">Send the first message. 👋</p>}
        {c.msgs.map((m, i) => {
          const mine = m.from === user.id; const d = dayLabel(m.time); const sep = d !== lastDay; lastDay = d;
          const prev = c.msgs[i - 1]; const next = c.msgs[i + 1];
          const first = !prev || prev.from !== m.from || sep; const lastInGroup = !next || next.from !== m.from || dayLabel(next.time) !== d;
          const rq = m.reply ? byId[m.reply] : null;
          const rx = Object.entries(m.rx || {}); const counts = {}; rx.forEach(([, e]) => { counts[e] = (counts[e] || 0) + 1; });
          const kind = m.kind || (m.img ? 'image' : 'text');
          return (
            <div key={m.id} className="mrow-wrap">
              {sep && <div className="daysep"><span>{d}</span></div>}
              <div className={'mrow' + (mine ? ' mine' : '')}>
                {!mine && (lastInGroup ? <Avatar user={s.users[m.from]} size={28} /> : <span className="av-gap" />)}
                <div className="mcol">
                  {c.group && !mine && first && <small className="sender">{nameOf(m.from)}</small>}
                  {m.deleted ? (
                    <div className="bubble gone">🚫 {mine ? 'You removed this message' : 'This message was removed'}</div>
                  ) : kind === 'sticker' ? (
                    <div className="sticker-msg" onClick={(e) => { e.stopPropagation(); cloud && setAct(m); }}>{m.text}</div>
                  ) : (
                    <div className={'bubble' + (mine ? ' mine' : '') + (m.sending ? ' sending' : '') + (kind === 'image' || kind === 'video' ? ' media' : '')} onClick={(e) => { e.stopPropagation(); (cloud || mine) && setAct(m); }}>
                      {rq && <div className="quote"><b>{nameOf(rq.from)}</b><span>{rq.deleted ? 'Message removed' : preview(rq, '').replace(/^You: /, '')}</span></div>}
                      {kind === 'image' && m.url && <img src={m.url} alt="" onClick={(e) => { e.stopPropagation(); setZoom(m.url); }} />}
                      {kind === 'video' && m.url && <video src={m.url} controls playsInline preload="metadata" onClick={(e) => e.stopPropagation()} />}
                      {kind === 'voice' && <VoicePlayer url={m.url} duration={m.duration} mine={mine} />}
                      {kind === 'file' && <a className="filecard" href={m.url} target="_blank" rel="noreferrer" download={m.fileName} onClick={(e) => e.stopPropagation()}><IoDocumentText size={26} /><span className="clip">{m.fileName || 'File'}</span></a>}
                      {(kind === 'text' || ((kind === 'image' || kind === 'video') && m.text)) && m.text && <p>{m.text}</p>}
                    </div>
                  )}
                  {Object.keys(counts).length > 0 && !m.deleted && <div className={'rx-row' + (mine ? ' mine' : '')}>{Object.entries(counts).map(([e, k]) => <button key={e} className={m.rx[user.id] === e ? 'me' : ''} onClick={() => reactToMessage(id, m.id, e)}>{e}{k > 1 && <b>{k}</b>}</button>)}</div>}
                  {(lastInGroup) && <small className="mtime" title={fullTime(m.time)}>{clock(m.time)}{m.edited && !m.deleted ? ' · edited' : ''}</small>}
                  {cloud && mine && lastMine?.id === m.id && <small className={'mstatus' + (statusOf(m).startsWith('Seen') ? ' seen' : '')}>{statusOf(m).startsWith('Seen') ? <IoCheckmarkDone size={14} /> : <IoCheckmark size={14} />} {statusOf(m)}</small>}
                </div>
              </div>
            </div>
          );
        })}
        {typers.length > 0 && <div className="mrow"><Avatar user={s.users[typers[0]]} size={28} /><div className="bubble typing"><i /><i /><i /></div></div>}
        <div ref={end} />
      </div>

      {(reply || edit) && (
        <div className="replybar">
          {edit ? <IoCreate size={18} /> : <IoArrowUndo size={18} />}
          <div className="grow"><b>{edit ? 'Edit message' : 'Replying to ' + nameOf(reply.from)}</b><span className="clip">{edit ? edit.text : preview(reply, '').replace(/^You: /, '')}</span></div>
          <button className="icon-btn" aria-label="Cancel" onClick={() => { setReply(null); if (edit) { setEdit(null); setT(''); } }}><IoClose size={20} /></button>
        </div>
      )}

      {panel === 'emoji' && <div className="panel emoji-grid">{EMOJI.map((e) => <button key={e} onClick={() => { setT((v) => v + e); input.current?.focus(); }}>{e}</button>)}</div>}
      {panel === 'sticker' && <div className="panel sticker-grid">{STICKERS.map((e) => <button key={e} onClick={() => (cloud ? sendSticker(e) : (sendMessage(id, e), setPanel('')))}>{e}</button>)}</div>}
      {panel === 'attach' && cloud && (
        <div className="panel attach">
          <button onClick={() => photo.current.click()}><span style={{ background: '#16A34A' }}><IoImage size={24} /></span>Photo / Video</button>
          <button onClick={() => file.current.click()}><span style={{ background: '#7C3AED' }}><IoDocumentText size={24} /></span>File</button>
        </div>
      )}
      <input ref={photo} hidden type="file" accept="image/*,video/*" onChange={(e) => pickFile(e, 'photo')} />
      <input ref={file} hidden type="file" onChange={(e) => pickFile(e, 'file')} />

      {rec.rec ? (
        <div className="msg-composer rec"><button className="icon-btn" aria-label="Cancel recording" onClick={() => rec.stop(true)}><IoTrash size={22} /></button>
          <span className="rec-dot" /><b className="grow">{mmss(rec.rec.secs)} <small className="muted">Recording…</small></b>
          <button className="send-btn" aria-label="Send voice message" onClick={() => rec.stop(false)}><IoSend size={20} /></button></div>
      ) : (
        <form className="msg-composer" onSubmit={send}>
          {cloud && <button type="button" className={'icon-btn' + (panel === 'attach' ? ' act' : '')} aria-label="Attach" onClick={() => setPanel(panel === 'attach' ? '' : 'attach')}><IoAttach size={24} /></button>}
          {!cloud && <><button type="button" className="icon-btn" aria-label="Send photo" onClick={() => photo.current.click()}><IoImage size={22} /></button></>}
          <div className="cinput">
            <input ref={input} placeholder="Message…" value={t} onFocus={() => setPanel('')} onChange={(e) => { setT(e.target.value); if (cloud && e.target.value) iAmTyping(id); }} aria-label="Message" maxLength={4000} />
            <button type="button" className={'icon-btn sm' + (panel === 'emoji' ? ' act' : '')} aria-label="Emoji" onClick={() => setPanel(panel === 'emoji' ? '' : 'emoji')}><IoHappyOutline size={22} /></button>
            <button type="button" className={'stk' + (panel === 'sticker' ? ' act' : '')} aria-label="Stickers" onClick={() => setPanel(panel === 'sticker' ? '' : 'sticker')}>🙂✨</button>
          </div>
          {t.trim() ? <button className="send-btn" aria-label="Send"><IoSend size={20} /></button>
            : cloud ? <button type="button" className="send-btn mic" aria-label="Record voice message" onClick={rec.start}><IoMic size={22} /></button>
              : <button className="send-btn" aria-label="Send" disabled><IoSend size={20} /></button>}
        </form>
      )}

      {act && (
        <Sheet title="Message" onClose={() => setAct(null)}>
          {cloud && !act.deleted && <div className="react-pick">{REACTIONS.map((e) => <button key={e} className={act.rx?.[user.id] === e ? 'me' : ''} onClick={() => { reactToMessage(id, act.id, e); setAct(null); }}>{e}</button>)}</div>}
          {cloud && !act.deleted && <button className="menu-item" onClick={() => { setReply(act); setAct(null); input.current?.focus(); }}><IoArrowUndo /> Reply</button>}
          {act.text && !act.deleted && <button className="menu-item" onClick={() => copy(act)}><IoCopy /> Copy</button>}
          {cloud && act.from === user.id && !act.deleted && (act.kind || 'text') === 'text' && <button className="menu-item" onClick={() => { setEdit(act); setT(act.text); setReply(null); setAct(null); input.current?.focus(); }}><IoCreate /> Edit</button>}
          {cloud && act.from === user.id && !act.deleted && <button className="menu-item danger" onClick={() => { if (confirm('Delete this message for everyone?')) deleteMessageOnline(id, act.id); setAct(null); }}><IoTrash /> Delete for everyone</button>}
          {cloud && act.from !== user.id && !act.deleted && <button className="menu-item" onClick={() => { askReport('message', act.id); setAct(null); }}><IoFlag /> Report message</button>}
          <small className="muted">{fullTime(act.time)}</small>
        </Sheet>
      )}
      {menu && (
        <Sheet title={c.group ? c.title : o?.name} onClose={() => setMenu(false)}>
          {!c.group && o && <a className="menu-item" href={'#/profile/' + o.id} onClick={() => setMenu(false)}><IoPerson /> View profile</a>}
          {!c.group && o && <button className="menu-item danger" onClick={() => { if (confirm(o.name + ' will be blocked. They will not be able to message or call you.')) { blockUser(o.id); setMenu(false); go('#/messenger'); } }}><IoBan /> Block {o.name.split(' ')[0]}</button>}
          {!c.group && o && <button className="menu-item" onClick={() => { askReport('user', o.id); setMenu(false); }}><IoFlag /> Report user</button>}
          {c.group && cloud && <button className="menu-item danger" onClick={async () => { if (!confirm('Leave this group?')) return; const e = await leaveChatOnline(id); if (e) toast(e); else go('#/messenger'); }}><IoExit /> Leave group</button>}
          {c.group && <div className="muted pad">{c.members.map((m) => nameOf(m)).join(', ')}</div>}
          {cloud && <p className="muted"><small>🔒 Chat photos/videos/files are kept in private storage; only members of this chat can see them.</small></p>}
        </Sheet>
      )}
      {zoom && <div className="lightbox" onClick={() => setZoom('')}><img src={zoom} alt="" /><button className="icon-btn" aria-label="Close"><IoClose size={28} /></button></div>}
    </div>
  );
}

// ---------------------------------------------------------------- calls (overlay, mounted once in App)
function Stream({ stream, muted, className }) {
  const r = useRef();
  useEffect(() => { if (r.current && r.current.srcObject !== stream) r.current.srcObject = stream || null; }, [stream]);
  return <video ref={r} className={className} autoPlay playsInline muted={muted} />;
}
export function CallLayer() {
  const s = useStore();
  const { call, incoming } = useMx();
  const [, tick] = useState(0);
  useEffect(() => { if (!call) return undefined; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [call?.id]); // eslint-disable-line
  if (incoming && !call) {
    const u = s.users[incoming.caller_id];
    return (
      <div className="call-ring" role="alertdialog" aria-label="Incoming call">
        <div className="ring-card">
          <Avatar user={u} size={96} />
          <b>{u?.name || 'Someone'}</b>
          <span className="muted">Incoming {incoming.kind} call…</span>
          <div className="ring-actions">
            <button className="round red" aria-label="Decline" onClick={declineCall}><IoCall size={28} style={{ transform: 'rotate(135deg)' }} /></button>
            <button className="round green" aria-label="Accept" onClick={acceptCall}>{incoming.kind === 'video' ? <IoVideocam size={28} /> : <IoCall size={28} />}</button>
          </div>
        </div>
      </div>
    );
  }
  if (!call) return null;
  const u = s.users[call.peer];
  const video = call.kind === 'video';
  const label = call.status === 'connected' ? mmss((Date.now() - call.started) / 1000) : call.status === 'calling' ? 'Calling…' : 'Connecting…';
  return (
    <div className={'call-screen' + (video ? ' video' : '')} role="dialog" aria-label="Call">
      {video && <Stream stream={call.remote} className="remote" />}
      {!video && <Stream stream={call.remote} className="audio-only" />}
      {(!video || !call.remote) && <div className="call-who"><Avatar user={u} size={110} /><h2>{u?.name}</h2><span>{label}</span></div>}
      {video && call.remote && <div className="call-top"><b>{u?.name}</b><span>{label}</span></div>}
      {video && <Stream stream={call.local} muted className={'self' + (call.camOff ? ' off' : '')} />}
      <div className="call-bar">
        <button className={'round' + (call.muted ? ' on' : '')} aria-label={call.muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>{call.muted ? <IoMicOff size={24} /> : <IoMic size={24} />}</button>
        {video && <button className={'round' + (call.camOff ? ' on' : '')} aria-label="Camera" onClick={toggleCam}>{call.camOff ? <IoVideocamOff size={24} /> : <IoVideocam size={24} />}</button>}
        <button className="round red" aria-label="End call" onClick={() => endCall()}><IoCall size={26} style={{ transform: 'rotate(135deg)' }} /></button>
      </div>
    </div>
  );
}
