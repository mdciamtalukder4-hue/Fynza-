import { useEffect, useState } from 'react';

// In-app update check for the Android app. The APK is published as a GitHub release tagged apk-<build number>.
// A new APK installs over the old one (same signing key), so nothing needs to be uninstalled.
const BUILD = parseInt(process.env.FYNZA_BUILD, 10) || 0;
const API = 'https://api.github.com/repos/mdciamtalukder4-hue/Fynza-/releases/latest';

export function UpdateBanner() {
  const [up, setUp] = useState(null);
  useEffect(() => {
    let dead = false;
    const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (!native || !BUILD) return undefined;
    const dismissed = (() => { try { return sessionStorage.getItem('fz_upd_x'); } catch (e) { return null; } })();
    fetch(API, { headers: { Accept: 'application/vnd.github+json' } }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (dead || !j) return;
      const n = parseInt(String(j.tag_name || '').replace(/^apk-/, ''), 10);
      const a = (j.assets || []).find((x) => /\.apk$/i.test(x.name));
      if (n > BUILD && a && dismissed !== String(n)) setUp({ n, url: a.browser_download_url });
    }).catch(() => {});
    return () => { dead = true; };
  }, []);
  if (!up) return null;
  const close = () => { try { sessionStorage.setItem('fz_upd_x', String(up.n)); } catch (e) { /* ignore */ } setUp(null); };
  return (
    <div className="upd-banner" role="status">
      <span><b>New version available.</b> Download and tap Install — no need to uninstall.</span>
      <button className="btn primary sm" onClick={() => window.open(up.url, '_system')}>Update</button>
      <button className="btn ghost sm" onClick={close} aria-label="Dismiss">Later</button>
    </div>
  );
}
