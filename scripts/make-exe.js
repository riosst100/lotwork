// Creates lotwork.exe: a copy of the Electron runtime branded as lotwork
// (name, description, icon) and marked "requireAdministrator". Without this,
// UAC and Task Manager show the launcher's name (wscript / Electron) instead
// of lotwork. It lives next to electron.exe because the runtime loads its
// DLLs and resources from its own folder, so re-run this after any Electron
// update (Setup.bat does it automatically).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const distDir = path.join(root, 'node_modules', 'electron', 'dist');
const source = path.join(distDir, 'electron.exe');
const target = path.join(distDir, 'lotwork.exe');
const rcedit = path.join(root, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
const { version } = require(path.join(root, 'package.json'));

if (!fs.existsSync(source)) {
  console.error('electron.exe not found - run "npm install" first.');
  process.exit(1);
}

fs.copyFileSync(source, target);
execFileSync(rcedit, [
  target,
  '--set-icon', path.join(root, 'lotwork.ico'),
  '--set-version-string', 'FileDescription', 'lotwork',
  '--set-version-string', 'ProductName', 'lotwork',
  '--set-version-string', 'InternalName', 'lotwork',
  '--set-version-string', 'OriginalFilename', 'lotwork.exe',
  '--set-version-string', 'CompanyName', 'lotwork',
  '--set-version-string', 'LegalCopyright', '',
  '--set-file-version', version,
  '--set-product-version', version,
  '--set-requested-execution-level', 'requireAdministrator',
], { stdio: 'inherit' });

console.log(`Created ${target}`);
