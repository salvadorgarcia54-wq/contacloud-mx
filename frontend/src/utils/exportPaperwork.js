import { message } from 'antd';
import { exportApi } from '../api/client';
import logoImg from '../assets/logo.png';

const formatCurrencyMXN = (val) => {
  if (val === null || val === undefined || val === '' || val === '-') return '-';
  const num = Number(val);
  if (isNaN(num)) return String(val);
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};

const formatNumberStd = (val) => {
  if (val === null || val === undefined || val === '' || val === '-') return '-';
  const num = Number(val);
  if (isNaN(num)) return String(val);
  return num.toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const escapeHtml = (str) => {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

/**
 * Descarga un archivo Excel (.xlsx) real con el logotipo de la firma incrustado en el encabezado
 */
export const exportToExcel = async ({
  filename = 'Papel_de_Trabajo.xlsx',
  sheetName = 'Papel de Trabajo',
  title = 'PAPEL DE TRABAJO CONTABLE Y FISCAL',
  subtitle = '',
  clientInfo = null,
  clientName = '',
  clientRfc = '',
  periodStr = '',
  period = '',
  summaryItems = [],
  summaryCards = [],
  columns = [],
  rows = [],
}) => {
  const hideLoading = message.loading('Generando archivo Excel (.xlsx) membretado...', 0);
  try {
    const resolvedSummary = (summaryCards && summaryCards.length > 0 ? summaryCards : summaryItems) || [];
    const payload = {
      filename,
      sheet_name: sheetName,
      title,
      subtitle,
      business_name: clientName || clientInfo?.business_name || '',
      rfc: clientRfc || clientInfo?.rfc || '',
      period_str: period || periodStr || '',
      summary_items: resolvedSummary.map((s) => ({
        label: String(s.label || ''),
        value: String(s.value || ''),
      })),
      columns: (columns || []).map((c) => {
        const fmt = c.format === 'currency' ? 'money' : c.format === 'integer' ? 'number' : (c.format || 'text');
        return {
          header: String(c.title || c.header || ''),
          key: String(c.key || ''),
          width: c.width || 18,
          align: c.align || (fmt === 'money' || fmt === 'number' || fmt === 'percent' ? 'right' : 'left'),
          format: fmt,
        };
      }),
      rows: rows || [],
    };

    const res = await exportApi.toXlsx(payload);
    const blob = new Blob([res.data], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    const cleanFilename = filename.toLowerCase().endsWith('.xlsx') ? filename : `${filename}.xlsx`;
    link.href = url;
    link.setAttribute('download', cleanFilename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    hideLoading();
    message.success(`Archivo Excel (${cleanFilename}) descargado exitosamente.`);
  } catch (err) {
    hideLoading();
    console.error('Error exporting to Excel:', err);
    message.error('No se pudo generar el archivo Excel (.xlsx).');
  }
};

/**
 * Genera y abre un Papel de Trabajo en PDF Membretado con el logotipo de la firma
 */
export const exportToPdfWithLogo = ({
  title = 'PAPEL DE TRABAJO CONTABLE Y FISCAL',
  subtitle = '',
  clientInfo = null,
  clientName = '',
  clientRfc = '',
  periodStr = '',
  period = '',
  summaryItems = [],
  summaryCards = [],
  columns = [],
  rows = [],
  orientation = 'landscape',
  footerNote = '',
  notes = '',
}) => {
  const resolvedClientName = clientName || clientInfo?.business_name || 'Contribuyente';
  const resolvedClientRfc = clientRfc || clientInfo?.rfc || '-';
  const resolvedPeriod = period || periodStr || '';
  const resolvedSummary = (summaryCards && summaryCards.length > 0 ? summaryCards : summaryItems) || [];
  const resolvedFooterNote = notes || footerNote || '';

  const nowStr = new Date().toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const resolvedLogoUrl = `${window.location.origin}/logo.svg`;

  const summaryHtml =
    resolvedSummary && resolvedSummary.length > 0
      ? `<div class="kpi-grid">
          ${resolvedSummary
            .map(
              (item) => `
            <div class="kpi-card">
              <div class="kpi-label">${escapeHtml(item.label)}</div>
              <div class="kpi-value">${escapeHtml(item.value)}</div>
              ${item.sublabel ? `<div class="kpi-sublabel">${escapeHtml(item.sublabel)}</div>` : ''}
            </div>
          `
            )
            .join('')}
        </div>`
      : '';

  const thHtml = columns
    .map((col) => {
      const isNumeric = ['money', 'currency', 'number', 'integer', 'percent'].includes(col.format);
      const align = col.align || (isNumeric ? 'right' : 'left');
      return `<th style="text-align:${align};">${escapeHtml(col.title || col.header || '')}</th>`;
    })
    .join('');

  const renderRowHtml = (row, idx) => {
    const rowType = row._rowType || 'normal'; // 'normal' | 'section' | 'subtotal' | 'total'
    const isBold = Boolean(row._bold) || rowType !== 'normal';
    const rowClass =
      rowType === 'total'
        ? 'row-total'
        : rowType === 'subtotal'
        ? 'row-subtotal'
        : rowType === 'section'
        ? 'row-section'
        : idx % 2 === 1
        ? 'row-zebra'
        : '';

    const tds = columns
      .map((col) => {
        const raw = row[col.key];
        let formatted = '';
        if (raw === null || raw === undefined || raw === '') {
          formatted = '';
        } else if (col.format === 'money' || col.format === 'currency') {
          formatted = formatCurrencyMXN(raw);
        } else if (col.format === 'percent') {
          const n = Number(raw);
          formatted = isNaN(n) ? String(raw) : `${formatNumberStd(n)}%`;
        } else if (col.format === 'integer') {
          const n = Number(raw);
          formatted = isNaN(n) ? String(raw) : Math.round(n).toLocaleString('es-MX');
        } else if (col.format === 'number') {
          formatted = formatNumberStd(raw);
        } else {
          formatted = String(raw);
        }
        const isNumeric = ['money', 'currency', 'number', 'integer', 'percent'].includes(col.format);
        const align = col.align || (isNumeric ? 'right' : 'left');
        const fontClass = isNumeric ? 'mono' : '';
        return `<td class="${fontClass}" style="text-align:${align}; ${isBold ? 'font-weight:700;' : ''}">${escapeHtml(
          formatted
        )}</td>`;
      })
      .join('');

    return `<tr class="${rowClass}">${tds}</tr>`;
  };

  // Paginación calibrada para que cada hoja se vea bien aprovechada y con buen contenido,
  // manteniendo holgura suficiente para no brincar jamás a una hoja vacía
  const isLandscape = orientation === 'landscape';
  const hasKpis = resolvedSummary && resolvedSummary.length > 0;
  const firstPageCap = isLandscape ? (hasKpis ? 23 : 26) : (hasKpis ? 32 : 35);
  const nextPageCap = isLandscape ? 27 : 36;

  const pageChunks = [];
  if (!rows || rows.length === 0) {
    pageChunks.push([]);
  } else {
    let cursor = 0;
    pageChunks.push(rows.slice(cursor, cursor + firstPageCap));
    cursor += firstPageCap;
    while (cursor < rows.length) {
      pageChunks.push(rows.slice(cursor, cursor + nextPageCap));
      cursor += nextPageCap;
    }
  }

  const totalPages = pageChunks.length;

  const pagesHtml = pageChunks
    .map((chunkRows, pIdx) => {
      const pageNum = pIdx + 1;
      const isFirstPage = pageNum === 1;
      const isLastPage = pageNum === totalPages;
      const globalOffset = isFirstPage ? 0 : firstPageCap + (pageNum - 2) * nextPageCap;
      const chunkRowsHtml = chunkRows.map((r, i) => renderRowHtml(r, globalOffset + i)).join('');

      return `
        <div class="page-sheet ${!isLastPage ? 'page-break' : ''}">
          <div class="page-body">
            <div class="header-banner">
              <div class="brand-left">
                <img src="${resolvedLogoUrl}" alt="Iterumx" class="brand-logo" />
                <div class="brand-titles">
                  <div class="firm-name">Iterumx — Plataforma Contable y Fiscal</div>
                  <h1 class="report-title">${escapeHtml(title)}</h1>
                  ${subtitle ? `<div class="report-subtitle">${escapeHtml(subtitle)}</div>` : ''}
                </div>
              </div>
              <div class="client-right">
                <div class="client-name">${escapeHtml(resolvedClientName)}</div>
                <div class="client-rfc">RFC: ${escapeHtml(resolvedClientRfc)}</div>
                <div class="client-meta">
                  ${resolvedPeriod ? `<strong>Periodo:</strong> ${escapeHtml(resolvedPeriod)} &nbsp;|&nbsp; ` : ''}
                  <strong>Emisión:</strong> ${escapeHtml(nowStr)}
                </div>
              </div>
            </div>

            ${isFirstPage ? summaryHtml : ''}

            <table>
              <thead>
                <tr>${thHtml}</tr>
              </thead>
              <tbody>
                ${chunkRowsHtml}
              </tbody>
            </table>

            ${
              isLastPage
                ? `
              <div class="signatures">
                <div class="sig-box">
                  <strong>ELABORÓ</strong><br/>
                  Auxiliar / Contador Responsable
                </div>
                <div class="sig-box">
                  <strong>REVISÓ</strong><br/>
                  Iterumx — Contabilidad Fiscal
                </div>
                <div class="sig-box">
                  <strong>AUTORIZÓ</strong><br/>
                  ${escapeHtml(resolvedClientName)}
                </div>
              </div>
              ${resolvedFooterNote ? `<div class="footer-note">${escapeHtml(resolvedFooterNote)}</div>` : ''}
            `
                : ''
            }
          </div>

          <div class="page-footer">
            <span>Iterumx &nbsp;|&nbsp; ${escapeHtml(resolvedClientName)} (${escapeHtml(resolvedClientRfc)})</span>
            <span class="page-footer-num">Página ${pageNum} de ${totalPages}</span>
          </div>
        </div>
      `;
    })
    .join('');

  const htmlContent = `<!DOCTYPE html>
<html lang="es-MX">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)} - ${escapeHtml(resolvedClientName)}</title>
  <style>
    @page {
      size: letter ${orientation};
      margin: 12mm 16mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: 'Segoe UI', Calibri, Arial, sans-serif;
      color: #0f172a;
      margin: 0;
      padding: 0;
      font-size: 9px;
      background: #ffffff;
    }
    .page-sheet {
      padding: 2mm 4mm;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .page-break {
      page-break-after: always;
      break-after: page;
    }
    .header-banner {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 3px double #005eb8;
      padding-bottom: 8px;
      margin-bottom: 10px;
    }
    .brand-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-logo {
      height: 48px;
      max-width: 175px;
      object-fit: contain;
    }
    .brand-titles {
      border-left: 2px solid #cbd5e1;
      padding-left: 12px;
    }
    .firm-name {
      font-size: 10px;
      font-weight: 800;
      color: #005eb8;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .report-title {
      font-size: 14px;
      font-weight: 800;
      color: #0f172a;
      text-transform: uppercase;
      margin: 0;
    }
    .report-subtitle {
      font-size: 9.5px;
      color: #475569;
      margin-top: 2px;
    }
    .client-right {
      text-align: right;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 7px 12px;
      min-width: 260px;
    }
    .client-name {
      font-size: 11.5px;
      font-weight: 800;
      color: #0f172a;
    }
    .client-rfc {
      font-family: Consolas, monospace;
      font-size: 10px;
      font-weight: 700;
      color: #005eb8;
      margin-top: 2px;
    }
    .client-meta {
      font-size: 8.5px;
      color: #475569;
      margin-top: 2px;
    }
    .page-badge {
      display: inline-block;
      margin-top: 4px;
      padding: 1.5px 8px;
      background: #dbeafe;
      color: #005eb8;
      border: 1px solid #93c5fd;
      border-radius: 10px;
      font-size: 8.5px;
      font-weight: 800;
      letter-spacing: 0.3px;
    }
    .kpi-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }
    .kpi-card {
      flex: 1 1 130px;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-top: 3px solid #005eb8;
      border-radius: 4px;
      padding: 6px 10px;
    }
    .kpi-label {
      font-size: 8px;
      font-weight: 700;
      text-transform: uppercase;
      color: #475569;
    }
    .kpi-value {
      font-size: 11.5px;
      font-weight: 800;
      color: #0f172a;
      margin-top: 2px;
      font-family: Consolas, monospace;
    }
    .kpi-sublabel {
      font-size: 7.5px;
      color: #64748b;
      margin-top: 1px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
    }
    thead {
      display: table-header-group;
    }
    th {
      background-color: #005eb8 !important;
      color: #ffffff !important;
      font-weight: 700;
      font-size: 8.5px;
      padding: 4.5px 6px;
      border: 1px solid #004c97;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    td {
      padding: 3.5px 6px;
      border: 1px solid #e2e8f0;
      font-size: 8.5px;
      color: #1e293b;
      white-space: nowrap;
    }
    .mono {
      font-family: Consolas, 'Courier New', monospace;
    }
    .row-zebra td {
      background-color: #f8fafc !important;
    }
    .row-section td {
      background-color: #e2e8f0 !important;
      font-weight: 800 !important;
      color: #0f172a !important;
      text-transform: uppercase;
    }
    .row-subtotal td {
      background-color: #f1f5f9 !important;
      font-weight: 700 !important;
      border-top: 1.5px solid #334155 !important;
      border-bottom: 1.5px solid #334155 !important;
    }
    .row-total td {
      background-color: #dbeafe !important;
      font-weight: 800 !important;
      color: #005eb8 !important;
      border-top: 1.5px solid #005eb8 !important;
      border-bottom: 3px double #005eb8 !important;
    }
    .signatures {
      margin-top: 22px;
      display: flex;
      justify-content: space-around;
      page-break-inside: avoid;
    }
    .sig-box {
      width: 210px;
      text-align: center;
      border-top: 1px solid #334155;
      padding-top: 5px;
      font-size: 8.5px;
      color: #334155;
    }
    .footer-note {
      margin-top: 8px;
      font-size: 8px;
      color: #64748b;
      text-align: center;
      font-style: italic;
    }
    .page-footer {
      margin-top: 10px;
      padding-top: 6px;
      border-top: 1px solid #cbd5e1;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 8.5px;
      color: #475569;
    }
    .page-footer-num {
      font-weight: 800;
      color: #005eb8;
      font-size: 9px;
    }
  </style>
</head>
<body>
  ${pagesHtml}
</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(htmlContent);
  doc.close();

  const triggerPrint = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      window.print();
    } finally {
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 2500);
    }
  };

  // Esperar a que cargue el logotipo antes de abrir el diálogo PDF
  const img = doc.querySelector('img');
  if (img && !img.complete) {
    img.onload = triggerPrint;
    img.onerror = triggerPrint;
  } else {
    setTimeout(triggerPrint, 250);
  }
};
