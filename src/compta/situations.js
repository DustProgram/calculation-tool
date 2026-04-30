// Situations chantier — factures à l'avancement.

const etude = require('../etude');
const { round2, calcTVA } = require('./calculs');

function listSituations(db, site_id) {
  return db.prepare(`
    SELECT * FROM compta_situations WHERE site_id = ? ORDER BY date, id
  `).all(site_id);
}

function createSituation(db, payload) {
  const {
    site_id, numero, date, pct_avancement_cumule, tva_pct, date_paiement, notes
  } = payload;
  if (!site_id) throw new Error('site_id requis');

  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(site_id);
  if (!site) throw new Error('Chantier introuvable');
  let montantTotal = 0;
  if (site.quote_id) {
    const q = etude.getQuote(db, site.quote_id);
    if (q && q.versions.length) {
      const last = q.versions[q.versions.length - 1];
      if (last.totals) montantTotal = last.totals.total_ht;
    }
  }

  // Montant période = montant cumulé à ce % - somme des situations précédentes.
  const pct = parseFloat(pct_avancement_cumule) || 0;
  const montantCumule = round2(montantTotal * pct / 100);
  const previous = db.prepare(`
    SELECT COALESCE(SUM(montant_ht_periode), 0) AS total
    FROM compta_situations WHERE site_id = ? AND date < ?
  `).get(site_id, date || Date.now());
  const montantPeriode = round2(montantCumule - (previous.total || 0));

  const tvaP = parseFloat(tva_pct) || 20;
  const tvaM = calcTVA(montantPeriode, tvaP);
  const ttc = round2(montantPeriode + tvaM);

  return db.prepare(`
    INSERT INTO compta_situations (site_id, numero, date, pct_avancement_cumule,
                                    montant_ht_periode, tva_pct, montant_ttc_periode,
                                    date_paiement, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    site_id, numero || null, date || Date.now(), pct,
    montantPeriode, tvaP, ttc,
    date_paiement || null, notes || null, Date.now()
  ).lastInsertRowid;
}

function deleteSituation(db, id) {
  db.prepare('DELETE FROM compta_situations WHERE id = ?').run(id);
}

module.exports = { listSituations, createSituation, deleteSituation };
