// src/db.js — Couche d'accès aux bases SQLite (via sql.js / WebAssembly).
//
// Pourquoi sql.js plutôt que better-sqlite3 ?
//   - Pas de compilation native (donc marche sur ARM64, Insiders VS, etc.)
//   - Pure JS/WASM, install instantanée
//   - Performance largement suffisante pour notre usage (qq milliers de lignes)
//
// Architecture conservée :
//   - 1 base "system.db" globale (catalogue des comptes utilisateurs)
//   - 1 base "user-<id>.db" par utilisateur (données métier)
//
// Wrapper : on imite l'API de better-sqlite3 (prepare/run/get/all, exec)
// pour limiter les changements dans le reste du code.

const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

let SQL = null;                 // namespace sql.js (chargé une seule fois)
let _systemDb = null;
let _systemDbPath = null;
let _systemDbWrapper = null;
let _userDb = null;
let _userDbPath = null;
let _userDbId = null;
let _appDir = null;

// =========================================================================
// Initialisation du runtime sql.js (à appeler une seule fois au boot)
// =========================================================================

async function initRuntime() {
  if (SQL) return SQL;
  // Le fichier .wasm est embarqué dans le package sql.js
  const wasmDir = path.dirname(require.resolve('sql.js/dist/sql-wasm.wasm'));
  SQL = await initSqlJs({
    locateFile: (file) => path.join(wasmDir, file)
  });
  return SQL;
}

// =========================================================================
// Helpers communs
// =========================================================================

function loadOrCreate(dbPath) {
  let db;
  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(new Uint8Array(buf));
  } else {
    db = new SQL.Database();
  }
  return db;
}

function persist(db, dbPath) {
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

// Wrapper qui imite l'API better-sqlite3 (prepare/run/get/all, exec)
// + persistance auto sur INSERT/UPDATE/DELETE.
function makeWrapper(db, dbPath) {
  function bindArgs(stmt, args) {
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0]) && !Buffer.isBuffer(args[0])) {
      stmt.bind(args[0]);
    } else {
      stmt.bind(args);
    }
  }
  return {
    raw: db,
    exec(sqlStr) {
      db.run(sqlStr);
      persist(db, dbPath);
    },
    prepare(sqlStr) {
      const isWrite = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sqlStr);
      return {
        run(...args) {
          const stmt = db.prepare(sqlStr);
          bindArgs(stmt, args);
          stmt.step();
          stmt.free();
          let lastId = 0;
          try {
            const r = db.exec('SELECT last_insert_rowid() AS id');
            if (r[0] && r[0].values && r[0].values[0]) lastId = r[0].values[0][0];
          } catch (_) {}
          if (isWrite) persist(db, dbPath);
          return { lastInsertRowid: lastId, changes: db.getRowsModified() };
        },
        get(...args) {
          const stmt = db.prepare(sqlStr);
          bindArgs(stmt, args);
          let row = null;
          if (stmt.step()) row = stmt.getAsObject();
          stmt.free();
          return row;
        },
        all(...args) {
          const stmt = db.prepare(sqlStr);
          bindArgs(stmt, args);
          const rows = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          stmt.free();
          return rows;
        }
      };
    },
    close() {
      try { persist(db, dbPath); } catch (_) {}
      try { db.close(); } catch (_) {}
    },
    flush() {
      persist(db, dbPath);
    }
  };
}

// =========================================================================
// DB SYSTÈME
// =========================================================================

function initSystemDb(appDir) {
  if (!SQL) throw new Error('sql.js runtime non initialisé. Appeler initRuntime() au boot.');
  _appDir = appDir;
  _systemDbPath = path.join(appDir, 'system.db');
  const db = loadOrCreate(_systemDbPath);
  const wrap = makeWrapper(db, _systemDbPath);
  wrap.exec(`
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
  _systemDb = db;
  _systemDbWrapper = buildSystemApi(wrap);
  return _systemDbWrapper;
}

function buildSystemApi(db) {
  return {
    hasAnyUser() {
      const r = db.prepare('SELECT COUNT(*) AS n FROM users').get();
      return (r ? r.n : 0) > 0;
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
      const info = db.prepare(`
        INSERT INTO users
          (login, display_name, profil_default, salt, wrapped_by_password, wrapped_by_mnemonic, public_key, enc_priv_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(login, displayName, profilDefault, salt, wrappedByPassword, wrappedByMnemonic, publicKey, encPrivKey, now, now);
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
  if (!SQL) throw new Error('sql.js runtime non initialisé.');
  closeUserDb();
  _userDbPath = path.join(_appDir, `user-${userId}.db`);
  const db = loadOrCreate(_userDbPath);
  const wrap = makeWrapper(db, _userDbPath);
  wrap.exec(SCHEMA_USER);
  // Migrations silencieuses pour les bases créées avant l'ajout des nouvelles colonnes.
  // SQLite ne supporte pas ALTER TABLE IF NOT EXISTS, donc on essaie et on ignore l'erreur
  // si la colonne existe déjà.
  const migrations = [
    `ALTER TABLE composition_items ADD COLUMN categorie TEXT NOT NULL DEFAULT 'materiau'`,
    `ALTER TABLE composition_items ADD COLUMN taux_perte REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE composition_items ADD COLUMN equipment_id INTEGER`,
    `ALTER TABLE quotes ADD COLUMN client_adresse TEXT`,
    `ALTER TABLE quotes ADD COLUMN kpv_mode TEXT NOT NULL DEFAULT 'fin'`,
    `ALTER TABLE quotes ADD COLUMN kpv_unit TEXT NOT NULL DEFAULT 'pct'`,
    `ALTER TABLE quotes ADD COLUMN kpv_pct REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE quotes ADD COLUMN tva_pct REAL NOT NULL DEFAULT 8.5`,
    `ALTER TABLE quotes ADD COLUMN notes_bas_devis TEXT`,
    // Phase 2 : compléments
    `ALTER TABLE suppliers ADD COLUMN telephone TEXT`,
    `ALTER TABLE suppliers ADD COLUMN email TEXT`,
    `ALTER TABLE suppliers ADD COLUMN adresse TEXT`,
    `ALTER TABLE supplier_prices ADD COLUMN reference TEXT`,
    `ALTER TABLE supplier_prices ADD COLUMN notes TEXT`,
    `ALTER TABLE sites ADD COLUMN date_debut INTEGER`,
    `ALTER TABLE sites ADD COLUMN date_fin_prev INTEGER`,
    `ALTER TABLE sites ADD COLUMN notes TEXT`,
    // Phase 2.1 : distance et nb trajets par chantier
    `ALTER TABLE sites ADD COLUMN distance_km REAL DEFAULT 0`,
    `ALTER TABLE sites ADD COLUMN nb_trajets_jour REAL DEFAULT 2`,
    `ALTER TABLE sites ADD COLUMN nb_jours_estim REAL DEFAULT 0`
  ];
  migrations.forEach(sql => {
    try { wrap.exec(sql); } catch (_) { /* colonne déjà présente */ }
  });
  _userDb = wrap;
  _userDbId = userId;
  return _userDb;
}

function closeUserDb() {
  if (_userDb) {
    try { _userDb.close(); } catch (_) {}
  }
  _userDb = null;
  _userDbPath = null;
  _userDbId = null;
}

function userDb() {
  if (!_userDb) throw new Error('User DB non initialisée (login requis).');
  return _userDb;
}

// Schéma initial — tables créées vides, à remplir en Phase 1/2/3
const SCHEMA_USER = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS kpv_params (
    id INTEGER PRIMARY KEY,
    lot TEXT,
    frais_chantier_pct REAL DEFAULT 0,
    frais_operation_pct REAL DEFAULT 0,
    frais_generaux_pct REAL DEFAULT 0,
    benefice_pct REAL DEFAULT 0,
    aleas_pct REAL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS logistic_params (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT,
    nom TEXT NOT NULL,
    couleur TEXT,
    ordre INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repere TEXT,
    lot_id INTEGER,
    designation TEXT NOT NULL,
    unite TEXT,
    prix REAL NOT NULL,
    date_prix TEXT,
    projet TEXT,
    source TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE SET NULL
  );

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
    price_id INTEGER,
    designation_libre TEXT,
    categorie TEXT NOT NULL DEFAULT 'materiau',
    quantite REAL NOT NULL,
    prix_unitaire REAL NOT NULL,
    taux_perte REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (composition_id) REFERENCES compositions(id) ON DELETE CASCADE,
    FOREIGN KEY (price_id) REFERENCES prices(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT,
    titre TEXT NOT NULL,
    client_nom TEXT,
    client_email TEXT,
    client_adresse TEXT,
    artisan_public_key TEXT,
    statut TEXT NOT NULL DEFAULT 'brouillon',
    kpv_mode TEXT NOT NULL DEFAULT 'fin',
    kpv_unit TEXT NOT NULL DEFAULT 'pct',
    kpv_pct REAL NOT NULL DEFAULT 0,
    tva_pct REAL NOT NULL DEFAULT 8.5,
    notes_bas_devis TEXT,
    date_creation INTEGER NOT NULL,
    date_maj INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quote_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id INTEGER NOT NULL,
    numero INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
  );

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

  CREATE TABLE IF NOT EXISTS sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    adresse TEXT,
    quote_id INTEGER,
    statut TEXT NOT NULL DEFAULT 'a_demarrer',
    avancement_pct REAL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE SET NULL
  );

  -- Catalogue de matériel / outillage avec amortissement
  -- Le prix unitaire de location interne est calculé depuis :
  --   prix_achat × (1 + frais_pct/100) / (duree_amort_annees × usage_par_an)
  CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    categorie TEXT,
    prix_achat REAL NOT NULL DEFAULT 0,
    duree_amort_annees REAL NOT NULL DEFAULT 5,
    usage_par_an REAL NOT NULL DEFAULT 200,
    unite_usage TEXT NOT NULL DEFAULT 'h',
    frais_pct REAL NOT NULL DEFAULT 0,
    prix_unitaire REAL NOT NULL DEFAULT 0,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_prices_lot ON prices(lot_id);
  CREATE INDEX IF NOT EXISTS idx_prices_repere ON prices(repere);
  CREATE INDEX IF NOT EXISTS idx_quotes_statut ON quotes(statut);
  CREATE INDEX IF NOT EXISTS idx_equipment_nom ON equipment(nom);

  -- ============================================================
  -- COMPTABILITÉ (Phase 2.2) — Profil Artisan
  -- ============================================================

  -- Écritures comptables (recettes et dépenses)
  CREATE TABLE IF NOT EXISTS compta_ecritures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,                  -- 'recette' ou 'depense'
    date INTEGER NOT NULL,               -- date d'opération (timestamp)
    libelle TEXT NOT NULL,
    compte_code TEXT,                    -- ex: '701', '604', '606'
    compte_label TEXT,                   -- libellé du compte (cache pour affichage)
    montant_ht REAL NOT NULL DEFAULT 0,
    tva_pct REAL NOT NULL DEFAULT 0,
    montant_tva REAL NOT NULL DEFAULT 0,
    montant_ttc REAL NOT NULL DEFAULT 0,
    site_id INTEGER,                     -- chantier rattaché (optionnel)
    quote_id INTEGER,                    -- devis rattaché (optionnel)
    supplier_id INTEGER,                 -- fournisseur rattaché (optionnel)
    client_nom TEXT,                     -- pour les recettes sans devis
    ref_facture TEXT,                    -- numéro de facture
    date_paiement INTEGER,               -- date d'encaissement/décaissement effectif
    mode_paiement TEXT,                  -- 'cheque', 'virement', 'cb', 'especes', 'prelevement'
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL,
    FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE SET NULL,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
  );

  -- Situations (factures intermédiaires de chantier, méthode à l'avancement)
  CREATE TABLE IF NOT EXISTS compta_situations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL,
    numero TEXT,                          -- ex: 'SIT-001', 'SIT-002'
    date INTEGER NOT NULL,
    pct_avancement_cumule REAL NOT NULL,  -- ex: 30, 60, 100
    montant_ht_periode REAL NOT NULL,     -- montant facturé sur cette période
    tva_pct REAL NOT NULL DEFAULT 8.5,
    montant_ttc_periode REAL NOT NULL,
    date_paiement INTEGER,                -- quand le client a payé
    notes TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_compta_ec_date ON compta_ecritures(date);
  CREATE INDEX IF NOT EXISTS idx_compta_ec_site ON compta_ecritures(site_id);
  CREATE INDEX IF NOT EXISTS idx_compta_sit_site ON compta_situations(site_id);

  -- ============================================================
  -- LICENCES MODULAIRES (Phase 3) — fichiers .nelic importés
  -- ============================================================
  CREATE TABLE IF NOT EXISTS user_licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_id TEXT,                  -- ID unique de la licence (du .nelic)
    user_name TEXT,                   -- "Pour qui" affichage
    modules TEXT NOT NULL,            -- JSON array ['etude','compta']
    issued_at INTEGER,                -- timestamp d'émission
    expires_at INTEGER,               -- timestamp d'expiration (null = jamais)
    payload TEXT NOT NULL,            -- JSON complet du .nelic (avec signature)
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_lic_id ON user_licenses(license_id);

  -- ============================================================
  -- SÉCURITÉ (Phase 3) — Secrets utilisateur (TOTP, mode éditeur, identité X25519)
  -- ============================================================
  CREATE TABLE IF NOT EXISTS user_secrets (
    id INTEGER PRIMARY KEY DEFAULT 1,
    totp_secret BLOB,
    totp_enabled INTEGER DEFAULT 0,
    totp_recovery_hashes TEXT,
    master_private_key BLOB,
    x25519_private BLOB,        -- clé privée X25519 chiffrée par DEK (échange .ndev)
    x25519_public BLOB,         -- clé publique X25519 (en clair, partageable)
    x25519_label TEXT,          -- libellé identité (ex: "Roland — PROMORAME")
    CHECK (id = 1)
  );
  INSERT OR IGNORE INTO user_secrets (id) VALUES (1);

  -- ============================================================
  -- COMMUNICATION ÉTUDE → ARTISAN (Phase 3.5)
  -- ============================================================

  -- Carnet d'adresses des artisans (côté BE/Étude)
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,            -- "Jean Dupont — SARL Plomberie Express"
    metier TEXT,                     -- "Plomberie", "Électricité", etc.
    email TEXT,
    telephone TEXT,
    pub_key TEXT NOT NULL,           -- Clé publique X25519 (base64)
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Devis reçus (côté Artisan, après import d'un .ndev)
  CREATE TABLE IF NOT EXISTS received_quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_label TEXT,                -- libellé du BE émetteur
    sender_pub TEXT,                  -- clé publique de l'émetteur (pour identifier)
    subject TEXT,                     -- ex: "DEV-2026-001 — Villa Dupont"
    received_at INTEGER NOT NULL,
    issued_at INTEGER,                -- date d'envoi par le BE
    payload TEXT NOT NULL,            -- JSON déchiffré (devis complet)
    statut TEXT DEFAULT 'nouveau',    -- 'nouveau', 'lu', 'accepte', 'refuse'
    notes TEXT
  );

  -- Historique des envois (côté Étude)
  CREATE TABLE IF NOT EXISTS sent_quotes_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id INTEGER,
    contact_id INTEGER,
    sent_at INTEGER NOT NULL,
    file_name TEXT,
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_recv_received_at ON received_quotes(received_at);
  CREATE INDEX IF NOT EXISTS idx_sent_quote_id ON sent_quotes_log(quote_id);
`;

module.exports = {
  initRuntime,
  initSystemDb,
  systemDb,
  openUserDb,
  closeUserDb,
  userDb
};
