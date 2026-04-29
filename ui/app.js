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
  // Phase 3 : challenge TOTP si activée pour cet utilisateur
  if (window.SecurityChallenge) {
    const ok = await window.SecurityChallenge.requireTotp('login');
    if (!ok) {
      // Refus → on déconnecte
      await window.api.auth.logout();
      currentUser = null;
      return errEl.textContent = 'Authentification 2FA refusée.';
    }
  }
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

  // Branchement des items du menu (du profil actif)
  const activeMenu = currentProfil === 'artisan' ? '#menu-artisan' : '#menu-etude';
  $$(activeMenu + ' .menu-item').forEach(btn => {
    btn.onclick = () => {
      $$(activeMenu + ' .menu-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderPage(btn.dataset.page);
    };
  });

  // Branchement des items data-page de la sidebar bottom (commune aux 2 profils)
  // ex: "Compte & sécurité"
  $$('.sidebar-bottom .menu-item[data-page]').forEach(btn => {
    btn.onclick = () => {
      // Désactive l'éventuel élément actif dans le menu principal
      $$(activeMenu + ' .menu-item').forEach(b => b.classList.remove('active'));
      // Active visuellement ce bouton
      $$('.sidebar-bottom .menu-item[data-page]').forEach(b => b.classList.remove('active'));
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
    <div class="kpi-grid" id="artisan-home-kpis">
      <div class="kpi-card"><div class="kpi-label">Devis reçus</div><div class="kpi-value">…</div></div>
      <div class="kpi-card"><div class="kpi-label">Chantiers en cours</div><div class="kpi-value">…</div></div>
      <div class="kpi-card"><div class="kpi-label">KPV global</div><div class="kpi-value">…</div></div>
      <div class="kpi-card"><div class="kpi-label">Matériel</div><div class="kpi-value">…</div></div>
      <div class="kpi-card"><div class="kpi-label">Fournisseurs</div><div class="kpi-value">…</div></div>
      <div class="kpi-card"><div class="kpi-label">Coût trajet/jour</div><div class="kpi-value">…</div></div>
    </div>`,

  // Pages avancées artisan : on délègue
  'artisan-kpv': null,
  'artisan-equipment': null,
  'artisan-suppliers': null,
  'artisan-logistic': null,
  'artisan-sites': null,
  'artisan-quotes-in': () => placeholder('📥 Devis reçus', 3,
    'Devis chiffrés reçus de l\'étude de prix sous forme de fichiers .ndev. Import par drag-drop ou via dossier surveillé. Statuts : Reçu → Lu → Accepté/Refusé/Modifications demandées.'),

  // ---- Étude ----
  'etude-home': () => `
    <h1>Tableau de bord — Étude de prix</h1>
    <p>Bienvenue ${escapeHtml(currentUser.displayName || currentUser.login)}.</p>
    <div class="kpi-grid" id="etude-home-kpis">
      <div class="kpi-card"><div class="kpi-label">Prix en base</div><div class="kpi-value">…</div></div>
      <div class="kpi-card"><div class="kpi-label">Compositions</div><div class="kpi-value">…</div></div>
      <div class="kpi-card"><div class="kpi-label">Devis</div><div class="kpi-value">…</div></div>
      <div class="kpi-card"><div class="kpi-label">Lots</div><div class="kpi-value">…</div></div>
      <div class="kpi-card"><div class="kpi-label">Matériel partagé</div><div class="kpi-value">…</div></div>
    </div>`,

  'etude-prices': null,
  'etude-compos': null,
  'etude-quotes': null,
  'etude-index':  null
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

async function renderPage(pageId) {
  const content = $('#content');

  // ---- Phase 3 : verrouillage licence ----
  // Pages Étude : licence "etude" requise
  if (pageId.startsWith('etude-') && pageId !== 'etude-home') {
    const lr = await window.api.security.license.status();
    if (lr.ok && !lr.hasEtude) return showLockedPage(content, 'Étude de prix', 'etude');
  }
  // Page Compta : licence "compta" requise + 2FA
  if (pageId === 'artisan-compta') {
    const lr = await window.api.security.license.status();
    if (lr.ok && !lr.hasCompta) return showLockedPage(content, 'Comptabilité', 'compta');
    // Challenge 2FA pour Compta (si activée)
    if (window.SecurityChallenge) {
      const ok = await window.SecurityChallenge.requireTotp('compta');
      if (!ok) return content.innerHTML = '<div class="loader">🔒 Accès refusé — utilise le menu pour aller ailleurs</div>';
    }
  }

  // Pages avancées : on délègue
  if (pageId === 'etude-prices'    && window.EtudePricesPage)    return window.EtudePricesPage.render(content);
  if (pageId === 'etude-compos'    && window.EtudeComposPage)    return window.EtudeComposPage.render(content);
  if (pageId === 'etude-quotes'    && window.EtudeQuotesPage)    return window.EtudeQuotesPage.render(content);
  if (pageId === 'etude-index'     && window.EtudeIndexPage)     return window.EtudeIndexPage.render(content);
  if (pageId === 'artisan-kpv'       && window.ArtisanKpvPage)       return window.ArtisanKpvPage.render(content);
  if (pageId === 'artisan-equipment' && window.ArtisanEquipmentPage) return window.ArtisanEquipmentPage.render(content);
  if (pageId === 'artisan-suppliers' && window.ArtisanSuppliersPage) return window.ArtisanSuppliersPage.render(content);
  if (pageId === 'artisan-logistic'  && window.ArtisanLogisticPage)  return window.ArtisanLogisticPage.render(content);
  if (pageId === 'artisan-sites'     && window.ArtisanSitesPage)     return window.ArtisanSitesPage.render(content);
  if (pageId === 'artisan-compta'    && window.ArtisanComptaPage)    return window.ArtisanComptaPage.render(content);
  if (pageId === 'artisan-quotes-in' && window.ArtisanReceivedPage)  return window.ArtisanReceivedPage.render(content);
  if (pageId === 'contacts'          && window.ContactsPage)         return window.ContactsPage.render(content);
  if (pageId === 'account'           && window.AccountPage)          return window.AccountPage.render(content);

  const renderer = PAGES[pageId];
  content.innerHTML = renderer ? renderer() : `<h1>Page inconnue</h1>`;

  // Cas spécial : home étude → on charge les vrais KPI
  if (pageId === 'etude-home') {
    try {
      const [pr, cr, qr, lr, er] = await Promise.all([
        window.api.etude.prices.list({}),
        window.api.etude.compos.list(),
        window.api.etude.quotes.list(),
        window.api.etude.lots.list(),
        window.api.artisan.equipment.list({})
      ]);
      const cells = $('#etude-home-kpis').querySelectorAll('.kpi-value');
      cells[0].textContent = pr.ok ? pr.total : '—';
      cells[1].textContent = cr.ok ? cr.data.length : '—';
      cells[2].textContent = qr.ok ? qr.data.length : '—';
      cells[3].textContent = lr.ok ? lr.data.length : '—';
      cells[4].textContent = er.ok ? er.data.length : '—';
    } catch (_) {}
  }
  // Cas spécial : home artisan → KPI Phase 2
  if (pageId === 'artisan-home') {
    try {
      const [kpv, sites, eq, sup, log] = await Promise.all([
        window.api.artisan.kpv.listAll(),
        window.api.artisan.sites.list(),
        window.api.artisan.equipment.list({}),
        window.api.artisan.suppliers.list(),
        window.api.artisan.logistic.get()
      ]);
      const cells = $('#artisan-home-kpis').querySelectorAll('.kpi-value');
      const enCours = sites.ok ? sites.data.filter(s => s.statut === 'en_cours').length : 0;
      cells[0].textContent = '—'; // Devis reçus = Phase 3
      cells[1].textContent = enCours;
      cells[2].textContent = kpv.ok ? '×' + (kpv.data.global_coef || 1).toFixed(3) : '—';
      cells[3].textContent = eq.ok ? eq.data.length : '—';
      cells[4].textContent = sup.ok ? sup.data.length : '—';
      cells[5].textContent = log.ok && log.computed ? log.computed.cout_total_jour.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €' : '—';
    } catch (_) {}
  }
}

// =========================================================================
// PHASE 3 — Page verrouillée (licence manquante)
// =========================================================================

function showLockedPage(content, moduleName, moduleKey) {
  content.innerHTML = `
    <div class="locked-page">
      <div style="font-size:64px;text-align:center">🔒</div>
      <h1 style="text-align:center">Module « ${moduleName} » verrouillé</h1>
      <p style="text-align:center;font-size:15px" class="muted">
        Pour accéder à ce module, tu dois importer un fichier de licence <code>.nelic</code> qui t'a été délivré par l'éditeur.
      </p>
      <div style="text-align:center;margin-top:24px">
        <button class="btn primary big" id="btn-go-account">📥 Aller à la page Compte & Sécurité</button>
      </div>
      <div style="text-align:center;margin-top:18px">
        <p class="muted small">Tu n'as pas encore de licence ? Contacte l'éditeur de l'application avec ton identifiant.</p>
      </div>
    </div>
  `;
  $('#btn-go-account').onclick = () => renderPage('account');
}

// Hook appelé par account.js quand une licence est importée/supprimée
window.App = window.App || {};
window.App.onLicenseChanged = () => {
  // Pas besoin de tout recharger : juste rafraîchir la sidebar pour que les éventuels indicateurs visuels se mettent à jour
  // Si on est sur une page verrouillée, on retourne sur la home
  // Pour simplifier, on ne fait rien ici — la page sera revérifiée au prochain clic
};

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
