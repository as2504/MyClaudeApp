// SQLite communication store (WAL mode, safe for concurrent hook/CLI/server access).
// Messages are append-only: content is never rewritten; only status/timestamp columns change.
'use strict';
// Silence node:sqlite's ExperimentalWarning so hook output stays clean.
process.removeAllListeners('warning');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const crypto = require('crypto');
const cfg = require('./config');

let _db;
function db() {
  if (_db) return _db;
  fs.mkdirSync(cfg.DATA, { recursive: true });
  _db = new DatabaseSync(cfg.DB_PATH);
  _db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=8000; PRAGMA foreign_keys=ON;');
  migrate(_db);
  return _db;
}

function migrate(d) {
  d.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    sender TEXT NOT NULL,          -- worker | pm | user | system
    recipient TEXT NOT NULL,       -- worker | pm | user
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL,          -- pending | delivered | acknowledged | processing | processed | noted | failed | read
    task_id TEXT, decision_id TEXT, file_id TEXT,
    meta TEXT,
    delivered_at TEXT, acked_at TEXT, processed_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    ack_note TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_msg_rcpt ON messages(recipient, status);
  CREATE INDEX IF NOT EXISTS ix_msg_ts ON messages(ts);

  CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    asked_by TEXT NOT NULL,        -- worker | pm
    asked_of TEXT NOT NULL,        -- pm | user
    question TEXT NOT NULL,
    context TEXT,
    options TEXT,                  -- JSON array of strings
    recommendation TEXT,
    status TEXT NOT NULL,          -- open | answered | closed
    answer TEXT, comment TEXT, answered_by TEXT, answered_at TEXT,
    task_id TEXT, source_message_id TEXT, importance TEXT
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    original_path TEXT NOT NULL,
    stored_name TEXT NOT NULL,     -- relative to FILES_DIR
    preview_name TEXT,             -- optional phone-friendly preview (relative)
    mime TEXT, kind TEXT, size INTEGER, sha256 TEXT,
    title TEXT, note TEXT,
    status TEXT NOT NULL,          -- awaiting_pm | pending_review | approved | rejected | changes_requested | archived
    review_comment TEXT, reviewed_at TEXT,
    uploaded_by TEXT, task_id TEXT
  );

  CREATE TABLE IF NOT EXISTS status (
    key TEXT PRIMARY KEY, value TEXT, updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_ev_ts ON events(ts);

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    title TEXT NOT NULL, body TEXT, url TEXT,
    priority TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL,          -- queued | sent | delivered | failed | no_subscribers
    sent_at TEXT, delivered_at TEXT, error TEXT, related_id TEXT, sent_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY, keys TEXT NOT NULL, created_at TEXT NOT NULL, ua TEXT, last_ok TEXT, failures INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS pm_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT, ended_at TEXT, pid INTEGER, status TEXT, message_ids TEXT, exit_code INTEGER, summary TEXT, cost_usd REAL
  );
  `);
  // v2: decisions can carry attachments (JSON array of file ids) so the user sees exactly what they approve.
  const cols = d.prepare(`PRAGMA table_info(decisions)`).all().map(c => c.name);
  if (!cols.includes('attachments')) d.exec(`ALTER TABLE decisions ADD COLUMN attachments TEXT`);
}

const now = () => new Date().toISOString();
function newId(prefix) {
  const t = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  return `${prefix}_${t}_${crypto.randomBytes(3).toString('hex')}`;
}

function logEvent(source, kind, detail) {
  db().prepare('INSERT INTO events(ts,source,kind,detail) VALUES (?,?,?,?)')
    .run(now(), source, kind, detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)));
}

function setStatus(key, value) {
  db().prepare(`INSERT INTO status(key,value,updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(key, value == null ? null : String(value), now());
}
function getStatus(key) {
  const r = db().prepare('SELECT value, updated_at FROM status WHERE key=?').get(key);
  return r ? r.value : null;
}
function allStatus() {
  const o = {};
  for (const r of db().prepare('SELECT key,value,updated_at FROM status').all()) o[r.key] = { value: r.value, updated_at: r.updated_at };
  return o;
}

function addMessage({ sender, recipient, type, content, task_id = null, decision_id = null, file_id = null, meta = null, status }) {
  const id = newId('m');
  const actionable = cfg.load().actionableTypes.includes(type);
  const st = status || (recipient === 'pm' ? (actionable ? 'pending' : 'noted') : 'pending');
  db().prepare(`INSERT INTO messages(id,ts,sender,recipient,type,content,status,task_id,decision_id,file_id,meta)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, now(), sender, recipient, type, String(content), st, task_id, decision_id, file_id, meta ? JSON.stringify(meta) : null);
  if (recipient === 'worker' && st === 'pending') {
    try { fs.writeFileSync(cfg.WORKER_INBOX_FLAG, now()); } catch (_) {}
  }
  return { id, status: st, actionable: recipient === 'pm' && st === 'pending' };
}

// Atomically claim pending messages for the worker. Returns the claimed rows.
function claimWorkerMessages() {
  const d = db();
  const rows = d.prepare(`SELECT * FROM messages WHERE recipient='worker' AND status='pending' ORDER BY ts`).all();
  const claimed = [];
  const upd = d.prepare(`UPDATE messages SET status='delivered', delivered_at=?, attempts=attempts+1 WHERE id=? AND status='pending'`);
  for (const r of rows) {
    const res = upd.run(now(), r.id);
    if (res.changes === 1) claimed.push(r);
  }
  const left = d.prepare(`SELECT COUNT(*) n FROM messages WHERE recipient='worker' AND status='pending'`).get().n;
  if (left === 0) { try { fs.unlinkSync(cfg.WORKER_INBOX_FLAG); } catch (_) {} }
  return claimed;
}

function formatForWorker(rows) {
  const lines = rows.map(r => {
    let s = `[Lorewood PM → worker | ${r.id} | ${r.type}${r.decision_id ? ' | decision ' + r.decision_id : ''}${r.task_id ? ' | task ' + r.task_id : ''}]\n${r.content}`;
    return s;
  });
  return `Message(s) from the Lorewood Production Manager via the production bus:\n\n${lines.join('\n\n')}\n\n` +
    `Acknowledge each one when you have read it: node "C:/Local Disk D/MyClaudeApp/bus/lw.js" ack <id> --note "<what you will do>". ` +
    `If you are mid-operation, finish the current step safely first; these messages do not require interrupting a running process.`;
}

module.exports = { db, now, newId, logEvent, setStatus, getStatus, allStatus, addMessage, claimWorkerMessages, formatForWorker };
