// Suivi chantiers — méthode à l'avancement et marge par chantier.

const etude = require('../etude');
const { getConfig } = require('./config');
const { round2, getExerciceBounds } = require('./calculs');

// Pour chaque chantier non clôturé à dateRef, calcule :
//   - Montant total devis HT (via le devis lié)
//   - % d'avancement physique
//   - CA reconnu = montant × avancement
//   - CA facturé = somme des situations émises jusqu'à dateRef
//   - Stock chantier en cours = CA reconnu - CA facturé
//     (> 0 : à inscrire au bilan ; < 0 : produit constaté d'avance)
function computeChantiersEnCours(db, dateRef) {
  if (!dateRef) dateRef = Date.now();
  const sites = db.prepare(`
    SELECT s.*, q.titre AS quote_titre
    FROM sites s LEFT JOIN quotes q ON q.id = s.quote_id
    WHERE s.statut NOT IN ('archive', 'facture')
  `).all();

  let totalReconnu = 0, totalFacture = 0, totalStock = 0;
  const lignes = [];

  for (const site of sites) {
    let montantDevis = 0;
    if (site.quote_id) {
      try {
        const q = etude.getQuote(db, site.quote_id);
        if (q && q.versions && q.versions.length) {
          const last = q.versions[q.versions.length - 1];
          if (last.totals) montantDevis = last.totals.total_ht;
        }
      } catch (_) {}
    }
    const avancement = parseFloat(site.avancement_pct) || 0;
    const caReconnu = round2(montantDevis * avancement / 100);

    const facture = db.prepare(`
      SELECT COALESCE(SUM(montant_ht_periode), 0) AS total
      FROM compta_situations WHERE site_id = ? AND date <= ?
    `).get(site.id, dateRef);
    const caFacture = parseFloat(facture.total) || 0;
    const stock = round2(caReconnu - caFacture);

    totalReconnu += caReconnu;
    totalFacture += caFacture;
    totalStock += stock;

    lignes.push({
      site_id: site.id,
      site_nom: site.nom,
      quote_titre: site.quote_titre || null,
      statut: site.statut,
      montant_devis: round2(montantDevis),
      avancement_pct: avancement,
      ca_reconnu: caReconnu,
      ca_facture: caFacture,
      stock_en_cours: stock,
      reste_a_facturer: round2(montantDevis - caFacture)
    });
  }

  return {
    date_ref: dateRef,
    total_reconnu: round2(totalReconnu),
    total_facture: round2(totalFacture),
    total_stock: round2(totalStock),
    lignes
  };
}

function computeMargeChantiers(db, { dateMin, dateMax } = {}) {
  if (!dateMin || !dateMax) {
    const cfg = getConfig(db);
    const [d, f] = getExerciceBounds(cfg, Date.now());
    dateMin = dateMin || d;
    dateMax = dateMax || f;
  }
  const sites = db.prepare(`SELECT id, nom, statut FROM sites ORDER BY nom`).all();
  const lignes = [];
  for (const site of sites) {
    const r = db.prepare(`
      SELECT COALESCE(SUM(montant_ht), 0) AS total
      FROM compta_ecritures WHERE site_id = ? AND type = 'recette' AND date >= ? AND date <= ?
    `).get(site.id, dateMin, dateMax);
    const c = db.prepare(`
      SELECT COALESCE(SUM(montant_ht), 0) AS total
      FROM compta_ecritures WHERE site_id = ? AND type = 'depense' AND date >= ? AND date <= ?
    `).get(site.id, dateMin, dateMax);
    if ((r.total || 0) === 0 && (c.total || 0) === 0) continue;
    const marge = (r.total || 0) - (c.total || 0);
    const margePct = r.total > 0 ? Math.round((marge / r.total) * 10000) / 100 : 0;
    lignes.push({
      site_id: site.id,
      site_nom: site.nom,
      statut: site.statut,
      ca: round2(r.total),
      charges: round2(c.total),
      marge: round2(marge),
      marge_pct: margePct
    });
  }
  return lignes;
}

module.exports = { computeChantiersEnCours, computeMargeChantiers };
