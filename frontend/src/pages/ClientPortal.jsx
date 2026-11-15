import React, { useEffect, useState } from 'react';
import {
  Card,
  Typography,
  Row,
  Col,
  Button,
  Alert,
  Statistic,
  Tag,
  Select,
  Space,
  Tooltip,
  Spin,
} from 'antd';
import {
  FileTextOutlined,
  BarChartOutlined,
  LineChartOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  DollarCircleOutlined,
  BankOutlined,
  RiseOutlined,
  FallOutlined,
  SafetyCertificateOutlined,
  ReloadOutlined,
  CalendarOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useClient } from '../components/Layout';
import { reportsApi } from '../api/client';

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

const ClientPortal = () => {
  const { user } = useAuth();
  const { selectedClient } = useClient();
  const navigate = useNavigate();

  const effectiveClientId =
    user?.role === 'client'
      ? user?.client_id || user?.company?.id
      : selectedClient || sessionStorage.getItem('contacloud_active_client_session');

  const [loading, setLoading] = useState(false);
  const [execData, setExecData] = useState(null);
  const [year, setYear] = useState(null);
  const [month, setMonth] = useState(null);

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

  const loadPortalData = async (cid = effectiveClientId, y = year, m = month) => {
    if (!cid) return;
    setLoading(true);
    try {
      const params = {};
      if (y) params.year = y;
      if (m) params.month = m;
      const res = await reportsApi.executiveDashboard(cid, params);
      const data = res?.data || null;
      setExecData(data);
      if (data?.period) {
        if (!y) setYear(data.period.year);
        if (!m) setMonth(data.period.month);
      }
    } catch (err) {
      console.error('Error loading client portal data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (effectiveClientId) {
      loadPortalData(effectiveClientId, null, null);
    }
  }, [effectiveClientId]);

  if (!effectiveClientId) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <Alert
          message="Seleccione un cliente activo"
          description="Para visualizar el Portal Ejecutivo del Cliente con datos en tiempo real, seleccione primero una empresa en la pantalla de Inicio."
          type="warning"
          showIcon
          action={
            <Button type="primary" size="small" onClick={() => navigate('/')}>
              Ir a Inicio
            </Button>
          }
        />
      </div>
    );
  }

  const companyName = execData?.client?.business_name || user?.company?.business_name || 'Empresa';
  const companyRfc = execData?.client?.rfc || user?.company?.rfc || '';
  const kpis = execData?.kpis || {};
  const obligations = execData?.obligations || {};
  const series = execData?.monthly_series || [];

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <Title level={2} className="m-0">
            Portal Ejecutivo — {companyName}
          </Title>
          <Text type="secondary" className="text-xs font-normal">
            RFC: <span className="font-mono font-normal">{companyRfc}</span> • Periodo consultado:{' '}
            <span>{execData?.period?.label || 'Actual'}</span> • Datos 100% en tiempo real
          </Text>
        </div>

        <Space wrap>
          <div className="flex items-center gap-1.5">
            <CalendarOutlined className="text-blue-600 text-xs" />
            <span className="text-xs font-normal text-slate-600">Año:</span>
            <Select
              size="small"
              value={year || execData?.period?.year || 2026}
              onChange={(y) => {
                setYear(y);
                loadPortalData(effectiveClientId, y, month || execData?.period?.month);
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
              value={month || execData?.period?.month || 1}
              onChange={(m) => {
                setMonth(m);
                loadPortalData(effectiveClientId, year || execData?.period?.year, m);
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
            icon={<ReloadOutlined spin={loading} />}
            onClick={() => loadPortalData(effectiveClientId, year, month)}
          >
            Actualizar
          </Button>
        </Space>
      </div>

      <Alert
        message="Centro de Control Financiero y Fiscal en Tiempo Real"
        description="Este portal muestra en vivo los saldos contables, ingresos, egresos, liquidez en bancos, cuentas por cobrar/pagar y el cumplimiento de obligaciones fiscales del periodo."
        type="info"
        showIcon
      />

      {loading && !execData ? (
        <div className="p-12 text-center">
          <Spin size="large" />
        </div>
      ) : (
        <>
          {/* 1. INDICADORES FINANCIEROS REALES */}
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} lg={6}>
              <Card size="small" className="shadow-sm border-t-4 border-t-emerald-600 h-full">
                <Statistic
                  title={<span className="text-xs font-normal uppercase text-slate-500">Ingresos del Mes</span>}
                  value={formatMXN(kpis.ingresos_mes)}
                  prefix={<RiseOutlined className="text-emerald-600 mr-1" />}
                  valueStyle={{ fontWeight: 400, color: '#047857', fontSize: '1.25rem' }}
                />
                <div className="text-[11px] font-normal text-slate-500 mt-1">
                  Acumulado anual: <span>{formatMXN(kpis.ingresos_acumulados)}</span>
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card size="small" className="shadow-sm border-t-4 border-t-rose-600 h-full">
                <Statistic
                  title={<span className="text-xs font-normal uppercase text-slate-500">Egresos del Mes (Costos + Gastos)</span>}
                  value={formatMXN(kpis.egresos_mes)}
                  prefix={<FallOutlined className="text-rose-600 mr-1" />}
                  valueStyle={{ fontWeight: 400, color: '#be123c', fontSize: '1.25rem' }}
                />
                <div className="text-[11px] font-normal text-slate-500 mt-1">
                  Costos: {formatMXN(kpis.costos_mes)} • Gastos: {formatMXN(kpis.gastos_mes)}
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card size="small" className="shadow-sm border-t-4 border-t-indigo-600 h-full">
                <Statistic
                  title={<span className="text-xs font-normal uppercase text-slate-500">Utilidad Neta Acumulada</span>}
                  value={formatMXN(kpis.utilidad_neta_acumulada)}
                  prefix={<DollarCircleOutlined className="text-indigo-600 mr-1" />}
                  valueStyle={{
                    fontWeight: 400,
                    color: Number(kpis.utilidad_neta_acumulada || 0) >= 0 ? '#1e3a8a' : '#b91c1c',
                    fontSize: '1.25rem',
                  }}
                />
                <div className="text-[11px] font-normal text-slate-500 mt-1">
                  Resultado del mes: <span>{formatMXN(kpis.utilidad_mes)}</span> ({kpis.polizas_mes || 0} pólizas)
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card size="small" className="shadow-sm border-t-4 border-t-sky-600 h-full">
                <Statistic
                  title={<span className="text-xs font-normal uppercase text-slate-500">Saldo en Bancos (102)</span>}
                  value={formatMXN(kpis.saldo_bancos_102)}
                  prefix={<BankOutlined className="text-sky-600 mr-1" />}
                  valueStyle={{ fontWeight: 400, color: '#0369a1', fontSize: '1.25rem' }}
                />
                <div className="text-[11px] font-normal text-slate-500 mt-1">
                  CxC (105): {formatMXN(kpis.cuentas_por_cobrar_105)} • CxP (201): {formatMXN(kpis.cuentas_por_pagar_201)}
                </div>
              </Card>
            </Col>
          </Row>

          {/* 2. GRÁFICA DE 12 MESES Y SEMÁFORO DE OBLIGACIONES */}
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={15}>
              <Card
                size="small"
                className="shadow-sm h-full"
                title={
                  <span className="font-normal text-slate-800 flex items-center gap-2">
                    <BarChartOutlined className="text-blue-600" />
                    Comportamiento Anual (12 Meses): Ingresos vs. Costos y Gastos ({execData?.period?.year})
                  </span>
                }
              >
                {(() => {
                  const maxVal = Math.max(
                    1,
                    ...series.map((s) => Math.max(Number(s.ingresos || 0), Number(s.egresos || 0)))
                  );
                  return (
                    <div className="grid grid-cols-12 gap-2 items-end h-52 pt-4 pb-2 px-2 border-b border-slate-200">
                      {series.map((item) => {
                        const ingH = Math.max(4, Math.round((Number(item.ingresos || 0) / maxVal) * 150));
                        const egrH = Math.max(4, Math.round((Number(item.egresos || 0) / maxVal) * 150));
                        const isCurr = Number(item.month) === Number(execData?.period?.month);
                        return (
                          <Tooltip
                            key={item.month}
                            title={`${item.label}: Ingresos ${formatMXN(item.ingresos)} | Egresos ${formatMXN(
                              item.egresos
                            )} | Utilidad ${formatMXN(item.utilidad)}`}
                          >
                            <div
                              onClick={() => {
                                setMonth(item.month);
                                loadPortalData(effectiveClientId, year || execData?.period?.year, item.month);
                              }}
                              className={`flex flex-col items-center cursor-pointer rounded px-1 py-1 ${
                                isCurr ? 'bg-blue-50 ring-1 ring-blue-400' : 'hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-end justify-center gap-1 h-40 w-full">
                                <div
                                  style={{ height: `${item.ingresos > 0 ? ingH : 3}px` }}
                                  className="w-3 bg-emerald-500 rounded-t"
                                />
                                <div
                                  style={{ height: `${item.egresos > 0 ? egrH : 3}px` }}
                                  className="w-3 bg-rose-500 rounded-t"
                                />
                              </div>
                              <span className="text-[11px] mt-1 font-normal text-slate-600">{item.label}</span>
                            </div>
                          </Tooltip>
                        );
                      })}
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
                    Semáforo de Obligaciones del Mes
                  </span>
                }
              >
                <div className="space-y-3">
                  <div className="p-2.5 rounded border border-slate-200 flex justify-between items-center">
                    <span className="text-xs font-normal text-slate-700">1. Balanza Cuadrada</span>
                    {renderSemaphoreBadge(obligations.balanza_cuadrada)}
                  </div>
                  <div className="p-2.5 rounded border border-slate-200 flex justify-between items-center">
                    <span className="text-xs font-normal text-slate-700">2. IVA Traspasado</span>
                    {renderSemaphoreBadge(obligations.iva_traspasado)}
                  </div>
                  <div className="p-2.5 rounded border border-slate-200 flex justify-between items-center">
                    <span className="text-xs font-normal text-slate-700">3. Depreciación Aplicada</span>
                    {renderSemaphoreBadge(obligations.depreciacion_aplicada)}
                  </div>
                  <div className="p-2.5 rounded border border-slate-200 flex justify-between items-center">
                    <span className="text-xs font-normal text-slate-700">4. DIOT Generada</span>
                    {renderSemaphoreBadge(obligations.diot_generada)}
                  </div>
                </div>
              </Card>
            </Col>
          </Row>

          <Title level={4} className="mb-2 mt-4">
            Consulta de Estados Financieros Oficiales
          </Title>
          <Row gutter={[20, 20]}>
            <Col xs={24} md={8}>
              <Card
                hoverable
                className="text-center shadow-sm"
                onClick={() => navigate(`/trial-balance/${effectiveClientId}`)}
              >
                <BarChartOutlined className="text-4xl text-blue-500 mb-3" />
                <Title level={4}>Balanza de Comprobación</Title>
                <Text type="secondary">Saldos iniciales, cargos, abonos y saldos finales por cuenta</Text>
                <Button type="primary" className="mt-4 w-full">
                  Ver Balanza
                </Button>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card
                hoverable
                className="text-center shadow-sm"
                onClick={() => navigate(`/income-statement/${effectiveClientId}`)}
              >
                <LineChartOutlined className="text-4xl text-green-500 mb-3" />
                <Title level={4}>Estado de Resultados</Title>
                <Text type="secondary">Ingresos, costos, gastos y utilidad neta del periodo y acumulada</Text>
                <Button type="primary" className="mt-4 w-full bg-green-600 hover:bg-green-700">
                  Ver Estado de Resultados
                </Button>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card
                hoverable
                className="text-center shadow-sm"
                onClick={() => navigate(`/balance-sheet/${effectiveClientId}`)}
              >
                <FileTextOutlined className="text-4xl text-purple-500 mb-3" />
                <Title level={4}>Balance General</Title>
                <Text type="secondary">Posición financiera detallada: Activos, Pasivos y Capital</Text>
                <Button type="primary" className="mt-4 w-full bg-purple-600 hover:bg-purple-700">
                  Ver Balance General
                </Button>
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
};

export default ClientPortal;
