// src/ndev.js — Format de fichier .ndev pour échange de devis chiffré
// entre l'étude de prix et l'artisan destinataire.
//
// Format envisagé (Phase 3) :
//   Magic bytes : "NDEV"
//   Version     : 1
//   Header JSON : { senderPubKey, recipientPubKey, ephemeralPubKey, iv, alg, schemaVersion }
//   Payload     : devis JSON chiffré AES-256-GCM, clé dérivée de l'ECDH X25519
//   Tag GCM     : 16 octets
//   Signature   : signature Ed25519 du sender sur (header || payload)
//
// Pour Phase 0 : sérialisation simple en JSON wrapping, sans chiffrement réel.
// L'API est conçue pour être étendue sans casser la compatibilité.

const MAGIC = Buffer.from('NDEV');
const VERSION = 1;

function serialize(payload) {
  // Phase 0 : enveloppe non chiffrée, juste structurée
  const envelope = {
    magic: 'NDEV',
    version: VERSION,
    encrypted: false, // sera true en Phase 3
    schemaVersion: 1,
    timestamp: Date.now(),
    payload
  };
  return Buffer.from(JSON.stringify(envelope, null, 2), 'utf8');
}

function deserialize(buffer) {
  let envelope;
  try {
    envelope = JSON.parse(buffer.toString('utf8'));
  } catch (e) {
    throw new Error('Fichier .ndev invalide ou corrompu.');
  }
  if (envelope.magic !== 'NDEV') throw new Error('Ce n\'est pas un fichier .ndev.');
  if (envelope.version !== VERSION) {
    throw new Error(`Version .ndev incompatible (fichier v${envelope.version}, app v${VERSION}).`);
  }
  return envelope;
}

module.exports = {
  serialize,
  deserialize,
  MAGIC,
  VERSION
};
