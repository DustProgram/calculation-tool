// src/contacts.js — Carnet d'adresses des artisans (côté BE/Étude)

const identity = require('./identity');

function listContacts(db) {
  return db.prepare(`SELECT * FROM contacts ORDER BY label`).all();
}

function getContact(db, id) {
  return db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(id);
}

function createContact(db, payload) {
  // Valide la clé publique
  let pub;
  try {
    pub = identity.pubFromShareable(payload.pub_key || '');
  } catch (e) {
    throw new Error('Clé publique invalide : ' + e.message);
  }
  // Stocke en format normalisé (base64 brut)
  const pubB64 = pub.toString('base64');
  const now = Date.now();
  return db.prepare(`
    INSERT INTO contacts (label, metier, email, telephone, pub_key, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.label || '',
    payload.metier || null,
    payload.email || null,
    payload.telephone || null,
    pubB64,
    payload.notes || null,
    now, now
  ).lastInsertRowid;
}

function updateContact(db, id, payload) {
  const fields = [], params = [];
  ['label', 'metier', 'email', 'telephone', 'notes'].forEach(k => {
    if (payload[k] !== undefined) {
      fields.push(`${k} = ?`);
      params.push(payload[k] || null);
    }
  });
  if (payload.pub_key !== undefined) {
    const pub = identity.pubFromShareable(payload.pub_key);
    fields.push('pub_key = ?');
    params.push(pub.toString('base64'));
  }
  if (!fields.length) return;
  fields.push('updated_at = ?');
  params.push(Date.now(), id);
  db.prepare(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

function deleteContact(db, id) {
  db.prepare(`DELETE FROM contacts WHERE id = ?`).run(id);
}

module.exports = { listContacts, getContact, createContact, updateContact, deleteContact };
