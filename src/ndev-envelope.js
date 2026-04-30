// src/ndev-envelope.js — Couche cryptographique réutilisable pour .ndev / .ndev-reply
//
// Format ECIES (Elliptic Curve Integrated Encryption Scheme) X25519 + AES-256-GCM.
// Utilisé par :
//   - src/ndev.js          : envoi de devis BE → Artisan (.ndev)
//   - src/quote-response.js: réponse Artisan → BE (.ndev-reply)

const crypto = require('crypto');
const cryptoMod = require('./crypto');
const identity = require('./identity');

// HKDF simplifié SHA-256 → 32 bytes clé + 12 bytes IV. Le `salt` sert de séparation
// de domaine : un même secret partagé donne des clés différentes selon le contexte.
function deriveSymmetric(sharedSecret, salt = 'nuclear-estim-ndev-v1') {
  const info = Buffer.from(salt);
  const prk = crypto.createHmac('sha256', Buffer.alloc(32)).update(sharedSecret).digest();
  const okm = Buffer.concat([
    crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest(),
    crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([2])])).digest()
  ]).slice(0, 44);
  return { key: okm.slice(0, 32), iv: okm.slice(32, 44) };
}

// Chiffre un payload (objet JSON) à destination d'un porteur de clé publique X25519.
// Renvoie l'enveloppe JSON sérialisable (champs base64).
function seal(db, dek, payload, recipientPubB64, options = {}) {
  const recipientPub = Buffer.from(recipientPubB64, 'base64');
  if (recipientPub.length !== 44) {
    throw new Error('Clé publique destinataire invalide (attendu 44 bytes SPKI, lu ' + recipientPub.length + ')');
  }
  const me = identity.getOrCreateIdentity(db, dek);
  const ephemeral = cryptoMod.generateKeyPairX25519();
  const sharedSecret = cryptoMod.deriveSharedSecret(ephemeral.privateKey, recipientPub);
  const { key, iv } = deriveSymmetric(sharedSecret, options.salt);

  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: 1,
    issued_at: Date.now(),
    from_pub: me.pub.toString('base64'),
    from_label: me.label || '',
    to_pub: recipientPub.toString('base64'),
    eph_pub: ephemeral.publicKey.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: ct.toString('base64'),
    tag: tag.toString('base64'),
    subject: options.subject || '',
    payload_kind: options.payloadKind || 'quote'
  };
}

// Ouvre une enveloppe reçue. Vérifie qu'elle nous est bien destinée et déchiffre.
function open(db, dek, envContent, options = {}) {
  let env = typeof envContent === 'string' ? JSON.parse(envContent) : envContent;
  if (env.v !== 1) throw new Error('Version enveloppe inconnue : ' + env.v);
  if (!env.eph_pub || !env.ciphertext || !env.iv || !env.tag) {
    throw new Error('Enveloppe incomplète');
  }

  const me = identity.getOrCreateIdentity(db, dek);
  if (env.to_pub && env.to_pub !== me.pub.toString('base64')) {
    throw new Error('Cette enveloppe n\'est pas destinée à toi (clé publique différente).');
  }

  const myPriv = identity.getPrivateKey(db, dek);
  const ephPub = Buffer.from(env.eph_pub, 'base64');
  const sharedSecret = cryptoMod.deriveSharedSecret(myPriv, ephPub);
  const { key } = deriveSymmetric(sharedSecret, options.salt);
  const iv = Buffer.from(env.iv, 'base64');
  const ct = Buffer.from(env.ciphertext, 'base64');
  const tag = Buffer.from(env.tag, 'base64');

  let payloadJson;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    payloadJson = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (e) {
    throw new Error('Déchiffrement impossible — clé invalide ou fichier corrompu : ' + e.message);
  }

  let payload;
  try { payload = JSON.parse(payloadJson); }
  catch (_) { throw new Error('Payload déchiffré invalide'); }

  return { env, payload };
}

module.exports = { seal, open };
