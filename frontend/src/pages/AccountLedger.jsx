import React, { useState, useEffect } from 'react';
import { 
  DatePicker, Select, Button, Typography, Space, Alert, 
  Card, Tag, Row, Col, Statistic, Tooltip, Empty, Segmented, Radio
} from 'antd';
import { 
  SearchOutlined, ExportOutlined, PrinterOutlined, 
  BookOutlined, TableOutlined, FileTextOutlined,
  FilterOutlined, EyeOutlined, FileSearchOutlined,
  FileExcelOutlined, FilePdfOutlined
} from '@ant-design/icons';
import { useParams, useSearchParams } from 'react-router-dom';
import { reportsApi, accountsApi, clientsApi } from '../api/client';
import { exportToExcel, exportToPdfWithLogo } from '../utils/exportPaperwork';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

// Formateador de números en formato estándar contable mexicano (ej: 1,234.56 o 0.00)
const formatNum = (val) => {
  if (val === undefined || val === null) return '0.00';
  return Number(val).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const formatSpanishDate = (d) => {
  if (!d) return '';
  const dt = dayjs(d);
  if (!dt.isValid()) return d;
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${dt.format('DD')}/${months[dt.month()]}/${dt.format('YYYY')}`;
};

const AccountLedger = () => {
  const { clientId } = useParams();
  const [searchParams] = useSearchParams();

  const queryAcc = searchParams.get('account_id') || 'all';
  const queryFrom = searchParams.get('date_from');
  const queryTo = searchParams.get('date_to');

  const [clientInfo, setClientInfo] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Filtros iniciales respetando query params
  const [selectedAccount, setSelectedAccount] = useState(queryAcc);
  const [dateRange, setDateRange] = useState(() => {
    if (queryFrom && queryTo && dayjs(queryFrom).isValid() && dayjs(queryTo).isValid()) {
      return [dayjs(queryFrom), dayjs(queryTo)];
    }
    return [
      dayjs().startOf('year'),
      dayjs().endOf('month')
    ];
  });
  const [filterMode, setFilterMode] = useState('with_balance_or_movements');
  const [viewMode, setViewMode] = useState('clasica'); // 'clasica' | 'analitica'
  
  const [reportResult, setReportResult] = useState(null);

  useEffect(() => {
    if (clientId) {
      const currentAcc = searchParams.get('account_id') || 'all';
      const currentFrom = searchParams.get('date_from');
      const currentTo = searchParams.get('date_to');

      const activeRange = (currentFrom && currentTo && dayjs(currentFrom).isValid() && dayjs(currentTo).isValid())
        ? [dayjs(currentFrom), dayjs(currentTo)]
        : dateRange;

      if (currentFrom && currentTo && dayjs(currentFrom).isValid() && dayjs(currentTo).isValid()) {
        setDateRange(activeRange);
      }

      clientsApi.get(clientId).then(res => setClientInfo(res.data)).catch(() => {});
      accountsApi.getClientAccounts(clientId).then(res => {
        const rawAccounts = res.data || [];
        rawAccounts.sort((a, b) => a.account_number.localeCompare(b.account_number));
        setAccounts(rawAccounts);

        if (currentAcc && currentAcc !== 'all') {
          const matched = rawAccounts.find(a => String(a.id) === String(currentAcc) || a.account_number === currentAcc);
          if (matched) {
            setSelectedAccount(String(matched.id));
          }
        } else {
          setSelectedAccount('all');
        }
      }).catch(err => {
        console.error('Error al cargar cuentas:', err);
        setError('No se pudieron cargar las cuentas del cliente.');
      });

      // Cargar reporte automáticamente al inicio o al cambiar URL
      loadLedger(currentAcc, activeRange, filterMode);
    }
  }, [clientId, searchParams]);

  const loadLedger = async (accountVal, range, mode) => {
    if (!range || !range[0] || !range[1]) {
      setError('Por favor seleccione un rango de fechas válido.');
      return;
    }
    
    setLoading(true);
    setError('');
    try {
      const start = range[0].format('YYYY-MM-DD');
      const end = range[1].format('YYYY-MM-DD');
      
      const res = await reportsApi.accountLedger(clientId, {
        account_id: accountVal || 'all',
        date_from: start,
        date_to: end,
        filter_mode: mode
      });
      
      setReportResult(res.data || null);
    } catch (err) {
      console.error('Error al generar auxiliar:', err);
      const detail = err?.response?.data?.detail || 'Error al generar el reporte de libro mayor';
      setError(detail);
      setReportResult(null);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = () => {
    loadLedger(selectedAccount, dateRange, filterMode);
  };

  const handlePrint = () => {
    window.print();
  };

  const buildLedgerExportPayload = () => {
    if (!reportResult) return null;
    const columnsDef = [
      { key: 'account', title: 'Cuenta', align: 'left', format: 'text', width: 15 },
      { key: 'date', title: 'Fecha', align: 'center', format: 'text', width: 13 },
      { key: 'entry_type', title: 'Tipo Póliza', align: 'center', format: 'text', width: 12 },
      { key: 'entry_number', title: 'No.', align: 'center', format: 'text', width: 9 },
      { key: 'description', title: 'Concepto / Nombre de Cuenta', align: 'left', format: 'text', width: 38 },
      { key: 'reference', title: 'Referencia / UUID', align: 'left', format: 'text', width: 16 },
      { key: 'debit', title: 'Cargos (Debe)', align: 'right', format: 'currency', width: 16 },
      { key: 'credit', title: 'Abonos (Haber)', align: 'right', format: 'currency', width: 16 },
      { key: 'balance', title: 'Saldo', align: 'right', format: 'currency', width: 18 },
    ];

    const rows = [];
    mayorAccountsList.forEach(m => {
      rows.push({
        account: m.account_number,
        date: '',
        entry_type: 'MAYOR',
        entry_number: '',
        description: `${m.account_name} (CUENTA DE MAYOR)`,
        reference: 'Saldo Inicial:',
        debit: '',
        credit: '',
        balance: Number(m.initial_balance || 0),
        _rowType: 'section'
      });

      (m.subaccounts || []).forEach(sub => {
        rows.push({
          account: sub.account_number,
          date: '',
          entry_type: 'SUBCUENTA',
          entry_number: '',
          description: `   ${sub.account_name}`,
          reference: 'Saldo Inicial:',
          debit: '',
          credit: '',
          balance: Number(sub.initial_balance || 0),
          _rowType: 'subtotal'
        });

        (sub.movements || []).forEach(mov => {
          rows.push({
            account: '',
            date: formatSpanishDate(mov.date),
            entry_type: mov.entry_type || '',
            entry_number: mov.entry_number || '',
            description: `      ${mov.description || ''}`,
            reference: mov.reference || (mov.cfdi_uuid ? mov.cfdi_uuid.slice(0, 8) : ''),
            debit: Number(mov.debit || 0),
            credit: Number(mov.credit || 0),
            balance: Number(mov.final_balance || 0),
            _rowType: 'normal'
          });
        });

        rows.push({
          account: '',
          date: '',
          entry_type: '',
          entry_number: '',
          description: `   Total Subcuenta: ${sub.account_name}`,
          reference: '',
          debit: Number(sub.total_debit || 0),
          credit: Number(sub.total_credit || 0),
          balance: Number(sub.final_balance || 0),
          _rowType: 'subtotal'
        });
      });

      rows.push({
        account: m.account_number,
        date: '',
        entry_type: '',
        entry_number: '',
        description: `Total Cuenta de Mayor: ${m.account_name}`,
        reference: '',
        debit: Number(m.total_debit || 0),
        credit: Number(m.total_credit || 0),
        balance: Number(m.final_balance || 0),
        _rowType: 'subtotal'
      });
    });

    if (reportResult.grand_total) {
      rows.push({
        account: '',
        date: '',
        entry_type: '',
        entry_number: '',
        description: 'GRAN TOTAL DEL LIBRO MAYOR',
        reference: '',
        debit: Number(reportResult.grand_total.total_debit || 0),
        credit: Number(reportResult.grand_total.total_credit || 0),
        balance: Number(reportResult.grand_total.final_balance || 0),
        _rowType: 'total'
      });
    }

    const summaryCards = [
      { label: 'Saldo Inicial Total', value: `$${formatNum(reportResult.grand_total?.initial_balance || 0)}`, sublabel: 'Inicio del periodo' },
      { label: 'Total Cargos (Debe)', value: `$${formatNum(reportResult.grand_total?.total_debit || 0)}`, sublabel: 'Movimientos deudores' },
      { label: 'Total Abonos (Haber)', value: `$${formatNum(reportResult.grand_total?.total_credit || 0)}`, sublabel: 'Movimientos acreedores' },
      { label: 'Saldo Final Total', value: `$${formatNum(reportResult.grand_total?.final_balance || 0)}`, sublabel: 'Cierre del periodo' },
    ];

    return {
      title: 'LIBRO MAYOR Y AUXILIAR DE CUENTAS',
      subtitle: 'Auxiliar Contable con Desglose de Subcuentas, Pólizas, Referencias CFDI y Saldos',
      clientName: reportResult.business_name || clientInfo?.business_name || '',
      clientRfc: reportResult.rfc || clientInfo?.rfc || '',
      period: `${formatSpanishDate(reportResult.date_from)} al ${formatSpanishDate(reportResult.date_to)}`,
      columns: columnsDef,
      rows,
      summaryCards,
      notes: 'Auxiliar contable emitido en Pesos Mexicanos (MXN). Incluye saldos iniciales, cargos, abonos y saldo acumulado por cuenta.',
      filename: `Libro_Mayor_${reportResult.rfc || clientInfo?.rfc || clientId}_${dateRange[0].format('YYYYMMDD')}_${dateRange[1].format('YYYYMMDD')}.xlsx`
    };
  };

  const handleExportExcel = () => {
    const payload = buildLedgerExportPayload();
    if (payload) exportToExcel(payload);
  };

  const handleExportPdf = () => {
    const payload = buildLedgerExportPayload();
    if (payload) exportToPdfWithLogo(payload);
  };

  const handleExportCSV = () => {
    if (!reportResult) return;

    let csv = `LIBRO MAYOR Y AUXILIAR DE CUENTAS\n`;
    csv += `Empresa: ${reportResult.business_name || clientInfo?.business_name || ''}\n`;
    csv += `RFC: ${reportResult.rfc || clientInfo?.rfc || ''}\n`;
    csv += `Periodo: ${formatSpanishDate(reportResult.date_from)} al ${formatSpanishDate(reportResult.date_to)}\n`;
    csv += `Moneda: ${reportResult.currency || 'Peso Mexicano'}\n`;
    csv += `Fecha de Emisión: ${formatSpanishDate(reportResult.emission_date || dayjs())}\n\n`;

    csv += `Cuenta,Fecha,Tipo,Número,Concepto,Referencia,Cargos,Abonos,Saldo\n`;

    const accountList = mayorAccountsList;

    accountList.forEach(m => {
      csv += `"${m.account_number}","","","","${m.account_name} - [CUENTA DE MAYOR]","Saldo inicial :","","",${m.initial_balance.toFixed(2)}\n`;

      (m.subaccounts || []).forEach(sub => {
        csv += `"${sub.account_number}","","","","${sub.account_name}","Saldo inicial :","","",${sub.initial_balance.toFixed(2)}\n`;

        (sub.movements || []).forEach(mov => {
          const fDate = formatSpanishDate(mov.date);
          const fTipo = mov.entry_type || '';
          const fNum = mov.entry_number || '';
          const fDesc = `"${(mov.description || '').replace(/"/g, '""')}"`;
          const fRef = `"${(mov.reference || '').replace(/"/g, '""')}"`;
          const fDeb = mov.debit > 0 ? mov.debit.toFixed(2) : '';
          const fCred = mov.credit > 0 ? mov.credit.toFixed(2) : '';
          const fSal = mov.final_balance.toFixed(2);
          csv += `,"${fDate}","${fTipo}","${fNum}",${fDesc},${fRef},${fDeb},${fCred},${fSal}\n`;
        });

        csv += `,"","","","Total: ${sub.account_name}","",${sub.total_debit.toFixed(2)},${sub.total_credit.toFixed(2)},${sub.final_balance.toFixed(2)}\n`;
      });

      csv += `,"","","","Total: ${m.account_name}","",${m.total_debit.toFixed(2)},${m.total_credit.toFixed(2)},${m.final_balance.toFixed(2)}\n\n`;
    });

    if (reportResult.grand_total) {
      csv += `,"","","","GRAN TOTAL:","",${reportResult.grand_total.total_debit.toFixed(2)},${reportResult.grand_total.total_credit.toFixed(2)},${reportResult.grand_total.final_balance.toFixed(2)}\n`;
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Libro_Mayor_${dateRange[0].format('YYYYMMDD')}_${dateRange[1].format('YYYYMMDD')}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  // Opciones del selector de cuentas
  const accountOptions = [
    {
      value: 'all',
      label: '★ TODAS LAS CUENTAS DE MAYOR (REPORTE COMPLETO)'
    },
    ...accounts.map(a => ({
      value: String(a.id),
      label: `${a.account_number} - ${a.name} [${a.classification || (a.level === 3 ? 'Afectable' : 'Acumulación')}]`
    }))
  ];

  const mayorAccountsList = (reportResult?.accounts || []).map(m => {
    if (filterMode === 'with_movements_only') {
      const subs = (m.subaccounts || []).filter(s => (s.movements && s.movements.length > 0) || s.total_debit > 0 || s.total_credit > 0);
      return { ...m, subaccounts: subs };
    } else if (filterMode === 'with_balance_or_movements') {
      const subs = (m.subaccounts || []).filter(s => 
        (s.movements && s.movements.length > 0) ||
        s.total_debit > 0.001 ||
        s.total_credit > 0.001 ||
        Math.abs(s.initial_balance || 0) > 0.001 ||
        Math.abs(s.final_balance || 0) > 0.001
      );
      return { ...m, subaccounts: subs };
    }
    return m;
  }).filter(m => {
    if (filterMode === 'all') return true;
    return m.subaccounts.length > 0 || Math.abs(m.initial_balance || 0) > 0.001 || Math.abs(m.final_balance || 0) > 0.001;
  });

  return (
    <div className="p-4 bg-gray-100 min-h-screen print:p-0 print:bg-white">
      {/* BARRA DE CONTROL SUPERIOR (Oculta al imprimir) */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 mb-6 print:hidden">
        <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
          <div>
            <Title level={3} className="m-0 text-gray-800 flex items-center gap-2">
              <BookOutlined className="text-blue-600" /> Libro Mayor y Auxiliar de Cuentas
            </Title>
            <Text type="secondary" className="text-sm">
              Formato oficial contable mexicano con desglose de subcuentas, movimientos y saldos iniciales
            </Text>
          </div>
          <Space>
            <Segmented
              value={viewMode}
              onChange={setViewMode}
              options={[
                { label: 'Vista Clásica (Oficial)', value: 'clasica', icon: <FileTextOutlined /> },
                { label: 'Vista Analítica', value: 'analitica', icon: <TableOutlined /> }
              ]}
            />
            <Button
              type="primary"
              icon={<FileExcelOutlined />}
              onClick={handleExportExcel}
              disabled={!reportResult}
              className="bg-emerald-600 hover:bg-emerald-700 border-emerald-600 font-semibold shadow-sm"
            >
              Exportar Excel (.xlsx)
            </Button>
            <Button
              type="primary"
              icon={<FilePdfOutlined />}
              onClick={handleExportPdf}
              disabled={!reportResult}
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

        {/* FILTROS PRINCIPALES */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end pt-2 border-t border-gray-100">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
              Cuenta a Consultar:
            </label>
            <Select
              style={{ width: '100%' }}
              value={selectedAccount}
              onChange={setSelectedAccount}
              options={accountOptions}
              showSearch
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
              Periodo de Fechas:
            </label>
            <RangePicker
              value={dateRange}
              onChange={setDateRange}
              format="DD/MM/YYYY"
              style={{ width: '100%' }}
              allowClear={false}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
              Filtro de Cuentas:
            </label>
            <Select
              style={{ width: '100%' }}
              value={filterMode}
              onChange={(val) => {
                setFilterMode(val);
                loadLedger(selectedAccount, dateRange, val);
              }}
              options={[
                { 
                  value: 'with_balance_or_movements', 
                  label: 'Solo cuentas con saldo o movimientos' 
                },
                { 
                  value: 'with_movements_only', 
                  label: 'Solo cuentas con movimientos en el periodo' 
                },
                { 
                  value: 'all', 
                  label: 'Todas las cuentas del catálogo (incluye ceros)' 
                }
              ]}
            />
          </div>

          <div>
            <Button
              type="primary"
              icon={<SearchOutlined />}
              onClick={handleGenerate}
              loading={loading}
              block
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
      {reportResult && (
        <>
          {/* MODO 1: VISTA CLÁSICA (IDÉNTICA AL FORMATO DE CONTABILIDAD OFICIAL CONTPAQi / COI) */}
          {viewMode === 'clasica' && (
            <div className="bg-white max-w-5xl mx-auto p-8 shadow-sm border border-gray-200 print:shadow-none print:border-none print:p-0 print:max-w-none text-black font-sans">
              
              {/* ENCABEZADO DEL REPORTE */}
              <div className="relative mb-6 text-center">
                <div className="absolute right-0 top-0 text-right text-xs font-mono">
                  <div>Fecha: {formatSpanishDate(reportResult.emission_date || dayjs())}</div>
                </div>

                <div className="text-base font-bold uppercase tracking-wider text-gray-900">
                  {reportResult.business_name || clientInfo?.business_name || 'EMPRESA'}
                </div>
                <div className="text-sm font-semibold text-gray-800">
                  Libro Mayor del {formatSpanishDate(reportResult.date_from)} al {formatSpanishDate(reportResult.date_to)}
                </div>
                <div className="text-xs text-gray-600">
                  Moneda: {reportResult.currency || 'Peso Mexicano'}
                </div>
              </div>

              {/* ENCABEZADO DE TABLA (DOBLE LÍNEA SOLID BLACK) */}
              <div className="border-t-2 border-b-2 border-black py-1 mb-4 text-xs font-mono font-bold">
                {/* FILA 1 DE ENCABEZADO */}
                <div className="flex">
                  <div className="w-28 text-left">Cuenta</div>
                  <div className="flex-1 text-left">Nombre</div>
                  <div className="w-28 text-right">Saldo Inicial</div>
                </div>
                {/* FILA 2 DE ENCABEZADO */}
                <div className="flex pt-1 border-t border-gray-200">
                  <div className="w-24 text-left">Fecha</div>
                  <div className="w-20 text-left">Tipo</div>
                  <div className="w-16 text-left">Número</div>
                  <div className="flex-1 text-left px-2">Concepto</div>
                  <div className="w-20 text-left px-1">Ref.</div>
                  <div className="w-24 text-right">Cargos</div>
                  <div className="w-24 text-right">Abonos</div>
                  <div className="w-28 text-right">Saldo</div>
                </div>
              </div>

              {/* LISTADO DE CUENTAS DE MAYOR Y SUBCUENTAS */}
              {mayorAccountsList.length === 0 ? (
                <div className="text-center py-12 text-gray-500 font-mono text-sm">
                  No se encontraron cuentas con los criterios de filtro seleccionados.
                </div>
              ) : (
                <div className="space-y-6 text-xs font-mono">
                  {mayorAccountsList.map((m) => (
                    <div key={m.id} className="break-inside-avoid">
                      
                      {/* FILA: CUENTA DE MAYOR */}
                      <div className="flex items-center font-bold text-gray-900 py-1 bg-gray-50 print:bg-transparent">
                        <div className="w-28 text-left">{m.account_number}</div>
                        <div className="flex-1 text-left uppercase">{m.account_name}</div>
                        <div className="w-48 text-right text-gray-600">Saldo inicial :</div>
                        <div className="w-28 text-right font-bold">{formatNum(m.initial_balance)}</div>
                      </div>

                      {/* BUCLE DE SUBCUENTAS */}
                      {(m.subaccounts || []).map((sub) => (
                        <div key={sub.id} className="mt-2 pl-4">
                          {/* FILA DE SUBCUENTA */}
                          <div className="flex items-center text-gray-800 py-0.5">
                            <div className="w-28 text-left font-medium">{sub.account_number}</div>
                            <div className="flex-1 text-left font-medium">{sub.account_name}</div>
                            <div className="w-48 text-right text-gray-500">Saldo inicial :</div>
                            <div className="w-28 text-right font-medium">{formatNum(sub.initial_balance)}</div>
                          </div>

                          {/* MOVIMIENTOS DE LA SUBCUENTA */}
                          {(sub.movements || []).map((mov) => (
                            <div key={mov.id} className="flex items-center py-0.5 text-gray-700 hover:bg-blue-50/50 print:hover:bg-transparent">
                              <div className="w-24 text-left">{formatSpanishDate(mov.date)}</div>
                              <div className="w-20 text-left">{mov.entry_type}</div>
                              <div className="w-16 text-left">
                                {mov.entry_id ? (
                                  <Tooltip title={`Consultar Póliza #${mov.entry_number} (${mov.entry_type}) en nueva ventana`}>
                                    <a
                                      href={`/journal-viewer/${mov.entry_id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-600 hover:text-blue-900 font-bold underline cursor-pointer inline-flex items-center gap-0.5"
                                    >
                                      <span>{mov.entry_number}</span>
                                      <FileSearchOutlined style={{ fontSize: '10px' }} className="print:hidden opacity-70" />
                                    </a>
                                  </Tooltip>
                                ) : (
                                  <span>{mov.entry_number}</span>
                                )}
                              </div>
                              <div className="flex-1 text-left px-2 truncate" title={mov.description}>
                                {mov.description}
                              </div>
                              <div className="w-20 text-left px-1 truncate text-gray-500" title={mov.reference || mov.cfdi_uuid}>
                                {mov.reference || (mov.cfdi_uuid ? mov.cfdi_uuid.slice(0, 8) : '')}
                              </div>
                              <div className="w-24 text-right font-mono">
                                {mov.debit > 0 ? formatNum(mov.debit) : ''}
                              </div>
                              <div className="w-24 text-right font-mono">
                                {mov.credit > 0 ? formatNum(mov.credit) : ''}
                              </div>
                              <div className="w-28 text-right font-mono font-medium">
                                {formatNum(mov.final_balance)}
                              </div>
                            </div>
                          ))}

                          {/* TOTAL DE LA SUBCUENTA */}
                          <div className="flex items-center py-1 mt-0.5 text-gray-900 border-t border-gray-100">
                            <div className="flex-1"></div>
                            <div className="w-20 text-right font-bold pr-2">Total:</div>
                            <div className="w-24 text-right font-bold">{formatNum(sub.total_debit)}</div>
                            <div className="w-24 text-right font-bold">{formatNum(sub.total_credit)}</div>
                            <div className="w-28 text-right font-bold">{formatNum(sub.final_balance)}</div>
                          </div>
                        </div>
                      ))}

                      {/* TOTAL DE LA CUENTA DE MAYOR */}
                      <div className="mt-2 pt-1 border-t border-black flex items-center font-bold text-gray-900">
                        <div className="flex-1"></div>
                        <div className="w-20 text-right pr-2">Total:</div>
                        <div className="w-24 text-right">{formatNum(m.total_debit)}</div>
                        <div className="w-24 text-right">{formatNum(m.total_credit)}</div>
                        <div className="w-28 text-right">{formatNum(m.final_balance)}</div>
                      </div>
                    </div>
                  ))}

                  {/* GRAN TOTAL DEL REPORTE */}
                  {reportResult.grand_total && (
                    <div className="mt-8 pt-2 pb-2 border-t-2 border-b-2 border-black flex items-center font-bold text-sm bg-gray-50 print:bg-transparent">
                      <div className="flex-1 text-right uppercase pr-4">Gran Total:</div>
                      <div className="w-24 text-right">{formatNum(reportResult.grand_total.total_debit)}</div>
                      <div className="w-24 text-right">{formatNum(reportResult.grand_total.total_credit)}</div>
                      <div className="w-28 text-right">{formatNum(reportResult.grand_total.final_balance)}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* MODO 2: VISTA ANALÍTICA (TARJETAS Y TABLAS INTERACTIVAS) */}
          {viewMode === 'analitica' && (
            <div className="space-y-6">
              {/* TARJETAS DE SUMATORIA GENERAL */}
              <Row gutter={[16, 16]}>
                <Col xs={12} sm={6}>
                  <Card className="shadow-sm border-l-4 border-l-blue-500">
                    <Statistic 
                      title={<span className="text-xs uppercase text-gray-500 font-bold">Saldo Inicial Total</span>}
                      value={reportResult.grand_total?.initial_balance || 0}
                      precision={2}
                      prefix="$"
                    />
                  </Card>
                </Col>
                <Col xs={12} sm={6}>
                  <Card className="shadow-sm border-l-4 border-l-green-500">
                    <Statistic 
                      title={<span className="text-xs uppercase text-gray-500 font-bold">Total Cargos (Debe)</span>}
                      value={reportResult.grand_total?.total_debit || 0}
                      precision={2}
                      prefix="$"
                    />
                  </Card>
                </Col>
                <Col xs={12} sm={6}>
                  <Card className="shadow-sm border-l-4 border-l-red-500">
                    <Statistic 
                      title={<span className="text-xs uppercase text-gray-500 font-bold">Total Abonos (Haber)</span>}
                      value={reportResult.grand_total?.total_credit || 0}
                      precision={2}
                      prefix="$"
                    />
                  </Card>
                </Col>
                <Col xs={12} sm={6}>
                  <Card className="shadow-sm border-l-4 border-l-purple-500">
                    <Statistic 
                      title={<span className="text-xs uppercase text-gray-500 font-bold">Saldo Final Total</span>}
                      value={reportResult.grand_total?.final_balance || 0}
                      precision={2}
                      prefix="$"
                    />
                  </Card>
                </Col>
              </Row>

              {/* LISTADO DE CUENTAS DE MAYOR */}
              {mayorAccountsList.map((m) => (
                <Card 
                  key={m.id} 
                  className="shadow-sm border border-gray-200"
                  title={
                    <div className="flex flex-wrap justify-between items-center py-1">
                      <Space>
                        <Tag color="blue" className="text-sm font-bold font-mono">{m.account_number}</Tag>
                        <span className="text-base font-bold text-gray-800">{m.account_name}</span>
                        <Tag color={m.nature?.toLowerCase().startsWith('d') ? 'green' : 'orange'}>
                          {m.nature?.toUpperCase()}
                        </Tag>
                      </Space>
                      <div className="text-sm font-mono space-x-4">
                        <span>Inicial: <strong>${formatNum(m.initial_balance)}</strong></span>
                        <span>Cargos: <strong className="text-blue-600">${formatNum(m.total_debit)}</strong></span>
                        <span>Abonos: <strong className="text-red-600">${formatNum(m.total_credit)}</strong></span>
                        <span>Final: <strong className="text-purple-600">${formatNum(m.final_balance)}</strong></span>
                      </div>
                    </div>
                  }
                >
                  <div className="space-y-4">
                    {(m.subaccounts || []).map((sub) => (
                      <div key={sub.id} className="border border-gray-100 rounded-lg p-3 bg-gray-50">
                        <div className="flex justify-between items-center mb-2 pb-1 border-b border-gray-200">
                          <Space>
                            <span className="font-mono font-bold text-blue-700">{sub.account_number}</span>
                            <span className="font-semibold">{sub.account_name}</span>
                            <Tag>{sub.movements_count} movimientos</Tag>
                          </Space>
                          <div className="text-xs font-mono space-x-3">
                            <span>Inicial: ${formatNum(sub.initial_balance)}</span>
                            <span>Debe: ${formatNum(sub.total_debit)}</span>
                            <span>Haber: ${formatNum(sub.total_credit)}</span>
                            <span>Final: <strong>${formatNum(sub.final_balance)}</strong></span>
                          </div>
                        </div>

                        {sub.movements && sub.movements.length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs font-mono bg-white rounded border border-gray-200">
                              <thead className="bg-gray-100 text-gray-600">
                                <tr>
                                  <th className="p-2 text-left">Fecha</th>
                                  <th className="p-2 text-left">Póliza</th>
                                  <th className="p-2 text-left">Tipo</th>
                                  <th className="p-2 text-left">Concepto</th>
                                  <th className="p-2 text-left">Ref / UUID</th>
                                  <th className="p-2 text-right">Saldo Inicial</th>
                                  <th className="p-2 text-right">Debe</th>
                                  <th className="p-2 text-right">Haber</th>
                                  <th className="p-2 text-right">Saldo Final</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {sub.movements.map((mov) => (
                                  <tr key={mov.id} className="hover:bg-gray-50">
                                    <td className="p-2">{formatSpanishDate(mov.date)}</td>
                                    <td className="p-2 font-bold">
                                      {mov.entry_id ? (
                                        <Tooltip title={`Ver Póliza #${mov.entry_number} en nueva ventana`}>
                                          <a
                                            href={`/journal-viewer/${mov.entry_id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:text-blue-900 underline inline-flex items-center gap-1 cursor-pointer"
                                          >
                                            <span>{mov.entry_number}</span>
                                            <FileSearchOutlined style={{ fontSize: '11px' }} />
                                          </a>
                                        </Tooltip>
                                      ) : (
                                        mov.entry_number
                                      )}
                                    </td>
                                    <td className="p-2">
                                      <Tag color={mov.entry_type === 'Ingresos' ? 'green' : (mov.entry_type === 'Egresos' ? 'red' : 'blue')}>
                                        {mov.entry_type}
                                      </Tag>
                                    </td>
                                    <td className="p-2 max-w-xs truncate" title={mov.description}>{mov.description}</td>
                                    <td className="p-2 text-gray-400 truncate max-w-[100px]">{mov.reference || mov.cfdi_uuid}</td>
                                    <td className="p-2 text-right text-gray-500">${formatNum(mov.initial_balance)}</td>
                                    <td className="p-2 text-right text-green-700 font-medium">{mov.debit > 0 ? `$${formatNum(mov.debit)}` : '-'}</td>
                                    <td className="p-2 text-right text-red-700 font-medium">{mov.credit > 0 ? `$${formatNum(mov.credit)}` : '-'}</td>
                                    <td className="p-2 text-right font-bold text-gray-900">${formatNum(mov.final_balance)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="text-gray-400 text-xs italic py-1">
                            Sin movimientos registrados en este periodo (Saldo mantenido: ${formatNum(sub.final_balance)}).
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AccountLedger;
