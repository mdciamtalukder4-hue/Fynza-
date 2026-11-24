// Messenger extras (Phase 10): presence, typing, new-message alerts and 1:1 voice/video calls (WebRTC).
// Everything here is TRANSIENT (not saved in the browser). Signalling goes through the Supabase tables
// calls / call_signals and is polled about once per second while a call is active.
import { useSyncExternalStore } from 'react';
import * as cloud from './cloud.js';
import { getState, me, refreshChats } from './store.js';
import { toast } from './ui.jsx';

let st = { typing: {}, presence: {}, call: null, incoming: null };
const ls = new Set();
const upd = (p) => { st = { ...st, ...p }; ls.forEach((l) => l()); };
export const useMx = () => useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l); }, () => st);
export const getMx = () => st;

const meId = () => getState().me;
const cloudMe = () => !!me(getState())?.cloud;

// ---------- presence ----------
export const ONLINE_MS = 70000;
export const isOnlineNow = (id) => { const t = st.presence[id]; return !!t && Date.now() - t < ONLINE_MS; };
export function lastSeenText(id) {
  const t = st.presence[id]; if (!t) return '';
  const d = Date.now() - t;
  if (d < ONLINE_MS) return 'Active now';
  const m = Math.round(d / 60000);
  if (m < 60) return `Active ${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `Active ${h} h ago`;
  return 'Active ' + new Date(t).toLocaleDateString();
}
async function presenceTick() {
  if (!cloudMe() || document.hidden) return;
  try {
    await cloud.touchPresence();
    const s = getState(); const ids = new Set();
    s.chats.filter((c) => c.cloud && !c.group).forEach((c) => c.members.forEach((m) => m !== s.me && ids.add(m)));
    s.friends.forEach(([a, b]) => ids.add(a === s.me ? b : a));
    const rows = await cloud.loadPresence([...ids].filter((x) => s.users[x]?.cloud));
    const p = {}; rows.forEach((r) => { p[r.user_id] = Date.parse(r.last_seen_at) || 0; });
    upd({ presence: p });
  } catch (e) { /* offline: ignore */ }
}

// ---------- typing ----------
let lastTypingSent = 0;
export function iAmTyping(convId) {
  if (Date.now() - lastTypingSent < 2500) return;
  lastTypingSent = Date.now();
  cloud.sendTyping(convId).catch(() => {});
}
export async function typingTick() {
  if (!cloudMe() || document.hidden) return;
  try {
    const rows = await cloud.loadTyping(); const t = {};
    rows.forEach((r) => { (t[r.conversation_id] ||= []).push(r.user_id); });
    upd({ typing: t });
  } catch (e) { /* ignore */ }
}

// ---------- alerts for new messages ----------
let lastAlert = Date.now();
export const canNotify = () => typeof Notification !== 'undefined';
export const notifyState = () => (canNotify() ? Notification.permission : 'unsupported');
export const askNotify = () => (canNotify() ? Notification.requestPermission() : Promise.resolve('unsupported'));
function newMessageCheck() {
  const s = getState(); const u = me(s); if (!u?.cloud) return;
  let newest = lastAlert;
  s.chats.filter((c) => c.cloud).forEach((c) => {
    c.msgs.filter((m) => m.from !== s.me && !m.deleted && m.time > lastAlert && !String(m.id).startsWith('tmp')).forEach((m) => {
      newest = Math.max(newest, m.time);
      const open = location.hash === '#/chat/' + c.id && !document.hidden;
      if (open) return;
      const who = s.users[m.from]?.name || 'New message';
      const body = m.text || ({ image: '📷 Photo', video: '🎬 Video', voice: '🎤 Voice message', file: '📎 ' + (m.fileName || 'File'), sticker: m.text }[m.kind] || '');
      if (document.hidden && notifyState() === 'granted') { try { const n = new Notification(who, { body, tag: c.id, icon: './icon-192.png' }); n.onclick = () => { window.focus(); location.hash = '#/chat/' + c.id; }; } catch (e) { /* ignore */ } }
      else toast(`💬 ${who}: ${body}`);
    });
  });
  lastAlert = newest;
}

// ---------- background loop ----------
let timers = [];
export function startMessengerSync() {
  stopMessengerSync();
  lastAlert = Date.now();
  presenceTick();
  timers = [
    setInterval(presenceTick, 25000),
    setInterval(() => { if (cloudMe()) { cloud.markDelivered().catch(() => {}); } }, 30000),
    setInterval(() => { if (cloudMe() && !location.hash.startsWith('#/chat/') && !location.hash.startsWith('#/messenger')) refreshChats().then(newMessageCheck); }, document.hidden ? 60000 : 12000),
    setInterval(incomingTick, 3000),
    setInterval(newMessageCheck, 2500),
  ];
}
export function stopMessengerSync() { timers.forEach(clearInterval); timers = []; }

// ---------- calls ----------
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
let pc = null; let local = null; let sigTimer = null; let ringTimer = null; let lastSig = 0; let pendingIce = []; let remoteSet = false; let busy = false;
const setCall = (p) => upd({ call: st.call ? { ...st.call, ...p } : null });

async function incomingTick() {
  if (!cloudMe() || st.call || busy) return;
  try {
    const r = await cloud.incomingCalls(meId());
    const c = r[0] || null;
    if (c && st.incoming?.id !== c.id) { upd({ incoming: c }); startRingWatch(c.id); }
    else if (!c && st.incoming) upd({ incoming: null });
  } catch (e) { /* ignore */ }
}
let ringWatch = null;
function startRingWatch(id) {
  clearInterval(ringWatch);
  ringWatch = setInterval(async () => {
    if (!st.incoming || st.incoming.id !== id) { clearInterval(ringWatch); return; }
    try { const c = await cloud.getCall(id); if (!c || c.status !== 'ringing') { upd({ incoming: null }); clearInterval(ringWatch); } } catch (e) { /* ignore */ }
  }, 2000);
}

async function getMedia(kind) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Calls are not supported on this device (no mic/camera support).');
  try { return await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' ? { facingMode: 'user' } : false }); }
  catch (e) { throw new Error(kind === 'video' ? 'Allow camera/microphone access.' : 'Allow microphone access.'); }
}

function makePc(callId, peerId) {
  pc = new RTCPeerConnection(ICE);
  remoteSet = false; pendingIce = []; lastSig = 0;
  local.getTracks().forEach((t) => pc.addTrack(t, local));
  const remote = new MediaStream();
  pc.ontrack = (e) => { e.streams[0]?.getTracks().forEach((t) => remote.addTrack(t)); if (!e.streams[0]) remote.addTrack(e.track); setCall({ remote }); };
  pc.onicecandidate = (e) => { if (e.candidate) cloud.sendSignal(meId(), callId, peerId, 'ice', e.candidate.toJSON()).catch(() => {}); };
  pc.onconnectionstatechange = () => {
    if (pc?.connectionState === 'connected') { clearTimeout(ringTimer); setCall({ status: 'connected', started: st.call?.started || Date.now() }); }
    if (pc?.connectionState === 'failed') endCall('Could not connect. Check both internet connections.');
  };
  local && setCall({ local });
}

async function applyIce() {
  while (pendingIce.length) { const c = pendingIce.shift(); try { await pc.addIceCandidate(c); } catch (e) { /* ignore */ } }
}
async function pollSignals(callId, role) {
  if (!pc || !st.call || st.call.id !== callId) return;
  try {
    const rows = await cloud.loadSignals(callId, lastSig);
    for (const r of rows) {
      lastSig = Math.max(lastSig, r.id);
      if (r.type === 'offer' && role === 'callee' && !remoteSet) {
        await pc.setRemoteDescription(r.payload); remoteSet = true; await applyIce();
        const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
        await cloud.sendSignal(meId(), callId, st.call.peer, 'answer', { type: ans.type, sdp: ans.sdp });
      } else if (r.type === 'answer' && role === 'caller' && !remoteSet) {
        await pc.setRemoteDescription(r.payload); remoteSet = true; await applyIce();
      } else if (r.type === 'ice') {
        if (remoteSet) { try { await pc.addIceCandidate(r.payload); } catch (e) { /* ignore */ } } else pendingIce.push(r.payload);
      }
    }
    const c = await cloud.getCall(callId);
    if (c && ['ended', 'declined', 'missed'].includes(c.status)) endCall(c.status === 'declined' ? 'Call declined.' : 'Call ended.', true);
  } catch (e) { /* network hiccup: keep polling */ }
}

export async function placeCall(convId, peerId, kind) {
  if (st.call || busy) return toast('Another call is in progress.');
  busy = true;
  try {
    local = await getMedia(kind);
    const id = await cloud.startCall(convId, kind);
    upd({ call: { id, role: 'caller', kind, peer: peerId, conv: convId, status: 'calling', muted: false, camOff: false, remote: null, local, started: 0 } });
    makePc(id, peerId);
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    await cloud.sendSignal(meId(), id, peerId, 'offer', { type: offer.type, sdp: offer.sdp });
    sigTimer = setInterval(() => pollSignals(id, 'caller'), 1000);
    ringTimer = setTimeout(() => { if (st.call?.status === 'calling') endCall('No answer.'); }, 40000);
  } catch (e) {
    local?.getTracks().forEach((t) => t.stop()); local = null;
    toast(/busy/.test(e.message) ? 'Line busy, please try again later.' : /blocked/.test(e.message) ? 'Cannot call because of a block.' : e.message);
  } finally { busy = false; }
}

export async function acceptCall() {
  const c = st.incoming; if (!c || busy) return;
  busy = true; clearInterval(ringWatch);
  try {
    local = await getMedia(c.kind);
    await cloud.setCallStatus(c.id, 'accepted');
    upd({ incoming: null, call: { id: c.id, role: 'callee', kind: c.kind, peer: c.caller_id, conv: c.conversation_id, status: 'connecting', muted: false, camOff: false, remote: null, local, started: 0 } });
    makePc(c.id, c.caller_id);
    sigTimer = setInterval(() => pollSignals(c.id, 'callee'), 1000);
    pollSignals(c.id, 'callee');
  } catch (e) {
    local?.getTracks().forEach((t) => t.stop()); local = null;
    cloud.setCallStatus(c.id, 'declined').catch(() => {}); upd({ incoming: null }); toast(e.message);
  } finally { busy = false; }
}
export async function declineCall() {
  const c = st.incoming; if (!c) return;
  upd({ incoming: null }); clearInterval(ringWatch);
  cloud.setCallStatus(c.id, 'declined').catch(() => {});
}
export function endCall(msg, remoteDone) {
  const c = st.call;
  clearInterval(sigTimer); clearTimeout(ringTimer); sigTimer = null;
  if (c && !remoteDone) cloud.setCallStatus(c.id, 'ended').catch(() => {});
  try { pc?.close(); } catch (e) { /* ignore */ }
  pc = null; local?.getTracks().forEach((t) => t.stop()); local = null; pendingIce = []; remoteSet = false;
  upd({ call: null });
  if (msg) toast(msg);
}
export function toggleMute() {
  const m = !st.call?.muted; local?.getAudioTracks().forEach((t) => { t.enabled = !m; }); setCall({ muted: m });
}
export function toggleCam() {
  const o = !st.call?.camOff; local?.getVideoTracks().forEach((t) => { t.enabled = !o; }); setCall({ camOff: o });
}
