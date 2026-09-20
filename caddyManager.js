const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
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

function isCaddyInstalled() {
  try {
    execSync('caddy version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Distinguishes "not installed at all" from "installed, but this process's
// PATH hasn't picked it up yet" (common right after a winget install, since
// PATH changes only apply to new processes) so the UI can suggest the right
// fix: install vs. restart the server.
function checkCaddyAvailability() {
  if (isCaddyInstalled()) {
    return { installed: true, needsRestart: false };
  }
  if (process.platform === 'win32') {
    try {
      const out = execSync('winget list --id CaddyServer.Caddy', { encoding: 'utf-8' });
      if (out.includes('CaddyServer.Caddy')) {
        return { installed: false, needsRestart: true };
      }
    } catch {
      // winget not available or Caddy not found via it; fall through
    }
  }
  return { installed: false, needsRestart: false };
}

let caddyProcess = null;

function reloadCaddy(projects) {
  generateCaddyfile(projects);

  if (!isCaddyInstalled()) {
    return { ok: false, message: 'Caddy belum terinstall. Install dulu: winget install CaddyServer.Caddy' };
  }

  if (caddyProcess) {
    try {
      execSync(`caddy reload --config "${CADDYFILE}"`);
      return { ok: true, message: 'Caddy config reloaded' };
    } catch (e) {
      return { ok: false, message: 'Gagal reload Caddy: ' + e.message };
    }
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
