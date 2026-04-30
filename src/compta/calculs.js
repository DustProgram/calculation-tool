// Calculs comptables purs — aucune dépendance (DB, etude, ...).
// Réutilisables par les modules métier et par les futurs exports fiscaux (FEC, CA3).

function round2(n) {
  return Math.round((parseFloat(n) || 0) * 100) / 100;
}

function calcTVA(ht, pct) {
  const h = parseFloat(ht) || 0;
  const p = parseFloat(pct) || 0;
  return Math.round(h * p) / 100;
}

function calcTTC(ht, pct) {
  const h = parseFloat(ht) || 0;
  return round2(h + calcTVA(h, pct));
}

// Renvoie [debut_ts, fin_ts, annee] de l'exercice qui contient ts.
function getExerciceBounds(config, ts) {
  const date = new Date(ts);
  const debutMois = (config.exercice_debut_mm || 1) - 1;
  const debutJour = config.exercice_debut_jj || 1;
  let annee = date.getFullYear();
  const debutCetteAnnee = new Date(annee, debutMois, debutJour).getTime();
  if (ts < debutCetteAnnee) annee = annee - 1;
  const debut = new Date(annee, debutMois, debutJour).getTime();
  const fin = new Date(annee + 1, debutMois, debutJour - 1, 23, 59, 59).getTime();
  return [debut, fin, annee];
}

module.exports = { round2, calcTVA, calcTTC, getExerciceBounds };
