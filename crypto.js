// src/crypto.js — Couche crypto centralisée.
// Choix techniques :
//   - Dérivation MDP : scryptSync (intégré Node, pas de build natif)
//   - Chiffrement symétrique : AES-256-GCM
//   - Échange asymétrique : X25519 (pour Phase 3, .ndev)
//   - Phrase de récup : BIP-39 12 mots (lib bip39)

const crypto = require('crypto');
const bip39 = require('bip39');

const KEY_LEN = 32; // 256 bits

// ---- Dérivation de clé ---------------------------------------------------

function deriveKey(password, salt) {
  // scrypt N=2^15 (32768), r=8, p=1 — solide, ~100ms sur PC moderne
  return crypto.scryptSync(password, salt, KEY_LEN, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function randomBytes(n) {
  return crypto.randomBytes(n);
}

// ---- AES-256-GCM ---------------------------------------------------------

function aesGcmEncrypt(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    ct: enc.toString('base64'),
    tag: tag.toString('base64')
  });
}

function aesGcmDecrypt(payloadOrJson, key) {
  const payload = typeof payloadOrJson === 'string' ? JSON.parse(payloadOrJson) : payloadOrJson;
  const iv = Buffer.from(payload.iv, 'base64');
  const ct = Buffer.from(payload.ct, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

// ---- BIP-39 (phrase de récupération 12 mots) -----------------------------

function generateMnemonic() {
  // 128 bits d'entropie => 12 mots
  return bip39.generateMnemonic(128);
}

function validateMnemonic(phrase) {
  if (typeof phrase !== 'string') return false;
  return bip39.validateMnemonic(phrase.trim());
}

// ---- X25519 (échange .ndev en Phase 3) -----------------------------------

function generateKeyPairX25519() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' })
  };
}

function deriveSharedSecret(myPrivateKeyDer, theirPublicKeyDer) {
  const myPriv = crypto.createPrivateKey({ key: myPrivateKeyDer, format: 'der', type: 'pkcs8' });
  const theirPub = crypto.createPublicKey({ key: theirPublicKeyDer, format: 'der', type: 'spki' });
  return crypto.diffieHellman({ privateKey: myPriv, publicKey: theirPub });
}

// ---- Helpers utilitaires -------------------------------------------------

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

module.exports = {
  deriveKey,
  randomBytes,
  aesGcmEncrypt,
  aesGcmDecrypt,
  generateMnemonic,
  validateMnemonic,
  generateKeyPairX25519,
  deriveSharedSecret,
  sha256
};
