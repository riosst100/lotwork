const fs = require('fs');
const path = require('path');
const { dataDir } = require('./paths');

const DATA_FILE = path.join(dataDir, 'projects.json');
const CONFIG_FILE = path.join(dataDir, 'config.json');

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ projects: [] }, null, 2));
}

// Global app-level setting (not per-project): whether this lotwork instance
// is running on a dev machine or on a production VPS. Purely a UI signal
// (badge/color) so it's obvious which one you're looking at - it doesn't
// change any start/stop/proxy behavior.
function getEnvironment() {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(CONFIG_FILE)) return 'local';
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    return config.environment === 'production' ? 'production' : 'local';
  } catch {
    return 'local';
  }
}

function setEnvironment(environment) {
  const value = environment === 'production' ? 'production' : 'local';
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ environment: value }, null, 2));
  return value;
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
  return projects
    .map(p => ({ startCount: 0, lastStartedAt: null, credentials: [], isSidejob: false, ...p }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function saveProjects(projects) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify({ projects }, null, 2));
}

function addProject(project) {
  const projects = loadProjects();
  const id = project.id || String(Date.now());
  if (project.port) {
    const existingPortOwner = projects.find(p => p.port === project.port && p.id !== id);
    if (existingPortOwner) {
      throw new Error(`Port ${project.port} sudah dipakai oleh project "${existingPortOwner.name}"`);
    }
  }
  const newProject = {
    id,
    name: project.name,
    cwd: project.cwd,
    command: project.command,
    port: project.port || null,
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

function setLastPulledAt(id, timestamp) {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) return;
  projects[idx].lastPulledAt = timestamp;
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

function addCommand(projectId, command) {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx === -1) throw new Error('Project tidak ditemukan');
  if (!command.label || !command.command) throw new Error('Label dan command wajib diisi');
  const newCommand = {
    id: String(Date.now()),
    label: command.label,
    command: command.command,
  };
  projects[idx].commands = [...(projects[idx].commands || []), newCommand];
  saveProjects(projects);
  return newCommand;
}

function removeCommand(projectId, commandId) {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx === -1) throw new Error('Project tidak ditemukan');
  projects[idx].commands = (projects[idx].commands || []).filter(c => c.id !== commandId);
  saveProjects(projects);
}

function removeCredential(projectId, credentialId) {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx === -1) throw new Error('Project tidak ditemukan');
  projects[idx].credentials = (projects[idx].credentials || []).filter(c => c.id !== credentialId);
  saveProjects(projects);
}

function addSshTarget(projectId, target) {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx === -1) throw new Error('Project tidak ditemukan');
  if (!target.host || !target.username) throw new Error('Host dan username wajib diisi');
  const newTarget = {
    id: String(Date.now()),
    label: target.label || '',
    host: target.host,
    port: target.port ? Number(target.port) : 22,
    username: target.username,
    password: target.password || '',
  };
  projects[idx].sshTargets = [...(projects[idx].sshTargets || []), newTarget];
  saveProjects(projects);
  return newTarget;
}

function updateSshTarget(projectId, targetId, updates) {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx === -1) throw new Error('Project tidak ditemukan');
  const targets = projects[idx].sshTargets || [];
  const tIdx = targets.findIndex(t => t.id === targetId);
  if (tIdx === -1) throw new Error('SSH target tidak ditemukan');
  targets[tIdx] = { ...targets[tIdx], ...updates, id: targetId };
  projects[idx].sshTargets = targets;
  saveProjects(projects);
  return targets[tIdx];
}

function removeSshTarget(projectId, targetId) {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx === -1) throw new Error('Project tidak ditemukan');
  projects[idx].sshTargets = (projects[idx].sshTargets || []).filter(t => t.id !== targetId);
  saveProjects(projects);
}

module.exports = {
  loadProjects, saveProjects, addProject, updateProject, removeProject, getProject, incrementStartCount,
  addCredential, updateCredential, removeCredential, setLastPulledAt, addCommand, removeCommand,
  addSshTarget, updateSshTarget, removeSshTarget, getEnvironment, setEnvironment,
};
