// Copies a production file into the review store. The original is only READ, never
// modified, moved or deleted. The copy is verified by SHA-256 against the original.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const cfg = require('./config');
const { db, now, newId, logEvent } = require('./db');

const MIME = {
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json', '.srt': 'text/plain', '.vtt': 'text/vtt',
  '.pdf': 'application/pdf', '.html': 'text/plain', '.csv': 'text/csv',
  '.patch': 'text/x-diff', '.diff': 'text/x-diff', '.py': 'text/plain', '.js': 'text/plain', '.ps1': 'text/plain',
};
function kindOf(mime) {
  if (!mime) return 'other';
  if (mime === 'text/x-diff') return 'diff';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('text/') || mime === 'application/json') return 'text';
  if (mime === 'application/pdf') return 'pdf';
  return 'other';
}

function sha256File(p) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(1 << 20);
  let n;
  try { while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
}

function findFfmpeg() {
  const r = spawnSync('where', ['ffmpeg'], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

function makePreview(id, srcCopy, kind, size) {
  // Phone-friendly previews: compress big lossless audio and very large video. Works from the COPY.
  const ff = findFfmpeg();
  if (!ff) return null;
  const dir = path.join(cfg.FILES_DIR, id);
  let out = null, args = null;
  const ext = path.extname(srcCopy).toLowerCase();
  if (kind === 'audio' && (['.wav', '.flac'].includes(ext) || size > 15e6)) {
    out = path.join(dir, 'preview.m4a');
    args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', srcCopy, '-vn', '-c:a', 'aac', '-b:a', '160k', out];
  } else if (kind === 'video' && (size > 150e6 || !['.mp4', '.webm'].includes(ext))) {
    out = path.join(dir, 'preview.mp4');
    args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', srcCopy, '-vf', 'scale=-2:min(720\\,ih)', '-c:v', 'libx264',
      '-preset', 'veryfast', '-crf', '26', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out];
  }
  if (!args) return null;
  const r = spawnSync(ff, args, { windowsHide: true, timeout: 30 * 60 * 1000 });
  if (r.status === 0 && fs.existsSync(out)) return path.relative(cfg.FILES_DIR, out);
  logEvent('files', 'preview_failed', { id, err: String(r.stderr || '').slice(0, 400) });
  return null;
}

function upload(originalPath, { title, note, uploadedBy = 'worker', taskId = null, status = 'awaiting_pm' } = {}) {
  const src = path.resolve(originalPath);
  const st = fs.statSync(src);
  if (!st.isFile()) throw new Error('Not a file: ' + src);
  const id = newId('f');
  const dir = path.join(cfg.FILES_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(src);
  const dest = path.join(dir, base);
  fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);  // read-only use of the original
  const hSrc = sha256File(src), hDst = sha256File(dest);
  if (hSrc !== hDst) { throw new Error('Copy verification failed (hash mismatch) for ' + src); }
  const mime = MIME[path.extname(base).toLowerCase()] || 'application/octet-stream';
  const kind = kindOf(mime);
  db().prepare(`INSERT INTO files(id,ts,original_path,stored_name,mime,kind,size,sha256,title,note,status,uploaded_by,task_id,project)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, now(), src, path.relative(cfg.FILES_DIR, dest), mime, kind, st.size, hSrc, title || base, note || null, status, uploadedBy, taskId,
      require('./db').currentProject());
  const preview = makePreview(id, dest, kind, st.size);
  if (preview) db().prepare('UPDATE files SET preview_name=? WHERE id=?').run(preview, id);
  logEvent('files', 'uploaded', { id, src, size: st.size, preview: !!preview });
  return { id, size: st.size, sha256: hSrc, preview };
}

module.exports = { upload, kindOf, MIME };
