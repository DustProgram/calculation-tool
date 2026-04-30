// Plan comptable BTP simplifié — données pures, sans dépendances.

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
  return COMPTES_RECETTES.find(c => c.code === code)
      || COMPTES_CHARGES.find(c => c.code === code)
      || null;
}

module.exports = { COMPTES_RECETTES, COMPTES_CHARGES, getCompte };
