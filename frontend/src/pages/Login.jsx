import React, { useState } from 'react';
import { Form, Input, Button, Card, Typography, Alert } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import logoImg from '../assets/logo.png';

const { Title, Text } = Typography;

const Login = () => {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const onFinish = async (values) => {
    setLoading(true);
    setError('');
    try {
      await login(values.username, values.password);
      navigate('/');
    } catch (err) {
      setError('Credenciales incorrectas o error de red. Intente nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemoAssistant = () => {
    form.setFieldsValue({ username: 'auxiliar', password: 'auxiliar123' });
    onFinish({ username: 'auxiliar', password: 'auxiliar123' });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#1890ff] to-[#001529] p-4">
      <Card className="w-full max-w-md shadow-2xl rounded-lg">
        <div className="text-center mb-6">
          <div className="bg-white p-4 rounded-xl inline-block mb-3 border border-blue-100 shadow-sm w-full max-w-[280px]">
            <img 
              src={logoImg} 
              alt="Garcia Salas Asesores de Negocio" 
              className="h-20 w-auto max-w-full mx-auto object-contain" 
            />
          </div>
          <div>
            <Text type="secondary" className="text-xs font-semibold tracking-wider uppercase text-gray-500">
              Sistema de Contabilidad Fiscal
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

        <div className="pt-3 border-t border-gray-100 text-center">
          <div className="text-[11px] text-gray-500 mb-2">
            Cuenta Demo de Auxiliar Contable (sin acceso a módulos del Socio/Titular):
          </div>
          <Button
            size="small"
            type="dashed"
            onClick={handleQuickDemoAssistant}
            loading={loading}
            className="text-xs text-blue-700 border-blue-300 hover:border-blue-500 font-medium"
          >
            👤 Ingresar como Auxiliar Demo (auxiliar / auxiliar123)
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default Login;
