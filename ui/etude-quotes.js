// ui/etude-quotes.js — Page Devis (création, édition, versions, diff, export PDF)
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
          const r = await window.api.etude.quotes.exportPdf({ quoteId: id, versionNumero: qData.last_version });
          if (r.ok) toast('PDF généré : ' + r.path, 'success');
          else if (!r.canceled) toast('Erreur : ' + r.error, 'danger');
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

  // Editeur de devis (création + édition + versions)
  async function openQuoteEditor(quote) {
    const isEdit = !!quote;
    let workingLignes = []; // copie locale des lignes en cours d'édition
    let viewingVersion = null; // numero de la version en cours d'affichage
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
          <div class="form-grid">
            <label>Code<input id="q-code" value="${escapeHtml(quote && quote.code || '')}" placeholder="ex: DEV-2026-001"></label>
            <label class="full">Titre *<input id="q-titre" value="${escapeHtml(quote && quote.titre || '')}"></label>
            <label>Client<input id="q-client" value="${escapeHtml(quote && quote.client_nom || '')}"></label>
            <label>Email client<input id="q-email" value="${escapeHtml(quote && quote.client_email || '')}"></label>
            ${isEdit ? `<label>Statut<select id="q-statut">${Object.entries(STATUTS).map(([k, v]) => `<option value="${k}" ${quote.statut === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>` : ''}
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
            <tfoot>
              <tr>
                <td colspan="5" class="right"><strong>Total HT :</strong></td>
                <td class="right"><strong id="total-ht">0,00 €</strong></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          <div class="form-row" style="margin-top:8px">
            <button class="btn ghost" id="btn-add-base">+ Depuis la base</button>
            <button class="btn ghost" id="btn-add-compo">+ Composition</button>
            <button class="btn ghost" id="btn-add-libre">+ Ligne libre</button>
          </div>
        </div>
      `,
      footer: `
        <button class="btn ghost" data-action="cancel">Fermer</button>
        ${isEdit ? '<button class="btn ghost" data-action="save-meta">💾 Enreg. métadonnées</button>' : ''}
        ${isEdit ? '<button class="btn primary" data-action="new-version">📌 Enreg. comme nouvelle version</button>' : '<button class="btn primary" data-action="create">Créer le devis</button>'}
      `,
      onMount: ({ body, footer, close }) => {
        const tbody = body.querySelector('#lignes-tbody');

        function renderLignes() {
          tbody.innerHTML = workingLignes.length ? workingLignes.map((l, i) => `
            <tr data-idx="${i}">
              <td class="center muted">${i + 1}</td>
              <td><input class="l-desig" value="${escapeHtml(l.designation || '')}"></td>
              <td><input class="l-unite" value="${escapeHtml(l.unite || '')}" style="width:100%"></td>
              <td><input class="l-qte" type="number" step="0.01" value="${l.quantite || 0}" class="right"></td>
              <td><input class="l-pu" type="number" step="0.01" value="${l.prixUnitaire || 0}" class="right"></td>
              <td class="right l-total">${formatEUR((parseFloat(l.quantite) || 0) * (parseFloat(l.prixUnitaire) || 0))}</td>
              <td class="center"><button class="btn-icon danger" data-action="remove-l">🗑</button></td>
            </tr>
          `).join('') : '<tr><td colspan="7" class="empty">Aucune ligne. Ajoute-en une.</td></tr>';

          let total = 0;
          workingLignes.forEach(l => total += (parseFloat(l.quantite) || 0) * (parseFloat(l.prixUnitaire) || 0));
          body.querySelector('#total-ht').textContent = formatEUR(total);

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
              let total = 0;
              workingLignes.forEach(l => total += (parseFloat(l.quantite) || 0) * (parseFloat(l.prixUnitaire) || 0));
              body.querySelector('#total-ht').textContent = formatEUR(total);
            };
            tr.querySelector('.l-desig').oninput = recalc;
            tr.querySelector('.l-unite').oninput = recalc;
            tr.querySelector('.l-qte').oninput = recalc;
            tr.querySelector('.l-pu').oninput = recalc;
            tr.querySelector('[data-action="remove-l"]').onclick = () => {
              workingLignes.splice(idx, 1);
              renderLignes();
            };
          });
        }
        renderLignes();

        body.querySelector('#btn-add-libre').onclick = () => {
          workingLignes.push({ designation: '', unite: '', quantite: 1, prixUnitaire: 0 });
          renderLignes();
        };
        body.querySelector('#btn-add-base').onclick = async () => {
          const picked = await window.openPricePicker();
          if (picked) {
            workingLignes.push({
              priceId: picked.id,
              designation: picked.designation,
              unite: picked.unite || '',
              quantite: 1,
              prixUnitaire: picked.prix
            });
            renderLignes();
          }
        };
        body.querySelector('#btn-add-compo').onclick = async () => {
          const picked = await window.openCompoPicker();
          if (picked) {
            workingLignes.push({
              compositionId: picked.id,
              designation: picked.nom,
              unite: picked.unite || '',
              quantite: 1,
              prixUnitaire: picked.total
            });
            renderLignes();
          }
        };

        // Versions : changer de version pour la consulter
        $$('.version-chip', body).forEach(chip => {
          chip.onclick = () => {
            const num = parseInt(chip.dataset.version, 10);
            const v = quote.versions.find(vv => vv.numero === num);
            if (v && v.snapshot) {
              workingLignes = JSON.parse(JSON.stringify(v.snapshot.lignes || []));
              viewingVersion = num;
              $$('.version-chip', body).forEach(c => c.classList.remove('active'));
              chip.classList.add('active');
              renderLignes();
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

        // Footer actions
        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);

        const saveMetaBtn = footer.querySelector('[data-action="save-meta"]');
        if (saveMetaBtn) saveMetaBtn.onclick = async () => {
          const payload = {
            id: quote.id,
            code: body.querySelector('#q-code').value.trim(),
            titre: body.querySelector('#q-titre').value.trim(),
            clientNom: body.querySelector('#q-client').value.trim(),
            clientEmail: body.querySelector('#q-email').value.trim(),
            statut: body.querySelector('#q-statut').value
          };
          if (!payload.titre) return toast('Titre requis', 'danger');
          const r = await window.api.etude.quotes.updateMeta(payload);
          if (r.ok) { toast('Métadonnées sauvegardées', 'success'); refresh(); }
          else toast('Erreur : ' + r.error, 'danger');
        };

        const newVerBtn = footer.querySelector('[data-action="new-version"]');
        if (newVerBtn) newVerBtn.onclick = async () => {
          if (!await confirmModal('Créer une nouvelle version ?', `Une nouvelle version sera créée avec les modifications actuelles. La version précédente reste consultable.`)) return;
          const r = await window.api.etude.quotes.addVersion({ id: quote.id, lignes: workingLignes });
          if (r.ok) {
            toast('Version v' + r.numero + ' créée', 'success');
            close(true);
            refresh();
          } else toast('Erreur : ' + r.error, 'danger');
        };

        const createBtn = footer.querySelector('[data-action="create"]');
        if (createBtn) createBtn.onclick = async () => {
          const payload = {
            code: body.querySelector('#q-code').value.trim(),
            titre: body.querySelector('#q-titre').value.trim(),
            clientNom: body.querySelector('#q-client').value.trim(),
            clientEmail: body.querySelector('#q-email').value.trim(),
            lignes: workingLignes
          };
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

  window.EtudeQuotesPage = {
    async render(container) {
      containerEl = container;
      containerEl.innerHTML = '<div class="loader">Chargement…</div>';
      await refresh();
    }
  };
})();
