// src/ndev.js — Échange chiffré de devis entre BE et Artisans
//
// Format ECIES (Elliptic Curve Integrated Encryption Scheme) :
//   1. Émetteur génère une paire éphémère (eph_priv, eph_pub)
//   2. ECDH(eph_priv, recipient_pub) → secret partagé
//   3. HKDF/SHA256 → clé AES-256 + IV
//   4. AES-256-GCM(devis_json) → ciphertext + tag
//   5. Fichier .ndev = JSON contenant { eph_pub, ciphertext, tag, iv, from_pub, subject, ... }
//   6. Destinataire : ECDH(my_priv, eph_pub) → même secret partagé → déchiffre

const crypto = require('crypto');
const cryptoMod = require('./crypto');
const identity = require('./identity');
const etude = require('./etude');

// Dérive une clé symétrique 32 bytes + IV 12 bytes depuis un secret partagé X25519
function deriveSymmetric(sharedSecret, salt = 'nuclear-estim-ndev-v1') {
  // HKDF-like (SHA-256, info=label) — simple et suffisant pour usage one-shot
  const info = Buffer.from(salt);
  const prk = crypto.createHmac('sha256', Buffer.alloc(32)).update(sharedSecret).digest();
  const okm = Buffer.concat([
    crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest(),
    crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([2])])).digest()
  ]).slice(0, 44); // 32 (clé) + 12 (IV)
  return { key: okm.slice(0, 32), iv: okm.slice(32, 44) };
}

// Exporte un devis vers un fichier .ndev pour un destinataire donné
// Retourne le contenu JSON du fichier .ndev (à sauvegarder côté UI)
function exportQuoteToNdev(db, dek, quoteId, recipientPubB64, options = {}) {
  // Récupère le devis complet
  const q = etude.getQuote(db, quoteId);
  if (!q) throw new Error('Devis introuvable');

  // Récupère la clé publique de l'émetteur (pour le destinataire l'identifie)
  const myIdentity = identity.getOrCreateIdentity(db, dek);

  // Décode la clé publique du destinataire (format SPKI DER, 44 bytes)
  const recipientPub = Buffer.from(recipientPubB64, 'base64');
  if (recipientPub.length !== 44) throw new Error('Clé publique destinataire invalide (attendu 44 bytes SPKI, lu ' + recipientPub.length + ')');

  // Génère une paire éphémère pour cet envoi
  const ephemeral = cryptoMod.generateKeyPairX25519();
  const sharedSecret = cryptoMod.deriveSharedSecret(ephemeral.privateKey, recipientPub);

  // Dérive clé AES + IV
  const { key, iv } = deriveSymmetric(sharedSecret);

  // Prépare le payload (devis complet)
  const payload = {
    type: 'quote',
    code: q.code,
    titre: q.titre,
    client_nom: q.client_nom,
    client_adresse: q.client_adresse,
    date_emission: q.date_emission,
    tva_pct: q.tva_pct,
    kpv_mode: q.kpv_mode,
    kpv_pct: q.kpv_pct,
    notes: q.notes,
    versions: q.versions || []
  };
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');

  // Chiffre AES-256-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Fichier .ndev
  const subject = options.subject || `${q.code || '#' + q.id} — ${q.titre || ''}`;
  return {
    v: 1,
    issued_at: Date.now(),
    from_pub: myIdentity.pub.toString('base64'),
    from_label: myIdentity.label || '',
    to_pub: recipientPub.toString('base64'),
    eph_pub: ephemeral.publicKey.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: ct.toString('base64'),
    tag: tag.toString('base64'),
    subject
  };
}

// Importe un .ndev reçu : déchiffre et stocke dans received_quotes
function importNdev(db, dek, ndevContent) {
  let env;
  try {
    env = typeof ndevContent === 'string' ? JSON.parse(ndevContent) : ndevContent;
  } catch (_) {
    throw new Error('Fichier .ndev invalide (JSON corrompu)');
  }
  if (env.v !== 1) throw new Error('Version .ndev inconnue : ' + env.v);
  if (!env.eph_pub || !env.ciphertext || !env.iv || !env.tag) throw new Error('Fichier .ndev incomplet');

  // Vérifie que c'est bien adressé à nous
  const myIdentity = identity.getOrCreateIdentity(db, dek);
  if (env.to_pub && env.to_pub !== myIdentity.pub.toString('base64')) {
    throw new Error('Ce fichier .ndev n\'est pas destiné à toi (clé publique différente). Demande au BE de te le renvoyer avec ta vraie clé publique.');
  }

  // Récupère notre clé privée et dérive le secret partagé
  const myPriv = identity.getPrivateKey(db, dek);
  const ephPub = Buffer.from(env.eph_pub, 'base64');
  const sharedSecret = cryptoMod.deriveSharedSecret(myPriv, ephPub);

  // Dérive la clé AES + IV (identique à l'émetteur)
  const { key } = deriveSymmetric(sharedSecret);
  const iv = Buffer.from(env.iv, 'base64');
  const ct = Buffer.from(env.ciphertext, 'base64');
  const tag = Buffer.from(env.tag, 'base64');

  // Déchiffre
  let payloadJson;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
    payloadJson = plaintext.toString('utf8');
  } catch (e) {
    throw new Error('Déchiffrement impossible — clé invalide ou fichier corrompu : ' + e.message);
  }

  let payload;
  try { payload = JSON.parse(payloadJson); }
  catch (_) { throw new Error('Payload déchiffré invalide'); }

  // Stocke dans received_quotes
  const id = db.prepare(`
    INSERT INTO received_quotes (sender_label, sender_pub, subject, received_at, issued_at, payload, statut)
    VALUES (?, ?, ?, ?, ?, ?, 'nouveau')
  `).run(
    env.from_label || null,
    env.from_pub || null,
    env.subject || '',
    Date.now(),
    env.issued_at || null,
    JSON.stringify(payload)
  ).lastInsertRowid;

  return { id, subject: env.subject, from: env.from_label, payload };
}

function listReceivedQuotes(db) {
  return db.prepare(`SELECT * FROM received_quotes ORDER BY received_at DESC`).all().map(r => ({
    ...r,
    payload: r.payload ? JSON.parse(r.payload) : null
  }));
}

function getReceivedQuote(db, id) {
  const r = db.prepare(`SELECT * FROM received_quotes WHERE id = ?`).get(id);
  if (!r) return null;
  // Marque comme lu
  if (r.statut === 'nouveau') {
    db.prepare(`UPDATE received_quotes SET statut = 'lu' WHERE id = ?`).run(id);
  }
  return { ...r, payload: r.payload ? JSON.parse(r.payload) : null };
}

function setReceivedQuoteStatut(db, id, statut, notes) {
  db.prepare(`UPDATE received_quotes SET statut = ?, notes = ? WHERE id = ?`).run(statut, notes || null, id);
}

function deleteReceivedQuote(db, id) {
  db.prepare(`DELETE FROM received_quotes WHERE id = ?`).run(id);
}

function logSent(db, quoteId, contactId, fileName) {
  db.prepare(`INSERT INTO sent_quotes_log (quote_id, contact_id, sent_at, file_name) VALUES (?, ?, ?, ?)`)
    .run(quoteId, contactId || null, Date.now(), fileName || '');
}

function listSentLog(db, { quoteId } = {}) {
  let sql = `
    SELECT s.*, c.label AS contact_label, c.email AS contact_email
    FROM sent_quotes_log s
    LEFT JOIN contacts c ON c.id = s.contact_id
  `;
  const params = [];
  if (quoteId) { sql += ' WHERE s.quote_id = ?'; params.push(quoteId); }
  sql += ' ORDER BY s.sent_at DESC';
  return db.prepare(sql).all(...params);
}

module.exports = {
  exportQuoteToNdev, importNdev,
  listReceivedQuotes, getReceivedQuote, setReceivedQuoteStatut, deleteReceivedQuote,
  logSent, listSentLog
};
