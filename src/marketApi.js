// Marketplace data layer (online only). Photos live in the private 'market' bucket as '<sellerId>/<file>'.
import { rest, uploadFile, signUrls, removeFiles } from './supabase.js';
import { sendReport, loadProfile, toUser } from './cloud.js';

export const CATEGORIES = ['Vehicles', 'Property', 'Electronics', 'Home & Garden', 'Clothing', 'Hobbies', 'Family', 'Services', 'Free stuff', 'Other'];
export const CONDITIONS = [['new', 'New'], ['like_new', 'Like new'], ['used', 'Used'], ['for_parts', 'For parts']];
export const MARKET_CURRENCIES = ['USD', 'EUR', 'GBP', 'BDT', 'INR', 'PKR', 'AED', 'CAD', 'AUD', 'JPY'];
export const condLabel = (c) => (CONDITIONS.find((x) => x[0] === c) || [0, c])[1];
export const MAX_PHOTOS = 8;
export const PAGE = 24;

export const exponent = (cur) => { try { return new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits; } catch (e) { return 2; } };
export const toMinor = (major, cur) => Math.round(Number(major) * 10 ** exponent(cur));
export const toMajor = (minor, cur) => Number(minor) / 10 ** exponent(cur);
export function fmtPrice(minor, cur) {
  if (Number(minor) === 0) return 'Free';
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: cur }).format(toMajor(minor, cur)); } catch (e) { return cur + ' ' + toMajor(minor, cur); }
}

const SEL = 'select=*';
const esc = (t) => encodeURIComponent(String(t).replace(/[*,()%\\]/g, ' ').trim());

export async function browse({ q = '', category = '', condition = '', currency = '', min = '', max = '', sort = 'new', offset = 0 } = {}) {
  let p = `listings?${SEL}&status=in.(active,sold)&limit=${PAGE}&offset=${offset}`;
  if (q.trim()) p += `&title=ilike.*${esc(q)}*`;
  if (category) p += '&category=eq.' + encodeURIComponent(category);
  if (condition) p += '&condition=eq.' + condition;
  if (currency) {
    p += '&currency=eq.' + currency;
    if (min !== '' && !isNaN(min)) p += '&price_minor=gte.' + toMinor(min, currency);
    if (max !== '' && !isNaN(max)) p += '&price_minor=lte.' + toMinor(max, currency);
  }
  p += sort === 'low' && currency ? '&order=price_minor.asc,created_at.desc' : sort === 'high' && currency ? '&order=price_minor.desc,created_at.desc' : '&order=created_at.desc';
  return rest(p);
}
export const getListing = async (id) => (await rest(`listings?${SEL}&id=eq.${id}`))[0] || null;
export const myListings = (meId) => rest(`listings?${SEL}&seller_id=eq.${meId}&order=created_at.desc&limit=100`);
export async function savedListings(meId) {
  const rows = await rest(`listing_saves?select=listing_id&user_id=eq.${meId}&order=created_at.desc&limit=100`);
  const ids = rows.map((r) => r.listing_id);
  if (!ids.length) return [];
  const ls = await rest(`listings?${SEL}&id=in.(${ids.join(',')})`);
  return ids.map((i) => ls.find((l) => l.id === i)).filter(Boolean);
}
export async function isSaved(meId, id) { return (await rest(`listing_saves?select=listing_id&user_id=eq.${meId}&listing_id=eq.${id}`)).length > 0; }
export const save = (meId, id) => rest('listing_saves?on_conflict=listing_id,user_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: { listing_id: id, user_id: meId } });
export const unsave = (meId, id) => rest(`listing_saves?user_id=eq.${meId}&listing_id=eq.${id}`, { method: 'DELETE' });

export async function sellerOf(id) { const p = await loadProfile(id); return p ? toUser(p) : null; }

// first photo of each listing -> signed URL map { path: url }
export async function thumbs(list) {
  const paths = list.map((l) => l.photos?.[0]).filter(Boolean);
  if (!paths.length) return {};
  try { return await signUrls('market', paths); } catch (e) { return {}; }
}
export async function photoUrls(paths) {
  if (!paths?.length) return [];
  try { const m = await signUrls('market', paths); return paths.map((p) => m[p]).filter(Boolean); } catch (e) { return []; }
}

const dataToBlob = async (d) => (await fetch(d)).blob();
// uploads compressed data-URL photos; returns the stored paths (rolls back uploaded files on failure)
export async function uploadPhotos(sellerId, dataUrls) {
  const done = [];
  try {
    for (const d of dataUrls) {
      const path = `${sellerId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      await uploadFile('market', path, await dataToBlob(d));
      done.push(path);
    }
  } catch (e) { if (done.length) await removeFiles('market', done); throw e; }
  return done;
}
export async function createListing(sellerId, f, photoDataUrls) {
  const photos = await uploadPhotos(sellerId, photoDataUrls);
  try {
    const r = await rest('listings', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { seller_id: sellerId, ...f, photos } });
    return r[0];
  } catch (e) { if (photos.length) await removeFiles('market', photos); throw e; }
}
// keep = existing paths still wanted, add = new data URLs
export async function updateListing(sellerId, old, f, keep, addData) {
  const added = await uploadPhotos(sellerId, addData);
  try {
    const r = await rest('listings?id=eq.' + old.id, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { ...f, photos: [...keep, ...added], updated_at: new Date().toISOString() } });
    if (!r?.length) throw new Error('Could not save changes.');
    const gone = (old.photos || []).filter((p) => !keep.includes(p));
    if (gone.length) removeFiles('market', gone);
    return r[0];
  } catch (e) { if (added.length) await removeFiles('market', added); throw e; }
}
export const setStatus = (id, status) => rest('listings?id=eq.' + id, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { status, updated_at: new Date().toISOString() } }).then((r) => r[0]);
export async function deleteListing(l) {
  await rest('listings?id=eq.' + l.id, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  if (l.photos?.length) await removeFiles('market', l.photos);
}
export const reportListing = (meId, id, reason) => sendReport(meId, 'listing', id, reason);
