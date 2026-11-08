import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { 
  Card, Table, Row, Col, Select, Button, Typography, Alert, Spin, Tag, 
  Statistic, Tabs, Space, Input, Tooltip, Modal, message, Badge, Checkbox, Switch, Divider 
} from 'antd';
import { 
  PayCircleOutlined, 
  PrinterOutlined, 
  CheckCircleOutlined, 
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  SearchOutlined,
  CopyOutlined,
  FileSearchOutlined,
  CheckOutlined,
  FilterOutlined,
  SendOutlined,
  FileProtectOutlined,
  WarningOutlined,
  StopOutlined,
  UnorderedListOutlined,
  UndoOutlined,
  FileExcelOutlined,
  FilePdfOutlined
} from '@ant-design/icons';
import { fiscalApi, clientsApi } from '../api/client';
import { exportToExcel, exportToPdfWithLogo } from '../utils/exportPaperwork';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;

const formatMoney = (val) => {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(val || 0);
};

const FiscalComplementosPago = () => {
  const { clientId } = useParams();
  const [loading, setLoading] = useState(true);
  const [clientInfo, setClientInfo] = useState(null);
  const [data, setData] = useState(null);
  
  // Filtros
  const currentYear = dayjs().year();
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState('all');
  const [tipoFilter, setTipoFilter] = useState('all'); // 'all', 'recibido', 'emitido'
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'sin_complemento', 'con_complemento', 'pago_parcial', 'excluidas_no_pagadas'
  const [searchText, setSearchText] = useState('');
  
  // Exclusión manual de facturas que todavía no están pagadas (persistido por cliente)
  const storageKey = `contacloud_unpaid_excluded_${clientId}`;
  const [excludedUuids, setExcludedUuids] = useState(() => {
    try {
      const saved = localStorage.getItem(`contacloud_unpaid_excluded_${clientId}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      setExcludedUuids(saved ? JSON.parse(saved) : []);
    } catch {
      setExcludedUuids([]);
    }
  }, [clientId, storageKey]);

  const saveExcludedUuids = (nextList) => {
    setExcludedUuids(nextList);
    try {
      localStorage.setItem(storageKey, JSON.stringify(nextList));
    } catch (e) {
      console.error('Error saving excluded UUIDs:', e);
    }
  };

  const toggleExcludeInvoice = (uuid, markAsExcluded) => {
    const cleanUuid = (uuid || '').toUpperCase();
    const exists = excludedUuids.includes(cleanUuid);
    const shouldExclude = markAsExcluded !== undefined ? markAsExcluded : !exists;
    let next;
    if (shouldExclude && !exists) {
      next = [...excludedUuids, cleanUuid];
      message.info('Factura marcada como "Aún no pagada" (excluida de la solicitud de REP).');
    } else if (!shouldExclude && exists) {
      next = excludedUuids.filter(id => id !== cleanUuid);
      message.success('Factura incluida nuevamente para seguimiento de complemento.');
    } else {
      return;
    }
    saveExcludedUuids(next);
  };

  // Vistas y Modal de Solicitud en Lista
  const [activeTab, setActiveTab] = useState('conciliacion'); // 'conciliacion' | 'reps_catalogo'
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkSupplierFilter, setBulkSupplierFilter] = useState('ALL'); // 'ALL' o RFC del proveedor
  const [selectedModalUuids, setSelectedModalUuids] = useState([]);
  const [detailModal, setDetailModal] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (clientId) {
      clientsApi.get(clientId).then(res => setClientInfo(res.data)).catch(() => {});
    }
  }, [clientId]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (year && year !== 'all') params.year = year;
      if (month && month !== 'all') params.month = month;
      if (tipoFilter && tipoFilter !== 'all') params.tipo = tipoFilter;
      // Filtramos estatus localmente para soportar también 'excluidas_no_pagadas'
      const reportRes = await fiscalApi.getComplementosReport(clientId, params);
      setData(reportRes.data);
    } catch (err) {
      console.error('Error fetching complementos report:', err);
      const detail = err?.response?.data?.detail || 'No se pudo cargar el reporte de complementos de pago.';
      setError(detail);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (clientId) {
      fetchData();
    }
  }, [clientId, year, month, tipoFilter]);

  const handlePrint = () => {
    window.print();
  };

  const buildComplementosExportPayload = () => {
    if (!data) return null;
    const columnsDef = [
      { key: 'cfdi_type', title: 'Flujo', align: 'center', format: 'text', width: 15 },
      { key: 'formatted_date', title: 'Fecha', align: 'center', format: 'text', width: 13 },
      { key: 'folio', title: 'Folio PPD', align: 'left', format: 'text', width: 14 },
      { key: 'uuid', title: 'UUID Factura PPD', align: 'left', format: 'text', width: 22 },
      { key: 'partner_rfc', title: 'RFC Tercero', align: 'left', format: 'text', width: 16 },
      { key: 'partner_name', title: 'Cliente / Proveedor', align: 'left', format: 'text', width: 30 },
      { key: 'total', title: 'Total Factura', align: 'right', format: 'currency', width: 16 },
      { key: 'monto_pagado', title: 'Monto con REP', align: 'right', format: 'currency', width: 16 },
      { key: 'saldo_pendiente', title: 'Saldo sin REP', align: 'right', format: 'currency', width: 16 },
      { key: 'estatus_label', title: 'Estatus REP', align: 'center', format: 'text', width: 18 },
    ];

    const rows = displayedFacturas.map(r => {
      let estatusLabel = 'Sin Complemento';
      if (r.status === 'con_complemento') estatusLabel = `Con REP (${r.reps_count})`;
      else if (r.isExcluded) estatusLabel = 'Excluida (No Pagada)';
      else if (r.status === 'pago_parcial') estatusLabel = `Pago Parcial (${r.reps_count})`;
      else estatusLabel = r.cfdi_type === 'recibido' ? 'Falta Solicitar REP' : 'Falta Emitir REP';

      return {
        cfdi_type: r.cfdi_type === 'emitido' ? 'Emitida (Cliente)' : 'Recibida (Proveedor)',
        formatted_date: r.formatted_date || '',
        folio: r.folio || '',
        uuid: r.uuid || '',
        partner_rfc: r.partner_rfc || '',
        partner_name: r.partner_name || '',
        total: Number(r.total || 0),
        monto_pagado: Number(r.monto_pagado || 0),
        saldo_pendiente: Number(r.saldo_pendiente || 0),
        estatus_label: estatusLabel,
        _rowType: 'normal'
      };
    });

    const sumTotal = rows.reduce((a, b) => a + b.total, 0);
    const sumPagado = rows.reduce((a, b) => a + b.monto_pagado, 0);
    const sumPendiente = rows.reduce((a, b) => a + b.saldo_pendiente, 0);

    rows.push({
      cfdi_type: '',
      formatted_date: '',
      folio: '',
      uuid: '',
      partner_rfc: '',
      partner_name: `TOTAL CONCILIACIÓN PPD (${rows.length} COMPROBANTES)`,
      total: sumTotal,
      monto_pagado: sumPagado,
      saldo_pendiente: sumPendiente,
      estatus_label: '',
      _rowType: 'total'
    });

    const summaryCards = [
      { label: 'PPD Proveedores (Total)', value: formatMoney(recibidosMet.total_monto || 0), sublabel: `${recibidosMet.total_count || 0} facturas recibidas` },
      { label: 'Proveedores Falta REP', value: formatMoney(recibidosMet.sin_rep_monto || 0), sublabel: `${recibidosMet.sin_rep_count || 0} pendientes de REP` },
      { label: 'PPD Clientes (Total)', value: formatMoney(emitidosMet.total_monto || 0), sublabel: `${emitidosMet.total_count || 0} facturas emitidas` },
      { label: 'Clientes Falta Emitir REP', value: formatMoney(emitidosMet.sin_rep_monto || 0), sublabel: `${emitidosMet.sin_rep_count || 0} pendientes de REP` },
    ];

    return {
      title: 'PAPEL DE TRABAJO — CONCILIACIÓN DE FACTURAS PPD Y COMPLEMENTOS DE PAGO (REP)',
      subtitle: 'Control de Acreditamiento de IVA y Seguimiento de CFDI Tipo P (Recepción de Pagos)',
      clientName: clientInfo?.business_name || '',
      clientRfc: clientInfo?.rfc || '',
      period: `${month === 'all' ? 'Todos los meses' : `Mes ${month}`} / ${year}`,
      columns: columnsDef,
      rows,
      summaryCards,
      notes: 'Cédula de auditoría fiscal para verificar que toda factura PPD liquidada cuente con su respectivo CFDI de Complemento de Pago (REP).',
      filename: `Papel_Trabajo_Complementos_PPD_${clientInfo?.rfc || clientId}_${year}_${month}.xlsx`
    };
  };

  const handleExportExcel = () => {
    const payload = buildComplementosExportPayload();
    if (payload) exportToExcel(payload);
  };

  const handleExportPdf = () => {
    const payload = buildComplementosExportPayload();
    if (payload) exportToPdfWithLogo(payload);
  };

  const handleCopyText = (text) => {
    navigator.clipboard.writeText(text);
    message.success('Lista de solicitud copiada al portapapeles.');
  };

  // Enriquecer facturas con bandera isExcluded (No pagada aún) y ordenar de fecha más antigua a más reciente
  const enrichedFacturas = useMemo(() => {
    const list = [...(data?.facturas || [])].sort(
      (a, b) => (a.date || '').localeCompare(b.date || '') || (a.id || 0) - (b.id || 0)
    );
    return list.map(f => {
      const cleanUuid = (f.uuid || '').toUpperCase();
      const isPending = f.status !== 'con_complemento';
      const isExcluded = isPending && excludedUuids.includes(cleanUuid);
      return {
        ...f,
        isExcluded,
      };
    });
  }, [data?.facturas, excludedUuids]);

  // Facturas recibidas pendientes de REP (para el modal de solicitud en lista)
  const allSupplierPendingFacturas = useMemo(() => {
    return enrichedFacturas.filter(
      f => f.cfdi_type === 'recibido' && f.status !== 'con_complemento'
    );
  }, [enrichedFacturas]);

  // Lista de proveedores con facturas PPD pendientes de REP
  const suppliersWithPending = useMemo(() => {
    const map = new Map();
    allSupplierPendingFacturas.forEach(f => {
      const key = f.partner_rfc || f.partner_name || 'SIN_RFC';
      if (!map.has(key)) {
        map.set(key, {
          rfc: f.partner_rfc || 'S/RFC',
          name: f.partner_name || 'Proveedor Sin Nombre',
          totalCount: 0,
          activeCount: 0,
          activeMonto: 0,
        });
      }
      const entry = map.get(key);
      entry.totalCount += 1;
      if (!f.isExcluded) {
        entry.activeCount += 1;
        entry.activeMonto += (f.saldo_pendiente || f.total || 0);
      }
    });
    return Array.from(map.values()).sort((a, b) => b.activeCount - a.activeCount);
  }, [allSupplierPendingFacturas]);

  // Abrir modal de solicitud en lista (para todos los proveedores o uno específico)
  const openBulkRequestModal = (supplierRfc = 'ALL') => {
    setBulkSupplierFilter(supplierRfc);
    const matching = allSupplierPendingFacturas.filter(f => {
      if (f.isExcluded) return false;
      if (supplierRfc !== 'ALL' && f.partner_rfc !== supplierRfc) return false;
      return true;
    });
    setSelectedModalUuids(matching.map(f => f.uuid));
    setBulkModalOpen(true);
  };

  // Cuando cambia el filtro de proveedor dentro del modal, actualizar selección activa
  const handleSupplierFilterChangeInModal = (supplierRfc) => {
    setBulkSupplierFilter(supplierRfc);
    const matching = allSupplierPendingFacturas.filter(f => {
      if (f.isExcluded) return false;
      if (supplierRfc !== 'ALL' && f.partner_rfc !== supplierRfc) return false;
      return true;
    });
    setSelectedModalUuids(matching.map(f => f.uuid));
  };

  // Facturas visibles dentro de la tabla del modal
  const modalFacturasList = useMemo(() => {
    return allSupplierPendingFacturas.filter(f => {
      if (bulkSupplierFilter !== 'ALL' && f.partner_rfc !== bulkSupplierFilter) return false;
      return true;
    });
  }, [allSupplierPendingFacturas, bulkSupplierFilter]);

  // Generar el texto consolidado en una sola lista para las facturas seleccionadas y no excluidas
  const consolidatedRequestText = useMemo(() => {
    const selectedInvoices = modalFacturasList.filter(
      f => !f.isExcluded && selectedModalUuids.includes(f.uuid)
    );

    if (selectedInvoices.length === 0) {
      return 'Seleccione al menos una factura pagada para generar la lista de solicitud de complementos de pago.';
    }

    const empresaNombre = clientInfo?.business_name || data?.business_name || 'Nuestra Empresa';
    const empresaRfc = clientInfo?.rfc || data?.rfc || '';

    // Agrupar por proveedor
    const grouped = new Map();
    selectedInvoices.forEach(inv => {
      const key = inv.partner_rfc || inv.partner_name || 'PROVEEDOR';
      if (!grouped.has(key)) {
        grouped.set(key, {
          name: inv.partner_name || 'Proveedor',
          rfc: inv.partner_rfc || '',
          invoices: []
        });
      }
      grouped.get(key).invoices.push(inv);
    });

    const totalGlobal = selectedInvoices.reduce((acc, f) => acc + (f.saldo_pendiente || f.total || 0), 0);

    // Si es un solo proveedor, formato directo para ese proveedor con lista de todas sus facturas
    if (grouped.size === 1) {
      const prov = Array.from(grouped.values())[0];
      const lines = [
        `Estimado proveedor: ${prov.name} (${prov.rfc})`,
        ``,
        `Por medio de la presente, de parte de ${empresaNombre} (${empresaRfc}), le solicitamos amablemente el envío de los Complementos para Recepción de Pagos (CFDI Tipo P - REP) correspondientes a las siguientes facturas emitidas con método de pago PPD que ya fueron liquidadas:`,
        ``
      ];

      prov.invoices.forEach((inv, idx) => {
        const montoSolicitado = inv.status === 'pago_parcial' ? inv.saldo_pendiente : inv.total;
        lines.push(
          `${idx + 1}. Factura / Folio: ${inv.folio} | Fecha: ${inv.formatted_date || 'S/F'} | Importe: ${formatMoney(montoSolicitado)} MXN | UUID: ${inv.uuid}`
        );
      });

      lines.push(
        ``,
        `Total de facturas solicitadas: ${prov.invoices.length}`,
        `Importe total por comprobar con REP: ${formatMoney(totalGlobal)} MXN`,
        ``,
        `Agradecemos su valioso apoyo enviándonos los archivos XML y PDF a la brevedad posible para nuestro cierre fiscal.`,
        `Muchas gracias.`
      );
      return lines.join('\n');
    }

    // Si son múltiples proveedores en una sola lista general
    const lines = [
      `RELACIÓN DE COMPLEMENTOS DE PAGO (REP) PENDIENTES DE SOLICITAR A PROVEEDORES`,
      `Empresa Receptor: ${empresaNombre} (${empresaRfc})`,
      `Fecha de corte: ${dayjs().format('DD/MM/YYYY')}`,
      `========================================================================`,
      ``
    ];

    Array.from(grouped.values()).forEach((prov, pIdx) => {
      const subtotalProv = prov.invoices.reduce((acc, f) => acc + (f.saldo_pendiente || f.total || 0), 0);
      lines.push(`▶ ${pIdx + 1}. PROVEEDOR: ${prov.name} (RFC: ${prov.rfc}) — ${prov.invoices.length} factura(s) | Subtotal: ${formatMoney(subtotalProv)}`);
      prov.invoices.forEach((inv, idx) => {
        const montoSolicitado = inv.status === 'pago_parcial' ? inv.saldo_pendiente : inv.total;
        lines.push(
          `   ${idx + 1}) Folio: ${inv.folio} | Fecha: ${inv.formatted_date || 'S/F'} | Importe: ${formatMoney(montoSolicitado)} MXN | UUID: ${inv.uuid}`
        );
      });
      lines.push(``);
    });

    lines.push(
      `========================================================================`,
      `TOTAL GENERAL: ${selectedInvoices.length} factura(s) pagada(s) pendientes de REP por ${formatMoney(totalGlobal)} MXN.`,
      `Favor de enviar los archivos XML y PDF de los Complementos de Pago correspondientes.`
    );

    return lines.join('\n');
  }, [modalFacturasList, selectedModalUuids, clientInfo, data]);

  // Filtrado local por estatus, exclusión y texto de búsqueda
  const displayedFacturas = useMemo(() => {
    return enrichedFacturas.filter(f => {
      // Filtro de estatus
      if (statusFilter === 'excluidas_no_pagadas') {
        if (!f.isExcluded) return false;
      } else if (statusFilter === 'sin_complemento') {
        if (f.status !== 'sin_complemento' || f.isExcluded) return false;
      } else if (statusFilter !== 'all') {
        if (f.status !== statusFilter) return false;
      }

      // Filtro de texto
      if (!searchText) return true;
      const q = searchText.toLowerCase().trim();
      return (
        (f.partner_name || '').toLowerCase().includes(q) ||
        (f.partner_rfc || '').toLowerCase().includes(q) ||
        (f.folio || '').toLowerCase().includes(q) ||
        (f.uuid || '').toLowerCase().includes(q)
      );
    });
  }, [enrichedFacturas, statusFilter, searchText]);

  // Recalcular KPIs dinámicamente tomando en cuenta las facturas excluidas manualmente (no pagadas aún)
  const computedMetrics = useMemo(() => {
    const rec = {
      total_count: 0,
      total_monto: 0,
      con_rep_count: 0,
      con_rep_monto: 0,
      sin_rep_count: 0,
      sin_rep_monto: 0,
      excluidas_count: 0,
      excluidas_monto: 0,
    };
    const emi = {
      total_count: 0,
      total_monto: 0,
      con_rep_count: 0,
      con_rep_monto: 0,
      sin_rep_count: 0,
      sin_rep_monto: 0,
      excluidas_count: 0,
      excluidas_monto: 0,
    };

    enrichedFacturas.forEach(f => {
      const target = f.cfdi_type === 'recibido' ? rec : emi;
      target.total_count += 1;
      target.total_monto += f.total || 0;

      if (f.status === 'con_complemento') {
        target.con_rep_count += 1;
        target.con_rep_monto += f.total || 0;
      } else if (f.isExcluded) {
        target.excluidas_count += 1;
        target.excluidas_monto += (f.saldo_pendiente || f.total || 0);
      } else if (f.status === 'pago_parcial') {
        target.con_rep_monto += f.monto_pagado || 0;
        target.sin_rep_count += 1;
        target.sin_rep_monto += f.saldo_pendiente || 0;
      } else {
        target.sin_rep_count += 1;
        target.sin_rep_monto += f.total || 0;
      }
    });

    return { recibidos: rec, emitidos: emi };
  }, [enrichedFacturas]);

  const recibidosMet = computedMetrics.recibidos;
  const emitidosMet = computedMetrics.emitidos;

  // Columnas principales de Conciliación PPD vs REP
  const conciliacionColumns = [
    {
      title: 'Tipo / Flujo',
      dataIndex: 'cfdi_type',
      key: 'cfdi_type',
      width: 135,
      render: (type) => (
        <Tag color={type === 'emitido' ? 'blue' : 'purple'} className="font-semibold text-xs px-2 py-0.5 m-0">
          {type === 'emitido' ? '📤 Emitida (Cliente)' : '📥 Recibida (Proveedor)'}
        </Tag>
      ),
    },
    {
      title: 'Fecha',
      dataIndex: 'formatted_date',
      key: 'formatted_date',
      width: 95,
      render: (d) => <span className="text-xs font-medium text-gray-700">{d || 'S/F'}</span>
    },
    {
      title: 'Folio Factura PPD',
      dataIndex: 'folio',
      key: 'folio',
      width: 125,
      render: (folio, r) => (
        <div className={r.isExcluded ? 'opacity-50' : ''}>
          <span className="font-bold text-gray-900 text-xs block">{folio}</span>
          <Tooltip title={`Ver Factura XML (${r.uuid})`}>
            <a
              href={`/cfdi-viewer/${r.uuid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[11px] text-blue-600 hover:underline"
            >
              <span>{r.uuid.slice(0, 8)}...</span>
              <FileSearchOutlined style={{ fontSize: '10px' }} />
            </a>
          </Tooltip>
        </div>
      ),
    },
    {
      title: 'Cliente / Proveedor',
      key: 'party',
      width: 210,
      render: (_, r) => (
        <div className={r.isExcluded ? 'opacity-50' : ''}>
          <div className="font-medium text-xs text-gray-800 line-clamp-1" title={r.partner_name}>
            {r.partner_name || 'Sin Nombre'}
          </div>
          <div className="text-gray-400 text-[11px] font-mono">
            {r.partner_rfc}
          </div>
        </div>
      ),
    },
    {
      title: 'Total Factura',
      dataIndex: 'total',
      key: 'total',
      align: 'right',
      width: 120,
      render: (val, r) => (
        <span className={`font-bold text-xs tabular-nums ${r.isExcluded ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
          {formatMoney(val)}
        </span>
      ),
    },
    {
      title: 'Pagado / Saldo',
      key: 'monto_pagado',
      align: 'right',
      width: 130,
      render: (_, r) => (
        <div className="text-right tabular-nums text-xs">
          <div className={r.monto_pagado > 0 ? "font-semibold text-emerald-700" : "text-gray-400"}>
            {formatMoney(r.monto_pagado)}
          </div>
          {r.saldo_pendiente > 0.01 && (
            <div className={`text-[11px] font-medium ${r.isExcluded ? 'text-gray-400' : 'text-amber-700'}`}>
              Resta: {formatMoney(r.saldo_pendiente)}
            </div>
          )}
        </div>
      ),
    },
    {
      title: '¿Ya fue Pagada?',
      key: 'is_paid_toggle',
      width: 155,
      align: 'center',
      render: (_, r) => {
        if (r.status === 'con_complemento') {
          return (
            <Tag color="green" className="text-[11px] m-0">
              ✅ Pagada con REP
            </Tag>
          );
        }
        return (
          <Tooltip
            title={
              r.isExcluded
                ? 'Esta factura está marcada como NO pagada todavía. Haz clic para activarla cuando ya se haya pagado.'
                : 'Si todavía no has pagado/cobrado esta factura, desactívala para excluirla de la solicitud de complementos.'
            }
          >
            <div className="inline-flex items-center gap-1.5 bg-gray-50 px-2 py-1 rounded border border-gray-200">
              <Switch
                size="small"
                checked={!r.isExcluded}
                onChange={(checked) => toggleExcludeInvoice(r.uuid, !checked)}
              />
              <span className={`text-[11px] font-semibold ${r.isExcluded ? 'text-gray-400' : 'text-emerald-700'}`}>
                {r.isExcluded ? 'No pagada' : 'Sí, pagada'}
              </span>
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: 'Estatus del Complemento (REP)',
      key: 'status',
      width: 175,
      render: (_, r) => {
        if (r.status === 'con_complemento') {
          return (
            <Tag color="success" icon={<CheckCircleOutlined />} className="text-xs py-0.5 px-2 font-medium">
              Con Complemento ({r.reps_count})
            </Tag>
          );
        }
        if (r.isExcluded) {
          return (
            <Tag color="default" icon={<StopOutlined />} className="text-xs py-0.5 px-2 text-gray-500">
              Excluida (No Pagada)
            </Tag>
          );
        }
        if (r.status === 'pago_parcial') {
          return (
            <Tag color="processing" icon={<ClockCircleOutlined />} className="text-xs py-0.5 px-2 font-medium">
              Pago Parcial ({r.reps_count})
            </Tag>
          );
        }
        // Sin complemento
        if (r.cfdi_type === 'recibido') {
          return (
            <Tag color="error" icon={<ExclamationCircleOutlined />} className="text-xs py-0.5 px-2 font-bold">
              Falta Solicitar REP
            </Tag>
          );
        }
        return (
          <Tag color="warning" icon={<WarningOutlined />} className="text-xs py-0.5 px-2 font-bold">
            Falta Emitir REP
          </Tag>
        );
      },
    },
    {
      title: 'CFDI Relacionados / Complementos',
      key: 'reps_detalle',
      width: 205,
      render: (_, r) => {
        if (r.complementos && r.complementos.length > 0) {
          return (
            <div className="space-y-1">
              {r.complementos.map((rep, idx) => (
                <div key={idx} className="flex items-center justify-between text-[11px] bg-emerald-50/70 border border-emerald-200 px-2 py-0.5 rounded">
                  <div className="truncate pr-1">
                    <span className="font-semibold text-emerald-900">REP: {rep.rep_folio}</span>
                    <span className="text-gray-500 ml-1">({rep.rep_date ? dayjs(rep.rep_date).format('DD/MM/YY') : ''})</span>
                  </div>
                  <Tooltip title={`Ver CFDI REP (${rep.rep_uuid})`}>
                    <a
                      href={`/cfdi-viewer/${rep.rep_uuid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-blue-600 hover:underline flex items-center gap-0.5 ml-1 shrink-0"
                    >
                      <FileSearchOutlined style={{ fontSize: '11px' }} />
                    </a>
                  </Tooltip>
                </div>
              ))}
            </div>
          );
        }
        if (r.isExcluded) {
          return <span className="text-[11px] text-gray-400 italic">Factura aún pendiente de pago</span>;
        }
        return (
          <span className="text-[11px] text-gray-400 italic">
            {r.cfdi_type === 'recibido' ? 'Sin XML de pago del proveedor' : 'Sin CFDI de pago emitido'}
          </span>
        );
      },
    },
    {
      title: 'Acción Fiscal',
      key: 'action',
      width: 175,
      align: 'center',
      fixed: 'right',
      render: (_, r) => {
        if (r.status !== 'con_complemento') {
          if (r.isExcluded) {
            return (
              <Button
                size="small"
                icon={<UndoOutlined />}
                onClick={() => toggleExcludeInvoice(r.uuid, false)}
                className="text-xs text-gray-600"
              >
                Incluir (Ya pagada)
              </Button>
            );
          }
          if (r.cfdi_type === 'recibido') {
            return (
              <Space size={4}>
                <Tooltip title={`Abrir lista de solicitud para ${r.partner_name}`}>
                  <Button
                    type="primary"
                    danger
                    size="small"
                    icon={<UnorderedListOutlined />}
                    onClick={() => openBulkRequestModal(r.partner_rfc)}
                    className="text-xs shadow-sm font-medium"
                  >
                    Solicitar en Lista
                  </Button>
                </Tooltip>
              </Space>
            );
          }
          return (
            <Tag color="orange" className="text-xs py-0.5 font-medium m-0">
              Emitir al Cliente
            </Tag>
          );
        }

        return (
          <Button
            size="small"
            icon={<FileProtectOutlined className="text-emerald-600" />}
            onClick={() => setDetailModal(r)}
            className="text-xs"
          >
            Ver Detalle ({r.reps_count})
          </Button>
        );
      },
    },
  ];

  // Columnas del Catálogo de Complementos (Pestaña Secundaria)
  const repsCatalogoColumns = [
    {
      title: 'Fecha Pago',
      dataIndex: 'date',
      key: 'date',
      width: 130,
      render: d => <span className="text-xs font-medium">{d || '-'}</span>
    },
    {
      title: 'Flujo',
      dataIndex: 'cfdi_type',
      key: 'cfdi_type',
      width: 100,
      render: t => (
        <Tag color={t === 'emitido' ? 'blue' : 'purple'}>
          {t === 'emitido' ? 'EMITIDO' : 'RECIBIDO'}
        </Tag>
      )
    },
    {
      title: 'Folio REP',
      dataIndex: 'folio',
      key: 'folio',
      width: 120,
      render: (f, r) => (
        <Tooltip title={r.uuid}>
          <a href={`/cfdi-viewer/${r.uuid}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-blue-600 hover:underline">
            {f || r.uuid.slice(0, 8)}
          </a>
        </Tooltip>
      )
    },
    {
      title: 'Emisor / Receptor',
      key: 'partner',
      render: (_, r) => (
        <div>
          <div className="font-semibold text-xs text-gray-800">{r.partner_name}</div>
          <div className="text-gray-400 text-xs font-mono">RFC: {r.partner_rfc}</div>
        </div>
      )
    },
    {
      title: 'UUID Factura Relacionada',
      dataIndex: 'related_uuid',
      key: 'related_uuid',
      width: 180,
      render: (rel) => rel ? (
        <a href={`/cfdi-viewer/${rel}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-blue-600 hover:underline">
          {rel.slice(0, 16)}...
        </a>
      ) : <span className="text-gray-400 text-xs italic">En nodo DoctoRelacionado</span>
    },
    {
      title: 'Monto Total REP',
      dataIndex: 'total',
      key: 'total',
      align: 'right',
      width: 130,
      render: v => <span className="font-bold text-emerald-700 text-xs tabular-nums">{formatMoney(v)}</span>
    },
    {
      title: 'Póliza',
      dataIndex: 'is_posted',
      key: 'is_posted',
      width: 120,
      align: 'center',
      render: p => p ? <Tag color="green">Contabilizado</Tag> : <Tag color="default">Sin Póliza</Tag>
    }
  ];

  return (
    <div className="p-6 print:p-0">
      {/* Encabezado */}
      <div className="flex flex-wrap justify-between items-center mb-5 print:hidden gap-4">
        <div>
          <Title level={2} className="m-0 flex items-center gap-2 text-gray-800">
            <PayCircleOutlined className="text-emerald-600 text-2xl" />
            Conciliación de Facturas PPD y Complementos de Pago (REP)
          </Title>
          <Text type="secondary" className="text-xs">
            Empresa: <strong className="text-gray-700">{clientInfo ? `${clientInfo.rfc} - ${clientInfo.business_name}` : 'Cargando...'}</strong>
          </Text>
        </div>
        <Space wrap>
          <Button
            type="primary"
            danger
            icon={<UnorderedListOutlined />}
            onClick={() => openBulkRequestModal('ALL')}
            size="middle"
            className="font-semibold shadow-sm"
          >
            Solicitar Complementos en Lista ({recibidosMet.sin_rep_count || 0})
          </Button>
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
          <Link to={`/cfdi-upload/${clientId}`}>
            <Button type="primary" className="bg-blue-600">
              Cargar más XML
            </Button>
          </Link>
        </Space>
      </div>

      {/* Tarjetas KPI Resumen - DE UNA SOLA VISTA */}
      <Row gutter={[16, 16]} className="mb-5 print:mb-3">
        {/* KPI Facturas de Proveedores (Recibidas) */}
        <Col xs={24} md={12}>
          <Card 
            size="small" 
            className="border-purple-200 bg-gradient-to-br from-purple-50/40 via-white to-white shadow-sm hover:shadow transition"
          >
            <div className="flex justify-between items-start mb-2 gap-2 flex-wrap">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-purple-900 block">
                  📥 Facturas PPD de Proveedores (Gastos y Compras)
                </span>
                <span className="text-[11px] text-gray-500">Obligación de solicitar comprobantes fiscales de pago</span>
              </div>
              <Space size={6}>
                <Tag color="purple" className="m-0 font-bold">{recibidosMet.total_count || 0} Facturas</Tag>
                {recibidosMet.sin_rep_count > 0 && (
                  <Button
                    type="primary"
                    danger
                    size="small"
                    icon={<SendOutlined />}
                    onClick={() => openBulkRequestModal('ALL')}
                    className="text-xs font-semibold"
                  >
                    Generar Lista de Solicitud
                  </Button>
                )}
              </Space>
            </div>

            <Row gutter={8} className="mt-3 pt-2 border-t border-purple-100">
              <Col span={6}>
                <Statistic
                  title={<span className="text-[11px] text-gray-500">Total PPD</span>}
                  value={recibidosMet.total_monto || 0}
                  formatter={formatMoney}
                  valueStyle={{ fontSize: '13px', fontWeight: 700, color: '#374151' }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title={<span className="text-[11px] text-emerald-700 font-semibold">Con REP ✅</span>}
                  value={recibidosMet.con_rep_count || 0}
                  suffix={<span className="text-[11px] text-gray-400 font-normal">({formatMoney(recibidosMet.con_rep_monto || 0)})</span>}
                  valueStyle={{ fontSize: '13px', fontWeight: 700, color: '#047857' }}
                />
              </Col>
              <Col span={6}>
                <div
                  onClick={() => openBulkRequestModal('ALL')}
                  className="bg-red-50 p-1.5 rounded border border-red-200 cursor-pointer hover:bg-red-100/70 transition"
                  title="Clic para abrir la lista de solicitud de complementos"
                >
                  <Statistic
                    title={<span className="text-[11px] text-red-700 font-bold">Solicitar REP 🚨</span>}
                    value={recibidosMet.sin_rep_count || 0}
                    suffix={<span className="text-[11px] text-red-600 font-semibold">({formatMoney(recibidosMet.sin_rep_monto || 0)})</span>}
                    valueStyle={{ fontSize: '14px', fontWeight: 800, color: '#b91c1c' }}
                  />
                </div>
              </Col>
              <Col span={6}>
                <div className="bg-gray-50 p-1.5 rounded border border-gray-200">
                  <Statistic
                    title={<span className="text-[11px] text-gray-600 font-medium">No Pagadas ⏳</span>}
                    value={recibidosMet.excluidas_count || 0}
                    suffix={<span className="text-[11px] text-gray-400">({formatMoney(recibidosMet.excluidas_monto || 0)})</span>}
                    valueStyle={{ fontSize: '13px', fontWeight: 700, color: '#6b7280' }}
                  />
                </div>
              </Col>
            </Row>
          </Card>
        </Col>

        {/* KPI Facturas Propias Emitidas (Clientes) */}
        <Col xs={24} md={12}>
          <Card 
            size="small" 
            className="border-blue-200 bg-gradient-to-br from-blue-50/40 via-white to-white shadow-sm hover:shadow transition"
          >
            <div className="flex justify-between items-start mb-2">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-blue-900 block">
                  📤 Facturas PPD Propias (Ventas a Clientes)
                </span>
                <span className="text-[11px] text-gray-500">Obligación de emitir y timbrar el REP al cobrar</span>
              </div>
              <Tag color="blue" className="m-0 font-bold">{emitidosMet.total_count || 0} Facturas</Tag>
            </div>

            <Row gutter={8} className="mt-3 pt-2 border-t border-blue-100">
              <Col span={6}>
                <Statistic
                  title={<span className="text-[11px] text-gray-500">Total PPD</span>}
                  value={emitidosMet.total_monto || 0}
                  formatter={formatMoney}
                  valueStyle={{ fontSize: '13px', fontWeight: 700, color: '#374151' }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title={<span className="text-[11px] text-emerald-700 font-semibold">Con REP ✅</span>}
                  value={emitidosMet.con_rep_count || 0}
                  suffix={<span className="text-[11px] text-gray-400 font-normal">({formatMoney(emitidosMet.con_rep_monto || 0)})</span>}
                  valueStyle={{ fontSize: '13px', fontWeight: 700, color: '#047857' }}
                />
              </Col>
              <Col span={6}>
                <div className="bg-amber-50 p-1.5 rounded border border-amber-200">
                  <Statistic
                    title={<span className="text-[11px] text-amber-800 font-bold">Emitir REP ⚠️</span>}
                    value={emitidosMet.sin_rep_count || 0}
                    suffix={<span className="text-[11px] text-amber-700 font-semibold">({formatMoney(emitidosMet.sin_rep_monto || 0)})</span>}
                    valueStyle={{ fontSize: '14px', fontWeight: 800, color: '#b45309' }}
                  />
                </div>
              </Col>
              <Col span={6}>
                <div className="bg-gray-50 p-1.5 rounded border border-gray-200">
                  <Statistic
                    title={<span className="text-[11px] text-gray-600 font-medium">No Cobradas ⏳</span>}
                    value={emitidosMet.excluidas_count || 0}
                    suffix={<span className="text-[11px] text-gray-400">({formatMoney(emitidosMet.excluidas_monto || 0)})</span>}
                    valueStyle={{ fontSize: '13px', fontWeight: 700, color: '#6b7280' }}
                  />
                </div>
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      {/* Barra de Filtros y Búsqueda */}
      <Card size="small" className="mb-4 shadow-sm bg-white print:hidden border border-gray-100">
        <Row gutter={[12, 12]} align="bottom">
          {/* Año */}
          <Col xs={12} sm={6} md={3}>
            <label className="block mb-1 text-xs font-bold text-gray-700">📅 Año</label>
            <Select value={year} onChange={setYear} className="w-full">
              <Option value="all">Todos</Option>
              {[currentYear + 1, currentYear, currentYear - 1, currentYear - 2].map((y) => (
                <Option key={y} value={y}>{y}</Option>
              ))}
            </Select>
          </Col>

          {/* Mes */}
          <Col xs={12} sm={6} md={3}>
            <label className="block mb-1 text-xs font-bold text-gray-700">🗓️ Mes</label>
            <Select value={month} onChange={setMonth} className="w-full">
              <Option value="all">Todos los Meses</Option>
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

          {/* Tipo de Flujo */}
          <Col xs={12} sm={6} md={4}>
            <label className="block mb-1 text-xs font-bold text-gray-700">🔀 Flujo</label>
            <Select value={tipoFilter} onChange={setTipoFilter} className="w-full">
              <Option value="all">Todas (Emitidas y Recibidas)</Option>
              <Option value="recibido">📥 Recibidas de Proveedores</Option>
              <Option value="emitido">📤 Emitidas a Clientes</Option>
            </Select>
          </Col>

          {/* Estatus del Complemento */}
          <Col xs={12} sm={6} md={5}>
            <label className="block mb-1 text-xs font-bold text-gray-700">🚦 Estatus de Complemento</label>
            <Select value={statusFilter} onChange={setStatusFilter} className="w-full">
              <Option value="all">Todos los Estatus</Option>
              <Option value="sin_complemento">🚨 Faltan Complementos (Ya Pagadas)</Option>
              <Option value="con_complemento">✅ Con Complemento Completo</Option>
              <Option value="pago_parcial">🟡 Con Pago Parcial</Option>
              <Option value="excluidas_no_pagadas">⏳ Excluidas (Aún No Pagadas)</Option>
            </Select>
          </Col>

          {/* Búsqueda */}
          <Col xs={24} md={6}>
            <label className="block mb-1 text-xs font-bold text-gray-700">Búsqueda Rápida</label>
            <Input
              placeholder="Proveedor, Cliente, Folio, RFC..."
              prefix={<SearchOutlined className="text-gray-400" />}
              allowClear
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-full"
            />
          </Col>

          {/* Botón Actualizar */}
          <Col xs={24} md={3}>
            <Button type="primary" onClick={fetchData} loading={loading} className="w-full bg-blue-600">
              Actualizar
            </Button>
          </Col>
        </Row>
      </Card>

      {error && <Alert message={error} type="error" className="mb-4 print:hidden" showIcon />}

      {/* Tabs Principales: Conciliación de PPD vs Catálogo de REPs */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        size="large"
        className="bg-white px-4 pt-2 rounded-lg shadow-sm"
        items={[
          {
            key: 'conciliacion',
            label: (
              <span className="font-semibold text-sm flex items-center gap-1.5">
                <FileProtectOutlined />
                <span>Conciliación de Facturas PPD vs Complementos</span>
                <Badge count={displayedFacturas.length} overflowCount={9999} style={{ backgroundColor: '#108ee9' }} />
              </span>
            ),
            children: (
              <div className="py-2">
                <Table
                  columns={conciliacionColumns}
                  dataSource={displayedFacturas}
                  rowKey="id"
                  loading={loading}
                  scroll={{ x: 1480 }}
                  pagination={{
                    defaultPageSize: 15,
                    pageSizeOptions: ['10', '15', '30', '50', '100'],
                    showSizeChanger: true,
                    showTotal: (total, range) => `${range[0]}-${range[1]} de ${total} facturas PPD`,
                  }}
                  locale={{
                    emptyText: (
                      <div className="py-12 text-center text-gray-400">
                        <PayCircleOutlined className="text-4xl mb-2 text-gray-300" />
                        <div>No se encontraron facturas PPD con los filtros seleccionados.</div>
                        <div className="text-xs text-gray-400 mt-1">
                          Pruebe seleccionando "Todos los Meses" o cambiando el filtro de estatus.
                        </div>
                      </div>
                    )
                  }}
                />
              </div>
            )
          },
          {
            key: 'reps_catalogo',
            label: (
              <span className="font-semibold text-sm flex items-center gap-1.5">
                <PayCircleOutlined />
                <span>Repositorio de Complementos de Pago Cargados</span>
                <Badge count={data?.reps_catalogo?.length || 0} overflowCount={9999} style={{ backgroundColor: '#52c41a' }} />
              </span>
            ),
            children: (
              <div className="py-2">
                <div className="mb-3 text-xs text-gray-500">
                  Mostrando todos los CFDI de tipo 'P' (Complementos de Pago) registrados para esta empresa.
                </div>
                <Table
                  columns={repsCatalogoColumns}
                  dataSource={data?.reps_catalogo || []}
                  rowKey="id"
                  loading={loading}
                  scroll={{ x: 1100 }}
                  pagination={{
                    defaultPageSize: 15,
                    showSizeChanger: true,
                    showTotal: (total, range) => `${range[0]}-${range[1]} de ${total} complementos`,
                  }}
                />
              </div>
            )
          }
        ]}
      />

      {/* Modal: Solicitud Masiva / En una sola lista a Proveedores con Exclusión Manual de No Pagadas */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-gray-800">
            <UnorderedListOutlined className="text-red-600" />
            <span>Solicitar Complementos de Pago (REP) en una Sola Lista</span>
          </div>
        }
        open={bulkModalOpen}
        onCancel={() => setBulkModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setBulkModalOpen(false)}>
            Cerrar
          </Button>,
          <Button
            key="copy"
            type="primary"
            icon={<CopyOutlined />}
            onClick={() => handleCopyText(consolidatedRequestText)}
            className="bg-blue-600 font-semibold"
          >
            Copiar Lista Completa para WhatsApp / Correo
          </Button>
        ]}
        width={920}
      >
        <div className="py-1 text-sm space-y-4">
          <Alert
            message="Genera una sola lista con todos los complementos faltantes y excluye las facturas que aún no hayas pagado"
            description="Puedes desactivar el interruptor '¿Ya pagada?' en aquellas facturas que todavía no se han liquidado; quedarán excluidas automáticamente de la lista y guardadas para futuras consultas."
            type="info"
            showIcon
            className="text-xs"
          />

          {/* Selector de Proveedor y Acciones Rápidas */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-50 p-3 rounded border border-gray-200">
            <div className="flex items-center gap-2 flex-1 min-w-[260px]">
              <span className="text-xs font-bold text-gray-700 whitespace-nowrap">Filtrar Proveedor:</span>
              <Select
                value={bulkSupplierFilter}
                onChange={handleSupplierFilterChangeInModal}
                className="w-full max-w-md"
                size="middle"
              >
                <Option value="ALL">
                  📋 Todos los Proveedores en una sola lista ({allSupplierPendingFacturas.filter(f => !f.isExcluded).length} pagadas pendientes)
                </Option>
                {suppliersWithPending.map(sup => (
                  <Option key={sup.rfc} value={sup.rfc}>
                    🏢 {sup.name} ({sup.rfc}) — {sup.activeCount} por solicitar / {sup.totalCount} total
                  </Option>
                ))}
              </Select>
            </div>

            <Space size={8} wrap>
              <Button
                size="small"
                onClick={() => {
                  const activeUuids = modalFacturasList.filter(f => !f.isExcluded).map(f => f.uuid);
                  setSelectedModalUuids(activeUuids);
                }}
              >
                Seleccionar todas las pagadas
              </Button>
              {excludedUuids.length > 0 && (
                <Button
                  size="small"
                  icon={<UndoOutlined />}
                  onClick={() => {
                    saveExcludedUuids([]);
                    const allUuids = modalFacturasList.map(f => f.uuid);
                    setSelectedModalUuids(allUuids);
                    message.success('Se restauraron todas las facturas excluidas.');
                  }}
                >
                  Restaurar excluidas ({excludedUuids.length})
                </Button>
              )}
            </Space>
          </div>

          {/* Tabla interactiva para marcar/excluir facturas no pagadas */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs font-bold text-gray-700">
                1. Marca o excluye manualmente las facturas que todavía no estén pagadas:
              </span>
              <span className="text-xs text-gray-500">
                Incluidas en la lista: <strong className="text-emerald-700">{modalFacturasList.filter(f => !f.isExcluded && selectedModalUuids.includes(f.uuid)).length}</strong> de {modalFacturasList.length}
              </span>
            </div>

            <Table
              size="small"
              rowKey="uuid"
              dataSource={modalFacturasList}
              pagination={{ pageSize: 6, showSizeChanger: false }}
              scroll={{ y: 240 }}
              rowSelection={{
                selectedRowKeys: selectedModalUuids.filter(u => !excludedUuids.includes((u || '').toUpperCase())),
                onChange: (keys) => setSelectedModalUuids(keys),
                getCheckboxProps: (record) => ({
                  disabled: record.isExcluded,
                }),
              }}
              columns={[
                {
                  title: 'Fecha',
                  dataIndex: 'formatted_date',
                  width: 90,
                  render: (d, r) => <span className={`text-xs ${r.isExcluded ? 'text-gray-400 line-through' : ''}`}>{d}</span>
                },
                {
                  title: 'Folio / UUID',
                  key: 'folio',
                  width: 150,
                  render: (_, r) => (
                    <div className={r.isExcluded ? 'opacity-40' : ''}>
                      <div className="font-bold text-xs">{r.folio}</div>
                      <div className="font-mono text-[10px] text-gray-500">{r.uuid.slice(0, 13)}...</div>
                    </div>
                  )
                },
                {
                  title: 'Proveedor',
                  key: 'partner',
                  render: (_, r) => (
                    <div className={r.isExcluded ? 'opacity-40' : ''}>
                      <div className="font-medium text-xs line-clamp-1">{r.partner_name}</div>
                      <div className="font-mono text-[10px] text-gray-400">{r.partner_rfc}</div>
                    </div>
                  )
                },
                {
                  title: 'Importe a Comprobar',
                  key: 'monto',
                  align: 'right',
                  width: 130,
                  render: (_, r) => (
                    <span className={`font-bold text-xs tabular-nums ${r.isExcluded ? 'text-gray-400 line-through' : 'text-red-600'}`}>
                      {formatMoney(r.status === 'pago_parcial' ? r.saldo_pendiente : r.total)}
                    </span>
                  )
                },
                {
                  title: '¿Ya está Pagada?',
                  key: 'exclude_action',
                  width: 175,
                  align: 'center',
                  render: (_, r) => (
                    <Space size={6}>
                      <Switch
                        size="small"
                        checked={!r.isExcluded}
                        onChange={(checked) => {
                          toggleExcludeInvoice(r.uuid, !checked);
                          if (checked) {
                            setSelectedModalUuids(prev => prev.includes(r.uuid) ? prev : [...prev, r.uuid]);
                          } else {
                            setSelectedModalUuids(prev => prev.filter(id => id !== r.uuid));
                          }
                        }}
                      />
                      <span className={`text-xs font-semibold ${r.isExcluded ? 'text-gray-400' : 'text-emerald-700'}`}>
                        {r.isExcluded ? 'No pagada (Excluida)' : 'Pagada (Solicitar)'}
                      </span>
                    </Space>
                  )
                }
              ]}
            />
          </div>

          {/* Texto Consolidado en una sola lista */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-xs font-bold text-gray-700">
                2. Lista Consolidada Lista para Copiar y Enviar (WhatsApp / Correo):
              </label>
              <Button
                type="link"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => handleCopyText(consolidatedRequestText)}
                className="p-0 text-xs"
              >
                Copiar texto
              </Button>
            </div>
            <Input.TextArea
              value={consolidatedRequestText}
              rows={9}
              readOnly
              className="font-mono text-xs bg-gray-50"
            />
          </div>
        </div>
      </Modal>

      {/* Modal: Detalle de Complementos de Pago Vinculados */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-gray-800">
            <FileProtectOutlined className="text-emerald-600" />
            <span>Complementos de Pago Vinculados</span>
          </div>
        }
        open={Boolean(detailModal)}
        onCancel={() => setDetailModal(null)}
        footer={[
          <Button key="close" type="primary" onClick={() => setDetailModal(null)}>
            Cerrar
          </Button>
        ]}
        width={750}
      >
        {detailModal && (
          <div className="py-2 text-sm space-y-4">
            <div className="bg-gray-50 p-3 rounded border text-xs space-y-1">
              <div><strong>Factura PPD:</strong> {detailModal.folio} ({detailModal.uuid})</div>
              <div><strong>Entidad:</strong> {detailModal.partner_name} ({detailModal.partner_rfc})</div>
              <div><strong>Total Factura:</strong> {formatMoney(detailModal.total)}</div>
              <div><strong>Monto Cubierto en Pagos:</strong> <span className="text-emerald-700 font-bold">{formatMoney(detailModal.monto_pagado)}</span></div>
              {detailModal.saldo_pendiente > 0.01 && (
                <div><strong>Saldo Pendiente:</strong> <span className="text-amber-700 font-bold">{formatMoney(detailModal.saldo_pendiente)}</span></div>
              )}
            </div>

            <div>
              <div className="text-xs font-bold text-gray-700 mb-2">Desglose de Complementos (REP) Asociados:</div>
              <div className="space-y-2">
                {(detailModal.complementos || []).map((rep, idx) => (
                  <div key={idx} className="p-3 bg-emerald-50/50 border border-emerald-200 rounded text-xs space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-emerald-900">REP #{idx + 1} - Folio: {rep.rep_folio}</span>
                      <span className="font-bold text-emerald-700 text-sm tabular-nums">{formatMoney(rep.monto_pagado)}</span>
                    </div>
                    <div className="font-mono text-gray-600 text-[11px]">UUID Pago: {rep.rep_uuid}</div>
                    <div className="flex justify-between text-gray-500 text-[11px] pt-1 border-t border-emerald-100">
                      <span>Fecha Pago: {rep.rep_date ? dayjs(rep.rep_date).format('DD/MM/YYYY HH:mm') : 'S/F'}</span>
                      <span>Forma Pago: {rep.rep_payment_form}</span>
                      <span>Parcialidad: #{rep.num_parcialidad || 1}</span>
                      <a href={`/cfdi-viewer/${rep.rep_uuid}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        Ver CFDI XML
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default FiscalComplementosPago;
