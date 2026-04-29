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
    const coutDep = site.cout_dep && site.cout_dep.cout_total_jour;
    return `
      <div class="kanban-card" data-id="${site.id}">
        <div class="kanban-card-title">${escapeHtml(site.nom)}</div>
        ${site.adresse ? `<div class="kanban-card-sub">📍 ${escapeHtml(site.adresse)}</div>` : ''}
        ${site.quote_titre ? `<div class="kanban-card-sub">📄 ${escapeHtml(site.quote_code || '')} ${escapeHtml(site.quote_titre)}</div>` : ''}
        ${site.distance_km ? `<div class="kanban-card-sub">🚐 ${formatNum(site.distance_km, 1)} km · ${formatNum(coutDep || 0, 2)} €/j</div>` : ''}
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
        <h3>Informations</h3>
        <div class="form-grid">
          <label class="full">Nom *<input id="f-nom" value="${escapeHtml(site && site.nom || '')}"></label>
          <label class="full">Adresse<textarea id="f-adresse" rows="2">${escapeHtml(site && site.adresse || '')}</textarea></label>
          <label>Statut<select id="f-statut">${statutOpts}</select></label>
          <label>Avancement (%)<input id="f-av" type="number" step="5" min="0" max="100" value="${site && site.avancement_pct || 0}"></label>
          <label class="full">Devis lié<select id="f-quote">${quoteOpts}</select></label>
        </div>

        <h3 style="margin-top:14px">🚐 Déplacements</h3>
        <div class="form-grid">
          <label>Distance siège → chantier (km, aller simple)
            <input id="f-dist" type="number" step="0.5" value="${site && site.distance_km || 0}">
          </label>
          <label>Nb trajets aller-retour / jour
            <input id="f-nbt" type="number" step="1" min="0" value="${site && site.nb_trajets_jour || 2}">
            <small class="muted">1 = matin+soir &nbsp;·&nbsp; 2 = + retour midi</small>
          </label>
          <label class="full">Nombre de jours estimé du chantier
            <input id="f-jours" type="number" step="0.5" min="0" value="${site && site.nb_jours_estim || 0}">
            <small class="muted">Sert à calculer le coût total déplacement du chantier</small>
          </label>
        </div>

        <div class="kpv-result-block" id="dep-block">
          <span>Coût carburant / jour</span>
          <span class="kpv-coef" id="dep-jour">…</span>
          <span class="kpv-pct">×</span>
          <span id="dep-jours-label">… jours</span>
          <span class="kpv-pct">=</span>
          <strong id="dep-total" style="font-size:18px">…</strong>
        </div>
        <p class="muted small" id="dep-formula" style="margin-top:6px"></p>

        <h3 style="margin-top:14px">Notes</h3>
        <textarea id="f-notes" rows="3">${escapeHtml(site && site.notes || '')}</textarea>
      `,
      footer: `
        <button class="btn ghost" data-action="cancel">Annuler</button>
        <button class="btn primary" data-action="save">${isEdit ? 'Enregistrer' : 'Créer'}</button>
      `,
      onMount: ({ body, footer, close }) => {
        const recalc = async () => {
          // On va chercher les params véhicule à chaque recalc (rarement appelé)
          const lr = await window.api.artisan.logistic.get();
          const veh = lr.ok ? lr.data : { prix_carburant_litre: 0, conso_l_100km: 0 };
          const dist = parseFloat(body.querySelector('#f-dist').value) || 0;
          const nbT = parseFloat(body.querySelector('#f-nbt').value) || 0;
          const nbJ = parseFloat(body.querySelector('#f-jours').value) || 0;
          const km = dist * 2 * nbT;
          const litres = km * (veh.conso_l_100km || 0) / 100;
          const coutJour = litres * (veh.prix_carburant_litre || 0);
          const total = coutJour * nbJ;
          body.querySelector('#dep-jour').textContent = window.UI.formatEUR(coutJour);
          body.querySelector('#dep-jours-label').textContent = nbJ + ' jours';
          body.querySelector('#dep-total').textContent = window.UI.formatEUR(total);
          body.querySelector('#dep-formula').textContent =
            `= ${dist} km × 2 × ${nbT} trajets × ${(veh.conso_l_100km || 0)}L/100 × ${(veh.prix_carburant_litre || 0)} €/L  =  ${window.UI.formatEUR(coutJour)}/jour`;
        };
        ['#f-dist', '#f-nbt', '#f-jours'].forEach(s => body.querySelector(s).oninput = recalc);
        recalc();

        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);
        footer.querySelector('[data-action="save"]').onclick = async () => {
          const payload = {
            nom: body.querySelector('#f-nom').value.trim(),
            adresse: body.querySelector('#f-adresse').value.trim(),
            statut: body.querySelector('#f-statut').value,
            avancement_pct: parseFloat(body.querySelector('#f-av').value) || 0,
            quote_id: body.querySelector('#f-quote').value ? parseInt(body.querySelector('#f-quote').value, 10) : null,
            notes: body.querySelector('#f-notes').value.trim(),
            distance_km: parseFloat(body.querySelector('#f-dist').value) || 0,
            nb_trajets_jour: parseFloat(body.querySelector('#f-nbt').value) || 2,
            nb_jours_estim: parseFloat(body.querySelector('#f-jours').value) || 0
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
