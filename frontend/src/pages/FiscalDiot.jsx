import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Table, Row, Col, Select, Button, Typography, Alert, Spin, Tag, Statistic, Input, Space, message } from 'antd';
import { 
  FileDoneOutlined, 
  PrinterOutlined, 
  DownloadOutlined, 
  SearchOutlined,
  CheckCircleOutlined,
  FileExcelOutlined,
  FilePdfOutlined
} from '@ant-design/icons';
import { fiscalApi, clientsApi } from '../api/client';
import { exportToExcel, exportToPdfWithLogo } from '../utils/exportPaperwork';

const { Title, Text } = Typography;
const { Option } = Select;

const FiscalDiot = () => {
  const { clientId } = useParams();
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [clientInfo, setClientInfo] = useState(null);
  const [data, setData] = useState(null);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(2);
  const [searchText, setSearchText] = useState('');
  const [error, setError] = useState(null);

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
      const [clientRes, diotRes] = await Promise.all([
        clientsApi.get(clientId),
        fiscalApi.getDiotReport(clientId, { year, month })
      ]);
      setClientInfo(clientRes.data);
      setData(diotRes.data);
    } catch (err) {
      console.error('Error fetching DIOT report:', err);
      setError('No se pudo cargar el reporte de la DIOT.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (clientId) {
      fetchData();
    }
  }, [clientId, year, month]);

  const handleDownloadTxt = async () => {
    setDownloading(true);
    try {
      const response = await fiscalApi.exportDiotTxt(clientId, { year, month });
      const blob = new Blob([response.data], { type: 'text/plain;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `DIOT_${clientInfo?.rfc || 'CLIENTE'}_${year}${String(month).padStart(2, '0')}.txt`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      message.success('Archivo Batch para carga al SAT DIOT generado exitosamente');
    } catch (err) {
      console.error('Error downloading DIOT txt:', err);
      message.error('No se pudo generar el archivo TXT de la DIOT');
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const buildDiotExportPayload = () => {
    if (!data) return null;
    const columnsDef = [
      { key: 'tipo_tercero', title: 'Tipo Tercero', align: 'center', format: 'text', width: 14 },
      { key: 'tipo_operacion', title: 'Tipo Operación', align: 'center', format: 'text', width: 15 },
      { key: 'rfc', title: 'RFC Proveedor', align: 'left', format: 'text', width: 16 },
      { key: 'nombre', title: 'Proveedor / Razón Social', align: 'left', format: 'text', width: 34 },
      { key: 'comprobantes_count', title: 'CFDIs', align: 'center', format: 'integer', width: 10 },
      { key: 'base_16', title: 'Base Gravada 16%', align: 'right', format: 'currency', width: 18 },
      { key: 'iva_16', title: 'IVA 16% Pagado', align: 'right', format: 'currency', width: 18 },
      { key: 'zero_exento', title: 'Base 0% / Exento', align: 'right', format: 'currency', width: 16 },
      { key: 'iva_retenido', title: 'IVA Retenido', align: 'right', format: 'currency', width: 16 },
      { key: 'total_pagado', title: 'Total Pagado', align: 'right', format: 'currency', width: 18 },
    ];

    const opLabels = { '03': '03 Servicios Prof.', '06': '06 Arrendamiento', '85': '85 Otros' };
    const rows = filteredSuppliers.map(s => ({
      tipo_tercero: s.tipo_tercero === '04' ? '04 Nacional' : '05 Extranjero',
      tipo_operacion: opLabels[s.tipo_operacion] || s.tipo_operacion,
      rfc: s.rfc || '',
      nombre: s.nombre || '',
      comprobantes_count: Number(s.comprobantes_count || 0),
      base_16: Number(s.base_16 || 0),
      iva_16: Number(s.iva_16 || 0),
      zero_exento: Number((s.base_0 || 0) + (s.exento || 0)),
      iva_retenido: Number(s.iva_retenido || 0),
      total_pagado: Number(s.total_pagado || 0),
      _rowType: 'normal'
    }));

    rows.push({
      tipo_tercero: '',
      tipo_operacion: '',
      rfc: '',
      nombre: `TOTALES DIOT (${data.totales.proveedores_count} PROVEEDORES)`,
      comprobantes_count: rows.reduce((a, b) => a + b.comprobantes_count, 0),
      base_16: Number(data.totales.base_16 || 0),
      iva_16: Number(data.totales.iva_16 || 0),
      zero_exento: Number((data.totales.base_0 || 0) + (data.totales.exento || 0)),
      iva_retenido: Number(data.totales.iva_retenido || 0),
      total_pagado: Number(data.totales.total_pagado || 0),
      _rowType: 'total'
    });

    const summaryCards = [
      { label: 'Proveedores Reportados', value: String(data.totales.proveedores_count || 0), sublabel: 'Terceros con operaciones' },
      { label: 'Base Gravada 16%', value: formatMoney(data.totales.base_16 || 0), sublabel: 'Actos o actividades pagados' },
      { label: 'IVA 16% Acreditable', value: formatMoney(data.totales.iva_16 || 0), sublabel: 'IVA efectivamente pagado' },
      { label: 'Total Pagado a Proveedores', value: formatMoney(data.totales.total_pagado || 0), sublabel: 'Flujo erogado del mes' },
    ];

    return {
      title: 'PAPEL DE TRABAJO — DECLARACIÓN INFORMATIVA DE OPERACIONES CON TERCEROS (DIOT)',
      subtitle: 'Cédula de Proveedores y Base de Actos o Actividades Pagados (Formato SAT A-29)',
      clientName: clientInfo?.business_name || '',
      clientRfc: clientInfo?.rfc || '',
      period: `${String(month).padStart(2, '0')} - ${monthNames[month - 1]} ${year}`,
      columns: columnsDef,
      rows,
      summaryCards,
      notes: 'Cédula integrada con base en los CFDI recibidos método PUE y Complementos de Pago (REP) efectivamente liquidados en el mes.',
      filename: `Papel_Trabajo_DIOT_${clientInfo?.rfc || clientId}_${year}_${String(month).padStart(2, '0')}.xlsx`
    };
  };

  const handleExportExcel = () => {
    const payload = buildDiotExportPayload();
    if (payload) exportToExcel(payload);
  };

  const handleExportPdf = () => {
    const payload = buildDiotExportPayload();
    if (payload) exportToPdfWithLogo(payload);
  };

  const filteredSuppliers = (data?.proveedores || []).filter((s) => {
    if (!searchText) return true;
    const term = searchText.toLowerCase();
    return s.rfc.toLowerCase().includes(term) || s.nombre.toLowerCase().includes(term);
  });

  const columns = [
    {
      title: 'Tipo Tercero',
      dataIndex: 'tipo_tercero',
      key: 'tipo_tercero',
      width: 110,
      render: (t) => (
        <Tag color={t === '04' ? 'blue' : 'purple'}>
          {t === '04' ? '04 Nacional' : '05 Extranjero'}
        </Tag>
      ),
    },
    {
      title: 'Tipo Op.',
      dataIndex: 'tipo_operacion',
      key: 'tipo_operacion',
      width: 100,
      render: (op) => {
        const labels = {
          '03': '03 Servicios',
          '06': '06 Arrend.',
          '85': '85 Otros',
        };
        return <span className="text-xs font-mono">{labels[op] || op}</span>;
      },
    },
    {
      title: 'RFC',
      dataIndex: 'rfc',
      key: 'rfc',
      width: 130,
      render: (rfc) => <span className="font-mono font-semibold text-xs text-blue-900">{rfc}</span>,
    },
    {
      title: 'Proveedor / Razón Social',
      dataIndex: 'nombre',
      key: 'nombre',
      ellipsis: true,
      render: (nom, r) => (
        <div>
          <div className="font-semibold text-xs text-gray-800">{nom}</div>
          <div className="text-xs text-gray-400">CFDIs procesados: {r.comprobantes_count}</div>
        </div>
      ),
    },
    {
      title: 'Base 16%',
      dataIndex: 'base_16',
      key: 'base_16',
      align: 'right',
      render: (val) => formatMoney(val),
      width: 120,
    },
    {
      title: 'IVA 16% Pagado',
      dataIndex: 'iva_16',
      key: 'iva_16',
      align: 'right',
      render: (val) => <span className="font-semibold text-purple-700">{formatMoney(val)}</span>,
      width: 125,
    },
    {
      title: 'Base 0% / Exento',
      key: 'zero_exento',
      align: 'right',
      render: (_, r) => formatMoney(r.base_0 + r.exento),
      width: 110,
    },
    {
      title: 'IVA Retenido',
      dataIndex: 'iva_retenido',
      key: 'iva_retenido',
      align: 'right',
      render: (val) => val > 0 ? <span className="text-amber-700">{formatMoney(val)}</span> : '-',
      width: 110,
    },
    {
      title: 'Total Pagado',
      dataIndex: 'total_pagado',
      key: 'total_pagado',
      align: 'right',
      render: (val) => <span className="font-bold text-gray-900">{formatMoney(val)}</span>,
      width: 130,
    },
  ];

  return (
    <div className="p-6 print:p-0">
      {/* Encabezado */}
      <div className="flex flex-wrap justify-between items-center mb-4 print:hidden gap-4">
        <div>
          <Title level={2} className="m-0 flex items-center gap-2">
            <FileDoneOutlined className="text-indigo-600" />
            DIOT - Declaración Informativa de Operaciones con Terceros
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
            onClick={handleDownloadTxt} 
            loading={downloading}
            className="bg-indigo-600 hover:bg-indigo-500 font-semibold"
          >
            Descargar Batch SAT (.txt)
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
          <Button icon={<PrinterOutlined />} onClick={handlePrint}>
            Imprimir
          </Button>
        </Space>
      </div>

      {/* Filtros */}
      <Card size="small" className="mb-4 shadow-sm bg-white print:hidden">
        <Row gutter={[16, 12]} align="middle">
          <Col xs={12} sm={6} md={4}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Año</label>
            <Select value={year} onChange={setYear} style={{ width: '100%' }}>
              {[2024, 2025, 2026, 2027].map((y) => (
                <Option key={y} value={y}>{y}</Option>
              ))}
            </Select>
          </Col>
          <Col xs={12} sm={6} md={5}>
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
          <Col xs={24} sm={12} md={8}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Buscar Proveedor</label>
            <Input 
              placeholder="Filtrar por RFC o nombre..." 
              value={searchText} 
              onChange={(e) => setSearchText(e.target.value)}
              prefix={<SearchOutlined className="text-gray-400" />}
              allowClear
            />
          </Col>
          <Col xs={24} md={5}>
            <Button type="primary" onClick={fetchData} loading={loading} style={{ width: '100%' }}>
              Consultar DIOT
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
              <Card className="shadow-sm border-indigo-200 bg-indigo-50/30">
                <Statistic
                  title={<span className="font-semibold text-indigo-900">PROVEEDORES REPORTADOS</span>}
                  value={data.totales.proveedores_count}
                  valueStyle={{ color: '#4338ca', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-500">
                  Terceros con operaciones en el mes
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className="shadow-sm border-blue-200 bg-blue-50/30">
                <Statistic
                  title={<span className="font-semibold text-blue-900">BASE GRAVADA (TASA 16%)</span>}
                  value={data.totales.base_16}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#1d4ed8', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-500">
                  Valor de los actos o actividades pagados
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className="shadow-sm border-purple-200 bg-purple-50/30">
                <Statistic
                  title={<span className="font-semibold text-purple-900">IVA 16% ACREDITABLE</span>}
                  value={data.totales.iva_16}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#7e22ce', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-500">
                  Impuesto al valor agregado pagado
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className="shadow-sm border-emerald-200 bg-emerald-50/30">
                <Statistic
                  title={<span className="font-semibold text-emerald-900">TOTAL PAGADO A PROVEEDORES</span>}
                  value={data.totales.total_pagado}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#047857', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-500">
                  Importe acumulado erogado en el periodo
                </div>
              </Card>
            </Col>
          </Row>

          {/* Tabla de Proveedores para la DIOT */}
          <Card 
            title={
              <div className="flex justify-between items-center">
                <span>Relación de Proveedores - DIOT ({filteredSuppliers.length})</span>
                <span className="text-xs text-gray-500 font-normal">Formato SAT A-29</span>
              </div>
            }
            className="shadow-sm" 
            size="small"
          >
            <Table
              columns={columns}
              dataSource={filteredSuppliers}
              rowKey="rfc"
              pagination={{ pageSize: 20 }}
              size="small"
              bordered
              summary={() => (
                <Table.Summary.Row className="bg-gray-100 font-bold">
                  <Table.Summary.Cell index={0} colSpan={4} align="right">
                    TOTALES DIOT ({data.totales.proveedores_count} Proveedores):
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">{formatMoney(data.totales.base_16)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right">{formatMoney(data.totales.iva_16)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right">{formatMoney(data.totales.base_0 + data.totales.exento)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right">{formatMoney(data.totales.iva_retenido)}</Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right">{formatMoney(data.totales.total_pagado)}</Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
          </Card>
        </>
      ) : null}
    </div>
  );
};

export default FiscalDiot;
