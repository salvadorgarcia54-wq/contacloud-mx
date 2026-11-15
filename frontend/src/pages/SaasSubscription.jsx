import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Card,
  Row,
  Col,
  Button,
  Typography,
  Tag,
  Progress,
  Table,
  Switch,
  Modal,
  Form,
  Input,
  Select,
  Space,
  Statistic,
  Alert,
  Radio,
  Checkbox,
  Rate,
  message,
} from 'antd';
import {
  CrownOutlined,
  CheckCircleFilled,
  CloudServerOutlined,
  CreditCardOutlined,
  TeamOutlined,
  FileTextOutlined,
  BankOutlined,
  EditOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  RocketOutlined,
  DownloadOutlined,
  LockOutlined,
  ClockCircleOutlined,
  StopOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import { saasApi, clientsApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useClient } from '../components/Layout';
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

const CANCELLATION_PRIMARY_REASONS = [
  'Precio o presupuesto actual del despacho',
  'Falta de alguna funcionalidad específica que necesito',
  'Curva de aprendizaje o complejidad en el uso diario',
  'Cambio a otro sistema contable o administrativo',
  'Reducción de cartera de clientes o pausa temporal de actividades',
  'Solo me registré para conocer o evaluar la plataforma',
  'Otro motivo',
];

const CANCELLATION_SECONDARY_FACTORS = [
  'Necesito capacitación o acompañamiento adicional para mi equipo',
  'Mi volumen actual de CFDIs o empresas es menor al esperado',
  'Requiero integraciones adicionales con otros sistemas',
  'Velocidad de respuesta o atención en soporte técnico',
  'Preferencia por esquemas de pago distintos',
  'Decisión administrativa de socios o dirección',
];

const ALTERNATIVE_SOLUTIONS = [
  'Otro software contable en la nube',
  'Sistema contable tradicional de escritorio',
  'Hojas de cálculo (Excel) y portal del SAT directamente',
  'Despacho o contador externo',
  'Pausa temporal sin otro sistema por ahora',
  'Aún no lo decido',
];

const LANDING_PLANS_CATALOG = [
  {
    code: 'starter',
    name: 'Iterumx Starter',
    tagline: 'Ideal para contadores independientes y emprendedores',
    badge: 'Inicial',
    monthly_price: 690,
    annual_monthly_equivalent: 550,
    annual_total: 6600,
    max_clients: 10,
    max_users: 3,
    max_cfdis_per_month: 1500,
    highlight: false,
    features: [
      'Hasta 10 Empresas / RFCs activos',
      '3 Usuarios (Titular + 2 Auxiliares)',
      'Hasta 1,500 CFDIs por mes (Emitidos, Recibidos y Nómina)',
      'Cálculo automático de IVA, ISR, IEPS y DIOT',
      'Contabilidad Electrónica SAT (XML Catálogo y Balanza)',
      'Copiloto Iterumbot IA (Asesor SAT 601 y LISR)',
      'Soporte Técnico Estándar',
    ],
  },
  {
    code: 'profesional',
    name: 'Iterumx Profesional',
    tagline: 'Para despachos contables en crecimiento con equipo de auxiliares',
    badge: 'Más Popular',
    monthly_price: 1690,
    annual_monthly_equivalent: 1350,
    annual_total: 16200,
    max_clients: 50,
    max_users: 10,
    max_cfdis_per_month: 15000,
    highlight: true,
    features: [
      'Hasta 50 Empresas / RFCs activos',
      'Hasta 10 Usuarios / Auxiliares Contables',
      'Hasta 15,000 CFDIs por mes con contabilización masiva',
      'Iterumbot IA con Auditoría Automática de Anomalías',
      'Validador Lista Negra SAT 69-B / EFOS',
      'Conciliación Bancaria Automatizada',
      'Papeles de Trabajo en Excel (.xlsx) y PDF Membretado',
      'Contraseñas Temporales de 32 dígitos (UUID)',
    ],
  },
  {
    code: 'empresarial',
    name: 'Iterumx Empresarial',
    tagline: 'Control total de productividad, auditoría y portal de clientes',
    badge: 'Despachos Consolidados',
    monthly_price: 3490,
    annual_monthly_equivalent: 2790,
    annual_total: 33480,
    max_clients: 120,
    max_users: 35,
    max_cfdis_per_month: 100000,
    highlight: false,
    features: [
      'Hasta 120 Empresas / RFCs activos',
      'Hasta 35 Usuarios / Auxiliares con permisos granulares',
      'Hasta 100,000 CFDIs procesados por mes',
      'Centro de Control Ejecutivo y Portal de Clientes en Vivo',
      'Bitácora de Actividades y Analítica de Tiempos por Auxiliar',
      'Respaldos completos (.json) y Restauración en 1 clic',
      'Soporte Prioritario vía WhatsApp y Remoto',
    ],
  },
  {
    code: 'corporativo',
    name: 'Iterumx Corporativo Unlimited',
    tagline: 'Capacidad ilimitada multi-despacho y SLA empresarial 99.9%',
    badge: 'Enterprise',
    monthly_price: 6900,
    annual_monthly_equivalent: 5520,
    annual_total: 66240,
    max_clients: 999,
    max_users: 250,
    max_cfdis_per_month: 999999,
    highlight: false,
    features: [
      'Hasta 999 Empresas / RFCs en la nube',
      'Usuarios y Auxiliares ilimitados (hasta 250)',
      'CFDIs ilimitados y procesamiento de alto volumen',
      'Iterumbot IA Ilimitado + Auditoría Fiscal Continua',
      'Auditoría avanzada, SLA 99.9% y Ejecutivo de Cuenta dedicado',
      'Personalización de marca y reportes corporativos',
    ],
  },
];

const LANDING_PLANS_BY_CODE = Object.fromEntries(
  LANDING_PLANS_CATALOG.map((p) => [p.code, p])
);

const SaasSubscription = () => {
  const { user } = useAuth();
  const { selectedClient, clients: contextClients } = useClient();
  const isAdmin = user?.role === 'admin';

  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [selectedClientDetail, setSelectedClientDetail] = useState(null);
  const [annualBilling, setAnnualBilling] = useState(true);
  const [changingPlan, setChangingPlan] = useState(null);

  // Pasarela de Pago Stripe / SPEI / OXXO / 7-Eleven
  const [stripeModalOpen, setStripeModalOpen] = useState(false);
  const [selectedCheckoutPlan, setSelectedCheckoutPlan] = useState(null);
  const [paymentType, setPaymentType] = useState('card'); // card | spei | cash
  const [cashStore, setCashStore] = useState('OXXO'); // OXXO | 7-Eleven
  const [cashVoucherRef, setCashVoucherRef] = useState('9300148290418274');
  const [processingStripe, setProcessingStripe] = useState(false);
  const [stripeForm] = Form.useForm();

  // Editar perfil del despacho / tenant
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm] = Form.useForm();

  // Recibo modal
  const [receiptInvoice, setReceiptInvoice] = useState(null);

  // Cancelación de Suscripción y Cuestionario de Retroalimentación
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancellingSubscription, setCancellingSubscription] = useState(false);
  const [reactivatingSubscription, setReactivatingSubscription] = useState(false);
  const [confirmCancelChecked, setConfirmCancelChecked] = useState(false);
  const [cancelForm] = Form.useForm();

  const fetchOverview = async () => {
    setLoading(true);
    const activeClientId =
      selectedClient || sessionStorage.getItem('contacloud_active_client_session') || null;
    try {
      const [res, clientRes] = await Promise.all([
        saasApi.getOverview(activeClientId ? { client_id: activeClientId } : {}),
        activeClientId
          ? clientsApi.get(activeClientId).catch(() => null)
          : Promise.resolve(null),
      ]);
      setOverview(res.data);
      if (clientRes?.data) {
        setSelectedClientDetail(clientRes.data);
      } else if (res.data?.active_client) {
        setSelectedClientDetail(res.data.active_client);
      } else {
        setSelectedClientDetail(null);
      }
      const t = res.data?.tenant || {};
      // Si los 14 días de Trial ya vencieron, abrir automáticamente la pasarela de pago
      if (t.trial_expired || t.status === 'past_due') {
        openStripeModal(t.plan_code || 'profesional', res.data?.tenant, res.data?.plans);
      }
    } catch (err) {
      message.error('No se pudo cargar la información de la suscripción.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    fetchOverview();
  }, [selectedClient, isAdmin]);

  const tenant = overview?.tenant || {};
  const activeClient = selectedClientDetail || overview?.active_client || null;
  const stripeConfig = overview?.stripe_config || {};
  const usage = overview?.usage || {};
  const rawPlans = overview?.plans?.length ? overview.plans : LANDING_PLANS_CATALOG;
  const plans = rawPlans.map((p) =>
    LANDING_PLANS_BY_CODE[p.code] ? { ...p, ...LANDING_PLANS_BY_CODE[p.code] } : p
  );
  const invoices = overview?.invoices || [];
  const cancellationFeedbackList = overview?.cancellation_feedback || [];

  const currentPlanObj =
    plans.find((p) => p.code === (tenant.plan_code || 'empresarial')) ||
    LANDING_PLANS_BY_CODE.empresarial;
  const bannerPlanPrice = annualBilling
    ? currentPlanObj.annual_monthly_equivalent
    : currentPlanObj.monthly_price;

  const formatMoney = (val) =>
    new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
    }).format(val || 0);

  const formatPlanPrice = (val) =>
    new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      maximumFractionDigits: 0,
    }).format(val || 0);

  const openStripeModal = (planCode, tOverride = null, plansOverride = null) => {
    const tData = tOverride || tenant;
    const planList = plansOverride || plans;
    const code = planCode || tData.plan_code || 'profesional';
    const foundPlan = planList.find((p) => p.code === code) || {
      code: 'profesional',
      name: 'Iterumx Profesional',
      monthly_price: 1690,
      annual_monthly_equivalent: 1350,
      annual_total: 16200,
    };
    const randomRef = `9300${String(tData.id || 1).padStart(4, '0')}${String(Math.floor(10000000 + Math.random() * 89999999))}`;
    setCashVoucherRef(randomRef);
    setSelectedCheckoutPlan(foundPlan);
    stripeForm.setFieldsValue({
      plan_code: foundPlan.code,
      billing_cycle: annualBilling ? 'annual' : tData.billing_cycle || 'monthly',
      card_holder_name: tData.card_holder_name || user?.full_name || tData.name || '',
      card_number: '',
      card_expiry: '',
      card_cvc: '',
      spei_sender_bank: 'BBVA México',
      spei_tracking_key: `ITX-${String(tData.id || 1).padStart(3, '0')}-${new Date().getMonth() + 1}${new Date().getDate()}`,
      rfc: tData.rfc || '',
      postal_code: tData.postal_code || '',
      tax_regime: tData.tax_regime || undefined,
      cfdi_use: tData.cfdi_use || 'G03 - Gastos en general',
      billing_email: tData.billing_email || user?.email || '',
    });
    setStripeModalOpen(true);
  };

  const handleSelectPlan = (planCode) => {
    if (!isAdmin) {
      message.warning('Solo el Socio / Titular puede modificar el plan de suscripción.');
      return;
    }
    openStripeModal(planCode);
  };

  const handleProcessStripeCheckout = async () => {
    try {
      const values = await stripeForm.validateFields();
      setProcessingStripe(true);
      const res = await saasApi.stripeCheckout({
        ...values,
        payment_type: paymentType,
        cash_store: cashStore,
        cash_voucher_reference: cashVoucherRef,
        plan_code: selectedCheckoutPlan?.code || values.plan_code || tenant.plan_code,
        billing_cycle: annualBilling ? 'annual' : 'monthly',
      });
      message.success(res.data?.message || '¡Pago procesado con éxito!');
      setStripeModalOpen(false);
      await fetchOverview();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.detail || 'No se pudo procesar el pago.');
    } finally {
      setProcessingStripe(false);
    }
  };

  const openProfileModal = () => {
    profileForm.setFieldsValue({
      name: tenant.name,
      rfc: tenant.rfc,
      postal_code: tenant.postal_code,
      tax_regime: tenant.tax_regime || undefined,
      cfdi_use: tenant.cfdi_use || 'G03 - Gastos en general',
      billing_email: tenant.billing_email,
      phone: tenant.phone,
      payment_method: tenant.payment_method,
      auto_renew: tenant.auto_renew !== false,
    });
    setProfileModalOpen(true);
  };

  const handleSaveProfile = async () => {
    try {
      const values = await profileForm.validateFields();
      setSavingProfile(true);
      await saasApi.updateTenantProfile(values);
      message.success('Perfil fiscal y de suscripción del despacho actualizado.');
      setProfileModalOpen(false);
      await fetchOverview();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.detail || 'Error al actualizar el perfil.');
    } finally {
      setSavingProfile(false);
    }
  };

  const openCancelModal = () => {
    setConfirmCancelChecked(false);
    cancelForm.resetFields();
    cancelForm.setFieldsValue({
      primary_reason: undefined,
      secondary_reasons: [],
      satisfaction_score: 4,
      nps_likelihood: 8,
      missing_features: '',
      alternative_solution: 'Aún no lo decido',
      would_return: 'Sí, más adelante',
      comments: '',
    });
    setCancelModalOpen(true);
  };

  const handleCancelSubscription = async () => {
    try {
      const values = await cancelForm.validateFields();
      if (!confirmCancelChecked) {
        message.warning('Por favor marca la casilla de confirmación para cancelar tu suscripción.');
        return;
      }
      setCancellingSubscription(true);
      const res = await saasApi.cancelSubscription(values);
      message.success(
        res.data?.message ||
          'Tu suscripción ha sido cancelada y tu cuestionario de retroalimentación fue registrado.'
      );
      setCancelModalOpen(false);
      await fetchOverview();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.detail || 'No se pudo procesar la cancelación.');
    } finally {
      setCancellingSubscription(false);
    }
  };

  const handleReactivateSubscription = async () => {
    try {
      setReactivatingSubscription(true);
      const res = await saasApi.reactivateSubscription();
      message.success(res.data?.message || '¡Tu suscripción ha sido reactivada!');
      await fetchOverview();
    } catch (err) {
      message.error(err?.response?.data?.detail || 'No se pudo reactivar la suscripción.');
    } finally {
      setReactivatingSubscription(false);
    }
  };

  const cleanStripeText = (val) =>
    String(val || '')
      .replace(/\s*\(Stripe[^)]*\)/gi, '')
      .replace(/Stripe\s*•\s*/gi, '')
      .replace(/Stripe/gi, '')
      .trim();

  const invoiceColumns = [
    {
      title: <span className="font-normal">Folio Factura</span>,
      dataIndex: 'folio',
      key: 'folio',
      width: 150,
      render: (f) => <span className="font-mono font-normal text-xs text-blue-800">{f}</span>,
    },
    {
      title: <span className="font-normal">Fecha</span>,
      dataIndex: 'created_at',
      key: 'created_at',
      width: 145,
      render: (d) => <span className="text-xs font-normal text-slate-600">{d}</span>,
    },
    {
      title: <span className="font-normal">Plan Contratado</span>,
      dataIndex: 'plan_name',
      key: 'plan_name',
      render: (name, r) => (
        <div>
          <div className="font-normal text-xs text-slate-900">{cleanStripeText(name)}</div>
          <div className="text-[11px] font-normal text-slate-500">{r.period_label}</div>
        </div>
      ),
    },
    {
      title: <span className="font-normal">Ciclo</span>,
      dataIndex: 'billing_cycle',
      key: 'billing_cycle',
      width: 130,
      align: 'center',
      render: (c) => <Tag color="geekblue" className="font-normal">{c}</Tag>,
    },
    {
      title: <span className="font-normal">Método de Pago</span>,
      dataIndex: 'payment_method',
      key: 'payment_method',
      width: 210,
      render: (m) => <span className="text-xs font-normal text-slate-700">{cleanStripeText(m)}</span>,
    },
    {
      title: <span className="font-normal">Importe (MXN)</span>,
      dataIndex: 'amount',
      key: 'amount',
      width: 140,
      align: 'right',
      render: (amt) => <span className="font-mono font-normal text-xs">{formatMoney(amt)}</span>,
    },
    {
      title: <span className="font-normal">Estado</span>,
      dataIndex: 'status',
      key: 'status',
      width: 120,
      align: 'center',
      render: (s) => (
        <Tag color="success" icon={<CheckCircleFilled />} className="font-normal">
          {cleanStripeText(s) || 'Pagado'}
        </Tag>
      ),
    },
    {
      title: <span className="font-normal">Comprobante</span>,
      key: 'actions',
      width: 125,
      align: 'center',
      render: (_, r) => (
        <Button
          size="small"
          icon={<DownloadOutlined />}
          onClick={() => setReceiptInvoice(r)}
          className="text-xs font-normal"
        >
          Ver CFDI
        </Button>
      ),
    },
  ];

  if (user && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="p-2 space-y-6 font-normal">
      {/* Encabezado */}
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <IterumxLogo size="md" collapsed />
          <div>
            <Title level={2} className="m-0 flex items-center gap-2 !font-normal" style={{ fontWeight: 400 }}>
              Mi Suscripción y Consumo — Iterumx
            </Title>
            <Text type="secondary" className="text-xs font-normal">
              Administración de tu membresía, cuotas multi-empresa, consumo en la nube y facturación.
            </Text>
          </div>
        </div>

        <Space wrap>
          {isAdmin && (
            <Button
              type="primary"
              icon={<CreditCardOutlined />}
              onClick={() => openStripeModal(tenant.plan_code)}
              style={{ backgroundColor: '#635BFF', borderColor: '#635BFF', fontWeight: 400 }}
            >
              Pasarela de Pago
            </Button>
          )}
          {isAdmin && (
            <Button icon={<EditOutlined />} onClick={openProfileModal} className="font-normal">
              Editar Datos del Despacho
            </Button>
          )}
          {isAdmin && tenant.status !== 'cancelled' && (
            <Button
              danger
              icon={<StopOutlined />}
              onClick={openCancelModal}
              className="font-normal"
              style={{ fontWeight: 400 }}
            >
              Cancelar Suscripción
            </Button>
          )}
          {isAdmin && tenant.status === 'cancelled' && (
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={reactivatingSubscription}
              onClick={handleReactivateSubscription}
              style={{ backgroundColor: '#57A82C', borderColor: '#57A82C', fontWeight: 400 }}
            >
              Reactivar Suscripción
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={fetchOverview} loading={loading} className="font-normal">
            Actualizar
          </Button>
        </Space>
      </div>

      {/* Alerta cuando la suscripción fue cancelada */}
      {tenant.status === 'cancelled' && (
        <Alert
          type="error"
          showIcon
          icon={<StopOutlined />}
          message={
            <span className="font-normal">
              Suscripción Cancelada {tenant.cancelled_at ? `el ${tenant.cancelled_at}` : ''} — La renovación automática se encuentra desactivada.
            </span>
          }
          description={
            <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
              <div className="text-xs font-normal space-y-0.5">
                <div>
                  Tus empresas, catálogo de cuentas, CFDIs y pólizas contables permanecen resguardados de forma segura.
                </div>
                {tenant.cancellation_reason && (
                  <div className="text-slate-600">
                    Motivo registrado en cuestionario: <span>{tenant.cancellation_reason}</span>
                    {tenant.cancellation_comments ? ` — "${tenant.cancellation_comments}"` : ''}
                  </div>
                )}
              </div>
              {isAdmin && (
                <Space>
                  <Button
                    size="small"
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    loading={reactivatingSubscription}
                    onClick={handleReactivateSubscription}
                    style={{ backgroundColor: '#57A82C', borderColor: '#57A82C', fontWeight: 400 }}
                  >
                    Reactivar Mi Suscripción Ahora
                  </Button>
                  <Button
                    size="small"
                    icon={<CreditCardOutlined />}
                    onClick={() => openStripeModal(tenant.plan_code)}
                    style={{ fontWeight: 400 }}
                  >
                    Elegir Otro Plan
                  </Button>
                </Space>
              )}
            </div>
          }
        />
      )}

      {/* Alerta cuando está en Trial de 14 días o cuando vence */}
      {(tenant.status === 'trial' || tenant.status === 'past_due' || tenant.trial_expired) && (
        <Alert
          type={tenant.trial_expired || tenant.status === 'past_due' ? 'error' : 'warning'}
          showIcon
          icon={<ClockCircleOutlined />}
          message={
            <span className="font-normal">
              {tenant.trial_expired || tenant.status === 'past_due'
                ? 'Tu periodo de prueba gratuita de 14 días ha finalizado — Activa tu suscripción para continuar operando.'
                : `Periodo de Prueba Gratuita de 14 días activo (${
                    tenant.trial_days_remaining !== null && tenant.trial_days_remaining !== undefined
                      ? `Quedan ${tenant.trial_days_remaining} días — vence el ${tenant.trial_ends_at}`
                      : `Vence el ${tenant.trial_ends_at || 'próximamente'}`
                  })`}
            </span>
          }
          description={
            <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
              <span className="text-xs font-normal">
                Al terminar los 14 días de prueba, se habilita esta pasarela de pago segura para domiciliar tu plan sin perder ninguna empresa, CFDI ni póliza capturada.
              </span>
              {isAdmin && (
                <Button
                  size="small"
                  type="primary"
                  icon={<CreditCardOutlined />}
                  onClick={() => openStripeModal(tenant.plan_code)}
                  style={{ backgroundColor: '#635BFF', borderColor: '#635BFF', fontWeight: 400 }}
                >
                  Activar Plan Ahora
                </Button>
              )}
            </div>
          }
        />
      )}

      {/* Banner Resumen del Tenant Activo */}
      <Card
        className="shadow-md border-0 text-white rounded-xl overflow-hidden"
        style={{
          background: 'linear-gradient(120deg, #1E2C5E 0%, #0f172a 65%, #1e3a2f 100%)',
        }}
      >
        <Row gutter={[24, 24]} align="middle">
          <Col xs={24} lg={14}>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Tag
                color={
                  tenant.status === 'cancelled'
                    ? 'default'
                    : tenant.status === 'past_due' || tenant.trial_expired
                    ? 'error'
                    : tenant.status === 'trial'
                    ? 'warning'
                    : 'green'
                }
                className="font-normal uppercase m-0"
              >
                {tenant.status === 'cancelled'
                  ? 'SUSCRIPCIÓN CANCELADA'
                  : tenant.status === 'past_due' || tenant.trial_expired
                  ? 'TRIAL VENCIDO — PAGO PENDIENTE'
                  : tenant.status === 'trial'
                  ? `PRUEBA GRATUITA 14D (${tenant.trial_days_remaining ?? 14} DÍAS RESTANTES)`
                  : 'SUSCRIPCIÓN ACTIVA'}
              </Tag>
              <Tag color="geekblue" className="font-mono font-normal m-0">
                ID Organización: #{tenant.id || 1} ({tenant.slug || 'iterumx-principal'})
              </Tag>
              {tenant.stripe_customer_id && (
                <Tag color="purple" className="font-mono font-normal m-0">
                  ID Cliente: {tenant.stripe_customer_id}
                </Tag>
              )}
            </div>
            <h2 className="text-2xl md:text-3xl font-normal text-white m-0">
              {tenant.name || 'Despacho Corporativo Iterumx'}
            </h2>
            <p className="text-slate-300 text-xs md:text-sm font-normal mt-1 mb-0">
              RFC Facturación: <span className="text-white font-mono font-normal">{tenant.rfc || 'S/RFC'}</span>
              {tenant.postal_code ? ` (C.P. ${tenant.postal_code})` : ''} &nbsp;|&nbsp;
              Correo: <span className="text-white font-normal">{tenant.billing_email || 'Sin correo'}</span> &nbsp;|&nbsp;
              Método de Pago: <span className="text-emerald-300 font-normal">{cleanStripeText(tenant.payment_method)}</span>
            </p>
          </Col>

          <Col xs={24} lg={10}>
            <div className="bg-white/10 backdrop-blur rounded-xl p-4 border border-white/20 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-300 font-normal">
                  Plan Actual
                </div>
                <div className="text-xl font-normal text-white flex items-center gap-2 mt-0.5">
                  <CrownOutlined style={{ color: '#6fd638' }} />
                  <span>{currentPlanObj?.name || tenant.plan_name || 'Iterumx Empresarial'}</span>
                </div>
                <div className="text-xs font-normal text-slate-300 mt-1">
                  Próximo corte: <span>{tenant.current_period_end || 'En 30 días'}</span>
                </div>
              </div>

              <div className="text-right">
                <div className="text-2xl font-normal" style={{ color: '#6fd638' }}>
                  {formatPlanPrice(bannerPlanPrice)} + IVA
                </div>
                <div className="text-[11px] font-normal text-slate-300">
                  MXN / mes ({annualBilling ? 'Facturación Anual' : 'Facturación Mensual'})
                </div>
              </div>
            </div>
          </Col>
        </Row>
      </Card>

      {/* Medidores de Consumo de Recursos en Tiempo Real */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" className="shadow-sm h-full border-t-4 border-t-blue-600">
            <Statistic
              title={<span className="text-xs font-normal uppercase text-slate-500">Empresas / RFCs Activos</span>}
              value={usage.active_clients ?? 0}
              suffix={`/ ${usage.max_clients ?? 100}`}
              prefix={<BankOutlined className="text-blue-600 mr-1" />}
              valueStyle={{ fontWeight: 400 }}
            />
            <Progress
              percent={usage.clients_percent || 0}
              size="small"
              strokeColor="#1E2C5E"
              className="mt-2"
            />
            <div className="text-[11px] font-normal text-slate-500 mt-1">
              Capacidad disponible: {(usage.max_clients || 100) - (usage.active_clients || 0)} RFCs
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card size="small" className="shadow-sm h-full border-t-4 border-t-emerald-600">
            <Statistic
              title={<span className="text-xs font-normal uppercase text-slate-500">Usuarios y Auxiliares</span>}
              value={usage.active_users ?? 0}
              suffix={`/ ${usage.max_users ?? 25}`}
              prefix={<TeamOutlined className="text-emerald-600 mr-1" />}
              valueStyle={{ fontWeight: 400 }}
            />
            <Progress
              percent={usage.users_percent || 0}
              size="small"
              strokeColor="#57A82C"
              className="mt-2"
            />
            <div className="text-[11px] font-normal text-slate-500 mt-1">
              Licencias de equipo activas en el despacho
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card size="small" className="shadow-sm h-full border-t-4 border-t-indigo-600">
            <Statistic
              title={<span className="text-xs font-normal uppercase text-slate-500">CFDIs Procesados en Nube</span>}
              value={usage.total_cfdis ?? 0}
              suffix={`/ ${(usage.max_cfdis_per_month || 50000).toLocaleString()}`}
              prefix={<FileTextOutlined className="text-indigo-600 mr-1" />}
              valueStyle={{ fontWeight: 400 }}
            />
            <Progress
              percent={usage.cfdis_percent || 0}
              size="small"
              strokeColor="#4f46e5"
              className="mt-2"
            />
            <div className="text-[11px] font-normal text-slate-500 mt-1">
              Emitidos, Recibidos y Nómina contabilizados
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card size="small" className="shadow-sm h-full border-t-4 border-t-teal-600">
            <Statistic
              title={<span className="text-xs font-normal uppercase text-slate-500">Almacenamiento & Pólizas</span>}
              value={`${usage.storage_mb ?? 12.5} MB`}
              prefix={<CloudServerOutlined className="text-teal-600 mr-1" />}
              valueStyle={{ fontWeight: 400 }}
            />
            <div className="mt-3 text-xs font-normal text-slate-700">
              Total Pólizas: <Tag color="cyan" className="font-normal">{usage.total_journals ?? 0}</Tag>
            </div>
            <div className="text-[11px] font-normal text-slate-500 mt-1">
              Respaldos automáticos cifrados activos
            </div>
          </Card>
        </Col>
      </Row>

      {/* Catálogo de Planes para Upgrade / Cambio de Plan */}
      <Card
        className="shadow-sm"
        title={
          <div className="flex flex-wrap items-center justify-between gap-3 py-1">
            <div>
              <span className="font-normal text-base text-slate-800">
                <RocketOutlined className="mr-2 text-blue-600" />
                Planes y Escalamiento de Iterumx
              </span>
              <div className="text-xs font-normal text-slate-500">
                Cambia o escala tu plan en cualquier momento según el crecimiento de tu cartera de clientes.
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-normal">Facturación Mensual</span>
              <Switch
                checked={annualBilling}
                onChange={setAnnualBilling}
                style={{ backgroundColor: annualBilling ? '#57A82C' : undefined }}
              />
              <span className="text-xs font-normal">Facturación Anual</span>
              <Tag color="success" className="m-0 font-normal">
                Ahorra 20%
              </Tag>
            </div>
          </div>
        }
      >
        <Row gutter={[16, 16]} align="stretch">
          {plans.map((plan) => {
            const isSamePlanCode = plan.code === tenant.plan_code;
            const isCurrent = isSamePlanCode;
            const displayPrice = annualBilling
              ? plan.annual_monthly_equivalent
              : plan.monthly_price;

            return (
              <Col xs={24} md={12} xl={6} key={plan.code}>
                <Card
                  size="small"
                  className={`h-full flex flex-col justify-between rounded-xl ${
                    isSamePlanCode
                      ? 'border-2 border-emerald-600 bg-emerald-50/20 shadow-md'
                      : 'border border-slate-200'
                  }`}
                  bodyStyle={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 18 }}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Tag color={isSamePlanCode ? 'success' : 'blue'} className="font-normal text-[10px]">
                        {isSamePlanCode ? 'PLAN ACTUAL' : plan.badge}
                      </Tag>
                      <span className="text-[11px] font-mono font-normal text-slate-400">
                        Hasta {plan.max_clients} RFCs
                      </span>
                    </div>

                    <div className="text-base font-normal text-slate-900 mt-1">{plan.name}</div>
                    <div className="text-xs font-normal text-slate-500 mt-0.5 min-h-[32px]">{plan.tagline}</div>

                    <div className="my-3 py-3 border-y border-slate-100">
                      <div className="flex items-baseline gap-1 flex-wrap">
                        <span className="text-2xl font-normal text-slate-900">
                          {formatPlanPrice(displayPrice)}
                        </span>
                        <span className="text-xs font-normal text-slate-500">MXN / mes + IVA</span>
                      </div>
                      <div className="text-[11px] font-normal text-slate-500 mt-1">
                        {annualBilling
                          ? `Facturado anualmente (${formatPlanPrice(plan.annual_total)} MXN + IVA / año)`
                          : 'Precios más IVA · Facturación mes a mes sin plazos forzosos'}
                      </div>
                    </div>

                    <div className="space-y-1.5 mb-4">
                      {(plan.features || []).map((f, idx) => (
                        <div key={idx} className="flex items-start gap-1.5 text-xs font-normal text-slate-700">
                          <CheckCircleFilled
                            className="mt-0.5 flex-shrink-0"
                            style={{ color: '#57A82C' }}
                          />
                          <span>{f}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Button
                    type={isSamePlanCode && tenant.status === 'active' ? 'default' : 'primary'}
                    block
                    disabled={(isCurrent && tenant.status === 'active') || !isAdmin}
                    loading={changingPlan === plan.code}
                    onClick={() => handleSelectPlan(plan.code)}
                    style={
                      !isSamePlanCode || tenant.status !== 'active'
                        ? { backgroundColor: '#635BFF', borderColor: '#635BFF', fontWeight: 400 }
                        : { fontWeight: 400 }
                    }
                    className="font-normal mt-auto"
                  >
                    {isCurrent && tenant.status === 'active'
                      ? 'Plan Activo Actual'
                      : isSamePlanCode && tenant.status !== 'active'
                      ? 'Activar Plan'
                      : isSamePlanCode
                      ? `Cambiar a Ciclo ${annualBilling ? 'Anual' : 'Mensual'}`
                      : `Contratar ${plan.name.replace('Iterumx ', '')}`}
                  </Button>
                </Card>
              </Col>
            );
          })}
        </Row>
      </Card>

      {/* Historial de Facturación */}
      <Card
        size="small"
        className="shadow-sm"
        title={
          <span className="font-normal text-slate-800">
            <CreditCardOutlined className="mr-2 text-blue-600" />
            Historial de Pagos y Facturación de tu Suscripción Iterumx ({invoices.length})
          </span>
        }
      >
        <Table
          dataSource={invoices}
          columns={invoiceColumns}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 900 }}
        />
      </Card>

      {/* Sección de Gestión de Renovación y Cancelación de Suscripción */}
      {isAdmin && (
        <Card
          size="small"
          className="shadow-sm border border-slate-200"
          title={
            <span className="font-normal text-slate-800 flex items-center gap-2">
              <MessageOutlined className="text-slate-600" />
              <span>Gestión de Renovación, Baja de Suscripción y Retroalimentación</span>
            </span>
          }
        >
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-2">
            <div className="space-y-1 max-w-3xl">
              <div className="text-sm font-normal text-slate-800">
                {tenant.status === 'cancelled'
                  ? 'Tu suscripción se encuentra cancelada actualmente'
                  : '¿Deseas pausar o cancelar tu suscripción de Iterumx?'}
              </div>
              <div className="text-xs font-normal text-slate-500">
                {tenant.status === 'cancelled'
                  ? `Cancelada el ${tenant.cancelled_at || 'recientemente'}. Puedes reactivar tu membresía en cualquier momento conservando intactas todas tus empresas, CFDIs y pólizas.`
                  : 'En Iterumx no existen plazos forzosos. Si decides cancelar, te pediremos responder un breve cuestionario de retroalimentación para conocer el motivo y seguir mejorando la plataforma.'}
              </div>
            </div>

            <div>
              {tenant.status === 'cancelled' ? (
                <Space wrap>
                  <Button
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    loading={reactivatingSubscription}
                    onClick={handleReactivateSubscription}
                    style={{ backgroundColor: '#57A82C', borderColor: '#57A82C', fontWeight: 400 }}
                  >
                    Reactivar Suscripción
                  </Button>
                  <Button
                    icon={<MessageOutlined />}
                    onClick={openCancelModal}
                    style={{ fontWeight: 400 }}
                  >
                    Actualizar Cuestionario de Retroalimentación
                  </Button>
                </Space>
              ) : (
                <Button
                  danger
                  icon={<StopOutlined />}
                  onClick={openCancelModal}
                  style={{ fontWeight: 400 }}
                >
                  Cancelar Suscripción y Responder Cuestionario
                </Button>
              )}
            </div>
          </div>

          {cancellationFeedbackList.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-100">
              <div className="text-xs font-normal text-slate-500 mb-2">
                Última retroalimentación registrada ({cancellationFeedbackList[0].created_at}):
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs font-normal text-slate-700 space-y-1">
                <div>
                  Motivo principal: <span className="text-slate-900">{cancellationFeedbackList[0].primary_reason}</span>
                </div>
                {cancellationFeedbackList[0].secondary_reasons?.length > 0 && (
                  <div>
                    Factores adicionales: <span>{cancellationFeedbackList[0].secondary_reasons.join(' · ')}</span>
                  </div>
                )}
                <div className="flex flex-wrap gap-4">
                  <span>Satisfacción general: {cancellationFeedbackList[0].satisfaction_score} / 5</span>
                  <span>Probabilidad de retorno / recomendación: {cancellationFeedbackList[0].nps_likelihood} / 10</span>
                  <span>¿Regresaría en el futuro?: {cancellationFeedbackList[0].would_return}</span>
                </div>
                {cancellationFeedbackList[0].missing_features && (
                  <div>
                    Mejora sugerida: <span>{cancellationFeedbackList[0].missing_features}</span>
                  </div>
                )}
                {cancellationFeedbackList[0].comments && (
                  <div>
                    Comentarios: <span>"{cancellationFeedbackList[0].comments}"</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Modal Pasarela de Pago con Tarjeta, SPEI y OXXO / 7-Eleven */}
      <Modal
        title={
          <div className="flex items-center justify-between pr-6 font-normal">
            <div className="flex items-center gap-2">
              <CreditCardOutlined className="text-indigo-600" />
              <span className="font-normal text-slate-900">
                Pasarela de Pago Segura — Iterumx
              </span>
            </div>
            <Tag color={stripeConfig.mode === 'live' ? 'green' : 'purple'} className="font-mono font-normal text-[11px] m-0">
              {stripeConfig.mode === 'live' ? 'MODO PRODUCCIÓN' : 'PASARELA ACTIVA'}
            </Tag>
          </div>
        }
        open={stripeModalOpen}
        onCancel={() => setStripeModalOpen(false)}
        onOk={handleProcessStripeCheckout}
        confirmLoading={processingStripe}
        width={680}
        okText={
          paymentType === 'spei'
            ? 'Confirmar Transferencia SPEI y Activar Plan'
            : paymentType === 'cash'
            ? `Confirmar Ficha de Pago en ${cashStore} y Activar Plan`
            : 'Pagar con Tarjeta y Activar Suscripción'
        }
        okButtonProps={{
          style: { backgroundColor: '#635BFF', borderColor: '#635BFF', fontWeight: 400 },
          icon: <LockOutlined />,
        }}
        cancelText="Cancelar"
      >
        {(() => {
          const activePlan = selectedCheckoutPlan || {
            code: tenant.plan_code || 'profesional',
            name: tenant.plan_name || 'Iterumx Profesional',
            monthly_price: tenant.price_mxn || 1690,
            annual_monthly_equivalent: 1350,
            annual_total: 16200,
          };
          const subtotal = annualBilling
            ? activePlan.annual_total || activePlan.annual_monthly_equivalent * 12
            : activePlan.monthly_price;
          const iva = Math.round(subtotal * 0.16 * 100) / 100;
          const total = Math.round((subtotal + iva) * 100) / 100;
          const directPaymentLink = stripeConfig?.payment_links?.[activePlan.code];
          const speiClabe = stripeConfig?.spei_clabe || '646180157042891042';
          const speiBank = cleanStripeText(stripeConfig?.spei_bank_name || 'STP / BBVA México (SPEI)');
          const speiBeneficiary = stripeConfig?.spei_beneficiary || 'Iterumx S.A. de C.V.';

          return (
            <div className="space-y-4 font-normal">
              {/* Resumen de cargo con IVA */}
              <div className="p-3.5 rounded-xl bg-slate-900 text-white border border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-slate-400 font-normal">
                      Suscripción Seleccionada
                    </div>
                    <div className="text-base font-normal text-white">
                      {activePlan.name} ({annualBilling ? 'Anual -20%' : 'Mensual'})
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-normal text-slate-300">
                      Subtotal: {formatMoney(subtotal)} + IVA (16%): {formatMoney(iva)}
                    </div>
                    <div className="text-xl font-normal" style={{ color: '#6fd638' }}>
                      Total: {formatMoney(total)} MXN
                    </div>
                  </div>
                </div>
                {directPaymentLink && (
                  <div className="mt-3 pt-2.5 border-t border-slate-700 flex items-center justify-between">
                    <span className="text-xs font-normal text-slate-300">
                      ¿Prefieres pagar en la ventana de pago en línea?
                    </span>
                    <Button
                      size="small"
                      href={directPaymentLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ backgroundColor: '#635BFF', color: '#fff', borderColor: '#635BFF', fontWeight: 400 }}
                    >
                      Abrir Enlace de Pago ↗
                    </Button>
                  </div>
                )}
              </div>

              {/* Selector de Método de Pago: Tarjeta | SPEI / Transferencia | Efectivo (OXXO / 7-Eleven) */}
              <div>
                <div className="text-xs font-normal uppercase tracking-wider text-slate-500 mb-2">
                  1. Selecciona tu Forma de Pago
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div
                    onClick={() => setPaymentType('card')}
                    className={`cursor-pointer p-2.5 rounded-lg border text-center transition-all ${
                      paymentType === 'card'
                        ? 'border-2 border-indigo-600 bg-indigo-50/60 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-normal text-xs text-slate-900 flex items-center justify-center gap-1.5">
                      <CreditCardOutlined className="text-indigo-600" />
                      <span>Tarjeta Bancaria</span>
                    </div>
                    <div className="text-[10px] font-normal text-slate-500 mt-0.5">
                      Visa, Mastercard, Amex
                    </div>
                  </div>

                  <div
                    onClick={() => setPaymentType('spei')}
                    className={`cursor-pointer p-2.5 rounded-lg border text-center transition-all ${
                      paymentType === 'spei'
                        ? 'border-2 border-indigo-600 bg-indigo-50/60 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-normal text-xs text-slate-900 flex items-center justify-center gap-1.5">
                      <BankOutlined className="text-emerald-600" />
                      <span>SPEI / Transferencia</span>
                    </div>
                    <div className="text-[10px] font-normal text-slate-500 mt-0.5">
                      CLABE Interbancaria 24/7
                    </div>
                  </div>

                  <div
                    onClick={() => setPaymentType('cash')}
                    className={`cursor-pointer p-2.5 rounded-lg border text-center transition-all ${
                      paymentType === 'cash'
                        ? 'border-2 border-indigo-600 bg-indigo-50/60 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-normal text-xs text-slate-900 flex items-center justify-center gap-1.5">
                      <span className="px-1.5 py-0.2 rounded bg-amber-500 text-white font-normal text-[10px]">
                        OXXO
                      </span>
                      <span>/ 7-Eleven</span>
                    </div>
                    <div className="text-[10px] font-normal text-slate-500 mt-0.5">
                      Pago en Efectivo en Tienda
                    </div>
                  </div>
                </div>
              </div>

              <Form form={stripeForm} layout="vertical">
                {/* MODO 1: TARJETA BANCARIA */}
                {paymentType === 'card' && (
                  <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60">
                    <div className="text-xs font-normal text-slate-700 mb-2">
                      Datos de Tarjeta de Crédito o Débito (Tokenización PCI-DSS)
                    </div>
                    <Form.Item
                      name="card_holder_name"
                      label="Nombre del Titular en la Tarjeta"
                      rules={[{ required: paymentType === 'card', message: 'Ingresa el nombre del titular' }]}
                    >
                      <Input placeholder="Ej. Rodolfo Acuña Landeros" />
                    </Form.Item>

                    <Row gutter={12}>
                      <Col span={12}>
                        <Form.Item
                          name="card_number"
                          label="Número de Tarjeta (Visa / Mastercard / Amex)"
                          rules={[{ required: paymentType === 'card', message: 'Ingresa los 16 dígitos de la tarjeta' }]}
                        >
                          <Input
                            prefix={<CreditCardOutlined className="text-indigo-600" />}
                            placeholder="4242 •••• •••• 4242"
                            maxLength={19}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item
                          name="card_expiry"
                          label="Vencimiento"
                          rules={[{ required: paymentType === 'card', message: 'MM/AA' }]}
                        >
                          <Input placeholder="MM/AA" maxLength={5} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item
                          name="card_cvc"
                          label="CVC / CVV"
                          rules={[{ required: paymentType === 'card', message: 'CVC' }]}
                        >
                          <Input.Password placeholder="123" maxLength={4} />
                        </Form.Item>
                      </Col>
                    </Row>
                  </div>
                )}

                {/* MODO 2: SPEI / TRANSFERENCIA BANCARIA */}
                {paymentType === 'spei' && (
                  <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50/40 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-normal text-emerald-900">
                        Datos Bancarios para Transferencia SPEI Referenciada
                      </span>
                      <Tag color="green" className="m-0 font-normal text-[10px]">
                        ACREDITACIÓN INMEDIATA
                      </Tag>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 p-2.5 bg-white rounded-lg border border-emerald-200 text-xs">
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase font-normal">Banco Receptor</div>
                        <div className="font-normal text-slate-800">{speiBank}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase font-normal">Beneficiario</div>
                        <div className="font-normal text-slate-800">{speiBeneficiary}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase font-normal">CLABE Interbancaria (18 dígitos)</div>
                        <div className="font-mono font-normal text-indigo-900 select-all flex items-center gap-1">
                          <span>{speiClabe}</span>
                          <Button
                            size="small"
                            type="link"
                            className="p-0 h-auto text-[11px] font-normal"
                            onClick={() => {
                              navigator.clipboard?.writeText(speiClabe);
                              message.success('CLABE copiada al portapapeles');
                            }}
                          >
                            Copiar
                          </Button>
                        </div>
                      </div>
                    </div>

                    <Row gutter={12}>
                      <Col span={12}>
                        <Form.Item
                          name="spei_sender_bank"
                          label="Banco desde el que transfieres"
                          rules={[{ required: paymentType === 'spei', message: 'Indica tu banco emisor' }]}
                        >
                          <Select showSearch>
                            <Option value="BBVA México">BBVA México</Option>
                            <Option value="Banorte">Banorte</Option>
                            <Option value="Santander">Santander</Option>
                            <Option value="Citibanamex">Citibanamex</Option>
                            <Option value="HSBC">HSBC</Option>
                            <Option value="Scotiabank">Scotiabank</Option>
                            <Option value="Banco del Bajío">Banco del Bajío</Option>
                            <Option value="Inbursa">Inbursa</Option>
                            <Option value="Banregio / Hey Banco">Banregio / Hey Banco</Option>
                            <Option value="STP / Otro Banco SPEI">STP / Otro Banco SPEI</Option>
                          </Select>
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          name="spei_tracking_key"
                          label="Clave de Rastreo o Referencia SPEI"
                          rules={[{ required: paymentType === 'spei', message: 'Ingresa tu referencia o clave de rastreo' }]}
                        >
                          <Input placeholder="Ej. ITX-005-SPEI o Clave de Rastreo" className="font-mono" />
                        </Form.Item>
                      </Col>
                    </Row>
                  </div>
                )}

                {/* MODO 3: PAGO EN EFECTIVO EN OXXO / 7-ELEVEN */}
                {paymentType === 'cash' && (
                  <div className="p-3.5 rounded-lg border border-amber-300 bg-amber-50/40 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-normal text-slate-800">
                        Ficha de Pago en Efectivo en Tiendas de Conveniencia
                      </span>
                      <Space size={6}>
                        <Button
                          size="small"
                          type={cashStore === 'OXXO' ? 'primary' : 'default'}
                          onClick={() => setCashStore('OXXO')}
                          style={
                            cashStore === 'OXXO'
                              ? { backgroundColor: '#dc2626', borderColor: '#dc2626', fontWeight: 400 }
                              : { fontWeight: 400 }
                          }
                        >
                          OXXO Pay
                        </Button>
                        <Button
                          size="small"
                          type={cashStore === '7-Eleven' ? 'primary' : 'default'}
                          onClick={() => setCashStore('7-Eleven')}
                          style={
                            cashStore === '7-Eleven'
                              ? { backgroundColor: '#15803d', borderColor: '#15803d', fontWeight: 400 }
                              : { fontWeight: 400 }
                          }
                        >
                          7-Eleven
                        </Button>
                      </Space>
                    </div>

                    <div className="p-3 bg-white rounded-xl border border-slate-200 text-center space-y-2">
                      <div className="flex items-center justify-center gap-2">
                        <span
                          className="px-2.5 py-0.5 rounded font-normal text-white text-xs"
                          style={{
                            backgroundColor: cashStore === 'OXXO' ? '#dc2626' : '#15803d',
                          }}
                        >
                          {cashStore}
                        </span>
                        <span className="text-xs font-normal text-slate-700">
                          Línea de Captura para Pago en Caja ({formatMoney(total)} MXN)
                        </span>
                      </div>

                      {/* Código de barras visual */}
                      <div className="py-2 px-4 bg-slate-50 rounded border border-slate-200 inline-block">
                        <div
                          className="font-mono text-lg tracking-[4px] font-normal text-slate-900 select-none"
                          style={{ letterSpacing: '3px' }}
                        >
                          ||| |||| | ||| |||| || | |||| ||| || | ||||
                        </div>
                        <div className="font-mono text-sm font-normal text-indigo-900 tracking-widest select-all mt-1">
                          {cashVoucherRef.replace(/(\d{4})(?=\d)/g, '$1-')}
                        </div>
                      </div>

                      <div className="flex items-center justify-center gap-3 text-[11px] font-normal text-slate-500">
                        <span>Dicta al cajero de {cashStore} los 16 dígitos o muestra el código de barras.</span>
                        <Button
                          size="small"
                          type="link"
                          className="p-0 h-auto text-xs font-normal"
                          onClick={() => window.print()}
                        >
                          Imprimir Ficha
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="text-xs font-normal uppercase tracking-wider text-slate-500 mt-3 mb-2">
                  2. Datos Fiscales para Emisión Automática de Factura CFDI 4.0
                </div>
                <Row gutter={12}>
                  <Col span={8}>
                    <Form.Item
                      name="rfc"
                      label="RFC Receptor"
                      rules={[{ required: true, message: 'Ingresa tu RFC' }]}
                    >
                      <Input style={{ textTransform: 'uppercase' }} maxLength={13} placeholder="XAXX010101000" />
                    </Form.Item>
                  </Col>
                  <Col span={6}>
                    <Form.Item
                      name="postal_code"
                      label="Código Postal"
                      rules={[{ required: true, message: 'C.P.' }]}
                    >
                      <Input maxLength={5} placeholder="06600" />
                    </Form.Item>
                  </Col>
                  <Col span={10}>
                    <Form.Item
                      name="billing_email"
                      label="Correo para Envío de CFDI"
                      rules={[{ required: true, message: 'Ingresa tu correo' }]}
                    >
                      <Input placeholder="facturacion@despacho.mx" />
                    </Form.Item>
                  </Col>
                </Row>

                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item name="tax_regime" label="Régimen Fiscal">
                      <Select placeholder="Seleccione régimen fiscal" showSearch allowClear>
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
              </Form>

              <Alert
                type="info"
                showIcon
                icon={<SafetyCertificateOutlined />}
                message={
                  <span className="text-xs font-normal">
                    Pasarela Multi-Método Segura: Tus pagos con Tarjeta, Transferencia SPEI y Efectivo en OXXO / 7-Eleven están respaldados y cifrados en servidores seguros de AWS.
                  </span>
                }
              />
            </div>
          );
        })()}
      </Modal>

      {/* Modal Editar Datos del Despacho */}
      <Modal
        title={<span className="font-normal">Configuración Fiscal y de Facturación del Despacho</span>}
        open={profileModalOpen}
        onCancel={() => setProfileModalOpen(false)}
        onOk={handleSaveProfile}
        confirmLoading={savingProfile}
        width={600}
        okText="Guardar Cambios"
        cancelText="Cancelar"
      >
        <Form form={profileForm} layout="vertical">
          <Form.Item
            name="name"
            label="Nombre del Despacho u Organización Suscriptora"
            rules={[{ required: true, message: 'Ingresa el nombre del despacho' }]}
          >
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="rfc" label="RFC Receptor">
                <Input style={{ textTransform: 'uppercase' }} maxLength={13} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="postal_code" label="Código Postal">
                <Input maxLength={5} />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="phone" label="Teléfono de Contacto">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="tax_regime" label="Régimen Fiscal">
                <Select placeholder="Seleccione régimen fiscal" showSearch allowClear>
                  {TAX_REGIMES_SAT.map((reg) => (
                    <Option key={reg} value={reg}>
                      {reg}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="cfdi_use" label="Uso del Comprobante">
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
          <Form.Item name="billing_email" label="Correo para Recepción de Facturas (CFDI)">
            <Input />
          </Form.Item>
          <Form.Item name="payment_method" label="Método de Pago Predeterminado">
            <Input placeholder="Ej. Visa Corporativa •••• 4242 o SPEI Referenciado" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal Comprobante CFDI de Suscripción */}
      <Modal
        title={<span className="font-normal">Comprobante Fiscal Digital de Suscripción — Iterumx</span>}
        open={!!receiptInvoice}
        onCancel={() => setReceiptInvoice(null)}
        footer={[
          <Button key="close" type="primary" onClick={() => setReceiptInvoice(null)} className="font-normal">
            Cerrar
          </Button>,
        ]}
      >
        {receiptInvoice && (
          <div className="space-y-3 text-xs font-normal">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between">
              <IterumxLogo size="sm" />
              <Tag color="success" className="font-normal">
                {cleanStripeText(receiptInvoice.status) || 'Pagado'}
              </Tag>
            </div>
            <div className="grid grid-cols-2 gap-2 p-3 border border-slate-200 rounded-lg">
              <div>
                <div className="text-slate-500">Folio de Suscripción:</div>
                <div className="font-mono font-normal text-slate-900">{receiptInvoice.folio}</div>
              </div>
              <div>
                <div className="text-slate-500">Fecha de Emisión:</div>
                <div className="font-normal text-slate-900">{receiptInvoice.created_at}</div>
              </div>
              <div>
                <div className="text-slate-500">Concepto / Plan:</div>
                <div className="font-normal text-slate-900">{cleanStripeText(receiptInvoice.plan_name)}</div>
              </div>
              <div>
                <div className="text-slate-500">Total Pagado:</div>
                <div className="font-mono font-normal text-emerald-700 text-sm">
                  {formatMoney(receiptInvoice.amount)} {receiptInvoice.currency}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-slate-500">UUID Fiscal (Folio SAT):</div>
                <div className="font-mono font-normal text-[11px] text-blue-800 select-all">
                  {receiptInvoice.cfdi_uuid}
                </div>
              </div>
            </div>
            <Alert
              type="success"
              showIcon
              icon={<SafetyCertificateOutlined />}
              message="Factura emitida por Iterumx S.A. de C.V. deducible al 100% como software contable y administrativo."
            />
          </div>
        )}
      </Modal>

      {/* Modal Cancelar Suscripción y Cuestionario de Retroalimentación */}
      <Modal
        title={
          <div className="flex items-center gap-2 font-normal text-slate-900">
            <ExclamationCircleOutlined className="text-rose-600" />
            <span className="font-normal">
              Cancelar Suscripción y Cuestionario de Retroalimentación
            </span>
          </div>
        }
        open={cancelModalOpen}
        onCancel={() => setCancelModalOpen(false)}
        onOk={handleCancelSubscription}
        confirmLoading={cancellingSubscription}
        width={680}
        okText="Enviar Cuestionario y Confirmar Cancelación"
        okButtonProps={{
          danger: true,
          disabled: !confirmCancelChecked,
          style: { fontWeight: 400 },
        }}
        cancelText="Conservar Mi Suscripción"
        cancelButtonProps={{ style: { fontWeight: 400 } }}
      >
        <div className="space-y-4 font-normal text-slate-700 pt-1">
          <Alert
            type="warning"
            showIcon
            message={
              <span className="text-xs font-normal">
                Antes de procesar la baja de tu plan ({tenant.plan_name || 'Iterumx'}), ayúdanos respondiendo este breve cuestionario. Tus empresas, catálogo de cuentas, CFDIs y pólizas se conservarán resguardados por si decides reactivar tu cuenta más adelante.
              </span>
            }
          />

          <Form form={cancelForm} layout="vertical">
            <Form.Item
              name="primary_reason"
              label={
                <span className="font-normal text-slate-800">
                  1. ¿Cuál es el motivo principal por el que deseas cancelar tu suscripción?
                </span>
              }
              rules={[{ required: true, message: 'Selecciona el motivo principal de tu cancelación' }]}
            >
              <Radio.Group className="w-full">
                <div className="grid grid-cols-1 gap-2">
                  {CANCELLATION_PRIMARY_REASONS.map((reason) => (
                    <label
                      key={reason}
                      className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer text-xs font-normal"
                    >
                      <Radio value={reason} className="font-normal">
                        <span className="font-normal text-slate-800">{reason}</span>
                      </Radio>
                    </label>
                  ))}
                </div>
              </Radio.Group>
            </Form.Item>

            <Form.Item
              name="secondary_reasons"
              label={
                <span className="font-normal text-slate-800">
                  2. ¿Qué otros factores influyeron en tu decisión? (Puedes elegir varios)
                </span>
              }
            >
              <Checkbox.Group className="w-full">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {CANCELLATION_SECONDARY_FACTORS.map((factor) => (
                    <div
                      key={factor}
                      className="p-2 rounded-lg border border-slate-200 bg-slate-50/50 text-xs font-normal"
                    >
                      <Checkbox value={factor} className="font-normal text-xs">
                        <span className="font-normal text-slate-700">{factor}</span>
                      </Checkbox>
                    </div>
                  ))}
                </div>
              </Checkbox.Group>
            </Form.Item>

            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item
                  name="satisfaction_score"
                  label={
                    <span className="font-normal text-slate-800">
                      3. Calificación de tu experiencia general en Iterumx (1 a 5)
                    </span>
                  }
                  rules={[{ required: true, message: 'Selecciona una calificación' }]}
                >
                  <Rate />
                </Form.Item>
              </Col>

              <Col xs={24} md={12}>
                <Form.Item
                  name="nps_likelihood"
                  label={
                    <span className="font-normal text-slate-800">
                      4. Del 0 al 10, ¿qué tan probable es que recomiendes o vuelvas a usar Iterumx?
                    </span>
                  }
                >
                  <Select className="font-normal">
                    {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((score) => (
                      <Option key={score} value={score}>
                        {score} / 10{' '}
                        {score >= 9
                          ? '(Muy probable)'
                          : score >= 7
                          ? '(Neutral)'
                          : '(Poco probable)'}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item
                  name="alternative_solution"
                  label={
                    <span className="font-normal text-slate-800">
                      5. ¿Cómo llevarás la operación contable ahora?
                    </span>
                  }
                >
                  <Select placeholder="Selecciona una opción">
                    {ALTERNATIVE_SOLUTIONS.map((alt) => (
                      <Option key={alt} value={alt}>
                        {alt}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>

              <Col xs={24} md={12}>
                <Form.Item
                  name="would_return"
                  label={
                    <span className="font-normal text-slate-800">
                      6. ¿Considerarías regresar a Iterumx en el futuro?
                    </span>
                  }
                >
                  <Radio.Group>
                    <Radio value="Sí, más adelante" className="font-normal">
                      Sí, más adelante
                    </Radio>
                    <Radio value="Tal vez" className="font-normal">
                      Tal vez
                    </Radio>
                    <Radio value="No por ahora" className="font-normal">
                      No por ahora
                    </Radio>
                  </Radio.Group>
                </Form.Item>
              </Col>
            </Row>

            <Form.Item
              name="missing_features"
              label={
                <span className="font-normal text-slate-800">
                  7. ¿Qué mejora, reporte o funcionalidad habría hecho que conservaras tu suscripción?
                </span>
              }
            >
              <Input placeholder="Ej. Integración específica, ajuste en el precio del plan, capacitación..." />
            </Form.Item>

            <Form.Item
              name="comments"
              label={
                <span className="font-normal text-slate-800">
                  8. Comentarios adicionales o sugerencias para nuestro equipo
                </span>
              }
            >
              <Input.TextArea
                rows={3}
                placeholder="Cuéntanos con total confianza cómo podemos mejorar tu experiencia..."
              />
            </Form.Item>
          </Form>

          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200">
            <Checkbox
              checked={confirmCancelChecked}
              onChange={(e) => setConfirmCancelChecked(e.target.checked)}
              className="font-normal text-xs text-rose-900"
            >
              <span className="font-normal text-xs text-rose-900">
                Confirmo que deseo cancelar mi suscripción y desactivar los cargos recurrentes automáticos.
              </span>
            </Checkbox>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default SaasSubscription;
