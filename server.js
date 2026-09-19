const express = require('express');
const path = require('path');
const fs = require('fs');
const net = require('net');
const store = require('./store');
const pm = require('./processManager');
const caddy = require('./caddyManager');
const hosts = require('./hostsManager');
const { dataDir, publicDir } = require('./paths');

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
  return { ...project, status: pm.getStatus(project.id) };
}

function syncDomains() {
  const projects = store.loadProjects();
  const caddyResult = caddy.reloadCaddy(projects);
  const domains = projects.filter(p => p.domain).map(p => p.domain);
  const hostsResult = hosts.syncHosts(domains);
  return { caddyResult, hostsResult };
}

app.get('/api/projects', async (req, res) => {
  const projects = store.loadProjects();
  res.json(projects.map(serialize));
});

app.post('/api/projects', (req, res) => {
  try {
    const project = store.addProject(req.body);
    let sync = null;
    if (project.domain) sync = syncDomains();
    res.json({ ...serialize(project), sync: sync && { hostsOk: sync.hostsResult.ok, hostsMessage: sync.hostsResult.message } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/projects/:id', (req, res) => {
  try {
    const before = store.getProject(req.params.id);
    const project = store.updateProject(req.params.id, req.body);
    let sync = null;
    if (project.domain || (before && before.domain)) sync = syncDomains();
    res.json({ ...serialize(project), sync: sync && { hostsOk: sync.hostsResult.ok, hostsMessage: sync.hostsResult.message } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/projects/:id', (req, res) => {
  const project = store.getProject(req.params.id);
  pm.stopProject(req.params.id);
  store.removeProject(req.params.id);
  if (project && project.domain) syncDomains();
  res.json({ ok: true });
});

app.get('/api/ports/check/:port', async (req, res) => {
  const free = await checkPortFree(Number(req.params.port));
  res.json({ free });
});

app.post('/api/projects/:id/start', async (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project tidak ditemukan' });

  const free = await checkPortFree(project.port);
  if (!free) {
    return res.status(409).json({ error: `Port ${project.port} sedang dipakai proses lain di luar lotwork` });
  }

  try {
    const result = pm.startProject(project);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/projects/:id/stop', (req, res) => {
  const ok = pm.stopProject(req.params.id);
  res.json({ ok });
});

app.get('/api/projects/:id/logs', (req, res) => {
  res.json({ logs: pm.getLogs(req.params.id) });
});

app.post('/api/caddy/reload', (req, res) => {
  const { caddyResult, hostsResult } = syncDomains();
  res.json({ ...caddyResult, hostsMessage: hostsResult.message, hostsOk: hostsResult.ok });
});

app.get('/api/caddy/status', (req, res) => {
  res.json({ installed: caddy.isCaddyInstalled() });
});

app.post('/api/hosts/sync', (req, res) => {
  const projects = store.loadProjects();
  const domains = projects.filter(p => p.domain).map(p => p.domain);
  const result = hosts.syncHosts(domains);
  res.json(result);
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
