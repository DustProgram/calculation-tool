// main.js — Process Electron principal
// Responsabilités : créer la fenêtre, exposer IPC, initialiser la DB et la couche crypto.

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const cryptoMod = require('./src/crypto');
const dbMod = require('./src/db');
const ndev = require('./src/ndev');
const etude = require('./src/etude');
const artisan = require('./src/artisan');
const compta = require('./src/compta');
const license = require('./src/license');
const totp = require('./src/totp');
const excelMod = require('./src/excel');
const pdfMod = require('./src/pdf');

// Flags de session sécurité (reset à chaque relance ou logout)
let sessionFlags = {
  totpVerifiedAtLogin: false,
  totpVerifiedForCompta: false
};
function resetSessionFlags() {
  sessionFlags = { totpVerifiedAtLogin: false, totpVerifiedForCompta: false };
}

let mainWindow = null;
let session = null; // { userId, profil, masterKey } après login

// ------------------------------------------------------------------------
// Dossiers de travail
// ------------------------------------------------------------------------

function getAppDir() {
  // %APPDATA%\Nucléar Estim\ sur Windows, équivalent sur autres OS
  const dir = path.join(app.getPath('userData'), 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getInboxDir() {
  // Dossier surveillé pour réception automatique de fichiers .ndev
  const dir = path.join(app.getPath('userData'), 'inbox');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ------------------------------------------------------------------------
// Auto-update (electron-updater + GitHub Releases)
// ------------------------------------------------------------------------

function setupAutoUpdate() {
  // En dev (npm start), on ne vérifie pas les MAJ pour éviter le bruit
  if (!app.isPackaged) {
    console.log('[updater] Mode dev — auto-update désactivé');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Vérification des mises à jour…');
  });
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] Mise à jour disponible :', info.version);
    if (mainWindow) mainWindow.webContents.send('update:available', info);
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[updater] Aucune mise à jour disponible.');
  });
  autoUpdater.on('error', (err) => {
    console.error('[updater] Erreur :', err);
  });
  autoUpdater.on('download-progress', (p) => {
    if (mainWindow) mainWindow.webContents.send('update:progress', p);
  });
  autoUpdater.on('update-downloaded', async (info) => {
    console.log('[updater] Mise à jour téléchargée :', info.version);
    if (mainWindow) mainWindow.webContents.send('update:downloaded', info);
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Mise à jour prête',
      message: `Nucléar Estim ${info.version} a été téléchargée.`,
      detail: 'L\'application va se fermer pour appliquer la mise à jour. Tes données et ta session seront conservées.',
      buttons: ['Redémarrer maintenant', 'Plus tard'],
      defaultId: 0,
      cancelId: 1
    });
    if (choice.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  // Vérification 5 secondes après le démarrage (laisse le temps au login de s'afficher)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      console.error('[updater] checkForUpdates a échoué :', err);
    });
  }, 5000);
}

ipcMain.handle('app:checkForUpdates', async () => {
  if (!app.isPackaged) return { ok: false, error: 'Mode dev — pas de MAJ.' };
  try {
    const r = await autoUpdater.checkForUpdates();
    return { ok: true, info: r ? r.updateInfo : null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ------------------------------------------------------------------------
// Création de la fenêtre
// ------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    title: 'Nucléar Estim',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false,
    backgroundColor: '#1e1e2e'
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('closed', () => {
    mainWindow = null;
    session = null;
  });

  // Menu réduit pour l'instant
  if (process.platform !== 'darwin') {
    mainWindow.setMenu(null);
  }
}

// ------------------------------------------------------------------------
// IPC : authentification
// ------------------------------------------------------------------------

ipcMain.handle('auth:exists', async () => {
  // Au moins un compte existe-t-il dans le système ?
  return dbMod.systemDb().hasAnyUser();
});

ipcMain.handle('auth:listUsers', async () => {
  // Liste publique : juste login + nom affiché, sans rien de sensible
  return dbMod.systemDb().listUsers();
});

ipcMain.handle('auth:signup', async (_evt, payload) => {
  try {
    const { login, displayName, password, profilDefault } = payload;
    if (!login || !password) throw new Error('Login et mot de passe requis.');
    if (password.length < 8) throw new Error('Le mot de passe doit faire au moins 8 caractères.');

    // 1. Génère phrase de récup 12 mots
    const mnemonic = cryptoMod.generateMnemonic();

    // 2. Dérive clé maître depuis le MDP + un salt aléatoire
    const salt = cryptoMod.randomBytes(32);
    const masterKey = cryptoMod.deriveKey(password, salt);

    // 3. Crée une clé de chiffrement de données (DEK) aléatoire,
    //    chiffrée par la masterKey ET par une clé dérivée de la mnemonic
    //    → ainsi MDP ou phrase peuvent toutes deux déchiffrer la DEK
    const dek = cryptoMod.randomBytes(32);
    const wrappedByPassword = cryptoMod.aesGcmEncrypt(dek, masterKey);
    const recoveryKey = cryptoMod.deriveKey(mnemonic, salt);
    const wrappedByMnemonic = cryptoMod.aesGcmEncrypt(dek, recoveryKey);

    // 4. Génère la paire X25519 pour échange de devis (.ndev)
    const kp = cryptoMod.generateKeyPairX25519();
    // Clé privée chiffrée avec la DEK (donc seulement déchiffrable une fois loggué)
    const encPrivKey = cryptoMod.aesGcmEncrypt(kp.privateKey, dek);

    // 5. Stocke le tout
    let userId;
    try {
      userId = dbMod.systemDb().createUser({
        login,
        displayName: displayName || login,
        profilDefault: profilDefault || 'etude',
        salt: salt.toString('base64'),
        wrappedByPassword,
        wrappedByMnemonic,
        publicKey: kp.publicKey.toString('base64'),
        encPrivKey
      });
    } catch (e) {
      if (/UNIQUE.*login/i.test(e.message)) {
        throw new Error(`Cet identifiant est déjà utilisé. Choisis-en un autre, ou utilise "Mot de passe oublié" si c'est ton compte.`);
      }
      throw e;
    }

    return {
      ok: true,
      userId,
      mnemonic, // ⚠️ retourné UNE SEULE FOIS au signup, à afficher à l'utilisateur
      publicKey: kp.publicKey.toString('base64')
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('auth:login', async (_evt, { login, password }) => {
  try {
    const user = dbMod.systemDb().getUserByLogin(login);
    if (!user) throw new Error('Identifiants invalides.');
    const salt = Buffer.from(user.salt, 'base64');
    const masterKey = cryptoMod.deriveKey(password, salt);
    let dek;
    try {
      dek = cryptoMod.aesGcmDecrypt(JSON.parse(user.wrapped_by_password), masterKey);
    } catch (_) {
      throw new Error('Identifiants invalides.');
    }
    session = { userId: user.id, login: user.login, displayName: user.display_name, profil: user.profil_default, dek };
    // Initialise la DB utilisateur (chiffrée par DEK pour les colonnes sensibles)
    dbMod.openUserDb(user.id, dek);
    resetSessionFlags();
    return { ok: true, user: { id: user.id, login: user.login, displayName: user.display_name, profilDefault: user.profil_default } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('auth:recover', async (_evt, { login, mnemonic, newPassword }) => {
  try {
    const user = dbMod.systemDb().getUserByLogin(login);
    if (!user) throw new Error('Identifiant inconnu.');
    // Normalise la phrase (virgules ou espaces → 1 espace)
    const normalizedMnemonic = String(mnemonic || '').trim().toLowerCase().replace(/[,\s]+/g, ' ');
    if (!cryptoMod.validateMnemonic(normalizedMnemonic)) throw new Error('Phrase de récupération invalide (vérifie l\'orthographe et l\'ordre des 12 mots).');
    const salt = Buffer.from(user.salt, 'base64');
    const recoveryKey = cryptoMod.deriveKey(normalizedMnemonic, salt);
    let dek;
    try {
      dek = cryptoMod.aesGcmDecrypt(JSON.parse(user.wrapped_by_mnemonic), recoveryKey);
    } catch (_) {
      throw new Error('Phrase de récupération incorrecte.');
    }
    // Re-wrap la DEK avec le nouveau MDP
    if (!newPassword || newPassword.length < 8) throw new Error('Nouveau mot de passe trop court.');
    const newMasterKey = cryptoMod.deriveKey(newPassword, salt);
    const newWrapped = cryptoMod.aesGcmEncrypt(dek, newMasterKey);
    dbMod.systemDb().updateWrappedPassword(user.id, newWrapped);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('auth:logout', async () => {
  session = null;
  dbMod.closeUserDb();
  resetSessionFlags();
  return { ok: true };
});

ipcMain.handle('auth:session', async () => {
  if (!session) return { loggedIn: false };
  return { loggedIn: true, user: { id: session.userId, login: session.login, displayName: session.displayName, profilDefault: session.profil } };
});

// ------------------------------------------------------------------------
// IPC : profil actif
// ------------------------------------------------------------------------

ipcMain.handle('profil:set', async (_evt, profil) => {
  if (!session) return { ok: false, error: 'Non connecté.' };
  if (!['artisan', 'etude'].includes(profil)) return { ok: false, error: 'Profil invalide.' };
  session.profil = profil;
  return { ok: true };
});

// ------------------------------------------------------------------------
// IPC : module Étude — Lots
// ------------------------------------------------------------------------

function requireSession() {
  if (!session) throw new Error('Non connecté.');
  return dbMod.userDb();
}

ipcMain.handle('etude:lots:list', async () => {
  try { return { ok: true, data: etude.listLots(requireSession()) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:lots:create', async (_e, payload) => {
  try { return { ok: true, id: etude.createLot(requireSession(), payload) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:lots:update', async (_e, { id, ...payload }) => {
  try { etude.updateLot(requireSession(), id, payload); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:lots:delete', async (_e, { id }) => {
  try { etude.deleteLot(requireSession(), id); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ------------------------------------------------------------------------
// IPC : module Étude — Prix
// ------------------------------------------------------------------------

ipcMain.handle('etude:prices:list', async (_e, query) => {
  try {
    const db = requireSession();
    return { ok: true, data: etude.listPrices(db, query || {}), total: etude.countPrices(db) };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:prices:create', async (_e, payload) => {
  try { return { ok: true, id: etude.createPrice(requireSession(), payload) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:prices:update', async (_e, { id, ...payload }) => {
  try { etude.updatePrice(requireSession(), id, payload); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:prices:delete', async (_e, { id }) => {
  try { etude.deletePrice(requireSession(), id); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// Import Excel : 2 étapes — preview puis import
ipcMain.handle('etude:prices:excelPreview', async () => {
  try {
    requireSession();
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Sélectionner un fichier Excel',
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'xlsm'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    const data = excelMod.readExcelFile(r.filePaths[0]);
    return { ok: true, filePath: r.filePaths[0], ...data };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:prices:excelLoadSheet', async (_e, { filePath, sheet }) => {
  try {
    requireSession();
    return { ok: true, ...excelMod.readWorkbookSheet(filePath, sheet) };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:prices:excelImport', async (_e, { rows, mapping, replaceExisting }) => {
  try {
    const db = requireSession();
    if (replaceExisting) etude.deletePricesAll(db);
    const mapped = excelMod.applyMapping(rows, mapping);
    const result = etude.bulkImportPrices(db, mapped);
    return { ok: true, ...result };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:prices:exportExcel', async () => {
  try {
    const db = requireSession();
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Exporter la base de prix',
      defaultPath: `base-prix-${Date.now()}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (r.canceled) return { ok: false, canceled: true };
    const all = etude.listPrices(db, {});
    excelMod.exportPricesToExcel(all, r.filePath);
    return { ok: true, path: r.filePath };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ------------------------------------------------------------------------
// IPC : module Étude — Compositions
// ------------------------------------------------------------------------

ipcMain.handle('etude:compos:list', async () => {
  try { return { ok: true, data: etude.listCompositions(requireSession()) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:compos:get', async (_e, { id }) => {
  try { return { ok: true, data: etude.getComposition(requireSession(), id) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:compos:create', async (_e, payload) => {
  try { return { ok: true, id: etude.createComposition(requireSession(), payload) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:compos:update', async (_e, { id, ...payload }) => {
  try { etude.updateComposition(requireSession(), id, payload); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:compos:delete', async (_e, { id }) => {
  try { etude.deleteComposition(requireSession(), id); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ------------------------------------------------------------------------
// IPC : module Étude — Devis
// ------------------------------------------------------------------------

ipcMain.handle('etude:quotes:list', async () => {
  try { return { ok: true, data: etude.listQuotes(requireSession()) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:quotes:get', async (_e, { id }) => {
  try { return { ok: true, data: etude.getQuote(requireSession(), id) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:quotes:create', async (_e, payload) => {
  try { return { ok: true, id: etude.createQuote(requireSession(), payload) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:quotes:updateMeta', async (_e, { id, ...payload }) => {
  try { etude.updateQuoteMeta(requireSession(), id, payload); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:quotes:addVersion', async (_e, { id, lignes }) => {
  try { return { ok: true, numero: etude.addQuoteVersion(requireSession(), id, lignes) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:quotes:delete', async (_e, { id }) => {
  try { etude.deleteQuote(requireSession(), id); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:quotes:diff', async (_e, { vA, vB }) => {
  try { return { ok: true, data: etude.diffVersions(vA, vB) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:quotes:exportPdf', async (_e, { quoteId, versionNumero }) => {
  try {
    const db = requireSession();
    const q = etude.getQuote(db, quoteId);
    if (!q) throw new Error('Devis introuvable.');
    const v = q.versions.find(vv => vv.numero === versionNumero) || q.versions[q.versions.length - 1];
    if (!v) throw new Error('Version introuvable.');
    const lignes = (v.snapshot && v.snapshot.lignes) || [];
    const settings = { kpv_mode: q.kpv_mode, kpv_pct: q.kpv_pct, tva_pct: q.tva_pct };
    const totals = etude.computeQuoteTotals(lignes, settings);
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Exporter le devis en PDF',
      defaultPath: `devis-${q.code || q.id}-v${v.numero}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (r.canceled) return { ok: false, canceled: true };
    await pdfMod.generateQuotePdf(q, v, lignes, totals, r.filePath);
    return { ok: true, path: r.filePath };
  } catch (e) {
    console.error('[exportPdf] Erreur :', e);
    return { ok: false, error: e.message || String(e) };
  }
});

// ------------------------------------------------------------------------
// IPC : module Étude — Indexation
// ------------------------------------------------------------------------

ipcMain.handle('etude:reindex:preview', async (_e, payload) => {
  try { return { ok: true, data: etude.previewReindex(requireSession(), payload) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:reindex:apply', async (_e, payload) => {
  try { return { ok: true, log: etude.applyReindex(requireSession(), payload) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('etude:reindex:history', async () => {
  try { return { ok: true, data: etude.getReindexHistory(requireSession()) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ------------------------------------------------------------------------
// IPC : module Artisan — KPV
// ------------------------------------------------------------------------

ipcMain.handle('artisan:kpv:getGlobal', async () => {
  try { return { ok: true, data: artisan.getKpvGlobal(requireSession()) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:kpv:setGlobal', async (_e, payload) => {
  try { return { ok: true, data: artisan.setKpvGlobal(requireSession(), payload) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:kpv:listAll', async () => {
  try { return { ok: true, data: artisan.listKpvAll(requireSession()) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:kpv:setForLot', async (_e, { lotId, params }) => {
  try { return { ok: true, data: artisan.setKpvForLot(requireSession(), lotId, params) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:kpv:explain', async (_e, { params, ds }) => {
  try { return { ok: true, data: artisan.explainKpv(params, ds || 1000) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('artisan:fraisReels:get', async () => {
  try { return { ok: true, data: artisan.getFraisReels(requireSession()) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:fraisReels:set', async (_e, payload) => {
  try { return { ok: true, data: artisan.setFraisReels(requireSession(), payload) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:fraisReels:compute', async (_e, payload) => {
  try { return { ok: true, data: artisan.computeFraisReelsToKpv(payload) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ------------------------------------------------------------------------
// IPC : module Artisan / Étude — Matériel amorti (PARTAGÉ)
// ------------------------------------------------------------------------

ipcMain.handle('artisan:equipment:list', async (_e, q) => {
  try { return { ok: true, data: artisan.listEquipment(requireSession(), q || {}) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:equipment:get', async (_e, { id }) => {
  try { return { ok: true, data: artisan.getEquipment(requireSession(), id) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:equipment:create', async (_e, payload) => {
  try { return { ok: true, id: artisan.createEquipment(requireSession(), payload) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:equipment:update', async (_e, { id, ...payload }) => {
  try {
    const prix_unitaire = artisan.updateEquipment(requireSession(), id, payload);
    return { ok: true, prix_unitaire };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:equipment:delete', async (_e, { id }) => {
  try { artisan.deleteEquipment(requireSession(), id); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ------------------------------------------------------------------------
// IPC : module Artisan — Fournisseurs
// ------------------------------------------------------------------------

ipcMain.handle('artisan:suppliers:list', async () => {
  try { return { ok: true, data: artisan.listSuppliers(requireSession()) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:suppliers:get', async (_e, { id }) => {
  try { return { ok: true, data: artisan.getSupplier(requireSession(), id) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:suppliers:create', async (_e, payload) => {
  try { return { ok: true, id: artisan.createSupplier(requireSession(), payload) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:suppliers:update', async (_e, { id, ...payload }) => {
  try { artisan.updateSupplier(requireSession(), id, payload); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:suppliers:delete', async (_e, { id }) => {
  try { artisan.deleteSupplier(requireSession(), id); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:suppliers:addPrice', async (_e, { supplierId, ...payload }) => {
  try { return { ok: true, id: artisan.addSupplierPrice(requireSession(), supplierId, payload) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:suppliers:updatePrice', async (_e, { id, ...payload }) => {
  try { artisan.updateSupplierPrice(requireSession(), id, payload); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:suppliers:deletePrice', async (_e, { id }) => {
  try { artisan.deleteSupplierPrice(requireSession(), id); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ------------------------------------------------------------------------
// IPC : module Artisan — Logistique / Déplacements
// ------------------------------------------------------------------------

ipcMain.handle('artisan:logistic:get', async () => {
  try {
    const params = artisan.getLogistic(requireSession());
    return { ok: true, data: params, computed: artisan.computeLogisticCost(params) };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:logistic:set', async (_e, payload) => {
  try {
    const params = artisan.setLogistic(requireSession(), payload);
    return { ok: true, data: params, computed: artisan.computeLogisticCost(params) };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ------------------------------------------------------------------------
// IPC : module Artisan — Suivi chantier
// ------------------------------------------------------------------------

ipcMain.handle('artisan:sites:list', async (_e, q) => {
  try { return { ok: true, data: artisan.listSites(requireSession(), q || {}) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:sites:get', async (_e, { id }) => {
  try { return { ok: true, data: artisan.getSite(requireSession(), id) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:sites:create', async (_e, payload) => {
  try { return { ok: true, id: artisan.createSite(requireSession(), payload) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:sites:update', async (_e, { id, ...payload }) => {
  try { artisan.updateSite(requireSession(), id, payload); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('artisan:sites:delete', async (_e, { id }) => {
  try { artisan.deleteSite(requireSession(), id); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ------------------------------------------------------------------------
// IPC : module Comptabilité
// ------------------------------------------------------------------------

ipcMain.handle('compta:config:get', async () => {
  try { return { ok: true, data: compta.getConfig(requireSession()) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('compta:config:set', async (_e, payload) => {
  try { return { ok: true, data: compta.setConfig(requireSession(), payload) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('compta:config:plan', async () => {
  return { ok: true, data: { recettes: compta.COMPTES_RECETTES, charges: compta.COMPTES_CHARGES } };
});

ipcMain.handle('compta:ecritures:list', async (_e, q) => {
  try { return { ok: true, data: compta.listEcritures(requireSession(), q || {}) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('compta:ecritures:create', async (_e, payload) => {
  try { return { ok: true, id: compta.createEcriture(requireSession(), payload) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('compta:ecritures:update', async (_e, { id, ...payload }) => {
  try { compta.updateEcriture(requireSession(), id, payload); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('compta:ecritures:delete', async (_e, { id }) => {
  try { compta.deleteEcriture(requireSession(), id); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('compta:situations:list', async (_e, { site_id }) => {
  try { return { ok: true, data: compta.listSituations(requireSession(), site_id) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('compta:situations:create', async (_e, payload) => {
  try { return { ok: true, id: compta.createSituation(requireSession(), payload) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('compta:situations:delete', async (_e, { id }) => {
  try { compta.deleteSituation(requireSession(), id); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('compta:dashboard', async (_e, q) => {
  try { return { ok: true, data: compta.computeDashboard(requireSession(), q || {}) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('compta:chantiersEnCours', async (_e, { dateRef } = {}) => {
  try { return { ok: true, data: compta.computeChantiersEnCours(requireSession(), dateRef) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('compta:margeChantiers', async (_e, q) => {
  try { return { ok: true, data: compta.computeMargeChantiers(requireSession(), q || {}) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ------------------------------------------------------------------------
// IPC : Phase 3 — Sécurité (TOTP, Licences, Mode éditeur)
// ------------------------------------------------------------------------

const QRCode = require('qrcode');

// ----- TOTP -----

ipcMain.handle('totp:status', async () => {
  try {
    const db = requireSession();
    const r = db.prepare('SELECT totp_enabled, totp_recovery_hashes FROM user_secrets WHERE id = 1').get();
    const enabled = !!(r && r.totp_enabled);
    const remainingRecovery = enabled && r.totp_recovery_hashes
      ? JSON.parse(r.totp_recovery_hashes).length : 0;
    return { ok: true, enabled, remainingRecovery, sessionVerified: sessionFlags.totpVerifiedAtLogin, comptaVerified: sessionFlags.totpVerifiedForCompta };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Étape 1 : génère un nouveau secret TOTP (mais ne l'enregistre pas encore)
ipcMain.handle('totp:setupBegin', async () => {
  try {
    if (!session) throw new Error('Non connecté');
    const secret = totp.generateSecret();
    const url = totp.getOtpAuthUrl(secret, session.login || 'user', 'Nuclear Estim');
    const qrDataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', scale: 6, margin: 2 });
    const secretB32 = totp.bufferToBase32(secret).replace(/=/g, '');
    return { ok: true, secret: secret.toString('base64'), secretBase32: secretB32, otpauthUrl: url, qrDataUrl };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Étape 2 : confirme avec un code, génère les codes de récupération, enregistre
ipcMain.handle('totp:setupConfirm', async (_e, { secretB64, code }) => {
  try {
    const db = requireSession();
    const secret = Buffer.from(secretB64, 'base64');
    if (!totp.verifyTOTP(secret, code)) {
      return { ok: false, error: 'Code incorrect — vérifie l\'heure du téléphone et réessaie.' };
    }
    const recovs = totp.generateRecoveryCodes(8);
    const hashes = recovs.map(c => totp.hashRecoveryCode(c));
    // Stocke le secret CHIFFRÉ par la DEK (aesGcmEncrypt retourne déjà un JSON string)
    const ciphertextJson = cryptoMod.aesGcmEncrypt(secret, session.dek);
    db.prepare(`UPDATE user_secrets SET totp_secret = ?, totp_enabled = 1, totp_recovery_hashes = ? WHERE id = 1`)
      .run(Buffer.from(ciphertextJson, 'utf8'), JSON.stringify(hashes));
    sessionFlags.totpVerifiedAtLogin = true;
    sessionFlags.totpVerifiedForCompta = true;
    return { ok: true, recoveryCodes: recovs };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Vérifie un code TOTP courant (pour challenge login ou compta)
ipcMain.handle('totp:verify', async (_e, { code, context }) => {
  try {
    const db = requireSession();
    const r = db.prepare('SELECT totp_secret, totp_enabled, totp_recovery_hashes FROM user_secrets WHERE id = 1').get();
    if (!r || !r.totp_enabled) return { ok: false, error: 'TOTP non activé' };
    const blob = Buffer.isBuffer(r.totp_secret) ? r.totp_secret : Buffer.from(r.totp_secret);
    const ciphertextJson = blob.toString('utf8');
    const secret = cryptoMod.aesGcmDecrypt(ciphertextJson, session.dek);
    let valid = totp.verifyTOTP(secret, code);
    let usedRecovery = false;
    // Si pas valide, on tente comme code de récupération
    if (!valid && r.totp_recovery_hashes) {
      const hashes = JSON.parse(r.totp_recovery_hashes);
      const v = totp.verifyRecoveryCode(code, hashes);
      if (v.ok) {
        valid = true; usedRecovery = true;
        db.prepare('UPDATE user_secrets SET totp_recovery_hashes = ? WHERE id = 1').run(JSON.stringify(v.hashes));
      }
    }
    if (!valid) return { ok: false, error: 'Code incorrect' };
    // Marque la session
    if (context === 'login') sessionFlags.totpVerifiedAtLogin = true;
    if (context === 'compta') sessionFlags.totpVerifiedForCompta = true;
    return { ok: true, usedRecovery };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Désactive le TOTP (demande mot de passe pour confirmer)
ipcMain.handle('totp:disable', async (_e, { password }) => {
  try {
    if (!session) throw new Error('Non connecté');
    // Vérification du mot de passe
    const u = dbMod.systemDb().getUserByLogin(session.login);
    if (!u) throw new Error('Utilisateur introuvable');
    const salt = Buffer.from(u.salt, 'base64');
    try {
      const k = cryptoMod.deriveKey(password, salt);
      cryptoMod.aesGcmDecrypt(JSON.parse(u.wrapped_by_password), k);
    } catch (_) { return { ok: false, error: 'Mot de passe incorrect' }; }
    const db = dbMod.userDb();
    db.prepare(`UPDATE user_secrets SET totp_secret = NULL, totp_enabled = 0, totp_recovery_hashes = NULL WHERE id = 1`).run();
    sessionFlags.totpVerifiedAtLogin = false;
    sessionFlags.totpVerifiedForCompta = false;
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Régénère les codes de récupération (en cas de besoin, demande mdp)
ipcMain.handle('totp:regenRecovery', async (_e, { password }) => {
  try {
    const db = requireSession();
    const u = dbMod.systemDb().getUserByLogin(session.login);
    const salt = Buffer.from(u.salt, 'base64');
    try {
      const k = cryptoMod.deriveKey(password, salt);
      cryptoMod.aesGcmDecrypt(JSON.parse(u.wrapped_by_password), k);
    } catch (_) { return { ok: false, error: 'Mot de passe incorrect' }; }
    const recovs = totp.generateRecoveryCodes(8);
    const hashes = recovs.map(c => totp.hashRecoveryCode(c));
    db.prepare('UPDATE user_secrets SET totp_recovery_hashes = ? WHERE id = 1').run(JSON.stringify(hashes));
    return { ok: true, recoveryCodes: recovs };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ----- LICENCES -----

ipcMain.handle('license:status', async () => {
  try {
    const db = requireSession();
    const active = license.getActiveModules(db);
    const isEditor = license.isEditorActive(db);
    return { ok: true, modules: active, hasEtude: active.includes('etude'), hasCompta: active.includes('compta'), isEditor };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('license:list', async () => {
  try { return { ok: true, data: license.listUserLicenses(requireSession()) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('license:import', async (_e, { content }) => {
  try {
    const db = requireSession();
    let lic;
    try { lic = JSON.parse(content); }
    catch (_) { return { ok: false, error: 'Le fichier .nelic n\'est pas un JSON valide' }; }
    const v = license.verifyLicense(lic);
    if (!v.ok) return v;
    license.addUserLicense(db, lic);
    return { ok: true, license: lic };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('license:delete', async (_e, { id }) => {
  try { license.deleteUserLicense(requireSession(), id); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('license:hasAccess', async (_e, { module }) => {
  try { return { ok: true, hasAccess: license.hasModuleAccess(requireSession(), module) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ----- MODE ÉDITEUR -----

ipcMain.handle('editor:status', async () => {
  try { return { ok: true, active: license.isEditorActive(requireSession()) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('editor:activate', async (_e, { privateKeyB64 }) => {
  try {
    if (!session) throw new Error('Non connecté');
    const db = requireSession();
    license.activateEditorMode(db, session.dek, privateKeyB64);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('editor:deactivate', async () => {
  try { license.deactivateEditorMode(requireSession()); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('editor:generateLicense', async (_e, params) => {
  try {
    if (!session) throw new Error('Non connecté');
    const db = requireSession();
    const lic = license.generateLicense(db, session.dek, params);
    return { ok: true, license: lic };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ----- SESSION FLAGS -----

ipcMain.handle('session:flags', async () => {
  return { ok: true, flags: sessionFlags };
});

// ------------------------------------------------------------------------
// IPC : .ndev (stub Phase 0, à compléter en Phase 3)
// ------------------------------------------------------------------------

ipcMain.handle('ndev:exportStub', async (_evt, payload) => {
  if (!session) return { ok: false, error: 'Non connecté.' };
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exporter le devis',
    defaultPath: `devis-${Date.now()}.ndev`,
    filters: [{ name: 'Fichier de devis', extensions: ['ndev'] }]
  });
  if (result.canceled) return { ok: false, error: 'Annulé.' };
  const data = ndev.serialize(payload || { stub: true, generatedAt: Date.now() });
  fs.writeFileSync(result.filePath, data);
  return { ok: true, path: result.filePath };
});

ipcMain.handle('ndev:openInbox', async () => {
  shell.openPath(getInboxDir());
  return { ok: true };
});

// ------------------------------------------------------------------------
// IPC : utilitaires
// ------------------------------------------------------------------------

ipcMain.handle('app:openDataFolder', async () => {
  shell.openPath(app.getPath('userData'));
  return { ok: true };
});

ipcMain.handle('app:version', async () => app.getVersion());

// ------------------------------------------------------------------------
// Cycle de vie
// ------------------------------------------------------------------------

app.whenReady().then(async () => {
  // Initialise le runtime sql.js (WASM, async, une seule fois)
  try {
    await dbMod.initRuntime();
  } catch (e) {
    dialog.showErrorBox('Erreur fatale', 'Impossible de charger le moteur de base de données :\n' + e.message);
    app.quit();
    return;
  }

  // Initialise la DB système (catalogue des utilisateurs)
  dbMod.initSystemDb(getAppDir());
  // Crée le dossier inbox
  getInboxDir();

  createWindow();
  setupAutoUpdate();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
