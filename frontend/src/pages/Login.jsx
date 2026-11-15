import React, { useState } from 'react';
import { Form, Input, Button, Card, Typography, Alert } from 'antd';
import { UserOutlined, LockOutlined, RocketOutlined, AppstoreOutlined } from '@ant-design/icons';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import IterumxLogo from '../components/IterumxLogo';

const { Text } = Typography;

const Login = () => {
  const { login, isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (isAuthenticated) {
    const isSuperAdmin = String(user?.username || '').trim().toLowerCase() === 'sgadmin';
    return <Navigate to={isSuperAdmin ? '/saas-console' : '/'} replace />;
  }

  const onFinish = async (values) => {
    setLoading(true);
    setError('');
    try {
      await login(values.username, values.password);
      const isSuperAdmin = String(values.username || '').trim().toLowerCase() === 'sgadmin';
      navigate(isSuperAdmin ? '/saas-console' : '/');
    } catch (err) {
      const serverDetail = err?.response?.data?.detail;
      if (serverDetail) {
        setError(String(serverDetail));
      } else if (!err?.response || err?.response?.status >= 500) {
        setError(
          'El servidor de Iterumx (puerto 8000) no está activo en este momento. Ejecute el acceso directo "Iterumx" en su Escritorio (o start_iterumx.bat) e intente de nuevo.'
        );
      } else {
        setError('Credenciales incorrectas o error de red. Intente nuevamente.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#1890ff] to-[#001529] p-4">
      <Card className="w-full max-w-md shadow-2xl rounded-lg">
        <div className="text-center mb-6">
          <div className="bg-white p-4 rounded-xl inline-flex items-center justify-center mb-3 border border-blue-100 shadow-sm w-full max-w-[300px]">
            <IterumxLogo size="xl" showSubtitle subtitle="PLATAFORMA CONTABLE Y FISCAL" />
          </div>
          <div>
            <Text type="secondary" className="text-xs font-semibold tracking-wider uppercase text-gray-500">
              Sistema de Contabilidad e Inteligencia Fiscal
            </Text>
          </div>
        </div>
        
        {error && <Alert message={error} type="error" showIcon className="mb-4" />}
        
        <Form form={form} name="login" onFinish={onFinish} layout="vertical" size="large">
          <Form.Item
            name="username"
            rules={[{ required: true, message: 'Por favor ingrese su usuario' }]}
          >
            <Input prefix={<UserOutlined className="text-gray-400" />} placeholder="Usuario" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: 'Por favor ingrese su contraseña' }]}
          >
            <Input.Password prefix={<LockOutlined className="text-gray-400" />} placeholder="Contraseña" />
          </Form.Item>

          <Form.Item className="mb-3">
            <Button type="primary" htmlType="submit" className="w-full h-12 text-lg font-semibold" loading={loading}>
              Iniciar Sesión
            </Button>
          </Form.Item>
        </Form>

        <div className="pt-3 border-t border-gray-100 flex flex-wrap items-center justify-center gap-3 text-xs">
          <Link to="/landing" className="font-semibold text-blue-700 hover:underline flex items-center gap-1">
            <AppstoreOutlined /> Ver Planes y Precios
          </Link>
          <span className="text-gray-300">|</span>
          <Link to="/register" className="font-bold text-emerald-700 hover:underline flex items-center gap-1">
            <RocketOutlined /> Crear Cuenta Gratis (14 días)
          </Link>
        </div>
      </Card>
    </div>
  );
};

export default Login;
