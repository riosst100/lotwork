const express = require('express');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const docker = require('./dockerManager');
const wsl = require('./wsl');
const caddy = require('./caddyManager');
const hosts = require('./hostsManager');
const envFile = require('./envFile');
const nextConfig = require('./nextConfig');
const gitOps = require('./gitOps');
const systemServices = require('./systemServices');
const sshLauncher = require('./sshLauncher');
const { dataDir, publicDir, appRoot } = require('./paths');

const app = express();
const PORT = process.env.LOTWORK_PORT || 4400;

app.use(express.json());
app.use(express.static(publicDir));

// Card git info (branch, remote) is read straight from files in .git - no
// git spawn - but for WSL repos those are reads over the \\wsl.localhost
// share and the dashboard polls every few seconds, so it's cached. Git
// actions invalidate their project, and the dashboard's Sync button
// (/api/sync) clears everything. Change counts and the last commit need a
// git spawn, so only the Git panel fetches them (/git/status), on demand.
const GIT_CACHE_MS = 60000;
const gitCache = new Map(); // cwd -> { at, data }

function getGitInfo(cwd) {
  const cached = gitCache.get(cwd);
  if (cached && Date.now() - cached.at < GIT_CACHE_MS) return cached.data;
  const data = {
    repoUrl: gitOps.getRemoteUrlSync(cwd),
    currentBranch: gitOps.getCurrentBranchSync(cwd),
    defaultBranch: gitOps.getDefaultBranchSync(cwd),
  };
  gitCache.set(cwd, { at: Date.now(), data });
  return data;
}

function invalidateGit(cwd) {
  gitCache.delete(cwd);
}

async function serialize(project) {
  if (project.kind !== 'compose') {
    // Archived pre-Docker project: read-only, never started or git-polled.
    return { ...project, status: { running: false } };
  }
  const [status, git] = await Promise.all([docker.getProjectStatus(project), getGitInfo(project.cwd)]);
  return { ...project, status, ...git };
}

function domainTargets(projects) {
  return projects
    .filter(p => p.kind === 'compose')
    .flatMap(p => (p.domains || []).map(d => ({ domain: d.domain, port: d.port })));
}

// Syncs run one at a time: reloadCaddy is async now, and two overlapping runs
// could each see no Caddy process yet and start a second `caddy run`.
let domainSyncQueue = Promise.resolve();

function syncDomains() {
  const next = domainSyncQueue.then(syncDomainsNow, syncDomainsNow);
  domainSyncQueue = next.catch(() => {});
  return next;
}

async function syncDomainsNow() {
  const targets = domainTargets(store.loadProjects());
  const caddyResult = await caddy.reloadCaddy(targets);
  const hostsResult = hosts.syncHosts(targets.map(t => t.domain));
  return { caddyResult, hostsResult };
}

// Best-effort: if the project (or one of its first-level subfolders, e.g.
// repo/frontend) is a Next.js app, add the domain to allowedDevOrigins so the
// dev server doesn't block HMR requests coming through the Caddy proxy.
function syncNextAllowedOrigin(project, domain) {
  const candidates = [project.cwd];
  try {
    for (const entry of fs.readdirSync(project.cwd, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        candidates.push(path.join(project.cwd, entry.name));
      }
    }
  } catch {}
  let last = null;
  for (const dir of candidates) {
    const result = nextConfig.ensureAllowedDevOrigin(dir, domain);
    if (result.reason !== 'not_next_project') last = result;
    if (result.ok === false && result.reason === 'unrecognized_format') return result;
  }
  return last;
}

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.local$/;

const LOTWORK_SELF_ID = '__lotwork_self__';

async function getLotworkSelfEntry() {
  return {
    id: LOTWORK_SELF_ID,
    name: 'LotWork',
    cwd: appRoot,
    port: PORT,
    isSelf: true,
    status: { running: true },
    ...getGitInfo(appRoot),
  };
}

// Validates the add/edit form and reads the compose file, so the stored
// project always matches what `docker compose` itself sees.
async function buildComposeProject(body, existingId) {
  const name = (body.name || '').trim();
  const cwd = (body.cwd || '').trim();
  const composeFile = (body.composeFile || '').trim();
  if (!name || !cwd || !composeFile) throw new Error('Nama, folder, dan compose file wajib diisi.');
  const cwdInfo = wsl.parseUnc(cwd);
  const fileInfo = wsl.parseUnc(composeFile);
  if (!cwdInfo || !fileInfo) throw new Error('Folder dan compose file harus berada di dalam WSL.');
  if (cwdInfo.distro.toLowerCase() !== fileInfo.distro.toLowerCase()) {
    throw new Error('Folder dan compose file harus berada di distro WSL yang sama.');
  }
  if (!fs.existsSync(cwd)) throw new Error(`Folder tidak ditemukan: ${cwdInfo.linuxPath}`);

  const info = await docker.inspectComposeFile(composeFile);
  const clash = store.loadProjects().find(p => p.kind === 'compose' && p.composeProject === info.name && p.id !== existingId);
  if (clash) throw new Error(`Compose project "${info.name}" sudah terdaftar sebagai "${clash.name}".`);


  return {
    name, cwd, composeFile,
    composeProject: info.name,
    services: info.services,
    ports: info.ports,
  };
}

function getComposeProject(req, res) {
  const project = store.getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project tidak ditemukan' });
    return null;
  }
  if (project.kind !== 'compose') {
    res.status(400).json({ error: 'Project arsip tidak bisa dijalankan.' });
    return null;
  }
  return project;
}

app.get('/api/projects', async (req, res) => {
  const projects = store.loadProjects();
  const [serialized, selfEntry] = await Promise.all([
    Promise.all(projects.map(serialize)),
    getLotworkSelfEntry(),
  ]);
  res.json([selfEntry, ...serialized]);
});

app.post('/api/projects', async (req, res) => {
  try {
    const project = store.addProject(await buildComposeProject(req.body));
    res.json(await serialize(project));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/projects/:id', async (req, res) => {
  try {
    const before = store.getProject(req.params.id);
    if (!before) return res.status(404).json({ error: 'Project tidak ditemukan' });
    // Partial updates (e.g. the sidejob toggle) skip the full form validation.
    const isFullEdit = req.body.composeFile !== undefined;
    const updates = isFullEdit ? await buildComposeProject(req.body, before.id) : req.body;
    const project = store.updateProject(req.params.id, updates);
    invalidateGit(project.cwd);
    res.json(await serialize(project));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Removes the project from lotwork only - its containers are left as they are.
app.delete('/api/projects/:id', async (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project tidak ditemukan' });
  store.removeProject(req.params.id);
  if ((project.domains || []).length) await syncDomains();
  res.json({ ok: true });
});

// --- Custom domains (several per project, each pointing at one published port) ---

app.post('/api/projects/:id/domains', async (req, res) => {
  const project = getComposeProject(req, res);
  if (!project) return;
  const name = String(req.body.domain || '').trim().toLowerCase().replace(/\.local$/, '');
  const domain = name ? `${name}.local` : '';
  const port = Number(req.body.port);
  if (!DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Nama domain tidak valid (huruf kecil, angka, titik, dan strip).' });
  if (!port) return res.status(400).json({ error: 'Pilih port container untuk domain ini.' });
  const owner = store.loadProjects().find(p => (p.domains || []).some(d => d.domain === domain));
  if (owner) return res.status(400).json({ error: `Domain ${domain} sudah dipakai di project "${owner.name}".` });

  const published = (project.ports || []).find(pt => pt.hostPort === port);
  const entry = store.addDomain(project.id, { domain, port, service: published ? published.service : '' });
  const sync = await syncDomains();
  res.json({
    domain: entry,
    sync: { hostsOk: sync.hostsResult.ok, hostsMessage: sync.hostsResult.message },
    nextOrigin: syncNextAllowedOrigin(project, domain),
  });
});

app.delete('/api/projects/:id/domains/:domainId', async (req, res) => {
  const project = getComposeProject(req, res);
  if (!project) return;
  store.removeDomain(project.id, req.params.domainId);
  const sync = await syncDomains();
  res.json({ ok: true, sync: { hostsOk: sync.hostsResult.ok, hostsMessage: sync.hostsResult.message } });
});

app.post('/api/projects/:id/refresh', async (req, res) => {
  const project = getComposeProject(req, res);
  if (!project) return;
  try {
    const info = await docker.inspectComposeFile(project.composeFile);
    const updated = store.updateProject(project.id, { composeProject: info.name, services: info.services, ports: info.ports });
    invalidateGit(project.cwd);
    res.json(await serialize(updated));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/projects/:id/start', async (req, res) => {
  const project = getComposeProject(req, res);
  if (!project) return;
  try {
    await docker.up(project);
    store.incrementStartCount(project.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects/:id/stop', async (req, res) => {
  const project = getComposeProject(req, res);
  if (!project) return;
  try {
    await docker.stop(project);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects/:id/restart', async (req, res) => {
  const project = getComposeProject(req, res);
  if (!project) return;
  try {
    await docker.restart(project);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects/:id/down', async (req, res) => {
  const project = getComposeProject(req, res);
  if (!project) return;
  try {
    await docker.down(project);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects/:id/services/:service/:action', async (req, res) => {
  const project = getComposeProject(req, res);
  if (!project) return;
  const { service, action } = req.params;
  try {
    if (action === 'start') await docker.up(project, [service]);
    else if (action === 'stop') await docker.stop(project, [service]);
    else if (action === 'restart') await docker.restart(project, [service]);
    else return res.status(400).json({ error: 'Aksi tidak dikenal' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:id/logs', async (req, res) => {
  const project = getComposeProject(req, res);
  if (!project) return;
  try {
    res.json({ logs: await docker.logs(project, req.query.service || '') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manual "Sync": drops cached git info and container status so the next
// fetch reflects changes made outside lotwork (editor, terminal, Docker CLI).
app.post('/api/sync', (req, res) => {
  gitCache.clear();
  docker.invalidate();
  res.json({ ok: true });
});

// --- WSL folder picker ---

app.get('/api/wsl/distros', async (req, res) => {
  res.json({ distros: await wsl.listDistros() });
});

app.get('/api/wsl/browse', async (req, res) => {
  const distro = req.query.distro;
  if (!distro) return res.status(400).json({ error: 'Distro wajib diisi' });
  try {
    const linuxPath = req.query.path || await wsl.getHomeDir(distro);
    res.json({ distro, ...wsl.listDirectory(distro, linuxPath), unc: wsl.toUnc(distro, linuxPath) });
  } catch (e) {
    res.status(400).json({ error: `Tidak bisa membuka folder: ${e.message}` });
  }
});

app.get('/api/wsl/compose-files', (req, res) => {
  const dir = req.query.dir || '';
  if (!wsl.isWslPath(dir)) return res.status(400).json({ error: 'Folder harus berada di dalam WSL' });
  const files = wsl.findComposeFiles(dir).map(full => ({ path: full, label: path.relative(dir, full).replace(/\\/g, '/') }));
  res.json({ files });
});

app.post('/api/compose/inspect', async (req, res) => {
  try {
    res.json(await docker.inspectComposeFile(req.body.composeFile));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- .env, credentials, commands, SSH ---

app.get('/api/projects/:id/env', (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project tidak ditemukan' });
  try {
    const result = envFile.readEnvFile(project.cwd);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/projects/:id/env', (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project tidak ditemukan' });
  try {
    envFile.writeEnvFile(project.cwd, req.body.entries || []);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects/:id/credentials', (req, res) => {
  try {
    const credential = store.addCredential(req.params.id, req.body);
    res.json(credential);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/projects/:id/credentials/:credId', (req, res) => {
  try {
    const credential = store.updateCredential(req.params.id, req.params.credId, req.body);
    res.json(credential);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/projects/:id/credentials/:credId', (req, res) => {
  try {
    store.removeCredential(req.params.id, req.params.credId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/projects/:id/commands', (req, res) => {
  try {
    const command = store.addCommand(req.params.id, req.body);
    res.json(command);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/projects/:id/commands/:cmdId', (req, res) => {
  try {
    store.removeCommand(req.params.id, req.params.cmdId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/projects/:id/commands/:cmdId/run', async (req, res) => {
  const project = getComposeProject(req, res);
  if (!project) return;
  const command = (project.commands || []).find(c => c.id === req.params.cmdId);
  if (!command) return res.status(404).json({ error: 'Command tidak ditemukan' });
  try {
    const result = await docker.runCommand(project, command.service, command.command);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects/:id/ssh-targets', (req, res) => {
  try {
    const target = store.addSshTarget(req.params.id, req.body);
    res.json(target);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/projects/:id/ssh-targets/:targetId', (req, res) => {
  try {
    const target = store.updateSshTarget(req.params.id, req.params.targetId, req.body);
    res.json(target);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/projects/:id/ssh-targets/:targetId', (req, res) => {
  try {
    store.removeSshTarget(req.params.id, req.params.targetId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/projects/:id/ssh-targets/:targetId/connect', (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project tidak ditemukan' });
  const target = (project.sshTargets || []).find(t => t.id === req.params.targetId);
  if (!target) return res.status(404).json({ error: 'SSH target tidak ditemukan' });
  try {
    const result = sshLauncher.launchSsh(target);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Git ---

// The "LotWork" self-entry isn't a real registered project, so its GitHub
// panel operates on lotwork's own repo (appRoot) instead of a project.cwd.
function resolveProjectCwd(id) {
  if (id === LOTWORK_SELF_ID) return appRoot;
  const project = store.getProject(id);
  return project && project.kind === 'compose' ? project.cwd : null;
}

app.get('/api/projects/:id/git/status', async (req, res) => {
  const cwd = resolveProjectCwd(req.params.id);
  if (!cwd) return res.status(404).json({ error: 'Project tidak ditemukan' });
  try {
    const status = await gitOps.getStatus(cwd);
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects/:id/git/push', async (req, res) => {
  const cwd = resolveProjectCwd(req.params.id);
  if (!cwd) return res.status(404).json({ error: 'Project tidak ditemukan' });
  try {
    const result = await gitOps.commitAndPush(cwd, {
      branch: req.body.branch,
      message: req.body.message,
      files: req.body.files,
    });
    invalidateGit(cwd);
    res.json(result);
  } catch (e) {
    invalidateGit(cwd);
    // e.message is already user-facing here (gitOps rewrites push failures).
    res.status(400).json({ error: e.message || e.stderr, pushRejected: Boolean(e.pushRejected), committed: Boolean(e.committed) });
  }
});

// For a branch that is behind its remote: pull (merge) then push.
app.post('/api/projects/:id/git/pull-push', async (req, res) => {
  const cwd = resolveProjectCwd(req.params.id);
  if (!cwd) return res.status(404).json({ error: 'Project tidak ditemukan' });
  try {
    const result = await gitOps.pullAndPush(cwd, { branch: req.body.branch });
    invalidateGit(cwd);
    res.json(result);
  } catch (e) {
    invalidateGit(cwd);
    res.status(400).json({ error: e.message || e.stderr, isConflict: e.isConflict || false });
  }
});

app.post('/api/projects/:id/git/pull-main', async (req, res) => {
  const cwd = resolveProjectCwd(req.params.id);
  if (!cwd) return res.status(404).json({ error: 'Project tidak ditemukan' });
  try {
    const result = await gitOps.pullFromMain(cwd, {
      mainBranch: req.body.mainBranch,
      currentBranch: req.body.currentBranch,
    });
    if (req.params.id !== LOTWORK_SELF_ID) {
      store.setLastPulledAt(req.params.id, Date.now());
    }
    invalidateGit(cwd);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.stderr || e.message, isConflict: e.isConflict || false });
  }
});

// On-demand only (hits the network via git fetch) - not called from the
// polling /api/projects loop, so it's triggered by an explicit user action.
app.get('/api/projects/:id/git/check-main', async (req, res) => {
  const cwd = resolveProjectCwd(req.params.id);
  if (!cwd) return res.status(404).json({ error: 'Project tidak ditemukan' });
  try {
    const result = await gitOps.checkAheadBehindMain(cwd, req.query.mainBranch);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.stderr || e.message });
  }
});

app.post('/api/projects/:id/git/remote', async (req, res) => {
  const cwd = resolveProjectCwd(req.params.id);
  if (!cwd) return res.status(404).json({ error: 'Project tidak ditemukan' });
  try {
    const result = await gitOps.setRemoteUrl(cwd, req.body.url);
    invalidateGit(cwd);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.stderr || e.message });
  }
});

app.post('/api/projects/:id/git/init', async (req, res) => {
  const cwd = resolveProjectCwd(req.params.id);
  if (!cwd) return res.status(404).json({ error: 'Project tidak ditemukan' });
  try {
    const result = await gitOps.initRepo(cwd);
    invalidateGit(cwd);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.stderr || e.message });
  }
});

app.post('/api/projects/:id/pin', async (req, res) => {
  try {
    const project = store.togglePinned(req.params.id);
    res.json(await serialize(project));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Caddy, environment, system services, hosts ---

app.post('/api/caddy/reload', async (req, res) => {
  const { caddyResult, hostsResult } = await syncDomains();
  res.json({ ...caddyResult, hostsMessage: hostsResult.message, hostsOk: hostsResult.ok });
});

app.get('/api/caddy/status', async (req, res) => {
  res.json(await caddy.checkCaddyAvailability());
});

app.get('/api/environment', (req, res) => {
  res.json({ environment: store.getEnvironment() });
});

app.put('/api/environment', (req, res) => {
  const environment = store.setEnvironment(req.body.environment);
  res.json({ environment });
});

app.post('/api/caddy/install', (req, res) => {
  if (process.platform !== 'win32') {
    return res.status(400).json({ error: 'Auto-install hanya didukung di Windows. Install Caddy manual: https://caddyserver.com/docs/install' });
  }
  const { exec } = require('child_process');
  exec('winget install CaddyServer.Caddy --accept-package-agreements --accept-source-agreements', { timeout: 120000 }, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: stderr || err.message });
    }
    res.json({ ok: true, needsRestart: true, message: 'Caddy installed. Restart lotwork server to detect it.' });
  });
});

app.get('/api/services', async (req, res) => {
  const [services, runtimes] = await Promise.all([
    systemServices.detectServices(),
    systemServices.detectRuntimes(),
  ]);
  res.json({ services, runtimes });
});

app.post('/api/services/:serviceName/start', async (req, res) => {
  try {
    await systemServices.startService(req.params.serviceName);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.stderr || e.message });
  }
});

app.post('/api/services/:serviceName/stop', async (req, res) => {
  try {
    await systemServices.stopService(req.params.serviceName);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.stderr || e.message });
  }
});

app.post('/api/hosts/sync', (req, res) => {
  const result = hosts.syncHosts(domainTargets(store.loadProjects()).map(t => t.domain));
  res.json(result);
});

app.get('/api/hosts', (req, res) => {
  try {
    res.json(hosts.listEntries());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/hosts/entries', (req, res) => {
  try {
    hosts.addEntry(req.body);
    res.json(hosts.listEntries());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/hosts/entries/:line', (req, res) => {
  try {
    hosts.updateEntry(Number(req.params.line), req.body.raw, req.body);
    res.json(hosts.listEntries());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/hosts/entries/:line', (req, res) => {
  try {
    hosts.deleteEntry(Number(req.params.line), req.body.raw);
    res.json(hosts.listEntries());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Resolves once the dashboard is listening, rejects if the port can't be bound
// (e.g. another lotwork instance already holds it). The Electron shell awaits
// this to decide whether to open the window or show an error.
const ready = new Promise((resolve, reject) => {
  const server = app.listen(PORT, () => {
    console.log(`lotwork dashboard running at http://localhost:${PORT}`);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'server.pid'), String(process.pid));

    if (domainTargets(store.loadProjects()).length) {
      syncDomains().catch(e => console.error('Domain sync failed:', e.message));
    }
    resolve(PORT);
  });
  server.once('error', reject);
});

// For the tray menu: how many registered compose projects have containers up.
async function runningProjects() {
  const projects = store.loadProjects().filter(p => p.kind === 'compose');
  const statuses = await Promise.all(projects.map(p => docker.getProjectStatus(p)));
  return projects.filter((p, i) => statuses[i].running);
}

async function stopAllProjects() {
  const running = await runningProjects();
  await Promise.allSettled(running.map(p => docker.stop(p)));
}

// Containers belong to Docker, not to lotwork, so they keep running after
// lotwork quits - only the Caddy proxy lotwork started is stopped.
function stopEverything() {
  caddy.stopCaddy();
}

function shutdown() {
  stopEverything();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { ready, stopEverything, runningProjects, stopAllProjects, PORT };
