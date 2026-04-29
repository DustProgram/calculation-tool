// src/excel.js — Lecture/écriture de fichiers Excel via SheetJS (xlsx)
//
// Usage : la 1ère ligne est considérée comme l'en-tête. On essaie de
// matcher automatiquement les colonnes connues (designation, prix, etc.).

const XLSX = require('xlsx');
const fs = require('fs');

// Mapping : pour chaque champ cible, liste des en-têtes acceptés (en minuscule)
const COLUMN_ALIASES = {
  repere:     ['repere', 'repère', 'ref', 'référence', 'reference', 'code', 'numero', 'numéro', 'n°', 'no'],
  designation:['designation', 'désignation', 'libelle', 'libellé', 'description', 'descriptif', 'item', 'article'],
  unite:      ['unite', 'unité', 'u', 'um', 'unit', 'unites'],
  prix:       ['prix', 'pu', 'p.u.', 'prix unitaire', 'prix u', 'pu ht', 'prix ht', 'tarif', 'cout', 'coût', 'price'],
  date_prix:  ['date', 'date prix', 'date_prix', 'année', 'annee'],
  projet:     ['projet', 'project', 'chantier', 'opération', 'operation', 'affaire'],
  lot_code:   ['code lot', 'lot_code', 'codelot', 'numero lot', 'n° lot', 'lot n°', 'lot id'],
  lot_nom:    ['lot', 'nom lot', 'lot_nom', 'lot name', 'corps état', 'corps d\'état']
};

// Lit un fichier Excel et retourne { headers, rows, sheets, mapping }
function readExcelFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, raw: false });
  const sheets = wb.SheetNames;
  // On lit la 1ère feuille par défaut
  return readSheet(wb, sheets[0], sheets);
}

function readSheet(wb, sheetName, sheets) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return { headers: [], rows: [], sheets, currentSheet: sheetName, mapping: {} };
  // Convertit en tableau de tableaux (raw)
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
  if (!aoa.length) return { headers: [], rows: [], sheets, currentSheet: sheetName, mapping: {} };
  const headers = aoa[0].map(h => String(h || '').trim());
  const rawRows = aoa.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = r[i] != null ? r[i] : '');
    return obj;
  });
  // Tentative de mapping automatique
  const mapping = autoMapColumns(headers);
  // Données brutes pour preview
  return { headers, rows: rawRows, sheets, currentSheet: sheetName, mapping };
}

function autoMapColumns(headers) {
  const norm = (s) => String(s || '').toLowerCase().trim();
  const result = {};
  Object.keys(COLUMN_ALIASES).forEach(field => {
    const aliases = COLUMN_ALIASES[field];
    const found = headers.find(h => aliases.includes(norm(h)));
    if (found) result[field] = found;
  });
  return result;
}

// Applique un mapping pour transformer les rows en {repere, designation, ...}
function applyMapping(rows, mapping) {
  return rows.map(r => {
    const out = {};
    Object.keys(mapping).forEach(field => {
      const sourceCol = mapping[field];
      if (sourceCol && r[sourceCol] !== undefined) {
        out[field] = r[sourceCol];
      }
    });
    return out;
  });
}

// Lecture d'une feuille spécifique d'un workbook déjà chargé
function readWorkbookSheet(filePath, sheetName) {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, raw: false });
  return readSheet(wb, sheetName, wb.SheetNames);
}

// Export d'une liste de prix vers Excel
function exportPricesToExcel(prices, filePath) {
  const data = prices.map(p => ({
    'Repère': p.repere || '',
    'Lot code': p.lot_code || '',
    'Lot': p.lot_nom || '',
    'Désignation': p.designation || '',
    'Unité': p.unite || '',
    'Prix': p.prix || 0,
    'Date': p.date_prix || '',
    'Projet': p.projet || ''
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Base de prix');
  XLSX.writeFile(wb, filePath);
}

module.exports = {
  readExcelFile,
  readWorkbookSheet,
  applyMapping,
  exportPricesToExcel,
  COLUMN_ALIASES
};
