// ui/artisan-kpv.js — KPV avec 2 onglets :
//   1) Saisie directe des %
//   2) Calcul depuis les frais réels (CA + charges → % auto)
(function () {
  const { $, $$, escapeHtml, formatEUR, formatNum, toast, modal, confirmModal } = window.UI;

  let containerEl = null;
  let kpvData = null;
  let fraisData = null;
  let currentTab = 'pct'; // 'pct' ou 'frais'

  const PARAMS = [
    { key: 'frais_chantier_pct',  label: 'Frais de chantier %',  short: 'FC', help: 'Petit outillage, EPI, encadrement chantier' },
    { key: 'aleas_pct',           label: 'Aléas %',              short: 'A',  help: 'Provision pour imprévus' },
    { key: 'frais_operation_pct', label: 'Frais d\'opération %', short: 'FO', help: 'Études, plans propres à l\'affaire' },
    { key: 'frais_generaux_pct',  label: 'Frais généraux %',     short: 'FG', help: 'Loyer, comptable, banque, assurance' },
    { key: 'benefice_pct',        label: 'Bénéfice %',           short: 'B',  help: 'Marge nette voulue' }
  ];

  const FRAIS_CATEGORIES = [
    { key: 'fg',    label: 'Frais généraux',    color: '#5b8def', placeholder: 'Loyer / Banque / Comptable / Assurance / Internet / …' },
    { key: 'fc',    label: 'Frais de chantier', color: '#f0a868', placeholder: 'Petit outillage / EPI / Vêtements / …' },
    { key: 'fo',    label: 'Frais d\'opération', color: '#9966cc', placeholder: 'Études spécifiques / Sous-traitance ponctuelle / …' },
    { key: 'aleas', label: 'Aléas',             color: '#e15a5a', placeholder: 'Provision pour imprévus' }
  ];

  function computeCoef(p) {
    const fc = parseFloat(p.frais_chantier_pct) || 0;
    const fo = parseFloat(p.frais_operation_pct) || 0;
    const fg = parseFloat(p.frais_generaux_pct) || 0;
    const b  = parseFloat(p.benefice_pct) || 0;
    const a  = parseFloat(p.aleas_pct) || 0;
    if (p.mode_calcul === 'pct_pv') {
      const sum = Math.min(99.99, Math.max(0, fc + fo + fg + b + a));
      return 1 / (1 - sum / 100);
    }
    if (p.mode_calcul === 'btp') {
      const dt = 1 + (fc + a) / 100;
      const cr = dt * (1 + (fo + fg) / 100);
      const bC = Math.min(99.99, Math.max(0, b));
      return cr / (1 - bC / 100);
    }
    if (p.mode_calcul === 'multiplicatif') {
      return (1 + fc / 100) * (1 + fo / 100) * (1 + fg / 100) * (1 + b / 100) * (1 + a / 100);
    }
    return 1 + (fc + fo + fg + b + a) / 100;
  }

  async function refresh() {
    const r = await window.api.artisan.kpv.listAll();
    if (r.ok) kpvData = r.data;
    const fr = await window.api.artisan.fraisReels.get();
    if (fr.ok) fraisData = fr.data;
    render();
  }

  function render() {
    if (!containerEl || !kpvData) return;
    containerEl.innerHTML = `
      <div class="page-header">
        <h1>⚙️ Paramètres KPV</h1>
      </div>
      <p class="muted">Le <strong>KPV (Coefficient de Prix de Vente)</strong> permet de passer du déboursé sec au prix de vente HT. 2 façons de le définir.</p>

      <div class="tabs-bar">
        <button class="tab ${currentTab === 'pct' ? 'active' : ''}" data-tab="pct">📐 Saisie directe des %</button>
        <button class="tab ${currentTab === 'frais' ? 'active' : ''}" data-tab="frais">💡 Calculer depuis mes frais réels</button>
      </div>

      <div id="tab-content"></div>
    `;
    $$('.tab').forEach(t => t.onclick = () => { currentTab = t.dataset.tab; render(); });
    if (currentTab === 'pct') renderTabPct();
    else renderTabFrais();
  }

  // -----------------------------------------------------------------------
  // ONGLET 1 : Saisie directe des %
  // -----------------------------------------------------------------------
  function renderTabPct() {
    const g = kpvData.global;
    const lotsRows = kpvData.lots.length ? kpvData.lots.map(({ lot, kpv, coef }) => `
      <tr data-lot-id="${lot.id}">
        <td><span class="lot-chip" style="background:${escapeHtml(lot.couleur || '#5b8def')}22;color:${escapeHtml(lot.couleur || '#5b8def')}">${escapeHtml(lot.code ? lot.code + ' — ' : '')}${escapeHtml(lot.nom)}</span></td>
        <td class="center small">${kpv.is_override ? '<strong style="color:var(--warning)">Spécifique</strong>' : '<span class="muted">Hérite global</span>'}</td>
        <td class="right">${formatNum((coef - 1) * 100, 2)} %</td>
        <td class="right"><strong>×${formatNum(coef, 4)}</strong></td>
        <td class="center actions">
          <button class="btn-icon" data-action="edit-lot" title="Personnaliser">✏️</button>
          ${kpv.is_override ? '<button class="btn-icon danger" data-action="reset-lot" title="Revenir au global">↺</button>' : ''}
        </td>
      </tr>
    `).join('') : '<tr><td colspan="5" class="empty">Pas de lots définis</td></tr>';

    $('#tab-content').innerHTML = `
      <div class="card-block">
        <h3>KPV Global</h3>

        <div class="form-row" style="margin-bottom:12px;flex-wrap:wrap">
          <label class="radio">
            <input type="radio" name="mode-calcul" value="pct_pv" ${g.mode_calcul === 'pct_pv' ? 'checked' : ''}>
            <span><strong>% du PV (recommandé)</strong></span>
          </label>
          <label class="radio" style="margin-left:14px">
            <input type="radio" name="mode-calcul" value="btp" ${g.mode_calcul === 'btp' ? 'checked' : ''}>
            <span>BTP cascade</span>
          </label>
          <label class="radio" style="margin-left:14px">
            <input type="radio" name="mode-calcul" value="additif" ${g.mode_calcul === 'additif' ? 'checked' : ''}>
            <span>Additif</span>
          </label>
          <label class="radio" style="margin-left:14px">
            <input type="radio" name="mode-calcul" value="multiplicatif" ${g.mode_calcul === 'multiplicatif' ? 'checked' : ''}>
            <span>Multiplicatif</span>
          </label>
        </div>

        <div class="form-grid">
          ${PARAMS.map(p => `
            <label>${p.label}
              <input class="kpv-input" data-key="${p.key}" type="number" step="0.1" value="${formatNum(g[p.key] || 0, 2)}">
              <small class="muted">${p.help}</small>
            </label>
          `).join('')}
        </div>

        <div class="kpv-result-block">
          <span>KPV résultant</span>
          <span class="kpv-coef" id="kpv-coef-out">×${formatNum(kpvData.global_coef, 4)}</span>
          <span class="kpv-pct" id="kpv-pct-out">(+${formatNum((kpvData.global_coef - 1) * 100, 2)} %)</span>
          <button class="btn primary" id="btn-save-global" style="margin-left:auto">💾 Enregistrer</button>
        </div>

        <h4 style="margin-top:18px">Tableau de calcul (pour 1 000 € de déboursé sec)</h4>
        <table class="data-table kpv-breakdown" id="kpv-breakdown"></table>
      </div>

      <h3>KPV par lot</h3>
      <p class="muted small">Personnalise le KPV par lot si besoin (ex: bénéfice plus élevé sur la plomberie).</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Lot</th>
            <th class="center" style="width:100px">Statut</th>
            <th class="right" style="width:100px">Marge totale</th>
            <th class="right" style="width:120px">Coefficient</th>
            <th class="center" style="width:90px">Actions</th>
          </tr></thead>
          <tbody>${lotsRows}</tbody>
        </table>
      </div>
    `;

    const recalc = async () => {
      const cur = collectGlobalParams();
      const coef = computeCoef(cur);
      $('#kpv-coef-out').textContent = '×' + formatNum(coef, 4);
      $('#kpv-pct-out').textContent = '(+' + formatNum((coef - 1) * 100, 2) + ' %)';
      const r = await window.api.artisan.kpv.explain({ params: cur, ds: 1000 });
      if (r.ok) renderBreakdown(r.data);
    };
    $$('input[name="mode-calcul"]').forEach(r => r.onchange = recalc);
    $$('.kpv-input').forEach(i => i.oninput = recalc);
    recalc();

    $('#btn-save-global').onclick = async () => {
      const r = await window.api.artisan.kpv.setGlobal(collectGlobalParams());
      if (r.ok) { toast('KPV global enregistré', 'success'); refresh(); }
      else toast('Erreur : ' + r.error, 'danger');
    };
    $$('[data-action="edit-lot"]').forEach(btn => {
      btn.onclick = () => {
        const id = parseInt(btn.closest('tr').dataset.lotId, 10);
        openLotKpvModal(kpvData.lots.find(l => l.lot.id === id));
      };
    });
    $$('[data-action="reset-lot"]').forEach(btn => {
      btn.onclick = async () => {
        const id = parseInt(btn.closest('tr').dataset.lotId, 10);
        if (await confirmModal('Revenir au KPV global ?', 'Le KPV spécifique sera supprimé.')) {
          const r = await window.api.artisan.kpv.setForLot({ lotId: id, params: null });
          if (r.ok) { toast('Réinitialisé', 'success'); refresh(); }
        }
      };
    });
  }

  function renderBreakdown(rows) {
    const tbody = rows.map(r => `
      <tr ${r.highlight ? 'class="bk-highlight"' : ''}>
        <td><strong>${escapeHtml(r.abbr)}</strong></td>
        <td>${escapeHtml(r.label)}</td>
        <td class="muted small">${escapeHtml(r.formule || '')}</td>
        <td class="right"><strong>${formatEUR(r.valeur)}</strong></td>
      </tr>
    `).join('');
    $('#kpv-breakdown').innerHTML = `
      <thead><tr><th style="width:60px">Abr.</th><th>Désignation</th><th>Formule</th><th class="right" style="width:130px">Valeur</th></tr></thead>
      <tbody>${tbody}</tbody>
    `;
  }

  function collectGlobalParams() {
    const params = { mode_calcul: $('input[name="mode-calcul"]:checked').value };
    PARAMS.forEach(p => {
      params[p.key] = parseFloat($(`.kpv-input[data-key="${p.key}"]`).value) || 0;
    });
    return params;
  }

  function openLotKpvModal({ lot, kpv }) {
    return modal({
      title: `KPV pour le lot « ${lot.nom} »`,
      large: true,
      content: `
        <div class="form-row" style="margin-bottom:12px;flex-wrap:wrap">
          ${['pct_pv', 'btp', 'additif', 'multiplicatif'].map(m => `
            <label class="radio" style="margin-right:14px">
              <input type="radio" name="lot-mode" value="${m}" ${kpv.mode_calcul === m ? 'checked' : ''}>
              <span>${m === 'pct_pv' ? '% du PV' : m === 'btp' ? 'BTP' : m.charAt(0).toUpperCase() + m.slice(1)}</span>
            </label>
          `).join('')}
        </div>
        <div class="form-grid">
          ${PARAMS.map(p => `
            <label>${p.label}
              <input class="lot-input" data-key="${p.key}" type="number" step="0.1" value="${formatNum(kpv[p.key] || 0, 2)}">
            </label>
          `).join('')}
        </div>
        <div class="kpv-result-block" style="margin-top:14px">
          <span>KPV du lot</span>
          <span class="kpv-coef" id="lot-coef-out">×${formatNum(computeCoef(kpv), 4)}</span>
        </div>
      `,
      footer: `
        <button class="btn ghost" data-action="cancel">Annuler</button>
        <button class="btn primary" data-action="save">Enregistrer</button>
      `,
      onMount: ({ body, footer, close }) => {
        const collect = () => {
          const params = { mode_calcul: body.querySelector('input[name="lot-mode"]:checked').value };
          PARAMS.forEach(p => {
            params[p.key] = parseFloat(body.querySelector(`.lot-input[data-key="${p.key}"]`).value) || 0;
          });
          return params;
        };
        const recalcLot = () => {
          body.querySelector('#lot-coef-out').textContent = '×' + formatNum(computeCoef(collect()), 4);
        };
        $$('.lot-input', body).forEach(i => i.oninput = recalcLot);
        $$('input[name="lot-mode"]', body).forEach(r => r.onchange = recalcLot);
        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);
        footer.querySelector('[data-action="save"]').onclick = async () => {
          const r = await window.api.artisan.kpv.setForLot({ lotId: lot.id, params: collect() });
          if (r.ok) { toast('KPV du lot enregistré', 'success'); close(true); refresh(); }
          else toast('Erreur : ' + r.error, 'danger');
        };
      }
    });
  }

  // -----------------------------------------------------------------------
  // ONGLET 2 : Calcul depuis les frais réels
  // -----------------------------------------------------------------------
  function renderTabFrais() {
    const f = fraisData || { ca_annuel: 0, benefice_voulu: 0, benefice_unit: 'eur', lignes: [] };

    const sectionsHtml = FRAIS_CATEGORIES.map(cat => `
      <div class="frais-section" data-cat="${cat.key}">
        <div class="frais-section-header" style="border-left:4px solid ${cat.color}">
          <h3 style="color:${cat.color}">${cat.label}</h3>
          <button class="btn ghost small" data-add-frais="${cat.key}">+ Ajouter une ligne</button>
        </div>
        <table class="data-table">
          <thead><tr>
            <th>Libellé</th>
            <th class="right" style="width:160px">Montant annuel</th>
            <th style="width:50px"></th>
          </tr></thead>
          <tbody data-tbody="${cat.key}"></tbody>
          <tfoot><tr>
            <td class="right"><em>Sous-total ${cat.label}</em></td>
            <td class="right"><strong data-sub="${cat.key}">0,00 €</strong></td>
            <td></td>
          </tr></tfoot>
        </table>
      </div>
    `).join('');

    $('#tab-content').innerHTML = `
      <div class="card-block">
        <h3>📊 Mon chiffre d'affaires annuel</h3>
        <div class="form-grid">
          <label class="full">CA annuel HT (en €)
            <input id="f-ca" type="number" step="100" value="${f.ca_annuel || 0}" placeholder="ex: 500000">
            <small class="muted">Soit ton CA réel de l'année passée, soit l'objectif que tu vises pour cette année.</small>
          </label>
        </div>
      </div>

      <div class="card-block">
        <h3>💸 Mes charges annuelles réelles</h3>
        <p class="muted small">Liste chaque poste de dépense. Tu peux ajouter autant de lignes que tu veux par catégorie. Tout est calculé en % de ton CA.</p>
        ${sectionsHtml}
      </div>

      <div class="card-block">
        <h3>💰 Bénéfice voulu</h3>
        <div class="form-grid">
          <label>Montant
            <input id="f-benef" type="number" step="0.01" value="${f.benefice_voulu || 0}">
          </label>
          <label>Unité
            <select id="f-benef-unit">
              <option value="eur" ${f.benefice_unit === 'eur' ? 'selected' : ''}>€ (montant annuel)</option>
              <option value="pct" ${f.benefice_unit === 'pct' ? 'selected' : ''}>% du CA</option>
            </select>
          </label>
        </div>
      </div>

      <div class="card-block frais-result">
        <h3>🎯 KPV calculé depuis tes vraies charges</h3>
        <table class="data-table" id="frais-recap"></table>
        <div class="kpv-result-block" style="margin-top:14px">
          <span>KPV final</span>
          <span class="kpv-coef" id="frais-coef">×—</span>
          <button class="btn ghost" id="btn-save-frais" style="margin-left:auto">💾 Enregistrer mes charges</button>
          <button class="btn primary" id="btn-apply-frais">✓ Appliquer ces % au KPV global</button>
        </div>
      </div>
    `;

    // État local des lignes (copie modifiable)
    let lignes = JSON.parse(JSON.stringify(f.lignes || []));

    function renderCategoryLines(catKey) {
      const tbody = $(`tbody[data-tbody="${catKey}"]`);
      const cat = FRAIS_CATEGORIES.find(c => c.key === catKey);
      const items = lignes.map((l, i) => ({ l, i })).filter(x => x.l.categorie === catKey);
      tbody.innerHTML = items.length ? items.map(({ l, i }) => `
        <tr data-idx="${i}">
          <td><input class="frais-lib" value="${escapeHtml(l.label || '')}" placeholder="${escapeHtml(cat.placeholder)}"></td>
          <td><input class="frais-mt" type="number" step="1" value="${l.montant || 0}" class="right"></td>
          <td class="center"><button class="btn-icon danger" data-action="rm-frais">🗑</button></td>
        </tr>
      `).join('') : `<tr><td colspan="3" class="empty" style="padding:8px">Aucune ligne — utilise « + Ajouter »</td></tr>`;
      $$('tr[data-idx]', tbody).forEach(tr => {
        const idx = parseInt(tr.dataset.idx, 10);
        const update = () => {
          lignes[idx].label = tr.querySelector('.frais-lib').value;
          lignes[idx].montant = parseFloat(tr.querySelector('.frais-mt').value) || 0;
          recalc();
        };
        tr.querySelector('.frais-lib').oninput = update;
        tr.querySelector('.frais-mt').oninput = update;
        tr.querySelector('[data-action="rm-frais"]').onclick = () => { lignes.splice(idx, 1); renderAll(); };
      });
    }

    function renderAll() {
      FRAIS_CATEGORIES.forEach(c => renderCategoryLines(c.key));
      recalc();
    }

    async function recalc() {
      const payload = {
        ca_annuel: parseFloat($('#f-ca').value) || 0,
        benefice_voulu: parseFloat($('#f-benef').value) || 0,
        benefice_unit: $('#f-benef-unit').value,
        lignes
      };
      // Sous-totaux par catégorie
      FRAIS_CATEGORIES.forEach(cat => {
        const sub = lignes.filter(l => l.categorie === cat.key).reduce((s, l) => s + (parseFloat(l.montant) || 0), 0);
        const el = $(`[data-sub="${cat.key}"]`);
        if (el) el.textContent = formatEUR(sub);
      });
      const r = await window.api.artisan.fraisReels.compute(payload);
      if (!r.ok) return;
      const c = r.data;
      // Tableau récap
      $('#frais-recap').innerHTML = `
        <thead><tr><th>Catégorie</th><th class="right">Montant</th><th class="right">% du CA</th></tr></thead>
        <tbody>
          ${FRAIS_CATEGORIES.map(cat => `
            <tr>
              <td><span style="color:${cat.color}">${cat.label}</span></td>
              <td class="right">${formatEUR(c.totals_eur[cat.key])}</td>
              <td class="right"><strong>${formatNum(c.totals_pct[cat.key + '_pct'] || c.totals_pct['frais_' + (cat.key === 'aleas' ? '' : cat.key + '_') + 'pct'] || 0, 2)} %</strong></td>
            </tr>
          `).join('')}
          <tr style="border-top:2px solid var(--border)">
            <td><strong>Bénéfice voulu</strong></td>
            <td class="right">${formatEUR(c.totals_eur.benefice)}</td>
            <td class="right"><strong>${formatNum(c.totals_pct.benefice_pct, 2)} %</strong></td>
          </tr>
          <tr class="bk-highlight">
            <td><strong>Total à imputer sur le PV</strong></td>
            <td class="right">${formatEUR(c.totals_eur.fg + c.totals_eur.fc + c.totals_eur.fo + c.totals_eur.aleas + c.totals_eur.benefice)}</td>
            <td class="right"><strong>${formatNum(c.sum_pct, 2)} %</strong></td>
          </tr>
        </tbody>
      `;
      $('#frais-coef').textContent = '×' + formatNum(c.coef, 4);
    }

    // Bind
    renderAll();
    $$('[data-add-frais]').forEach(btn => {
      btn.onclick = () => {
        lignes.push({ categorie: btn.dataset.addFrais, label: '', montant: 0 });
        renderAll();
      };
    });
    $('#f-ca').oninput = recalc;
    $('#f-benef').oninput = recalc;
    $('#f-benef-unit').onchange = recalc;

    $('#btn-save-frais').onclick = async () => {
      const payload = {
        ca_annuel: parseFloat($('#f-ca').value) || 0,
        benefice_voulu: parseFloat($('#f-benef').value) || 0,
        benefice_unit: $('#f-benef-unit').value,
        lignes
      };
      const r = await window.api.artisan.fraisReels.set(payload);
      if (r.ok) { toast('Charges enregistrées', 'success'); fraisData = r.data; }
      else toast('Erreur : ' + r.error, 'danger');
    };

    $('#btn-apply-frais').onclick = async () => {
      const payload = {
        ca_annuel: parseFloat($('#f-ca').value) || 0,
        benefice_voulu: parseFloat($('#f-benef').value) || 0,
        benefice_unit: $('#f-benef-unit').value,
        lignes
      };
      const c = (await window.api.artisan.fraisReels.compute(payload)).data;
      if (!c) return;
      if (!await confirmModal('Appliquer ces % au KPV global ?', `Cela remplacera tes paramètres KPV actuels par ceux calculés depuis tes frais réels (mode "% du PV", coef ×${formatNum(c.coef, 4)}).`)) return;
      // Sauve aussi les charges au passage
      await window.api.artisan.fraisReels.set(payload);
      const r = await window.api.artisan.kpv.setGlobal(c.totals_pct);
      if (r.ok) { toast('KPV global mis à jour depuis les frais réels', 'success'); refresh(); currentTab = 'pct'; }
      else toast('Erreur : ' + r.error, 'danger');
    };
  }

  window.ArtisanKpvPage = {
    async render(container) {
      containerEl = container;
      containerEl.innerHTML = '<div class="loader">Chargement…</div>';
      await refresh();
    }
  };
})();
