const path = require('path');
const { execFile } = require('child_process');
const wsl = require('./wsl');

// Two ways of talking to Docker, picked per command:
// - Windows docker.exe with `-p <project>`: fast, enough for anything that only
//   needs the compose project name (ps, logs, stop, restart, down).
// - `docker compose -f <file>` inside the project's WSL distro: needed for
//   `up` and `exec`, so relative bind mounts / env files resolve exactly as
//   when the user runs compose themselves (otherwise containers get recreated
//   with different mount paths).

function runDocker(args, { timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    execFile('docker', args, { maxBuffer: 20 * 1024 * 1024, timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout || '', stderr: stderr || (err && !stdout ? err.message : '') });
    });
  });
}

function composeTarget(project) {
  const parsed = wsl.parseUnc(project.composeFile);
  if (!parsed) throw new Error('Compose file harus berada di dalam WSL');
  return { distro: parsed.distro, file: parsed.linuxPath, dir: path.posix.dirname(parsed.linuxPath) };
}

function runComposeInWsl(project, args, opts) {
  const { distro, file, dir } = composeTarget(project);
  const base = ['compose'];
  if (project.composeProject) base.push('-p', project.composeProject);
  base.push('-f', file);
  return wsl.run(distro, dir, 'docker', [...base, ...args], opts);
}

function runComposeByName(project, args, opts) {
  return runDocker(['compose', '-p', project.composeProject, ...args], opts);
}

// --- Container status (one `docker ps` for every project, cached briefly
// so the dashboard's polling doesn't spawn a process per project) ---

let cache = { at: 0, containers: [], promise: null };
const CACHE_MS = 4000;

function labelValue(labels, key) {
  const match = new RegExp(`(?:^|,)${key.replace(/\./g, '\\.')}=([^,]*)`).exec(labels || '');
  return match ? match[1] : '';
}

// "127.0.0.1:3020->3000/tcp, [::]:3020->3000/tcp, 9000/tcp" -> published ports only
function parsePorts(str) {
  const seen = new Map();
  for (const part of (str || '').split(',')) {
    const match = /(?:(.+):)?(\d+)->(\d+)\/(tcp|udp)/.exec(part.trim());
    if (!match) continue;
    const hostPort = Number(match[2]);
    if (!seen.has(hostPort)) seen.set(hostPort, { hostIp: match[1] || '0.0.0.0', hostPort, containerPort: Number(match[3]), proto: match[4] });
  }
  return [...seen.values()];
}

async function listContainers({ fresh = false } = {}) {
  if (!fresh && Date.now() - cache.at < CACHE_MS) return cache.containers;
  if (cache.promise) return cache.promise;
  cache.promise = (async () => {
    const result = await runDocker(['ps', '-a', '--filter', 'label=com.docker.compose.project', '--format', '{{json .}}'], { timeout: 15000 });
    const containers = result.code !== 0 ? [] : result.stdout.split(/\r?\n/).filter(Boolean).map(line => {
      try {
        const c = JSON.parse(line);
        return {
          id: c.ID,
          name: c.Names,
          image: c.Image,
          state: c.State,
          status: c.Status,
          project: labelValue(c.Labels, 'com.docker.compose.project'),
          service: labelValue(c.Labels, 'com.docker.compose.service'),
          oneoff: labelValue(c.Labels, 'com.docker.compose.oneoff') === 'True',
          ports: parsePorts(c.Ports),
        };
      } catch {
        return null;
      }
    }).filter(c => c && !c.oneoff);
    cache = { at: Date.now(), containers, promise: null };
    return containers;
  })();
  try {
    return await cache.promise;
  } finally {
    cache.promise = null;
  }
}

// Combines the services the compose file defines (stored when the project was
// saved) with the containers that actually exist, so a service that was never
// created still shows up as "not created" rather than disappearing.
async function getProjectStatus(project) {
  const containers = (await listContainers()).filter(c => c.project === project.composeProject);
  const byService = new Map();
  for (const c of containers) {
    if (!byService.has(c.service)) byService.set(c.service, []);
    byService.get(c.service).push(c);
  }
  const serviceNames = [...new Set([...(project.services || []), ...byService.keys()])];
  const services = serviceNames.map(name => {
    const list = byService.get(name) || [];
    const running = list.filter(c => c.state === 'running');
    const primary = running[0] || list[0];
    return {
      name,
      state: primary ? primary.state : 'not-created',
      status: primary ? primary.status : '',
      image: primary ? primary.image : '',
      replicas: list.length,
      ports: list.flatMap(c => c.ports),
    };
  });
  const runningCount = services.filter(s => s.state === 'running').length;
  return {
    running: runningCount > 0,
    runningCount,
    total: services.length,
    state: runningCount === 0 ? 'stopped' : runningCount === services.length ? 'running' : 'partial',
    services,
    ports: services.flatMap(s => s.ports.map(p => ({ ...p, service: s.name }))),
  };
}

// --- Compose file inspection (on add/edit) ---

async function inspectComposeFile(composeFile) {
  const parsed = wsl.parseUnc(composeFile);
  if (!parsed) throw new Error('Compose file harus berada di dalam WSL');
  const result = await wsl.run(parsed.distro, path.posix.dirname(parsed.linuxPath), 'docker',
    ['compose', '-f', parsed.linuxPath, 'config', '--format', 'json'], { timeout: 60000 });
  if (result.code !== 0) {
    throw new Error(`Gagal membaca compose file:\n${(result.stderr || result.stdout).trim()}`);
  }
  const config = JSON.parse(result.stdout);
  const services = Object.keys(config.services || {});
  const ports = [];
  for (const [service, def] of Object.entries(config.services || {})) {
    for (const p of def.ports || []) {
      if (p.published) ports.push({ service, hostPort: Number(p.published), containerPort: Number(p.target) });
    }
  }
  return { name: config.name, services, ports };
}

// --- Actions ---

function tail(text, lines = 60) {
  return text.split(/\r?\n/).slice(-lines).join('\n').trim();
}

async function up(project, services = []) {
  const result = await runComposeInWsl(project, ['up', '-d', ...services], { timeout: 15 * 60 * 1000 });
  invalidate();
  if (result.code !== 0) {
    throw new Error(tail(result.stderr || result.stdout) || 'docker compose up gagal');
  }
  return result;
}

async function byName(project, args, errorLabel) {
  const result = await runComposeByName(project, args, { timeout: 5 * 60 * 1000 });
  invalidate();
  if (result.code !== 0) throw new Error(tail(result.stderr || result.stdout) || errorLabel);
  return result;
}

const stop = (project, services = []) => byName(project, ['stop', ...services], 'docker compose stop gagal');
const restart = (project, services = []) => byName(project, ['restart', ...services], 'docker compose restart gagal');
const down = (project) => byName(project, ['down'], 'docker compose down gagal');

async function logs(project, service, lines = 400) {
  const args = ['logs', '--no-color', '--tail', String(lines)];
  if (service) args.push(service);
  const result = await runComposeByName(project, args, { timeout: 20000 });
  return (result.stdout + (result.code !== 0 ? result.stderr : '')).trimEnd();
}

// Saved commands run either inside a service container (`exec`), or - with
// no service - as a plain shell command in the project folder inside WSL.
async function runCommand(project, service, command) {
  if (service) {
    const result = await runComposeInWsl(project, ['exec', '-T', service, 'sh', '-lc', command], { timeout: 30 * 60 * 1000 });
    return { code: result.code, output: `$ [${service}] ${command}\n${result.stdout}${result.stderr}` };
  }
  const parsed = wsl.parseUnc(project.cwd);
  if (!parsed) throw new Error('Folder project harus berada di dalam WSL');
  const result = await wsl.run(parsed.distro, parsed.linuxPath, 'bash', ['-lc', command], { timeout: 30 * 60 * 1000 });
  return { code: result.code, output: `$ ${command}\n${result.stdout}${result.stderr}` };
}

function invalidate() {
  cache.at = 0;
}

module.exports = {
  listContainers, getProjectStatus, inspectComposeFile, invalidate,
  up, stop, restart, down, logs, runCommand, parsePorts,
};
