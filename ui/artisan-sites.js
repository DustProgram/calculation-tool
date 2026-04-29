// ui/artisan-sites.js — Suivi de chantier (vue Kanban + liste)
(function () {
  const { $, $$, escapeHtml, formatNum, formatDate, toast, modal, confirmModal } = window.UI;

  const STATUTS = [
    { key: 'a_demarrer', label: '🟡 À démarrer', color: '#f0a868' },
    { key: 'en_cours',   label: '🔵 En cours',   color: '#5b8def' },
    { key: 'pause',      label: '⏸ En pause',    color: '#9494a8' },
    { key: 'termine',    label: '✅ Terminé',     color: '#4caf7c' },
    { key: 'facture',    label: '💰 Facturé',    color: '#7ed957' },
    { key: 'archive',    label: '📦 Archivé',    color: '#666' }
  ];

  let containerEl = null;
  let sites = [];
  let quotes = [];
  let viewMode = 'kanban'; // 'kanban' ou 'list'

  async function refresh() {
    const r = await window.api.artisan.sites.list();
    if (r.ok) sites = r.data;
    const qr = await window.api.etude.quotes.list();
    if (qr.ok) quotes = qr.data;
    render();
  }

  function render() {
    if (!containerEl) return;
    containerEl.innerHTML = `
      <div class="page-header">
        <h1>🏗 Suivi chantier <span class="muted small">(${sites.length})</span></h1>
        <div class="page-actions">
          <button class="btn ghost" id="btn-toggle-view">${viewMode === 'kanban' ? '📋 Liste' : '🎯 Kanban'}</button>
          <button class="btn primary" id="btn-new-site">+ Nouveau chantier</button>
        </div>
      </div>
      <div id="sites-content"></div>
    `;
    $('#btn-toggle-view').onclick = () => { viewMode = viewMode === 'kanban' ? 'list' : 'kanban'; render(); };
    $('#btn-new-site').onclick = () => openSiteModal(null);
    if (viewMode === 'kanban') renderKanban();
    else renderList();
  }

  function renderKanban() {
    const cont = $('#sites-content');
    cont.innerHTML = `<div class="kanban">${STATUTS.map(s => {
      const items = sites.filter(x => x.statut === s.key);
      return `
        <div class="kanban-col" data-statut="${s.key}">
          <div class="kanban-header" style="border-top:3px solid ${s.color}">
            <span>${s.label}</span>
            <span class="kanban-count">${items.length}</span>
          </div>
          <div class="kanban-body">
            ${items.length ? items.map(siteCard).join('') : '<div class="kanban-empty muted">—</div>'}
          </div>
        </div>
      `;
    }).join('')}</div>`;
    bindCards();
  }

  function siteCard(site) {
    return `
      <div class="kanban-card" data-id="${site.id}">
        <div class="kanban-card-title">${escapeHtml(site.nom)}</div>
        ${site.adresse ? `<div class="kanban-card-sub">📍 ${escapeHtml(site.adresse)}</div>` : ''}
        ${site.quote_titre ? `<div class="kanban-card-sub">📄 ${escapeHtml(site.quote_code || '')} ${escapeHtml(site.quote_titre)}</div>` : ''}
        <div class="kanban-card-progress">
          <div class="kanban-card-bar"><div style="width:${Math.min(100, site.avancement_pct || 0)}%"></div></div>
          <span class="small muted">${formatNum(site.avancement_pct || 0, 0)} %</span>
        </div>
      </div>
    `;
  }

  function renderList() {
    const cont = $('#sites-content');
    const rows = sites.length ? sites.map(s => {
      const stat = STATUTS.find(x => x.key === s.statut) || STATUTS[0];
      return `
        <tr data-id="${s.id}">
          <td><strong>${escapeHtml(s.nom)}</strong></td>
          <td class="muted small">${escapeHtml(s.adresse || '')}</td>
          <td class="muted small">${s.quote_titre ? escapeHtml((s.quote_code || '#' + s.quote_id) + ' — ' + s.quote_titre) : '—'}</td>
          <td class="center"><span class="status-badge" style="background:${stat.color}22;color:${stat.color}">${stat.label}</span></td>
          <td class="right">${formatNum(s.avancement_pct || 0, 0)} %</td>
          <td class="center small muted">${formatDate(s.updated_at)}</td>
          <td class="center actions">
            <button class="btn-icon" data-action="edit">✏️</button>
            <button class="btn-icon danger" data-action="delete">🗑</button>
          </td>
        </tr>
      `;
    }).join('') : '<tr><td colspan="7" class="empty">Aucun chantier</td></tr>';
    cont.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Nom</th><th style="width:200px">Adresse</th><th>Devis lié</th>
            <th class="center" style="width:130px">Statut</th>
            <th class="right" style="width:80px">Avancement</th>
            <th class="center" style="width:140px">Maj</th>
            <th class="center" style="width:90px">Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    $$('[data-action]').forEach(btn => {
      btn.onclick = async () => {
        const id = parseInt(btn.closest('tr').dataset.id, 10);
        const s = sites.find(x => x.id === id);
        if (btn.dataset.action === 'edit') openSiteModal(s);
        if (btn.dataset.action === 'delete') {
          if (await confirmModal('Supprimer ce chantier ?', `« ${s.nom} »`)) {
            const r = await window.api.artisan.sites.delete({ id });
            if (r.ok) { toast('Supprimé', 'success'); refresh(); }
          }
        }
      };
    });
  }

  function bindCards() {
    $$('.kanban-card').forEach(card => {
      card.onclick = async () => {
        const id = parseInt(card.dataset.id, 10);
        const s = sites.find(x => x.id === id);
        openSiteModal(s);
      };
    });
  }

  function openSiteModal(site) {
    const isEdit = !!site;
    const quoteOpts = ['<option value="">— Aucun devis lié —</option>']
      .concat(quotes.map(q => `<option value="${q.id}" ${site && site.quote_id === q.id ? 'selected' : ''}>${escapeHtml((q.code || '#' + q.id) + ' — ' + q.titre)}</option>`))
      .join('');
    const statutOpts = STATUTS.map(s => `<option value="${s.key}" ${site && site.statut === s.key ? 'selected' : ''}>${s.label}</option>`).join('');

    return modal({
      title: isEdit ? 'Modifier le chantier' : 'Nouveau chantier',
      large: true,
      content: `
        <div class="form-grid">
          <label class="full">Nom *<input id="f-nom" value="${escapeHtml(site && site.nom || '')}"></label>
          <label class="full">Adresse<textarea id="f-adresse" rows="2">${escapeHtml(site && site.adresse || '')}</textarea></label>
          <label>Statut<select id="f-statut">${statutOpts}</select></label>
          <label>Avancement (%)<input id="f-av" type="number" step="5" min="0" max="100" value="${site && site.avancement_pct || 0}"></label>
          <label class="full">Devis lié<select id="f-quote">${quoteOpts}</select></label>
          <label class="full">Notes<textarea id="f-notes" rows="3">${escapeHtml(site && site.notes || '')}</textarea></label>
        </div>
      `,
      footer: `
        <button class="btn ghost" data-action="cancel">Annuler</button>
        <button class="btn primary" data-action="save">${isEdit ? 'Enregistrer' : 'Créer'}</button>
      `,
      onMount: ({ body, footer, close }) => {
        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);
        footer.querySelector('[data-action="save"]').onclick = async () => {
          const payload = {
            nom: body.querySelector('#f-nom').value.trim(),
            adresse: body.querySelector('#f-adresse').value.trim(),
            statut: body.querySelector('#f-statut').value,
            avancement_pct: parseFloat(body.querySelector('#f-av').value) || 0,
            quote_id: body.querySelector('#f-quote').value ? parseInt(body.querySelector('#f-quote').value, 10) : null,
            notes: body.querySelector('#f-notes').value.trim()
          };
          if (!payload.nom) return toast('Nom requis', 'danger');
          const r = isEdit
            ? await window.api.artisan.sites.update({ id: site.id, ...payload })
            : await window.api.artisan.sites.create(payload);
          if (r.ok) { toast(isEdit ? 'Modifié' : 'Créé', 'success'); close(true); refresh(); }
          else toast('Erreur : ' + r.error, 'danger');
        };
      }
    });
  }

  window.ArtisanSitesPage = {
    async render(container) {
      containerEl = container;
      containerEl.innerHTML = '<div class="loader">Chargement…</div>';
      await refresh();
    }
  };
})();
