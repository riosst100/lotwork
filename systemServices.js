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
// XAMPP can be installed on any drive, so a few common roots are checked
// rather than assuming C:\xampp.
const XAMPP_ROOT_CANDIDATES = ['C:\\xampp', 'D:\\xampp', 'E:\\xampp'];

function findXamppRoot() {
  return XAMPP_ROOT_CANDIDATES.find(root => fs.existsSync(root)) || null;
}

function buildXamppDefs(xamppRoot) {
  return [
    {
      id: 'xampp-mysql', label: 'MySQL (XAMPP)', processName: 'mysqld',
      exe: `${xamppRoot}\\mysql\\bin\\mysqld.exe`,
      args: ['--defaults-file=' + `${xamppRoot}\\mysql\\bin\\my.ini`, '--standalone', '--skip-grant-tables'],
      cwd: `${xamppRoot}\\mysql\\bin`,
    },
  ];
}

// Manually-installed MySQL (downloaded zip, not the Windows installer and
// not bundled with a stack like XAMPP/Laragon) also just runs mysqld.exe as
// a plain process, launched with --defaults-file pointing at its own my.ini.
// Each candidate root is checked for that layout; every match found is
// listed as its own entry (with a unique id derived from the root) so two
// manual MySQL installs never collide with each other.
const MANUAL_MYSQL_ROOT_CANDIDATES = [
  'D:\\devtools\\mysql-8.4',
  'C:\\devtools\\mysql-8.4',
  'D:\\mysql',
  'C:\\mysql',
];

function findManualMysqlRoots() {
  return MANUAL_MYSQL_ROOT_CANDIDATES.filter(root => fs.existsSync(`${root}\\bin\\mysqld.exe`));
}

function buildManualMysqlDef(root) {
  const id = 'manual-mysql-' + root.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const iniPath = `${root}\\my.ini`;
  const args = fs.existsSync(iniPath) ? [`--defaults-file=${iniPath}`] : [];
  return {
    id, label: `MySQL (${root})`, processName: 'mysqld',
    exe: `${root}\\bin\\mysqld.exe`,
    args,
    cwd: `${root}\\bin`,
  };
}

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

// One PowerShell call per poll: starting powershell.exe is the expensive part
// (~0.3-0.6s CPU each), so services and process paths come back together.
// Get-Service is structured and locale-independent, unlike `sc query` text.
// Process paths come from Win32_Process (which exposes ExecutablePath, unlike
// Get-Process) because two separate manually-run mysqld.exe instances (e.g.
// XAMPP's and a standalone install) share the same process name - matching
// by name alone can't tell them apart. That half is the slower query, so it
// only runs when a process-based install exists. Async so the poll never
// blocks the event loop (the server shares a process with the Electron shell).
async function queryWindowsState(includeProcessPaths) {
  const paths = includeProcessPaths
    ? '@(Get-CimInstance Win32_Process | Where-Object ExecutablePath | Select-Object -ExpandProperty ExecutablePath)'
    : '@()';
  const script = `@{ services = @(Get-Service | Select-Object Name, DisplayName, Status); paths = ${paths} } | ConvertTo-Json -Compress -Depth 3`;
  try {
    const parsed = JSON.parse(await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]));
    return {
      services: parsed.services || [],
      runningPaths: new Set((parsed.paths || []).map(p => p.toLowerCase())),
    };
  } catch {
    return { services: [], runningPaths: new Set() };
  }
}

// Finds installed dev-database services on this machine and their current
// status. Returns only services that were actually found (not every
// definition), since most machines won't have all of them installed.
// Overlapping callers share one in-flight query.
let detectInFlight = null;

function detectServices() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  if (!detectInFlight) {
    detectInFlight = detectServicesNow().finally(() => { detectInFlight = null; });
  }
  return detectInFlight;
}

async function detectServicesNow() {
  // Process-based MySQL installs (XAMPP's bundled copy, plus any manually
  // unzipped standalone installs) - only list entries whose exe actually
  // exists on this machine, and check "running" by exact exe path since
  // process name alone ("mysqld") can't tell two such installs apart.
  const processDefs = [];
  const xamppRoot = findXamppRoot();
  if (xamppRoot) processDefs.push(...buildXamppDefs(xamppRoot));
  for (const root of findManualMysqlRoots()) processDefs.push(buildManualMysqlDef(root));
  const existingProcessDefs = processDefs.filter(def => fs.existsSync(def.exe));

  const { services, runningPaths } = await queryWindowsState(existingProcessDefs.length > 0);

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

  for (const def of existingProcessDefs) {
    found.push({
      id: def.id,
      label: def.label,
      serviceName: def.id,
      displayName: def.label,
      running: runningPaths.has(def.exe.toLowerCase()),
      kind: def.id.startsWith('xampp') ? 'xampp' : 'manual-process',
    });
  }

  return found;
}

// Looks up a process-based def (XAMPP or manual MySQL) by its id, across
// every root currently found on disk.
function findProcessDef(serviceName) {
  const defs = [];
  const xamppRoot = findXamppRoot();
  if (xamppRoot) defs.push(...buildXamppDefs(xamppRoot));
  for (const root of findManualMysqlRoots()) defs.push(buildManualMysqlDef(root));
  return defs.find(d => d.id === serviceName) || null;
}

async function startService(serviceName) {
  const processDef = findProcessDef(serviceName);
  if (processDef) {
    // mysqld runs in the foreground until stopped, so it's spawned and
    // unref'd rather than awaited like a one-shot command - awaiting it via
    // execFile would hang forever since it never exits on its own.
    // `detached: true` on Windows gives the child its own console, which
    // defeats `windowsHide` and pops up mysqld's console window; omitting
    // it keeps windowsHide effective while unref() still lets lotwork exit
    // independently of the child.
    const child = spawn(processDef.exe, processDef.args, {
      cwd: processDef.cwd,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return;
  }
  await run('powershell', ['-NoProfile', '-Command', `Start-Service -Name "${serviceName}"`]);
}

async function stopService(serviceName) {
  const processDef = findProcessDef(serviceName);
  if (processDef) {
    // Killing by exe name alone (taskkill /IM mysqld.exe) would also kill
    // any other mysqld.exe instance running from a different install (e.g.
    // XAMPP's and a standalone one at once), so only PIDs matching this
    // install's exact exe path are targeted - via WMI filter, since taskkill
    // has no path-based filter. mysqld can spawn itself as a child process
    // on Windows, so every matching PID is killed, not just the first.
    let pids = [];
    let unreadablePathCount = 0;
    try {
      const out = execFileSync(
        'powershell',
        ['-NoProfile', '-Command',
          `Get-CimInstance Win32_Process -Filter "Name='${processDef.processName}.exe'" | ` +
          `Select-Object ProcessId, ExecutablePath | ConvertTo-Json -Compress`],
        { encoding: 'utf-8', timeout: 15000, windowsHide: true }
      );
      const trimmed = out.trim();
      if (trimmed) {
        const parsed = JSON.parse(trimmed);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (const proc of list) {
          if (!proc.ExecutablePath) {
            // WMI couldn't read this process's path - typically because it's
            // running with higher privileges than this lookup. Can't safely
            // tell if it's this install or a different one, so it's neither
            // killed nor silently ignored; surfaced as its own error below.
            unreadablePathCount++;
          } else if (proc.ExecutablePath.toLowerCase() === processDef.exe.toLowerCase()) {
            pids.push(String(proc.ProcessId));
          }
        }
      }
    } catch {
      // fall through - no matching process found
    }
    if (pids.length === 0) {
      if (unreadablePathCount > 0) {
        throw new Error(
          `Ada ${unreadablePathCount} proses mysqld.exe yang jalan tapi path-nya tidak bisa dibaca ` +
          `(biasanya karena privilege berbeda dari lotwork). Jalankan lotwork sebagai Administrator, ` +
          `atau matikan proses itu manual lewat Task Manager.`
        );
      }
      throw new Error(`${processDef.label} tidak sedang berjalan dari lokasi ini`);
    }
    for (const pid of pids) {
      await run('taskkill', ['/PID', pid, '/F']);
    }
    return;
  }
  await run('powershell', ['-NoProfile', '-Command', `Stop-Service -Name "${serviceName}" -Force`]);
}

function getVersion(cmd, versionArgs, extractRegex) {
  return new Promise(resolve => {
    execFile(cmd, versionArgs, { encoding: 'utf-8', timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const match = stdout.match(extractRegex);
      resolve(match ? match[1] : stdout.trim().split('\n')[0]);
    });
  });
}

// Runtime availability (not services - these are just "is it on PATH").
// Versions practically never change while lotwork runs, so the result is
// cached instead of spawning node/php on every services poll.
const RUNTIMES_TTL_MS = 5 * 60 * 1000;
let runtimesCache = { at: 0, promise: null };

function detectRuntimes() {
  if (!runtimesCache.promise || Date.now() - runtimesCache.at > RUNTIMES_TTL_MS) {
    const promise = Promise.all([
      getVersion('node', ['--version'], /v?([\d.]+)/).then(version => ({ id: 'node', label: 'Node.js', version })),
      getVersion('php', ['-v'], /PHP ([\d.]+)/).then(version => ({ id: 'php', label: 'PHP', version })),
    ]).then(list => list.map(r => ({ ...r, installed: r.version !== null })));
    runtimesCache = { at: Date.now(), promise };
  }
  return runtimesCache.promise;
}

module.exports = { detectServices, startService, stopService, detectRuntimes };
