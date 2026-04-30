// Écritures comptables — recettes et dépenses (CRUD).

const { getCompte } = require('./plan-comptable');
const { round2, calcTVA } = require('./calculs');

function listEcritures(db, { type, site_id, dateMin, dateMax, supplierId } = {}) {
  let sql = `
    SELECT e.*, s.nom AS site_nom, sup.nom AS supplier_nom, q.titre AS quote_titre
    FROM compta_ecritures e
    LEFT JOIN sites s ON s.id = e.site_id
    LEFT JOIN suppliers sup ON sup.id = e.supplier_id
    LEFT JOIN quotes q ON q.id = e.quote_id
    WHERE 1=1
  `;
  const params = [];
  if (type)        { sql += ' AND e.type = ?';        params.push(type); }
  if (site_id)     { sql += ' AND e.site_id = ?';     params.push(site_id); }
  if (supplierId)  { sql += ' AND e.supplier_id = ?'; params.push(supplierId); }
  if (dateMin)     { sql += ' AND e.date >= ?';        params.push(dateMin); }
  if (dateMax)     { sql += ' AND e.date <= ?';        params.push(dateMax); }
  sql += ' ORDER BY e.date DESC, e.id DESC';
  return db.prepare(sql).all(...params);
}

function createEcriture(db, payload) {
  const {
    type, date, libelle, compte_code,
    montant_ht, tva_pct, site_id, quote_id, supplier_id,
    client_nom, ref_facture, date_paiement, mode_paiement, notes
  } = payload;
  const ht = parseFloat(montant_ht) || 0;
  const tvaP = parseFloat(tva_pct) || 0;
  const tvaM = calcTVA(ht, tvaP);
  const ttc = round2(ht + tvaM);
  const compte = getCompte(compte_code);
  const now = Date.now();
  return db.prepare(`
    INSERT INTO compta_ecritures (type, date, libelle, compte_code, compte_label,
      montant_ht, tva_pct, montant_tva, montant_ttc,
      site_id, quote_id, supplier_id, client_nom, ref_facture,
      date_paiement, mode_paiement, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    type, date, libelle, compte_code || null, compte ? compte.label : null,
    ht, tvaP, tvaM, ttc,
    site_id || null, quote_id || null, supplier_id || null,
    client_nom || null, ref_facture || null,
    date_paiement || null, mode_paiement || null, notes || null,
    now, now
  ).lastInsertRowid;
}

function updateEcriture(db, id, payload) {
  const ec = db.prepare('SELECT * FROM compta_ecritures WHERE id = ?').get(id);
  if (!ec) throw new Error('Écriture introuvable');
  const m = { ...ec, ...payload };
  const ht = parseFloat(m.montant_ht) || 0;
  const tvaP = parseFloat(m.tva_pct) || 0;
  const tvaM = calcTVA(ht, tvaP);
  const ttc = round2(ht + tvaM);
  const compte = getCompte(m.compte_code);
  db.prepare(`
    UPDATE compta_ecritures SET
      type=?, date=?, libelle=?, compte_code=?, compte_label=?,
      montant_ht=?, tva_pct=?, montant_tva=?, montant_ttc=?,
      site_id=?, quote_id=?, supplier_id=?, client_nom=?, ref_facture=?,
      date_paiement=?, mode_paiement=?, notes=?, updated_at=?
    WHERE id=?
  `).run(
    m.type, m.date, m.libelle, m.compte_code || null, compte ? compte.label : null,
    ht, tvaP, tvaM, ttc,
    m.site_id || null, m.quote_id || null, m.supplier_id || null,
    m.client_nom || null, m.ref_facture || null,
    m.date_paiement || null, m.mode_paiement || null, m.notes || null,
    Date.now(), id
  );
}

function deleteEcriture(db, id) {
  db.prepare('DELETE FROM compta_ecritures WHERE id = ?').run(id);
}

module.exports = { listEcritures, createEcriture, updateEcriture, deleteEcriture };
