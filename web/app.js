'use strict';
(() => {
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (iso) => {
  if (!iso) return '—';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago'; return new Date(iso).toLocaleDateString();
};
const clock = (iso) => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const label = (s) => String(s || '').replace(/_/g, ' ');
let S = null;               // last /api/state
let route = '';

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}

async function api(path, opts = {}) {
  const o = Object.assign({ credentials: 'same-origin', headers: {} }, opts);
  if (o.body && typeof o.body !== 'string') { o.body = JSON.stringify(o.body); o.headers['Content-Type'] = 'application/json'; }
  let r;
  try { r = await fetch(path, o); } catch (e) { $('#conn').className = 'conn bad'; throw e; }
  $('#conn').className = 'conn ok';
  if (r.status === 401 && path !== '/api/login') { showLogin(); throw new Error('login'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

function showLogin() {
  $('#tabs').style.display = 'none';
  view.innerHTML = $('#login-tpl').innerHTML;
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/login', { method: 'POST', body: { key: $('#key').value.trim() } }); $('#tabs').style.display = ''; render(); }
    catch (err) { $('#login-err').textContent = err.message; }
  };
}

function badges() {
  if (!S) return;
  const set = (id, n) => { const b = $(id); b.textContent = n; b.classList.toggle('show', n > 0); };
  set('#b-chat', S.unread_pm); set('#b-dec', S.decisions_open); set('#b-files', S.files_pending);
}
async function refreshState() { S = await api('/api/state'); badges(); return S; }
const st = (k) => S && S.status[k] ? S.status[k].value : null;
const stAt = (k) => S && S.status[k] ? S.status[k].updated_at : null;

// ---------- Dashboard ----------
async function home() {
  await refreshState();
  const prog = Math.max(0, Math.min(100, parseInt(st('progress') || '0', 10) || 0));
  const ws = st('worker_state') || 'unknown';
  const needs = ws === 'needs_input' ? `<div class="recbox">⚠ ${esc(st('worker_needs_input') || 'The worker is waiting for input on the laptop.')}</div>` : '';
  view.innerHTML = `
  <section class="card hero">
    <h2>Current project</h2>
    <div class="film">${esc(st('project') || 'No project set')}</div>
    <span class="stage">${esc(st('stage') || 'stage not set')}</span>
    <div class="progress"><i style="width:${prog}%"></i></div>
    <div class="row between small muted"><span>Overall progress</span><span>${prog}%</span></div>
    ${st('next_step') ? `<p class="small" style="margin:10px 0 0"><span class="muted">Next:</span> ${esc(st('next_step'))}</p>` : ''}
  </section>
  <section class="grid2 grid4" style="margin-bottom:14px">
    <a class="stat ${S.decisions_open ? 'hot' : ''}" href="#/decisions"><b>${S.decisions_open}</b><span>Decisions</span></a>
    <a class="stat ${S.files_pending ? 'hot' : ''}" href="#/files"><b>${S.files_pending}</b><span>To review</span></a>
    <a class="stat ${S.unread_pm ? 'hot' : ''}" href="#/chat"><b>${S.unread_pm}</b><span>PM replies</span></a>
    <div class="stat"><b>${S.pm_waiting}</b><span>PM queue</span></div>
  </section>
  <section class="card">
    <div class="row between"><h2 style="margin:0">Worker</h2><span class="pill ${esc(ws)}">${esc(label(ws))}</span></div>
    ${needs}
    <dl class="kv" style="margin-top:12px">
      <dt>Task</dt><dd>${esc(st('current_task') || '—')}</dd>
      <dt>Last done</dt><dd>${esc(st('last_completed') || '—')}</dd>
      <dt>Plans next</dt><dd>${esc(st('worker_next') || '—')}</dd>
      <dt>Last seen</dt><dd>${ago(st('worker_last_seen'))}</dd>
      <dt>Unacked</dt><dd>${S.worker_unacked} PM message(s)</dd>
    </dl>
  </section>
  <section class="card">
    <div class="row between"><h2 style="margin:0">Production manager</h2><span class="pill ${esc(st('pm_state') || 'idle')}">${esc(label(st('pm_state') || 'idle'))}</span></div>
    <p class="small" style="margin:10px 0 0">${esc(st('pm_last_summary') || 'No PM run yet.')}</p>
    <p class="tiny muted" style="margin:6px 0 0">Last run ${ago(st('pm_last_run'))} · watchdog ${ago(st('watchdog_last_run'))}</p>
  </section>
  <section class="card"><h2>Recent activity</h2>${feed(S.activity.slice(0, 15))}</section>`;
}

function feed(rows) {
  if (!rows.length) return '<p class="empty">Nothing yet.</p>';
  return `<ul class="feed">${rows.map(r => `
    <li><span class="who ${esc(r.sender)}">${esc(r.sender.slice(0, 2).toUpperCase())}</span>
      <div><div class="meta">${esc(r.sender)} → ${esc(r.recipient)} · ${esc(label(r.type))} · ${ago(r.ts)} · <span class="pill ${esc(r.status)}">${esc(r.status)}</span></div>
      <div class="txt">${esc(r.content)}</div></div></li>`).join('')}</ul>`;
}

// ---------- Ask PM ----------
let chatTimer = null;
async function chat() {
  const j = await api('/api/chat');
  refreshState().catch(() => {});
  const waiting = j.messages.length && j.messages[j.messages.length - 1].sender === 'user';
  view.innerHTML = `
  <div class="chat" id="chatlog">
    ${j.messages.length ? '' : '<p class="empty">Ask the PM anything about production — status, priorities, changes. It answers here and can instruct the worker.</p>'}
    ${j.messages.map(m => `<div class="bubble ${m.sender === 'user' ? 'user' : 'pm'}">${esc(m.content)}<span class="t">${clock(m.ts)}${m.sender === 'user' ? ' · ' + esc(label(m.status)) : ''}</span></div>`).join('')}
    ${waiting || j.pm_state === 'thinking' ? '<div class="thinking">PM is reading… replies usually take a minute or two.</div>' : ''}
  </div>
  <div class="composer"><form id="cf"><textarea id="ct" rows="2" placeholder="Message the PM…" maxlength="4000"></textarea><button class="btn primary" type="submit">Send</button></form></div>`;
  const log = $('#chatlog'); window.scrollTo(0, document.body.scrollHeight);
  $('#cf').onsubmit = async (e) => {
    e.preventDefault();
    const t = $('#ct').value.trim(); if (!t) return;
    e.submitter && (e.submitter.disabled = true);
    try { await api('/api/chat', { method: 'POST', body: { text: t } }); chat(); } catch (err) { toast(err.message); e.submitter && (e.submitter.disabled = false); }
  };
  clearTimeout(chatTimer);
  if (waiting || j.pm_state === 'thinking') chatTimer = setTimeout(() => route === 'chat' && chat(), 8000);
}

// ---------- Decisions ----------
async function decisions() {
  const j = await api('/api/decisions');
  refreshState().catch(() => {});
  const open = j.decisions.filter(d => d.status === 'open'), done = j.decisions.filter(d => d.status !== 'open');
  view.innerHTML = `
    ${open.length ? open.map(decCard).join('') : '<div class="card empty">No decisions waiting for you. 🎬</div>'}
    ${done.length ? `<section class="card"><h2>Answered</h2><ul class="feed">${done.map(d => `<li><span class="who user">✓</span><div>
      <div class="meta">${clock(d.answered_at || d.ts)} · <span class="pill ${esc(d.status)}">${esc(d.status)}</span></div>
      <div class="txt"><b>${esc(d.question)}</b>\n→ ${esc(d.answer || '')}${d.comment ? '\n“' + esc(d.comment) + '”' : ''}</div></div></li>`).join('')}</ul></section>` : ''}`;
  for (const f of view.querySelectorAll('form[data-dec]')) f.onsubmit = submitDecision;
}
function decCard(d) {
  const recIdx = d.options.findIndex(o => d.recommendation && (d.recommendation.startsWith(o) || o.startsWith(d.recommendation)));
  return `<form class="card" data-dec="${esc(d.id)}">
    <div class="row between"><h2 style="margin:0">${d.importance === 'high' ? 'Important decision' : 'Decision'}</h2><span class="tiny muted">${ago(d.ts)}</span></div>
    <h3 style="margin-top:8px">${esc(d.question)}</h3>
    ${d.context ? `<div class="context">${esc(d.context)}</div>` : ''}
    ${d.recommendation ? `<div class="recbox"><span class="rec-tag">PM recommends</span>${esc(d.recommendation)}</div>` : ''}
    ${d.options.map((o, i) => `<label class="opt ${i === recIdx ? 'rec' : ''}"><input type="radio" name="choice" value="${esc(o)}" ${i === recIdx ? 'checked' : ''}><span>${esc(o)}${i === recIdx ? '<span class="rec-tag">Recommended</span>' : ''}</span></label>`).join('')}
    <textarea name="comment" rows="2" placeholder="Additional comments (optional)" style="margin-top:10px"></textarea>
    <div class="btns">
      <button class="btn primary" type="submit">${d.options.length ? 'Submit decision' : 'Send answer'}</button>
      ${d.recommendation && !d.options.length ? `<button class="btn good" type="submit" name="approve" value="1">Approve recommendation</button>` : ''}
    </div></form>`;
}
async function submitDecision(e) {
  e.preventDefault();
  const f = e.target, fd = new FormData(f);
  let choice = fd.get('choice') || '';
  if (e.submitter && e.submitter.name === 'approve') choice = 'Approve PM recommendation';
  const comment = fd.get('comment') || '';
  try { await api('/api/decisions/' + f.dataset.dec, { method: 'POST', body: { choice, comment } }); toast('Sent to the PM'); decisions(); }
  catch (err) { toast(err.message); }
}

// ---------- Files ----------
const ICON = { audio: '♪', video: '▶', image: '▣', text: '¶', pdf: '⎙', other: '◇' };
async function files() {
  const j = await api('/api/files');
  refreshState().catch(() => {});
  view.innerHTML = j.files.length ? `<section class="card">${j.files.map(f => `
    <a class="file" href="#/files/${esc(f.id)}" style="padding:10px 0;border-top:1px solid var(--line)">
      <span class="ficon">${ICON[f.kind] || '◇'}</span>
      <div><div class="row between"><b>${esc(f.title)}</b><span class="pill ${esc(f.status)}">${esc(label(f.status))}</span></div>
      <div class="tiny muted">${esc(f.original_name)} · ${(f.size / 1e6).toFixed(1)} MB · ${ago(f.ts)}</div></div></a>`).join('')}</section>`
    : '<div class="card empty">No files have been shared for review yet.</div>';
}
async function fileDetail(id) {
  const f = await api('/api/files/' + encodeURIComponent(id));
  const src = `/api/files/${encodeURIComponent(id)}/raw`;
  let media = '';
  if (f.kind === 'audio') media = `<audio class="media" controls preload="metadata" src="${src}"></audio>`;
  else if (f.kind === 'video') media = `<video class="media" controls playsinline preload="metadata" src="${src}"></video>`;
  else if (f.kind === 'image') media = `<img class="media" src="${src}" alt="${esc(f.title)}">`;
  else if (f.kind === 'text') media = `<pre class="text">${esc(f.text)}${f.truncated ? '\n\n… (truncated)' : ''}</pre>`;
  else media = `<p><a class="btn" href="${src}?preview=0">Open file</a></p>`;
  view.innerHTML = `
  <p><a href="#/files">← All files</a></p>
  <section class="card">
    <div class="row between"><h2 style="margin:0">${esc(label(f.kind))}</h2><span class="pill ${esc(f.status)}">${esc(label(f.status))}</span></div>
    <h3 style="margin-top:8px">${esc(f.title)}</h3>
    <div class="tiny muted">${esc(f.original_name)} · ${(f.size / 1e6).toFixed(1)} MB${f.has_preview ? ' · phone preview (original kept on laptop)' : ''}</div>
    ${f.note ? `<div class="recbox">${esc(f.note)}</div>` : ''}
    ${media}
    ${f.has_preview ? `<p class="tiny"><a href="${src}?preview=0">Download full-quality copy</a></p>` : ''}
  </section>
  <form class="card" id="rf">
    <h2>Your review</h2>
    ${f.review_comment ? `<p class="small muted">Previous comment: ${esc(f.review_comment)}</p>` : ''}
    <textarea name="comment" rows="3" placeholder="Comments for the PM (timestamps help, e.g. 2:14 too fast)"></textarea>
    <div class="btns">
      <button class="btn good" name="v" value="approved">Approve</button>
      <button class="btn warn" name="v" value="changes_requested">Request changes</button>
      <button class="btn bad" name="v" value="rejected">Reject</button>
      <button class="btn" name="v" value="">Comment only</button>
    </div>
  </form>`;
  $('#rf').onsubmit = async (e) => {
    e.preventDefault();
    const verdict = e.submitter ? e.submitter.value : '';
    const comment = new FormData(e.target).get('comment') || '';
    try { await api(`/api/files/${encodeURIComponent(id)}/review`, { method: 'POST', body: { verdict, comment } }); toast('Review sent to the PM'); fileDetail(id); }
    catch (err) { toast(err.message); }
  };
}

// ---------- Notifications ----------
async function notifications() {
  const j = await api('/api/notifications');
  await refreshState();
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  view.innerHTML = `
  <section class="card">
    <h2>Push notifications</h2>
    <p class="small">This phone: <span class="pill ${perm === 'granted' ? 'ok' : 'pending'}">${esc(perm)}</span> · subscribed devices: <b>${S.push_subscriptions}</b></p>
    <p class="tiny muted">You are notified only for decisions, files to review, important completions, errors and PM replies — never for routine checks.</p>
    <div class="btns"><button class="btn primary" id="pe">${perm === 'granted' ? 'Re-register this phone' : 'Enable notifications'}</button><button class="btn" id="pt">Send test</button></div>
  </section>
  <section class="card"><h2>History</h2>${j.notifications.length ? `<ul class="feed">${j.notifications.map(n => `
    <li><span class="who pm">${n.priority === 'high' ? '!' : '•'}</span><div>
      <div class="meta">${clock(n.ts)} · <span class="pill ${esc(n.status)}">${esc(label(n.status))}</span></div>
      <div class="txt"><b>${esc(n.title)}</b>${n.body ? '\n' + esc(n.body) : ''}</div>
      ${n.error ? `<div class="tiny muted">${esc(n.error)}</div>` : ''}</div></li>`).join('')}</ul>` : '<p class="empty">No notifications yet.</p>'}
  <p class="tiny muted">“sent” = accepted by the push service · “delivered” = shown on a phone and confirmed back.</p></section>`;
  $('#pe').onclick = enablePush;
  $('#pt').onclick = async () => { await api('/api/push/test', { method: 'POST' }); toast('Test queued'); setTimeout(() => route === 'notifications' && notifications(), 6000); };
}
function b64ToU8(b) { const p = '='.repeat((4 - b.length % 4) % 4); const s = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); }
async function enablePush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Push is not supported in this browser. Install the app to the home screen in Chrome.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications were not allowed.');
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api('/api/vapid');
    let sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(publicKey) });
    await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    toast('This phone will now receive notifications'); notifications();
  } catch (e) { toast(e.message); }
}

// ---------- router ----------
async function render() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, arg] = h.split('/');
  route = name || 'home';
  for (const a of document.querySelectorAll('.tabs a')) a.classList.toggle('on', a.dataset.tab === (route === '' ? 'home' : route));
  try {
    if (route === 'home') await home();
    else if (route === 'chat') await chat();
    else if (route === 'decisions') await decisions();
    else if (route === 'files') { if (arg) await fileDetail(arg); else await files(); }
    else if (route === 'notifications') await notifications();
    else await home();
  } catch (e) { if (e.message !== 'login') view.innerHTML = `<div class="card empty">Could not load: ${esc(e.message)}<br><br><button class="btn" onclick="location.reload()">Retry</button></div>`; }
}
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && route !== 'files') render(); });
setInterval(() => { if (!document.hidden && (route === 'home')) render(); else if (!document.hidden) refreshState().catch(() => {}); }, 30000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'push' && !(route === 'files' && location.hash.split('/')[2])) render(); });
}
render();
})();
