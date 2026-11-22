// FYNZA local data store (Phase 2).
// Everything is saved in THIS browser only (localStorage + IndexedDB for videos).
// In Phase 3 this file is replaced by the real Supabase backend with the same functions.
import { useSyncExternalStore } from 'react';
import * as cloud from './cloud.js';
import { isOnline, cloudSignUp, cloudSignIn, cloudSignOut, usernameAvailable, validSession, fetchMyProfile, patchMyProfile, passwordProblems, mfaLoginVerify } from './supabase.js';

const KEY = 'fynza_v2';
const DAY = 86400000;
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const now = () => Date.now();

export async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fynza:' + text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const COLORS = ['#2563EB', '#7C3AED', '#0EA5E9', '#EA580C', '#16A34A', '#DB2777', '#0891B2', '#4F46E5'];

function empty() {
  return {
    v: 2, users: {}, me: null, posts: [], saved: {}, friends: [], requests: [], follows: [],
    stories: [], chats: [], groups: [], pages: [], notifs: [], visits: [], settings: {},
    blocks: [], reports: [], reels: [], demoOn: false,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...empty(), ...JSON.parse(raw) };
  } catch (e) { /* ignore */ }
  return empty();
}

let state = load();
let errorHandler = () => {};
export const setErrorHandler = (f) => { errorHandler = f; };
const listeners = new Set();
export let saveError = null;

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); saveError = null; }
  catch (e) { saveError = 'ব্রাউজারের জায়গা শেষ। ছবি কম ব্যবহার করুন বা পুরনো পোস্ট মুছুন।'; }
}
function set(fn) {
  state = fn(state) || state;
  state = { ...state };
  persist();
  listeners.forEach((l) => l());
}
export function useStore() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}
export const getState = () => state;

// ---------- helpers ----------
export const colorFor = (id) => COLORS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
export const me = (s = state) => (s.me ? s.users[s.me] : null);
export const areFriends = (s, a, b) => s.friends.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
export const isBlocked = (s, a, b) => s.blocks.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
export const requestBetween = (s, a, b) => s.requests.find((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a));
export const mySettings = (s = state, id = state.me) => ({
  recordMyVisits: true, keepVisitors: true, autoDeleteDays: 0, profilePublic: true, whoCanMessage: 'everyone',
  postAudience: 'public', showLastSeen: true, showReadReceipts: true, ...(s.settings[id] || {}),
});

export function timeAgo(t) {
  const d = Math.max(0, now() - t);
  const m = Math.floor(d / 60000);
  if (m < 1) return 'এইমাত্র';
  if (m < 60) return m + ' মিনিট আগে';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' ঘণ্টা আগে';
  const dd = Math.floor(h / 24);
  if (dd < 30) return dd + ' দিন আগে';
  return new Date(t).toLocaleDateString();
}
export const fullTime = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

// ---------- auth ----------
export async function register({ name, username, email, password }) {
  name = name.trim(); username = username.trim().replace(/^@/, '').toLowerCase(); email = email.trim().toLowerCase();
  if (name.length < 2) return 'নাম কমপক্ষে ২ অক্ষরের হতে হবে।';
  if (!/^[a-z0-9_.]{3,20}$/.test(username)) return 'ইউজারনেম ৩-২০ অক্ষর; শুধু a-z, 0-9, _ এবং . চলবে।';
  if (!/^\S+@\S+\.\S+$/.test(email)) return 'সঠিক ইমেইল দিন।';
  if (password.length < 8) return 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।';
  if (isOnline()) { const bad = passwordProblems(password); if (bad.length) return 'পাসওয়ার্ডে লাগবে: ' + bad.join(', '); }
  if (isOnline()) return cloudRegister({ name, username, email, password });
  const users = Object.values(state.users);
  if (users.some((u) => u.username === username)) return 'এই ইউজারনেম আগেই নেওয়া হয়েছে।';
  if (users.some((u) => u.email === email)) return 'এই ইমেইল দিয়ে আগেই অ্যাকাউন্ট আছে।';
  const hash = await sha(password);
  const id = 'u_' + uid();
  set((s) => {
    s.users = { ...s.users, [id]: { id, name, username, email, hash, bio: '', avatar: '', cover: '', created: now() } };
    s.me = id;
    if (!s.demoOn && Object.values(s.users).filter((u) => !u.demo).length === 1) seedDemo(s, id);
  });
  return null;
}
export async function login(emailOrUser, password) {
  const key = emailOrUser.trim().toLowerCase().replace(/^@/, '');
  if (isOnline()) return cloudLogin(key, password);
  const u = Object.values(state.users).find((x) => !x.demo && !x.cloud && (x.email === key || x.username === key));
  if (!u) return 'এই ইমেইল/ইউজারনেমে কোনো অ্যাকাউন্ট নেই।';
  if ((await sha(password)) !== u.hash) return 'পাসওয়ার্ড ভুল।';
  set((s) => { s.me = u.id; });
  return null;
}
export const logout = () => { cloudSignOut(); set((s) => { s.me = null; }); };

// ---------- online (Supabase) accounts ----------
function adopt(profile, email) {
  if (profile.banned) { cloudSignOut(); set((s) => { s.me = null; }); throw new Error('আপনার অ্যাকাউন্ট সাসপেন্ড করা হয়েছে। অ্যাডমিনের সাথে যোগাযোগ করুন।'); }
  set((s) => {
    const prev = s.users[profile.id] || {};
    s.users = { ...s.users, [profile.id]: cloud.toUser(profile, { email: email || prev.email }) };
    s.me = profile.id;
  });
  refreshAll();
}
let refreshing = null;
// Reload feed, authors, reactions, comments and saved posts from the online database
export function refreshFeed() {
  const meId = state.me;
  if (!meId || !state.users[meId]?.cloud) return Promise.resolve();
  if (refreshing) return refreshing.then(() => refreshFeed()); // a refresh started earlier may not contain the newest change
  refreshing = cloud.loadFeed(meId).then((d) => set((s) => {
    const users = { ...s.users };
    d.users.forEach((p) => { users[p.id] = cloud.toUser(p, users[p.id]); });
    s.users = users;
    s.posts = [...d.posts, ...s.posts.filter((p) => !p.cloud)];
    s.saved = { ...s.saved, [meId]: d.saved };
  })).catch((e) => errorHandler('ফিড লোড হয়নি: ' + e.message)).finally(() => { refreshing = null; });
  return refreshing;
}
const pendingW = new Set();
const track = (p) => { pendingW.add(p); const d = () => pendingW.delete(p); p.then(d, d); return p; };
const snap = (s) => [s.friends, s.requests, s.follows, s.notifs, s.visits, s.blocks, s.settings];
let socialBusy = null;
export function refreshSocial() {
  const meId = state.me;
  if (!meId || !state.users[meId]?.cloud) return Promise.resolve();
  if (socialBusy) return socialBusy.then(() => refreshSocial());
  const before = snap(state);
  socialBusy = Promise.allSettled([...pendingW]).then(() => cloud.loadSocial(meId)).then((d) => {
    // if something changed locally while we were loading (or a write is still running), this server copy may be stale: ask again later
    if (pendingW.size || snap(state).some((x, i) => x !== before[i])) { stale = true; return; }
    applySocial(d, meId);
  }).catch((e) => errorHandler('আপডেট আনা যায়নি: ' + e.message)).finally(() => { socialBusy = null; if (stale) { stale = false; setTimeout(refreshSocial, 400); } });
  return socialBusy;
}
let stale = false;
function applySocial(d, meId) {
  set((s) => {
    const users = { ...s.users }; d.profiles.forEach((p) => { users[p.id] = cloud.toUser(p, users[p.id]); }); s.users = users;
    const local = (id) => !users[id]?.cloud;               // entries between local-only demo users stay as they are
    const keep = (a, b) => local(a) && local(b);
    s.friends = [...s.friends.filter(([a, b]) => keep(a, b)), ...d.friends];
    s.requests = [...s.requests.filter((r) => keep(r.from, r.to)), ...d.requests];
    // follows of other cloud profiles that I loaded while browsing are kept
    s.follows = [...s.follows.filter(([a, b]) => keep(a, b) || (a !== meId && b !== meId)), ...d.follows.filter(([a, b], i, arr) => arr.findIndex(([x, y]) => x === a && y === b) === i)];
    s.notifs = [...s.notifs.filter((n) => n.to !== meId), ...d.notifs];
    s.visits = [...s.visits.filter((v) => v.profile !== meId), ...d.visits];
    s.blocks = [...s.blocks.filter(([a, b]) => keep(a, b)), ...d.blocks];
    s.settings = { ...s.settings, [meId]: { ...mySettings(s), ...d.settings } };
    if (s.users[meId]) s.users = { ...s.users, [meId]: { ...s.users[meId], role: d.self.role, banned: d.self.banned } };
  });
  if (d.self.banned) { cloudSignOut(); set((s) => { s.me = null; }); errorHandler('আপনার অ্যাকাউন্ট সাসপেন্ড করা হয়েছে।'); }
}
export async function suggestPeopleOnline() {
  if (!state.users[state.me]?.cloud) return;
  try { const rows = await cloud.newestProfiles(state.me); set((s) => { const u = { ...s.users }; rows.forEach((p) => { u[p.id] = cloud.toUser(p, u[p.id]); }); s.users = u; }); } catch (e) { /* ignore */ }
}
let mediaBusy = null;
export function refreshMedia() {
  const meId = state.me;
  if (!meId || !state.users[meId]?.cloud) return Promise.resolve();
  if (mediaBusy) return mediaBusy.then(() => refreshMedia());
  mediaBusy = Promise.allSettled([...pendingW]).then(() => cloud.loadMedia()).then((d) => set((s) => {
    const users = { ...s.users }; d.profiles.forEach((p) => { users[p.id] = cloud.toUser(p, users[p.id]); }); s.users = users;
    s.stories = [...d.stories, ...s.stories.filter((x) => !x.cloud)];
    s.reels = [...d.reels, ...s.reels.filter((x) => !x.cloud)];
  })).catch((e) => errorHandler('স্টোরি/রিল লোড হয়নি: ' + e.message)).finally(() => { mediaBusy = null; });
  return mediaBusy;
}
let chatBusy = null;
export function refreshChats() {
  const meId = state.me;
  if (!meId || !state.users[meId]?.cloud) return Promise.resolve();
  if (chatBusy) return chatBusy.then(() => refreshChats());
  chatBusy = Promise.allSettled([...pendingW]).then(() => cloud.loadChats(meId)).then((d) => set((s) => {
    const users = { ...s.users }; d.profiles.forEach((p) => { users[p.id] = cloud.toUser(p, users[p.id]); }); s.users = users;
    s.chats = [...d.chats, ...s.chats.filter((c) => !c.cloud)];
  })).catch((e) => errorHandler('মেসেজ আনা যায়নি: ' + e.message)).finally(() => { chatBusy = null; });
  return chatBusy;
}
let groupBusy = null;
export function refreshGroups() {
  const meId = state.me;
  if (!meId || !state.users[meId]?.cloud) return Promise.resolve();
  if (groupBusy) return groupBusy.then(() => refreshGroups());
  groupBusy = Promise.allSettled([...pendingW]).then(() => cloud.loadGroups()).then((d) => set((s) => {
    const users = { ...s.users }; d.profiles.forEach((p) => { users[p.id] = cloud.toUser(p, users[p.id]); }); s.users = users;
    s.groups = [...d.groups, ...s.groups.filter((g) => !g.cloud)];
    s.pages = [...d.pages, ...s.pages.filter((p) => !p.cloud)];
  })).catch((e) => errorHandler('গ্রুপ/পেজ আনা যায়নি: ' + e.message)).finally(() => { groupBusy = null; });
  return groupBusy;
}
export const refreshAll = () => Promise.all([refreshFeed(), refreshSocial(), refreshMedia(), refreshChats(), refreshGroups()]);
const grpErr = (m) => (/only friends|you can only add friends/.test(m) ? 'শুধু আপনার বন্ধুদের যোগ করা যায়।' : /only the group owner/.test(m) ? 'শুধু গ্রুপের মালিক/অ্যাডমিন সদস্য যোগ করতে পারেন।' : m);
export async function createGroupOnline(name, desc, privacy) { try { await cloud.makeGroup(state.me, name, desc, privacy); await refreshGroups(); return null; } catch (e) { return e.message; } }
export async function createPageOnline(name, kind, desc) { try { await cloud.makePage(state.me, name, kind, desc); await refreshGroups(); return null; } catch (e) { return e.message; } }
export async function addGroupMemberOnline(groupId, userId) { try { await cloud.addGroupMember(groupId, userId); await refreshGroups(); return null; } catch (e) { return grpErr(e.message); } }
const chatErr = (m) => (/only friends/.test(m) ? 'এই ব্যবহারকারী শুধু বন্ধুদের মেসেজ নেন।' : /blocked/.test(m) ? 'ব্লক থাকায় মেসেজ পাঠানো যাবে না।' : /you can only add friends/.test(m) ? 'গ্রুপে শুধু বন্ধুদের যোগ করা যায়।' : m);
export async function openChatOnline(otherId) {
  try { const id = await cloud.startChat(otherId); await refreshChats(); return { id }; } catch (e) { return { error: chatErr(e.message) }; }
}
export async function createGroupChatOnline(title, memberIds) {
  try { const id = await cloud.makeGroupChat(title, memberIds); await refreshChats(); return { id }; } catch (e) { return { error: chatErr(e.message) }; }
}
export async function loadProfileExtras(id) {
  if (!state.users[state.me]?.cloud || !state.users[id]?.cloud) return;
  try {
    const f = await cloud.followersOf(id);
    // my own edge stays as the app already knows it (it may have just changed); only other people's follows are replaced
    set((s) => { s.follows = [...s.follows.filter(([a, b]) => b !== id || a === s.me), ...f.filter((x) => x.follower_id !== s.me).map((x) => [x.follower_id, x.following_id])]; });
  } catch (e) { /* ignore */ }
}
export async function fetchUserOnline(id) {
  if (!state.users[state.me]?.cloud || state.users[id]) return;
  try { const p = await cloud.loadProfile(id); if (p) set((s) => { s.users = { ...s.users, [id]: cloud.toUser(p) }; }); } catch (e) { /* ignore */ }
}
export async function searchPeopleOnline(term) {
  const rows = await cloud.searchProfiles(term);
  set((s) => { const u = { ...s.users }; rows.forEach((p) => { u[p.id] = cloud.toUser(p, u[p.id]); }); s.users = u; });
  return rows.map((p) => p.id);
}
export const sameWorld = (s, u) => !!u?.cloud === !!s.users[s.me]?.cloud;
export const isCloudMe = (s = state) => !!s.users[s.me]?.cloud;
async function cloudRegister({ name, username, email, password }) {
  try {
    if (!(await usernameAvailable(username))) return 'এই ইউজারনেম আগেই নেওয়া হয়েছে।';
    const r = await cloudSignUp({ email, password, name, username });
    if (r.needsConfirm) return { info: 'আপনার ইমেইলে একটি ভেরিফিকেশন লিংক পাঠানো হয়েছে। লিংকে ক্লিক করে ভেরিফাই করুন, তারপর লগইন করুন।' };
    const p = await fetchMyProfile();
    if (!p) return 'অ্যাকাউন্ট হয়েছে কিন্তু প্রোফাইল পাওয়া যায়নি। schema.sql চালানো হয়েছে কিনা দেখুন।';
    adopt(p, email); return null;
  } catch (e) { return e.message; }
}
async function cloudLogin(key, password) {
  if (!key.includes('@')) return 'অনলাইন মোডে ইমেইল দিয়ে লগইন করুন।';
  try {
    const r = await cloudSignIn(key, password);
    if (r?.mfa) { pendingMfa = { ...r.mfa, email: key }; return { mfa: true }; }
    return finishCloudLogin(key);
  } catch (e) { return e.message; }
}
let pendingMfa = null;
export async function loginMfa(code) {
  if (!pendingMfa) return 'আবার লগইন করুন।';
  try { await mfaLoginVerify(pendingMfa.factorId, pendingMfa.token, code); const k = pendingMfa.email; pendingMfa = null; return finishCloudLogin(k); }
  catch (e) { return /expired|invalid|incorrect/i.test(e.message) ? 'কোড ভুল বা মেয়াদ শেষ। আবার চেষ্টা করুন।' : e.message; }
}
export const cancelMfa = () => { pendingMfa = null; };
async function finishCloudLogin(key) {
  try {
    const p = await fetchMyProfile();
    if (!p) return 'লগইন হয়েছে কিন্তু প্রোফাইল পাওয়া যায়নি। schema.sql চালানো হয়েছে কিনা দেখুন।';
    adopt(p, key); return null;
  } catch (e) { return e.message; }
}
// Called once when the app starts: refresh the online session and profile
export async function initCloud() {
  const u = state.me && state.users[state.me];
  if (!isOnline() || !u?.cloud) return;
  const ses = await validSession();
  if (!ses) { set((s) => { s.me = null; }); return; }
  try { const p = await fetchMyProfile(); if (p) adopt(p, u.email); } catch (e) { /* offline: keep local copy */ }
  if (!pollTimer) pollTimer = setInterval(() => { if (!document.hidden && state.me && state.users[state.me]?.cloud) refreshAll(); }, 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAll(); });
}
let pollTimer = null;

// ---------- demo data ----------
const DEMO = [
  ['Ayesha Akter', 'ayesha', 'Nature lover. Photography & travel.'],
  ['Tanvir Rahman', 'tanvir', 'Dream Big • Work Hard • Be Happy'],
  ['Sadia Islam', 'sadia', 'Coffee, books and good vibes.'],
  ['Rakib Hasan', 'rakib', 'Learning to code, one day at a time.'],
  ['Nusrat Jahan', 'nusrat', 'Designer. Sunsets are my thing.'],
];
function seedDemo(s, meId) {
  s.demoOn = true;
  const ids = DEMO.map(([name, username, bio]) => {
    const id = 'd_' + username;
    s.users[id] = { id, name, username, email: username + '@demo.fynza', hash: '', bio, avatar: '', cover: '', created: now() - 30 * DAY, demo: true };
    return id;
  });
  const [a, t, sa, r, n] = ids;
  s.posts.push(
    { id: uid(), author: a, text: 'Good vibes only! 😎', img: '', time: now() - 2 * 3600000, aud: 'public', reactions: { [t]: 'like', [sa]: 'love' }, comments: [{ id: uid(), author: t, text: 'Looks amazing!', time: now() - 3600000, replies: [] }] },
    { id: uid(), author: r, text: 'First week of learning to code is done. Small steps count.', img: '', time: now() - 5 * 3600000, aud: 'public', reactions: { [a]: 'like' }, comments: [] },
    { id: uid(), author: n, text: 'Sunset by the river. Sharing the calm with all of you.', img: '', scene: 'sunset', time: now() - 9 * 3600000, aud: 'public', reactions: {}, comments: [] },
  );
  s.requests.push({ from: t, to: meId, time: now() - 5 * 60000 }, { from: sa, to: meId, time: now() - 2 * 3600000 });
  s.notifs.push(
    { id: uid(), to: meId, type: 'friend_request', from: t, time: now() - 5 * 60000, read: false },
    { id: uid(), to: meId, type: 'friend_request', from: sa, time: now() - 2 * 3600000, read: false },
    { id: uid(), to: meId, type: 'system', from: '', text: 'FYNZA-তে স্বাগতম! এটি ডেমো তথ্য — সেটিংস থেকে মুছে ফেলা যায়।', time: now() - 60000, read: false },
  );
  s.groups.push(
    { id: uid(), name: 'Fynza Community', desc: 'Welcome to the FYNZA community.', privacy: 'public', members: [a, t, sa, r, n], owner: a, demo: true },
    { id: uid(), name: 'Tech Lovers BD', desc: 'Everything about technology.', privacy: 'public', members: [r, t], owner: r, demo: true },
    { id: uid(), name: 'Nature Lovers', desc: 'Photos and trips in nature.', privacy: 'private', members: [a, n], owner: n, demo: true },
  );
  s.pages.push({ id: uid(), name: 'Fynza News', kind: 'Business', desc: 'Product news and updates.', owner: a, followers: [t, sa], demo: true });
  s.chats.push({ id: uid(), members: [meId, a], group: false, title: '', msgs: [{ id: uid(), from: a, text: 'Hi! Welcome to FYNZA 👋', time: now() - 600000 }] });
  [a, t, sa].forEach((v, i) => s.visits.push({ id: uid(), profile: meId, visitor: v, time: now() - (i + 1) * 7 * 3600000 }));
}
export function clearDemo() {
  set((s) => {
    const demoIds = Object.values(s.users).filter((u) => u.demo).map((u) => u.id);
    const isD = (id) => demoIds.includes(id);
    demoIds.forEach((id) => delete s.users[id]);
    s.posts = s.posts.filter((p) => !isD(p.author)).map((p) => ({ ...p, comments: p.comments.filter((c) => !isD(c.author)) }));
    s.requests = s.requests.filter((r) => !isD(r.from) && !isD(r.to));
    s.friends = s.friends.filter(([x, y]) => !isD(x) && !isD(y));
    s.follows = s.follows.filter(([x, y]) => !isD(x) && !isD(y));
    s.notifs = s.notifs.filter((x) => !isD(x.from));
    s.visits = s.visits.filter((v) => !isD(v.visitor));
    s.stories = s.stories.filter((x) => !isD(x.author));
    s.chats = s.chats.filter((c) => !c.members.some(isD));
    s.groups = s.groups.filter((g) => !g.demo).map((g) => ({ ...g, members: g.members.filter((m) => !isD(m)) }));
    s.pages = s.pages.filter((p) => !p.demo);
    s.demoOn = false;
  });
}

// ---------- profile ----------
export async function updateProfile(patch) {
  if (!state.users[state.me]?.cloud) {
    set((s) => { s.users = { ...s.users, [s.me]: { ...s.users[s.me], ...patch } }; });
    return null;
  }
  try {
    let { avatar, cover } = patch;
    if (avatar && avatar.startsWith('data:')) avatar = await cloud.uploadProfileImage(state.me, 'avatar', avatar);
    if (cover && cover.startsWith('data:')) cover = await cloud.uploadProfileImage(state.me, 'cover', cover);
    const row = await cloud.patchProfile(state.me, { name: patch.name, bio: patch.bio, avatar_url: avatar || '', cover_url: cover || '' });
    set((s) => { s.users = { ...s.users, [s.me]: cloud.toUser(row, s.users[s.me]) }; });
    return null;
  } catch (e) { return e.message; }
}
export function updateSettings(patch) {
  set((s) => { s.settings = { ...s.settings, [s.me]: { ...mySettings(s), ...patch } }; });
  if (state.users[state.me]?.cloud) track(cloud.saveSettings(state.me, patch)).catch((e) => { errorHandler('সেটিং সেভ হয়নি: ' + e.message); refreshSocial(); });
}

// ---------- profile visitors ----------
export function recordVisit(profileId) {
  const s0 = state;
  if (!s0.me || s0.me === profileId) return;
  if (!mySettings(s0).recordMyVisits) return;            // I browse privately
  if (!mySettings(s0, profileId).keepVisitors) return;   // owner turned visitor log off
  if (isBlocked(s0, s0.me, profileId)) return;
  if (s0.users[profileId]?.cloud) { cloud.visit(profileId).catch(() => {}); return; } // server applies both people's privacy rules
  const last = s0.visits.find((v) => v.profile === profileId && v.visitor === s0.me && now() - v.time < 30 * 60000);
  if (last) return; // one entry per 30 minutes
  set((s) => {
    s.visits = [{ id: uid(), profile: profileId, visitor: s.me, time: now() }, ...s.visits].slice(0, 2000);
    s.notifs = [{ id: uid(), to: profileId, type: 'visit', from: s.me, time: now(), read: false }, ...s.notifs];
  });
}
export function visitsOfMe(s = state) {
  const st = mySettings(s);
  const cutoff = st.autoDeleteDays ? now() - st.autoDeleteDays * DAY : 0;
  return s.visits.filter((v) => v.profile === s.me && v.time >= cutoff && s.users[v.visitor]);
}
export const removeVisit = (id) => {
  set((s) => { s.visits = s.visits.filter((v) => v.id !== id); });
  if (state.users[state.me]?.cloud) track(cloud.deleteVisit(id)).catch((e) => { errorHandler('মোছা যায়নি: ' + e.message); refreshSocial(); });
};
export const clearVisits = () => {
  set((s) => { s.visits = s.visits.filter((v) => v.profile !== s.me); });
  if (state.users[state.me]?.cloud) track(cloud.clearVisitsOnline(state.me)).catch((e) => { errorHandler('মোছা যায়নি: ' + e.message); refreshSocial(); });
};

// ---------- friends / follow / block ----------
const fail = (msg) => (e) => { errorHandler(msg + e.message); refreshSocial(); };
export function sendRequest(to) {
  if (state.users[to]?.cloud) {
    set((s) => { if (!requestBetween(s, s.me, to) && !areFriends(s, s.me, to)) s.requests = [...s.requests, { from: s.me, to, time: now() }]; });
    return track(cloud.requestFriend(state.me, to)).catch(fail('অনুরোধ যায়নি: '));
  }
  set((s) => {
    if (requestBetween(s, s.me, to) || areFriends(s, s.me, to)) return;
    s.requests = [...s.requests, { from: s.me, to, time: now() }];
    s.notifs = [{ id: uid(), to, type: 'friend_request', from: s.me, time: now(), read: false }, ...s.notifs];
  });
}
export function acceptRequest(from) {
  if (state.users[from]?.cloud) {
    set((s) => {
      s.requests = s.requests.filter((r) => !(r.from === from && r.to === s.me));
      if (!areFriends(s, from, s.me)) s.friends = [...s.friends, [from, s.me]];
      s.notifs = s.notifs.filter((n) => !(n.type === 'friend_request' && n.from === from));
    });
    return track(cloud.acceptFriend(state.me, from)).catch(fail('Confirm হয়নি: '));
  }
  set((s) => {
    s.requests = s.requests.filter((r) => !(r.from === from && r.to === s.me));
    if (!areFriends(s, from, s.me)) s.friends = [...s.friends, [from, s.me]];
    s.notifs = s.notifs.filter((n) => !(n.type === 'friend_request' && n.from === from && n.to === s.me));
  });
}
export function declineRequest(from) {
  if (state.users[from]?.cloud) {
    set((s) => { s.requests = s.requests.filter((r) => !((r.from === from && r.to === s.me) || (r.from === s.me && r.to === from))); s.notifs = s.notifs.filter((n) => !(n.type === 'friend_request' && n.from === from)); });
    return track(cloud.removeFriendship(state.me, from)).catch(fail('বাতিল হয়নি: '));
  }
  set((s) => {
    s.requests = s.requests.filter((r) => !((r.from === from && r.to === s.me) || (r.from === s.me && r.to === from)));
    s.notifs = s.notifs.filter((n) => !(n.type === 'friend_request' && n.from === from && n.to === s.me));
  });
}
export const unfriend = (id) => {
  if (state.users[id]?.cloud) track(cloud.removeFriendship(state.me, id)).catch(fail('Unfriend হয়নি: '));
  localUnfriend(id);
};
const localUnfriend = (id) => set((s) => { s.friends = s.friends.filter(([x, y]) => !((x === id && y === s.me) || (y === id && x === s.me))); });
export const toggleFollow = (id) => {
  const on = !state.follows.some(([a, b]) => a === state.me && b === id);
  if (state.users[id]?.cloud) track(cloud.followOnline(state.me, id, on)).catch(fail('Follow হয়নি: '));
  localFollow(id);
};
const localFollow = (id) => set((s) => {
  const has = s.follows.some(([a, b]) => a === s.me && b === id);
  s.follows = has ? s.follows.filter(([a, b]) => !(a === s.me && b === id)) : [...s.follows, [s.me, id]];
});
export const blockUser = (id) => {
  if (state.users[id]?.cloud) cloud.addBlockOnline(state.me, id).catch((e) => { errorHandler('ব্লক সেভ হয়নি: ' + e.message); });
  localBlock(id);
};
const localBlock = (id) => set((s) => {
  if (!isBlocked(s, s.me, id)) s.blocks = [...s.blocks, [s.me, id]];
  s.friends = s.friends.filter(([x, y]) => !((x === id && y === s.me) || (y === id && x === s.me)));
  s.requests = s.requests.filter((r) => !((r.from === id && r.to === s.me) || (r.from === s.me && r.to === id)));
});
export const unblockUser = (id) => {
  if (state.users[id]?.cloud) cloud.removeBlockOnline(state.me, id).catch((e) => errorHandler('আনব্লক সেভ হয়নি: ' + e.message));
  set((s) => { s.blocks = s.blocks.filter(([a, b]) => !(a === s.me && b === id)); });
};
export const report = (kind, target, reason) => {
  const online = kind === 'post' ? state.posts.find((p) => p.id === target)?.cloud : kind === 'message' ? state.chats.some((c) => c.cloud && c.msgs.some((m) => m.id === target)) : state.users[target]?.cloud;
  if (online) { cloud.sendReport(state.me, kind, target, reason).catch((e) => errorHandler('রিপোর্ট যায়নি: ' + e.message)); return; }
  localReport(kind, target, reason);
};
const localReport = (kind, target, reason) => set((s) => { s.reports = [...s.reports, { id: uid(), by: s.me, kind, target, reason, time: now() }]; });

// ---------- posts ----------
export function addPost({ text, img, videoKey, aud, groupId, pageId }) {
  set((s) => { s.posts = [{ id: uid(), author: s.me, text, img: img || '', videoKey: videoKey || '', aud: aud || mySettings(s).postAudience, time: now(), reactions: {}, comments: [], groupId, pageId }, ...s.posts]; });
}
export async function addPostOnline(args) {
  try { await cloud.createPost(state.me, args); await refreshFeed(); return null; } catch (e) { return e.message; }
}
export const deletePost = (id) => {
  const p = state.posts.find((x) => x.id === id);
  set((s) => { s.posts = s.posts.filter((x) => x.id !== id || x.author !== s.me); });
  if (p?.cloud && p.author === state.me) cloud.deletePostOnline(p).catch((e) => { errorHandler('মুছতে পারেনি: ' + e.message); refreshFeed(); });
};
export function react(postId, type) {
  set((s) => {
    s.posts = s.posts.map((p) => {
      if (p.id !== postId) return p;
      const r = { ...p.reactions };
      if (!type || r[s.me] === type) delete r[s.me]; else r[s.me] = type;
      if (type && p.author !== s.me && r[s.me] && !p.cloud) s.notifs = [{ id: uid(), to: p.author, type: 'like', from: s.me, postId, time: now(), read: false }, ...s.notifs];
      return { ...p, reactions: r };
    });
  });
  const p = state.posts.find((x) => x.id === postId);
  if (p?.cloud) cloud.setReaction(state.me, postId, p.reactions[state.me] || null).catch((e) => { errorHandler('রিঅ্যাকশন সেভ হয়নি: ' + e.message); refreshFeed(); });
}
export function addComment(postId, text, parentId) {
  if (state.posts.find((p) => p.id === postId)?.cloud) {
    return cloud.createComment(state.me, postId, text, parentId).then(() => refreshFeed()).catch((e) => errorHandler('কমেন্ট হয়নি: ' + e.message));
  }
  set((s) => {
    s.posts = s.posts.map((p) => {
      if (p.id !== postId) return p;
      const c = { id: uid(), author: s.me, text, time: now(), replies: [] };
      if (p.author !== s.me) s.notifs = [{ id: uid(), to: p.author, type: 'comment', from: s.me, postId, time: now(), read: false }, ...s.notifs];
      if (!parentId) return { ...p, comments: [...p.comments, c] };
      return { ...p, comments: p.comments.map((x) => (x.id === parentId ? { ...x, replies: [...x.replies, c] } : x)) };
    });
  });
}
export function sharePost(postId, text) {
  if (state.posts.find((p) => p.id === postId)?.cloud) {
    return cloud.createPost(state.me, { text: text || '', sharedId: postId, aud: mySettings(state).postAudience }).then(() => refreshFeed()).catch((e) => errorHandler('শেয়ার হয়নি: ' + e.message));
  }
  set((s) => {
    const o = s.posts.find((p) => p.id === postId);
    if (!o) return;
    s.posts = [{ id: uid(), author: s.me, text: text || '', img: '', time: now(), aud: mySettings(s).postAudience, reactions: {}, comments: [], shareOf: postId }, ...s.posts];
    if (o.author !== s.me) s.notifs = [{ id: uid(), to: o.author, type: 'share', from: s.me, postId, time: now(), read: false }, ...s.notifs];
  });
}
export const toggleSave = (postId) => {
  set((s) => {
    const cur = s.saved[s.me] || [];
    s.saved = { ...s.saved, [s.me]: cur.includes(postId) ? cur.filter((x) => x !== postId) : [...cur, postId] };
  });
  if (state.posts.find((p) => p.id === postId)?.cloud) {
    cloud.setSaved(state.me, postId, (state.saved[state.me] || []).includes(postId)).catch((e) => { errorHandler('সেভ হয়নি: ' + e.message); refreshFeed(); });
  }
};

// ---------- stories ----------
export async function addStoryOnline(a) { try { await cloud.createStory(state.me, { text: a.text, imgDataUrl: a.img, bg: a.bg }); await refreshMedia(); return null; } catch (e) { return e.message; } }
export const deleteStory = (id) => {
  const st = state.stories.find((x) => x.id === id);
  set((s) => { s.stories = s.stories.filter((x) => x.id !== id || x.author !== s.me); });
  if (st?.cloud && st.author === state.me) track(cloud.deleteStoryOnline(st)).catch((e) => { errorHandler('মোছা যায়নি: ' + e.message); refreshMedia(); });
};
export const addStory = ({ text, img, bg }) => set((s) => { s.stories = [{ id: uid(), author: s.me, text, img, bg, time: now() }, ...s.stories]; });
export const liveStories = (s = state) => s.stories.filter((x) => now() - x.time < DAY);

// ---------- reels ----------
export async function addReelOnline(file, caption) { try { await cloud.createReel(state.me, file, caption); await refreshMedia(); return null; } catch (e) { return e.message; } }
export const deleteReel = (id) => {
  const r = state.reels.find((x) => x.id === id);
  set((s) => { s.reels = s.reels.filter((x) => x.id !== id || x.author !== s.me); });
  if (r?.cloud && r.author === state.me) cloud.deleteReelOnline(r).catch((e) => { errorHandler('মোছা যায়নি: ' + e.message); refreshMedia(); });
};
export const addReel = (videoKey, caption) => set((s) => { s.reels = [{ id: uid(), author: s.me, videoKey, caption, time: now(), likes: [] }, ...s.reels]; });
export const toggleReelLike = (id) => {
  const r = state.reels.find((x) => x.id === id);
  if (r?.cloud) { const on = !r.likes.includes(state.me); track(cloud.setReelLike(state.me, id, on)).catch((e) => { errorHandler('লাইক হয়নি: ' + e.message); refreshMedia(); }); }
  localReelLike(id);
};
const localReelLike = (id) => set((s) => {
  s.reels = s.reels.map((r) => (r.id !== id ? r : { ...r, likes: r.likes.includes(s.me) ? r.likes.filter((x) => x !== s.me) : [...r.likes, s.me] }));
});

// ---------- chat ----------
export function openChat(otherId) {
  const ex = state.chats.find((c) => !c.group && c.members.includes(state.me) && c.members.includes(otherId));
  if (ex) return ex.id;
  const id = uid();
  set((s) => { s.chats = [{ id, members: [s.me, otherId], group: false, title: '', msgs: [] }, ...s.chats]; });
  return id;
}
export function createGroupChat(title, memberIds) {
  const id = uid();
  set((s) => { s.chats = [{ id, members: [s.me, ...memberIds], group: true, title, msgs: [] }, ...s.chats]; });
  return id;
}
export function sendMessage(chatId, text, img) {
  const c = state.chats.find((x) => x.id === chatId);
  if (!c?.cloud) return localSend(chatId, text, img);
  return sendRich(chatId, { text, kind: img ? 'image' : 'text', dataUrl: img });
}
const patchChat = (chatId, fn) => set((s) => { s.chats = s.chats.map((x) => (x.id !== chatId ? x : fn(x))); });
const patchMsg = (chatId, mid, fn) => patchChat(chatId, (x) => ({ ...x, msgs: x.msgs.map((m) => (m.id !== mid ? m : fn(m))) }));
// o: { text, kind, dataUrl | blob, fileName, duration, replyTo }
export function sendRich(chatId, o) {
  const tmp = 'tmp' + uid();
  const local = o.blob ? URL.createObjectURL(o.blob) : (o.dataUrl || '');
  const kind = o.kind || 'text';
  patchChat(chatId, (x) => ({ ...x, msgs: [...x.msgs, { id: tmp, from: state.me, text: o.text || '', kind, url: local, img: kind === 'image' ? local : '', fileName: o.fileName || '', duration: o.duration || 0, reply: o.replyTo || '', rx: {}, time: now(), sending: true }] }));
  return track(cloud.sendChatMessage(state.me, chatId, o)).catch((e) => {
    errorHandler('মেসেজ যায়নি: ' + chatErr(e.message));
    patchChat(chatId, (x) => ({ ...x, msgs: x.msgs.filter((m) => m.id !== tmp) }));
  }).finally(() => refreshChats());
}
export function reactToMessage(chatId, mid, emoji) {
  const mine = state.me; const cur = state.chats.find((c) => c.id === chatId)?.msgs.find((m) => m.id === mid)?.rx?.[mine];
  const next = cur === emoji ? '' : emoji;
  patchMsg(chatId, mid, (m) => { const rx = { ...m.rx }; if (next) rx[mine] = next; else delete rx[mine]; return { ...m, rx }; });
  return track(cloud.reactMessage(mine, mid, next)).catch((e) => { errorHandler('রিঅ্যাকশন হয়নি: ' + chatErr(e.message)); refreshChats(); });
}
export function editMessageOnline(chatId, mid, text) {
  patchMsg(chatId, mid, (m) => ({ ...m, text, edited: true }));
  return track(cloud.editMessage(mid, text)).catch((e) => { errorHandler('এডিট হয়নি: ' + chatErr(e.message)); refreshChats(); });
}
export function deleteMessageOnline(chatId, mid) {
  patchMsg(chatId, mid, (m) => ({ ...m, deleted: true, text: '', url: '', img: '', rx: {} }));
  return track(cloud.deleteMessage(mid)).catch((e) => { errorHandler('ডিলিট হয়নি: ' + chatErr(e.message)); refreshChats(); });
}
export function markChatRead(chatId) {
  const c = state.chats.find((x) => x.id === chatId);
  if (!c?.cloud) return Promise.resolve();
  return cloud.markChatRead(chatId).catch(() => {});
}
export async function leaveChatOnline(chatId) {
  try { await cloud.leaveChat(chatId); set((s) => { s.chats = s.chats.filter((c) => c.id !== chatId); }); return null; } catch (e) { return e.message; }
}
const localSend = (chatId, text, img) => set((s) => {
  s.chats = s.chats.map((c) => (c.id !== chatId ? c : { ...c, msgs: [...c.msgs, { id: uid(), from: s.me, text, img: img || '', time: now() }] }));
});

// ---------- groups & pages ----------
export const createGroup = (name, desc, privacy) => set((s) => { s.groups = [{ id: uid(), name, desc, privacy, members: [s.me], owner: s.me }, ...s.groups]; });
export const toggleGroup = (id) => {
  const g = state.groups.find((x) => x.id === id);
  if (g?.cloud) {
    const joined = g.members.includes(state.me);
    if (joined && g.owner === state.me) { errorHandler('মালিক গ্রুপ ছাড়তে পারেন না।'); return; }
    return track(joined ? cloud.leaveGroupOnline(state.me, id) : cloud.joinGroupOnline(state.me, id)).then(() => refreshGroups()).catch((e) => { errorHandler('হয়নি: ' + e.message); refreshGroups(); });
  }
  localToggleGroup(id);
};
const localToggleGroup = (id) => set((s) => {
  s.groups = s.groups.map((g) => (g.id !== id ? g : { ...g, members: g.members.includes(s.me) ? g.members.filter((m) => m !== s.me) : [...g.members, s.me] }));
});
export const createPage = (name, kind, desc) => set((s) => { s.pages = [{ id: uid(), name, kind, desc, owner: s.me, followers: [s.me] }, ...s.pages]; });
export const togglePage = (id) => {
  const p = state.pages.find((x) => x.id === id);
  if (p?.cloud) {
    const on = !p.followers.includes(state.me);
    set((s) => { s.pages = s.pages.map((x) => (x.id !== id ? x : { ...x, followers: on ? [...x.followers, s.me] : x.followers.filter((u) => u !== s.me) })); });
    return track(cloud.followPageOnline(state.me, id, on)).catch((e) => { errorHandler('Follow হয়নি: ' + e.message); refreshGroups(); });
  }
  localTogglePage(id);
};
const localTogglePage = (id) => set((s) => {
  s.pages = s.pages.map((p) => (p.id !== id ? p : { ...p, followers: p.followers.includes(s.me) ? p.followers.filter((m) => m !== s.me) : [...p.followers, s.me] }));
});

// ---------- notifications ----------
export const markNotifsRead = () => {
  const had = state.notifs.some((n) => n.to === state.me && !n.read);
  set((s) => { s.notifs = s.notifs.map((n) => (n.to === s.me ? { ...n, read: true } : n)); });
  if (had && state.users[state.me]?.cloud) track(cloud.markRead(state.me)).catch(() => {});
};

// ---------- media (images + videos) ----------
export function compressImage(file, max = 1000, q = 0.78) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', q));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('fynza_media', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('v');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function saveVideo(file) {
  const db = await idb(); const key = 'vid_' + uid();
  await new Promise((res, rej) => { const t = db.transaction('v', 'readwrite'); t.objectStore('v').put(file, key); t.oncomplete = res; t.onerror = () => rej(t.error); });
  return key;
}
export async function getVideoUrl(key) {
  const db = await idb();
  const blob = await new Promise((res, rej) => { const q = db.transaction('v').objectStore('v').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  return blob ? URL.createObjectURL(blob) : '';
}
