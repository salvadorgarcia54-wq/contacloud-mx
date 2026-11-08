import React, { useState, useEffect } from 'react';
import { 
  Select, Button, Typography, Alert, Card, Spin, Space, Switch, Tooltip 
} from 'antd';
import { 
  PrinterOutlined, SearchOutlined, ExportOutlined, FileTextOutlined, FileExcelOutlined, FilePdfOutlined
} from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import { reportsApi, clientsApi } from '../api/client';
import { exportToExcel, exportToPdfWithLogo } from '../utils/exportPaperwork';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { Option } = Select;

// Formateador estándar contable mexicano
const formatNum = (val) => {
  if (val === undefined || val === null || isNaN(val)) return '0.00';
  return Number(val).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const formatPct = (val) => {
  if (val === undefined || val === null || isNaN(val)) return '0.00';
  return Number(val).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const IncomeStatement = () => {
  const { clientId } = useParams();
  
  const [clientInfo, setClientInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(9); // Septiembre por defecto
  const [showMinusSign, setShowMinusSign] = useState(true); // Estilo contable con signo (-) o positivo (+)

  useEffect(() => {
    if (clientId) {
      clientsApi.get(clientId).then(res => setClientInfo(res.data)).catch(() => {});
      loadStatement(year, month);
    }
  }, [clientId]);

  const loadStatement = async (y = year, m = month) => {
    setLoading(true);
    setError('');
    try {
      const res = await reportsApi.incomeStatement(clientId, {
        year: y,
        month: m || undefined
      });
      setData(res.data);
    } catch (err) {
      console.error('Error al generar el estado de resultados:', err);
      setError('Error al generar el estado de resultados');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = () => {
    loadStatement(year, month);
  };

  const handlePrint = () => {
    window.print();
  };

  const buildIncomeExportPayload = () => {
    if (!data) return null;
    const columnsDef = [
      { key: 'concept', title: 'Concepto / Cuenta Contable', align: 'left', format: 'text', width: 45 },
      { key: 'period', title: 'Importe Periodo', align: 'right', format: 'currency', width: 20 },
      { key: 'period_pct', title: '% Periodo', align: 'right', format: 'percent', width: 14 },
      { key: 'accum', title: 'Importe Acumulado', align: 'right', format: 'currency', width: 20 },
      { key: 'accum_pct', title: '% Acumulado', align: 'right', format: 'percent', width: 14 },
    ];

    const rows = [];
    rows.push({ concept: 'INGRESOS', period: '', period_pct: '', accum: '', accum_pct: '', _rowType: 'section' });
    (data.ingresos?.items || []).forEach(it => {
      rows.push({
        concept: `   ${it.name}`,
        period: Number(it.period || 0),
        period_pct: Number(it.period_pct || 0),
        accum: Number(it.accum || 0),
        accum_pct: Number(it.accum_pct || 0),
        _rowType: 'normal'
      });
    });
    rows.push({
      concept: 'Total Ingresos',
      period: Number(data.total_ingresos?.period || 0),
      period_pct: Number(data.total_ingresos?.period_pct || 0),
      accum: Number(data.total_ingresos?.accum || 0),
      accum_pct: Number(data.total_ingresos?.accum_pct || 0),
      _rowType: 'subtotal'
    });

    rows.push({ concept: 'EGRESOS', period: '', period_pct: '', accum: '', accum_pct: '', _rowType: 'section' });
    if (data.costos?.items && data.costos.items.length > 0) {
      rows.push({ concept: '  COSTOS', period: '', period_pct: '', accum: '', accum_pct: '', _rowType: 'section' });
      data.costos.items.forEach(it => {
        rows.push({
          concept: `     ${it.name}`,
          period: Number(it.period || 0),
          period_pct: Number(it.period_pct || 0),
          accum: Number(it.accum || 0),
          accum_pct: Number(it.accum_pct || 0),
          _rowType: 'normal'
        });
      });
      rows.push({
        concept: '  Total COSTOS',
        period: Number(data.costos.total_period || 0),
        period_pct: Number(data.costos.total_period_pct || 0),
        accum: Number(data.costos.total_accum || 0),
        accum_pct: Number(data.costos.total_accum_pct || 0),
        _rowType: 'subtotal'
      });
    }

    if (data.gastos?.items && data.gastos.items.length > 0) {
      rows.push({ concept: '  GASTOS DE OPERACIÓN', period: '', period_pct: '', accum: '', accum_pct: '', _rowType: 'section' });
      data.gastos.items.forEach(it => {
        rows.push({
          concept: `     ${it.name}`,
          period: Number(it.period || 0),
          period_pct: Number(it.period_pct || 0),
          accum: Number(it.accum || 0),
          accum_pct: Number(it.accum_pct || 0),
          _rowType: 'normal'
        });
      });
      rows.push({
        concept: '  Total GASTOS',
        period: Number(data.gastos.total_period || 0),
        period_pct: Number(data.gastos.total_period_pct || 0),
        accum: Number(data.gastos.total_accum || 0),
        accum_pct: Number(data.gastos.total_accum_pct || 0),
        _rowType: 'subtotal'
      });
    }

    if (data.rif) {
      rows.push({ concept: '  RESULTADO INTEGRAL DE FINANCIAMIENTO', period: '', period_pct: '', accum: '', accum_pct: '', _rowType: 'section' });
      if (data.rif.gastos_financieros) {
        rows.push({
          concept: `     ${data.rif.gastos_financieros.name}`,
          period: Number(data.rif.gastos_financieros.period || 0),
          period_pct: Number(data.rif.gastos_financieros.period_pct || 0),
          accum: Number(data.rif.gastos_financieros.accum || 0),
          accum_pct: Number(data.rif.gastos_financieros.accum_pct || 0),
          _rowType: 'normal'
        });
      }
      if (data.rif.productos_financieros) {
        rows.push({
          concept: `     ${data.rif.productos_financieros.name}`,
          period: Number(data.rif.productos_financieros.period || 0),
          period_pct: Number(data.rif.productos_financieros.period_pct || 0),
          accum: Number(data.rif.productos_financieros.accum || 0),
          accum_pct: Number(data.rif.productos_financieros.accum_pct || 0),
          _rowType: 'normal'
        });
      }
      rows.push({
        concept: '  Total RESULTADO INTEGRAL DE FINANCIAMIENTO',
        period: Number(data.rif.total_period || 0),
        period_pct: Number(data.rif.total_period_pct || 0),
        accum: Number(data.rif.total_accum || 0),
        accum_pct: Number(data.rif.total_accum_pct || 0),
        _rowType: 'subtotal'
      });
    }

    if (data.impuestos_ptu) {
      rows.push({ concept: '  IMPUESTOS Y PTU', period: '', period_pct: '', accum: '', accum_pct: '', _rowType: 'section' });
      if (data.impuestos_ptu.ptu) {
        rows.push({
          concept: `     ${data.impuestos_ptu.ptu.name}`,
          period: Number(data.impuestos_ptu.ptu.period || 0),
          period_pct: Number(data.impuestos_ptu.ptu.period_pct || 0),
          accum: Number(data.impuestos_ptu.ptu.accum || 0),
          accum_pct: Number(data.impuestos_ptu.ptu.accum_pct || 0),
          _rowType: 'normal'
        });
      }
      if (data.impuestos_ptu.isr) {
        rows.push({
          concept: `     ${data.impuestos_ptu.isr.name}`,
          period: Number(data.impuestos_ptu.isr.period || 0),
          period_pct: Number(data.impuestos_ptu.isr.period_pct || 0),
          accum: Number(data.impuestos_ptu.isr.accum || 0),
          accum_pct: Number(data.impuestos_ptu.isr.accum_pct || 0),
          _rowType: 'normal'
        });
      }
      rows.push({
        concept: '  Total IMPUESTOS Y PTU',
        period: Number(data.impuestos_ptu.total_period || 0),
        period_pct: Number(data.impuestos_ptu.total_period_pct || 0),
        accum: Number(data.impuestos_ptu.total_accum || 0),
        accum_pct: Number(data.impuestos_ptu.total_accum_pct || 0),
        _rowType: 'subtotal'
      });
    }

    rows.push({
      concept: 'Total Egresos',
      period: Number(data.total_egresos?.period || 0),
      period_pct: Number(data.total_egresos?.period_pct || 0),
      accum: Number(data.total_egresos?.accum || 0),
      accum_pct: Number(data.total_egresos?.accum_pct || 0),
      _rowType: 'subtotal'
    });

    rows.push({
      concept: 'UTILIDAD (O PÉRDIDA) NETA DEL EJERCICIO',
      period: Number(data.utilidad?.period || 0),
      period_pct: Number(data.utilidad?.period_pct || 0),
      accum: Number(data.utilidad?.accum || 0),
      accum_pct: Number(data.utilidad?.accum_pct || 0),
      _rowType: 'total'
    });

    const summaryCards = [
      { label: 'Ingresos del Periodo', value: `$${formatNum(data.total_ingresos?.period)}`, sublabel: `Acum: $${formatNum(data.total_ingresos?.accum)}` },
      { label: 'Egresos del Periodo', value: `$${formatNum(data.total_egresos?.period)}`, sublabel: `Acum: $${formatNum(data.total_egresos?.accum)}` },
      { label: 'Resultado del Periodo', value: `$${formatNum(data.utilidad?.period)}`, sublabel: `${formatPct(data.utilidad?.period_pct)}% sobre ingresos` },
      { label: 'Resultado Acumulado', value: `$${formatNum(data.utilidad?.accum)}`, sublabel: `${formatPct(data.utilidad?.accum_pct)}% sobre ingresos` },
    ];

    return {
      title: 'ESTADO DE RESULTADOS INTEGRAL',
      subtitle: 'Comparativa de Cifras del Periodo y Saldos Acumulados del Ejercicio',
      clientName: data.business_name || clientInfo?.business_name || '',
      clientRfc: data.rfc || clientInfo?.rfc || '',
      period: data.period_str || `${month || 'Anual'}/${year}`,
      columns: columnsDef,
      rows,
      summaryCards,
      notes: 'Cifras expresadas en Pesos Mexicanos (MXN) conforme a las Normas de Información Financiera (NIF B-3).',
      filename: `Estado_Resultados_${data.rfc || clientInfo?.rfc || clientId}_${year}_${month || 'Anual'}.xlsx`
    };
  };

  const handleExportExcel = () => {
    const payload = buildIncomeExportPayload();
    if (payload) exportToExcel(payload);
  };

  const handleExportPdf = () => {
    const payload = buildIncomeExportPayload();
    if (payload) exportToPdfWithLogo(payload);
  };

  const formatAmount = (val) => {
    if (val === undefined || val === null) return '0.00';
    const num = Number(val);
    if (Math.abs(num) < 0.001) return '0.00';

    if (showMinusSign) {
      return num > 0 ? `-${formatNum(num)}` : `${formatNum(Math.abs(num))}`;
    } else {
      return num < 0 ? `-${formatNum(Math.abs(num))}` : `${formatNum(num)}`;
    }
  };

  const handleExportCSV = () => {
    if (!data) return;

    let csv = `ESTADO DE RESULTADOS\n`;
    csv += `Empresa: ${data.business_name || clientInfo?.business_name || ''}\n`;
    csv += `RFC: ${data.rfc || clientInfo?.rfc || ''}\n`;
    csv += `Periodo: ${data.period_str || ''}\n`;
    csv += `Fecha de Emisión: ${data.emission_date || ''}\n\n`;
    csv += `Concepto,Periodo,%,Acumulado,%\n`;

    const addRow = (concept, pVal, pPct, aVal, aPct) => {
      csv += `"${concept}",${Number(pVal || 0).toFixed(2)},${Number(pPct || 0).toFixed(2)},${Number(aVal || 0).toFixed(2)},${Number(aPct || 0).toFixed(2)}\n`;
    };

    csv += `"Ingresos","","","",""\n`;
    (data.ingresos?.items || []).forEach(it => {
      addRow(`  ${it.name}`, it.period, it.period_pct, it.accum, it.accum_pct);
    });
    addRow(`Total Ingresos`, data.total_ingresos?.period, data.total_ingresos?.period_pct, data.total_ingresos?.accum, data.total_ingresos?.accum_pct);

    csv += `\n"Egresos","","","",""\n`;

    if (data.costos?.items && data.costos.items.length > 0) {
      csv += `"COSTOS","","","",""\n`;
      data.costos.items.forEach(it => {
        addRow(`  ${it.name}`, it.period, it.period_pct, it.accum, it.accum_pct);
      });
      addRow(`Total COSTOS`, data.costos?.total_period, data.costos?.total_period_pct, data.costos?.total_accum, data.costos?.total_accum_pct);
    }

    if (data.gastos?.items && data.gastos.items.length > 0) {
      csv += `"GASTOS","","","",""\n`;
      data.gastos.items.forEach(it => {
        addRow(`  ${it.name}`, it.period, it.period_pct, it.accum, it.accum_pct);
      });
      addRow(`Total GASTOS`, data.gastos?.total_period, data.gastos?.total_period_pct, data.gastos?.total_accum, data.gastos?.total_accum_pct);
    }

    if (data.rif) {
      csv += `"RESULTADO INTEGRAL DE FINANCIAMIENTO","","","",""\n`;
      if (data.rif.gastos_financieros) {
        addRow(`  ${data.rif.gastos_financieros.name}`, data.rif.gastos_financieros.period, data.rif.gastos_financieros.period_pct, data.rif.gastos_financieros.accum, data.rif.gastos_financieros.accum_pct);
      }
      if (data.rif.productos_financieros) {
        addRow(`  ${data.rif.productos_financieros.name}`, data.rif.productos_financieros.period, data.rif.productos_financieros.period_pct, data.rif.productos_financieros.accum, data.rif.productos_financieros.accum_pct);
      }
      addRow(`Total RESULTADO INTEGRAL DE FINANCIAMIENTO`, data.rif.total_period, data.rif.total_period_pct, data.rif.total_accum, data.rif.total_accum_pct);
    }

    if (data.impuestos_ptu) {
      csv += `"IMPUESTOS Y PTU","","","",""\n`;
      if (data.impuestos_ptu.ptu) {
        addRow(`  ${data.impuestos_ptu.ptu.name}`, data.impuestos_ptu.ptu.period, data.impuestos_ptu.ptu.period_pct, data.impuestos_ptu.ptu.accum, data.impuestos_ptu.ptu.accum_pct);
      }
      if (data.impuestos_ptu.isr) {
        addRow(`  ${data.impuestos_ptu.isr.name}`, data.impuestos_ptu.isr.period, data.impuestos_ptu.isr.period_pct, data.impuestos_ptu.isr.accum, data.impuestos_ptu.isr.accum_pct);
      }
      addRow(`Total IMPUESTOS Y PTU`, data.impuestos_ptu.total_period, data.impuestos_ptu.total_period_pct, data.impuestos_ptu.total_accum, data.impuestos_ptu.total_accum_pct);
    }

    addRow(`Total Egresos`, data.total_egresos?.period, data.total_egresos?.period_pct, data.total_egresos?.accum, data.total_egresos?.accum_pct);
    addRow(`Utilidad (o Pérdida)`, data.utilidad?.period, data.utilidad?.period_pct, data.utilidad?.accum, data.utilidad?.accum_pct);

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Estado_Resultados_${data.business_name || 'Empresa'}_${year}_${month || 'Todo'}.csv`;
    link.click();
  };

  // Renderiza una fila contable limpia (sin recuadros azules)
  const renderRow = ({
    title,
    periodVal,
    periodPct,
    accumVal,
    accumPct,
    isBold = false,
    isItalic = false,
    hasTopBorder = false,
    hasDoubleBottom = false,
    indent = 'pl-2',
    textColor = 'text-gray-900',
    bgColor = ''
  }) => {
    return (
      <div 
        className={`flex items-center py-0.5 text-xs font-mono ${bgColor} ${
          hasTopBorder ? 'border-t border-black pt-1 mt-1' : ''
        } ${hasDoubleBottom ? 'border-b-4 border-double border-black pb-1.5' : ''}`}
      >
        {/* Concepto / Nombre de la cuenta */}
        <div className={`flex-1 ${indent} ${isBold ? 'font-bold' : ''} ${isItalic ? 'italic' : ''} ${textColor} truncate`}>
          {title}
        </div>

        {/* Columna 1: Periodo Importe */}
        <div className="w-32 text-right px-2 py-0.5 font-mono text-xs">
          <span className={isBold ? 'font-bold' : ''}>{formatAmount(periodVal)}</span>
        </div>

        {/* Columna 2: Periodo % */}
        <div className="w-16 text-right pr-2 font-mono text-xs text-gray-700">
          {formatPct(periodPct)}
        </div>

        {/* Columna 3: Acumulado Importe */}
        <div className="w-32 text-right px-2 py-0.5 font-mono text-xs">
          <span className={isBold ? 'font-bold' : ''}>{formatAmount(accumVal)}</span>
        </div>

        {/* Columna 4: Acumulado % */}
        <div className="w-16 text-right pr-1 font-mono text-xs text-gray-700">
          {formatPct(accumPct)}
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 bg-gray-100 min-h-screen print:p-0 print:bg-white font-sans">
      
      {/* BARRA DE CONTROL SUPERIOR (Oculta al imprimir) */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 mb-6 print:hidden max-w-5xl mx-auto">
        <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
          <div>
            <Title level={4} className="m-0 text-gray-800 flex items-center gap-2">
              <FileTextOutlined className="text-blue-600" /> Estado de Resultados
            </Title>
            <Text type="secondary" className="text-xs">
              Comparativa de cifras del Periodo y Saldos Acumulados
            </Text>
          </div>
          <Space>
            <Tooltip title="Alternar visualización de signo negativo (-) o positivo (+)">
              <div className="flex items-center gap-2 border border-gray-200 px-3 py-1 rounded bg-gray-50 text-xs font-medium">
                <span>Signo (-):</span>
                <Switch 
                  size="small"
                  checked={showMinusSign} 
                  onChange={setShowMinusSign} 
                />
              </div>
            </Tooltip>
            <Button
              type="primary"
              icon={<FileExcelOutlined />}
              onClick={handleExportExcel}
              disabled={!data}
              className="bg-emerald-600 hover:bg-emerald-700 border-emerald-600 font-semibold shadow-sm"
            >
              Exportar Excel (.xlsx)
            </Button>
            <Button
              type="primary"
              icon={<FilePdfOutlined />}
              onClick={handleExportPdf}
              disabled={!data}
              className="bg-sky-500 hover:bg-sky-600 border-sky-500 font-semibold shadow-sm"
              style={{ backgroundColor: '#0ea5e9', borderColor: '#0ea5e9', color: '#ffffff' }}
            >
              PDF Membretado
            </Button>
            <Button icon={<PrinterOutlined />} onClick={handlePrint}>
              Imprimir
            </Button>
          </Space>
        </div>

        {/* FILTROS DE PERIODO */}
        <div className="flex flex-wrap items-end gap-4 pt-3 border-t border-gray-100">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Año:</label>
            <Select 
              value={year} 
              onChange={(val) => {
                setYear(val);
                loadStatement(val, month);
              }} 
              style={{ width: 110 }}
            >
              {[2022, 2023, 2024, 2025, 2026].map(y => (
                <Option key={y} value={y}>{y}</Option>
              ))}
            </Select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Periodo (Mes):</label>
            <Select 
              value={month} 
              onChange={(val) => {
                setMonth(val);
                loadStatement(year, val);
              }} 
              style={{ width: 170 }}
            >
              <Option value={null}>Todo el Año (Acumulado)</Option>
              <Option value={1}>Enero</Option>
              <Option value={2}>Febrero</Option>
              <Option value={3}>Marzo</Option>
              <Option value={4}>Abril</Option>
              <Option value={5}>Mayo</Option>
              <Option value={6}>Junio</Option>
              <Option value={7}>Julio</Option>
              <Option value={8}>Agosto</Option>
              <Option value={9}>Septiembre</Option>
              <Option value={10}>Octubre</Option>
              <Option value={11}>Noviembre</Option>
              <Option value={12}>Diciembre</Option>
            </Select>
          </div>

          <div>
            <Button 
              type="primary" 
              icon={<SearchOutlined />} 
              onClick={handleGenerate} 
              loading={loading}
            >
              Consultar Reporte
            </Button>
          </div>
        </div>

        {error && (
          <Alert message={error} type="error" showIcon className="mt-4" closable onClose={() => setError('')} />
        )}
      </div>

      {/* CUERPO DEL REPORTE */}
      <Spin spinning={loading}>
        {data && (
          <div className="bg-white max-w-5xl mx-auto p-8 shadow-sm border border-gray-200 print:shadow-none print:border-none print:p-0 text-black">
            
            {/* ENCABEZADO DEL REPORTE (SIN LOGOTIPO CONTPAQ i Y SIN HOJA 1) */}
            <div className="relative mb-4 flex items-start justify-between">
              {/* Espacio izquierdo para balance visual */}
              <div className="w-1/4"></div>

              {/* TÍTULO CENTRAL: NOMBRE DE EMPRESA Y FECHAS */}
              <div className="w-2/4 text-center">
                <div className="text-sm font-bold uppercase tracking-wide text-gray-900">
                  {data.business_name || clientInfo?.business_name || 'EMPRESA'}
                </div>
                <div className="text-xs font-semibold text-gray-800 mt-1">
                  Estado de Resultados {data.period_str || ''}
                </div>
              </div>

              {/* FECHA DE EMISIÓN (SIN HOJA 1) */}
              <div className="w-1/4 text-right text-xs font-mono text-gray-800">
                <div>Fecha: {data.emission_date || dayjs().format('DD/MMM/YYYY')}</div>
              </div>
            </div>

            {/* ENCABEZADO DE TABLA (DOBLE LÍNEA SOLID BLACK) */}
            <div className="border-t-2 border-b-2 border-black py-1 mb-2 text-xs font-mono font-bold flex items-center">
              <div className="flex-1 text-left pl-2">Concepto</div>
              <div className="w-32 text-right pr-2">Periodo</div>
              <div className="w-16 text-right pr-2">%</div>
              <div className="w-32 text-right pr-2">Acumulado</div>
              <div className="w-16 text-right pr-1">%</div>
            </div>

            {/* CONTENIDO DEL ESTADO DE RESULTADOS */}
            <div className="space-y-4 font-mono text-xs">
              
              {/* ==================== SECCIÓN 1: INGRESOS ==================== */}
              <div>
                <div className="text-sm font-bold italic tracking-widest text-gray-900 mb-1 pl-1">
                  I n g r e s o s
                </div>

                {/* Listado directo de las cuentas que integran el ingreso */}
                {(data.ingresos?.items || []).map((it, idx) => (
                  <React.Fragment key={it.code || idx}>
                    {renderRow({
                      title: it.name,
                      periodVal: it.period,
                      periodPct: it.period_pct,
                      accumVal: it.accum,
                      accumPct: it.accum_pct,
                      indent: 'pl-6',
                      textColor: 'text-gray-900'
                    })}
                  </React.Fragment>
                ))}

                {/* TOTAL INGRESOS */}
                {renderRow({
                  title: 'Total Ingresos',
                  periodVal: data.total_ingresos?.period,
                  periodPct: data.total_ingresos?.period_pct,
                  accumVal: data.total_ingresos?.accum,
                  accumPct: data.total_ingresos?.accum_pct,
                  isBold: true,
                  isItalic: true,
                  hasTopBorder: true,
                  indent: 'pl-2',
                  textColor: 'text-gray-900 font-bold'
                })}
              </div>

              {/* ==================== SECCIÓN 2: EGRESOS ==================== */}
              <div className="pt-2">
                <div className="text-sm font-bold italic tracking-widest text-gray-900 mb-1 pl-1">
                  E g r e s o s
                </div>

                {/* COSTOS (Si existen cuentas con saldo) */}
                {data.costos?.items && data.costos.items.length > 0 && (
                  <div className="my-1.5">
                    <div className="text-xs font-bold italic uppercase text-gray-800 pl-2 py-0.5 tracking-wider">
                      COSTOS
                    </div>
                    {data.costos.items.map((it, idx) => (
                      <React.Fragment key={it.code || idx}>
                        {renderRow({
                          title: it.name,
                          periodVal: it.period,
                          periodPct: it.period_pct,
                          accumVal: it.accum,
                          accumPct: it.accum_pct,
                          indent: 'pl-6',
                          textColor: 'text-gray-900'
                        })}
                      </React.Fragment>
                    ))}
                    {renderRow({
                      title: 'Total COSTOS',
                      periodVal: data.costos.total_period,
                      periodPct: data.costos.total_period_pct,
                      accumVal: data.costos.total_accum,
                      accumPct: data.costos.total_accum_pct,
                      indent: 'pl-2',
                      isBold: false
                    })}
                  </div>
                )}

                {/* GASTOS */}
                <div className="my-1.5">
                  <div className="text-xs font-bold italic uppercase text-gray-800 pl-2 py-0.5 tracking-wider">
                    GASTOS
                  </div>
                  {(data.gastos?.items || []).map((it, idx) => (
                    <React.Fragment key={it.code || idx}>
                      {renderRow({
                        title: it.name,
                        periodVal: it.period,
                        periodPct: it.period_pct,
                        accumVal: it.accum,
                        accumPct: it.accum_pct,
                        indent: 'pl-6',
                        textColor: 'text-gray-900'
                      })}
                    </React.Fragment>
                  ))}
                  {renderRow({
                    title: 'Total GASTOS',
                    periodVal: data.gastos?.total_period,
                    periodPct: data.gastos?.total_period_pct,
                    accumVal: data.gastos?.total_accum,
                    accumPct: data.gastos?.total_accum_pct,
                    indent: 'pl-2',
                    isBold: false
                  })}
                </div>

                {/* RESULTADO INTEGRAL DE FINANCIAMIENTO */}
                <div className="my-1.5">
                  <div className="text-xs font-bold italic uppercase text-gray-800 pl-2 py-0.5 tracking-wider">
                    RESULTADO INTEGRAL DE FINANCIAMIENTO
                  </div>
                  {renderRow({
                    title: data.rif?.gastos_financieros?.name || '701-00-000  GASTOS FINANCIEROS',
                    periodVal: data.rif?.gastos_financieros?.period,
                    periodPct: data.rif?.gastos_financieros?.period_pct,
                    accumVal: data.rif?.gastos_financieros?.accum,
                    accumPct: data.rif?.gastos_financieros?.accum_pct,
                    indent: 'pl-6'
                  })}
                  {renderRow({
                    title: data.rif?.productos_financieros?.name || '702-00-000  PRODUCTOS FINANCIEROS',
                    periodVal: data.rif?.productos_financieros?.period,
                    periodPct: data.rif?.productos_financieros?.period_pct,
                    accumVal: data.rif?.productos_financieros?.accum,
                    accumPct: data.rif?.productos_financieros?.accum_pct,
                    indent: 'pl-6'
                  })}
                  {renderRow({
                    title: 'Total RESULTADO INTEGRAL DE FINANCIAMIENTO',
                    periodVal: data.rif?.total_period,
                    periodPct: data.rif?.total_period_pct,
                    accumVal: data.rif?.total_accum,
                    accumPct: data.rif?.total_accum_pct,
                    indent: 'pl-2'
                  })}
                </div>

                {/* IMPUESTOS Y PTU */}
                <div className="my-1.5">
                  <div className="text-xs font-bold italic uppercase text-gray-800 pl-2 py-0.5 tracking-wider">
                    IMPUESTOS Y PTU
                  </div>
                  {renderRow({
                    title: data.impuestos_ptu?.ptu?.name || '607-00-000  PARTICIPACION DE LOS TRABAJADORES EN LAS UTILIDADES',
                    periodVal: data.impuestos_ptu?.ptu?.period,
                    periodPct: data.impuestos_ptu?.ptu?.period_pct,
                    accumVal: data.impuestos_ptu?.ptu?.accum,
                    accumPct: data.impuestos_ptu?.ptu?.accum_pct,
                    indent: 'pl-6'
                  })}
                  {renderRow({
                    title: data.impuestos_ptu?.isr?.name || '611-00-000  IMPUESTO SOBRE LA RENTA',
                    periodVal: data.impuestos_ptu?.isr?.period,
                    periodPct: data.impuestos_ptu?.isr?.period_pct,
                    accumVal: data.impuestos_ptu?.isr?.accum,
                    accumPct: data.impuestos_ptu?.isr?.accum_pct,
                    indent: 'pl-6'
                  })}
                  {renderRow({
                    title: 'Total IMPUESTOS Y PTU',
                    periodVal: data.impuestos_ptu?.total_period,
                    periodPct: data.impuestos_ptu?.total_period_pct,
                    accumVal: data.impuestos_ptu?.total_accum,
                    accumPct: data.impuestos_ptu?.total_accum_pct,
                    indent: 'pl-2'
                  })}
                </div>

                {/* TOTAL EGRESOS */}
                {renderRow({
                  title: 'Total Egresos',
                  periodVal: data.total_egresos?.period,
                  periodPct: data.total_egresos?.period_pct,
                  accumVal: data.total_egresos?.accum,
                  accumPct: data.total_egresos?.accum_pct,
                  isBold: true,
                  isItalic: true,
                  hasTopBorder: true,
                  indent: 'pl-2',
                  textColor: 'text-gray-900 font-bold'
                })}
              </div>

              {/* ==================== RESULTADO FINAL: UTILIDAD O PÉRDIDA ==================== */}
              <div className="pt-3">
                {renderRow({
                  title: 'Utilidad (o Pérdida)',
                  periodVal: data.utilidad?.period,
                  periodPct: data.utilidad?.period_pct,
                  accumVal: data.utilidad?.accum,
                  accumPct: data.utilidad?.accum_pct,
                  isBold: true,
                  isItalic: true,
                  hasTopBorder: true,
                  hasDoubleBottom: true,
                  indent: 'pl-2',
                  textColor: 'text-gray-900 font-bold text-sm'
                })}
              </div>

            </div>

          </div>
        )}
      </Spin>

    </div>
  );
};

export default IncomeStatement;
