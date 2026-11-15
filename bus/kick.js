// Start a PM trigger run without waiting for it. Uses the Task Scheduler task when it is
// installed (fully independent of the calling process tree, e.g. a hook), otherwise a
// detached node process. The trigger itself holds a lock, so extra kicks are harmless.
'use strict';
const { spawn, spawnSync } = require('child_process');
const path = require('path');

const TASK = '\\Lorewood\\PM Trigger';

function kick() {
  try {
    const r = spawnSync('schtasks.exe', ['/Run', '/TN', TASK], { windowsHide: true, encoding: 'utf8', timeout: 8000 });
    if (r.status === 0) return 'scheduler';
  } catch (_) {}
  const child = spawn(process.execPath, [path.join(__dirname, 'lw.js'), 'trigger'], {
    detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.unref();
  return 'detached';
}

module.exports = { kick, TASK };
