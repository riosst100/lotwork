const fs = require('fs');
const { execFile, execFileSync, spawn } = require('child_process');

// Windows service name patterns for common local dev databases. Different
// installers name these differently (stock MySQL installer vs Laragon),
// so each entry tries a few known patterns. XAMPP's MySQL doesn't register
// as a service at all - it's covered separately by XAMPP_PROCESS_DEFINITIONS.
const SERVICE_DEFINITIONS = [
  { id: 'mysql', label: 'MySQL', patterns: ['^mysql$', '^mysql\\d*$', '^mysqld$'] },
  { id: 'postgresql', label: 'PostgreSQL', patterns: ['^postgresql-x64-\\d+$', '^postgresql$'] },
];

// XAMPP runs mysqld.exe/httpd.exe as plain processes launched from its
// Control Panel, not as Windows services, so they need their own detection
// (process name). XAMPP's own mysql_start.bat/mysql_stop.bat are avoided:
// the start script runs mysqld in the foreground (blocks until stopped, so
// spawning it via execFile would hang forever waiting for exit), and the
// stop script ships with an unsubstituted "@@BITROCK_INSTALLDIR@@"
// placeholder from the installer template, so it never actually runs.
// mysqld.exe is spawned/killed directly instead.
const XAMPP_ROOT = 'C:\\xampp';
const XAMPP_PROCESS_DEFINITIONS = [
  {
    id: 'xampp-mysql', label: 'MySQL (XAMPP)', processName: 'mysqld',
    exe: `${XAMPP_ROOT}\\mysql\\bin\\mysqld.exe`,
    args: ['--defaults-file=' + `${XAMPP_ROOT}\\mysql\\bin\\my.ini`, '--standalone', '--skip-grant-tables'],
    cwd: `${XAMPP_ROOT}\\mysql\\bin`,
  },
];

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

// Uses PowerShell Get-Service (structured, locale-independent) rather than
// parsing `sc query` text output.
function getWindowsServices() {
  try {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', 'Get-Service | Select-Object Name, DisplayName, Status | ConvertTo-Json -Compress'],
      { encoding: 'utf-8', timeout: 15000, windowsHide: true }
    );
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

// Checks for a running process by name (no ".exe") via PowerShell
// Get-Process, mirroring getWindowsServices' approach for services.
function getWindowsProcessNames() {
  try {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', 'Get-Process | Select-Object -ExpandProperty Name'],
      { encoding: 'utf-8', timeout: 15000, windowsHide: true }
    );
    return out.split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// Finds installed dev-database services on this machine and their current
// status. Returns only services that were actually found (not every
// definition), since most machines won't have all of them installed.
function detectServices() {
  if (process.platform !== 'win32') return [];
  const services = getWindowsServices();

  const found = [];
  for (const def of SERVICE_DEFINITIONS) {
    const match = services.find(s => def.patterns.some(p => new RegExp(p, 'i').test(s.Name)));
    if (match) {
      found.push({
        id: def.id,
        label: def.label,
        serviceName: match.Name,
        displayName: match.DisplayName,
        running: match.Status === 4 || match.Status === 'Running',
        kind: 'service',
      });
    }
  }

  // Only list XAMPP entries whose executable actually exists on this
  // machine, since XAMPP_ROOT is a guess (default install path).
  if (fs.existsSync(XAMPP_ROOT)) {
    const processNames = getWindowsProcessNames();
    for (const def of XAMPP_PROCESS_DEFINITIONS) {
      if (!fs.existsSync(def.exe)) continue;
      found.push({
        id: def.id,
        label: def.label,
        serviceName: def.id,
        displayName: def.label,
        running: processNames.includes(def.processName),
        kind: 'xampp',
      });
    }
  }

  return found;
}

function findXamppDef(serviceName) {
  return XAMPP_PROCESS_DEFINITIONS.find(d => d.id === serviceName);
}

async function startService(serviceName) {
  const xampp = findXamppDef(serviceName);
  if (xampp) {
    // mysqld runs in the foreground until stopped, so it's spawned detached
    // (unref'd) rather than awaited like a one-shot command - awaiting it
    // via execFile would hang forever since it never exits on its own.
    const child = spawn(xampp.exe, xampp.args, {
      cwd: xampp.cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return;
  }
  await run('powershell', ['-NoProfile', '-Command', `Start-Service -Name "${serviceName}"`]);
}

async function stopService(serviceName) {
  const xampp = findXamppDef(serviceName);
  if (xampp) {
    // XAMPP's own mysql_stop.bat ships broken (see comment above), so the
    // process is killed directly by name instead.
    await run('taskkill', ['/IM', `${xampp.processName}.exe`, '/F']);
    return;
  }
  await run('powershell', ['-NoProfile', '-Command', `Stop-Service -Name "${serviceName}" -Force`]);
}

function getVersionSync(cmd, versionArgs, extractRegex) {
  try {
    const out = execFileSync(cmd, versionArgs, { encoding: 'utf-8', timeout: 5000, windowsHide: true });
    const match = out.match(extractRegex);
    return match ? match[1] : out.trim().split('\n')[0];
  } catch {
    return null;
  }
}

// Runtime availability (not services - these are just "is it on PATH").
function detectRuntimes() {
  return [
    { id: 'node', label: 'Node.js', version: getVersionSync('node', ['--version'], /v?([\d.]+)/) },
    { id: 'php', label: 'PHP', version: getVersionSync('php', ['-v'], /PHP ([\d.]+)/) },
  ].map(r => ({ ...r, installed: r.version !== null }));
}

module.exports = { detectServices, startService, stopService, detectRuntimes };
