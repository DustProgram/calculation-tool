// ui/contacts.js — Carnet d'adresses des artisans destinataires (côté BE/Étude)
(function () {
  const { $, $$, escapeHtml, formatDate, toast, modal, confirmModal } = window.UI;

  let containerEl = null;
  let contacts = [];

  async function refresh() {
    const r = await window.api.contacts.list();
    if (r.ok) contacts = r.data;
    render();
  }

  function render() {
    if (!containerEl) return;
    const rows = contacts.length ? contacts.map(c => `
      <tr data-id="${c.id}">
        <td><strong>${escapeHtml(c.label)}</strong>${c.metier ? '<br><span class="muted small">' + escapeHtml(c.metier) + '</span>' : ''}</td>
        <td class="small">${escapeHtml(c.email || '—')}<br>${escapeHtml(c.telephone || '')}</td>
        <td class="small" style="font-family:monospace">${escapeHtml((c.pub_key || '').substring(0, 16))}…</td>
        <td class="center"><span class="badge badge-info">✅ Active</span></td>
        <td class="center actions">
          <button class="btn-icon" data-action="edit">✏️</button>
          <button class="btn-icon danger" data-action="delete">🗑</button>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="5" class="empty">Aucun artisan dans le carnet. Ajoute-en pour pouvoir leur envoyer des devis chiffrés.</td></tr>';

    containerEl.innerHTML = `
      <div class="page-header">
        <h1>👥 Carnet artisans</h1>
        <div class="page-actions">
          <button class="btn primary" id="btn-add">+ Ajouter un artisan</button>
        </div>
      </div>
      <p class="muted small">Liste des artisans à qui tu peux envoyer des devis chiffrés .ndev. Pour ajouter un artisan, demande-lui sa clé publique (visible dans <strong>🔐 Compte & sécurité → Mon identité</strong> côté artisan).</p>

      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Nom / Métier</th>
            <th>Contact</th>
            <th>Clé publique</th>
            <th class="center" style="width:90px">Statut</th>
            <th class="center" style="width:90px">Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    $('#btn-add').onclick = () => openContactModal(null);
    $$('[data-action="edit"]').forEach(btn => {
      btn.onclick = () => {
        const id = parseInt(btn.closest('tr').dataset.id, 10);
        openContactModal(contacts.find(c => c.id === id));
      };
    });
    $$('[data-action="delete"]').forEach(btn => {
      btn.onclick = async () => {
        const id = parseInt(btn.closest('tr').dataset.id, 10);
        const c = contacts.find(x => x.id === id);
        if (await confirmModal('Supprimer cet artisan ?', `« ${c.label} »`)) {
          const r = await window.api.contacts.delete({ id });
          if (r.ok) { toast('Supprimé', 'success'); refresh(); }
        }
      };
    });
  }

  function openContactModal(contact) {
    const isEdit = !!contact;
    return modal({
      title: isEdit ? 'Modifier l\'artisan' : 'Ajouter un artisan',
      large: true,
      content: `
        <div class="form-grid">
          <label class="full">Nom / Raison sociale *
            <input id="c-label" value="${escapeHtml(contact && contact.label || '')}" placeholder="ex: Jean Dupont — SARL Plomberie Express">
          </label>
          <label>Métier
            <input id="c-metier" value="${escapeHtml(contact && contact.metier || '')}" placeholder="ex: Plomberie, Électricité, Maçonnerie">
          </label>
          <label>Email
            <input id="c-email" type="email" value="${escapeHtml(contact && contact.email || '')}">
          </label>
          <label>Téléphone
            <input id="c-tel" value="${escapeHtml(contact && contact.telephone || '')}">
          </label>
          <label>&nbsp;</label>
          <label class="full">Clé publique X25519 *
            <textarea id="c-pub" rows="3" placeholder="nestm:MCowBQYDK2Vu..." style="font-family:monospace;font-size:11px">${escapeHtml(contact && contact.pub_key ? 'nestm:' + contact.pub_key.replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '') : '')}</textarea>
            <small class="muted">L'artisan trouve sa clé dans 🔐 Compte & sécurité → Mon identité</small>
          </label>
          <label class="full">Notes (optionnel)
            <textarea id="c-notes" rows="2">${escapeHtml(contact && contact.notes || '')}</textarea>
          </label>
        </div>
      `,
      footer: `
        <button class="btn ghost" data-action="cancel">Annuler</button>
        <button class="btn primary" data-action="save">${isEdit ? 'Enregistrer' : 'Ajouter'}</button>
      `,
      onMount: ({ body, footer, close }) => {
        body.querySelector('#c-label').focus();
        footer.querySelector('[data-action="cancel"]').onclick = () => close(null);
        footer.querySelector('[data-action="save"]').onclick = async () => {
          const payload = {
            label: body.querySelector('#c-label').value.trim(),
            metier: body.querySelector('#c-metier').value.trim(),
            email: body.querySelector('#c-email').value.trim(),
            telephone: body.querySelector('#c-tel').value.trim(),
            pub_key: body.querySelector('#c-pub').value.trim(),
            notes: body.querySelector('#c-notes').value.trim()
          };
          if (!payload.label) return toast('Nom requis', 'danger');
          if (!payload.pub_key) return toast('Clé publique requise', 'danger');
          const r = isEdit
            ? await window.api.contacts.update({ id: contact.id, ...payload })
            : await window.api.contacts.create(payload);
          if (r.ok) { toast(isEdit ? 'Modifié' : 'Ajouté', 'success'); close(true); refresh(); }
          else toast('Erreur : ' + r.error, 'danger');
        };
      }
    });
  }

  window.ContactsPage = {
    async render(container) {
      containerEl = container;
      containerEl.innerHTML = '<div class="loader">Chargement…</div>';
      await refresh();
    }
  };
})();
