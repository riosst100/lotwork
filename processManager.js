const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { dataDir } = require('./paths');
const { withPortFlag } = require('./portFlag');

const LOG_DIR = path.join(dataDir, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// id -> { proc, startedAt }  (only while the process is alive)
const running = new Map();
// id -> string[]  (kept even after the process exits, so logs survive crashes)
const logsById = new Map();

const MAX_LOG_LINES = 500;

function appendLog(id, line) {
  if (!logsById.has(id)) logsById.set(id, []);
  const logs = logsById.get(id);
  logs.push(line);
  if (logs.length > MAX_LOG_LINES) logs.shift();
}

function isRunning(id) {
  return running.has(id);
}

// Matches Next.js's "Another next dev server is already running" message,
// which prints the stray process's PID a couple lines down, e.g.:
//   ⨯ Another next dev server is already running.
//   - PID:          18988
const STALE_NEXT_SERVER_RE = /Another next dev server is already running/i;
const NEXT_SERVER_PID_RE = /PID:\s*(\d+)/i;

function killPid(pid) {
  return new Promise((resolve) => {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
    killer.on('exit', () => resolve());
    killer.on('error', () => resolve());
  });
}

function spawnProject(project, command, env, { isRetry } = {}) {
  let outputSoFar = '';
  let retried = false;

  const child = spawn(command, {
    cwd: project.cwd,
    shell: true,
    env,
  });

  running.set(project.id, { proc: child, startedAt: Date.now() });

  const handleChunk = (text) => {
    appendLog(project.id, text);
    if (isRetry || retried) return; // only auto-retry once
    outputSoFar += text;
    if (STALE_NEXT_SERVER_RE.test(outputSoFar)) {
      const match = outputSoFar.match(NEXT_SERVER_PID_RE);
      if (match) {
        retried = true;
        const stalePid = match[1];
        appendLog(project.id, `\n[lotwork] Found a stale Next.js dev server (PID ${stalePid}), stopping it and retrying...\n`);
        killPid(stalePid).then(() => {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
          setTimeout(() => spawnProject(project, command, env, { isRetry: true }), 500);
        });
      }
    }
  };

  child.stdout.on('data', (data) => handleChunk(data.toString()));
  child.stderr.on('data', (data) => handleChunk(data.toString()));
  child.on('exit', (code) => {
    if (retried) return; // the retry's own exit handler will report the final outcome
    appendLog(project.id, `\n[process exited with code ${code}]\n`);
    running.delete(project.id);
  });
  child.on('error', (err) => {
    if (retried) return;
    appendLog(project.id, `\n[error: ${err.message}]\n`);
    running.delete(project.id);
  });
}

function startProject(project) {
  if (running.has(project.id)) {
    throw new Error('Project sudah berjalan');
  }

  const env = { ...process.env, ...project.env };
  if (project.port) env.PORT = String(project.port);
  const command = project.port ? withPortFlag(project.command, project.port) : project.command;

  logsById.set(project.id, []);
  appendLog(project.id, `$ ${command}\n`);

  spawnProject(project, command, env);

  return { pid: running.get(project.id).proc.pid };
}

function stopProject(id) {
  const entry = running.get(id);
  if (!entry) return false;
  const { proc } = entry;

  if (process.platform === 'win32') {
    // Kill the whole process tree spawned by the shell
    spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
  } else {
    proc.kill('SIGTERM');
  }
  running.delete(id);
  return true;
}

function getLogs(id) {
  const logs = logsById.get(id);
  return logs ? logs.join('') : '';
}

function getStatus(id) {
  const entry = running.get(id);
  if (!entry) return { running: false };
  return { running: true, pid: entry.proc.pid, startedAt: entry.startedAt };
}

function stopAll() {
  for (const id of running.keys()) {
    stopProject(id);
  }
}

// One-shot commands (e.g. "php artisan migrate") - unlike startProject, this
// waits for exit and returns the full output instead of tracking a long-lived
// process, since these commands aren't meant to keep running.
function runCommand(project, command) {
  return new Promise((resolve) => {
    const env = { ...process.env, ...project.env };
    let output = `$ ${command}\n`;

    const child = spawn(command, {
      cwd: project.cwd,
      shell: true,
      env,
    });

    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += data.toString(); });
    child.on('exit', (code) => {
      resolve({ code, output });
    });
    child.on('error', (err) => {
      output += `\n[error: ${err.message}]\n`;
      resolve({ code: null, output });
    });
  });
}

module.exports = { startProject, stopProject, isRunning, getLogs, getStatus, stopAll, runCommand };
