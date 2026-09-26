const express = require('express');
const path = require('path');
const fs = require('fs');
const net = require('net');
const store = require('./store');
const pm = require('./processManager');
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

function checkPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.once('close', () => resolve(true)).close())
      .listen(port, '127.0.0.1');
  });
}

function serialize(project) {
  return {
    ...project,
    status: pm.getStatus(project.id),
    repoUrl: gitOps.getRemoteUrlSync(project.cwd),
    currentBranch: gitOps.getCurrentBranchSync(project.cwd),
    defaultBranch: gitOps.getDefaultBranchSync(project.cwd),
  };
}

async function serializeWithCommit(project) {
  const [lastCommit, gitChanges] = await Promise.all([
    gitOps.getLastCommit(project.cwd),
    gitOps.getChangeSummary(project.cwd),
  ]);
  return { ...serialize(project), lastCommit, gitChanges };
}

function syncDomains() {
  const projects = store.loadProjects();
  const caddyResult = caddy.reloadCaddy(projects);
  const domains = projects.filter(p => p.domain).map(p => p.domain);
  const hostsResult = hosts.syncHosts(domains);
  return { caddyResult, hostsResult };
}

// Best-effort: if this is a Next.js project, add its domain to allowedDevOrigins
// so the dev server doesn't block HMR requests coming through the Caddy proxy.
function syncNextAllowedOrigin(project) {
  if (!project.domain) return null;
  const result = nextConfig.ensureAllowedDevOrigin(project.cwd, project.domain);
  if (result.reason === 'not_next_project') return null;
  return result;
}

const LOTWORK_SELF_ID = '__lotwork_self__';

async function getLotworkSelfEntry() {
  const cwd = appRoot;
  const [lastCommit, gitChanges] = await Promise.all([
    gitOps.getLastCommit(cwd),
    gitOps.getChangeSummary(cwd),
  ]);
  return {
    id: LOTWORK_SELF_ID,
    name: 'LotWork',
    cwd,
    command: null,
    port: PORT,
    domain: null,
    isSelf: true,
    status: { running: true },
    repoUrl: gitOps.getRemoteUrlSync(cwd),
    currentBranch: gitOps.getCurrentBranchSync(cwd),
    defaultBranch: gitOps.getDefaultBranchSync(cwd),
    lastCommit,
    gitChanges,
  };
}

app.get('/api/projects', async (req, res) => {
  const projects = store.loadProjects();
  const serialized = await Promise.all(projects.map(serializeWithCommit));
  const selfEntry = await getLotworkSelfEntry();
  res.json([selfEntry, ...serialized]);
});

app.post('/api/projects', (req, res) => {
  try {
    if (req.body.domain && !req.body.port) {
      return res.status(400).json({ error: 'Port wajib diisi kalau pakai custom domain.' });
    }
    const project = store.addProject(req.body);
    let sync = null;
    if (project.domain) sync = syncDomains();
    const nextOrigin = syncNextAllowedOrigin(project);
    res.json({
      ...serialize(project),
      sync: sync && { hostsOk: sync.hostsResult.ok, hostsMessage: sync.hostsResult.message },
      nextOrigin,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/projects/:id', (req, res) => {
  try {
    const before = store.getProject(req.params.id);
    const domain = req.body.domain !== undefined ? req.body.domain : before && before.domain;
    const port = req.body.port !== undefined ? req.body.port : before && before.port;
    if (domain && !port) {
      return res.status(400).json({ error: 'Port wajib diisi kalau pakai custom domain.' });
    }
    const project = store.updateProject(req.params.id, req.body);
    let sync = null;
    if (project.domain || (before && before.domain)) sync = syncDomains();
    const nextOrigin = syncNextAllowedOrigin(project);
    res.json({
      ...serialize(project),
      sync: sync && { hostsOk: sync.hostsResult.ok, hostsMessage: sync.hostsResult.message },
      nextOrigin,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/projects/:id', (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project tidak ditemukan' });
  pm.stopProject(req.params.id);
  store.removeProject(req.params.id);
  if (project.domain) syncDomains();
  res.json({ ok: true });
});

app.get('/api/ports/check/:port', async (req, res) => {
  const free = await checkPortFree(Number(req.params.port));
  res.json({ free });
});

app.get('/api/ports/next', async (req, res) => {
  const base = Number(req.query.base) || 3000;
  const max = Number(req.query.max) || (base + 1000);
  const registeredPorts = new Set(store.loadProjects().map(p => p.port));

  for (let port = base; port <= max; port++) {
    if (registeredPorts.has(port)) continue;
    const free = await checkPortFree(port);
    if (free) return res.json({ port });
  }
  res.status(404).json({ error: `Tidak ada port kosong antara ${base}-${max}` });
});

app.post('/api/projects/:id/start', async (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project tidak ditemukan' });

  if (project.port) {
    const free = await checkPortFree(project.port);
    if (!free) {
      return res.status(409).json({ error: `Port ${project.port} sedang dipakai proses lain di luar lotwork` });
    }
  }

  try {
    const result = pm.startProject(project);
    store.incrementStartCount(project.id);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

function checkPortReady(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1', timeout: 1000 });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

app.get('/api/projects/:id/ready', async (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project tidak ditemukan' });
  const ready = project.port ? await checkPortReady(project.port) : true;
  res.json({ ready });
});

app.post('/api/projects/:id/stop', (req, res) => {
  const ok = pm.stopProject(req.params.id);
  res.json({ ok });
});

app.get('/api/projects/:id/logs', (req, res) => {
  res.json({ logs: pm.getLogs(req.params.id) });
});

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
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project tidak ditemukan' });
  const command = (project.commands || []).find(c => c.id === req.params.cmdId);
  if (!command) return res.status(404).json({ error: 'Command tidak ditemukan' });
  try {
    const result = await pm.runCommand(project, command.command);
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

// The "LotWork" self-entry isn't a real registered project, so its GitHub
// panel operates on lotwork's own repo (appRoot) instead of a project.cwd.
function resolveProjectCwd(id) {
  if (id === LOTWORK_SELF_ID) return appRoot;
  const project = store.getProject(id);
  return project ? project.cwd : null;
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
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.stderr || e.message });
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
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.stderr || e.message });
  }
});

app.post('/api/projects/:id/pin', (req, res) => {
  try {
    const project = store.togglePinned(req.params.id);
    res.json(serialize(project));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/caddy/reload', (req, res) => {
  const { caddyResult, hostsResult } = syncDomains();
  res.json({ ...caddyResult, hostsMessage: hostsResult.message, hostsOk: hostsResult.ok });
});

app.get('/api/caddy/status', (req, res) => {
  res.json(caddy.checkCaddyAvailability());
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

app.get('/api/services', (req, res) => {
  res.json({
    services: systemServices.detectServices(),
    runtimes: systemServices.detectRuntimes(),
  });
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
  const projects = store.loadProjects();
  const domains = projects.filter(p => p.domain).map(p => p.domain);
  const result = hosts.syncHosts(domains);
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

app.listen(PORT, () => {
  console.log(`lotwork dashboard running at http://localhost:${PORT}`);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'server.pid'), String(process.pid));

  const projects = store.loadProjects();
  if (projects.some(p => p.domain)) {
    syncDomains();
  }
});

function shutdown() {
  pm.stopAll();
  caddy.stopCaddy();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
