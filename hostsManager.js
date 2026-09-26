const fs = require('fs');
const net = require('net');
const { exec } = require('child_process');

const HOSTS_PATH = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
const MARKER_START = '# lotwork-managed-start';
const MARKER_END = '# lotwork-managed-end';

function readHosts() {
  try {
    return fs.readFileSync(HOSTS_PATH, 'utf-8');
  } catch (e) {
    return null;
  }
}

function syncHosts(domains) {
  const content = readHosts();
  if (content === null) {
    return { ok: false, message: 'Tidak bisa membaca hosts file. Jalankan lotwork sebagai Administrator.' };
  }

  const startIdx = content.indexOf(MARKER_START);
  const endIdx = content.indexOf(MARKER_END);
  let base = content;
  if (startIdx !== -1 && endIdx !== -1) {
    base = content.slice(0, startIdx) + content.slice(endIdx + MARKER_END.length);
  }

  const block = domains.length
    ? `${MARKER_START}\n${domains.map(d => `127.0.0.1 ${d}`).join('\n')}\n${MARKER_END}\n`
    : '';

  const newContent = base.trimEnd() + '\n\n' + block;

  try {
    fs.writeFileSync(HOSTS_PATH, newContent);
    return { ok: true, message: 'hosts file updated' };
  } catch (e) {
    return { ok: false, message: 'Gagal menulis hosts file (perlu Administrator): ' + e.message };
  }
}

// --- Manual hosts editing (Edit Hosts page) ---
// Entries are addressed by their 0-based line number in the file. Every
// mutation also sends the raw line it expects to find there, so if the file
// changed in the meantime (another editor, a domain sync) we refuse instead
// of clobbering the wrong line.

const HOSTNAME_RE = /^[A-Za-z0-9_]([A-Za-z0-9_.-]*[A-Za-z0-9_])?$/;

function splitLines(content) {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  return { eol, lines: content.split(/\r?\n/) };
}

// Parses "ip host1 host2 # comment". Returns null when the text isn't an entry.
function parseEntryText(text) {
  const hashIdx = text.indexOf('#');
  const body = hashIdx === -1 ? text : text.slice(0, hashIdx);
  const comment = hashIdx === -1 ? '' : text.slice(hashIdx + 1).trim();
  const tokens = body.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || !net.isIP(tokens[0])) return null;
  if (!tokens.slice(1).every(h => HOSTNAME_RE.test(h))) return null;
  return { ip: tokens[0], hostnames: tokens.slice(1), comment };
}

function listEntries() {
  const content = readHosts();
  if (content === null) throw new Error('Tidak bisa membaca hosts file.');
  const { lines } = splitLines(content);
  const entries = [];
  let inManaged = false;
  lines.forEach((raw, line) => {
    const trimmed = raw.trim();
    if (trimmed === MARKER_START) { inManaged = true; return; }
    if (trimmed === MARKER_END) { inManaged = false; return; }
    let enabled = true;
    let parsed = parseEntryText(trimmed);
    if (!parsed && trimmed.startsWith('#')) {
      // A commented-out entry like "# 127.0.0.1 foo.test" counts as disabled.
      parsed = parseEntryText(trimmed.replace(/^#+\s*/, ''));
      enabled = false;
    }
    if (parsed) entries.push({ line, raw, enabled, managed: inManaged, ...parsed });
  });
  return { path: HOSTS_PATH, entries };
}

function formatEntry({ ip, hostnames, comment, enabled }) {
  ip = String(ip || '').trim();
  const hosts = (Array.isArray(hostnames) ? hostnames : String(hostnames || '').split(/[\s,]+/))
    .map(h => String(h).trim()).filter(Boolean);
  if (!net.isIP(ip)) throw new Error(`IP tidak valid: "${ip}"`);
  if (!hosts.length) throw new Error('Hostname wajib diisi.');
  const bad = hosts.find(h => !HOSTNAME_RE.test(h));
  if (bad) throw new Error(`Hostname tidak valid: "${bad}"`);
  const cleanComment = String(comment || '').replace(/[\r\n]/g, ' ').trim();
  let text = `${ip}\t${hosts.join(' ')}`;
  if (cleanComment) text += `\t# ${cleanComment}`;
  return enabled === false ? `# ${text}` : text;
}

function writeHostsFile(content) {
  try {
    fs.writeFileSync(HOSTS_PATH, content);
  } catch (e) {
    throw new Error('Gagal menulis hosts file (perlu Administrator): ' + e.message);
  }
  // Best-effort so the change takes effect immediately in browsers.
  if (process.platform === 'win32') exec('ipconfig /flushdns', () => {});
}

function mutateLine(line, expectedRaw, mutate) {
  const content = readHosts();
  if (content === null) throw new Error('Tidak bisa membaca hosts file.');
  const { eol, lines } = splitLines(content);
  if (!Number.isInteger(line) || line < 0 || line >= lines.length || lines[line] !== expectedRaw) {
    throw new Error('hosts file sudah berubah sejak terakhir dimuat. Refresh lalu coba lagi.');
  }
  mutate(lines);
  writeHostsFile(lines.join(eol));
}

function addEntry(entry) {
  const text = formatEntry(entry);
  const content = readHosts();
  if (content === null) throw new Error('Tidak bisa membaca hosts file.');
  const { eol, lines } = splitLines(content);
  // Insert before the lotwork-managed block so syncHosts keeps it at the end.
  let insertAt = lines.findIndex(l => l.trim() === MARKER_START);
  if (insertAt === -1) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    insertAt = lines.length;
    lines.push('');
  } else {
    while (insertAt > 0 && lines[insertAt - 1].trim() === '') insertAt--;
  }
  lines.splice(insertAt, 0, text);
  writeHostsFile(lines.join(eol));
}

function updateEntry(line, expectedRaw, entry) {
  const text = formatEntry(entry);
  mutateLine(line, expectedRaw, lines => { lines[line] = text; });
}

function deleteEntry(line, expectedRaw) {
  mutateLine(line, expectedRaw, lines => { lines.splice(line, 1); });
}

module.exports = { syncHosts, listEntries, addEntry, updateEntry, deleteEntry };
