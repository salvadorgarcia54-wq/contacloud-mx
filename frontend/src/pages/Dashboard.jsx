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
  Select,
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
  DollarCircleOutlined,
  RiseOutlined,
  FallOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  CalendarOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useClient } from '../components/Layout';
import { clientsApi, journalsApi, authApi, reportsApi } from '../api/client';

const { Title, Text } = Typography;
const { Option } = Select;

const MONTHS_OPTIONS = [
  { value: 1, label: 'Enero' },
  { value: 2, label: 'Febrero' },
  { value: 3, label: 'Marzo' },
  { value: 4, label: 'Abril' },
  { value: 5, label: 'Mayo' },
  { value: 6, label: 'Junio' },
  { value: 7, label: 'Julio' },
  { value: 8, label: 'Agosto' },
  { value: 9, label: 'Septiembre' },
  { value: 10, label: 'Octubre' },
  { value: 11, label: 'Noviembre' },
  { value: 12, label: 'Diciembre' },
];

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

  // Estado del Centro de Control Ejecutivo en Tiempo Real
  const [execLoading, setExecLoading] = useState(false);
  const [execData, setExecData] = useState(null);
  const [portfolioObligations, setPortfolioObligations] = useState([]);
  const [filterYear, setFilterYear] = useState(null);
  const [filterMonth, setFilterMonth] = useState(null);

  const userDisplayName = user?.full_name || user?.name || user?.username || 'Usuario';

  const formatMXN = (val) =>
    new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(val || 0));

  const renderSemaphoreBadge = (item) => {
    if (!item) return <Tag>—</Tag>;
    if (item.status === 'cumplido') {
      return (
        <Tag color="success" icon={<CheckCircleOutlined />} className="font-normal m-0">
          {item.label}
        </Tag>
      );
    }
    if (item.status === 'alerta') {
      return (
        <Tag color="error" icon={<ExclamationCircleOutlined />} className="font-normal m-0">
          {item.label}
        </Tag>
      );
    }
    return (
      <Tag color="warning" icon={<ClockCircleOutlined />} className="font-normal m-0">
        {item.label}
      </Tag>
    );
  };

  const fetchExecutiveMetrics = async (clientId, y = filterYear, m = filterMonth) => {
    if (!clientId) {
      setExecData(null);
      return;
    }
    try {
      setExecLoading(true);
      const params = {};
      if (y) params.year = y;
      if (m) params.month = m;
      const res = await reportsApi.executiveDashboard(clientId, params);
      const payload = res?.data || null;
      setExecData(payload);
      if (payload?.period) {
        if (!y) setFilterYear(payload.period.year);
        if (!m) setFilterMonth(payload.period.month);
      }
    } catch (err) {
      console.error('Error loading executive dashboard:', err);
    } finally {
      setExecLoading(false);
    }
  };

  const fetchPortfolioSemaphore = async (y = filterYear, m = filterMonth) => {
    if (user?.role !== 'admin' && user?.role !== 'accountant') return;
    try {
      const params = {};
      if (y) params.year = y;
      if (m) params.month = m;
      const res = await reportsApi.portfolioObligations(params);
      setPortfolioObligations(res?.data?.items || []);
    } catch (err) {
      console.error('Error loading portfolio obligations:', err);
    }
  };

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

  useEffect(() => {
    if (selectedClient) {
      fetchExecutiveMetrics(selectedClient, null, null);
    } else {
      setExecData(null);
    }
  }, [selectedClient]);

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

          {/* CENTRO DE CONTROL EJECUTIVO EN TIEMPO REAL DEL CLIENTE ACTIVO */}
          {selectedClient && execData && (
            <div className="space-y-6 mb-6">
              {/* Barra de Periodo y Accesos Directos del Centro Ejecutivo */}
              <Card
                size="small"
                className="shadow-sm border-l-4 border-l-blue-700 bg-gradient-to-r from-slate-50 to-white"
              >
                <div className="flex flex-wrap justify-between items-center gap-3">
                  <div>
                    <div className="text-sm font-normal text-slate-900 flex items-center gap-2">
                      <BarChartOutlined className="text-blue-700" />
                      Centro de Control Financiero y Fiscal en Tiempo Real — {execData.client?.rfc} ({execData.client?.business_name})
                    </div>
                    <div className="text-xs font-normal text-slate-500">
                      Cifras calculadas en vivo desde Pólizas Contables, Balanza, Cuentas de Mayor y CFDIs de <span>{execData.period?.label}</span>
                    </div>
                  </div>

                  <Space wrap>
                    <div className="flex items-center gap-1.5">
                      <CalendarOutlined className="text-blue-700 text-xs" />
                      <span className="text-xs font-normal text-slate-600">Ejercicio:</span>
                      <Select
                        size="small"
                        value={filterYear || execData.period?.year || 2026}
                        onChange={(y) => {
                          setFilterYear(y);
                          fetchExecutiveMetrics(selectedClient, y, filterMonth || execData.period?.month);
                          fetchPortfolioSemaphore(y, filterMonth || execData.period?.month);
                        }}
                        style={{ width: 90 }}
                      >
                        {[2024, 2025, 2026, 2027].map((yr) => (
                          <Option key={yr} value={yr}>
                            {yr}
                          </Option>
                        ))}
                      </Select>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-normal text-slate-600">Mes:</span>
                      <Select
                        size="small"
                        value={filterMonth || execData.period?.month || 1}
                        onChange={(m) => {
                          setFilterMonth(m);
                          fetchExecutiveMetrics(selectedClient, filterYear || execData.period?.year, m);
                          fetchPortfolioSemaphore(filterYear || execData.period?.year, m);
                        }}
                        style={{ width: 125 }}
                      >
                        {MONTHS_OPTIONS.map((mo) => (
                          <Option key={mo.value} value={mo.value}>
                            {mo.label}
                          </Option>
                        ))}
                      </Select>
                    </div>

                    <Button
                      size="small"
                      icon={<ReloadOutlined spin={execLoading} />}
                      onClick={() => {
                        fetchExecutiveMetrics(selectedClient, filterYear, filterMonth);
                        fetchPortfolioSemaphore(filterYear, filterMonth);
                      }}
                    >
                      Actualizar KPIs
                    </Button>
                  </Space>
                </div>
              </Card>

              {/* 1. INDICADORES FINANCIEROS REALES DEL CLIENTE SELECCIONADO */}
              <Row gutter={[14, 14]}>
                <Col xs={24} sm={12} lg={6}>
                  <Card size="small" className="shadow-sm border-t-4 border-t-emerald-600 h-full">
                    <Statistic
                      title={
                        <span className="text-xs font-normal uppercase text-slate-500">
                          Ingresos del Mes ({execData.period?.month_name})
                        </span>
                      }
                      value={formatMXN(execData.kpis?.ingresos_mes)}
                      prefix={<RiseOutlined className="text-emerald-600 mr-1" />}
                      valueStyle={{ fontWeight: 400, color: '#047857', fontSize: '1.25rem' }}
                    />
                    <div className="text-[11px] font-normal text-slate-500 mt-1 flex justify-between border-t border-slate-100 pt-1.5">
                      <span>Acumulado Anual:</span>
                      <span className="font-mono font-normal text-slate-700">
                        {formatMXN(execData.kpis?.ingresos_acumulados)}
                      </span>
                    </div>
                  </Card>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                  <Card size="small" className="shadow-sm border-t-4 border-t-rose-600 h-full">
                    <Statistic
                      title={
                        <span className="text-xs font-normal uppercase text-slate-500">
                          Egresos del Mes (Costos + Gastos)
                        </span>
                      }
                      value={formatMXN(execData.kpis?.egresos_mes)}
                      prefix={<FallOutlined className="text-rose-600 mr-1" />}
                      valueStyle={{ fontWeight: 400, color: '#be123c', fontSize: '1.25rem' }}
                    />
                    <div className="text-[11px] font-normal text-slate-500 mt-1 flex justify-between border-t border-slate-100 pt-1.5">
                      <span>Costos: {formatMXN(execData.kpis?.costos_mes)}</span>
                      <span>Gastos: {formatMXN(execData.kpis?.gastos_mes)}</span>
                    </div>
                  </Card>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                  <Card size="small" className="shadow-sm border-t-4 border-t-indigo-600 h-full">
                    <Statistic
                      title={
                        <span className="text-xs font-normal uppercase text-slate-500">
                          Utilidad Neta Acumulada ({execData.period?.year})
                        </span>
                      }
                      value={formatMXN(execData.kpis?.utilidad_neta_acumulada)}
                      prefix={<DollarCircleOutlined className="text-indigo-600 mr-1" />}
                      valueStyle={{
                        fontWeight: 400,
                        color: Number(execData.kpis?.utilidad_neta_acumulada || 0) >= 0 ? '#1e3a8a' : '#b91c1c',
                        fontSize: '1.25rem',
                      }}
                    />
                    <div className="text-[11px] font-normal text-slate-500 mt-1 flex justify-between border-t border-slate-100 pt-1.5">
                      <span>Resultado del Mes:</span>
                      <span
                        className={`font-mono font-normal ${
                          Number(execData.kpis?.utilidad_mes || 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {formatMXN(execData.kpis?.utilidad_mes)}
                      </span>
                    </div>
                  </Card>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                  <Card
                    size="small"
                    hoverable
                    onClick={() => navigate(`/bank-reconciliation/${selectedClient}`)}
                    className="shadow-sm border-t-4 border-t-sky-600 h-full"
                  >
                    <Statistic
                      title={
                        <span className="text-xs font-normal uppercase text-slate-500">
                          Saldo en Bancos (Cuenta 102)
                        </span>
                      }
                      value={formatMXN(execData.kpis?.saldo_bancos_102)}
                      prefix={<BankOutlined className="text-sky-600 mr-1" />}
                      valueStyle={{ fontWeight: 400, color: '#0369a1', fontSize: '1.25rem' }}
                    />
                    <div className="text-[11px] font-normal text-sky-700 mt-1 flex justify-between border-t border-slate-100 pt-1.5">
                      <span>Liquidez disponible al corte</span>
                      <span className="font-normal underline">Ir a Bancos →</span>
                    </div>
                  </Card>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                  <Card
                    size="small"
                    hoverable
                    onClick={() => navigate(`/ledger/${selectedClient}`)}
                    className="shadow-sm border-l-4 border-l-teal-600 h-full"
                  >
                    <Statistic
                      title={
                        <span className="text-xs font-normal uppercase text-slate-500">
                          Cuentas por Cobrar (Clientes 105)
                        </span>
                      }
                      value={formatMXN(execData.kpis?.cuentas_por_cobrar_105)}
                      valueStyle={{ fontWeight: 400, color: '#0f766e', fontSize: '1.15rem' }}
                    />
                    <div className="text-[11px] font-normal text-slate-500 mt-1">
                      Cartera pendiente de cobro (105-01 / 105-02)
                    </div>
                  </Card>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                  <Card
                    size="small"
                    hoverable
                    onClick={() => navigate(`/ledger/${selectedClient}`)}
                    className="shadow-sm border-l-4 border-l-amber-600 h-full"
                  >
                    <Statistic
                      title={
                        <span className="text-xs font-normal uppercase text-slate-500">
                          Cuentas por Pagar (Proveedores 201)
                        </span>
                      }
                      value={formatMXN(execData.kpis?.cuentas_por_pagar_201)}
                      valueStyle={{ fontWeight: 400, color: '#b45309', fontSize: '1.15rem' }}
                    />
                    <div className="text-[11px] font-normal text-slate-500 mt-1">
                      Pasivo exigible a proveedores (201-01)
                    </div>
                  </Card>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                  <Card
                    size="small"
                    hoverable
                    onClick={() => navigate(`/cfdi-upload/${selectedClient}`)}
                    className="shadow-sm border-l-4 border-l-orange-500 h-full"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-normal uppercase text-slate-500">
                        CFDIs sin Contabilizar
                      </span>
                      <Tag
                        color={Number(execData.kpis?.cfdis_sin_contabilizar_count || 0) === 0 ? 'success' : 'warning'}
                        className="font-normal m-0"
                      >
                        {Number(execData.kpis?.cfdis_sin_contabilizar_count || 0) === 0 ? 'Al día' : 'Pendientes'}
                      </Tag>
                    </div>
                    <div className="text-xl font-normal text-slate-900 mt-1">
                      {execData.kpis?.cfdis_sin_contabilizar_count || 0} CFDI(s)
                    </div>
                    <div className="text-[11px] font-normal text-slate-500 mt-1 flex justify-between">
                      <span>Importe: {formatMXN(execData.kpis?.cfdis_sin_contabilizar_total)}</span>
                      <span className="text-blue-600 font-normal">Contabilizar →</span>
                    </div>
                  </Card>
                </Col>

                <Col xs={24} sm={12} lg={6}>
                  <Card
                    size="small"
                    hoverable
                    onClick={() => navigate(`/fiscal-complementos/${selectedClient}`)}
                    className="shadow-sm border-l-4 border-l-purple-600 h-full"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-normal uppercase text-slate-500">
                        Complementos de Pago Pendientes
                      </span>
                      <Tag
                        color={Number(execData.kpis?.complementos_pendientes_count || 0) === 0 ? 'success' : 'purple'}
                        className="font-normal m-0"
                      >
                        PPD / REP
                      </Tag>
                    </div>
                    <div className="text-xl font-normal text-purple-900 mt-1">
                      {execData.kpis?.complementos_pendientes_count || 0} Pendiente(s)
                    </div>
                    <div className="text-[11px] font-normal text-slate-500 mt-1 flex justify-between">
                      <span>Monto: {formatMXN(execData.kpis?.complementos_pendientes_monto)}</span>
                      <span className="text-purple-700 font-normal">Revisar PPD →</span>
                    </div>
                  </Card>
                </Col>
              </Row>

              {/* 2. GRÁFICA COMPARATIVA MENSUAL (12 MESES): INGRESOS VS COSTOS Y GASTOS + SEMÁFORO DEL CLIENTE */}
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={15}>
                  <Card
                    size="small"
                    className="shadow-sm h-full"
                    title={
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-normal text-slate-800 flex items-center gap-2">
                          <BarChartOutlined className="text-blue-600" />
                          Gráfica Comparativa Mensual: Ingresos vs. Costos y Gastos ({execData.period?.year})
                        </span>
                        <div className="flex items-center gap-3 text-xs font-normal">
                          <span className="inline-flex items-center gap-1">
                            <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> Ingresos
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="w-3 h-3 rounded-sm bg-rose-500 inline-block" /> Costos y Gastos
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="w-3 h-3 rounded-sm bg-indigo-600 inline-block" /> Utilidad Neta
                          </span>
                        </div>
                      </div>
                    }
                  >
                    {(() => {
                      const series = execData.monthly_series || [];
                      const maxVal = Math.max(
                        1,
                        ...series.map((s) => Math.max(Number(s.ingresos || 0), Number(s.egresos || 0)))
                      );
                      return (
                        <div>
                          <div className="grid grid-cols-12 gap-2 items-end h-52 pt-4 pb-2 px-2 border-b border-slate-200">
                            {series.map((item) => {
                              const ingH = Math.max(4, Math.round((Number(item.ingresos || 0) / maxVal) * 150));
                              const egrH = Math.max(4, Math.round((Number(item.egresos || 0) / maxVal) * 150));
                              const isCurrentMonth = Number(item.month) === Number(execData.period?.month);
                              return (
                                <Tooltip
                                  key={item.month}
                                  title={
                                    <div className="text-xs space-y-0.5 font-normal">
                                      <div className="font-normal border-b border-white/20 pb-0.5 mb-1">
                                        {item.label} {execData.period?.year} ({item.polizas_count} pólizas)
                                      </div>
                                      <div>Ingresos: {formatMXN(item.ingresos)}</div>
                                      <div>Costos: {formatMXN(item.costos)}</div>
                                      <div>Gastos: {formatMXN(item.gastos)}</div>
                                      <div className="font-normal text-emerald-300">
                                        Utilidad: {formatMXN(item.utilidad)}
                                      </div>
                                    </div>
                                  }
                                >
                                  <div
                                    onClick={() => {
                                      setFilterMonth(item.month);
                                      fetchExecutiveMetrics(
                                        selectedClient,
                                        filterYear || execData.period?.year,
                                        item.month
                                      );
                                    }}
                                    className={`flex flex-col items-center cursor-pointer rounded px-1 py-1 transition-all ${
                                      isCurrentMonth
                                        ? 'bg-blue-50 ring-1 ring-blue-400'
                                        : 'hover:bg-slate-50'
                                    }`}
                                  >
                                    <div className="flex items-end justify-center gap-1 h-40 w-full">
                                      <div
                                        style={{ height: `${item.ingresos > 0 ? ingH : 3}px` }}
                                        className="w-3 bg-emerald-500 rounded-t transition-all"
                                      />
                                      <div
                                        style={{ height: `${item.egresos > 0 ? egrH : 3}px` }}
                                        className="w-3 bg-rose-500 rounded-t transition-all"
                                      />
                                    </div>
                                    <span
                                      className={`text-[11px] mt-1.5 font-normal ${
                                        isCurrentMonth ? 'text-blue-800' : 'text-slate-600'
                                      }`}
                                    >
                                      {item.label}
                                    </span>
                                  </div>
                                </Tooltip>
                              );
                            })}
                          </div>
                          <div className="flex flex-wrap justify-between items-center text-xs font-normal text-slate-500 mt-2 px-1">
                            <span>
                              Haz clic en cualquier mes de la gráfica para inspeccionar sus cifras detalladas.
                            </span>
                            <Button
                              type="link"
                              size="small"
                              onClick={() => navigate(`/income-statement/${selectedClient}`)}
                            >
                              Ver Estado de Resultados completo →
                            </Button>
                          </div>
                        </div>
                      );
                    })()}
                  </Card>
                </Col>

                <Col xs={24} lg={9}>
                  <Card
                    size="small"
                    className="shadow-sm h-full"
                    title={
                      <span className="font-normal text-slate-800 flex items-center gap-2">
                        <SafetyCertificateOutlined className="text-emerald-600" />
                        Semáforo de Obligaciones ({execData.period?.label})
                      </span>
                    }
                  >
                    <div className="space-y-3">
                      <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 flex items-center justify-between">
                        <div>
                          <div className="text-xs font-normal text-slate-800">1. Balanza de Comprobación Cuadrada</div>
                          <div className="text-[11px] font-normal text-slate-500">Validación de partida doble (Cargos = Abonos)</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {renderSemaphoreBadge(execData.obligations?.balanza_cuadrada)}
                          <Button
                            size="small"
                            type="link"
                            onClick={() => navigate(`/trial-balance/${selectedClient}`)}
                          >
                            Ver
                          </Button>
                        </div>
                      </div>

                      <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 flex items-center justify-between">
                        <div>
                          <div className="text-xs font-normal text-slate-800">2. Traspaso Mensual de IVA</div>
                          <div className="text-[11px] font-normal text-slate-500">Cruce de IVA acreditable (118) vs trasladado (208)</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {renderSemaphoreBadge(execData.obligations?.iva_traspasado)}
                          <Button
                            size="small"
                            type="link"
                            onClick={() => navigate(`/fiscal-iva/${selectedClient}`)}
                          >
                            Ver
                          </Button>
                        </div>
                      </div>

                      <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 flex items-center justify-between">
                        <div>
                          <div className="text-xs font-normal text-slate-800">3. Depreciación Fiscal y Contable</div>
                          <div className="text-[11px] font-normal text-slate-500">Aplicación mensual sobre activos fijos registrados</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {renderSemaphoreBadge(execData.obligations?.depreciacion_aplicada)}
                          <Button
                            size="small"
                            type="link"
                            onClick={() => navigate(`/fiscal-inversiones/${selectedClient}`)}
                          >
                            Ver
                          </Button>
                        </div>
                      </div>

                      <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 flex items-center justify-between">
                        <div>
                          <div className="text-xs font-normal text-slate-800">4. DIOT Generada / Operaciones con Terceros</div>
                          <div className="text-[11px] font-normal text-slate-500">CFDIs recibidos contabilizados para carga batch SAT</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {renderSemaphoreBadge(execData.obligations?.diot_generada)}
                          <Button
                            size="small"
                            type="link"
                            onClick={() => navigate(`/fiscal-diot/${selectedClient}`)}
                          >
                            Ver
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                </Col>
              </Row>
            </div>
          )}

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
