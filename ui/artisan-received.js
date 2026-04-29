// ui/artisan-received.js — Devis reçus chiffrés (.ndev) côté Artisan
(function () {
  const { $, $$, escapeHtml, formatEUR, formatNum, formatDate, toast, modal, confirmModal } = window.UI;

  let containerEl = null;
  let received = [];

  async function refresh() {
    const r = await window.api.ndev.receivedList();
    if (r.ok) received = r.data;
    render();
  }

  function statutBadge(s) {
    const map = {
      nouveau: '<span class="badge" style="background:rgba(91,141,239,0.2);color:#5b8def">🆕 Nouveau</span>',
      lu: '<span class="badge" style="background:rgba(160,160,160,0.2);color:var(--text-muted)">👁 Lu</span>',
      accepte: '<span class="badge" style="background:rgba(0,180,100,0.2);color:var(--success)">✅ Accepté</span>',
      refuse: '<span class="badge" style="background:rgba(225,90,90,0.2);color:var(--danger)">❌ Refusé</span>'
    };
    return map[s] || s;
  }

  function render() {
    if (!containerEl) return;
    const rows = received.length ? received.map(r => `
      <tr data-id="${r.id}">
        <td class="small">${formatDate(r.received_at).split(' ')[0]}</td>
        <td>${escapeHtml(r.subject || '—')}</td>
        <td class="small">${escapeHtml(r.sender_label || '—')}</td>
        <td class="center">${statutBadge(r.statut)}</td>
        <td class="center actions">
          <button class="btn-icon" data-action="view" title="Consulter">👁</button>
          <button class="btn-icon danger" data-action="delete" title="Supprimer">🗑</button>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="5" class="empty">Aucun devis reçu. Importe un fichier .ndev avec le bouton ci-dessus.</td></tr>';

    containerEl.innerHTML = `
      <div class="page-header">
        <h1>📥 Devis reçus</h1>
        <div class="page-actions">
          <button class="btn primary" id="btn-import">📥 Importer un .ndev</button>
        </div>
      </div>
      <p class="muted small">Devis chiffrés envoyés par des Bureaux d'Études. Pour qu'un BE puisse t'envoyer un devis, il doit avoir ta clé publique (visible dans <strong>🔐 Compte & sécurité → Mon identité</strong>).</p>

      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th style="width:90px">Reçu le</th>
            <th>Sujet</th>
            <th>De</th>
            <th class="center" style="width:100px">Statut</th>
            <th class="center" style="width:90px">Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    $('#btn-import').onclick = openImportModal;
    $$('[data-action="view"]').forEach(btn => {
      btn.onclick = () => {
        const id = parseInt(btn.closest('tr').dataset.id, 10);
        openViewModal(id);
      };
    });
    $$('[data-action="delete"]').forEach(btn => {
      btn.onclick = async () => {
        const id = parseInt(btn.closest('tr').dataset.id, 10);
        const r = received.find(x => x.id === id);
        if (await confirmModal('Supprimer ce devis reçu ?', r.subject || '')) {
          const res = await window.api.ndev.receivedDelete({ id });
          if (res.ok) { toast('Supprimé', 'success'); refresh(); }
        }
      };
    });
  }

  function openImportModal() {
    return modal({
      title: '📥 Importer un fichier .ndev',
      content: `
        <p class="muted small">Glisse-dépose le fichier .ndev reçu de ton BE, ou clique pour choisir.</p>
        <div id="drop-zone" style="border:2px dashed var(--border);padding:40px;text-align:center;border-radius:8px;cursor:pointer;background:var(--bg-2)">
          <div style="font-size:48px">🔐</div>
          <p>Glisse ton fichier .ndev ici<br><span class="muted small">ou clique pour parcourir</span></p>
          <input type="file" id="ndev-file" accept=".ndev,.json,application/json" style="display:none">
        </div>
        <div id="ndev-status" style="margin-top:12px"></div>
      `,
      footer: `<button class="btn ghost" data-action="close">Fermer</button>`,
      onMount: ({ body, footer, close }) => {
        const dz = body.querySelector('#drop-zone');
        const fi = body.querySelector('#ndev-file');
        const status = body.querySelector('#ndev-status');

        const importFile = async (file) => {
          const txt = await file.text();
          const r = await window.api.ndev.import({ content: txt });
          if (!r.ok) {
            status.innerHTML = `<div class="status-box err">❌ ${escapeHtml(r.error)}</div>`;
            return;
          }
          status.innerHTML = `<div class="status-box ok">✅ Devis importé : <strong>${escapeHtml(r.data.subject)}</strong> de <strong>${escapeHtml(r.data.from || '—')}</strong></div>`;
          toast('Devis reçu importé', 'success');
          refresh();
        };

        dz.onclick = () => fi.click();
        fi.onchange = (e) => { if (e.target.files[0]) importFile(e.target.files[0]); };
        dz.ondragover = (e) => { e.preventDefault(); dz.style.borderColor = 'var(--primary)'; };
        dz.ondragleave = () => { dz.style.borderColor = 'var(--border)'; };
        dz.ondrop = (e) => {
          e.preventDefault(); dz.style.borderColor = 'var(--border)';
          if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]);
        };
        footer.querySelector('[data-action="close"]').onclick = () => close(true);
      }
    });
  }

  async function openViewModal(id) {
    const r = await window.api.ndev.receivedGet({ id });
    if (!r.ok) return toast(r.error, 'danger');
    const rq = r.data;
    const p = rq.payload || {};
    const lastVer = p.versions && p.versions.length ? p.versions[p.versions.length - 1] : null;

    const linesHtml = lastVer && lastVer.lignes ? `
      <table class="data-table">
        <thead><tr>
          <th>Désignation</th>
          <th class="right" style="width:60px">Qté</th>
          <th class="right" style="width:90px">P.U. HT</th>
          <th class="right" style="width:100px">Total HT</th>
        </tr></thead>
        <tbody>${lastVer.lignes.map(l => `
          <tr>
            <td>${escapeHtml(l.designation || '—')}</td>
            <td class="right">${formatNum(l.quantite || 0, 2)}</td>
            <td class="right">${formatEUR(l.prix_unitaire || 0)}</td>
            <td class="right"><strong>${formatEUR((l.quantite || 0) * (l.prix_unitaire || 0))}</strong></td>
          </tr>
        `).join('')}</tbody>
      </table>
    ` : '<p class="muted">Pas de lignes dans la dernière version</p>';

    const totalHT = lastVer && lastVer.lignes
      ? lastVer.lignes.reduce((s, l) => s + (l.quantite || 0) * (l.prix_unitaire || 0), 0) : 0;
    const totalTVA = totalHT * (p.tva_pct || 0) / 100;

    return modal({
      title: '📄 ' + (rq.subject || 'Devis reçu'),
      large: true,
      content: `
        <div class="status-box ok" style="text-align:left">
          <strong>Émis par :</strong> ${escapeHtml(rq.sender_label || '—')}<br>
          <strong>Reçu le :</strong> ${formatDate(rq.received_at)}
        </div>
        <h3 style="margin-top:18px">Détails du devis</h3>
        <div class="form-grid">
          <label>Code<input value="${escapeHtml(p.code || '—')}" readonly></label>
          <label>Date d'émission<input value="${p.date_emission ? formatDate(p.date_emission).split(' ')[0] : '—'}" readonly></label>
          <label class="full">Titre<input value="${escapeHtml(p.titre || '—')}" readonly></label>
          <label>Client<input value="${escapeHtml(p.client_nom || '—')}" readonly></label>
          <label>TVA<input value="${formatNum(p.tva_pct || 0, 2)} %" readonly></label>
        </div>

        <h3 style="margin-top:14px">Détail des prix (lecture seule)</h3>
        ${linesHtml}

        <div class="kpv-result-block" style="margin-top:14px">
          <span>Total HT</span>
          <span>${formatEUR(totalHT)}</span>
          <span>TVA ${formatNum(p.tva_pct || 0, 2)}%</span>
          <span>${formatEUR(totalTVA)}</span>
          <span>Total TTC</span>
          <strong class="kpv-coef">${formatEUR(totalHT + totalTVA)}</strong>
        </div>

        ${p.notes ? `<h3 style="margin-top:14px">Notes</h3><div class="status-box warn">${escapeHtml(p.notes)}</div>` : ''}

        <h3 style="margin-top:14px">Réponse</h3>
        <label>Statut
          <select id="rq-statut">
            <option value="lu" ${rq.statut === 'lu' ? 'selected' : ''}>👁 Lu (en cours d'examen)</option>
            <option value="accepte" ${rq.statut === 'accepte' ? 'selected' : ''}>✅ Accepté</option>
            <option value="refuse" ${rq.statut === 'refuse' ? 'selected' : ''}>❌ Refusé</option>
          </select>
        </label>
        <label class="full" style="margin-top:8px">Notes internes (visibles à toi seul)
          <textarea id="rq-notes" rows="2">${escapeHtml(rq.notes || '')}</textarea>
        </label>
      `,
      footer: `
        <button class="btn ghost" data-action="close">Fermer</button>
        <button class="btn primary" data-action="save">💾 Enregistrer la réponse</button>
      `,
      onMount: ({ body, footer, close }) => {
        footer.querySelector('[data-action="close"]').onclick = () => close(true);
        footer.querySelector('[data-action="save"]').onclick = async () => {
          const r = await window.api.ndev.receivedSetStatut({
            id: rq.id,
            statut: body.querySelector('#rq-statut').value,
            notes: body.querySelector('#rq-notes').value
          });
          if (r.ok) { toast('Enregistré', 'success'); close(true); refresh(); }
          else toast(r.error, 'danger');
        };
      }
    });
  }

  window.ArtisanReceivedPage = {
    async render(container) {
      containerEl = container;
      containerEl.innerHTML = '<div class="loader">Chargement…</div>';
      await refresh();
    }
  };
})();
