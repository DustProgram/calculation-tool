// ui/etude-responses.js — Réponses annotées reçues d'artisans (.ndev-reply) côté BE
(function () {
  const { $, $$, escapeHtml, formatEUR, formatNum, formatDate, toast, modal, confirmModal } = window.UI;

  let containerEl = null;
  let responses = [];

  async function refresh() {
    const r = await window.api.quoteResponse.receivedList();
    if (r.ok) responses = r.data;
    render();
  }

  function statutBadge(s) {
    const map = {
      nouveau: '<span class="badge" style="background:rgba(91,141,239,0.2);color:#5b8def">🆕 Nouveau</span>',
      lu: '<span class="badge" style="background:rgba(160,160,160,0.2);color:var(--text-muted)">👁 Lu</span>',
      traite: '<span class="badge" style="background:rgba(0,180,100,0.2);color:var(--success)">✅ Traité</span>'
    };
    return map[s] || s;
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' o';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' Ko';
    return (n / 1024 / 1024).toFixed(1) + ' Mo';
  }

  function render() {
    if (!containerEl) return;
    const rows = responses.length ? responses.map(r => {
      const p = r.payload || {};
      const nbAdded = (p.lignes_ajoutees || []).length;
      const nbAtt = (p.attachments || []).length;
      const linkedQuote = r.quote_titre ? `<span class="badge" style="background:rgba(91,141,239,0.15);color:#5b8def">${escapeHtml(r.quote_code || '')} — ${escapeHtml(r.quote_titre)}</span>` : `<span class="muted small">non lié</span>`;
      return `
        <tr data-id="${r.id}">
          <td class="small">${formatDate(r.received_at).split(' ')[0]}</td>
          <td>${escapeHtml(r.subject || '—')}</td>
          <td class="small">${escapeHtml(r.sender_label || '—')}</td>
          <td>${linkedQuote}</td>
          <td class="center small">${nbAdded ? '➕' + nbAdded + ' ' : ''}${nbAtt ? '📎' + nbAtt : ''}</td>
          <td class="center">${statutBadge(r.statut)}</td>
          <td class="center actions">
            <button class="btn-icon" data-action="view" title="Consulter">👁</button>
            <button class="btn-icon danger" data-action="delete" title="Supprimer">🗑</button>
          </td>
        </tr>`;
    }).join('') : '<tr><td colspan="7" class="empty">Aucune réponse reçue. Importe un fichier .ndev-reply avec le bouton ci-dessus.</td></tr>';

    containerEl.innerHTML = `
      <div class="page-header">
        <h1>📨 Réponses d'artisans</h1>
        <div class="page-actions">
          <button class="btn primary" id="btn-import">📥 Importer un .ndev-reply</button>
        </div>
      </div>
      <p class="muted small">Réponses chiffrées renvoyées par les artisans après consultation d'un devis. Tu peux consulter leurs remarques, voir les lignes qu'ils proposent d'ajouter, et les intégrer en 1 clic comme nouvelle version du devis.</p>

      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th style="width:90px">Reçu le</th>
            <th>Sujet</th>
            <th>De</th>
            <th>Devis lié</th>
            <th class="center" style="width:80px">Annot.</th>
            <th class="center" style="width:100px">Statut</th>
            <th class="center" style="width:90px">Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    $('#btn-import').onclick = openImportModal;
    $$('[data-action="view"]').forEach(btn => {
      btn.onclick = () => openViewModal(parseInt(btn.closest('tr').dataset.id, 10));
    });
    $$('[data-action="delete"]').forEach(btn => {
      btn.onclick = async () => {
        const id = parseInt(btn.closest('tr').dataset.id, 10);
        const r = responses.find(x => x.id === id);
        if (await confirmModal('Supprimer cette réponse ?', r.subject || '')) {
          const res = await window.api.quoteResponse.receivedDelete({ id });
          if (res.ok) { toast('Supprimé', 'success'); refresh(); }
        }
      };
    });
  }

  function openImportModal() {
    return modal({
      title: '📥 Importer un fichier .ndev-reply',
      content: `
        <p class="muted small">Glisse-dépose le fichier .ndev-reply renvoyé par l'artisan, ou clique pour choisir.</p>
        <div id="drop-zone" style="border:2px dashed var(--border);padding:40px;text-align:center;border-radius:8px;cursor:pointer;background:var(--bg-2)">
          <div style="font-size:48px">🔐</div>
          <p>Glisse ton fichier .ndev-reply ici<br><span class="muted small">ou clique pour parcourir</span></p>
          <input type="file" id="reply-file" accept=".ndev-reply,.json,application/json" style="display:none">
        </div>
        <div id="reply-status" style="margin-top:12px"></div>
      `,
      footer: `<button class="btn ghost" data-action="close">Fermer</button>`,
      onMount: ({ body, footer, close }) => {
        const dz = body.querySelector('#drop-zone');
        const fi = body.querySelector('#reply-file');
        const status = body.querySelector('#reply-status');

        const importFile = async (file) => {
          const txt = await file.text();
          const r = await window.api.quoteResponse.import({ content: txt });
          if (!r.ok) {
            status.innerHTML = `<div class="status-box err">❌ ${escapeHtml(r.error)}</div>`;
            return;
          }
          const linkMsg = r.data.quote_id ? ` (lié au devis #${r.data.quote_id})` : ' <em>(devis BE non trouvé localement — lie-le manuellement)</em>';
          status.innerHTML = `<div class="status-box ok">✅ Réponse importée : <strong>${escapeHtml(r.data.subject)}</strong> de <strong>${escapeHtml(r.data.from || '—')}</strong>${linkMsg}</div>`;
          toast('Réponse reçue importée', 'success');
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

  // Télécharge une PJ embarquée (depuis base64).
  function downloadAttachment(att) {
    const bin = atob(att.data_b64 || '');
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: att.mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = att.name || 'piece-jointe';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function openViewModal(id) {
    const r = await window.api.quoteResponse.receivedGet({ id });
    if (!r.ok) return toast(r.error, 'danger');
    const rr = r.data;
    const p = rr.payload || {};

    const remarquesEntries = Object.entries(p.remarques_lignes || {});
    const remarquesHtml = remarquesEntries.length ? `
      <table class="data-table">
        <thead><tr><th>Ligne (clé)</th><th>Remarque de l'artisan</th></tr></thead>
        <tbody>${remarquesEntries.map(([k, v]) => `
          <tr><td class="small"><code>${escapeHtml(k)}</code></td><td>${escapeHtml(v)}</td></tr>
        `).join('')}</tbody>
      </table>
    ` : '<p class="muted small">Aucune remarque sur les lignes existantes</p>';

    const linesHtml = (p.lignes_ajoutees || []).length ? `
      <table class="data-table">
        <thead><tr>
          <th>Désignation</th>
          <th class="right" style="width:70px">Qté</th>
          <th style="width:70px">Unité</th>
          <th class="right" style="width:110px">Prix proposé</th>
          <th>Remarque</th>
        </tr></thead>
        <tbody>${(p.lignes_ajoutees || []).map(l => `
          <tr>
            <td>${escapeHtml(l.designation || '—')}</td>
            <td class="right">${formatNum(l.quantite || 0, 2)}</td>
            <td class="small">${escapeHtml(l.unite || '')}</td>
            <td class="right">${l.prix_propose != null ? formatEUR(l.prix_propose) : '<em class="muted">à chiffrer</em>'}</td>
            <td class="small">${escapeHtml(l.remarque || '')}</td>
          </tr>
        `).join('')}</tbody>
      </table>
    ` : '<p class="muted small">Aucune ligne proposée</p>';

    const attHtml = (p.attachments || []).length ? `
      <ul style="list-style:none;padding:0">${(p.attachments || []).map((a, i) => `
        <li style="margin:6px 0">
          📎 <strong>${escapeHtml(a.name || 'fichier')}</strong>
          <span class="muted small">— ${formatBytes(a.size || 0)}${a.mime ? ' · ' + escapeHtml(a.mime) : ''}</span>
          <button class="btn ghost small" data-action="att-dl" data-i="${i}" style="margin-left:8px">⬇ Télécharger</button>
        </li>
      `).join('')}</ul>
    ` : '<p class="muted small">Aucune pièce jointe</p>';

    const linkedHtml = rr.quote_id
      ? `<div class="status-box ok"><strong>Devis BE lié :</strong> ${escapeHtml(rr.quote_code || '')} — ${escapeHtml(rr.quote_titre || '')}</div>`
      : `<div class="status-box warn">⚠ Devis BE non lié — soit le code n'existe pas, soit il a été supprimé. <strong>Crée d'abord le devis avec le code « ${escapeHtml(p.original_code || '?')} »</strong> avant d'intégrer les lignes.</div>`;

    return modal({
      title: '📨 ' + (rr.subject || 'Réponse reçue'),
      large: true,
      content: `
        <div class="status-box ok" style="text-align:left">
          <strong>De :</strong> ${escapeHtml(rr.sender_label || '—')}<br>
          <strong>Reçu le :</strong> ${formatDate(rr.received_at)}<br>
          <strong>Concerne version :</strong> v${p.version_target != null ? p.version_target : '?'} du devis ${escapeHtml(p.original_code || '?')}
        </div>

        ${linkedHtml}

        ${p.remarque_globale ? `
          <h3 style="margin-top:14px">💬 Remarque globale</h3>
          <div class="status-box warn">${escapeHtml(p.remarque_globale)}</div>
        ` : ''}

        <h3 style="margin-top:14px">📝 Remarques sur les lignes existantes</h3>
        ${remarquesHtml}

        <h3 style="margin-top:14px">➕ Lignes proposées par l'artisan</h3>
        ${linesHtml}

        <h3 style="margin-top:14px">📎 Pièces jointes</h3>
        ${attHtml}

        <h3 style="margin-top:14px">Statut & notes BE</h3>
        <label>Statut
          <select id="rr-statut">
            <option value="lu" ${rr.statut === 'lu' ? 'selected' : ''}>👁 Lu</option>
            <option value="traite" ${rr.statut === 'traite' ? 'selected' : ''}>✅ Traité</option>
          </select>
        </label>
        <label class="full" style="margin-top:8px">Notes internes
          <textarea id="rr-notes" rows="2">${escapeHtml(rr.notes || '')}</textarea>
        </label>
      `,
      footer: `
        <button class="btn ghost" data-action="close">Fermer</button>
        <button class="btn" data-action="save-statut">💾 Enregistrer statut</button>
        ${(p.lignes_ajoutees || []).length ? '<button class="btn primary" data-action="integrate">⤴ Intégrer les lignes au devis (nouvelle version)</button>' : ''}
      `,
      onMount: ({ body, footer, close }) => {
        body.querySelectorAll('[data-action="att-dl"]').forEach(btn => {
          btn.onclick = () => {
            const i = parseInt(btn.dataset.i, 10);
            const att = (p.attachments || [])[i];
            if (att) downloadAttachment(att);
          };
        });

        footer.querySelector('[data-action="close"]').onclick = () => close(true);
        footer.querySelector('[data-action="save-statut"]').onclick = async () => {
          const r = await window.api.quoteResponse.receivedSetStatut({
            id: rr.id,
            statut: body.querySelector('#rr-statut').value,
            notes: body.querySelector('#rr-notes').value
          });
          if (r.ok) { toast('Enregistré', 'success'); refresh(); }
          else toast(r.error, 'danger');
        };
        const btnInt = footer.querySelector('[data-action="integrate"]');
        if (btnInt) btnInt.onclick = async () => {
          if (!await confirmModal('Intégrer les lignes proposées au devis ?', 'Une nouvelle version sera créée avec les lignes existantes + les ' + (p.lignes_ajoutees || []).length + ' lignes proposées par l\'artisan.')) return;
          const r = await window.api.quoteResponse.integrate({ id: rr.id });
          if (!r.ok) return toast(r.error || 'Échec intégration', 'danger');
          toast(`Devis #${r.data.quote_id} → nouvelle version v${r.data.new_version} (${r.data.added_lines} ligne(s) ajoutée(s))`, 'success');
          close(true);
          refresh();
        };
      }
    });
  }

  window.EtudeResponsesPage = {
    async render(container) {
      containerEl = container;
      containerEl.innerHTML = '<div class="loader">Chargement…</div>';
      await refresh();
    }
  };
})();
