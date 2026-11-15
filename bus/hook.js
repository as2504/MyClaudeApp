#!/usr/bin/env node
// Claude Code command hooks for the WORKER session (configured in the production
// folder's .claude/settings.json). Pure scripts: they record events and deliver PM
// messages without calling any AI model. Usage: node hook.js <event>
'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const event = process.argv[2];
let input = {};
try { const raw = fs.readFileSync(0, 'utf8'); if (raw.trim()) input = JSON.parse(raw); } catch (_) {}
const sid = input.session_id || '';

// ---- Fast path for PostToolUse: no inbox flag → nothing to do (no DB open). ----
if (event === 'post-tool' && !fs.existsSync(cfg.WORKER_INBOX_FLAG)) process.exit(0);

const B = require('./db');

function isWorker() {
  if (!sid) return false;
  const c = cfg.load();
  if ((c.excludeSessionIds || []).includes(sid)) return false;
  if (c.workerSessionId === sid) return true;
  const workerState = B.getStatus('worker_state');
  if (!c.workerSessionId || (event === 'session-start' && workerState === 'ended')) {
    cfg.save({ workerSessionId: sid });
    B.logEvent('hook', 'worker_adopted', { sid, previous: c.workerSessionId || null });
    B.setStatus('worker_session', sid);
    return true;
  }
  return false;
}

function emit(obj) { process.stdout.write(JSON.stringify(obj)); }

const PROTOCOL = `This session is the Lorewood Films WORKER. A Production Manager (PM) coordinates production through a shared bus.
Bus command: node "C:/Local Disk D/MyClaudeApp/bus/lw.js" <command>
At natural task boundaries (not in the middle of a running operation) report with:
- send --type started "<important task you are beginning>"   (for long renders/TTS: report the start, then completion when it really finishes)
- send --type completed "<what finished, where the output is>"
- send --type plan "<what you will do next>"
- send --type review --file "<path>" --title "<short title>" "<what the user should check>"   (copies the file for phone review; originals are untouched)
- send --type error "<significant error and its impact>"
- ask "<question>" --options "A|B|C" --context "<why>" --recommend "A"   then end your turn or continue independent work; the answer is delivered here automatically
- report-user-decision "<what the user decided>"   when the user answers you directly in this session
- ack <message-id> --note "<what you will do>"   for every PM message you receive
PM messages arrive automatically as context at safe checkpoints. Routine progress pings are not needed.`;

function deliverAsContext(hookEventName) {
  const rows = B.claimWorkerMessages();
  if (!rows.length) return false;
  B.logEvent('hook', 'delivered', { via: hookEventName, ids: rows.map(r => r.id) });
  emit({ hookSpecificOutput: { hookEventName, additionalContext: B.formatForWorker(rows) } });
  return true;
}

function quickNotify(kind, title, body, minGapMinutes = 15) {
  // Rule-based user alert (no AI), rate-limited per kind.
  const key = 'last_alert_' + kind;
  const last = B.getStatus(key);
  if (last && Date.now() - Date.parse(last) < minGapMinutes * 60000) return;
  B.setStatus(key, B.now());
  const id = B.newId('n');
  B.db().prepare(`INSERT INTO notifications(id,ts,title,body,url,priority,status) VALUES (?,?,?,?,?,?,?)`)
    .run(id, B.now(), title, String(body || '').slice(0, 300), '/#/', 'high', 'queued');
}

function main() {
  switch (event) {
    case 'session-start': {
      if (!isWorker()) return;
      B.setStatus('worker_state', 'working');
      B.setStatus('worker_last_seen', B.now());
      B.logEvent('worker', 'session_start', { source: input.source });
      B.addMessage({ sender: 'system', recipient: 'pm', type: 'session_start', content: `Worker session started (${input.source || 'startup'}).`, status: 'noted' });
      const rows = B.claimWorkerMessages();
      emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: PROTOCOL + (rows.length ? '\n\n' + B.formatForWorker(rows) : '') } });
      return;
    }
    case 'user-prompt': {
      if (!isWorker()) return;
      B.setStatus('worker_state', 'working');
      B.setStatus('worker_last_seen', B.now());
      B.setStatus('user_last_direct', B.now());
      deliverAsContext('UserPromptSubmit');
      return;
    }
    case 'post-tool': {
      if (!isWorker()) return;
      B.setStatus('worker_last_seen', B.now());
      deliverAsContext('PostToolUse');
      return;
    }
    case 'stop': {
      if (!isWorker()) return;
      const bg = Array.isArray(input.background_tasks) ? input.background_tasks.length : 0;
      B.setStatus('worker_last_seen', B.now());
      B.setStatus('worker_state', bg ? 'idle_background_running' : 'idle');
      B.setStatus('worker_background_tasks', bg);
      if (input.last_assistant_message) B.setStatus('worker_last_reply', String(input.last_assistant_message).slice(0, 600));
      const rows = B.claimWorkerMessages();
      if (rows.length) {
        B.logEvent('hook', 'delivered', { via: 'Stop', ids: rows.map(r => r.id) });
        B.setStatus('worker_state', 'working');
        emit({ decision: 'block', reason: B.formatForWorker(rows) });
      }
      return;
    }
    case 'listen': {
      // asyncRewake Stop hook: waits (no tokens) for a PM message while the worker is idle,
      // then exits 2 so Claude Code wakes the session with the message.
      if (!isWorker()) return;
      const pidFile = path.join(cfg.DATA, 'listener.pid');
      const me = String(process.pid);
      fs.writeFileSync(pidFile, me);
      const started = Date.now();
      const maxMs = 23 * 3600 * 1000;
      const tick = () => {
        let owner = '';
        try { owner = fs.readFileSync(pidFile, 'utf8').trim(); } catch (_) {}
        if (owner !== me) process.exit(0);                       // a newer listener took over
        if (Date.now() - started > maxMs) process.exit(0);
        if (fs.existsSync(cfg.WORKER_INBOX_FLAG)) {
          if (B.getStatus('worker_state') === 'ended') process.exit(0);
          const rows = B.claimWorkerMessages();
          if (rows.length) {
            B.logEvent('hook', 'delivered', { via: 'asyncRewake', ids: rows.map(r => r.id) });
            B.setStatus('worker_state', 'working');
            process.stderr.write(B.formatForWorker(rows));
            process.exit(2);
          }
        }
        setTimeout(tick, 3000);
      };
      B.setStatus('listener_since', B.now());
      tick();
      return 'async';
    }
    case 'notification': {
      if (!isWorker()) return;
      const t = input.notification_type || '';
      B.logEvent('worker', 'notification', { type: t, message: input.message });
      if (['permission_prompt', 'agent_needs_input', 'elicitation_dialog', 'elicitation_url_dialog'].includes(t)) {
        B.setStatus('worker_state', 'needs_input');
        B.setStatus('worker_needs_input', `${t}: ${String(input.message || '').slice(0, 200)}`);
        quickNotify('needs_input', 'Worker is waiting for you', `${input.message || 'The worker session needs input'} (approve it in the Claude app on the laptop).`);
      }
      return;
    }
    case 'stop-failure': {
      if (!isWorker()) return;
      const err = String(input.error || 'unknown') + ': ' + String(input.last_assistant_message || '').slice(0, 300);
      B.setStatus('worker_state', 'error');
      B.setStatus('last_error', err);
      B.addMessage({ sender: 'system', recipient: 'pm', type: 'error', content: 'Worker turn failed: ' + err });
      quickNotify('stop_failure', 'Worker hit an error', err, 30);
      require('./kick').kick();
      return;
    }
    case 'session-end': {
      if (!isWorker()) return;
      B.setStatus('worker_state', 'ended');
      B.logEvent('worker', 'session_end', { reason: input.reason });
      B.addMessage({ sender: 'system', recipient: 'pm', type: 'session_end', content: `Worker session ended (${input.reason || 'unknown'}).`, status: 'noted' });
      return;
    }
  }
}

try {
  const r = main();
  if (r !== 'async') process.exit(0);
} catch (e) {
  try { fs.appendFileSync(path.join(cfg.LOG_DIR, 'hook-errors.log'), `${new Date().toISOString()} ${event} ${e.stack}\n`); } catch (_) {}
  process.exit(0);   // never disrupt the worker because of a bus problem
}
