// ui/etude-compos.js — Page Compositions / sous-détails
(function () {
  const { $, $$, escapeHtml, formatEUR, formatNum, toast, modal, confirmModal } = window.UI;

  let compositions = [];
  let containerEl = null;
  let pricesCache = []; // pour le picker dans la modale

  async function refresh() {
    const r = await window.api.etude.compos.list();
    if (r.ok) compositions = r.data;
    const pr = await window.api.etude.prices.list({});
    if (pr.ok) pricesCache = pr.data;
    render();
  }

  function render() {
    if (!containerEl) return;
    const rows = compositions.length ? compositions.map(c => `
      <tr data-id="${c.id}">
        <td>${escapeHtml(c.nom)}</td>
        <td class="center">${escapeHtml(c.unite || '—')}</td>
        <td>${escapeHtml(c.description || '')}</td>
        <td class="right">${formatEUR(c.total)}</td>
        <td class="center actions">
          <button class="btn-icon" data-action="edit">✏️</button>
          <button class="btn-icon danger" data-action="delete">🗑</button>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="5" class="empty">Aucune composition. Crée-en une à partir de tes prix existants.</td></tr>';

    containerEl.innerHTML = `
      <div class="page-header">
        <h1>🧱 Compositions / sous-détails <span class="muted small">(${compositions.length})</span></h1>
        <div class="page-actions">
          <button class="btn primary" id="btn-new-compo">+ Nouvelle composition</button>
        </div>
      </div>
      <p class="muted">Une composition est un bloc réutilisable, ex: <em>"1 m² de mur parpaing 20 = X parpaings + Y kg ciment + Z h main d'œuvre"</em>. Tu peux ensuite l'insérer dans un devis comme une seule ligne.</p>

      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Nom</th><th class="center" style="width:80px">Unité</th>
            <th>Description</th><th class="right" style="width:120px">Coût total</th>
            <th class="center" style="width:90px">Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    $('#btn-new-compo').onclick = () => openCompoModal(null);
    $$('[data-action]').forEach(btn => {
      btn.onclick = async () => {
        const tr = btn.closest('tr');
        const id = parseInt(tr.dataset.id, 10);
        if (btn.dataset.action === 'edit') {
          const r = await window.api.etude.compos.get({ id });
          if (r.ok) openCompoModal(r.data);
        }
        if (btn.dataset.action === 'delete') {
          const c = compositions.find(x => x.id === id);
          if (await confirmModal('Supprimer cette composition ?', `« ${c.nom} »`)) {
            const r = await window.api.etude.compos.delete({ id });
            if (r.ok) { toast('Supprimée', 'success'); refresh(); }
            else toast('Erreur : ' + r.error, 'danger');
          }
        }
      };
    });
  }

  function openCompoModal(compo) {
    const isEdit = !!compo;
    const items = (compo && compo.items) ? compo.items.map(it => ({
      priceId: it.price_id || null,
      designationLibre: it.designation_libre || it.price_designation || '',
      unite: it.price_unite || '',
      quantite: it.quantite || 1,
      prixUnitaire: it.prix_unitaire || 0
    })) : [];

    return modal({
      title: isEdit ? 'Modifier la composition' : 'Nouvelle composition',
      large: true,
      content: `
        <div class="form-grid">
          <label class="full">Nom *<input id="f-nom" value="${escapeHtml(compo && compo.nom || '')}"></label>
          <label>Unité (résultat)<input id="f-unite" value="${escapeHtml(compo && compo.unite || '')}" placeholder="ex: m², ml, u"></label>
          <label class="full">Description<textarea id="f-desc" rows="2">${escapeHtml(compo && compo.description || '')}</textarea></label>
        </div>
        <h3 style="margin-top:16px">Composants</h3>
        <table class="data-table">
          <thead><tr>
            <th>Désignation</th>
            <th style="width:60px" class="center">U.</th>
            <th style="width:100px" class="right">Quantité</th>
            <th style="width:120px" class="right">Prix unit.</th>
            <th style="width:120px" class="right">Total</th>
            <th style="width:60px"></th>
          </tr></thead>
          <tbody id="compo-items"></tbody>
          <tfoot><tr>
            <td colspan="4" class="right"><strong>Total composition :</strong></td>
            <td class="right"><strong id="compo-total">0,00 €</strong></td>
            <td></td>
          </tr></tfoot>
        </table>
        <div class="form-row" style="margin-top:8px">
          <button class="btn ghost" id="btn-add-from-base">+ Depuis la base</button>
          <button class="btn ghost" id="btn-add-libre">+ Ligne libre</button>
        </div>
      `,
      footer: `
        <button class="btn ghost" data-action="cancel">Annuler</button>
        <button class="btn primary" data-action="save">${isEdit ? 'Enregistrer' : 'Créer'}</button>
      `,
      onMount: ({ body, footer, close }) => {
        const tbody = body.querySelector('#compo-items');

        function renderItems() {
          tbody.innerHTML = items.map((it, i) => `
            <tr data-idx="${i}">
              <td><input class="it-desig" value="${escapeHtml(it.designationLibre)}" ${it.priceId ? 'readonly' : ''}></td>
              <td><input class="it-unite" value="${escapeHtml(it.unite || '')}" style="width:100%"></td>
              <td><input class="it-qte" type="number" step="0.01" value="${it.quantite}" class="right"></td>
              <td><input class="it-pu" type="number" step="0.01" value="${it.prixUnitaire}" class="right"></td>
              <td class="right it-total">${formatEUR((parseFloat(it.quantite) || 0) * (parseFloat(it.prixUnitaire) || 0))}</td>
              <td class="center"><button class="btn-icon danger" data-action="remove-item">🗑</button></td>
            </tr>
          `).join('');
          let total = 0;
          items.forEach(it => total += (parseFloat(it.quantite) || 0) * (parseFloat(it.prixUnitaire) || 0));
          body.querySelector('#compo-total').textContent = formatEUR(total);

          $$('tr', tbody).forEach(tr => {
            const idx = parseInt(tr.dataset.idx, 10);
            tr.querySelector('.it-desig').oninput = (e) => { items[idx].designationLibre = e.target.value; };
            tr.querySelector('.it-unite').oninput = (e) => { items[idx].unite = e.target.value; };
            const recalc = () => {
              const q = parseFloat(tr.querySelector('.it-qte').value) || 0;
              const pu = parseFloat(tr.querySelector('.it-pu').value) || 0;
              tr.querySelector('.it-total').textContent = formatEUR(q * pu);
              items[idx].quantite = q;
              items[idx].prixUnitaire = pu;
              let total = 0;
              items.forEach(it => total += (parseFloat(it.quantite) || 0) * (parseFloat(it.prixUnitaire) || 0));
              body.querySelector('#compo-total').textContent = formatEUR(total);
            };
            tr.querySelector('.it-qte').oninput = recalc;
            tr.querySelector('.it-pu').oninput = recalc;
            tr.querySelector('[data-action="remove-item"]').onclick = () => {
              items.splice(idx, 1);
              renderItems();
            };
          });
        }
        renderItems();

        body.querySelector('#btn-add-libre').onclick = () => {
          items.push({ priceId: null, designationLibre: '', unite: '', quantite: 1, prixUnitaire: 0 });
          renderItems();
        };
        body.querySelector('#btn-add-from-base').onclick = async () => {
          const picked = await openPricePicker();
          if (picked) {
            items.push({
              priceId: picked.id,
              designationLibre: picked.designation,
              unite: picked.unite || '',
              quantite: 1,
              prixUnitaire: picked.prix
            });
            renderItems();
          }
        };

        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);
        footer.querySelector('[data-action="save"]').onclick = async () => {
          const payload = {
            nom: body.querySelector('#f-nom').value.trim(),
            unite: body.querySelector('#f-unite').value.trim(),
            description: body.querySelector('#f-desc').value.trim(),
            items
          };
          if (!payload.nom) return toast('Nom requis', 'danger');
          const r = isEdit
            ? await window.api.etude.compos.update({ id: compo.id, ...payload })
            : await window.api.etude.compos.create(payload);
          if (r.ok) { toast(isEdit ? 'Modifiée' : 'Créée', 'success'); close(true); refresh(); }
          else toast('Erreur : ' + r.error, 'danger');
        };
      }
    });
  }

  // Picker de prix (réutilisable, exporté)
  function openPricePicker() {
    return new Promise((resolve) => {
      const list = pricesCache;
      modal({
        title: 'Choisir un prix de la base',
        large: true,
        content: `
          <input type="text" id="picker-search" placeholder="🔍 Rechercher…" style="width:100%; margin-bottom:12px">
          <div class="table-wrap" style="max-height:400px">
            <table class="data-table">
              <thead><tr>
                <th>Repère</th><th>Désignation</th><th class="center" style="width:60px">U.</th>
                <th class="right" style="width:100px">Prix</th>
                <th style="width:80px"></th>
              </tr></thead>
              <tbody id="picker-tbody"></tbody>
            </table>
          </div>
        `,
        footer: `<button class="btn ghost" data-action="cancel">Annuler</button>`,
        onMount: ({ body, footer, close }) => {
          const tbody = body.querySelector('#picker-tbody');
          const renderRows = (items) => {
            tbody.innerHTML = items.length ? items.slice(0, 200).map(p => `
              <tr data-id="${p.id}">
                <td>${escapeHtml(p.repere || '')}</td>
                <td>${escapeHtml(p.designation)}</td>
                <td class="center">${escapeHtml(p.unite || '')}</td>
                <td class="right">${formatEUR(p.prix)}</td>
                <td class="center"><button class="btn primary small" data-action="pick">Choisir</button></td>
              </tr>
            `).join('') : '<tr><td colspan="5" class="empty">Aucun résultat</td></tr>';
            $$('[data-action="pick"]', tbody).forEach(btn => {
              btn.onclick = () => {
                const id = parseInt(btn.closest('tr').dataset.id, 10);
                const picked = list.find(p => p.id === id);
                close(true);
                resolve(picked);
              };
            });
          };
          renderRows(list);
          body.querySelector('#picker-search').oninput = (e) => {
            const q = e.target.value.toLowerCase();
            const filtered = list.filter(p =>
              (p.designation || '').toLowerCase().includes(q) ||
              (p.repere || '').toLowerCase().includes(q)
            );
            renderRows(filtered);
          };
          footer.querySelector('[data-action="cancel"]').onclick = () => { close(null); resolve(null); };
        }
      });
    });
  }

  // Exposé pour le module Devis
  window.openPricePicker = openPricePicker;
  window.openCompoPicker = function () {
    return new Promise((resolve) => {
      modal({
        title: 'Choisir une composition',
        large: true,
        content: `
          <div class="table-wrap" style="max-height:400px">
            <table class="data-table">
              <thead><tr>
                <th>Nom</th><th class="center" style="width:80px">Unité</th>
                <th class="right" style="width:140px">Coût total</th>
                <th style="width:80px"></th>
              </tr></thead>
              <tbody id="picker-c-tbody"></tbody>
            </table>
          </div>
        `,
        footer: `<button class="btn ghost" data-action="cancel">Annuler</button>`,
        onMount: ({ body, footer, close }) => {
          const tbody = body.querySelector('#picker-c-tbody');
          tbody.innerHTML = compositions.length ? compositions.map(c => `
            <tr data-id="${c.id}">
              <td>${escapeHtml(c.nom)}</td>
              <td class="center">${escapeHtml(c.unite || '')}</td>
              <td class="right">${formatEUR(c.total)}</td>
              <td class="center"><button class="btn primary small" data-action="pick">Choisir</button></td>
            </tr>
          `).join('') : '<tr><td colspan="4" class="empty">Aucune composition</td></tr>';
          $$('[data-action="pick"]', tbody).forEach(btn => {
            btn.onclick = () => {
              const id = parseInt(btn.closest('tr').dataset.id, 10);
              const picked = compositions.find(c => c.id === id);
              close(true);
              resolve(picked);
            };
          });
          footer.querySelector('[data-action="cancel"]').onclick = () => { close(null); resolve(null); };
        }
      });
    });
  };

  window.EtudeComposPage = {
    async render(container) {
      containerEl = container;
      containerEl.innerHTML = '<div class="loader">Chargement…</div>';
      await refresh();
    }
  };
})();
