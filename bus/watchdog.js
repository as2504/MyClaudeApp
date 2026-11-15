// 10-minute watchdog (Windows Task Scheduler). Plain local checks — never calls an AI model
// itself. It only kicks the PM trigger when actionable messages are waiting and no PM run is active.
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const cfg = require('./config');
const B = require('./db');

function serverHealthy(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/healthz', timeout: 4000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function startServer() {
  const logPath = path.join(cfg.LOG_DIR, 'server.log');
  const fd = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, [path.join(cfg.REPO, 'server', 'server.js')], {
    detached: true, stdio: ['ignore', fd, fd], windowsHide: true, cwd: cfg.REPO,
  });
  child.unref();
}

function claudeRunning() {
  const r = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
  const s = (r.stdout || '').toLowerCase();
  return { desktop: s.includes('"claude.exe"'), };
}

async function run() {
  const c = cfg.load();
  const d = B.db();
  const changes = [];

  // 1. Phone backend alive?
  if (!(await serverHealthy(c.port))) { startServer(); changes.push('server restarted'); B.logEvent('watchdog', 'server_restart'); }

  // 2. Worker process / session state (records only).
  const proc = claudeRunning();
  B.setStatus('claude_process', proc.desktop ? 'running' : 'not running');
  const ws = B.getStatus('worker_state');
  if (!proc.desktop && ws && ws !== 'ended' && ws !== 'app_closed') {
    B.setStatus('worker_state', 'app_closed');
    require('./lw').queueNotification({ title: 'Claude app is not running', body: 'The worker session cannot continue until the Claude app is open on the laptop.', priority: 'high' });
    changes.push('claude app not running');
  }

  // 3. PM → worker messages delivered but never acknowledged while the worker went idle → redeliver (bounded).
  const cutoff = new Date(Date.now() - c.redeliverAfterMinutes * 60000).toISOString();
  const lastSeen = B.getStatus('worker_last_seen') || '';
  const stale = d.prepare(`SELECT id, attempts, delivered_at FROM messages WHERE recipient='worker' AND status='delivered' AND delivered_at < ?`).all(cutoff);
  for (const m of stale) {
    const idleSince = (ws === 'idle' || ws === 'idle_background_running') && lastSeen > m.delivered_at;
    if (!idleSince) continue;                                           // still busy: leave it alone
    if (m.attempts < 3) {
      d.prepare(`UPDATE messages SET status='pending' WHERE id=? AND status='delivered'`).run(m.id);
      fs.writeFileSync(cfg.WORKER_INBOX_FLAG, B.now());
      changes.push('redeliver ' + m.id);
    } else {
      d.prepare(`UPDATE messages SET status='failed' WHERE id=?`).run(m.id);
      B.addMessage({ sender: 'system', recipient: 'pm', type: 'alert', content: `Worker never acknowledged ${m.id} after 3 deliveries.` });
      changes.push('unacked ' + m.id);
    }
  }

  // 4. Actionable messages waiting for the PM?
  const lockActive = fs.existsSync(cfg.PM_LOCK);
  const waiting = d.prepare(`SELECT COUNT(*) n FROM messages WHERE recipient='pm' AND status='pending'`).get().n;
  if (waiting && !lockActive) { require('./kick').kick(); changes.push(`PM kicked for ${waiting} message(s)`); }

  // 5. Notifications queued for too long (server down / no subscription) are reported on the dashboard only.
  B.setStatus('watchdog_last_run', B.now());
  if (changes.length) B.logEvent('watchdog', 'actions', changes);
}

module.exports = { run };
