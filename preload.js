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
  // Module Étude
  etude: {
    lots: {
      list: () => ipcRenderer.invoke('etude:lots:list'),
      create: (p) => ipcRenderer.invoke('etude:lots:create', p),
      update: (p) => ipcRenderer.invoke('etude:lots:update', p),
      delete: (p) => ipcRenderer.invoke('etude:lots:delete', p)
    },
    prices: {
      list: (q) => ipcRenderer.invoke('etude:prices:list', q),
      create: (p) => ipcRenderer.invoke('etude:prices:create', p),
      update: (p) => ipcRenderer.invoke('etude:prices:update', p),
      delete: (p) => ipcRenderer.invoke('etude:prices:delete', p),
      excelPreview: () => ipcRenderer.invoke('etude:prices:excelPreview'),
      excelLoadSheet: (p) => ipcRenderer.invoke('etude:prices:excelLoadSheet', p),
      excelImport: (p) => ipcRenderer.invoke('etude:prices:excelImport', p),
      exportExcel: () => ipcRenderer.invoke('etude:prices:exportExcel')
    },
    compos: {
      list: () => ipcRenderer.invoke('etude:compos:list'),
      get: (p) => ipcRenderer.invoke('etude:compos:get', p),
      create: (p) => ipcRenderer.invoke('etude:compos:create', p),
      update: (p) => ipcRenderer.invoke('etude:compos:update', p),
      delete: (p) => ipcRenderer.invoke('etude:compos:delete', p)
    },
    quotes: {
      list: () => ipcRenderer.invoke('etude:quotes:list'),
      get: (p) => ipcRenderer.invoke('etude:quotes:get', p),
      create: (p) => ipcRenderer.invoke('etude:quotes:create', p),
      updateMeta: (p) => ipcRenderer.invoke('etude:quotes:updateMeta', p),
      addVersion: (p) => ipcRenderer.invoke('etude:quotes:addVersion', p),
      delete: (p) => ipcRenderer.invoke('etude:quotes:delete', p),
      diff: (p) => ipcRenderer.invoke('etude:quotes:diff', p),
      exportPdf: (p) => ipcRenderer.invoke('etude:quotes:exportPdf', p)
    },
    reindex: {
      preview: (p) => ipcRenderer.invoke('etude:reindex:preview', p),
      apply: (p) => ipcRenderer.invoke('etude:reindex:apply', p),
      history: () => ipcRenderer.invoke('etude:reindex:history')
    }
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
