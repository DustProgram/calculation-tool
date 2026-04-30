// Configuration entreprise (statut, TVA, exercice, méthode chantier).

const DEFAULT_CONFIG = {
  raison_sociale: '',
  forme_juridique: 'eurl',          // 'auto', 'ei', 'eurl', 'sarl', 'sas'
  siret: '',
  ape: '',
  adresse: '',
  regime_tva: 'reel_simplifie',     // 'franchise', 'reel_simplifie', 'reel_normal'
  tva_pct_defaut: 20,
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
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('compta_config', ?)`)
    .run(JSON.stringify(merged));
  return merged;
}

module.exports = { DEFAULT_CONFIG, getConfig, setConfig };
