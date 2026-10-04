const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const wsl = require('./wsl');

// Repos inside WSL are reached through their \\wsl.localhost UNC path, but
// git itself runs inside the distro: Windows git over UNC is slow and trips
// over "dubious ownership" checks.
function run(cwd, args) {
  const inWsl = wsl.parseUnc(cwd);
  const [file, fileArgs, options] = inWsl
    ? ['wsl.exe', ['-d', inWsl.distro, '--cd', inWsl.linuxPath, '--exec', 'git', ...args], { maxBuffer: 10 * 1024 * 1024, windowsHide: true }]
    : ['git', args, { cwd, maxBuffer: 10 * 1024 * 1024 }];
  return new Promise((resolve, reject) => {
    execFile(file, fileArgs, options, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        err.stdout = stdout;
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

// The folder containing .git - i.e. the actual repo root, which may be a
// parent of cwd in a monorepo (project.cwd = repo/backend, root = repo).
// `git status --porcelain` always prints paths relative to this root
// regardless of cwd, so commands that consume those paths (git add <path>)
// must also run from here, not from project.cwd, or pathspecs won't resolve.
function getRepoRoot(cwd) {
  const gitDir = findGitDir(cwd);
  return gitDir ? path.dirname(gitDir) : null;
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

  // A freshly `git init`-ed repo with no commits yet has no valid HEAD, so
  // `rev-parse --abbrev-ref HEAD` fails. Fall back to reading the symbolic
  // ref directly (e.g. "refs/heads/main") instead of erroring the whole page.
  let currentBranch;
  try {
    currentBranch = (await run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  } catch {
    try {
      const symbolicRef = await run(cwd, ['symbolic-ref', '--short', 'HEAD']);
      currentBranch = symbolicRef.trim();
    } catch {
      currentBranch = 'main';
    }
  }

  const [statusOut, branchesOut, lastCommit] = await Promise.all([
    // -z: raw, NUL-separated paths. Plain --porcelain wraps paths with
    // spaces/special characters in quotes, which then don't match as pathspecs.
    run(cwd, ['status', '--porcelain', '-z']),
    run(cwd, ['branch', '--format=%(refname:short)']),
    getLastCommit(cwd),
  ]);

  const branches = branchesOut.split('\n').map(b => b.trim()).filter(Boolean);
  const noCommitsYet = branches.length === 0;
  if (noCommitsYet) branches.push(currentBranch);

  let remoteUrl = null;
  try {
    remoteUrl = (await run(cwd, ['remote', 'get-url', 'origin'])).trim();
  } catch {
    // no remote configured
  }

  // Entries are "XY path\0"; renames/copies add the original path as the next
  // entry ("R  new\0old\0"). Shown as "old -> new" like plain porcelain output.
  const entries = statusOut.split('\0');
  const files = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const statusCode = entry.slice(0, 2);
    let filePath = entry.slice(3);
    if (/[RC]/.test(statusCode)) filePath = `${entries[++i]} -> ${filePath}`;
    files.push({ status: statusCode.trim(), path: filePath });
  }

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
    noCommitsYet,
    lastCommit,
  };
}

async function initRepo(cwd) {
  if (isGitRepo(cwd)) throw new Error('Folder ini sudah git repository');
  await run(cwd, ['init']);
  return { ok: true };
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
  // `git status --porcelain` prints paths relative to the repo root even
  // when run from a subfolder, so `git add <path>` must run from that same
  // root too, or the pathspec won't match (e.g. in a monorepo where
  // project.cwd is repo/backend but paths look like "backend/file.php").
  const root = getRepoRoot(cwd);

  const status = await getStatus(cwd);
  if (branch && branch !== status.currentBranch) {
    await run(root, ['checkout', branch]);
  }

  // Paths that git reports as changed right now. The dashboard's file list
  // can be stale (e.g. a previous attempt already committed but failed to
  // push), and committing a path git no longer knows fails with
  // "pathspec did not match any file(s) known to git".
  const changed = new Set(status.files.flatMap(f => f.path.split(' -> ')));
  let commitPaths = [];
  let shouldCommit = true;
  if (Array.isArray(files) && files.length > 0) {
    // Renames show up as "old -> new" in porcelain output; both sides matter.
    commitPaths = [...new Set(files.flatMap(f => f.split(' -> ')))].filter(f => changed.has(f));
    if (!commitPaths.length) {
      if (!status.ahead) throw new Error('Daftar file sudah tidak sesuai (mungkin sudah ter-commit). Klik Refresh lalu coba lagi.');
      shouldCommit = false; // nothing left to commit, but earlier commits still need pushing
    } else {
      // Only paths still on disk can be `git add`-ed: a deletion (staged or
      // not) has nothing to add, and `git add` on a path that is gone from
      // both the worktree and the index fails with "pathspec did not match".
      const onDisk = commitPaths.filter(f => fs.existsSync(path.join(root, f)));
      if (onDisk.length) await run(root, ['add', '--', ...onDisk]);
    }
  } else if (Array.isArray(files)) {
    // No files selected: only valid as "push the commits I already have".
    if (!status.ahead) throw new Error('Tidak ada file yang dipilih untuk di-commit');
    shouldCommit = false;
  } else {
    await run(root, ['add', '-A']);
  }

  const finalMessage = message || 'Update';

  if (shouldCommit) {
    try {
      // With paths, `git commit -- <paths>` commits exactly those files, even
      // if other changes were already staged - so unselected files stay out.
      await run(root, ['commit', '-m', finalMessage, ...(commitPaths.length ? ['--', ...commitPaths] : [])]);
    } catch (e) {
      if (/nothing to commit/i.test(e.stdout || '') || /nothing to commit/i.test(e.stderr || '')) {
        throw new Error('Tidak ada perubahan untuk di-commit');
      }
      throw e;
    }
  }

  const targetBranch = branch || status.currentBranch;
  try {
    await pushBranch(root, targetBranch);
  } catch (e) {
    e.committed = shouldCommit;
    if (shouldCommit) e.message = `Commit "${finalMessage}" sudah tersimpan di lokal, tapi push gagal. ${e.message}`;
    throw e;
  }

  return { ok: true, message: shouldCommit ? finalMessage : null, branch: targetBranch, committed: shouldCommit };
}

// Pushes, setting the upstream on a branch's first push. A rejection because
// the remote has commits we don't is turned into an actionable message.
async function pushBranch(root, branch) {
  try {
    await run(root, ['push', 'origin', branch]);
  } catch (e) {
    const stderr = e.stderr || '';
    if (/no upstream branch|has no upstream/i.test(stderr)) {
      await run(root, ['push', '-u', 'origin', branch]);
      return;
    }
    if (/\[rejected\]|non-fast-forward|fetch first/i.test(stderr)) {
      const err = new Error(`Branch "${branch}" di remote punya commit yang belum ada di lokal. Klik "Pull & Push" untuk menggabungkannya lalu push lagi.`);
      err.pushRejected = true;
      throw err;
    }
    e.message = stderr.trim() || e.message;
    throw e;
  }
}

// For a branch that is behind its remote: merge the remote branch in, then
// push. Conflicts are left in place for the user to resolve, as with pull-main.
async function pullAndPush(cwd, { branch }) {
  if (!isGitRepo(cwd)) throw new Error('Bukan git repository');
  const root = getRepoRoot(cwd);
  const status = await getStatus(cwd);
  const target = branch || status.currentBranch;
  if (target !== status.currentBranch) await run(root, ['checkout', target]);
  try {
    await run(root, ['pull', '--no-rebase', '--no-edit', 'origin', target]);
  } catch (e) {
    const out = `${e.stdout || ''}\n${e.stderr || ''}`;
    if (/CONFLICT|Automatic merge failed/i.test(out)) {
      const err = new Error(
        `Pull "origin/${target}" menghasilkan conflict. Branch dibiarkan dalam kondisi conflict — ` +
        `resolve manual lalu commit, atau jalankan "git merge --abort" untuk membatalkan.`
      );
      err.isConflict = true;
      throw err;
    }
    if (/would be overwritten/i.test(out)) {
      throw new Error('Pull dibatalkan: ada perubahan lokal yang belum di-commit yang akan tertimpa. Commit atau stash dulu.');
    }
    e.message = (e.stderr || '').trim() || e.message;
    throw e;
  }
  await pushBranch(root, target);
  return { ok: true, branch: target };
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

  const root = getRepoRoot(cwd);

  if (await hasUncommittedChanges(root)) {
    throw new Error('Ada perubahan belum di-commit. Commit atau stash dulu sebelum pull dari main branch.');
  }

  await run(root, ['checkout', mainBranch]);
  await run(root, ['pull', 'origin', mainBranch]);
  await run(root, ['checkout', currentBranch]);

  try {
    await run(root, ['merge', mainBranch]);
  } catch (e) {
    const err = new Error(
      `Merge "${mainBranch}" ke "${currentBranch}" menghasilkan conflict. ` +
      `Branch dibiarkan dalam kondisi conflict — resolve manual lalu commit, ` +
      `atau jalankan "git merge --abort" untuk membatalkan.`
    );
    err.isConflict = true;
    throw err;
  }

  await run(root, ['push', 'origin', currentBranch]);

  return { ok: true, mainBranch, currentBranch };
}

// Fetches origin, then reports how far the current branch is from the
// remote's default/main branch. Meant to be called on-demand (e.g. a
// "Check main" button), not on every dashboard poll, since `git fetch`
// hits the network and can be slow.
async function checkAheadBehindMain(cwd, mainBranch) {
  if (!isGitRepo(cwd)) throw new Error('Bukan git repository');
  const root = getRepoRoot(cwd);

  let currentBranch;
  try {
    currentBranch = (await run(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  } catch {
    currentBranch = null;
  }

  const resolvedMain = mainBranch || getDefaultBranchSync(root) || 'main';

  await run(root, ['fetch', 'origin', resolvedMain]);

  const upstreamRef = `origin/${resolvedMain}`;
  let ahead = 0, behind = 0;
  try {
    const out = await run(root, ['rev-list', '--left-right', '--count', `${upstreamRef}...HEAD`]);
    const [b, a] = out.trim().split(/\s+/).map(Number);
    behind = b || 0;
    ahead = a || 0;
  } catch (e) {
    throw new Error(`Tidak bisa membandingkan dengan ${upstreamRef}: ${e.stderr || e.message}`);
  }

  return {
    ok: true,
    currentBranch,
    mainBranch: resolvedMain,
    ahead,
    behind,
    upToDate: behind === 0,
    checkedAt: Date.now(),
  };
}

module.exports = {
  isGitRepo, getStatus, commitAndPush, getRemoteUrlSync, getLastCommit,
  getCurrentBranchSync, getDefaultBranchSync, setRemoteUrl, pullFromMain, initRepo,
  checkAheadBehindMain, pullAndPush,
};
