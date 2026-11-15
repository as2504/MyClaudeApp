#!/usr/bin/env node
// lw — Lorewood production bus CLI. Used by the worker session, the PM, the watchdog and humans.
// All routine communication is plain database work: no AI model is called from here,
// except `lw trigger`, which starts a headless PM run only when actionable messages exist.
'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const B = require('./db');
const { kick } = require('./kick');

function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      if (opt[k] !== undefined) opt[k] = [].concat(opt[k], v); else opt[k] = v;
    } else pos.push(a);
  }
  return { pos, opt };
}
const out = (o) => process.stdout.write((typeof o === 'string' ? o : JSON.stringify(o, null, 2)) + '\n');
const die = (m) => { process.stderr.write('lw: ' + m + '\n'); process.exit(1); };
const splitOpts = (s) => (s && s !== true) ? String(s).split('|').map(x => x.trim()).filter(Boolean) : [];

function queueNotification({ title, body, url = '/', priority = 'normal', related = null }) {
  const id = B.newId('n');
  B.db().prepare(`INSERT INTO notifications(id,ts,title,body,url,priority,status,related_id) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, B.now(), String(title).slice(0, 120), body ? String(body).slice(0, 400) : null, url, priority, 'queued', related);
  return id;
}

function workerSend(opt, content) {
  const type = opt.type || 'update';
  let file_id = null;
  if (opt.file) {
    const files = require('./files');
    const f = files.upload(opt.file, { title: opt.title, note: content, uploadedBy: 'worker', taskId: opt.task || null });
    file_id = f.id;
  }
  let decision_id = opt.decision || null;
  if ((type === 'question' || type === 'decision_request') && !decision_id) {
    decision_id = B.newId('d');
    B.db().prepare(`INSERT INTO decisions(id,ts,asked_by,asked_of,question,context,options,recommendation,status,task_id,importance)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(decision_id, B.now(), 'worker', 'pm', content, opt.context || null, JSON.stringify(splitOpts(opt.options)),
        opt.recommend || null, 'open', opt.task || null, opt.importance || 'normal');
  }
  const m = B.addMessage({ sender: 'worker', recipient: 'pm', type, content, task_id: opt.task || null, decision_id, file_id,
    meta: opt.context ? { context: opt.context } : null });
  // Status bookkeeping (no AI).
  if (type === 'started') { B.setStatus('current_task', content.slice(0, 200)); B.setStatus('worker_state', 'working'); }
  if (type === 'completed') B.setStatus('last_completed', content.slice(0, 200));
  if (type === 'plan') B.setStatus('worker_next', content.slice(0, 300));
  if (type === 'question' || type === 'decision_request') B.setStatus('worker_state', 'waiting_for_decision');
  if (type === 'error') B.setStatus('last_error', content.slice(0, 300));
  B.logEvent('worker', 'message', { id: m.id, type });
  const res = { id: m.id, status: m.status };
  if (file_id) res.file_id = file_id;
  if (decision_id) res.decision_id = decision_id;
  if (m.actionable) res.pm = 'PM will be notified (' + kick() + ')';
  if (type === 'question' || type === 'decision_request')
    res.next = 'End your turn now (or continue with independent work). The answer will be delivered to this session automatically.';
  return res;
}

function digest() {
  const d = B.db();
  const pending = d.prepare(`SELECT * FROM messages WHERE recipient='pm' AND status IN ('pending','processing') ORDER BY ts`).all();
  const st = B.allStatus();
  const openDec = d.prepare(`SELECT id,asked_by,asked_of,question,options,recommendation,status,answer,comment,answered_by FROM decisions WHERE status IN ('open','answered') ORDER BY ts`).all();
  const files = d.prepare(`SELECT id,title,original_path,kind,status,review_comment FROM files WHERE status NOT IN ('archived') ORDER BY ts DESC LIMIT 15`).all();
  const recent = d.prepare(`SELECT id,ts,sender,recipient,type,substr(content,1,300) content,status FROM messages ORDER BY ts DESC LIMIT 20`).all().reverse();
  const unacked = d.prepare(`SELECT id,ts,type,status,substr(content,1,160) content FROM messages WHERE recipient='worker' AND status IN ('pending','delivered') ORDER BY ts`).all();
  const flat = {}; for (const k of Object.keys(st)) flat[k] = st[k].value;
  return { now: B.now(), status: flat, actionable: pending, open_decisions: openDec, worker_unacknowledged: unacked, files, recent_history: recent };
}

function pmCmd(sub, pos, opt) {
  const d = B.db();
  switch (sub) {
    case 'digest': return out(digest());
    case 'tell-worker': {
      const text = pos.join(' ') || die('message text required');
      const m = B.addMessage({ sender: 'pm', recipient: 'worker', type: opt.type || 'instruction', content: text,
        decision_id: opt.decision || null, task_id: opt.task || null });
      B.logEvent('pm', 'to_worker', { id: m.id });
      return out({ id: m.id, status: 'pending', note: 'Delivered to the worker at its next tool call, stop, or immediately if idle. Delivery is confirmed only when the worker acknowledges.' });
    }
    case 'tell-user': {
      const text = pos.join(' ') || die('message text required');
      const m = B.addMessage({ sender: 'pm', recipient: 'user', type: opt.type || 'pm_reply', content: text, status: 'pending',
        decision_id: opt.decision || null });
      let n = null;
      if (opt.notify) n = queueNotification({ title: opt.title || 'Lorewood PM', body: text, url: '/#/chat', priority: opt.priority || 'normal', related: m.id });
      return out({ id: m.id, notification: n });
    }
    case 'ask-user': {
      const q = opt.question || pos.join(' ') || die('--question required');
      const id = B.newId('d');
      d.prepare(`INSERT INTO decisions(id,ts,asked_by,asked_of,question,context,options,recommendation,status,task_id,importance,source_message_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, B.now(), 'pm', 'user', q, opt.context || null, JSON.stringify(splitOpts(opt.options)), opt.recommend || null,
          'open', opt.task || null, opt.importance || 'normal', opt.from || null);
      const n = queueNotification({ title: 'Decision needed', body: q, url: '/#/decisions', priority: opt.importance === 'high' ? 'high' : 'normal', related: id });
      B.addMessage({ sender: 'pm', recipient: 'user', type: 'decision_request', content: q, decision_id: id, status: 'pending' });
      return out({ decision_id: id, notification: n });
    }
    case 'answer': {
      const [did, ...rest] = pos; const ans = rest.join(' ') || opt.answer || die('answer text required');
      const dec = d.prepare('SELECT * FROM decisions WHERE id=?').get(did) || die('no decision ' + did);
      d.prepare(`UPDATE decisions SET status='closed', answer=?, comment=?, answered_by='pm', answered_at=? WHERE id=?`)
        .run(ans, opt.comment || null, B.now(), did);
      let m = null;
      if (dec.asked_by === 'worker' && !opt['no-relay']) {
        m = B.addMessage({ sender: 'pm', recipient: 'worker', type: 'decision', content: `Decision on "${dec.question.slice(0, 200)}": ${ans}`, decision_id: did });
      }
      return out({ decision_id: did, relayed_to_worker: m ? m.id : null });
    }
    case 'close-decision': {
      const [did] = pos;
      d.prepare(`UPDATE decisions SET status='closed' WHERE id=?`).run(did);
      return out({ closed: did });
    }
    case 'upload': {
      const files = require('./files');
      const f = files.upload(pos[0] || die('path required'), { title: opt.title, note: opt.note, uploadedBy: 'pm', status: 'awaiting_pm' });
      return out(f);
    }
    case 'request-review': {
      const [fid] = pos;
      const f = d.prepare('SELECT * FROM files WHERE id=?').get(fid) || die('no file ' + fid);
      d.prepare(`UPDATE files SET status='pending_review', note=COALESCE(?, note) WHERE id=?`).run(opt.note || null, fid);
      const n = queueNotification({ title: 'Ready for your review', body: (opt.note || f.title).slice(0, 300), url: '/#/files/' + fid, related: fid });
      return out({ file: fid, notification: n });
    }
    case 'set': {
      for (const kv of pos) { const i = kv.indexOf('='); if (i > 0) B.setStatus(kv.slice(0, i), kv.slice(i + 1)); }
      return out(B.allStatus());
    }
    case 'done': {
      const ids = opt['all-processing']
        ? d.prepare(`SELECT id FROM messages WHERE recipient='pm' AND status='processing'`).all().map(r => r.id) : pos;
      const u = d.prepare(`UPDATE messages SET status='processed', processed_at=? WHERE id=? AND recipient='pm'`);
      for (const id of ids) u.run(B.now(), id);
      if (opt.summary) B.setStatus('pm_last_summary', opt.summary);
      return out({ processed: ids });
    }
    case 'memory': {
      if (opt.set) { B.setStatus('pm_memory', opt.set); return out('memory saved'); }
      return out(B.getStatus('pm_memory') || '(empty)');
    }
    case 'notify': {
      const n = queueNotification({ title: opt.title || 'Lorewood PM', body: opt.body || pos.join(' '), url: opt.url || '/', priority: opt.priority || 'normal' });
      return out({ notification: n, note: 'Queued. Delivery is confirmed only when the phone acknowledges it.' });
    }
    default: die('unknown pm command: ' + sub);
  }
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parseArgs(rest);
  switch (cmd) {
    case 'send': return out(workerSend(opt, pos.join(' ') || die('message text required')));
    case 'ask': return out(workerSend(Object.assign({ type: 'decision_request' }, opt), pos.join(' ') || die('question required')));
    case 'ack': {
      const ids = pos.length ? pos : die('message id required');
      const res = [];
      for (const id of ids) {
        const r = B.db().prepare(`UPDATE messages SET status='acknowledged', acked_at=?, ack_note=? WHERE id=? AND recipient='worker' AND status IN ('pending','delivered')`)
          .run(B.now(), opt.note ? String(opt.note) : null, id);
        res.push({ id, acknowledged: r.changes === 1 });
      }
      B.setStatus('worker_last_ack', B.now());
      return out(res);
    }
    case 'inbox': {
      const rows = B.claimWorkerMessages();
      return out(rows.length ? B.formatForWorker(rows) : 'No new messages from the PM.');
    }
    case 'report-user-decision': {
      // Worker: the user answered directly in the worker session; keep central records accurate.
      const text = pos.join(' ');
      if (opt.decision) B.db().prepare(`UPDATE decisions SET status='closed', answer=?, answered_by='user (direct)', answered_at=? WHERE id=?`).run(text, B.now(), opt.decision);
      return out(workerSend({ type: 'user_decision', decision: opt.decision }, text));
    }
    case 'status': return out(digest().status);
    case 'pm': return pmCmd(pos[0], pos.slice(1), opt);
    case 'trigger': return require('./trigger').run({ now: !!opt.now });
    case 'watchdog': return require('./watchdog').run();
    case 'config': {
      if (opt.set) { const [k, ...v] = String(opt.set).split('='); let val = v.join('='); try { val = JSON.parse(val); } catch (_) {} return out(cfg.save({ [k]: val })); }
      return out(cfg.load());
    }
    case 'init': { B.db(); return out({ db: cfg.DB_PATH, config: cfg.load() }); }
    default:
      out(`lw — Lorewood production bus
Worker:  send --type started|completed|plan|question|decision_request|error|review|update [--task T] [--file PATH --title T] [--options "A|B"] [--recommend X] "text"
         ask "question" --options "A|B|C" [--context "..."] [--recommend "A"]
         ack <message-id> [--note "..."]      inbox      status
         report-user-decision [--decision D] "what the user decided"
PM:      pm digest | tell-worker | tell-user [--notify] | ask-user | answer | request-review | upload | set k=v | done | memory | notify
System:  trigger [--now] | watchdog | config [--set k=v] | init`);
  }
}

module.exports = { digest, queueNotification };   // exported before main() (trigger.js requires this module)
if (require.main === module) {
  try { main(); } catch (e) { die(e.message); }
}
