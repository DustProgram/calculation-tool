// src/db.js — Couche d'accès aux bases SQLite.
//
// Architecture :
//   - 1 base "system.db" globale qui stocke les comptes utilisateurs
//     (login, salt, wrappedKey, publicKey, etc.)
//   - 1 base "user-<id>.db" par utilisateur, qui contient ses données métier
//     (paramètres KPV, base de prix, devis, fournisseurs…). Les colonnes
//     sensibles sont chiffrées au niveau applicatif via la DEK de session.
//
// Note : on utilise better-sqlite3 (synchrone, rapide, idéal pour Electron).

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

let _systemDb = null;
let _systemDbWrapper = null;
let _userDb = null;
let _userDbDek = null;
let _userDbId = null;
let _appDir = null;

// =========================================================================
// DB SYSTÈME
// =========================================================================

function initSystemDb(appDir) {
  _appDir = appDir;
  const filePath = path.join(appDir, 'system.db');
  _systemDb = new Database(filePath);
  _systemDb.pragma('journal_mode = WAL');
  _systemDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT UNIQUE NOT NULL,
      display_name TEXT,
      profil_default TEXT NOT NULL DEFAULT 'etude',
      salt TEXT NOT NULL,
      wrapped_by_password TEXT NOT NULL,
      wrapped_by_mnemonic TEXT NOT NULL,
      public_key TEXT NOT NULL,
      enc_priv_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  _systemDbWrapper = buildSystemWrapper(_systemDb);
  return _systemDbWrapper;
}

function buildSystemWrapper(db) {
  return {
    hasAnyUser() {
      const r = db.prepare('SELECT COUNT(*) AS n FROM users').get();
      return r.n > 0;
    },
    listUsers() {
      return db.prepare('SELECT id, login, display_name, profil_default FROM users ORDER BY login').all()
        .map(u => ({ id: u.id, login: u.login, displayName: u.display_name, profilDefault: u.profil_default }));
    },
    getUserByLogin(login) {
      return db.prepare(`
        SELECT id, login, display_name, profil_default, salt,
               wrapped_by_password, wrapped_by_mnemonic, public_key, enc_priv_key
        FROM users WHERE login = ?
      `).get(login);
    },
    createUser({ login, displayName, profilDefault, salt, wrappedByPassword, wrappedByMnemonic, publicKey, encPrivKey }) {
      const now = Date.now();
      const stmt = db.prepare(`
        INSERT INTO users
          (login, display_name, profil_default, salt, wrapped_by_password, wrapped_by_mnemonic, public_key, enc_priv_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(login, displayName, profilDefault, salt, wrappedByPassword, wrappedByMnemonic, publicKey, encPrivKey, now, now);
      return info.lastInsertRowid;
    },
    updateWrappedPassword(userId, newWrapped) {
      db.prepare('UPDATE users SET wrapped_by_password = ?, updated_at = ? WHERE id = ?')
        .run(newWrapped, Date.now(), userId);
    }
  };
}

function systemDb() {
  if (!_systemDbWrapper) throw new Error('System DB non initialisée.');
  return _systemDbWrapper;
}

// =========================================================================
// DB UTILISATEUR
// =========================================================================

function openUserDb(userId, dek) {
  closeUserDb();
  const filePath = path.join(_appDir, `user-${userId}.db`);
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_USER);
  _userDb = db;
  _userDbDek = dek;
  _userDbId = userId;
  return _userDb;
}

function closeUserDb() {
  if (_userDb) {
    try { _userDb.close(); } catch (_) {}
  }
  _userDb = null;
  _userDbDek = null;
  _userDbId = null;
}

function userDb() {
  if (!_userDb) throw new Error('User DB non initialisée (login requis).');
  return _userDb;
}

// Schéma initial (Phase 0) — tables créées vides, à remplir en Phase 1/2/3
const SCHEMA_USER = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- Paramètres KPV (côté artisan)
  CREATE TABLE IF NOT EXISTS kpv_params (
    id INTEGER PRIMARY KEY,
    lot TEXT,                    -- NULL = global, sinon nom du lot
    frais_chantier_pct REAL DEFAULT 0,
    frais_operation_pct REAL DEFAULT 0,
    frais_generaux_pct REAL DEFAULT 0,
    benefice_pct REAL DEFAULT 0,
    aleas_pct REAL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  -- Paramètres logistiques artisan (carburant, conso, distance par défaut)
  CREATE TABLE IF NOT EXISTS logistic_params (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- Lots (pour les deux profils)
  CREATE TABLE IF NOT EXISTS lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT,
    nom TEXT NOT NULL,
    couleur TEXT,
    ordre INTEGER NOT NULL DEFAULT 0
  );

  -- Base de prix (étude de prix)
  CREATE TABLE IF NOT EXISTS prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repere TEXT,
    lot_id INTEGER,
    designation TEXT NOT NULL,
    unite TEXT,
    prix REAL NOT NULL,
    date_prix TEXT,
    projet TEXT,
    source TEXT,                 -- ex: "import excel", "manuel"
    created_at INTEGER NOT NULL,
    FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE SET NULL
  );

  -- Compositions / sous-détails
  CREATE TABLE IF NOT EXISTS compositions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    unite TEXT,
    description TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS composition_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    composition_id INTEGER NOT NULL,
    price_id INTEGER,            -- référence à un prix de la base
    designation_libre TEXT,      -- si pas de référence
    quantite REAL NOT NULL,
    prix_unitaire REAL NOT NULL,
    FOREIGN KEY (composition_id) REFERENCES compositions(id) ON DELETE CASCADE,
    FOREIGN KEY (price_id) REFERENCES prices(id) ON DELETE SET NULL
  );

  -- Devis
  CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT,
    titre TEXT NOT NULL,
    client_nom TEXT,
    client_email TEXT,
    artisan_public_key TEXT,     -- clé publique de l'artisan destinataire si applicable
    statut TEXT NOT NULL DEFAULT 'brouillon',  -- brouillon | envoye | recu | lu | accepte | refuse | clos
    date_creation INTEGER NOT NULL,
    date_maj INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quote_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id INTEGER NOT NULL,
    numero INTEGER NOT NULL,
    snapshot TEXT NOT NULL,      -- JSON de l'état complet du devis (chiffré au niveau app si besoin)
    created_at INTEGER NOT NULL,
    FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
  );

  -- Carnet fournisseurs (artisan)
  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    contact TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS supplier_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL,
    designation TEXT NOT NULL,
    unite TEXT,
    prix REAL NOT NULL,
    date_prix TEXT,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
  );

  -- Suivi chantier
  CREATE TABLE IF NOT EXISTS sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    adresse TEXT,
    quote_id INTEGER,
    statut TEXT NOT NULL DEFAULT 'a_demarrer',  -- a_demarrer | en_cours | termine | facture
    avancement_pct REAL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE SET NULL
  );

  -- Index utiles
  CREATE INDEX IF NOT EXISTS idx_prices_lot ON prices(lot_id);
  CREATE INDEX IF NOT EXISTS idx_prices_repere ON prices(repere);
  CREATE INDEX IF NOT EXISTS idx_quotes_statut ON quotes(statut);
`;

module.exports = {
  initSystemDb,
  systemDb,
  openUserDb,
  closeUserDb,
  userDb
};
