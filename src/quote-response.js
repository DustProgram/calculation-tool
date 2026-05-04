// src/quote-response.js — Réponse annotée de l'Artisan au BE (.ndev-reply)
//
// Côté Artisan :
//   - saveDraftResponse : enregistre les annotations dans received_quotes.response_data
//   - getDraftResponse  : relit le brouillon courant
//   - exportResponse    : produit l'enveloppe .ndev-reply chiffrée pour le BE
//
// Côté BE :
//   - importResponse              : déchiffre et stocke dans quote_responses_received
//   - listReceivedResponses       : liste pour la UI
//   - getReceivedResponse         : détail (passe le statut à 'lu')
//   - setReceivedResponseStatut   : met à jour statut + notes BE
//   - deleteReceivedResponse      : supprime
//   - integrateResponseIntoQuote  : crée une nouvelle version du devis BE incluant les
//                                   lignes proposées par l'artisan (et marque la réponse
//                                   comme traitée).

const envelope = require('./ndev-envelope');
const etude = require('./etude');

// 20 Mo de pièces jointes cumulées max (raw, avant base64).
const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024;

// Forme attendue de response_data :
// {
//   version_target: 3,
//   remarques_lignes: { "p:42": "...", "l:designation": "..." },
//   lignes_ajoutees:  [ { designation, quantite, unite, prix_propose|null, remarque } ],
//   remarque_globale: "...",
//   attachments:      [ { name, size, mime, data_b64 } ]
// }

function _validateAttachmentsBudget(attachments) {
  const total = (attachments || []).reduce((s, a) => s + (parseInt(a.size, 10) || 0), 0);
  if (total > MAX_ATTACHMENTS_BYTES) {
    throw new Error(`Pièces jointes trop volumineuses : ${(total / 1024 / 1024).toFixed(1)} Mo (max ${MAX_ATTACHMENTS_BYTES / 1024 / 1024} Mo)`);
  }
}

function _normalizeResponseData(data) {
  return {
    version_target: data && data.version_target != null ? data.version_target : null,
    remarques_lignes: (data && data.remarques_lignes) || {},
    lignes_ajoutees: Array.isArray(data && data.lignes_ajoutees) ? data.lignes_ajoutees : [],
    remarque_globale: (data && data.remarque_globale) || '',
    attachments: Array.isArray(data && data.attachments) ? data.attachments : []
  };
}

// =========================================================================
// CÔTÉ ARTISAN — Brouillon de réponse + export chiffré
// =========================================================================

function saveDraftResponse(db, receivedId, data) {
  const r = db.prepare('SELECT id FROM received_quotes WHERE id = ?').get(receivedId);
  if (!r) throw new Error('Devis reçu introuvable');
  const norm = _normalizeResponseData(data);
  _validateAttachmentsBudget(norm.attachments);
  db.prepare('UPDATE received_quotes SET response_data = ? WHERE id = ?')
    .run(JSON.stringify(norm), receivedId);
  return norm;
}

function getDraftResponse(db, receivedId) {
  const r = db.prepare('SELECT response_data FROM received_quotes WHERE id = ?').get(receivedId);
  if (!r || !r.response_data) return _normalizeResponseData(null);
  try { return _normalizeResponseData(JSON.parse(r.response_data)); }
  catch (_) { return _normalizeResponseData(null); }
}

function exportResponse(db, dek, receivedId) {
  const rq = db.prepare('SELECT * FROM received_quotes WHERE id = ?').get(receivedId);
  if (!rq) throw new Error('Devis reçu introuvable');
  if (!rq.sender_pub) throw new Error('Clé publique du BE inconnue — impossible de chiffrer la réponse');

  const incoming = rq.payload ? JSON.parse(rq.payload) : {};
  const draft = rq.response_data ? _normalizeResponseData(JSON.parse(rq.response_data)) : _normalizeResponseData(null);
  _validateAttachmentsBudget(draft.attachments);

  const payload = {
    type: 'quote-response',
    original_code: incoming.code || null,
    original_subject: rq.subject || '',
    version_target: draft.version_target,
    remarques_lignes: draft.remarques_lignes,
    lignes_ajoutees: draft.lignes_ajoutees,
    remarque_globale: draft.remarque_globale,
    attachments: draft.attachments
  };

  const subject = `Réponse — ${incoming.code ? incoming.code + ' — ' : ''}${incoming.titre || rq.subject || ''}`;
  return envelope.seal(db, dek, payload, rq.sender_pub, {
    subject,
    payloadKind: 'quote-response',
    salt: 'nuclear-estim-ndev-reply-v1'
  });
}

// =========================================================================
// CÔTÉ BE — Import + consultation + intégration au devis
// =========================================================================

function importResponse(db, dek, content) {
  const { env, payload } = envelope.open(db, dek, content, { salt: 'nuclear-estim-ndev-reply-v1' });
  if (payload.type !== 'quote-response') {
    throw new Error('Ce fichier n\'est pas une réponse de devis (type=' + payload.type + ')');
  }

  // Tentative de résolution locale : devis BE par code (les codes sont typiquement uniques côté BE).
  let quoteId = null;
  if (payload.original_code) {
    const q = db.prepare('SELECT id FROM quotes WHERE code = ?').get(payload.original_code);
    if (q) quoteId = q.id;
  }

  const id = db.prepare(`
    INSERT INTO quote_responses_received
      (sender_label, sender_pub, subject, received_at, issued_at, original_code, quote_id, payload, statut)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'nouveau')
  `).run(
    env.from_label || null,
    env.from_pub || null,
    env.subject || '',
    Date.now(),
    env.issued_at || null,
    payload.original_code || null,
    quoteId,
    JSON.stringify(payload)
  ).lastInsertRowid;

  return { id, subject: env.subject, from: env.from_label, payload, quote_id: quoteId };
}

function listReceivedResponses(db) {
  return db.prepare(`
    SELECT r.*, q.titre AS quote_titre, q.code AS quote_code
    FROM quote_responses_received r
    LEFT JOIN quotes q ON q.id = r.quote_id
    ORDER BY r.received_at DESC
  `).all().map(r => ({
    ...r,
    payload: r.payload ? JSON.parse(r.payload) : null
  }));
}

function getReceivedResponse(db, id) {
  const r = db.prepare(`
    SELECT r.*, q.titre AS quote_titre, q.code AS quote_code
    FROM quote_responses_received r
    LEFT JOIN quotes q ON q.id = r.quote_id
    WHERE r.id = ?
  `).get(id);
  if (!r) return null;
  if (r.statut === 'nouveau') {
    db.prepare(`UPDATE quote_responses_received SET statut = 'lu' WHERE id = ?`).run(id);
  }
  return { ...r, payload: r.payload ? JSON.parse(r.payload) : null };
}

function setReceivedResponseStatut(db, id, statut, notes) {
  db.prepare('UPDATE quote_responses_received SET statut = ?, notes = ? WHERE id = ?')
    .run(statut, notes || null, id);
}

function deleteReceivedResponse(db, id) {
  db.prepare('DELETE FROM quote_responses_received WHERE id = ?').run(id);
}

// Intègre les lignes proposées par l'artisan dans une nouvelle version du devis BE.
// Logique :
//   - Récupère la dernière version du devis lié (par quote_id, sinon par code)
//   - Ajoute les lignes_ajoutees comme nouvelles lignes (prix_propose -> prixUnitaire si renseigné, sinon 0 = à chiffrer)
//   - Crée une nouvelle version
//   - Marque la réponse comme 'traite'
function integrateResponseIntoQuote(db, responseId) {
  const r = db.prepare('SELECT * FROM quote_responses_received WHERE id = ?').get(responseId);
  if (!r) throw new Error('Réponse introuvable');
  const payload = r.payload ? JSON.parse(r.payload) : null;
  if (!payload) throw new Error('Payload de réponse vide');

  let quoteId = r.quote_id;
  if (!quoteId && payload.original_code) {
    const q = db.prepare('SELECT id FROM quotes WHERE code = ?').get(payload.original_code);
    if (q) quoteId = q.id;
  }
  if (!quoteId) throw new Error('Devis BE introuvable (code ' + (payload.original_code || '?') + '). Crée le devis d\'abord ou lie-le manuellement.');

  const quote = etude.getQuote(db, quoteId);
  if (!quote) throw new Error('Devis introuvable');
  const lastVersion = quote.versions && quote.versions.length ? quote.versions[quote.versions.length - 1] : null;
  const baseLignes = (lastVersion && lastVersion.snapshot && lastVersion.snapshot.lignes) || [];

  const proposedLines = (payload.lignes_ajoutees || []).map(l => ({
    designation: l.designation || '',
    unite: l.unite || '',
    quantite: parseFloat(l.quantite) || 0,
    prixUnitaire: l.prix_propose != null ? (parseFloat(l.prix_propose) || 0) : 0,
    _from_artisan: true,
    _artisan_remarque: l.remarque || ''
  }));

  const newLignes = baseLignes.concat(proposedLines);
  const newVersion = etude.addQuoteVersion(db, quoteId, newLignes);

  setReceivedResponseStatut(db, responseId, 'traite', r.notes);
  return { quote_id: quoteId, new_version: newVersion, added_lines: proposedLines.length };
}

module.exports = {
  MAX_ATTACHMENTS_BYTES,
  // Artisan
  saveDraftResponse, getDraftResponse, exportResponse,
  // BE
  importResponse, listReceivedResponses, getReceivedResponse,
  setReceivedResponseStatut, deleteReceivedResponse, integrateResponseIntoQuote
};
