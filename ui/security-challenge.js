// ui/security-challenge.js — Modales challenge TOTP (login + compta)
//
// Usage :
//   const ok = await window.SecurityChallenge.requireTotp('login');  // au login
//   const ok = await window.SecurityChallenge.requireTotp('compta'); // entrée compta

(function () {
  const { $, modal, toast } = window.UI;

  // Affiche la modale challenge TOTP, retourne true si validé, false sinon
  async function challengeModal(context) {
    const titles = {
      login: '🔐 Authentification à deux facteurs',
      compta: '🔐 Accès au module Comptabilité'
    };
    const subtitles = {
      login: 'Saisis le code à 6 chiffres affiché par ton app d\'authentification.',
      compta: 'Le module Compta exige une 2e authentification. Saisis le code à 6 chiffres affiché par ton app.'
    };
    return new Promise((resolve) => {
      modal({
        title: titles[context] || titles.login,
        content: `
          <p class="muted small">${subtitles[context] || subtitles.login}</p>
          <input id="ch-code" type="text" placeholder="000000" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"
                 style="font-size:28px;letter-spacing:8px;text-align:center;font-family:monospace;width:240px;display:block;margin:18px auto">
          <p class="muted small" style="text-align:center">
            Tu peux aussi utiliser un <a href="#" id="use-recov">code de récupération (XXXX-XXXX)</a>.
          </p>
        `,
        footer: `
          <button class="btn ghost" data-action="cancel">Annuler</button>
          <button class="btn primary" data-action="ok">Valider</button>
        `,
        backdropClose: false,
        onMount: ({ body, footer, close }) => {
          const inp = body.querySelector('#ch-code');
          inp.focus();

          body.querySelector('#use-recov').onclick = (e) => {
            e.preventDefault();
            inp.placeholder = 'XXXX-XXXX';
            inp.style.letterSpacing = '4px';
            inp.style.fontSize = '20px';
            inp.maxLength = 9;
            inp.removeAttribute('pattern');
            inp.removeAttribute('inputmode');
            inp.value = '';
            inp.focus();
          };

          const submit = async () => {
            const code = inp.value.trim();
            if (!code) return toast('Code requis', 'danger');
            const r = await window.api.security.totp.verify({ code, context });
            if (!r.ok) return toast('❌ ' + r.error, 'danger');
            if (r.usedRecovery) toast('Code de récupération utilisé — pense à en regénérer', 'warning');
            close(true);
            resolve(true);
          };

          inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
          footer.querySelector('[data-action="cancel"]').onclick = () => { close(null); resolve(false); };
          footer.querySelector('[data-action="ok"]').onclick = submit;
        }
      });
    });
  }

  // Demande TOTP pour un contexte si nécessaire (vérifie d'abord si déjà validé pour la session)
  async function requireTotp(context) {
    const r = await window.api.security.totp.status();
    if (!r.ok || !r.enabled) return true; // pas activée → pas de challenge
    if (context === 'login' && r.sessionVerified) return true;
    if (context === 'compta' && r.comptaVerified) return true;
    return await challengeModal(context);
  }

  window.SecurityChallenge = { requireTotp, challengeModal };
})();
