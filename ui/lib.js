// ui/lib.js — Utilitaires partagés pour les modules UI

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatEUR(n) {
  const num = parseFloat(n) || 0;
  return num.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function formatNum(n, dec = 2) {
  const num = parseFloat(n) || 0;
  return num.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('fr-FR') + ' ' + new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Notification toast
let toastTimer = null;
function toast(msg, type = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.className = 'toast ' + type;
  el.textContent = msg;
  el.classList.add('visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3500);
}

// Modale générique
function modal({ title, content, onMount, footer, large = false, onClose }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card ${large ? 'large' : ''}">
        <div class="modal-header">
          <h2>${escapeHtml(title || '')}</h2>
          <button class="modal-close" type="button">×</button>
        </div>
        <div class="modal-body"></div>
        <div class="modal-footer"></div>
      </div>
    `;
    const body = overlay.querySelector('.modal-body');
    const footerEl = overlay.querySelector('.modal-footer');
    if (typeof content === 'string') body.innerHTML = content;
    else if (content instanceof HTMLElement) body.appendChild(content);
    if (footer) footerEl.innerHTML = footer;
    document.body.appendChild(overlay);
    const close = (val) => {
      try { document.body.removeChild(overlay); } catch (_) {}
      if (onClose) onClose();
      resolve(val);
    };
    overlay.querySelector('.modal-close').onclick = () => close(null);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    if (onMount) onMount({ body, footer: footerEl, close });
  });
}

function confirmModal(title, msg) {
  return modal({
    title,
    content: `<p style="margin-top:8px">${escapeHtml(msg)}</p>`,
    footer: `
      <button class="btn ghost" data-action="cancel">Annuler</button>
      <button class="btn primary" data-action="ok">Confirmer</button>
    `,
    onMount: ({ footer, close }) => {
      footer.querySelector('[data-action="cancel"]').onclick = () => close(false);
      footer.querySelector('[data-action="ok"]').onclick = () => close(true);
    }
  });
}

// Expose dans window pour usage par les autres modules UI
window.UI = { $, $$, escapeHtml, formatEUR, formatNum, formatDate, toast, modal, confirmModal };
