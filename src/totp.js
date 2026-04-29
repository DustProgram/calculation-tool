// src/totp.js — Implémentation TOTP RFC 6238 (Google Authenticator, Authy, Bitwarden, etc.)
// HMAC-SHA1, fenêtre 30 secondes, 6 chiffres, tolérance ±1 step (gestion dérive horloge)

const crypto = require('crypto');

// =========================================================================
// Encodage/décodage Base32 (RFC 4648, alphabet sans 0/1/I/L pour clarté)
// =========================================================================

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function bufferToBase32(buf) {
  let out = '';
  let bits = 0, value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1F];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1F];
  return out;
}

function base32ToBuffer(s) {
  s = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const result = [];
  let bits = 0, value = 0;
  for (const c of s) {
    const i = BASE32_ALPHABET.indexOf(c);
    if (i === -1) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      result.push((value >>> (bits - 8)) & 0xFF);
      bits -= 8;
    }
  }
  return Buffer.from(result);
}

// =========================================================================
// TOTP
// =========================================================================

function generateSecret() {
  return crypto.randomBytes(20); // 160 bits, recommandé RFC 6238
}

// Génère le code à 6 chiffres pour le timestamp donné (par défaut maintenant)
function generateTOTP(secretBuf, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 30000);
  const counterBuf = Buffer.alloc(8);
  // Big-endian 64 bits
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter & 0xFFFFFFFF, 4);

  const hmac = crypto.createHmac('sha1', secretBuf);
  hmac.update(counterBuf);
  const hash = hmac.digest();

  const offset = hash[hash.length - 1] & 0x0F;
  const code = (
    ((hash[offset] & 0x7F) << 24) |
    ((hash[offset + 1] & 0xFF) << 16) |
    ((hash[offset + 2] & 0xFF) << 8) |
    (hash[offset + 3] & 0xFF)
  ) % 1000000;

  return String(code).padStart(6, '0');
}

// Vérifie un code utilisateur, avec tolérance de ±1 step (90s de fenêtre totale)
function verifyTOTP(secretBuf, token, windowSteps = 1) {
  if (!token || typeof token !== 'string') return false;
  const cleaned = token.replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  const now = Date.now();
  for (let i = -windowSteps; i <= windowSteps; i++) {
    const expected = generateTOTP(secretBuf, now + i * 30000);
    // Comparaison à temps constant pour éviter timing attacks
    if (cleaned.length === expected.length && crypto.timingSafeEqual(Buffer.from(cleaned), Buffer.from(expected))) {
      return true;
    }
  }
  return false;
}

// URL OTPAUTH (norme Google Authenticator) — à encoder en QR code
function getOtpAuthUrl(secretBuf, label, issuer = 'Nuclear Estim') {
  const secretB32 = bufferToBase32(secretBuf).replace(/=/g, '');
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30'
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?${params.toString()}`;
}

// =========================================================================
// Codes de récupération (en cas de perte du téléphone)
// =========================================================================

// Génère N codes de récupération format XXXX-XXXX (8 chars, lisibles)
function generateRecoveryCodes(n = 8) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const buf = crypto.randomBytes(5);
    const part1 = bufferToBase32(buf.slice(0, 3)).slice(0, 4);
    const part2 = bufferToBase32(buf.slice(2, 5)).slice(0, 4);
    codes.push(part1 + '-' + part2);
  }
  return codes;
}

function hashRecoveryCode(code) {
  // SHA-256 sur le code normalisé (uppercase, sans tirets)
  const norm = code.toUpperCase().replace(/-/g, '');
  return crypto.createHash('sha256').update(norm).digest('hex');
}

function verifyRecoveryCode(code, hashes) {
  if (!Array.isArray(hashes)) return { ok: false, hashes };
  const target = hashRecoveryCode(code);
  const idx = hashes.indexOf(target);
  if (idx === -1) return { ok: false, hashes };
  // Code utilisé = retiré de la liste (one-time use)
  const newHashes = hashes.slice();
  newHashes.splice(idx, 1);
  return { ok: true, hashes: newHashes };
}

module.exports = {
  bufferToBase32, base32ToBuffer,
  generateSecret, generateTOTP, verifyTOTP, getOtpAuthUrl,
  generateRecoveryCodes, hashRecoveryCode, verifyRecoveryCode
};
