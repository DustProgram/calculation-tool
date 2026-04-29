// app.js — Logique du renderer (UI)
// Pas de framework, tout en JS vanille avec un mini routeur d'écrans.
// Note : $, $$, escapeHtml et autres utils sont définis par ui/lib.js
// (chargé AVANT app.js dans index.html).

let currentUser = null;
let currentProfil = null;
let mnemonicSavedShown = false;

// =========================================================================
// THÈMES (sombre / clair / beige) — persistance localStorage
// =========================================================================

const THEMES = ['dark', 'light', 'beige'];

function applyTheme(theme) {
  if (!THEMES.includes(theme)) theme = 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('theme', theme); } catch (_) {}
  // Synchronise les deux selects
  ['#theme-select-auth', '#theme-select-app'].forEach(sel => {
    const el = $(sel);
    if (el && el.value !== theme) el.value = theme;
  });
}

function setupTheme() {
  let saved = 'dark';
  try { saved = localStorage.getItem('theme') || 'dark'; } catch (_) {}
  applyTheme(saved);
  ['#theme-select-auth', '#theme-select-app'].forEach(sel => {
    const el = $(sel);
    if (el) el.addEventListener('change', e => applyTheme(e.target.value));
  });
}

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
  // Normalise : virgules ou espaces multiples → 1 espace simple
  const rawMnemonic = $('#recover-mnemonic').value.trim().toLowerCase().replace(/[,\s]+/g, ' ');
  const payload = {
    login: $('#recover-username').value.trim().toLowerCase(),
    mnemonic: rawMnemonic,
    newPassword: $('#recover-password').value
  };
  if (!payload.login) return errEl.textContent = 'Identifiant requis.';
  const wordCount = payload.mnemonic ? payload.mnemonic.split(' ').length : 0;
  if (wordCount !== 12)
    return errEl.textContent = `La phrase doit contenir exactement 12 mots (tu en as saisi ${wordCount}).`;
  if (!payload.newPassword || payload.newPassword.length < 8)
    return errEl.textContent = 'Nouveau mot de passe trop court (8 min).';

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
  grid.classList.add('hidden'); // floutée par défaut
  const words = phrase.split(/\s+/);
  words.forEach((w, i) => {
    const div = document.createElement('div');
    div.className = 'mnemonic-word';
    div.innerHTML = `<span class="num">${i + 1}.</span><span class="word">${w}</span>`;
    grid.appendChild(div);
  });

  $('#chk-mnemonic-saved').checked = false;
  $('#btn-mnemonic-continue').disabled = true;

  $('#chk-mnemonic-saved').onchange = (e) => {
    $('#btn-mnemonic-continue').disabled = !e.target.checked;
  };

  // Bouton "Maintenir pour afficher" — révèle la phrase tant qu'on appuie
  const revealBtn = $('#btn-mnemonic-reveal');
  const reveal = () => grid.classList.remove('hidden');
  const hide = () => grid.classList.add('hidden');
  revealBtn.onmousedown = reveal;
  revealBtn.onmouseup = hide;
  revealBtn.onmouseleave = hide;
  revealBtn.ontouchstart = (e) => { e.preventDefault(); reveal(); };
  revealBtn.ontouchend = hide;
  revealBtn.ontouchcancel = hide;

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
    <div class="kpi-grid" id="etude-home-kpis">
      <div class="kpi-card"><div class="kpi-label">Prix en base</div><div class="kpi-value">…</div></div>
      <div class="kpi-card"><div class="kpi-label">Compositions</div><div class="kpi-value">…</div></div>
      <div class="kpi-card"><div class="kpi-label">Devis</div><div class="kpi-value">…</div></div>
      <div class="kpi-card"><div class="kpi-label">Lots</div><div class="kpi-value">…</div></div>
    </div>`,

  // Pages avancées : on délègue au module dédié
  'etude-prices': null,  // gérée par EtudePricesPage.render()
  'etude-compos': null,
  'etude-quotes': null,
  'etude-index':  null
};

async function renderPage(pageId) {
  const content = $('#content');
  // Pages avancées : on délègue
  if (pageId === 'etude-prices' && window.EtudePricesPage) return window.EtudePricesPage.render(content);
  if (pageId === 'etude-compos' && window.EtudeComposPage) return window.EtudeComposPage.render(content);
  if (pageId === 'etude-quotes' && window.EtudeQuotesPage) return window.EtudeQuotesPage.render(content);
  if (pageId === 'etude-index'  && window.EtudeIndexPage)  return window.EtudeIndexPage.render(content);

  const renderer = PAGES[pageId];
  content.innerHTML = renderer ? renderer() : `<h1>Page inconnue</h1>`;

  // Cas spécial : home étude → on charge les vrais KPI
  if (pageId === 'etude-home') {
    try {
      const [pr, cr, qr, lr] = await Promise.all([
        window.api.etude.prices.list({}),
        window.api.etude.compos.list(),
        window.api.etude.quotes.list(),
        window.api.etude.lots.list()
      ]);
      const kpis = $('#etude-home-kpis');
      if (kpis) {
        const cells = kpis.querySelectorAll('.kpi-value');
        cells[0].textContent = pr.ok ? pr.total : '—';
        cells[1].textContent = cr.ok ? cr.data.length : '—';
        cells[2].textContent = qr.ok ? qr.data.length : '—';
        cells[3].textContent = lr.ok ? lr.data.length : '—';
      }
    } catch (_) {}
  }
}

// =========================================================================
// BOOT
// =========================================================================

window.addEventListener('DOMContentLoaded', async () => {
  setupTheme();
  bindAuthTabs();
  await bootAuth();

  $('#btn-signup').addEventListener('click', doSignup);
  $('#btn-login').addEventListener('click', doLogin);
  $('#btn-recover').addEventListener('click', doRecover);

  // Entrée pour valider
  $('#login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('#signup-password').addEventListener('keydown', e => { if (e.key === 'Enter') doSignup(); });
});
