const fs = require('fs');
const path = require('path');
const { dataDir } = require('./paths');

const DATA_FILE = path.join(dataDir, 'projects.json');

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ projects: [] }, null, 2));
}

function loadProjects() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  try {
    return JSON.parse(raw).projects || [];
  } catch {
    return [];
  }
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

module.exports = { loadProjects, saveProjects, addProject, updateProject, removeProject, getProject };
