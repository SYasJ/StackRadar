// StackRadar desktop shell: starts the bundled local server, shows it in a window,
// and keeps itself up to date from GitHub Releases (electron-updater).
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require("electron");
const { spawn, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

let win = null, server = null, serverPort = null, autoUpdater = null;
const isMac = process.platform === "darwin", isWin = process.platform === "win32";

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

// GUI apps on macOS/Linux start with a tiny PATH (no Homebrew, nvm, pyenv …).
// Borrow the login shell's PATH so StackRadar finds git, node, npm, docker, claude, codex …
function loginShellEnv() {
  const env = { ...process.env };
  if (isWin) return env;
  try {
    const sh = process.env.SHELL || (isMac ? "/bin/zsh" : "/bin/bash");
    const out = execFileSync(sh, ["-ilc", "printf '__DR__%s__DR__' \"$PATH\""], { encoding: "utf8", timeout: 5000 });
    const m = out.match(/__DR__(.*)__DR__/s);
    if (m && m[1]) env.PATH = m[1];
  } catch (_) {
    env.PATH = ["/opt/homebrew/bin", "/usr/local/bin", env.PATH || "/usr/bin:/bin"].join(":");
  }
  return env;
}

function backendCommand() {
  const exe = isWin ? "stackradar-server.exe" : "stackradar-server";
  const packaged = path.join(process.resourcesPath || "", "backend", exe);
  if (app.isPackaged && fs.existsSync(packaged)) return { cmd: packaged, args: [] };
  // dev mode: run the Python source next to this folder
  return { cmd: isWin ? "python" : "python3", args: [path.join(__dirname, "..", "stackradar.py")] };
}

function startServer() {
  return new Promise((resolve, reject) => {
    const { cmd, args } = backendCommand();
    const full = args.concat(["--port", "0", "--host", "127.0.0.1"]);
    server = spawn(cmd, full, { env: loginShellEnv(), windowsHide: true });
    let buf = "";
    const timer = setTimeout(() => reject(new Error("StackRadar server did not start in 30 s")), 30000);
    server.stdout.on("data", d => {
      buf += d.toString();
      const m = buf.match(/STACKRADAR_READY port=(\d+)/);
      if (m && !serverPort) { serverPort = parseInt(m[1], 10); clearTimeout(timer); resolve(serverPort); }
    });
    server.stderr.on("data", d => process.stderr.write(d));
    server.on("exit", code => {
      if (!serverPort) { clearTimeout(timer); reject(new Error("server exited with code " + code + "\n" + buf)); }
      else if (!app.isQuitting) dialog.showErrorBox("StackRadar", "The StackRadar engine stopped (exit " + code + "). Restart the app.");
    });
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 960, minWidth: 980, minHeight: 640, show: false,
    backgroundColor: "#0b0e14", title: "StackRadar " + app.getVersion(),
    titleBarStyle: isMac ? "hiddenInset" : "default",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, "loading.html"));
  win.once("ready-to-show", () => win.show());
  // open external links in the real browser, keep the app on localhost only
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("http://127.0.0.1:" + serverPort) && !url.startsWith("file://")) { e.preventDefault(); shell.openExternal(url); }
  });
}

function sendStatus(msg) { if (win) win.webContents.send("stackradar:update-status", msg); }

function hasDeveloperIdSignature() {
  try {
    const appPath = path.resolve(process.execPath, "..", "..", "..");
    const out = require("child_process").spawnSync("codesign", ["-dv", "--verbose=2", appPath], { encoding: "utf8", timeout: 5000 });
    return /Authority=Developer ID Application/.test((out.stderr || "") + (out.stdout || ""));
  } catch (_) { return false; }
}

function setupUpdater() {
  if (!app.isPackaged) return;
  try { autoUpdater = require("electron-updater").autoUpdater; } catch (_) { return; }
  // macOS only installs updates for apps signed with a Developer ID. Ad-hoc / unsigned builds get a
  // "new version" prompt that opens the download page instead of a silent install that would fail.
  const manual = isMac && !hasDeveloperIdSignature();
  autoUpdater.autoDownload = !manual;
  autoUpdater.on("update-available", async i => {
    if (!manual) return sendStatus("Downloading StackRadar " + i.version + " …");
    sendStatus("StackRadar " + i.version + " is available.");
    const r = await dialog.showMessageBox(win, { type: "info", buttons: ["Download", "Later"], defaultId: 0,
      message: "StackRadar " + i.version + " is available", detail: "You have " + app.getVersion() + ". This build isn't signed with an Apple Developer ID, " +
        "so macOS can't install updates automatically. Download the new .dmg and drag it to Applications to replace this one." });
    if (r.response === 0) shell.openExternal("https://github.com/SYasJ/StackRadar/releases/tag/v" + i.version);
  });
  autoUpdater.on("update-not-available", () => sendStatus("StackRadar is up to date."));
  autoUpdater.on("error", e => sendStatus("Update check failed: " + (e && e.message ? e.message.split("\n")[0] : e)));
  autoUpdater.on("update-downloaded", async i => {
    const r = await dialog.showMessageBox(win, { type: "info", buttons: ["Restart now", "Later"], defaultId: 0,
      message: "StackRadar " + i.version + " is ready", detail: "Restart to finish updating." });
    if (r.response === 0) { app.isQuitting = true; autoUpdater.quitAndInstall(); }
  });
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 8000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 3600 * 1000);
}
function checkForUpdates() {
  if (autoUpdater) autoUpdater.checkForUpdates().catch(e => sendStatus("Update check failed: " + e.message));
  else shell.openExternal("https://github.com/SYasJ/StackRadar/releases");
}
ipcMain.on("stackradar:check-updates", checkForUpdates);

function buildMenu() {
  const tpl = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { label: "File", submenu: [
      { label: "Open in Browser", click: () => serverPort && shell.openExternal("http://127.0.0.1:" + serverPort) },
      { label: "Show Settings Folder", click: () => shell.openPath(path.join(app.getPath("home"), ".stackradar")) },
      { type: "separator" }, isMac ? { role: "close" } : { role: "quit" }] },
    { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
    { label: "Help", submenu: [
      { label: "About StackRadar " + app.getVersion(), click: () => dialog.showMessageBox(win, { type: "info", title: "About StackRadar",
          message: "StackRadar " + app.getVersion(), detail: "Your whole dev stack on one local screen.\n© 2026 Yasir Jilani\n\nFree for personal, non-commercial use (PolyForm Noncommercial 1.0.0).\nCommercial use needs a license: github.com/SYasJ/StackRadar/blob/main/COMMERCIAL.md\n\nhttps://github.com/SYasJ/StackRadar" }) },
      { label: "Check for Updates…", click: checkForUpdates },
      { label: "StackRadar Wiki", click: () => shell.openExternal("https://github.com/SYasJ/StackRadar/wiki") },
      { label: "Report an Issue", click: () => shell.openExternal("https://github.com/SYasJ/StackRadar/issues") }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.whenReady().then(async () => {
  buildMenu();
  createWindow();
  try {
    const port = await startServer();
    win.loadURL("http://127.0.0.1:" + port + "/");
  } catch (e) {
    dialog.showErrorBox("StackRadar could not start", String(e.message || e));
    app.quit();
    return;
  }
  setupUpdater();
});
app.on("before-quit", () => { app.isQuitting = true; if (server && !server.killed) server.kill(); });
app.on("window-all-closed", () => app.quit());
