// Online data layer (Phase 4): talks to Supabase through supabase.js and returns data shaped like the local store.
import { rest, uploadFile, removeFiles, signUrls, publicUrl } from './supabase.js';

const T = (s) => Date.parse(s) || Date.now();
const inList = (ids) => 'in.(' + ids.join(',') + ')';
export const toUser = (p, prev = {}) => ({
  id: p.id, name: p.name, username: p.username, bio: p.bio || '', avatar: p.avatar_url || '', cover: p.cover_url || '',
  email: prev.email || '', created: T(p.created_at), cloud: true, hash: '', role: p.role || prev.role || 'user', banned: !!p.banned, verified: !!p.verified, country: p.country || '',
});

export async function loadFeed(meId, limit = 30, extraIds = []) {
  const [page, sched] = await Promise.all([
    rest('posts?select=*&order=created_at.desc&limit=' + limit),
    rest(`posts?select=*&author_id=eq.${meId}&publish_at=not.is.null&order=publish_at.desc&limit=50`).catch(() => []),
  ]);
  const eff = (p) => T(p.publish_at || p.created_at);
  const seen = new Set();
  let posts = [...page, ...sched].filter((p) => !seen.has(p.id) && seen.add(p.id)).sort((x, y) => eff(y) - eff(x));
  const have = new Set(posts.map((p) => p.id));
  const need = [...new Set([...posts.map((p) => p.shared_post_id).filter(Boolean), ...extraIds])].filter((x) => !have.has(x));
  const extras = need.length ? await rest('posts?select=*&id=' + inList(need)).catch(() => []) : [];
  extras.forEach((p) => { p.__extra = true; });
  posts = [...posts, ...extras];
  const ids = posts.map((p) => p.id);
  const authorIds = [...new Set([meId, ...posts.map((p) => p.author_id)])];
  const [profiles, reactions, comments, saved, sharesRows] = await Promise.all([
    rest('profiles?select=*&id=' + inList(authorIds)),
    ids.length ? rest('post_reactions?select=post_id,user_id,type&post_id=' + inList(ids)) : [],
    ids.length ? rest('comments?select=*&order=created_at.asc&post_id=' + inList(ids)) : [],
    rest('saved_posts?select=post_id&user_id=eq.' + meId),
    ids.length ? rest('posts?select=shared_post_id&shared_post_id=' + inList(ids)).catch(() => []) : [],
  ]);
  const clikes = comments.length ? await rest('comment_likes?select=comment_id,user_id&comment_id=' + inList(comments.map((c) => c.id))).catch(() => []) : [];
  const commenters = [...new Set(comments.map((c) => c.author_id))].filter((x) => !authorIds.includes(x));
  const extra = commenters.length ? await rest('profiles?select=*&id=' + inList(commenters)) : [];
  const urls = await signUrls('posts', posts.map((p) => p.media_url).filter(Boolean)).catch(() => ({}));

  const rx = {}; reactions.forEach((r) => { (rx[r.post_id] ||= {})[r.user_id] = r.type; });
  const lk = {}; clikes.forEach((l) => { (lk[l.comment_id] ||= []).push(l.user_id); });
  const shares = {}; sharesRows.forEach((r) => { shares[r.shared_post_id] = (shares[r.shared_post_id] || 0) + 1; });
  const byPost = {}; comments.forEach((c) => (byPost[c.post_id] ||= []).push(c));
  const toC = (c) => ({ id: c.id, author: c.author_id, text: c.body, time: T(c.created_at), replies: [], likes: lk[c.id] || [] });
  const nest = (list = []) => {
    const top = list.filter((c) => !c.parent_id).map(toC);
    const map = Object.fromEntries(top.map((c) => [c.id, c]));
    list.filter((c) => c.parent_id && map[c.parent_id]).forEach((c) => map[c.parent_id].replies.push(toC(c)));
    return top;
  };
  return {
    users: [...profiles, ...extra],
    more: page.length >= limit,
    posts: posts.map((p) => ({
      id: p.id, author: p.author_id, text: p.body, time: eff(p), aud: p.audience, cloud: true, shareOf: p.shared_post_id || undefined,
      sched: p.publish_at && T(p.publish_at) > Date.now() ? T(p.publish_at) : undefined, extra: p.__extra || undefined, shares: shares[p.id] || 0,
      img: p.media_type === 'image' ? urls[p.media_url] || '' : '', videoUrl: p.media_type === 'video' ? urls[p.media_url] || '' : '',
      mediaPath: p.media_url, reactions: rx[p.id] || {}, comments: nest(byPost[p.id]), groupId: p.group_id || undefined, pageId: p.page_id || undefined,
    })),
    saved: saved.map((x) => x.post_id),
  };
}

const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const dataUrlToBlob = async (d) => (await fetch(d)).blob();
const ext = (type) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }[type] || 'bin');

export async function createPost(meId, { text, imgDataUrl, videoFile, aud, sharedId, groupId, pageId, publishAt }) {
  let media_url = '', media_type = '';
  if (imgDataUrl) {
    const b = await dataUrlToBlob(imgDataUrl); media_url = `${meId}/${rid()}.${ext(b.type)}`; media_type = 'image';
    await uploadFile('posts', media_url, b);
  } else if (videoFile) {
    media_url = `${meId}/${rid()}.${ext(videoFile.type)}`; media_type = 'video';
    await uploadFile('posts', media_url, videoFile);
  }
  try {
    await rest('posts', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { author_id: meId, body: text || '', media_url, media_type, audience: aud || 'public', shared_post_id: sharedId || null, group_id: groupId || null, page_id: pageId || null, ...(publishAt ? { publish_at: new Date(publishAt).toISOString() } : {}) } });
  } catch (e) { if (media_url) removeFiles('posts', [media_url]); throw e; }
}
export const deletePostOnline = async (post) => {
  await rest('posts?id=eq.' + post.id, { method: 'DELETE' });
  if (post.mediaPath) removeFiles('posts', [post.mediaPath]);
};
export const setReaction = (meId, postId, type) => type
  ? rest('post_reactions?on_conflict=post_id,user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: { post_id: postId, user_id: meId, type } })
  : rest(`post_reactions?post_id=eq.${postId}&user_id=eq.${meId}`, { method: 'DELETE' });
export const createComment = (meId, postId, text, parentId) =>
  rest('comments', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { post_id: postId, author_id: meId, body: text, parent_id: parentId || null } });
export const setSaved = (meId, postId, on) => on
  ? rest('saved_posts?on_conflict=user_id,post_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: { user_id: meId, post_id: postId } })
  : rest(`saved_posts?user_id=eq.${meId}&post_id=eq.${postId}`, { method: 'DELETE' });
export const sendReport = (meId, kind, target, reason) =>
  rest('reports', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { reporter_id: meId, kind, target_id: String(target), reason } })
    .catch((e) => { if (e.status === 409 || /duplicate key/i.test(e.message)) return; throw e; }); // already reported by me: fine
export const addBlockOnline = (meId, other) =>
  rest('blocks?on_conflict=blocker_id,blocked_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: { blocker_id: meId, blocked_id: other } });
export const removeBlockOnline = (meId, other) => rest(`blocks?blocker_id=eq.${meId}&blocked_id=eq.${other}`, { method: 'DELETE' });

export async function uploadProfileImage(meId, kind, dataUrl) {
  const b = await dataUrlToBlob(dataUrl); const bucket = kind === 'avatar' ? 'avatars' : 'covers';
  const path = `${meId}/${kind}-${Date.now()}.${ext(b.type)}`;
  await uploadFile(bucket, path, b);
  return publicUrl(bucket, path);
}
export async function patchProfile(meId, patch) {
  const rows = await rest('profiles?id=eq.' + meId, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: patch });
  if (!rows?.length) throw new Error('Profile could not be saved.');
  return rows[0];
}
export async function searchProfiles(term) {
  const t = term.replace(/[%*,()\\]/g, '').trim(); if (t.length < 1) return [];
  const [a, b] = await Promise.all([
    rest(`profiles?select=*&username=ilike.*${encodeURIComponent(t)}*&limit=20`),
    rest(`profiles?select=*&name=ilike.*${encodeURIComponent(t)}*&limit=20`),
  ]);
  const seen = new Set(); return [...a, ...b].filter((p) => !seen.has(p.id) && seen.add(p.id));
}
export async function loadProfile(id) {
  const rows = await rest('profiles?select=*&id=eq.' + id); return rows[0] || null;
}

// ---------- Phase 5: friends, follows, notifications, visitors, settings, blocks ----------
const settingsFromRow = (r) => r && ({ recordMyVisits: r.record_my_visits, keepVisitors: r.keep_visitors, autoDeleteDays: r.auto_delete_days, whoCanMessage: r.who_can_message, postAudience: r.post_audience, showLastSeen: r.show_last_seen !== false, showReadReceipts: r.show_read_receipts !== false });
const settingsToRow = { recordMyVisits: 'record_my_visits', keepVisitors: 'keep_visitors', autoDeleteDays: 'auto_delete_days', whoCanMessage: 'who_can_message', postAudience: 'post_audience', showLastSeen: 'show_last_seen', showReadReceipts: 'show_read_receipts' };

export async function loadSocial(meId) {
  const [fr, fol, notes, visits, st, blocks, me] = await Promise.all([
    rest('friendships?select=*'),
    rest(`follows?select=follower_id,following_id&follower_id=eq.${meId}`),
    rest('notifications?select=*&order=created_at.desc&limit=60'),
    rest('rpc/my_visitors', { method: 'POST', body: {} }),
    rest('user_settings?select=*&user_id=eq.' + meId),
    rest('blocks?select=blocker_id,blocked_id&blocker_id=eq.' + meId),
    rest('profiles?select=is_public,banned,role&id=eq.' + meId),
  ]);
  const followers = await rest(`follows?select=follower_id,following_id&following_id=eq.${meId}`);
  const ids = new Set();
  fr.forEach((f) => { ids.add(f.requester_id); ids.add(f.addressee_id); });
  followers.forEach((f) => ids.add(f.follower_id)); fol.forEach((f) => ids.add(f.following_id));
  notes.forEach((n) => n.actor_id && ids.add(n.actor_id)); visits.forEach((v) => ids.add(v.visitor_id));
  blocks.forEach((b) => ids.add(b.blocked_id)); ids.delete(meId);
  const profiles = ids.size ? await rest('profiles?select=*&id=' + inList([...ids])) : [];
  return {
    profiles,
    friends: fr.filter((f) => f.status === 'accepted').map((f) => [f.requester_id, f.addressee_id]),
    requests: fr.filter((f) => f.status === 'pending').map((f) => ({ from: f.requester_id, to: f.addressee_id, time: T(f.created_at) })),
    follows: [...fol, ...followers].map((f) => [f.follower_id, f.following_id]),
    notifs: notes.map((n) => ({ id: n.id, to: meId, type: n.type, from: n.actor_id, postId: n.post_id, time: T(n.created_at), read: n.read })),
    visits: visits.map((v) => ({ id: v.id, profile: meId, visitor: v.visitor_id, time: T(v.visited_at) })),
    blocks: blocks.map((b) => [b.blocker_id, b.blocked_id]),
    settings: { ...settingsFromRow(st[0]), profilePublic: me[0] ? me[0].is_public : true },
    self: { banned: !!me[0]?.banned, role: me[0]?.role || 'user' },
  };
}
export const requestFriend = (meId, to) => rest('friendships', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { requester_id: meId, addressee_id: to, status: 'pending' } });
export const acceptFriend = (meId, from) => rest(`friendships?requester_id=eq.${from}&addressee_id=eq.${meId}&status=eq.pending`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { status: 'accepted' } })
  .then((rows) => { if (!rows?.length) throw new Error('This request no longer exists.'); });
export async function removeFriendship(meId, other) {
  await rest(`friendships?requester_id=eq.${meId}&addressee_id=eq.${other}`, { method: 'DELETE' });
  await rest(`friendships?requester_id=eq.${other}&addressee_id=eq.${meId}`, { method: 'DELETE' });
}
export const followOnline = (meId, id, on) => on
  ? rest('follows?on_conflict=follower_id,following_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: { follower_id: meId, following_id: id } })
  : rest(`follows?follower_id=eq.${meId}&following_id=eq.${id}`, { method: 'DELETE' });
export const followersOf = (id) => rest(`follows?select=follower_id,following_id&following_id=eq.${id}`);
export const markRead = (meId) => rest(`notifications?user_id=eq.${meId}&read=eq.false`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { read: true } });
export const visit = (profileId) => rest('rpc/record_visit', { method: 'POST', body: { p_profile: profileId } });
export const deleteVisit = (id) => rest('profile_visits?id=eq.' + id, { method: 'DELETE' });
export const clearVisitsOnline = (meId) => rest('profile_visits?profile_id=eq.' + meId, { method: 'DELETE' });
export async function saveSettings(meId, patch) {
  const row = {}; for (const [k, v] of Object.entries(patch)) if (settingsToRow[k]) row[settingsToRow[k]] = v;
  if (Object.keys(row).length) await rest('user_settings?user_id=eq.' + meId, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: row });
  if ('profilePublic' in patch) await rest('profiles?id=eq.' + meId, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { is_public: !!patch.profilePublic } });
}
export const newestProfiles = (meId) => rest(`profiles?select=*&id=neq.${meId}&order=created_at.desc&limit=30`);

// ---------- Phase 6: stories and reels ----------
export async function loadMedia() {
  const [stories, reels] = await Promise.all([
    rest('stories?select=*&order=created_at.desc&limit=60'),
    rest('reels?select=*&order=created_at.desc&limit=30'),
  ]);
  const rids = reels.map((r) => r.id);
  const [rx, rcm, rsh] = rids.length ? await Promise.all([
    rest('reel_reactions?select=reel_id,user_id,type&reel_id=' + inList(rids)),
    rest('reel_comments?select=id,reel_id,author_id,parent_id,body,created_at&order=created_at.asc&limit=1000&reel_id=' + inList(rids)),
    rest('reel_shares?select=reel_id&limit=2000&reel_id=' + inList(rids)),
  ]) : [[], [], []];
  const [sUrls, rUrls] = await Promise.all([
    signUrls('stories', stories.map((x) => x.media_url).filter(Boolean)).catch(() => ({})),
    signUrls('reels', reels.map((x) => x.video_url)).catch(() => ({})),
  ]);
  const authors = [...new Set([...stories.map((x) => x.author_id), ...reels.map((x) => x.author_id), ...rcm.map((x) => x.author_id)])];
  const profiles = authors.length ? await rest('profiles?select=*&id=' + inList(authors)) : [];
  const rxm = {}; rx.forEach((l) => { (rxm[l.reel_id] ||= {})[l.user_id] = l.type; });
  const cm = {}; rcm.filter((c) => !c.parent_id).forEach((c) => { (cm[c.reel_id] ||= []).push({ id: c.id, author: c.author_id, text: c.body, time: T(c.created_at), replies: [] }); });
  rcm.filter((c) => c.parent_id).forEach((c) => { const par = (cm[c.reel_id] || []).find((x) => x.id === c.parent_id); if (par) par.replies.push({ id: c.id, author: c.author_id, text: c.body, time: T(c.created_at) }); });
  const shn = {}; rsh.forEach((x) => { shn[x.reel_id] = (shn[x.reel_id] || 0) + 1; });
  return {
    profiles,
    stories: stories.map((x) => ({ id: x.id, author: x.author_id, text: x.body, img: x.media_url ? sUrls[x.media_url] || '' : '', bg: x.bg, time: T(x.created_at), cloud: true, mediaPath: x.media_url })),
    reels: reels.map((x) => ({ id: x.id, author: x.author_id, videoUrl: rUrls[x.video_url] || '', videoPath: x.video_url, caption: x.caption, time: T(x.created_at), reactions: rxm[x.id] || {}, likes: Object.keys(rxm[x.id] || {}), comments: cm[x.id] || [], shares: shn[x.id] || 0, cloud: true })),
  };
}
export async function createStory(meId, { text, imgDataUrl, bg }) {
  let media_url = '';
  if (imgDataUrl) { const b = await dataUrlToBlob(imgDataUrl); media_url = `${meId}/${rid()}.${ext(b.type)}`; await uploadFile('stories', media_url, b); }
  try { await rest('stories', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { author_id: meId, body: text || '', media_url, bg: imgDataUrl ? '' : bg || '' } }); }
  catch (e) { if (media_url) removeFiles('stories', [media_url]); throw e; }
}
export const deleteStoryOnline = async (st) => { await rest('stories?id=eq.' + st.id, { method: 'DELETE' }); if (st.mediaPath) removeFiles('stories', [st.mediaPath]); };
export async function createReel(meId, file, caption) {
  const path = `${meId}/${rid()}.${ext(file.type)}`; await uploadFile('reels', path, file);
  try { await rest('reels', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { author_id: meId, video_url: path, caption: caption || '' } }); }
  catch (e) { removeFiles('reels', [path]); throw e; }
}
export const deleteReelOnline = async (r) => { await rest('reels?id=eq.' + r.id, { method: 'DELETE' }); if (r.videoPath) removeFiles('reels', [r.videoPath]); };
export const setReelReaction = (meId, id, type) => type
  ? rest('reel_reactions?on_conflict=reel_id,user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: { reel_id: id, user_id: meId, type } })
  : rest(`reel_reactions?reel_id=eq.${id}&user_id=eq.${meId}`, { method: 'DELETE' });
export const createReelComment = (meId, reelId, text, parentId) => rest('reel_comments', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { reel_id: reelId, author_id: meId, body: text, parent_id: parentId || null } });
export const deleteReelCommentOnline = (id) => rest('reel_comments?id=eq.' + id, { method: 'DELETE' });
export const recordReelShare = (meId, reelId) => rest('reel_shares', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { reel_id: reelId, user_id: meId } });

// ---------- Phase 7/10: messenger (polling; see README) ----------
export async function loadChats(meId) {
  const [convs, members, msgs, rxRows] = await Promise.all([
    rest('conversations?select=*'),
    rest('conversation_members?select=conversation_id,user_id,last_read_at,last_delivered_at'),
    rest('messages?select=*&order=created_at.desc&limit=400'),
    rest('message_reactions?select=message_id,user_id,emoji&order=created_at.desc&limit=1500').catch(() => []),
  ]);
  const urls = await signUrls('chat', msgs.map((m) => m.media_url).filter(Boolean)).catch(() => ({}));
  const ids = [...new Set(members.map((m) => m.user_id))].filter((x) => x !== meId);
  const profiles = ids.length ? await rest('profiles?select=*&id=' + inList(ids)) : [];
  const rx = {}; rxRows.forEach((r) => { (rx[r.message_id] ||= {})[r.user_id] = r.emoji; });
  const by = {};
  msgs.reverse().forEach((m) => {
    const kind = m.kind === 'text' && m.media_url ? 'image' : (m.kind || 'text');
    const url = m.media_url ? urls[m.media_url] || '' : '';
    (by[m.conversation_id] ||= []).push({
      id: m.id, from: m.sender_id, text: m.body, kind, url, img: kind === 'image' ? url : '', fileName: m.file_name || '', duration: m.duration || 0,
      reply: m.reply_to || '', edited: !!m.edited_at, deleted: !!m.deleted_at, rx: rx[m.id] || {}, time: T(m.created_at),
    });
  });
  const mem = {}; const reads = {};
  members.forEach((m) => { (mem[m.conversation_id] ||= []).push(m.user_id); (reads[m.conversation_id] ||= {})[m.user_id] = { read: T(m.last_read_at), deliv: T(m.last_delivered_at) }; });
  const chats = convs.map((c) => ({ id: c.id, members: mem[c.id] || [meId], group: c.is_group, title: c.title, msgs: by[c.id] || [], reads: reads[c.id] || {}, cloud: true, created: T(c.created_at) }));
  chats.sort((a, b) => (b.msgs.at(-1)?.time || b.created) - (a.msgs.at(-1)?.time || a.created));
  return { profiles, chats };
}
const rpcId = (r) => (Array.isArray(r) ? Object.values(r[0] || {})[0] : r);
export const startChat = (otherId) => rest('rpc/start_chat', { method: 'POST', body: { p_other: otherId } }).then(rpcId);
export const makeGroupChat = (title, members) => rest('rpc/create_group_chat', { method: 'POST', body: { p_title: title, p_members: members } }).then(rpcId);
const rpc = (name, body = {}) => rest('rpc/' + name, { method: 'POST', body });
const fileExt = (n = '') => (/\.([a-z0-9]{1,8})$/i.exec(n)?.[1] || 'bin').toLowerCase();
const mediaExt = (b, name) => (b.type.startsWith('audio/') ? (b.type.includes('mp4') ? 'm4a' : b.type.includes('ogg') ? 'ogg' : 'webm') : name ? fileExt(name) : ext(b.type));
// o: { text, kind: text|image|video|file|voice|sticker, dataUrl | blob, fileName, duration, replyTo }
export async function sendChatMessage(meId, convId, o) {
  let media_url = '';
  const blob = o.blob || (o.dataUrl ? await dataUrlToBlob(o.dataUrl) : null);
  if (blob) {
    if (blob.size > 25 * 1024 * 1024) throw new Error('File is larger than 25 MB.');
    media_url = `${meId}/${rid()}.${mediaExt(blob, o.fileName)}`; await uploadFile('chat', media_url, blob);
  }
  const kind = o.kind || (blob ? 'image' : 'text');
  try {
    await rest('messages', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: {
      conversation_id: convId, sender_id: meId, body: o.text || '', media_url, kind, file_name: o.fileName || '', duration: Math.round(o.duration || 0), ...(o.replyTo ? { reply_to: o.replyTo } : {}),
    } });
  } catch (e) { if (media_url) removeFiles('chat', [media_url]); throw e; }
}
export const editMessage = (id, body) => rpc('edit_message', { p_id: id, p_body: body });
export const deleteMessage = (id) => rpc('delete_message', { p_id: id });
export async function reactMessage(meId, id, emoji) {
  await rest(`message_reactions?message_id=eq.${id}&user_id=eq.${meId}`, { method: 'DELETE' });
  if (emoji) await rest('message_reactions', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { message_id: id, user_id: meId, emoji } });
}
export const markChatRead = (convId) => rpc('mark_chat_read', { p_conv: convId });
export const markDelivered = () => rpc('mark_delivered');
export const leaveChat = (convId) => rpc('leave_chat', { p_conv: convId });
export const sendTyping = (convId) => rpc('set_typing', { p_conv: convId });
export const loadTyping = () => rest('typing?select=conversation_id,user_id');
export const touchPresence = () => rpc('touch_presence');
export const loadPresence = (ids) => (ids.length ? rpc('get_presence', { p_ids: ids }) : Promise.resolve([]));
// calls
export const startCall = (convId, kind) => rpc('start_call', { p_conv: convId, p_kind: kind }).then(rpcId);
export const setCallStatus = (id, status) => rpc('set_call_status', { p_id: id, p_status: status });
export const getCall = (id) => rest('calls?select=*&id=eq.' + id).then((r) => r[0] || null);
export const incomingCalls = (meId) => rest(`calls?select=*&callee_id=eq.${meId}&status=eq.ringing&created_at=gt.${encodeURIComponent(new Date(Date.now() - 40000).toISOString())}&order=created_at.desc&limit=1`);
export const sendSignal = (meId, callId, toId, type, payload) => rest('call_signals', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { call_id: callId, from_id: meId, to_id: toId, type, payload } });
export const loadSignals = (callId, after) => rest(`call_signals?select=id,type,payload,from_id&call_id=eq.${callId}&id=gt.${after}&order=id.asc`);

// ---------- Phase 8: groups and pages ----------
export async function loadGroups() {
  const [groups, members, pages, followers] = await Promise.all([
    rest('groups?select=*&order=created_at.desc'), rest('group_members?select=group_id,user_id,role'),
    rest('pages?select=*&order=created_at.desc'), rest('page_followers?select=page_id,user_id'),
  ]);
  const ids = new Set([...groups.map((g) => g.owner_id), ...pages.map((p) => p.owner_id), ...members.map((m) => m.user_id)]);
  const profiles = ids.size ? await rest('profiles?select=*&id=' + inList([...ids].slice(0, 150))) : [];
  const gm = {}; members.forEach((m) => { (gm[m.group_id] ||= []).push(m.user_id); });
  const pf = {}; followers.forEach((f) => { (pf[f.page_id] ||= []).push(f.user_id); });
  return {
    profiles,
    groups: groups.map((g) => ({ id: g.id, name: g.name, desc: g.description, privacy: g.privacy, owner: g.owner_id, members: gm[g.id] || [], cloud: true })),
    pages: pages.map((p) => ({ id: p.id, name: p.name, kind: p.kind, desc: p.description, owner: p.owner_id, followers: pf[p.id] || [], verified: !!p.verified, cloud: true })),
  };
}
export const makeGroup = (meId, name, desc, privacy) => rest('groups', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { owner_id: meId, name, description: desc, privacy } });
export const joinGroupOnline = (meId, id) => rest('group_members', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { group_id: id, user_id: meId, role: 'member' } });
export const leaveGroupOnline = (meId, id) => rest(`group_members?group_id=eq.${id}&user_id=eq.${meId}`, { method: 'DELETE' });
export const addGroupMember = (groupId, userId) => rest('rpc/add_group_member', { method: 'POST', body: { p_group: groupId, p_user: userId } });
export const makePage = (meId, name, kind, desc) => rest('pages', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { owner_id: meId, name, kind, description: desc } });
export const followPageOnline = (meId, id, on) => on
  ? rest('page_followers?on_conflict=page_id,user_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: { page_id: id, user_id: meId } })
  : rest(`page_followers?page_id=eq.${id}&user_id=eq.${meId}`, { method: 'DELETE' });

// ---------- Phase 9: admin (all checks are enforced by the database, not by this app) ----------
export const adminStats = () => rest('rpc/admin_stats', { method: 'POST', body: {} }).then((r) => (Array.isArray(r) ? r[0] : r));
export const adminReports = (status) => rest('rpc/admin_reports', { method: 'POST', body: { p_status: status, p_limit: 60 } });
export const adminResolve = (id, status, note) => rest('rpc/admin_resolve_report', { method: 'POST', body: { p_id: id, p_status: status, p_note: note || '' } });
export const adminRemove = (kind, target, note) => rest('rpc/admin_remove_content', { method: 'POST', body: { p_kind: kind, p_target: String(target), p_note: note || '' } });
export const adminBan = (user, banned, note) => rest('rpc/admin_set_ban', { method: 'POST', body: { p_user: user, p_banned: banned, p_note: note || '' } });
export const adminUsers = (q) => rest('rpc/admin_users', { method: 'POST', body: { p_q: q || '' } });
export const adminLog = () => rest('admin_actions?select=*&order=created_at.desc&limit=40');


// ---------- Phase 10: security, verification, ads, creators (payments stay disabled) ----------
const rpcP = (fn, body = {}) => rest('rpc/' + fn, { method: 'POST', body });
export const paymentOptions = (country, direction = 'pay') => rpcP('payment_options', { p_country: country || null, p_direction: direction });
export const verifiedPlans = () => rest('verified_plans?select=*&active=eq.true');
export const myVerification = () => rest('verification_applications?select=id,page_id,status,full_name,doc_type,admin_note,created_at&order=created_at.desc&limit=10');
export const submitVerification = (o) => rpcP('submit_verification', { p_page: o.page || null, p_full_name: o.fullName, p_doc_type: o.docType, p_doc_path: o.docPath, p_selfie_path: o.selfiePath, p_country: o.country || null });
export const startVerifiedSubscription = (app, method, currency) => rpcP('start_verified_subscription', { p_app: app, p_method: method, p_currency: currency });
export const setMyCountry = (meId, country) => rest('profiles?id=eq.' + meId, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { country: country || null } });
export const mySecurityEvents = () => rest('security_events?select=kind,device,created_at&order=created_at.desc&limit=15');
export const exportMyData = () => rpcP('export_my_data');
export const deleteMyAccount = () => rpcP('delete_my_account');
// ads
export const myCampaigns = () => rest('ad_campaigns?select=*&order=created_at.desc');
export const createCampaign = (o) => rpcP('create_campaign', { p_name: o.name, p_objective: o.objective, p_headline: o.headline, p_body: o.body, p_link: o.link, p_currency: o.currency, p_budget_minor: o.budget, p_daily_minor: o.daily, p_start: o.start || null, p_end: o.end || null, p_targeting: o.targeting || {}, p_page: o.page || null });
export const submitCampaign = (id) => rpcP('submit_campaign_for_review', { p_id: id });
export const activateCampaign = (id) => rpcP('activate_campaign', { p_id: id });
export const deleteCampaign = (id) => rest('ad_campaigns?id=eq.' + id, { method: 'DELETE' });
export const campaignStats = (id) => rpcP('campaign_stats', { p_id: id }).then((r) => (Array.isArray(r) ? r[0] : r));
export const feedAds = (country) => rpcP('feed_ads', { p_country: country || null });
export const pageAnalytics = (id) => rpcP('page_analytics', { p_page: id }).then((r) => (Array.isArray(r) ? r[0] : r));
// creators
export const creatorEligibility = () => rpcP('creator_eligibility');
export const applyCreator = () => rpcP('apply_creator');
export const myCreatorApp = () => rest('creator_applications?select=*');
export const creatorSummary = () => rpcP('creator_summary').then((r) => (Array.isArray(r) ? r[0] : r));
export const myEarnings = () => rest('earnings_ledger?select=*&order=created_at.desc&limit=50');
export const myWithdrawals = () => rest('withdrawals?select=*&order=created_at.desc&limit=50');
export const giftCatalog = () => rest('gift_catalog?select=*');
export const requestWithdrawal = (m, a, c) => rpcP('request_withdrawal', { p_method: m, p_amount_minor: a, p_currency: c });
export const buyStars = (m, n) => rpcP('buy_stars', { p_method: m, p_stars: n });
// admin
export const adminSetPayment = (id, on) => rpcP('admin_set_payment_method', { p_id: id, p_enabled: on });
export const adminUpsertPlan = (cur, amt) => rpcP('admin_upsert_plan', { p_currency: cur, p_amount_minor: amt, p_active: true });
export const adminSetSetting = (k, v) => rpcP('admin_set_setting', { p_key: k, p_value: v });
export const adminVerifications = (status) => rpcP('admin_verifications', { p_status: status });
export const adminReviewVerification = (id, ok, note) => rpcP('admin_review_verification', { p_id: id, p_approve: ok, p_note: note || '' });
export const adminGrantBadge = (user, page, reason) => rpcP('admin_grant_badge', { p_user: user || null, p_page: page || null, p_reason: reason });
export const adminRevokeBadge = (user, page, reason) => rpcP('admin_revoke_badge', { p_user: user || null, p_page: page || null, p_reason: reason });
export const adminBadgeHistory = () => rpcP('admin_badge_history');
export const adminCases = (status) => rpcP('admin_cases', { p_status: status });
export const adminDecideCase = (id, action, message, note) => rpcP('admin_decide_case', { p_id: id, p_decision: action, p_message: message || '', p_note: note || '' });
export const adminSuspicious = () => rpcP('admin_suspicious_accounts');
export const adminSecuritySummary = () => rpcP('admin_security_summary');
export const adminAds = (status) => rpcP('admin_ad_campaigns', { p_status: status });
export const adminReviewAd = (id, ok, reason) => rpcP('admin_review_campaign', { p_id: id, p_approve: ok, p_reason: reason || '' });
export const adminCreatorApps = (status) => rpcP('admin_creator_applications', { p_status: status });
export const adminReviewCreator = (u, ok, note) => rpcP('admin_review_creator', { p_user: u, p_approve: ok, p_note: note || '' });
export const adminPaymentMethods = () => rest('payment_methods?select=*&order=sort.asc');
export const adminSettings = () => rest('app_settings?select=key,value');
export const adminWarnings = () => rpcP('admin_warnings');

// ---------- feed v2 ----------
export const publishPostNow = (id) => rest('posts?id=eq.' + id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { publish_at: null } });
export const deleteCommentOnline = (id) => rest('comments?id=eq.' + id, { method: 'DELETE' });
export const setCommentLike = (meId, cid, on) => on
  ? rest('comment_likes', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { comment_id: cid, user_id: meId } }).catch((e) => { if (e.status === 409 || /duplicate key/i.test(e.message)) return; throw e; })
  : rest(`comment_likes?comment_id=eq.${cid}&user_id=eq.${meId}`, { method: 'DELETE' });
export const profilesByIds = (ids) => ids.length ? rest('profiles?select=*&id=' + inList(ids)) : Promise.resolve([]);
export const setProfileLock = (lock) => rest('rpc/set_profile_lock', { method: 'POST', body: { p_lock: !!lock } });
