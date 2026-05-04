// src/ndev.js — Échange chiffré de devis entre BE et Artisans (.ndev)
//
// La cryptographie ECIES (X25519 + AES-256-GCM) est mutualisée dans
// src/ndev-envelope.js, qui est aussi utilisée par src/quote-response.js
// pour les fichiers .ndev-reply (retour Artisan → BE).

const envelope = require('./ndev-envelope');
const etude = require('./etude');

// Exporte un devis vers une enveloppe .ndev pour un destinataire donné.
function exportQuoteToNdev(db, dek, quoteId, recipientPubB64, options = {}) {
  const q = etude.getQuote(db, quoteId);
  if (!q) throw new Error('Devis introuvable');

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
  const subject = options.subject || `${q.code || '#' + q.id} — ${q.titre || ''}`;
  return envelope.seal(db, dek, payload, recipientPubB64, { subject, payloadKind: 'quote' });
}

// Importe un .ndev reçu : déchiffre et stocke (ou met à jour) dans received_quotes.
function importNdev(db, dek, ndevContent) {
  const { env, payload } = envelope.open(db, dek, ndevContent);
  if (payload.type && payload.type !== 'quote') {
    throw new Error('Ce fichier n\'est pas un devis (type=' + payload.type + ')');
  }

  // Si un devis avec le même code venant du même expéditeur existe déjà, on remplace
  // son payload (qui contient l'historique complet des versions) au lieu d'un doublon.
  // Statut repasse à 'nouveau' pour signaler la révision ; notes internes préservées.
  const now = Date.now();
  if (payload.code && env.from_pub) {
    const candidates = db.prepare(`
      SELECT id, payload FROM received_quotes WHERE sender_pub = ?
    `).all(env.from_pub);
    const existing = candidates.find(c => {
      try { return JSON.parse(c.payload).code === payload.code; }
      catch (_) { return false; }
    });
    if (existing) {
      db.prepare(`
        UPDATE received_quotes
        SET subject = ?, received_at = ?, issued_at = ?, payload = ?, statut = 'nouveau'
        WHERE id = ?
      `).run(env.subject || '', now, env.issued_at || null, JSON.stringify(payload), existing.id);
      return { id: existing.id, subject: env.subject, from: env.from_label, payload, updated: true };
    }
  }

  const id = db.prepare(`
    INSERT INTO received_quotes (sender_label, sender_pub, subject, received_at, issued_at, payload, statut)
    VALUES (?, ?, ?, ?, ?, ?, 'nouveau')
  `).run(
    env.from_label || null,
    env.from_pub || null,
    env.subject || '',
    now,
    env.issued_at || null,
    JSON.stringify(payload)
  ).lastInsertRowid;

  return { id, subject: env.subject, from: env.from_label, payload, updated: false };
}

function listReceivedQuotes(db) {
  return db.prepare(`SELECT * FROM received_quotes ORDER BY received_at DESC`).all().map(r => ({
    ...r,
    payload: r.payload ? JSON.parse(r.payload) : null,
    response_data: r.response_data ? JSON.parse(r.response_data) : null
  }));
}

function getReceivedQuote(db, id) {
  const r = db.prepare(`SELECT * FROM received_quotes WHERE id = ?`).get(id);
  if (!r) return null;
  if (r.statut === 'nouveau') {
    db.prepare(`UPDATE received_quotes SET statut = 'lu' WHERE id = ?`).run(id);
  }
  return {
    ...r,
    payload: r.payload ? JSON.parse(r.payload) : null,
    response_data: r.response_data ? JSON.parse(r.response_data) : null
  };
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
