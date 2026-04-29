// src/license.js — Système de licences modulaires signées Ed25519
//
// Format .nelic (Nuclear Estim License) :
//   {
//     v: 1,                              // version du format
//     id: "lic-xxxx",                    // ID unique de la licence
//     user_id: "...",                    // Pour qui (texte libre)
//     user_name: "Jean Dupont",          // Affichage
//     modules: ["etude", "compta"],      // Modules autorisés
//     issued_at: <timestamp>,
//     expires_at: <timestamp>|null,      // null = jamais
//     issuer_note: "Achat 2026-04-29",   // Note de l'éditeur (optionnel)
//     signature: "base64..."             // Signature Ed25519 de tout le reste
//   }

const crypto = require('crypto');
const cryptoMod = require('./crypto');

// =========================================================================
// CLÉ PUBLIQUE MAÎTRE (intégrée dans le code source — JAMAIS la privée !)
// =========================================================================
//
// Cette clé permet de VÉRIFIER toute licence générée par Roland.
// La clé privée correspondante n'existe QUE chez Roland.
//
// Si un jour tu dois changer cette paire de clés (compromise, perdue) :
//   1. Génère une nouvelle paire avec `crypto.generateKeyPairSync('ed25519')`
//   2. Remplace cette constante par la nouvelle clé publique
//   3. Distribue une nouvelle version de l'app (les anciennes licences seront invalides)
//
const MASTER_PUBLIC_KEY_B64 = 'MCowBQYDK2VwAyEAdSYwxgShbcST4Ggz65OlCXgr4muHqUfxpIvcN9rMWIg=';

const MASTER_PUBLIC_KEY = crypto.createPublicKey({
  key: Buffer.from(MASTER_PUBLIC_KEY_B64, 'base64'),
  format: 'der',
  type: 'spki'
});

// Liste des modules valides
const VALID_MODULES = ['etude', 'compta'];

// =========================================================================
// SIGNATURE / VÉRIFICATION
// =========================================================================

// Sérialise un payload de manière déterministe (pour signature)
function canonicalSerialize(obj) {
  // Tri des clés alphabétiquement, hors signature
  const keys = Object.keys(obj).filter(k => k !== 'signature').sort();
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return JSON.stringify(out);
}

// Signe un payload avec une clé privée (mode éditeur uniquement)
function signLicense(payload, privateKeyDer) {
  const privKey = crypto.createPrivateKey({
    key: privateKeyDer,
    format: 'der',
    type: 'pkcs8'
  });
  const data = Buffer.from(canonicalSerialize(payload));
  const sig = crypto.sign(null, data, privKey);
  return { ...payload, signature: sig.toString('base64') };
}

// Vérifie qu'une licence est valide (signature + dates + modules)
function verifyLicense(license) {
  if (!license || typeof license !== 'object') {
    return { ok: false, reason: 'Format invalide' };
  }
  if (license.v !== 1) {
    return { ok: false, reason: 'Version inconnue : ' + license.v };
  }
  if (!Array.isArray(license.modules) || license.modules.length === 0) {
    return { ok: false, reason: 'Aucun module dans la licence' };
  }
  for (const m of license.modules) {
    if (!VALID_MODULES.includes(m)) {
      return { ok: false, reason: 'Module inconnu : ' + m };
    }
  }
  if (!license.signature) {
    return { ok: false, reason: 'Signature manquante' };
  }
  // Vérification cryptographique
  let sigOk = false;
  try {
    const data = Buffer.from(canonicalSerialize(license));
    sigOk = crypto.verify(null, data, MASTER_PUBLIC_KEY, Buffer.from(license.signature, 'base64'));
  } catch (e) {
    return { ok: false, reason: 'Erreur de vérification : ' + e.message };
  }
  if (!sigOk) {
    return { ok: false, reason: 'Signature invalide — ce fichier .nelic n\'a pas été émis par cette installation' };
  }
  // Expiration
  if (license.expires_at && license.expires_at < Date.now()) {
    return { ok: false, reason: 'Licence expirée le ' + new Date(license.expires_at).toLocaleDateString('fr-FR') };
  }
  return { ok: true };
}

// Vérifie qu'une clé privée correspond bien à la clé publique maître
function checkMasterPrivateKey(privateKeyB64) {
  try {
    const privKey = crypto.createPrivateKey({
      key: Buffer.from(privateKeyB64, 'base64'),
      format: 'der',
      type: 'pkcs8'
    });
    // Génère un challenge aléatoire et le signe
    const challenge = crypto.randomBytes(32);
    const sig = crypto.sign(null, challenge, privKey);
    // Vérifie avec la clé publique maître
    return crypto.verify(null, challenge, MASTER_PUBLIC_KEY, sig);
  } catch (_) {
    return false;
  }
}

// =========================================================================
// PERSISTANCE — Licences importées par l'utilisateur
// =========================================================================

// Stocke une licence dans la DB de l'utilisateur (after verifyLicense)
function addUserLicense(db, license) {
  // Empêche les doublons (par id)
  db.prepare(`DELETE FROM user_licenses WHERE license_id = ?`).run(license.id || '');
  db.prepare(`
    INSERT INTO user_licenses (license_id, user_name, modules, issued_at, expires_at, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    license.id || '',
    license.user_name || '',
    JSON.stringify(license.modules || []),
    license.issued_at || Date.now(),
    license.expires_at || null,
    JSON.stringify(license),
    Date.now()
  );
}

function listUserLicenses(db) {
  const rows = db.prepare(`SELECT * FROM user_licenses ORDER BY created_at DESC`).all();
  return rows.map(r => ({
    ...r,
    modules: JSON.parse(r.modules || '[]'),
    payload: JSON.parse(r.payload || '{}')
  }));
}

function deleteUserLicense(db, id) {
  db.prepare(`DELETE FROM user_licenses WHERE id = ?`).run(id);
}

// Calcule l'ensemble des modules actifs (union de toutes les licences valides + non expirées)
function getActiveModules(db) {
  const licenses = listUserLicenses(db);
  const active = new Set();
  const now = Date.now();
  for (const lic of licenses) {
    if (lic.expires_at && lic.expires_at < now) continue;
    // Re-vérifier la signature à chaque appel (paranoïa — empêche manipulation manuelle DB)
    const v = verifyLicense(lic.payload);
    if (!v.ok) continue;
    for (const m of lic.modules) active.add(m);
  }
  return Array.from(active);
}

function hasModuleAccess(db, moduleName) {
  return getActiveModules(db).includes(moduleName);
}

// =========================================================================
// MODE ÉDITEUR — La clé privée maître est stockée chiffrée (par DEK utilisateur)
// =========================================================================

// Active le mode éditeur en stockant la clé privée maître chiffrée
function activateEditorMode(db, dek, privateKeyB64) {
  if (!checkMasterPrivateKey(privateKeyB64)) {
    throw new Error('La clé privée fournie ne correspond pas à la clé publique maître intégrée dans cette version. Vérifie que tu as le bon fichier.');
  }
  const ciphertextJson = cryptoMod.aesGcmEncrypt(Buffer.from(privateKeyB64, 'utf8'), dek);
  db.prepare(`UPDATE user_secrets SET master_private_key = ? WHERE id = 1`).run(Buffer.from(ciphertextJson, 'utf8'));
  return true;
}

function deactivateEditorMode(db) {
  db.prepare(`UPDATE user_secrets SET master_private_key = NULL WHERE id = 1`).run();
}

function isEditorActive(db) {
  const r = db.prepare(`SELECT master_private_key FROM user_secrets WHERE id = 1`).get();
  return !!(r && r.master_private_key);
}

// Retourne la clé privée déchiffrée (pour signer des licences)
function getMasterPrivateKey(db, dek) {
  const r = db.prepare(`SELECT master_private_key FROM user_secrets WHERE id = 1`).get();
  if (!r || !r.master_private_key) throw new Error('Mode éditeur non activé');
  const blob = Buffer.isBuffer(r.master_private_key) ? r.master_private_key : Buffer.from(r.master_private_key);
  const ciphertextJson = blob.toString('utf8');
  const plainBuf = cryptoMod.aesGcmDecrypt(ciphertextJson, dek);
  return plainBuf.toString('utf8');
}

// Génère une nouvelle licence (mode éditeur uniquement)
function generateLicense(db, dek, params) {
  const privB64 = getMasterPrivateKey(db, dek);
  const privDer = Buffer.from(privB64, 'base64');
  const id = 'lic-' + crypto.randomBytes(8).toString('hex');
  const payload = {
    v: 1,
    id,
    user_id: params.user_id || '',
    user_name: params.user_name || '',
    modules: Array.isArray(params.modules) ? params.modules.filter(m => VALID_MODULES.includes(m)) : [],
    issued_at: Date.now(),
    expires_at: params.expires_at || null,
    issuer_note: params.issuer_note || ''
  };
  if (payload.modules.length === 0) {
    throw new Error('Au moins un module doit être autorisé');
  }
  return signLicense(payload, privDer);
}

module.exports = {
  MASTER_PUBLIC_KEY_B64, VALID_MODULES,
  signLicense, verifyLicense, checkMasterPrivateKey,
  addUserLicense, listUserLicenses, deleteUserLicense,
  getActiveModules, hasModuleAccess,
  activateEditorMode, deactivateEditorMode, isEditorActive, getMasterPrivateKey,
  generateLicense
};
