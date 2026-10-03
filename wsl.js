const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// Projects live inside a WSL distro. lotwork stores their folders as UNC
// paths (\\wsl.localhost\<distro>\home\...) so plain fs calls - .env editing,
// .git lookups, next.config patching - keep working from Windows, and
// converts back to a Linux path whenever a command has to run inside WSL.
const UNC_RE = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(\\.*)?$/i;

function parseUnc(p) {
  const match = UNC_RE.exec(p || '');
  if (!match) return null;
  const linuxPath = (match[2] || '\\').replace(/\\/g, '/');
  return { distro: match[1], linuxPath: linuxPath.length > 1 ? linuxPath.replace(/\/+$/, '') : '/' };
}

function toUnc(distro, linuxPath) {
  const clean = path.posix.normalize(linuxPath || '/');
  return `\\\\wsl.localhost\\${distro}${clean.replace(/\//g, '\\')}`.replace(/\\$/, '');
}

function isWslPath(p) {
  return parseUnc(p) !== null;
}

// Runs `cmd args...` inside the distro, in linuxCwd. Uses --exec rather than
// `--`: with `--`, wsl.exe joins the arguments into one string for the login
// shell, so characters like ( ) $ ; in them (e.g. git --format=%(refname))
// break or get interpreted. --exec passes argv through untouched. Resolves with
// { code, stdout, stderr } instead of rejecting, so callers can show the
// output of a failed `docker compose up` rather than just "exit code 1".
function run(distro, linuxCwd, cmd, args = [], { timeout = 0 } = {}) {
  return new Promise((resolve) => {
    const wslArgs = ['-d', distro];
    if (linuxCwd) wslArgs.push('--cd', linuxCwd);
    wslArgs.push('--exec', cmd, ...args);
    execFile('wsl.exe', wslArgs, { maxBuffer: 20 * 1024 * 1024, timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout || '', stderr: stderr || (err && !stdout ? err.message : '') });
    });
  });
}

// `wsl -l -q` prints UTF-16LE. Docker Desktop's own internal distros aren't
// places anyone keeps projects, so they're left out of the picker.
function listDistros() {
  return new Promise((resolve) => {
    execFile('wsl.exe', ['-l', '-q'], { encoding: 'buffer', windowsHide: true }, (err, stdout) => {
      if (err) return resolve([]);
      const text = stdout.toString('utf16le').replace(/\0/g, '');
      resolve(text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !/^docker-desktop/i.test(s)));
    });
  });
}

const homeCache = new Map();
async function getHomeDir(distro) {
  if (homeCache.has(distro)) return homeCache.get(distro);
  const result = await run(distro, null, 'sh', ['-c', 'printf %s "$HOME"']);
  const home = result.code === 0 && result.stdout.startsWith('/') ? result.stdout.trim() : '/';
  homeCache.set(distro, home);
  return home;
}

function listDirectory(distro, linuxPath) {
  const unc = toUnc(distro, linuxPath);
  const entries = fs.readdirSync(unc, { withFileTypes: true });
  const dirs = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b));
  return { path: path.posix.normalize(linuxPath), dirs, hasCompose: findComposeFiles(unc, 0).length > 0 };
}

// A YAML file counts as a compose file when it has a top-level `services:`
// key. Looks in the folder itself plus one level down, which covers layouts
// like repo/docker/api.yml next to repo/docker-compose.yml.
function findComposeFiles(dirUnc, depth = 1) {
  const found = [];
  let entries;
  try { entries = fs.readdirSync(dirUnc, { withFileTypes: true }); } catch { return found; }
  for (const e of entries) {
    const full = path.join(dirUnc, e.name);
    if (e.isFile() && /\.ya?ml$/i.test(e.name)) {
      try {
        const head = fs.readFileSync(full, 'utf-8').slice(0, 64 * 1024);
        if (/^services\s*:/m.test(head)) found.push(full);
      } catch {}
    } else if (depth > 0 && e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'vendor') {
      found.push(...findComposeFiles(full, depth - 1));
    }
  }
  return found;
}

module.exports = { parseUnc, toUnc, isWslPath, run, listDistros, getHomeDir, listDirectory, findComposeFiles };
