// Groups v2 API (online mode). All calls go through Supabase RPC / REST.
import { rest } from './supabase.js';
import { uploadProfileImage } from './cloud.js';

const rpc = (fn, body = {}) => rest('rpc/' + fn, { method: 'POST', body });
const one = (r) => (Array.isArray(r) ? r[0] : r);

export function friendlyError(e) {
  const m = String((e && e.message) || e || '');
  if (/only friends/i.test(m)) return 'You can only add your friends.';
  if (/muted/i.test(m)) return 'You are muted in this group.';
  if (/banned/i.test(m)) return 'You are banned from this group.';
  if (/not allowed|permission|denied|row-level|forbidden|insufficient/i.test(m)) return 'You do not have permission to do that.';
  if (/already/i.test(m)) return 'Already done.';
  if (/not found/i.test(m)) return 'Group or member not found.';
  return m.replace(/^.*?(P0001|ERROR:)\s*/, '') || 'Something went wrong.';
}
export const wrap = async (fn) => { try { return { data: await fn() }; } catch (e) { return { error: friendlyError(e) }; } };

export const listGroups = (scope) => rpc('list_groups', { p_scope: scope }).then((r) => r || []);
export const groupDetail = (id) => rpc('group_detail', { p_group: id }).then(one);
export const requestJoin = (id, msg) => rpc('request_join_group', { p_group: id, p_message: msg || null });
export const cancelJoin = (id) => rpc('cancel_join_request', { p_group: id });
export const decideRequest = (reqId, ok) => rpc('decide_join_request', { p_request: reqId, p_approve: ok });
export const setRole = (g, u, role) => rpc('set_member_role', { p_group: g, p_user: u, p_role: role });
export const removeMember = (g, u, ban) => rpc('remove_group_member', { p_group: g, p_user: u, p_ban: !!ban });
export const unban = (g, u) => rpc('unban_group_member', { p_group: g, p_user: u });
export const muteMember = (g, u, hours) => rpc('mute_group_member', { p_group: g, p_user: u, p_hours: hours });
export const leave = (g) => rpc('leave_group', { p_group: g });
export const deletePost = (p) => rpc('delete_group_post', { p_post: p });
export const pinPost = (p, on) => rpc('pin_group_post', { p_post: p, p_pinned: on });
export const addMember = (g, u) => rpc('add_group_member', { p_group: g, p_user: u });
export const updateGroup = (g, o) => rpc('update_group', {
  p_group: g, p_name: o.name ?? null, p_description: o.description ?? null, p_rules: o.rules ?? null,
  p_privacy: o.privacy ?? null, p_cover: o.cover ?? null, p_avatar: o.avatar ?? null, p_approval: o.approval ?? null,
});
export const deleteGroup = (g) => rest('groups?id=eq.' + g, { method: 'DELETE' });

export const uploadGroupImage = (meId, kind, dataUrl) => uploadProfileImage(meId, kind, dataUrl);

export async function createGroup(meId, o) {
  const body = { owner_id: meId, name: o.name, description: o.description || '', privacy: o.privacy };
  if (o.rules) body.rules = o.rules;
  if (o.coverDataUrl) body.cover_url = await uploadGroupImage(meId, 'cover', o.coverDataUrl);
  const rows = await rest('groups', { method: 'POST', headers: { Prefer: 'return=representation' }, body });
  return one(rows)?.id;
}

export const groupMembers = (g) => rest(`group_members?select=user_id,role,joined_at,muted_until&group_id=eq.${g}&order=joined_at.asc`);
export const pendingRequests = (groupIds) => (groupIds.length
  ? rest(`group_join_requests?select=*&status=eq.pending&group_id=in.(${groupIds.join(',')})&order=created_at.desc`) : Promise.resolve([]));
export const pendingForGroup = (g) => pendingRequests([g]);
export const pinnedIds = (g) => rest(`posts?select=id&group_id=eq.${g}&pinned_in_group=eq.true`).then((r) => (r || []).map((x) => x.id));
export const bans = (g) => rest(`group_bans?select=user_id&group_id=eq.${g}`).catch(() => []);
export async function profilesById(ids) {
  const u = [...new Set(ids)].filter(Boolean); if (!u.length) return {};
  const rows = await rest(`profiles?select=id,name,username,avatar_url&id=in.(${u.join(',')})`).catch(() => []);
  const o = {}; (rows || []).forEach((p) => { o[p.id] = { id: p.id, name: p.name, username: p.username, avatar: p.avatar_url || '' }; });
  return o;
}
