import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { initCloud } from './store.js';
import { consumeAuthHash } from './supabase.js';
import './styles.css';

(async () => {
  let kind = null;
  try { kind = await consumeAuthHash(); } catch (e) { /* ignore */ }
  if (kind === 'recovery') location.hash = '#/reset';
  else if (kind === 'confirmed') location.hash = '#/login';
  createRoot(document.getElementById('root')).render(<App />);
  if (kind !== 'recovery') initCloud();
})();
