const { app, BrowserWindow, Tray, Menu, dialog, shell } = require('electron');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'lotwork.ico');

// A process only sees the PATH it was launched with, so tools installed
// after Explorer started (e.g. Caddy via winget) stay invisible until a
// reboot. Re-read it from the registry so a plain lotwork restart is enough.
function refreshPathFromRegistry() {
  if (process.platform !== 'win32') return;
  try {
    const fresh = execFileSync('powershell', [
      '-NoProfile', '-Command',
      "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')",
    ], { encoding: 'utf-8', windowsHide: true }).trim();
    if (fresh) process.env.PATH = fresh;
  } catch {
    // keep the inherited PATH
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('lotwork');
  refreshPathFromRegistry();
  main();
}

function main() {
  let server;
  let win = null;
  let tray = null;
  let isQuitting = false;
  let shownTrayHint = false;
  let lastRunningCount = -1;

  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    try {
      server = require(path.join(ROOT, 'server.js'));
      await server.ready;
    } catch (e) {
      const message = e && e.code === 'EADDRINUSE'
        ? `Port 4400 is already in use.\n\nAnother lotwork instance (maybe the old control window or "npm start") is probably still running. Stop it and open lotwork again.`
        : `lotwork failed to start:\n\n${e && e.stack || e}`;
      dialog.showErrorBox('lotwork', message);
      app.exit(1);
      return;
    }

    Menu.setApplicationMenu(null);
    createTray();
    createWindow();
  });

  // Closing the window only hides it; lotwork keeps running in the tray.
  app.on('window-all-closed', () => {});

  app.on('before-quit', () => {
    isQuitting = true;
    if (server) server.stopEverything();
  });

  function dashboardUrl() {
    return `http://localhost:${server.PORT}`;
  }

  function createWindow() {
    win = new BrowserWindow({
      width: 1320,
      height: 880,
      minWidth: 720,
      minHeight: 500,
      title: 'lotwork',
      icon: ICON,
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true },
    });

    win.loadURL(dashboardUrl());
    win.once('ready-to-show', () => win.show());

    // Keep the app window for the dashboard only; repo links, project
    // domains etc. open in the user's normal browser.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(dashboardUrl())) {
        event.preventDefault();
        if (/^https?:/i.test(url)) shell.openExternal(url);
      }
    });

    // No app menu, so wire up the usual reload / devtools shortcuts by hand.
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = input.key.toLowerCase();
      if (key === 'f5' || (input.control && key === 'r')) {
        win.webContents.reload();
        event.preventDefault();
      } else if (key === 'f12' || (input.control && input.shift && key === 'i')) {
        win.webContents.toggleDevTools();
        event.preventDefault();
      }
    });

    win.on('close', (event) => {
      if (isQuitting) return;
      event.preventDefault();
      win.hide();
      if (!shownTrayHint) {
        shownTrayHint = true;
        tray.displayBalloon({
          iconType: 'info',
          title: 'lotwork is still running',
          content: 'Click the tray icon to open it again. Right-click for more options.',
        });
      }
    });

    win.on('session-end', () => server.stopEverything());
  }

  function showWindow() {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  function createTray() {
    tray = new Tray(ICON);
    tray.setToolTip('lotwork');
    tray.on('click', showWindow);
    tray.on('balloon-click', showWindow);
    updateTrayMenu();
    setInterval(updateTrayMenu, 5000);
  }

  let trayUpdating = false;
  async function updateTrayMenu() {
    if (trayUpdating) return;
    trayUpdating = true;
    let count;
    try {
      count = (await server.runningProjects()).length;
    } catch {
      count = 0;
    } finally {
      trayUpdating = false;
    }
    if (count === lastRunningCount) return;
    lastRunningCount = count;

    tray.setToolTip(count ? `lotwork - ${count} project(s) running` : 'lotwork');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open lotwork', click: showWindow },
      { label: 'Open in browser', click: () => shell.openExternal(dashboardUrl()) },
      { type: 'separator' },
      { label: count ? `${count} project(s) running` : 'No projects running', enabled: false },
      { label: 'Stop all projects', enabled: count > 0, click: stopAllProjects },
      { type: 'separator' },
      { label: 'Restart lotwork', click: restart },
      { label: 'Quit lotwork', click: () => app.quit() },
    ]));
  }

  // Containers are Docker's, so quitting/restarting lotwork leaves them
  // running; stopping them is an explicit tray action.
  async function stopAllProjects() {
    const choice = dialog.showMessageBoxSync({
      type: 'question',
      buttons: ['Stop all', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'lotwork',
      message: 'Stop the containers of every running project?',
    });
    if (choice !== 0) return;
    await server.stopAllProjects();
    lastRunningCount = -1;
    updateTrayMenu();
  }

  function restart() {
    app.relaunch();
    app.quit();
  }
}
