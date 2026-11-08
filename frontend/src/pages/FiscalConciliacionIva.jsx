import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, Row, Col, Select, Button, Typography, Alert, Spin, Space } from 'antd';
import { CalculatorOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { fiscalApi, clientsApi } from '../api/client';
import ConciliacionIvaMatrix from '../components/ConciliacionIvaMatrix';

const { Title } = Typography;
const { Option } = Select;

const monthNames = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export default function FiscalConciliacionIva() {
  const { clientId } = useParams();
  const [loading, setLoading] = useState(true);
  const [clientInfo, setClientInfo] = useState(null);
  const [matrixData, setMatrixData] = useState(null);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(9);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const [clientRes, matrixRes] = await Promise.all([
        clientsApi.get(clientId),
        fiscalApi.getConciliacionIva(clientId, { year, month }),
      ]);
      setClientInfo(clientRes.data);
      setMatrixData(matrixRes.data);
    } catch (err) {
      console.error('Error fetching conciliacion IVA:', err);
      setError('No se pudo cargar el Reporte Conciliación IVA Acreditable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (clientId) {
      fetchData();
    }
  }, [clientId, year, month]);

  return (
    <div className="p-6 print:p-0">
      {/* Encabezado */}
      <div className="flex flex-wrap justify-between items-center mb-4 print:hidden gap-4">
        <div>
          <Title level={2} className="m-0 text-gray-900">
            Reporte Conciliación IVA Acreditable
          </Title>
          <p className="text-gray-500 m-0 text-xs mt-0.5">
            Periodo: <strong>{String(month).padStart(2, '0')}/{year}</strong>
            {clientInfo && (
              <span className="ml-2">
                — Empresa: <strong className="text-gray-700">{clientInfo.business_name}</strong> ({clientInfo.rfc})
              </span>
            )}
          </p>
        </div>
        <Space>
          <Link to={`/fiscal-iva/${clientId}`}>
            <Button icon={<ArrowLeftOutlined />}>
              Ir a Cálculo Mensual de IVA
            </Button>
          </Link>
        </Space>
      </div>

      {/* Filtros Mes y Año */}
      <Card size="small" className="mb-4 shadow-sm bg-white print:hidden">
        <Row gutter={[16, 12]} align="bottom">
          <Col xs={12} sm={8} md={5}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Mes:</label>
            <Select value={month} onChange={setMonth} style={{ width: '100%' }}>
              {monthNames.map((mName, idx) => (
                <Option key={idx + 1} value={idx + 1}>
                  {mName}
                </Option>
              ))}
            </Select>
          </Col>
          <Col xs={12} sm={8} md={5}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Año:</label>
            <Select value={year} onChange={setYear} style={{ width: '100%' }}>
              {[2024, 2025, 2026, 2027].map((y) => (
                <Option key={y} value={y}>
                  {y}
                </Option>
              ))}
            </Select>
          </Col>
          <Col xs={24} sm={8} md={4}>
            <Button
              type="primary"
              onClick={fetchData}
              loading={loading}
              className="bg-blue-600 font-semibold"
            >
              Aplicar filtros
            </Button>
          </Col>
        </Row>
      </Card>

      {error && <Alert message={error} type="error" className="mb-4 print:hidden" showIcon />}

      {loading ? (
        <div className="text-center py-12">
          <Spin size="large" />
        </div>
      ) : (
        <ConciliacionIvaMatrix
          matrixData={matrixData}
          clientInfo={clientInfo}
          year={year}
          month={month}
        />
      )}
    </div>
  );
}
