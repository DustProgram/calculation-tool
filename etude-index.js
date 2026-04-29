// ui/etude-index.js — Page Indexation BT01 / ILC
(function () {
  const { $, $$, escapeHtml, formatEUR, formatNum, formatDate, toast, modal, confirmModal } = window.UI;

  let lots = [];
  let history = [];
  let containerEl = null;

  async function refresh() {
    const lr = await window.api.etude.lots.list();
    if (lr.ok) lots = lr.data;
    const hr = await window.api.etude.reindex.history();
    if (hr.ok) history = hr.data;
    render();
  }

  function render() {
    if (!containerEl) return;
    const lotOpts = ['<option value="all">Tous les prix</option>']
      .concat(lots.map(l => `<option value="${l.id}">${escapeHtml(l.code ? l.code + ' — ' : '')}${escapeHtml(l.nom)}</option>`))
      .join('');

    const histRows = history.length ? history.map(h => `
      <tr>
        <td class="small muted">${formatDate(h.when)}</td>
        <td>${h.scope && h.scope.lotId ? 'Lot #' + h.scope.lotId : 'Tous'}</td>
        <td class="right">×${formatNum(h.coef, 4)}</td>
        <td class="center">${h.affected || 0} prix</td>
        <td>${escapeHtml(h.label || '')}</td>
      </tr>
    `).join('') : '<tr><td colspan="5" class="empty">Aucune indexation enregistrée.</td></tr>';

    containerEl.innerHTML = `
      <div class="page-header">
        <h1>📈 Indexation BT01 / ILC</h1>
      </div>
      <p class="muted">Applique un coefficient de révision sur tout ou partie de ta base de prix. Utile pour mettre à jour les prix selon l'inflation des indices BT01, ILC, ILAT, etc.</p>

      <div class="card-block">
        <h3>Nouveau coefficient</h3>
        <div class="form-grid">
          <label>Périmètre
            <select id="r-scope">${lotOpts}</select>
          </label>
          <label>Coefficient (ex: 1.025 pour +2,5%)
            <input id="r-coef" type="number" step="0.0001" placeholder="1.025">
          </label>
          <label class="full">Étiquette (optionnel)
            <input id="r-label" placeholder="ex: Révision BT01 Q4 2026">
          </label>
        </div>
        <div class="form-row" style="margin-top:12px">
          <button class="btn ghost" id="btn-preview">👁 Aperçu (sans appliquer)</button>
          <button class="btn primary" id="btn-apply">⚡ Appliquer</button>
        </div>
        <div id="preview-zone" style="margin-top:16px"></div>
      </div>

      <h3>Historique</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th style="width:160px">Date</th>
            <th>Périmètre</th>
            <th class="right" style="width:100px">Coef.</th>
            <th class="center" style="width:90px">Lignes</th>
            <th>Étiquette</th>
          </tr></thead>
          <tbody>${histRows}</tbody>
        </table>
      </div>
    `;

    const getPayload = () => {
      const scope = $('#r-scope').value === 'all' ? { all: true } : { lotId: parseInt($('#r-scope').value, 10) };
      return {
        coef: $('#r-coef').value,
        scope,
        label: $('#r-label').value.trim()
      };
    };

    $('#btn-preview').onclick = async () => {
      const payload = getPayload();
      if (!payload.coef || isNaN(parseFloat(payload.coef))) return toast('Coefficient requis', 'danger');
      const r = await window.api.etude.reindex.preview(payload);
      if (!r.ok) return toast('Erreur : ' + r.error, 'danger');
      const rows = r.data.map(p => `
        <tr>
          <td>${escapeHtml(p.designation)}</td>
          <td class="right muted">${formatEUR(p.prix)}</td>
          <td class="center" style="color:${p.delta >= 0 ? 'var(--success)' : 'var(--danger)'}">${p.delta >= 0 ? '+' : ''}${formatEUR(p.delta)}</td>
          <td class="right"><strong>${formatEUR(p.new_prix)}</strong></td>
        </tr>
      `).join('');
      $('#preview-zone').innerHTML = `
        <h4>Aperçu — ${r.data.length} premiers prix</h4>
        <div class="table-wrap" style="max-height:300px">
          <table class="data-table">
            <thead><tr><th>Désignation</th><th class="right">Avant</th><th class="center">Δ</th><th class="right">Après</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4" class="empty">Aucun prix dans ce périmètre</td></tr>'}</tbody>
          </table>
        </div>
      `;
    };

    $('#btn-apply').onclick = async () => {
      const payload = getPayload();
      if (!payload.coef || isNaN(parseFloat(payload.coef))) return toast('Coefficient requis', 'danger');
      if (!await confirmModal('Appliquer le coefficient ?', `Coefficient ×${payload.coef} sur ${payload.scope.all ? 'tous les prix' : 'le lot sélectionné'}. Cette action est irréversible (mais sera tracée dans l'historique).`)) return;
      const r = await window.api.etude.reindex.apply(payload);
      if (r.ok) {
        toast(`Indexation appliquée — ${r.log.affected} prix mis à jour`, 'success');
        refresh();
      } else toast('Erreur : ' + r.error, 'danger');
    };
  }

  window.EtudeIndexPage = {
    async render(container) {
      containerEl = container;
      containerEl.innerHTML = '<div class="loader">Chargement…</div>';
      await refresh();
    }
  };
})();
