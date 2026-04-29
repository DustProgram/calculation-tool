// app.js — Logique du renderer (UI)
// Pas de framework, tout en JS vanille avec un mini routeur d'écrans.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let currentUser = null;
let currentProfil = null;
let mnemonicSavedShown = false;

// =========================================================================
// ROUTEUR D'ÉCRANS
// =========================================================================

function showScreen(id) {
  $$('.screen').forEach(s => s.classList.remove('visible'));
  $('#' + id).classList.add('visible');
}

// =========================================================================
// AUTH — onglets, signup, login, recover
// =========================================================================

function bindAuthTabs() {
  $$('#auth-tabs .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('#auth-tabs .tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      $$('.tab-pane').forEach(p => p.classList.remove('visible'));
      $('#tab-' + tab).classList.add('visible');
    });
  });
}

async function bootAuth() {
  const exists = await window.api.auth.exists();
  if (!exists) {
    // Aucun compte : on force l'onglet signup
    $$('#auth-tabs .tab').forEach(b => b.classList.remove('active'));
    $('[data-tab="signup"]').classList.add('active');
    $$('.tab-pane').forEach(p => p.classList.remove('visible'));
    $('#tab-signup').classList.add('visible');
  }
  $('#app-version').textContent = await window.api.app.version();
}

async function doSignup() {
  const errEl = $('#signup-error');
  errEl.textContent = '';
  const payload = {
    login: $('#signup-username').value.trim().toLowerCase(),
    displayName: $('#signup-displayname').value.trim(),
    password: $('#signup-password').value,
    profilDefault: $('#signup-profil').value
  };
  if (!payload.login) return errEl.textContent = 'Identifiant requis.';
  if (!payload.password || payload.password.length < 8)
    return errEl.textContent = 'Mot de passe trop court (8 min).';

  const res = await window.api.auth.signup(payload);
  if (!res.ok) return errEl.textContent = res.error;

  // Affiche la phrase de récupération
  showMnemonic(res.mnemonic, async () => {
    // Une fois confirmé : login auto
    const loginRes = await window.api.auth.login({ login: payload.login, password: payload.password });
    if (loginRes.ok) {
      currentUser = loginRes.user;
      goToProfilSelector();
    } else {
      errEl.textContent = loginRes.error;
      showScreen('screen-auth');
    }
  });
}

async function doLogin() {
  const errEl = $('#login-error');
  errEl.textContent = '';
  const payload = {
    login: $('#login-username').value.trim().toLowerCase(),
    password: $('#login-password').value
  };
  if (!payload.login || !payload.password) return errEl.textContent = 'Champs requis.';

  const res = await window.api.auth.login(payload);
  if (!res.ok) return errEl.textContent = res.error;
  currentUser = res.user;
  goToProfilSelector();
}

async function doRecover() {
  const errEl = $('#recover-error');
  errEl.textContent = '';
  const payload = {
    login: $('#recover-username').value.trim().toLowerCase(),
    mnemonic: $('#recover-mnemonic').value.trim().toLowerCase().replace(/\s+/g, ' '),
    newPassword: $('#recover-password').value
  };
  if (!payload.login) return errEl.textContent = 'Identifiant requis.';
  if (payload.mnemonic.split(' ').length !== 12)
    return errEl.textContent = 'La phrase doit contenir exactement 12 mots.';
  if (!payload.newPassword || payload.newPassword.length < 8)
    return errEl.textContent = 'Nouveau mot de passe trop court.';

  const res = await window.api.auth.recover(payload);
  if (!res.ok) return errEl.textContent = res.error;

  // Bascule sur l'onglet login
  $('#login-username').value = payload.login;
  $('#login-password').value = '';
  $$('#auth-tabs .tab').forEach(b => b.classList.remove('active'));
  $('[data-tab="login"]').classList.add('active');
  $$('.tab-pane').forEach(p => p.classList.remove('visible'));
  $('#tab-login').classList.add('visible');
  errEl.textContent = '';
  alert('Mot de passe réinitialisé. Connecte-toi avec le nouveau MDP.');
}

// =========================================================================
// MNEMONIC
// =========================================================================

function showMnemonic(phrase, onContinue) {
  const grid = $('#mnemonic-grid');
  grid.innerHTML = '';
  const words = phrase.split(/\s+/);
  words.forEach((w, i) => {
    const div = document.createElement('div');
    div.className = 'mnemonic-word';
    div.innerHTML = `<span class="num">${i + 1}.</span><span>${w}</span>`;
    grid.appendChild(div);
  });

  $('#chk-mnemonic-saved').checked = false;
  $('#btn-mnemonic-continue').disabled = true;

  $('#chk-mnemonic-saved').onchange = (e) => {
    $('#btn-mnemonic-continue').disabled = !e.target.checked;
  };

  $('#btn-mnemonic-copy').onclick = () => {
    navigator.clipboard.writeText(phrase);
    $('#btn-mnemonic-copy').textContent = '✓ Copié';
    setTimeout(() => $('#btn-mnemonic-copy').textContent = '📋 Copier', 1500);
  };

  $('#btn-mnemonic-print').onclick = () => window.print();

  $('#btn-mnemonic-continue').onclick = () => {
    if ($('#chk-mnemonic-saved').checked) onContinue();
  };

  showScreen('screen-mnemonic');
}

// =========================================================================
// CHOIX DE PROFIL
// =========================================================================

function goToProfilSelector() {
  $('#profil-username').textContent = currentUser.displayName || currentUser.login;
  showScreen('screen-profil');

  $$('.profil-card').forEach(card => {
    card.onclick = async () => {
      const profil = card.dataset.profil;
      const res = await window.api.profil.set(profil);
      if (res.ok) {
        currentProfil = profil;
        goToApp();
      }
    };
  });

  $('#btn-logout-profil').onclick = doLogout;
}

// =========================================================================
// APP (sidebar + contenu)
// =========================================================================

function goToApp() {
  // Affichage du menu correspondant
  $('#menu-artisan').classList.toggle('visible', currentProfil === 'artisan');
  $('#menu-etude').classList.toggle('visible', currentProfil === 'etude');

  $('#sidebar-profil-label').textContent =
    currentProfil === 'artisan' ? '👤 Profil Artisan' : '📐 Profil Étude';

  // Branchement des items du menu
  const activeMenu = currentProfil === 'artisan' ? '#menu-artisan' : '#menu-etude';
  $$(activeMenu + ' .menu-item').forEach(btn => {
    btn.onclick = () => {
      $$(activeMenu + ' .menu-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderPage(btn.dataset.page);
    };
  });

  // Boutons du bas
  $('#btn-switch-profil').onclick = () => {
    goToProfilSelector();
  };
  $('#btn-data-folder').onclick = () => window.api.app.openDataFolder();
  $('#btn-logout').onclick = doLogout;

  // Page d'accueil par défaut
  renderPage(currentProfil === 'artisan' ? 'artisan-home' : 'etude-home');

  showScreen('screen-app');
}

async function doLogout() {
  await window.api.auth.logout();
  currentUser = null;
  currentProfil = null;
  $('#login-password').value = '';
  $('#signup-password').value = '';
  showScreen('screen-auth');
}

// =========================================================================
// PAGES (Phase 0 — placeholders)
// =========================================================================

const PAGES = {
  // ---- Artisan ----
  'artisan-home': () => `
    <h1>Tableau de bord — Artisan</h1>
    <p>Bienvenue ${escapeHtml(currentUser.displayName || currentUser.login)}. Voici l'état de ton activité.</p>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Devis reçus</div><div class="kpi-value">0</div></div>
      <div class="kpi-card"><div class="kpi-label">Chantiers en cours</div><div class="kpi-value">0</div></div>
      <div class="kpi-card"><div class="kpi-label">KPV global</div><div class="kpi-value">—</div></div>
      <div class="kpi-card"><div class="kpi-label">Fournisseurs</div><div class="kpi-value">0</div></div>
    </div>
    <div class="placeholder-card">
      <div class="emoji">🚧</div>
      <p>Les modules métier seront branchés en Phase 2. Pour l'instant, tu peux explorer l'arborescence dans la barre latérale.</p>
    </div>`,
  'artisan-kpv': () => placeholder('⚙️ Paramètres KPV', 2,
    'Définition du KPV global et par lot : déboursé sec, frais de chantier (%), frais d\'opération (%), frais généraux (%), bénéfice (%), aléas (%). Calcul automatique du coefficient de prix de vente.'),
  'artisan-logistic': () => placeholder('🚐 Déplacements & logistique', 2,
    'Prix carburant, consommation véhicule, distance siège ↔ chantier, nombre de trajets. Calcul automatique du coût de déplacement à intégrer dans les frais de chantier.'),
  'artisan-suppliers': () => placeholder('🏪 Fournisseurs', 2,
    'Carnet de fournisseurs avec prix négociés. Sert de base personnelle pour le chiffrage de tes propres devis.'),
  'artisan-quotes-in': () => placeholder('📥 Devis reçus', 3,
    'Devis chiffrés reçus de l\'étude de prix sous forme de fichiers .ndev. Import par drag-drop ou via dossier surveillé. Statuts : Reçu → Lu → Accepté/Refusé/Modifications demandées.'),
  'artisan-sites': () => placeholder('🏗 Suivi chantier', 2,
    'Suivi des chantiers issus de devis acceptés : avancement (%), statut (à démarrer / en cours / terminé / facturé), pièces jointes.'),

  // ---- Étude ----
  'etude-home': () => `
    <h1>Tableau de bord — Étude de prix</h1>
    <p>Bienvenue ${escapeHtml(currentUser.displayName || currentUser.login)}.</p>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Prix en base</div><div class="kpi-value">0</div></div>
      <div class="kpi-card"><div class="kpi-label">Compositions</div><div class="kpi-value">0</div></div>
      <div class="kpi-card"><div class="kpi-label">Devis en cours</div><div class="kpi-value">0</div></div>
      <div class="kpi-card"><div class="kpi-label">Devis envoyés</div><div class="kpi-value">0</div></div>
    </div>
    <div class="placeholder-card">
      <div class="emoji">🚧</div>
      <p>Les modules métier seront branchés en Phase 1. Pour l'instant, tu peux explorer l'arborescence dans la barre latérale.</p>
    </div>`,
  'etude-prices': () => placeholder('💶 Base de prix', 1,
    'Catalogue interne de prix (style BatiPrix). Import Excel en masse, recherche, filtres par lot/projet/année, édition inline, détection des anomalies (hors plage min-max), historique de prix.'),
  'etude-compos': () => placeholder('🧱 Compositions / sous-détails', 1,
    'Création de compositions réutilisables (ex: 1 m² de mur parpaing = X parpaings + Y kg ciment + Z h MO). Insertion dans les devis comme un bloc unitaire.'),
  'etude-quotes': () => placeholder('📄 Devis', 1,
    'Création de devis HT, sélection du client artisan, application automatique du KPV (par ligne ou en bas), versions multiples avec diff visuel, export PDF, export .ndev pour envoi à l\'artisan.'),
  'etude-index': () => placeholder('📈 Indexation BT01 / ILC', 1,
    'Application d\'un coefficient de révision officiel (BT01, ILC, ILAT…) sur tout ou partie de la base de prix pour mettre à jour les prix selon l\'inflation des indices.')
};

function placeholder(title, phase, description) {
  return `
    <h1>${title}<span class="badge phase${phase}">Phase ${phase}</span></h1>
    <p>${description}</p>
    <div class="placeholder-card">
      <div class="emoji">🚧</div>
      <p>Module à implémenter en Phase ${phase}.</p>
    </div>`;
}

function renderPage(pageId) {
  const renderer = PAGES[pageId];
  $('#content').innerHTML = renderer ? renderer() : `<h1>Page inconnue</h1>`;
}

// =========================================================================
// UTILS
// =========================================================================

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =========================================================================
// BOOT
// =========================================================================

window.addEventListener('DOMContentLoaded', async () => {
  bindAuthTabs();
  await bootAuth();

  $('#btn-signup').addEventListener('click', doSignup);
  $('#btn-login').addEventListener('click', doLogin);
  $('#btn-recover').addEventListener('click', doRecover);

  // Entrée pour valider
  $('#login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('#signup-password').addEventListener('keydown', e => { if (e.key === 'Enter') doSignup(); });
});
