// ui/etude-compos.js — Compositions / sous-détails (3 parties + perte)
(function () {
  const { $, $$, escapeHtml, formatEUR, formatNum, toast, modal, confirmModal } = window.UI;

  // Catégories d'items dans une composition
  const CATEGORIES = [
    { key: 'materiau', label: '📦 Matériaux',     color: '#5b8def' },
    { key: 'materiel', label: '🔧 Matériel',      color: '#f0a868' },
    { key: 'mo',       label: '👷 Main d\'œuvre', color: '#4caf7c' }
  ];

  let compositions = [];
  let containerEl = null;
  let pricesCache = [];

  async function refresh() {
    const r = await window.api.etude.compos.list();
    if (r.ok) compositions = r.data;
    const pr = await window.api.etude.prices.list({});
    if (pr.ok) pricesCache = pr.data;
    render();
  }

  function render() {
    if (!containerEl) return;
    const rows = compositions.length ? compositions.map(c => {
      const st = c.sous_totaux || { materiau: 0, materiel: 0, mo: 0 };
      return `
        <tr data-id="${c.id}">
          <td>${escapeHtml(c.nom)}</td>
          <td class="center">${escapeHtml(c.unite || '—')}</td>
          <td class="right small muted">${formatEUR(st.materiau)}</td>
          <td class="right small muted">${formatEUR(st.materiel)}</td>
          <td class="right small muted">${formatEUR(st.mo)}</td>
          <td class="right"><strong>${formatEUR(c.total)}</strong></td>
          <td class="center actions">
            <button class="btn-icon" data-action="edit">✏️</button>
            <button class="btn-icon" data-action="dup" title="Dupliquer">📋</button>
            <button class="btn-icon danger" data-action="delete">🗑</button>
          </td>
        </tr>
      `;
    }).join('') : '<tr><td colspan="7" class="empty">Aucune composition. Crée-en une à partir de tes prix existants.</td></tr>';

    containerEl.innerHTML = `
      <div class="page-header">
        <h1>🧱 Compositions / sous-détails <span class="muted small">(${compositions.length})</span></h1>
        <div class="page-actions">
          <button class="btn primary" id="btn-new-compo">+ Nouvelle composition</button>
        </div>
      </div>
      <p class="muted">Une composition (sous-détail) regroupe les <strong>matériaux</strong>, le <strong>matériel</strong> et la <strong>main d'œuvre</strong> nécessaires à 1 unité d'ouvrage. Le total est le <strong>déboursé sec</strong>.</p>

      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Nom</th>
            <th class="center" style="width:60px">Unité</th>
            <th class="right" style="width:100px">📦 Mat.</th>
            <th class="right" style="width:100px">🔧 Matériel</th>
            <th class="right" style="width:100px">👷 MO</th>
            <th class="right" style="width:120px">Déboursé sec</th>
            <th class="center" style="width:120px">Actions</th>
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
        if (btn.dataset.action === 'dup') {
          const r = await window.api.etude.compos.get({ id });
          if (r.ok) {
            const cloned = { ...r.data, id: null, nom: r.data.nom + ' (copie)' };
            openCompoModal(cloned);
          }
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
    const isEdit = !!(compo && compo.id);
    // Items normalisés (avec catégorie par défaut 'materiau' si absent)
    let items = (compo && compo.items) ? compo.items.map(it => ({
      priceId: it.price_id || it.priceId || null,
      designationLibre: it.designation_libre || it.designationLibre || it.price_designation || '',
      unite: it.unite || it.price_unite || '',
      categorie: it.categorie || 'materiau',
      quantite: it.quantite != null ? it.quantite : 1,
      prixUnitaire: it.prix_unitaire != null ? it.prix_unitaire : (it.prixUnitaire || 0),
      tauxPerte: it.taux_perte != null ? it.taux_perte : (it.tauxPerte || 0)
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

        ${CATEGORIES.map(cat => `
          <div class="compo-section" data-cat="${cat.key}">
            <div class="compo-section-header" style="border-left:4px solid ${cat.color}">
              <h3 style="color:${cat.color}">${cat.label}</h3>
              <div class="compo-section-actions">
                <button class="btn ghost small" data-add-base="${cat.key}">+ Depuis base</button>
                <button class="btn ghost small" data-add-libre="${cat.key}">+ Ligne libre</button>
              </div>
            </div>
            <table class="data-table compo-items-table">
              <thead><tr>
                <th>Désignation</th>
                <th class="center" style="width:60px">U.</th>
                <th class="right" style="width:80px">Qté</th>
                <th class="right" style="width:90px">P.U.</th>
                <th class="right" style="width:80px">% perte</th>
                <th class="right" style="width:100px">Total</th>
                <th style="width:40px"></th>
              </tr></thead>
              <tbody data-tbody="${cat.key}"></tbody>
              <tfoot><tr>
                <td colspan="5" class="right"><em>Sous-total ${cat.label.replace(/^[^\\s]+\\s/, '')}</em></td>
                <td class="right"><strong data-sub="${cat.key}">0,00 €</strong></td>
                <td></td>
              </tr></tfoot>
            </table>
          </div>
        `).join('')}

        <div class="compo-total-block">
          <span>Déboursé sec total</span>
          <span class="big" id="compo-total">0,00 €</span>
        </div>
      `,
      footer: `
        <button class="btn ghost" data-action="cancel">Annuler</button>
        <button class="btn primary" data-action="save">${isEdit ? 'Enregistrer' : 'Créer'}</button>
      `,
      onMount: ({ body, footer, close }) => {
        function calcCost(it) {
          const q = parseFloat(it.quantite) || 0;
          const pu = parseFloat(it.prixUnitaire) || 0;
          const p = parseFloat(it.tauxPerte) || 0;
          return q * pu * (1 + p / 100);
        }
        function renderCategory(catKey) {
          const tbody = body.querySelector(`tbody[data-tbody="${catKey}"]`);
          const itemsCat = items.map((it, i) => ({ it, i })).filter(x => x.it.categorie === catKey);
          tbody.innerHTML = itemsCat.length ? itemsCat.map(({ it, i }) => `
            <tr data-idx="${i}">
              <td><input class="it-desig" value="${escapeHtml(it.designationLibre)}" ${it.priceId ? 'readonly title="Vient de la base de prix"' : ''}></td>
              <td><input class="it-unite" value="${escapeHtml(it.unite || '')}" style="width:100%"></td>
              <td><input class="it-qte" type="number" step="0.01" value="${it.quantite}" class="right"></td>
              <td><input class="it-pu" type="number" step="0.01" value="${it.prixUnitaire}" class="right"></td>
              <td><input class="it-perte" type="number" step="0.1" value="${it.tauxPerte}" class="right"></td>
              <td class="right it-total">${formatEUR(calcCost(it))}</td>
              <td class="center"><button class="btn-icon danger" data-action="rm">🗑</button></td>
            </tr>
          `).join('') : `<tr><td colspan="7" class="empty" style="padding:8px">Aucune ligne — utilise les boutons ci-dessus</td></tr>`;

          $$('tr[data-idx]', tbody).forEach(tr => {
            const idx = parseInt(tr.dataset.idx, 10);
            const recalcAll = () => {
              const q = parseFloat(tr.querySelector('.it-qte').value) || 0;
              const pu = parseFloat(tr.querySelector('.it-pu').value) || 0;
              const p = parseFloat(tr.querySelector('.it-perte').value) || 0;
              items[idx].quantite = q;
              items[idx].prixUnitaire = pu;
              items[idx].tauxPerte = p;
              items[idx].designationLibre = tr.querySelector('.it-desig').value;
              items[idx].unite = tr.querySelector('.it-unite').value;
              tr.querySelector('.it-total').textContent = formatEUR(calcCost(items[idx]));
              recalcSubtotals();
            };
            tr.querySelector('.it-desig').oninput = recalcAll;
            tr.querySelector('.it-unite').oninput = recalcAll;
            tr.querySelector('.it-qte').oninput = recalcAll;
            tr.querySelector('.it-pu').oninput = recalcAll;
            tr.querySelector('.it-perte').oninput = recalcAll;
            tr.querySelector('[data-action="rm"]').onclick = () => {
              items.splice(idx, 1);
              renderAll();
            };
          });
        }
        function recalcSubtotals() {
          let total = 0;
          CATEGORIES.forEach(cat => {
            const sub = items.filter(it => it.categorie === cat.key).reduce((s, it) => s + calcCost(it), 0);
            const el = body.querySelector(`[data-sub="${cat.key}"]`);
            if (el) el.textContent = formatEUR(sub);
            total += sub;
          });
          body.querySelector('#compo-total').textContent = formatEUR(total);
        }
        function renderAll() {
          CATEGORIES.forEach(c => renderCategory(c.key));
          recalcSubtotals();
        }
        renderAll();

        // Boutons "+ Depuis base" et "+ Ligne libre" pour chaque catégorie
        $$('[data-add-libre]', body).forEach(btn => {
          btn.onclick = () => {
            items.push({
              priceId: null, designationLibre: '', unite: '',
              categorie: btn.dataset.addLibre,
              quantite: 1, prixUnitaire: 0, tauxPerte: 0
            });
            renderAll();
          };
        });
        $$('[data-add-base]', body).forEach(btn => {
          btn.onclick = async () => {
            const picked = await window.openPricePicker();
            if (picked) {
              items.push({
                priceId: picked.id,
                designationLibre: picked.designation,
                unite: picked.unite || '',
                categorie: btn.dataset.addBase,
                quantite: 1,
                prixUnitaire: picked.prix,
                tauxPerte: 0
              });
              renderAll();
            }
          };
        });

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

  // ---------- Pickers (réutilisés par etude-quotes) ----------
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
                <th class="right" style="width:140px">Déboursé sec</th>
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
