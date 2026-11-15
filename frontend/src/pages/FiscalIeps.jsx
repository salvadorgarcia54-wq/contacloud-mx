import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Card,
  Table,
  Row,
  Col,
  Select,
  Button,
  Typography,
  Alert,
  Spin,
  Tag,
  Statistic,
  Tabs,
  Input,
  Space,
  Checkbox,
  Tooltip,
  Modal,
  Segmented,
  message,
} from 'antd';
import {
  CalculatorOutlined,
  PrinterOutlined,
  CheckCircleOutlined,
  SearchOutlined,
  UndoOutlined,
  FileSearchOutlined,
  SwapOutlined,
  EyeOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  DownloadOutlined,
  FileDoneOutlined,
} from '@ant-design/icons';
import { fiscalApi, clientsApi } from '../api/client';
import { exportToExcel, exportToPdfWithLogo } from '../utils/exportPaperwork';

const { Title } = Typography;
const { Option } = Select;

const FiscalIeps = () => {
  const { clientId } = useParams();
  const [loading, setLoading] = useState(true);
  const [downloadingTxt, setDownloadingTxt] = useState(false);
  const [clientInfo, setClientInfo] = useState(null);
  const [data, setData] = useState(null);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(2);
  const [activeTab, setActiveTab] = useState('emitidos');
  const [searchEmitidos, setSearchEmitidos] = useState('');
  const [searchRecibidos, setSearchRecibidos] = useState('');
  const [searchInformativa, setSearchInformativa] = useState('');
  const [infoScope, setInfoScope] = useState('mensual'); // 'mensual' | 'trimestral'
  const [infoAnexoView, setInfoAnexoView] = useState('proveedores'); // 'proveedores' | 'clientes' | 'conceptos'
  const [error, setError] = useState(null);

  // Omisiones manuales de comprobantes por cliente y periodo
  const storageKey = `fiscal_ieps_omitted_${clientId}_${year}_${month}`;
  const [omittedIds, setOmittedIds] = useState(() => {
    try {
      const saved = localStorage.getItem(`fiscal_ieps_omitted_${clientId}_${year}_${month}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Comprobantes recibidos marcados como "No Acreditable (Al Gasto)" para efectos del cálculo mensual
  const nonCreditableKey = `fiscal_ieps_noncreditable_${clientId}_${year}_${month}`;
  const [nonCreditableIds, setNonCreditableIds] = useState(() => {
    try {
      const saved = localStorage.getItem(`fiscal_ieps_noncreditable_${clientId}_${year}_${month}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      const savedOmitted = localStorage.getItem(`fiscal_ieps_omitted_${clientId}_${year}_${month}`);
      setOmittedIds(savedOmitted ? JSON.parse(savedOmitted) : []);
      const savedNonCred = localStorage.getItem(`fiscal_ieps_noncreditable_${clientId}_${year}_${month}`);
      setNonCreditableIds(savedNonCred ? JSON.parse(savedNonCred) : []);
    } catch {
      setOmittedIds([]);
      setNonCreditableIds([]);
    }
  }, [clientId, year, month]);

  const toggleOmit = (id) => {
    setOmittedIds((prev) => {
      const updated = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(storageKey, JSON.stringify(updated));
      } catch (e) {
        console.error('Error guardando omisiones IEPS:', e);
      }
      return updated;
    });
  };

  const toggleNonCreditable = (id) => {
    setNonCreditableIds((prev) => {
      const updated = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(nonCreditableKey, JSON.stringify(updated));
      } catch (e) {
        console.error('Error guardando clasificación IEPS:', e);
      }
      return updated;
    });
  };

  const resetOmitted = () => {
    setOmittedIds([]);
    setNonCreditableIds([]);
    try {
      localStorage.removeItem(storageKey);
      localStorage.removeItem(nonCreditableKey);
    } catch (e) {
      console.error('Error al restablecer omisiones IEPS:', e);
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
      const [clientRes, iepsRes] = await Promise.all([
        clientsApi.get(clientId),
        fiscalApi.getIepsReport(clientId, { year, month }),
      ]);
      setClientInfo(clientRes.data);
      setData(iepsRes.data);
    } catch (err) {
      console.error('Error fetching IEPS calculation:', err);
      setError('No se pudo cargar el cálculo mensual de IEPS del periodo.');
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

  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];

  // Separación de comprobantes con IEPS del periodo
  const allInvoices = [...(data?.invoices || [])].sort(
    (a, b) => (a.date || '').localeCompare(b.date || '') || (a.id || 0) - (b.id || 0)
  );
  const emitidosAll = allInvoices.filter((i) => i.cfdi_type === 'emitido');
  const recibidosAll = allInvoices.filter((i) => i.cfdi_type === 'recibido');

  const activeEmitidosAll = emitidosAll.filter((i) => !omittedIds.includes(i.id));
  const activeRecibidosAll = recibidosAll.filter((i) => !omittedIds.includes(i.id));

  const activeEmitidosTotals = activeEmitidosAll.reduce(
    (acc, r) => {
      acc.base_ieps += Number(r.base_ieps) || 0;
      acc.ieps += Number(r.ieps) || 0;
      acc.retencion_ieps += Number(r.retencion_ieps) || 0;
      acc.total += Number(r.total) || 0;
      return acc;
    },
    { base_ieps: 0, ieps: 0, retencion_ieps: 0, total: 0 }
  );

  const activeRecibidosTotals = activeRecibidosAll.reduce(
    (acc, r) => {
      const isGasto = nonCreditableIds.includes(r.id);
      if (isGasto) {
        acc.ieps_gasto += Number(r.ieps) || 0;
      } else {
        acc.base_ieps += Number(r.base_ieps) || 0;
        acc.ieps += Number(r.ieps) || 0;
      }
      acc.retencion_ieps += Number(r.retencion_ieps) || 0;
      acc.total += Number(r.total) || 0;
      return acc;
    },
    { base_ieps: 0, ieps: 0, ieps_gasto: 0, retencion_ieps: 0, total: 0 }
  );

  // Determinación mensual de IEPS considerando omisiones y clasificación Acreditable vs Gasto
  const cta208Cobrado = Number(data?.contabilidad?.cta_208_02_cobrado || 0);
  const cta118Pagado = Number(data?.contabilidad?.cta_118_03_pagado || 0);

  const dynamicIepsCausado =
    Math.round(
      (emitidosAll.length > 0 ? activeEmitidosTotals.ieps : cta208Cobrado) * 100
    ) / 100;
  const dynamicBaseCausado = Math.round(activeEmitidosTotals.base_ieps * 100) / 100;

  const dynamicIepsAcreditable =
    Math.round(
      (recibidosAll.length > 0 ? activeRecibidosTotals.ieps : cta118Pagado) * 100
    ) / 100;
  const dynamicBaseAcreditable = Math.round(activeRecibidosTotals.base_ieps * 100) / 100;

  const dynamicIepsGasto =
    Math.round(
      (activeRecibidosTotals.ieps_gasto || Number(data?.summary?.ieps_en_gasto) || 0) * 100
    ) / 100;

  const dynamicRetenciones =
    Math.round(
      (activeEmitidosTotals.retencion_ieps ||
        activeRecibidosTotals.retencion_ieps ||
        Number(data?.summary?.retenciones_ieps) ||
        0) * 100
    ) / 100;

  const dynamicNet =
    Math.round((dynamicIepsCausado - dynamicIepsAcreditable - dynamicRetenciones) * 100) / 100;
  const dynamicIepsCargo = Math.max(0, dynamicNet);
  const dynamicIepsFavor = Math.max(0, -dynamicNet);

  // Filtrado por búsqueda
  const emitidos = emitidosAll.filter((i) => {
    if (!searchEmitidos) return true;
    const term = searchEmitidos.toLowerCase();
    return (
      (i.rfc || '').toLowerCase().includes(term) ||
      (i.name || '').toLowerCase().includes(term) ||
      (i.folio || '').toLowerCase().includes(term) ||
      (i.uuid || '').toLowerCase().includes(term) ||
      (i.categoria_ieps || '').toLowerCase().includes(term) ||
      (i.tasa_principal || '').toLowerCase().includes(term)
    );
  });

  const recibidos = recibidosAll.filter((i) => {
    if (!searchRecibidos) return true;
    const term = searchRecibidos.toLowerCase();
    return (
      (i.rfc || '').toLowerCase().includes(term) ||
      (i.name || '').toLowerCase().includes(term) ||
      (i.folio || '').toLowerCase().includes(term) ||
      (i.uuid || '').toLowerCase().includes(term) ||
      (i.categoria_ieps || '').toLowerCase().includes(term) ||
      (i.tasa_principal || '').toLowerCase().includes(term)
    );
  });

  // Datos de la Declaración Informativa IEPS (MULTI-IEPS)
  const currentInformativa =
    infoScope === 'trimestral'
      ? data?.informativa?.trimestral || {
          clientes: [],
          proveedores: [],
          resumen_anexos: [],
          totales_clientes: {},
          totales_proveedores: {},
        }
      : data?.informativa?.mensual || {
          clientes: [],
          proveedores: [],
          resumen_anexos: [],
          totales_clientes: {},
          totales_proveedores: {},
        };

  const filteredInfoClientes = (currentInformativa.clientes || []).filter((c) => {
    if (!searchInformativa) return true;
    const t = searchInformativa.toLowerCase();
    return (
      (c.rfc || '').toLowerCase().includes(t) ||
      (c.nombre || '').toLowerCase().includes(t) ||
      (c.categoria_ieps || '').toLowerCase().includes(t) ||
      (c.anexo_multi_ieps || '').toLowerCase().includes(t)
    );
  });

  const filteredInfoProveedores = (currentInformativa.proveedores || []).filter((p) => {
    if (!searchInformativa) return true;
    const t = searchInformativa.toLowerCase();
    return (
      (p.rfc || '').toLowerCase().includes(t) ||
      (p.nombre || '').toLowerCase().includes(t) ||
      (p.categoria_ieps || '').toLowerCase().includes(t) ||
      (p.anexo_multi_ieps || '').toLowerCase().includes(t)
    );
  });

  const filteredInfoAnexos = (currentInformativa.resumen_anexos || []).filter((a) => {
    if (!searchInformativa) return true;
    const t = searchInformativa.toLowerCase();
    return (
      (a.anexo || '').toLowerCase().includes(t) ||
      (a.categoria || '').toLowerCase().includes(t) ||
      (a.tasa_label || '').toLowerCase().includes(t)
    );
  });

  // Descarga de archivo Batch TXT MULTI-IEPS SAT
  const handleDownloadInformativaTxt = async (anexoParam = 'todos') => {
    setDownloadingTxt(true);
    try {
      const response = await fiscalApi.exportIepsInformativaTxt(clientId, {
        year,
        month,
        scope: infoScope,
        anexo: anexoParam,
      });
      const blob = new Blob([response.data], { type: 'text/plain;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const periodTag =
        infoScope === 'trimestral'
          ? `${year}_T${data?.quarter || Math.ceil(month / 3)}`
          : `${year}_${String(month).padStart(2, '0')}`;
      link.setAttribute(
        'download',
        `MULTI_IEPS_${clientInfo?.rfc || 'CLIENTE'}_${periodTag}_${anexoParam.toUpperCase()}.txt`
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      message.success('Archivo Batch para Declaración Informativa IEPS (MULTI-IEPS SAT) generado exitosamente.');
    } catch (err) {
      console.error('Error descargando TXT Informativa IEPS:', err);
      message.error('No se pudo generar el archivo TXT de la Declaración Informativa IEPS.');
    } finally {
      setDownloadingTxt(false);
    }
  };

  // Construcción de Papel de Trabajo para Excel y PDF Membretado
  const buildIepsExportPayload = (forceInformativa = false) => {
    if (!data) return null;

    if (forceInformativa || activeTab === 'informativa') {
      const columnsDef = [
        { key: 'relacion', title: 'Tipo Tercero', align: 'center', format: 'text', width: 15 },
        { key: 'rfc', title: 'RFC Tercero', align: 'left', format: 'text', width: 16 },
        { key: 'nombre', title: 'Razón Social / Tercero', align: 'left', format: 'text', width: 32 },
        { key: 'anexo', title: 'Anexo MULTI-IEPS', align: 'left', format: 'text', width: 26 },
        { key: 'categoria', title: 'Categoría / Concepto IEPS', align: 'left', format: 'text', width: 32 },
        { key: 'tasa', title: 'Tasa / Cuota', align: 'center', format: 'text', width: 14 },
        { key: 'unidades', title: 'Unidades', align: 'right', format: 'number', width: 12 },
        { key: 'base_ieps', title: 'Valor Actos (Base)', align: 'right', format: 'currency', width: 18 },
        { key: 'ieps', title: 'Monto IEPS', align: 'right', format: 'currency', width: 16 },
        { key: 'ieps_ret', title: 'IEPS Retenido', align: 'right', format: 'currency', width: 15 },
      ];

      const rows = [];
      rows.push({
        relacion: 'CLIENTES',
        rfc: '',
        nombre: 'I. OPERACIONES CON CLIENTES (IEPS TRASLADADO EN ENAJENACIONES)',
        anexo: '',
        categoria: '',
        tasa: '',
        unidades: '',
        base_ieps: '',
        ieps: '',
        ieps_ret: '',
        _rowType: 'section',
      });

      filteredInfoClientes.forEach((c) => {
        rows.push({
          relacion: 'Cliente',
          rfc: c.rfc,
          nombre: c.nombre,
          anexo: c.anexo_multi_ieps,
          categoria: c.categoria_ieps,
          tasa: c.tasa_principal,
          unidades: Number(c.cantidad_unidades || 0),
          base_ieps: Number(c.base_ieps || 0),
          ieps: Number(c.ieps_causado_o_pagado || 0),
          ieps_ret: Number(c.ieps_retenido || 0),
          _rowType: 'normal',
        });
      });

      rows.push({
        relacion: '',
        rfc: '',
        nombre: `SUBTOTAL CLIENTES (${filteredInfoClientes.length} REGISTROS)`,
        anexo: '',
        categoria: '',
        tasa: '',
        unidades: filteredInfoClientes.reduce((a, b) => a + Number(b.cantidad_unidades || 0), 0),
        base_ieps: filteredInfoClientes.reduce((a, b) => a + Number(b.base_ieps || 0), 0),
        ieps: filteredInfoClientes.reduce((a, b) => a + Number(b.ieps_causado_o_pagado || 0), 0),
        ieps_ret: filteredInfoClientes.reduce((a, b) => a + Number(b.ieps_retenido || 0), 0),
        _rowType: 'subtotal',
      });

      rows.push({
        relacion: 'PROVEEDORES',
        rfc: '',
        nombre: 'II. OPERACIONES CON PROVEEDORES (IEPS PAGADO EN ADQUISICIONES)',
        anexo: '',
        categoria: '',
        tasa: '',
        unidades: '',
        base_ieps: '',
        ieps: '',
        ieps_ret: '',
        _rowType: 'section',
      });

      filteredInfoProveedores.forEach((p) => {
        rows.push({
          relacion: 'Proveedor',
          rfc: p.rfc,
          nombre: p.nombre,
          anexo: p.anexo_multi_ieps,
          categoria: p.categoria_ieps,
          tasa: p.tasa_principal,
          unidades: Number(p.cantidad_unidades || 0),
          base_ieps: Number(p.base_ieps || 0),
          ieps: Number(p.ieps_causado_o_pagado || 0),
          ieps_ret: Number(p.ieps_retenido || 0),
          _rowType: 'normal',
        });
      });

      rows.push({
        relacion: '',
        rfc: '',
        nombre: `SUBTOTAL PROVEEDORES (${filteredInfoProveedores.length} REGISTROS)`,
        anexo: '',
        categoria: '',
        tasa: '',
        unidades: filteredInfoProveedores.reduce((a, b) => a + Number(b.cantidad_unidades || 0), 0),
        base_ieps: filteredInfoProveedores.reduce((a, b) => a + Number(b.base_ieps || 0), 0),
        ieps: filteredInfoProveedores.reduce((a, b) => a + Number(b.ieps_causado_o_pagado || 0), 0),
        ieps_ret: filteredInfoProveedores.reduce((a, b) => a + Number(b.ieps_retenido || 0), 0),
        _rowType: 'subtotal',
      });

      const periodLabel =
        infoScope === 'trimestral'
          ? data.quarter_label || `${data.quarter}° Trimestre ${year}`
          : `${String(month).padStart(2, '0')} - ${monthNames[month - 1]} ${year}`;

      return {
        title: 'DECLARACIÓN INFORMATIVA MÚLTIPLE DEL IEPS (MULTI-IEPS)',
        subtitle: `Cédula de Clientes, Proveedores y Conceptos afectos al IEPS (${infoScope === 'trimestral' ? 'Acumulado Trimestral' : 'Periodo Mensual'})`,
        clientName: clientInfo?.business_name || '',
        clientRfc: clientInfo?.rfc || '',
        period: periodLabel,
        columns: columnsDef,
        rows,
        summaryCards: [
          {
            label: 'Clientes con IEPS',
            value: String(currentInformativa.totales_clientes?.terceros_count || 0),
            sublabel: `IEPS Trasladado: ${formatMoney(currentInformativa.totales_clientes?.ieps_trasladado || 0)}`,
          },
          {
            label: 'Proveedores con IEPS',
            value: String(currentInformativa.totales_proveedores?.terceros_count || 0),
            sublabel: `IEPS Pagado: ${formatMoney(currentInformativa.totales_proveedores?.ieps_pagado || 0)}`,
          },
          {
            label: 'Base Enajenaciones',
            value: formatMoney(currentInformativa.totales_clientes?.base_ieps || 0),
            sublabel: 'Actos gravados con clientes',
          },
          {
            label: 'Base Adquisiciones',
            value: formatMoney(currentInformativa.totales_proveedores?.base_ieps || 0),
            sublabel: 'Compras con IEPS de proveedores',
          },
        ],
        notes: 'Declaración Informativa integrada conforme al formato MULTI-IEPS del SAT (Art. 19 Ley del IEPS).',
        filename: `Declaracion_Informativa_IEPS_${clientInfo?.rfc || clientId}_${year}_${String(month).padStart(2, '0')}.xlsx`,
      };
    }

    const columnsDef = [
      { key: 'flujo', title: 'Tipo Flujo', align: 'center', format: 'text', width: 14 },
      { key: 'date', title: 'Fecha', align: 'center', format: 'text', width: 12 },
      { key: 'folio', title: 'Folio / UUID', align: 'left', format: 'text', width: 16 },
      { key: 'rfc', title: 'RFC Tercero', align: 'left', format: 'text', width: 15 },
      { key: 'name', title: 'Cliente / Proveedor', align: 'left', format: 'text', width: 30 },
      { key: 'categoria_ieps', title: 'Categoría / Tasa IEPS', align: 'left', format: 'text', width: 28 },
      { key: 'base_ieps', title: 'Base IEPS', align: 'right', format: 'currency', width: 16 },
      { key: 'ieps', title: 'Monto IEPS', align: 'right', format: 'currency', width: 16 },
      { key: 'retencion_ieps', title: 'Ret. IEPS', align: 'right', format: 'currency', width: 14 },
      { key: 'total', title: 'Total CFDI', align: 'right', format: 'currency', width: 16 },
    ];

    const rows = [];
    rows.push({
      flujo: 'EMITIDOS',
      date: '',
      folio: '',
      rfc: '',
      name: 'I. CFDI EMITIDOS COBRADOS (IEPS TRASLADADO CAUSADO)',
      categoria_ieps: '',
      base_ieps: '',
      ieps: '',
      retencion_ieps: '',
      total: '',
      _rowType: 'section',
    });

    activeEmitidosAll.forEach((r) => {
      rows.push({
        flujo: 'Emitido',
        date: r.date || '',
        folio: r.folio || (r.uuid ? r.uuid.slice(0, 8) : ''),
        rfc: r.rfc || '',
        name: r.name || '',
        categoria_ieps: `${r.tasa_principal || ''} - ${r.categoria_ieps || ''}`,
        base_ieps: Number(r.base_ieps || 0),
        ieps: Number(r.ieps || 0),
        retencion_ieps: Number(r.retencion_ieps || 0),
        total: Number(r.total || 0),
        _rowType: 'normal',
      });
    });

    rows.push({
      flujo: '',
      date: '',
      folio: '',
      rfc: '',
      name: 'SUBTOTAL IEPS TRASLADADO (EMITIDOS COBRADOS)',
      categoria_ieps: '',
      base_ieps: dynamicBaseCausado,
      ieps: dynamicIepsCausado,
      retencion_ieps: activeEmitidosTotals.retencion_ieps,
      total: activeEmitidosTotals.total,
      _rowType: 'subtotal',
    });

    rows.push({
      flujo: 'RECIBIDOS',
      date: '',
      folio: '',
      rfc: '',
      name: 'II. CFDI RECIBIDOS PAGADOS (IEPS ACREDITABLE / GASTO)',
      categoria_ieps: '',
      base_ieps: '',
      ieps: '',
      retencion_ieps: '',
      total: '',
      _rowType: 'section',
    });

    activeRecibidosAll.forEach((r) => {
      const isGasto = nonCreditableIds.includes(r.id);
      rows.push({
        flujo: isGasto ? 'Recibido (Gasto)' : 'Recibido (Acred.)',
        date: r.date || '',
        folio: r.folio || (r.uuid ? r.uuid.slice(0, 8) : ''),
        rfc: r.rfc || '',
        name: r.name || '',
        categoria_ieps: `${r.tasa_principal || ''} - ${r.categoria_ieps || ''}`,
        base_ieps: Number(r.base_ieps || 0),
        ieps: Number(r.ieps || 0),
        retencion_ieps: Number(r.retencion_ieps || 0),
        total: Number(r.total || 0),
        _rowType: 'normal',
      });
    });

    rows.push({
      flujo: '',
      date: '',
      folio: '',
      rfc: '',
      name: 'SUBTOTAL IEPS ACREDITABLE (RECIBIDOS PAGADOS)',
      categoria_ieps: '',
      base_ieps: dynamicBaseAcreditable,
      ieps: dynamicIepsAcreditable,
      retencion_ieps: activeRecibidosTotals.retencion_ieps,
      total: activeRecibidosTotals.total,
      _rowType: 'subtotal',
    });

    rows.push({
      flujo: '',
      date: '',
      folio: '',
      rfc: '',
      name:
        dynamicIepsCargo > 0
          ? '(=) IMPUESTO ESPECIAL SOBRE PRODUCCIÓN Y SERVICIOS (IEPS) A CARGO'
          : '(=) SALDO A FAVOR DE IEPS DEL PERIODO',
      categoria_ieps: '',
      base_ieps: dynamicBaseCausado - dynamicBaseAcreditable,
      ieps: dynamicIepsCargo > 0 ? dynamicIepsCargo : -dynamicIepsFavor,
      retencion_ieps: dynamicRetenciones,
      total: activeEmitidosTotals.total - activeRecibidosTotals.total,
      _rowType: 'total',
    });

    const summaryCards = [
      {
        label: 'IEPS Trasladado (Causado)',
        value: formatMoney(dynamicIepsCausado),
        sublabel: `Base IEPS: ${formatMoney(dynamicBaseCausado)}`,
      },
      {
        label: '(-) IEPS Acreditable',
        value: formatMoney(dynamicIepsAcreditable),
        sublabel: `Base Acreditable: ${formatMoney(dynamicBaseAcreditable)}`,
      },
      {
        label: '(-) Retenciones IEPS',
        value: formatMoney(dynamicRetenciones),
        sublabel: `IEPS en Gasto: ${formatMoney(dynamicIepsGasto)}`,
      },
      {
        label: dynamicIepsCargo > 0 ? '(=) IEPS A CARGO' : '(=) SALDO A FAVOR IEPS',
        value: formatMoney(dynamicIepsCargo > 0 ? dynamicIepsCargo : dynamicIepsFavor),
        sublabel: dynamicIepsCargo > 0 ? 'Enterar en pago mensual definitivo' : 'Compensable contra IEPS posterior',
      },
    ];

    return {
      title: 'PAPEL DE TRABAJO — DETERMINACIÓN MENSUAL DE IEPS',
      subtitle: 'Cédula de Flujo de Efectivo por Tasas y Cuotas de IEPS (Ley del IEPS)',
      clientName: clientInfo?.business_name || '',
      clientRfc: clientInfo?.rfc || '',
      period: `${String(month).padStart(2, '0')} - ${monthNames[month - 1]} ${year}`,
      columns: columnsDef,
      rows,
      summaryCards,
      notes: `Papel de trabajo elaborado conforme a la Ley del IEPS (flujo de efectivo). Comprobantes omitidos manualmente: ${omittedIds.length}.`,
      filename: `Papel_Trabajo_IEPS_${clientInfo?.rfc || clientId}_${year}_${String(month).padStart(2, '0')}.xlsx`,
    };
  };

  const handleExportExcel = (forceInfo = false) => {
    const payload = buildIepsExportPayload(forceInfo);
    if (payload) exportToExcel(payload);
  };

  const handleExportPdf = (forceInfo = false) => {
    const payload = buildIepsExportPayload(forceInfo);
    if (payload) exportToPdfWithLogo(payload);
  };

  // Traspaso contable mensual de IEPS
  const [traspasoModalVisible, setTraspasoModalVisible] = useState(false);
  const [generatingTraspaso, setGeneratingTraspaso] = useState(false);

  const handleExecuteTraspaso = async () => {
    setGeneratingTraspaso(true);
    try {
      const res = await fiscalApi.generarTraspasoIeps(clientId, {
        year,
        month,
        ieps_trasladado: dynamicIepsCausado,
        ieps_acreditable: dynamicIepsAcreditable,
      });
      message.success(res.data.message || 'Póliza de traspaso de IEPS generada con éxito.');
      setTraspasoModalVisible(false);
      await fetchData();
    } catch (err) {
      console.error('Error al generar traspaso de IEPS:', err);
      message.error(err?.response?.data?.detail || 'No se pudo generar la póliza de traspasos de IEPS.');
    } finally {
      setGeneratingTraspaso(false);
    }
  };

  const emitidosColumns = [
    {
      title: (
        <Tooltip title="Marcar casilla para omitir la factura del cálculo de IEPS">
          <div className="text-center font-bold text-red-600 text-xs cursor-help">Omitir</div>
        </Tooltip>
      ),
      key: 'omit',
      width: 65,
      align: 'center',
      render: (_, record) => {
        const isOmitted = omittedIds.includes(record.id);
        return (
          <Checkbox checked={isOmitted} onChange={() => toggleOmit(record.id)} />
        );
      },
    },
    {
      title: 'Fecha',
      dataIndex: 'date',
      key: 'date',
      width: 100,
    },
    {
      title: 'Folio / UUID',
      dataIndex: 'folio',
      key: 'folio',
      width: 135,
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
              <span className="font-mono text-xs">{displayFolio}</span>
            )}
            {isOmitted && <Tag color="red" className="text-[10px] px-1 py-0 m-0">Omitida</Tag>}
          </div>
        );
      },
    },
    {
      title: 'RFC Cliente',
      dataIndex: 'rfc',
      key: 'rfc',
      width: 125,
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
      title: 'Categoría / Tasa IEPS',
      key: 'categoria_ieps',
      width: 220,
      render: (_, r) => (
        <div>
          <Tag color="blue" className="text-[11px] font-semibold m-0 mr-1">
            {r.tasa_principal}
          </Tag>
          <span className="text-xs text-gray-600">{r.categoria_ieps}</span>
        </div>
      ),
    },
    {
      title: 'Base IEPS',
      dataIndex: 'base_ieps',
      key: 'base_ieps',
      align: 'right',
      width: 115,
      render: (val) => formatMoney(val),
    },
    {
      title: 'IEPS Trasladado',
      dataIndex: 'ieps',
      key: 'ieps',
      align: 'right',
      width: 125,
      render: (val) => <span className="font-semibold text-blue-700">{formatMoney(val)}</span>,
    },
    {
      title: 'Ret. IEPS',
      dataIndex: 'retencion_ieps',
      key: 'retencion_ieps',
      align: 'right',
      width: 95,
      render: (val) => (val > 0 ? <span className="text-amber-700">{formatMoney(val)}</span> : '-'),
    },
    {
      title: 'Total CFDI',
      dataIndex: 'total',
      key: 'total',
      align: 'right',
      width: 120,
      render: (val) => <span className="font-bold text-gray-900">{formatMoney(val)}</span>,
    },
  ];

  const recibidosColumns = [
    {
      title: (
        <Tooltip title="Marcar casilla para omitir la factura del cálculo de IEPS">
          <div className="text-center font-bold text-red-600 text-xs cursor-help">Omitir</div>
        </Tooltip>
      ),
      key: 'omit',
      width: 60,
      align: 'center',
      render: (_, record) => {
        const isOmitted = omittedIds.includes(record.id);
        return (
          <Checkbox checked={isOmitted} onChange={() => toggleOmit(record.id)} />
        );
      },
    },
    {
      title: 'Tratamiento Fiscal',
      key: 'tratamiento',
      width: 135,
      align: 'center',
      render: (_, record) => {
        const isGasto = nonCreditableIds.includes(record.id);
        return (
          <Tooltip title="Haga clic para alternar entre IEPS Acreditable en declaración o IEPS Deducible en el Gasto (Art. 4 Ley IEPS)">
            <Tag
              color={isGasto ? 'orange' : 'purple'}
              className="cursor-pointer font-semibold text-[11px] m-0 select-none"
              onClick={() => toggleNonCreditable(record.id)}
            >
              {isGasto ? 'Al Gasto (No Acred.)' : '✓ Acreditable'}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: 'Fecha',
      dataIndex: 'date',
      key: 'date',
      width: 100,
    },
    {
      title: 'Folio / UUID',
      dataIndex: 'folio',
      key: 'folio',
      width: 135,
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
              <span className="font-mono text-xs">{displayFolio}</span>
            )}
            {isOmitted && <Tag color="red" className="text-[10px] px-1 py-0 m-0">Omitida</Tag>}
          </div>
        );
      },
    },
    {
      title: 'RFC Proveedor',
      dataIndex: 'rfc',
      key: 'rfc',
      width: 125,
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
      title: 'Categoría / Tasa IEPS',
      key: 'categoria_ieps',
      width: 210,
      render: (_, r) => (
        <div>
          <Tag color="purple" className="text-[11px] font-semibold m-0 mr-1">
            {r.tasa_principal}
          </Tag>
          <span className="text-xs text-gray-600">{r.categoria_ieps}</span>
        </div>
      ),
    },
    {
      title: 'Base IEPS',
      dataIndex: 'base_ieps',
      key: 'base_ieps',
      align: 'right',
      width: 115,
      render: (val) => formatMoney(val),
    },
    {
      title: 'IEPS Pagado',
      dataIndex: 'ieps',
      key: 'ieps',
      align: 'right',
      width: 120,
      render: (val, r) => {
        const isGasto = nonCreditableIds.includes(r.id);
        return (
          <span className={`font-semibold ${isGasto ? 'text-amber-700' : 'text-purple-700'}`}>
            {formatMoney(val)}
          </span>
        );
      },
    },
    {
      title: 'Total Factura',
      dataIndex: 'total',
      key: 'total',
      align: 'right',
      width: 120,
      render: (val) => <span className="font-bold text-gray-900">{formatMoney(val)}</span>,
    },
  ];

  const informativaTercerosColumns = [
    {
      title: 'RFC Tercero',
      dataIndex: 'rfc',
      key: 'rfc',
      width: 130,
      render: (rfc) => <span className="font-mono font-semibold text-xs text-indigo-900">{rfc}</span>,
    },
    {
      title: 'Nombre / Razón Social',
      dataIndex: 'nombre',
      key: 'nombre',
      ellipsis: true,
      render: (nom, r) => (
        <div>
          <div className="font-semibold text-xs text-gray-800">{nom}</div>
          <div className="text-[11px] text-gray-400">CFDIs acumulados: {r.comprobantes_count}</div>
        </div>
      ),
    },
    {
      title: 'Anexo MULTI-IEPS',
      dataIndex: 'anexo_multi_ieps',
      key: 'anexo_multi_ieps',
      width: 210,
      render: (a) => <Tag color="geekblue" className="text-xs">{a}</Tag>,
    },
    {
      title: 'Categoría / Tasa IEPS',
      key: 'cat_tasa',
      width: 230,
      render: (_, r) => (
        <div>
          <Tag color="cyan" className="text-[11px] font-semibold m-0 mr-1">{r.tasa_principal}</Tag>
          <span className="text-xs text-gray-700">{r.categoria_ieps}</span>
        </div>
      ),
    },
    {
      title: 'Cantidad / Unidad',
      key: 'cantidad',
      align: 'right',
      width: 120,
      render: (_, r) => (
        <span className="font-mono text-xs">
          {Number(r.cantidad_unidades || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })} {r.unidad_medida}
        </span>
      ),
    },
    {
      title: 'Valor de Actos (Base)',
      dataIndex: 'base_ieps',
      key: 'base_ieps',
      align: 'right',
      width: 140,
      render: (val) => formatMoney(val),
    },
    {
      title: 'Monto IEPS',
      dataIndex: 'ieps_causado_o_pagado',
      key: 'ieps_causado_o_pagado',
      align: 'right',
      width: 135,
      render: (val) => <span className="font-bold text-indigo-700">{formatMoney(val)}</span>,
    },
    {
      title: 'IEPS Retenido',
      dataIndex: 'ieps_retenido',
      key: 'ieps_retenido',
      align: 'right',
      width: 115,
      render: (val) => (val > 0 ? <span className="text-amber-700">{formatMoney(val)}</span> : '-'),
    },
    {
      title: 'Total Operación',
      dataIndex: 'total_operacion',
      key: 'total_operacion',
      align: 'right',
      width: 135,
      render: (val) => <span className="font-semibold text-gray-900">{formatMoney(val)}</span>,
    },
  ];

  const informativaAnexosColumns = [
    {
      title: 'Anexo MULTI-IEPS',
      dataIndex: 'anexo',
      key: 'anexo',
      width: 210,
      render: (a) => <Tag color="geekblue" className="font-semibold">{a}</Tag>,
    },
    {
      title: 'Categoría / Bien o Servicio Gravado',
      dataIndex: 'categoria',
      key: 'categoria',
      render: (c) => <span className="font-medium text-xs text-gray-800">{c}</span>,
    },
    {
      title: 'Tasa / Cuota',
      dataIndex: 'tasa_label',
      key: 'tasa_label',
      width: 120,
      align: 'center',
      render: (t) => <Tag color="blue">{t}</Tag>,
    },
    {
      title: 'Base Ventas (Enajenación)',
      dataIndex: 'ventas_base',
      key: 'ventas_base',
      align: 'right',
      width: 140,
      render: (v) => formatMoney(v),
    },
    {
      title: 'IEPS Trasladado Ventas',
      dataIndex: 'ventas_ieps',
      key: 'ventas_ieps',
      align: 'right',
      width: 140,
      render: (v) => <span className="font-semibold text-blue-700">{formatMoney(v)}</span>,
    },
    {
      title: 'Base Compras (Adquisición)',
      dataIndex: 'compras_base',
      key: 'compras_base',
      align: 'right',
      width: 140,
      render: (v) => formatMoney(v),
    },
    {
      title: 'IEPS Pagado Compras',
      dataIndex: 'compras_ieps',
      key: 'compras_ieps',
      align: 'right',
      width: 140,
      render: (v) => <span className="font-semibold text-purple-700">{formatMoney(v)}</span>,
    },
  ];

  return (
    <div className="p-6 print:p-0">
      {/* Encabezado */}
      <div className="flex flex-wrap justify-between items-center mb-4 print:hidden gap-4">
        <div>
          <Title level={2} className="m-0 flex items-center gap-2">
            <CalculatorOutlined className="text-indigo-600" />
            Papel de Trabajo — Cálculo Mensual e Informativas de IEPS
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
            icon={<DownloadOutlined />}
            onClick={() => handleDownloadInformativaTxt('todos')}
            loading={downloadingTxt}
            disabled={!data}
            className="bg-indigo-600 hover:bg-indigo-700 border-indigo-600 font-semibold shadow-sm"
          >
            Emitir Declaración Informativa (.txt MULTI-IEPS)
          </Button>
          <Button
            type="primary"
            icon={<FileExcelOutlined />}
            onClick={() => handleExportExcel(false)}
            disabled={!data}
            className="bg-emerald-600 hover:bg-emerald-700 border-emerald-600 font-semibold shadow-sm"
          >
            Exportar Excel (.xlsx)
          </Button>
          <Button
            type="primary"
            icon={<FilePdfOutlined />}
            onClick={() => handleExportPdf(false)}
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
              {[2022, 2023, 2024, 2025, 2026, 2027].map((y) => (
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
              <Tooltip title="Ver póliza de traspasos de IEPS generada en visor">
                <a
                  href={`/journal-viewer/${data.traspaso_poliza.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center"
                >
                  <Tag color="success" className="font-semibold text-xs py-1 px-2.5 cursor-pointer border-emerald-300 flex items-center gap-1.5 shadow-sm">
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
              {data?.traspaso_poliza ? 'Actualizar Traspaso de IEPS' : 'Hacer Traspaso de IEPS'}
            </Button>
          </Col>
        </Row>
      </Card>

      {error && <Alert message={error} type="error" className="mb-4 print:hidden" showIcon />}

      {loading ? (
        <div className="text-center py-12"><Spin size="large" /></div>
      ) : data ? (
        <>
          {(omittedIds.length > 0 || nonCreditableIds.length > 0) && (
            <Alert
              type="warning"
              showIcon
              className="mb-4 print:hidden shadow-sm border-amber-300"
              message={
                <div className="flex flex-wrap justify-between items-center gap-2">
                  <span>
                    <strong>Ajustes manuales en cédula:</strong>{' '}
                    {omittedIds.length > 0 && (
                      <span><strong>{omittedIds.length}</strong> comprobante(s) omitidos. </span>
                    )}
                    {nonCreditableIds.length > 0 && (
                      <span><strong>{nonCreditableIds.length}</strong> comprobante(s) reclasificados como IEPS al Gasto (No Acreditable).</span>
                    )}
                  </span>
                  <Button size="small" icon={<UndoOutlined />} onClick={resetOmitted} danger>
                    Restablecer todos
                  </Button>
                </div>
              }
            />
          )}

          {/* Tarjetas de Determinación Mensual del IEPS */}
          <Row gutter={[16, 16]} className="mb-6">
            <Col xs={24} sm={12} lg={6}>
              <Card className="shadow-sm border-blue-200 bg-blue-50/30">
                <Statistic
                  title={<span className="font-semibold text-blue-900">IEPS TRASLADADO (CAUSADO)</span>}
                  value={dynamicIepsCausado}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#1d4ed8', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-500">
                  Base gravada cobrada: <span className="font-semibold">{formatMoney(dynamicBaseCausado)}</span>
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className="shadow-sm border-purple-200 bg-purple-50/30">
                <Statistic
                  title={<span className="font-semibold text-purple-900">(-) IEPS ACREDITABLE (PAGADO)</span>}
                  value={dynamicIepsAcreditable}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#7e22ce', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-500">
                  Base acreditable: <span className="font-semibold">{formatMoney(dynamicBaseAcreditable)}</span>
                  {dynamicIepsGasto > 0 && (
                    <span className="ml-2 text-amber-700 font-medium">
                      (En gasto: {formatMoney(dynamicIepsGasto)})
                    </span>
                  )}
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className="shadow-sm border-amber-200 bg-amber-50/30">
                <Statistic
                  title={<span className="font-semibold text-amber-900">(-) RETENCIONES DE IEPS</span>}
                  value={dynamicRetenciones}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#b45309', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-500">
                  Retenciones de IEPS del periodo
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className={`shadow-sm border-2 ${dynamicIepsCargo > 0 ? 'border-red-400 bg-red-50/40' : 'border-green-400 bg-green-50/40'}`}>
                {dynamicIepsCargo > 0 ? (
                  <Statistic
                    title={<span className="font-bold text-red-900 uppercase">(=) IEPS A CARGO DEL MES</span>}
                    value={dynamicIepsCargo}
                    precision={2}
                    prefix="$"
                    valueStyle={{ color: '#dc2626', fontWeight: 'bold', fontSize: '1.5rem' }}
                  />
                ) : (
                  <Statistic
                    title={<span className="font-bold text-green-900 uppercase">(=) SALDO A FAVOR IEPS</span>}
                    value={dynamicIepsFavor}
                    precision={2}
                    prefix="$"
                    valueStyle={{ color: '#16a34a', fontWeight: 'bold', fontSize: '1.5rem' }}
                  />
                )}
                <div className="mt-2 text-xs font-semibold text-gray-700">
                  {dynamicIepsCargo > 0
                    ? 'Enterar a más tardar el día 17 del mes siguiente'
                    : 'Acreditable contra IEPS a cargo en meses posteriores'}
                </div>
              </Card>
            </Col>
          </Row>

          {/* Conciliación Contable vs CFDI y Desglose por Tasas */}
          <Row gutter={[16, 16]} className="mb-6">
            <Col xs={24} md={11}>
              <Card title="Saldos en Cuentas Contables de IEPS" size="small" className="shadow-sm h-full">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b">
                      <td className="py-1.5 text-gray-600">208-02-000 IEPS trasladado cobrado (Causado)</td>
                      <td className="py-1.5 text-right font-semibold text-blue-700">
                        {formatMoney(data.contabilidad?.cta_208_02_cobrado)}
                      </td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-1.5 text-gray-600">209-02-000 IEPS trasladado no cobrado (PPD)</td>
                      <td className="py-1.5 text-right font-mono text-gray-500">
                        {formatMoney(data.contabilidad?.cta_209_02_pendiente)}
                      </td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-1.5 text-gray-600">118-03-000 IEPS acreditable pagado</td>
                      <td className="py-1.5 text-right font-semibold text-purple-700">
                        {formatMoney(data.contabilidad?.cta_118_03_pagado)}
                      </td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-1.5 text-gray-600">119-03-000 IEPS pendiente de pago (PPD)</td>
                      <td className="py-1.5 text-right font-mono text-gray-500">
                        {formatMoney(data.contabilidad?.cta_119_03_pendiente)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 text-gray-600">601-58-000 IEPS registrado en gasto (No acreditable)</td>
                      <td className="py-1.5 text-right font-semibold text-amber-700">
                        {formatMoney(data.contabilidad?.cta_601_58_gasto)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </Card>
            </Col>

            <Col xs={24} md={13}>
              <Card title="Desglose Mensual por Tasa / Cuota y Categoría de IEPS" size="small" className="shadow-sm h-full">
                {(data.desglose_tasas || []).length === 0 ? (
                  <div className="text-center py-6 text-gray-400 text-xs">
                    No se detectaron CFDIs con desglose de impuesto 003 (IEPS) en este mes.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-slate-50 text-gray-600">
                          <th className="py-1.5 px-2 text-left">Tasa / Categoría</th>
                          <th className="py-1.5 px-2 text-right">Base Ventas</th>
                          <th className="py-1.5 px-2 text-right">IEPS Causado</th>
                          <th className="py-1.5 px-2 text-right">Base Compras</th>
                          <th className="py-1.5 px-2 text-right">IEPS Pagado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.desglose_tasas.map((t) => (
                          <tr key={t.key} className="border-b">
                            <td className="py-1.5 px-2">
                              <Tag color="blue" className="text-[10px] mr-1">{t.tasa_label}</Tag>
                              <span className="font-medium text-gray-700">{t.categoria}</span>
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono">{formatMoney(t.base_emitidos)}</td>
                            <td className="py-1.5 px-2 text-right font-semibold text-blue-700">{formatMoney(t.ieps_trasladado)}</td>
                            <td className="py-1.5 px-2 text-right font-mono">{formatMoney(t.base_recibidos)}</td>
                            <td className="py-1.5 px-2 text-right font-semibold text-purple-700">{formatMoney(t.ieps_acreditable)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </Col>
          </Row>

          {/* Pestañas: Emitidos, Recibidos y Declaraciones Informativas IEPS */}
          <Card className="shadow-sm">
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  key: 'emitidos',
                  label: (
                    <span
                      className="font-semibold text-sm px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-all"
                      style={
                        activeTab === 'emitidos'
                          ? {
                              backgroundColor: '#1E2C5E',
                              color: '#ffffff',
                              boxShadow: '0 2px 6px rgba(30, 44, 94, 0.25)',
                            }
                          : {
                              backgroundColor: '#e2e8f0',
                              color: '#334155',
                            }
                      }
                    >
                      📤 CFDI Emitidos con IEPS ({emitidosAll.length})
                    </span>
                  ),
                  children: (
                    <div>
                      <div className="flex flex-wrap justify-between items-center mb-3 gap-2 print:hidden">
                        <span className="text-xs text-gray-500">
                          Facturas de venta cobradas con traslado de IEPS (Impuesto 003).
                        </span>
                        <Input
                          placeholder="Buscar por RFC, cliente, folio o tasa..."
                          prefix={<SearchOutlined className="text-gray-400" />}
                          value={searchEmitidos}
                          onChange={(e) => setSearchEmitidos(e.target.value)}
                          style={{ width: 300 }}
                          allowClear
                        />
                      </div>
                      <Table
                        dataSource={emitidos}
                        columns={emitidosColumns}
                        rowKey="id"
                        size="small"
                        pagination={{ pageSize: 20 }}
                        scroll={{ x: 1050 }}
                        summary={() => (
                          <Table.Summary.Row className="bg-blue-50/60 font-bold">
                            <Table.Summary.Cell index={0} colSpan={6} align="right">
                              TOTALES IEPS TRASLADADO ACTIVO:
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={6} align="right">
                              {formatMoney(dynamicBaseCausado)}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={7} align="right">
                              <span className="text-blue-700">{formatMoney(dynamicIepsCausado)}</span>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={8} align="right">
                              {formatMoney(activeEmitidosTotals.retencion_ieps)}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={9} align="right">
                              {formatMoney(activeEmitidosTotals.total)}
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
                    <span
                      className="font-semibold text-sm px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-all"
                      style={
                        activeTab === 'recibidos'
                          ? {
                              backgroundColor: '#1E2C5E',
                              color: '#ffffff',
                              boxShadow: '0 2px 6px rgba(30, 44, 94, 0.25)',
                            }
                          : {
                              backgroundColor: '#e2e8f0',
                              color: '#334155',
                            }
                      }
                    >
                      📥 CFDI Recibidos con IEPS ({recibidosAll.length})
                    </span>
                  ),
                  children: (
                    <div>
                      <div className="flex flex-wrap justify-between items-center mb-3 gap-2 print:hidden">
                        <span className="text-xs text-gray-500">
                          Compras y gastos con IEPS pagado. Puede hacer clic en la etiqueta de <strong>Tratamiento Fiscal</strong> para alternar entre <em>Acreditable</em> o <em>Al Gasto (No Acreditable)</em>.
                        </span>
                        <Input
                          placeholder="Buscar por RFC, proveedor, folio o tasa..."
                          prefix={<SearchOutlined className="text-gray-400" />}
                          value={searchRecibidos}
                          onChange={(e) => setSearchRecibidos(e.target.value)}
                          style={{ width: 300 }}
                          allowClear
                        />
                      </div>
                      <Table
                        dataSource={recibidos}
                        columns={recibidosColumns}
                        rowKey="id"
                        size="small"
                        pagination={{ pageSize: 20 }}
                        scroll={{ x: 1080 }}
                        summary={() => (
                          <Table.Summary.Row className="bg-purple-50/60 font-bold">
                            <Table.Summary.Cell index={0} colSpan={7} align="right">
                              TOTALES IEPS ACREDITABLE ACTIVO:
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={7} align="right">
                              {formatMoney(dynamicBaseAcreditable)}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={8} align="right">
                              <span className="text-purple-700">{formatMoney(dynamicIepsAcreditable)}</span>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={9} align="right">
                              {formatMoney(activeRecibidosTotals.total)}
                            </Table.Summary.Cell>
                          </Table.Summary.Row>
                        )}
                      />
                    </div>
                  ),
                },
                {
                  key: 'informativa',
                  label: (
                    <span
                      className="font-semibold text-sm px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-all"
                      style={
                        activeTab === 'informativa'
                          ? {
                              backgroundColor: '#1E2C5E',
                              color: '#ffffff',
                              boxShadow: '0 2px 6px rgba(30, 44, 94, 0.25)',
                            }
                          : {
                              backgroundColor: '#e2e8f0',
                              color: '#334155',
                            }
                      }
                    >
                      <FileDoneOutlined className="mr-1" />
                      Declaraciones Informativas IEPS (MULTI-IEPS)
                    </span>
                  ),
                  children: (
                    <div>
                      <Alert
                        type="info"
                        showIcon
                        className="mb-4 border-indigo-200 bg-indigo-50/40"
                        message={
                          <div className="flex flex-wrap justify-between items-center gap-3">
                            <div className="text-xs text-indigo-950">
                              <strong>Emisión de Declaración Informativa Múltiple del IEPS (Formato SAT MULTI-IEPS — Art. 19 Ley del IEPS):</strong>{' '}
                              Integra automáticamente el padrón de Clientes, Proveedores y Anexos por Categoría y Tasa/Cuota de IEPS tanto en vista <strong>Mensual</strong> como <strong>Trimestral Acumulada</strong> ({data.quarter_label}).
                            </div>
                            <Space wrap>
                              <Button
                                size="small"
                                type="primary"
                                icon={<DownloadOutlined />}
                                loading={downloadingTxt}
                                onClick={() => handleDownloadInformativaTxt('todos')}
                                className="bg-indigo-600 hover:bg-indigo-700"
                              >
                                Descargar Batch Completo (.txt)
                              </Button>
                              <Button
                                size="small"
                                icon={<FileExcelOutlined />}
                                onClick={() => handleExportExcel(true)}
                                className="text-emerald-700 border-emerald-400"
                              >
                                Excel Informativa (.xlsx)
                              </Button>
                              <Button
                                size="small"
                                icon={<FilePdfOutlined />}
                                onClick={() => handleExportPdf(true)}
                                className="text-sky-700 border-sky-400"
                              >
                                PDF Informativa
                              </Button>
                            </Space>
                          </div>
                        }
                      />

                      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                        <Space wrap>
                          <span className="text-xs font-semibold text-gray-600">Periodo Informativa:</span>
                          <Segmented
                            value={infoScope}
                            onChange={setInfoScope}
                            options={[
                              { label: `Mensual (${monthNames[month - 1]} ${year})`, value: 'mensual' },
                              { label: `Trimestral (${data.quarter_label})`, value: 'trimestral' },
                            ]}
                          />
                          <Segmented
                            value={infoAnexoView}
                            onChange={setInfoAnexoView}
                            options={[
                              { label: `Proveedores (${currentInformativa.proveedores?.length || 0})`, value: 'proveedores' },
                              { label: `Clientes (${currentInformativa.clientes?.length || 0})`, value: 'clientes' },
                              { label: `Resumen por Anexo SAT (${currentInformativa.resumen_anexos?.length || 0})`, value: 'conceptos' },
                            ]}
                          />
                        </Space>

                        <Space wrap>
                          <Input
                            placeholder="Filtrar por RFC, razón social o categoría..."
                            prefix={<SearchOutlined className="text-gray-400" />}
                            value={searchInformativa}
                            onChange={(e) => setSearchInformativa(e.target.value)}
                            style={{ width: 270 }}
                            allowClear
                          />
                          <Button
                            size="small"
                            icon={<DownloadOutlined />}
                            onClick={() => handleDownloadInformativaTxt(infoAnexoView)}
                          >
                            TXT solo {infoAnexoView === 'proveedores' ? 'Proveedores' : infoAnexoView === 'clientes' ? 'Clientes' : 'Anexos'}
                          </Button>
                        </Space>
                      </div>

                      {infoAnexoView === 'proveedores' && (
                        <Table
                          dataSource={filteredInfoProveedores}
                          columns={informativaTercerosColumns}
                          rowKey="key"
                          size="small"
                          pagination={{ pageSize: 20 }}
                          scroll={{ x: 1150 }}
                          summary={() => (
                            <Table.Summary.Row className="bg-indigo-50/60 font-bold">
                              <Table.Summary.Cell index={0} colSpan={5} align="right">
                                TOTAL PROVEEDORES REPORTADOS ({filteredInfoProveedores.length}):
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={5} align="right">
                                {formatMoney(filteredInfoProveedores.reduce((a, b) => a + Number(b.base_ieps || 0), 0))}
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={6} align="right">
                                <span className="text-indigo-700">
                                  {formatMoney(filteredInfoProveedores.reduce((a, b) => a + Number(b.ieps_causado_o_pagado || 0), 0))}
                                </span>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={7} align="right">
                                {formatMoney(filteredInfoProveedores.reduce((a, b) => a + Number(b.ieps_retenido || 0), 0))}
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={8} align="right">
                                {formatMoney(filteredInfoProveedores.reduce((a, b) => a + Number(b.total_operacion || 0), 0))}
                              </Table.Summary.Cell>
                            </Table.Summary.Row>
                          )}
                        />
                      )}

                      {infoAnexoView === 'clientes' && (
                        <Table
                          dataSource={filteredInfoClientes}
                          columns={informativaTercerosColumns}
                          rowKey="key"
                          size="small"
                          pagination={{ pageSize: 20 }}
                          scroll={{ x: 1150 }}
                          summary={() => (
                            <Table.Summary.Row className="bg-indigo-50/60 font-bold">
                              <Table.Summary.Cell index={0} colSpan={5} align="right">
                                TOTAL CLIENTES REPORTADOS ({filteredInfoClientes.length}):
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={5} align="right">
                                {formatMoney(filteredInfoClientes.reduce((a, b) => a + Number(b.base_ieps || 0), 0))}
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={6} align="right">
                                <span className="text-indigo-700">
                                  {formatMoney(filteredInfoClientes.reduce((a, b) => a + Number(b.ieps_causado_o_pagado || 0), 0))}
                                </span>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={7} align="right">
                                {formatMoney(filteredInfoClientes.reduce((a, b) => a + Number(b.ieps_retenido || 0), 0))}
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={8} align="right">
                                {formatMoney(filteredInfoClientes.reduce((a, b) => a + Number(b.total_operacion || 0), 0))}
                              </Table.Summary.Cell>
                            </Table.Summary.Row>
                          )}
                        />
                      )}

                      {infoAnexoView === 'conceptos' && (
                        <Table
                          dataSource={filteredInfoAnexos}
                          columns={informativaAnexosColumns}
                          rowKey="key"
                          size="small"
                          pagination={{ pageSize: 20 }}
                          scroll={{ x: 1000 }}
                        />
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        </>
      ) : null}

      {/* Modal de Confirmación de Póliza de Traspaso de IEPS */}
      <Modal
        title="Generar Póliza Contable de Traspaso Mensual de IEPS"
        open={traspasoModalVisible}
        onCancel={() => setTraspasoModalVisible(false)}
        onOk={handleExecuteTraspaso}
        confirmLoading={generatingTraspaso}
        okText="Generar Póliza de Traspaso"
        cancelText="Cancelar"
      >
        <div className="space-y-3 text-sm text-gray-700">
          <p>
            Se generará (o actualizará) una póliza de <strong>Diario</strong> al cierre de{' '}
            <strong>{monthNames[month - 1]} {year}</strong> con el siguiente asiento de liquidación mensual de IEPS:
          </p>
          <div className="bg-slate-50 p-3 rounded border text-xs space-y-1.5">
            <div className="flex justify-between">
              <span><strong>Cargo:</strong> 208-02-000 IEPS trasladado cobrado</span>
              <span className="font-mono font-semibold">{formatMoney(dynamicIepsCausado)}</span>
            </div>
            <div className="flex justify-between">
              <span><strong>Abono:</strong> 118-03-000 IEPS acreditable pagado</span>
              <span className="font-mono font-semibold">{formatMoney(dynamicIepsAcreditable)}</span>
            </div>
            {dynamicIepsCargo > 0 && (
              <div className="flex justify-between text-red-700 pt-1 border-t">
                <span><strong>Abono:</strong> 213-02-000 IEPS por pagar (A cargo)</span>
                <span className="font-mono font-bold">{formatMoney(dynamicIepsCargo)}</span>
              </div>
            )}
            {dynamicIepsFavor > 0 && (
              <div className="flex justify-between text-emerald-700 pt-1 border-t">
                <span><strong>Cargo:</strong> 113-03-000 IEPS a favor</span>
                <span className="font-mono font-bold">{formatMoney(dynamicIepsFavor)}</span>
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default FiscalIeps;
