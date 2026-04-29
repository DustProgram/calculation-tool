// ui/artisan-equipment.js — Catalogue de matériel amorti (partagé Étude/Artisan)
(function () {
  const { $, $$, escapeHtml, formatEUR, formatNum, toast, modal, confirmModal } = window.UI;

  let containerEl = null;
  let equipment = [];
  let searchTerm = '';

  function computePrice(eq) {
    const prix = parseFloat(eq.prix_achat) || 0;
    const annees = parseFloat(eq.duree_amort_annees) || 1;
    const usage = parseFloat(eq.usage_par_an) || 1;
    const frais = parseFloat(eq.frais_pct) || 0;
    if (annees <= 0 || usage <= 0) return 0;
    return Math.round((prix * (1 + frais / 100)) / (annees * usage) * 100) / 100;
  }

  async function refresh() {
    const r = await window.api.artisan.equipment.list({ search: searchTerm });
    if (r.ok) equipment = r.data;
    render();
  }

  function render() {
    if (!containerEl) return;
    const rows = equipment.length ? equipment.map(eq => `
      <tr data-id="${eq.id}">
        <td>${escapeHtml(eq.nom)}</td>
        <td class="muted small">${escapeHtml(eq.categorie || '—')}</td>
        <td class="right">${formatEUR(eq.prix_achat)}</td>
        <td class="center small muted">${formatNum(eq.duree_amort_annees, 0)} an(s) · ${formatNum(eq.usage_par_an, 0)} ${eq.unite_usage}/an</td>
        <td class="center small muted">+${formatNum(eq.frais_pct, 1)} %</td>
        <td class="right"><strong>${formatEUR(eq.prix_unitaire)}/${escapeHtml(eq.unite_usage)}</strong></td>
        <td class="center actions">
          <button class="btn-icon" data-action="edit">✏️</button>
          <button class="btn-icon danger" data-action="delete">🗑</button>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="7" class="empty">Aucun matériel. Ajoute ton outillage et le prix amorti sera calculé automatiquement.</td></tr>';

    containerEl.innerHTML = `
      <div class="page-header">
        <h1>🔨 Matériel amorti <span class="muted small">(${equipment.length})</span></h1>
        <div class="page-actions">
          <button class="btn primary" id="btn-new-eq">+ Nouveau matériel</button>
        </div>
      </div>
      <p class="muted">Pour chaque outil/machine, saisis le prix d'achat, la durée d'amortissement et l'utilisation prévue. Le <strong>prix horaire ou journalier amorti</strong> est calculé automatiquement et utilisable dans tes compositions et chantiers.</p>

      <div class="filters">
        <input type="text" id="search-input" placeholder="🔍 Rechercher (nom, catégorie)…" value="${escapeHtml(searchTerm)}">
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Nom</th>
            <th style="width:110px">Catégorie</th>
            <th class="right" style="width:100px">Achat</th>
            <th class="center" style="width:160px">Amortissement</th>
            <th class="center" style="width:80px">Maint.</th>
            <th class="right" style="width:130px">Prix amorti</th>
            <th class="center" style="width:90px">Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    $('#search-input').oninput = (e) => {
      searchTerm = e.target.value;
      clearTimeout(window._eqSearchTimer);
      window._eqSearchTimer = setTimeout(refresh, 200);
    };
    $('#btn-new-eq').onclick = () => openEqModal(null);
    $$('[data-action]').forEach(btn => {
      btn.onclick = async () => {
        const id = parseInt(btn.closest('tr').dataset.id, 10);
        const eq = equipment.find(x => x.id === id);
        if (btn.dataset.action === 'edit') openEqModal(eq);
        if (btn.dataset.action === 'delete') {
          if (await confirmModal('Supprimer ce matériel ?', `« ${eq.nom} »`)) {
            const r = await window.api.artisan.equipment.delete({ id });
            if (r.ok) { toast('Supprimé', 'success'); refresh(); }
          }
        }
      };
    });
  }

  function openEqModal(eq) {
    const isEdit = !!eq;
    const initial = eq || {
      nom: '', categorie: '',
      prix_achat: 0, duree_amort_annees: 5,
      usage_par_an: 800, unite_usage: 'h',
      frais_pct: 20, notes: ''
    };
    return modal({
      title: isEdit ? 'Modifier le matériel' : 'Nouveau matériel',
      large: true,
      content: `
        <div class="form-grid">
          <label class="full">Nom * <input id="f-nom" value="${escapeHtml(initial.nom || '')}" placeholder="ex: Bétonnière 160L"></label>
          <label>Catégorie <input id="f-cat" value="${escapeHtml(initial.categorie || '')}" placeholder="ex: Gros œuvre, Outillage électrique…"></label>
          <label>Prix d'achat (€) * <input id="f-achat" type="number" step="0.01" value="${initial.prix_achat || 0}"></label>
          <label>Durée amortissement (années) <input id="f-annees" type="number" step="0.5" value="${initial.duree_amort_annees || 5}"></label>
          <label>Base de calcul
            <select id="f-base">
              <option value="h" ${initial.unite_usage === 'h' ? 'selected' : ''}>Horaire (h)</option>
              <option value="j" ${initial.unite_usage === 'j' ? 'selected' : ''}>Journalier (j)</option>
            </select>
          </label>
          <label>Utilisation prévue / an <input id="f-usage" type="number" step="1" value="${initial.usage_par_an || 800}"></label>
          <label>Frais de maintenance (%) <input id="f-frais" type="number" step="1" value="${initial.frais_pct || 0}"></label>
          <label class="full">Notes <textarea id="f-notes" rows="2">${escapeHtml(initial.notes || '')}</textarea></label>
        </div>

        <div class="kpv-result-block" id="eq-preview" style="margin-top:14px">
          <span>Prix unitaire amorti</span>
          <span class="kpv-coef" id="eq-pu">${formatEUR(eq ? eq.prix_unitaire : computePrice(initial))}</span>
          <span class="muted small" id="eq-formula"></span>
        </div>
      `,
      footer: `
        <button class="btn ghost" data-action="cancel">Annuler</button>
        <button class="btn primary" data-action="save">${isEdit ? 'Enregistrer' : 'Créer'}</button>
      `,
      onMount: ({ body, footer, close }) => {
        const collect = () => ({
          nom: body.querySelector('#f-nom').value.trim(),
          categorie: body.querySelector('#f-cat').value.trim(),
          prix_achat: parseFloat(body.querySelector('#f-achat').value) || 0,
          duree_amort_annees: parseFloat(body.querySelector('#f-annees').value) || 1,
          usage_par_an: parseFloat(body.querySelector('#f-usage').value) || 1,
          unite_usage: body.querySelector('#f-base').value,
          frais_pct: parseFloat(body.querySelector('#f-frais').value) || 0,
          notes: body.querySelector('#f-notes').value.trim()
        });
        const refreshPreview = () => {
          const cur = collect();
          const pu = computePrice(cur);
          body.querySelector('#eq-pu').textContent = formatEUR(pu) + '/' + cur.unite_usage;
          body.querySelector('#eq-formula').textContent =
            ` = ${formatEUR(cur.prix_achat)} × (1 + ${formatNum(cur.frais_pct, 1)}%) / (${formatNum(cur.duree_amort_annees, 1)} × ${formatNum(cur.usage_par_an, 0)} ${cur.unite_usage})`;
        };
        $$('input, select, textarea', body).forEach(i => i.oninput = refreshPreview);
        $$('select', body).forEach(s => s.onchange = refreshPreview);
        refreshPreview();

        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);
        footer.querySelector('[data-action="save"]').onclick = async () => {
          const payload = collect();
          if (!payload.nom) return toast('Nom requis', 'danger');
          if (!payload.prix_achat) return toast('Prix d\'achat requis', 'danger');
          const r = isEdit
            ? await window.api.artisan.equipment.update({ id: eq.id, ...payload })
            : await window.api.artisan.equipment.create(payload);
          if (r.ok) { toast(isEdit ? 'Modifié' : 'Créé', 'success'); close(true); refresh(); }
          else toast('Erreur : ' + r.error, 'danger');
        };
      }
    });
  }

  // Picker exposé pour les compositions Étude
  window.openEquipmentPicker = function () {
    return new Promise(async (resolve) => {
      const r = await window.api.artisan.equipment.list({});
      const list = r.ok ? r.data : [];
      modal({
        title: 'Choisir un matériel amorti',
        large: true,
        content: `
          <input type="text" id="picker-eq-search" placeholder="🔍 Rechercher…" style="width:100%; margin-bottom:12px">
          <div class="table-wrap" style="max-height:400px">
            <table class="data-table">
              <thead><tr>
                <th>Nom</th><th>Catégorie</th>
                <th class="right" style="width:140px">Prix amorti</th>
                <th style="width:80px"></th>
              </tr></thead>
              <tbody id="picker-eq-tbody"></tbody>
            </table>
          </div>
        `,
        footer: `<button class="btn ghost" data-action="cancel">Annuler</button>`,
        onMount: ({ body, footer, close }) => {
          const tbody = body.querySelector('#picker-eq-tbody');
          const renderRows = (items) => {
            tbody.innerHTML = items.length ? items.map(eq => `
              <tr data-id="${eq.id}">
                <td>${escapeHtml(eq.nom)}</td>
                <td class="muted small">${escapeHtml(eq.categorie || '')}</td>
                <td class="right"><strong>${formatEUR(eq.prix_unitaire)}/${escapeHtml(eq.unite_usage)}</strong></td>
                <td class="center"><button class="btn primary small" data-action="pick">Choisir</button></td>
              </tr>
            `).join('') : '<tr><td colspan="4" class="empty">Aucun matériel</td></tr>';
            $$('[data-action="pick"]', tbody).forEach(btn => {
              btn.onclick = () => {
                const id = parseInt(btn.closest('tr').dataset.id, 10);
                close(true);
                resolve(list.find(x => x.id === id));
              };
            });
          };
          renderRows(list);
          body.querySelector('#picker-eq-search').oninput = (e) => {
            const q = e.target.value.toLowerCase();
            renderRows(list.filter(eq =>
              (eq.nom || '').toLowerCase().includes(q) ||
              (eq.categorie || '').toLowerCase().includes(q)
            ));
          };
          footer.querySelector('[data-action="cancel"]').onclick = () => { close(null); resolve(null); };
        }
      });
    });
  };

  window.ArtisanEquipmentPage = {
    async render(container) {
      containerEl = container;
      containerEl.innerHTML = '<div class="loader">Chargement…</div>';
      await refresh();
    }
  };
})();
