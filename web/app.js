'use strict';
(() => {
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (iso) => {
  if (!iso) return '—';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago'; return Math.round(s / 86400) + 'd ago';
};
const clock = (iso) => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const label = (s) => String(s || '').replace(/_/g, ' ');
const mb = (n) => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';

// ---------- icons (inline SVG) ----------
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/>',
  scale: '<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5.5 3.5-5.5 3.5z"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkc: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.8L16.5 9.5"/>',
  alert: '<path d="M12 3 2 20h20zM12 10v4M12 17.2v.1"/>',
  q: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 0 1 5 .8c0 1.7-2.5 2.2-2.5 3.7M12 17v.1"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  diff: '<path d="M6 3v12M18 9v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 9c0 4-6 3-6 9M6 15c0-4 6-3 6-9"/>',
  chev: '<path d="m9 6 6 6-6 6"/>', back: '<path d="m15 6-6 6 6 6"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  send: '<path d="M4 12 20 4l-6 16-2.5-6.5z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', pen: '<path d="M12 19l7-7 2 2-7 7zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18zM2 2l7.6 7.6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5"/>', scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 8.1 20 20M8.1 15.9 20 4"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  thumbup: '<path d="M7 11v9H4v-9zM7 11l4-8a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7"/>',
  redo: '<path d="M20 7v5h-5M20 12a8 8 0 1 0-2.3 5.7"/>', ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.1"/>',
};
const I = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || P.file}</svg>`;
const KIND_ICON = { audio: 'music', video: 'film', image: 'image', text: 'file', diff: 'diff', pdf: 'file', other: 'file' };

let S = null, route = '';
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }

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

// ---------- nav ----------
const TABS = [['home', 'Home', 'home', '#/'], ['chat', 'Ask PM', 'chat', '#/chat'], ['decisions', 'Decide', 'scale', '#/decisions'], ['files', 'Review', 'play', '#/files'], ['notifications', 'Alerts', 'bell', '#/notifications']];
$('#tabs').innerHTML = TABS.map(([k, l, ic, h]) => `<a href="${h}" data-tab="${k}"><span class="pill-bg">${I(ic)}</span><span>${l}</span><i class="nbadge" id="b-${k}"></i></a>`).join('');
function badges() {
  if (!S) return;
  const set = (k, n) => { const b = $('#b-' + k); b.textContent = n; b.classList.toggle('show', n > 0); };
  set('chat', S.unread_pm); set('decisions', S.decisions_open); set('files', S.files_pending);
}
async function refreshState() { S = await api('/api/state'); badges(); return S; }
const st = (k) => S && S.status[k] ? S.status[k].value : null;

function showLogin() {
  $('#tabs').style.display = 'none';
  view.innerHTML = `<section class="login"><img src="/icons/icon-512.png" alt="">
    <h1>Production Control</h1><p class="muted">Lorewood Films</p>
    <form id="lf"><input id="key" type="password" autocomplete="current-password" placeholder="Access key" required>
    <button class="btn primary full" type="submit">Sign in</button><p class="err" id="le"></p></form></section>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/login', { method: 'POST', body: { key: $('#key').value.trim() } }); $('#tabs').style.display = ''; render(); }
    catch (err) { $('#le').textContent = err.message; }
  };
}

// ---------- renderers: markdown + diff ----------
function inline(s) {
  return s.replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--amber)">$1</a>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
}
function md(src) {
  const lines = esc(src).split(/\r?\n/); let html = '', list = null, para = [], code = null, table = null;
  const flushP = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
  const flushL = () => { if (list) { html += `</${list}>`; list = null; } };
  const flushT = () => { if (table) { html += `<table>${table.map((r, i) => `<tr>${r.map(c => i === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</table>`; table = null; } };
  for (const raw of lines) {
    if (code !== null) { if (/^```/.test(raw)) { html += `<pre>${code}</pre>`; code = null; } else code += raw + '\n'; continue; }
    if (/^```/.test(raw)) { flushP(); flushL(); flushT(); code = ''; continue; }
    const l = raw.trimEnd();
    if (/^\|.*\|$/.test(l)) { flushP(); flushL(); if (/^\|[\s:-]+\|/.test(l) && /-{2,}/.test(l)) continue; (table = table || []).push(l.slice(1, -1).split('|').map(c => c.trim())); continue; } else flushT();
    let m;
    if (!l.trim()) { flushP(); flushL(); continue; }
    if ((m = /^(#{1,4})\s+(.*)/.exec(l))) { flushP(); flushL(); const n = Math.min(3, m[1].length); html += `<h${n}>${inline(m[2])}</h${n}>`; continue; }
    if (/^(-{3,}|\*{3,})$/.test(l.trim())) { flushP(); flushL(); html += '<hr>'; continue; }
    if ((m = /^&gt;\s?(.*)/.exec(l))) { flushP(); flushL(); html += `<blockquote>${inline(m[1])}</blockquote>`; continue; }
    if ((m = /^\s*[-*•]\s+(.*)/.exec(l))) { flushP(); if (list !== 'ul') { flushL(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)/.exec(l))) { flushP(); if (list !== 'ol') { flushL(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; continue; }
    flushL(); para.push(l.trim());
  }
  flushP(); flushL(); flushT(); if (code !== null) html += `<pre>${code}</pre>`;
  return html;
}
function parseDiff(text) {
  const files = []; let cur = null;
  for (const ln of text.split(/\r?\n/)) {
    if (ln.startsWith('diff ')) { const m = / b\/(.+)$/.exec(ln); cur = { name: m ? m[1] : ln.slice(5), lines: [], add: 0, del: 0 }; files.push(cur); continue; }
    if (ln.startsWith('--- ') || ln.startsWith('+++ ')) {
      if (!cur || (ln.startsWith('--- ') && cur.lines.length)) { cur = { name: '', lines: [], add: 0, del: 0 }; files.push(cur); }
      if (ln.startsWith('+++ ') && !cur.name) cur.name = ln.slice(4).replace(/^b\//, '').split('\t')[0];
      continue;
    }
    if (!cur) continue;
    if (ln.startsWith('@@')) cur.lines.push({ t: 'hunk', s: ln.replace(/^@@ -(\d+).*?\+(\d+).*?@@\s?/, (_, a, b) => `Around line ${b} `) });
    else if (ln.startsWith('+')) { cur.lines.push({ t: 'add', s: ln.slice(1) }); cur.add++; }
    else if (ln.startsWith('-')) { cur.lines.push({ t: 'del', s: ln.slice(1) }); cur.del++; }
    else if (ln.startsWith(' ')) cur.lines.push({ t: 'ctx', s: ln.slice(1) });
  }
  return files.filter(f => f.lines.length);
}
function diffView(text) {
  const files = parseDiff(text);
  if (!files.length) return `<div class="doc"><pre>${esc(text)}</pre></div>`;
  const tot = files.reduce((a, f) => [a[0] + f.add, a[1] + f.del], [0, 0]);
  return `<div class="row wrap" style="padding:10px 13px;gap:8px;border-bottom:1px solid var(--line)">
      <span class="tag grey">${files.length} file${files.length > 1 ? 's' : ''} changed</span><span class="tag green">+${tot[0]} lines added</span>${tot[1] ? `<span class="tag red">−${tot[1]} removed</span>` : ''}</div>
    <div class="diff-body">${files.map(f => `<div class="diff-file"><div class="diff-name"><span class="clamp1">${esc(f.name)}</span><span><span class="plus">+${f.add}</span> <span class="minus">−${f.del}</span></span></div>
      ${f.lines.map(l => l.t === 'hunk' ? `<div class="hunk">${esc(l.s)}</div>` : `<div class="dl ${l.t}"><i>${l.t === 'add' ? '+' : l.t === 'del' ? '−' : ''}</i><span>${esc(l.s) || ' '}</span></div>`).join('')}</div>`).join('')}</div>`;
}
function attachmentView(a, open = true) {
  const src = `/api/files/${encodeURIComponent(a.id)}/raw`;
  let body = '';
  if (a.kind === 'diff') body = diffView(a.text || '');
  else if (a.kind === 'text') body = `<div class="doc-wrap"><div class="doc">${/\.md$/i.test(a.original_name) ? md(a.text || '') : `<pre style="white-space:pre-wrap;font:14px/1.6 var(--sans);background:none;padding:0">${esc(a.text || '')}</pre>`}</div></div>`;
  else if (a.kind === 'image') body = `<img class="media" src="${src}" alt="">`;
  else if (a.kind === 'audio') body = `<audio class="media" controls preload="metadata" src="${src}"></audio>`;
  else if (a.kind === 'video') body = `<video class="media" controls playsinline preload="metadata" src="${src}"></video>`;
  else body = `<div style="padding:12px"><a class="btn ghost" href="${src}?preview=0">Open file</a></div>`;
  return `<details class="att" ${open ? 'open' : ''}><summary class="att-h" style="list-style:none;cursor:pointer">${I(KIND_ICON[a.kind] || 'file')}
    <span class="t"><span class="clamp1">${a.kind === 'diff' ? 'Proposed changes' : esc(a.title)}</span><span class="small muted clamp1" style="display:block;font-weight:500">${esc(a.original_name)}</span></span>${I('chev', 'sm')}</summary>${body}</details>`;
}

// ---------- phase pipeline ----------
const PHASES = [['Research', 'search'], ['Story', 'layers'], ['Script', 'pen'], ['Voice', 'mic'], ['Visuals', 'image'], ['Edit', 'scissors'], ['Publish', 'upload']];
function phaseIndex() {
  const p = parseInt(st('phase'), 10); if (!isNaN(p)) return Math.max(0, Math.min(6, p));
  const s = (st('stage') || '').toLowerCase();
  const rules = [[6, /publish|upload|thumbnail final/], [5, /edit|cut|render|preview|assembl/], [4, /visual|graphic|asset|animation/], [3, /narration|tts|voice|audio/], [2, /script|draft|rewrite/], [1, /story|structure|premise/], [0, /research/]];
  for (const [i, re] of rules) if (re.test(s)) return i;
  return 0;
}
function ring(pct) {
  const r = 30, c = 2 * Math.PI * r;
  return `<div class="ring"><svg viewBox="0 0 74 74"><circle cx="37" cy="37" r="${r}" stroke="rgba(255,255,255,.12)" stroke-width="7" fill="none"/>
    <circle cx="37" cy="37" r="${r}" stroke="url(#rg)" stroke-width="7" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"/>
    <defs><linearGradient id="rg"><stop offset="0" stop-color="#e5654f"/><stop offset="1" stop-color="#f2b705"/></linearGradient></defs></svg><b>${pct}%</b></div>`;
}
function workerState() {
  const ws = st('worker_state') || 'unknown';
  const map = { working: ['Working', 'st-working'], idle: ['Idle', 'st-idle'], idle_background_running: ['Rendering', 'st-working'], waiting_for_decision: ['Waiting on a decision', 'st-wait'], waiting_for_user: ['Waiting for your answer', 'st-bad'],
    needs_input: ['Needs you on laptop', 'st-bad'], error: ['Error', 'st-bad'], ended: ['Session ended', 'st-off'], app_closed: ['App closed', 'st-off'] };
  return map[ws] || [label(ws), 'st-off'];
}

// ---------- HOME ----------
async function home() {
  if (!S) view.innerHTML = '<div class="skeleton" style="height:210px"></div>';
  await refreshState();
  const pct = Math.max(0, Math.min(100, parseInt(st('progress') || '0', 10) || 0));
  const pi = phaseIndex();
  const art = st('project_art');
  const [wsLabel, wsCls] = workerState();
  const pmState = st('pm_state') || 'idle';
  view.innerHTML = `
  <section class="hero">${art ? `<div class="hero-art" style="background-image:url('/api/files/${encodeURIComponent(art)}/raw')"></div>` : ''}
    <div class="hero-in"><div class="hero-txt"><div class="eyebrow">Now producing</div>
      <h1>${esc(st('project') || 'No project yet')}</h1>
      <span class="chip">${I(PHASES[pi][1], 'sm')} ${esc(st('stage') || PHASES[pi][0])}</span></div>${ring(pct)}</div>
  </section>
  <div class="pipe"><div class="pipe-fill" style="width:${(pi / 6) * 86}%"></div>
    ${PHASES.map(([n, ic], i) => `<div class="step ${i < pi ? 'done' : i === pi ? 'now' : ''}"><div class="dot">${I(i < pi ? 'check' : ic, 'sm')}</div><span>${n}</span></div>`).join('')}</div>

  <div class="section-h"><h2>Needs you</h2><span class="count">${(S.todo_decisions.length + S.todo_files.length) || ''}</span></div>
  ${needsYou()}

  <div class="section-h"><h2>The team</h2></div>
  <div class="team">
    <div class="member"><div class="who"><span class="avatar av-worker">${I('wrench')}</span><span class="name">Worker</span></div>
      <span class="state ${wsCls}">${esc(wsLabel)}</span><div class="doing clamp2">${esc(st('current_task') || 'No task reported')}</div></div>
    <div class="member"><div class="who"><span class="avatar av-pm">${I('spark')}</span><span class="name">PM</span></div>
      <span class="state ${pmState === 'thinking' ? 'st-working' : pmState === 'error' ? 'st-bad' : pmState === 'paused' ? 'st-off' : 'st-idle'}">${pmState === 'thinking' ? 'Thinking' : label(pmState)}</span>
      <div class="doing clamp2">${esc(st('pm_last_summary') || 'Waiting for something to handle')}</div></div>
  </div>

  <div class="section-h"><h2>Activity</h2><span class="count">tap to expand</span></div>
  <div class="timeline">${S.activity.slice(0, 14).map(evRow).join('') || '<p class="empty">Nothing yet.</p>'}</div>`;
  for (const e of view.querySelectorAll('.ev')) e.onclick = () => e.classList.toggle('open');
}
function needsYou() {
  const t = [];
  if (st('worker_state') === 'needs_input') t.push(`<div class="tile k-alert"><span class="ico">${I('alert', 'lg')}</span><div><div class="t">Worker is waiting on the laptop</div><div class="m clamp2">${esc(st('worker_needs_input') || 'Approve the prompt in the Claude app')}</div></div><span></span></div>`);
  for (const d of S.todo_decisions) {
    const att = JSON.parse(d.attachments || '[]').length;
    t.push(`<a class="tile k-dec" href="#/decisions/${esc(d.id)}"><span class="ico">${I('scale', 'lg')}</span>
      <div><div class="t clamp2">${esc(shortQ(d.question))}</div><div class="m">${d.source === 'direct' ? '<span class="tag red">Worker is waiting</span>' : '<span class="tag amber">Decision</span>'}${d.importance === 'high' ? '<span class="tag red">Important</span>' : ''}${att ? `<span>${I('diff', 'sm')} ${att} attachment${att > 1 ? 's' : ''}</span>` : ''}<span>${ago(d.ts)}</span></div></div>
      <span class="chev">${I('chev')}</span></a>`);
  }
  for (const f of S.todo_files) t.push(`<a class="tile k-rev" href="#/files/${esc(f.id)}"><span class="ico">${I(KIND_ICON[f.kind] || 'file', 'lg')}</span>
      <div><div class="t clamp2">${esc(f.title)}</div><div class="m"><span class="tag blue">${esc(f.kind === 'text' ? 'Read' : f.kind === 'audio' ? 'Listen' : f.kind === 'video' ? 'Watch' : 'Review')}</span><span>${ago(f.ts)}</span></div></div>
      <span class="chev">${I('chev')}</span></a>`);
  if (S.unread_pm) t.push(`<a class="tile k-msg" href="#/chat"><span class="ico">${I('chat', 'lg')}</span><div><div class="t">${S.unread_pm} new message${S.unread_pm > 1 ? 's' : ''} from the PM</div><div class="m"><span class="tag green">Reply</span></div></div><span class="chev">${I('chev')}</span></a>`);
  return t.length ? `<div class="tiles">${t.join('')}</div>` : `<div class="allclear">${I('checkc', 'lg')}<div><b>You're all caught up</b><div class="small">Production is moving. We'll notify you when something needs you.</div></div></div>`;
}
const shortQ = (q) => { const s = String(q).split(/(?<=[?])\s/)[0]; return s.length > 140 ? s.slice(0, 137) + '…' : s; };
const EV = { completed: ['checkc', 'var(--green)'], started: ['bolt', 'var(--amber)'], plan: ['layers', 'var(--text2)'], question: ['q', 'var(--amber)'], decision_request: ['scale', 'var(--amber)'],
  decision_response: ['scale', '#f3a99a'], decision: ['scale', 'var(--amber)'], error: ['alert', 'var(--red)'], review: ['play', 'var(--blue)'], file_review: ['thumbup', '#f3a99a'],
  user_message: ['chat', '#f3a99a'], pm_reply: ['chat', 'var(--amber)'], instruction: ['spark', 'var(--amber)'], user_decision: ['user', '#f3a99a'], dismissed: ['x', 'var(--muted)'] };
const WHO = { worker: 'Worker', pm: 'PM', user: 'You', system: 'System' };
function evRow(r) {
  const [ic, col] = EV[r.type] || ['info', 'var(--text2)'];
  return `<div class="ev"><span class="ei" style="color:${col}">${I(ic, 'sm')}</span><div style="min-width:0">
    <div class="et clamp2">${esc(r.content)}</div><div class="em">${WHO[r.sender] || r.sender} → ${WHO[r.recipient] || r.recipient} · ${esc(label(r.type))} · ${ago(r.ts)}</div>
    <div class="full">${esc(r.content)}</div></div></div>`;
}

// ---------- ASK PM ----------
// The composer is built ONCE; refreshes only redraw the message list, so typing is never erased.
let chatTimer = null;
const DRAFT_KEY = 'lw_chat_draft';
const getDraft = () => { try { return localStorage.getItem(DRAFT_KEY) || ''; } catch (_) { return ''; } };
const setDraft = (v) => { try { v ? localStorage.setItem(DRAFT_KEY, v) : localStorage.removeItem(DRAFT_KEY); } catch (_) {} };
async function chat() {
  view.innerHTML = `<h1 class="page-h">Ask the PM</h1><p class="page-sub">Status, priorities, changes — the PM answers here and can instruct the worker.</p>
  <div class="chat" id="chatlog"><div class="skeleton" style="height:80px"></div></div>
  <div class="composer"><form id="cf"><textarea id="ct" rows="1" placeholder="Message the PM" maxlength="4000"></textarea><button class="send" id="cs" type="submit" aria-label="Send">${I('send')}</button></form></div>`;
  const ta = $('#ct');
  ta.value = getDraft();
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; };
  ta.oninput = () => { setDraft(ta.value); grow(); };
  grow();
  $('#cf').onsubmit = async (e) => {
    e.preventDefault(); const t = ta.value.trim(); if (!t) return;
    $('#cs').disabled = true;
    try {
      await api('/api/chat', { method: 'POST', body: { text: t } });
      ta.value = ''; setDraft(''); grow(); toast('Sent to the PM');
      await chatLog(true);
    } catch (err) { toast('Not sent: ' + err.message); }   // text stays in the box
    finally { $('#cs').disabled = false; }
  };
  await chatLog(true);
}
async function chatLog(scroll) {
  if (route !== 'chat') return;
  const j = await api('/api/chat');
  refreshState().catch(() => {});
  const log = $('#chatlog'); if (!log) return;
  const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
  log.innerHTML = `
    ${j.messages.length ? '' : `<div class="empty" style="padding:20px 10px">${I('chat')}<div>Ask anything about production. The PM usually replies within a minute or two.</div></div>`}
    ${j.messages.map(m => m.sender === 'user'
      ? `<div class="msg me"><div class="bubble">${esc(m.content)}<span class="t">${clock(m.ts)}</span></div></div>`
      : `<div class="msg pm"><span class="avatar av-pm">${I('spark', 'sm')}</span><div class="bubble">${esc(m.content)}<span class="t">${clock(m.ts)}</span></div></div>`).join('')}
    ${j.awaiting_reply ? `<div class="msg pm"><span class="avatar av-pm">${I('spark', 'sm')}</span><div class="bubble typing" title="PM is reading"><i></i><i></i><i></i></div></div>` : ''}
    ${j.unanswered ? `<p class="small muted center">The PM handled this without a chat reply. Ask again if you need an answer.</p>` : ''}
    ${!j.awaiting_reply ? `<div class="suggest">${['Where are we now?', 'What is blocked?', 'What happens next?'].map(s => `<button type="button" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}`;
  for (const b of log.querySelectorAll('[data-s]')) b.onclick = () => { const ta = $('#ct'); ta.value = b.dataset.s; setDraft(ta.value); ta.focus(); };
  if (scroll || nearBottom) window.scrollTo(0, document.body.scrollHeight);
  clearTimeout(chatTimer);
  if (j.awaiting_reply) chatTimer = setTimeout(() => chatLog(false), 6000);
}

// ---------- DECISIONS ----------
async function decisions(focusId) {
  const j = await api('/api/decisions');
  refreshState().catch(() => {});
  const open = j.decisions.filter(d => d.status === 'open'), done = j.decisions.filter(d => d.status !== 'open');
  view.innerHTML = `<h1 class="page-h">Decisions</h1><p class="page-sub">${open.length ? `${open.length} waiting for you` : 'Nothing waiting for you'}</p>
    ${open.length ? selBar() : ''}
    ${open.length ? open.map(decCard).join('') : `<div class="empty">${I('checkc')}<div>No decisions waiting. 🎬</div></div>`}
    ${done.length ? `<details class="hist"><summary>${I('chev', 'sm')} History · ${done.length}</summary>${done.map(d => `<div class="histrow">
      <span class="tag ${d.answered_by === 'user (dismissed)' ? 'grey' : 'green'}">${d.answered_by === 'user (dismissed)' ? 'Cleared' : 'Decided'}</span>
      <div style="min-width:0"><div class="clamp2">${esc(shortQ(d.question))}</div>${d.answer ? `<div class="small muted clamp1">→ ${esc(d.answer)}</div>` : ''}</div></div>`).join('')}</details>` : ''}`;
  for (const f of view.querySelectorAll('form[data-dec]')) f.onsubmit = submitDecision;
  for (const b of view.querySelectorAll('[data-fill]')) b.onclick = () => { const ta = b.closest('form').querySelector('textarea'); ta.value = b.dataset.fill; ta.focus(); };
  wireClear(() => decisions());
  if (focusId) { const el = view.querySelector(`[data-dec="${CSS.escape(focusId)}"]`); if (el) el.scrollIntoView({ block: 'start' }); }
}
// A question the worker asked inside its own session: show what it said, answer it from here.
function directCard(d) {
  return `<form class="card dec" data-dec="${esc(d.id)}" style="border-color:var(--red-line);background:linear-gradient(180deg,#2a1611 0%,var(--s1) 120px)">
    <div class="dec-top"><span class="row" style="gap:6px"><span class="tag red">${I('wrench', 'sm')} Worker is waiting</span><span class="small muted">${ago(d.ts)}</span></span>${pickBox('dec', d.id)}</div>
    <div class="q">${esc(d.question)}</div>
    <details class="att" open><summary class="att-h" style="list-style:none;cursor:pointer">${I('chat')}<span class="t">What the worker said</span>${I('chev', 'sm')}</summary>
      <div class="doc">${md(d.context || '')}</div></details>
    <div class="suggest mt">${['Yes, go ahead', 'No, hold off', 'Use your recommendation'].map(s => `<button type="button" data-fill="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <textarea name="comment" rows="3" class="mt" placeholder="Your answer to the worker"></textarea>
    <button class="btn primary full mt" type="submit">${I('send', 'sm')} Send to worker</button>
  </form>`;
}

function decCard(d) {
  if (d.source === 'direct') return directCard(d);
  const rec = d.recommendation || '';
  const recIdx = d.options.findIndex(o => rec && (rec.toLowerCase().startsWith(o.toLowerCase().slice(0, 18)) || rec.trim().startsWith(o.split(/[:—-]/)[0].trim()) || rec.startsWith(o.charAt(0) + ' ') || rec.startsWith(o.charAt(0) + ' —')));
  const hasDiff = d.attachments.some(a => a.kind === 'diff');
  return `<form class="card dec" data-dec="${esc(d.id)}">
    <div class="dec-top"><span class="row" style="gap:6px"><span class="tag amber">${I('scale', 'sm')} Decision</span>${d.importance === 'high' ? '<span class="tag red">Important</span>' : ''}<span class="small muted">${ago(d.ts)}</span></span>${pickBox('dec', d.id)}</div>
    <div class="q">${esc(d.question)}</div>
    ${d.attachments.map(a => attachmentView(a, true)).join('')}
    ${!d.attachments.length && /\.(patch|diff|md)\b|patch|diff/i.test(d.question + ' ' + (d.context || '')) ? `<div class="notebox" style="border:1px dashed var(--amber-line)">${I('info')}<span>The change itself isn't attached yet. Ask the PM to attach it before you approve.</span></div>` : ''}
    ${d.context ? `<details class="why" ${hasDiff ? '' : ''}><summary>${I('chev', 'sm')} Why you're being asked</summary><p>${esc(d.context)}</p></details>` : ''}
    ${d.options.length ? `<div class="choices">${d.options.map((o, i) => `<label class="choice"><input type="radio" name="choice" value="${esc(o)}" ${i === recIdx ? 'checked' : ''}><span class="radio"></span>
      <span><span class="ct">${esc(o)}</span>${i === recIdx ? `<span class="pick-badge" style="display:flex">${I('spark', 'sm')} PM's pick</span>` : ''}</span></label>`).join('')}</div>` : ''}
    ${rec ? `<div class="recline">${I('spark', 'sm')}<span><b style="color:var(--text)">PM recommends:</b> ${esc(rec)}</span></div>` : ''}
    <textarea name="comment" rows="2" class="mt" placeholder="Add a comment (optional)"></textarea>
    <button class="btn primary full mt" type="submit">${I('check')} ${d.options.length ? 'Submit decision' : 'Send answer'}</button>
  </form>`;
}
async function submitDecision(e) {
  e.preventDefault();
  const f = e.target, fd = new FormData(f);
  const choice = fd.get('choice') || '', comment = fd.get('comment') || '';
  try { await api('/api/decisions/' + f.dataset.dec, { method: 'POST', body: { choice, comment } }); toast('Sent to the PM'); decisions(); }
  catch (err) { toast(err.message); }
}

// ---------- select & clear ----------
function selBar() {
  return `<div class="selbar"><span>Tick anything no longer needed</span><label class="pick"><input type="checkbox" id="pickall"> All</label></div>
    <div class="clearbar" id="clearbar"><div class="in"><span id="clearcount" style="font-weight:600"></span>
      <span class="row"><button class="btn ghost" type="button" id="clearcancel">Cancel</button><button class="btn bad" type="button" id="cleargo">${I('x', 'sm')} Clear</button></span></div></div>`;
}
const pickBox = (kind, id) => `<label class="pick" onclick="event.stopPropagation()"><input type="checkbox" class="pickone" data-kind="${kind}" data-id="${esc(id)}"> Not needed</label>`;
function wireClear(reload) {
  const boxes = [...view.querySelectorAll('.pickone')];
  if (!boxes.length) return;
  const bar = $('#clearbar'), all = $('#pickall');
  const upd = () => { const n = boxes.filter(b => b.checked).length; bar.classList.toggle('show', n > 0); $('#clearcount').textContent = `${n} selected`; all.checked = n === boxes.length; };
  boxes.forEach(b => b.onchange = upd);
  all.onchange = () => { boxes.forEach(b => b.checked = all.checked); upd(); };
  $('#clearcancel').onclick = () => { boxes.forEach(b => b.checked = false); upd(); };
  $('#cleargo').onclick = async () => {
    const sel = boxes.filter(b => b.checked);
    if (!confirm(`Clear ${sel.length} item(s)? They move to History and the PM is told. Nothing is deleted.`)) return;
    const body = { decisions: sel.filter(b => b.dataset.kind === 'dec').map(b => b.dataset.id), files: sel.filter(b => b.dataset.kind === 'file').map(b => b.dataset.id), reason: 'No longer needed' };
    try { const r = await api('/api/dismiss', { method: 'POST', body }); toast(`Cleared ${r.closed.length + r.archived.length}`); reload(); } catch (e) { toast(e.message); }
  };
}

// ---------- REVIEW ----------
async function files() {
  const j = await api('/api/files');
  refreshState().catch(() => {});
  const todo = j.files.filter(f => f.status === 'pending_review'), rest = j.files.filter(f => f.status !== 'pending_review');
  const STAT = { approved: ['green', 'Approved'], rejected: ['red', 'Rejected'], changes_requested: ['amber', 'Changes asked'], awaiting_pm: ['grey', 'With PM'] };
  view.innerHTML = `<h1 class="page-h">Review</h1><p class="page-sub">${todo.length ? `${todo.length} waiting for you` : 'Nothing waiting for your review'}</p>
    ${todo.length ? selBar() + `<div class="rgrid">${todo.map(f => `<div class="tile k-rev" style="grid-template-columns:46px minmax(0,1fr) auto">
      <a href="#/files/${esc(f.id)}" class="ico">${I(KIND_ICON[f.kind] || 'file', 'lg')}</a>
      <a href="#/files/${esc(f.id)}" style="min-width:0"><div class="t clamp2">${esc(f.title)}</div><div class="m"><span class="tag blue">${esc(f.kind === 'text' ? 'Read' : f.kind === 'audio' ? 'Listen' : f.kind === 'video' ? 'Watch' : 'Check')}</span><span>${mb(f.size)}</span><span>${ago(f.ts)}</span></div></a>
      ${pickBox('file', f.id)}</div>`).join('')}</div>` : `<div class="empty">${I('checkc')}<div>Nothing waiting for your review. 🎬</div></div>`}
    ${rest.length ? `<details class="hist"><summary>${I('chev', 'sm')} History · ${rest.length}</summary>${rest.map(f => { const s = STAT[f.status] || ['grey', label(f.status)]; return `<a class="histrow" href="#/files/${esc(f.id)}">
      <span class="tag ${s[0]}">${s[1]}</span><span class="clamp1" style="flex:1">${esc(f.title)}</span>${I('chev', 'sm')}</a>`; }).join('')}</details>` : ''}`;
  wireClear(files);
}
async function fileDetail(id) {
  const f = await api('/api/files/' + encodeURIComponent(id));
  const src = `/api/files/${encodeURIComponent(id)}/raw`;
  let media = '';
  if (f.kind === 'audio') media = `<div class="audio-card"><div class="wave">${Array.from({ length: 48 }, (_, i) => `<i style="height:${18 + Math.abs(Math.sin(i * 1.7) * 26 + Math.sin(i * .5) * 12)}px"></i>`).join('')}</div><audio class="media" style="padding:0" controls preload="metadata" src="${src}"></audio></div>`;
  else if (f.kind === 'video') media = `<div class="media-wrap"><video class="media" controls playsinline preload="metadata" src="${src}"></video></div>`;
  else if (f.kind === 'image') media = `<div class="media-wrap"><img class="media" style="object-fit:contain" src="${src}" alt=""></div>`;
  else if (f.kind === 'text' || f.kind === 'diff') media = attachmentView(f, true);
  else media = `<a class="btn ghost" href="${src}?preview=0">Open file</a>`;
  const reviewed = { approved: 'You approved this', rejected: 'You rejected this', changes_requested: 'You asked for changes' }[f.status];
  view.innerHTML = `<a class="back" href="#/files">${I('back', 'sm')} Review</a>
  <div class="row" style="gap:8px;margin-bottom:6px"><span class="tag blue">${I(KIND_ICON[f.kind] || 'file', 'sm')} ${esc(label(f.kind))}</span><span class="small muted">${mb(f.size)} · ${ago(f.ts)}</span></div>
  <h1 class="page-h" style="margin-top:0">${esc(f.title)}</h1>
  ${media}
  ${f.note ? `<div class="notebox">${I('info')}<span>${esc(f.note)}</span></div>` : ''}
  ${f.has_preview ? `<p class="small muted">Phone-sized copy. <a href="${src}?preview=0" style="color:var(--amber)">Full quality</a> · the original stays on the laptop.</p>` : ''}
  <form class="card mt" id="rf"><div class="row between"><b>Your verdict</b>${reviewed ? `<span class="tag green">${reviewed}</span>` : ''}</div>
    <p class="small muted" style="margin:6px 0 0">Anything you write here is sent <b>together with</b> the button you tap. The PM passes it on to the creator.</p>
    <textarea name="comment" rows="3" class="mt" placeholder="Optional notes, e.g. 2:14 too fast, swap the second shot"></textarea>
    <div class="verdicts">
      <button class="btn good" name="v" value="approved">${I('thumbup')}Approve</button>
      <button class="btn warn" name="v" value="changes_requested">${I('redo')}Changes</button>
      <button class="btn bad" name="v" value="rejected">${I('ban')}Reject</button>
    </div>
    <button class="btn ghost full mt" name="v" value="">${I('chat', 'sm')} Send notes only (no verdict yet)</button>
  </form>`;
  $('#rf').onsubmit = async (e) => {
    e.preventDefault();
    const verdict = e.submitter ? e.submitter.value : '', comment = new FormData(e.target).get('comment') || '';
    const what = { approved: 'Approved', changes_requested: 'Changes requested', rejected: 'Rejected', '': 'Notes' }[verdict] || 'Sent';
    try { await api(`/api/files/${encodeURIComponent(id)}/review`, { method: 'POST', body: { verdict, comment } });
      toast(`${what}${comment && verdict ? ' + your notes' : ''} sent: PM → creator`); fileDetail(id); } catch (err) { toast(err.message); }
  };
}

// ---------- ALERTS ----------
async function notifications() {
  const j = await api('/api/notifications');
  await refreshState();
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const NS = { delivered: ['green', 'Seen on phone'], sent: ['blue', 'Sent'], queued: ['amber', 'Queued'], failed: ['red', 'Failed'], no_subscribers: ['grey', 'No phone yet'] };
  view.innerHTML = `<h1 class="page-h">Alerts</h1><p class="page-sub">Only decisions, reviews, important results and PM replies — never routine checks.</p>
  <div class="card row between"><div class="row">${I('bell', 'lg')}<div><b>Push notifications</b><div class="small muted">${perm === 'granted' ? 'On for this phone' : 'Off on this phone'} · ${S.push_subscriptions} device${S.push_subscriptions === 1 ? '' : 's'}</div></div></div>
    <span class="row" style="gap:6px"><button class="btn ghost" id="pt" style="min-height:40px;padding:8px 12px">Test</button>${perm !== 'granted' ? `<button class="btn primary" id="pe" style="min-height:40px;padding:8px 12px">Enable</button>` : ''}</span></div>
  <div class="card" style="padding:4px 14px">${j.notifications.map(n => { const s = NS[n.status] || ['grey', label(n.status)]; return `<div class="nrow">
    <span class="ei" style="color:${n.priority === 'high' ? 'var(--red)' : 'var(--amber)'}">${I(/decision/i.test(n.title) ? 'scale' : /review/i.test(n.title) ? 'play' : n.priority === 'high' ? 'alert' : 'bell', 'sm')}</span>
    <div style="min-width:0"><div class="clamp1" style="font-weight:600">${esc(n.title)}</div><div class="small muted clamp1">${esc(n.body || '')}</div></div>
    <div style="text-align:right"><span class="tag ${s[0]}">${s[1]}</span><div class="small muted" style="margin-top:3px">${ago(n.ts)}</div></div></div>`; }).join('') || '<p class="empty">No notifications yet.</p>'}</div>`;
  if ($('#pe')) $('#pe').onclick = enablePush;
  $('#pt').onclick = async () => { if (perm !== 'granted') return enablePush(); await api('/api/push/test', { method: 'POST' }); toast('Test sent'); setTimeout(() => route === 'notifications' && notifications(), 5000); };
}
function b64ToU8(b) { const p = '='.repeat((4 - b.length % 4) % 4); const s = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); }
async function enablePush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Install the app to the home screen in Chrome first.');
    if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications were not allowed.');
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api('/api/vapid');
    let sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(publicKey) });
    await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    toast('Notifications are on'); notifications();
  } catch (e) { toast(e.message); }
}

// ---------- router ----------
async function render() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  route = name || 'home';
  for (const a of document.querySelectorAll('.tabs a')) a.classList.toggle('on', a.dataset.tab === route);
  try {
    if (route === 'chat') await chat();
    else if (route === 'decisions') await decisions(arg);
    else if (route === 'files') await (arg ? fileDetail(arg) : files());
    else if (route === 'notifications') await notifications();
    else { route = 'home'; $('.tabs a[data-tab=home]').classList.add('on'); await home(); }
  } catch (e) { if (e.message !== 'login') view.innerHTML = `<div class="empty">${I('alert')}<div>Couldn't reach the laptop: ${esc(e.message)}</div><button class="btn mt" onclick="location.reload()">Retry</button></div>`; }
}
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) return; if (route === 'chat') chatLog(false).catch(() => {}); else if (route !== 'files' && route !== 'decisions') render(); });
setInterval(() => { if (document.hidden) return; if (route === 'home') render(); else refreshState().catch(() => {}); }, 30000);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => { if (!e.data || e.data.type !== 'push') return; if (route === 'chat') chatLog(false).catch(() => {}); else if (route === 'home') render(); });
}
render();
})();
