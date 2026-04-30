// ui/artisan-received.js — Devis reçus chiffrés (.ndev) côté Artisan
(function () {
  const { $, $$, escapeHtml, formatEUR, formatNum, formatDate, toast, modal, confirmModal } = window.UI;

  let containerEl = null;
  let received = [];

  async function refresh() {
    const r = await window.api.ndev.receivedList();
    if (r.ok) received = r.data;
    render();
  }

  function statutBadge(s) {
    const map = {
      nouveau: '<span class="badge" style="background:rgba(91,141,239,0.2);color:#5b8def">🆕 Nouveau</span>',
      lu: '<span class="badge" style="background:rgba(160,160,160,0.2);color:var(--text-muted)">👁 Lu</span>',
      accepte: '<span class="badge" style="background:rgba(0,180,100,0.2);color:var(--success)">✅ Accepté</span>',
      refuse: '<span class="badge" style="background:rgba(225,90,90,0.2);color:var(--danger)">❌ Refusé</span>'
    };
    return map[s] || s;
  }

  function getVersions(payload) {
    return (payload && payload.versions) || [];
  }

  function getLignes(version) {
    return (version && version.snapshot && version.snapshot.lignes) || [];
  }

  // Badge "vN" indiquant la dernière version reçue.
  function versionBadge(payload) {
    const versions = getVersions(payload);
    if (!versions.length) return '';
    const last = versions[versions.length - 1];
    const n = last && last.numero ? last.numero : versions.length;
    return `<span class="badge" style="background:rgba(91,141,239,0.15);color:#5b8def;margin-left:6px">v${n}</span>`;
  }

  // Clé stable d'une ligne, partagée avec diffVersions et les annotations.
  function lineKey(l) {
    return l.priceId ? 'p:' + l.priceId
         : l.compositionId ? 'c:' + l.compositionId
         : 'l:' + (l.designation || '').toLowerCase();
  }

  // Diff entre 2 versions (même logique que etude.diffVersions côté BE).
  function diffVersions(vA, vB) {
    const linesA = getLignes(vA);
    const linesB = getLignes(vB);
    const mapA = {}; linesA.forEach(l => mapA[lineKey(l)] = l);
    const mapB = {}; linesB.forEach(l => mapB[lineKey(l)] = l);
    const added = [], removed = [], modified = [];
    Object.keys(mapB).forEach(k => {
      if (!mapA[k]) added.push(mapB[k]);
      else {
        const a = mapA[k], b = mapB[k];
        if (a.quantite !== b.quantite || a.prixUnitaire !== b.prixUnitaire || a.designation !== b.designation) {
          modified.push({ before: a, after: b });
        }
      }
    });
    Object.keys(mapA).forEach(k => { if (!mapB[k]) removed.push(mapA[k]); });
    return { added, removed, modified };
  }

  // Brouillon de réponse vide (utilisé si pas encore de response_data en DB).
  function emptyDraft() {
    return {
      version_target: null,
      remarques_lignes: {},
      lignes_ajoutees: [],
      remarque_globale: '',
      attachments: []
    };
  }

  // Total cumulé des PJ (octets bruts).
  function attachmentsTotalBytes(atts) {
    return (atts || []).reduce((s, a) => s + (parseInt(a.size, 10) || 0), 0);
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' o';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' Ko';
    return (n / 1024 / 1024).toFixed(1) + ' Mo';
  }

  // Lit un File en base64 (sans le préfixe data:).
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const url = e.target.result || '';
        const i = url.indexOf(',');
        resolve(i >= 0 ? url.slice(i + 1) : url);
      };
      reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
      reader.readAsDataURL(file);
    });
  }

  // Télécharge un fichier généré (utilise un blob URL temporaire).
  function downloadFile(name, content, mime) {
    const blob = new Blob([content], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function render() {
    if (!containerEl) return;
    const rows = received.length ? received.map(r => `
      <tr data-id="${r.id}">
        <td class="small">${formatDate(r.received_at).split(' ')[0]}</td>
        <td>${escapeHtml(r.subject || '—')}${versionBadge(r.payload)}</td>
        <td class="small">${escapeHtml(r.sender_label || '—')}</td>
        <td class="center">${statutBadge(r.statut)}</td>
        <td class="center actions">
          <button class="btn-icon" data-action="view" title="Consulter">👁</button>
          <button class="btn-icon danger" data-action="delete" title="Supprimer">🗑</button>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="5" class="empty">Aucun devis reçu. Importe un fichier .ndev avec le bouton ci-dessus.</td></tr>';

    containerEl.innerHTML = `
      <div class="page-header">
        <h1>📥 Devis reçus</h1>
        <div class="page-actions">
          <button class="btn primary" id="btn-import">📥 Importer un .ndev</button>
        </div>
      </div>
      <p class="muted small">Devis chiffrés envoyés par des Bureaux d'Études. Pour qu'un BE puisse t'envoyer un devis, il doit avoir ta clé publique (visible dans <strong>🔐 Compte & sécurité → Mon identité</strong>). Si le BE renvoie une nouvelle version d'un devis déjà reçu, elle remplace la précédente — l'historique des versions reste consultable.</p>

      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th style="width:90px">Reçu le</th>
            <th>Sujet</th>
            <th>De</th>
            <th class="center" style="width:100px">Statut</th>
            <th class="center" style="width:90px">Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    $('#btn-import').onclick = openImportModal;
    $$('[data-action="view"]').forEach(btn => {
      btn.onclick = () => {
        const id = parseInt(btn.closest('tr').dataset.id, 10);
        openViewModal(id);
      };
    });
    $$('[data-action="delete"]').forEach(btn => {
      btn.onclick = async () => {
        const id = parseInt(btn.closest('tr').dataset.id, 10);
        const r = received.find(x => x.id === id);
        if (await confirmModal('Supprimer ce devis reçu ?', r.subject || '')) {
          const res = await window.api.ndev.receivedDelete({ id });
          if (res.ok) { toast('Supprimé', 'success'); refresh(); }
        }
      };
    });
  }

  function openImportModal() {
    return modal({
      title: '📥 Importer un fichier .ndev',
      content: `
        <p class="muted small">Glisse-dépose le fichier .ndev reçu de ton BE, ou clique pour choisir.</p>
        <div id="drop-zone" style="border:2px dashed var(--border);padding:40px;text-align:center;border-radius:8px;cursor:pointer;background:var(--bg-2)">
          <div style="font-size:48px">🔐</div>
          <p>Glisse ton fichier .ndev ici<br><span class="muted small">ou clique pour parcourir</span></p>
          <input type="file" id="ndev-file" accept=".ndev,.json,application/json" style="display:none">
        </div>
        <div id="ndev-status" style="margin-top:12px"></div>
      `,
      footer: `<button class="btn ghost" data-action="close">Fermer</button>`,
      onMount: ({ body, footer, close }) => {
        const dz = body.querySelector('#drop-zone');
        const fi = body.querySelector('#ndev-file');
        const status = body.querySelector('#ndev-status');

        const importFile = async (file) => {
          const txt = await file.text();
          const r = await window.api.ndev.import({ content: txt });
          if (!r.ok) {
            status.innerHTML = `<div class="status-box err">❌ ${escapeHtml(r.error)}</div>`;
            return;
          }
          const updatedMsg = r.data.updated
            ? ' <em>(nouvelle version d\'un devis déjà reçu — l\'entrée existante a été mise à jour)</em>'
            : '';
          status.innerHTML = `<div class="status-box ok">✅ Devis importé : <strong>${escapeHtml(r.data.subject)}</strong> de <strong>${escapeHtml(r.data.from || '—')}</strong>${updatedMsg}</div>`;
          toast(r.data.updated ? 'Nouvelle version importée' : 'Devis reçu importé', 'success');
          refresh();
        };

        dz.onclick = () => fi.click();
        fi.onchange = (e) => { if (e.target.files[0]) importFile(e.target.files[0]); };
        dz.ondragover = (e) => { e.preventDefault(); dz.style.borderColor = 'var(--primary)'; };
        dz.ondragleave = () => { dz.style.borderColor = 'var(--border)'; };
        dz.ondrop = (e) => {
          e.preventDefault(); dz.style.borderColor = 'var(--border)';
          if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]);
        };
        footer.querySelector('[data-action="close"]').onclick = () => close(true);
      }
    });
  }

  // Construit le bloc « détail des prix + totaux + comparaison » pour une version donnée.
  // Si `draft` est fourni, ajoute une zone d'annotation par ligne (alimentée par draft.remarques_lignes).
  function renderVersionDetail(payload, viewIdx, compareIdx, draft) {
    const versions = getVersions(payload);
    const v = versions[viewIdx];
    const lignes = getLignes(v);
    const remarques = (draft && draft.remarques_lignes) || {};

    const linesHtml = lignes.length ? `
      <table class="data-table">
        <thead><tr>
          <th>Désignation</th>
          <th class="right" style="width:60px">Qté</th>
          <th class="right" style="width:80px">Unité</th>
          <th class="right" style="width:90px">P.U. HT</th>
          <th class="right" style="width:100px">Total HT</th>
          ${draft ? '<th style="width:200px">📝 Remarque (artisan)</th>' : ''}
        </tr></thead>
        <tbody>${lignes.map(l => {
          const k = lineKey(l);
          const remVal = escapeHtml(remarques[k] || '');
          return `
          <tr>
            <td>${escapeHtml(l.designation || '—')}</td>
            <td class="right">${formatNum(l.quantite || 0, 2)}</td>
            <td class="right small">${escapeHtml(l.unite || '')}</td>
            <td class="right">${formatEUR(l.prixUnitaire || 0)}</td>
            <td class="right"><strong>${formatEUR((l.quantite || 0) * (l.prixUnitaire || 0))}</strong></td>
            ${draft ? `<td><textarea class="line-remark" data-line-key="${escapeHtml(k)}" rows="1" placeholder="Remarque sur cette ligne…" style="width:100%;min-height:28px;font-size:12px">${remVal}</textarea></td>` : ''}
          </tr>`;
        }).join('')}</tbody>
      </table>
    ` : '<p class="muted">Aucune ligne dans cette version</p>';

    const totalHT = lignes.reduce((s, l) => s + (parseFloat(l.quantite) || 0) * (parseFloat(l.prixUnitaire) || 0), 0);
    const totalTVA = totalHT * (parseFloat(payload.tva_pct) || 0) / 100;

    let diffHtml = '';
    if (compareIdx >= 0 && compareIdx !== viewIdx) {
      const vA = versions[compareIdx];
      const vB = versions[viewIdx];
      const d = diffVersions(vA, vB);
      const totA = getLignes(vA).reduce((s, l) => s + (parseFloat(l.quantite) || 0) * (parseFloat(l.prixUnitaire) || 0), 0);
      const delta = totalHT - totA;
      const deltaCls = delta > 0 ? 'err' : delta < 0 ? 'ok' : '';
      const sign = delta > 0 ? '+' : '';
      diffHtml = `
        <h3 style="margin-top:14px">Comparaison v${vA.numero} → v${vB.numero}</h3>
        <div class="status-box ${deltaCls}">
          <strong>Évolution du total HT :</strong> ${formatEUR(totA)} → ${formatEUR(totalHT)}
          (<strong>${sign}${formatEUR(delta)}</strong>)
        </div>
        ${d.added.length ? `<p class="small" style="color:var(--success);margin-top:8px"><strong>➕ ${d.added.length} ligne(s) ajoutée(s)</strong></p>
          <ul class="small">${d.added.map(l => `<li>${escapeHtml(l.designation || '—')} — ${formatNum(l.quantite || 0)} × ${formatEUR(l.prixUnitaire || 0)} = ${formatEUR((l.quantite || 0) * (l.prixUnitaire || 0))}</li>`).join('')}</ul>` : ''}
        ${d.removed.length ? `<p class="small" style="color:var(--danger);margin-top:8px"><strong>➖ ${d.removed.length} ligne(s) supprimée(s)</strong></p>
          <ul class="small">${d.removed.map(l => `<li>${escapeHtml(l.designation || '—')} — ${formatNum(l.quantite || 0)} × ${formatEUR(l.prixUnitaire || 0)}</li>`).join('')}</ul>` : ''}
        ${d.modified.length ? `<p class="small" style="color:#d49b3a;margin-top:8px"><strong>✏ ${d.modified.length} ligne(s) modifiée(s)</strong></p>
          <ul class="small">${d.modified.map(m => `<li>${escapeHtml(m.after.designation || '—')} : <s>${formatNum(m.before.quantite)} × ${formatEUR(m.before.prixUnitaire)}</s> → ${formatNum(m.after.quantite)} × ${formatEUR(m.after.prixUnitaire)}</li>`).join('')}</ul>` : ''}
        ${!d.added.length && !d.removed.length && !d.modified.length ? '<p class="muted small">Aucune différence sur les lignes — seules les métadonnées peuvent avoir changé.</p>' : ''}
      `;
    }

    return `
      <h3 style="margin-top:14px">Détail des prix — v${v ? v.numero : '?'} (lecture seule)</h3>
      ${linesHtml}

      <div class="kpv-result-block" style="margin-top:14px">
        <span>Total HT</span>
        <span>${formatEUR(totalHT)}</span>
        <span>TVA ${formatNum(payload.tva_pct || 0, 2)}%</span>
        <span>${formatEUR(totalTVA)}</span>
        <span>Total TTC</span>
        <strong class="kpv-coef">${formatEUR(totalHT + totalTVA)}</strong>
      </div>

      ${diffHtml}
    `;
  }

  // Rend la section « Réponse au BE » : lignes ajoutées + remarque globale + PJ.
  // L'état est dans `draft` ; les inputs mettent à jour draft on-blur via openViewModal.
  function renderResponseSection(draft, maxBytes) {
    const linesHtml = (draft.lignes_ajoutees || []).map((l, i) => `
      <tr data-add-idx="${i}">
        <td><input class="add-desig" data-i="${i}" value="${escapeHtml(l.designation || '')}" placeholder="Prestation à chiffrer"></td>
        <td><input class="add-qte"   data-i="${i}" type="number" step="0.01" value="${l.quantite != null ? l.quantite : 0}" class="right"></td>
        <td><input class="add-unite" data-i="${i}" value="${escapeHtml(l.unite || '')}" placeholder="u, ml, m², h…"></td>
        <td><input class="add-prix"  data-i="${i}" type="number" step="0.01" value="${l.prix_propose != null ? l.prix_propose : ''}" placeholder="vide = à chiffrer par le BE" class="right"></td>
        <td><input class="add-rem"   data-i="${i}" value="${escapeHtml(l.remarque || '')}" placeholder="Précision (optionnel)"></td>
        <td class="center"><button class="btn-icon danger" data-action="add-remove" data-i="${i}" title="Supprimer">🗑</button></td>
      </tr>
    `).join('');

    const totalBytes = attachmentsTotalBytes(draft.attachments);
    const overBudget = totalBytes > maxBytes;
    const attHtml = (draft.attachments || []).map((a, i) => `
      <li>
        📎 <strong>${escapeHtml(a.name || 'fichier')}</strong>
        <span class="muted small">— ${formatBytes(a.size || 0)}${a.mime ? ' · ' + escapeHtml(a.mime) : ''}</span>
        <button class="btn-icon danger" data-action="att-remove" data-i="${i}" title="Retirer">🗑</button>
      </li>
    `).join('');

    return `
      <h3 style="margin-top:18px">📤 Ma réponse au BE</h3>
      <p class="muted small">Tu peux annoter les lignes du devis (au-dessus), ajouter des prestations manquantes, écrire une remarque générale et joindre des documents. Ta réponse sera chiffrée et exportable en .ndev-reply à renvoyer au BE.</p>

      <h4 style="margin-top:14px">➕ Lignes à ajouter (manquantes au devis)</h4>
      <p class="muted small">Laisse le prix vide si tu veux que le BE chiffre la ligne ; renseigne-le pour faire une contre-proposition.</p>
      <table class="data-table">
        <thead><tr>
          <th>Désignation</th>
          <th class="right" style="width:80px">Qté</th>
          <th style="width:80px">Unité</th>
          <th class="right" style="width:110px">Prix proposé</th>
          <th>Remarque</th>
          <th class="center" style="width:50px"></th>
        </tr></thead>
        <tbody id="add-lines-body">${linesHtml || '<tr><td colspan="6" class="muted center small">Aucune ligne ajoutée — clique sur « ➕ Ajouter une ligne »</td></tr>'}</tbody>
      </table>
      <button class="btn ghost" id="btn-add-line" style="margin-top:6px">➕ Ajouter une ligne</button>

      <h4 style="margin-top:14px">💬 Remarque globale sur l'étude de prix</h4>
      <textarea id="rem-globale" rows="3" class="full" placeholder="Délais, contraintes chantier, suggestions globales…">${escapeHtml(draft.remarque_globale || '')}</textarea>

      <h4 style="margin-top:14px">📎 Pièces jointes <span class="muted small">(${formatBytes(totalBytes)} / ${formatBytes(maxBytes)} max)</span></h4>
      <div id="att-drop" style="border:2px dashed var(--border);padding:18px;text-align:center;border-radius:8px;cursor:pointer;background:var(--bg-2)">
        <p class="muted small" style="margin:0">Glisse-dépose des fichiers (plans, photos, fiches techniques) ou clique pour choisir.</p>
        <input type="file" id="att-input" multiple style="display:none">
      </div>
      ${overBudget ? '<div class="status-box err" style="margin-top:8px">⚠ Limite de taille dépassée — retire des PJ avant d\'exporter.</div>' : ''}
      <ul id="att-list" style="list-style:none;padding:0;margin-top:8px">${attHtml}</ul>
    `;
  }

  async function openViewModal(id) {
    const r = await window.api.ndev.receivedGet({ id });
    if (!r.ok) return toast(r.error, 'danger');
    const rq = r.data;
    const p = rq.payload || {};
    const versions = getVersions(p);

    let viewIdx = versions.length ? versions.length - 1 : -1;
    let compareIdx = -1;

    // Brouillon de réponse (annotations + lignes ajoutées + PJ + remarque globale).
    const draft = Object.assign(emptyDraft(), rq.response_data || {});
    if (draft.version_target == null && versions.length) draft.version_target = versions[versions.length - 1].numero;

    const MAX_BYTES = 20 * 1024 * 1024;

    const versionOptions = versions.map((v, i) =>
      `<option value="${i}">v${v.numero} — ${formatDate(v.created_at).split(' ')[0]}</option>`
    ).join('');

    return modal({
      title: '📄 ' + (rq.subject || 'Devis reçu'),
      large: true,
      content: `
        <div class="status-box ok" style="text-align:left">
          <strong>Émis par :</strong> ${escapeHtml(rq.sender_label || '—')}<br>
          <strong>Reçu le :</strong> ${formatDate(rq.received_at)}<br>
          <strong>Versions reçues :</strong> ${versions.length}
        </div>
        <h3 style="margin-top:18px">Détails du devis</h3>
        <div class="form-grid">
          <label>Code<input value="${escapeHtml(p.code || '—')}" readonly></label>
          <label>Date d'émission<input value="${p.date_emission ? formatDate(p.date_emission).split(' ')[0] : '—'}" readonly></label>
          <label class="full">Titre<input value="${escapeHtml(p.titre || '—')}" readonly></label>
          <label>Client<input value="${escapeHtml(p.client_nom || '—')}" readonly></label>
          <label>TVA<input value="${formatNum(p.tva_pct || 0, 2)} %" readonly></label>
        </div>

        ${versions.length > 1 ? `
        <div class="form-grid" style="margin-top:14px">
          <label>Version affichée
            <select id="ver-view">${versionOptions.replace(`value="${viewIdx}"`, `value="${viewIdx}" selected`)}</select>
          </label>
          <label>Comparer avec
            <select id="ver-compare">
              <option value="-1">— Aucune comparaison —</option>
              ${versionOptions}
            </select>
          </label>
        </div>` : ''}

        <div id="version-detail">${renderVersionDetail(p, viewIdx, compareIdx, draft)}</div>

        ${p.notes ? `<h3 style="margin-top:14px">Notes du BE</h3><div class="status-box warn">${escapeHtml(p.notes)}</div>` : ''}

        <div id="response-section">${renderResponseSection(draft, MAX_BYTES)}</div>

        <h3 style="margin-top:14px">Statut & notes internes</h3>
        <label>Statut
          <select id="rq-statut">
            <option value="lu" ${rq.statut === 'lu' ? 'selected' : ''}>👁 Lu (en cours d'examen)</option>
            <option value="accepte" ${rq.statut === 'accepte' ? 'selected' : ''}>✅ Accepté</option>
            <option value="refuse" ${rq.statut === 'refuse' ? 'selected' : ''}>❌ Refusé</option>
          </select>
        </label>
        <label class="full" style="margin-top:8px">Notes internes (visibles à toi seul)
          <textarea id="rq-notes" rows="2">${escapeHtml(rq.notes || '')}</textarea>
        </label>
      `,
      footer: `
        <button class="btn ghost" data-action="close">Fermer</button>
        <button class="btn" data-action="save-statut">💾 Enregistrer statut</button>
        <button class="btn" data-action="save-draft">📝 Enregistrer mes annotations</button>
        <button class="btn primary" data-action="export-reply">📤 Exporter ma réponse (.ndev-reply)</button>
      `,
      onMount: ({ body, footer, close }) => {
        const detailEl = body.querySelector('#version-detail');
        const respEl = body.querySelector('#response-section');
        const verSel = body.querySelector('#ver-view');
        const cmpSel = body.querySelector('#ver-compare');

        // Capture les remarques par ligne (DOM event delegation : se rebind après chaque refresh).
        const bindLineRemarks = () => {
          detailEl.querySelectorAll('textarea.line-remark').forEach(t => {
            t.onchange = (e) => {
              const k = e.target.dataset.lineKey;
              const v = e.target.value || '';
              if (v) draft.remarques_lignes[k] = v;
              else delete draft.remarques_lignes[k];
            };
          });
        };

        const refreshDetail = () => {
          detailEl.innerHTML = renderVersionDetail(p, viewIdx, compareIdx, draft);
          bindLineRemarks();
        };
        const refreshResponse = () => {
          respEl.innerHTML = renderResponseSection(draft, MAX_BYTES);
          bindResponseHandlers();
        };

        if (verSel) verSel.onchange = (e) => {
          viewIdx = parseInt(e.target.value, 10);
          if (versions[viewIdx]) draft.version_target = versions[viewIdx].numero;
          refreshDetail();
        };
        if (cmpSel) cmpSel.onchange = (e) => { compareIdx = parseInt(e.target.value, 10); refreshDetail(); };

        // Câblage des handlers de la section « Réponse au BE » (à rebind après chaque refresh).
        const bindResponseHandlers = () => {
          const onAddInputChange = (e) => {
            const i = parseInt(e.target.dataset.i, 10);
            if (!draft.lignes_ajoutees[i]) return;
            const cls = e.target.className;
            if (cls.includes('add-desig')) draft.lignes_ajoutees[i].designation = e.target.value;
            else if (cls.includes('add-qte')) draft.lignes_ajoutees[i].quantite = parseFloat(e.target.value) || 0;
            else if (cls.includes('add-unite')) draft.lignes_ajoutees[i].unite = e.target.value;
            else if (cls.includes('add-prix')) {
              const v = e.target.value;
              draft.lignes_ajoutees[i].prix_propose = v === '' ? null : (parseFloat(v) || 0);
            }
            else if (cls.includes('add-rem')) draft.lignes_ajoutees[i].remarque = e.target.value;
          };
          respEl.querySelectorAll('.add-desig, .add-qte, .add-unite, .add-prix, .add-rem').forEach(el => {
            el.onchange = onAddInputChange;
          });
          respEl.querySelectorAll('[data-action="add-remove"]').forEach(btn => {
            btn.onclick = () => {
              const i = parseInt(btn.dataset.i, 10);
              draft.lignes_ajoutees.splice(i, 1);
              refreshResponse();
            };
          });
          const btnAdd = respEl.querySelector('#btn-add-line');
          if (btnAdd) btnAdd.onclick = () => {
            draft.lignes_ajoutees.push({ designation: '', quantite: 1, unite: '', prix_propose: null, remarque: '' });
            refreshResponse();
          };
          const remGlob = respEl.querySelector('#rem-globale');
          if (remGlob) remGlob.onchange = (e) => { draft.remarque_globale = e.target.value; };

          const dropZone = respEl.querySelector('#att-drop');
          const fileInput = respEl.querySelector('#att-input');
          const handleFiles = async (fileList) => {
            const arr = Array.from(fileList || []);
            for (const f of arr) {
              if (attachmentsTotalBytes(draft.attachments) + (f.size || 0) > MAX_BYTES) {
                toast(`Limite ${formatBytes(MAX_BYTES)} dépassée — "${f.name}" ignoré`, 'danger');
                continue;
              }
              try {
                const data_b64 = await fileToBase64(f);
                draft.attachments.push({ name: f.name, size: f.size, mime: f.type || '', data_b64 });
              } catch (e) { toast('Lecture impossible : ' + e.message, 'danger'); }
            }
            refreshResponse();
          };
          if (dropZone) {
            dropZone.onclick = () => fileInput.click();
            dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--primary)'; };
            dropZone.ondragleave = () => { dropZone.style.borderColor = 'var(--border)'; };
            dropZone.ondrop = (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--border)'; handleFiles(e.dataTransfer.files); };
          }
          if (fileInput) fileInput.onchange = (e) => handleFiles(e.target.files);
          respEl.querySelectorAll('[data-action="att-remove"]').forEach(btn => {
            btn.onclick = () => {
              const i = parseInt(btn.dataset.i, 10);
              draft.attachments.splice(i, 1);
              refreshResponse();
            };
          });
        };

        bindLineRemarks();
        bindResponseHandlers();

        footer.querySelector('[data-action="close"]').onclick = () => close(true);

        footer.querySelector('[data-action="save-statut"]').onclick = async () => {
          const r = await window.api.ndev.receivedSetStatut({
            id: rq.id,
            statut: body.querySelector('#rq-statut').value,
            notes: body.querySelector('#rq-notes').value
          });
          if (r.ok) { toast('Statut enregistré', 'success'); refresh(); }
          else toast(r.error, 'danger');
        };

        footer.querySelector('[data-action="save-draft"]').onclick = async () => {
          const r = await window.api.quoteResponse.saveDraft({ receivedId: rq.id, data: draft });
          if (r.ok) toast('Annotations enregistrées', 'success');
          else toast(r.error || 'Échec sauvegarde', 'danger');
        };

        footer.querySelector('[data-action="export-reply"]').onclick = async () => {
          const sv = await window.api.quoteResponse.saveDraft({ receivedId: rq.id, data: draft });
          if (!sv.ok) return toast(sv.error || 'Échec sauvegarde', 'danger');
          const r = await window.api.quoteResponse.export({ receivedId: rq.id });
          if (!r.ok) return toast(r.error || 'Échec export', 'danger');
          downloadFile(r.file_name, r.content, 'application/json');
          toast('Réponse exportée — envoie le .ndev-reply au BE', 'success');
        };
      }
    });
  }

  window.ArtisanReceivedPage = {
    async render(container) {
      containerEl = container;
      containerEl.innerHTML = '<div class="loader">Chargement…</div>';
      await refresh();
    }
  };
})();
