const { execFileSync, spawn } = require('child_process');

function isPlinkAvailable() {
  try {
    execFileSync('where', ['plink'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Opens a new terminal window for the SSH session, rather than capturing
// its I/O in lotwork itself - this is a plain interactive SSH session, not
// something the dashboard needs to parse or log.
function launchSsh(target) {
  const host = target.host;
  const port = target.port || 22;
  const username = target.username;
  const password = target.password || '';

  let command;
  if (password && isPlinkAvailable()) {
    // plink supports passing the password non-interactively. The password
    // still ends up visible in the process list (Get-Process/tasklist show
    // command lines) for as long as plink is starting up - an inherent
    // limitation of this approach, not something lotwork can fully hide.
    command = `plink -ssh ${username}@${host} -P ${port} -pw "${password}"`;
  } else {
    // Plain ssh always prompts for the password interactively - no way to
    // pass it on the command line, so the user types/pastes it themselves.
    command = `ssh -p ${port} ${username}@${host}`;
  }

  spawn('cmd', ['/c', 'start', '""', 'cmd', '/k', command], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  }).unref();

  return { usedPlink: Boolean(password && isPlinkAvailable()) };
}

module.exports = { launchSsh, isPlinkAvailable };
