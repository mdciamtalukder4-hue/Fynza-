import { useEffect, useState } from 'react';
import { useStore, me, mySettings, updateSettings, lockProfile } from './store.js';
import { mfaFactors } from './supabase.js';
import { toast, LocalNote } from './ui.jsx';

// Guided privacy checkup: every row reads a real setting and can be fixed inline.
export function PrivacyCheckup() {
  const s = useStore();
  const user = me(s);
  const st = mySettings(s);
  const cloud = !!user?.cloud;
  const [mfa, setMfa] = useState(cloud ? null : undefined);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (!cloud) return undefined;
    let on = true;
    mfaFactors().then((f) => on && setMfa(f.some((x) => x.status === 'verified'))).catch(() => on && setMfa(undefined));
    return () => { on = false; };
  }, [cloud]);
  if (!user) return null;
  const fix = async (key, fn) => { setBusy(key); try { const e = await fn(); if (e) toast(e); } finally { setBusy(''); } };
  const rows = [
    { k: 'lock', ok: st.profilePublic === false, title: 'Locked profile', now: st.profilePublic === false ? 'Only friends can see your posts and info.' : 'Your profile is public.', fixLabel: 'Lock profile', run: () => lockProfile(true), undo: 'Unlock', undoRun: () => lockProfile(false) },
    { k: 'aud', ok: st.postAudience !== 'public', title: 'Default post audience', now: { public: 'New posts are public.', friends: 'New posts are for friends only.', me: 'New posts are only visible to you.' }[st.postAudience] || '', fixLabel: 'Set to Friends', run: () => updateSettings({ postAudience: 'friends' }) },
    { k: 'msg', ok: st.whoCanMessage !== 'everyone', title: 'Who can message you', now: st.whoCanMessage === 'everyone' ? 'Anyone can message you.' : 'Messages are restricted.', fixLabel: 'Friends only', run: () => updateSettings({ whoCanMessage: 'friends' }) },
    { k: 'seen', ok: st.showLastSeen === false, title: 'Last seen', now: st.showLastSeen === false ? 'Your last seen is hidden.' : 'Others can see when you were last online.', fixLabel: 'Hide last seen', run: () => updateSettings({ showLastSeen: false }) },
    { k: 'read', ok: st.showReadReceipts === false, title: 'Read receipts', now: st.showReadReceipts === false ? 'Read receipts are off.' : 'People can see when you read their messages.', fixLabel: 'Turn off', run: () => updateSettings({ showReadReceipts: false }) },
    { k: 'visits', ok: st.recordMyVisits === false, title: 'Profile visit recording', now: st.recordMyVisits === false ? 'Your visits to profiles are not recorded.' : 'People see when you visit their profile.', fixLabel: 'Stop recording', run: () => updateSettings({ recordMyVisits: false }) },
  ];
  const showMfa = cloud && mfa !== undefined;
  const total = rows.length + (showMfa ? 1 : 0);
  const score = rows.filter((r) => r.ok).length + (showMfa && mfa ? 1 : 0);
  return (
    <div className="stack">
      <section className="card pad">
        <b>Privacy Checkup</b>
        <p className="muted"><b>{score} of {total} protected</b>{score === total ? ' — great job!' : ' — fix the items below.'}</p>
        <div className="pc-bar"><i style={{ width: (total ? (score / total) * 100 : 0) + '%' }} /></div>
        {!cloud && <LocalNote what="Privacy settings" phase="4" />}
      </section>
      {rows.map((r) => (
        <section className="card pad pc-row" key={r.k}>
          <span className={'pc-dot ' + (r.ok ? 'ok' : 'warn')} aria-hidden="true">{r.ok ? '✓' : '!'}</span>
          <div className="grow"><b>{r.title}</b><p className="muted">{r.now}</p></div>
          {r.ok ? (r.undo ? <button className="btn ghost sm" disabled={busy === r.k} onClick={() => fix(r.k, r.undoRun)}>{r.undo}</button> : <span className="chip">Protected</span>)
            : <button className="btn primary sm" disabled={busy === r.k} onClick={() => fix(r.k, r.run)}>{r.fixLabel}</button>}
        </section>
      ))}
      {showMfa && (
        <section className="card pad pc-row">
          <span className={'pc-dot ' + (mfa ? 'ok' : 'warn')} aria-hidden="true">{mfa ? '✓' : mfa === null ? '…' : '!'}</span>
          <div className="grow"><b>Two-factor authentication</b><p className="muted">{mfa === null ? 'Checking…' : mfa ? '2FA is on for your account.' : '2FA is off. Add an authenticator app for stronger protection.'}</p></div>
          {mfa === false && <a className="btn primary sm" href="#/security">Set up 2FA</a>}
        </section>
      )}
    </div>
  );
}
