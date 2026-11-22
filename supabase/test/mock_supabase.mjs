// TEST ONLY: pretends to be Supabase (Auth + REST) but runs every query on a REAL local Postgres that has schema.sql applied.
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const PORT = +process.env.PORT || 5300;
const CONFIRM = process.env.CONFIRM === '1';
const PG = { PGHOST: '/var/tmp/fynza-pgtest', PGPORT: '5433', PGUSER: 'postgres', PGDATABASE: process.env.DB || 'fz2' };
const users = new Map(); // email -> {id,password}
const tokens = new Map(); // access_token -> uid
const refresh = new Map();

function psql(sql, vars = {}) {
  const args = ['-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  return execFileSync('psql', [...args, '-f', '-'], { env: { ...process.env, ...PG }, input: sql }).toString().trim();
}
const asUser = (uid, body, vars = {}) => psql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'uid', true) \\g /dev/null\n${body}\ncommit;`, { uid, ...vars });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
function session(uid, email) {
  const at = 'at_' + randomUUID(), rt = 'rt_' + randomUUID(); tokens.set(at, uid); refresh.set(rt, uid);
  return { access_token: at, refresh_token: rt, expires_in: 3600, token_type: 'bearer', user: { id: uid, email } };
}
const uidFromAuth = (req) => tokens.get((req.headers.authorization || '').replace('Bearer ', ''));

const lit = (v) => v === null || v === undefined ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const ident = (x) => { if (!/^[a-z_][a-z0-9_]*$/.test(x)) throw new Error('bad ident ' + x); return x; };
const lastJson = (out) => JSON.parse(out.split('\n').filter((l) => /^[\[{]/.test(l)).pop() || '[]');
const errCode = (m) => /row-level security|permission denied/.test(m) ? 403 : /duplicate key value/.test(m) ? 409 : 400;
function cond(u) {
  const w = [];
  for (const [k, v] of u.searchParams) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    const c = ident(k); const m = v.match(/^(eq|neq|is|in|ilike|gt|gte|lt|lte)\.(.*)$/); if (!m) throw new Error('bad filter ' + v);
    const [, op, val] = m;
    if (op === 'eq') w.push(`${c}::text = ${lit(val)}`);
    else if (op === 'neq') w.push(`${c}::text <> ${lit(val)}`);
    else if (op === 'is') w.push(`${c} is ${val === 'null' ? 'null' : val}`);
    else if (['gt','gte','lt','lte'].includes(op)) w.push(`${c} ${{ gt: '>', gte: '>=', lt: '<', lte: '<=' }[op]} ${lit(decodeURIComponent(val))}`);
    else if (op === 'ilike') w.push(`${c}::text ilike ${lit(decodeURIComponent(val).replace(/\*/g, '%'))}`);
    else w.push(`${c}::text in (${val.replace(/^\(|\)$/g, '').split(',').map((x) => lit(x.replace(/^"|"$/g, ''))).join(',')})`);
  }
  return w.length ? ' where ' + w.join(' and ') : '';
}
function rest(req, res, u, table, b) {
  const uid = uidFromAuth(req); if (!uid) return send(res, 401, { message: 'JWT expired or invalid' });
  const t = 'public.' + ident(table); const where = cond(u); const prefer = req.headers.prefer || '';
  try {
    if (req.method === 'GET') {
      const ord = u.searchParams.get('order'); const lim = u.searchParams.get('limit');
      const o = ord ? ' order by ' + ord.split(',').map((x) => { const [c, d] = x.split('.'); return ident(c) + (d === 'desc' ? ' desc' : ' asc'); }).join(',') : '';
      const out = asUser(uid, `select coalesce(jsonb_agg(r), '[]'::jsonb) from (select * from ${t}${where}${o}${lim ? ' limit ' + +lim : ''}) r;`);
      return send(res, 200, lastJson(out));
    }
    const rep = /return=representation/.test(prefer); let sql;
    if (req.method === 'POST') {
      const rows = Array.isArray(b) ? b : [b]; const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].map(ident);
      let oc = ''; const onc = u.searchParams.get('on_conflict');
      if (onc) { const k = onc.split(',').map(ident); const rest_ = cols.filter((c) => !k.includes(c)); oc = /ignore-duplicates/.test(prefer) || !rest_.length ? ` on conflict (${k.join(',')}) do nothing` : ` on conflict (${k.join(',')}) do update set ${rest_.map((c) => `${c}=excluded.${c}`).join(',')}`; }
      sql = `with r as (insert into ${t} (${cols.join(',')}) select ${cols.join(',')} from json_populate_recordset(null::${t}, ${lit(JSON.stringify(rows))}::json)${oc} ${rep ? 'returning *' : ''}) select ${rep ? "coalesce(jsonb_agg(r), '[]'::jsonb)" : "1"} from ${rep ? 'r' : '(select 1) r'};`;
    } else if (req.method === 'PATCH') {
      const cols = Object.keys(b).map(ident);
      sql = `with r as (update ${t} set ${cols.map((c) => `${c} = (json_populate_record(null::${t}, ${lit(JSON.stringify(b))}::json)).${c}`).join(',')}${where} ${rep ? 'returning *' : ''}) select ${rep ? "coalesce(jsonb_agg(r), '[]'::jsonb)" : "1"} from ${rep ? 'r' : '(select 1) r'};`;
    } else if (req.method === 'DELETE') {
      sql = `with r as (delete from ${t}${where} ${rep ? 'returning *' : ''}) select ${rep ? "coalesce(jsonb_agg(r), '[]'::jsonb)" : "1"} from ${rep ? 'r' : '(select 1) r'};`;
    } else return send(res, 405, { message: 'method' });
    const out = lastJson(asUser(uid, sql));
    return rep ? send(res, req.method === 'POST' ? 201 : 200, out) : send(res, req.method === 'POST' ? 201 : 204);
  } catch (e) { const m = String(e.stderr || e.message); send(res, errCode(m), { message: m.slice(0, 300) }); }
}
const FILES = '/var/tmp/fz-storage'; const signed = new Map(); const PUBLIC = ['avatars', 'covers'];
const fpath = (b, p) => { if (/\.\./.test(b + p)) throw new Error('bad path'); return `${FILES}/${b}/${p}`; };
function storage(req, res, u, p, buf) {
  const fs = require_fs();
  const uid = uidFromAuth(req);
  const m = p.match(/^object\/(sign|public)?\/?(.*)$/); const rawcmd = p;
  try {
    if (req.method === 'POST' && /^object\/sign\//.test(p)) {
      if (!uid) return send(res, 401, { message: 'unauthorized' });
      const bucket = p.slice(12); const { paths } = JSON.parse(buf.toString());
      const out = paths.map((path) => {
        const ok = asUser(uid, `select count(*) from storage.objects where bucket_id=${lit(bucket)} and name=${lit(path)};`).split('\n').pop() === '1';
        if (!ok) return { path, error: 'Object not found', signedURL: null };
        const tok = randomUUID(); signed.set(tok, [bucket, path]); return { path, signedURL: `/object/sign/${bucket}/${path}?token=${tok}` };
      });
      return send(res, 200, out);
    }
    if (req.method === 'GET' && /^object\/sign\//.test(p)) {
      const hit = signed.get(u.searchParams.get('token')); if (!hit) return send(res, 400, { message: 'bad token' });
      return file(res, fpath(...hit));
    }
    if (req.method === 'GET' && /^object\/public\//.test(p)) {
      const [, , bucket, ...rest_] = ['', ''].concat(p.slice(14).split('/')); if (!PUBLIC.includes(bucket)) return send(res, 400, { message: 'not public' });
      return file(res, fpath(bucket, rest_.join('/')));
    }
    if (req.method === 'POST' && /^object\//.test(p)) {
      if (!uid) return send(res, 401, { message: 'unauthorized' });
      const [bucket, ...r] = p.slice(7).split('/'); const name = r.join('/');
      if (buf.length > 50e6) return send(res, 413, { message: 'too large' });
      asUser(uid, `insert into storage.objects (bucket_id,name,owner) values (${lit(bucket)}, ${lit(name)}, auth.uid());`);
      fs.mkdirSync(fpath(bucket, name).replace(/\/[^/]*$/, ''), { recursive: true }); fs.writeFileSync(fpath(bucket, name), buf);
      return send(res, 200, { Key: bucket + '/' + name });
    }
    if (req.method === 'DELETE' && /^object\//.test(p)) {
      if (!uid) return send(res, 401, { message: 'unauthorized' });
      const bucket = p.slice(7); const { prefixes } = JSON.parse(buf.toString());
      for (const name of prefixes) { asUser(uid, `delete from storage.objects where bucket_id=${lit(bucket)} and name=${lit(name)};`); try { fs.unlinkSync(fpath(bucket, name)); } catch (e) {} }
      return send(res, 200, []);
    }
    send(res, 404, { message: 'storage not found ' + rawcmd });
  } catch (e) { const mm = String(e.stderr || e.message); send(res, errCode(mm), { message: mm.slice(0, 300) }); }
}
import fsmod from 'node:fs';
const require_fs = () => fsmod;
function file(res, fp) {
  try { const d = fsmod.readFileSync(fp); const ext = fp.split('.').pop(); res.writeHead(200, { 'Content-Type': { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webm: 'video/webm', mp4: 'video/mp4' }[ext] || 'application/octet-stream', ...cors }); res.end(d); }
  catch (e) { send(res, 404, { message: 'not found' }); }
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    const buf = Buffer.concat(chunks); const raw = buf.toString(); let b = {}; try { b = raw ? JSON.parse(raw) : {}; } catch (e) {}
    const u = new URL(req.url, 'http://x'); const path = u.pathname;
    try {
      if (path === '/auth/v1/signup') {
        if (users.has(b.email)) return send(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
        if ((b.password || '').length < 8) return send(res, 422, { error_code: 'weak_password', msg: 'Password should be at least 8 characters.' });
        const id = randomUUID(); users.set(b.email, { id, password: b.password });
        psql(`insert into auth.users (id,email,raw_user_meta_data) values (:'id', :'email', :'meta'::jsonb)`, { id, email: b.email, meta: JSON.stringify(b.data || {}) });
        return send(res, 200, CONFIRM ? { id, email: b.email } : session(id, b.email));
      }
      if (path === '/auth/v1/token') {
        const g = u.searchParams.get('grant_type');
        if (g === 'password') {
          const x = users.get(b.email);
          if (!x || x.password !== b.password) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
          return send(res, 200, session(x.id, b.email));
        }
        if (g === 'refresh_token') { const uid = refresh.get(b.refresh_token); if (!uid) return send(res, 400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }); return send(res, 200, session(uid, '')); }
      }
      if (path === '/auth/v1/logout') { tokens.delete((req.headers.authorization || '').replace('Bearer ', '')); return send(res, 204); }
      if (path === '/rest/v1/rpc/username_available') {
        const r = psql(`begin; set local role anon; select public.username_available(:'u'); commit;`, { u: b.u }); // anon role, like a real signed-out visitor
        return send(res, 200, r.split('\n')[0] === 't');
      }
      if (path.startsWith('/rest/v1/rpc/')) {
        const uid = uidFromAuth(req); if (!uid) return send(res, 401, { message: 'JWT expired or invalid' });
        const fn = ident(path.slice(13)); const args = Object.entries(b).map(([k, v]) => `${ident(k)} => ${lit(Array.isArray(v) ? '{' + v.join(',') + '}' : v)}`).join(', ');
        const out = asUser(uid, `select coalesce(jsonb_agg(r), '[]'::jsonb) from public.${fn}(${args}) r;`);
        const rows = lastJson(out); // scalar functions answer with the bare value, like PostgREST
        if (rows.length === 1 && typeof rows[0] === 'string') return send(res, 200, rows[0]);
        if (rows.length === 1 && Object.keys(rows[0]).length === 1 && Object.keys(rows[0])[0] === fn) return send(res, 200, rows[0][fn]);
        return send(res, 200, rows);
      }
      if (path.startsWith('/rest/v1/') && !path.startsWith('/rest/v1/rpc/')) return rest(req, res, u, path.slice(9), b);
      if (path.startsWith('/storage/v1/')) return storage(req, res, u, path.slice(12), buf);
      send(res, 404, { message: 'not found: ' + path });
    } catch (e) { send(res, 400, { message: String(e.stderr || e.message).slice(0, 300) }); }
  });
}).listen(PORT, () => console.log('mock supabase on', PORT));
