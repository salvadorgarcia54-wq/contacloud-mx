import React, { useEffect, useState, useMemo } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Table,
  Tag,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Typography,
  Progress,
  Tabs,
  Divider,
  Tooltip,
  message,
} from 'antd';
import {
  CloudServerOutlined,
  DollarCircleOutlined,
  ApartmentOutlined,
  PlusOutlined,
  EditOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  StopOutlined,
  BankOutlined,
  UserOutlined,
  KeyOutlined,
  CreditCardOutlined,
  SettingOutlined,
  SmileOutlined,
  HeartOutlined,
  CustomerServiceOutlined,
  RiseOutlined,
  BarChartOutlined,
  ThunderboltOutlined,
  TrophyOutlined,
  LineChartOutlined,
} from '@ant-design/icons';
import { Navigate } from 'react-router-dom';
import { saasApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import IterumxLogo from '../components/IterumxLogo';

const { Title, Text } = Typography;
const { Option } = Select;

const TAX_REGIMES_SAT = [
  '601 - General de Ley Personas Morales',
  '603 - Personas Morales con Fines no Lucrativos',
  '605 - Sueldos y Salarios e Ingresos Asimilados a Salarios',
  '606 - Arrendamiento',
  '612 - Personas Físicas con Actividades Empresariales y Profesionales',
  '616 - Sin obligaciones fiscales',
  '621 - Incorporación Fiscal',
  '625 - Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas',
  '626 - Régimen Simplificado de Confianza',
];

const CFDI_USES_SAT = [
  'G03 - Gastos en general',
  'G01 - Adquisición de mercancías',
  'I04 - Equipo de computo y accesorios',
  'I08 - Otra maquinaria y equipo',
  'S01 - Sin efectos fiscales',
  'CP01 - Pagos',
];

const SaasAdminConsole = () => {
  const { user } = useAuth();
  const isAdmin = String(user?.username || '').trim().toLowerCase() === 'sgadmin';

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('directory');
  const [kpiTenantFilter, setKpiTenantFilter] = useState('all');
  const [kpiPlanFilter, setKpiPlanFilter] = useState('all');

  // Modal Crear / Editar Tenant
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  // Modal Configuración de Pasarela Stripe
  const [stripeModalOpen, setStripeModalOpen] = useState(false);
  const [savingStripe, setSavingStripe] = useState(false);
  const [stripeForm] = Form.useForm();

  const openStripeConfigModal = async () => {
    try {
      const res = await saasApi.getStripeConfigAdmin();
      stripeForm.setFieldsValue(res.data || { mode: 'test' });
      setStripeModalOpen(true);
    } catch (err) {
      message.error('No se pudo cargar la configuración de Stripe.');
    }
  };

  const handleSaveStripeConfig = async () => {
    try {
      const values = await stripeForm.validateFields();
      setSavingStripe(true);
      await saasApi.updateStripeConfigAdmin(values);
      message.success('Llaves y configuración de Stripe guardadas en la base de datos.');
      setStripeModalOpen(false);
    } catch (err) {
      if (err?.errorFields) return;
      message.error('No se pudo guardar la configuración de Stripe.');
    } finally {
      setSavingStripe(false);
    }
  };

  const fetchTenants = async () => {
    setLoading(true);
    try {
      const res = await saasApi.listTenantsAdmin();
      setData(res.data);
    } catch (err) {
      message.error('No se pudo cargar la consola de organizaciones.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchTenants();
    }
  }, [isAdmin]);

  if (user && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  const metrics = data?.metrics || {};
  const tenants = data?.tenants || [];

  const formatMoney = (val) =>
    new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      maximumFractionDigits: 0,
    }).format(val || 0);

  const openModal = (record = null) => {
    setEditingTenant(record);
    if (record) {
      form.setFieldsValue({
        name: record.name,
        rfc: record.rfc,
        postal_code: record.postal_code,
        tax_regime: record.tax_regime || undefined,
        cfdi_use: record.cfdi_use || 'G03 - Gastos en general',
        billing_email: record.billing_email,
        admin_username: record.admin_username,
        admin_password: record.admin_password,
        plan_code: record.plan_code,
        billing_cycle: record.billing_cycle,
        status: record.status,
        nps_score: record.nps_score ?? 9,
        csat_score: record.csat_score ?? 4.7,
        ces_score: record.ces_score ?? 1.6,
        frt_minutes: record.frt_minutes ?? 15.0,
        fcr_rate: record.fcr_rate ?? 89.0,
        art_hours: record.art_hours ?? 2.2,
        cac_mxn: record.cac_mxn ?? 2100.0,
        tenure_months: record.tenure_months ?? 18,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        cfdi_use: 'G03 - Gastos en general',
        plan_code: 'profesional',
        billing_cycle: 'monthly',
        status: 'active',
        nps_score: 9,
        csat_score: 4.7,
        ces_score: 1.6,
        frt_minutes: 15.0,
        fcr_rate: 90.0,
        art_hours: 2.0,
        cac_mxn: 2100.0,
        tenure_months: 18,
      });
    }
    setModalOpen(true);
  };

  const handleSaveTenant = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editingTenant) {
        await saasApi.updateTenantAdmin(editingTenant.id, values);
        message.success(`Organización "${values.name}" actualizada.`);
      } else {
        await saasApi.createTenantAdmin(values);
        message.success(`Nueva organización "${values.name}" registrada en Iterumx.`);
      }
      setModalOpen(false);
      await fetchTenants();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.detail || 'No se pudo guardar la organización.');
    } finally {
      setSaving(false);
    }
  };

  const filteredTenants = tenants.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (t.name || '').toLowerCase().includes(q) ||
      (t.rfc || '').toLowerCase().includes(q) ||
      (t.slug || '').toLowerCase().includes(q) ||
      (t.admin_username || '').toLowerCase().includes(q) ||
      (t.plan_name || '').toLowerCase().includes(q)
    );
  });

  // Filtrado interactivo para el tablero de KPIs de Comportamiento
  const kpiScopedTenants = useMemo(() => {
    return tenants.filter((t) => {
      if (kpiTenantFilter !== 'all' && String(t.id) !== String(kpiTenantFilter)) return false;
      if (kpiPlanFilter !== 'all' && t.plan_code !== kpiPlanFilter) return false;
      return true;
    });
  }, [tenants, kpiTenantFilter, kpiPlanFilter]);

  // Cálculo dinámico de las 4 dimensiones de KPIs basado en el subconjunto seleccionado
  const kpiStats = useMemo(() => {
    const list = kpiScopedTenants;
    const n = Math.max(1, list.length);

    const promoters = list.filter((t) => Number(t.nps_score ?? 9) >= 9).length;
    const passives = list.filter((t) => {
      const s = Number(t.nps_score ?? 9);
      return s >= 7 && s <= 8;
    }).length;
    const detractors = list.filter((t) => Number(t.nps_score ?? 9) <= 6).length;

    const promotersPct = Math.round((promoters / n) * 1000) / 10;
    const passivesPct = Math.round((passives / n) * 1000) / 10;
    const detractorsPct = Math.round((detractors / n) * 1000) / 10;
    const npsNetScore = Math.round((promotersPct - detractorsPct) * 10) / 10;

    const csatAvg =
      Math.round((list.reduce((acc, t) => acc + Number(t.csat_score ?? 4.6), 0) / n) * 100) / 100;
    const csatSatisfied = list.filter((t) => Number(t.csat_score ?? 4.6) >= 4.0).length;
    const csatSatisfactionPct = Math.round((csatSatisfied / n) * 1000) / 10;

    const cesAvg =
      Math.round((list.reduce((acc, t) => acc + Number(t.ces_score ?? 1.7), 0) / n) * 100) / 100;
    const cesLowEffort = list.filter((t) => Number(t.ces_score ?? 1.7) <= 2.0).length;
    const cesLowEffortPct = Math.round((cesLowEffort / n) * 1000) / 10;

    const retained = list.filter((t) => t.status === 'active' || t.status === 'trial').length;
    const churned = list.filter((t) => t.status === 'cancelled' || t.status === 'past_due').length;
    const crrPct = Math.round((retained / n) * 1000) / 10;
    const churnRatePct = Math.round((100 - crrPct) * 10) / 10;
    const avgTenureMonths =
      Math.round((list.reduce((acc, t) => acc + Number(t.tenure_months ?? 18), 0) / n) * 10) / 10;

    const ltvList = list.map(
      (t) => Number(t.ltv_mxn ?? Number(t.price_mxn || 0) * Number(t.tenure_months || 18))
    );
    const ltvTotal = Math.round(ltvList.reduce((a, b) => a + b, 0));
    const ltvAvg = Math.round(ltvTotal / n);

    const frtAvgMin =
      Math.round((list.reduce((acc, t) => acc + Number(t.frt_minutes ?? 15), 0) / n) * 10) / 10;
    const frtAvgHrs = Math.round((frtAvgMin / 60) * 100) / 100;
    const fcrAvgPct =
      Math.round((list.reduce((acc, t) => acc + Number(t.fcr_rate ?? 88), 0) / n) * 10) / 10;
    const artAvgHrs =
      Math.round((list.reduce((acc, t) => acc + Number(t.art_hours ?? 2.2), 0) / n) * 100) / 100;

    const cacTotal = Math.round(list.reduce((acc, t) => acc + Number(t.cac_mxn ?? 2100), 0));
    const cacAvg = Math.round(cacTotal / n);
    const ticketPromedioMensual = Math.round(
      list.reduce((acc, t) => acc + Number(t.price_mxn || 0), 0) / n
    );
    const ticketPromedioConIva = Math.round(ticketPromedioMensual * 1.16);
    const ltvCacRatio = Math.round((ltvAvg / Math.max(1, cacAvg)) * 10) / 10;
    const paybackMonths = Math.round((cacAvg / Math.max(1, ticketPromedioMensual)) * 10) / 10;

    return {
      totalCount: list.length,
      npsNetScore,
      promoters,
      passives,
      detractors,
      promotersPct,
      passivesPct,
      detractorsPct,
      csatAvg,
      csatSatisfactionPct,
      cesAvg,
      cesLowEffortPct,
      crrPct,
      churnRatePct,
      retained,
      churned,
      avgTenureMonths,
      ltvAvg,
      ltvTotal,
      frtAvgMin,
      frtAvgHrs,
      fcrAvgPct,
      artAvgHrs,
      cacAvg,
      cacTotal,
      ticketPromedioMensual,
      ticketPromedioConIva,
      ltvCacRatio,
      paybackMonths,
    };
  }, [kpiScopedTenants]);

  const comparativeSummaryRows = useMemo(
    () => [
      {
        key: 'nps',
        indicador: 'NPS (Net Promoter Score)',
        evalua: 'Lealtad y recomendación a futuro (Escala 0 al 10: % Promotores [9-10] − % Detractores [0-6])',
        herramienta: 'Encuestas estandarizadas de una pregunta',
        valorActual: `${kpiStats.npsNetScore > 0 ? `+${kpiStats.npsNetScore}` : kpiStats.npsNetScore} pts (${kpiStats.promotersPct}% Promotores)`,
        estado: kpiStats.npsNetScore >= 50 ? 'Excelente' : kpiStats.npsNetScore >= 20 ? 'Bueno' : 'Atención',
        color: kpiStats.npsNetScore >= 50 ? 'success' : kpiStats.npsNetScore >= 20 ? 'processing' : 'warning',
      },
      {
        key: 'csat',
        indicador: 'CSAT (Customer Satisfaction Score)',
        evalua: 'Satisfacción transaccional o inmediata frente a interacción, compra o servicio (Escala 1 al 5)',
        herramienta: 'Encuestas de cierre de atención o de servicio',
        valorActual: `${kpiStats.csatAvg} / 5.0 (${kpiStats.csatSatisfactionPct}% satisfechos)`,
        estado: kpiStats.csatAvg >= 4.5 ? 'Óptimo' : kpiStats.csatAvg >= 4.0 ? 'Estable' : 'Mejorar',
        color: kpiStats.csatAvg >= 4.5 ? 'success' : kpiStats.csatAvg >= 4.0 ? 'processing' : 'warning',
      },
      {
        key: 'ces',
        indicador: 'CES (Customer Effort Score)',
        evalua: 'Nivel de esfuerzo para resolver un problema o completar una acción (Menor esfuerzo = mayor retención)',
        herramienta: 'Encuesta post-interacción de esfuerzo (Escala 1 al 5)',
        valorActual: `${kpiStats.cesAvg} / 5.0 (${kpiStats.cesLowEffortPct}% bajo esfuerzo)`,
        estado: kpiStats.cesAvg <= 2.0 ? 'Fricción Mínima' : 'Esfuerzo Moderado',
        color: kpiStats.cesAvg <= 2.0 ? 'success' : 'processing',
      },
      {
        key: 'churn',
        indicador: 'Churn Rate vs Retención (CRR)',
        evalua: 'Pérdida de clientes en el tiempo vs estabilidad de la cartera activa',
        herramienta: 'Análisis de bases de datos y bajas del CRM / Suscripciones',
        valorActual: `Churn: ${kpiStats.churnRatePct}% | Retención (CRR): ${kpiStats.crrPct}%`,
        estado: kpiStats.churnRatePct <= 5 ? 'Alta Retención' : kpiStats.churnRatePct <= 15 ? 'Controlado' : 'Riesgo de Baja',
        color: kpiStats.churnRatePct <= 5 ? 'success' : kpiStats.churnRatePct <= 15 ? 'processing' : 'error',
      },
      {
        key: 'soporte',
        indicador: 'FRT / FCR / TMR (Operaciones y Soporte)',
        evalua: 'Velocidad de primera respuesta (FRT), resolución en 1er contacto (FCR) y tiempo medio de cierre (TMR/ART)',
        herramienta: 'Mesa de Ayuda y métricas de tickets de soporte',
        valorActual: `FRT: ${kpiStats.frtAvgMin} min | FCR: ${kpiStats.fcrAvgPct}% | TMR: ${kpiStats.artAvgHrs} hrs`,
        estado: kpiStats.fcrAvgPct >= 85 ? 'SLA Cumplido' : 'En Optimización',
        color: kpiStats.fcrAvgPct >= 85 ? 'success' : 'warning',
      },
      {
        key: 'cac_ltv',
        indicador: 'CAC vs LTV y Ticket Promedio',
        evalua: 'Salud financiera, costo de captación y rentabilidad acumulada por cliente en toda su relación comercial',
        herramienta: 'Auditoría financiera y análisis de ventas / facturación',
        valorActual: `CAC: ${formatMoney(kpiStats.cacAvg)} vs LTV: ${formatMoney(kpiStats.ltvAvg)} (${kpiStats.ltvCacRatio}x) • Ticket: ${formatMoney(kpiStats.ticketPromedioMensual)}/mes`,
        estado: kpiStats.ltvCacRatio >= 3 ? `Rentable (${kpiStats.ltvCacRatio}x)` : 'Revisar CAC',
        color: kpiStats.ltvCacRatio >= 3 ? 'success' : 'warning',
      },
    ],
    [kpiStats]
  );

  const tenantKpiColumns = [
    {
      title: 'Tenant / Organización',
      key: 'tenant_name',
      minWidth: 210,
      render: (_, r) => (
        <div>
          <div className="font-bold text-slate-900 text-xs">{r.name}</div>
          <div className="text-[11px] text-slate-500">
            <Tag color="geekblue" className="text-[10px] mr-1">
              {r.plan_name}
            </Tag>
            <span className="font-mono">{r.current_clients || 0} RFCs</span> •{' '}
            <span className="font-mono">{r.total_cfdis || 0} CFDIs</span>
          </div>
        </div>
      ),
    },
    {
      title: '1. CX (NPS / CSAT / CES)',
      key: 'cx_col',
      width: 220,
      render: (_, r) => {
        const nps = Number(r.nps_score ?? 9);
        const catColor = nps >= 9 ? 'success' : nps >= 7 ? 'processing' : 'error';
        const catLabel = nps >= 9 ? 'Promotor' : nps >= 7 ? 'Pasivo' : 'Detractor';
        return (
          <div className="text-xs space-y-0.5">
            <div>
              <span className="font-semibold">NPS:</span>{' '}
              <Tag color={catColor} className="font-mono font-bold text-[11px] m-0">
                {nps}/10 ({catLabel})
              </Tag>
            </div>
            <div className="text-[11px] text-slate-600">
              <strong>CSAT:</strong> {r.csat_score ?? 4.7}/5.0 • <strong>CES:</strong> {r.ces_score ?? 1.6}/5.0
            </div>
          </div>
        );
      },
    },
    {
      title: '2. Retención y LTV',
      key: 'retention_col',
      width: 200,
      render: (_, r) => {
        const retained = r.status === 'active' || r.status === 'trial';
        const ltv = Number(r.ltv_mxn ?? Number(r.price_mxn || 0) * Number(r.tenure_months || 18));
        return (
          <div className="text-xs space-y-0.5">
            <div>
              <Tag color={retained ? 'green' : 'volcano'} className="text-[10px] font-bold m-0">
                {retained ? 'RETENIDO (CRR)' : 'BAJA / CHURN'}
              </Tag>{' '}
              <span className="text-[11px] text-slate-500">({r.tenure_months || 18} meses)</span>
            </div>
            <div className="font-mono font-bold text-emerald-700 text-xs">
              LTV: {formatMoney(ltv)}
            </div>
          </div>
        );
      },
    },
    {
      title: '3. Soporte (FRT / FCR / TMR)',
      key: 'support_col',
      width: 210,
      render: (_, r) => (
        <div className="text-[11px] text-slate-700 space-y-0.5">
          <div>
            <strong>FRT (1ª Resp.):</strong> <span className="font-mono">{r.frt_minutes ?? 15} min</span>
          </div>
          <div>
            <strong>FCR (1er Contacto):</strong>{' '}
            <span className="font-mono font-bold text-blue-700">{r.fcr_rate ?? 88}%</span> •{' '}
            <strong>TMR:</strong> <span className="font-mono">{r.art_hours ?? 2.2} h</span>
          </div>
        </div>
      ),
    },
    {
      title: '4. Adquisición (CAC vs Ticket)',
      key: 'sales_col',
      width: 215,
      render: (_, r) => {
        const ltv = Number(r.ltv_mxn ?? Number(r.price_mxn || 0) * Number(r.tenure_months || 18));
        const cac = Math.max(1, Number(r.cac_mxn ?? 2100));
        const ratio = Math.round((ltv / cac) * 10) / 10;
        return (
          <div className="text-[11px] space-y-0.5">
            <div>
              <strong>CAC:</strong> <span className="font-mono text-slate-800">{formatMoney(cac)}</span> •{' '}
              <strong>Ticket:</strong>{' '}
              <span className="font-mono text-emerald-700 font-bold">{formatMoney(r.price_mxn)}/mes</span>
            </div>
            <div>
              <Tag color={ratio >= 3 ? 'purple' : 'orange'} className="font-mono font-bold text-[10px] m-0">
                Relación LTV/CAC: {ratio}x
              </Tag>
            </div>
          </div>
        );
      },
    },
    {
      title: 'Evaluar KPIs',
      key: 'kpi_action',
      width: 130,
      align: 'center',
      render: (_, r) => (
        <Button size="small" type="primary" ghost icon={<EditOutlined />} onClick={() => openModal(r)}>
          Ajustar KPIs
        </Button>
      ),
    },
  ];

  const columns = [
    {
      title: 'ID / Slug',
      key: 'slug',
      width: 140,
      render: (_, r) => (
        <div>
          <span className="font-mono font-bold text-xs text-blue-900">#{r.id}</span>
          <div className="font-mono text-[11px] text-slate-500">{r.slug}</div>
        </div>
      ),
    },
    {
      title: 'Despacho / Organización Suscriptora (Tenant)',
      key: 'name',
      minWidth: 250,
      render: (_, r) => (
        <div>
          <div className="font-bold text-sm text-slate-900">{r.name}</div>
          <div className="text-xs text-slate-500">
            RFC: <span className="font-mono font-semibold">{r.rfc || 'S/RFC'}</span>
            {r.postal_code ? ` • C.P. ${r.postal_code}` : ''} • {r.billing_email || 'Sin correo'}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {r.tax_regime ? `${r.tax_regime} • ` : ''}
            Uso CFDI: {r.cfdi_use || 'G03 - Gastos en general'}
          </div>
        </div>
      ),
    },
    {
      title: 'Usuario del Tenant',
      dataIndex: 'admin_username',
      key: 'admin_username',
      width: 145,
      render: (val) =>
        val ? (
          <Tag icon={<UserOutlined />} color="blue" className="font-mono font-semibold">
            {val}
          </Tag>
        ) : (
          <span className="text-xs text-slate-400">Sin asignar</span>
        ),
    },
    {
      title: 'Contraseña',
      dataIndex: 'admin_password',
      key: 'admin_password',
      width: 150,
      render: (val) =>
        val ? (
          <Tag icon={<KeyOutlined />} color="default" className="font-mono font-semibold text-slate-700">
            {val}
          </Tag>
        ) : (
          <span className="text-xs text-slate-400">••••••••</span>
        ),
    },
    {
      title: 'Plan Contratado',
      key: 'plan',
      width: 185,
      render: (_, r) => (
        <div>
          <Tag color="geekblue" className="font-bold">
            {r.plan_name}
          </Tag>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Ciclo: {r.billing_cycle === 'annual' ? 'Anual (-20%)' : 'Mensual'}
          </div>
        </div>
      ),
    },
    {
      title: 'Uso de Empresas (RFCs)',
      key: 'clients_usage',
      width: 175,
      render: (_, r) => {
        const pct = Math.min(100, Math.round(((r.current_clients || 0) / Math.max(1, r.max_clients)) * 100));
        return (
          <div>
            <div className="text-xs font-semibold text-slate-800">
              {r.current_clients || 0} / {r.max_clients} RFCs
            </div>
            <Progress percent={pct} size="small" strokeColor="#1E2C5E" />
          </div>
        );
      },
    },
    {
      title: 'Ingreso Mensual (MRR)',
      dataIndex: 'price_mxn',
      key: 'price_mxn',
      width: 145,
      align: 'right',
      render: (val, r) => (
        <div>
          <span className="font-mono font-extrabold text-emerald-700 text-xs">
            {formatMoney(val)} / mes
          </span>
          {r.card_last4 && (
            <div className="text-[10px] font-mono text-indigo-600 mt-0.5">
              {r.card_brand || 'Stripe'} •••• {r.card_last4}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Estado',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      align: 'center',
      render: (st, r) => {
        if (st === 'active') {
          return (
            <Tag color="success" icon={<CheckCircleOutlined />} className="font-semibold">
              ACTIVO
            </Tag>
          );
        }
        if (st === 'trial' && !r.trial_expired) {
          return (
            <Tag color="processing" icon={<ClockCircleOutlined />} className="font-semibold">
              TRIAL 14D {r.trial_days_remaining !== null ? `(${r.trial_days_remaining}d)` : ''}
            </Tag>
          );
        }
        if (st === 'past_due' || r.trial_expired) {
          return (
            <Tag color="warning" icon={<ClockCircleOutlined />} className="font-semibold">
              TRIAL VENCIDO
            </Tag>
          );
        }
        return (
          <Tag color="error" icon={<StopOutlined />} className="font-semibold">
            SUSPENDIDO
          </Tag>
        );
      },
    },
    {
      title: 'Acciones',
      key: 'actions',
      width: 110,
      align: 'center',
      render: (_, r) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => openModal(r)}>
          Gestionar
        </Button>
      ),
    },
  ];

  return (
    <div className="p-2 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <IterumxLogo size="md" collapsed />
          <div>
            <Title level={2} className="m-0 !font-normal" style={{ fontWeight: 400 }}>
              Organizaciones y Planes — Iterumx
            </Title>
            <Text type="secondary" className="text-xs font-normal">
              Panel ejecutivo de organizaciones suscritas, ingresos recurrentes (MRR / ARR) y aprovisionamiento de planes.
            </Text>
          </div>
        </div>

        <Space wrap>
          <Button
            icon={<BarChartOutlined />}
            onClick={() => setActiveTab(activeTab === 'kpis' ? 'directory' : 'kpis')}
            style={{
              backgroundColor: activeTab === 'kpis' ? '#047857' : '#0f766e',
              color: '#fff',
              borderColor: '#0f766e',
              fontWeight: 400,
            }}
          >
            {activeTab === 'kpis'
              ? 'Ver Directorio de Organizaciones'
              : 'Consultar KPIs de Clientes (4 Dimensiones)'}
          </Button>
          <Button
            icon={<CreditCardOutlined />}
            onClick={openStripeConfigModal}
            style={{ backgroundColor: '#635BFF', color: '#fff', borderColor: '#635BFF', fontWeight: 400 }}
          >
            Configurar Pasarela Stripe
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => openModal(null)}
            style={{ backgroundColor: '#1E2C5E', borderColor: '#1E2C5E', fontWeight: 400 }}
          >
            Dar de Alta Nuevo Despacho
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchTenants} loading={loading} className="font-normal">
            Actualizar
          </Button>
        </Space>
      </div>

      {/* KPIs de Negocio Generales */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" className="shadow-sm border-l-4 border-l-emerald-600">
            <Statistic
              title={<span className="text-xs font-normal uppercase text-slate-500">MRR (Ingreso Mensual Recurrente)</span>}
              value={formatMoney(metrics.mrr_mxn || 0)}
              prefix={<DollarCircleOutlined className="text-emerald-600 mr-1" />}
              valueStyle={{ fontWeight: 400, color: '#047857' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" className="shadow-sm border-l-4 border-l-blue-600">
            <Statistic
              title={<span className="text-xs font-normal uppercase text-slate-500">ARR (Ingreso Anual Proyectado)</span>}
              value={formatMoney(metrics.arr_mxn || 0)}
              prefix={<CloudServerOutlined className="text-blue-600 mr-1" />}
              valueStyle={{ fontWeight: 400, color: '#1E2C5E' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" className="shadow-sm border-l-4 border-l-indigo-600">
            <Statistic
              title={<span className="text-xs font-normal uppercase text-slate-500">Despachos / Tenants Suscritos</span>}
              value={metrics.total_tenants || 0}
              suffix={<span className="text-xs font-normal text-slate-400">({metrics.active_tenants || 0} activos)</span>}
              prefix={<ApartmentOutlined className="text-indigo-600 mr-1" />}
              valueStyle={{ fontWeight: 400 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" className="shadow-sm border-l-4 border-l-teal-600">
            <Statistic
              title={<span className="text-xs font-normal uppercase text-slate-500">Total Empresas Contabilizadas</span>}
              value={metrics.total_managed_companies || 0}
              prefix={<BankOutlined className="text-teal-600 mr-1" />}
              valueStyle={{ fontWeight: 400 }}
            />
          </Card>
        </Col>
      </Row>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        type="card"
        items={[
          {
            key: 'directory',
            label: (
              <span
                className="font-semibold text-sm px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-all"
                style={
                  activeTab === 'directory'
                    ? {
                        backgroundColor: '#1E2C5E',
                        color: '#ffffff',
                        boxShadow: '0 2px 6px rgba(30, 44, 94, 0.25)',
                      }
                    : {
                        backgroundColor: '#e2e8f0',
                        color: '#334155',
                      }
                }
              >
                <ApartmentOutlined /> Organizaciones y Planes ({tenants.length})
              </span>
            ),
            children: (
              <Card
                size="small"
                className="shadow-sm"
                title={
                  <div className="flex flex-wrap justify-between items-center gap-3 py-1">
                    <span className="font-bold text-slate-800">
                      Organizaciones / Despachos en Iterumx ({filteredTenants.length})
                    </span>
                    <Input.Search
                      placeholder="Buscar por nombre del despacho, RFC o plan..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      style={{ width: 320 }}
                      allowClear
                    />
                  </div>
                }
              >
                <Table
                  dataSource={filteredTenants}
                  columns={columns}
                  rowKey="id"
                  size="small"
                  loading={loading}
                  pagination={{ pageSize: 10 }}
                  scroll={{ x: 1200 }}
                />
              </Card>
            ),
          },
          {
            key: 'kpis',
            label: (
              <span
                className="font-semibold text-sm px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-all"
                style={
                  activeTab === 'kpis'
                    ? {
                        backgroundColor: '#1E2C5E',
                        color: '#ffffff',
                        boxShadow: '0 2px 6px rgba(30, 44, 94, 0.25)',
                      }
                    : {
                        backgroundColor: '#e2e8f0',
                        color: '#334155',
                      }
                }
              >
                <BarChartOutlined /> Indicadores de Clientes (KPIs y Comportamiento de Tenants)
              </span>
            ),
            children: (
              <div className="space-y-5">
                {/* Barra de Filtros de Consulta de Indicadores */}
                <Card size="small" className="shadow-sm bg-slate-50 border-slate-200">
                  <div className="flex flex-wrap justify-between items-center gap-4">
                    <div>
                      <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                        <LineChartOutlined className="text-teal-700" />
                        Tablero Ejecutivo de KPIs de Clientes (Basado en el Comportamiento de los Tenants)
                      </div>
                      <div className="text-xs text-slate-500">
                        Evalúa satisfacción (CX), retención y lealtad, eficiencia operativa en soporte y rentabilidad financiera (CAC vs LTV).
                      </div>
                    </div>

                    <Space wrap>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-600">Filtrar por Tenant:</span>
                        <Select
                          value={kpiTenantFilter}
                          onChange={setKpiTenantFilter}
                          style={{ width: 260 }}
                          size="small"
                        >
                          <Option value="all">Todos los Tenants ({tenants.length} organizaciones)</Option>
                          {tenants.map((t) => (
                            <Option key={t.id} value={String(t.id)}>
                              #{t.id} — {t.name}
                            </Option>
                          ))}
                        </Select>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-600">Plan:</span>
                        <Select
                          value={kpiPlanFilter}
                          onChange={setKpiPlanFilter}
                          style={{ width: 170 }}
                          size="small"
                        >
                          <Option value="all">Todos los Planes</Option>
                          <Option value="starter">Iterumx Starter</Option>
                          <Option value="profesional">Iterumx Profesional</Option>
                          <Option value="empresarial">Iterumx Empresarial</Option>
                          <Option value="corporativo">Iterumx Corporativo</Option>
                        </Select>
                      </div>

                      {(kpiTenantFilter !== 'all' || kpiPlanFilter !== 'all') && (
                        <Button
                          size="small"
                          onClick={() => {
                            setKpiTenantFilter('all');
                            setKpiPlanFilter('all');
                          }}
                        >
                          Limpiar Filtros
                        </Button>
                      )}
                    </Space>
                  </div>
                </Card>

                {/* DIMENSIÓN 1: Indicadores de Experiencia y Satisfacción (CX) */}
                <Card
                  size="small"
                  className="shadow-sm border-t-4 border-t-indigo-600"
                  title={
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-900 flex items-center gap-2">
                        <SmileOutlined className="text-indigo-600" />
                        1. Indicadores de Experiencia y Satisfacción (CX)
                      </span>
                      <span className="text-xs font-normal text-slate-500">
                        Evalúan cómo perciben los usuarios su interacción con la marca, producto o servicio
                      </span>
                    </div>
                  }
                >
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={8}>
                      <div className="p-3 rounded-lg bg-indigo-50/60 border border-indigo-100 h-full flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-extrabold uppercase text-indigo-900">
                              NPS (Net Promoter Score)
                            </span>
                            <Tag color={kpiStats.npsNetScore >= 50 ? 'success' : 'processing'} className="font-bold m-0">
                              Escala 0 al 10
                            </Tag>
                          </div>
                          <div className="text-2xl font-black text-indigo-900 my-1">
                            {kpiStats.npsNetScore > 0 ? `+${kpiStats.npsNetScore}` : kpiStats.npsNetScore}{' '}
                            <span className="text-xs font-semibold text-slate-500">pts</span>
                          </div>
                          <div className="text-[11px] text-slate-600 mb-2">
                            Mide la lealtad y probabilidad de recomendación restando el % de Detractores (0–6) al de Promotores (9–10).
                          </div>
                        </div>
                        <div className="space-y-1 text-[11px] border-t border-indigo-100 pt-2">
                          <div className="flex justify-between">
                            <span className="text-emerald-700 font-semibold">Promotores (9–10):</span>
                            <span className="font-mono font-bold">
                              {kpiStats.promotersPct}% ({kpiStats.promoters})
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-amber-600 font-semibold">Pasivos (7–8):</span>
                            <span className="font-mono font-bold">
                              {kpiStats.passivesPct}% ({kpiStats.passives})
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-red-600 font-semibold">Detractores (0–6):</span>
                            <span className="font-mono font-bold">
                              {kpiStats.detractorsPct}% ({kpiStats.detractors})
                            </span>
                          </div>
                        </div>
                      </div>
                    </Col>

                    <Col xs={24} md={8}>
                      <div className="p-3 rounded-lg bg-emerald-50/60 border border-emerald-100 h-full flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-extrabold uppercase text-emerald-900">
                              CSAT (Customer Satisfaction Score)
                            </span>
                            <Tag color="success" className="font-bold m-0">
                              Escala 1 al 5
                            </Tag>
                          </div>
                          <div className="text-2xl font-black text-emerald-800 my-1">
                            {kpiStats.csatAvg} <span className="text-xs font-semibold text-slate-500">/ 5.0</span>
                          </div>
                          <div className="text-[11px] text-slate-600 mb-2">
                            Mide el nivel de satisfacción general frente a una interacción, compra o servicio específico en la plataforma.
                          </div>
                        </div>
                        <div className="border-t border-emerald-100 pt-2">
                          <div className="flex justify-between text-[11px] font-semibold text-emerald-900 mb-1">
                            <span>Índice de Satisfacción Positiva (≥ 4.0):</span>
                            <span className="font-mono">{kpiStats.csatSatisfactionPct}%</span>
                          </div>
                          <Progress percent={kpiStats.csatSatisfactionPct} size="small" strokeColor="#059669" />
                        </div>
                      </div>
                    </Col>

                    <Col xs={24} md={8}>
                      <div className="p-3 rounded-lg bg-sky-50/60 border border-sky-100 h-full flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-extrabold uppercase text-sky-900">
                              CES (Customer Effort Score)
                            </span>
                            <Tag color="blue" className="font-bold m-0">
                              Menor Esfuerzo = +Retención
                            </Tag>
                          </div>
                          <div className="text-2xl font-black text-sky-900 my-1">
                            {kpiStats.cesAvg}{' '}
                            <span className="text-xs font-semibold text-slate-500">/ 5.0 (Esfuerzo Bajo)</span>
                          </div>
                          <div className="text-[11px] text-slate-600 mb-2">
                            Evalúa el esfuerzo que realizó el cliente para resolver un problema o completar una acción. Menos esfuerzo se traduce en mayor retención.
                          </div>
                        </div>
                        <div className="border-t border-sky-100 pt-2">
                          <div className="flex justify-between text-[11px] font-semibold text-sky-900 mb-1">
                            <span>Operaciones de Bajo Esfuerzo (≤ 2.0):</span>
                            <span className="font-mono">{kpiStats.cesLowEffortPct}%</span>
                          </div>
                          <Progress percent={kpiStats.cesLowEffortPct} size="small" strokeColor="#0284c7" />
                        </div>
                      </div>
                    </Col>
                  </Row>
                </Card>

                {/* DIMENSIÓN 2: Indicadores de Retención y Lealtad */}
                <Card
                  size="small"
                  className="shadow-sm border-t-4 border-t-emerald-600"
                  title={
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-900 flex items-center gap-2">
                        <HeartOutlined className="text-emerald-600" />
                        2. Indicadores de Retención y Lealtad
                      </span>
                      <span className="text-xs font-normal text-slate-500">
                        Ayudan a entender la estabilidad de la cartera de clientes en el tiempo
                      </span>
                    </div>
                  }
                >
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={8}>
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 h-full flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-extrabold uppercase text-slate-800">
                              Tasa de Retención de Clientes (CRR)
                            </span>
                            <Tag color="green" className="font-bold m-0">
                              Estabilidad
                            </Tag>
                          </div>
                          <div className="text-2xl font-black text-emerald-700 my-1">{kpiStats.crrPct}%</div>
                          <div className="text-[11px] text-slate-600 mb-2">
                            Porcentaje de clientes (tenants) que permanecen activos con la empresa durante el periodo evaluado.
                          </div>
                        </div>
                        <div className="text-[11px] font-semibold text-slate-700 border-t border-slate-200 pt-2 flex justify-between">
                          <span>Tenants Retenidos:</span>
                          <span className="font-mono font-bold text-emerald-700">
                            {kpiStats.retained} de {kpiStats.totalCount} organizaciones
                          </span>
                        </div>
                      </div>
                    </Col>

                    <Col xs={24} md={8}>
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 h-full flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-extrabold uppercase text-slate-800">
                              Tasa de Abandono (Churn Rate)
                            </span>
                            <Tag color={kpiStats.churnRatePct <= 10 ? 'blue' : 'volcano'} className="font-bold m-0">
                              Contraparte de CRR
                            </Tag>
                          </div>
                          <div className="text-2xl font-black text-rose-700 my-1">{kpiStats.churnRatePct}%</div>
                          <div className="text-[11px] text-slate-600 mb-2">
                            Mide el porcentaje de clientes que dejan de consumir o cancelan su suscripción con el negocio (100% − CRR).
                          </div>
                        </div>
                        <div className="text-[11px] font-semibold text-slate-700 border-t border-slate-200 pt-2 flex justify-between">
                          <span>Bajas / Suscripciones Vencidas:</span>
                          <span className="font-mono font-bold text-rose-700">
                            {kpiStats.churned} de {kpiStats.totalCount} organizaciones
                          </span>
                        </div>
                      </div>
                    </Col>

                    <Col xs={24} md={8}>
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 h-full flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-extrabold uppercase text-slate-800">
                              CLV / LTV (Customer Lifetime Value)
                            </span>
                            <Tag color="purple" className="font-bold m-0">
                              Vida Media: {kpiStats.avgTenureMonths} meses
                            </Tag>
                          </div>
                          <div className="text-2xl font-black text-purple-900 my-1">
                            {formatMoney(kpiStats.ltvAvg)}{' '}
                            <span className="text-xs font-normal text-slate-500">/ promedio por tenant</span>
                          </div>
                          <div className="text-[11px] text-slate-600 mb-2">
                            Representa el total de ingresos netos o ventas estimadas que un solo cliente genera a lo largo de toda su relación comercial.
                          </div>
                        </div>
                        <div className="text-[11px] font-semibold text-slate-700 border-t border-slate-200 pt-2 flex justify-between">
                          <span>Valor de Vida Total de Cartera:</span>
                          <span className="font-mono font-bold text-purple-800">
                            {formatMoney(kpiStats.ltvTotal)} MXN
                          </span>
                        </div>
                      </div>
                    </Col>
                  </Row>
                </Card>

                {/* DIMENSIÓN 3: Indicadores de Operaciones y Soporte */}
                <Card
                  size="small"
                  className="shadow-sm border-t-4 border-t-amber-500"
                  title={
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-900 flex items-center gap-2">
                        <CustomerServiceOutlined className="text-amber-600" />
                        3. Indicadores de Operaciones y Soporte
                      </span>
                      <span className="text-xs font-normal text-slate-500">
                        Miden la velocidad y eficacia del equipo de atención al cliente para solucionar incidencias
                      </span>
                    </div>
                  }
                >
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={8}>
                      <div className="p-3 rounded-lg bg-amber-50/50 border border-amber-100 h-full flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-extrabold uppercase text-amber-900">
                              FRT (First Response Time)
                            </span>
                            <Tag color="gold" className="font-bold m-0">
                              Tiempo 1ª Respuesta
                            </Tag>
                          </div>
                          <div className="text-2xl font-black text-amber-900 my-1">
                            {kpiStats.frtAvgMin} min{' '}
                            <span className="text-xs font-semibold text-slate-500">({kpiStats.frtAvgHrs} hrs)</span>
                          </div>
                          <div className="text-[11px] text-slate-600">
                            Mide los minutos u horas que tarda un agente en dar la primera réplica a un caso o ticket abierto por un tenant.
                          </div>
                        </div>
                        <div className="text-[11px] font-semibold text-amber-900 border-t border-amber-100 pt-2 mt-2 flex justify-between">
                          <span>Meta SLA Primera Respuesta:</span>
                          <span className="font-mono">≤ 30 minutos</span>
                        </div>
                      </div>
                    </Col>

                    <Col xs={24} md={8}>
                      <div className="p-3 rounded-lg bg-amber-50/50 border border-amber-100 h-full flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-extrabold uppercase text-amber-900">
                              FCR (First Contact Resolution)
                            </span>
                            <Tag color="green" className="font-bold m-0">
                              1er Contacto
                            </Tag>
                          </div>
                          <div className="text-2xl font-black text-emerald-800 my-1">{kpiStats.fcrAvgPct}%</div>
                          <div className="text-[11px] text-slate-600">
                            Porcentaje de solicitudes que se solucionan de manera definitiva en la primera interacción, sin requerir seguimientos adicionales.
                          </div>
                        </div>
                        <div className="border-t border-amber-100 pt-2 mt-2">
                          <Progress percent={kpiStats.fcrAvgPct} size="small" strokeColor="#d97706" />
                        </div>
                      </div>
                    </Col>

                    <Col xs={24} md={8}>
                      <div className="p-3 rounded-lg bg-amber-50/50 border border-amber-100 h-full flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-extrabold uppercase text-amber-900">
                              TMR / ART (Tiempo Medio de Resolución)
                            </span>
                            <Tag color="blue" className="font-bold m-0">
                              Cierre Total
                            </Tag>
                          </div>
                          <div className="text-2xl font-black text-slate-900 my-1">
                            {kpiStats.artAvgHrs} horas
                          </div>
                          <div className="text-[11px] text-slate-600">
                            Promedio de tiempo total que le toma a la empresa cerrar por completo un ticket de soporte desde que se crea.
                          </div>
                        </div>
                        <div className="text-[11px] font-semibold text-slate-700 border-t border-amber-100 pt-2 mt-2 flex justify-between">
                          <span>Estándar Operativo SLA:</span>
                          <span className="font-mono text-emerald-700 font-bold">≤ 4.0 horas</span>
                        </div>
                      </div>
                    </Col>
                  </Row>
                </Card>

                {/* DIMENSIÓN 4: Indicadores de Adquisición y Ventas */}
                <Card
                  size="small"
                  className="shadow-sm border-t-4 border-t-blue-700"
                  title={
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-900 flex items-center gap-2">
                        <RiseOutlined className="text-blue-700" />
                        4. Indicadores de Adquisición y Ventas
                      </span>
                      <span className="text-xs font-normal text-slate-500">
                        Analizan la eficiencia de la empresa para captar nuevos perfiles de clientes y su rentabilidad inicial
                      </span>
                    </div>
                  }
                >
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={8}>
                      <div className="p-3 rounded-lg bg-blue-50/50 border border-blue-100 h-full flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-extrabold uppercase text-blue-900">
                              CAC (Costo de Adquisición de Clientes)
                            </span>
                            <Tag color="geekblue" className="font-bold m-0">
                              Inversión Comercial
                            </Tag>
                          </div>
                          <div className="text-2xl font-black text-blue-900 my-1">
                            {formatMoney(kpiStats.cacAvg)}{' '}
                            <span className="text-xs font-normal text-slate-500">/ por tenant captado</span>
                          </div>
                          <div className="text-[11px] text-slate-600">
                            Define la inversión económica total (en marketing, ventas y sueldos) necesaria para conseguir que un cliente potencial realice su primera compra.
                          </div>
                        </div>
                        <div className="text-[11px] font-semibold text-slate-700 border-t border-blue-100 pt-2 mt-2 flex justify-between">
                          <span>Inversión Acumulada en Cartera:</span>
                          <span className="font-mono font-bold text-blue-900">{formatMoney(kpiStats.cacTotal)} MXN</span>
                        </div>
                      </div>
                    </Col>

                    <Col xs={24} md={8}>
                      <div className="p-3 rounded-lg bg-blue-50/50 border border-blue-100 h-full flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-extrabold uppercase text-blue-900">
                              Ticket Promedio (ARPU / Transacción)
                            </span>
                            <Tag color="cyan" className="font-bold m-0">
                              Ingresos por Cliente
                            </Tag>
                          </div>
                          <div className="text-2xl font-black text-emerald-700 my-1">
                            {formatMoney(kpiStats.ticketPromedioMensual)}{' '}
                            <span className="text-xs font-semibold text-slate-500">+ IVA / mes</span>
                          </div>
                          <div className="text-[11px] text-slate-600">
                            El valor medio del gasto que realiza un cliente cada vez que efectúa una transacción o pago recurrente de su suscripción.
                          </div>
                        </div>
                        <div className="text-[11px] font-semibold text-slate-700 border-t border-blue-100 pt-2 mt-2 flex justify-between">
                          <span>Ticket Promedio Facturado (IVA incl.):</span>
                          <span className="font-mono font-bold text-emerald-800">
                            {formatMoney(kpiStats.ticketPromedioConIva)} MXN
                          </span>
                        </div>
                      </div>
                    </Col>

                    <Col xs={24} md={8}>
                      <div className="p-3 rounded-lg bg-blue-50/50 border border-blue-100 h-full flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-extrabold uppercase text-blue-900">
                              Rentabilidad: Relación LTV vs CAC
                            </span>
                            <Tag color={kpiStats.ltvCacRatio >= 3 ? 'success' : 'warning'} className="font-bold m-0">
                              Salud Financiera
                            </Tag>
                          </div>
                          <div className="text-2xl font-black text-indigo-900 my-1">
                            {kpiStats.ltvCacRatio}x{' '}
                            <span className="text-xs font-semibold text-slate-500">
                              (Recuperación en {kpiStats.paybackMonths} meses)
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600">
                            Compara el valor de vida del cliente (LTV) contra su costo de adquisición (CAC). Una relación ≥ 3.0x indica alta rentabilidad sostenible.
                          </div>
                        </div>
                        <div className="text-[11px] font-semibold text-slate-700 border-t border-blue-100 pt-2 mt-2 flex justify-between">
                          <span>Retorno Neto por Cliente (LTV − CAC):</span>
                          <span className="font-mono font-bold text-emerald-700">
                            {formatMoney(Math.max(0, kpiStats.ltvAvg - kpiStats.cacAvg))} MXN
                          </span>
                        </div>
                      </div>
                    </Col>
                  </Row>
                </Card>

                {/* RESUMEN COMPARATIVO DE MÉTRICAS CLAVE */}
                <Card
                  size="small"
                  className="shadow-sm"
                  title={
                    <span className="font-bold text-slate-900 flex items-center gap-2">
                      <TrophyOutlined className="text-amber-500" />
                      Resumen Comparativo de Métricas Clave
                    </span>
                  }
                >
                  <Table
                    dataSource={comparativeSummaryRows}
                    rowKey="key"
                    size="small"
                    pagination={false}
                    columns={[
                      {
                        title: 'Indicador',
                        dataIndex: 'indicador',
                        key: 'indicador',
                        width: 240,
                        render: (val) => <span className="font-bold text-slate-900 text-xs">{val}</span>,
                      },
                      {
                        title: '¿Qué evalúa principalmente?',
                        dataIndex: 'evalua',
                        key: 'evalua',
                        render: (val) => <span className="text-xs text-slate-700">{val}</span>,
                      },
                      {
                        title: 'Herramienta de medición común',
                        dataIndex: 'herramienta',
                        key: 'herramienta',
                        width: 260,
                        render: (val) => <span className="text-xs text-slate-500">{val}</span>,
                      },
                      {
                        title: 'Resultado Actual (Tenants)',
                        dataIndex: 'valorActual',
                        key: 'valorActual',
                        width: 260,
                        render: (val) => <span className="font-mono font-bold text-xs text-blue-900">{val}</span>,
                      },
                      {
                        title: 'Diagnóstico',
                        dataIndex: 'estado',
                        key: 'estado',
                        width: 140,
                        align: 'center',
                        render: (val, r) => (
                          <Tag color={r.color} className="font-bold m-0">
                            {val}
                          </Tag>
                        ),
                      },
                    ]}
                  />
                </Card>

                {/* DESGLOSE DE COMPORTAMIENTO INDIVIDUAL POR TENANT */}
                <Card
                  size="small"
                  className="shadow-sm"
                  title={
                    <div className="flex flex-wrap justify-between items-center gap-2">
                      <span className="font-bold text-slate-900">
                        Matriz de Comportamiento e Indicadores por Tenant ({kpiScopedTenants.length})
                      </span>
                      <span className="text-xs font-normal text-slate-500">
                        Haz clic en &quot;Ajustar KPIs&quot; en cualquier organización para actualizar sus encuestas CX, tiempos de soporte o CAC
                      </span>
                    </div>
                  }
                >
                  <Table
                    dataSource={kpiScopedTenants}
                    columns={tenantKpiColumns}
                    rowKey="id"
                    size="small"
                    loading={loading}
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: 1100 }}
                  />
                </Card>
              </div>
            ),
          },
        ]}
      />

      <Modal
        title={
          editingTenant
            ? `Gestionar Suscripción — ${editingTenant.name}`
            : 'Aprovisionar Nuevo Despacho / Organización'
        }
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSaveTenant}
        confirmLoading={saving}
        width={640}
        okText="Guardar"
        cancelText="Cancelar"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="Nombre del Despacho u Organización"
            rules={[{ required: true, message: 'Ingresa el nombre de la organización' }]}
          >
            <Input placeholder="Ej. Despacho Fiscal del Centro S.C." />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="rfc" label="RFC">
                <Input style={{ textTransform: 'uppercase' }} maxLength={13} placeholder="XAXX010101000" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="postal_code" label="Código Postal">
                <Input maxLength={5} placeholder="Ej. 06600" />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="billing_email" label="Correo de Facturación">
                <Input placeholder="admin@despacho.mx" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="tax_regime" label="Régimen Fiscal">
                <Select placeholder="Seleccione régimen fiscal SAT" allowClear showSearch>
                  {TAX_REGIMES_SAT.map((reg) => (
                    <Option key={reg} value={reg}>
                      {reg}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="cfdi_use"
                label="Uso del Comprobante"
                initialValue="G03 - Gastos en general"
              >
                <Select showSearch>
                  {CFDI_USES_SAT.map((use) => (
                    <Option key={use} value={use}>
                      {use}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="admin_username" label="Usuario del Tenant">
                <Input prefix={<UserOutlined className="text-slate-400" />} placeholder="Ej. usuario_despacho" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="admin_password" label="Contraseña del Tenant">
                <Input.Password prefix={<KeyOutlined className="text-slate-400" />} placeholder="Contraseña de acceso" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="plan_code" label="Plan Asignado" rules={[{ required: true }]}>
                <Select>
                  <Option value="starter">Iterumx Starter (10 RFCs)</Option>
                  <Option value="profesional">Iterumx Profesional (50 RFCs)</Option>
                  <Option value="empresarial">Iterumx Empresarial (120 RFCs)</Option>
                  <Option value="corporativo">Iterumx Corporativo (999 RFCs)</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="billing_cycle" label="Ciclo de Cobro">
                <Select>
                  <Option value="monthly">Mensual</Option>
                  <Option value="annual">Anual (-20%)</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="status" label="Estado del Tenant">
            <Select>
              <Option value="active">Activo (Suscripción al corriente)</Option>
              <Option value="trial">Trial (Prueba gratuita 14 días)</Option>
              <Option value="past_due">Trial Vencido / Pago Pendiente</Option>
              <Option value="cancelled">Suspendido / Cancelado</Option>
            </Select>
          </Form.Item>

          <Divider className="my-3 text-xs font-bold text-slate-600">
            Indicadores de Comportamiento del Tenant (CX, Retención, Soporte y Adquisición)
          </Divider>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="nps_score" label="NPS (Escala 0 a 10)">
                <InputNumber min={0} max={10} step={1} className="w-full" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="csat_score" label="CSAT (Escala 1 a 5)">
                <InputNumber min={1} max={5} step={0.1} className="w-full" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="ces_score" label="CES Esfuerzo (1 a 5)">
                <InputNumber min={1} max={5} step={0.1} className="w-full" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="frt_minutes" label="FRT 1ª Resp. (Minutos)">
                <InputNumber min={1} max={1440} step={1} className="w-full" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="fcr_rate" label="FCR 1er Contacto (%)">
                <InputNumber min={0} max={100} step={1} className="w-full" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="art_hours" label="TMR / ART Cierre (Hrs)">
                <InputNumber min={0.1} max={240} step={0.1} className="w-full" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="cac_mxn" label="CAC — Costo de Adquisición (MXN)">
                <InputNumber min={0} step={100} className="w-full" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="tenure_months" label="Vida Estimada / Relación (Meses para LTV)">
                <InputNumber min={1} max={120} step={1} className="w-full" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Modal Configuración de Pasarela Stripe (Exclusivo Super Admin) */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center justify-center px-2.5 py-0.5 rounded font-extrabold text-white text-xs"
              style={{ backgroundColor: '#635BFF' }}
            >
              stripe
            </span>
            <span className="font-bold text-slate-900">
              Configuración de Pasarela de Pago Stripe — Iterumx
            </span>
          </div>
        }
        open={stripeModalOpen}
        onCancel={() => setStripeModalOpen(false)}
        onOk={handleSaveStripeConfig}
        confirmLoading={savingStripe}
        width={640}
        okText="Guardar Configuración Stripe"
        okButtonProps={{ style: { backgroundColor: '#635BFF', borderColor: '#635BFF', fontWeight: 700 } }}
        cancelText="Cancelar"
      >
        <Form form={stripeForm} layout="vertical">
          <Form.Item name="mode" label="Modo de Operación de Stripe">
            <Select>
              <Option value="test">Modo Pruebas (Sandbox / Test Keys pk_test_...)</Option>
              <Option value="live">Modo Producción (Cobros Reales / Live Keys pk_live_...)</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="publishable_key"
            label="Stripe Publishable Key (Llave Pública)"
          >
            <Input className="font-mono text-xs" placeholder="pk_live_51... o pk_test_51..." />
          </Form.Item>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="secret_key"
                label="Stripe Secret Key (Llave Secreta)"
              >
                <Input.Password className="font-mono text-xs" placeholder="sk_live_51... o sk_test_51..." />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="webhook_secret"
                label="Webhook Signing Secret"
              >
                <Input.Password className="font-mono text-xs" placeholder="whsec_..." />
              </Form.Item>
            </Col>
          </Row>

          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mt-2 mb-2">
            Datos Bancarios para Cobros SPEI / Transferencia
          </div>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="spei_bank_name" label="Banco Receptor SPEI">
                <Input placeholder="Ej. STP / BBVA México" className="text-xs" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="spei_clabe" label="CLABE Interbancaria (18 dígitos)">
                <Input maxLength={18} placeholder="646180157042891042" className="font-mono text-xs" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="spei_beneficiary" label="Beneficiario">
                <Input placeholder="Iterumx S.A. de C.V." className="text-xs" />
              </Form.Item>
            </Col>
          </Row>

          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mt-2 mb-2">
            Payment Links de Stripe por Plan (Opcional — URLs directas de Checkout)
          </div>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="payment_link_starter" label="Link Plan Starter ($690 + IVA)">
                <Input placeholder="https://buy.stripe.com/..." className="text-xs" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="payment_link_profesional" label="Link Plan Profesional ($1,690 + IVA)">
                <Input placeholder="https://buy.stripe.com/..." className="text-xs" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="payment_link_empresarial" label="Link Plan Empresarial ($3,490 + IVA)">
                <Input placeholder="https://buy.stripe.com/..." className="text-xs" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="payment_link_corporativo" label="Link Plan Corporativo ($6,900 + IVA)">
                <Input placeholder="https://buy.stripe.com/..." className="text-xs" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
};

export default SaasAdminConsole;
