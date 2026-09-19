const fs = require('fs');

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

module.exports = { syncHosts };
