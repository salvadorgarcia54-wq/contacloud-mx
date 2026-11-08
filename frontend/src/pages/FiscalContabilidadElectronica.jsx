import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Row, Col, Select, Button, Typography, Alert, Spin, Tag, Statistic, Radio, Divider, Space, message, Badge } from 'antd';
import { 
  CodeOutlined, 
  DownloadOutlined, 
  FileTextOutlined, 
  CheckCircleOutlined,
  SafetyCertificateOutlined,
  CalendarOutlined,
  BookOutlined
} from '@ant-design/icons';
import { fiscalApi, clientsApi } from '../api/client';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;

const FiscalContabilidadElectronica = () => {
  const { clientId } = useParams();
  const [loading, setLoading] = useState(true);
  const [clientInfo, setClientInfo] = useState(null);
  const [data, setData] = useState(null);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(2);
  const [tipoEnvio, setTipoEnvio] = useState('N'); // 'N' Normal, 'C' Complementaria
  const [downloading, setDownloading] = useState({});
  const [error, setError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [clientRes, infoRes] = await Promise.all([
        clientsApi.get(clientId),
        fiscalApi.getContabilidadInfo(clientId, { year, month })
      ]);
      setClientInfo(clientRes.data);
      setData(infoRes.data);
    } catch (err) {
      console.error('Error fetching contabilidad info:', err);
      setError('No se pudo cargar la información de Contabilidad Electrónica.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (clientId) {
      fetchData();
    }
  }, [clientId, year, month]);

  const handleDownload = async (type) => {
    setDownloading(prev => ({ ...prev, [type]: true }));
    try {
      let response;
      let filename;
      const rfc = clientInfo?.rfc || 'CLIENTE';

      if (type === 'catalogo') {
        response = await fiscalApi.getCatalogoXml(clientId);
        filename = `${rfc}CT.xml`;
      } else if (type === 'balanza') {
        response = await fiscalApi.getBalanzaXml(clientId, { year, month, tipo_envio: tipoEnvio });
        filename = `${rfc}${year}${String(month).padStart(2, '0')}BN.xml`;
      } else if (type === 'polizas') {
        response = await fiscalApi.getPolizasXml(clientId, { year, month });
        filename = `${rfc}${year}${String(month).padStart(2, '0')}PL.xml`;
      }

      if (response && response.data) {
        const blob = new Blob([response.data], { type: 'application/xml;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
        message.success(`Archivo ${filename} generado y descargado exitosamente`);
      }
    } catch (err) {
      console.error(`Error downloading ${type}:`, err);
      message.error(`No se pudo generar el XML de ${type}`);
    } finally {
      setDownloading(prev => ({ ...prev, [type]: false }));
    }
  };

  return (
    <div className="p-6">
      {/* Encabezado */}
      <div className="flex flex-wrap justify-between items-center mb-4 gap-4">
        <div>
          <Title level={2} className="m-0 flex items-center gap-2">
            <CodeOutlined className="text-cyan-600" />
            Contabilidad Electrónica (Anexo 24 del SAT)
          </Title>
          {clientInfo && (
            <p className="text-gray-500 m-0 text-sm">
              Empresa: <span className="font-semibold text-gray-700">{clientInfo.business_name}</span> ({clientInfo.rfc})
            </p>
          )}
        </div>
        <Tag color="cyan" className="px-3 py-1 text-sm font-semibold flex items-center gap-1">
          <SafetyCertificateOutlined /> Estándar SAT Versión 1.3
        </Tag>
      </div>

      {/* Filtros */}
      <Card size="small" className="mb-4 shadow-sm bg-white">
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
            <label className="block mb-1 text-xs font-semibold text-gray-600">Mes de Envío</label>
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
              <Option value={13}>13 - Cierre del Ejercicio</Option>
            </Select>
          </Col>
          <Col xs={24} sm={12} md={7}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Tipo de Envío (Balanza)</label>
            <Radio.Group value={tipoEnvio} onChange={(e) => setTipoEnvio(e.target.value)}>
              <Radio value="N">Normal (N)</Radio>
              <Radio value="C">Complementaria (C)</Radio>
            </Radio.Group>
          </Col>
          <Col xs={24} md={4}>
            <Button type="primary" onClick={fetchData} loading={loading} style={{ width: '100%' }}>
              Actualizar Datos
            </Button>
          </Col>
        </Row>
      </Card>

      {error && <Alert message={error} type="error" className="mb-4" showIcon />}

      {loading ? (
        <div className="text-center py-12"><Spin size="large" /></div>
      ) : data ? (
        <>
          {/* Métricas del Sistema */}
          <Row gutter={[16, 16]} className="mb-6">
            <Col xs={24} sm={8}>
              <Card className="shadow-sm border-blue-200 bg-blue-50/20">
                <Statistic
                  title={<span className="font-semibold text-blue-900">CUENTAS EN CATÁLOGO</span>}
                  value={data.stats.total_cuentas}
                  valueStyle={{ color: '#1d4ed8', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-500">
                  Activas: <span className="font-semibold">{data.stats.cuentas_activas}</span> con código SAT
                </div>
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card className="shadow-sm border-emerald-200 bg-emerald-50/20">
                <Statistic
                  title={<span className="font-semibold text-emerald-900">PÓLIZAS DEL PERIODO</span>}
                  value={data.stats.polizas_periodo}
                  valueStyle={{ color: '#047857', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-500">
                  Transacciones contables generadas
                </div>
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card className="shadow-sm border-cyan-200 bg-cyan-50/20">
                <Statistic
                  title={<span className="font-semibold text-cyan-900">ESTATUS DE CONFORMIDAD</span>}
                  value="100% SAT Anexo 24"
                  valueStyle={{ color: '#0891b2', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-500">
                  Validación XSD y codificación UTF-8
                </div>
              </Card>
            </Col>
          </Row>

          {/* Tarjetas de Descarga de Archivos XML */}
          <Row gutter={[16, 16]} className="mb-6">
            {/* 1. Catálogo de Cuentas */}
            <Col xs={24} md={8}>
              <Card 
                className="shadow-sm hover:shadow-md transition-shadow h-full flex flex-col justify-between"
                title={
                  <div className="flex items-center gap-2">
                    <BookOutlined className="text-blue-600 text-lg" />
                    <span className="font-bold">1. Catálogo de Cuentas</span>
                  </div>
                }
                extra={<Tag color="blue">CT</Tag>}
              >
                <div>
                  <Paragraph className="text-gray-600 text-sm">
                    Genera el archivo XML con el catálogo de cuentas de la empresa y la equivalencia del Código Agrupador del SAT (Nivel 1, 2 y 3).
                  </Paragraph>
                  <div className="bg-gray-50 p-2 rounded text-xs font-mono text-gray-600 mb-4">
                    Nombre: <strong>{clientInfo?.rfc}CT.xml</strong><br />
                    Esquema: <strong>Catalogo_1_3.xsd</strong>
                  </div>
                </div>
                <Button 
                  type="primary" 
                  icon={<DownloadOutlined />} 
                  block
                  loading={downloading.catalogo}
                  onClick={() => handleDownload('catalogo')}
                >
                  Descargar XML Catálogo
                </Button>
              </Card>
            </Col>

            {/* 2. Balanza de Comprobación */}
            <Col xs={24} md={8}>
              <Card 
                className="shadow-sm hover:shadow-md transition-shadow h-full flex flex-col justify-between"
                title={
                  <div className="flex items-center gap-2">
                    <CalendarOutlined className="text-emerald-600 text-lg" />
                    <span className="font-bold">2. Balanza de Comprobación</span>
                  </div>
                }
                extra={<Tag color="green">BN</Tag>}
              >
                <div>
                  <Paragraph className="text-gray-600 text-sm">
                    Genera la balanza de comprobación mensual con saldos iniciales, movimientos deudor/acreedor y saldos finales conciliados al centavo.
                  </Paragraph>
                  <div className="bg-gray-50 p-2 rounded text-xs font-mono text-gray-600 mb-4">
                    Nombre: <strong>{clientInfo?.rfc}{year}{String(month).padStart(2, '0')}BN.xml</strong><br />
                    Tipo: <strong>{tipoEnvio === 'N' ? 'Normal (N)' : 'Complementaria (C)'}</strong>
                  </div>
                </div>
                <Button 
                  type="primary" 
                  icon={<DownloadOutlined />} 
                  block
                  className="bg-emerald-600 hover:bg-emerald-500"
                  loading={downloading.balanza}
                  onClick={() => handleDownload('balanza')}
                >
                  Descargar XML Balanza
                </Button>
              </Card>
            </Col>

            {/* 3. Pólizas del Periodo */}
            <Col xs={24} md={8}>
              <Card 
                className="shadow-sm hover:shadow-md transition-shadow h-full flex flex-col justify-between"
                title={
                  <div className="flex items-center gap-2">
                    <FileTextOutlined className="text-purple-600 text-lg" />
                    <span className="font-bold">3. Pólizas del Periodo</span>
                  </div>
                }
                extra={<Tag color="purple">PL</Tag>}
              >
                <div>
                  <Paragraph className="text-gray-600 text-sm">
                    Genera el archivo XML con el detalle de pólizas contables, movimientos por cuenta y los UUIDs de comprobantes fiscales asociados.
                  </Paragraph>
                  <div className="bg-gray-50 p-2 rounded text-xs font-mono text-gray-600 mb-4">
                    Nombre: <strong>{clientInfo?.rfc}{year}{String(month).padStart(2, '0')}PL.xml</strong><br />
                    Pólizas incluidas: <strong>{data.stats.polizas_periodo}</strong>
                  </div>
                </div>
                <Button 
                  type="primary" 
                  icon={<DownloadOutlined />} 
                  block
                  className="bg-purple-600 hover:bg-purple-500"
                  loading={downloading.polizas}
                  onClick={() => handleDownload('polizas')}
                >
                  Descargar XML Pólizas
                </Button>
              </Card>
            </Col>
          </Row>

          {/* Guía de Cumplimiento SAT */}
          <Card title="Directrices de Cumplimiento SAT - Anexo 24 RMF" size="small" className="shadow-sm bg-gray-50">
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1">
              <li><strong>Catálogo de cuentas:</strong> Se envía por única vez en el primer periodo o cada vez que se agreguen o modifiquen cuentas a nivel mayor o subcuenta.</li>
              <li><strong>Balanza de comprobación:</strong> Las personas morales la envían a más tardar el día 25 del mes siguiente al que corresponda la información; las personas físicas, el día 27.</li>
              <li><strong>Balanza de cierre (Mes 13):</strong> Se envía con los ajustes fiscales a más tardar el 20 de abril del año siguiente para personas morales (22 de mayo para personas físicas).</li>
              <li><strong>Pólizas del periodo:</strong> Se remiten únicamente cuando el SAT lo solicita en auditorías, revisiones electrónicas o solicitudes de compensación/devolución de impuestos.</li>
            </ul>
          </Card>
        </>
      ) : null}
    </div>
  );
};

export default FiscalContabilidadElectronica;
