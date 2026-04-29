// src/compta.js — Module Comptabilité (profil Artisan)
//
// Couvre :
//   - Configuration entreprise (statut, TVA, exercice, méthode chantier)
//   - Écritures comptables (recettes / dépenses)
//   - Situations chantier (factures à l'avancement)
//   - Calculs CA / charges / résultat / marge par chantier
//   - Chantiers en cours (méthode à l'avancement) — crucial pour BTP à cheval sur 2 années
//   - Déclaration TVA (collectée / déductible / à payer)

const etude = require('./etude');

// =========================================================================
// PLAN COMPTABLE BTP SIMPLIFIÉ
// =========================================================================

const COMPTES_RECETTES = [
  { code: '704', label: 'Travaux (prestation principale)' },
  { code: '706', label: 'Prestations de services (étude, conseil)' },
  { code: '707', label: 'Ventes de marchandises (négoce)' },
  { code: '708', label: 'Produits annexes (refacturation)' },
  { code: '791', label: 'Transferts de charges' }
];

const COMPTES_CHARGES = [
  { code: '601', label: 'Achats de matières premières (matériaux)', cat: 'achats' },
  { code: '602', label: 'Achats stockés (autres approvisionnements)', cat: 'achats' },
  { code: '604', label: 'Achats d\'études et prestations', cat: 'achats' },
  { code: '606', label: 'Achats non stockés (fournitures, EPI)', cat: 'achats' },
  { code: '607', label: 'Achats de marchandises', cat: 'achats' },
  { code: '611', label: 'Sous-traitance générale', cat: 'sous-traitance' },
  { code: '613', label: 'Locations (matériel, immobilières)', cat: 'services' },
  { code: '615', label: 'Entretien et réparations', cat: 'services' },
  { code: '616', label: 'Primes d\'assurances', cat: 'services' },
  { code: '622', label: 'Honoraires (comptable, avocat)', cat: 'services' },
  { code: '623', label: 'Publicité, communication', cat: 'services' },
  { code: '624', label: 'Transports', cat: 'transports' },
  { code: '625', label: 'Déplacements et missions (carburant)', cat: 'transports' },
  { code: '626', label: 'Frais postaux et télécoms', cat: 'services' },
  { code: '627', label: 'Services bancaires', cat: 'services' },
  { code: '631', label: 'Impôts et taxes', cat: 'impots' },
  { code: '641', label: 'Rémunérations du personnel', cat: 'personnel' },
  { code: '645', label: 'Charges sociales', cat: 'personnel' },
  { code: '681', label: 'Dotations aux amortissements', cat: 'amort' }
];

function getCompte(code) {
  return COMPTES_RECETTES.find(c => c.code === code) || COMPTES_CHARGES.find(c => c.code === code) || null;
}

// =========================================================================
// CONFIGURATION ENTREPRISE
// =========================================================================

const DEFAULT_CONFIG = {
  raison_sociale: '',
  forme_juridique: 'eurl',          // 'auto', 'ei', 'eurl', 'sarl', 'sas'
  siret: '',
  ape: '',
  adresse: '',
  regime_tva: 'reel_simplifie',     // 'franchise', 'reel_simplifie', 'reel_normal'
  tva_pct_defaut: 8.5,
  exercice_debut_mm: 1,             // mois de début d'exercice (1=janvier, 7=juillet, etc.)
  exercice_debut_jj: 1,             // jour de début
  methode_chantier: 'avancement',   // 'avancement' ou 'achevement'
  numerotation_facture: 'FAC-{annee}-{numero}',
  numerotation_situation: 'SIT-{site}-{numero}'
};

function getConfig(db) {
  try {
    const r = db.prepare(`SELECT value FROM settings WHERE key = 'compta_config'`).get();
    if (r && r.value) return { ...DEFAULT_CONFIG, ...JSON.parse(r.value) };
  } catch (_) {}
  return { ...DEFAULT_CONFIG };
}

function setConfig(db, payload) {
  const merged = { ...DEFAULT_CONFIG, ...payload };
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('compta_config', ?)`).run(JSON.stringify(merged));
  return merged;
}

// Renvoie [debut_ts, fin_ts] de l'exercice qui contient ts
function getExerciceBounds(config, ts) {
  const date = new Date(ts);
  const debutMois = (config.exercice_debut_mm || 1) - 1; // 0-indexed
  const debutJour = config.exercice_debut_jj || 1;
  let annee = date.getFullYear();
  // Si on est avant le début d'exercice de l'année courante, on est dans l'exercice précédent
  const debutCetteAnnee = new Date(annee, debutMois, debutJour).getTime();
  if (ts < debutCetteAnnee) annee = annee - 1;
  const debut = new Date(annee, debutMois, debutJour).getTime();
  const fin = new Date(annee + 1, debutMois, debutJour - 1, 23, 59, 59).getTime();
  return [debut, fin, annee];
}

// =========================================================================
// ÉCRITURES (recettes et dépenses)
// =========================================================================

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
  const tvaM = Math.round(ht * tvaP) / 100;
  const ttc = Math.round((ht + tvaM) * 100) / 100;
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
  const tvaM = Math.round(ht * tvaP) / 100;
  const ttc = Math.round((ht + tvaM) * 100) / 100;
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

// =========================================================================
// SITUATIONS CHANTIER (méthode à l'avancement)
// =========================================================================

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

  // Récupère le montant total du devis lié au chantier
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

  // Calcul du montant période = montant cumulé à ce % - somme des situations précédentes
  const pct = parseFloat(pct_avancement_cumule) || 0;
  const montantCumule = Math.round(montantTotal * pct) / 100;
  const previous = db.prepare(`
    SELECT COALESCE(SUM(montant_ht_periode), 0) AS total
    FROM compta_situations WHERE site_id = ? AND date < ?
  `).get(site_id, date || Date.now());
  const montantPeriode = Math.round((montantCumule - (previous.total || 0)) * 100) / 100;

  const tvaP = parseFloat(tva_pct) || 8.5;
  const tvaM = Math.round(montantPeriode * tvaP) / 100;
  const ttc = Math.round((montantPeriode + tvaM) * 100) / 100;

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

// =========================================================================
// CALCULS — Tableau de bord
// =========================================================================

function computeDashboard(db, { dateMin, dateMax } = {}) {
  // Par défaut : exercice courant
  if (!dateMin || !dateMax) {
    const cfg = getConfig(db);
    const [d, f] = getExerciceBounds(cfg, Date.now());
    dateMin = dateMin || d;
    dateMax = dateMax || f;
  }

  // CA facturé (somme des recettes)
  const recettes = db.prepare(`
    SELECT COALESCE(SUM(montant_ht), 0) AS ht, COALESCE(SUM(montant_tva), 0) AS tva
    FROM compta_ecritures WHERE type = 'recette' AND date >= ? AND date <= ?
  `).get(dateMin, dateMax);

  // Charges
  const charges = db.prepare(`
    SELECT COALESCE(SUM(montant_ht), 0) AS ht, COALESCE(SUM(montant_tva), 0) AS tva
    FROM compta_ecritures WHERE type = 'depense' AND date >= ? AND date <= ?
  `).get(dateMin, dateMax);

  // Charges par catégorie
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

  // CA mensuel (12 derniers mois max)
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
    ca_ht: Math.round(recettes.ht * 100) / 100,
    charges_ht: Math.round(charges.ht * 100) / 100,
    resultat_ht: Math.round((recettes.ht - charges.ht) * 100) / 100,
    marge_pct: recettes.ht > 0 ? Math.round((1 - charges.ht / recettes.ht) * 10000) / 100 : 0,
    tva_collectee: Math.round(recettes.tva * 100) / 100,
    tva_deductible: Math.round(charges.tva * 100) / 100,
    tva_a_payer: Math.round((recettes.tva - charges.tva) * 100) / 100,
    charges_par_categorie: chargesByCategorie,
    monthly
  };
}

// =========================================================================
// CHANTIERS EN COURS — Méthode à l'avancement
// =========================================================================

// Pour chaque chantier non clôturé à dateRef, calcule :
//   - Montant total devis HT (via le devis lié)
//   - % d'avancement physique
//   - CA reconnu = montant × avancement
//   - CA facturé = somme des situations émises jusqu'à dateRef
//   - Stock chantier en cours = CA reconnu - CA facturé
//     (si > 0 : on a fait plus que ce qu'on a facturé → à inscrire au bilan)
//     (si < 0 : on a facturé plus que ce qu'on a fait → produit constaté d'avance)
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
    const caReconnu = Math.round(montantDevis * avancement) / 100;

    const facture = db.prepare(`
      SELECT COALESCE(SUM(montant_ht_periode), 0) AS total
      FROM compta_situations WHERE site_id = ? AND date <= ?
    `).get(site.id, dateRef);
    const caFacture = parseFloat(facture.total) || 0;
    const stock = Math.round((caReconnu - caFacture) * 100) / 100;

    totalReconnu += caReconnu;
    totalFacture += caFacture;
    totalStock += stock;

    lignes.push({
      site_id: site.id,
      site_nom: site.nom,
      quote_titre: site.quote_titre || null,
      statut: site.statut,
      montant_devis: Math.round(montantDevis * 100) / 100,
      avancement_pct: avancement,
      ca_reconnu: caReconnu,
      ca_facture: caFacture,
      stock_en_cours: stock,
      reste_a_facturer: Math.round((montantDevis - caFacture) * 100) / 100
    });
  }

  return {
    date_ref: dateRef,
    total_reconnu: Math.round(totalReconnu * 100) / 100,
    total_facture: Math.round(totalFacture * 100) / 100,
    total_stock: Math.round(totalStock * 100) / 100,
    lignes
  };
}

// Marge par chantier (CA recettes affectées - charges affectées)
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
      ca: Math.round(r.total * 100) / 100,
      charges: Math.round(c.total * 100) / 100,
      marge: Math.round(marge * 100) / 100,
      marge_pct: margePct
    });
  }
  return lignes;
}

// =========================================================================
// EXPORTS
// =========================================================================

module.exports = {
  COMPTES_RECETTES, COMPTES_CHARGES, getCompte,
  DEFAULT_CONFIG, getConfig, setConfig, getExerciceBounds,
  listEcritures, createEcriture, updateEcriture, deleteEcriture,
  listSituations, createSituation, deleteSituation,
  computeDashboard, computeChantiersEnCours, computeMargeChantiers
};
