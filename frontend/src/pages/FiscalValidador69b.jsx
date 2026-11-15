import React, { useState, useEffect, useMemo } from 'react';
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
  Tooltip,
  Modal,
  Form,
  Upload,
  Popconfirm,
  message,
} from 'antd';
import {
  SafetyCertificateOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
  SearchOutlined,
  FileSearchOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  PrinterOutlined,
  PlusOutlined,
  UploadOutlined,
  DeleteOutlined,
  AuditOutlined,
  DatabaseOutlined,
  FlagOutlined,
} from '@ant-design/icons';
import { fiscalApi, clientsApi } from '../api/client';
import { exportToExcel, exportToPdfWithLogo } from '../utils/exportPaperwork';

const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;

const monthNames = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const FiscalValidador69b = () => {
  const { clientId } = useParams();
  const [loading, setLoading] = useState(true);
  const [clientInfo, setClientInfo] = useState(null);
  const [data, setData] = useState(null);
  const [year, setYear] = useState('all');
  const [month, setMonth] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [activeTab, setActiveTab] = useState('terceros');
  const [error, setError] = useState(null);

  // Catálogo SAT 69-B y 49-B y verificador masivo de RFCs
  const [catalogList, setCatalogList] = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogFilterType, setCatalogFilterType] = useState('all');
  const [catalogSearch, setCatalogSearch] = useState('');

  const [rfcsInput, setRfcsInput] = useState('');
  const [checkingRfcs, setCheckingRfcs] = useState(false);
  const [rfcCheckResults, setRfcCheckResults] = useState(null);

  // Modal para agregar o señalar un RFC en 69-B o 49-B
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [savingEntry, setSavingEntry] = useState(false);
  const [uploadingCsv, setUploadingCsv] = useState(false);
  const [csvListType, setCsvListType] = useState('69-B');
  const [form] = Form.useForm();

  const formatMoney = (val) =>
    new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
    }).format(val || 0);

  const fetchReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const [clientRes, repRes] = await Promise.all([
        clientsApi.get(clientId),
        fiscalApi.getValidador69bReport(clientId, { year, month }),
      ]);
      setClientInfo(clientRes.data);
      setData(repRes.data);
    } catch (err) {
      console.error('Error fetching 69-B/49-B report:', err);
      setError('No se pudo cargar el reporte de auditoría 69-B / 49-B del SAT.');
    } finally {
      setLoading(false);
    }
  };

  const fetchCatalog = async () => {
    setLoadingCatalog(true);
    try {
      const res = await fiscalApi.listSatBlacklistCatalog({
        list_type: catalogFilterType,
        search: catalogSearch || undefined,
      });
      setCatalogList(res.data || []);
    } catch (err) {
      console.error('Error loading SAT catalog:', err);
    } finally {
      setLoadingCatalog(false);
    }
  };

  useEffect(() => {
    if (clientId) {
      fetchReport();
    }
  }, [clientId, year, month]);

  useEffect(() => {
    if (activeTab === 'buscador_catalogo') {
      fetchCatalog();
    }
  }, [activeTab, catalogFilterType, catalogSearch]);

  const handleOpenAddModal = (prefill = null) => {
    if (prefill) {
      form.setFieldsValue({
        rfc: prefill.rfc || '',
        taxpayer_name: prefill.name || prefill.taxpayer_name || '',
        list_type: prefill.list_type || '69-B',
        situation: prefill.list_type === '49-B' ? 'Definitivo 49-B (CFDI Falso)' : 'Definitivo',
        oficio_presuncion: '500-05-2026-01420',
        fecha_dof_presuncion: new Date().toISOString().slice(0, 10),
        oficio_definitivo: '',
        fecha_dof_definitivo: '',
        motivo_fiscal: '',
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        list_type: '69-B',
        situation: 'Definitivo',
        fecha_dof_presuncion: new Date().toISOString().slice(0, 10),
      });
    }
    setAddModalVisible(true);
  };

  const handleSaveBlacklistEntry = async () => {
    try {
      const values = await form.validateFields();
      setSavingEntry(true);
      const res = await fiscalApi.addSatBlacklistEntry(values);
      message.success(res.data?.message || 'RFC registrado en el listado SAT.');
      setAddModalVisible(false);
      await fetchReport();
      if (activeTab === 'buscador_catalogo') {
        await fetchCatalog();
      }
    } catch (err) {
      if (err?.response?.data?.detail) {
        message.error(err.response.data.detail);
      }
    } finally {
      setSavingEntry(false);
    }
  };

  const handleDeleteCatalogEntry = async (entryId) => {
    try {
      const res = await fiscalApi.deleteSatBlacklistEntry(entryId);
      message.success(res.data?.message || 'RFC eliminado del listado.');
      await fetchCatalog();
      await fetchReport();
    } catch (err) {
      message.error('No se pudo eliminar el registro.');
    }
  };

  const handleCheckRfcs = async () => {
    if (!rfcsInput.trim()) {
      message.warning('Escribe o pega al menos un RFC para validar.');
      return;
    }
    setCheckingRfcs(true);
    try {
      const res = await fiscalApi.checkRfcs69b({ rfcs_text: rfcsInput });
      setRfcCheckResults(res.data?.results || []);
      message.success(`Se verificaron ${res.data?.total_checked || 0} RFC(s) contra los listados 69-B y 49-B.`);
    } catch (err) {
      message.error(err?.response?.data?.detail || 'Error al verificar los RFCs.');
    } finally {
      setCheckingRfcs(false);
    }
  };

  const handleUploadCsv = async ({ file, onSuccess, onError }) => {
    setUploadingCsv(true);
    try {
      const res = await fiscalApi.uploadSatBlacklistCsv(csvListType, file);
      message.success(res.data?.message || 'Archivo CSV importado con éxito.');
      await fetchReport();
      await fetchCatalog();
      if (onSuccess) onSuccess('ok');
    } catch (err) {
      message.error(err?.response?.data?.detail || 'No se pudo procesar el archivo CSV.');
      if (onError) onError(err);
    } finally {
      setUploadingCsv(false);
    }
  };

  // Filtrado de la tabla de terceros auditados
  const filteredTerceros = useMemo(() => {
    const list = data?.terceros_auditados || [];
    return list.filter((t) => {
      if (statusFilter === 'alertas' && t.risk_level === 'LIMPIO') return false;
      if (statusFilter === 'limpios' && t.risk_level !== 'LIMPIO') return false;
      if (searchText) {
        const term = searchText.toLowerCase();
        return (
          (t.rfc || '').toLowerCase().includes(term) ||
          (t.name || '').toLowerCase().includes(term) ||
          (t.status_69b || '').toLowerCase().includes(term) ||
          (t.status_49b || '').toLowerCase().includes(term)
        );
      }
      return true;
    });
  }, [data, statusFilter, searchText]);

  // Construcción de payload para Exportar Excel (.xlsx) y PDF Membretado
  const buildExportPayload = () => {
    if (!data) return null;
    const s = data.summary || {};

    const columnsDef = [
      { key: 'rfc', title: 'RFC Tercero', align: 'left', format: 'text', width: 16 },
      { key: 'name', title: 'Proveedor / Cliente (Razón Social)', align: 'left', format: 'text', width: 34 },
      { key: 'role', title: 'Rol', align: 'center', format: 'text', width: 12 },
      { key: 'cfdi_count', title: 'CFDIs', align: 'center', format: 'number', width: 9 },
      { key: 'subtotal', title: 'Subtotal', align: 'right', format: 'currency', width: 15 },
      { key: 'iva', title: 'IVA', align: 'right', format: 'currency', width: 14 },
      { key: 'total', title: 'Total Operado', align: 'right', format: 'currency', width: 16 },
      { key: 'status_69b', title: 'Estatus Art. 69-B', align: 'center', format: 'text', width: 20 },
      { key: 'status_49b', title: 'Estatus Art. 49-B', align: 'center', format: 'text', width: 22 },
    ];

    const rows = [];
    rows.push({
      rfc: 'SECCIÓN I',
      name: 'I. PADRÓN DE PROVEEDORES Y CLIENTES AUDITADOS (CRUCE ART. 69-B Y ART. 49-B CFF)',
      role: '',
      cfdi_count: '',
      subtotal: '',
      iva: '',
      total: '',
      status_69b: '',
      status_49b: '',
      _rowType: 'section',
    });

    filteredTerceros.forEach((t) => {
      rows.push({
        rfc: t.rfc,
        name: t.name,
        role: t.role,
        cfdi_count: t.cfdi_count,
        subtotal: t.subtotal,
        iva: t.iva,
        total: t.total,
        status_69b: t.status_69b,
        status_49b: t.status_49b,
        _rowType: t.risk_level === 'CRITICO' || t.risk_level === 'ALTO' ? 'subtotal' : 'normal',
      });
    });

    if ((data.riesgos_fiscales_cfdi || []).length > 0) {
      rows.push({
        rfc: 'SECCIÓN II',
        name: `II. FACTURAS CON OBSERVACIONES DE RIESGO FISCAL / MATERIALIDAD (${data.riesgos_fiscales_cfdi.length} CFDI)`,
        role: '',
        cfdi_count: '',
        subtotal: '',
        iva: '',
        total: '',
        status_69b: '',
        status_49b: '',
        _rowType: 'section',
      });
      data.riesgos_fiscales_cfdi.forEach((r) => {
        rows.push({
          rfc: r.rfc,
          name: `${r.date} | Folio ${r.folio} — ${r.name}`,
          role: r.severity,
          cfdi_count: 1,
          subtotal: r.subtotal,
          iva: r.iva,
          total: r.total,
          status_69b: (r.flags || []).map((f) => f.label).join('; '),
          status_49b: `Forma: ${r.payment_form} | Uso: ${r.cfdi_use}`,
          _rowType: 'normal',
        });
      });
    }

    const periodLabel =
      year === 'all'
        ? 'Auditoría Histórica Integral (Todos los Periodos)'
        : month === 'all'
        ? `Ejercicio ${year} Completo`
        : `${String(month).padStart(2, '0')} - ${monthNames[Number(month) - 1]} ${year}`;

    return {
      title: 'DICTAMEN DE AUDITORÍA — VALIDADOR SAT ART. 69-B (EFOS/EDOS) Y ART. 49-B (CFDI FALSOS)',
      subtitle: 'Cruce de Proveedores y Clientes contra Listados Oficiales del SAT y Detección Preventiva de Riesgo Fiscal',
      clientName: clientInfo?.business_name || '',
      clientRfc: clientInfo?.rfc || '',
      period: periodLabel,
      columns: columnsDef,
      rows,
      summaryCards: [
        {
          label: 'Terceros Auditados',
          value: `${s.total_terceros || 0} RFCs`,
          sublabel: `${s.total_proveedores || 0} Proveedores · ${s.total_cfdis_analizados || 0} CFDIs`,
        },
        {
          label: 'Alertas Art. 69-B (EFOS)',
          value: `${s.alertas_69b_count || 0} CFDI(s)`,
          sublabel: `En riesgo: ${formatMoney(s.monto_en_riesgo_69b)}`,
        },
        {
          label: 'Alertas Art. 49-B (CFDI Falsos)',
          value: `${s.alertas_49b_count || 0} CFDI(s)`,
          sublabel: `En riesgo: ${formatMoney(s.monto_en_riesgo_49b)}`,
        },
        {
          label: 'Contingencia Fiscal Estimada',
          value: formatMoney(s.contingencia_fiscal_estimada),
          sublabel: `${s.cfdis_riesgo_fiscal_count || 0} CFDI(s) con riesgo fiscal`,
        },
      ],
      notes: 'Auditoría preventiva elaborada conforme a los Artículos 69-B, 49-B (49 Bis), 17-H Bis y 5-A del Código Fiscal de la Federación y Art. 27 LISR.',
      filename: `Auditoria_SAT_69B_49B_${clientInfo?.rfc || clientId}.xlsx`,
    };
  };

  const renderStatusTag = (statusText, listType) => {
    if (!statusText || statusText.includes('Limpio') || statusText.includes('No Listado')) {
      return (
        <Tag color="success" icon={<CheckCircleOutlined />} className="text-[11px] m-0">
          Limpio ({listType})
        </Tag>
      );
    }
    if (statusText.includes('Definitivo')) {
      return (
        <Tag color="error" icon={<ExclamationCircleOutlined />} className="text-[11px] font-bold m-0">
          🚨 {statusText}
        </Tag>
      );
    }
    if (statusText.includes('Presunto') || statusText.includes('Procedimiento') || statusText.includes('Suspensión')) {
      return (
        <Tag color="warning" icon={<WarningOutlined />} className="text-[11px] font-bold m-0">
          ⚠️ {statusText}
        </Tag>
      );
    }
    return (
      <Tag color="blue" className="text-[11px] m-0">
        {statusText}
      </Tag>
    );
  };

  const tercerosColumns = [
    {
      title: 'RFC',
      dataIndex: 'rfc',
      key: 'rfc',
      width: 135,
      render: (rfc, r) => (
        <span className={`font-mono text-xs font-bold ${r.risk_level === 'CRITICO' ? 'text-red-700' : 'text-gray-900'}`}>
          {rfc}
        </span>
      ),
    },
    {
      title: 'Razón Social / Proveedor o Cliente',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name, r) => (
        <div>
          <div className="font-semibold text-xs text-gray-800">{name}</div>
          {r.motivo_fiscal && (
            <div className="text-[11px] text-red-600 mt-0.5">{r.motivo_fiscal}</div>
          )}
        </div>
      ),
    },
    {
      title: 'Rol',
      dataIndex: 'role',
      key: 'role',
      width: 100,
      align: 'center',
      render: (role) => (
        <Tag color={role === 'Proveedor' ? 'purple' : 'cyan'} className="text-[11px] m-0">
          {role}
        </Tag>
      ),
    },
    {
      title: 'CFDIs',
      dataIndex: 'cfdi_count',
      key: 'cfdi_count',
      width: 75,
      align: 'center',
      render: (c) => <span className="font-mono text-xs font-semibold">{c}</span>,
    },
    {
      title: 'Subtotal Operado',
      dataIndex: 'subtotal',
      key: 'subtotal',
      width: 130,
      align: 'right',
      render: (v) => <span className="font-mono text-xs">{formatMoney(v)}</span>,
    },
    {
      title: 'IVA',
      dataIndex: 'iva',
      key: 'iva',
      width: 115,
      align: 'right',
      render: (v) => <span className="font-mono text-xs text-gray-600">{formatMoney(v)}</span>,
    },
    {
      title: 'Total Acumulado',
      dataIndex: 'total',
      key: 'total',
      width: 135,
      align: 'right',
      render: (v) => <span className="font-mono text-xs font-bold text-gray-900">{formatMoney(v)}</span>,
    },
    {
      title: 'Listado Art. 69-B (EFOS)',
      dataIndex: 'status_69b',
      key: 'status_69b',
      width: 185,
      align: 'center',
      render: (st, r) => (
        <div>
          {renderStatusTag(st, '69-B')}
          {r.oficio_69b && (
            <div className="text-[10px] text-gray-500 mt-0.5 truncate" title={r.oficio_69b}>
              Oficio: {r.oficio_69b}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Listado Art. 49-B (CFDI Falsos)',
      dataIndex: 'status_49b',
      key: 'status_49b',
      width: 205,
      align: 'center',
      render: (st, r) => (
        <div>
          {renderStatusTag(st, '49-B')}
          {r.oficio_49b && (
            <div className="text-[10px] text-gray-500 mt-0.5 truncate" title={r.oficio_49b}>
              {r.oficio_49b}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Acción Auditoría',
      key: 'actions',
      width: 155,
      align: 'center',
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="Registrar o simular alerta 69-B / 49-B para este RFC">
            <Button
              size="small"
              danger={r.risk_level === 'LIMPIO'}
              type={r.risk_level === 'LIMPIO' ? 'dashed' : 'default'}
              icon={<FlagOutlined />}
              onClick={() => handleOpenAddModal({ rfc: r.rfc, name: r.name, list_type: '69-B' })}
              className="text-[11px]"
            >
              {r.risk_level === 'LIMPIO' ? 'Señalar 69-B/49-B' : 'Editar Alerta'}
            </Button>
          </Tooltip>
        </Space>
      ),
    },
  ];

  const alertasDetalleColumns = [
    {
      title: 'Listado SAT',
      dataIndex: 'list_type',
      key: 'list_type',
      width: 105,
      align: 'center',
      render: (lt) => (
        <Tag color={lt === '49-B' ? 'volcano' : 'red'} className="font-bold text-xs m-0">
          Art. {lt}
        </Tag>
      ),
    },
    {
      title: 'Situación Fiscal',
      dataIndex: 'situation',
      key: 'situation',
      width: 175,
      render: (sit, r) => renderStatusTag(sit, r.list_type),
    },
    {
      title: 'Fecha CFDI',
      dataIndex: 'date',
      key: 'date',
      width: 100,
    },
    {
      title: 'Folio / UUID',
      dataIndex: 'folio',
      key: 'folio',
      width: 130,
      render: (f, r) => (
        <a
          href={`/cfdi-viewer/${r.uuid}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-blue-600 hover:underline font-mono text-xs font-semibold"
        >
          <span>{f}</span>
          <FileSearchOutlined className="text-[11px]" />
        </a>
      ),
    },
    {
      title: 'RFC / Emisor o Receptor',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name, r) => (
        <div>
          <div className="font-semibold text-xs text-gray-900">{r.rfc} — {name}</div>
          <div className="text-[11px] text-gray-500">{r.oficio_definitivo || r.oficio_presuncion}</div>
        </div>
      ),
    },
    {
      title: 'Subtotal (Deducción)',
      dataIndex: 'subtotal',
      key: 'subtotal',
      align: 'right',
      width: 130,
      render: (v) => <span className="font-mono text-xs font-semibold">{formatMoney(v)}</span>,
    },
    {
      title: 'IVA Acreditado',
      dataIndex: 'iva',
      key: 'iva',
      align: 'right',
      width: 115,
      render: (v) => <span className="font-mono text-xs">{formatMoney(v)}</span>,
    },
    {
      title: 'Contingencia (ISR+IVA)',
      dataIndex: 'contingencia_estimada',
      key: 'contingencia_estimada',
      align: 'right',
      width: 145,
      render: (v) => <span className="font-mono text-xs font-bold text-red-700">{formatMoney(v)}</span>,
    },
  ];

  const riesgosCfdiColumns = [
    {
      title: 'Nivel Riesgo',
      dataIndex: 'severity',
      key: 'severity',
      width: 110,
      align: 'center',
      render: (sev) => (
        <Tag color={sev === 'CRITICO' ? 'red' : sev === 'ALTO' ? 'volcano' : 'gold'} className="font-bold text-xs m-0">
          {sev}
        </Tag>
      ),
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
      width: 130,
      render: (f, r) => (
        <a
          href={`/cfdi-viewer/${r.uuid}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-blue-600 hover:underline font-mono text-xs font-semibold"
        >
          <span>{f}</span>
          <FileSearchOutlined className="text-[11px]" />
        </a>
      ),
    },
    {
      title: 'Proveedor / RFC',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      ellipsis: true,
      render: (name, r) => (
        <div>
          <div className="font-semibold text-xs text-gray-800 truncate">{name}</div>
          <div className="font-mono text-[11px] text-gray-500">{r.rfc} · Forma: {r.payment_form} · Uso: {r.cfdi_use}</div>
        </div>
      ),
    },
    {
      title: 'Hallazgos de Auditoría Preventiva (Art. 69-B / 49-B / 27 LISR)',
      dataIndex: 'flags',
      key: 'flags',
      render: (flags) => (
        <div className="space-y-1">
          {(flags || []).map((fl, i) => (
            <div key={i} className="text-xs">
              <Tag color={fl.level === 'CRITICO' ? 'red' : fl.level === 'ALTO' ? 'orange' : 'blue'} className="font-semibold text-[11px]">
                {fl.label}
              </Tag>
              <span className="text-gray-600 text-[11px]">{fl.detail}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: 'Total CFDI',
      dataIndex: 'total',
      key: 'total',
      width: 125,
      align: 'right',
      render: (v) => <span className="font-mono text-xs font-bold text-gray-900">{formatMoney(v)}</span>,
    },
  ];

  const s = data?.summary || {};

  return (
    <div className="p-6 print:p-0">
      {/* Encabezado Principal */}
      <div className="flex flex-wrap justify-between items-center mb-4 print:hidden gap-4">
        <div>
          <Title level={2} className="m-0 flex items-center gap-2">
            <SafetyCertificateOutlined className="text-red-600" />
            Validador SAT Art. 69-B (EFOS / EDOS) y Art. 49-B (CFDI Falsos)
          </Title>
          {clientInfo && (
            <p className="text-gray-500 m-0 text-sm">
              Empresa Auditada: <span className="font-semibold text-gray-700">{clientInfo.business_name}</span> ({clientInfo.rfc})
            </p>
          )}
        </div>
        <Space wrap>
          <Button
            icon={<PlusOutlined />}
            onClick={() => handleOpenAddModal()}
            className="border-red-300 text-red-700 hover:border-red-500 font-semibold"
          >
            Registrar RFC en 69-B / 49-B
          </Button>
          <Button
            type="primary"
            icon={<FileExcelOutlined />}
            onClick={() => {
              const p = buildExportPayload();
              if (p) exportToExcel(p);
            }}
            disabled={!data}
            className="bg-emerald-600 hover:bg-emerald-700 border-emerald-600 font-semibold shadow-sm"
          >
            Exportar Excel (.xlsx)
          </Button>
          <Button
            type="primary"
            icon={<FilePdfOutlined />}
            onClick={() => {
              const p = buildExportPayload();
              if (p) exportToPdfWithLogo(p);
            }}
            disabled={!data}
            className="bg-sky-500 hover:bg-sky-600 border-sky-500 font-semibold shadow-sm"
            style={{ backgroundColor: '#0ea5e9', borderColor: '#0ea5e9', color: '#ffffff' }}
          >
            PDF Membretado
          </Button>
          <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
            Imprimir
          </Button>
        </Space>
      </div>

      {/* Filtros de Periodo y Búsqueda */}
      <Card size="small" className="mb-4 shadow-sm bg-white print:hidden">
        <Row gutter={[12, 12]} align="middle">
          <Col xs={12} sm={5} md={4}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Alcance de Ejercicio</label>
            <Select value={year} onChange={setYear} style={{ width: '100%' }}>
              <Option value="all">Histórico Completo (Todos)</Option>
              {[2024, 2025, 2026, 2027].map((y) => (
                <Option key={y} value={String(y)}>{y}</Option>
              ))}
            </Select>
          </Col>
          <Col xs={12} sm={5} md={4}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Mes</label>
            <Select value={month} onChange={setMonth} style={{ width: '100%' }}>
              <Option value="all">Todos los Meses</Option>
              {monthNames.map((m, idx) => (
                <Option key={idx + 1} value={String(idx + 1)}>
                  {String(idx + 1).padStart(2, '0')} - {m}
                </Option>
              ))}
            </Select>
          </Col>
          <Col xs={12} sm={6} md={5}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Filtro de Riesgo</label>
            <Select value={statusFilter} onChange={setStatusFilter} style={{ width: '100%' }}>
              <Option value="all">Todos los Proveedores y Clientes</Option>
              <Option value="alertas">Solo Alertas 69-B y 49-B</Option>
              <Option value="limpios">Solo Contribuyentes Limpios</Option>
            </Select>
          </Col>
          <Col xs={12} sm={8} md={7}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Buscar Proveedor / Cliente / RFC</label>
            <Input
              placeholder="Escribe RFC, razón social u oficio..."
              prefix={<SearchOutlined className="text-gray-400" />}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear
            />
          </Col>
          <Col xs={24} sm={24} md={4} className="pt-1 md:pt-5">
            <Button type="primary" onClick={fetchReport} loading={loading} style={{ width: '100%' }}>
              Ejecutar Cruce SAT
            </Button>
          </Col>
        </Row>
      </Card>

      {error && <Alert message={error} type="error" className="mb-4" showIcon />}

      {loading ? (
        <div className="text-center py-12"><Spin size="large" /></div>
      ) : data ? (
        <>
          {/* Banner de Alerta si hay CFDIs en 69-B o 49-B */}
          {(s.alertas_69b_count > 0 || s.alertas_49b_count > 0) && (
            <Alert
              type="error"
              showIcon
              className="mb-4 border-red-400 shadow-sm"
              message={
                <span className="font-bold text-red-900">
                  ¡ALERTA CRÍTICA DE AUDITORÍA SAT! Se detectaron operaciones con RFCs señalados en los listados del Artículo 69-B y/o Artículo 49-B del CFF.
                </span>
              }
              description={
                <div className="text-xs text-red-800 mt-1">
                  Se identificaron <strong>{s.alertas_69b_count} comprobante(s) en el supuesto del Art. 69-B (EFOS)</strong> por <strong>{formatMoney(s.monto_en_riesgo_69b)}</strong> y{' '}
                  <strong>{s.alertas_49b_count} comprobante(s) en el supuesto del Art. 49-B (CFDI Falsos / Suspensión CSD)</strong> por <strong>{formatMoney(s.monto_en_riesgo_49b)}</strong>.
                  El receptor (EDOS) cuenta con 30 días siguientes a la publicación en el DOF para acreditar la materialidad ante el SAT o corregir su situación fiscal mediante declaraciones complementarias.
                </div>
              }
            />
          )}

          {/* 4 Tarjetas Ejecutivas de Auditoría */}
          <Row gutter={[16, 16]} className="mb-6">
            <Col xs={24} sm={12} lg={6}>
              <Card className="shadow-sm border-blue-200 bg-blue-50/30">
                <Statistic
                  title={<span className="font-semibold text-blue-900 text-xs uppercase">TERCEROS Y CFDIS AUDITADOS</span>}
                  value={s.total_terceros || 0}
                  suffix={<span className="text-xs text-gray-500 font-normal">RFCs ({s.total_cfdis_analizados || 0} CFDIs)</span>}
                  valueStyle={{ color: '#1d4ed8', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-600">
                  Operaciones auditadas: <strong>{formatMoney(s.monto_total_operaciones)}</strong>
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className={`shadow-sm ${s.alertas_69b_count > 0 ? 'border-red-400 bg-red-50/40' : 'border-emerald-200 bg-emerald-50/30'}`}>
                <Statistic
                  title={<span className="font-semibold text-red-900 text-xs uppercase">ALERTAS ART. 69-B CFF (EFOS / EDOS)</span>}
                  value={s.alertas_69b_count || 0}
                  suffix={<span className="text-xs font-normal">CFDI(s)</span>}
                  valueStyle={{ color: s.alertas_69b_count > 0 ? '#dc2626' : '#16a34a', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-700">
                  Monto en riesgo 69-B: <strong>{formatMoney(s.monto_en_riesgo_69b)}</strong>
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className={`shadow-sm ${s.alertas_49b_count > 0 ? 'border-orange-400 bg-orange-50/40' : 'border-emerald-200 bg-emerald-50/30'}`}>
                <Statistic
                  title={<span className="font-semibold text-orange-900 text-xs uppercase">ALERTAS ART. 49-B CFF (CFDI FALSOS)</span>}
                  value={s.alertas_49b_count || 0}
                  suffix={<span className="text-xs font-normal">CFDI(s)</span>}
                  valueStyle={{ color: s.alertas_49b_count > 0 ? '#ea580c' : '#16a34a', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-700">
                  Monto en riesgo 49-B: <strong>{formatMoney(s.monto_en_riesgo_49b)}</strong>
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className="shadow-sm border-amber-300 bg-amber-50/30">
                <Statistic
                  title={<span className="font-semibold text-amber-900 text-xs uppercase">CONTINGENCIA FISCAL ESTIMADA</span>}
                  value={s.contingencia_fiscal_estimada || 0}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#b45309', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-600">
                  <strong>{s.cfdis_riesgo_fiscal_count || 0}</strong> CFDI(s) con observaciones de riesgo fiscal
                </div>
              </Card>
            </Col>
          </Row>

          {/* Pestañas del Validador */}
          <Card size="small" className="shadow-sm">
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  key: 'terceros',
                  label: (
                    <span
                      className="font-semibold text-sm px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-all"
                      style={
                        activeTab === 'terceros'
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
                      <SafetyCertificateOutlined />
                      Padrón de Proveedores y Clientes ({filteredTerceros.length})
                    </span>
                  ),
                  children: (
                    <div>
                      <div className="text-xs text-gray-500 mb-3">
                        Cruce automático de todos los RFCs emisores y receptores de la empresa contra los listados del <strong>Artículo 69-B (Operaciones Inexistentes EFOS)</strong> y del <strong>Artículo 49-B (Comprobantes Fiscales Falsos / Visita Domiciliaria Exprés)</strong>. Puedes hacer clic en <strong>"Señalar 69-B/49-B"</strong> en cualquier fila para registrar un oficio del SAT o simular una alerta sobre ese proveedor.
                      </div>
                      <Table
                        columns={tercerosColumns}
                        dataSource={filteredTerceros}
                        rowKey="rfc"
                        size="small"
                        bordered
                        pagination={{ pageSize: 15 }}
                        scroll={{ x: 1150 }}
                        rowClassName={(r) =>
                          r.risk_level === 'CRITICO'
                            ? 'bg-red-50/70'
                            : r.risk_level === 'ALTO'
                            ? 'bg-amber-50/70'
                            : ''
                        }
                      />
                    </div>
                  ),
                },
                {
                  key: 'alertas',
                  label: (
                    <span
                      className="font-semibold text-sm px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-all"
                      style={
                        activeTab === 'alertas'
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
                      <ExclamationCircleOutlined />
                      CFDIs Señalados en 69-B y 49-B ({(data.alertas_69b_49b_detalle || []).length})
                    </span>
                  ),
                  children: (
                    <div>
                      <div className="text-xs text-gray-500 mb-3">
                        Detalle de facturas recibidas o emitidas con contribuyentes publicados en los listados del <strong>Art. 69-B CFF</strong> o <strong>Art. 49-B CFF</strong>, incluyendo número de oficio global, fecha de publicación en el DOF y estimación del crédito fiscal contingente (ISR 30% + IVA 16%).
                      </div>
                      <Table
                        columns={alertasDetalleColumns}
                        dataSource={data.alertas_69b_49b_detalle || []}
                        rowKey={(r) => `${r.invoice_id}-${r.list_type}`}
                        size="small"
                        bordered
                        pagination={{ pageSize: 15 }}
                        locale={{
                          emptyText: '¡Excelente! Ningún CFDI del periodo pertenece a un RFC listado en el Art. 69-B ni en el Art. 49-B.',
                        }}
                      />
                    </div>
                  ),
                },
                {
                  key: 'riesgos_cfdi',
                  label: (
                    <span
                      className="font-semibold text-sm px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-all"
                      style={
                        activeTab === 'riesgos_cfdi'
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
                      <AuditOutlined />
                      Facturas con Riesgo Fiscal / Materialidad ({(data.riesgos_fiscales_cfdi || []).length})
                    </span>
                  ),
                  children: (
                    <div>
                      <div className="text-xs text-gray-500 mb-3">
                        Auditoría preventiva de comprobantes que presentan riesgos de rechazo en revisiones del SAT: pagos en efectivo mayores a $2,000.00 (Art. 27 Fracc. III LISR), servicios intangibles que requieren expediente de materialidad (Art. 69-B / 49-B / 5-A CFF), UsoCFDI S01 o importes redondos atípicos.
                      </div>
                      <Table
                        columns={riesgosCfdiColumns}
                        dataSource={data.riesgos_fiscales_cfdi || []}
                        rowKey="invoice_id"
                        size="small"
                        bordered
                        pagination={{ pageSize: 15 }}
                        locale={{
                          emptyText: 'No se detectaron facturas con observaciones de riesgo fiscal en este periodo.',
                        }}
                      />
                    </div>
                  ),
                },
                {
                  key: 'buscador_catalogo',
                  label: (
                    <span
                      className="font-semibold text-sm px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-all"
                      style={
                        activeTab === 'buscador_catalogo'
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
                      <DatabaseOutlined />
                      Verificador de RFCs y Base SAT (69-B: {s.catalogo_total_69b || 0} · 49-B: {s.catalogo_total_49b || 0})
                    </span>
                  ),
                  children: (
                    <div className="space-y-6">
                      {/* Verificador Masivo de RFCs */}
                      <Card
                        size="small"
                        title="1. Verificador Rápido y Masivo de RFCs (Art. 69-B y Art. 49-B CFF)"
                        className="bg-gray-50 border-gray-200"
                      >
                        <Row gutter={[16, 12]}>
                          <Col xs={24} md={16}>
                            <TextArea
                              rows={3}
                              value={rfcsInput}
                              onChange={(e) => setRfcsInput(e.target.value)}
                              placeholder="Escribe o pega uno o varios RFCs separados por coma, espacio o salto de línea (Ej: GCO1805149A1, CEI2103098M2, SIN1908227K4)..."
                              className="font-mono text-xs"
                            />
                          </Col>
                          <Col xs={24} md={8} className="flex flex-col justify-between gap-2">
                            <div className="text-xs text-gray-600">
                              Valida preventivamente a cualquier proveedor antes de contratarlo o pagarle, revisando simultáneamente los listados <strong>69-B</strong> y <strong>49-B</strong>.
                            </div>
                            <Space>
                              <Button
                                type="primary"
                                icon={<SearchOutlined />}
                                loading={checkingRfcs}
                                onClick={handleCheckRfcs}
                              >
                                Revisar RFC(s) en 69-B y 49-B
                              </Button>
                              <Button
                                size="small"
                                onClick={() => setRfcsInput('GCO1805149A1, SIN1908227K4, CEI2103098M2, AAL2207194P9')}
                              >
                                Cargar Ejemplo
                              </Button>
                            </Space>
                          </Col>
                        </Row>

                        {rfcCheckResults && (
                          <div className="mt-4">
                            <Table
                              size="small"
                              bordered
                              rowKey="rfc"
                              pagination={false}
                              dataSource={rfcCheckResults}
                              columns={[
                                {
                                  title: 'RFC Consultado',
                                  dataIndex: 'rfc',
                                  width: 140,
                                  render: (v) => <span className="font-mono font-bold text-xs">{v}</span>,
                                },
                                {
                                  title: 'Razón Social / Contribuyente',
                                  dataIndex: 'taxpayer_name',
                                  render: (v, r) => (
                                    <div>
                                      <div className="font-semibold text-xs">{v}</div>
                                      <div className="text-[11px] text-gray-500">{r.motivo_fiscal}</div>
                                    </div>
                                  ),
                                },
                                {
                                  title: 'Estatus Art. 69-B',
                                  dataIndex: 'status_69b',
                                  width: 190,
                                  align: 'center',
                                  render: (st) => renderStatusTag(st, '69-B'),
                                },
                                {
                                  title: 'Estatus Art. 49-B',
                                  dataIndex: 'status_49b',
                                  width: 200,
                                  align: 'center',
                                  render: (st) => renderStatusTag(st, '49-B'),
                                },
                                {
                                  title: 'Operaciones en el Despacho',
                                  dataIndex: 'cfdis_en_despacho',
                                  width: 180,
                                  align: 'right',
                                  render: (cnt, r) =>
                                    cnt > 0 ? (
                                      <span className="text-xs font-bold text-red-700">
                                        {cnt} CFDI(s) ({formatMoney(r.monto_operado_despacho)})
                                      </span>
                                    ) : (
                                      <span className="text-xs text-gray-500">0 CFDIs</span>
                                    ),
                                },
                              ]}
                            />
                          </div>
                        )}
                      </Card>

                      {/* Base de Datos de Listados SAT (69-B y 49-B) + Importador CSV */}
                      <Card
                        size="small"
                        title={
                          <div className="flex flex-wrap justify-between items-center gap-2">
                            <span>2. Base de Datos Local de Listados SAT (Art. 69-B y Art. 49-B)</span>
                            <Space wrap>
                              <Select
                                size="small"
                                value={csvListType}
                                onChange={setCsvListType}
                                style={{ width: 170 }}
                              >
                                <Option value="69-B">Importar a Lista 69-B</Option>
                                <Option value="49-B">Importar a Lista 49-B</Option>
                              </Select>
                              <Upload
                                accept=".csv,.txt"
                                showUploadList={false}
                                customRequest={handleUploadCsv}
                              >
                                <Button size="small" icon={<UploadOutlined />} loading={uploadingCsv}>
                                  Subir CSV Oficial SAT
                                </Button>
                              </Upload>
                              <Button
                                size="small"
                                type="primary"
                                icon={<PlusOutlined />}
                                onClick={() => handleOpenAddModal()}
                              >
                                Agregar RFC Manualmente
                              </Button>
                            </Space>
                          </div>
                        }
                      >
                        <div className="flex flex-wrap justify-between items-center mb-3 gap-2">
                          <Space>
                            <Select
                              size="small"
                              value={catalogFilterType}
                              onChange={setCatalogFilterType}
                              style={{ width: 200 }}
                            >
                              <Option value="all">Todos los Listados (69-B y 49-B)</Option>
                              <Option value="69-B">Solo Artículo 69-B (EFOS)</Option>
                              <Option value="49-B">Solo Artículo 49-B (CFDI Falsos)</Option>
                            </Select>
                            <Input
                              size="small"
                              placeholder="Buscar en el catálogo por RFC, nombre u oficio..."
                              prefix={<SearchOutlined className="text-gray-400" />}
                              value={catalogSearch}
                              onChange={(e) => setCatalogSearch(e.target.value)}
                              style={{ width: 280 }}
                              allowClear
                            />
                          </Space>
                        </div>

                        <Table
                          size="small"
                          bordered
                          loading={loadingCatalog}
                          dataSource={catalogList}
                          rowKey="id"
                          pagination={{ pageSize: 10 }}
                          columns={[
                            {
                              title: 'Listado',
                              dataIndex: 'list_type',
                              width: 95,
                              align: 'center',
                              render: (lt) => (
                                <Tag color={lt === '49-B' ? 'volcano' : 'red'} className="font-bold text-xs m-0">
                                  Art. {lt}
                                </Tag>
                              ),
                            },
                            {
                              title: 'RFC',
                              dataIndex: 'rfc',
                              width: 135,
                              render: (v) => <span className="font-mono font-bold text-xs">{v}</span>,
                            },
                            {
                              title: 'Contribuyente / Razón Social',
                              dataIndex: 'taxpayer_name',
                              ellipsis: true,
                              render: (v, r) => (
                                <div>
                                  <div className="font-semibold text-xs">{v}</div>
                                  <div className="text-[11px] text-gray-500">{r.motivo_fiscal}</div>
                                </div>
                              ),
                            },
                            {
                              title: 'Situación',
                              dataIndex: 'situation',
                              width: 185,
                              align: 'center',
                              render: (sit, r) => renderStatusTag(sit, r.list_type),
                            },
                            {
                              title: 'Oficio Presunción / 49-B',
                              dataIndex: 'oficio_presuncion',
                              width: 190,
                              ellipsis: true,
                              render: (v, r) => (
                                <span className="text-xs text-gray-600">
                                  {v || '-'} {r.fecha_dof_presuncion ? `(DOF: ${r.fecha_dof_presuncion})` : ''}
                                </span>
                              ),
                            },
                            {
                              title: 'Oficio Definitivo',
                              dataIndex: 'oficio_definitivo',
                              width: 190,
                              ellipsis: true,
                              render: (v, r) => (
                                <span className="text-xs text-gray-600">
                                  {v || '-'} {r.fecha_dof_definitivo ? `(DOF: ${r.fecha_dof_definitivo})` : ''}
                                </span>
                              ),
                            },
                            {
                              title: 'Acción',
                              key: 'del',
                              width: 75,
                              align: 'center',
                              render: (_, r) => (
                                <Popconfirm
                                  title={`¿Retirar a ${r.rfc} del listado ${r.list_type}?`}
                                  onConfirm={() => handleDeleteCatalogEntry(r.id)}
                                  okText="Sí"
                                  cancelText="No"
                                >
                                  <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                                </Popconfirm>
                              ),
                            },
                          ]}
                        />
                      </Card>
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        </>
      ) : null}

      {/* Modal para Registrar o Actualizar un RFC en Lista 69-B o 49-B */}
      <Modal
        title="Registrar / Señalar RFC en Listado SAT (Art. 69-B o Art. 49-B CFF)"
        open={addModalVisible}
        onCancel={() => setAddModalVisible(false)}
        onOk={handleSaveBlacklistEntry}
        confirmLoading={savingEntry}
        okText="Guardar en Listado SAT"
        cancelText="Cancelar"
        width={640}
      >
        <Form form={form} layout="vertical" size="small" className="pt-2">
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item
                name="rfc"
                label="RFC del Contribuyente"
                rules={[{ required: true, message: 'Ingrese el RFC' }]}
              >
                <Input placeholder="Ej. GCO1805149A1" className="font-mono uppercase" maxLength={13} />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item
                name="taxpayer_name"
                label="Nombre o Razón Social"
                rules={[{ required: true, message: 'Ingrese la razón social' }]}
              >
                <Input placeholder="Razón social del proveedor o emisor" className="uppercase" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="list_type" label="Fundamento / Listado SAT" rules={[{ required: true }]}>
                <Select
                  onChange={(val) => {
                    form.setFieldsValue({
                      situation: val === '49-B' ? 'Definitivo 49-B (CFDI Falso)' : 'Definitivo',
                    });
                  }}
                >
                  <Option value="69-B">Artículo 69-B CFF (Operaciones Inexistentes — EFOS)</Option>
                  <Option value="49-B">Artículo 49-B / 49 Bis CFF (CFDI Falsos / Visita Exprés)</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="situation" label="Situación Fiscal Publicada" rules={[{ required: true }]}>
                <Select>
                  <Option value="Presunto">69-B: Presunto</Option>
                  <Option value="Definitivo">69-B: Definitivo</Option>
                  <Option value="Desvirtuado">69-B: Desvirtuado</Option>
                  <Option value="Sentencia Favorable">69-B: Sentencia Favorable</Option>
                  <Option value="En Procedimiento 49-B">49-B: En Procedimiento 49-B (Suspensión CSD)</Option>
                  <Option value="Definitivo 49-B (CFDI Falso)">49-B: Definitivo 49-B (CFDI Falso)</Option>
                  <Option value="Suspensión CSD (17-H Bis)">49-B / 17-H Bis: Restricción Temporal CSD</Option>
                  <Option value="Aclarado">49-B: Aclarado / Subsanado</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={14}>
              <Form.Item name="oficio_presuncion" label="Oficio de Presunción / Orden de Verificación 49-B">
                <Input placeholder="Ej. 500-05-2026-01420" />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="fecha_dof_presuncion" label="Fecha Publicación DOF / Notificación">
                <Input placeholder="YYYY-MM-DD" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={14}>
              <Form.Item name="oficio_definitivo" label="Oficio de Definitividad / Resolución 49-B (Opcional)">
                <Input placeholder="Ej. 500-05-2026-09850" />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="fecha_dof_definitivo" label="Fecha DOF Definitivo">
                <Input placeholder="YYYY-MM-DD" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="motivo_fiscal" label="Motivo u Observación de Auditoría">
            <TextArea
              rows={2}
              placeholder="Ej. Publicado en el listado global del Art. 69-B / Determinado en procedimiento del Art. 49-B por comprobantes sin sustancia material."
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default FiscalValidador69b;
