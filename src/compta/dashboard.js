// Tableau de bord — agrégations CA / charges / résultat / TVA sur une période.

const { COMPTES_CHARGES } = require('./plan-comptable');
const { getConfig } = require('./config');
const { round2, getExerciceBounds } = require('./calculs');

function computeDashboard(db, { dateMin, dateMax } = {}) {
  if (!dateMin || !dateMax) {
    const cfg = getConfig(db);
    const [d, f] = getExerciceBounds(cfg, Date.now());
    dateMin = dateMin || d;
    dateMax = dateMax || f;
  }

  const recettes = db.prepare(`
    SELECT COALESCE(SUM(montant_ht), 0) AS ht, COALESCE(SUM(montant_tva), 0) AS tva
    FROM compta_ecritures WHERE type = 'recette' AND date >= ? AND date <= ?
  `).get(dateMin, dateMax);

  const charges = db.prepare(`
    SELECT COALESCE(SUM(montant_ht), 0) AS ht, COALESCE(SUM(montant_tva), 0) AS tva
    FROM compta_ecritures WHERE type = 'depense' AND date >= ? AND date <= ?
  `).get(dateMin, dateMax);

  const chargesByCategorie = {};
  COMPTES_CHARGES.forEach(c => { chargesByCategorie[c.cat] = chargesByCategorie[c.cat] || 0; });
  const rowsCh = db.prepare(`
    SELECT compte_code, SUM(montant_ht) AS total
    FROM compta_ecritures WHERE type = 'depense' AND date >= ? AND date <= ?
    GROUP BY compte_code
  `).all(dateMin, dateMax);
  rowsCh.forEach(r => {
    const c = COMPTES_CHARGES.find(x => x.code === r.compte_code);
    if (c) chargesByCategorie[c.cat] = (chargesByCategorie[c.cat] || 0) + r.total;
  });

  const monthly = [];
  let cur = new Date(dateMin);
  cur.setDate(1); cur.setHours(0, 0, 0, 0);
  const end = new Date(dateMax);
  while (cur <= end) {
    const monthStart = cur.getTime();
    const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1).getTime();
    const r = db.prepare(`
      SELECT COALESCE(SUM(montant_ht), 0) AS recettes
      FROM compta_ecritures WHERE type = 'recette' AND date >= ? AND date < ?
    `).get(monthStart, next);
    const c = db.prepare(`
      SELECT COALESCE(SUM(montant_ht), 0) AS charges
      FROM compta_ecritures WHERE type = 'depense' AND date >= ? AND date < ?
    `).get(monthStart, next);
    monthly.push({
      mois: cur.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
      recettes: r.recettes,
      charges: c.charges,
      resultat: r.recettes - c.charges
    });
    cur = new Date(next);
  }

  return {
    periode: { debut: dateMin, fin: dateMax },
    ca_ht: round2(recettes.ht),
    charges_ht: round2(charges.ht),
    resultat_ht: round2(recettes.ht - charges.ht),
    marge_pct: recettes.ht > 0 ? Math.round((1 - charges.ht / recettes.ht) * 10000) / 100 : 0,
    tva_collectee: round2(recettes.tva),
    tva_deductible: round2(charges.tva),
    tva_a_payer: round2(recettes.tva - charges.tva),
    charges_par_categorie: chargesByCategorie,
    monthly
  };
}

module.exports = { computeDashboard };
