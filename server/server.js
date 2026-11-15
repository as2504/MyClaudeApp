// Lorewood Production Control Centre — backend for the phone PWA.
// Plain Node http server + the shared SQLite bus. Serves the PWA, a small JSON API,
// review files (with HTTP Range support for audio/video), and sends Web Push.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');
const cfg = require('../bus/config');
const B = require('../bus/db');
const { kick } = require('../bus/kick');

const WEB = path.join(__dirname, '..', 'web');

// ---------- secrets ----------
function loadSecrets() {
  let s = null;
  try { s = JSON.parse(fs.readFileSync(cfg.SECRETS_PATH, 'utf8')); } catch (_) {}
  if (!s) {
    const v = webpush.generateVAPIDKeys();
    s = {
      accessKey: crypto.randomBytes(9).toString('base64url'),
      sessionSecret: crypto.randomBytes(32).toString('hex'),
      vapidPublic: v.publicKey, vapidPrivate: v.privateKey,
      vapidSubject: 'mailto:pm@lorewood.invalid',
    };
    fs.mkdirSync(cfg.DATA, { recursive: true });
    fs.writeFileSync(cfg.SECRETS_PATH, JSON.stringify(s, null, 2));
    console.log('Created secrets at', cfg.SECRETS_PATH);
  }
  return s;
}
const S = loadSecrets();
webpush.setVapidDetails(S.vapidSubject, S.vapidPublic, S.vapidPrivate);
const AUTH_TOKEN = crypto.createHmac('sha256', S.sessionSecret).update('lw-session-v1').digest('hex');

// ---------- helpers ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  res.writeHead(code, Object.assign({ 'Content-Type': isObj ? 'application/json' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, SEC_HEADERS, headers));
  res.end(data);
}
const SEC_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };

function cookies(req) {
  const o = {};
  for (const p of (req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }
  return o;
}
function authed(req) {
  const c = cookies(req).lw_auth || '';
  const h = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const tok = c || h;
  return tok.length === AUTH_TOKEN.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(AUTH_TOKEN));
}
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (d) => { n += d.length; if (n > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const loginAttempts = new Map();
function rateLimited(ip) {
  const now = Date.now(); const a = (loginAttempts.get(ip) || []).filter(t => now - t < 10 * 60000);
  a.push(now); loginAttempts.set(ip, a); return a.length > 10;
}
function isSecure(req) { return req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted || (req.headers.host || '').endsWith('.ts.net'); }

// ---------- data views ----------
function state() {
  const d = B.db();
  const st = {}; for (const [k, v] of Object.entries(B.allStatus())) st[k] = v;
  return {
    status: st,
    decisions_open: d.prepare(`SELECT COUNT(*) n FROM decisions WHERE asked_of='user' AND status='open'`).get().n,
    files_pending: d.prepare(`SELECT COUNT(*) n FROM files WHERE status='pending_review'`).get().n,
    unread_pm: d.prepare(`SELECT COUNT(*) n FROM messages WHERE sender='pm' AND recipient='user' AND status IN ('pending','delivered')`).get().n,
    pm_waiting: d.prepare(`SELECT COUNT(*) n FROM messages WHERE recipient='pm' AND status IN ('pending','processing')`).get().n,
    worker_unacked: d.prepare(`SELECT COUNT(*) n FROM messages WHERE recipient='worker' AND status IN ('pending','delivered')`).get().n,
    activity: d.prepare(`SELECT id,ts,sender,recipient,type,substr(content,1,280) content,status,file_id,decision_id FROM messages ORDER BY ts DESC LIMIT 40`).all(),
    pm_runs: d.prepare(`SELECT id,started_at,ended_at,status,summary,cost_usd FROM pm_runs ORDER BY id DESC LIMIT 5`).all(),
    push_subscriptions: d.prepare(`SELECT COUNT(*) n FROM push_subs`).get().n,
    server_time: B.now(),
  };
}

// ---------- push ----------
let pushing = false;
async function pushLoop() {
  if (pushing) return; pushing = true;
  try {
    const d = B.db();
    const queued = d.prepare(`SELECT * FROM notifications WHERE status='queued' ORDER BY ts LIMIT 10`).all();
    if (!queued.length) return;
    const subs = d.prepare(`SELECT * FROM push_subs`).all();
    const base = (cfg.load().publicUrl || '').replace(/\/$/, '');
    for (const n of queued) {
      if (!subs.length) { d.prepare(`UPDATE notifications SET status='no_subscribers', error='no phone subscribed yet' WHERE id=?`).run(n.id); continue; }
      const payload = JSON.stringify({ id: n.id, title: n.title, body: n.body || '', url: base + (n.url || '/'), priority: n.priority });
      let ok = 0; const errs = [];
      for (const s of subs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, payload, { TTL: 24 * 3600, urgency: n.priority === 'high' ? 'high' : 'normal' });
          ok++; d.prepare(`UPDATE push_subs SET last_ok=?, failures=0 WHERE endpoint=?`).run(B.now(), s.endpoint);
        } catch (e) {
          errs.push(`${e.statusCode || ''} ${e.body || e.message}`.slice(0, 200));
          if (e.statusCode === 404 || e.statusCode === 410) d.prepare(`DELETE FROM push_subs WHERE endpoint=?`).run(s.endpoint);
          else d.prepare(`UPDATE push_subs SET failures=failures+1 WHERE endpoint=?`).run(s.endpoint);
        }
      }
      d.prepare(`UPDATE notifications SET status=?, sent_at=?, sent_count=?, error=? WHERE id=?`)
        .run(ok ? 'sent' : 'failed', B.now(), ok, errs.join(' | ') || null, n.id);
    }
  } catch (e) { console.error('push loop', e); }
  finally { pushing = false; }
}
setInterval(pushLoop, 3000);

// ---------- file streaming ----------
function streamFile(req, res, abs, mime) {
  let st;
  try { st = fs.statSync(abs); } catch (_) { return send(res, 404, { error: 'missing' }); }
  const range = req.headers.range;
  const head = Object.assign({ 'Content-Type': mime || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' }, SEC_HEADERS);
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (m && !m[1] && m[2]) { start = st.size - parseInt(m[2], 10); end = st.size - 1; }
    if (start >= st.size || end >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, Object.assign(head, { 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 }));
    fs.createReadStream(abs, { start, end }).pipe(res);
  } else {
    res.writeHead(200, Object.assign(head, { 'Content-Length': st.size }));
    fs.createReadStream(abs).pipe(res);
  }
}
function safeJoin(base, rel) {
  const abs = path.resolve(base, rel);
  if (!abs.startsWith(path.resolve(base) + path.sep)) throw new Error('bad path');
  return abs;
}

// ---------- routes ----------
async function api(req, res, url) {
  const d = B.db();
  const p = url.pathname;
  const M = req.method;

  if (p === '/api/login' && M === 'POST') {
    const ip = req.socket.remoteAddress;
    if (rateLimited(ip)) return send(res, 429, { error: 'too many attempts, wait 10 minutes' });
    const body = await readBody(req);
    const k = String(body.key || '');
    const ok = k.length === S.accessKey.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(S.accessKey));
    if (!ok) return send(res, 401, { error: 'wrong access key' });
    const cookie = `lw_auth=${AUTH_TOKEN}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${180 * 86400}${isSecure(req) ? '; Secure' : ''}`;
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie });
  }
  if (!authed(req)) return send(res, 401, { error: 'login required' });

  if (p === '/api/state' && M === 'GET') return send(res, 200, state());

  if (p === '/api/chat' && M === 'GET') {
    const rows = d.prepare(`SELECT id,ts,sender,recipient,type,content,status,decision_id FROM messages
      WHERE (sender='user' AND recipient='pm') OR (sender='pm' AND recipient='user') ORDER BY ts DESC LIMIT 100`).all().reverse();
    d.prepare(`UPDATE messages SET status='read', acked_at=? WHERE sender='pm' AND recipient='user' AND status IN ('pending','delivered')`).run(B.now());
    return send(res, 200, { messages: rows, pm_state: B.getStatus('pm_state') });
  }
  if (p === '/api/chat' && M === 'POST') {
    const body = await readBody(req);
    const text = String(body.text || '').trim().slice(0, 4000);
    if (!text) return send(res, 400, { error: 'empty' });
    const m = B.addMessage({ sender: 'user', recipient: 'pm', type: 'user_message', content: text });
    kick();
    return send(res, 200, { id: m.id, status: m.status });
  }

  if (p === '/api/decisions' && M === 'GET') {
    const rows = d.prepare(`SELECT * FROM decisions WHERE asked_of='user' ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, ts DESC LIMIT 50`).all();
    return send(res, 200, { decisions: rows.map(r => Object.assign(r, { options: JSON.parse(r.options || '[]') })) });
  }
  let m;
  if ((m = /^\/api\/decisions\/([\w-]+)$/.exec(p)) && M === 'POST') {
    const dec = d.prepare('SELECT * FROM decisions WHERE id=?').get(m[1]);
    if (!dec) return send(res, 404, { error: 'not found' });
    if (dec.status !== 'open') return send(res, 409, { error: 'already answered' });
    const body = await readBody(req);
    const choice = String(body.choice || '').slice(0, 500), comment = String(body.comment || '').slice(0, 4000);
    if (!choice && !comment) return send(res, 400, { error: 'choose an option or write a comment' });
    d.prepare(`UPDATE decisions SET status='answered', answer=?, comment=?, answered_by='user', answered_at=? WHERE id=? AND status='open'`)
      .run(choice || null, comment || null, B.now(), dec.id);
    const msg = B.addMessage({ sender: 'user', recipient: 'pm', type: 'decision_response', decision_id: dec.id,
      content: `Decision ${dec.id} — "${dec.question.slice(0, 200)}" → ${choice || '(no option chosen)'}${comment ? '. Comment: ' + comment : ''}` });
    kick();
    return send(res, 200, { ok: true, message: msg.id });
  }

  if (p === '/api/files' && M === 'GET') {
    const rows = d.prepare(`SELECT id,ts,title,note,kind,mime,size,status,review_comment,reviewed_at,preview_name IS NOT NULL has_preview, original_path FROM files WHERE status!='archived' ORDER BY CASE status WHEN 'pending_review' THEN 0 ELSE 1 END, ts DESC LIMIT 100`).all();
    for (const r of rows) r.original_name = path.basename(r.original_path), delete r.original_path;
    return send(res, 200, { files: rows });
  }
  if ((m = /^\/api\/files\/([\w-]+)$/.exec(p)) && M === 'GET') {
    const f = d.prepare('SELECT * FROM files WHERE id=?').get(m[1]);
    if (!f) return send(res, 404, { error: 'not found' });
    const out = { id: f.id, ts: f.ts, title: f.title, note: f.note, kind: f.kind, mime: f.mime, size: f.size, status: f.status,
      review_comment: f.review_comment, reviewed_at: f.reviewed_at, has_preview: !!f.preview_name, original_name: path.basename(f.original_path) };
    if (f.kind === 'text') {
      const abs = safeJoin(cfg.FILES_DIR, f.stored_name);
      const buf = Buffer.alloc(Math.min(f.size, 400 * 1024));
      const fd = fs.openSync(abs, 'r'); fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
      out.text = buf.toString('utf8'); out.truncated = f.size > buf.length;
    }
    return send(res, 200, out);
  }
  if ((m = /^\/api\/files\/([\w-]+)\/raw$/.exec(p)) && M === 'GET') {
    const f = d.prepare('SELECT * FROM files WHERE id=?').get(m[1]);
    if (!f) return send(res, 404, { error: 'not found' });
    const usePreview = url.searchParams.get('preview') !== '0' && f.preview_name;
    const rel = usePreview ? f.preview_name : f.stored_name;
    const mime = usePreview ? (rel.endsWith('.m4a') ? 'audio/mp4' : 'video/mp4') : f.mime;
    return streamFile(req, res, safeJoin(cfg.FILES_DIR, rel), mime);
  }
  if ((m = /^\/api\/files\/([\w-]+)\/review$/.exec(p)) && M === 'POST') {
    const f = d.prepare('SELECT * FROM files WHERE id=?').get(m[1]);
    if (!f) return send(res, 404, { error: 'not found' });
    const body = await readBody(req);
    const verdict = ['approved', 'rejected', 'changes_requested'].includes(body.verdict) ? body.verdict : null;
    const comment = String(body.comment || '').slice(0, 4000);
    if (!verdict && !comment) return send(res, 400, { error: 'choose a verdict or write a comment' });
    if (verdict) d.prepare(`UPDATE files SET status=?, review_comment=?, reviewed_at=? WHERE id=?`).run(verdict, comment || null, B.now(), f.id);
    const msg = B.addMessage({ sender: 'user', recipient: 'pm', type: 'file_review', file_id: f.id,
      content: `Review of ${f.id} "${f.title}" (${path.basename(f.original_path)}): ${verdict || 'comment only'}${comment ? '. Comment: ' + comment : ''}` });
    kick();
    return send(res, 200, { ok: true, message: msg.id });
  }

  if (p === '/api/notifications' && M === 'GET') {
    return send(res, 200, { notifications: d.prepare(`SELECT * FROM notifications ORDER BY ts DESC LIMIT 60`).all() });
  }
  if (p === '/api/vapid' && M === 'GET') return send(res, 200, { publicKey: S.vapidPublic });
  if (p === '/api/push/subscribe' && M === 'POST') {
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub || !sub.endpoint || !sub.keys) return send(res, 400, { error: 'bad subscription' });
    d.prepare(`INSERT INTO push_subs(endpoint,keys,created_at,ua) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET keys=excluded.keys`)
      .run(sub.endpoint, JSON.stringify(sub.keys), B.now(), String(req.headers['user-agent'] || '').slice(0, 200));
    return send(res, 200, { ok: true });
  }
  if (p === '/api/push/ack' && M === 'POST') {
    const body = await readBody(req);
    const r = d.prepare(`UPDATE notifications SET status='delivered', delivered_at=? WHERE id=? AND status IN ('sent','queued','failed')`).run(B.now(), String(body.id || ''));
    return send(res, 200, { ok: r.changes === 1 });
  }
  if (p === '/api/push/test' && M === 'POST') {
    const id = require('../bus/lw').queueNotification({ title: 'Test notification', body: 'Push notifications are working on this phone.', url: '/#/notifications' });
    return send(res, 200, { id });
  }
  return send(res, 404, { error: 'unknown endpoint' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  let abs;
  try {
    // Channel icons are generated into the private data folder, not committed to the repo.
    abs = rel.startsWith('/icons/') ? safeJoin(path.join(cfg.DATA, 'icons'), rel.slice(7)) : safeJoin(WEB, '.' + rel);
  } catch (_) { return send(res, 400, 'bad path'); }
  fs.readFile(abs, (err, data) => {
    if (err) return send(res, 404, 'not found');
    const ext = path.extname(abs).toLowerCase();
    const h = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': rel === '/sw.js' || ext === '.html' ? 'no-cache' : 'public, max-age=300' };
    if (ext === '.html') h['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'";
    res.writeHead(200, Object.assign(h, SEC_HEADERS));
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/healthz') return send(res, 200, 'ok');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'server error' });
  }
});

const port = cfg.load().port;
server.listen(port, '127.0.0.1', () => {
  console.log(`[${B.now()}] Lorewood Control Centre on http://127.0.0.1:${port}`);
  B.setStatus('server_started', B.now());
});
