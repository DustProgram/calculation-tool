// src/identity.js — Identité cryptographique X25519 de l'utilisateur
// Permet l'échange chiffré de devis entre BE et Artisans via .ndev

const cryptoMod = require('./crypto');

// Génère ou récupère la paire X25519 de l'utilisateur
// Au 1er appel : génère et stocke (privée chiffrée par DEK, publique en clair)
function getOrCreateIdentity(db, dek, defaultLabel = '') {
  const r = db.prepare(`SELECT x25519_private, x25519_public, x25519_label FROM user_secrets WHERE id = 1`).get();
  if (r && r.x25519_public && r.x25519_private) {
    return {
      pub: Buffer.isBuffer(r.x25519_public) ? r.x25519_public : Buffer.from(r.x25519_public),
      label: r.x25519_label || defaultLabel,
      hasIdentity: true
    };
  }
  // Génère une nouvelle paire
  const kp = cryptoMod.generateKeyPairX25519();
  const ciphertextJson = cryptoMod.aesGcmEncrypt(kp.privateKey, dek);
  db.prepare(`UPDATE user_secrets SET x25519_private = ?, x25519_public = ?, x25519_label = ? WHERE id = 1`)
    .run(Buffer.from(ciphertextJson, 'utf8'), kp.publicKey, defaultLabel);
  return { pub: kp.publicKey, label: defaultLabel, hasIdentity: true };
}

// Récupère la clé privée déchiffrée (pour décrypter un .ndev reçu)
function getPrivateKey(db, dek) {
  const r = db.prepare(`SELECT x25519_private FROM user_secrets WHERE id = 1`).get();
  if (!r || !r.x25519_private) throw new Error('Identité non initialisée');
  const blob = Buffer.isBuffer(r.x25519_private) ? r.x25519_private : Buffer.from(r.x25519_private);
  return cryptoMod.aesGcmDecrypt(blob.toString('utf8'), dek);
}

// Met à jour le libellé d'identité
function setLabel(db, label) {
  db.prepare(`UPDATE user_secrets SET x25519_label = ? WHERE id = 1`).run(label || '');
}

// Régénère la paire (anciens .ndev reçus restent lisibles via leur ancienne clé en DB)
// Mais les nouvelles personnes ne pourront utiliser que la nouvelle clé publique
function regenerateIdentity(db, dek, label) {
  const kp = cryptoMod.generateKeyPairX25519();
  const ciphertextJson = cryptoMod.aesGcmEncrypt(kp.privateKey, dek);
  db.prepare(`UPDATE user_secrets SET x25519_private = ?, x25519_public = ?, x25519_label = ? WHERE id = 1`)
    .run(Buffer.from(ciphertextJson, 'utf8'), kp.publicKey, label || '');
  return { pub: kp.publicKey, label: label || '' };
}

// Format compact pour partage : "NESTM-XXXX-XXXX-XXXX-XXXX..." (base32)
// La clé publique X25519 fait 32 bytes = 52 chars en base32
function pubToShareable(pubBuf) {
  // On utilise base64url pour rester court et copier-collable
  return 'nestm:' + pubBuf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function pubFromShareable(s) {
  if (!s || typeof s !== 'string') throw new Error('Clé invalide');
  let b64 = s.trim();
  if (b64.startsWith('nestm:')) b64 = b64.slice(6);
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const buf = Buffer.from(b64, 'base64');
  // Format DER SPKI X25519 = 44 bytes (12 bytes header ASN.1 + 32 bytes clé)
  if (buf.length !== 44) throw new Error('Clé X25519 doit être en format SPKI DER (44 bytes en base64). Lue : ' + buf.length + ' bytes.');
  return buf;
}

module.exports = {
  getOrCreateIdentity, getPrivateKey, setLabel, regenerateIdentity,
  pubToShareable, pubFromShareable
};
