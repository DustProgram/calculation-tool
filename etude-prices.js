// ui/etude-prices.js — Page Base de prix + gestion des lots
// Expose window.EtudePricesPage avec render(container)

(function () {
  const { $, $$, escapeHtml, formatEUR, toast, modal, confirmModal } = window.UI;

  // État local de la page
  let lots = [];
  let prices = [];
  let total = 0;
  let filterLotId = ''; // '', null (sans lot), ou ID
  let searchTerm = '';
  let containerEl = null;

  async function refresh() {
    const lotsRes = await window.api.etude.lots.list();
    if (lotsRes.ok) lots = lotsRes.data;
    const query = { search: searchTerm, lotId: filterLotId === '' ? undefined : (filterLotId === 'null' ? null : parseInt(filterLotId, 10)) };
    const pricesRes = await window.api.etude.prices.list(query);
    if (pricesRes.ok) {
      prices = pricesRes.data;
      total = pricesRes.total;
    }
    renderTable();
  }

  function renderTable() {
    if (!containerEl) return;
    const lotOptions = ['<option value="">Tous les lots</option>', '<option value="null">— Sans lot —</option>']
      .concat(lots.map(l => `<option value="${l.id}" ${String(filterLotId) === String(l.id) ? 'selected' : ''}>${escapeHtml(l.code ? l.code + ' — ' : '')}${escapeHtml(l.nom)}</option>`))
      .join('');

    const lotById = {};
    lots.forEach(l => lotById[l.id] = l);

    const rowsHtml = prices.length ? prices.map(p => `
      <tr data-id="${p.id}">
        <td>${escapeHtml(p.repere || '')}</td>
        <td>${p.lot_nom ? `<span class="lot-chip" style="background:${escapeHtml(p.lot_couleur || '#5b8def')}22;color:${escapeHtml(p.lot_couleur || '#5b8def')}">${escapeHtml(p.lot_code ? p.lot_code + ' ' : '')}${escapeHtml(p.lot_nom)}</span>` : '<span class="muted">—</span>'}</td>
        <td>${escapeHtml(p.designation)}</td>
        <td class="center">${escapeHtml(p.unite || '')}</td>
        <td class="right">${formatEUR(p.prix)}</td>
        <td class="center">${escapeHtml(p.date_prix || '')}</td>
        <td class="center actions">
          <button class="btn-icon" data-action="edit" title="Modifier">✏️</button>
          <button class="btn-icon danger" data-action="delete" title="Supprimer">🗑</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="7" class="empty">Aucun prix. Importe un fichier Excel ou ajoute manuellement.</td></tr>`;

    containerEl.innerHTML = `
      <div class="page-header">
        <div>
          <h1>💶 Base de prix <span class="muted small">(${prices.length}${total !== prices.length ? ' / ' + total : ''})</span></h1>
        </div>
        <div class="page-actions">
          <button class="btn ghost" id="btn-manage-lots">📂 Gérer les lots (${lots.length})</button>
          <button class="btn ghost" id="btn-export-xlsx">📤 Exporter Excel</button>
          <button class="btn ghost" id="btn-import-xlsx">📥 Importer Excel</button>
          <button class="btn primary" id="btn-new-price">+ Nouveau prix</button>
        </div>
      </div>

      <div class="filters">
        <input type="text" id="search-input" placeholder="🔍 Rechercher (désignation, repère, projet)…" value="${escapeHtml(searchTerm)}">
        <select id="lot-filter">${lotOptions}</select>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:90px">Repère</th>
              <th style="width:160px">Lot</th>
              <th>Désignation</th>
              <th style="width:60px" class="center">U.</th>
              <th style="width:110px" class="right">Prix HT</th>
              <th style="width:90px" class="center">Date</th>
              <th style="width:90px" class="center">Actions</th>
            </tr>
          </thead>
          <tbody id="prices-tbody">${rowsHtml}</tbody>
        </table>
      </div>
    `;

    bindTableEvents();
  }

  function bindTableEvents() {
    $('#search-input').oninput = (e) => {
      searchTerm = e.target.value;
      clearTimeout(window._searchTimer);
      window._searchTimer = setTimeout(refresh, 200);
    };
    $('#lot-filter').onchange = (e) => {
      filterLotId = e.target.value;
      refresh();
    };
    $('#btn-new-price').onclick = () => openPriceModal(null);
    $('#btn-manage-lots').onclick = () => openLotsModal();
    $('#btn-import-xlsx').onclick = () => openImportWizard();
    $('#btn-export-xlsx').onclick = async () => {
      const r = await window.api.etude.prices.exportExcel();
      if (r.ok) toast('Exporté : ' + r.path, 'success');
      else if (!r.canceled) toast('Erreur : ' + r.error, 'danger');
    };

    $$('#prices-tbody [data-action]').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const tr = btn.closest('tr');
        const id = parseInt(tr.dataset.id, 10);
        const p = prices.find(x => x.id === id);
        if (btn.dataset.action === 'edit') openPriceModal(p);
        if (btn.dataset.action === 'delete') {
          if (await confirmModal('Supprimer ce prix ?', `« ${p.designation} »`)) {
            const r = await window.api.etude.prices.delete({ id });
            if (r.ok) { toast('Supprimé', 'success'); refresh(); }
            else toast('Erreur : ' + r.error, 'danger');
          }
        }
      };
    });
  }

  // ---------- MODALE PRIX (création / édition) ----------
  function openPriceModal(price) {
    const isEdit = !!price;
    const lotOpts = ['<option value="">— Sans lot —</option>']
      .concat(lots.map(l => `<option value="${l.id}" ${price && price.lot_id === l.id ? 'selected' : ''}>${escapeHtml(l.code ? l.code + ' — ' : '')}${escapeHtml(l.nom)}</option>`))
      .join('');
    return modal({
      title: isEdit ? 'Modifier le prix' : 'Nouveau prix',
      content: `
        <div class="form-grid">
          <label>Repère<input id="f-repere" value="${escapeHtml(price && price.repere || '')}"></label>
          <label>Lot<select id="f-lot">${lotOpts}</select></label>
          <label class="full">Désignation *<input id="f-designation" value="${escapeHtml(price && price.designation || '')}"></label>
          <label>Unité<input id="f-unite" value="${escapeHtml(price && price.unite || '')}"></label>
          <label>Prix HT *<input id="f-prix" type="number" step="0.01" value="${price && price.prix != null ? price.prix : ''}"></label>
          <label>Date<input id="f-date" placeholder="ex: 2025" value="${escapeHtml(price && price.date_prix || '')}"></label>
          <label>Projet<input id="f-projet" value="${escapeHtml(price && price.projet || '')}"></label>
        </div>
      `,
      footer: `
        <button class="btn ghost" data-action="cancel">Annuler</button>
        <button class="btn primary" data-action="save">${isEdit ? 'Enregistrer' : 'Créer'}</button>
      `,
      onMount: ({ body, footer, close }) => {
        body.querySelector('#f-designation').focus();
        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);
        footer.querySelector('[data-action="save"]').onclick = async () => {
          const payload = {
            repere: body.querySelector('#f-repere').value.trim(),
            lotId: body.querySelector('#f-lot').value ? parseInt(body.querySelector('#f-lot').value, 10) : null,
            designation: body.querySelector('#f-designation').value.trim(),
            unite: body.querySelector('#f-unite').value.trim(),
            prix: body.querySelector('#f-prix').value,
            datePrix: body.querySelector('#f-date').value.trim(),
            projet: body.querySelector('#f-projet').value.trim()
          };
          if (!payload.designation) return toast('Désignation requise', 'danger');
          const r = isEdit
            ? await window.api.etude.prices.update({ id: price.id, ...payload })
            : await window.api.etude.prices.create(payload);
          if (r.ok) { toast(isEdit ? 'Modifié' : 'Créé', 'success'); close(true); refresh(); }
          else toast('Erreur : ' + r.error, 'danger');
        };
      }
    });
  }

  // ---------- MODALE LOTS ----------
  function openLotsModal() {
    const renderList = () => lots.map(l => `
      <tr data-id="${l.id}">
        <td><input class="lot-code" value="${escapeHtml(l.code || '')}" placeholder="ex: 01"></td>
        <td><input class="lot-nom" value="${escapeHtml(l.nom)}"></td>
        <td><input class="lot-couleur" type="color" value="${escapeHtml(l.couleur || '#5b8def')}"></td>
        <td><input class="lot-ordre" type="number" value="${l.ordre || 0}" style="width:60px"></td>
        <td class="center">
          <button class="btn-icon" data-action="save-lot" title="Enregistrer">💾</button>
          <button class="btn-icon danger" data-action="delete-lot" title="Supprimer">🗑</button>
        </td>
      </tr>
    `).join('');
    return modal({
      title: 'Gestion des lots',
      large: true,
      content: `
        <table class="data-table mb-12">
          <thead><tr><th style="width:90px">Code</th><th>Nom</th><th style="width:90px">Couleur</th><th style="width:80px">Ordre</th><th style="width:90px"></th></tr></thead>
          <tbody id="lots-tbody">${renderList()}</tbody>
        </table>
        <div class="form-row">
          <input id="new-lot-code" placeholder="Code (ex: 03)" style="max-width:120px">
          <input id="new-lot-nom" placeholder="Nom du lot (ex: Charpente)">
          <input id="new-lot-couleur" type="color" value="#5b8def">
          <button class="btn primary" id="btn-add-lot">+ Ajouter</button>
        </div>
      `,
      footer: `<button class="btn primary" data-action="done">Terminé</button>`,
      onMount: ({ body, footer, close }) => {
        const bindLines = () => {
          $$('#lots-tbody [data-action]', body).forEach(btn => {
            btn.onclick = async () => {
              const tr = btn.closest('tr');
              const id = parseInt(tr.dataset.id, 10);
              if (btn.dataset.action === 'save-lot') {
                const payload = {
                  id,
                  code: tr.querySelector('.lot-code').value.trim(),
                  nom: tr.querySelector('.lot-nom').value.trim(),
                  couleur: tr.querySelector('.lot-couleur').value,
                  ordre: parseInt(tr.querySelector('.lot-ordre').value, 10) || 0
                };
                if (!payload.nom) return toast('Nom requis', 'danger');
                const r = await window.api.etude.lots.update(payload);
                if (r.ok) { toast('Lot mis à jour', 'success'); }
                else toast('Erreur : ' + r.error, 'danger');
              }
              if (btn.dataset.action === 'delete-lot') {
                const lot = lots.find(l => l.id === id);
                if (await confirmModal('Supprimer ce lot ?', `« ${lot.nom} » — les prix associés ne seront pas supprimés mais perdront leur lot.`)) {
                  const r = await window.api.etude.lots.delete({ id });
                  if (r.ok) {
                    toast('Lot supprimé', 'success');
                    const lr = await window.api.etude.lots.list();
                    if (lr.ok) lots = lr.data;
                    body.querySelector('#lots-tbody').innerHTML = renderList();
                    bindLines();
                  } else toast('Erreur : ' + r.error, 'danger');
                }
              }
            };
          });
        };
        bindLines();
        body.querySelector('#btn-add-lot').onclick = async () => {
          const payload = {
            code: body.querySelector('#new-lot-code').value.trim(),
            nom: body.querySelector('#new-lot-nom').value.trim(),
            couleur: body.querySelector('#new-lot-couleur').value,
            ordre: lots.length + 1
          };
          if (!payload.nom) return toast('Nom requis', 'danger');
          const r = await window.api.etude.lots.create(payload);
          if (r.ok) {
            toast('Lot créé', 'success');
            body.querySelector('#new-lot-code').value = '';
            body.querySelector('#new-lot-nom').value = '';
            const lr = await window.api.etude.lots.list();
            if (lr.ok) lots = lr.data;
            body.querySelector('#lots-tbody').innerHTML = renderList();
            bindLines();
          } else toast('Erreur : ' + r.error, 'danger');
        };
        footer.querySelector('[data-action="done"]').onclick = () => { close(true); refresh(); };
      }
    });
  }

  // ---------- ASSISTANT D'IMPORT EXCEL ----------
  async function openImportWizard() {
    const r = await window.api.etude.prices.excelPreview();
    if (r.canceled) return;
    if (!r.ok) return toast('Erreur : ' + r.error, 'danger');

    let { filePath, headers, rows, sheets, currentSheet, mapping } = r;
    let currentMapping = { ...mapping };

    const FIELDS = [
      { key: 'designation', label: 'Désignation *', required: true },
      { key: 'prix',        label: 'Prix HT *',    required: true },
      { key: 'unite',       label: 'Unité' },
      { key: 'repere',      label: 'Repère' },
      { key: 'lot_code',    label: 'Code lot' },
      { key: 'lot_nom',     label: 'Nom lot' },
      { key: 'date_prix',   label: 'Date / Année' },
      { key: 'projet',      label: 'Projet' }
    ];

    const renderBody = () => {
      const sheetSel = sheets.length > 1 ? `
        <label class="block">Feuille à importer
          <select id="sheet-sel">${sheets.map(s => `<option value="${escapeHtml(s)}" ${s === currentSheet ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select>
        </label>
      ` : '';
      const mapHtml = FIELDS.map(f => `
        <label>${f.label}
          <select data-field="${f.key}">
            <option value="">— ignorer —</option>
            ${headers.map(h => `<option value="${escapeHtml(h)}" ${currentMapping[f.key] === h ? 'selected' : ''}>${escapeHtml(h)}</option>`).join('')}
          </select>
        </label>
      `).join('');
      // Aperçu : 5 premières lignes après mapping
      const previewRows = rows.slice(0, 5).map(r2 => {
        const tds = FIELDS.map(f => {
          const col = currentMapping[f.key];
          return `<td>${col ? escapeHtml(String(r2[col] != null ? r2[col] : '')) : '<span class="muted">—</span>'}</td>`;
        }).join('');
        return `<tr>${tds}</tr>`;
      }).join('');

      return `
        <p class="muted small">Fichier : <strong>${escapeHtml(filePath.split(/[\\\\/]/).pop())}</strong> — ${rows.length} lignes</p>
        ${sheetSel}
        <h3>Mappage des colonnes</h3>
        <p class="muted small">Associe chaque champ Nucléar Estim à une colonne de ton fichier. Le mapping a été détecté automatiquement quand possible.</p>
        <div class="form-grid">${mapHtml}</div>
        <h3>Aperçu (5 premières lignes)</h3>
        <div class="table-wrap" style="max-height:240px">
          <table class="data-table">
            <thead><tr>${FIELDS.map(f => `<th>${escapeHtml(f.label)}</th>`).join('')}</tr></thead>
            <tbody>${previewRows}</tbody>
          </table>
        </div>
        <label class="checkbox" style="margin-top:12px">
          <input type="checkbox" id="chk-replace">
          <span>⚠️ <strong>Remplacer</strong> tous les prix existants (sinon ajout aux existants)</span>
        </label>
      `;
    };

    return modal({
      title: 'Importer un fichier Excel',
      large: true,
      content: renderBody(),
      footer: `
        <button class="btn ghost" data-action="cancel">Annuler</button>
        <button class="btn primary" data-action="import">Importer</button>
      `,
      onMount: function bind({ body, footer, close }) {
        const bindForm = () => {
          $$('select[data-field]', body).forEach(sel => {
            sel.onchange = () => {
              currentMapping[sel.dataset.field] = sel.value || null;
              body.innerHTML = renderBody();
              bindForm();
            };
          });
          const sheetSel = body.querySelector('#sheet-sel');
          if (sheetSel) sheetSel.onchange = async () => {
            const res = await window.api.etude.prices.excelLoadSheet({ filePath, sheet: sheetSel.value });
            if (res.ok) {
              headers = res.headers; rows = res.rows; currentSheet = res.currentSheet;
              currentMapping = { ...res.mapping };
              body.innerHTML = renderBody();
              bindForm();
            }
          };
        };
        bindForm();
        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);
        footer.querySelector('[data-action="import"]').onclick = async () => {
          if (!currentMapping.designation || !currentMapping.prix) {
            return toast('Désignation et Prix sont obligatoires', 'danger');
          }
          const replaceExisting = body.querySelector('#chk-replace').checked;
          if (replaceExisting && !await confirmModal('Confirmer le remplacement', 'Tous les prix existants vont être supprimés et remplacés. Continuer ?')) return;
          const res = await window.api.etude.prices.excelImport({ rows, mapping: currentMapping, replaceExisting });
          if (res.ok) {
            toast(`Import : ${res.inserted} lignes ajoutées${res.skipped ? ', ' + res.skipped + ' ignorées' : ''}`, 'success');
            close(true);
            refresh();
          } else toast('Erreur : ' + res.error, 'danger');
        };
      }
    });
  }

  // ---------- API publique ----------
  window.EtudePricesPage = {
    async render(container) {
      containerEl = container;
      containerEl.innerHTML = '<div class="loader">Chargement…</div>';
      await refresh();
    }
  };
})();
