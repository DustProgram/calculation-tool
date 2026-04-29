// main.js — Process Electron principal
// Responsabilités : créer la fenêtre, exposer IPC, initialiser la DB et la couche crypto.

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const cryptoMod = require('./src/crypto');
const dbMod = require('./src/db');
const ndev = require('./src/ndev');

let mainWindow = null;
let session = null; // { userId, profil, masterKey } après login

// ------------------------------------------------------------------------
// Dossiers de travail
// ------------------------------------------------------------------------

function getAppDir() {
  // %APPDATA%\RAMEDACE Devis\ sur Windows, équivalent sur autres OS
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
      message: `RAMEDACE Devis ${info.version} a été téléchargée.`,
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
    title: 'RAMEDACE Devis',
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
    const userId = dbMod.systemDb().createUser({
      login,
      displayName: displayName || login,
      profilDefault: profilDefault || 'etude',
      salt: salt.toString('base64'),
      wrappedByPassword,
      wrappedByMnemonic,
      publicKey: kp.publicKey.toString('base64'),
      encPrivKey
    });

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
      dek = cryptoMod.aesGcmDecrypt(JSON.parse(user.wrappedByPassword), masterKey);
    } catch (_) {
      throw new Error('Identifiants invalides.');
    }
    session = { userId: user.id, login: user.login, displayName: user.display_name, profil: user.profil_default, dek };
    // Initialise la DB utilisateur (chiffrée par DEK pour les colonnes sensibles)
    dbMod.openUserDb(user.id, dek);
    return { ok: true, user: { id: user.id, login: user.login, displayName: user.display_name, profilDefault: user.profil_default } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('auth:recover', async (_evt, { login, mnemonic, newPassword }) => {
  try {
    const user = dbMod.systemDb().getUserByLogin(login);
    if (!user) throw new Error('Identifiant inconnu.');
    if (!cryptoMod.validateMnemonic(mnemonic)) throw new Error('Phrase de récupération invalide.');
    const salt = Buffer.from(user.salt, 'base64');
    const recoveryKey = cryptoMod.deriveKey(mnemonic.trim(), salt);
    let dek;
    try {
      dek = cryptoMod.aesGcmDecrypt(JSON.parse(user.wrappedByMnemonic), recoveryKey);
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

app.whenReady().then(() => {
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
