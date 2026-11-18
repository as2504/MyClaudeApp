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

// The worker is ONE session, but its conversation id changes when the desktop session is cleared,
// compacted into a new conversation, or restarted. Follow it: a new conversation in the production
// folder becomes the worker when the user is driving it (session start / prompt) or when the
// previous worker has gone quiet. Never the excluded builder session.
function isWorker() {
  if (!sid) return false;
  const c = cfg.load();
  if ((c.excludeSessionIds || []).includes(sid)) return false;
  if (c.workerSessionId === sid) return true;
  const lastSeen = Date.parse(B.getStatus('worker_last_seen') || 0) || 0;
  const quiet = Date.now() - lastSeen > 10 * 60000;
  const driven = event === 'session-start' || event === 'user-prompt';
  if (!c.workerSessionId || driven || quiet || B.getStatus('worker_state') === 'ended') {
    cfg.save({ workerSessionId: sid });
    B.logEvent('hook', 'worker_adopted', { sid, previous: c.workerSessionId || null, via: event });
    B.setStatus('worker_session', sid);
    return true;
  }
  return false;
}

// Teach the protocol once to every new worker conversation (SessionStart may not fire for it).
function protocolOnce() {
  const key = 'protocol_sent_' + sid;
  if (B.getStatus(key)) return '';
  B.setStatus(key, B.now());
  return PROTOCOL + '\n\n';
}

// A turn that ends by asking the user something, inside the worker session, must reach the phone.
function looksLikeQuestion(msg) {
  const tail = String(msg || '').trim().slice(-500);
  if (!tail) return false;
  if (/\?\s*[*_)"'`]*\s*$/.test(tail)) return true;
  return /\b(should I|shall I|do you want|would you like|want me to|which (one|option|do you)|let me know|your (call|approval|ok|go-ahead|decision)|approve|confirm (?:that|whether|if)|waiting (for|on) (you|your))\b/i.test(tail);
}
function directAsk(msg) {
  const d = B.db();
  const text = String(msg).trim();
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const qLine = [...lines].reverse().find(l => /\?/.test(l)) || lines[lines.length - 1] || 'The worker is waiting for your reply';
  const question = qLine.replace(/^[#>*\-\s]+/, '').replace(/\*\*/g, '').slice(0, 200);
  const context = text.length > 2500 ? '…' + text.slice(-2500) : text;
  const prev = d.prepare(`SELECT id, context FROM decisions WHERE source='direct' AND status='open' ORDER BY ts DESC LIMIT 1`).get();
  if (prev && prev.context === context) return;                  // same question already on the phone
  d.prepare(`UPDATE decisions SET status='closed', comment='Superseded by a newer worker question', answered_by='system', answered_at=? WHERE source='direct' AND status='open'`).run(B.now());
  const id = B.newId('d');
  d.prepare(`INSERT INTO decisions(id,ts,asked_by,asked_of,question,context,options,status,importance,project,source)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, B.now(), 'worker', 'user', question, context, '[]', 'open', 'normal', B.currentProject(), 'direct');
  const nid = B.newId('n');
  d.prepare(`INSERT INTO notifications(id,ts,title,body,url,priority,status,related_id) VALUES (?,?,?,?,?,?,?,?)`)
    .run(nid, B.now(), 'Worker is waiting for your answer', question.slice(0, 300), '/#/decisions/' + id, 'high', 'queued', id);
  B.setStatus('worker_state', 'waiting_for_user');
  B.logEvent('hook', 'direct_ask', { id });
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
- ask "<question>" --options "A|B|C" --context "<why>" --recommend "A" [--attach "<path>"]   then end your turn or continue independent work; the answer is delivered here automatically.
  If the question is about a patch, draft or file, ALWAYS --attach it (patches render as a readable diff on the user's phone)
- report-user-decision "<what the user decided>"   when the user answers you directly in this session
- ack <message-id> --note "<what you will do>"   for every PM message you receive
PM messages arrive automatically as context at safe checkpoints. Routine progress pings are not needed.`;

function deliverAsContext(hookEventName) {
  const intro = protocolOnce();
  const rows = B.claimWorkerMessages();
  if (!rows.length && !intro) return false;
  if (rows.length) B.logEvent('hook', 'delivered', { via: hookEventName, ids: rows.map(r => r.id) });
  emit({ hookSpecificOutput: { hookEventName, additionalContext: intro + (rows.length ? B.formatForWorker(rows) : '') } });
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
      B.setStatus('protocol_sent_' + sid, B.now());
      emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: PROTOCOL + (rows.length ? '\n\n' + B.formatForWorker(rows) : '') } });
      return;
    }
    case 'user-prompt': {
      if (!isWorker()) return;
      B.setStatus('worker_state', 'working');
      B.setStatus('worker_last_seen', B.now());
      B.setStatus('user_last_direct', B.now());
      // The user is answering on the laptop: questions waiting on the phone are no longer needed.
      B.db().prepare(`UPDATE decisions SET status='closed', comment='Answered directly in the worker session', answered_by='user (laptop)', answered_at=? WHERE source='direct' AND status='open'`).run(B.now());
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
      // Only real PM messages may block a stop (the protocol intro waits for the next prompt, so a
      // question the worker is ending on is never pushed aside).
      const rows = B.claimWorkerMessages();
      if (rows.length) {
        B.logEvent('hook', 'delivered', { via: 'Stop', ids: rows.map(r => r.id) });
        B.setStatus('worker_state', 'working');
        emit({ decision: 'block', reason: protocolOnce() + B.formatForWorker(rows) });
        return;
      }
      if (!input.stop_hook_active && looksLikeQuestion(input.last_assistant_message)) directAsk(input.last_assistant_message);
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
            process.stderr.write(protocolOnce() + B.formatForWorker(rows));
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
