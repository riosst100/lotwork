const fs = require('fs');
const path = require('path');
const { dataDir } = require('./paths');

const DATA_FILE = path.join(dataDir, 'projects.json');
const RECENT_WINDOW_MS = 8 * 60 * 60 * 1000; // 8 hours

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ projects: [] }, null, 2));
}

function loadProjects() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  let projects;
  try {
    projects = JSON.parse(raw).projects || [];
  } catch {
    projects = [];
  }
  const now = Date.now();
  const isRecent = (p) => p.lastStartedAt && (now - p.lastStartedAt) < RECENT_WINDOW_MS;

  return projects
    .map(p => ({ startCount: 0, lastStartedAt: null, credentials: [], ...p }))
    .sort((a, b) => {
      const aRecent = isRecent(a);
      const bRecent = isRecent(b);
      if (aRecent && bRecent) return b.lastStartedAt - a.lastStartedAt;
      if (aRecent && !bRecent) return -1;
      if (!aRecent && bRecent) return 1;
      return b.startCount - a.startCount;
    });
}

function saveProjects(projects) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify({ projects }, null, 2));
}

function addProject(project) {
  const projects = loadProjects();
  const id = project.id || String(Date.now());
  const existingPortOwner = projects.find(p => p.port === project.port && p.id !== id);
  if (existingPortOwner) {
    throw new Error(`Port ${project.port} sudah dipakai oleh project "${existingPortOwner.name}"`);
  }
  const newProject = {
    id,
    name: project.name,
    cwd: project.cwd,
    command: project.command,
    port: project.port,
    domain: project.domain || '',
    env: project.env || {},
    stack: project.stack || '',
    startCount: 0,
    lastStartedAt: null,
    credentials: [],
  };
  projects.push(newProject);
  saveProjects(projects);
  return newProject;
}

function updateProject(id, updates) {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) throw new Error('Project tidak ditemukan');
  if (updates.port) {
    const conflict = projects.find(p => p.port === updates.port && p.id !== id);
    if (conflict) throw new Error(`Port ${updates.port} sudah dipakai oleh project "${conflict.name}"`);
  }
  projects[idx] = { ...projects[idx], ...updates };
  saveProjects(projects);
  return projects[idx];
}

function removeProject(id) {
  const projects = loadProjects().filter(p => p.id !== id);
  saveProjects(projects);
}

function getProject(id) {
  return loadProjects().find(p => p.id === id);
}

function incrementStartCount(id) {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) return;
  projects[idx].startCount = (projects[idx].startCount || 0) + 1;
  projects[idx].lastStartedAt = Date.now();
  saveProjects(projects);
}

function addCredential(projectId, credential) {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx === -1) throw new Error('Project tidak ditemukan');
  const newCredential = {
    id: String(Date.now()),
    label: credential.label || '',
    username: credential.username || '',
    password: credential.password || '',
  };
  projects[idx].credentials = [...(projects[idx].credentials || []), newCredential];
  saveProjects(projects);
  return newCredential;
}

function updateCredential(projectId, credentialId, updates) {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx === -1) throw new Error('Project tidak ditemukan');
  const credentials = projects[idx].credentials || [];
  const cIdx = credentials.findIndex(c => c.id === credentialId);
  if (cIdx === -1) throw new Error('Credential tidak ditemukan');
  credentials[cIdx] = { ...credentials[cIdx], ...updates, id: credentialId };
  projects[idx].credentials = credentials;
  saveProjects(projects);
  return credentials[cIdx];
}

function removeCredential(projectId, credentialId) {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx === -1) throw new Error('Project tidak ditemukan');
  projects[idx].credentials = (projects[idx].credentials || []).filter(c => c.id !== credentialId);
  saveProjects(projects);
}

module.exports = {
  loadProjects, saveProjects, addProject, updateProject, removeProject, getProject, incrementStartCount,
  addCredential, updateCredential, removeCredential,
};
