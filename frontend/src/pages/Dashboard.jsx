import React, { useEffect, useState } from 'react';
import {
  Card,
  Statistic,
  Row,
  Col,
  Button,
  Typography,
  Spin,
  Alert,
  Table,
  Tag,
  Input,
  Space,
  Tooltip,
  message,
} from 'antd';
import {
  UsergroupAddOutlined,
  FileTextOutlined,
  UploadOutlined,
  BarChartOutlined,
  CheckCircleFilled,
  PlayCircleFilled,
  SearchOutlined,
  AccountBookOutlined,
  BankOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useClient } from '../components/Layout';
import { clientsApi, journalsApi, authApi } from '../api/client';

const { Title, Text } = Typography;

const Dashboard = () => {
  const { user } = useAuth();
  const { selectedClient: contextClient, setSelectedClient: setContextClient, refreshClients } = useClient();
  const navigate = useNavigate();

  const [localSelectedClient, setLocalSelectedClient] = useState(() => {
    return sessionStorage.getItem('contacloud_active_client_session') || contextClient || null;
  });

  const selectedClient = localSelectedClient;

  useEffect(() => {
    setLocalSelectedClient(sessionStorage.getItem('contacloud_active_client_session') || contextClient || null);
  }, [contextClient]);

  useEffect(() => {
    const onClientChange = (e) => {
      const nextId = e?.detail && String(e.detail).trim() !== '' ? String(e.detail) : null;
      setLocalSelectedClient(nextId);
    };
    window.addEventListener('contacloud:client-changed', onClientChange);
    return () => window.removeEventListener('contacloud:client-changed', onClientChange);
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [clientsList, setClientsList] = useState([]);
  const [searchClient, setSearchClient] = useState('');
  const [stats, setStats] = useState({ clients: 0, journals: 0 });

  const userDisplayName = user?.full_name || user?.name || user?.username || 'Usuario';

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      if (user?.role === 'admin' || user?.role === 'accountant') {
        const [clientsRes, meRes] = await Promise.all([
          clientsApi.list({ limit: 1000 }).catch(() => ({ data: [] })),
          user?.role !== 'admin' ? authApi.getMe().catch(() => ({ data: user })) : Promise.resolve({ data: user }),
        ]);
        const freshUser = meRes?.data || user;
        let allClients = clientsRes?.data || [];
        if (freshUser && freshUser.role !== 'admin') {
          const allowedIds = new Set((freshUser.assigned_client_ids || []).map(Number));
          allClients = allClients.filter((c) => allowedIds.has(Number(c.id)));
        }
        setClientsList(allClients);

        const activeClientId = selectedClient || null;

        let journalsCount = 0;
        if (activeClientId) {
          const journalsRes = await journalsApi
            .listByClient(activeClientId)
            .catch(() => ({ data: [] }));
          journalsCount = journalsRes?.data?.length || 0;
        }

        setStats({
          clients: allClients.filter((c) => c.is_active !== false).length,
          journals: journalsCount,
        });
      }
    } catch (err) {
      setError('Error al cargar la información de inicio.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [user, selectedClient]);

  const handleSelectAndWork = (clientRecord, targetRoute = null) => {
    const idStr = String(clientRecord.id);
    sessionStorage.setItem('contacloud_active_client_session', idStr);
    setLocalSelectedClient(idStr);
    if (setContextClient) {
      setContextClient(idStr);
    }
    window.dispatchEvent(new CustomEvent('contacloud:client-changed', { detail: idStr }));
    message.success(
      `Cliente activo seleccionado: ${clientRecord.rfc} - ${clientRecord.business_name}`
    );
    if (targetRoute) {
      navigate(targetRoute.replace('{clientId}', idStr));
    }
  };

  const activeClientObj = clientsList.find((c) => String(c.id) === String(selectedClient));

  const filteredClients = clientsList.filter((c) => {
    if (!searchClient) return true;
    const term = searchClient.toLowerCase();
    return (
      (c.rfc || '').toLowerCase().includes(term) ||
      (c.business_name || '').toLowerCase().includes(term) ||
      (c.tax_regime || '').toLowerCase().includes(term) ||
      (c.email || '').toLowerCase().includes(term)
    );
  });

  const clientColumns = [
    {
      title: 'Trabajar',
      key: 'select_icon',
      width: 175,
      align: 'center',
      render: (_, record) => {
        const isSelected = String(record.id) === String(selectedClient);
        return (
          <Tooltip
            title={
              isSelected
                ? 'Este cliente ya está activo para trabajar'
                : 'Haga clic para seleccionar este cliente y trabajar con su contabilidad'
            }
          >
            <Button
              type={isSelected ? 'primary' : 'default'}
              size="small"
              icon={
                isSelected ? (
                  <CheckCircleFilled className="text-white" />
                ) : (
                  <PlayCircleFilled className="text-blue-600" />
                )
              }
              onClick={() => handleSelectAndWork(record)}
              className={
                isSelected
                  ? 'bg-emerald-600 hover:bg-emerald-700 border-emerald-600 font-semibold shadow-sm'
                  : 'border-blue-300 text-blue-700 hover:border-blue-500 hover:bg-blue-50 font-medium'
              }
            >
              {isSelected ? 'Cliente Activo' : 'Seleccionar'}
            </Button>
          </Tooltip>
        );
      },
    },
    {
      title: 'RFC',
      dataIndex: 'rfc',
      key: 'rfc',
      width: 145,
      render: (rfc, record) => {
        const isSelected = String(record.id) === String(selectedClient);
        return (
          <span
            className={`font-mono text-xs font-bold ${
              isSelected ? 'text-emerald-700' : 'text-blue-900'
            }`}
          >
            {rfc}
          </span>
        );
      },
    },
    {
      title: 'Razón Social / Nombre del Cliente',
      dataIndex: 'business_name',
      key: 'business_name',
      render: (name, record) => {
        const isSelected = String(record.id) === String(selectedClient);
        return (
          <div className="flex items-center gap-2">
            <span
              className={`text-sm ${
                isSelected ? 'font-bold text-gray-900' : 'font-medium text-gray-800'
              }`}
            >
              {name}
            </span>
            {isSelected && (
              <Tag color="success" className="text-[11px] font-semibold m-0">
                En uso
              </Tag>
            )}
          </div>
        );
      },
    },
    {
      title: 'Régimen Fiscal',
      dataIndex: 'tax_regime',
      key: 'tax_regime',
      width: 130,
      align: 'center',
      render: (reg) =>
        reg ? (
          <Tag color="geekblue" className="font-mono text-xs m-0">
            {reg}
          </Tag>
        ) : (
          <span className="text-gray-400 text-xs">-</span>
        ),
    },
    {
      title: 'Estado en el Sistema',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 150,
      align: 'center',
      render: (active) => (
        <Tag color={active !== false ? 'green' : 'red'} className="font-medium m-0">
          {active !== false ? 'Activo' : 'Inactivo'}
        </Tag>
      ),
    },
    {
      title: 'Ir Directo al Módulo',
      key: 'quick_modules',
      width: 240,
      align: 'center',
      render: (_, record) => (
        <Space size={6}>
          <Tooltip title="Seleccionar e ir a Pólizas Contables">
            <Button
              size="small"
              icon={<FileTextOutlined />}
              onClick={() => handleSelectAndWork(record, '/journal/{clientId}')}
              className="text-xs"
            >
              Pólizas
            </Button>
          </Tooltip>
          <Tooltip title="Seleccionar e ir a Cargar CFDI">
            <Button
              size="small"
              icon={<UploadOutlined />}
              onClick={() => handleSelectAndWork(record, '/cfdi-upload/{clientId}')}
              className="text-xs"
            >
              CFDI
            </Button>
          </Tooltip>
          <Tooltip title="Seleccionar e ir a Catálogo de Cuentas">
            <Button
              size="small"
              icon={<AccountBookOutlined />}
              onClick={() => handleSelectAndWork(record, '/accounts/{clientId}')}
            />
          </Tooltip>
          <Tooltip title="Seleccionar e ir a Balanza de Comprobación">
            <Button
              size="small"
              icon={<BarChartOutlined />}
              onClick={() => handleSelectAndWork(record, '/trial-balance/{clientId}')}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  if (loading && clientsList.length === 0) {
    return (
      <div className="p-8 text-center">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="p-2">
      {/* Banner de Bienvenida con imagen extendida a todo lo ancho y letras blancas */}
      <div
        className="w-full rounded-xl overflow-hidden shadow-md mb-6 relative"
        style={{
          backgroundImage: `linear-gradient(90deg, rgba(2, 18, 68, 0.72) 0%, rgba(4, 36, 130, 0.45) 60%, rgba(2, 18, 68, 0.65) 100%), url('/api/assets/banner-inicio')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          minHeight: '145px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <div className="w-full px-8 py-6 flex flex-wrap justify-between items-center gap-4">
          <div>
            <h1
              className="text-3xl md:text-4xl font-light m-0 tracking-wide"
              style={{
                color: '#ffffff',
                fontWeight: 300,
                textShadow: '0 2px 8px rgba(0, 0, 0, 0.65)',
              }}
            >
              Bienvenido, {userDisplayName}
            </h1>
            <p
              className="m-0 mt-1.5 text-sm md:text-base font-light"
              style={{
                color: 'rgba(255, 255, 255, 0.92)',
                fontWeight: 300,
                textShadow: '0 1px 4px rgba(0, 0, 0, 0.6)',
              }}
            >
              Resumen de tu contabilidad al día de hoy
            </p>
          </div>

          {activeClientObj ? (
            <div
              className="px-4 py-2.5 rounded-lg border border-white/30 backdrop-blur-sm"
              style={{ backgroundColor: 'rgba(0, 15, 55, 0.65)' }}
            >
              <div className="text-[11px] uppercase tracking-wider text-sky-200 font-semibold">
                Cliente Activo Seleccionado
              </div>
              <div className="text-sm md:text-base font-bold text-white flex items-center gap-2 mt-0.5">
                <CheckCircleFilled className="text-emerald-400" />
                <span>
                  {activeClientObj.rfc} — {activeClientObj.business_name}
                </span>
              </div>
            </div>
          ) : (
            <div
              className="px-4 py-2.5 rounded-lg border border-amber-300/50 backdrop-blur-sm"
              style={{ backgroundColor: 'rgba(0, 15, 55, 0.65)' }}
            >
              <div className="text-[11px] uppercase tracking-wider text-amber-300 font-semibold">
                Cliente Activo Seleccionado
              </div>
              <div className="text-sm md:text-base font-semibold text-white flex items-center gap-2 mt-0.5">
                <span>— Ninguno (Seleccione un cliente para trabajar) —</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && <Alert message={error} type="error" showIcon className="mb-6" />}

      {user?.role === 'admin' || user?.role === 'accountant' ? (
        <>
          {/* Lista de Clientes debajo del banner para seleccionarlos y trabajar con ellos */}
          <Card
            className="mb-6 shadow-sm border-blue-100"
            title={
              <div className="flex flex-wrap justify-between items-center gap-3 py-1">
                <div className="flex items-center gap-2">
                  <PlayCircleFilled className="text-blue-600 text-lg" />
                  <div>
                    <span className="font-bold text-base text-gray-800">
                      Selección de Cliente para Trabajar
                    </span>
                    <div className="text-xs font-normal text-gray-500">
                      Haga clic en el icono <strong>Seleccionar</strong> de cualquier empresa para activarla y trabajar en sus módulos contables y fiscales
                    </div>
                  </div>
                </div>

                <Space wrap>
                  <Input
                    placeholder="Buscar cliente por RFC o Razón Social..."
                    prefix={<SearchOutlined className="text-gray-400" />}
                    value={searchClient}
                    onChange={(e) => setSearchClient(e.target.value)}
                    style={{ width: 290 }}
                    allowClear
                  />
                  <Tooltip title="Actualizar lista de clientes">
                    <Button
                      icon={<ReloadOutlined spin={loading} />}
                      onClick={() => {
                        fetchDashboardData();
                        if (refreshClients) refreshClients();
                      }}
                    />
                  </Tooltip>
                  <Button
                    type="primary"
                    icon={<UsergroupAddOutlined />}
                    onClick={() => navigate('/clients')}
                  >
                    Administrar Clientes
                  </Button>
                </Space>
              </div>
            }
          >
            <Table
              dataSource={filteredClients}
              columns={clientColumns}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 8, showSizeChanger: true }}
              rowClassName={(record) =>
                String(record.id) === String(selectedClient)
                  ? 'bg-emerald-50/70 font-medium'
                  : 'hover:bg-slate-50 cursor-pointer'
              }
              onRow={(record) => ({
                onDoubleClick: () => handleSelectAndWork(record),
              })}
              scroll={{ x: 900 }}
            />
          </Card>

          {/* Indicadores Generales */}
          <Row gutter={[16, 16]} className="mb-6">
            <Col xs={24} sm={12} lg={8}>
              <Card className="shadow-sm">
                <Statistic
                  title="Total Clientes Activos"
                  value={stats.clients}
                  prefix={<UsergroupAddOutlined className="text-blue-600" />}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Card className="shadow-sm">
                <Statistic
                  title={`Pólizas Registradas (${activeClientObj ? activeClientObj.rfc : 'Cliente Activo'})`}
                  value={stats.journals}
                  prefix={<FileTextOutlined className="text-indigo-600" />}
                />
              </Card>
            </Col>
            <Col xs={24} sm={24} lg={8}>
              <Card className="shadow-sm">
                <div className="text-xs text-gray-500 mb-2 font-semibold uppercase">
                  Accesos Rápidos del Cliente Activo
                </div>
                <Space wrap>
                  <Button
                    type="primary"
                    size="small"
                    icon={<UploadOutlined />}
                    disabled={!selectedClient}
                    onClick={() => navigate(`/cfdi-upload/${selectedClient}`)}
                  >
                    Cargar CFDI
                  </Button>
                  <Button
                    size="small"
                    icon={<FileTextOutlined />}
                    disabled={!selectedClient}
                    onClick={() => navigate(`/journal/${selectedClient}`)}
                  >
                    Pólizas
                  </Button>
                  <Button
                    size="small"
                    icon={<BarChartOutlined />}
                    disabled={!selectedClient}
                    onClick={() => navigate(`/trial-balance/${selectedClient}`)}
                  >
                    Balanza
                  </Button>
                  <Button
                    size="small"
                    icon={<BankOutlined />}
                    disabled={!selectedClient}
                    onClick={() => navigate(`/bank-reconciliation/${selectedClient}`)}
                  >
                    Bancos
                  </Button>
                </Space>
              </Card>
            </Col>
          </Row>
        </>
      ) : (
        <Card title="Información de tu Empresa" className="mb-6">
          <p>
            <strong>Razón Social:</strong> {user?.company?.business_name || 'Mi Empresa SA de CV'}
          </p>
          <p>
            <strong>RFC:</strong> {user?.company?.rfc || 'XAXX010101000'}
          </p>
          <div className="mt-4 flex gap-4">
            <Button type="primary" onClick={() => navigate('/portal')}>
              Ir al Portal de Cliente
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
};

export default Dashboard;
