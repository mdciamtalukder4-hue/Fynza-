import { useEffect, useState, useSyncExternalStore } from 'react';
import { colorFor, getVideoUrl, setErrorHandler } from './store.js';

// ---------- routing (hash based, works on any static host) ----------
const subscribe = (cb) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); };
export const useHash = () => useSyncExternalStore(subscribe, () => location.hash || '#/');
export const go = (path) => { location.hash = path; };
export const back = (fallback = '#/feed') => { if (history.length > 1) history.back(); else go(fallback); };

// ---------- logo ----------
export function LogoMark({ size = 40, flat = false }) {
  const id = 'lg' + size + (flat ? 'f' : '');
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="FYNZA logo">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3B7BFF" /><stop offset="1" stopColor="#1A2BB8" /></linearGradient>
      </defs>
      {!flat && <rect width="100" height="100" rx="26" fill={`url(#${id})`} />}
      <g fill="none" stroke="#fff" strokeWidth="10" strokeLinecap="round">
        <path d="M36 78C37 62 40 48 45 38" />
        <path d="M45 38C51 29 63 26 77 28" />
        <path d="M40 57C48 51 58 50 69 52" />
      </g>
    </svg>
  );
}
export const Wordmark = ({ color = '#0B1F6B', size = 28 }) => (
  <span className="wordmark" style={{ color, fontSize: size }}>Fynza</span>
);

// ---------- avatar ----------
export function Avatar({ user, size = 44, ring, onClick }) {
  const style = { width: size, height: size, fontSize: size * 0.4 };
  const inner = user?.avatar
    ? <img src={user.avatar} alt="" style={style} className="avatar-img" />
    : <span className="avatar-ph" style={{ ...style, background: `linear-gradient(135deg, ${colorFor(user?.id || 'x')}, #0B1F6B)` }}>{(user?.name || '?').trim()[0]?.toUpperCase()}</span>;
  return (
    <span className={'avatar' + (ring ? ' ring' : '') + (onClick ? ' clickable' : '')} onClick={onClick} style={{ width: size + (ring ? 8 : 0), height: size + (ring ? 8 : 0) }}>{inner}</span>
  );
}

// ---------- generated picture for demo posts ----------
export function Scene({ kind = 'sunset', height = 220 }) {
  const grads = {
    sunset: 'linear-gradient(180deg,#FFD59A 0%,#FF8F5A 38%,#C2477B 62%,#27307A 100%)',
    mountain: 'linear-gradient(180deg,#8EC5FF 0%,#CFE6FF 55%,#3E7A5A 56%,#1F4B3A 100%)',
  };
  return <div className="scene" style={{ height, background: grads[kind] }} />;
}

// ---------- video from IndexedDB ----------
export function Video({ vkey, url: direct, className, controls = true, ...rest }) {
  const [url, setUrl] = useState(direct || '');
  useEffect(() => { if (direct || !vkey) return undefined; let alive = true, u = ''; getVideoUrl(vkey).then((x) => { u = x; if (alive) setUrl(x); }); return () => { alive = false; if (u) URL.revokeObjectURL(u); }; }, [vkey, direct]);
  if (direct) return <video src={direct} className={className} controls={controls} playsInline preload="metadata" {...rest} />;
  if (!url) return <div className={'video-loading ' + (className || '')}>ভিডিও লোড হচ্ছে…</div>;
  return <video src={url} className={className} controls={controls} playsInline {...rest} />;
}

// ---------- small things ----------
export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><b>{title}</b><button className="icon-btn" aria-label="বন্ধ করুন" onClick={onClose}>✕</button></div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

let toastSet = null;
export const toast = (m) => toastSet && toastSet(m);
export function LocalNote({ what, phase }) {
  return <div className="local-note">ℹ️ {what} এখনও শুধু এই ফোনে চলে (অনলাইনে আসবে Phase {phase}-এ)। অন্য ডিভাইসে দেখা যাবে না।</div>;
}
export function Toaster() {
  const [m, setM] = useState('');
  useEffect(() => { setErrorHandler((x) => toastSet && toastSet(x)); toastSet = (x) => { setM(x); setTimeout(() => setM(''), 2600); }; return () => { toastSet = null; }; }, []);
  return m ? <div className="toast" role="status">{m}</div> : null;
}

export function Empty({ title, text, children }) {
  return <div className="empty"><b>{title}</b>{text && <p>{text}</p>}{children}</div>;
}
export function Toggle({ on, onChange, label, hint }) {
  return (
    <label className="toggle-row">
      <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <i className="switch" aria-hidden="true" />
    </label>
  );
}

// FYNZA Verified blue badge (shown only when the database says verified)
export function Badge({ on, size = 16 }) {
  if (!on) return null;
  return (
    <svg className="vbadge" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="FYNZA Verified" style={{ verticalAlign: '-3px', marginLeft: 4 }}>
      <title>FYNZA Verified</title>
      <path fill="#1F6BFF" d="M12 1.8l2.6 1.9 3.2-.1 1 3 2.6 1.9-1 3 1 3-2.6 1.9-1 3-3.2-.1L12 22.2l-2.6-1.9-3.2.1-1-3-2.6-1.9 1-3-1-3 2.6-1.9 1-3 3.2.1z" />
      <path d="M7.6 12.3l3 3 5.8-6.2" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
