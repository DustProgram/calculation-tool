// src/artisan.js — Logique métier du module Artisan (Phase 2)
//
// Modules :
//   - KPV global et par lot (paramètres de marge)
//   - Matériel amorti (PARTAGÉ avec le profil Étude)
//   - Fournisseurs et leurs prix
//   - Déplacements / logistique
//   - Suivi de chantier
//
// Toutes les fonctions prennent une userDb en argument et opèrent dessus.

// =========================================================================
// KPV — Paramètres globaux et overrides par lot
// =========================================================================

const DEFAULT_KPV = {
  frais_chantier_pct: 0,
  frais_operation_pct: 0,
  frais_generaux_pct: 0,
  benefice_pct: 0,
  aleas_pct: 0,
  mode_calcul: 'btp' // 'btp' (officiel cascade), 'additif' ou 'multiplicatif'
};

function getKpvGlobal(db) {
  try {
    const r = db.prepare(`SELECT value FROM settings WHERE key = 'kpv_global'`).get();
    if (r && r.value) {
      return { ...DEFAULT_KPV, ...JSON.parse(r.value) };
    }
  } catch (_) {}
  return { ...DEFAULT_KPV };
}

function setKpvGlobal(db, params) {
  const merged = { ...DEFAULT_KPV, ...params };
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('kpv_global', ?)`).run(JSON.stringify(merged));
  return merged;
}

function getKpvForLot(db, lotId) {
  try {
    const r = db.prepare(`SELECT value FROM settings WHERE key = ?`).get('kpv_lot_' + lotId);
    if (r && r.value) {
      return { ...JSON.parse(r.value), is_override: true };
    }
  } catch (_) {}
  return { ...getKpvGlobal(db), is_override: false };
}

function setKpvForLot(db, lotId, params) {
  if (!params) {
    db.prepare(`DELETE FROM settings WHERE key = ?`).run('kpv_lot_' + lotId);
    return null;
  }
  const merged = { ...DEFAULT_KPV, ...params };
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run('kpv_lot_' + lotId, JSON.stringify(merged));
  return merged;
}

// Calcule le coefficient KPV final à partir des paramètres
// 3 modes :
//   - 'btp' (officiel BTP) : cascade DS → DT → CR → PV avec B = b/(1-b) × CR
//                            (bénéfice exprimé en % du PRIX DE VENTE final)
//   - 'multiplicatif'      : (1+fc)(1+fg)(1+b) avec B en % du déboursé
//   - 'additif' (défaut)   : 1 + (somme des %) — simple/rapide mais imprécis
function computeKpvCoef(params) {
  const p = { ...DEFAULT_KPV, ...(params || {}) };
  const fc = parseFloat(p.frais_chantier_pct) || 0;
  const fo = parseFloat(p.frais_operation_pct) || 0;
  const fg = parseFloat(p.frais_generaux_pct) || 0;
  const b  = parseFloat(p.benefice_pct) || 0;
  const a  = parseFloat(p.aleas_pct) || 0;

  if (p.mode_calcul === 'btp') {
    // Méthode BTP officielle (cascade) :
    //   DT = DS × (1 + (fc + aleas) / 100)            — frais chantier + aléas sur DS
    //   CR = DT × (1 + (fo + fg) / 100)               — frais opération + frais généraux sur DT
    //   PV = CR / (1 - b/100)                          — bénéfice en % du PV
    const dtCoef = 1 + (fc + a) / 100;
    const crCoef = dtCoef * (1 + (fo + fg) / 100);
    const bClamp = Math.min(99.99, Math.max(0, b)); // garde-fou : pas de division par 0
    return crCoef / (1 - bClamp / 100);
  }

  if (p.mode_calcul === 'multiplicatif') {
    return (1 + fc / 100) * (1 + fo / 100) * (1 + fg / 100) * (1 + b / 100) * (1 + a / 100);
  }

  // Mode additif (défaut)
  return 1 + (fc + fo + fg + b + a) / 100;
}

// Breakdown détaillé du calcul KPV pour affichage (style tableau BTP standard).
// Retourne un tableau de lignes {label, abbr, valeur, formule} pour un déboursé sec donné.
function explainKpv(params, ds = 1000) {
  const p = { ...DEFAULT_KPV, ...(params || {}) };
  const fc = parseFloat(p.frais_chantier_pct) || 0;
  const fo = parseFloat(p.frais_operation_pct) || 0;
  const fg = parseFloat(p.frais_generaux_pct) || 0;
  const b  = parseFloat(p.benefice_pct) || 0;
  const a  = parseFloat(p.aleas_pct) || 0;

  if (p.mode_calcul === 'btp') {
    const fcMontant = ds * (fc + a) / 100;
    const dt = ds + fcMontant;
    const fgMontant = dt * (fo + fg) / 100;
    const cr = dt + fgMontant;
    const bClamp = Math.min(99.99, Math.max(0, b));
    const bMontant = cr * (bClamp / (100 - bClamp));
    const pv = cr + bMontant;
    return [
      { label: 'Déboursé sec',                abbr: 'DS',           valeur: ds,        formule: 'point de départ' },
      { label: `Frais chantier (${fc}%) + Aléas (${a}%)`, abbr: 'FC',  valeur: fcMontant, formule: `DS × ${(fc + a).toFixed(1)}%` },
      { label: 'Déboursés totaux',            abbr: 'DT = DS + FC', valeur: dt,        formule: '' },
      { label: `Frais opération (${fo}%) + Frais généraux (${fg}%)`, abbr: 'FG', valeur: fgMontant, formule: `DT × ${(fo + fg).toFixed(1)}%` },
      { label: 'Coût de revient',             abbr: 'CR = DT + FG', valeur: cr,        formule: '' },
      { label: `Bénéfice (${b}% du PV)`,       abbr: 'B',            valeur: bMontant,  formule: `CR × ${b.toFixed(1)}/(100 − ${b.toFixed(1)})` },
      { label: 'Prix de vente HT',            abbr: 'PV = CR + B',  valeur: pv,        formule: '', highlight: true }
    ];
  }

  // Modes additif et multiplicatif : breakdown plus simple
  const coef = computeKpvCoef(p);
  const pv = ds * coef;
  return [
    { label: 'Déboursé sec',     abbr: 'DS', valeur: ds, formule: 'point de départ' },
    { label: 'Marge totale',     abbr: 'M',  valeur: pv - ds, formule: `DS × ${((coef - 1) * 100).toFixed(2)}%` },
    { label: 'Prix de vente HT', abbr: 'PV', valeur: pv, formule: `DS × ${coef.toFixed(4)}`, highlight: true }
  ];
}

function listKpvAll(db) {
  const lots = db.prepare('SELECT id, code, nom, couleur FROM lots ORDER BY ordre, nom').all();
  const global = getKpvGlobal(db);
  const lotsKpv = lots.map(l => {
    const k = getKpvForLot(db, l.id);
    return { lot: l, kpv: k, coef: computeKpvCoef(k) };
  });
  return { global, global_coef: computeKpvCoef(global), lots: lotsKpv };
}

// =========================================================================
// MATÉRIEL AMORTI (table equipment, PARTAGÉ avec Étude)
// =========================================================================

// Recalcule le prix_unitaire d'amortissement
function computeEquipmentPrice(eq) {
  const prix = parseFloat(eq.prix_achat) || 0;
  const annees = parseFloat(eq.duree_amort_annees) || 1;
  const usage = parseFloat(eq.usage_par_an) || 1;
  const frais = parseFloat(eq.frais_pct) || 0;
  if (annees <= 0 || usage <= 0) return 0;
  return Math.round((prix * (1 + frais / 100)) / (annees * usage) * 100) / 100;
}

function listEquipment(db, { search } = {}) {
  let sql = 'SELECT * FROM equipment WHERE 1=1';
  const params = [];
  if (search) {
    sql += ' AND (nom LIKE ? OR categorie LIKE ?)';
    const like = '%' + search + '%';
    params.push(like, like);
  }
  sql += ' ORDER BY nom';
  return db.prepare(sql).all(...params);
}

function getEquipment(db, id) {
  return db.prepare('SELECT * FROM equipment WHERE id = ?').get(id);
}

function createEquipment(db, payload) {
  const {
    nom, categorie, prix_achat, duree_amort_annees, usage_par_an,
    unite_usage, frais_pct, notes
  } = payload;
  const prix_unitaire = computeEquipmentPrice(payload);
  const now = Date.now();
  return db.prepare(`
    INSERT INTO equipment (nom, categorie, prix_achat, duree_amort_annees, usage_par_an,
                           unite_usage, frais_pct, prix_unitaire, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    nom, categorie || null,
    parseFloat(prix_achat) || 0,
    parseFloat(duree_amort_annees) || 5,
    parseFloat(usage_par_an) || 800,
    unite_usage || 'h',
    parseFloat(frais_pct) || 0,
    prix_unitaire,
    notes || null,
    now, now
  ).lastInsertRowid;
}

function updateEquipment(db, id, payload) {
  const {
    nom, categorie, prix_achat, duree_amort_annees, usage_par_an,
    unite_usage, frais_pct, notes
  } = payload;
  const prix_unitaire = computeEquipmentPrice(payload);
  db.prepare(`
    UPDATE equipment SET nom=?, categorie=?, prix_achat=?, duree_amort_annees=?,
                          usage_par_an=?, unite_usage=?, frais_pct=?, prix_unitaire=?,
                          notes=?, updated_at=?
    WHERE id=?
  `).run(
    nom, categorie || null,
    parseFloat(prix_achat) || 0,
    parseFloat(duree_amort_annees) || 5,
    parseFloat(usage_par_an) || 800,
    unite_usage || 'h',
    parseFloat(frais_pct) || 0,
    prix_unitaire,
    notes || null,
    Date.now(),
    id
  );
  return prix_unitaire;
}

function deleteEquipment(db, id) {
  db.prepare('DELETE FROM equipment WHERE id = ?').run(id);
}

// =========================================================================
// FOURNISSEURS
// =========================================================================

function listSuppliers(db) {
  return db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM supplier_prices sp WHERE sp.supplier_id = s.id) AS nb_prix
    FROM suppliers s ORDER BY s.nom
  `).all();
}

function getSupplier(db, id) {
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  if (!s) return null;
  s.prix = db.prepare('SELECT * FROM supplier_prices WHERE supplier_id = ? ORDER BY designation').all(id);
  return s;
}

function createSupplier(db, { nom, contact, telephone, email, adresse, notes }) {
  return db.prepare(`
    INSERT INTO suppliers (nom, contact, telephone, email, adresse, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(nom, contact || null, telephone || null, email || null, adresse || null, notes || null, Date.now()).lastInsertRowid;
}

function updateSupplier(db, id, { nom, contact, telephone, email, adresse, notes }) {
  db.prepare(`
    UPDATE suppliers SET nom=?, contact=?, telephone=?, email=?, adresse=?, notes=? WHERE id=?
  `).run(nom, contact || null, telephone || null, email || null, adresse || null, notes || null, id);
}

function deleteSupplier(db, id) {
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
}

function addSupplierPrice(db, supplierId, { designation, reference, unite, prix, notes }) {
  return db.prepare(`
    INSERT INTO supplier_prices (supplier_id, designation, reference, unite, prix, notes, date_prix)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(supplierId, designation, reference || null, unite || null, parseFloat(prix) || 0, notes || null, Date.now()).lastInsertRowid;
}

function updateSupplierPrice(db, id, { designation, reference, unite, prix, notes }) {
  db.prepare(`
    UPDATE supplier_prices SET designation=?, reference=?, unite=?, prix=?, notes=? WHERE id=?
  `).run(designation, reference || null, unite || null, parseFloat(prix) || 0, notes || null, id);
}

function deleteSupplierPrice(db, id) {
  db.prepare('DELETE FROM supplier_prices WHERE id = ?').run(id);
}

// =========================================================================
// LOGISTIQUE / DÉPLACEMENTS
// =========================================================================

const DEFAULT_LOGISTIC = {
  prix_carburant_litre: 1.85,
  conso_l_100km: 8,
  // Conservés pour compatibilité (utilisés comme valeurs par défaut quand un chantier
  // n'a pas encore renseigné distance/nb_trajets)
  distance_aller_km: 20,
  nb_trajets_jour: 2
};

function getLogistic(db) {
  try {
    const r = db.prepare(`SELECT value FROM settings WHERE key = 'logistic'`).get();
    if (r && r.value) return { ...DEFAULT_LOGISTIC, ...JSON.parse(r.value) };
  } catch (_) {}
  return { ...DEFAULT_LOGISTIC };
}

function setLogistic(db, params) {
  const merged = { ...DEFAULT_LOGISTIC, ...params };
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('logistic', ?)`).run(JSON.stringify(merged));
  return merged;
}

// Coût quotidien de déplacement GLOBAL (utilise les défauts)
function computeLogisticCost(params) {
  const p = { ...DEFAULT_LOGISTIC, ...(params || {}) };
  return computeSiteLogisticCost(
    parseFloat(p.distance_aller_km) || 0,
    parseFloat(p.nb_trajets_jour) || 0,
    p
  );
}

// Coût quotidien de déplacement POUR UN CHANTIER donné (distance et trajets propres)
function computeSiteLogisticCost(distanceKm, nbTrajets, vehiculeParams) {
  const p = { ...DEFAULT_LOGISTIC, ...(vehiculeParams || {}) };
  const dist = parseFloat(distanceKm) || 0;
  const nb = parseFloat(nbTrajets) || 0;
  const km_par_jour = dist * 2 * nb; // aller-retour × nb trajets
  const litres = km_par_jour * (parseFloat(p.conso_l_100km) || 0) / 100;
  const carburant = litres * (parseFloat(p.prix_carburant_litre) || 0);
  return {
    km_par_jour: Math.round(km_par_jour * 10) / 10,
    litres_par_jour: Math.round(litres * 100) / 100,
    cout_carburant_jour: Math.round(carburant * 100) / 100,
    cout_total_jour: Math.round(carburant * 100) / 100
  };
}

// =========================================================================
// SUIVI CHANTIER
// =========================================================================

const SITE_STATUTS = ['a_demarrer', 'en_cours', 'pause', 'termine', 'facture', 'archive'];

function listSites(db, { statut } = {}) {
  let sql = `
    SELECT s.*, q.titre AS quote_titre, q.code AS quote_code
    FROM sites s
    LEFT JOIN quotes q ON q.id = s.quote_id
    WHERE 1=1
  `;
  const params = [];
  if (statut) { sql += ' AND s.statut = ?'; params.push(statut); }
  sql += ' ORDER BY s.updated_at DESC';
  const rows = db.prepare(sql).all(...params);
  // Enrichit chaque chantier avec son coût de déplacement calculé
  const veh = getLogistic(db);
  rows.forEach(s => {
    s.cout_dep = computeSiteLogisticCost(s.distance_km || 0, s.nb_trajets_jour || 2, veh);
    s.cout_dep_total = Math.round(s.cout_dep.cout_total_jour * (parseFloat(s.nb_jours_estim) || 0) * 100) / 100;
  });
  return rows;
}

function getSite(db, id) {
  const s = db.prepare(`
    SELECT s.*, q.titre AS quote_titre, q.code AS quote_code
    FROM sites s LEFT JOIN quotes q ON q.id = s.quote_id
    WHERE s.id = ?
  `).get(id);
  if (s) {
    const veh = getLogistic(db);
    s.cout_dep = computeSiteLogisticCost(s.distance_km || 0, s.nb_trajets_jour || 2, veh);
    s.cout_dep_total = Math.round(s.cout_dep.cout_total_jour * (parseFloat(s.nb_jours_estim) || 0) * 100) / 100;
  }
  return s;
}

function createSite(db, payload) {
  const {
    nom, adresse, quote_id, statut, date_debut, date_fin_prev, notes,
    distance_km, nb_trajets_jour, nb_jours_estim
  } = payload;
  const now = Date.now();
  return db.prepare(`
    INSERT INTO sites (nom, adresse, quote_id, statut, avancement_pct, date_debut, date_fin_prev,
                       notes, distance_km, nb_trajets_jour, nb_jours_estim, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    nom, adresse || null, quote_id || null,
    statut || 'a_demarrer',
    date_debut || null, date_fin_prev || null,
    notes || null,
    parseFloat(distance_km) || 0,
    parseFloat(nb_trajets_jour) || 2,
    parseFloat(nb_jours_estim) || 0,
    now, now
  ).lastInsertRowid;
}

function updateSite(db, id, payload) {
  const fields = [], params = [];
  const allowed = ['nom', 'adresse', 'quote_id', 'statut', 'avancement_pct', 'date_debut',
                   'date_fin_prev', 'notes', 'distance_km', 'nb_trajets_jour', 'nb_jours_estim'];
  allowed.forEach(k => {
    if (payload[k] !== undefined) {
      fields.push(`${k} = ?`);
      let val = payload[k];
      if (['avancement_pct', 'distance_km', 'nb_trajets_jour', 'nb_jours_estim'].includes(k)) {
        val = parseFloat(val) || 0;
      } else if (['quote_id', 'date_debut', 'date_fin_prev'].includes(k)) {
        val = val || null;
      } else if (typeof val === 'string') {
        val = val.trim() || null;
      }
      params.push(val);
    }
  });
  if (!fields.length) return;
  fields.push('updated_at = ?');
  params.push(Date.now(), id);
  db.prepare(`UPDATE sites SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

function deleteSite(db, id) {
  db.prepare('DELETE FROM sites WHERE id = ?').run(id);
}

// =========================================================================
// EXPORTS
// =========================================================================

module.exports = {
  // KPV
  DEFAULT_KPV, getKpvGlobal, setKpvGlobal, getKpvForLot, setKpvForLot,
  computeKpvCoef, explainKpv, listKpvAll,
  // Equipment
  listEquipment, getEquipment, createEquipment, updateEquipment, deleteEquipment,
  computeEquipmentPrice,
  // Suppliers
  listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier,
  addSupplierPrice, updateSupplierPrice, deleteSupplierPrice,
  // Logistic
  DEFAULT_LOGISTIC, getLogistic, setLogistic, computeLogisticCost, computeSiteLogisticCost,
  // Sites
  SITE_STATUTS, listSites, getSite, createSite, updateSite, deleteSite
};
