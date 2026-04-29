// preload.js — pont sécurisé entre le renderer et le main process
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Auth
  auth: {
    exists: () => ipcRenderer.invoke('auth:exists'),
    listUsers: () => ipcRenderer.invoke('auth:listUsers'),
    signup: (payload) => ipcRenderer.invoke('auth:signup', payload),
    login: (payload) => ipcRenderer.invoke('auth:login', payload),
    recover: (payload) => ipcRenderer.invoke('auth:recover', payload),
    logout: () => ipcRenderer.invoke('auth:logout'),
    session: () => ipcRenderer.invoke('auth:session')
  },
  // Profil
  profil: {
    set: (profil) => ipcRenderer.invoke('profil:set', profil)
  },
  // .ndev (stubs Phase 0)
  ndev: {
    exportStub: (payload) => ipcRenderer.invoke('ndev:exportStub', payload),
    openInbox: () => ipcRenderer.invoke('ndev:openInbox')
  },
  // Divers
  app: {
    openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
    version: () => ipcRenderer.invoke('app:version'),
    checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
    onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_e, info) => cb(info)),
    onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (_e, p) => cb(p)),
    onUpdateDownloaded: (cb) => ipcRenderer.on('update:downloaded', (_e, info) => cb(info))
  }
});
