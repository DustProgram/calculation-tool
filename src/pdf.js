// src/pdf.js — Génération PDF des devis via pdfmake (JS pur, pas de natif)
//
// IMPORTANT : pdfmake est require() de manière LAZY (à l'appel de generateQuotePdf
// uniquement) pour ne pas planter le démarrage de l'app si pdfmake n'est
// pas correctement installé. Si tu vois "Cannot find module 'call-bind-apply-helpers'"
// ou similaire, lance : npm install --force, ou ajoute la dep manquante.

const fs = require('fs');

let _PdfPrinter = null;
function loadPdfMake() {
  if (_PdfPrinter) return _PdfPrinter;
  _PdfPrinter = require('pdfmake');
  return _PdfPrinter;
}

// Polices : pdfmake exige des chemins TTF côté Node
function getPrinter() {
  const PdfPrinter = loadPdfMake();
  const candidates = [
    {
      Roboto: {
        normal: require.resolve('pdfmake/test/fonts/Roboto/Roboto-Regular.ttf'),
        bold: require.resolve('pdfmake/test/fonts/Roboto/Roboto-Medium.ttf'),
        italics: require.resolve('pdfmake/test/fonts/Roboto/Roboto-Italic.ttf'),
        bolditalics: require.resolve('pdfmake/test/fonts/Roboto/Roboto-MediumItalic.ttf')
      }
    }
  ];
  for (const fonts of candidates) {
    try {
      return new PdfPrinter(fonts);
    } catch (_) {}
  }
  throw new Error('Polices PDF introuvables. Réinstalle pdfmake (npm install pdfmake).');
}

function buildQuoteDocDefinition(quote, version, lignes) {
  const totalHT = lignes.reduce((s, l) => s + (parseFloat(l.quantite) || 0) * (parseFloat(l.prixUnitaire) || 0), 0);

  const tableBody = [
    [
      { text: '#', style: 'th' },
      { text: 'Désignation', style: 'th' },
      { text: 'U.', style: 'th', alignment: 'center' },
      { text: 'Qté', style: 'th', alignment: 'right' },
      { text: 'P.U. HT', style: 'th', alignment: 'right' },
      { text: 'Total HT', style: 'th', alignment: 'right' }
    ]
  ];

  lignes.forEach((l, i) => {
    const q = parseFloat(l.quantite) || 0;
    const pu = parseFloat(l.prixUnitaire) || 0;
    const tot = q * pu;
    tableBody.push([
      { text: String(i + 1), alignment: 'center' },
      { text: l.designation || '' },
      { text: l.unite || '', alignment: 'center' },
      { text: q.toLocaleString('fr-FR', { minimumFractionDigits: 2 }), alignment: 'right' },
      { text: pu.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €', alignment: 'right' },
      { text: tot.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €', alignment: 'right' }
    ]);
  });

  return {
    pageSize: 'A4',
    pageMargins: [40, 60, 40, 60],
    content: [
      { text: 'DEVIS', style: 'h1' },
      {
        columns: [
          [
            { text: quote.code ? 'Réf : ' + quote.code : '', style: 'meta' },
            { text: 'Date : ' + new Date().toLocaleDateString('fr-FR'), style: 'meta' },
            { text: 'Version : ' + version.numero, style: 'meta' }
          ],
          [
            { text: 'Client', style: 'metaLabel' },
            { text: quote.client_nom || '—', style: 'meta' },
            { text: quote.client_email || '', style: 'meta' }
          ]
        ],
        margin: [0, 10, 0, 20]
      },
      { text: quote.titre || '', style: 'h2', margin: [0, 0, 0, 10] },
      {
        table: {
          headerRows: 1,
          widths: [25, '*', 30, 50, 60, 70],
          body: tableBody
        },
        layout: 'lightHorizontalLines'
      },
      {
        columns: [
          { text: '' },
          {
            table: {
              widths: ['*', 'auto'],
              body: [
                [{ text: 'Total HT', style: 'totalLabel' }, { text: totalHT.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €', style: 'totalValue' }]
              ]
            },
            layout: 'noBorders',
            margin: [0, 20, 0, 0]
          }
        ]
      }
    ],
    styles: {
      h1: { fontSize: 22, bold: true, alignment: 'center' },
      h2: { fontSize: 14, bold: true },
      th: { bold: true, fillColor: '#eeeeee' },
      meta: { fontSize: 10 },
      metaLabel: { fontSize: 10, bold: true },
      totalLabel: { fontSize: 12, bold: true, alignment: 'right' },
      totalValue: { fontSize: 12, bold: true, alignment: 'right' }
    },
    defaultStyle: { font: 'Roboto', fontSize: 10 }
  };
}

// Génère un PDF à partir d'un devis et de sa version, le sauve dans filePath
function generateQuotePdf(quote, version, lignes, filePath) {
  const printer = getPrinter();
  const dd = buildQuoteDocDefinition(quote, version, lignes);
  return new Promise((resolve, reject) => {
    try {
      const pdfDoc = printer.createPdfKitDocument(dd);
      const stream = fs.createWriteStream(filePath);
      pdfDoc.pipe(stream);
      pdfDoc.end();
      stream.on('finish', () => resolve(filePath));
      stream.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { generateQuotePdf };
