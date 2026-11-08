import React, { useState, useMemo } from 'react';
import { Button, Input, Modal, Table, Tag, Space, Tooltip } from 'antd';
import {
  FileExcelOutlined,
  FilePdfOutlined,
  PrinterOutlined,
  SearchOutlined,
  FileSearchOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { exportToExcel, exportToPdfWithLogo } from '../utils/exportPaperwork';

const formatMoney = (val) => {
  const num = Number(val) || 0;
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};

const USO_GROUPS = [
  { key: 'g01', code: 'G01', subtitle: 'Compras' },
  { key: 'g03', code: 'G03', subtitle: 'Gastos' },
  { key: 'g02', code: 'G02', subtitle: 'Devoluciones descuentos' },
  { key: 'i', code: 'I', subtitle: 'Inversiones' },
  { key: 'd', code: 'D', subtitle: 'Deducciones personales' },
  { key: 's', code: 'S', subtitle: 'Sin efectos fiscales' },
];

const ACCENT_STYLES = {
  blue: {
    borderLeft: '4px solid #2563eb',
    rowOdd: 'bg-[#f8fafc]',
    rowEven: 'bg-[#e2e8f0]/60',
  },
  orange: {
    borderLeft: '4px solid #ea580c',
    rowOdd: 'bg-[#fff7ed]',
    rowEven: 'bg-[#ffedd5]/60',
  },
  purple: {
    borderLeft: '4px solid #7c3aed',
    rowOdd: 'bg-[#faf5ff]',
    rowEven: 'bg-[#f3e8ff]/60',
  },
  green: {
    borderLeft: '4px solid #16a34a',
    rowOdd: 'bg-[#f0fdf4]',
    rowEven: 'bg-[#dcfce7]/60',
  },
  yellow: {
    borderLeft: '4px solid #eab308',
    rowOdd: 'bg-[#fefce8]',
    rowEven: 'bg-[#fef9c3]/60',
  },
};

export default function ConciliacionIvaMatrix({
  matrixData,
  clientInfo,
  year,
  month,
  omittedIds = [],
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [drilldownModal, setDrilldownModal] = useState(null);

  // Recalcular dinámicamente las filas si hay comprobantes omitidos por el usuario
  const computedMatrix = useMemo(() => {
    if (!matrixData) return null;

    const recalcRow = (row) => {
      const activeCfdis = (row.cfdis || []).filter((c) => !omittedIds.includes(c.id));
      const updated = {
        ...row,
        g01_importe: 0,
        g01_iva: 0,
        g03_importe: 0,
        g03_iva: 0,
        g02_importe: 0,
        g02_iva: 0,
        i_importe: 0,
        i_iva: 0,
        d_importe: 0,
        d_iva: 0,
        s_importe: 0,
        s_iva: 0,
        total_iva_acreditable: 0,
        cfdi_count: activeCfdis.length,
        active_cfdis: activeCfdis,
      };

      activeCfdis.forEach((c) => {
        const uk = c.uso_bucket || 'g03';
        const imp = Number(c.importe) || 0;
        const iva = Number(c.iva) || 0;
        updated[`${uk}_importe`] = Math.round((updated[`${uk}_importe`] + imp) * 100) / 100;
        updated[`${uk}_iva`] = Math.round((updated[`${uk}_iva`] + iva) * 100) / 100;
        if (uk !== 's') {
          updated.total_iva_acreditable = Math.round((updated.total_iva_acreditable + iva) * 100) / 100;
        }
      });

      return updated;
    };

    const rows = (matrixData.rows || []).map(recalcRow);
    const ppdRow = matrixData.ppd_row ? recalcRow(matrixData.ppd_row) : null;

    const totals = {
      key: 'TOTALES',
      tipo: '',
      concepto: 'Totales',
      forma_pago: '',
      g01_importe: 0,
      g01_iva: 0,
      g03_importe: 0,
      g03_iva: 0,
      g02_importe: 0,
      g02_iva: 0,
      i_importe: 0,
      i_iva: 0,
      d_importe: 0,
      d_iva: 0,
      s_importe: 0,
      s_iva: 0,
      total_iva_acreditable: 0,
      cfdi_count: 0,
      active_cfdis: [],
    };

    rows.forEach((r) => {
      const sign = r.key.startsWith('E_') ? -1 : 1;
      USO_GROUPS.forEach(({ key: uk }) => {
        totals[`${uk}_importe`] = Math.round((totals[`${uk}_importe`] + sign * r[`${uk}_importe`]) * 100) / 100;
        totals[`${uk}_iva`] = Math.round((totals[`${uk}_iva`] + sign * r[`${uk}_iva`]) * 100) / 100;
      });
      totals.total_iva_acreditable = Math.round((totals.total_iva_acreditable + sign * r.total_iva_acreditable) * 100) / 100;
      totals.cfdi_count += r.cfdi_count;
      totals.active_cfdis.push(...(r.active_cfdis || []));
    });

    return {
      ...matrixData,
      rows,
      totals,
      ppd_row: ppdRow,
    };
  }, [matrixData, omittedIds]);

  const filteredRows = useMemo(() => {
    if (!computedMatrix?.rows) return [];
    if (!searchTerm.trim()) return computedMatrix.rows;
    const q = searchTerm.toLowerCase().trim();
    return computedMatrix.rows.filter(
      (r) =>
        (r.tipo || '').toLowerCase().includes(q) ||
        (r.concepto || '').toLowerCase().includes(q) ||
        (r.group_badge || '').toLowerCase().includes(q) ||
        (r.forma_pago || '').toLowerCase().includes(q) ||
        (r.active_cfdis || []).some(
          (c) =>
            (c.rfc || '').toLowerCase().includes(q) ||
            (c.name || '').toLowerCase().includes(q) ||
            (c.folio || '').toLowerCase().includes(q) ||
            (c.uuid || '').toLowerCase().includes(q)
        )
    );
  }, [computedMatrix, searchTerm]);

  const buildExportPayload = () => {
    if (!computedMatrix) return null;

    const columnsDef = [
      { key: 'tipo', title: 'Tipo', align: 'center', format: 'text', width: 8 },
      { key: 'concepto', title: 'Concepto', align: 'left', format: 'text', width: 32 },
      { key: 'forma_pago', title: 'Forma de pago', align: 'left', format: 'text', width: 15 },
      { key: 'g01_importe', title: 'G01 Compras Importe', align: 'right', format: 'currency', width: 15 },
      { key: 'g01_iva', title: 'G01 Compras IVA', align: 'right', format: 'currency', width: 14 },
      { key: 'g03_importe', title: 'G03 Gastos Importe', align: 'right', format: 'currency', width: 15 },
      { key: 'g03_iva', title: 'G03 Gastos IVA', align: 'right', format: 'currency', width: 14 },
      { key: 'g02_importe', title: 'G02 Devoluciones Importe', align: 'right', format: 'currency', width: 15 },
      { key: 'g02_iva', title: 'G02 Devoluciones IVA', align: 'right', format: 'currency', width: 14 },
      { key: 'i_importe', title: 'I Inversiones Importe', align: 'right', format: 'currency', width: 15 },
      { key: 'i_iva', title: 'I Inversiones IVA', align: 'right', format: 'currency', width: 14 },
      { key: 'd_importe', title: 'D Deducciones Importe', align: 'right', format: 'currency', width: 15 },
      { key: 'd_iva', title: 'D Deducciones IVA', align: 'right', format: 'currency', width: 14 },
      { key: 's_importe', title: 'S Sin Efectos Importe', align: 'right', format: 'currency', width: 15 },
      { key: 's_iva', title: 'S Sin Efectos IVA', align: 'right', format: 'currency', width: 14 },
      { key: 'total_iva_acreditable', title: 'Totales IVA acreditable', align: 'right', format: 'currency', width: 18 },
      { key: 'cfdi_count', title: "Número de CFDI's", align: 'right', format: 'integer', width: 14 },
    ];

    const mapRow = (r, rowType = 'normal') => ({
      tipo: r.tipo || '',
      concepto: r.group_badge || r.concepto || '',
      forma_pago: r.forma_pago || '',
      g01_importe: Number(r.g01_importe || 0),
      g01_iva: Number(r.g01_iva || 0),
      g03_importe: Number(r.g03_importe || 0),
      g03_iva: Number(r.g03_iva || 0),
      g02_importe: Number(r.g02_importe || 0),
      g02_iva: Number(r.g02_iva || 0),
      i_importe: Number(r.i_importe || 0),
      i_iva: Number(r.i_iva || 0),
      d_importe: Number(r.d_importe || 0),
      d_iva: Number(r.d_iva || 0),
      s_importe: Number(r.s_importe || 0),
      s_iva: Number(r.s_iva || 0),
      total_iva_acreditable: Number(r.total_iva_acreditable || 0),
      cfdi_count: Number(r.cfdi_count || 0),
      _rowType: rowType,
    });

    const rows = computedMatrix.rows.map((r) => mapRow(r, 'normal'));
    rows.push(mapRow(computedMatrix.totals, 'total'));

    if (computedMatrix.ppd_row) {
      rows.push({
        tipo: 'CONTROL',
        concepto: 'CFDI PPD por definir: se muestran para control, pero no suman al total anterior.',
        forma_pago: '',
        g01_importe: '',
        g01_iva: '',
        g03_importe: '',
        g03_iva: '',
        g02_importe: '',
        g02_iva: '',
        i_importe: '',
        i_iva: '',
        d_importe: '',
        d_iva: '',
        s_importe: '',
        s_iva: '',
        total_iva_acreditable: '',
        cfdi_count: '',
        _rowType: 'section',
      });
      rows.push(mapRow(computedMatrix.ppd_row, 'subtotal'));
    }

    const t = computedMatrix.totals;
    const summaryCards = [
      { label: 'Total IVA Acreditable', value: formatMoney(t.total_iva_acreditable), sublabel: `${t.cfdi_count} CFDI efectivos en el periodo` },
      { label: 'IVA G03 (Gastos)', value: formatMoney(t.g03_iva), sublabel: `Base: ${formatMoney(t.g03_importe)}` },
      { label: 'IVA G01 (Compras) + I (Inversiones)', value: formatMoney((t.g01_iva || 0) + (t.i_iva || 0)), sublabel: `Base: ${formatMoney((t.g01_importe || 0) + (t.i_importe || 0))}` },
      { label: 'CFDI PPD Emitidos en el Periodo', value: formatMoney(computedMatrix.ppd_row?.total_iva_acreditable || 0), sublabel: `${computedMatrix.ppd_row?.cfdi_count || 0} CFDI PPD (control informativo)` },
    ];

    const periodStr = computedMatrix.period_str || `${String(month).padStart(2, '0')}/${year}`;
    return {
      title: 'REPORTE CONCILIACIÓN IVA ACREDITABLE',
      subtitle: 'Matriz de CFDI Recibidos por Tipo de Comprobante, Método de Pago, Forma de Pago y Uso del CFDI',
      clientName: clientInfo?.business_name || '',
      clientRfc: clientInfo?.rfc || '',
      period: `${periodStr} (${computedMatrix.period_description || ''})`,
      columns: columnsDef,
      rows,
      summaryCards,
      orientation: 'landscape',
      notes: 'Los CFDI PPD emitidos en el periodo se muestran aparte como referencia y no se consideran dentro de los totales del IVA acreditable. Los CFDI con UsoCFDI S01 se muestran de forma informativa.',
      filename: `Conciliacion_IVA_Acreditable_${clientInfo?.rfc || 'Cliente'}_${year}_${String(month).padStart(2, '0')}.xlsx`,
    };
  };

  if (!computedMatrix) return null;

  const { totals, ppd_row: ppdRow } = computedMatrix;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 mb-6">
      {/* Banner Informativo Azul idéntico al reporte solicitado */}
      <div className="mb-4 rounded-md border border-sky-200 bg-gradient-to-r from-cyan-50 via-sky-50 to-blue-50 px-4 py-3 text-xs text-teal-950 leading-relaxed shadow-inner">
        <div>
          La matriz agrupa CFDI recibidos por uso del CFDI y forma de pago. Los importes corresponden a base gravable/exenta y el IVA corresponde al IVA trasladado acreditable registrado en los XML locales del contribuyente.
        </div>
        <div>
          <strong>Importante:</strong> los CFDI PPD emitidos en el periodo se muestran aparte como referencia y no se consideran dentro de los totales del IVA acreditable.
        </div>
        <div>
          <strong>Sin efectos fiscales:</strong> los CFDI con UsoCFDI S01 se muestran de forma informativa con su base e IVA, pero ese IVA no se suma al total acreditable.
        </div>
      </div>

      {/* Barra superior de la matriz */}
      <div className="flex flex-wrap justify-between items-center gap-3 mb-3 print:hidden">
        <div className="text-xs text-gray-600 font-medium">
          Mostrando 1 a {filteredRows.length} de {computedMatrix.rows.length} registros
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="small"
            type="primary"
            icon={<FileExcelOutlined />}
            onClick={() => exportToExcel(buildExportPayload())}
            className="bg-emerald-700 hover:bg-emerald-800 border-emerald-700 font-semibold text-xs shadow-sm"
          >
            Descargar Excel
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<FilePdfOutlined />}
            onClick={() => exportToPdfWithLogo(buildExportPayload())}
            style={{ backgroundColor: '#0ea5e9', borderColor: '#0ea5e9', color: '#ffffff' }}
            className="font-semibold text-xs shadow-sm"
          >
            PDF Membretado
          </Button>
          <Button
            size="small"
            icon={<PrinterOutlined />}
            onClick={() => exportToPdfWithLogo(buildExportPayload())}
            className="text-xs"
          >
            Imprimir
          </Button>
          <div className="flex items-center gap-1.5 ml-1">
            <span className="text-xs text-gray-600">Buscar:</span>
            <Input
              size="small"
              allowClear
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Concepto, forma, RFC..."
              prefix={<SearchOutlined className="text-gray-400 text-[11px]" />}
              style={{ width: 175 }}
            />
          </div>
        </div>
      </div>

      {/* Tabla Matriz Conciliación IVA Acreditable */}
      <div className="overflow-x-auto border border-slate-300 rounded">
        <table className="w-full border-collapse text-[11px] min-w-[1250px]">
          <thead>
            <tr className="bg-[#d6e4f5] text-slate-900 font-bold border-b border-slate-300">
              <th rowSpan={2} className="border border-slate-300 px-2 py-2 text-left w-10">
                Tipo
              </th>
              <th rowSpan={2} className="border border-slate-300 px-2.5 py-2 text-left min-w-[205px]">
                Concepto
              </th>
              <th rowSpan={2} className="border border-slate-300 px-2 py-2 text-left w-24">
                Forma de pago
              </th>
              {USO_GROUPS.map((g) => (
                <th key={g.key} colSpan={2} className="border border-slate-300 px-2 py-1 text-left">
                  <div className="font-bold text-slate-900 text-[11px] leading-tight">{g.code}</div>
                  <div className="font-semibold text-slate-700 text-[9.5px] leading-tight">{g.subtitle}</div>
                </th>
              ))}
              <th rowSpan={2} className="border border-slate-300 px-2.5 py-2 text-left w-32">
                Totales IVA acreditable
              </th>
              <th rowSpan={2} className="border border-slate-300 px-2 py-2 text-left w-24">
                Número de CFDI&apos;s
              </th>
            </tr>
            <tr className="bg-[#e3edf9] text-slate-800 font-bold border-b border-slate-300">
              {USO_GROUPS.map((g) => (
                <React.Fragment key={`${g.key}-sub`}>
                  <th className="border border-slate-300 px-2 py-1 text-left w-20">Importe</th>
                  <th className="border border-slate-300 px-2 py-1 text-left w-16">IVA</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>

          <tbody>
            {filteredRows.map((row, idx) => {
              const styleCfg = ACCENT_STYLES[row.accent_color] || ACCENT_STYLES.blue;
              const bgClass = idx % 2 === 0 ? styleCfg.rowEven : styleCfg.rowOdd;
              const hasCfdis = row.cfdi_count > 0;

              return (
                <tr
                  key={row.key}
                  style={{ borderLeft: styleCfg.borderLeft }}
                  className={`${bgClass} border-b border-slate-200 hover:brightness-95 transition`}
                >
                  <td className="px-2 py-1.5 font-bold text-slate-800 border-r border-slate-200">
                    {row.tipo}
                  </td>
                  <td className="px-2.5 py-1.5 border-r border-slate-200">
                    {row.group_badge ? (
                      <span className="inline-block bg-white border border-slate-300 rounded-full px-2.5 py-0.5 font-bold text-[10.5px] text-slate-800 shadow-2xs">
                        {row.group_badge}
                      </span>
                    ) : (
                      <span className="text-slate-600 pl-1">{row.concepto}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-slate-700 border-r border-slate-200">
                    {row.forma_pago}
                  </td>

                  {USO_GROUPS.map((g) => {
                    const impVal = Number(row[`${g.key}_importe`] || 0);
                    const ivaVal = Number(row[`${g.key}_iva`] || 0);
                    return (
                      <React.Fragment key={`${row.key}-${g.key}`}>
                        <td
                          className={`px-2 py-1.5 text-right tabular-nums border-r border-slate-200/70 ${
                            impVal > 0 ? 'font-semibold text-slate-900' : 'text-slate-500'
                          }`}
                        >
                          {formatMoney(impVal)}
                        </td>
                        <td
                          className={`px-2 py-1.5 text-right tabular-nums border-r border-slate-200 ${
                            ivaVal > 0 ? 'font-semibold text-slate-900' : 'text-slate-500'
                          }`}
                        >
                          {formatMoney(ivaVal)}
                        </td>
                      </React.Fragment>
                    );
                  })}

                  <td className="px-2.5 py-1.5 text-right font-bold text-slate-900 tabular-nums border-r border-slate-200">
                    {formatMoney(row.total_iva_acreditable)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {hasCfdis ? (
                      <Tooltip title="Haga clic para ver los CFDI que integran este renglón">
                        <button
                          type="button"
                          onClick={() =>
                            setDrilldownModal({
                              title: `${row.group_badge || row.concepto} — ${row.forma_pago}`,
                              cfdis: row.active_cfdis || [],
                            })
                          }
                          className="font-bold text-blue-700 hover:text-blue-900 underline cursor-pointer bg-transparent border-0 p-0"
                        >
                          {row.cfdi_count}
                        </button>
                      </Tooltip>
                    ) : (
                      <span className="text-slate-600">0</span>
                    )}
                  </td>
                </tr>
              );
            })}

            {/* Fila de Totales */}
            <tr className="bg-white font-bold text-slate-950 border-t-2 border-b-2 border-slate-800">
              <td className="px-2 py-2 border-r border-slate-200"></td>
              <td className="px-2.5 py-2 border-r border-slate-200">Totales</td>
              <td className="px-2 py-2 border-r border-slate-200"></td>
              {USO_GROUPS.map((g) => (
                <React.Fragment key={`tot-${g.key}`}>
                  <td className="px-2 py-2 text-right tabular-nums border-r border-slate-200">
                    {formatMoney(totals[`${g.key}_importe`])}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums border-r border-slate-200">
                    {formatMoney(totals[`${g.key}_iva`])}
                  </td>
                </React.Fragment>
              ))}
              <td className="px-2.5 py-2 text-right tabular-nums border-r border-slate-200">
                {formatMoney(totals.total_iva_acreditable)}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">
                {totals.cfdi_count > 0 ? (
                  <Tooltip title="Ver todos los CFDI acreditables del periodo">
                    <button
                      type="button"
                      onClick={() =>
                        setDrilldownModal({
                          title: `Total CFDI Acreditables del Periodo (${totals.cfdi_count})`,
                          cfdis: totals.active_cfdis || [],
                        })
                      }
                      className="font-bold text-blue-700 hover:text-blue-900 underline cursor-pointer bg-transparent border-0 p-0"
                    >
                      {totals.cfdi_count}
                    </button>
                  </Tooltip>
                ) : (
                  0
                )}
              </td>
            </tr>

            {/* Separador y Fila de Control CFDI PPD */}
            {ppdRow && (
              <>
                <tr className="bg-[#fef9e7] border-t border-b border-amber-400">
                  <td colSpan={17} className="px-2.5 py-1.5 font-bold text-amber-950 text-[11px]">
                    CFDI PPD por definir: se muestran para control, pero no suman al total anterior.
                  </td>
                </tr>
                <tr
                  style={{ borderLeft: ACCENT_STYLES.yellow.borderLeft }}
                  className="bg-[#fef3c7]/65 border-b border-amber-300 hover:brightness-95 transition"
                >
                  <td className="px-2 py-1.5 font-bold text-slate-900 border-r border-amber-200">
                    {ppdRow.tipo}
                  </td>
                  <td className="px-2.5 py-1.5 border-r border-amber-200">
                    <span className="inline-block bg-white border border-amber-300 rounded-full px-2.5 py-0.5 font-bold text-[10.5px] text-slate-800">
                      {ppdRow.group_badge}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-slate-700 border-r border-amber-200">
                    {ppdRow.forma_pago}
                  </td>

                  {USO_GROUPS.map((g) => {
                    const impVal = Number(ppdRow[`${g.key}_importe`] || 0);
                    const ivaVal = Number(ppdRow[`${g.key}_iva`] || 0);
                    return (
                      <React.Fragment key={`ppd-${g.key}`}>
                        <td
                          className={`px-2 py-1.5 text-right tabular-nums border-r border-amber-200/70 ${
                            impVal > 0 ? 'font-semibold text-slate-900' : 'text-slate-500'
                          }`}
                        >
                          {formatMoney(impVal)}
                        </td>
                        <td
                          className={`px-2 py-1.5 text-right tabular-nums border-r border-amber-200 ${
                            ivaVal > 0 ? 'font-semibold text-slate-900' : 'text-slate-500'
                          }`}
                        >
                          {formatMoney(ivaVal)}
                        </td>
                      </React.Fragment>
                    );
                  })}

                  <td className="px-2.5 py-1.5 text-right font-bold text-slate-900 tabular-nums border-r border-amber-200">
                    {formatMoney(ppdRow.total_iva_acreditable)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {ppdRow.cfdi_count > 0 ? (
                      <Tooltip title="Ver los CFDI PPD emitidos en el periodo">
                        <button
                          type="button"
                          onClick={() =>
                            setDrilldownModal({
                              title: `CFDI PPD emitidos en el periodo (${ppdRow.cfdi_count})`,
                              cfdis: ppdRow.active_cfdis || [],
                            })
                          }
                          className="font-bold text-amber-900 hover:text-amber-950 underline cursor-pointer bg-transparent border-0 p-0"
                        >
                          {ppdRow.cfdi_count}
                        </button>
                      </Tooltip>
                    ) : (
                      <span className="text-slate-600">0</span>
                    )}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal de desglose de CFDI al hacer clic en Número de CFDI's */}
      <Modal
        title={
          <div className="font-bold text-gray-800 text-sm">
            Desglose de Comprobantes — {drilldownModal?.title}
          </div>
        }
        open={Boolean(drilldownModal)}
        onCancel={() => setDrilldownModal(null)}
        footer={[
          <Button key="close" type="primary" onClick={() => setDrilldownModal(null)}>
            Cerrar
          </Button>,
        ]}
        width={980}
      >
        <Table
          dataSource={drilldownModal?.cfdis || []}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: 'Fecha',
              dataIndex: 'date',
              key: 'date',
              width: 95,
            },
            {
              title: 'Folio / UUID',
              dataIndex: 'folio',
              key: 'folio',
              width: 140,
              render: (folio, r) => (
                <a
                  href={`/cfdi-viewer/${r.uuid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline font-mono text-xs inline-flex items-center gap-1"
                >
                  <span>{folio}</span>
                  <FileSearchOutlined />
                </a>
              ),
            },
            {
              title: 'RFC Emisor',
              dataIndex: 'rfc',
              key: 'rfc',
              width: 120,
              render: (v) => <span className="font-mono text-xs">{v}</span>,
            },
            {
              title: 'Proveedor / Emisor',
              dataIndex: 'name',
              key: 'name',
              ellipsis: true,
            },
            {
              title: 'Tipo / Método',
              key: 'tipo',
              width: 105,
              render: (_, r) => (
                <Space size={4}>
                  <Tag color="blue" className="m-0 text-[10px]">
                    {r.tipo_comprobante}
                  </Tag>
                  <Tag color="cyan" className="m-0 text-[10px]">
                    {r.payment_method}
                  </Tag>
                </Space>
              ),
            },
            {
              title: 'Forma Pago',
              dataIndex: 'payment_form',
              key: 'payment_form',
              width: 90,
              align: 'center',
            },
            {
              title: 'Uso CFDI',
              dataIndex: 'cfdi_use',
              key: 'cfdi_use',
              width: 85,
              align: 'center',
              render: (u) => <Tag color="geekblue" className="m-0 text-[10px]">{u}</Tag>,
            },
            {
              title: 'Base (Importe)',
              dataIndex: 'importe',
              key: 'importe',
              align: 'right',
              width: 115,
              render: (v) => <span className="tabular-nums font-medium">{formatMoney(v)}</span>,
            },
            {
              title: 'IVA Acreditable',
              dataIndex: 'iva',
              key: 'iva',
              align: 'right',
              width: 115,
              render: (v) => <span className="tabular-nums font-bold text-purple-700">{formatMoney(v)}</span>,
            },
          ]}
        />
      </Modal>
    </div>
  );
}
