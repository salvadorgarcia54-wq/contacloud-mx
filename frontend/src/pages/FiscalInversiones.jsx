import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Card, Table, Row, Col, Select, Button, Typography, Alert, Spin,
  Tag, Statistic, Space, Popconfirm, Tooltip, message, Badge, Modal
} from 'antd';
import { 
  FundOutlined, 
  PrinterOutlined, 
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  CalculatorOutlined,
  EyeOutlined,
  BookOutlined,
  FileExcelOutlined,
  FilePdfOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { fiscalApi, clientsApi } from '../api/client';
import { exportToExcel, exportToPdfWithLogo } from '../utils/exportPaperwork';
import FixedAssetModal from '../components/FixedAssetModal';

const { Title, Text } = Typography;
const { Option } = Select;

const FiscalInversiones = () => {
  const { clientId } = useParams();
  const [loading, setLoading] = useState(true);
  const [clientInfo, setClientInfo] = useState(null);
  const [data, setData] = useState(null);
  const [year, setYear] = useState(dayjs().year());
  const [month, setMonth] = useState(dayjs().month() + 1);
  const [error, setError] = useState(null);

  // Estado del Modal de Captura/Edición de Activos Fijos
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [selectedCfdiForModal, setSelectedCfdiForModal] = useState(null);

  // Estado del Modal de Póliza de Diario de Depreciaciones del Mes
  const [polizaModalVisible, setPolizaModalVisible] = useState(false);
  const [generatingPoliza, setGeneratingPoliza] = useState(false);

  const formatMoney = (val) => {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
    }).format(val || 0);
  };

  useEffect(() => {
    if (clientId) {
      clientsApi.get(clientId).then(res => setClientInfo(res.data)).catch(() => {});
    }
  }, [clientId]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const invRes = await fiscalApi.getInversionesReport(clientId, { year, month });
      setData(invRes.data);
    } catch (err) {
      console.error('Error fetching inversiones report:', err);
      setError('No se pudo cargar el reporte de inversiones y activos fijos.');
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

  const buildInversionesExportPayload = () => {
    if (!data) return null;
    const columnsDef = [
      { key: 'account_number', title: 'Cuenta Activo', align: 'left', format: 'text', width: 15 },
      { key: 'description', title: 'Descripción / Activo Fijo', align: 'left', format: 'text', width: 30 },
      { key: 'tipo_activo', title: 'Rubro LISR', align: 'left', format: 'text', width: 18 },
      { key: 'acquisition_date', title: 'Fecha Adq.', align: 'center', format: 'text', width: 13 },
      { key: 'moi', title: 'MOI Contable', align: 'right', format: 'currency', width: 16 },
      { key: 'deductible_moi', title: 'MOI Deducible', align: 'right', format: 'currency', width: 16 },
      { key: 'tasa', title: '% Deprec. SAT', align: 'right', format: 'percent', width: 13 },
      { key: 'depreciacion_mensual', title: 'Deprec. Mensual', align: 'right', format: 'currency', width: 16 },
      { key: 'depreciacion_ejercicio', title: 'Deprec. Ejercicio', align: 'right', format: 'currency', width: 16 },
      { key: 'depreciacion_acumulada', title: 'Deprec. Acumulada', align: 'right', format: 'currency', width: 16 },
      { key: 'saldo_por_deducir', title: 'Saldo por Deducir', align: 'right', format: 'currency', width: 16 },
    ];

    const rows = (data.activos || []).map(r => ({
      account_number: r.account_number || '',
      description: r.description || r.name || '',
      tipo_activo: r.tipo_activo || '',
      acquisition_date: r.acquisition_date ? dayjs(r.acquisition_date).format('DD/MM/YYYY') : '-',
      moi: Number(r.moi || 0),
      deductible_moi: Number(r.deductible_moi ?? r.moi ?? 0),
      tasa: Number(r.deductible_depreciation_rate ?? r.tasa_anual_lisr ?? 0),
      depreciacion_mensual: Number(r.depreciacion_mensual || 0),
      depreciacion_ejercicio: Number(r.depreciacion_ejercicio || 0),
      depreciacion_acumulada: Number(r.depreciacion_acumulada || 0),
      saldo_por_deducir: Number(r.saldo_por_deducir || 0),
      _rowType: 'normal'
    }));

    rows.push({
      account_number: '',
      description: `TOTAL CÉDULA DE ACTIVOS FIJOS E INVERSIONES (${rows.length} ACTIVOS)`,
      tipo_activo: '',
      acquisition_date: '',
      moi: Number(data.totales?.monto_original_inversion || 0),
      deductible_moi: Number(data.totales?.moi_deducible ?? data.totales?.monto_original_inversion ?? 0),
      tasa: '',
      depreciacion_mensual: rows.reduce((a, b) => a + b.depreciacion_mensual, 0),
      depreciacion_ejercicio: Number(data.totales?.depreciacion_ejercicio || 0),
      depreciacion_acumulada: Number(data.totales?.depreciacion_acumulada || 0),
      saldo_por_deducir: Number(data.totales?.saldo_por_deducir || 0),
      _rowType: 'total'
    });

    const summaryCards = [
      { label: 'Monto Original (MOI)', value: formatMoney(data.totales?.monto_original_inversion || 0), sublabel: `MOI Deducible: ${formatMoney(data.totales?.moi_deducible ?? data.totales?.monto_original_inversion)}` },
      { label: 'Depreciación del Ejercicio', value: formatMoney(data.totales?.depreciacion_ejercicio || 0), sublabel: data.period_description || `Corte ${month}/${year}` },
      { label: 'Depreciación Acumulada', value: formatMoney(data.totales?.depreciacion_acumulada || 0), sublabel: 'Amortización histórica' },
      { label: 'Saldo Pendiente por Deducir', value: formatMoney(data.totales?.saldo_por_deducir || 0), sublabel: 'Remanente fiscal' },
    ];

    return {
      title: 'PAPEL DE TRABAJO — CÉDULA DE DEDUCCIÓN DE INVERSIONES Y DEPRECIACIONES',
      subtitle: 'Control Contable y Fiscal de Activos Fijos conforme a los Artículos 31, 34, 35 y 36 de la Ley del ISR',
      clientName: clientInfo?.business_name || '',
      clientRfc: clientInfo?.rfc || '',
      period: `${String(month).padStart(2, '0')} - ${monthNames[month - 1]} ${year}`,
      columns: columnsDef,
      rows,
      summaryCards,
      notes: 'Papel de trabajo con determinación de depreciación contable y deducción de inversiones fiscal en Pesos Mexicanos (MXN).',
      filename: `Cedula_Inversiones_Activos_Fijos_${clientInfo?.rfc || clientId}_${year}_${String(month).padStart(2, '0')}.xlsx`
    };
  };

  const handleExportExcel = () => {
    const payload = buildInversionesExportPayload();
    if (payload) exportToExcel(payload);
  };

  const handleExportPdf = () => {
    const payload = buildInversionesExportPayload();
    if (payload) exportToPdfWithLogo(payload);
  };

  const handleOpenNewAsset = (cfdi = null) => {
    setEditingAsset(null);
    setSelectedCfdiForModal(cfdi);
    setModalOpen(true);
  };

  const handleOpenEditAsset = (record) => {
    setSelectedCfdiForModal(null);
    setEditingAsset(record);
    setModalOpen(true);
  };

  const handleDeleteAsset = async (assetId) => {
    try {
      await fiscalApi.deleteInversion(clientId, assetId);
      message.success('Activo fijo eliminado.');
      fetchData();
    } catch (err) {
      message.error('No se pudo eliminar el activo fijo.');
    }
  };

  const handleGenerarPolizaDepreciacion = async () => {
    setGeneratingPoliza(true);
    try {
      const res = await fiscalApi.generarPolizaDepreciacion(clientId, {
        year,
        month,
      });
      message.success(res.data?.message || 'Póliza de diario de depreciaciones generada con éxito.');
      setPolizaModalVisible(false);
      await fetchData();
    } catch (err) {
      console.error('Error al generar póliza de depreciación:', err);
      message.error(err?.response?.data?.detail || 'No se pudo generar la póliza de depreciaciones del mes.');
    } finally {
      setGeneratingPoliza(false);
    }
  };

  const pendingInversionCfdis = (data?.cfdis_inversion_detectados || []).filter(c => !c.already_registered);
  const propuestaPoliza = data?.propuesta_poliza_mes || null;
  const depreciacionPoliza = data?.depreciacion_poliza || null;

  const columns = [
    {
      title: 'Cuenta Activo',
      dataIndex: 'account_number',
      key: 'account_number',
      width: 115,
      render: (num, r) => (
        <div>
          <span className="font-mono text-xs font-semibold text-blue-900 block">{num}</span>
          {r.cfdi_uuid && (
            <Tooltip title={`CFDI Vinculado: ${r.cfdi_uuid}`}>
              <a
                href={`/cfdi-viewer/${r.cfdi_uuid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-mono text-blue-600 hover:underline inline-flex items-center gap-0.5"
              >
                <span>CFDI</span>
                <FileSearchOutlined />
              </a>
            </Tooltip>
          )}
        </div>
      ),
    },
    {
      title: 'Descripción / Activo Fijo',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      render: (name, r) => (
        <div>
          <span className="font-semibold text-xs text-gray-800 block">{r.description || name}</span>
          <span className="text-[11px] text-gray-500">{r.tipo_activo}</span>
          {r.has_disposal && r.disposal_date && (
            <Tag color="red" className="ml-1 text-[10px] py-0 px-1">
              Baja: {dayjs(r.disposal_date).format('DD/MM/YYYY')}
            </Tag>
          )}
        </div>
      ),
    },
    {
      title: 'Fecha Adq. / Deprec.',
      key: 'dates',
      width: 115,
      render: (_, r) => (
        <div className="text-[11px] text-gray-600">
          <div><strong>Adq:</strong> {r.acquisition_date ? dayjs(r.acquisition_date).format('DD/MM/YYYY') : '-'}</div>
          <div><strong>Dep:</strong> {r.depreciation_start_date ? dayjs(r.depreciation_start_date).format('DD/MM/YYYY') : '-'}</div>
        </div>
      ),
    },
    {
      title: 'MOI',
      dataIndex: 'moi',
      key: 'moi',
      align: 'right',
      width: 115,
      render: (val) => <span className="text-xs font-medium tabular-nums">{formatMoney(val)}</span>,
    },
    {
      title: 'MOI Deducible',
      dataIndex: 'deductible_moi',
      key: 'deductible_moi',
      align: 'right',
      width: 120,
      render: (val, r) => (
        <span className="text-xs font-bold text-gray-900 tabular-nums">
          {formatMoney(val ?? r.moi)}
        </span>
      ),
    },
    {
      title: '% Deprec. / Deduc.',
      key: 'tasa_anual_lisr',
      align: 'center',
      width: 110,
      render: (_, r) => (
        <div>
          <Tag color={r.tasa_anual_lisr > 0 ? 'blue' : 'default'} className="m-0 font-semibold">
            {r.deductible_depreciation_rate ?? r.tasa_anual_lisr}% SAT
          </Tag>
          {r.depreciation_rate !== undefined && r.depreciation_rate !== r.deductible_depreciation_rate && (
            <div className="text-[10px] text-gray-400 mt-0.5">Cont: {r.depreciation_rate}%</div>
          )}
        </div>
      ),
    },
    {
      title: 'Deprec. Mensual',
      dataIndex: 'depreciacion_mensual',
      key: 'depreciacion_mensual',
      align: 'right',
      width: 115,
      render: (val) => <span className="text-xs tabular-nums">{formatMoney(val)}</span>,
    },
    {
      title: 'Deprec. Ejercicio',
      dataIndex: 'depreciacion_ejercicio',
      key: 'depreciacion_ejercicio',
      align: 'right',
      width: 120,
      render: (val) => <span className="font-semibold text-xs text-purple-700 tabular-nums">{formatMoney(val)}</span>,
    },
    {
      title: 'Deprec. Acumulada',
      dataIndex: 'depreciacion_acumulada',
      key: 'depreciacion_acumulada',
      align: 'right',
      width: 125,
      render: (val) => <span className="text-xs tabular-nums">{formatMoney(val)}</span>,
    },
    {
      title: 'Saldo por Deducir',
      dataIndex: 'saldo_por_deducir',
      key: 'saldo_por_deducir',
      align: 'right',
      width: 125,
      render: (val) => <span className="font-bold text-xs text-emerald-700 tabular-nums">{formatMoney(val)}</span>,
    },
    {
      title: 'Acciones',
      key: 'actions',
      width: 95,
      align: 'center',
      fixed: 'right',
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title={r.is_registered_asset ? 'Editar Activo Fijo' : 'Completar ficha de Activo Fijo'}>
            <Button
              size="small"
              type="text"
              icon={<EditOutlined className="text-blue-600" />}
              onClick={() => handleOpenEditAsset(r)}
            />
          </Tooltip>
          {r.is_registered_asset && r.id && (
            <Popconfirm
              title="¿Eliminar este activo fijo de la cédula?"
              onConfirm={() => handleDeleteAsset(r.id)}
              okText="Eliminar"
              cancelText="Cancelar"
              okButtonProps={{ danger: true }}
            >
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
              />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="p-6 print:p-0">
      {/* Encabezado */}
      <div className="flex flex-wrap justify-between items-center mb-4 print:hidden gap-4">
        <div>
          <Title level={2} className="m-0 flex items-center gap-2">
            <FundOutlined className="text-amber-600" />
            Papel de Trabajo - Deducción de Inversiones (Activos Fijos)
          </Title>
          <p className="text-gray-500 m-0 text-sm">
            Empresa: <span className="font-semibold text-gray-700">{clientInfo ? `${clientInfo.business_name} (${clientInfo.rfc})` : 'Cargando...'}</span>
          </p>
        </div>
        <Space wrap>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => handleOpenNewAsset(null)}
            size="middle"
            className="bg-blue-600 font-semibold shadow-sm"
          >
            Capturar Activo Fijo / Inversión
          </Button>
          <Button
            type="primary"
            icon={<BookOutlined />}
            onClick={() => setPolizaModalVisible(true)}
            disabled={loading || !data}
            size="middle"
            className="bg-emerald-600 hover:bg-emerald-700 border-emerald-600 font-semibold shadow-sm"
          >
            {depreciacionPoliza ? 'Actualizar Póliza de Depreciaciones del Mes' : 'Póliza de Depreciaciones del Mes'}
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
        </Space>
      </div>

      {/* Alerta inteligente cuando el sistema detecta CFDIs con UsoCFDI 'I' (Inversiones) pendientes de capturar */}
      {pendingInversionCfdis.length > 0 && (
        <Alert
          type="warning"
          showIcon
          icon={<ThunderboltOutlined />}
          className="mb-4 border-amber-300 bg-amber-50/80 print:hidden"
          message={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-amber-900 text-sm">
                Se detectaron {pendingInversionCfdis.length} CFDI(s) con Uso de Inversión (I01–I08) pendientes de registrar en Activos Fijos
              </span>
              <Button
                size="small"
                type="primary"
                onClick={() => handleOpenNewAsset(pendingInversionCfdis[0])}
                className="bg-amber-600 hover:bg-amber-700 border-none font-semibold text-xs"
              >
                Capturar Inversión Ahora
              </Button>
            </div>
          }
          description={
            <div className="mt-2 space-y-1.5">
              {pendingInversionCfdis.map((cfdi) => (
                <div
                  key={cfdi.uuid}
                  className="flex flex-wrap items-center justify-between bg-white px-3 py-1.5 rounded border border-amber-200 text-xs gap-2"
                >
                  <div>
                    <Tag color="gold" className="font-bold">{cfdi.cfdi_use}</Tag>
                    <strong className="text-gray-800">{cfdi.description}</strong>
                    <span className="text-gray-500 ml-2">
                      • Proveedor: {cfdi.issuer_name} • Fecha: {cfdi.formatted_date} • MOI (Subtotal): <strong>{formatMoney(cfdi.subtotal)}</strong>
                    </span>
                  </div>
                  <Button
                    size="small"
                    type="link"
                    icon={<PlusOutlined />}
                    onClick={() => handleOpenNewAsset(cfdi)}
                    className="font-semibold text-blue-600 p-0"
                  >
                    Abrir Ventana de Captura (Tasa SAT {cfdi.sat_rate}%)
                  </Button>
                </div>
              ))}
            </div>
          }
        />
      )}

      {/* Filtros */}
      <Card size="small" className="mb-4 shadow-sm bg-white print:hidden">
        <Row gutter={[16, 12]} align="bottom">
          <Col xs={12} sm={6} md={4}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Año del Ejercicio</label>
            <Select value={year} onChange={setYear} style={{ width: '100%' }}>
              {[2023, 2024, 2025, 2026, 2027].map((y) => (
                <Option key={y} value={y}>{y}</Option>
              ))}
            </Select>
          </Col>
          <Col xs={12} sm={6} md={5}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Mes de Corte</label>
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
          <Col xs={24} sm={12} md={4}>
            <Button type="primary" onClick={fetchData} loading={loading} className="bg-blue-600">
              Actualizar Cédula
            </Button>
          </Col>
          <Col xs={24} sm={24} md={11} className="flex flex-wrap justify-start md:justify-end items-end gap-2 pt-1 md:pt-0">
            {depreciacionPoliza && (
              <Tooltip title="Ver póliza de diario de depreciaciones en visor">
                <a
                  href={`/journal-viewer/${depreciacionPoliza.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center"
                >
                  <Tag
                    color="success"
                    className="font-semibold text-xs py-1 px-2.5 cursor-pointer border-emerald-300 flex items-center gap-1.5 shadow-sm hover:border-emerald-500 hover:bg-emerald-50 transition-colors m-0"
                  >
                    <CheckCircleOutlined className="text-emerald-600" />
                    <span>Póliza Diario #{depreciacionPoliza.entry_number} ({depreciacionPoliza.formatted_date})</span>
                    <EyeOutlined className="text-[11px] text-emerald-700" />
                  </Tag>
                </a>
              </Tooltip>
            )}
            <Button
              type="primary"
              className="bg-emerald-600 hover:bg-emerald-700 border-emerald-600 font-semibold flex items-center gap-1.5 shadow-sm"
              icon={<CalculatorOutlined />}
              onClick={() => setPolizaModalVisible(true)}
              disabled={loading || !data}
            >
              {depreciacionPoliza
                ? 'Actualizar Póliza de Depreciaciones del Mes'
                : 'Hacer Póliza de Depreciaciones del Mes'}
            </Button>
          </Col>
        </Row>
      </Card>

      {error && <Alert message={error} type="error" className="mb-4 print:hidden" showIcon />}

      {loading ? (
        <div className="text-center py-12"><Spin size="large" /></div>
      ) : data ? (
        <>
          {/* Métricas Principales */}
          <Row gutter={[16, 16]} className="mb-6">
            <Col xs={24} sm={12} lg={6}>
              <Card className="shadow-sm border-amber-200 bg-amber-50/30">
                <Statistic
                  title={<span className="font-semibold text-amber-900">MONTO ORIGINAL (MOI)</span>}
                  value={data.totales.monto_original_inversion}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#b45309', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-500">
                  MOI Deducible: <strong>{formatMoney(data.totales.moi_deducible ?? data.totales.monto_original_inversion)}</strong>
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className="shadow-sm border-purple-200 bg-purple-50/30">
                <Statistic
                  title={<span className="font-semibold text-purple-900">DEPRECIACIÓN EJERCICIO</span>}
                  value={data.totales.depreciacion_ejercicio}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#7e22ce', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-500">
                  Deducción devengada a {data.period_description}
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className="shadow-sm border-blue-200 bg-blue-50/30">
                <Statistic
                  title={<span className="font-semibold text-blue-900">DEPRECIACIÓN ACUMULADA</span>}
                  value={data.totales.depreciacion_acumulada}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#1d4ed8', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-500">
                  Total de deducciones acumuladas históricas
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className="shadow-sm border-emerald-200 bg-emerald-50/30">
                <Statistic
                  title={<span className="font-semibold text-emerald-900">SALDO POR DEDUCIR</span>}
                  value={data.totales.saldo_por_deducir}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#047857', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-500">
                  Remanente pendiente de amortización fiscal
                </div>
              </Card>
            </Col>
          </Row>

          {/* Tabla de Activos Fijos */}
          <Card 
            title={
              <div className="flex flex-wrap justify-between items-center gap-2">
                <span>Cédula de Activos Fijos e Inversiones ({data.activos.length})</span>
                <Space>
                  <span className="text-xs text-gray-500 font-normal">Arts. 31, 34, 35 y 36 Ley del ISR</span>
                  <Button
                    size="small"
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => handleOpenNewAsset(null)}
                    className="bg-blue-600 text-xs print:hidden"
                  >
                    Agregar Activo
                  </Button>
                </Space>
              </div>
            }
            className="shadow-sm" 
            size="small"
          >
            <Table
              columns={columns}
              dataSource={data.activos}
              rowKey={(r) => r.id ? `asset-${r.id}` : `acc-${r.account_id}`}
              pagination={{ pageSize: 15 }}
              size="small"
              scroll={{ x: 1280 }}
              bordered
              summary={() => (
                <Table.Summary.Row className="bg-gray-100 font-bold text-xs">
                  <Table.Summary.Cell index={0} colSpan={3} align="right">
                    TOTALES ACTIVOS FIJOS:
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">{formatMoney(data.totales.monto_original_inversion)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right">{formatMoney(data.totales.moi_deducible ?? data.totales.monto_original_inversion)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="center">-</Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right">-</Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right">{formatMoney(data.totales.depreciacion_ejercicio)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={6} align="right">{formatMoney(data.totales.depreciacion_acumulada)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={7} align="right">{formatMoney(data.totales.saldo_por_deducir)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={8} />
                </Table.Summary.Row>
              )}
            />
          </Card>

          {/* Guía LISR */}
          <Card title="Tasas Máximas de Deducción Autorizadas por el SAT (Ley del ISR)" size="small" className="mt-6 shadow-sm bg-gray-50">
            <Row gutter={[16, 8]} className="text-xs text-gray-600">
              <Col xs={12} sm={6}><strong>I01 - Construcciones:</strong> 5% anual</Col>
              <Col xs={12} sm={6}><strong>I02 - Mobiliario y equipo:</strong> 10% anual</Col>
              <Col xs={12} sm={6}><strong>I03 - Equipo de transporte:</strong> 25% anual</Col>
              <Col xs={12} sm={6}><strong>I04 - Equipo de cómputo:</strong> 30% anual</Col>
              <Col xs={12} sm={6}><strong>I05 - Dados, troqueles y herramental:</strong> 35% anual</Col>
              <Col xs={12} sm={6}><strong>I06 - Comunicaciones telefónicas:</strong> 10% anual</Col>
              <Col xs={12} sm={6}><strong>I07 - Comunicaciones satelitales:</strong> 8% anual</Col>
              <Col xs={12} sm={6}><strong>I08 - Maquinaria y equipo:</strong> 10% anual</Col>
            </Row>
          </Card>
        </>
      ) : null}

      {/* Ventana Modal de Captura de Activo Fijo / Inversión */}
      <FixedAssetModal
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setEditingAsset(null);
          setSelectedCfdiForModal(null);
        }}
        onSuccess={() => {
          setModalOpen(false);
          setEditingAsset(null);
          setSelectedCfdiForModal(null);
          fetchData();
        }}
        clientId={clientId}
        initialAsset={editingAsset}
        cfdiInvoice={selectedCfdiForModal}
        pendingCfdis={pendingInversionCfdis}
      />

      {/* Ventana Modal de Póliza de Diario de Depreciaciones Contables del Mes */}
      <Modal
        open={polizaModalVisible}
        onCancel={() => setPolizaModalVisible(false)}
        width={780}
        title={
          <div className="flex items-center gap-2 text-emerald-900">
            <CalculatorOutlined className="text-emerald-600 text-lg" />
            <span>Póliza de Diario - Depreciaciones Contables del Mes</span>
          </div>
        }
        footer={[
          <Button key="cancel" onClick={() => setPolizaModalVisible(false)}>
            Cancelar
          </Button>,
          <Button
            key="submit"
            type="primary"
            className="bg-emerald-600 hover:bg-emerald-700 border-emerald-600 font-semibold"
            loading={generatingPoliza}
            disabled={!propuestaPoliza?.lines?.length}
            onClick={handleGenerarPolizaDepreciacion}
          >
            {depreciacionPoliza
              ? 'Confirmar y Actualizar Póliza de Diario'
              : 'Confirmar y Generar Póliza de Diario'}
          </Button>,
        ]}
      >
        <div className="py-2 text-sm">
          <div className="bg-gray-50 border border-gray-200 rounded p-3 mb-4 space-y-1 text-xs">
            <div>
              <strong>Empresa:</strong> {clientInfo?.business_name} ({clientInfo?.rfc})
            </div>
            <div>
              <strong>Tipo de Póliza:</strong> <Tag color="blue" className="m-0 font-semibold">Póliza de Diario</Tag>
            </div>
            <div>
              <strong>Fecha de Registro:</strong>{' '}
              <span className="font-semibold text-blue-800">
                {propuestaPoliza?.formatted_date || new Date(year, month, 0).toLocaleDateString('es-MX')}
              </span>{' '}
              <em>(último día del mes de corte seleccionado)</em>
            </div>
            <div>
              <strong>Concepto:</strong>{' '}
              <span className="font-semibold">{propuestaPoliza?.concepto || `Depreciación contable del mes (${month}/${year})`}</span>
            </div>
            <div>
              <strong>Activos fijos depreciados en el mes:</strong>{' '}
              <span className="font-semibold">{propuestaPoliza?.activos_count || 0}</span>
            </div>
          </div>

          <div className="font-semibold text-gray-800 mb-2 text-xs uppercase tracking-wide">
            Movimientos contables con las cuentas capturadas en el formulario (Gasto, No deducible y Depreciación):
          </div>

          {propuestaPoliza?.lines?.length > 0 ? (
            <>
              <div className="border border-gray-200 rounded overflow-hidden mb-4 shadow-sm max-h-[380px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-emerald-50 text-emerald-950 font-bold border-b border-emerald-100 sticky top-0">
                    <tr>
                      <th className="py-2 px-3 text-left">Cuenta Contable</th>
                      <th className="py-2 px-3 text-left">Rubro</th>
                      <th className="py-2 px-3 text-left">Activo Fijo / Concepto</th>
                      <th className="py-2 px-3 text-right">Debe (Cargo)</th>
                      <th className="py-2 px-3 text-right">Haber (Abono)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {propuestaPoliza.lines.map((line, idx) => (
                      <tr key={idx} className={line.credit > 0 ? 'bg-slate-50/60' : ''}>
                        <td className="py-2 px-3">
                          <div className="font-mono font-semibold text-gray-900">{line.account_number}</div>
                          <div className="text-[11px] text-gray-500">{line.account_name}</div>
                        </td>
                        <td className="py-2 px-3">
                          <Tag
                            color={
                              line.role === 'Gasto'
                                ? 'blue'
                                : line.role === 'No deducible'
                                ? 'orange'
                                : 'purple'
                            }
                            className="m-0 text-[10px] font-semibold"
                          >
                            {line.role}
                          </Tag>
                        </td>
                        <td className="py-2 px-3 text-gray-700">
                          <div className="font-medium text-gray-800">{line.asset_description}</div>
                          <div className="text-[11px] text-gray-500">{line.description}</div>
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-semibold text-blue-700">
                          {line.debit > 0 ? formatMoney(line.debit) : '-'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-semibold text-purple-700">
                          {line.credit > 0 ? formatMoney(line.credit) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-100 font-bold border-t border-gray-300 sticky bottom-0">
                    <tr>
                      <td colSpan={3} className="py-2.5 px-3 text-right text-gray-800">
                        <div className="flex items-center justify-end gap-1.5 text-emerald-700">
                          <CheckCircleOutlined />
                          <span>SUMAS IGUALES:</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-gray-950 font-bold">
                        {formatMoney(propuestaPoliza.total_debit)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-gray-950 font-bold">
                        {formatMoney(propuestaPoliza.total_credit)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="text-xs text-gray-600 bg-emerald-50/40 border border-emerald-200 rounded p-2.5">
                Al confirmar, se {depreciacionPoliza ? 'actualizará' : 'creará'} una <strong>Póliza de Diario</strong> con fecha del último día del mes (<strong>{propuestaPoliza.formatted_date}</strong>), cargando a las cuentas de <strong>Gasto</strong> (y <strong>No deducible</strong> cuando aplique) y abonando a las cuentas de <strong>Depreciación acumulada</strong> capturadas en cada activo fijo.
              </div>
            </>
          ) : (
            <Alert
              type="info"
              showIcon
              message="Sin depreciación contable en el mes seleccionado"
              description="No hay activos fijos con depreciación contable devengada para este mes y año. Verifica que existan activos fijos capturados con tasa de depreciación mayor a 0% y fecha de inicio de depreciación anterior o igual al mes de corte."
            />
          )}
        </div>
      </Modal>
    </div>
  );
};

export default FiscalInversiones;
