// ui/account.js — Page Compte & Sécurité
// Sections : 2FA TOTP, Licences modulaires, Mode éditeur (admin)

(function () {
  const { $, $$, escapeHtml, formatEUR, formatNum, formatDate, toast, modal, confirmModal } = window.UI;

  let containerEl = null;

  async function refresh() {
    if (!containerEl) return;
    containerEl.innerHTML = '<div class="loader">Chargement…</div>';
    const [totpRes, licStatusRes, licListRes, edRes, idRes] = await Promise.all([
      window.api.security.totp.status(),
      window.api.security.license.status(),
      window.api.security.license.list(),
      window.api.security.editor.status(),
      window.api.security.identity.get()
    ]);
    const totp = totpRes.ok ? totpRes : { enabled: false, remainingRecovery: 0 };
    const licStatus = licStatusRes.ok ? licStatusRes : { hasEtude: false, hasCompta: false, modules: [] };
    const licenses = licListRes.ok ? licListRes.data : [];
    const editorActive = !!(edRes.ok && edRes.active);
    const myId = idRes.ok ? idRes : null;
    render({ totp, licStatus, licenses, editorActive, myId });
  }

  function render({ totp, licStatus, licenses, editorActive, myId }) {
    containerEl.innerHTML = `
      <div class="page-header">
        <h1>🔐 Compte & Sécurité</h1>
      </div>

      <div class="card-block">
        <h3>👤 Mon identité (échange de devis chiffrés)</h3>
        <p class="muted small">Ta clé publique permet à un Bureau d'Études de t'envoyer des devis chiffrés .ndev. Donne-la à tes partenaires (par email, QR code, ou copier-coller).</p>
        ${myId ? `
          <label>Libellé affiché aux destinataires
            <input id="id-label" value="${escapeHtml(myId.label || '')}" placeholder="ex: ton nom + nom de l'entreprise">
          </label>
          <label class="full" style="margin-top:10px">Ta clé publique (à partager)
            <textarea id="id-pub" readonly rows="3" style="font-family:monospace;font-size:11px;background:var(--bg-2)">${escapeHtml(myId.pub_shareable)}</textarea>
          </label>
          <div class="form-row" style="margin-top:10px;flex-wrap:wrap">
            <button class="btn ghost" id="btn-id-copy">📋 Copier</button>
            <button class="btn ghost" id="btn-id-qr">📱 Voir en QR Code</button>
            <button class="btn ghost" id="btn-id-save" style="margin-left:auto">💾 Enregistrer libellé</button>
            <button class="btn danger" id="btn-id-regen">🔄 Régénérer (rompt les anciens partages)</button>
          </div>
        ` : '<p class="muted">Identité non disponible</p>'}
      </div>

      <div class="card-block">
        <h3>📱 Authentification à deux facteurs (TOTP)</h3>
        <p class="muted small">La 2FA ajoute un code à 6 chiffres généré par ton téléphone (Google Authenticator, Authy, Bitwarden, Microsoft Authenticator, 1Password). Demandée au login et à l'ouverture du module Compta (1 fois par session).</p>
        ${totp.enabled ? `
          <div class="status-box ok">
            ✅ <strong>TOTP activée</strong> — Codes de récupération restants : ${totp.remainingRecovery} / 8
            ${totp.remainingRecovery <= 2 ? '<br><span style="color:var(--warning)">⚠️ Plus que ' + totp.remainingRecovery + ' codes — pense à en regénérer un nouveau lot</span>' : ''}
          </div>
          <div class="form-row" style="margin-top:10px">
            <button class="btn ghost" id="btn-regen-recov">🔄 Régénérer codes de récupération</button>
            <button class="btn danger" id="btn-disable-totp">🗑 Désactiver la 2FA</button>
          </div>
        ` : `
          <div class="status-box warn">
            ⚠️ <strong>TOTP désactivée</strong> — Active-la pour sécuriser ton compte
          </div>
          <button class="btn primary" id="btn-setup-totp" style="margin-top:10px">📱 Activer la 2FA</button>
        `}
      </div>

      <div class="card-block">
        <h3>🎫 Licences modulaires</h3>
        <p class="muted small">Modules débloqués par les licences importées (.nelic). Si tu n'as pas accès à un module, importe le fichier .nelic correspondant.</p>
        <div class="kpi-grid" style="grid-template-columns:1fr 1fr;gap:10px;margin:10px 0">
          <div class="kpi-card"><div class="kpi-label">Étude de prix</div><div class="kpi-value">${licStatus.hasEtude ? '<span style="color:var(--success)">✅ Débloqué</span>' : '<span style="color:var(--danger)">🔒 Verrouillé</span>'}</div></div>
          <div class="kpi-card"><div class="kpi-label">Comptabilité</div><div class="kpi-value">${licStatus.hasCompta ? '<span style="color:var(--success)">✅ Débloqué</span>' : '<span style="color:var(--danger)">🔒 Verrouillé</span>'}</div></div>
        </div>

        <div class="form-row" style="margin:14px 0">
          <button class="btn primary" id="btn-import-lic">📥 Importer un fichier .nelic</button>
        </div>

        <h4 style="margin-top:14px">Licences importées (${licenses.length})</h4>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr>
              <th>Émis pour</th>
              <th>Modules</th>
              <th class="center">Émis le</th>
              <th class="center">Expire</th>
              <th class="center" style="width:60px"></th>
            </tr></thead>
            <tbody>${licenses.length ? licenses.map(l => `
              <tr data-id="${l.id}">
                <td>${escapeHtml(l.user_name || '—')}</td>
                <td>${l.modules.map(m => `<span class="badge ${m === 'compta' ? 'badge-warn' : 'badge-info'}">${escapeHtml(m)}</span>`).join(' ')}</td>
                <td class="center small">${l.issued_at ? formatDate(l.issued_at).split(' ')[0] : '—'}</td>
                <td class="center small">${l.expires_at ? formatDate(l.expires_at).split(' ')[0] : '<span class="muted">jamais</span>'}</td>
                <td class="center"><button class="btn-icon danger" data-action="del-lic">🗑</button></td>
              </tr>
            `).join('') : '<tr><td colspan="5" class="empty">Aucune licence importée — les modules Étude et Compta sont verrouillés</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      ${editorActive ? `
        <div class="card-block" style="border:2px solid var(--warning)">
          <h3>🛠 Mode éditeur (admin)</h3>
          <div class="status-box ok">✅ Mode éditeur ACTIVÉ — Tu peux générer des fichiers .nelic</div>
          <div class="form-row" style="margin-top:10px">
            <button class="btn primary" id="btn-gen-lic">+ Générer une nouvelle licence .nelic</button>
            <button class="btn ghost" id="btn-deactivate-editor">🚪 Désactiver le mode éditeur</button>
          </div>
        </div>
      ` : `
        <div class="card-block">
          <h3>🛠 Mode éditeur (admin)</h3>
          <p class="muted small">Si tu es l'éditeur de cette application, tu peux importer ta clé privée maître pour activer le mode éditeur et générer des licences .nelic.</p>
          <button class="btn ghost" id="btn-activate-editor">🔑 Activer le mode éditeur</button>
        </div>
      `}

      <div class="card-block">
        <h3>💾 Sauvegarde & transfert entre postes</h3>
        <p class="muted small">Exporte toutes tes données (base de prix, devis, compositions, chantiers, etc.) dans un fichier <code>.nbak</code> chiffré. Importe ce fichier sur un autre poste via l'onglet "Restaurer" de l'écran de connexion.</p>
        <div class="status-box warn" style="margin-bottom:12px">
          ⚠️ Le fichier de sauvegarde est chiffré avec ta clé de session — tu auras besoin de ton mot de passe pour le restaurer.
        </div>
        <button class="btn primary" id="btn-backup-export">⬇️ Exporter une sauvegarde (.nbak)</button>
        <p id="backup-export-status" class="muted small" style="margin-top:8px"></p>
      </div>

      <div class="card-block about-block">
        <h3>ℹ️ À propos</h3>
        <p>
          <strong>Nucléar Estim</strong> — Logiciel de chiffrage d'opérations et études de prix BTP.<br>
          <span class="muted small">Version <span id="about-version">…</span></span>
        </p>
        <p class="muted small" style="margin-top:8px">
          Conçu et développé par <strong>Nathan RAMEDACE</strong>.<br>
          © 2026 — Tous droits réservés.
        </p>
      </div>
    `;

    // BIND : TOTP
    const btnSetup = $('#btn-setup-totp');
    if (btnSetup) btnSetup.onclick = openTotpSetupModal;
    const btnDisable = $('#btn-disable-totp');
    if (btnDisable) btnDisable.onclick = openTotpDisableModal;
    const btnRegen = $('#btn-regen-recov');
    if (btnRegen) btnRegen.onclick = openRegenRecoveryModal;

    // BIND : Identité
    const btnIdCopy = $('#btn-id-copy');
    if (btnIdCopy && myId) {
      btnIdCopy.onclick = () => navigator.clipboard.writeText(myId.pub_shareable).then(() => toast('Clé copiée', 'success'));
    }
    const btnIdQr = $('#btn-id-qr');
    if (btnIdQr && myId) {
      btnIdQr.onclick = async () => {
        const r = await window.api.security.identity.qrcode({ text: myId.pub_shareable });
        if (!r.ok) return toast(r.error, 'danger');
        modal({
          title: '📱 Mon identité en QR Code',
          content: `
            <p class="muted small">Le destinataire peut scanner ce QR avec son téléphone, ou utiliser l'image directement.</p>
            <div style="text-align:center"><img src="${r.dataUrl}" alt="QR" style="width:280px;background:white;padding:8px;border-radius:8px"></div>
            <p class="small" style="text-align:center;margin-top:10px"><strong>${escapeHtml(myId.label || '—')}</strong></p>
          `,
          footer: '<button class="btn primary" data-action="close">Fermer</button>',
          onMount: ({ footer, close }) => { footer.querySelector('[data-action="close"]').onclick = () => close(true); }
        });
      };
    }
    const btnIdSave = $('#btn-id-save');
    if (btnIdSave) {
      btnIdSave.onclick = async () => {
        const lbl = $('#id-label').value.trim();
        const r = await window.api.security.identity.setLabel({ label: lbl });
        if (r.ok) { toast('Libellé enregistré', 'success'); refresh(); }
        else toast(r.error, 'danger');
      };
    }
    const btnIdRegen = $('#btn-id-regen');
    if (btnIdRegen) {
      btnIdRegen.onclick = async () => {
        if (!await confirmModal('Régénérer ta clé d\'identité ?',
          'Tous les BE qui ont ton ancienne clé publique ne pourront plus t\'envoyer de devis. Tu devras leur communiquer ta nouvelle clé.')) return;
        const lbl = $('#id-label').value.trim();
        const r = await window.api.security.identity.regenerate({ label: lbl });
        if (r.ok) { toast('Identité régénérée', 'success'); refresh(); }
        else toast(r.error, 'danger');
      };
    }

    // BIND : Licences
    $('#btn-import-lic').onclick = openLicenseImportModal;
    $$('[data-action="del-lic"]').forEach(btn => {
      btn.onclick = async () => {
        const id = parseInt(btn.closest('tr').dataset.id, 10);
        if (await confirmModal('Supprimer cette licence ?', 'Tu pourras toujours la ré-importer si tu as encore le fichier .nelic.')) {
          const r = await window.api.security.license.delete({ id });
          if (r.ok) { toast('Licence supprimée', 'success'); refresh(); }
        }
      };
    });

    // BIND : Mode éditeur
    const btnEditAct = $('#btn-activate-editor');
    if (btnEditAct) btnEditAct.onclick = openEditorActivateModal;
    const btnEditDeact = $('#btn-deactivate-editor');
    if (btnEditDeact) btnEditDeact.onclick = async () => {
      if (await confirmModal('Désactiver le mode éditeur ?', 'Tu ne pourras plus générer de licences. Tu pourras réactiver en réimportant la clé privée maître.')) {
        const r = await window.api.security.editor.deactivate();
        if (r.ok) { toast('Mode éditeur désactivé', 'success'); refresh(); }
      }
    };
    const btnGenLic = $('#btn-gen-lic');
    if (btnGenLic) btnGenLic.onclick = openGenerateLicenseModal;

    // BIND : Sauvegarde
    const btnBackup = $('#btn-backup-export');
    if (btnBackup) {
      btnBackup.onclick = async () => {
        btnBackup.disabled = true;
        const statusEl = $('#backup-export-status');
        statusEl.textContent = 'Export en cours…';
        const r = await window.api.backup.export();
        btnBackup.disabled = false;
        if (r.canceled) {
          statusEl.textContent = '';
        } else if (!r.ok) {
          statusEl.innerHTML = `<span style="color:var(--danger)">❌ ${escapeHtml(r.error)}</span>`;
        } else {
          statusEl.innerHTML = `<span style="color:var(--success)">✅ Sauvegarde exportée : ${escapeHtml(r.path)}</span>`;
        }
      };
    }

    // Affichage de la version
    if (window.api.app && window.api.app.version) {
      window.api.app.version().then(v => {
        const el = $('#about-version');
        if (el && v) el.textContent = v;
      });
    }
  }

  // -----------------------------------------------------------------------
  // TOTP SETUP : afficher QR + saisir code de confirmation
  // -----------------------------------------------------------------------
  async function openTotpSetupModal() {
    const r = await window.api.security.totp.setupBegin();
    if (!r.ok) return toast('Erreur : ' + r.error, 'danger');
    return modal({
      title: '📱 Activation de la 2FA',
      large: true,
      content: `
        <div style="display:grid;grid-template-columns:auto 1fr;gap:20px;align-items:start">
          <img src="${r.qrDataUrl}" alt="QR Code" style="width:240px;height:240px;background:white;padding:8px;border-radius:8px">
          <div>
            <h4 style="margin-top:0">1. Scanne ce QR code</h4>
            <p>Avec ton app d'authentification : <strong>Google Authenticator</strong>, <strong>Authy</strong>, <strong>Bitwarden</strong>, <strong>Microsoft Authenticator</strong>, <strong>1Password</strong>…</p>
            <details>
              <summary class="muted small">Saisie manuelle si scan impossible</summary>
              <p class="small" style="margin:8px 0">
                <strong>Compte :</strong> Nuclear Estim<br>
                <strong>Clé secrète :</strong>
                <code style="display:block;padding:6px;background:var(--bg-2);border-radius:4px;font-family:monospace;word-break:break-all;margin-top:4px">${r.secretBase32}</code>
                <strong>Type :</strong> TOTP · 6 chiffres · 30 secondes · SHA1
              </p>
            </details>
            <h4 style="margin-top:18px">2. Saisis le code à 6 chiffres affiché par l'app</h4>
            <input id="totp-code" type="text" placeholder="000000" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off"
                   style="font-size:24px;letter-spacing:6px;text-align:center;font-family:monospace;width:200px">
          </div>
        </div>
      `,
      footer: `
        <button class="btn ghost" data-action="cancel">Annuler</button>
        <button class="btn primary" data-action="confirm">Confirmer et activer</button>
      `,
      onMount: ({ body, footer, close }) => {
        const inp = body.querySelector('#totp-code');
        inp.focus();
        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);
        footer.querySelector('[data-action="confirm"]').onclick = async () => {
          const code = inp.value.trim();
          if (!/^\d{6}$/.test(code)) return toast('Code à 6 chiffres requis', 'danger');
          const cr = await window.api.security.totp.setupConfirm({ secretB64: r.secret, code });
          if (!cr.ok) return toast('❌ ' + cr.error, 'danger');
          close(true);
          showRecoveryCodesModal(cr.recoveryCodes, true);
        };
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') footer.querySelector('[data-action="confirm"]').click(); });
      }
    });
  }

  function showRecoveryCodesModal(codes, firstTime = false) {
    return modal({
      title: '🔑 Codes de récupération',
      content: `
        <p>${firstTime ? '<strong>Ta 2FA est activée !</strong><br>' : ''}Ces 8 codes te permettront d'accéder à ton compte si tu perds ton téléphone. <strong style="color:var(--warning)">Imprime-les ou copie-les dans un endroit sûr (gestionnaire de mots de passe, papier dans un coffre).</strong></p>
        <p class="muted small">⚠️ Chaque code n'est utilisable qu'une seule fois.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:16px 0;background:var(--bg-2);padding:14px;border-radius:8px;font-family:monospace">
          ${codes.map(c => `<div style="font-size:18px;letter-spacing:2px;padding:6px;background:var(--bg-1);border-radius:4px;text-align:center">${escapeHtml(c)}</div>`).join('')}
        </div>
        <div class="form-row">
          <button class="btn ghost" id="btn-copy-codes">📋 Copier dans le presse-papier</button>
        </div>
      `,
      footer: `<button class="btn primary" data-action="close">J'ai sauvegardé mes codes</button>`,
      onMount: ({ body, footer, close }) => {
        body.querySelector('#btn-copy-codes').onclick = () => {
          const txt = 'Nuclear Estim — Codes de récupération 2FA\n\n' + codes.join('\n') + '\n\n⚠️ Chaque code n\'est utilisable qu\'une seule fois.';
          navigator.clipboard.writeText(txt).then(() => toast('Copié', 'success'));
        };
        footer.querySelector('[data-action="close"]').onclick = () => { close(true); refresh(); };
      }
    });
  }

  function openTotpDisableModal() {
    return modal({
      title: 'Désactiver la 2FA',
      content: `
        <p>Cette action désactive la double authentification de ton compte. Pour confirmer, saisis ton mot de passe actuel.</p>
        <label>Mot de passe<input id="d-pwd" type="password" autocomplete="current-password"></label>
      `,
      footer: `
        <button class="btn ghost" data-action="cancel">Annuler</button>
        <button class="btn danger" data-action="ok">Désactiver</button>
      `,
      onMount: ({ body, footer, close }) => {
        body.querySelector('#d-pwd').focus();
        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);
        footer.querySelector('[data-action="ok"]').onclick = async () => {
          const pwd = body.querySelector('#d-pwd').value;
          if (!pwd) return toast('Mot de passe requis', 'danger');
          const r = await window.api.security.totp.disable({ password: pwd });
          if (!r.ok) return toast(r.error, 'danger');
          toast('2FA désactivée', 'success'); close(true); refresh();
        };
      }
    });
  }

  function openRegenRecoveryModal() {
    return modal({
      title: 'Régénérer les codes de récupération',
      content: `
        <p>Tes anciens codes seront immédiatement invalidés. Saisis ton mot de passe pour confirmer.</p>
        <label>Mot de passe<input id="d-pwd" type="password" autocomplete="current-password"></label>
      `,
      footer: `
        <button class="btn ghost" data-action="cancel">Annuler</button>
        <button class="btn primary" data-action="ok">Régénérer</button>
      `,
      onMount: ({ body, footer, close }) => {
        body.querySelector('#d-pwd').focus();
        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);
        footer.querySelector('[data-action="ok"]').onclick = async () => {
          const pwd = body.querySelector('#d-pwd').value;
          if (!pwd) return toast('Mot de passe requis', 'danger');
          const r = await window.api.security.totp.regenRecovery({ password: pwd });
          if (!r.ok) return toast(r.error, 'danger');
          close(true);
          showRecoveryCodesModal(r.recoveryCodes, false);
        };
      }
    });
  }

  // -----------------------------------------------------------------------
  // LICENCES — Import .nelic
  // -----------------------------------------------------------------------
  function openLicenseImportModal() {
    return modal({
      title: '📥 Importer une licence .nelic',
      content: `
        <p class="muted small">Glisse-dépose le fichier .nelic envoyé par l'éditeur, ou clique pour choisir.</p>
        <div id="drop-zone" style="border:2px dashed var(--border);padding:40px;text-align:center;border-radius:8px;cursor:pointer;background:var(--bg-2)">
          <div style="font-size:48px">📄</div>
          <p>Glisse ton fichier .nelic ici<br><span class="muted small">ou clique pour parcourir</span></p>
          <input type="file" id="lic-file" accept=".nelic,.json,application/json" style="display:none">
        </div>
        <div id="lic-preview" style="margin-top:12px"></div>
      `,
      footer: `
        <button class="btn ghost" data-action="cancel">Annuler</button>
        <button class="btn primary" data-action="import" disabled>Importer</button>
      `,
      onMount: ({ body, footer, close }) => {
        const dz = body.querySelector('#drop-zone');
        const fi = body.querySelector('#lic-file');
        const preview = body.querySelector('#lic-preview');
        const btnImport = footer.querySelector('[data-action="import"]');
        let parsedContent = null;

        const tryParse = async (file) => {
          const txt = await file.text();
          try {
            const obj = JSON.parse(txt);
            parsedContent = txt;
            preview.innerHTML = `
              <div class="status-box ok" style="text-align:left">
                ✅ Fichier reconnu :<br>
                <strong>Pour :</strong> ${escapeHtml(obj.user_name || '—')}<br>
                <strong>Modules :</strong> ${(obj.modules || []).join(', ')}<br>
                <strong>Émis le :</strong> ${obj.issued_at ? new Date(obj.issued_at).toLocaleDateString('fr-FR') : '—'}<br>
                <strong>Expire :</strong> ${obj.expires_at ? new Date(obj.expires_at).toLocaleDateString('fr-FR') : 'jamais'}
              </div>
            `;
            btnImport.disabled = false;
          } catch (_) {
            preview.innerHTML = '<div class="status-box err">❌ Fichier invalide (pas un JSON .nelic)</div>';
            btnImport.disabled = true;
          }
        };

        dz.onclick = () => fi.click();
        fi.onchange = (e) => { if (e.target.files[0]) tryParse(e.target.files[0]); };
        dz.ondragover = (e) => { e.preventDefault(); dz.style.borderColor = 'var(--primary)'; };
        dz.ondragleave = () => { dz.style.borderColor = 'var(--border)'; };
        dz.ondrop = (e) => {
          e.preventDefault(); dz.style.borderColor = 'var(--border)';
          if (e.dataTransfer.files[0]) tryParse(e.dataTransfer.files[0]);
        };

        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);
        btnImport.onclick = async () => {
          if (!parsedContent) return;
          const r = await window.api.security.license.import({ content: parsedContent });
          if (!r.ok) return toast('❌ ' + r.error, 'danger');
          toast('✅ Licence importée — modules débloqués', 'success');
          close(true);
          refresh();
          // Notifier app.js pour qu'il recharge la sidebar
          if (window.App && window.App.onLicenseChanged) window.App.onLicenseChanged();
        };
      }
    });
  }

  // -----------------------------------------------------------------------
  // MODE ÉDITEUR — Activation
  // -----------------------------------------------------------------------
  function openEditorActivateModal() {
    return modal({
      title: '🔑 Activer le mode éditeur',
      content: `
        <p class="muted small">Colle ta clé privée maître Ed25519 (base64). Cette clé est stockée chiffrée localement et permet de générer des fichiers .nelic.</p>
        <div class="status-box warn">⚠️ La clé privée doit correspondre à la clé publique embarquée dans cette version de l'app. Si elle ne correspond pas, l'activation sera refusée.</div>
        <label class="full">Clé privée maître (base64)
          <textarea id="ed-priv" rows="3" placeholder="MC4CAQAwBQYDK2VwBCIEI..." style="font-family:monospace;font-size:12px"></textarea>
        </label>
      `,
      footer: `
        <button class="btn ghost" data-action="cancel">Annuler</button>
        <button class="btn primary" data-action="ok">Activer</button>
      `,
      onMount: ({ body, footer, close }) => {
        body.querySelector('#ed-priv').focus();
        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);
        footer.querySelector('[data-action="ok"]').onclick = async () => {
          const key = body.querySelector('#ed-priv').value.trim();
          if (!key) return toast('Clé privée requise', 'danger');
          const r = await window.api.security.editor.activate({ privateKeyB64: key });
          if (!r.ok) return toast('❌ ' + r.error, 'danger');
          toast('✅ Mode éditeur activé', 'success');
          close(true); refresh();
        };
      }
    });
  }

  // -----------------------------------------------------------------------
  // MODE ÉDITEUR — Génération de licence .nelic
  // -----------------------------------------------------------------------
  function openGenerateLicenseModal() {
    const today = new Date().toISOString().split('T')[0];
    return modal({
      title: '+ Générer une licence .nelic',
      large: true,
      content: `
        <div class="form-grid">
          <label class="full">Émis pour (nom du destinataire) *
            <input id="g-name" placeholder="ex: nom + raison sociale du client">
          </label>
          <label class="full">Identifiant unique
            <input id="g-uid" placeholder="ex: client-001 (laisse vide pour auto)">
          </label>
          <label>Modules autorisés *</label>
          <div></div>
          <label class="checkbox" style="grid-column:1/-1">
            <input type="checkbox" id="g-mod-etude" checked>
            <span><strong>Étude de prix</strong> — devis, lots, compositions, KPV</span>
          </label>
          <label class="checkbox" style="grid-column:1/-1">
            <input type="checkbox" id="g-mod-compta" checked>
            <span><strong>Comptabilité</strong> — recettes/dépenses, situations, déclarations TVA</span>
          </label>
          <label>Date d'expiration (vide = jamais)
            <input id="g-exp" type="date">
          </label>
          <label class="full">Note interne (optionnel, visible nulle part sauf à toi)
            <input id="g-note" placeholder="ex: Achat — Facture n°XXX">
          </label>
        </div>
      `,
      footer: `
        <button class="btn ghost" data-action="cancel">Annuler</button>
        <button class="btn primary" data-action="generate">Générer .nelic</button>
      `,
      onMount: ({ body, footer, close }) => {
        body.querySelector('#g-name').focus();
        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);
        footer.querySelector('[data-action="generate"]').onclick = async () => {
          const modules = [];
          if (body.querySelector('#g-mod-etude').checked) modules.push('etude');
          if (body.querySelector('#g-mod-compta').checked) modules.push('compta');
          if (modules.length === 0) return toast('Au moins un module', 'danger');
          const name = body.querySelector('#g-name').value.trim();
          if (!name) return toast('Nom du destinataire requis', 'danger');
          const expVal = body.querySelector('#g-exp').value;
          const params = {
            user_id: body.querySelector('#g-uid').value.trim() || ('user-' + Date.now()),
            user_name: name,
            modules,
            expires_at: expVal ? new Date(expVal).getTime() : null,
            issuer_note: body.querySelector('#g-note').value.trim()
          };
          const r = await window.api.security.editor.generateLicense(params);
          if (!r.ok) return toast('❌ ' + r.error, 'danger');
          close(true);
          showGeneratedLicenseModal(r.license);
        };
      }
    });
  }

  function showGeneratedLicenseModal(lic) {
    const json = JSON.stringify(lic, null, 2);
    return modal({
      title: '✅ Licence générée',
      large: true,
      content: `
        <p>Licence pour <strong>${escapeHtml(lic.user_name)}</strong> — modules : ${(lic.modules || []).join(', ')}</p>
        <p class="muted small">Télécharge le fichier .nelic ci-dessous et envoie-le au destinataire (par email, clé USB, etc.).</p>
        <textarea readonly rows="10" style="font-family:monospace;font-size:11px;width:100%;background:var(--bg-2)">${escapeHtml(json)}</textarea>
        <div class="form-row" style="margin-top:12px">
          <button class="btn primary" id="btn-dl">⬇ Télécharger .nelic</button>
          <button class="btn ghost" id="btn-cp">📋 Copier le contenu</button>
        </div>
      `,
      footer: `<button class="btn ghost" data-action="close">Fermer</button>`,
      onMount: ({ body, footer, close }) => {
        body.querySelector('#btn-dl').onclick = () => {
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${(lic.user_name || 'licence').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.nelic`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 100);
          toast('Téléchargé', 'success');
        };
        body.querySelector('#btn-cp').onclick = () => {
          navigator.clipboard.writeText(json).then(() => toast('Copié', 'success'));
        };
        footer.querySelector('[data-action="close"]').onclick = () => close(true);
      }
    });
  }

  window.AccountPage = {
    async render(container) {
      containerEl = container;
      await refresh();
    }
  };
})();
