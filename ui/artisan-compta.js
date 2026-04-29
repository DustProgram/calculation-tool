// ui/artisan-compta.js — Module Comptabilité (profil Artisan)
// 6 onglets : Tableau de bord, Recettes, Dépenses, Situations, Déclarations, Configuration

(function () {
  const { $, $$, escapeHtml, formatEUR, formatNum, formatDate, toast, modal, confirmModal } = window.UI;

  let containerEl = null;
  let currentTab = 'dashboard';
  let plan = { recettes: [], charges: [] };
  let config = null;
  let sites = [];
  let suppliers = [];
  let quotes = [];

  const TABS = [
    { key: 'dashboard',     label: '📊 Tableau de bord' },
    { key: 'recettes',      label: '💰 Recettes' },
    { key: 'depenses',      label: '💸 Dépenses' },
    { key: 'situations',    label: '🏗 Situations' },
    { key: 'declarations',  label: '📋 Déclarations' },
    { key: 'config',        label: '⚙️ Configuration' }
  ];

  const MODES_PAIEMENT = [
    { value: '',           label: '—' },
    { value: 'virement',   label: 'Virement' },
    { value: 'cheque',     label: 'Chèque' },
    { value: 'cb',         label: 'CB' },
    { value: 'especes',    label: 'Espèces' },
    { value: 'prelevement',label: 'Prélèvement' }
  ];

  // -----------------------------------------------------------------------
  // BOOT
  // -----------------------------------------------------------------------
  async function refresh() {
    const [pl, cf, sr, su, qr] = await Promise.all([
      window.api.compta.config.plan(),
      window.api.compta.config.get(),
      window.api.artisan.sites.list(),
      window.api.artisan.suppliers.list(),
      window.api.etude.quotes.list()
    ]);
    if (pl.ok) plan = pl.data;
    if (cf.ok) config = cf.data;
    if (sr.ok) sites = sr.data;
    if (su.ok) suppliers = su.data;
    if (qr.ok) quotes = qr.data;
    render();
  }

  function render() {
    if (!containerEl) return;
    containerEl.innerHTML = `
      <div class="page-header">
        <h1>📒 Comptabilité</h1>
        <div class="page-actions">
          <span class="muted small">${escapeHtml(config && config.raison_sociale || '— configurer l\'entreprise —')}</span>
        </div>
      </div>
      <div class="tabs-bar">
        ${TABS.map(t => `<button class="tab ${currentTab === t.key ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
      </div>
      <div id="tab-content"></div>
    `;
    $$('.tab').forEach(t => t.onclick = () => { currentTab = t.dataset.tab; render(); });
    if (currentTab === 'dashboard')        renderDashboard();
    else if (currentTab === 'recettes')    renderEcritures('recette');
    else if (currentTab === 'depenses')    renderEcritures('depense');
    else if (currentTab === 'situations')  renderSituations();
    else if (currentTab === 'declarations')renderDeclarations();
    else if (currentTab === 'config')      renderConfig();
  }

  // -----------------------------------------------------------------------
  // ONGLET 1 — Tableau de bord
  // -----------------------------------------------------------------------
  async function renderDashboard() {
    $('#tab-content').innerHTML = '<div class="loader">Calculs en cours…</div>';
    const [dr, cc, mc] = await Promise.all([
      window.api.compta.dashboard({}),
      window.api.compta.chantiersEnCours({}),
      window.api.compta.margeChantiers({})
    ]);
    if (!dr.ok) return $('#tab-content').innerHTML = '<p class="muted">Erreur : ' + dr.error + '</p>';
    const d = dr.data;
    const ec = cc.ok ? cc.data : { lignes: [], total_stock: 0 };
    const margeRows = mc.ok ? mc.data : [];

    const periodeStr = `${formatDate(d.periode.debut).split(' ')[0]} → ${formatDate(d.periode.fin).split(' ')[0]}`;

    $('#tab-content').innerHTML = `
      <p class="muted small">Exercice : ${periodeStr}</p>

      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">CA HT</div><div class="kpi-value">${formatEUR(d.ca_ht)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Charges HT</div><div class="kpi-value">${formatEUR(d.charges_ht)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Résultat</div><div class="kpi-value" style="color:${d.resultat_ht >= 0 ? 'var(--success)' : 'var(--danger)'}">${formatEUR(d.resultat_ht)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Marge brute</div><div class="kpi-value">${formatNum(d.marge_pct, 1)} %</div></div>
        <div class="kpi-card"><div class="kpi-label">TVA à payer</div><div class="kpi-value">${formatEUR(d.tva_a_payer)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Stock chantiers en cours</div><div class="kpi-value">${formatEUR(ec.total_stock)}</div></div>
      </div>

      <div class="grid-2cols" style="margin-top:18px">
        <div class="card-block">
          <h3>📈 Évolution mensuelle</h3>
          <table class="data-table">
            <thead><tr><th>Mois</th><th class="right">Recettes</th><th class="right">Charges</th><th class="right">Résultat</th></tr></thead>
            <tbody>${d.monthly.map(m => `
              <tr>
                <td>${escapeHtml(m.mois)}</td>
                <td class="right">${formatEUR(m.recettes)}</td>
                <td class="right">${formatEUR(m.charges)}</td>
                <td class="right" style="color:${m.resultat >= 0 ? 'var(--success)' : 'var(--danger)'}">${formatEUR(m.resultat)}</td>
              </tr>
            `).join('') || '<tr><td colspan="4" class="empty">Aucune donnée</td></tr>'}</tbody>
          </table>
        </div>

        <div class="card-block">
          <h3>📊 Charges par catégorie</h3>
          <table class="data-table">
            <thead><tr><th>Catégorie</th><th class="right">Montant</th><th class="right">% des charges</th></tr></thead>
            <tbody>${Object.entries(d.charges_par_categorie).filter(([k, v]) => v > 0).map(([k, v]) => `
              <tr>
                <td>${escapeHtml(catLabel(k))}</td>
                <td class="right">${formatEUR(v)}</td>
                <td class="right">${d.charges_ht > 0 ? formatNum(v / d.charges_ht * 100, 1) : '0'} %</td>
              </tr>
            `).join('') || '<tr><td colspan="3" class="empty">Aucune charge</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      <h3 style="margin-top:18px">🏗 Marge par chantier</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Chantier</th>
            <th class="right">CA</th>
            <th class="right">Charges</th>
            <th class="right">Marge</th>
            <th class="right">Marge %</th>
          </tr></thead>
          <tbody>${margeRows.length ? margeRows.map(m => `
            <tr>
              <td>${escapeHtml(m.site_nom)}</td>
              <td class="right">${formatEUR(m.ca)}</td>
              <td class="right">${formatEUR(m.charges)}</td>
              <td class="right" style="color:${m.marge >= 0 ? 'var(--success)' : 'var(--danger)'}"><strong>${formatEUR(m.marge)}</strong></td>
              <td class="right">${formatNum(m.marge_pct, 1)} %</td>
            </tr>
          `).join('') : '<tr><td colspan="5" class="empty">Pas encore de chantier avec des écritures rattachées</td></tr>'}</tbody>
        </table>
      </div>

      ${ec.lignes.length ? `
        <h3 style="margin-top:18px">⏳ Chantiers en cours (méthode à l'avancement)</h3>
        <p class="muted small">Pour les chantiers à cheval sur plusieurs exercices : la valeur reconnue (devis × % avancement) moins ce qui a été facturé en situations donne le <strong>stock à inscrire au bilan</strong>.</p>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr>
              <th>Chantier</th>
              <th class="right">Montant devis</th>
              <th class="right">Avancement</th>
              <th class="right">CA reconnu</th>
              <th class="right">CA facturé (situations)</th>
              <th class="right">Stock à reporter</th>
            </tr></thead>
            <tbody>${ec.lignes.map(l => `
              <tr>
                <td>${escapeHtml(l.site_nom)}</td>
                <td class="right">${formatEUR(l.montant_devis)}</td>
                <td class="right">${formatNum(l.avancement_pct, 0)} %</td>
                <td class="right">${formatEUR(l.ca_reconnu)}</td>
                <td class="right">${formatEUR(l.ca_facture)}</td>
                <td class="right" style="color:${l.stock_en_cours >= 0 ? 'var(--success)' : 'var(--warning)'}"><strong>${formatEUR(l.stock_en_cours)}</strong></td>
              </tr>
            `).join('')}
            <tr style="border-top:2px solid var(--primary)">
              <td colspan="5"><strong>Total stock chantiers en cours</strong></td>
              <td class="right"><strong>${formatEUR(ec.total_stock)}</strong></td>
            </tr>
            </tbody>
          </table>
        </div>
      ` : ''}
    `;
  }

  function catLabel(cat) {
    const labels = {
      achats: 'Achats matériaux/fournitures',
      'sous-traitance': 'Sous-traitance',
      services: 'Services extérieurs',
      transports: 'Transports/Déplacements',
      impots: 'Impôts et taxes',
      personnel: 'Personnel',
      amort: 'Amortissements'
    };
    return labels[cat] || cat;
  }

  // -----------------------------------------------------------------------
  // ONGLET 2/3 — Recettes / Dépenses (table + modale)
  // -----------------------------------------------------------------------
  async function renderEcritures(type) {
    const r = await window.api.compta.ecritures.list({ type });
    const ecs = r.ok ? r.data : [];
    const isRec = type === 'recette';
    const totalHT = ecs.reduce((s, e) => s + (e.montant_ht || 0), 0);
    const totalTVA = ecs.reduce((s, e) => s + (e.montant_tva || 0), 0);
    const totalTTC = ecs.reduce((s, e) => s + (e.montant_ttc || 0), 0);

    $('#tab-content').innerHTML = `
      <div class="page-actions" style="margin:12px 0">
        <button class="btn primary" id="btn-add-ec">+ ${isRec ? 'Nouvelle recette' : 'Nouvelle dépense'}</button>
        <span class="muted small" style="margin-left:auto">Total HT : <strong>${formatEUR(totalHT)}</strong> · TVA : <strong>${formatEUR(totalTVA)}</strong> · TTC : <strong>${formatEUR(totalTTC)}</strong></span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th style="width:90px">Date</th>
            <th>Libellé</th>
            <th style="width:80px">Compte</th>
            <th>${isRec ? 'Client' : 'Fournisseur'}</th>
            <th>Chantier</th>
            <th class="right" style="width:90px">HT</th>
            <th class="center" style="width:60px">TVA%</th>
            <th class="right" style="width:90px">TTC</th>
            <th class="center" style="width:80px">Payé</th>
            <th class="center" style="width:90px">Actions</th>
          </tr></thead>
          <tbody>${ecs.length ? ecs.map(e => `
            <tr data-id="${e.id}">
              <td class="small">${formatDate(e.date).split(' ')[0]}</td>
              <td>${escapeHtml(e.libelle)} ${e.ref_facture ? '<span class="muted small">· ' + escapeHtml(e.ref_facture) + '</span>' : ''}</td>
              <td><span class="badge">${escapeHtml(e.compte_code || '—')}</span></td>
              <td class="small">${escapeHtml(isRec ? (e.client_nom || '—') : (e.supplier_nom || '—'))}</td>
              <td class="small">${escapeHtml(e.site_nom || '—')}</td>
              <td class="right">${formatEUR(e.montant_ht)}</td>
              <td class="center small">${formatNum(e.tva_pct, 1)}</td>
              <td class="right"><strong>${formatEUR(e.montant_ttc)}</strong></td>
              <td class="center small">${e.date_paiement ? '✅' : '<span class="muted">⏳</span>'}</td>
              <td class="center actions">
                <button class="btn-icon" data-action="edit">✏️</button>
                <button class="btn-icon danger" data-action="delete">🗑</button>
              </td>
            </tr>
          `).join('') : `<tr><td colspan="10" class="empty">Aucune ${isRec ? 'recette' : 'dépense'}.</td></tr>`}</tbody>
        </table>
      </div>
    `;

    $('#btn-add-ec').onclick = () => openEcritureModal(null, type);
    $$('[data-action]').forEach(btn => {
      btn.onclick = async () => {
        const id = parseInt(btn.closest('tr').dataset.id, 10);
        const ec = ecs.find(x => x.id === id);
        if (btn.dataset.action === 'edit') openEcritureModal(ec, type);
        if (btn.dataset.action === 'delete') {
          if (await confirmModal('Supprimer cette écriture ?', `« ${ec.libelle} »`)) {
            const r = await window.api.compta.ecritures.delete({ id });
            if (r.ok) { toast('Supprimé', 'success'); render(); }
          }
        }
      };
    });
  }

  function openEcritureModal(ec, type) {
    const isEdit = !!ec;
    const isRec = type === 'recette';
    const comptes = isRec ? plan.recettes : plan.charges;
    const today = new Date().toISOString().split('T')[0];
    const dateStr = ec && ec.date ? new Date(ec.date).toISOString().split('T')[0] : today;
    const datePaiStr = ec && ec.date_paiement ? new Date(ec.date_paiement).toISOString().split('T')[0] : '';

    return modal({
      title: isEdit
        ? `Modifier ${isRec ? 'la recette' : 'la dépense'}`
        : `Nouvelle ${isRec ? 'recette' : 'dépense'}`,
      large: true,
      content: `
        <div class="form-grid">
          <label>Date *<input id="f-date" type="date" value="${dateStr}"></label>
          <label>Compte
            <select id="f-compte">
              <option value="">— Choisir —</option>
              ${comptes.map(c => `<option value="${c.code}" ${ec && ec.compte_code === c.code ? 'selected' : ''}>${escapeHtml(c.code + ' — ' + c.label)}</option>`).join('')}
            </select>
          </label>
          <label class="full">Libellé *<input id="f-libelle" value="${escapeHtml(ec && ec.libelle || '')}"></label>
          <label>Montant HT *<input id="f-ht" type="number" step="0.01" value="${ec && ec.montant_ht != null ? ec.montant_ht : ''}"></label>
          <label>TVA %<input id="f-tva" type="number" step="0.1" value="${ec && ec.tva_pct != null ? ec.tva_pct : (config && config.tva_pct_defaut || 8.5)}"></label>
          ${isRec ? `
            <label>Nom client<input id="f-client" value="${escapeHtml(ec && ec.client_nom || '')}"></label>
            <label>Devis lié
              <select id="f-quote">
                <option value="">— Aucun —</option>
                ${quotes.map(q => `<option value="${q.id}" ${ec && ec.quote_id === q.id ? 'selected' : ''}>${escapeHtml((q.code || '#' + q.id) + ' — ' + q.titre)}</option>`).join('')}
              </select>
            </label>
          ` : `
            <label>Fournisseur
              <select id="f-supplier">
                <option value="">— Aucun —</option>
                ${suppliers.map(s => `<option value="${s.id}" ${ec && ec.supplier_id === s.id ? 'selected' : ''}>${escapeHtml(s.nom)}</option>`).join('')}
              </select>
            </label>
            <label>&nbsp;<span class="muted small">Le fournisseur s'auto-créera si tu choisis "Aucun"</span></label>
          `}
          <label>Chantier rattaché
            <select id="f-site">
              <option value="">— Aucun —</option>
              ${sites.map(s => `<option value="${s.id}" ${ec && ec.site_id === s.id ? 'selected' : ''}>${escapeHtml(s.nom)}</option>`).join('')}
            </select>
          </label>
          <label>N° facture<input id="f-ref" value="${escapeHtml(ec && ec.ref_facture || '')}"></label>
          <label>Date paiement<input id="f-datepai" type="date" value="${datePaiStr}"></label>
          <label>Mode de paiement
            <select id="f-mode">
              ${MODES_PAIEMENT.map(m => `<option value="${m.value}" ${ec && ec.mode_paiement === m.value ? 'selected' : ''}>${m.label}</option>`).join('')}
            </select>
          </label>
          <label class="full">Notes<textarea id="f-notes" rows="2">${escapeHtml(ec && ec.notes || '')}</textarea></label>
        </div>

        <div class="kpv-result-block" id="ec-preview" style="margin-top:14px">
          <span>Aperçu</span>
          <span>HT: <strong id="prev-ht">0,00 €</strong></span>
          <span>TVA: <strong id="prev-tva">0,00 €</strong></span>
          <span>TTC: <strong class="kpv-coef" id="prev-ttc">0,00 €</strong></span>
        </div>
      `,
      footer: `
        <button class="btn ghost" data-action="cancel">Annuler</button>
        <button class="btn primary" data-action="save">${isEdit ? 'Enregistrer' : 'Créer'}</button>
      `,
      onMount: ({ body, footer, close }) => {
        const recalc = () => {
          const ht = parseFloat(body.querySelector('#f-ht').value) || 0;
          const tva = parseFloat(body.querySelector('#f-tva').value) || 0;
          const tvaM = ht * tva / 100;
          body.querySelector('#prev-ht').textContent = formatEUR(ht);
          body.querySelector('#prev-tva').textContent = formatEUR(tvaM);
          body.querySelector('#prev-ttc').textContent = formatEUR(ht + tvaM);
        };
        body.querySelector('#f-ht').oninput = recalc;
        body.querySelector('#f-tva').oninput = recalc;
        recalc();

        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);
        footer.querySelector('[data-action="save"]').onclick = async () => {
          const dateVal = body.querySelector('#f-date').value;
          const datePaiVal = body.querySelector('#f-datepai').value;
          const payload = {
            type,
            date: dateVal ? new Date(dateVal).getTime() : Date.now(),
            libelle: body.querySelector('#f-libelle').value.trim(),
            compte_code: body.querySelector('#f-compte').value,
            montant_ht: parseFloat(body.querySelector('#f-ht').value) || 0,
            tva_pct: parseFloat(body.querySelector('#f-tva').value) || 0,
            site_id: body.querySelector('#f-site').value ? parseInt(body.querySelector('#f-site').value, 10) : null,
            ref_facture: body.querySelector('#f-ref').value.trim(),
            date_paiement: datePaiVal ? new Date(datePaiVal).getTime() : null,
            mode_paiement: body.querySelector('#f-mode').value,
            notes: body.querySelector('#f-notes').value.trim()
          };
          if (isRec) {
            payload.client_nom = body.querySelector('#f-client').value.trim();
            payload.quote_id = body.querySelector('#f-quote').value ? parseInt(body.querySelector('#f-quote').value, 10) : null;
          } else {
            payload.supplier_id = body.querySelector('#f-supplier').value ? parseInt(body.querySelector('#f-supplier').value, 10) : null;
          }
          if (!payload.libelle) return toast('Libellé requis', 'danger');
          if (!payload.montant_ht) return toast('Montant HT requis', 'danger');
          const r = isEdit
            ? await window.api.compta.ecritures.update({ id: ec.id, ...payload })
            : await window.api.compta.ecritures.create(payload);
          if (r.ok) { toast(isEdit ? 'Modifié' : 'Créé', 'success'); close(true); render(); }
          else toast('Erreur : ' + r.error, 'danger');
        };
      }
    });
  }

  // -----------------------------------------------------------------------
  // ONGLET 4 — Situations chantier
  // -----------------------------------------------------------------------
  async function renderSituations() {
    const cont = $('#tab-content');
    cont.innerHTML = `
      <p class="muted small">Les <strong>situations</strong> sont des factures intermédiaires émises au fur et à mesure de l'avancement d'un chantier. Choisis un chantier pour voir et créer ses situations.</p>
      <div class="filters" style="margin-top:12px">
        <select id="site-select">
          <option value="">— Choisir un chantier —</option>
          ${sites.map(s => `<option value="${s.id}">${escapeHtml(s.nom)}${s.statut ? ' (' + s.statut + ')' : ''}</option>`).join('')}
        </select>
      </div>
      <div id="situations-content"></div>
    `;
    $('#site-select').onchange = (e) => {
      const id = parseInt(e.target.value, 10);
      if (id) renderSituationsForSite(id);
      else $('#situations-content').innerHTML = '';
    };
  }

  async function renderSituationsForSite(siteId) {
    const r = await window.api.compta.situations.list({ site_id: siteId });
    const sits = r.ok ? r.data : [];
    const site = sites.find(s => s.id === siteId);
    let montantTotal = 0;
    if (site && site.quote_id) {
      const q = quotes.find(qq => qq.id === site.quote_id);
      // Pour avoir le montant on ferait un appel api… simplifié ici
    }
    const totalFacture = sits.reduce((s, x) => s + (x.montant_ht_periode || 0), 0);

    $('#situations-content').innerHTML = `
      <div class="page-actions" style="margin:12px 0">
        <button class="btn primary" id="btn-add-sit">+ Nouvelle situation</button>
        <span class="muted small" style="margin-left:auto">${sits.length} situation(s) · Total facturé : <strong>${formatEUR(totalFacture)}</strong></span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th style="width:90px">N°</th>
            <th style="width:90px">Date</th>
            <th class="right" style="width:90px">Avancement</th>
            <th class="right" style="width:110px">Montant HT période</th>
            <th class="center" style="width:60px">TVA</th>
            <th class="right" style="width:110px">Montant TTC</th>
            <th class="center" style="width:80px">Payé le</th>
            <th class="center" style="width:60px"></th>
          </tr></thead>
          <tbody>${sits.length ? sits.map(s => `
            <tr data-id="${s.id}">
              <td>${escapeHtml(s.numero || '—')}</td>
              <td class="small">${formatDate(s.date).split(' ')[0]}</td>
              <td class="right"><strong>${formatNum(s.pct_avancement_cumule, 1)} %</strong></td>
              <td class="right">${formatEUR(s.montant_ht_periode)}</td>
              <td class="center small">${formatNum(s.tva_pct, 1)} %</td>
              <td class="right">${formatEUR(s.montant_ttc_periode)}</td>
              <td class="center small">${s.date_paiement ? formatDate(s.date_paiement).split(' ')[0] : '<span class="muted">—</span>'}</td>
              <td class="center"><button class="btn-icon danger" data-action="del-sit">🗑</button></td>
            </tr>
          `).join('') : '<tr><td colspan="8" class="empty">Aucune situation. Crée la première à un avancement donné.</td></tr>'}</tbody>
        </table>
      </div>
    `;
    $('#btn-add-sit').onclick = () => openSituationModal(siteId);
    $$('[data-action="del-sit"]').forEach(btn => {
      btn.onclick = async () => {
        const id = parseInt(btn.closest('tr').dataset.id, 10);
        if (await confirmModal('Supprimer cette situation ?', 'Les situations suivantes ne seront PAS recalculées automatiquement.')) {
          const r = await window.api.compta.situations.delete({ id });
          if (r.ok) { toast('Supprimée', 'success'); renderSituationsForSite(siteId); }
        }
      };
    });
  }

  function openSituationModal(siteId) {
    const today = new Date().toISOString().split('T')[0];
    return modal({
      title: 'Nouvelle situation',
      content: `
        <div class="form-grid">
          <label>N° situation<input id="s-num" placeholder="ex: SIT-001"></label>
          <label>Date *<input id="s-date" type="date" value="${today}"></label>
          <label class="full">Avancement cumulé (%)
            <input id="s-pct" type="number" step="0.5" min="0" max="100" value="0">
            <small class="muted">Pourcentage TOTAL de l'avancement (ex: 30, puis 60, puis 100). Le montant période sera calculé auto.</small>
          </label>
          <label>TVA %<input id="s-tva" type="number" step="0.1" value="${config && config.tva_pct_defaut || 8.5}"></label>
          <label>Date paiement<input id="s-pay" type="date"></label>
          <label class="full">Notes<textarea id="s-notes" rows="2"></textarea></label>
        </div>
      `,
      footer: `
        <button class="btn ghost" data-action="cancel">Annuler</button>
        <button class="btn primary" data-action="save">Créer</button>
      `,
      onMount: ({ body, footer, close }) => {
        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);
        footer.querySelector('[data-action="save"]').onclick = async () => {
          const dateVal = body.querySelector('#s-date').value;
          const payVal = body.querySelector('#s-pay').value;
          const payload = {
            site_id: siteId,
            numero: body.querySelector('#s-num').value.trim(),
            date: dateVal ? new Date(dateVal).getTime() : Date.now(),
            pct_avancement_cumule: parseFloat(body.querySelector('#s-pct').value) || 0,
            tva_pct: parseFloat(body.querySelector('#s-tva').value) || 0,
            date_paiement: payVal ? new Date(payVal).getTime() : null,
            notes: body.querySelector('#s-notes').value.trim()
          };
          const r = await window.api.compta.situations.create(payload);
          if (r.ok) { toast('Situation créée', 'success'); close(true); renderSituationsForSite(siteId); }
          else toast('Erreur : ' + r.error, 'danger');
        };
      }
    });
  }

  // -----------------------------------------------------------------------
  // ONGLET 5 — Déclarations (TVA, etc.)
  // -----------------------------------------------------------------------
  async function renderDeclarations() {
    const cont = $('#tab-content');
    cont.innerHTML = `
      <p class="muted">Données pré-calculées pour tes déclarations (à reporter sur les formulaires officiels CA3, CA12, etc.).</p>
      <div class="filters" style="margin-top:12px">
        <select id="periode-select">
          <option value="exercice">Exercice courant</option>
          <option value="trim1">1er trimestre</option>
          <option value="trim2">2e trimestre</option>
          <option value="trim3">3e trimestre</option>
          <option value="trim4">4e trimestre</option>
          <option value="mois-actuel">Mois actuel</option>
          <option value="mois-precedent">Mois précédent</option>
        </select>
      </div>
      <div id="decl-content"></div>
    `;
    const refresh = async () => {
      const opt = $('#periode-select').value;
      const [d1, d2] = computePeriode(opt);
      const r = await window.api.compta.dashboard({ dateMin: d1, dateMax: d2 });
      if (!r.ok) return $('#decl-content').innerHTML = '<p class="muted">Erreur</p>';
      const d = r.data;
      const periodeStr = `${formatDate(d1).split(' ')[0]} → ${formatDate(d2).split(' ')[0]}`;
      $('#decl-content').innerHTML = `
        <p class="muted small">Période : <strong>${periodeStr}</strong></p>

        <div class="grid-2cols" style="margin-top:14px">
          <div class="card-block">
            <h3>📋 TVA</h3>
            <table class="data-table">
              <tr><td>TVA collectée (sur ventes)</td><td class="right"><strong>${formatEUR(d.tva_collectee)}</strong></td></tr>
              <tr><td>TVA déductible (sur achats)</td><td class="right">−${formatEUR(d.tva_deductible)}</td></tr>
              <tr style="border-top:2px solid var(--primary)">
                <td><strong>TVA à payer (à reverser à l'État)</strong></td>
                <td class="right" style="color:${d.tva_a_payer >= 0 ? 'var(--danger)' : 'var(--success)'}">
                  <strong>${formatEUR(d.tva_a_payer)}</strong>
                </td>
              </tr>
            </table>
            <p class="muted small" style="margin-top:8px">
              ${d.tva_a_payer >= 0 ? 'Montant à reverser via formulaire CA3 (mensuel/trimestriel) ou CA12 (annuel selon régime).' : 'Crédit de TVA : peut être reporté sur la prochaine déclaration ou demandé en remboursement.'}
            </p>
          </div>

          <div class="card-block">
            <h3>📊 Résultat de la période</h3>
            <table class="data-table">
              <tr><td>Recettes HT</td><td class="right">${formatEUR(d.ca_ht)}</td></tr>
              <tr><td>Charges HT</td><td class="right">−${formatEUR(d.charges_ht)}</td></tr>
              <tr style="border-top:2px solid var(--primary)">
                <td><strong>Résultat brut</strong></td>
                <td class="right" style="color:${d.resultat_ht >= 0 ? 'var(--success)' : 'var(--danger)'}"><strong>${formatEUR(d.resultat_ht)}</strong></td>
              </tr>
              <tr><td>Marge brute</td><td class="right">${formatNum(d.marge_pct, 1)} %</td></tr>
            </table>
            ${config && config.forme_juridique === 'auto' ? `
              <p class="muted small" style="margin-top:8px">
                Auto-entrepreneur : assiette URSSAF = CA encaissé HT (à déclarer sur autoentrepreneur.urssaf.fr).
              </p>
            ` : `
              <p class="muted small" style="margin-top:8px">
                EI/EURL au réel : le résultat est imposé à l'IR (BIC) ou IS selon ton régime.
              </p>
            `}
          </div>
        </div>
      `;
    };
    $('#periode-select').onchange = refresh;
    refresh();
  }

  function computePeriode(opt) {
    const now = new Date();
    const annee = now.getFullYear();
    if (opt === 'exercice') {
      const exDeb = config && config.exercice_debut_mm ? config.exercice_debut_mm - 1 : 0;
      const exJj = config && config.exercice_debut_jj || 1;
      let yr = annee;
      const dCurrent = new Date(yr, exDeb, exJj).getTime();
      if (Date.now() < dCurrent) yr--;
      return [
        new Date(yr, exDeb, exJj).getTime(),
        new Date(yr + 1, exDeb, exJj - 1, 23, 59, 59).getTime()
      ];
    }
    if (opt === 'trim1') return [new Date(annee, 0, 1).getTime(), new Date(annee, 2, 31, 23, 59, 59).getTime()];
    if (opt === 'trim2') return [new Date(annee, 3, 1).getTime(), new Date(annee, 5, 30, 23, 59, 59).getTime()];
    if (opt === 'trim3') return [new Date(annee, 6, 1).getTime(), new Date(annee, 8, 30, 23, 59, 59).getTime()];
    if (opt === 'trim4') return [new Date(annee, 9, 1).getTime(), new Date(annee, 11, 31, 23, 59, 59).getTime()];
    if (opt === 'mois-actuel') return [new Date(annee, now.getMonth(), 1).getTime(), new Date(annee, now.getMonth() + 1, 0, 23, 59, 59).getTime()];
    if (opt === 'mois-precedent') return [new Date(annee, now.getMonth() - 1, 1).getTime(), new Date(annee, now.getMonth(), 0, 23, 59, 59).getTime()];
    return [Date.now() - 365 * 86400000, Date.now()];
  }

  // -----------------------------------------------------------------------
  // ONGLET 6 — Configuration
  // -----------------------------------------------------------------------
  function renderConfig() {
    const c = config || {};
    $('#tab-content').innerHTML = `
      <div class="card-block">
        <h3>🏢 Identité de l'entreprise</h3>
        <div class="form-grid">
          <label class="full">Raison sociale<input id="c-rs" value="${escapeHtml(c.raison_sociale || '')}"></label>
          <label>Forme juridique
            <select id="c-fj">
              <option value="auto" ${c.forme_juridique === 'auto' ? 'selected' : ''}>Auto-entrepreneur (micro)</option>
              <option value="ei" ${c.forme_juridique === 'ei' ? 'selected' : ''}>EI (Entreprise individuelle)</option>
              <option value="eurl" ${c.forme_juridique === 'eurl' ? 'selected' : ''}>EURL</option>
              <option value="sarl" ${c.forme_juridique === 'sarl' ? 'selected' : ''}>SARL</option>
              <option value="sas" ${c.forme_juridique === 'sas' ? 'selected' : ''}>SAS / SASU</option>
            </select>
          </label>
          <label>SIRET<input id="c-siret" value="${escapeHtml(c.siret || '')}"></label>
          <label>Code APE<input id="c-ape" value="${escapeHtml(c.ape || '')}"></label>
          <label class="full">Adresse<textarea id="c-adr" rows="2">${escapeHtml(c.adresse || '')}</textarea></label>
        </div>
      </div>

      <div class="card-block">
        <h3>💼 Régime TVA</h3>
        <div class="form-grid">
          <label>Régime
            <select id="c-tva-reg">
              <option value="franchise" ${c.regime_tva === 'franchise' ? 'selected' : ''}>Franchise en base (auto-entrepreneur sous seuil)</option>
              <option value="reel_simplifie" ${c.regime_tva === 'reel_simplifie' ? 'selected' : ''}>Réel simplifié (CA12 annuel)</option>
              <option value="reel_normal" ${c.regime_tva === 'reel_normal' ? 'selected' : ''}>Réel normal (CA3 mensuel/trimestriel)</option>
            </select>
          </label>
          <label>TVA par défaut (%)
            <input id="c-tva-pct" type="number" step="0.1" value="${c.tva_pct_defaut || 8.5}">
            <small class="muted">DOM-TOM 8.5% · Métropole 20% · Travaux rénovation 10%</small>
          </label>
        </div>
      </div>

      <div class="card-block">
        <h3>📅 Exercice fiscal</h3>
        <div class="form-grid">
          <label>Mois début (1-12)<input id="c-ex-mm" type="number" min="1" max="12" value="${c.exercice_debut_mm || 1}"></label>
          <label>Jour début<input id="c-ex-jj" type="number" min="1" max="31" value="${c.exercice_debut_jj || 1}"></label>
        </div>
        <p class="muted small">La plupart des entreprises clôturent au 31/12 (mois 1, jour 1). Modifie si tu as un exercice décalé.</p>
      </div>

      <div class="card-block">
        <h3>🏗 Méthode de comptabilisation des chantiers</h3>
        <div class="form-row" style="flex-wrap:wrap">
          <label class="radio">
            <input type="radio" name="c-meth" value="avancement" ${c.methode_chantier === 'avancement' ? 'checked' : ''}>
            <span><strong>À l'avancement</strong> (recommandé pour BTP) — CA reconnu au % d'avancement</span>
          </label>
          <label class="radio">
            <input type="radio" name="c-meth" value="achevement" ${c.methode_chantier === 'achevement' ? 'checked' : ''}>
            <span>À l'achèvement — CA reconnu uniquement à la fin du chantier</span>
          </label>
        </div>
      </div>

      <div class="form-row" style="margin:18px 0">
        <button class="btn primary" id="btn-save-cfg">💾 Enregistrer la configuration</button>
      </div>
    `;

    $('#btn-save-cfg').onclick = async () => {
      const payload = {
        raison_sociale: $('#c-rs').value.trim(),
        forme_juridique: $('#c-fj').value,
        siret: $('#c-siret').value.trim(),
        ape: $('#c-ape').value.trim(),
        adresse: $('#c-adr').value.trim(),
        regime_tva: $('#c-tva-reg').value,
        tva_pct_defaut: parseFloat($('#c-tva-pct').value) || 8.5,
        exercice_debut_mm: parseInt($('#c-ex-mm').value, 10) || 1,
        exercice_debut_jj: parseInt($('#c-ex-jj').value, 10) || 1,
        methode_chantier: $('input[name="c-meth"]:checked').value
      };
      const r = await window.api.compta.config.set(payload);
      if (r.ok) { toast('Configuration enregistrée', 'success'); config = r.data; render(); }
      else toast('Erreur : ' + r.error, 'danger');
    };
  }

  window.ArtisanComptaPage = {
    async render(container) {
      containerEl = container;
      containerEl.innerHTML = '<div class="loader">Chargement…</div>';
      await refresh();
    }
  };
})();
