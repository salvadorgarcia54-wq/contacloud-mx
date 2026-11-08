import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Table, Row, Col, Select, Button, Typography, Alert, Spin, Tag, Statistic, Tabs, Input, Space, Checkbox, Tooltip, Modal, message } from 'antd';
import { 
  CalculatorOutlined, 
  PrinterOutlined, 
  ArrowUpOutlined, 
  ArrowDownOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  SearchOutlined,
  UndoOutlined,
  FileSearchOutlined,
  SwapOutlined,
  EyeOutlined,
  FileExcelOutlined,
  FilePdfOutlined
} from '@ant-design/icons';
import { fiscalApi, clientsApi } from '../api/client';
import { exportToExcel, exportToPdfWithLogo } from '../utils/exportPaperwork';
import ConciliacionIvaMatrix from '../components/ConciliacionIvaMatrix';

const { Title, Text } = Typography;
const { Option } = Select;

const FiscalIva = () => {
  const { clientId } = useParams();
  const [loading, setLoading] = useState(true);
  const [clientInfo, setClientInfo] = useState(null);
  const [data, setData] = useState(null);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(2);
  const [activeTab, setActiveTab] = useState('emitidos');
  const [searchEmitidos, setSearchEmitidos] = useState('');
  const [searchRecibidos, setSearchRecibidos] = useState('');
  const [error, setError] = useState(null);

  // Clave de almacenamiento local para guardar los comprobantes omitidos por cliente y periodo
  const storageKey = `fiscal_iva_omitted_${clientId}_${year}_${month}`;
  const [omittedIds, setOmittedIds] = useState(() => {
    try {
      const saved = localStorage.getItem(`fiscal_iva_omitted_${clientId}_${year}_${month}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Al cambiar cliente, año o mes, cargar las omisiones correspondientes
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`fiscal_iva_omitted_${clientId}_${year}_${month}`);
      setOmittedIds(saved ? JSON.parse(saved) : []);
    } catch {
      setOmittedIds([]);
    }
  }, [clientId, year, month]);

  // Alternar el estado de omisión de un comprobante
  const toggleOmit = (id) => {
    setOmittedIds((prev) => {
      const updated = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(storageKey, JSON.stringify(updated));
      } catch (e) {
        console.error('Error guardando omisiones:', e);
      }
      return updated;
    });
  };

  // Restablecer todas las omisiones
  const resetOmitted = () => {
    setOmittedIds([]);
    try {
      localStorage.removeItem(storageKey);
    } catch (e) {
      console.error('Error al restablecer omisiones:', e);
    }
  };

  const formatMoney = (val) => {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
    }).format(val || 0);
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [clientRes, ivaRes] = await Promise.all([
        clientsApi.get(clientId),
        fiscalApi.getIvaReport(clientId, { year, month })
      ]);
      setClientInfo(clientRes.data);
      setData(ivaRes.data);
    } catch (err) {
      console.error('Error fetching IVA calculation:', err);
      setError('No se pudo cargar el cálculo de IVA del periodo.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (clientId) {
      fetchData();
    }
  }, [clientId, year, month]);

  const handlePrint = () => {
    window.print();
  };

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const buildIvaExportPayload = () => {
    if (!data) return null;
    const columnsDef = [
      { key: 'flujo', title: 'Tipo Flujo', align: 'center', format: 'text', width: 16 },
      { key: 'date', title: 'Fecha', align: 'center', format: 'text', width: 13 },
      { key: 'folio', title: 'Folio / UUID', align: 'left', format: 'text', width: 18 },
      { key: 'rfc', title: 'RFC Tercero', align: 'left', format: 'text', width: 16 },
      { key: 'name', title: 'Cliente / Proveedor', align: 'left', format: 'text', width: 32 },
      { key: 'payment_method', title: 'Método', align: 'center', format: 'text', width: 10 },
      { key: 'base_16', title: 'Base 16%', align: 'right', format: 'currency', width: 16 },
      { key: 'iva', title: 'IVA 16%', align: 'right', format: 'currency', width: 16 },
      { key: 'retencion_iva', title: 'Ret. IVA', align: 'right', format: 'currency', width: 14 },
      { key: 'total', title: 'Total CFDI', align: 'right', format: 'currency', width: 16 },
    ];

    const rows = [];
    rows.push({
      flujo: 'EMITIDOS', date: '', folio: '', rfc: '',
      name: 'I. CFDI EMITIDOS COBRADOS (IVA TRASLADADO CAUSADO)',
      payment_method: '', base_16: '', iva: '', retencion_iva: '', total: '',
      _rowType: 'section'
    });

    activeEmitidosAll.forEach(r => {
      rows.push({
        flujo: 'Emitido',
        date: r.date || '',
        folio: r.folio || (r.uuid ? r.uuid.slice(0, 8) : ''),
        rfc: r.rfc || '',
        name: r.name || '',
        payment_method: r.payment_method || 'PUE',
        base_16: Number(r.base_16 || 0),
        iva: Number(r.iva || 0),
        retencion_iva: Number(r.retencion_iva || 0),
        total: Number(r.total || 0),
        _rowType: 'normal'
      });
    });

    rows.push({
      flujo: '', date: '', folio: '', rfc: '',
      name: 'SUBTOTAL IVA TRASLADADO (EMITIDOS COBRADOS)',
      payment_method: '',
      base_16: activeEmitidosTotals.base_16,
      iva: activeEmitidosTotals.iva,
      retencion_iva: activeEmitidosTotals.retencion_iva,
      total: activeEmitidosTotals.total,
      _rowType: 'subtotal'
    });

    rows.push({
      flujo: 'RECIBIDOS', date: '', folio: '', rfc: '',
      name: 'II. CFDI RECIBIDOS PAGADOS (IVA ACREDITABLE)',
      payment_method: '', base_16: '', iva: '', retencion_iva: '', total: '',
      _rowType: 'section'
    });

    activeRecibidosAll.forEach(r => {
      rows.push({
        flujo: 'Recibido',
        date: r.date || '',
        folio: r.folio || (r.uuid ? r.uuid.slice(0, 8) : ''),
        rfc: r.rfc || '',
        name: r.name || '',
        payment_method: r.payment_method || 'PUE',
        base_16: Number(r.base_16 || 0),
        iva: Number(r.iva || 0),
        retencion_iva: Number(r.retencion_iva || 0),
        total: Number(r.total || 0),
        _rowType: 'normal'
      });
    });

    rows.push({
      flujo: '', date: '', folio: '', rfc: '',
      name: 'SUBTOTAL IVA ACREDITABLE (RECIBIDOS PAGADOS)',
      payment_method: '',
      base_16: activeRecibidosTotals.base_16,
      iva: activeRecibidosTotals.iva,
      retencion_iva: activeRecibidosTotals.retencion_iva,
      total: activeRecibidosTotals.total,
      _rowType: 'subtotal'
    });

    rows.push({
      flujo: '', date: '', folio: '', rfc: '',
      name: dynamicIvaCargo > 0 ? '(=) IMPUESTO AL VALOR AGREGADO A CARGO DEL PERIODO' : '(=) SALDO A FAVOR DE IVA DEL PERIODO',
      payment_method: '',
      base_16: dynamicBaseCausado16 - dynamicBaseAcreditable16,
      iva: dynamicIvaCargo > 0 ? dynamicIvaCargo : -dynamicIvaFavor,
      retencion_iva: dynamicRetenciones,
      total: activeEmitidosTotals.total - activeRecibidosTotals.total,
      _rowType: 'total'
    });

    const summaryCards = [
      { label: 'IVA Trasladado (Causado)', value: formatMoney(dynamicIvaCausado), sublabel: `Base 16%: ${formatMoney(dynamicBaseCausado16)}` },
      { label: '(-) IVA Acreditable (Pagado)', value: formatMoney(dynamicIvaAcreditable), sublabel: `Base 16%: ${formatMoney(dynamicBaseAcreditable16)}` },
      { label: '(-) Retenciones de IVA', value: formatMoney(dynamicRetenciones), sublabel: 'Retenido al contribuyente' },
      {
        label: dynamicIvaCargo > 0 ? '(=) IVA A CARGO' : '(=) SALDO A FAVOR',
        value: formatMoney(dynamicIvaCargo > 0 ? dynamicIvaCargo : dynamicIvaFavor),
        sublabel: dynamicIvaCargo > 0 ? 'Enterar en declaración mensual' : 'Acreditable / Devolución'
      },
    ];

    return {
      title: 'PAPEL DE TRABAJO — DETERMINACIÓN MENSUAL DE IVA',
      subtitle: 'Cédula de Flujo de Efectivo (CFDI PUE y Complementos de Pago Efectivamente Cobrados y Pagados)',
      clientName: clientInfo?.business_name || '',
      clientRfc: clientInfo?.rfc || '',
      period: `${String(month).padStart(2, '0')} - ${monthNames[month - 1]} ${year}`,
      columns: columnsDef,
      rows,
      summaryCards,
      notes: `Papel de trabajo elaborado conforme a la Ley del IVA (flujo de efectivo). Comprobantes omitidos manualmente: ${omittedIds.length}.`,
      filename: `Papel_Trabajo_IVA_${clientInfo?.rfc || clientId}_${year}_${String(month).padStart(2, '0')}.xlsx`
    };
  };

  const handleExportExcel = () => {
    const payload = buildIvaExportPayload();
    if (payload) exportToExcel(payload);
  };

  const handleExportPdf = () => {
    const payload = buildIvaExportPayload();
    if (payload) exportToPdfWithLogo(payload);
  };

  const [traspasoModalVisible, setTraspasoModalVisible] = useState(false);
  const [generatingTraspaso, setGeneratingTraspaso] = useState(false);

  const handleExecuteTraspaso = async () => {
    setGeneratingTraspaso(true);
    try {
      const res = await fiscalApi.generarTraspasoIva(clientId, {
        year,
        month,
        iva_trasladado: dynamicIvaCausado,
        iva_acreditable: dynamicIvaAcreditable,
      });
      message.success(res.data.message || 'Póliza de traspaso de IVA generada con éxito.');
      setTraspasoModalVisible(false);
      await fetchData();
    } catch (err) {
      console.error('Error al generar traspaso de IVA:', err);
      message.error(err?.response?.data?.detail || 'No se pudo generar la póliza de traspasos de IVA.');
    } finally {
      setGeneratingTraspaso(false);
    }
  };

  // Separación de comprobantes ordenados de la fecha más antigua a la más reciente
  const allInvoices = [...(data?.invoices || [])].sort(
    (a, b) => (a.date || '').localeCompare(b.date || '') || (a.id || 0) - (b.id || 0)
  );
  const emitidosAll = allInvoices.filter(i => i.cfdi_type === 'emitido');
  const recibidosAll = allInvoices.filter(i => i.cfdi_type === 'recibido');

  // Comprobantes activos (no omitidos) a nivel global del periodo para el cálculo
  const activeEmitidosAll = emitidosAll.filter(i => !omittedIds.includes(i.id));
  const activeRecibidosAll = recibidosAll.filter(i => !omittedIds.includes(i.id));

  // Totales acumulados para las tarjetas de cálculo mensual
  const activeEmitidosTotals = activeEmitidosAll.reduce((acc, r) => {
    acc.base_16 += Number(r.base_16) || 0;
    acc.iva += Number(r.iva) || 0;
    acc.retencion_iva += Number(r.retencion_iva) || 0;
    acc.total += Number(r.total) || 0;
    return acc;
  }, { base_16: 0, iva: 0, retencion_iva: 0, total: 0 });

  const activeRecibidosTotals = activeRecibidosAll.reduce((acc, r) => {
    acc.base_16 += Number(r.base_16) || 0;
    acc.iva += Number(r.iva) || 0;
    acc.retencion_iva += Number(r.retencion_iva) || 0;
    acc.total += Number(r.total) || 0;
    return acc;
  }, { base_16: 0, iva: 0, retencion_iva: 0, total: 0 });

  // Determinación dinámica de IVA considerando omisiones del usuario
  const dynamicIvaCausado = Math.round(activeEmitidosTotals.iva * 100) / 100;
  const dynamicBaseCausado16 = Math.round(activeEmitidosTotals.base_16 * 100) / 100;
  const dynamicIvaAcreditable = Math.round(activeRecibidosTotals.iva * 100) / 100;
  const dynamicBaseAcreditable16 = Math.round(activeRecibidosTotals.base_16 * 100) / 100;
  const dynamicRetenciones = Math.round((activeEmitidosTotals.retencion_iva || Number(data?.summary?.retenciones_que_le_hicieron) || 0) * 100) / 100;

  const dynamicNet = Math.round((dynamicIvaCausado - dynamicIvaAcreditable - dynamicRetenciones) * 100) / 100;
  const dynamicIvaCargo = Math.max(0, dynamicNet);
  const dynamicIvaFavor = Math.max(0, -dynamicNet);

  // Filtrado por búsqueda en tabla
  const emitidos = emitidosAll.filter(i => {
    if (!searchEmitidos) return true;
    const term = searchEmitidos.toLowerCase();
    return (
      (i.rfc || '').toLowerCase().includes(term) ||
      (i.name || '').toLowerCase().includes(term) ||
      (i.folio || '').toLowerCase().includes(term) ||
      (i.uuid || '').toLowerCase().includes(term) ||
      (i.payment_form || '').toLowerCase().includes(term) ||
      (i.cfdi_use || '').toLowerCase().includes(term)
    );
  });

  const recibidos = recibidosAll.filter(i => {
    if (!searchRecibidos) return true;
    const term = searchRecibidos.toLowerCase();
    return (
      (i.rfc || '').toLowerCase().includes(term) ||
      (i.name || '').toLowerCase().includes(term) ||
      (i.folio || '').toLowerCase().includes(term) ||
      (i.uuid || '').toLowerCase().includes(term) ||
      (i.payment_form || '').toLowerCase().includes(term) ||
      (i.cfdi_use || '').toLowerCase().includes(term)
    );
  });

  // Totales de la vista de tabla (sumando exclusivamente los comprobantes activos no omitidos)
  const emitidosActivosEnTabla = emitidos.filter(i => !omittedIds.includes(i.id));
  const emitidosOmitidosEnTablaCount = emitidos.length - emitidosActivosEnTabla.length;

  const emitidosTotals = emitidosActivosEnTabla.reduce((acc, r) => {
    acc.base_16 += Number(r.base_16) || 0;
    acc.iva += Number(r.iva) || 0;
    acc.retencion_iva += Number(r.retencion_iva) || 0;
    acc.total += Number(r.total) || 0;
    return acc;
  }, { base_16: 0, iva: 0, retencion_iva: 0, total: 0 });

  const recibidosActivosEnTabla = recibidos.filter(i => !omittedIds.includes(i.id));
  const recibidosOmitidosEnTablaCount = recibidos.length - recibidosActivosEnTabla.length;

  const recibidosTotals = recibidosActivosEnTabla.reduce((acc, r) => {
    acc.base_16 += Number(r.base_16) || 0;
    acc.iva += Number(r.iva) || 0;
    acc.retencion_iva += Number(r.retencion_iva) || 0;
    acc.total += Number(r.total) || 0;
    return acc;
  }, { base_16: 0, iva: 0, retencion_iva: 0, total: 0 });

  // Helper para etiquetas de forma de pago
  const renderFormaPago = (f) => {
    const labels = {
      '01': '01 Efectivo',
      '02': '02 Cheque',
      '03': '03 Transferencia',
      '04': '04 Tarjeta Crédito',
      '28': '28 Tarjeta Débito',
      '99': '99 Por definir',
    };
    const desc = labels[f] || (f ? `${f}` : '-');
    return <span className="text-xs font-mono text-gray-700" title={desc}>{desc}</span>;
  };

  // Helper para etiquetas de uso de CFDI
  const renderUsoCfdi = (u) => {
    const labels = {
      'G01': 'G01 Adquisición de mercancías',
      'G02': 'G02 Devoluciones o descuentos',
      'G03': 'G03 Gastos en general',
      'I01': 'I01 Construcciones',
      'I02': 'I02 Mobiliario y equipo',
      'I03': 'I03 Equipo de transporte',
      'I04': 'I04 Equipo de cómputo',
      'I08': 'I08 Otra maquinaria',
      'CP01': 'CP01 Pagos',
      'S01': 'S01 Sin efectos fiscales',
    };
    const desc = labels[u] || (u ? `${u}` : '-');
    return u ? (
      <Tag color="geekblue" className="text-[11px] font-mono px-1 m-0" title={desc}>
        {u}
      </Tag>
    ) : (
      <span className="text-gray-400 text-xs">-</span>
    );
  };

  // Columnas para CFDI Emitidos (Ventas a Clientes)
  const emitidosColumns = [
    {
      title: (
        <Tooltip title="Marcar casilla para omitir la factura del cálculo de IVA">
          <div className="text-center font-bold text-red-600 text-xs cursor-help">
            Omitir
          </div>
        </Tooltip>
      ),
      key: 'omit',
      width: 65,
      align: 'center',
      render: (_, record) => {
        const isOmitted = omittedIds.includes(record.id);
        return (
          <Tooltip title={isOmitted ? "Comprobante omitido del cálculo de IVA. Clic para incluirlo." : "Seleccionar para omitir del cálculo de IVA"}>
            <Checkbox
              checked={isOmitted}
              onChange={() => toggleOmit(record.id)}
            />
          </Tooltip>
        );
      },
    },
    {
      title: 'Fecha',
      dataIndex: 'date',
      key: 'date',
      width: 105,
    },
    {
      title: 'Folio / UUID',
      dataIndex: 'folio',
      key: 'folio',
      width: 140,
      render: (folio, record) => {
        const isOmitted = omittedIds.includes(record.id);
        const displayFolio = folio || (record.uuid ? record.uuid.substring(0, 8) : 'S/F');
        return (
          <div className="flex items-center gap-1.5">
            {record.uuid ? (
              <Tooltip title={`Ver detalle de CFDI (${record.uuid}) en nueva pestaña`}>
                <a
                  href={`/cfdi-viewer/${record.uuid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-semibold cursor-pointer group"
                >
                  <span className={`font-mono text-xs ${isOmitted ? 'line-through text-gray-400' : 'group-hover:underline'}`}>
                    {displayFolio}
                  </span>
                  <FileSearchOutlined className="text-[11px] opacity-75 group-hover:opacity-100" />
                </a>
              </Tooltip>
            ) : (
              <span className={`font-mono text-xs ${isOmitted ? 'line-through text-gray-400' : 'text-blue-900 font-semibold'}`}>
                {displayFolio}
              </span>
            )}
            {isOmitted && (
              <Tag color="red" className="text-[10px] leading-tight px-1 py-0 m-0">
                Omitida
              </Tag>
            )}
          </div>
        );
      },
    },
    {
      title: 'RFC Cliente',
      dataIndex: 'rfc',
      key: 'rfc',
      width: 130,
      render: (rfc) => <span className="font-mono text-xs">{rfc}</span>,
    },
    {
      title: 'Cliente / Razón Social',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name) => <span className="font-medium text-xs text-gray-800">{name}</span>,
    },
    {
      title: 'Método',
      dataIndex: 'payment_method',
      key: 'payment_method',
      width: 85,
      render: (m) => (
        <Tag color={m === 'PUE' ? 'cyan' : m === 'PAGO' ? 'blue' : 'orange'} className="text-[11px] px-1">
          {m || 'PUE'}
        </Tag>
      ),
    },
    {
      title: 'Forma Pago',
      dataIndex: 'payment_form',
      key: 'payment_form',
      width: 125,
      render: renderFormaPago,
    },
    {
      title: 'Uso CFDI',
      dataIndex: 'cfdi_use',
      key: 'cfdi_use',
      width: 95,
      render: renderUsoCfdi,
    },
    {
      title: 'Base 16%',
      dataIndex: 'base_16',
      key: 'base_16',
      align: 'right',
      render: (val) => formatMoney(val),
      width: 115,
    },
    {
      title: 'IVA Trasladado',
      dataIndex: 'iva',
      key: 'iva',
      align: 'right',
      render: (val) => <span className="font-semibold text-blue-700">{formatMoney(val)}</span>,
      width: 120,
    },
    {
      title: 'Ret. IVA',
      dataIndex: 'retencion_iva',
      key: 'retencion_iva',
      align: 'right',
      render: (val) => val > 0 ? <span className="text-amber-700">{formatMoney(val)}</span> : '-',
      width: 95,
    },
    {
      title: 'Total Facturado',
      dataIndex: 'total',
      key: 'total',
      align: 'right',
      render: (val) => <span className="font-bold text-gray-900">{formatMoney(val)}</span>,
      width: 120,
    },
  ];

  // Columnas para CFDI Recibidos (Compras y Gastos de Proveedores)
  const recibidosColumns = [
    {
      title: (
        <Tooltip title="Marcar casilla para omitir la factura del cálculo de IVA">
          <div className="text-center font-bold text-red-600 text-xs cursor-help">
            Omitir
          </div>
        </Tooltip>
      ),
      key: 'omit',
      width: 65,
      align: 'center',
      render: (_, record) => {
        const isOmitted = omittedIds.includes(record.id);
        return (
          <Tooltip title={isOmitted ? "Comprobante omitido del cálculo de IVA. Clic para incluirlo." : "Seleccionar para omitir del cálculo de IVA"}>
            <Checkbox
              checked={isOmitted}
              onChange={() => toggleOmit(record.id)}
            />
          </Tooltip>
        );
      },
    },
    {
      title: 'Fecha',
      dataIndex: 'date',
      key: 'date',
      width: 105,
    },
    {
      title: 'Folio / UUID',
      dataIndex: 'folio',
      key: 'folio',
      width: 140,
      render: (folio, record) => {
        const isOmitted = omittedIds.includes(record.id);
        const displayFolio = folio || (record.uuid ? record.uuid.substring(0, 8) : 'S/F');
        return (
          <div className="flex items-center gap-1.5">
            {record.uuid ? (
              <Tooltip title={`Ver detalle de CFDI (${record.uuid}) en nueva pestaña`}>
                <a
                  href={`/cfdi-viewer/${record.uuid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-purple-700 hover:text-purple-900 font-semibold cursor-pointer group"
                >
                  <span className={`font-mono text-xs ${isOmitted ? 'line-through text-gray-400' : 'group-hover:underline'}`}>
                    {displayFolio}
                  </span>
                  <FileSearchOutlined className="text-[11px] opacity-75 group-hover:opacity-100" />
                </a>
              </Tooltip>
            ) : (
              <span className={`font-mono text-xs ${isOmitted ? 'line-through text-gray-400' : 'text-purple-900 font-semibold'}`}>
                {displayFolio}
              </span>
            )}
            {isOmitted && (
              <Tag color="red" className="text-[10px] leading-tight px-1 py-0 m-0">
                Omitida
              </Tag>
            )}
          </div>
        );
      },
    },
    {
      title: 'RFC Proveedor',
      dataIndex: 'rfc',
      key: 'rfc',
      width: 130,
      render: (rfc) => <span className="font-mono text-xs">{rfc}</span>,
    },
    {
      title: 'Proveedor / Razón Social',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name) => <span className="font-medium text-xs text-gray-800">{name}</span>,
    },
    {
      title: 'Método',
      dataIndex: 'payment_method',
      key: 'payment_method',
      width: 85,
      render: (m) => (
        <Tag color={m === 'PUE' ? 'cyan' : m === 'PAGO' ? 'blue' : 'orange'} className="text-[11px] px-1">
          {m || 'PUE'}
        </Tag>
      ),
    },
    {
      title: 'Forma Pago',
      dataIndex: 'payment_form',
      key: 'payment_form',
      width: 125,
      render: renderFormaPago,
    },
    {
      title: 'Uso CFDI',
      dataIndex: 'cfdi_use',
      key: 'cfdi_use',
      width: 95,
      render: renderUsoCfdi,
    },
    {
      title: 'Base 16%',
      dataIndex: 'base_16',
      key: 'base_16',
      align: 'right',
      render: (val) => formatMoney(val),
      width: 115,
    },
    {
      title: 'IVA Acreditable',
      dataIndex: 'iva',
      key: 'iva',
      align: 'right',
      render: (val) => <span className="font-semibold text-purple-700">{formatMoney(val)}</span>,
      width: 120,
    },
    {
      title: 'Ret. IVA',
      dataIndex: 'retencion_iva',
      key: 'retencion_iva',
      align: 'right',
      render: (val) => val > 0 ? <span className="text-amber-700">{formatMoney(val)}</span> : '-',
      width: 95,
    },
    {
      title: 'Total Factura',
      dataIndex: 'total',
      key: 'total',
      align: 'right',
      render: (val) => <span className="font-bold text-gray-900">{formatMoney(val)}</span>,
      width: 120,
    },
  ];

  return (
    <div className="p-6 print:p-0">
      {/* Encabezado */}
      <div className="flex flex-wrap justify-between items-center mb-4 print:hidden gap-4">
        <div>
          <Title level={2} className="m-0 flex items-center gap-2">
            <CalculatorOutlined className="text-blue-600" />
            Papel de Trabajo - Cálculo de IVA
          </Title>
          {clientInfo && (
            <p className="text-gray-500 m-0 text-sm">
              Empresa: <span className="font-semibold text-gray-700">{clientInfo.business_name}</span> ({clientInfo.rfc})
            </p>
          )}
        </div>
        <Space wrap>
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
          <Button icon={<PrinterOutlined />} onClick={handlePrint} size="middle">
            Imprimir
          </Button>
        </Space>
      </div>

      {/* Filtros y Acciones */}
      <Card size="small" className="mb-4 shadow-sm bg-white print:hidden">
        <Row gutter={[16, 12]} align="middle">
          <Col xs={12} sm={6} md={3}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Año</label>
            <Select value={year} onChange={setYear} style={{ width: '100%' }}>
              {[2024, 2025, 2026, 2027].map((y) => (
                <Option key={y} value={y}>{y}</Option>
              ))}
            </Select>
          </Col>
          <Col xs={12} sm={6} md={4}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Mes</label>
            <Select value={month} onChange={setMonth} style={{ width: '100%' }}>
              <Option value={1}>01 - Enero</Option>
              <Option value={2}>02 - Febrero</Option>
              <Option value={3}>03 - Marzo</Option>
              <Option value={4}>04 - Abril</Option>
              <Option value={5}>05 - Mayo</Option>
              <Option value={6}>06 - Junio</Option>
              <Option value={7}>07 - Julio</Option>
              <Option value={8}>08 - Agosto</Option>
              <Option value={9}>09 - Septiembre</Option>
              <Option value={10}>10 - Octubre</Option>
              <Option value={11}>11 - Noviembre</Option>
              <Option value={12}>12 - Diciembre</Option>
            </Select>
          </Col>
          <Col xs={24} sm={12} md={5}>
            <label className="block mb-1 text-xs font-semibold text-transparent select-none">&nbsp;</label>
            <Button type="primary" onClick={fetchData} loading={loading} style={{ width: '100%' }}>
              Consultar Periodo
            </Button>
          </Col>
          <Col xs={24} sm={12} md={12} className="flex flex-wrap justify-start md:justify-end items-end gap-2 pt-1 md:pt-0">
            {data?.traspaso_poliza && (
              <Tooltip title="Ver póliza de traspasos generada en visor">
                <a
                  href={`/journal-viewer/${data.traspaso_poliza.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center"
                >
                  <Tag color="success" className="font-semibold text-xs py-1 px-2.5 cursor-pointer border-emerald-300 flex items-center gap-1.5 shadow-sm hover:border-emerald-500 hover:bg-emerald-50 transition-colors">
                    <CheckCircleOutlined className="text-emerald-600" />
                    <span>Póliza Diario #{data.traspaso_poliza.entry_number} ({data.traspaso_poliza.formatted_date})</span>
                    <EyeOutlined className="text-[11px] text-emerald-700" />
                  </Tag>
                </a>
              </Tooltip>
            )}
            <Button
              type="primary"
              className="bg-emerald-600 hover:bg-emerald-700 border-emerald-600 font-semibold flex items-center gap-1.5 shadow-sm"
              icon={<SwapOutlined />}
              onClick={() => setTraspasoModalVisible(true)}
              disabled={loading || !data}
            >
              {data?.traspaso_poliza ? 'Actualizar Traspaso de IVA' : 'Hacer Traspaso de IVA'}
            </Button>
          </Col>
        </Row>
      </Card>

      {error && <Alert message={error} type="error" className="mb-4 print:hidden" showIcon />}

      {loading ? (
        <div className="text-center py-12"><Spin size="large" /></div>
      ) : data ? (
        <>
          {/* Banner de Aviso de Comprobantes Omitidos */}
          {omittedIds.length > 0 && (
            <Alert
              type="warning"
              showIcon
              className="mb-4 print:hidden shadow-sm border-amber-300"
              message={
                <div className="flex flex-wrap justify-between items-center gap-2">
                  <span>
                    <strong>Atención:</strong> Se han marcado <strong>{omittedIds.length}</strong> comprobante(s) para ser <strong>omitidos del cálculo de IVA</strong>.
                    Las tarjetas de cálculo, bases gravadas y sumatorias de las tablas reflejan únicamente los comprobantes activos.
                  </span>
                  <Button 
                    size="small" 
                    icon={<UndoOutlined />} 
                    onClick={resetOmitted} 
                    danger
                  >
                    Restablecer todos (Incluir todos)
                  </Button>
                </div>
              }
            />
          )}

          {/* Tarjetas de Determinación del Impuesto */}
          <Row gutter={[16, 16]} className="mb-6">
            <Col xs={24} sm={12} lg={6}>
              <Card className="shadow-sm border-blue-200 bg-blue-50/30">
                <Statistic
                  title={<span className="font-semibold text-blue-900">IVA TRASLADADO (CAUSADO)</span>}
                  value={dynamicIvaCausado}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#1d4ed8', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-500">
                  Base gravada al 16%: <span className="font-semibold">{formatMoney(dynamicBaseCausado16)}</span>
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className="shadow-sm border-purple-200 bg-purple-50/30">
                <Statistic
                  title={<span className="font-semibold text-purple-900">(-) IVA ACREDITABLE (PAGADO)</span>}
                  value={dynamicIvaAcreditable}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#7e22ce', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-500">
                  Base compras/gastos 16%: <span className="font-semibold">{formatMoney(dynamicBaseAcreditable16)}</span>
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className="shadow-sm border-amber-200 bg-amber-50/30">
                <Statistic
                  title={<span className="font-semibold text-amber-900">(-) RETENCIONES EFECTUADAS</span>}
                  value={dynamicRetenciones}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#b45309', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-500">
                  Retenciones que le retuvieron
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className={`shadow-sm border-2 ${dynamicIvaCargo > 0 ? 'border-red-400 bg-red-50/40' : 'border-green-400 bg-green-50/40'}`}>
                {dynamicIvaCargo > 0 ? (
                  <Statistic
                    title={<span className="font-bold text-red-900 uppercase">(=) IMPUESTO A CARGO</span>}
                    value={dynamicIvaCargo}
                    precision={2}
                    prefix="$"
                    valueStyle={{ color: '#dc2626', fontWeight: 'bold', fontSize: '1.5rem' }}
                  />
                ) : (
                  <Statistic
                    title={<span className="font-bold text-green-900 uppercase">(=) SALDO A FAVOR</span>}
                    value={dynamicIvaFavor}
                    precision={2}
                    prefix="$"
                    valueStyle={{ color: '#16a34a', fontWeight: 'bold', fontSize: '1.5rem' }}
                  />
                )}
                <div className="mt-2 text-xs font-semibold text-gray-700">
                  {dynamicIvaCargo > 0 ? 'Pagar antes del día 17 del mes siguiente' : 'Susceptible de acreditamiento o devolución'}
                </div>
              </Card>
            </Col>
          </Row>

          {/* Conciliación Contable vs CFDI */}
          <Row gutter={[16, 16]} className="mb-6">
            <Col xs={24} md={12}>
              <Card title="Saldos en Cuentas Contables de IVA" size="small" className="shadow-sm">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b py-2">
                      <td className="py-2 text-gray-600">208-01-000 IVA trasladado cobrado (Causado)</td>
                      <td className="py-2 text-right font-semibold">{formatMoney(data.contabilidad.cta_208_cobrado)}</td>
                    </tr>
                    <tr className="border-b py-2">
                      <td className="py-2 text-gray-600">118-01-000 IVA acreditable pagado</td>
                      <td className="py-2 text-right font-semibold">{formatMoney(data.contabilidad.cta_118_pagado)}</td>
                    </tr>
                    <tr className="border-b py-2">
                      <td className="py-2 text-gray-500">209-01-000 IVA trasladado no cobrado (Pendiente)</td>
                      <td className="py-2 text-right text-gray-600">{formatMoney(data.contabilidad.cta_209_pendiente)}</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-gray-500">119-01-000 IVA pendiente de pago</td>
                      <td className="py-2 text-right text-gray-600">{formatMoney(data.contabilidad.cta_119_pendiente)}</td>
                    </tr>
                  </tbody>
                </table>
              </Card>
            </Col>

            <Col xs={24} md={12}>
              <Card title="Comprobantes Fiscales Efectivos (Base Cálculo IVA)" size="small" className="shadow-sm">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b py-2">
                      <td className="py-2 text-gray-600">Facturación Efectivamente Cobrada</td>
                      <td className="py-2 text-right font-semibold">{formatMoney(activeEmitidosTotals.total)}</td>
                    </tr>
                    <tr className="border-b py-2">
                      <td className="py-2 text-gray-600">IVA Trasladado Cobrado (CFDI)</td>
                      <td className="py-2 text-right font-semibold text-blue-700">{formatMoney(activeEmitidosTotals.iva)}</td>
                    </tr>
                    <tr className="border-b py-2">
                      <td className="py-2 text-gray-600">Compras y Gastos Efectivamente Pagados</td>
                      <td className="py-2 text-right font-semibold">{formatMoney(activeRecibidosTotals.total)}</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-gray-600">IVA Acreditable Pagado (CFDI)</td>
                      <td className="py-2 text-right font-semibold text-purple-700">{formatMoney(activeRecibidosTotals.iva)}</td>
                    </tr>
                  </tbody>
                </table>
              </Card>
            </Col>
          </Row>

          {/* Detalle de Comprobantes Soporte Separados en Pestañas */}
          <Card 
            title={
              <div className="flex flex-wrap justify-between items-center gap-2">
                <span className="font-bold text-gray-800">
                  Comprobantes Fiscales Efectivamente Cobrados / Pagados (Base Cálculo IVA)
                </span>
                <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-normal border border-emerald-200">
                  Exclusivo flujo de efectivo: PUE y Pagos (sin PPD pendientes)
                </span>
              </div>
            }
            className="shadow-sm" 
            size="small"
          >
            <Tabs 
              activeKey={activeTab} 
              onChange={setActiveTab}
              items={[
                {
                  key: 'emitidos',
                  label: (
                    <span className="font-semibold flex items-center gap-2 text-sm">
                      <ArrowUpOutlined className="text-blue-600" />
                      CFDI Emitidos Cobrados ({activeEmitidosAll.length} de {emitidosAll.length}
                      {emitidosAll.length - activeEmitidosAll.length > 0 ? ` · ${emitidosAll.length - activeEmitidosAll.length} omitidos` : ''})
                    </span>
                  ),
                  children: (
                    <div>
                      <div className="flex flex-wrap justify-between items-center mb-3 gap-2">
                        <div className="text-xs text-gray-500">
                          Comprobantes fiscales emitidos cobrados que integran la cuenta <strong>208-01-000 IVA Trasladado Cobrado</strong>. Marca la casilla <strong>Omitir</strong> para excluir comprobantes del cálculo.
                        </div>
                        <Input
                          placeholder="Buscar por RFC, cliente, forma o folio..."
                          prefix={<SearchOutlined className="text-gray-400" />}
                          value={searchEmitidos}
                          onChange={(e) => setSearchEmitidos(e.target.value)}
                          style={{ width: 280 }}
                          size="small"
                          allowClear
                        />
                      </div>
                      <Table
                        columns={emitidosColumns}
                        dataSource={emitidos}
                        rowKey="id"
                        pagination={{ pageSize: 15 }}
                        size="small"
                        bordered
                        rowClassName={(record) => omittedIds.includes(record.id) ? 'bg-amber-50/50 opacity-60' : ''}
                        summary={() => (
                          <Table.Summary.Row className="bg-blue-50/60 font-bold text-xs">
                            <Table.Summary.Cell index={0} colSpan={8} align="right">
                              TOTAL CFDI EMITIDOS COBRADOS ({emitidosActivosEnTabla.length} de {emitidos.length} facturas
                              {emitidosOmitidosEnTablaCount > 0 ? ` · ${emitidosOmitidosEnTablaCount} omitida(s)` : ''}):
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={1} align="right">
                              {formatMoney(emitidosTotals.base_16)}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={2} align="right" className="text-blue-800">
                              {formatMoney(emitidosTotals.iva)}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={3} align="right">
                              {emitidosTotals.retencion_iva > 0 ? formatMoney(emitidosTotals.retencion_iva) : '-'}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={4} align="right">
                              {formatMoney(emitidosTotals.total)}
                            </Table.Summary.Cell>
                          </Table.Summary.Row>
                        )}
                      />
                    </div>
                  ),
                },
                {
                  key: 'recibidos',
                  label: (
                    <span className="font-semibold flex items-center gap-2 text-sm">
                      <ArrowDownOutlined className="text-purple-600" />
                      CFDI Recibidos Pagados ({activeRecibidosAll.length} de {recibidosAll.length}
                      {recibidosAll.length - activeRecibidosAll.length > 0 ? ` · ${recibidosAll.length - activeRecibidosAll.length} omitidos` : ''})
                    </span>
                  ),
                  children: (
                    <div>
                      <div className="flex flex-wrap justify-between items-center mb-3 gap-2">
                        <div className="text-xs text-gray-500">
                          Comprobantes fiscales de compras y gastos pagados que integran la cuenta <strong>118-01-000 IVA Acreditable Pagado</strong>. Marca la casilla <strong>Omitir</strong> para excluir comprobantes del cálculo.
                        </div>
                        <Input
                          placeholder="Buscar por RFC, proveedor, forma o folio..."
                          prefix={<SearchOutlined className="text-gray-400" />}
                          value={searchRecibidos}
                          onChange={(e) => setSearchRecibidos(e.target.value)}
                          style={{ width: 280 }}
                          size="small"
                          allowClear
                        />
                      </div>
                      <Table
                        columns={recibidosColumns}
                        dataSource={recibidos}
                        rowKey="id"
                        pagination={{ pageSize: 15 }}
                        size="small"
                        bordered
                        rowClassName={(record) => omittedIds.includes(record.id) ? 'bg-amber-50/50 opacity-60' : ''}
                        summary={() => (
                          <Table.Summary.Row className="bg-purple-50/60 font-bold text-xs">
                            <Table.Summary.Cell index={0} colSpan={8} align="right">
                              TOTAL CFDI RECIBIDOS PAGADOS ({recibidosActivosEnTabla.length} de {recibidos.length} facturas
                              {recibidosOmitidosEnTablaCount > 0 ? ` · ${recibidosOmitidosEnTablaCount} omitida(s)` : ''}):
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={1} align="right">
                              {formatMoney(recibidosTotals.base_16)}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={2} align="right" className="text-purple-800">
                              {formatMoney(recibidosTotals.iva)}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={3} align="right">
                              {recibidosTotals.retencion_iva > 0 ? formatMoney(recibidosTotals.retencion_iva) : '-'}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={4} align="right">
                              {formatMoney(recibidosTotals.total)}
                            </Table.Summary.Cell>
                          </Table.Summary.Row>
                        )}
                      />
                    </div>
                  ),
                },
                {
                  key: 'conciliacion_matriz',
                  label: (
                    <span className="font-semibold flex items-center gap-2 text-sm text-emerald-800">
                      <CalculatorOutlined className="text-emerald-600" />
                      Reporte Conciliación IVA Acreditable (Matriz)
                    </span>
                  ),
                  children: (
                    <ConciliacionIvaMatrix
                      matrixData={data?.conciliacion_iva_acreditable}
                      clientInfo={clientInfo}
                      year={year}
                      month={month}
                      omittedIds={omittedIds}
                    />
                  ),
                },
              ]}
            />
          </Card>
        </>
      ) : null}

      {/* Modal de Confirmación de Traspaso Contable Mensual de IVA */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-emerald-800 text-base font-bold">
            <SwapOutlined />
            <span>Traspaso Contable Mensual de IVA - {data?.period_description || `${month}/${year}`}</span>
          </div>
        }
        open={traspasoModalVisible}
        onCancel={() => setTraspasoModalVisible(false)}
        width={720}
        footer={[
          <Button key="cancel" onClick={() => setTraspasoModalVisible(false)}>
            Cancelar
          </Button>,
          <Button
            key="submit"
            type="primary"
            className="bg-emerald-600 hover:bg-emerald-700 border-emerald-600 font-semibold"
            loading={generatingTraspaso}
            onClick={handleExecuteTraspaso}
          >
            {data?.traspaso_poliza ? 'Confirmar y Actualizar Póliza' : 'Confirmar y Generar Póliza'}
          </Button>,
        ]}
      >
        <div className="py-2 text-sm">
          <div className="bg-gray-50 border border-gray-200 rounded p-3 mb-4 space-y-1 text-xs">
            <div><strong>Empresa:</strong> {clientInfo?.business_name} ({clientInfo?.rfc})</div>
            <div><strong>Tipo de Póliza:</strong> Póliza de Diario</div>
            <div>
              <strong>Fecha de Registro:</strong>{' '}
              <span className="font-semibold text-blue-800">
                {new Date(year, month, 0).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })}
              </span>{' '}
              <em>(último día del mes que se está generando)</em>
            </div>
            <div><strong>Concepto:</strong> <span className="font-semibold">Traspasos de IVA del mes</span></div>
          </div>

          <div className="font-semibold text-gray-800 mb-2 text-xs uppercase tracking-wide">
            Movimientos contables de cancelación y determinación:
          </div>

          <div className="border border-gray-200 rounded overflow-hidden mb-4 shadow-sm">
            <table className="w-full text-xs">
              <thead className="bg-emerald-50 text-emerald-950 font-bold border-b border-emerald-100">
                <tr>
                  <th className="py-2 px-3 text-left">Cuenta Contable</th>
                  <th className="py-2 px-3 text-left">Concepto del Movimiento</th>
                  <th className="py-2 px-3 text-right">Debe (Cargo)</th>
                  <th className="py-2 px-3 text-right">Haber (Abono)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {/* 1. Cancelación IVA Trasladado Cobrado */}
                <tr>
                  <td className="py-2.5 px-3 font-mono font-semibold text-gray-800">208-01-000</td>
                  <td className="py-2.5 px-3 text-gray-700">IVA trasladado cobrado (Cancelación mensual)</td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold text-blue-700">
                    {formatMoney(dynamicIvaCausado)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-gray-400">-</td>
                </tr>

                {/* Si hay saldo a favor: Cargo a 113-01-000 */}
                {dynamicIvaFavor > 0 && (
                  <tr className="bg-green-50/60">
                    <td className="py-2.5 px-3 font-mono font-bold text-emerald-900">113-01-000</td>
                    <td className="py-2.5 px-3 text-emerald-900">
                      <strong>IVA a favor</strong> (Determinación del saldo a favor del mes)
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-800">
                      {formatMoney(dynamicIvaFavor)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-gray-400">-</td>
                  </tr>
                )}

                {/* 2. Cancelación IVA Acreditable Pagado */}
                <tr>
                  <td className="py-2.5 px-3 font-mono font-semibold text-gray-800">118-01-000</td>
                  <td className="py-2.5 px-3 text-gray-700">IVA acreditable pagado (Cancelación mensual)</td>
                  <td className="py-2.5 px-3 text-right font-mono text-gray-400">-</td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold text-purple-700">
                    {formatMoney(dynamicIvaAcreditable)}
                  </td>
                </tr>

                {/* Si hay impuesto a cargo: Abono a 213-01-000 */}
                {dynamicIvaCargo > 0 && (
                  <tr className="bg-red-50/60">
                    <td className="py-2.5 px-3 font-mono font-bold text-red-900">213-01-000</td>
                    <td className="py-2.5 px-3 text-red-900">
                      <strong>IVA por pagar</strong> (Determinación del impuesto a cargo del mes)
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-gray-400">-</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-red-800">
                      {formatMoney(dynamicIvaCargo)}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="bg-gray-100 font-bold border-t border-gray-300">
                <tr>
                  <td colSpan={2} className="py-2.5 px-3 text-right text-gray-800">
                    <div className="flex items-center justify-end gap-1.5 text-emerald-700">
                      <CheckCircleOutlined />
                      <span>SUMAS IGUALES:</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-gray-950 font-bold">
                    {formatMoney(dynamicIvaCargo > 0 ? dynamicIvaCausado : (dynamicIvaCausado + dynamicIvaFavor))}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-gray-950 font-bold">
                    {formatMoney(dynamicIvaCargo > 0 ? (dynamicIvaAcreditable + dynamicIvaCargo) : dynamicIvaAcreditable)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="text-xs text-gray-600 bg-emerald-50/40 border border-emerald-200 rounded p-2.5">
            {dynamicIvaCargo > 0 ? (
              <span>
                Al confirmar, se cancelarán los saldos mensuales de <strong>IVA trasladado cobrado ($208-01-000$)</strong> e <strong>IVA acreditable pagado ($118-01-000$)</strong> y se registrará el pasivo de <strong>{formatMoney(dynamicIvaCargo)}</strong> en la cuenta <strong>213-01-000 (IVA por pagar)</strong> con fecha del último día del mes.
              </span>
            ) : dynamicIvaFavor > 0 ? (
              <span>
                Al confirmar, se cancelarán los saldos mensuales de <strong>IVA trasladado cobrado ($208-01-000$)</strong> e <strong>IVA acreditable pagado ($118-01-000$)</strong> y se reconocerá el saldo a favor de <strong>{formatMoney(dynamicIvaFavor)}</strong> en la cuenta <strong>113-01-000 (IVA a favor)</strong> con fecha del último día del mes.
              </span>
            ) : (
              <span>
                Al confirmar, los saldos de IVA trasladado e IVA acreditable quedarán saldados a $0.00.
              </span>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default FiscalIva;
