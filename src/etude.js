// src/etude.js — Logique métier du module Étude de prix
//
// Ce module expose des fonctions pures qui prennent en argument la userDb
// et opèrent dessus. Il est appelé depuis main.js via les handlers IPC.

// =========================================================================
// LOTS
// =========================================================================

function listLots(db) {
  return db.prepare('SELECT * FROM lots ORDER BY ordre, nom').all();
}

function createLot(db, { code, nom, couleur, ordre }) {
  const info = db.prepare(`
    INSERT INTO lots (code, nom, couleur, ordre) VALUES (?, ?, ?, ?)
  `).run(code || null, nom, couleur || '#5b8def', ordre || 0);
  return info.lastInsertRowid;
}

function updateLot(db, id, { code, nom, couleur, ordre }) {
  db.prepare('UPDATE lots SET code = ?, nom = ?, couleur = ?, ordre = ? WHERE id = ?')
    .run(code || null, nom, couleur || '#5b8def', ordre || 0, id);
}

function deleteLot(db, id) {
  // Les prix qui référencent ce lot voient leur lot_id mis à NULL (FK ON DELETE SET NULL)
  db.prepare('DELETE FROM lots WHERE id = ?').run(id);
}

// =========================================================================
// PRIX (BASE DE PRIX)
// =========================================================================

function listPrices(db, { search, lotId, limit, offset } = {}) {
  let sql = `
    SELECT p.*, l.nom AS lot_nom, l.couleur AS lot_couleur, l.code AS lot_code
    FROM prices p LEFT JOIN lots l ON l.id = p.lot_id
    WHERE 1=1
  `;
  const params = [];
  if (search) {
    sql += ' AND (p.designation LIKE ? OR p.repere LIKE ? OR p.projet LIKE ?)';
    const like = '%' + search + '%';
    params.push(like, like, like);
  }
  if (lotId === null) {
    sql += ' AND p.lot_id IS NULL';
  } else if (lotId !== undefined && lotId !== '') {
    sql += ' AND p.lot_id = ?';
    params.push(lotId);
  }
  sql += ' ORDER BY l.ordre, p.repere, p.designation';
  if (limit) {
    sql += ' LIMIT ' + parseInt(limit, 10);
    if (offset) sql += ' OFFSET ' + parseInt(offset, 10);
  }
  return db.prepare(sql).all(...params);
}

function countPrices(db) {
  const r = db.prepare('SELECT COUNT(*) AS n FROM prices').get();
  return r ? r.n : 0;
}

function createPrice(db, { repere, lotId, designation, unite, prix, datePrix, projet, source }) {
  const info = db.prepare(`
    INSERT INTO prices (repere, lot_id, designation, unite, prix, date_prix, projet, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(repere || null, lotId || null, designation, unite || null, parseFloat(prix) || 0,
         datePrix || null, projet || null, source || 'manuel', Date.now());
  return info.lastInsertRowid;
}

function updatePrice(db, id, { repere, lotId, designation, unite, prix, datePrix, projet }) {
  db.prepare(`
    UPDATE prices SET repere = ?, lot_id = ?, designation = ?, unite = ?, prix = ?, date_prix = ?, projet = ?
    WHERE id = ?
  `).run(repere || null, lotId || null, designation, unite || null, parseFloat(prix) || 0,
         datePrix || null, projet || null, id);
}

function deletePrice(db, id) {
  db.prepare('DELETE FROM prices WHERE id = ?').run(id);
}

function deletePricesAll(db) {
  db.prepare('DELETE FROM prices').run();
}

// Import en masse depuis un tableau d'objets {repere?, lot_code?, designation, unite?, prix, date_prix?, projet?}
function bulkImportPrices(db, rows, { sourceLabel = 'import excel' } = {}) {
  // Map des lots existants par code
  const lots = listLots(db);
  const byCode = {};
  const byNom = {};
  lots.forEach(l => {
    if (l.code) byCode[String(l.code).toLowerCase()] = l.id;
    byNom[String(l.nom).toLowerCase()] = l.id;
  });

  let inserted = 0;
  let skipped = 0;
  const errors = [];

  // On exécute toutes les insertions, puis on flush UNE seule fois (gain énorme avec sql.js)
  const stmt = db.prepare(`
    INSERT INTO prices (repere, lot_id, designation, unite, prix, date_prix, projet, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const designation = (r.designation || '').toString().trim();
      if (!designation) { skipped++; continue; }
      const prix = parseFloat(String(r.prix).replace(',', '.'));
      if (isNaN(prix)) { skipped++; continue; }
      let lotId = null;
      if (r.lot_code) {
        const k = String(r.lot_code).toLowerCase();
        lotId = byCode[k] || byNom[k] || null;
      } else if (r.lot_nom) {
        lotId = byNom[String(r.lot_nom).toLowerCase()] || null;
      }
      stmt.run(
        r.repere ? String(r.repere) : null,
        lotId,
        designation,
        r.unite ? String(r.unite) : null,
        prix,
        r.date_prix ? String(r.date_prix) : null,
        r.projet ? String(r.projet) : null,
        sourceLabel,
        Date.now()
      );
      inserted++;
    } catch (e) {
      errors.push({ row: i + 1, error: e.message });
    }
  }

  // Persistance unique (l'API .run() persist déjà à chaque appel ; mais on flush au cas où)
  if (typeof db.flush === 'function') db.flush();

  return { inserted, skipped, errors };
}

// =========================================================================
// COMPOSITIONS / SOUS-DÉTAILS (structure 3 parties : matériaux / matériel / MO)
// =========================================================================

const ITEM_CATEGORIES = ['materiau', 'materiel', 'mo'];

// Calcule le coût d'un item (avec taux de perte intégré)
function itemCost(it) {
  const q = parseFloat(it.quantite) || 0;
  const pu = parseFloat(it.prix_unitaire != null ? it.prix_unitaire : it.prixUnitaire) || 0;
  const perte = parseFloat(it.taux_perte != null ? it.taux_perte : it.tauxPerte) || 0;
  return q * pu * (1 + perte / 100);
}

function listCompositions(db) {
  const rows = db.prepare('SELECT * FROM compositions ORDER BY nom').all();
  return rows.map(c => {
    const items = db.prepare('SELECT quantite, prix_unitaire, taux_perte, categorie FROM composition_items WHERE composition_id = ?').all(c.id);
    let total = 0, materiau = 0, materiel = 0, mo = 0;
    items.forEach(it => {
      const cost = itemCost(it);
      total += cost;
      if (it.categorie === 'materiau') materiau += cost;
      else if (it.categorie === 'materiel') materiel += cost;
      else if (it.categorie === 'mo') mo += cost;
    });
    return { ...c, total, sous_totaux: { materiau, materiel, mo } };
  });
}

function getComposition(db, id) {
  const c = db.prepare('SELECT * FROM compositions WHERE id = ?').get(id);
  if (!c) return null;
  const items = db.prepare(`
    SELECT ci.*,
           p.designation AS price_designation,
           p.unite AS price_unite,
           p.prix AS price_prix
    FROM composition_items ci
    LEFT JOIN prices p ON p.id = ci.price_id
    WHERE ci.composition_id = ?
    ORDER BY ci.categorie, ci.id
  `).all(id);
  let total = 0, materiau = 0, materiel = 0, mo = 0;
  items.forEach(it => {
    const cost = itemCost(it);
    total += cost;
    if (it.categorie === 'materiau') materiau += cost;
    else if (it.categorie === 'materiel') materiel += cost;
    else if (it.categorie === 'mo') mo += cost;
  });
  return { ...c, items, total, sous_totaux: { materiau, materiel, mo } };
}

function createComposition(db, { nom, unite, description, items }) {
  const cid = db.prepare(`
    INSERT INTO compositions (nom, unite, description, created_at) VALUES (?, ?, ?, ?)
  `).run(nom, unite || null, description || null, Date.now()).lastInsertRowid;
  if (Array.isArray(items)) {
    const stmt = db.prepare(`
      INSERT INTO composition_items (composition_id, price_id, designation_libre, categorie, quantite, prix_unitaire, taux_perte)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    items.forEach(it => {
      const cat = ITEM_CATEGORIES.includes(it.categorie) ? it.categorie : 'materiau';
      stmt.run(cid, it.priceId || null, it.designationLibre || null, cat,
               parseFloat(it.quantite) || 0, parseFloat(it.prixUnitaire) || 0,
               parseFloat(it.tauxPerte) || 0);
    });
  }
  return cid;
}

function updateComposition(db, id, { nom, unite, description, items }) {
  db.prepare('UPDATE compositions SET nom = ?, unite = ?, description = ? WHERE id = ?')
    .run(nom, unite || null, description || null, id);
  db.prepare('DELETE FROM composition_items WHERE composition_id = ?').run(id);
  if (Array.isArray(items)) {
    const stmt = db.prepare(`
      INSERT INTO composition_items (composition_id, price_id, designation_libre, categorie, quantite, prix_unitaire, taux_perte)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    items.forEach(it => {
      const cat = ITEM_CATEGORIES.includes(it.categorie) ? it.categorie : 'materiau';
      stmt.run(id, it.priceId || null, it.designationLibre || null, cat,
               parseFloat(it.quantite) || 0, parseFloat(it.prixUnitaire) || 0,
               parseFloat(it.tauxPerte) || 0);
    });
  }
}

function deleteComposition(db, id) {
  db.prepare('DELETE FROM compositions WHERE id = ?').run(id);
}

// =========================================================================
// DEVIS (avec KPV, TVA, totaux multiples)
// =========================================================================

// Calcul des totaux d'un devis à partir de ses lignes et settings
// settings = { kpv_mode: 'integre'|'fin', kpv_pct, tva_pct }
function computeQuoteTotals(lignes, settings) {
  const debourse = (lignes || []).reduce((s, l) =>
    s + (parseFloat(l.quantite) || 0) * (parseFloat(l.prixUnitaire) || 0), 0);
  const kpvPct = parseFloat(settings && settings.kpv_pct) || 0;
  const tvaPct = parseFloat(settings && settings.tva_pct) || 0;
  const kpvMode = (settings && settings.kpv_mode) || 'fin';
  let totalHT, frais = 0;
  if (kpvMode === 'integre') {
    // Le KPV est censé être déjà dans les PU. Mais on peut quand même l'appliquer ici
    // si l'utilisateur a saisi des PU "déboursé" et veut un coef global.
    totalHT = debourse * (1 + kpvPct / 100);
    frais = totalHT - debourse;
  } else {
    // Mode 'fin' : on ajoute la marge en bas du devis
    frais = debourse * (kpvPct / 100);
    totalHT = debourse + frais;
  }
  const tva = totalHT * (tvaPct / 100);
  const totalTTC = totalHT + tva;
  return {
    debourse: Math.round(debourse * 100) / 100,
    frais: Math.round(frais * 100) / 100,
    total_ht: Math.round(totalHT * 100) / 100,
    tva: Math.round(tva * 100) / 100,
    total_ttc: Math.round(totalTTC * 100) / 100,
    kpv_mode: kpvMode,
    kpv_pct: kpvPct,
    tva_pct: tvaPct
  };
}

function listQuotes(db) {
  return db.prepare(`
    SELECT q.*,
           (SELECT COUNT(*) FROM quote_versions qv WHERE qv.quote_id = q.id) AS nb_versions,
           (SELECT MAX(numero) FROM quote_versions qv WHERE qv.quote_id = q.id) AS last_version
    FROM quotes q
    ORDER BY q.date_maj DESC
  `).all();
}

function getQuote(db, id) {
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
  if (!q) return null;
  const versions = db.prepare(`
    SELECT id, numero, snapshot, created_at FROM quote_versions WHERE quote_id = ? ORDER BY numero
  `).all(id);
  versions.forEach(v => {
    try { v.snapshot = JSON.parse(v.snapshot); } catch (_) { v.snapshot = null; }
  });
  // Calcule les totaux pour la dernière version
  const settings = { kpv_mode: q.kpv_mode, kpv_pct: q.kpv_pct, tva_pct: q.tva_pct };
  const lastVersion = versions[versions.length - 1];
  if (lastVersion && lastVersion.snapshot) {
    lastVersion.totals = computeQuoteTotals(lastVersion.snapshot.lignes, settings);
  }
  return { ...q, versions };
}

function createQuote(db, payload) {
  const { code, titre, clientNom, clientEmail, clientAdresse, kpvMode, kpvPct, tvaPct, notesBasDevis, lignes } = payload;
  const now = Date.now();
  const qid = db.prepare(`
    INSERT INTO quotes (code, titre, client_nom, client_email, client_adresse, statut, kpv_mode, kpv_pct, tva_pct, notes_bas_devis, date_creation, date_maj)
    VALUES (?, ?, ?, ?, ?, 'brouillon', ?, ?, ?, ?, ?, ?)
  `).run(
    code || null, titre, clientNom || null, clientEmail || null, clientAdresse || null,
    kpvMode || 'fin', parseFloat(kpvPct) || 0, parseFloat(tvaPct) || 20,
    notesBasDevis || null, now, now
  ).lastInsertRowid;
  db.prepare(`
    INSERT INTO quote_versions (quote_id, numero, snapshot, created_at)
    VALUES (?, 1, ?, ?)
  `).run(qid, JSON.stringify({ lignes: lignes || [] }), now);
  return qid;
}

function updateQuoteMeta(db, id, payload) {
  const { code, titre, clientNom, clientEmail, clientAdresse, statut, kpvMode, kpvPct, tvaPct, notesBasDevis } = payload;
  const fields = [];
  const params = [];
  if (code !== undefined)         { fields.push('code = ?');          params.push(code || null); }
  if (titre !== undefined)        { fields.push('titre = ?');         params.push(titre); }
  if (clientNom !== undefined)    { fields.push('client_nom = ?');    params.push(clientNom || null); }
  if (clientEmail !== undefined)  { fields.push('client_email = ?');  params.push(clientEmail || null); }
  if (clientAdresse !== undefined){ fields.push('client_adresse = ?');params.push(clientAdresse || null); }
  if (statut !== undefined)       { fields.push('statut = ?');        params.push(statut); }
  if (kpvMode !== undefined)      { fields.push('kpv_mode = ?');      params.push(kpvMode); }
  if (kpvPct !== undefined)       { fields.push('kpv_pct = ?');       params.push(parseFloat(kpvPct) || 0); }
  if (tvaPct !== undefined)       { fields.push('tva_pct = ?');       params.push(parseFloat(tvaPct) || 0); }
  if (notesBasDevis !== undefined){ fields.push('notes_bas_devis = ?');params.push(notesBasDevis || null); }
  if (!fields.length) return;
  fields.push('date_maj = ?'); params.push(Date.now());
  params.push(id);
  db.prepare(`UPDATE quotes SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

function addQuoteVersion(db, quoteId, lignes) {
  const last = db.prepare('SELECT MAX(numero) AS n FROM quote_versions WHERE quote_id = ?').get(quoteId);
  const next = (last && last.n) ? last.n + 1 : 1;
  const now = Date.now();
  db.prepare(`
    INSERT INTO quote_versions (quote_id, numero, snapshot, created_at)
    VALUES (?, ?, ?, ?)
  `).run(quoteId, next, JSON.stringify({ lignes: lignes || [] }), now);
  db.prepare('UPDATE quotes SET date_maj = ? WHERE id = ?').run(now, quoteId);
  return next;
}

function deleteQuote(db, id) {
  db.prepare('DELETE FROM quotes WHERE id = ?').run(id);
}

// Calcul du diff entre 2 versions de devis (pour affichage côté UI)
function diffVersions(vA, vB) {
  const linesA = (vA && vA.lignes) || [];
  const linesB = (vB && vB.lignes) || [];

  // Index par "key" : si la ligne a un priceId on l'utilise, sinon on prend designation
  const keyOf = (l) => l.priceId ? 'p:' + l.priceId : (l.compositionId ? 'c:' + l.compositionId : 'l:' + (l.designation || '').toLowerCase());

  const mapA = {}; linesA.forEach(l => mapA[keyOf(l)] = l);
  const mapB = {}; linesB.forEach(l => mapB[keyOf(l)] = l);

  const added = [];
  const removed = [];
  const modified = [];
  const unchanged = [];

  Object.keys(mapB).forEach(k => {
    if (!mapA[k]) added.push(mapB[k]);
    else {
      const a = mapA[k], b = mapB[k];
      if (a.quantite !== b.quantite || a.prixUnitaire !== b.prixUnitaire || a.designation !== b.designation) {
        modified.push({ before: a, after: b });
      } else {
        unchanged.push(b);
      }
    }
  });
  Object.keys(mapA).forEach(k => {
    if (!mapB[k]) removed.push(mapA[k]);
  });

  return { added, removed, modified, unchanged };
}

// =========================================================================
// INDEXATION (BT01 / ILC / coefficient libre)
// =========================================================================

function previewReindex(db, { coef, scope }) {
  // scope: { all: true } ou { lotId: 3 }
  const c = parseFloat(coef);
  if (isNaN(c) || c <= 0) throw new Error('Coefficient invalide.');
  let sql = 'SELECT id, designation, prix FROM prices WHERE 1=1';
  const params = [];
  if (scope && scope.lotId) {
    sql += ' AND lot_id = ?';
    params.push(scope.lotId);
  }
  sql += ' ORDER BY designation LIMIT 200';
  const rows = db.prepare(sql).all(...params);
  return rows.map(r => ({ ...r, new_prix: Math.round(r.prix * c * 100) / 100, delta: Math.round((r.prix * c - r.prix) * 100) / 100 }));
}

function applyReindex(db, { coef, scope, label }) {
  const c = parseFloat(coef);
  if (isNaN(c) || c <= 0) throw new Error('Coefficient invalide.');
  // On compte d'abord les lignes affectées (sql.js ne renvoie pas getRowsModified
  // de manière fiable après un UPDATE multi-lignes via prepare/run).
  let countSql = 'SELECT COUNT(*) AS n FROM prices WHERE 1=1';
  const countParams = [];
  if (scope && scope.lotId) {
    countSql += ' AND lot_id = ?';
    countParams.push(scope.lotId);
  }
  const countRow = db.prepare(countSql).get(...countParams);
  const affected = countRow ? countRow.n : 0;

  let sql = 'UPDATE prices SET prix = ROUND(prix * ?, 2)';
  const params = [c];
  if (scope && scope.lotId) {
    sql += ' WHERE lot_id = ?';
    params.push(scope.lotId);
  }
  db.prepare(sql).run(...params);

  // Trace dans settings
  const log = {
    when: Date.now(),
    coef: c,
    scope: scope || { all: true },
    label: label || null,
    affected
  };
  let history = [];
  try {
    const existing = db.prepare(`SELECT value FROM settings WHERE key = 'reindex_history'`).get();
    if (existing && existing.value) history = JSON.parse(existing.value);
  } catch (_) {}
  history.unshift(log);
  history = history.slice(0, 50);
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('reindex_history', ?)`).run(JSON.stringify(history));
  return log;
}

function getReindexHistory(db) {
  try {
    const r = db.prepare(`SELECT value FROM settings WHERE key = 'reindex_history'`).get();
    if (r && r.value) return JSON.parse(r.value);
  } catch (_) {}
  return [];
}

module.exports = {
  // Lots
  listLots, createLot, updateLot, deleteLot,
  // Prix
  listPrices, countPrices, createPrice, updatePrice, deletePrice, deletePricesAll, bulkImportPrices,
  // Compositions
  listCompositions, getComposition, createComposition, updateComposition, deleteComposition,
  ITEM_CATEGORIES, itemCost,
  // Devis
  listQuotes, getQuote, createQuote, updateQuoteMeta, addQuoteVersion, deleteQuote, diffVersions,
  computeQuoteTotals,
  // Indexation
  previewReindex, applyReindex, getReindexHistory
};
