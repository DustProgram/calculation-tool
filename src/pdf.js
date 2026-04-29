// src/pdf.js — Génération PDF via le moteur Chromium d'Electron (printToPDF).
//
// Pourquoi cette approche :
//   - Aucune dépendance npm tierce (pdfmake était fragile, deps cassées sur Win)
//   - On dispose d'un vrai moteur de rendu HTML/CSS pour un PDF stylé
//   - Identique au rendu d'aperçu écran : on peut fignoler le visuel facilement
//
// Flux : on construit un HTML complet → on l'écrit dans un fichier temp →
// on charge ce fichier dans une BrowserWindow cachée → printToPDF → close.

const { BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtEUR(n) {
  const v = parseFloat(n) || 0;
  return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function fmtNum(n, dec = 2) {
  const v = parseFloat(n) || 0;
  return v.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Construit l'HTML complet du devis
function buildQuoteHtml(quote, version, lignes, totals) {
  const dateStr = new Date().toLocaleDateString('fr-FR');
  const showFraisLine = totals.kpv_mode === 'fin' && totals.kpv_pct > 0;

  const lignesHtml = lignes.map((l, i) => {
    const q = parseFloat(l.quantite) || 0;
    const pu = parseFloat(l.prixUnitaire) || 0;
    const tot = q * pu;
    return `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(l.designation || '')}</td>
        <td class="center">${escapeHtml(l.unite || '')}</td>
        <td class="right">${fmtNum(q)}</td>
        <td class="right">${fmtEUR(pu)}</td>
        <td class="right">${fmtEUR(tot)}</td>
      </tr>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Devis ${escapeHtml(quote.code || quote.id)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm 16mm 14mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
    font-size: 10.5pt;
    color: #1a1a24;
    background: white;
  }
  header {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding-bottom: 14px; margin-bottom: 18px;
    border-bottom: 2px solid #1a1a24;
  }
  .brand { font-size: 22pt; font-weight: 700; letter-spacing: -0.5px; }
  .brand-sub { font-size: 9pt; color: #666; margin-top: 2px; }
  .meta { text-align: right; font-size: 9.5pt; }
  .meta .ref { font-weight: 600; font-size: 11pt; }
  .meta .date { color: #555; }
  h1 {
    font-size: 16pt; margin: 0 0 4px 0; text-align: center;
    text-transform: uppercase; letter-spacing: 1px;
  }
  .titre-devis {
    text-align: center; font-size: 12pt; margin: 0 0 18px 0;
    color: #444;
  }
  .info-block {
    display: flex; gap: 30px; margin-bottom: 18px;
  }
  .info-card {
    flex: 1;
    border: 1px solid #ddd; border-radius: 4px;
    padding: 10px 14px;
  }
  .info-card .label {
    font-size: 8pt; text-transform: uppercase; color: #888; letter-spacing: 0.5px;
    margin-bottom: 4px;
  }
  .info-card .value { font-size: 10pt; }
  .info-card .name { font-weight: 600; }
  table.lignes {
    width: 100%; border-collapse: collapse; margin-bottom: 14px;
  }
  table.lignes thead th {
    background: #1a1a24; color: white;
    padding: 7px 8px; text-align: left;
    font-size: 9pt; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  table.lignes thead th.right { text-align: right; }
  table.lignes thead th.center { text-align: center; }
  table.lignes tbody td {
    padding: 6px 8px; border-bottom: 1px solid #e5e5e5;
    vertical-align: top;
  }
  table.lignes tbody tr:nth-child(even) td { background: #fafafa; }
  td.num { width: 28px; color: #888; text-align: center; }
  td.right { text-align: right; }
  td.center { text-align: center; }
  .totaux {
    margin-left: auto; width: 60%;
    margin-top: 10px;
  }
  .totaux table {
    width: 100%; border-collapse: collapse;
  }
  .totaux td {
    padding: 5px 10px;
  }
  .totaux .label { text-align: right; color: #555; }
  .totaux .value { text-align: right; width: 130px; font-variant-numeric: tabular-nums; }
  .totaux tr.total-ht td {
    border-top: 1px solid #999;
    font-weight: 600;
    padding-top: 7px;
  }
  .totaux tr.total-ttc td {
    background: #1a1a24; color: white;
    font-weight: 700; font-size: 12pt;
    padding: 9px 10px;
  }
  .notes {
    margin-top: 22px; padding: 10px 14px;
    border-left: 3px solid #999; background: #fafafa;
    font-size: 9pt; color: #444;
    white-space: pre-wrap;
  }
  footer {
    margin-top: 28px; padding-top: 10px; border-top: 1px solid #ddd;
    font-size: 8pt; color: #888; text-align: center;
  }
</style>
</head>
<body>
  <header>
    <div>
      <div class="brand">Devis</div>
      <div class="brand-sub">Édition Nucléar Estim · ${escapeHtml(dateStr)}</div>
    </div>
    <div class="meta">
      <div class="ref">${escapeHtml(quote.code ? 'Réf : ' + quote.code : '#' + quote.id)}</div>
      <div class="date">Version ${version.numero} · ${escapeHtml(dateStr)}</div>
    </div>
  </header>

  <h1>${escapeHtml(quote.titre || 'Devis')}</h1>

  <div class="info-block">
    <div class="info-card">
      <div class="label">Émetteur</div>
      <div class="value name">— à compléter dans les paramètres —</div>
    </div>
    <div class="info-card">
      <div class="label">Client</div>
      <div class="value name">${escapeHtml(quote.client_nom || '—')}</div>
      ${quote.client_adresse ? `<div class="value">${escapeHtml(quote.client_adresse).replace(/\n/g, '<br>')}</div>` : ''}
      ${quote.client_email ? `<div class="value">${escapeHtml(quote.client_email)}</div>` : ''}
    </div>
  </div>

  <table class="lignes">
    <thead>
      <tr>
        <th class="center" style="width:30px">#</th>
        <th>Désignation</th>
        <th class="center" style="width:50px">U.</th>
        <th class="right" style="width:70px">Qté</th>
        <th class="right" style="width:90px">P.U. HT</th>
        <th class="right" style="width:100px">Total HT</th>
      </tr>
    </thead>
    <tbody>${lignesHtml || `<tr><td colspan="6" class="center" style="padding:20px;color:#888">Aucune ligne</td></tr>`}</tbody>
  </table>

  <div class="totaux">
    <table>
      ${showFraisLine ? `
        <tr>
          <td class="label">Sous-total déboursé HT</td>
          <td class="value">${fmtEUR(totals.debourse)}</td>
        </tr>
        <tr>
          <td class="label">Frais et marge (${fmtNum(totals.kpv_pct, 2)} %)</td>
          <td class="value">${fmtEUR(totals.frais)}</td>
        </tr>
      ` : ''}
      <tr class="total-ht">
        <td class="label">Total HT</td>
        <td class="value">${fmtEUR(totals.total_ht)}</td>
      </tr>
      <tr>
        <td class="label">TVA (${fmtNum(totals.tva_pct, 2)} %)</td>
        <td class="value">${fmtEUR(totals.tva)}</td>
      </tr>
      <tr class="total-ttc">
        <td class="label">Total TTC</td>
        <td class="value">${fmtEUR(totals.total_ttc)}</td>
      </tr>
    </table>
  </div>

  ${quote.notes_bas_devis ? `<div class="notes">${escapeHtml(quote.notes_bas_devis)}</div>` : ''}

  <footer>
    Devis généré par Nucléar Estim · ${escapeHtml(dateStr)}
  </footer>
</body>
</html>`;
}

// Génère un PDF à partir d'un devis et de sa version, le sauve dans filePath
async function generateQuotePdf(quote, version, lignes, totals, filePath) {
  // 1) Écrire le HTML temporaire
  const html = buildQuoteHtml(quote, version, lignes, totals);
  const tmpFile = path.join(os.tmpdir(), `nuclear-estim-quote-${Date.now()}.html`);
  fs.writeFileSync(tmpFile, html, 'utf8');

  // 2) Créer une fenêtre invisible et y charger le HTML
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 1100,
    webPreferences: {
      offscreen: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  try {
    await win.loadFile(tmpFile);
    // Court délai pour s'assurer que le rendu CSS est stable
    await new Promise(r => setTimeout(r, 200));
    const pdfBuffer = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 } // les marges sont gérées par @page CSS
    });
    fs.writeFileSync(filePath, pdfBuffer);
    return filePath;
  } finally {
    if (!win.isDestroyed()) win.destroy();
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

module.exports = { generateQuotePdf, buildQuoteHtml };
