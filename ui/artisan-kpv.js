// ui/artisan-kpv.js — KPV global et par lot, méthode BTP (cascade)
(function () {
  const { $, $$, escapeHtml, formatEUR, formatNum, toast, modal, confirmModal } = window.UI;

  let containerEl = null;
  let data = null;

  // 5 paramètres regroupés en 3 niveaux pour la cascade BTP :
  //   Niveau 1 (au DS) : Frais de chantier + Aléas → DT
  //   Niveau 2 (au DT) : Frais d'opération + Frais généraux → CR
  //   Niveau 3 (au CR) : Bénéfice (% du PV final, formule particulière) → PV
  const PARAMS = [
    { key: 'frais_chantier_pct',  label: 'Frais de chantier %',  level: 1, help: 'Petit outillage, EPI, encadrement, fluides — % du DS' },
    { key: 'aleas_pct',           label: 'Aléas %',              level: 1, help: 'Provision pour imprévus chantier — % du DS' },
    { key: 'frais_operation_pct', label: 'Frais d\'opération %', level: 2, help: 'Études, plans, suivi spécifique de l\'affaire — % du DT' },
    { key: 'frais_generaux_pct',  label: 'Frais généraux %',     level: 2, help: 'Loyer, comptable, assurance, gestion — % du DT' },
    { key: 'benefice_pct',        label: 'Bénéfice %',           level: 3, help: 'Marge nette voulue, exprimée en % du PV final (formule B = b/(1-b) × CR)' }
  ];

  function computeCoef(p) {
    const fc = parseFloat(p.frais_chantier_pct) || 0;
    const fo = parseFloat(p.frais_operation_pct) || 0;
    const fg = parseFloat(p.frais_generaux_pct) || 0;
    const b  = parseFloat(p.benefice_pct) || 0;
    const a  = parseFloat(p.aleas_pct) || 0;
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

  function buildBreakdown(p, ds = 1000) {
    const fc = parseFloat(p.frais_chantier_pct) || 0;
    const fo = parseFloat(p.frais_operation_pct) || 0;
    const fg = parseFloat(p.frais_generaux_pct) || 0;
    const b  = parseFloat(p.benefice_pct) || 0;
    const a  = parseFloat(p.aleas_pct) || 0;

    if (p.mode_calcul === 'btp') {
      const fcMontant = ds * (fc + a) / 100;
      const dt = ds + fcMontant;
      const fgMontant = dt * (fo + fg) / 100;
      const cr = dt + fgMontant;
      const bC = Math.min(99.99, Math.max(0, b));
      const bMontant = cr * (bC / (100 - bC));
      const pv = cr + bMontant;
      return [
        { label: 'Déboursé sec',           abbr: 'DS',           valeur: ds,        formule: '' },
        { label: `Frais chantier (${formatNum(fc, 1)}%) + Aléas (${formatNum(a, 1)}%)`, abbr: 'FC',  valeur: fcMontant, formule: `DS × ${formatNum(fc + a, 1)}%` },
        { label: 'Déboursés totaux',       abbr: 'DT',           valeur: dt,        formule: 'DS + FC' },
        { label: `Frais opé (${formatNum(fo, 1)}%) + Frais généraux (${formatNum(fg, 1)}%)`, abbr: 'FG', valeur: fgMontant, formule: `DT × ${formatNum(fo + fg, 1)}%` },
        { label: 'Coût de revient',        abbr: 'CR',           valeur: cr,        formule: 'DT + FG' },
        { label: `Bénéfice (${formatNum(b, 1)}% du PV)`, abbr: 'B',  valeur: bMontant,  formule: `CR × ${formatNum(b, 1)}/(100−${formatNum(b, 1)})` },
        { label: 'Prix de vente HT',       abbr: 'PV',           valeur: pv,        formule: 'CR + B', highlight: true }
      ];
    }
    const coef = computeCoef(p);
    return [
      { label: 'Déboursé sec',     abbr: 'DS', valeur: ds,           formule: '' },
      { label: 'Marge totale',     abbr: 'M',  valeur: ds * (coef - 1), formule: `DS × ${formatNum((coef - 1) * 100, 2)}%` },
      { label: 'Prix de vente HT', abbr: 'PV', valeur: ds * coef,    formule: `DS × ${formatNum(coef, 4)}`, highlight: true }
    ];
  }

  async function refresh() {
    const r = await window.api.artisan.kpv.listAll();
    if (r.ok) data = r.data;
    render();
  }

  function render() {
    if (!containerEl || !data) return;
    const g = data.global;

    const lotsRows = data.lots.length ? data.lots.map(({ lot, kpv, coef }) => `
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
    `).join('') : '<tr><td colspan="5" class="empty">Pas de lots définis (à créer dans la base de prix)</td></tr>';

    containerEl.innerHTML = `
      <div class="page-header">
        <h1>⚙️ Paramètres KPV</h1>
      </div>
      <p class="muted">Le <strong>KPV (Coefficient de Prix de Vente)</strong> permet de passer du déboursé sec au prix de vente HT. Mode <strong>BTP officiel</strong> recommandé : calcul en cascade DS → DT → CR → PV avec la formule normée.</p>

      <div class="card-block">
        <h3>KPV Global</h3>

        <div class="form-row" style="margin-bottom:12px;flex-wrap:wrap">
          <label class="radio">
            <input type="radio" name="mode-calcul" value="btp" ${g.mode_calcul === 'btp' ? 'checked' : ''}>
            <span><strong>BTP officiel (cascade)</strong> — recommandé</span>
          </label>
          <label class="radio" style="margin-left:16px">
            <input type="radio" name="mode-calcul" value="additif" ${g.mode_calcul === 'additif' ? 'checked' : ''}>
            <span>Additif (somme rapide)</span>
          </label>
          <label class="radio" style="margin-left:16px">
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
          <span class="kpv-coef" id="kpv-coef-out">×${formatNum(data.global_coef, 4)}</span>
          <span class="kpv-pct" id="kpv-pct-out">(+${formatNum((data.global_coef - 1) * 100, 2)} %)</span>
          <button class="btn primary" id="btn-save-global" style="margin-left:auto">💾 Enregistrer</button>
        </div>

        <h4 style="margin-top:18px">Tableau de calcul (pour 1 000 € de déboursé sec)</h4>
        <table class="data-table kpv-breakdown" id="kpv-breakdown"></table>
      </div>

      <h3>KPV par lot</h3>
      <p class="muted small">Tu peux personnaliser le KPV pour chaque lot (ex: bénéfice plus élevé sur la plomberie). Sinon, le lot hérite du KPV global.</p>
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

    const renderBreakdown = (params) => {
      const rows = buildBreakdown(params, 1000);
      const tbody = rows.map(r => `
        <tr ${r.highlight ? 'class="bk-highlight"' : ''}>
          <td><strong>${escapeHtml(r.abbr)}</strong></td>
          <td>${escapeHtml(r.label)}</td>
          <td class="muted small">${escapeHtml(r.formule || '')}</td>
          <td class="right"><strong>${formatEUR(r.valeur)}</strong></td>
        </tr>
      `).join('');
      $('#kpv-breakdown').innerHTML = `
        <thead><tr><th style="width:60px">Abbr.</th><th>Désignation</th><th>Formule</th><th class="right" style="width:130px">Valeur</th></tr></thead>
        <tbody>${tbody}</tbody>
      `;
    };

    const recalc = () => {
      const cur = collectGlobalParams();
      const coef = computeCoef(cur);
      $('#kpv-coef-out').textContent = '×' + formatNum(coef, 4);
      $('#kpv-pct-out').textContent = '(+' + formatNum((coef - 1) * 100, 2) + ' %)';
      renderBreakdown(cur);
    };
    $$('input[name="mode-calcul"]').forEach(r => r.onchange = recalc);
    $$('.kpv-input').forEach(i => i.oninput = recalc);
    recalc(); // initial

    $('#btn-save-global').onclick = async () => {
      const r = await window.api.artisan.kpv.setGlobal(collectGlobalParams());
      if (r.ok) { toast('KPV global enregistré', 'success'); refresh(); }
      else toast('Erreur : ' + r.error, 'danger');
    };

    $$('[data-action="edit-lot"]').forEach(btn => {
      btn.onclick = () => {
        const id = parseInt(btn.closest('tr').dataset.lotId, 10);
        openLotKpvModal(data.lots.find(l => l.lot.id === id));
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
        <div class="form-row" style="margin-bottom:12px">
          <label class="radio">
            <input type="radio" name="lot-mode" value="btp" ${kpv.mode_calcul === 'btp' ? 'checked' : ''}>
            <span>BTP officiel</span>
          </label>
          <label class="radio" style="margin-left:16px">
            <input type="radio" name="lot-mode" value="additif" ${kpv.mode_calcul === 'additif' ? 'checked' : ''}>
            <span>Additif</span>
          </label>
          <label class="radio" style="margin-left:16px">
            <input type="radio" name="lot-mode" value="multiplicatif" ${kpv.mode_calcul === 'multiplicatif' ? 'checked' : ''}>
            <span>Multiplicatif</span>
          </label>
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

  window.ArtisanKpvPage = {
    async render(container) {
      containerEl = container;
      containerEl.innerHTML = '<div class="loader">Chargement…</div>';
      await refresh();
    }
  };
})();
