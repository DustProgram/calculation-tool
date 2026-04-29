// ui/artisan-suppliers.js — Fournisseurs et carnet de prix
(function () {
  const { $, $$, escapeHtml, formatEUR, toast, modal, confirmModal } = window.UI;

  let suppliers = [];
  let containerEl = null;

  async function refresh() {
    const r = await window.api.artisan.suppliers.list();
    if (r.ok) suppliers = r.data;
    render();
  }

  function render() {
    if (!containerEl) return;
    const rows = suppliers.length ? suppliers.map(s => `
      <tr data-id="${s.id}">
        <td><strong>${escapeHtml(s.nom)}</strong></td>
        <td class="muted small">${escapeHtml(s.contact || '')}</td>
        <td class="muted small">${escapeHtml(s.telephone || '')} ${s.email ? '· ' + escapeHtml(s.email) : ''}</td>
        <td class="center"><span class="badge">${s.nb_prix} prix</span></td>
        <td class="center actions">
          <button class="btn-icon" data-action="prices" title="Voir les prix">📋</button>
          <button class="btn-icon" data-action="edit" title="Modifier">✏️</button>
          <button class="btn-icon danger" data-action="delete" title="Supprimer">🗑</button>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="5" class="empty">Aucun fournisseur. Crée ton carnet pour comparer les prix.</td></tr>';

    containerEl.innerHTML = `
      <div class="page-header">
        <h1>🏪 Fournisseurs <span class="muted small">(${suppliers.length})</span></h1>
        <div class="page-actions">
          <button class="btn primary" id="btn-new-sup">+ Nouveau fournisseur</button>
        </div>
      </div>
      <p class="muted">Carnet de tes fournisseurs avec leurs prix négociés. Permet de retrouver rapidement un tarif et de comparer entre fournisseurs.</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Nom</th>
            <th style="width:160px">Contact</th>
            <th>Tél / Email</th>
            <th class="center" style="width:90px">Prix</th>
            <th class="center" style="width:130px">Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    $('#btn-new-sup').onclick = () => openSupModal(null);
    $$('[data-action]').forEach(btn => {
      btn.onclick = async () => {
        const id = parseInt(btn.closest('tr').dataset.id, 10);
        const s = suppliers.find(x => x.id === id);
        if (btn.dataset.action === 'edit') openSupModal(s);
        if (btn.dataset.action === 'prices') {
          const r = await window.api.artisan.suppliers.get({ id });
          if (r.ok) openPricesModal(r.data);
        }
        if (btn.dataset.action === 'delete') {
          if (await confirmModal('Supprimer ce fournisseur ?', `« ${s.nom} » et tous ses prix associés.`)) {
            const r = await window.api.artisan.suppliers.delete({ id });
            if (r.ok) { toast('Supprimé', 'success'); refresh(); }
          }
        }
      };
    });
  }

  function openSupModal(sup) {
    const isEdit = !!sup;
    return modal({
      title: isEdit ? 'Modifier le fournisseur' : 'Nouveau fournisseur',
      content: `
        <div class="form-grid">
          <label class="full">Nom *<input id="f-nom" value="${escapeHtml(sup && sup.nom || '')}"></label>
          <label>Contact<input id="f-contact" value="${escapeHtml(sup && sup.contact || '')}"></label>
          <label>Téléphone<input id="f-tel" value="${escapeHtml(sup && sup.telephone || '')}"></label>
          <label>Email<input id="f-email" value="${escapeHtml(sup && sup.email || '')}"></label>
          <label class="full">Adresse<textarea id="f-adresse" rows="2">${escapeHtml(sup && sup.adresse || '')}</textarea></label>
          <label class="full">Notes<textarea id="f-notes" rows="2">${escapeHtml(sup && sup.notes || '')}</textarea></label>
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
            contact: body.querySelector('#f-contact').value.trim(),
            telephone: body.querySelector('#f-tel').value.trim(),
            email: body.querySelector('#f-email').value.trim(),
            adresse: body.querySelector('#f-adresse').value.trim(),
            notes: body.querySelector('#f-notes').value.trim()
          };
          if (!payload.nom) return toast('Nom requis', 'danger');
          const r = isEdit
            ? await window.api.artisan.suppliers.update({ id: sup.id, ...payload })
            : await window.api.artisan.suppliers.create(payload);
          if (r.ok) { toast(isEdit ? 'Modifié' : 'Créé', 'success'); close(true); refresh(); }
          else toast('Erreur : ' + r.error, 'danger');
        };
      }
    });
  }

  function openPricesModal(supplier) {
    let prix = supplier.prix || [];
    const renderTable = () => prix.length ? prix.map(p => `
      <tr data-id="${p.id}">
        <td>${escapeHtml(p.designation)}</td>
        <td class="muted small">${escapeHtml(p.reference || '')}</td>
        <td class="center small">${escapeHtml(p.unite || '')}</td>
        <td class="right"><strong>${formatEUR(p.prix)}</strong></td>
        <td class="center actions">
          <button class="btn-icon" data-action="edit-p">✏️</button>
          <button class="btn-icon danger" data-action="del-p">🗑</button>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="5" class="empty">Aucun prix enregistré pour ce fournisseur</td></tr>';

    return modal({
      title: `Prix de « ${supplier.nom} »`,
      large: true,
      content: `
        <div class="page-actions" style="margin-bottom:12px">
          <button class="btn primary" id="btn-add-price">+ Ajouter un prix</button>
        </div>
        <div class="table-wrap" style="max-height:480px">
          <table class="data-table">
            <thead><tr>
              <th>Désignation</th>
              <th style="width:100px">Référence</th>
              <th class="center" style="width:60px">U.</th>
              <th class="right" style="width:110px">Prix HT</th>
              <th class="center" style="width:90px">Actions</th>
            </tr></thead>
            <tbody id="prix-tbody">${renderTable()}</tbody>
          </table>
        </div>
      `,
      footer: `<button class="btn primary" data-action="close">Fermer</button>`,
      onMount: ({ body, footer, close }) => {
        async function reloadPrices() {
          const r = await window.api.artisan.suppliers.get({ id: supplier.id });
          if (r.ok) {
            prix = r.data.prix || [];
            body.querySelector('#prix-tbody').innerHTML = renderTable();
            bindRows();
          }
        }
        function bindRows() {
          $$('[data-action="edit-p"]', body).forEach(btn => {
            btn.onclick = () => {
              const id = parseInt(btn.closest('tr').dataset.id, 10);
              openPriceForm(prix.find(p => p.id === id), reloadPrices);
            };
          });
          $$('[data-action="del-p"]', body).forEach(btn => {
            btn.onclick = async () => {
              const id = parseInt(btn.closest('tr').dataset.id, 10);
              const p = prix.find(x => x.id === id);
              if (await confirmModal('Supprimer ce prix ?', `« ${p.designation} »`)) {
                const r = await window.api.artisan.suppliers.deletePrice({ id });
                if (r.ok) { toast('Supprimé', 'success'); reloadPrices(); }
              }
            };
          });
        }
        function openPriceForm(p, onSaved) {
          const isEdit = !!p;
          modal({
            title: isEdit ? 'Modifier le prix' : 'Ajouter un prix',
            content: `
              <div class="form-grid">
                <label class="full">Désignation *<input id="p-desig" value="${escapeHtml(p && p.designation || '')}"></label>
                <label>Référence<input id="p-ref" value="${escapeHtml(p && p.reference || '')}"></label>
                <label>Unité<input id="p-unit" value="${escapeHtml(p && p.unite || '')}"></label>
                <label>Prix HT *<input id="p-prix" type="number" step="0.01" value="${p && p.prix != null ? p.prix : ''}"></label>
                <label class="full">Notes<textarea id="p-notes" rows="2">${escapeHtml(p && p.notes || '')}</textarea></label>
              </div>
            `,
            footer: `
              <button class="btn ghost" data-action="cancel">Annuler</button>
              <button class="btn primary" data-action="save">${isEdit ? 'Enregistrer' : 'Créer'}</button>
            `,
            onMount: ({ body: b, footer: f, close: c }) => {
              f.querySelector('[data-action="cancel"]').onclick = () => c(null);
              f.querySelector('[data-action="save"]').onclick = async () => {
                const payload = {
                  designation: b.querySelector('#p-desig').value.trim(),
                  reference: b.querySelector('#p-ref').value.trim(),
                  unite: b.querySelector('#p-unit').value.trim(),
                  prix: b.querySelector('#p-prix').value,
                  notes: b.querySelector('#p-notes').value.trim()
                };
                if (!payload.designation) return toast('Désignation requise', 'danger');
                const r = isEdit
                  ? await window.api.artisan.suppliers.updatePrice({ id: p.id, ...payload })
                  : await window.api.artisan.suppliers.addPrice({ supplierId: supplier.id, ...payload });
                if (r.ok) { toast(isEdit ? 'Modifié' : 'Créé', 'success'); c(true); onSaved && onSaved(); }
                else toast('Erreur : ' + r.error, 'danger');
              };
            }
          });
        }

        body.querySelector('#btn-add-price').onclick = () => openPriceForm(null, reloadPrices);
        bindRows();
        footer.querySelector('[data-action="close"]').onclick = () => close(true);
      }
    });
  }

  window.ArtisanSuppliersPage = {
    async render(container) {
      containerEl = container;
      containerEl.innerHTML = '<div class="loader">Chargement…</div>';
      await refresh();
    }
  };
})();
