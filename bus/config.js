// Shared configuration for the Lorewood production bus.
// Runtime data (database, uploaded review copies, secrets, logs) lives OUTSIDE
// this repository, in LW_HOME (default: C:\Local Disk D\LorewoodPM).
'use strict';
const fs = require('fs');
const path = require('path');

const LW_HOME = process.env.LW_HOME || 'C:\\Local Disk D\\LorewoodPM';
const DATA = path.join(LW_HOME, 'data');
const CONFIG_PATH = path.join(LW_HOME, 'config.json');

const DEFAULTS = {
  productionDir: 'C:\\Local Disk D\\LorewoodFilms',
  // Claude Code session id of the single worker (filled in automatically on first hook event).
  workerSessionId: '',
  // Sessions in the production folder that must never be treated as the worker (e.g. the builder/PM session).
  excludeSessionIds: [],
  port: 8787,
  publicUrl: '',              // e.g. https://laptop.tailnet.ts.net  (used in push notification links)
  pmModel: 'sonnet',          // model for headless PM runs
  pmEffort: 'medium',
  pmDebounceSeconds: 20,      // batch window before a PM run
  pmMaxAttempts: 3,
  pmRunTimeoutMinutes: 20,
  claudeExe: path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe'),
  // Message types that need PM reasoning. Everything else is recorded only.
  actionableTypes: ['question', 'decision_request', 'error', 'review', 'completed',
                    'user_message', 'decision_response', 'file_review', 'alert', 'blocked'],
  redeliverAfterMinutes: 30,
};

function load() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) {}
  return Object.assign({}, DEFAULTS, c);
}

function save(patch) {
  const cur = (() => { try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) { return {}; } })();
  const next = Object.assign(cur, patch);
  fs.mkdirSync(LW_HOME, { recursive: true });
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
  return load();
}

module.exports = {
  LW_HOME, DATA, CONFIG_PATH, load, save,
  DB_PATH: path.join(DATA, 'lorewood.db'),
  FILES_DIR: path.join(DATA, 'files'),
  LOG_DIR: path.join(DATA, 'logs'),
  SECRETS_PATH: path.join(DATA, 'secrets.json'),
  WORKER_INBOX_FLAG: path.join(DATA, 'worker_inbox.flag'),
  PM_LOCK: path.join(DATA, 'pm.lock'),
  REPO: path.resolve(__dirname, '..'),
};
