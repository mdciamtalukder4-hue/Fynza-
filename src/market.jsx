import { useCallback, useEffect, useRef, useState } from 'react';
import { IoAdd, IoSearch, IoBookmark, IoBookmarkOutline, IoChevronBack, IoChevronForward, IoChatbubbleEllipses, IoFlag, IoLinkOutline, IoImageOutline, IoClose, IoOptions, IoShieldCheckmark } from 'react-icons/io5';
import { useStore, me, compressImage, openChatOnline } from './store.js';
import { Avatar, Sheet, Empty, LocalNote, Badge, toast, go, useHash } from './ui.jsx';
import { Head } from './more.jsx';
import * as api from './marketApi.js';

const msg = (e) => (e && e.message) || 'Something went wrong. Please try again.';

function Safety() {
  return <div className="mk-safety"><IoShieldCheckmark size={18} /><span>Meet in public places. FYNZA does not process payments.</span></div>;
}

function Card({ l, url }) {
  return (
    <a className="mk-card" href={'#/market/' + l.id}>
      <div className="mk-img">
        {url ? <img src={url} alt="" loading="lazy" /> : <span className="mk-noimg"><IoImageOutline size={30} /></span>}
        {l.status === 'sold' && <span className="mk-ribbon">SOLD</span>}
        {l.status === 'hidden' && <span className="mk-ribbon hid">HIDDEN</span>}
      </div>
      <div className="mk-info"><b className="mk-price">{api.fmtPrice(l.price_minor, l.currency)}</b><span className="mk-title">{l.title}</span><small className="muted">{l.location || ' '}</small></div>
    </a>
  );
}
function Grid({ items, urls }) {
  return <div className="mk-grid">{items.map((l) => <Card key={l.id} l={l} url={urls[l.photos?.[0]]} />)}</div>;
}

// ---------------- browse ----------------
const F0 = { q: '', category: '', condition: '', currency: '', min: '', max: '', sort: 'new' };
function Browse() {
  const [f, setF] = useState(F0);
  const [applied, setApplied] = useState(F0);
  const [items, setItems] = useState([]);
  const [urls, setUrls] = useState({});
  const [busy, setBusy] = useState(true);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (flt, append, off) => {
    const my = ++seq.current;
    setBusy(true); setErr('');
    try {
      const rows = await api.browse({ ...flt, offset: off });
      const t = await api.thumbs(rows);
      if (my !== seq.current) return;
      setItems((p) => (append ? [...p, ...rows] : rows)); setUrls((p) => ({ ...p, ...t })); setMore(rows.length === api.PAGE);
    } catch (e) { if (my === seq.current) setErr(msg(e)); }
    if (my === seq.current) setBusy(false);
  }, []);
  useEffect(() => { load(applied, false, 0); }, [applied, load]);
  useEffect(() => { const t = setTimeout(() => setApplied((a) => (a.q === f.q ? a : { ...a, q: f.q })), 350); return () => clearTimeout(t); }, [f.q]);
  const apply = (patch) => { const n = { ...f, ...patch }; setF(n); setApplied(n); };

  return (
    <>
      <div className="mk-bar">
        <label className="mk-search"><IoSearch /><input className="input" type="search" placeholder="Search marketplace" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></label>
        <button className="icon-btn" aria-label="Filters" onClick={() => setOpen(true)}><IoOptions size={22} /></button>
      </div>
      <div className="mk-chips" role="tablist">
        {['', ...api.CATEGORIES].map((c) => <button key={c} className={'mk-chip' + (f.category === c ? ' on' : '')} onClick={() => apply({ category: c })}>{c || 'All'}</button>)}
      </div>
      <Safety />
      {err && <div className="local-note">{err} <button className="link-btn" onClick={() => load(applied, false, 0)}>Retry</button></div>}
      {!busy && !err && !items.length && <Empty title="No listings found" text="Try a different search or filter, or sell something yourself."><a className="btn primary" href="#/market/new"><IoAdd /> Sell an item</a></Empty>}
      <Grid items={items} urls={urls} />
      {busy && <p className="muted" style={{ textAlign: 'center' }}>Loading…</p>}
      {more && !busy && <button className="btn ghost" style={{ margin: '12px auto', display: 'flex' }} onClick={() => load(applied, true, items.length)}>Load more</button>}
      {open && (
        <Sheet title="Filters" onClose={() => setOpen(false)}>
          <div className="mk-form">
            <label>Sort<select className="input" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })}>
              <option value="new">Newest first</option>{f.currency && <><option value="low">Price: low to high</option><option value="high">Price: high to low</option></>}</select></label>
            <label>Condition<select className="input" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })}><option value="">Any</option>{api.CONDITIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Price currency<select className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value, ...(e.target.value ? {} : { min: '', max: '', sort: 'new' }) })}><option value="">Any (no price filter)</option>{api.MARKET_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
            {f.currency && <div className="mk-row"><label>Min<input className="input" inputMode="decimal" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></label><label>Max<input className="input" inputMode="decimal" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} /></label></div>}
            <div className="mk-row"><button className="btn ghost" onClick={() => { setF(F0); setApplied(F0); setOpen(false); }}>Reset</button><button className="btn primary" onClick={() => { setApplied({ ...f }); setOpen(false); }}>Apply</button></div>
          </div>
        </Sheet>
      )}
    </>
  );
}

// ---------------- create / edit form ----------------
function ListingForm({ user, initial, onDone, onCancel }) {
  const ed = !!initial;
  const [t, setT] = useState(initial?.title || '');
  const [cur, setCur] = useState(initial?.currency || 'USD');
  const [price, setPrice] = useState(initial ? String(api.toMajor(initial.price_minor, initial.currency)) : '');
  const [cat, setCat] = useState(initial?.category || 'Other');
  const [cond, setCond] = useState(initial?.condition || 'used');
  const [loc, setLoc] = useState(initial?.location || '');
  const [desc, setDesc] = useState(initial?.description || '');
  const [keep, setKeep] = useState(initial?.photos || []);
  const [keepUrls, setKeepUrls] = useState({});
  const [add, setAdd] = useState([]);
  const [busy, setBusy] = useState(false);
  const fi = useRef(null);
  useEffect(() => { if (initial?.photos?.length) Promise.all(initial.photos.map((p) => api.photoUrls([p]).then((u) => [p, u[0]]))).then((e) => setKeepUrls(Object.fromEntries(e))); }, [initial]);
  const room = api.MAX_PHOTOS - keep.length - add.length;
  const pick = async (e) => {
    const files = [...e.target.files].slice(0, Math.max(0, room)); e.target.value = '';
    if (e.target.files.length > room) toast('Maximum ' + api.MAX_PHOTOS + ' photos.');
    try { const out = []; for (const x of files) out.push(await compressImage(x, 1280, 0.8)); setAdd((a) => [...a, ...out]); } catch (er) { toast('Could not read that image.'); }
  };
  const submit = async (e) => {
    e.preventDefault();
    const title = t.trim(); const p = Number(price);
    if (title.length < 3) return toast('Enter a title (at least 3 characters).');
    if (price === '' || isNaN(p) || p < 0) return toast('Enter a valid price (0 for free).');
    if (p > 1e9) return toast('Price is too large.');
    const f = { title: title.slice(0, 100), description: desc.trim().slice(0, 2000), price_minor: api.toMinor(p, cur), currency: cur, category: cat, condition: cond, location: loc.trim().slice(0, 100) };
    setBusy(true);
    try { const r = ed ? await api.updateListing(user.id, initial, f, keep, add) : await api.createListing(user.id, f, add); toast(ed ? 'Listing updated.' : 'Listing published.'); onDone(r); }
    catch (er) { toast(/rate|too many|limit/i.test(msg(er)) ? 'You are posting too fast. Please try again later.' : msg(er)); setBusy(false); }
  };
  return (
    <form className="mk-form" onSubmit={submit}>
      <div className="mk-photos">
        {keep.map((p) => <div key={p} className="mk-ph">{keepUrls[p] ? <img src={keepUrls[p]} alt="" /> : null}<button type="button" aria-label="Remove photo" onClick={() => setKeep(keep.filter((x) => x !== p))}><IoClose /></button></div>)}
        {add.map((d, i) => <div key={i} className="mk-ph"><img src={d} alt="" /><button type="button" aria-label="Remove photo" onClick={() => setAdd(add.filter((_, k) => k !== i))}><IoClose /></button></div>)}
        {room > 0 && <button type="button" className="mk-ph mk-addph" onClick={() => fi.current.click()}><IoImageOutline size={26} /><small>Add photos ({keep.length + add.length}/{api.MAX_PHOTOS})</small></button>}
        <input ref={fi} type="file" accept="image/jpeg,image/png,image/webp,image/*" multiple hidden onChange={pick} />
      </div>
      <label>Title<input className="input" maxLength={100} value={t} onChange={(e) => setT(e.target.value)} placeholder="What are you selling?" /></label>
      <div className="mk-row">
        <label>Price<input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(',', '.'))} placeholder="0 = free" /></label>
        <label>Currency<select className="input" value={cur} onChange={(e) => setCur(e.target.value)}>{api.MARKET_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
      </div>
      <div className="mk-row">
        <label>Category<select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>{api.CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Condition<select className="input" value={cond} onChange={(e) => setCond(e.target.value)}>{api.CONDITIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      <label>Location<input className="input" maxLength={100} value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="City / area" /></label>
      <label>Description<textarea className="input" rows={5} maxLength={2000} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Describe the item, its condition, and anything buyers should know." /></label>
      <Safety />
      <div className="mk-row">{onCancel && <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>}<button className="btn primary" disabled={busy}>{busy ? 'Saving…' : ed ? 'Save changes' : 'Publish listing'}</button></div>
    </form>
  );
}
function NewPage({ user }) {
  return <><Head title="Sell an item" /><section className="card pad"><ListingForm user={user} onDone={(l) => go('#/market/' + l.id)} /></section></>;
}

// ---------------- mine ----------------
function Mine({ user }) {
  const [tab, setTab] = useState('sell');
  const [items, setItems] = useState(null);
  const [urls, setUrls] = useState({});
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true; setItems(null); setErr('');
    (tab === 'sell' ? api.myListings(user.id) : api.savedListings(user.id))
      .then(async (r) => { const t = await api.thumbs(r); if (live) { setItems(r); setUrls(t); } })
      .catch((e) => live && setErr(msg(e)));
    return () => { live = false; };
  }, [tab, user.id]);
  return (
    <>
      <Head title="My marketplace" right={<a className="btn primary sm" href="#/market/new"><IoAdd /> Sell</a>} />
      <div className="card tabs"><button className={tab === 'sell' ? 'on' : ''} onClick={() => setTab('sell')}>My listings</button><button className={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>Saved</button></div>
      {err && <div className="local-note">{err}</div>}
      {items === null && !err && <p className="muted" style={{ textAlign: 'center' }}>Loading…</p>}
      {items && !items.length && <Empty title={tab === 'sell' ? 'No listings yet' : 'Nothing saved'} text={tab === 'sell' ? 'Items you sell will appear here.' : 'Save items to find them again later.'} />}
      {items && <Grid items={items} urls={urls} />}
    </>
  );
}

// ---------------- gallery ----------------
function Gallery({ urls, sold }) {
  const [i, setI] = useState(0); const ref = useRef(null);
  const to = (n) => { const el = ref.current; if (!el || !urls.length) return; const k = (n + urls.length) % urls.length; el.scrollTo({ left: k * el.clientWidth, behavior: 'smooth' }); setI(k); };
  if (!urls.length) return <div className="mk-gallery"><span className="mk-noimg big"><IoImageOutline size={48} /></span>{sold && <span className="mk-ribbon">SOLD</span>}</div>;
  return (
    <div className="mk-gallery">
      <div className="mk-slides" ref={ref} onScroll={(e) => setI(Math.round(e.target.scrollLeft / e.target.clientWidth))}>
        {urls.map((u, k) => <img key={k} src={u} alt={'Photo ' + (k + 1)} />)}
      </div>
      {urls.length > 1 && <>
        <button className="mk-arr l" aria-label="Previous photo" onClick={() => to(i - 1)}><IoChevronBack /></button>
        <button className="mk-arr r" aria-label="Next photo" onClick={() => to(i + 1)}><IoChevronForward /></button>
        <div className="mk-dots">{urls.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</div>
      </>}
      {sold && <span className="mk-ribbon">SOLD</span>}
    </div>
  );
}

const REASONS = [['spam', 'Spam / scam / fraud'], ['prohibited', 'Prohibited or illegal item'], ['misleading', 'Misleading listing'], ['harassment', 'Harassment'], ['other', 'Other']];
function ReportSheet({ user, id, onClose }) {
  const [r, setR] = useState('spam'); const [tx, setTx] = useState(''); const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { await api.reportListing(user.id, id, r + (tx.trim() ? ': ' + tx.trim().slice(0, 480) : '')); toast('Report submitted. An admin will review it.'); onClose(); }
    catch (e) { toast('Could not send report: ' + msg(e)); setBusy(false); }
  };
  return (
    <Sheet title="Report listing" onClose={onClose}>
      {REASONS.map(([k, l]) => <label key={k} className="toggle-row"><span>{l}</span><input type="radio" name="lr" checked={r === k} onChange={() => setR(k)} /></label>)}
      <textarea className="input" maxLength={480} placeholder="Add details (optional)" value={tx} onChange={(e) => setTx(e.target.value)} />
      <button className="btn danger" disabled={busy} onClick={send}>Send report</button>
    </Sheet>
  );
}

// ---------------- detail ----------------
function Detail({ id, user }) {
  const [l, setL] = useState(undefined);
  const [urls, setUrls] = useState([]);
  const [seller, setSeller] = useState(null);
  const [saved, setSaved] = useState(false);
  const [edit, setEdit] = useState(false);
  const [rep, setRep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try {
      const x = await api.getListing(id); setL(x);
      if (!x) return;
      api.photoUrls(x.photos).then(setUrls);
      api.sellerOf(x.seller_id).then(setSeller).catch(() => {});
      if (x.seller_id !== user.id) api.isSaved(user.id, id).then(setSaved).catch(() => {});
    } catch (e) { setErr(msg(e)); }
  }, [id, user.id]);
  useEffect(() => { setL(undefined); setErr(''); load(); }, [load]);

  if (err) return <><Head title="Listing" /><div className="local-note">{err}</div></>;
  if (l === undefined) return <><Head title="Listing" /><p className="muted" style={{ textAlign: 'center' }}>Loading…</p></>;
  if (l === null) return <><Head title="Listing" /><Empty title="Listing not available" text="It may have been removed or hidden by the seller."><a className="btn primary" href="#/market">Back to marketplace</a></Empty></>;
  const own = l.seller_id === user.id;
  const run = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) toast(ok); } catch (e) { toast(msg(e)); } setBusy(false); };
  const toggleSave = () => run(async () => { if (saved) { await api.unsave(user.id, id); setSaved(false); } else { await api.save(user.id, id); setSaved(true); } }, saved ? 'Removed from saved.' : 'Saved.');
  const share = async () => {
    const url = location.origin + location.pathname + '#/market/' + id;
    try { await navigator.clipboard.writeText(url); toast('Link copied.'); } catch (e) { window.prompt('Copy this link', url); }
  };
  const message = () => run(async () => { const r = await openChatOnline(l.seller_id); if (r.error) throw new Error(r.error); go('#/chat/' + r.id); });
  const status = (st, ok) => run(async () => { setL(await api.setStatus(id, st)); }, ok);
  const del = () => { if (!window.confirm('Delete this listing permanently? Its photos will be removed too.')) return; run(async () => { await api.deleteListing(l); go('#/market/mine'); }, 'Listing deleted.'); };

  return (
    <>
      <Head title="Listing" right={<button className="icon-btn" aria-label="Copy link" onClick={share}><IoLinkOutline size={22} /></button>} />
      <section className="card mk-detail">
        <Gallery urls={urls} sold={l.status === 'sold'} />
        <div className="pad">
          {l.status === 'hidden' && <div className="local-note">This listing is hidden. Only you can see it.</div>}
          <h2 className="mk-d-price">{api.fmtPrice(l.price_minor, l.currency)}</h2>
          <h3 className="mk-d-title">{l.title}</h3>
          <small className="muted">{[l.location, 'Listed ' + new Date(l.created_at).toLocaleDateString()].filter(Boolean).join(' · ')}</small>
          <div className="mk-facts"><span className="chip">{l.category}</span><span className="chip">{api.condLabel(l.condition)}</span></div>
          {l.description && <p className="mk-desc">{l.description}</p>}
        </div>
      </section>
      <a className="card pad mk-seller person" href={'#/profile/' + l.seller_id}>
        <Avatar user={seller || { id: l.seller_id, name: '?' }} size={44} />
        <span><small className="muted">Seller</small><br /><b>{seller?.name || 'Seller'}</b><Badge on={seller?.verified} /></span>
      </a>
      <Safety />
      {own ? (
        <section className="card pad mk-actions">
          <button className="btn primary" disabled={busy} onClick={() => setEdit(true)}>Edit</button>
          {l.status === 'sold' ? <button className="btn ghost" disabled={busy} onClick={() => status('active', 'Relisted.')}>Relist</button> : <button className="btn ghost" disabled={busy} onClick={() => status('sold', 'Marked as sold.')}>Mark as sold</button>}
          {l.status === 'hidden' ? <button className="btn ghost" disabled={busy} onClick={() => status('active', 'Listing is visible again.')}>Unhide</button> : <button className="btn ghost" disabled={busy} onClick={() => status('hidden', 'Listing hidden.')}>Hide</button>}
          <button className="btn danger" disabled={busy} onClick={del}>Delete</button>
        </section>
      ) : (
        <section className="card pad mk-actions">
          <button className="btn primary" disabled={busy} onClick={message}><IoChatbubbleEllipses /> Message seller</button>
          <button className="btn ghost" disabled={busy} onClick={toggleSave}>{saved ? <><IoBookmark /> Unsave</> : <><IoBookmarkOutline /> Save</>}</button>
          <button className="btn ghost" onClick={() => setRep(true)}><IoFlag /> Report</button>
        </section>
      )}
      {rep && <ReportSheet user={user} id={id} onClose={() => setRep(false)} />}
      {edit && <Sheet title="Edit listing" onClose={() => setEdit(false)}><ListingForm user={user} initial={l} onCancel={() => setEdit(false)} onDone={(r) => { setEdit(false); setL(r); api.photoUrls(r.photos).then(setUrls); }} /></Sheet>}
    </>
  );
}

// ---------------- router ----------------
export function Market() {
  const s = useStore(); const user = me(s); const hash = useHash();
  const sub = (hash.replace(/^#\/market\/?/, '').split(/[?#]/)[0] || '');
  if (!user?.cloud) {
    return <><Head title="Marketplace" /><LocalNote what="Marketplace" phase={7} /><Empty title="Online account required" text="Buying and selling needs an online FYNZA account, because listings are shared with other people." /></>;
  }
  if (sub === 'new') return <NewPage user={user} />;
  if (sub === 'mine') return <Mine user={user} />;
  if (sub) return <Detail key={sub} id={sub} user={user} />;
  return (
    <>
      <Head title="Marketplace" right={<><a className="btn ghost sm" href="#/market/mine">My items</a> <a className="btn primary sm" href="#/market/new"><IoAdd /> Sell</a></>} />
      <Browse />
    </>
  );
}
