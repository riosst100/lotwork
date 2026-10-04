const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const { dataDir } = require('./paths');

const CADDYFILE = path.join(dataDir, 'Caddyfile');

function generateCaddyfile(projects) {
  const blocks = projects
    .filter(p => p.domain)
    .map(p => `${p.domain} {\n\treverse_proxy localhost:${p.port}\n\ttls internal\n}`)
    .join('\n\n');
  fs.writeFileSync(CADDYFILE, blocks + '\n');
  return CADDYFILE;
}

// Async so these checks (winget especially can take seconds) never block the
// server, which shares a process with the Electron shell.
function run(command) {
  return new Promise(resolve => {
    exec(command, { encoding: 'utf-8', windowsHide: true, timeout: 30000 }, (err, stdout) => {
      resolve({ ok: !err, stdout: stdout || '', error: err });
    });
  });
}

async function isCaddyInstalled() {
  return (await run('caddy version')).ok;
}

// Distinguishes "not installed at all" from "installed, but this process's
// PATH hasn't picked it up yet" (common right after a winget install, since
// PATH changes only apply to new processes) so the UI can suggest the right
// fix: install vs. restart the server.
async function checkCaddyAvailability() {
  if (await isCaddyInstalled()) {
    return { installed: true, needsRestart: false };
  }
  if (process.platform === 'win32') {
    // A failure here means winget isn't available or Caddy isn't found via it.
    const { ok, stdout } = await run('winget list --id CaddyServer.Caddy');
    if (ok && stdout.includes('CaddyServer.Caddy')) {
      return { installed: false, needsRestart: true };
    }
  }
  return { installed: false, needsRestart: false };
}

let caddyProcess = null;

async function reloadCaddy(projects) {
  generateCaddyfile(projects);

  if (!(await isCaddyInstalled())) {
    return { ok: false, message: 'Caddy belum terinstall. Install dulu: winget install CaddyServer.Caddy' };
  }

  if (caddyProcess) {
    const { ok, error } = await run(`caddy reload --config "${CADDYFILE}"`);
    return ok
      ? { ok: true, message: 'Caddy config reloaded' }
      : { ok: false, message: 'Gagal reload Caddy: ' + error.message };
  } else {
    caddyProcess = spawn('caddy', ['run', '--config', CADDYFILE], { detached: false });
    caddyProcess.on('exit', () => { caddyProcess = null; });
    return { ok: true, message: 'Caddy started' };
  }
}

function stopCaddy() {
  if (caddyProcess) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(caddyProcess.pid), '/T', '/F']);
    } else {
      caddyProcess.kill('SIGTERM');
    }
    caddyProcess = null;
  }
}

module.exports = { generateCaddyfile, reloadCaddy, stopCaddy, isCaddyInstalled, checkCaddyAvailability, CADDYFILE };
