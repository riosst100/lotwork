const fs = require('fs');
const path = require('path');

const ENV_FILES = ['.env', '.env.local'];

function parseEnv(content) {
  const lines = content.split(/\r?\n/);
  const entries = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries.push({ key, value });
  }
  return entries;
}

function serializeEnv(entries) {
  return entries
    .filter(e => e.key && e.key.trim())
    .map(e => {
      const needsQuotes = /[\s#"]/.test(e.value);
      const value = needsQuotes ? `"${e.value.replace(/"/g, '\\"')}"` : e.value;
      return `${e.key.trim()}=${value}`;
    })
    .join('\n') + '\n';
}

// Reads .env and .env.local, merging them with .env.local values winning on
// key collisions (mirrors Next.js/Vite precedence). Each entry remembers
// which file it came from so saving writes it back to the right place.
function readEnvFile(cwd) {
  const byKey = new Map();
  let anyExists = false;

  for (const filename of ENV_FILES) {
    const filePath = path.join(cwd, filename);
    if (!fs.existsSync(filePath)) continue;
    anyExists = true;
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const { key, value } of parseEnv(content)) {
      byKey.set(key, { key, value, source: filename });
    }
  }

  return { exists: anyExists, entries: Array.from(byKey.values()) };
}

function writeEnvFile(cwd, entries) {
  const bySource = new Map(ENV_FILES.map(f => [f, []]));

  for (const entry of entries) {
    const source = ENV_FILES.includes(entry.source) ? entry.source : '.env';
    bySource.get(source).push(entry);
  }

  for (const [filename, fileEntries] of bySource) {
    const filePath = path.join(cwd, filename);
    if (fileEntries.length === 0) {
      continue; // don't create/touch a file that has nothing to write
    }
    fs.writeFileSync(filePath, serializeEnv(fileEntries));
  }
}

module.exports = { readEnvFile, writeEnvFile, ENV_FILES };
