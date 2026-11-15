import React, { useState } from 'react';
import { Form, Input, Button, Card, Select, Radio, Row, Col, Typography, Alert, Tag, message } from 'antd';
import {
  UserOutlined,
  LockOutlined,
  MailOutlined,
  PhoneOutlined,
  BankOutlined,
  RocketOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import IterumxLogo from '../components/IterumxLogo';
import { saasApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text } = Typography;
const { Option } = Select;

const SaasRegister = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setAuthSession } = useAuth();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const defaultPlan = searchParams.get('plan') || 'profesional';
  const defaultCycle = searchParams.get('cycle') || 'monthly';

  const onFinish = async (values) => {
    setLoading(true);
    setError('');
    try {
      const res = await saasApi.register(values);
      const tokenVal = res.data?.access_token || res.data?.token;
      if (tokenVal && res.data?.user && setAuthSession) {
        setAuthSession(tokenVal, res.data.user);
      }
      message.success(res.data?.message || '¡Cuenta creada exitosamente en Iterumx!');
      navigate('/saas-subscription');
    } catch (err) {
      setError(
        err?.response?.data?.detail ||
          'No se pudo completar el registro. Verifica los datos e intenta nuevamente.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1E2C5E 55%, #001529 100%)',
      }}
    >
      <Card className="w-full max-w-2xl shadow-2xl rounded-2xl border-0">
        <div className="flex items-center justify-between mb-4">
          <Button
            type="link"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/landing')}
            className="p-0 text-xs font-semibold"
          >
            Ver Planes y Precios
          </Button>
          <Tag color="success" className="font-bold">
            Prueba Gratuita 14 Días Incluida
          </Tag>
        </div>

        <div className="text-center mb-6">
          <div className="inline-block bg-slate-50 px-5 py-3 rounded-xl border border-slate-200 mb-2">
            <IterumxLogo size="lg" showSubtitle subtitle="ALTA DE DESPACHO / EMPRESA" />
          </div>
          <Title level={4} className="m-0 mt-1 text-slate-800">
            Crea tu Cuenta Multi-Empresa en Iterumx
          </Title>
          <Text type="secondary" className="text-xs">
            Configura tu espacio de trabajo en menos de 1 minuto y comienza a operar en la nube.
          </Text>
        </div>

        {error && <Alert message={error} type="error" showIcon className="mb-4" />}

        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{
            plan_code: defaultPlan,
            billing_cycle: defaultCycle,
          }}
        >
          <Row gutter={16}>
            <Col xs={24} sm={14}>
              <Form.Item
                name="firm_name"
                label="Nombre del Despacho Contable o Corporativo"
                rules={[{ required: true, message: 'Ingresa el nombre de tu despacho o empresa' }]}
              >
                <Input
                  prefix={<BankOutlined className="text-gray-400" />}
                  placeholder="Ej. Despacho Contable Iterum & Asociados S.C."
                />
              </Form.Item>
            </Col>

            <Col xs={24} sm={10}>
              <Form.Item name="rfc" label="RFC de Facturación (Opcional)">
                <Input
                  placeholder="Ej. DCI240101AAA"
                  maxLength={13}
                  style={{ textTransform: 'uppercase' }}
                />
              </Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item
                name="plan_code"
                label="Plan Seleccionado"
                rules={[{ required: true }]}
              >
                <Select>
                  <Option value="starter">Iterumx Starter ($690 MXN/mes + IVA — 10 Empresas)</Option>
                  <Option value="profesional">Iterumx Profesional ($1,690 MXN/mes + IVA — 50 Empresas)</Option>
                  <Option value="empresarial">Iterumx Empresarial ($3,490 MXN/mes + IVA — 120 Empresas)</Option>
                  <Option value="corporativo">Iterumx Corporativo ($6,900 MXN/mes + IVA — 999 Empresas)</Option>
                </Select>
              </Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item name="billing_cycle" label="Ciclo de Facturación">
                <Radio.Group buttonStyle="solid" className="w-full">
                  <Radio.Button value="monthly" className="w-1/2 text-center">
                    Mensual
                  </Radio.Button>
                  <Radio.Button value="annual" className="w-1/2 text-center">
                    Anual (-20%)
                  </Radio.Button>
                </Radio.Group>
              </Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item
                name="full_name"
                label="Nombre del Titular / Administrador"
                rules={[{ required: true, message: 'Ingresa tu nombre completo' }]}
              >
                <Input prefix={<UserOutlined className="text-gray-400" />} placeholder="Ej. C.P. Alejandro Morales" />
              </Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item
                name="username"
                label="Usuario de Acceso (Login)"
                rules={[{ required: true, message: 'Elige un nombre de usuario' }]}
              >
                <Input prefix={<UserOutlined className="text-gray-400" />} placeholder="Ej. amorales" />
              </Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item
                name="email"
                label="Correo Electrónico Corporativo"
                rules={[
                  { required: true, message: 'Ingresa tu correo' },
                  { type: 'email', message: 'Correo inválido' },
                ]}
              >
                <Input prefix={<MailOutlined className="text-gray-400" />} placeholder="contacto@tudespacho.mx" />
              </Form.Item>
            </Col>

            <Col xs={24} sm={12}>
              <Form.Item name="phone" label="Teléfono / WhatsApp">
                <Input prefix={<PhoneOutlined className="text-gray-400" />} placeholder="55 1234 5678" />
              </Form.Item>
            </Col>

            <Col xs={24}>
              <Form.Item
                name="password"
                label="Contraseña del Administrador"
                rules={[
                  { required: true, message: 'Crea una contraseña segura' },
                  { min: 6, message: 'Mínimo 6 caracteres' },
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined className="text-gray-400" />}
                  placeholder="Contraseña segura (mínimo 6 caracteres)"
                />
              </Form.Item>
            </Col>
          </Row>

          <Button
            type="primary"
            htmlType="submit"
            size="large"
            loading={loading}
            icon={<RocketOutlined />}
            style={{ backgroundColor: '#57A82C', borderColor: '#57A82C' }}
            className="w-full h-12 font-bold text-base shadow-md mt-2"
          >
            Activar Cuenta en Iterumx
          </Button>
        </Form>

        <div className="text-center mt-4 pt-3 border-t border-slate-100 text-xs text-slate-600">
          ¿Ya tienes una cuenta en Iterumx?{' '}
          <Link to="/login" className="font-bold text-blue-700 hover:underline">
            Iniciar Sesión Aquí
          </Link>
        </div>
      </Card>
    </div>
  );
};

export default SaasRegister;
