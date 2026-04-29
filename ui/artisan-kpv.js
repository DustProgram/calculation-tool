// ui/artisan-kpv.js — Paramètres KPV global et par lot
(function () {
  const { $, $$, escapeHtml, formatNum, toast, modal, confirmModal } = window.UI;

  let containerEl = null;
  let data = null;

  const PARAMS = [
    { key: 'frais_chantier_pct',  label: 'Frais de chantier %', help: 'Petit outillage, EPI, fluides, encadrement chantier' },
    { key: 'frais_operation_pct', label: 'Frais d\'opération %',help: 'Études, plans, suivi spécifique de cette affaire' },
    { key: 'frais_generaux_pct',  label: 'Frais généraux %',     help: 'Loyer, comptable, assurance, gestion administrative' },
    { key: 'benefice_pct',        label: 'Bénéfice %',           help: 'Marge nette voulue après frais' },
    { key: 'aleas_pct',           label: 'Aléas %',              help: 'Provision pour imprévus chantier' }
  ];

  function computeCoef(p) {
    const fc = parseFloat(p.frais_chantier_pct) || 0;
    const fo = parseFloat(p.frais_operation_pct) || 0;
    const fg = parseFloat(p.frais_generaux_pct) || 0;
    const b  = parseFloat(p.benefice_pct) || 0;
    const a  = parseFloat(p.aleas_pct) || 0;
    if (p.mode_calcul === 'multiplicatif') {
      return (1 + fc / 100) * (1 + fo / 100) * (1 + fg / 100) * (1 + b / 100) * (1 + a / 100);
    }
    return 1 + (fc + fo + fg + b + a) / 100;
  }

  async function refresh() {
    const r = await window.api.artisan.kpv.listAll();
    if (r.ok) data = r.data;
    render();
  }

  function render() {
    if (!containerEl || !data) return;
    const g = data.global;
    const isMult = g.mode_calcul === 'multiplicatif';

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
      <p class="muted">Le <strong>KPV (Coefficient de Prix de Vente)</strong> permet de passer du déboursé sec à un prix de vente client. Définis ici tes paramètres globaux et personnalise par lot si besoin.</p>

      <div class="card-block">
        <h3>KPV Global</h3>
        <div class="form-row" style="margin-bottom:12px">
          <label class="radio">
            <input type="radio" name="mode-calcul" value="additif" ${!isMult ? 'checked' : ''}>
            <span>Additif (somme des %)</span>
          </label>
          <label class="radio" style="margin-left:16px">
            <input type="radio" name="mode-calcul" value="multiplicatif" ${isMult ? 'checked' : ''}>
            <span>Multiplicatif (cascade)</span>
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

    // Recalcul live
    const recalc = () => {
      const cur = collectGlobalParams();
      const coef = computeCoef(cur);
      $('#kpv-coef-out').textContent = '×' + formatNum(coef, 4);
      $('#kpv-pct-out').textContent = '(+' + formatNum((coef - 1) * 100, 2) + ' %)';
    };
    $$('input[name="mode-calcul"]').forEach(r => r.onchange = recalc);
    $$('.kpv-input').forEach(i => i.oninput = recalc);

    $('#btn-save-global').onclick = async () => {
      const params = collectGlobalParams();
      const r = await window.api.artisan.kpv.setGlobal(params);
      if (r.ok) { toast('KPV global enregistré', 'success'); refresh(); }
      else toast('Erreur : ' + r.error, 'danger');
    };

    $$('[data-action="edit-lot"]').forEach(btn => {
      btn.onclick = () => {
        const id = parseInt(btn.closest('tr').dataset.lotId, 10);
        const entry = data.lots.find(l => l.lot.id === id);
        openLotKpvModal(entry);
      };
    });
    $$('[data-action="reset-lot"]').forEach(btn => {
      btn.onclick = async () => {
        const id = parseInt(btn.closest('tr').dataset.lotId, 10);
        if (await confirmModal('Revenir au KPV global ?', 'Le KPV spécifique de ce lot sera supprimé.')) {
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
      large: false,
      content: `
        <p class="muted small">Si tu enregistres, ce lot aura son propre KPV qui surchargera le global.</p>
        <div class="form-row" style="margin-bottom:12px">
          <label class="radio">
            <input type="radio" name="lot-mode" value="additif" ${kpv.mode_calcul !== 'multiplicatif' ? 'checked' : ''}>
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
        const recalc = () => {
          const params = { mode_calcul: body.querySelector('input[name="lot-mode"]:checked').value };
          PARAMS.forEach(p => {
            params[p.key] = parseFloat(body.querySelector(`.lot-input[data-key="${p.key}"]`).value) || 0;
          });
          body.querySelector('#lot-coef-out').textContent = '×' + formatNum(computeCoef(params), 4);
        };
        $$('.lot-input', body).forEach(i => i.oninput = recalc);
        $$('input[name="lot-mode"]', body).forEach(r => r.onchange = recalc);

        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);
        footer.querySelector('[data-action="save"]').onclick = async () => {
          const params = { mode_calcul: body.querySelector('input[name="lot-mode"]:checked').value };
          PARAMS.forEach(p => {
            params[p.key] = parseFloat(body.querySelector(`.lot-input[data-key="${p.key}"]`).value) || 0;
          });
          const r = await window.api.artisan.kpv.setForLot({ lotId: lot.id, params });
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
