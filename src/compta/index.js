// Façade Comptabilité — point d'entrée unique consommé par main.js.
//
// Découpage interne (SOLID) :
//   plan-comptable.js  — données du plan comptable BTP
//   calculs.js         — calculs purs (TVA, arrondis, bornes d'exercice)
//   config.js          — configuration entreprise
//   ecritures.js       — CRUD écritures (recettes / dépenses)
//   situations.js      — CRUD situations chantier (avancement)
//   dashboard.js       — agrégations CA / charges / TVA
//   chantiers.js       — suivi en-cours et marge par chantier
//
// Évolutions prévues : exports fiscaux (FEC, CA3, CA12), journaux, grand livre,
// liasse fiscale → s'ajouteront dans src/compta/exports/*.js sans toucher au reste.

const planComptable = require('./plan-comptable');
const config = require('./config');
const calculs = require('./calculs');
const ecritures = require('./ecritures');
const situations = require('./situations');
const dashboard = require('./dashboard');
const chantiers = require('./chantiers');

module.exports = {
  // Plan comptable
  COMPTES_RECETTES: planComptable.COMPTES_RECETTES,
  COMPTES_CHARGES: planComptable.COMPTES_CHARGES,
  getCompte: planComptable.getCompte,

  // Configuration
  DEFAULT_CONFIG: config.DEFAULT_CONFIG,
  getConfig: config.getConfig,
  setConfig: config.setConfig,

  // Utilitaire calculs
  getExerciceBounds: calculs.getExerciceBounds,

  // Écritures
  listEcritures: ecritures.listEcritures,
  createEcriture: ecritures.createEcriture,
  updateEcriture: ecritures.updateEcriture,
  deleteEcriture: ecritures.deleteEcriture,

  // Situations chantier
  listSituations: situations.listSituations,
  createSituation: situations.createSituation,
  deleteSituation: situations.deleteSituation,

  // Tableau de bord & suivi chantiers
  computeDashboard: dashboard.computeDashboard,
  computeChantiersEnCours: chantiers.computeChantiersEnCours,
  computeMargeChantiers: chantiers.computeMargeChantiers
};
