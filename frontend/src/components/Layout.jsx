import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Layout as AntLayout, Select, Button, Modal, Form, Input, message, theme, Tooltip, Avatar, Tag } from 'antd';
import { LogoutOutlined, UserOutlined, KeyOutlined, ReloadOutlined, HomeOutlined, LockOutlined, CrownOutlined, CreditCardOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { Outlet, Navigate, useNavigate, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import IterumbotWidget from './IterumbotWidget';
import { useAuth } from '../contexts/AuthContext';
import { clientsApi, authApi, saasApi } from '../api/client';

const { Header, Content } = AntLayout;

const ClientContext =
  typeof window !== 'undefined' && window.__CONTACLOUD_CLIENT_CONTEXT__
    ? window.__CONTACLOUD_CLIENT_CONTEXT__
    : createContext({
        selectedClient: null,
        setSelectedClient: () => {},
        clients: [],
        refreshClients: () => {},
      });

if (typeof window !== 'undefined') {
  window.__CONTACLOUD_CLIENT_CONTEXT__ = ClientContext;
}

export const useClient = () => useContext(ClientContext);

export const Layout = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [selectedClient, setSelectedClientState] = useState(() => {
    localStorage.removeItem('contacloud_selected_client');
    return sessionStorage.getItem('contacloud_active_client_session') || null;
  });
  const [clients, setClients] = useState([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordForm] = Form.useForm();
  const [tenantInfo, setTenantInfo] = useState(null);
  const isSaasSuperAdmin = String(user?.username || '').trim().toLowerCase() === 'sgadmin';

  useEffect(() => {
    if (user && user.role === 'admin' && !isSaasSuperAdmin) {
      saasApi
        .getOverview()
        .then((res) => setTenantInfo(res.data?.tenant || null))
        .catch(() => {});
    } else {
      setTenantInfo(null);
    }
  }, [user, location.pathname, isSaasSuperAdmin]);

  const {
    token: { colorBgContainer },
  } = theme.useToken();

  const setSelectedClient = useCallback((id) => {
    const cleanId = id && String(id).trim() !== '' ? String(id) : null;
    setSelectedClientState(cleanId);
    localStorage.removeItem('contacloud_selected_client');
    if (cleanId) {
      sessionStorage.setItem('contacloud_active_client_session', cleanId);
    } else {
      sessionStorage.removeItem('contacloud_active_client_session');
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('contacloud:client-changed', { detail: cleanId }));
    }
  }, []);

  useEffect(() => {
    const onExternalClientChange = (e) => {
      const nextId = e?.detail && String(e.detail).trim() !== '' ? String(e.detail) : null;
      setSelectedClientState(nextId);
    };
    window.addEventListener('contacloud:client-changed', onExternalClientChange);
    return () => window.removeEventListener('contacloud:client-changed', onExternalClientChange);
  }, []);

  const loadClients = useCallback(async () => {
    if (isSaasSuperAdmin) {
      return;
    }
    if (user?.role === 'client') {
      if (user?.client_id) {
        setSelectedClient(String(user.client_id));
      }
      return;
    }
    setLoadingClients(true);
    try {
      const [res, meRes] = await Promise.all([
        clientsApi.list({ limit: 1000 }),
        user?.role !== 'admin' ? authApi.getMe().catch(() => ({ data: user })) : Promise.resolve({ data: user }),
      ]);
      const freshUser = meRes?.data || user;
      let rawClients = res.data || [];
      if (freshUser && freshUser.role !== 'admin') {
        const allowedIds = new Set((freshUser.assigned_client_ids || []).map(Number));
        rawClients = rawClients.filter(c => allowedIds.has(Number(c.id)));
      }
      const list = rawClients.map(c => ({
        value: String(c.id),
        label: `${c.rfc} - ${c.business_name}`,
      }));
      setClients(list);

      const savedClient = sessionStorage.getItem('contacloud_active_client_session');
      if (savedClient && list.some(item => item.value === savedClient)) {
        setSelectedClient(savedClient);
      } else {
        setSelectedClient(null);
      }
    } catch (err) {
      console.error('Error fetching clients:', err);
    } finally {
      setLoadingClients(false);
    }
  }, [user, setSelectedClient, isSaasSuperAdmin]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const isHomePage = location.pathname === '/';

  const handleClientChange = (newClientId) => {
    if (!isHomePage) {
      message.info('Para cambiar de cliente, ve a la pantalla de Inicio.');
      return;
    }
    setSelectedClient(newClientId || null);
  };

  const handleChangePassword = async (values) => {
    if (values.new_password !== values.confirm_password) {
      message.error('Las contraseñas nuevas no coinciden');
      return;
    }
    setPasswordLoading(true);
    try {
      await authApi.changePassword(values.current_password, values.new_password);
      message.success('Contraseña cambiada exitosamente');
      passwordForm.resetFields();
      setPasswordModalVisible(false);
    } catch (err) {
      const msg = err.response?.data?.detail || 'Error al cambiar contraseña';
      message.error(msg);
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <ClientContext.Provider value={{ selectedClient, setSelectedClient, clients, refreshClients: loadClients }}>
      <AntLayout style={{ minHeight: '100vh' }}>
        <Sidebar collapsed={collapsed} onCollapse={setCollapsed} />
        <AntLayout>
          <Header
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 100,
              width: '100%',
              padding: '0 24px',
              background: colorBgContainer,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              boxShadow: '0 1px 4px rgba(0,21,41,.08)'
            }}
          >
            <div className="flex items-center gap-3">
              {user?.role !== 'client' && !isSaasSuperAdmin && (
                isHomePage ? (
                  <>
                    <Select
                      showSearch
                      allowClear
                      placeholder="— Ninguno (Seleccione un cliente para trabajar) —"
                      style={{ width: 400 }}
                      value={selectedClient || ''}
                      onChange={handleClientChange}
                      loading={loadingClients}
                      options={[
                        { value: '', label: '— Ninguno (Seleccione un cliente para trabajar) —' },
                        ...clients,
                      ]}
                      filterOption={(input, option) =>
                        (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                      }
                    />
                    <Tooltip title="Actualizar lista de clientes">
                      <Button 
                        icon={<ReloadOutlined spin={loadingClients} />} 
                        onClick={loadClients} 
                        size="middle" 
                      />
                    </Tooltip>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <Tooltip title="El cambio de cliente solo está disponible en la pantalla de Inicio">
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-sm text-gray-700 select-none cursor-not-allowed">
                        <LockOutlined className="text-gray-400 text-xs" />
                        <span className="font-semibold truncate max-w-[330px]">
                          {clients.find(c => c.value === String(selectedClient))?.label || 'Sin cliente seleccionado'}
                        </span>
                      </div>
                    </Tooltip>
                    <Tooltip title="Ir a Inicio para cambiar de cliente">
                      <Button
                        size="small"
                        type="link"
                        icon={<HomeOutlined />}
                        onClick={() => navigate('/')}
                        className="text-xs font-medium px-1.5"
                      >
                        Cambiar en Inicio
                      </Button>
                    </Tooltip>
                  </div>
                )
              )}
            </div>
            
            <div className="flex items-center gap-3">
              <Tooltip title="Abrir la Landing Page pública de Iterumx">
                <Tag
                  color="blue"
                  onClick={() => navigate('/landing')}
                  className="cursor-pointer font-normal m-0 px-2.5 py-1 hidden md:inline-flex items-center gap-1"
                >
                  Landing Page
                </Tag>
              </Tooltip>
              {user?.role === 'admin' && !isSaasSuperAdmin && (
                <Tooltip title="Ver estado de tu Suscripción y Consumo en Iterumx">
                  <Tag
                    color="green"
                    icon={<CrownOutlined />}
                    onClick={() => navigate('/saas-subscription')}
                    className="cursor-pointer font-semibold m-0 px-2.5 py-1 hidden md:inline-flex items-center gap-1"
                  >
                    Mi Suscripción
                  </Tag>
                </Tooltip>
              )}
              <div className="flex items-center gap-2 font-medium text-gray-700 leading-tight">
                <Avatar
                  size={32}
                  src={user?.photo_url || undefined}
                  icon={!user?.photo_url && <UserOutlined />}
                  className="bg-blue-50 text-blue-600 border border-blue-200"
                />
                <div className="flex flex-col text-left">
                  <span className="text-sm font-semibold text-gray-800 leading-none">
                    {user?.full_name || user?.username || 'Usuario'}
                  </span>
                  {user?.position && (
                    <span className="text-[11px] text-gray-500 leading-none mt-1">
                      {user.position}
                    </span>
                  )}
                </div>
              </div>
              <Button 
                type="default" 
                icon={<KeyOutlined />} 
                onClick={() => setPasswordModalVisible(true)}
                size="small"
              >
                Cambiar Contraseña
              </Button>
              <Button type="text" icon={<LogoutOutlined />} onClick={logout} danger>
                Salir
              </Button>
            </div>
          </Header>

          {user?.role === 'admin' && !isSaasSuperAdmin && tenantInfo && (tenantInfo.status === 'trial' || tenantInfo.status === 'past_due' || tenantInfo.trial_expired) && (
            <div
              className="mx-4 mt-3 px-4 py-2 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs text-white shadow-sm"
              style={{
                background:
                  tenantInfo.trial_expired || tenantInfo.status === 'past_due'
                    ? 'linear-gradient(90deg, #b91c1c 0%, #7f1d1d 100%)'
                    : 'linear-gradient(90deg, #1E2C5E 0%, #312e81 100%)',
              }}
            >
              <div className="flex items-center gap-2 font-medium">
                <ClockCircleOutlined />
                <span>
                  {tenantInfo.trial_expired || tenantInfo.status === 'past_due'
                    ? 'Tu periodo de prueba de 14 días ha vencido. Activa tu suscripción en la pasarela de pago para continuar operando sin interrupciones.'
                    : `Prueba Gratuita 14 días activa (${
                        tenantInfo.trial_days_remaining !== null && tenantInfo.trial_days_remaining !== undefined
                          ? `Quedan ${tenantInfo.trial_days_remaining} días`
                          : `Vence el ${tenantInfo.trial_ends_at}`
                      }) — Al finalizar podrás domiciliar tu plan.`}
                </span>
              </div>
              <Button
                size="small"
                icon={<CreditCardOutlined />}
                onClick={() => navigate('/saas-subscription')}
                style={{
                  backgroundColor: '#635BFF',
                  color: '#fff',
                  borderColor: '#635BFF',
                  fontWeight: 400,
                }}
              >
                Activar Plan
              </Button>
            </div>
          )}

          <Content style={{ margin: '24px 16px', padding: 24, background: colorBgContainer, minHeight: 280, borderRadius: 8 }}>
            {isSaasSuperAdmin && location.pathname !== '/saas-console' ? (
              <Navigate to="/saas-console" replace />
            ) : (
              <Outlet />
            )}
          </Content>
          {!isSaasSuperAdmin && <IterumbotWidget />}
        </AntLayout>
      </AntLayout>

      <Modal
        title="Cambiar Contraseña"
        open={passwordModalVisible}
        onCancel={() => {
          passwordForm.resetFields();
          setPasswordModalVisible(false);
        }}
        footer={null}
        destroyOnClose
      >
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={handleChangePassword}
        >
          <Form.Item
            name="current_password"
            label="Contraseña Actual"
            rules={[{ required: true, message: 'Ingresa tu contraseña actual' }]}
          >
            <Input.Password placeholder="Contraseña actual" />
          </Form.Item>

          <Form.Item
            name="new_password"
            label="Nueva Contraseña"
            rules={[
              { required: true, message: 'Ingresa una nueva contraseña' },
              { min: 8, message: 'Debe tener al menos 8 caracteres' }
            ]}
          >
            <Input.Password placeholder="Nueva contraseña segura (mínimo 8 caracteres)" />
          </Form.Item>

          <Form.Item
            name="confirm_password"
            label="Confirmar Nueva Contraseña"
            rules={[{ required: true, message: 'Confirma la nueva contraseña' }]}
          >
            <Input.Password placeholder="Repite la nueva contraseña" />
          </Form.Item>

          <div className="flex justify-end gap-2 mt-4">
            <Button onClick={() => setPasswordModalVisible(false)}>
              Cancelar
            </Button>
            <Button type="primary" htmlType="submit" loading={passwordLoading}>
              Actualizar Contraseña
            </Button>
          </div>
        </Form>
      </Modal>
    </ClientContext.Provider>
  );
};
