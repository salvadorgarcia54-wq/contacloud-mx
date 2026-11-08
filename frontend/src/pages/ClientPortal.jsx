import React from 'react';
import { Card, Typography, Row, Col, Button, Alert } from 'antd';
import { FileTextOutlined, BarChartOutlined, LineChartOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text } = Typography;

const ClientPortal = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  // If role is not client, they shouldn't really be here, but we can handle it
  if (user?.role === 'admin' || user?.role === 'accountant') {
    return (
      <div className="p-6">
        <Alert message="Vista previa del portal de cliente" type="info" showIcon />
      </div>
    );
  }

  const companyName = user?.company?.business_name || 'Mi Empresa SA de CV';
  const clientId = user?.company?.id || 'all'; // Fallback

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-8">
        <Title level={2}>Bienvenido, {companyName}</Title>
        <Alert 
          message="Acceso de solo lectura" 
          description="Este portal le permite consultar el estado financiero de su empresa. Para cualquier modificación o duda, por favor contacte a su contador asignado." 
          type="info" 
          showIcon 
          className="mt-4"
        />
      </div>

      <Row gutter={[24, 24]} className="mb-8">
        <Col xs={24} md={12}>
          <Card className="h-full border-l-4 border-l-blue-500 shadow-sm">
            <div className="flex items-center gap-4">
              <CheckCircleOutlined className="text-4xl text-green-500" />
              <div>
                <Text type="secondary" className="block text-lg">Estado de la contabilidad</Text>
                <Title level={4} className="m-0">Al corriente (Octubre 2023 procesado)</Title>
              </div>
            </div>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card className="h-full border-l-4 border-l-green-500 shadow-sm">
            <div className="flex items-center gap-4">
              <FileTextOutlined className="text-4xl text-blue-500" />
              <div>
                <Text type="secondary" className="block text-lg">Total de pólizas del mes actual</Text>
                <Title level={2} className="m-0">45</Title>
              </div>
            </div>
          </Card>
        </Col>
      </Row>

      <Title level={3} className="mb-4">Reportes Financieros (Último periodo cerrado)</Title>
      <Row gutter={[24, 24]}>
        <Col xs={24} md={8}>
          <Card hoverable className="text-center shadow-sm" onClick={() => navigate(`/trial-balance/${clientId}`)}>
            <BarChartOutlined className="text-5xl text-blue-500 mb-4" />
            <Title level={4}>Balanza de Comprobación</Title>
            <Text type="secondary">Ver detalle de saldos y movimientos por cuenta</Text>
            <Button type="primary" className="mt-4 w-full">Ver Reporte</Button>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card hoverable className="text-center shadow-sm" onClick={() => navigate(`/income-statement/${clientId}`)}>
            <LineChartOutlined className="text-5xl text-green-500 mb-4" />
            <Title level={4}>Estado de Resultados</Title>
            <Text type="secondary">Consulte la utilidad o pérdida del periodo</Text>
            <Button type="primary" className="mt-4 w-full bg-green-500 hover:bg-green-600">Ver Reporte</Button>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card hoverable className="text-center shadow-sm" onClick={() => navigate(`/balance-sheet/${clientId}`)}>
            <FileTextOutlined className="text-5xl text-purple-500 mb-4" />
            <Title level={4}>Balance General</Title>
            <Text type="secondary">Situación financiera: Activos, Pasivos y Capital</Text>
            <Button type="primary" className="mt-4 w-full bg-purple-500 hover:bg-purple-600">Ver Reporte</Button>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default ClientPortal;
