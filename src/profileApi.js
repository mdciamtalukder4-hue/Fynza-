// Profile v2 online data layer: details, friends list, highlights, professional mode, lock.
import { rest, signUrls } from './supabase.js';

const inList = (ids) => 'in.(' + ids.join(',') + ')';
const rpc = (name, body = {}) => rest('rpc/' + name, { method: 'POST', body });

export const REL = ['', 'Single', 'In a relationship', 'Engaged', 'Married', 'Complicated'];
export const VIS = [['public', 'Public'], ['friends', 'Friends'], ['me', 'Only me']];
export const PRO_CATS = ['Creator', 'Business', 'Artist', 'Educator', 'Public figure', 'Entrepreneur', 'Other'];

// profile flags (locked / professional mode); readable by anyone who can read the profile
export async function loadFlags(id) {
  const r = await rest(`profiles?select=locked,professional_mode,pro_category&id=eq.${id}`);
  const p = r[0] || {};
  return { locked: !!p.locked, pro: !!p.professional_mode, cat: p.pro_category || '' };
}
export async function setPro(meId, on, cat) {
  await rest('profiles?id=eq.' + meId, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { professional_mode: !!on, pro_category: on ? cat || '' : '' } });
}
export const setLock = (lock) => rpc('set_profile_lock', { p_lock: !!lock });

// details row: null when it does not exist or RLS hides it from this viewer
export async function loadDetails(id) {
  const r = await rest('profile_details?select=*&user_id=eq.' + id);
  return r[0] || null;
}
export function cleanWebsite(v) {
  v = (v || '').trim(); if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try { const u = new URL(v); if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null; return u.href; } catch (e) { return null; }
}
export async function saveDetails(meId, d) {
  const row = { user_id: meId, work: d.work.trim(), education: d.education.trim(), current_city: d.current_city.trim(), hometown: d.hometown.trim(), relationship: d.relationship, website: d.website, birthday: d.birthday || null, details_visibility: d.details_visibility, friends_visibility: d.friends_visibility };
  await rest('profile_details?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: row });
  return row;
}
export async function loadFriends(id) { return rpc('profile_friends', { p_user: id }); }

// ---- highlights ----
export async function loadHighlights(id) {
  const hs = await rest(`story_highlights?select=*&user_id=eq.${id}&order=created_at.desc`);
  if (!hs.length) return [];
  const items = await rest(`highlight_items?select=*&order=created_at.asc&highlight_id=${inList(hs.map((h) => h.id))}`);
  const paths = [...hs.map((h) => h.cover_url), ...items.map((i) => i.media_url)].filter(Boolean);
  const urls = paths.length ? await signUrls('stories', paths).catch(() => ({})) : {};
  return hs.map((h) => {
    const its = items.filter((i) => i.highlight_id === h.id).map((i) => ({ id: i.id, img: i.media_url ? urls[i.media_url] || '' : '', text: i.body || '', bg: i.bg || '' }));
    return { id: h.id, title: h.title, cover: h.cover_url ? urls[h.cover_url] || '' : '', items: its };
  });
}
export const addToHighlight = (storyId, highlightId, title) => rpc('add_story_to_highlight', { p_story: storyId, p_highlight: highlightId || null, p_title: title || '' });
export const renameHighlight = (id, title) => rest('story_highlights?id=eq.' + id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { title: title.trim().slice(0, 30) } });
export const deleteHighlight = (id) => rest('story_highlights?id=eq.' + id, { method: 'DELETE' });
export const deleteHighlightItem = (id) => rest('highlight_items?id=eq.' + id, { method: 'DELETE' });
