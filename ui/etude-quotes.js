// ui/etude-quotes.js — Devis avec KPV (intégré ou en bas), TVA, multi-versions
(function () {
  const { $, $$, escapeHtml, formatEUR, formatNum, formatDate, toast, modal, confirmModal } = window.UI;

  let quotes = [];
  let containerEl = null;

  const STATUTS = {
    brouillon: { label: '📝 Brouillon', color: '#9494a8' },
    envoye:    { label: '📤 Envoyé',    color: '#5b8def' },
    recu:      { label: '📥 Reçu',      color: '#5b8def' },
    lu:        { label: '👁 Lu',         color: '#f0a868' },
    accepte:   { label: '✅ Accepté',   color: '#4caf7c' },
    refuse:    { label: '❌ Refusé',    color: '#e15a5a' },
    clos:      { label: '🔒 Clos',      color: '#9494a8' }
  };

  // Calcul des totaux côté UI (mirror de etude.js computeQuoteTotals)
  function computeTotals(lignes, settings) {
    const debourse = (lignes || []).reduce((s, l) =>
      s + (parseFloat(l.quantite) || 0) * (parseFloat(l.prixUnitaire) || 0), 0);
    const kpvPct = parseFloat(settings.kpv_pct) || 0;
    const tvaPct = parseFloat(settings.tva_pct) || 0;
    const kpvMode = settings.kpv_mode || 'fin';
    let totalHT, frais = 0;
    if (kpvMode === 'integre') {
      totalHT = debourse * (1 + kpvPct / 100);
      frais = totalHT - debourse;
    } else {
      frais = debourse * (kpvPct / 100);
      totalHT = debourse + frais;
    }
    const tva = totalHT * (tvaPct / 100);
    const totalTTC = totalHT + tva;
    return { debourse, frais, total_ht: totalHT, tva, total_ttc: totalTTC, kpv_mode: kpvMode, kpv_pct: kpvPct, tva_pct: tvaPct };
  }

  async function refresh() {
    const r = await window.api.etude.quotes.list();
    if (r.ok) quotes = r.data;
    render();
  }

  function render() {
    if (!containerEl) return;
    const rows = quotes.length ? quotes.map(q => {
      const s = STATUTS[q.statut] || STATUTS.brouillon;
      return `
        <tr data-id="${q.id}">
          <td>${escapeHtml(q.code || '#' + q.id)}</td>
          <td>${escapeHtml(q.titre)}</td>
          <td>${escapeHtml(q.client_nom || '—')}</td>
          <td class="center"><span class="status-badge" style="background:${s.color}22;color:${s.color}">${s.label}</span></td>
          <td class="center">v${q.last_version || 1}</td>
          <td class="center small muted">${formatDate(q.date_maj)}</td>
          <td class="center actions">
            <button class="btn-icon" data-action="open" title="Ouvrir">📂</button>
            <button class="btn-icon" data-action="pdf" title="Export PDF">📄</button>
            <button class="btn-icon" data-action="send" title="Envoyer aux artisans (.ndev)">📤</button>
            <button class="btn-icon danger" data-action="delete" title="Supprimer">🗑</button>
          </td>
        </tr>
      `;
    }).join('') : '<tr><td colspan="7" class="empty">Aucun devis. Crée-en un !</td></tr>';

    containerEl.innerHTML = `
      <div class="page-header">
        <h1>📄 Devis <span class="muted small">(${quotes.length})</span></h1>
        <div class="page-actions">
          <button class="btn primary" id="btn-new-quote">+ Nouveau devis</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th style="width:100px">Code</th>
            <th>Titre</th>
            <th>Client</th>
            <th class="center" style="width:120px">Statut</th>
            <th class="center" style="width:60px">Vers.</th>
            <th class="center" style="width:140px">Maj</th>
            <th class="center" style="width:130px">Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    $('#btn-new-quote').onclick = () => openQuoteEditor(null);
    $$('[data-action]').forEach(btn => {
      btn.onclick = async () => {
        const tr = btn.closest('tr');
        const id = parseInt(tr.dataset.id, 10);
        if (btn.dataset.action === 'open') {
          const r = await window.api.etude.quotes.get({ id });
          if (r.ok) openQuoteEditor(r.data);
        }
        if (btn.dataset.action === 'pdf') {
          const qData = quotes.find(x => x.id === id);
          toast('Génération du PDF…', 'info');
          const r = await window.api.etude.quotes.exportPdf({ quoteId: id, versionNumero: qData.last_version });
          if (r.ok) toast('PDF généré : ' + r.path, 'success');
          else if (!r.canceled) toast('Erreur PDF : ' + r.error, 'danger');
        }
        if (btn.dataset.action === 'send') {
          const qData = quotes.find(x => x.id === id);
          openSendModal(id, qData);
        }
        if (btn.dataset.action === 'delete') {
          const q = quotes.find(x => x.id === id);
          if (await confirmModal('Supprimer ce devis ?', `« ${q.titre} »`)) {
            const r = await window.api.etude.quotes.delete({ id });
            if (r.ok) { toast('Supprimé', 'success'); refresh(); }
          }
        }
      };
    });
  }

  // ---------- ÉDITEUR DE DEVIS ----------
  async function openQuoteEditor(quote) {
    const isEdit = !!quote;
    let workingLignes = [];
    let viewingVersion = null;

    // Settings courants (avec valeurs par défaut sensées pour Martinique)
    let settings = {
      kpv_mode: (quote && quote.kpv_mode) || 'fin',
      kpv_pct: quote ? (quote.kpv_pct || 0) : 25,
      tva_pct: quote ? (quote.tva_pct || 8.5) : 8.5
    };

    if (isEdit && quote.versions && quote.versions.length) {
      const last = quote.versions[quote.versions.length - 1];
      workingLignes = JSON.parse(JSON.stringify((last.snapshot && last.snapshot.lignes) || []));
      viewingVersion = last.numero;
    }

    return modal({
      title: isEdit ? `Devis #${quote.id} — ${quote.titre}` : 'Nouveau devis',
      large: true,
      content: `
        <div class="quote-editor">

          <h3>Informations générales</h3>
          <div class="form-grid">
            <label>Code<input id="q-code" value="${escapeHtml(quote && quote.code || '')}" placeholder="ex: DEV-2026-001"></label>
            <label class="full">Titre *<input id="q-titre" value="${escapeHtml(quote && quote.titre || '')}"></label>
            <label>Client<input id="q-client" value="${escapeHtml(quote && quote.client_nom || '')}"></label>
            <label>Email client<input id="q-email" value="${escapeHtml(quote && quote.client_email || '')}"></label>
            <label class="full">Adresse client<textarea id="q-adresse" rows="2">${escapeHtml(quote && quote.client_adresse || '')}</textarea></label>
            ${isEdit ? `<label>Statut<select id="q-statut">${Object.entries(STATUTS).map(([k, v]) => `<option value="${k}" ${quote.statut === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>` : ''}
          </div>

          <h3>💰 Tarification (KPV & TVA)</h3>
          <div class="kpv-block">
            <div class="form-row" style="margin-bottom:6px">
              <label class="radio">
                <input type="radio" name="kpv-mode" value="fin" ${settings.kpv_mode === 'fin' ? 'checked' : ''}>
                <span><strong>Marge à la fin du devis</strong> — le client voit le détail : Sous-total + Frais et marge + Total HT</span>
              </label>
            </div>
            <div class="form-row">
              <label class="radio">
                <input type="radio" name="kpv-mode" value="integre" ${settings.kpv_mode === 'integre' ? 'checked' : ''}>
                <span><strong>Marge intégrée aux prix unitaires</strong> — le client ne voit qu'un PU final (déboursé masqué)</span>
              </label>
            </div>

            <div class="form-grid" style="margin-top:12px">
              <label>KPV en %
                <input id="q-kpv-pct" type="number" step="0.1" value="${formatNum(settings.kpv_pct, 2)}">
              </label>
              <label>KPV en coefficient
                <input id="q-kpv-coef" type="number" step="0.001" value="${formatNum(1 + settings.kpv_pct / 100, 4)}">
              </label>
              <label class="full">TVA (%)
                <input id="q-tva" type="number" step="0.1" value="${settings.tva_pct}">
                <small class="muted">DOM-TOM : 8.5% &nbsp;·&nbsp; Métropole : 20% &nbsp;·&nbsp; Travaux rénovation : 10% ou 5.5%</small>
              </label>
            </div>
            <p class="kpv-note muted small" id="kpv-explainer"></p>
          </div>

          ${isEdit && quote.versions.length > 1 ? `
            <div class="versions-bar">
              <strong>Versions :</strong>
              ${quote.versions.map(v => `<button class="version-chip ${v.numero === viewingVersion ? 'active' : ''}" data-version="${v.numero}">v${v.numero}</button>`).join('')}
              <button class="btn ghost small" id="btn-diff">⚖ Comparer v${quote.versions.length - 1} ↔ v${quote.versions.length}</button>
            </div>
          ` : ''}

          <h3 style="margin-top:16px">Lignes de devis</h3>
          <table class="data-table">
            <thead><tr>
              <th style="width:30px">#</th>
              <th>Désignation</th>
              <th class="center" style="width:60px">U.</th>
              <th class="right" style="width:90px">Qté</th>
              <th class="right" style="width:110px">P.U. HT</th>
              <th class="right" style="width:110px">Total HT</th>
              <th style="width:50px"></th>
            </tr></thead>
            <tbody id="lignes-tbody"></tbody>
          </table>
          <div class="form-row" style="margin-top:8px">
            <button class="btn ghost" id="btn-add-base">+ Depuis la base</button>
            <button class="btn ghost" id="btn-add-compo">+ Composition</button>
            <button class="btn ghost" id="btn-add-libre">+ Ligne libre</button>
          </div>

          <div class="totaux-block" id="totaux-zone"></div>

          <h3>Notes (bas de devis)</h3>
          <textarea id="q-notes" rows="3" placeholder="Conditions, validité, modalités de paiement…">${escapeHtml(quote && quote.notes_bas_devis || '')}</textarea>
        </div>
      `,
      footer: `
        <button class="btn ghost" data-action="cancel">Fermer</button>
        ${isEdit ? '<button class="btn ghost" data-action="save-meta">💾 Enreg. infos & tarif</button>' : ''}
        ${isEdit ? '<button class="btn primary" data-action="new-version">📌 Enreg. comme nouvelle version</button>' : '<button class="btn primary" data-action="create">Créer le devis</button>'}
      `,
      onMount: ({ body, footer, close }) => {
        const tbody = body.querySelector('#lignes-tbody');
        const totauxZone = body.querySelector('#totaux-zone');

        function renderTotaux() {
          const t = computeTotals(workingLignes, settings);
          const showFrais = t.kpv_mode === 'fin' && t.kpv_pct > 0;
          const showIntegreFrais = t.kpv_mode === 'integre' && t.kpv_pct > 0;
          totauxZone.innerHTML = `
            <table class="totaux-table">
              ${showFrais ? `
                <tr><td>Sous-total déboursé HT</td><td class="value">${formatEUR(t.debourse)}</td></tr>
                <tr><td>Frais et marge (${formatNum(t.kpv_pct, 2)} %)</td><td class="value">${formatEUR(t.frais)}</td></tr>
              ` : ''}
              ${showIntegreFrais ? `
                <tr class="muted"><td>Déboursé sec (info, non visible client)</td><td class="value">${formatEUR(t.debourse)}</td></tr>
                <tr class="muted"><td>Marge intégrée aux PU (${formatNum(t.kpv_pct, 2)} %)</td><td class="value">${formatEUR(t.frais)}</td></tr>
              ` : ''}
              <tr class="total-ht"><td><strong>Total HT</strong></td><td class="value"><strong>${formatEUR(t.total_ht)}</strong></td></tr>
              <tr><td>TVA (${formatNum(t.tva_pct, 2)} %)</td><td class="value">${formatEUR(t.tva)}</td></tr>
              <tr class="total-ttc"><td>Total TTC</td><td class="value">${formatEUR(t.total_ttc)}</td></tr>
            </table>
          `;
        }

        function renderLignes() {
          tbody.innerHTML = workingLignes.length ? workingLignes.map((l, i) => `
            <tr data-idx="${i}">
              <td class="center muted">${i + 1}</td>
              <td><input class="l-desig" value="${escapeHtml(l.designation || '')}"></td>
              <td><input class="l-unite" value="${escapeHtml(l.unite || '')}" style="width:100%"></td>
              <td><input class="l-qte" type="number" step="0.01" value="${l.quantite || 0}" class="right"></td>
              <td><input class="l-pu" type="number" step="0.01" value="${l.prixUnitaire || 0}" class="right"></td>
              <td class="right l-total">${formatEUR((parseFloat(l.quantite) || 0) * (parseFloat(l.prixUnitaire) || 0))}</td>
              <td class="center"><button class="btn-icon danger" data-action="rm-l">🗑</button></td>
            </tr>
          `).join('') : '<tr><td colspan="7" class="empty">Aucune ligne. Ajoute-en une.</td></tr>';

          $$('tr[data-idx]', tbody).forEach(tr => {
            const idx = parseInt(tr.dataset.idx, 10);
            const recalc = () => {
              const q = parseFloat(tr.querySelector('.l-qte').value) || 0;
              const pu = parseFloat(tr.querySelector('.l-pu').value) || 0;
              tr.querySelector('.l-total').textContent = formatEUR(q * pu);
              workingLignes[idx].quantite = q;
              workingLignes[idx].prixUnitaire = pu;
              workingLignes[idx].designation = tr.querySelector('.l-desig').value;
              workingLignes[idx].unite = tr.querySelector('.l-unite').value;
              renderTotaux();
            };
            tr.querySelector('.l-desig').oninput = recalc;
            tr.querySelector('.l-unite').oninput = recalc;
            tr.querySelector('.l-qte').oninput = recalc;
            tr.querySelector('.l-pu').oninput = recalc;
            tr.querySelector('[data-action="rm-l"]').onclick = () => {
              workingLignes.splice(idx, 1);
              renderLignes();
              renderTotaux();
            };
          });
        }

        renderLignes();
        renderTotaux();

        // Inputs KPV/TVA — sync coef <-> pct + explainer
        function refreshKpvUi() {
          const inputPct = body.querySelector('#q-kpv-pct');
          const inputCoef = body.querySelector('#q-kpv-coef');
          if (inputPct && document.activeElement !== inputPct) inputPct.value = formatNum(settings.kpv_pct, 2);
          if (inputCoef && document.activeElement !== inputCoef) inputCoef.value = formatNum(1 + settings.kpv_pct / 100, 4);
          const expl = body.querySelector('#kpv-explainer');
          if (expl) {
            const t = computeTotals(workingLignes, settings);
            if (settings.kpv_mode === 'fin') {
              expl.innerHTML = `→ Le client verra une ligne <em>"Frais et marge"</em> de <strong>${formatEUR(t.frais)}</strong> ajoutée au déboursé.`;
            } else {
              expl.innerHTML = `→ Chaque PU au client = PU déboursé × <strong>${formatNum(1 + settings.kpv_pct / 100, 4)}</strong>. Le déboursé est masqué dans le PDF.`;
            }
          }
          renderTotaux();
        }
        $$('input[name="kpv-mode"]', body).forEach(r => {
          r.onchange = () => { settings.kpv_mode = r.value; refreshKpvUi(); };
        });
        body.querySelector('#q-kpv-pct').oninput = (e) => {
          settings.kpv_pct = parseFloat(String(e.target.value).replace(',', '.')) || 0;
          refreshKpvUi();
        };
        body.querySelector('#q-kpv-coef').oninput = (e) => {
          const coef = parseFloat(String(e.target.value).replace(',', '.')) || 1;
          settings.kpv_pct = (coef - 1) * 100;
          refreshKpvUi();
        };
        body.querySelector('#q-tva').oninput = (e) => {
          settings.tva_pct = parseFloat(String(e.target.value).replace(',', '.')) || 0;
          renderTotaux();
        };
        refreshKpvUi();

        // Boutons d'ajout
        body.querySelector('#btn-add-libre').onclick = () => {
          workingLignes.push({ designation: '', unite: '', quantite: 1, prixUnitaire: 0 });
          renderLignes();
          renderTotaux();
        };
        body.querySelector('#btn-add-base').onclick = async () => {
          const picked = await window.openPricePicker();
          if (picked) {
            workingLignes.push({
              priceId: picked.id, designation: picked.designation,
              unite: picked.unite || '', quantite: 1, prixUnitaire: picked.prix
            });
            renderLignes(); renderTotaux();
          }
        };
        body.querySelector('#btn-add-compo').onclick = async () => {
          const picked = await window.openCompoPicker();
          if (picked) {
            workingLignes.push({
              compositionId: picked.id, designation: picked.nom,
              unite: picked.unite || '', quantite: 1, prixUnitaire: picked.total
            });
            renderLignes(); renderTotaux();
          }
        };

        // Versions : changer
        $$('.version-chip', body).forEach(chip => {
          chip.onclick = () => {
            const num = parseInt(chip.dataset.version, 10);
            const v = quote.versions.find(vv => vv.numero === num);
            if (v && v.snapshot) {
              workingLignes = JSON.parse(JSON.stringify(v.snapshot.lignes || []));
              viewingVersion = num;
              $$('.version-chip', body).forEach(c => c.classList.remove('active'));
              chip.classList.add('active');
              renderLignes(); renderTotaux();
            }
          };
        });

        const diffBtn = body.querySelector('#btn-diff');
        if (diffBtn) {
          diffBtn.onclick = async () => {
            const vA = quote.versions[quote.versions.length - 2];
            const vB = quote.versions[quote.versions.length - 1];
            const r = await window.api.etude.quotes.diff({ vA: vA.snapshot, vB: vB.snapshot });
            if (r.ok) showDiffModal(vA, vB, r.data);
          };
        }

        // Footer
        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);

        const collectMeta = () => ({
          code: body.querySelector('#q-code').value.trim(),
          titre: body.querySelector('#q-titre').value.trim(),
          clientNom: body.querySelector('#q-client').value.trim(),
          clientEmail: body.querySelector('#q-email').value.trim(),
          clientAdresse: body.querySelector('#q-adresse').value.trim(),
          kpvMode: settings.kpv_mode,
          kpvPct: settings.kpv_pct,
          tvaPct: settings.tva_pct,
          notesBasDevis: body.querySelector('#q-notes').value.trim()
        });

        const saveMetaBtn = footer.querySelector('[data-action="save-meta"]');
        if (saveMetaBtn) saveMetaBtn.onclick = async () => {
          const payload = { id: quote.id, ...collectMeta(), statut: body.querySelector('#q-statut').value };
          if (!payload.titre) return toast('Titre requis', 'danger');
          const r = await window.api.etude.quotes.updateMeta(payload);
          if (r.ok) { toast('Enregistré', 'success'); refresh(); }
          else toast('Erreur : ' + r.error, 'danger');
        };

        const newVerBtn = footer.querySelector('[data-action="new-version"]');
        if (newVerBtn) newVerBtn.onclick = async () => {
          if (!await confirmModal('Créer une nouvelle version ?', 'Une nouvelle version sera créée avec les modifications actuelles. La version précédente reste consultable.')) return;
          // Sauve aussi les méta (KPV/TVA peuvent avoir changé)
          await window.api.etude.quotes.updateMeta({ id: quote.id, ...collectMeta() });
          const r = await window.api.etude.quotes.addVersion({ id: quote.id, lignes: workingLignes });
          if (r.ok) { toast('Version v' + r.numero + ' créée', 'success'); close(true); refresh(); }
          else toast('Erreur : ' + r.error, 'danger');
        };

        const createBtn = footer.querySelector('[data-action="create"]');
        if (createBtn) createBtn.onclick = async () => {
          const payload = { ...collectMeta(), lignes: workingLignes };
          if (!payload.titre) return toast('Titre requis', 'danger');
          const r = await window.api.etude.quotes.create(payload);
          if (r.ok) { toast('Devis créé', 'success'); close(true); refresh(); }
          else toast('Erreur : ' + r.error, 'danger');
        };
      }
    });
  }

  function showDiffModal(vA, vB, diff) {
    const renderRows = (lst, cls) => lst.length ? lst.map(l => {
      if (cls === 'mod') {
        return `<tr class="diff-mod">
          <td>~ ${escapeHtml(l.after.designation || '')}</td>
          <td class="right"><s>${formatNum(l.before.quantite)} × ${formatEUR(l.before.prixUnitaire)}</s> → ${formatNum(l.after.quantite)} × ${formatEUR(l.after.prixUnitaire)}</td>
        </tr>`;
      }
      return `<tr class="diff-${cls}">
        <td>${cls === 'add' ? '+' : '−'} ${escapeHtml(l.designation || '')}</td>
        <td class="right">${formatNum(l.quantite)} × ${formatEUR(l.prixUnitaire)} = ${formatEUR((l.quantite || 0) * (l.prixUnitaire || 0))}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="2" class="empty">Aucun</td></tr>`;

    modal({
      title: `Comparaison v${vA.numero} → v${vB.numero}`,
      large: true,
      content: `
        ${diff.added.length ? `<h3 style="color:var(--success)">+ Ajoutés (${diff.added.length})</h3><table class="data-table"><tbody>${renderRows(diff.added, 'add')}</tbody></table>` : ''}
        ${diff.removed.length ? `<h3 style="color:var(--danger)">− Supprimés (${diff.removed.length})</h3><table class="data-table"><tbody>${renderRows(diff.removed, 'rem')}</tbody></table>` : ''}
        ${diff.modified.length ? `<h3 style="color:var(--warning)">~ Modifiés (${diff.modified.length})</h3><table class="data-table"><tbody>${renderRows(diff.modified, 'mod')}</tbody></table>` : ''}
        ${(!diff.added.length && !diff.removed.length && !diff.modified.length) ? '<p>Aucune différence.</p>' : ''}
      `,
      footer: `<button class="btn primary" data-action="close">Fermer</button>`,
      onMount: ({ footer, close }) => {
        footer.querySelector('[data-action="close"]').onclick = () => close(true);
      }
    });
  }

  // -----------------------------------------------------------------------
  // ENVOI .ndev — multi-destinataires
  // -----------------------------------------------------------------------
  async function openSendModal(quoteId, quoteData) {
    const r = await window.api.contacts.list();
    const all = r.ok ? r.data : [];
    if (!all.length) {
      return modal({
        title: '📤 Envoyer aux artisans',
        content: `
          <div class="status-box warn">⚠️ Aucun artisan dans ton carnet.</div>
          <p>Pour envoyer un devis chiffré, ajoute d'abord des artisans dans le menu <strong>👥 Carnet artisans</strong>. Tu auras besoin de leur clé publique X25519.</p>
        `,
        footer: '<button class="btn primary" data-action="ok">Compris</button>',
        onMount: ({ footer, close }) => { footer.querySelector('[data-action="ok"]').onclick = () => close(true); }
      });
    }
    return modal({
      title: '📤 Envoyer le devis ' + (quoteData.code || '#' + quoteId),
      large: true,
      content: `
        <p class="muted small">Sélectionne les artisans à qui envoyer le devis. Un fichier .nbsp.ndev sera généré pour chaque destinataire (chiffré spécifiquement pour lui).</p>

        <label>Sujet
          <input id="s-subject" value="${escapeHtml((quoteData.code || '') + ' — ' + (quoteData.titre || ''))}">
        </label>

        <h4 style="margin-top:14px">Destinataires (${all.length})</h4>
        <div class="contacts-pick" style="max-height:300px;overflow:auto;border:1px solid var(--border);border-radius:6px">
          ${all.map(c => `
            <label class="contact-pick" style="display:flex;align-items:center;gap:10px;padding:10px;border-bottom:1px solid var(--border);cursor:pointer">
              <input type="checkbox" class="c-pick" data-id="${c.id}" style="width:18px;height:18px;accent-color:var(--primary)">
              <div style="flex:1">
                <strong>${escapeHtml(c.label)}</strong>
                ${c.metier ? '<br><span class="muted small">' + escapeHtml(c.metier) + '</span>' : ''}
                ${c.email ? '<br><span class="muted small">' + escapeHtml(c.email) + '</span>' : ''}
              </div>
            </label>
          `).join('')}
        </div>
        <div class="form-row" style="margin-top:8px">
          <button class="btn ghost small" id="btn-pick-all">Tout sélectionner</button>
          <button class="btn ghost small" id="btn-pick-none">Aucun</button>
        </div>
        <div id="send-result" style="margin-top:14px"></div>
      `,
      footer: `
        <button class="btn ghost" data-action="cancel">Annuler</button>
        <button class="btn primary" data-action="send">📤 Générer les fichiers .ndev</button>
      `,
      onMount: ({ body, footer, close }) => {
        body.querySelector('#btn-pick-all').onclick = () => $$('.c-pick', body).forEach(c => c.checked = true);
        body.querySelector('#btn-pick-none').onclick = () => $$('.c-pick', body).forEach(c => c.checked = false);
        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);
        footer.querySelector('[data-action="send"]').onclick = async () => {
          const ids = $$('.c-pick:checked', body).map(c => parseInt(c.dataset.id, 10));
          if (!ids.length) return toast('Sélectionne au moins un artisan', 'danger');
          const subj = body.querySelector('#s-subject').value.trim();
          const r = await window.api.ndev.export({ quoteId, contactIds: ids, subject: subj });
          if (!r.ok) return toast('Erreur : ' + r.error, 'danger');
          // Affiche les fichiers générés avec boutons de téléchargement
          const result = body.querySelector('#send-result');
          result.innerHTML = `
            <div class="status-box ok">✅ ${r.files.length} fichier(s) .ndev généré(s)</div>
            <table class="data-table" style="margin-top:8px">
              <thead><tr><th>Destinataire</th><th>Email</th><th class="center">Action</th></tr></thead>
              <tbody>${r.files.map((f, i) => `
                <tr>
                  <td>${escapeHtml(f.contact_label)}</td>
                  <td class="small">${escapeHtml(f.contact_email || '—')}</td>
                  <td class="center">
                    <button class="btn ghost small" data-dl="${i}">⬇ Télécharger</button>
                  </td>
                </tr>
              `).join('')}</tbody>
            </table>
          `;
          $$('[data-dl]', result).forEach(btn => {
            btn.onclick = () => {
              const f = r.files[parseInt(btn.dataset.dl, 10)];
              const blob = new Blob([f.content], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = f.file_name; a.click();
              setTimeout(() => URL.revokeObjectURL(url), 100);
              toast('Téléchargé : ' + f.file_name, 'success');
            };
          });
          toast('Fichiers .ndev générés', 'success');
        };
      }
    });
  }

  window.EtudeQuotesPage = {
    async render(container) {
      containerEl = container;
      containerEl.innerHTML = '<div class="loader">Chargement…</div>';
      await refresh();
    }
  };
})();
