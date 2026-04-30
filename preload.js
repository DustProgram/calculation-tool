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
  // Module Artisan
  artisan: {
    kpv: {
      getGlobal: () => ipcRenderer.invoke('artisan:kpv:getGlobal'),
      setGlobal: (p) => ipcRenderer.invoke('artisan:kpv:setGlobal', p),
      listAll: () => ipcRenderer.invoke('artisan:kpv:listAll'),
      setForLot: (p) => ipcRenderer.invoke('artisan:kpv:setForLot', p),
      explain: (p) => ipcRenderer.invoke('artisan:kpv:explain', p)
    },
    fraisReels: {
      get: () => ipcRenderer.invoke('artisan:fraisReels:get'),
      set: (p) => ipcRenderer.invoke('artisan:fraisReels:set', p),
      compute: (p) => ipcRenderer.invoke('artisan:fraisReels:compute', p)
    },
    equipment: {
      list: (q) => ipcRenderer.invoke('artisan:equipment:list', q),
      get: (p) => ipcRenderer.invoke('artisan:equipment:get', p),
      create: (p) => ipcRenderer.invoke('artisan:equipment:create', p),
      update: (p) => ipcRenderer.invoke('artisan:equipment:update', p),
      delete: (p) => ipcRenderer.invoke('artisan:equipment:delete', p)
    },
    suppliers: {
      list: () => ipcRenderer.invoke('artisan:suppliers:list'),
      get: (p) => ipcRenderer.invoke('artisan:suppliers:get', p),
      create: (p) => ipcRenderer.invoke('artisan:suppliers:create', p),
      update: (p) => ipcRenderer.invoke('artisan:suppliers:update', p),
      delete: (p) => ipcRenderer.invoke('artisan:suppliers:delete', p),
      addPrice: (p) => ipcRenderer.invoke('artisan:suppliers:addPrice', p),
      updatePrice: (p) => ipcRenderer.invoke('artisan:suppliers:updatePrice', p),
      deletePrice: (p) => ipcRenderer.invoke('artisan:suppliers:deletePrice', p)
    },
    logistic: {
      get: () => ipcRenderer.invoke('artisan:logistic:get'),
      set: (p) => ipcRenderer.invoke('artisan:logistic:set', p)
    },
    sites: {
      list: (q) => ipcRenderer.invoke('artisan:sites:list', q),
      get: (p) => ipcRenderer.invoke('artisan:sites:get', p),
      create: (p) => ipcRenderer.invoke('artisan:sites:create', p),
      update: (p) => ipcRenderer.invoke('artisan:sites:update', p),
      delete: (p) => ipcRenderer.invoke('artisan:sites:delete', p)
    }
  },
  // Module Comptabilité
  compta: {
    config: {
      get: () => ipcRenderer.invoke('compta:config:get'),
      set: (p) => ipcRenderer.invoke('compta:config:set', p),
      plan: () => ipcRenderer.invoke('compta:config:plan')
    },
    ecritures: {
      list: (q) => ipcRenderer.invoke('compta:ecritures:list', q),
      create: (p) => ipcRenderer.invoke('compta:ecritures:create', p),
      update: (p) => ipcRenderer.invoke('compta:ecritures:update', p),
      delete: (p) => ipcRenderer.invoke('compta:ecritures:delete', p)
    },
    situations: {
      list: (p) => ipcRenderer.invoke('compta:situations:list', p),
      create: (p) => ipcRenderer.invoke('compta:situations:create', p),
      delete: (p) => ipcRenderer.invoke('compta:situations:delete', p)
    },
    dashboard: (q) => ipcRenderer.invoke('compta:dashboard', q),
    chantiersEnCours: (q) => ipcRenderer.invoke('compta:chantiersEnCours', q),
    margeChantiers: (q) => ipcRenderer.invoke('compta:margeChantiers', q)
  },
  // Phase 3 : Sécurité
  security: {
    totp: {
      status: () => ipcRenderer.invoke('totp:status'),
      setupBegin: () => ipcRenderer.invoke('totp:setupBegin'),
      setupConfirm: (p) => ipcRenderer.invoke('totp:setupConfirm', p),
      verify: (p) => ipcRenderer.invoke('totp:verify', p),
      disable: (p) => ipcRenderer.invoke('totp:disable', p),
      regenRecovery: (p) => ipcRenderer.invoke('totp:regenRecovery', p)
    },
    license: {
      status: () => ipcRenderer.invoke('license:status'),
      list: () => ipcRenderer.invoke('license:list'),
      import: (p) => ipcRenderer.invoke('license:import', p),
      delete: (p) => ipcRenderer.invoke('license:delete', p),
      hasAccess: (p) => ipcRenderer.invoke('license:hasAccess', p)
    },
    editor: {
      status: () => ipcRenderer.invoke('editor:status'),
      activate: (p) => ipcRenderer.invoke('editor:activate', p),
      deactivate: () => ipcRenderer.invoke('editor:deactivate'),
      generateLicense: (p) => ipcRenderer.invoke('editor:generateLicense', p)
    },
    session: {
      flags: () => ipcRenderer.invoke('session:flags')
    },
    identity: {
      get: () => ipcRenderer.invoke('identity:get'),
      setLabel: (p) => ipcRenderer.invoke('identity:setLabel', p),
      regenerate: (p) => ipcRenderer.invoke('identity:regenerate', p),
      qrcode: (p) => ipcRenderer.invoke('identity:qrcode', p)
    }
  },
  contacts: {
    list: () => ipcRenderer.invoke('contacts:list'),
    create: (p) => ipcRenderer.invoke('contacts:create', p),
    update: (p) => ipcRenderer.invoke('contacts:update', p),
    delete: (p) => ipcRenderer.invoke('contacts:delete', p)
  },
  ndev: {
    export: (p) => ipcRenderer.invoke('ndev:export', p),
    import: (p) => ipcRenderer.invoke('ndev:import', p),
    receivedList: () => ipcRenderer.invoke('ndev:received:list'),
    receivedGet: (p) => ipcRenderer.invoke('ndev:received:get', p),
    receivedSetStatut: (p) => ipcRenderer.invoke('ndev:received:setStatut', p),
    receivedDelete: (p) => ipcRenderer.invoke('ndev:received:delete', p),
    sentLog: (p) => ipcRenderer.invoke('ndev:sentLog', p),
    openInbox: () => ipcRenderer.invoke('ndev:openInbox')
  },
  // Réponses annotées Artisan ↔ BE (.ndev-reply)
  quoteResponse: {
    saveDraft: (p) => ipcRenderer.invoke('quoteResponse:saveDraft', p),
    getDraft: (p) => ipcRenderer.invoke('quoteResponse:getDraft', p),
    export: (p) => ipcRenderer.invoke('quoteResponse:export', p),
    import: (p) => ipcRenderer.invoke('quoteResponse:import', p),
    receivedList: () => ipcRenderer.invoke('quoteResponse:receivedList'),
    receivedGet: (p) => ipcRenderer.invoke('quoteResponse:receivedGet', p),
    receivedSetStatut: (p) => ipcRenderer.invoke('quoteResponse:receivedSetStatut', p),
    receivedDelete: (p) => ipcRenderer.invoke('quoteResponse:receivedDelete', p),
    integrate: (p) => ipcRenderer.invoke('quoteResponse:integrate', p)
  },
  // Sauvegarde / restauration
  backup: {
    export: () => ipcRenderer.invoke('backup:export'),
    import: () => ipcRenderer.invoke('backup:import'),
    importConfirm: (p) => ipcRenderer.invoke('backup:importConfirm', p)
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
