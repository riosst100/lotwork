const { execFile, execFileSync } = require('child_process');

// Windows service name patterns for common local dev databases. Different
// installers name these differently (stock MySQL installer vs XAMPP vs
// Laragon), so each entry tries a few known patterns.
const SERVICE_DEFINITIONS = [
  { id: 'mysql', label: 'MySQL', patterns: ['^mysql$', '^mysql\\d*$', '^mysqld$'] },
  { id: 'postgresql', label: 'PostgreSQL', patterns: ['^postgresql-x64-\\d+$', '^postgresql$'] },
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
      });
    }
  }
  return found;
}

async function startService(serviceName) {
  await run('powershell', ['-NoProfile', '-Command', `Start-Service -Name "${serviceName}"`]);
}

async function stopService(serviceName) {
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
