// Minimal, safe bridge: the dashboard can ask for an update check and hear back.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("stackradarDesktop", {
  isDesktop: true,
  checkForUpdates: () => ipcRenderer.send("stackradar:check-updates"),
  onUpdateStatus: cb => ipcRenderer.on("stackradar:update-status", (_e, msg) => cb(String(msg))),
});
