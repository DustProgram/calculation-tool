// ui/artisan-logistic.js — Paramètres déplacements / logistique
(function () {
  const { $, $$, escapeHtml, formatEUR, formatNum, toast } = window.UI;

  let containerEl = null;
  let params = null;
  let computed = null;

  async function refresh() {
    const r = await window.api.artisan.logistic.get();
    if (r.ok) { params = r.data; computed = r.computed; }
    render();
  }

  function localCompute(p) {
    const km = (parseFloat(p.distance_aller_km) || 0) * 2 * (parseFloat(p.nb_trajets_jour) || 0);
    const litres = km * (parseFloat(p.conso_l_100km) || 0) / 100;
    const carb = litres * (parseFloat(p.prix_carburant_litre) || 0);
    return { km_par_jour: km, litres_par_jour: litres, cout_carburant_jour: carb, cout_total_jour: carb };
  }

  function render() {
    if (!containerEl || !params) return;
    containerEl.innerHTML = `
      <div class="page-header">
        <h1>🚐 Déplacements & logistique</h1>
      </div>
      <p class="muted">Calcule automatiquement le coût quotidien de tes déplacements (siège ↔ chantier). Ce coût peut être ajouté au déboursé d'un chantier comme un poste à part.</p>

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
      </div>

      <div class="card-block">
        <h3>Trajets quotidiens</h3>
        <div class="form-grid">
          <label>Distance aller (km)
            <input id="p-dist" type="number" step="0.5" value="${formatNum(params.distance_aller_km, 1)}">
            <small class="muted">Distance simple aller, du siège au chantier</small>
          </label>
          <label>Nb de trajets aller-retour / jour
            <input id="p-nb" type="number" step="1" value="${params.nb_trajets_jour}">
            <small class="muted">1 = aller le matin et retour le soir &nbsp;·&nbsp; 2 = + un retour midi</small>
          </label>
        </div>
      </div>

      <div class="card-block">
        <h3>Coût quotidien calculé</h3>
        <div class="logistic-result">
          <div><span class="label">Km / jour</span><span class="value" id="r-km">${formatNum(computed.km_par_jour, 1)} km</span></div>
          <div><span class="label">Litres / jour</span><span class="value" id="r-litres">${formatNum(computed.litres_par_jour, 2)} L</span></div>
          <div><span class="label">Coût carburant / jour</span><span class="value big" id="r-cout">${formatEUR(computed.cout_carburant_jour)}</span></div>
        </div>
        <div class="form-row" style="margin-top:14px">
          <button class="btn primary" id="btn-save">💾 Enregistrer</button>
          <span class="muted small" style="margin-left:auto">Les calculs se mettent à jour en live, l'enregistrement est manuel.</span>
        </div>
      </div>
    `;

    const recalc = () => {
      const cur = collect();
      const c = localCompute(cur);
      $('#r-km').textContent = formatNum(c.km_par_jour, 1) + ' km';
      $('#r-litres').textContent = formatNum(c.litres_par_jour, 2) + ' L';
      $('#r-cout').textContent = formatEUR(c.cout_carburant_jour);
    };
    $$('input').forEach(i => i.oninput = recalc);

    $('#btn-save').onclick = async () => {
      const cur = collect();
      const r = await window.api.artisan.logistic.set(cur);
      if (r.ok) { toast('Paramètres logistiques enregistrés', 'success'); refresh(); }
      else toast('Erreur : ' + r.error, 'danger');
    };
  }

  function collect() {
    return {
      prix_carburant_litre: parseFloat($('#p-prix-carb').value) || 0,
      conso_l_100km: parseFloat($('#p-conso').value) || 0,
      distance_aller_km: parseFloat($('#p-dist').value) || 0,
      nb_trajets_jour: parseFloat($('#p-nb').value) || 0
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
