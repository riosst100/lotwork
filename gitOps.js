const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

function run(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

function isGitRepo(cwd) {
  return findGitDir(cwd) !== null;
}

// Walks up from cwd to find the nearest .git directory, same as git itself
// does for subfolders inside a repo (e.g. a monorepo's backend/ or frontend/).
function findGitDir(cwd) {
  let dir = cwd;
  while (true) {
    const gitPath = path.join(dir, '.git');
    if (fs.existsSync(gitPath)) return gitPath;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

// Fast, synchronous remote URL lookup by reading .git/config directly,
// instead of spawning `git`. Safe to call on every /api/projects poll.
function getRemoteUrlSync(cwd) {
  const gitDir = findGitDir(cwd);
  if (!gitDir) return null;
  const configPath = path.join(gitDir, 'config');
  if (!fs.existsSync(configPath)) return null;
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const match = content.match(/\[remote "origin"\][^[]*?url\s*=\s*(.+)/);
    if (!match) return null;
    return toWebUrl(match[1].trim());
  } catch {
    return null;
  }
}

// Fast, synchronous current-branch lookup by reading .git/HEAD directly.
function getCurrentBranchSync(cwd) {
  const gitDir = findGitDir(cwd);
  if (!gitDir) return null;
  try {
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf-8').trim();
    if (head.startsWith('ref:')) {
      return head.slice(5).trim().replace(/^refs\/heads\//, '');
    }
    return null; // detached HEAD
  } catch {
    return null;
  }
}

// Best-effort default/main branch: reads the remote's HEAD symref if it's
// been recorded locally (refs/remotes/origin/HEAD), which `git clone` sets
// up automatically. Falls back to whichever of main/master exists locally.
// Does not hit the network, so it's safe for frequent polling.
function getDefaultBranchSync(cwd) {
  const gitDir = findGitDir(cwd);
  if (!gitDir) return null;
  try {
    const originHead = path.join(gitDir, 'refs', 'remotes', 'origin', 'HEAD');
    if (fs.existsSync(originHead)) {
      const content = fs.readFileSync(originHead, 'utf-8').trim();
      const match = content.match(/refs\/remotes\/origin\/(.+)$/);
      if (match) return match[1];
    }
    const packedRefs = path.join(gitDir, 'packed-refs');
    if (fs.existsSync(packedRefs)) {
      const content = fs.readFileSync(packedRefs, 'utf-8');
      if (content.includes('refs/remotes/origin/main')) return 'main';
      if (content.includes('refs/remotes/origin/master')) return 'master';
    }
    const headsDir = path.join(gitDir, 'refs', 'heads');
    if (fs.existsSync(path.join(headsDir, 'main'))) return 'main';
    if (fs.existsSync(path.join(headsDir, 'master'))) return 'master';
  } catch {
    // fall through
  }
  return null;
}

// Last-commit lookup (message + date), non-blocking. Callers should run this
// for multiple projects in parallel (Promise.all) rather than sequentially.
async function getLastCommit(cwd) {
  if (!findGitDir(cwd)) return null;
  try {
    const out = await run(cwd, ['log', '-1', '--format=%s%n%ci']);
    const [message, dateStr] = out.split('\n');
    if (!message) return null;
    return { message: message.trim(), date: (dateStr || '').trim() };
  } catch {
    return null; // no commits yet, or git not available
  }
}

// Lightweight change-count summary (no per-file details) for showing on
// project cards without the cost of a full getStatus() call. Untracked files
// (status "??") are counted separately from tracked changes (modified/added/
// deleted/renamed) so the UI can label them distinctly.
async function getChangeSummary(cwd) {
  if (!findGitDir(cwd)) return null;
  try {
    const out = await run(cwd, ['status', '--porcelain']);
    const lines = out.split('\n').filter(Boolean);
    let untracked = 0;
    let changed = 0;
    for (const line of lines) {
      if (line.startsWith('??')) untracked++;
      else changed++;
    }
    return { changed, untracked, total: changed + untracked };
  } catch {
    return null;
  }
}

// Converts common git remote URL forms into a clickable https:// URL.
//   git@github.com:owner/repo.git       -> https://github.com/owner/repo
//   https://github.com/owner/repo.git   -> https://github.com/owner/repo
function toWebUrl(remoteUrl) {
  if (!remoteUrl) return null;
  let url = remoteUrl.trim();

  const sshMatch = url.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    url = `https://${sshMatch[1]}/${sshMatch[2]}`;
  }

  url = url.replace(/\.git$/, '');
  return url;
}

async function getStatus(cwd) {
  if (!isGitRepo(cwd)) {
    return { isRepo: false };
  }

  const [branchOut, statusOut, branchesOut] = await Promise.all([
    run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    run(cwd, ['status', '--porcelain']),
    run(cwd, ['branch', '--format=%(refname:short)']),
  ]);

  const currentBranch = branchOut.trim();
  const branches = branchesOut.split('\n').map(b => b.trim()).filter(Boolean);

  let remoteUrl = null;
  try {
    remoteUrl = (await run(cwd, ['remote', 'get-url', 'origin'])).trim();
  } catch {
    // no remote configured
  }

  const files = statusOut
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const statusCode = line.slice(0, 2);
      const filePath = line.slice(3);
      return { status: statusCode.trim(), path: filePath };
    });

  let ahead = 0, behind = 0;
  try {
    const upstreamOut = await run(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
    const [a, b] = upstreamOut.trim().split(/\s+/).map(Number);
    ahead = a || 0;
    behind = b || 0;
  } catch {
    // no upstream configured, that's fine
  }

  return {
    isRepo: true,
    currentBranch,
    branches,
    files,
    ahead,
    behind,
    remoteUrl: toWebUrl(remoteUrl),
    hasChanges: files.length > 0,
  };
}

async function setRemoteUrl(cwd, url) {
  if (!isGitRepo(cwd)) throw new Error('Bukan git repository');
  if (!url || !url.trim()) throw new Error('URL remote wajib diisi');

  try {
    await run(cwd, ['remote', 'add', 'origin', url.trim()]);
  } catch (e) {
    if (/already exists/i.test(e.stderr || '')) {
      await run(cwd, ['remote', 'set-url', 'origin', url.trim()]);
    } else {
      throw e;
    }
  }

  return { ok: true, remoteUrl: toWebUrl(url.trim()) };
}

async function commitAndPush(cwd, { branch, message, files }) {
  if (!isGitRepo(cwd)) throw new Error('Bukan git repository');

  const status = await getStatus(cwd);
  if (branch && branch !== status.currentBranch) {
    await run(cwd, ['checkout', branch]);
  }

  if (Array.isArray(files) && files.length > 0) {
    await run(cwd, ['add', '--', ...files]);
  } else if (!files) {
    await run(cwd, ['add', '-A']);
  } else {
    throw new Error('Tidak ada file yang dipilih untuk di-commit');
  }

  const finalMessage = message || 'Update';

  try {
    await run(cwd, ['commit', '-m', finalMessage]);
  } catch (e) {
    if (/nothing to commit/i.test(e.stdout || '') || /nothing to commit/i.test(e.stderr || '')) {
      throw new Error('Tidak ada perubahan untuk di-commit');
    }
    throw e;
  }

  const targetBranch = branch || status.currentBranch;
  try {
    await run(cwd, ['push', 'origin', targetBranch]);
  } catch (e) {
    // First push on a new branch needs -u
    if (/no upstream branch/i.test(e.stderr || '')) {
      await run(cwd, ['push', '-u', 'origin', targetBranch]);
    } else {
      throw e;
    }
  }

  return { ok: true, message: finalMessage, branch: targetBranch };
}

async function hasUncommittedChanges(cwd) {
  const out = await run(cwd, ['status', '--porcelain']);
  return out.trim().length > 0;
}

// Pulls the latest from mainBranch and merges it into currentBranch, then
// pushes currentBranch. Steps:
//   1. checkout mainBranch
//   2. pull origin mainBranch
//   3. checkout currentBranch
//   4. merge mainBranch
//   5. push origin currentBranch
// Refuses to start if there are uncommitted changes (so checkout can't lose
// or mix in edits). If the merge conflicts, the branch is left in the
// conflicted state for the user to resolve manually — this function surfaces
// that as a distinct error rather than trying to auto-abort.
async function pullFromMain(cwd, { mainBranch, currentBranch }) {
  if (!isGitRepo(cwd)) throw new Error('Bukan git repository');
  if (!mainBranch) throw new Error('Main branch wajib dipilih');
  if (!currentBranch) throw new Error('Current branch tidak diketahui');
  if (mainBranch === currentBranch) throw new Error('Main branch dan current branch tidak boleh sama');

  if (await hasUncommittedChanges(cwd)) {
    throw new Error('Ada perubahan belum di-commit. Commit atau stash dulu sebelum pull dari main branch.');
  }

  await run(cwd, ['checkout', mainBranch]);
  await run(cwd, ['pull', 'origin', mainBranch]);
  await run(cwd, ['checkout', currentBranch]);

  try {
    await run(cwd, ['merge', mainBranch]);
  } catch (e) {
    const err = new Error(
      `Merge "${mainBranch}" ke "${currentBranch}" menghasilkan conflict. ` +
      `Branch dibiarkan dalam kondisi conflict — resolve manual lalu commit, ` +
      `atau jalankan "git merge --abort" untuk membatalkan.`
    );
    err.isConflict = true;
    throw err;
  }

  await run(cwd, ['push', 'origin', currentBranch]);

  return { ok: true, mainBranch, currentBranch };
}

module.exports = {
  isGitRepo, getStatus, commitAndPush, getRemoteUrlSync, getLastCommit,
  getCurrentBranchSync, getDefaultBranchSync, setRemoteUrl, pullFromMain, getChangeSummary,
};
