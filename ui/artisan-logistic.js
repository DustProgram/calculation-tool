// ui/artisan-logistic.js — Paramètres véhicule (la distance est désormais par chantier)
(function () {
  const { $, $$, escapeHtml, formatEUR, formatNum, toast } = window.UI;

  let containerEl = null;
  let params = null;
  let sites = [];

  async function refresh() {
    const r = await window.api.artisan.logistic.get();
    if (r.ok) params = r.data;
    const sr = await window.api.artisan.sites.list();
    if (sr.ok) sites = sr.data;
    render();
  }

  function siteCost(site, p) {
    const km = (parseFloat(site.distance_km) || 0) * 2 * (parseFloat(site.nb_trajets_jour) || 0);
    const litres = km * (parseFloat(p.conso_l_100km) || 0) / 100;
    return litres * (parseFloat(p.prix_carburant_litre) || 0);
  }

  function render() {
    if (!containerEl || !params) return;

    // Tableau récap par chantier
    const sitesActifs = sites.filter(s => !['archive', 'facture'].includes(s.statut));
    const sitesRows = sitesActifs.length ? sitesActifs.map(s => {
      const cout = siteCost(s, params);
      return `
        <tr>
          <td>${escapeHtml(s.nom)}</td>
          <td class="right">${formatNum(s.distance_km || 0, 1)} km</td>
          <td class="center">${s.nb_trajets_jour || 2} ×/jour</td>
          <td class="right"><strong>${formatEUR(cout)} / jour</strong></td>
        </tr>
      `;
    }).join('') : '<tr><td colspan="4" class="empty">Aucun chantier actif. La distance se renseigne à la création de chaque chantier (Suivi chantier).</td></tr>';

    containerEl.innerHTML = `
      <div class="page-header">
        <h1>🚐 Véhicule & déplacements</h1>
      </div>
      <p class="muted">Paramètres globaux de ton véhicule. Le <strong>coût de déplacement</strong> est calculé automatiquement <strong>pour chaque chantier</strong> en fonction de sa distance (à renseigner dans Suivi chantier).</p>

      <div class="card-block">
        <h3>Véhicule</h3>
        <div class="form-grid">
          <label>Prix carburant (€/litre)
            <input id="p-prix-carb" type="number" step="0.001" value="${formatNum(params.prix_carburant_litre, 3)}">
          </label>
          <label>Consommation (litres / 100 km)
            <input id="p-conso" type="number" step="0.1" value="${formatNum(params.conso_l_100km, 1)}">
          </label>
        </div>
        <div class="form-row" style="margin-top:14px">
          <button class="btn primary" id="btn-save">💾 Enregistrer</button>
          <span class="muted small" style="margin-left:auto">Le coût est recalculé automatiquement pour tous les chantiers à chaque modif.</span>
        </div>
      </div>

      <div class="card-block">
        <h3>📍 Coût de déplacement par chantier actif</h3>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr>
              <th>Chantier</th>
              <th class="right" style="width:120px">Distance aller</th>
              <th class="center" style="width:120px">Trajets / jour</th>
              <th class="right" style="width:160px">Coût carburant</th>
            </tr></thead>
            <tbody>${sitesRows}</tbody>
          </table>
        </div>
      </div>
    `;

    $('#btn-save').onclick = async () => {
      const cur = {
        ...params,
        prix_carburant_litre: parseFloat($('#p-prix-carb').value) || 0,
        conso_l_100km: parseFloat($('#p-conso').value) || 0
      };
      const r = await window.api.artisan.logistic.set(cur);
      if (r.ok) { toast('Paramètres véhicule enregistrés', 'success'); refresh(); }
      else toast('Erreur : ' + r.error, 'danger');
    };
  }

  window.ArtisanLogisticPage = {
    async render(container) {
      containerEl = container;
      containerEl.innerHTML = '<div class="loader">Chargement…</div>';
      await refresh();
    }
  };
})();
