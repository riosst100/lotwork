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

function startProject(project) {
  if (running.has(project.id)) {
    throw new Error('Project sudah berjalan');
  }

  const env = { ...process.env, ...project.env, PORT: String(project.port) };
  const command = withPortFlag(project.command, project.port);

  logsById.set(project.id, []);
  appendLog(project.id, `$ ${command}\n`);

  const child = spawn(command, {
    cwd: project.cwd,
    shell: true,
    env,
  });

  running.set(project.id, { proc: child, startedAt: Date.now() });

  child.stdout.on('data', (data) => {
    appendLog(project.id, data.toString());
  });
  child.stderr.on('data', (data) => {
    appendLog(project.id, data.toString());
  });
  child.on('exit', (code) => {
    appendLog(project.id, `\n[process exited with code ${code}]\n`);
    running.delete(project.id);
  });
  child.on('error', (err) => {
    appendLog(project.id, `\n[error: ${err.message}]\n`);
    running.delete(project.id);
  });

  return { pid: child.pid };
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

module.exports = { startProject, stopProject, isRunning, getLogs, getStatus, stopAll };
