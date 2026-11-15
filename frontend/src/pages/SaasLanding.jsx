import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, Row, Col, Tag, Switch, Typography, Input, Modal, Collapse, message } from 'antd';
import {
  CheckCircleFilled,
  RocketOutlined,
  SafetyCertificateOutlined,
  CloudServerOutlined,
  FileDoneOutlined,
  BankOutlined,
  CalculatorOutlined,
  TeamOutlined,
  LoginOutlined,
  ArrowRightOutlined,
  ThunderboltFilled,
  PictureOutlined,
  UploadOutlined,
  DeleteOutlined,
  RobotOutlined,
  BarChartOutlined,
  CreditCardOutlined,
  QuestionCircleOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import IterumxLogo from '../components/IterumxLogo';
import { saasApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text, Paragraph } = Typography;

const FALLBACK_PLANS = [
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

const FEATURE_BLOCKS = [
  {
    icon: <RobotOutlined className="text-2xl text-indigo-600" />,
    title: 'Iterumbot: Copiloto Contable y Fiscal con IA',
    desc: 'Pregunta en lenguaje natural por la utilidad acumulada, proveedores con PPD pendientes o IVA del mes; detecta saldos contrarios a su naturaleza y consulta cuentas SAT 601 y topes LISR.',
  },
  {
    icon: <BarChartOutlined className="text-2xl text-blue-600" />,
    title: 'Centro de Control Ejecutivo en Tiempo Real',
    desc: 'Monitorea al instante Ingresos vs. Egresos, Utilidad Neta, Bancos (102), Cuentas por Cobrar (105), Cuentas por Pagar (201), gráfica de 12 meses y Semáforo de Obligaciones.',
  },
  {
    icon: <FileDoneOutlined className="text-2xl text-sky-600" />,
    title: 'Contabilización Automática CFDI 4.0 y Nómina',
    desc: 'Carga masiva de XML emitidos, recibidos, complementos de pago (REP) y recibos de nómina con mapeo inteligente de cuentas SAT por RFC y clave de producto.',
  },
  {
    icon: <CalculatorOutlined className="text-2xl text-emerald-600" />,
    title: 'Impuestos Federales, DIOT y Contabilidad Electrónica',
    desc: 'Determinación mensual de IVA, Conciliación de IVA Acreditable, ISR, IEPS, depreciación de inversiones, carga batch DIOT (.txt) y XML del Anexo 24.',
  },
  {
    icon: <SafetyCertificateOutlined className="text-2xl text-purple-600" />,
    title: 'Validador EFOS 69-B y Seguridad UUID',
    desc: 'Monitoreo continuo de proveedores contra listas negras del SAT (Art. 69-B CFF) y autorización de operaciones críticas mediante contraseñas temporales de 32 dígitos.',
  },
  {
    icon: <TeamOutlined className="text-2xl text-teal-600" />,
    title: 'Multi-Empresa, Auxiliares y Portal de Clientes',
    desc: 'Asigna carteras de clientes por auxiliar, mide tiempos efectivos en la bitácora y brinda a cada empresario acceso a su Portal Ejecutivo en tiempo real.',
  },
];

const ITERUMBOT_DEMO_CONVERSATIONS = [
  {
    key: 'utilidad',
    question: '¿Cuál es la utilidad acumulada de este cliente en 2026?',
    badge: 'Consulta Financiera en Vivo',
    answerTitle: 'Resumen Financiero y Fiscal en Vivo — Cliente Activo Seleccionado',
    bullets: [
      'Utilidad Neta Acumulada (2026): $358,986.50 MXN',
      'Ingresos Acumulados (2026): $1,886,437.86 MXN | Egresos Acumulados: $1,527,451.36 MXN',
      'Saldo en Bancos (102): $828,336.45 MXN | Cuentas por Cobrar (105): $866,722.30 MXN',
      'Cuentas por Pagar (201): $1,284,243.32 MXN | CFDIs sin contabilizar: 2 CFDI(s)',
    ],
  },
  {
    key: 'ppd',
    question: '¿Qué proveedores tienen facturas PPD pendientes de complemento de pago?',
    badge: 'Control Fiscal de REP / PPD',
    answerTitle: 'Facturas PPD Pendientes de Complemento de Pago (REP)',
    bullets: [
      'Total de CFDIs PPD sin complemento relacionado: 14 comprobante(s) por $284,590.00 MXN',
      '1. DISTRIBUIDORA INDUSTRIAL DEL NORTE SA DE CV (DIN180412AA1) — 6 CFDI(s) PPD por $142,800.00 MXN',
      '2. SERVICIOS LOGISTICOS DEL BAJIO SC (SLB200915BB4) — 5 CFDI(s) PPD por $96,450.00 MXN',
      '3. TECNOLOGIA Y REDES EMPRESARIALES SA DE CV (TRE190201CC8) — 3 CFDI(s) PPD por $45,340.00 MXN',
    ],
  },
  {
    key: 'iva',
    question: '¿Cuánto IVA a cargo o a favor trae en octubre?',
    badge: 'Cálculo de Impuestos',
    answerTitle: 'Determinación de IVA en Octubre 2026 — Cruce de Cuentas 208-01 vs 118-01',
    bullets: [
      'IVA Trasladado Cobrado (208-01): $30,303.04 MXN',
      '(-) IVA Acreditable Pagado (118-01): $26,840.18 MXN',
      '(-) Retenciones de IVA del periodo: $1,120.00 MXN',
      'Resultado del Periodo (Octubre 2026): IVA A CARGO del periodo por $2,342.86 MXN',
    ],
  },
  {
    key: 'auditoria',
    question: 'Ejecutar auditoría automática de saldos contrarios a su naturaleza y CFDIs sin póliza',
    badge: 'Auditoría Automática IA',
    answerTitle: 'Auditoría Automática de Anomalías con IA — Octubre 2026',
    bullets: [
      'Saldos contrarios a su naturaleza: 1 cuenta detectada → 105-01-004 Clientes Nacionales (-$4,250.00 MXN: cobro registrado sin factura origen).',
      'CFDIs cargados sin póliza contable en el mes: 2 CFDI(s) recibidos pendientes de contabilizar por $9,308.26 MXN.',
      'Validación de partida doble en Balanza de Comprobación: Cuadrada (Cargos = Abonos en 193 pólizas).',
    ],
  },
  {
    key: 'sat601',
    question: '¿A qué cuenta 601 mando consumos en restaurantes, viáticos y automóviles?',
    badge: 'Asesor SAT 601 y LISR / LIVA',
    answerTitle: 'Asesoría de Código Agrupador SAT (601-xx-xxx) y Topes LISR / LIVA',
    bullets: [
      'Consumos en Restaurantes (Art. 28 fracc. XX LISR): 8.5% deducible en cuenta 601-50-000 (Atención a clientes) pagando con tarjeta; el 91.5% restante va a 601-83-000 (Gastos no deducibles).',
      'Viáticos y Gastos de Viaje (Art. 28 fracc. V LISR): Cuenta 601-49-000. Alimentación hasta $750/día nacional y $1,500/día extranjero (>50 km del establecimiento).',
      'Automóviles (Art. 36 fracc. II y 28 XIII LISR): Tope deducible de $175,000 MXN (combustión) o $250,000 MXN (eléctricos/híbridos); renta diaria hasta $200 o $285 MXN en cuenta 601-46-000.',
    ],
  },
];

const FAQ_ITEMS = [
  {
    key: '1',
    label: '¿Cómo funciona la prueba gratuita de 14 días?',
    children:
      'Al crear tu cuenta obtienes acceso inmediato durante 14 días a todos los módulos de Iterumx (carga de CFDI 4.0, pólizas, estados financieros, impuestos e Iterumbot IA) sin cargo inicial. Al finalizar tu periodo de prueba, puedes activar tu plan conservando intactas todas tus empresas, pólizas y CFDIs.',
  },
  {
    key: '2',
    label: '¿Qué métodos de pago aceptan para activar mi suscripción?',
    children:
      'Contamos con pasarela de pago integrada que acepta Tarjetas de Crédito y Débito (Visa, Mastercard y American Express), Transferencia Interbancaria SPEI referenciada 24/7 y pago en efectivo en tiendas OXXO y 7-Eleven, con emisión automática de tu factura CFDI 4.0 deducible.',
  },
  {
    key: '3',
    label: '¿Qué puede hacer Iterumbot IA por mi despacho contable?',
    children:
      'Iterumbot es tu Copiloto Contable y Fiscal integrado en toda la plataforma. Responde preguntas en lenguaje natural sobre el cliente activo (utilidad acumulada, proveedores con facturas PPD sin complemento de pago, determinación de IVA), audita automáticamente saldos contrarios a su naturaleza y CFDIs sin póliza, y asesora sobre el Código Agrupador SAT (601-xx-xxx) y topes LISR/LIVA.',
  },
  {
    key: '4',
    label: '¿Puedo dar acceso a mis auxiliares contables y a mis clientes?',
    children:
      'Sí. Puedes crear cuentas para tus auxiliares asignándoles únicamente las empresas de su cartera y supervisar sus tiempos en la Bitácora de Actividades. Además, cada cliente puede ingresar a su propio Portal Ejecutivo para consultar sus indicadores y estados financieros en tiempo real.',
  },
  {
    key: '5',
    label: '¿Dónde se resguarda la información contable y fiscal de mis clientes?',
    children:
      'Toda la base de datos y los archivos XML se alojan en servidores seguros de Amazon Web Services (AWS) con cifrado SSL/TLS, aislamiento estricto por despacho y respaldos descargables en cualquier momento.',
  },
];

const SaasLanding = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEditLandingImage = Boolean(
    user &&
      ['admin', 'sgadmin', 'superadmin'].includes(String(user.username || '').trim().toLowerCase())
  );
  const [plans, setPlans] = useState(FALLBACK_PLANS);
  const [annualBilling, setAnnualBilling] = useState(true);
  const [selectedBotPrompt, setSelectedBotPrompt] = useState(ITERUMBOT_DEMO_CONVERSATIONS[0]);

  const fileInputRef = useRef(null);
  const [demoImage, setDemoImage] = useState({
    mode: 'none',
    url: '',
    title: 'Vista del Programa — Interfaz de Iterumx',
  });
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    saasApi
      .getPlans()
      .then((res) => {
        if (res.data?.plans?.length) {
          const fallbackByCode = Object.fromEntries(FALLBACK_PLANS.map((p) => [p.code, p]));
          const merged = res.data.plans.map((p) =>
            fallbackByCode[p.code] ? { ...p, ...fallbackByCode[p.code] } : p
          );
          setPlans(merged);
        }
      })
      .catch(() => {});

    saasApi
      .getDemoVideoInfo()
      .then((res) => {
        if (res.data && res.data.mode && res.data.mode !== 'none' && res.data.url) {
          setDemoImage({
            mode: 'image',
            url: `${res.data.url}?t=${Date.now()}`,
            title: res.data.title || 'Vista del Programa — Interfaz de Iterumx',
          });
          return;
        }
        const savedLocal = localStorage.getItem('iterumx_demo_image');
        if (savedLocal) {
          try {
            const parsed = JSON.parse(savedLocal);
            if (parsed?.url) setDemoImage(parsed);
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {
        const savedLocal = localStorage.getItem('iterumx_demo_image');
        if (savedLocal) {
          try {
            const parsed = JSON.parse(savedLocal);
            if (parsed?.url) setDemoImage(parsed);
          } catch {
            // ignore
          }
        }
      });
  }, []);

  const handleSelectImageFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (!file.type.startsWith('image/')) {
      message.error('Selecciona un archivo de imagen válido (.png, .jpg, .jpeg o .webp).');
      return;
    }

    setUploadingImage(true);

    // Convertir a DataURL para respaldo inmediato en navegador
    const readAsDataUrl = (f) =>
      new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(URL.createObjectURL(f));
        reader.readAsDataURL(f);
      });

    const dataUrl = await readAsDataUrl(file);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', 'Vista del Programa — Interfaz de Iterumx');

      const res = await saasApi.saveDemoVideo(formData);
      const updated = {
        mode: 'image',
        url: res.data?.url ? `${res.data.url}?t=${Date.now()}` : dataUrl,
        title: 'Vista del Programa — Interfaz de Iterumx',
      };
      setDemoImage(updated);
      try {
        localStorage.setItem(
          'iterumx_demo_image',
          JSON.stringify({ mode: 'image', url: dataUrl, title: updated.title })
        );
      } catch {
        // ignore quota errors
      }
      message.success('Imagen del programa cargada correctamente.');
    } catch {
      const fallback = {
        mode: 'image',
        url: dataUrl,
        title: 'Vista del Programa — Interfaz de Iterumx',
      };
      setDemoImage(fallback);
      try {
        localStorage.setItem('iterumx_demo_image', JSON.stringify(fallback));
      } catch {
        // ignore quota errors
      }
      message.success('Imagen del programa cargada correctamente.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleRemoveImage = async () => {
    try {
      await saasApi.deleteDemoVideo();
    } catch {
      // ignore
    }
    localStorage.removeItem('iterumx_demo_image');
    localStorage.removeItem('iterumx_demo_video');
    setDemoImage({
      mode: 'none',
      url: '',
      title: 'Vista del Programa — Interfaz de Iterumx',
    });
    message.info('Imagen del programa eliminada.');
  };

  const formatMoney = (val) =>
    new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      maximumFractionDigits: 0,
    }).format(val || 0);

  const scrollToSection = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Barra de Navegación Principal */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-2.5 min-h-[84px] flex items-center justify-between gap-4">
          <div className="cursor-pointer flex-shrink-0" onClick={() => navigate('/landing')}>
            <IterumxLogo size="lg" showSubtitle subtitle="PLATAFORMA CONTABLE Y FISCAL CLOUD" />
          </div>

          <div className="hidden lg:flex items-center gap-1">
            <Button
              type="text"
              className="text-slate-700"
              onClick={() => scrollToSection('modulos-iterumx')}
            >
              Módulos
            </Button>
            <Button
              type="text"
              icon={<RobotOutlined className="text-indigo-600" />}
              className="text-slate-700"
              onClick={() => scrollToSection('iterumbot-ia')}
            >
              Iterumbot IA
            </Button>
            <Button
              type="text"
              className="text-slate-700"
              onClick={() => scrollToSection('centro-ejecutivo')}
            >
              Centro Ejecutivo
            </Button>
            <Button
              type="text"
              icon={<PictureOutlined style={{ color: '#57A82C' }} />}
              className="text-slate-700"
              onClick={() => scrollToSection('video-demo-iterumx')}
            >
              Vista del Programa
            </Button>
            <Button
              type="text"
              className="text-slate-700"
              onClick={() => scrollToSection('planes-saas')}
            >
              Planes y Precios
            </Button>
            <Button
              type="text"
              className="text-slate-700"
              onClick={() => scrollToSection('faq-iterumx')}
            >
              Preguntas Frecuentes
            </Button>
          </div>

          <div className="flex items-center gap-2.5">
            <Button
              icon={<LoginOutlined />}
              onClick={() => navigate('/login')}
              className="border-slate-300"
            >
              Iniciar Sesión
            </Button>
            <Button
              type="primary"
              icon={<RocketOutlined />}
              onClick={() => navigate('/register?plan=profesional')}
              style={{ backgroundColor: '#1E2C5E', borderColor: '#1E2C5E' }}
            >
              Crear Cuenta Gratis
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section
        className="py-16 md:py-24 px-6 text-white relative overflow-hidden"
        style={{
          backgroundColor: '#0a1938',
        }}
      >
        <img
          src="/api/assets/landing-hero-bg"
          alt=""
          aria-hidden="true"
          onError={(e) => {
            if (!e.currentTarget.src.endsWith('/hero-binary-bg.jpg')) {
              e.currentTarget.src = '/hero-binary-bg.jpg';
            }
          }}
          className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none select-none"
          style={{
            opacity: 0.72,
            filter: 'contrast(1.06) saturate(1.05)',
          }}
        />

        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at center, rgba(10, 24, 61, 0.52) 0%, rgba(11, 23, 54, 0.72) 65%, rgba(8, 16, 38, 0.86) 100%)',
          }}
        />

        <div className="max-w-6xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-950/45 backdrop-blur-sm border border-white/25 text-xs tracking-wide uppercase mb-6">
            <ThunderboltFilled style={{ color: '#6fd638' }} />
            <span>Plataforma Contable, Fiscal e Inteligencia Artificial con Iterumbot</span>
          </div>

          <h1
            className="text-4xl md:text-6xl font-light tracking-wide text-white leading-tight mb-6"
            style={{
              fontWeight: 300,
              textShadow: '0 2px 18px rgba(4, 12, 32, 0.65)',
            }}
          >
            Tu Despacho Contable y Fiscal en la Nube con{' '}
            <span style={{ color: '#6fd638', fontWeight: 300 }}>Iterumx</span>
          </h1>

          <p
            className="text-lg md:text-xl text-slate-100 max-w-3xl mx-auto font-light mb-10"
            style={{
              fontWeight: 300,
              textShadow: '0 1px 12px rgba(4, 12, 32, 0.6)',
            }}
          >
            Automatiza la contabilización de CFDI 4.0 y Nómina, calcula IVA, ISR, IEPS y DIOT al instante,
            audita anomalías con <strong>Iterumbot IA</strong> y entrega un Centro de Control Financiero en tiempo real a tus clientes.
          </p>

          <div className="flex flex-wrap justify-center gap-4">
            <Button
              type="primary"
              size="large"
              icon={<RocketOutlined />}
              onClick={() => navigate('/register?plan=profesional')}
              style={{
                backgroundColor: '#57A82C',
                borderColor: '#57A82C',
                height: 50,
                paddingInline: 32,
                fontSize: 16,
              }}
              className="shadow-lg"
            >
              Probar 14 Días Gratis
            </Button>
            <Button
              size="large"
              icon={<RobotOutlined />}
              onClick={() => scrollToSection('iterumbot-ia')}
              style={{
                height: 50,
                paddingInline: 26,
                fontSize: 16,
                backgroundColor: 'rgba(79, 70, 229, 0.55)',
                color: '#fff',
                borderColor: 'rgba(255,255,255,0.45)',
              }}
              className="backdrop-blur-sm hover:bg-indigo-600/70"
            >
              Conocer Iterumbot IA
            </Button>
            <Button
              size="large"
              onClick={() => navigate('/login')}
              style={{
                height: 50,
                paddingInline: 28,
                fontSize: 16,
                backgroundColor: 'rgba(15, 23, 42, 0.45)',
                color: '#fff',
                borderColor: 'rgba(255,255,255,0.45)',
              }}
              className="backdrop-blur-sm hover:bg-white/20"
            >
              Entrar al Sistema <ArrowRightOutlined />
            </Button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-14 pt-10 border-t border-white/20 max-w-4xl mx-auto">
            <div>
              <div className="text-3xl font-light text-white" style={{ fontWeight: 300 }}>100%</div>
              <div className="text-xs text-slate-200 uppercase tracking-wider mt-1">Compatible SAT Anexo 24</div>
            </div>
            <div>
              <div className="text-3xl font-light" style={{ color: '#6fd638', fontWeight: 300 }}>Iterumbot IA</div>
              <div className="text-xs text-slate-200 uppercase tracking-wider mt-1">Copiloto Contable y Fiscal 24/7</div>
            </div>
            <div>
              <div className="text-3xl font-light text-white" style={{ fontWeight: 300 }}>CFDI 4.0</div>
              <div className="text-xs text-slate-200 uppercase tracking-wider mt-1">Emitidos, Recibidos, REP y Nómina</div>
            </div>
            <div>
              <div className="text-3xl font-light" style={{ color: '#6fd638', fontWeight: 300 }}>Multi-RFC</div>
              <div className="text-xs text-slate-200 uppercase tracking-wider mt-1">Hasta 999 Empresas en AWS Cloud</div>
            </div>
          </div>
        </div>
      </section>

      {/* Sección 1: Módulos de la Plataforma */}
      <section id="modulos-iterumx" className="py-16 px-6 max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <Tag color="blue" className="uppercase tracking-wider px-3 py-1 mb-2">
            Arquitectura Integral en la Nube
          </Tag>
          <Title level={2} className="m-0 !font-normal" style={{ fontWeight: 400 }}>
            Todo lo que tu despacho contable necesita en una sola plataforma
          </Title>
          <Paragraph className="text-slate-600 mt-2 max-w-2xl mx-auto">
            Iterumx unifica contabilidad electrónica, impuestos federales, validación 69-B, control de auxiliares e inteligencia artificial.
          </Paragraph>
        </div>

        <Row gutter={[24, 24]}>
          {FEATURE_BLOCKS.map((item, idx) => (
            <Col xs={24} md={12} lg={8} key={idx}>
              <Card className="h-full shadow-sm hover:shadow-md transition-shadow border-slate-200 rounded-xl">
                <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mb-4">
                  {item.icon}
                </div>
                <Title level={4} className="mb-2 !font-normal" style={{ fontWeight: 400 }}>
                  {item.title}
                </Title>
                <Text className="text-slate-600 text-sm leading-relaxed">{item.desc}</Text>
              </Card>
            </Col>
          ))}
        </Row>
      </section>

      {/* Sección 2: Iterumbot — Copiloto Contable y Fiscal con Inteligencia Artificial */}
      <section
        id="iterumbot-ia"
        className="py-16 px-6 text-white"
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1E2C5E 55%, #1e1b4b 100%)',
        }}
      >
        <div className="max-w-7xl mx-auto">
          <Row gutter={[32, 32]} align="middle">
            <Col xs={24} lg={11}>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-200 text-xs uppercase tracking-wider mb-4">
                <RobotOutlined />
                <span>Inteligencia Artificial Contable y Fiscal</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-light text-white leading-tight mb-4" style={{ fontWeight: 300 }}>
                Conoce a <span style={{ color: '#6fd638' }}>Iterumbot</span>: Tu Copiloto Contable y Fiscal en toda la pantalla
              </h2>
              <p className="text-slate-300 text-sm md:text-base leading-relaxed mb-6">
                Disponible mediante un botón flotante en cualquier módulo del sistema, <strong>Iterumbot</strong> analiza en vivo las pólizas, balanza y CFDIs del cliente activo para responderte al instante:
              </p>

              <div className="space-y-4 mb-6">
                <div className="p-3.5 rounded-xl bg-white/5 border border-white/10">
                  <div className="text-sm text-emerald-300 mb-1">
                    1. Consultas en lenguaje natural sobre el cliente activo
                  </div>
                  <div className="text-xs text-slate-300">
                    Pregunta por la utilidad acumulada del ejercicio, proveedores con facturas PPD pendientes de complemento de pago o el cálculo de IVA a cargo o a favor del mes.
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-white/5 border border-white/10">
                  <div className="text-sm text-amber-300 mb-1">
                    2. Auditoría automática de anomalías con IA
                  </div>
                  <div className="text-xs text-slate-300">
                    Detecta automáticamente saldos contrarios a su naturaleza (bancos o caja en negativo, clientes en negativo, IVA pendiente negativo) y CFDIs cargados que aún no tienen póliza contable.
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-white/5 border border-white/10">
                  <div className="text-sm text-sky-300 mb-1">
                    3. Asesoría de Código Agrupador SAT y LISR / LIVA
                  </div>
                  <div className="text-xs text-slate-300">
                    Sugiere a qué cuenta contable <code className="text-white">601-xx-xxx</code> enviar un gasto específico y explica los topes legales de deducibilidad (automóviles, viáticos, consumos en restaurantes, combustibles y honorarios).
                  </div>
                </div>
              </div>
            </Col>

            {/* Simulador Interactivo de Iterumbot en la Landing */}
            <Col xs={24} lg={13}>
              <div className="rounded-2xl bg-white text-slate-900 shadow-2xl border border-slate-200 overflow-hidden">
                <div
                  className="px-5 py-3.5 text-white flex items-center justify-between"
                  style={{
                    background: 'linear-gradient(90deg, #1E2C5E 0%, #4f46e5 100%)',
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center text-base">
                      <RobotOutlined />
                    </span>
                    <div>
                      <div className="text-sm leading-none">Iterumbot — Demostración Interactiva</div>
                      <div className="text-[11px] text-indigo-200 mt-0.5">
                        Haz clic en una pregunta para ver la respuesta en tiempo real
                      </div>
                    </div>
                  </div>
                  <Tag color="green" className="m-0 text-[10px]">
                    EN VIVO
                  </Tag>
                </div>

                <div className="p-5 space-y-4">
                  <div>
                    <div className="text-xs text-slate-500 mb-2 flex items-center gap-1">
                      <BulbOutlined className="text-amber-500" /> Selecciona una consulta de ejemplo:
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {ITERUMBOT_DEMO_CONVERSATIONS.map((item) => {
                        const active = selectedBotPrompt.key === item.key;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => setSelectedBotPrompt(item)}
                            className={`text-left text-xs px-3 py-1.5 rounded-full border transition-all cursor-pointer ${
                              active
                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                : 'bg-slate-50 hover:bg-indigo-50 text-slate-700 border-slate-200'
                            }`}
                          >
                            {item.question}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Burbuja del usuario */}
                  <div className="flex justify-end">
                    <div className="bg-indigo-600 text-white text-xs px-4 py-2.5 rounded-2xl max-w-[85%]">
                      {selectedBotPrompt.question}
                    </div>
                  </div>

                  {/* Burbuja de respuesta de Iterumbot */}
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
                      <span className="text-xs text-indigo-950">{selectedBotPrompt.answerTitle}</span>
                      <Tag color="geekblue" className="m-0 text-[10px]">
                        {selectedBotPrompt.badge}
                      </Tag>
                    </div>
                    <div className="space-y-1.5 pt-1">
                      {selectedBotPrompt.bullets.map((b, i) => (
                        <div key={i} className="text-xs text-slate-700 flex items-start gap-2">
                          <CheckCircleOutlined className="text-emerald-600 mt-0.5 flex-shrink-0" />
                          <span>{b}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-slate-500">
                      Incluido en todos los planes de Iterumx.
                    </span>
                    <Button
                      type="primary"
                      size="small"
                      icon={<RocketOutlined />}
                      onClick={() => navigate('/register?plan=profesional')}
                      style={{ backgroundColor: '#1E2C5E', borderColor: '#1E2C5E' }}
                    >
                      Probar Iterumbot Gratis
                    </Button>
                  </div>
                </div>
              </div>
            </Col>
          </Row>
        </div>
      </section>

      {/* Sección 3: Vista Previa del Centro de Control Financiero y Fiscal en Tiempo Real */}
      <section id="centro-ejecutivo" className="py-16 px-6 bg-slate-50 border-t border-slate-200">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-10">
            <Tag color="cyan" className="uppercase tracking-wider px-3 py-1 mb-2">
              Datos 100% en Tiempo Real
            </Tag>
            <Title level={2} className="m-0 !font-normal" style={{ fontWeight: 400 }}>
              Centro de Control Ejecutivo y Portal del Cliente
            </Title>
            <Paragraph className="text-slate-600 mt-2 max-w-2xl mx-auto">
              Visualiza al instante la salud financiera y fiscal del cliente seleccionado sin exportar hojas de cálculo manuales.
            </Paragraph>
          </div>

          <div className="p-5 md:p-6 rounded-2xl bg-white border border-slate-200 shadow-md space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div className="text-sm text-slate-800 flex items-center gap-2">
                <BarChartOutlined className="text-blue-700" />
                <span>Centro de Control Financiero y Fiscal en Tiempo Real — Vista Ejecutiva del Cliente</span>
              </div>
              <Tag color="green" className="m-0">
                Sincronizado con Pólizas, Balanza y CFDIs
              </Tag>
            </div>

            <Row gutter={[14, 14]}>
              <Col xs={24} sm={12} lg={6}>
                <div className="p-3.5 rounded-xl border border-slate-200 border-t-4 border-t-emerald-600 bg-white">
                  <div className="text-xs uppercase text-slate-500">Ingresos del Mes</div>
                  <div className="text-xl text-emerald-700 mt-1">$189,394.00</div>
                  <div className="text-[11px] text-slate-500 mt-1">Acumulado Anual: $1,886,437.86</div>
                </div>
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <div className="p-3.5 rounded-xl border border-slate-200 border-t-4 border-t-rose-600 bg-white">
                  <div className="text-xs uppercase text-slate-500">Egresos del Mes (Costos + Gastos)</div>
                  <div className="text-xl text-rose-700 mt-1">$189,011.49</div>
                  <div className="text-[11px] text-slate-500 mt-1">Costos y gastos contabilizados</div>
                </div>
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <div className="p-3.5 rounded-xl border border-slate-200 border-t-4 border-t-indigo-600 bg-white">
                  <div className="text-xs uppercase text-slate-500">Utilidad Neta Acumulada</div>
                  <div className="text-xl text-indigo-900 mt-1">$358,986.50</div>
                  <div className="text-[11px] text-slate-500 mt-1">Cálculo automático desde cuentas 4xx-7xx</div>
                </div>
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <div className="p-3.5 rounded-xl border border-slate-200 border-t-4 border-t-sky-600 bg-white">
                  <div className="text-xs uppercase text-slate-500">Saldo en Bancos (Cuenta 102)</div>
                  <div className="text-xl text-sky-700 mt-1">$828,336.45</div>
                  <div className="text-[11px] text-slate-500 mt-1">CxC (105): $866,722.30 • CxP (201): $1,284,243.32</div>
                </div>
              </Col>
            </Row>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                <span>1. Balanza Cuadrada</span>
                <Tag color="success" className="m-0">Cuadrada</Tag>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                <span>2. Traspaso Mensual IVA</span>
                <Tag color="success" className="m-0">118 vs 208</Tag>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                <span>3. Depreciación Fiscal</span>
                <Tag color="success" className="m-0">INPC al día</Tag>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                <span>4. DIOT Batch SAT</span>
                <Tag color="success" className="m-0">Lista para TXT</Tag>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Sección 4: Imagen del Programa con Fondo Blanco */}
      <section id="video-demo-iterumx" className="pt-14 pb-6 px-6 bg-white border-t border-slate-200">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-8">
            <Tag color="blue" className="uppercase tracking-wider px-3 py-1 mb-2">
              Vista General del Sistema
            </Tag>
            <Title level={2} className="m-0 !font-normal" style={{ fontWeight: 400 }}>
              Conoce la interfaz de Iterumx
            </Title>
            <Paragraph className="text-slate-500 mt-2 max-w-2xl mx-auto">
              Descubre lo rápido que es contabilizar CFDI 4.0, calcular impuestos y generar estados financieros.
            </Paragraph>
          </div>

          {canEditLandingImage && (
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={handleSelectImageFile}
            />
          )}

          <div className="rounded-2xl overflow-hidden border border-slate-800 bg-[#0b1536] shadow-2xl">
            <div className="px-5 py-3.5 bg-[#0f1c45] border-b border-white/10 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-400 inline-block" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                </div>
                <span className="text-xs md:text-sm text-slate-200 ml-2">
                  {demoImage.title || 'Vista del Programa — Interfaz de Iterumx'}
                </span>
              </div>

              {canEditLandingImage && (
                <div className="flex items-center gap-2">
                  <Button
                    size="small"
                    icon={<UploadOutlined />}
                    loading={uploadingImage}
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      borderColor: 'rgba(255,255,255,0.25)',
                      color: '#fff',
                    }}
                    className="text-xs"
                  >
                    {demoImage.url ? 'Cambiar Imagen' : 'Subir Imagen'}
                  </Button>
                  {demoImage.url && (
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={handleRemoveImage}
                      className="text-xs"
                    >
                      Quitar
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div
              className="relative w-full"
              style={{
                aspectRatio: '16 / 9',
                background: 'radial-gradient(circle at center, #1E2C5E 0%, #0b1536 70%, #070e24 100%)',
              }}
            >
              {demoImage.url ? (
                <img
                  src={demoImage.url}
                  alt={demoImage.title || 'Vista del Programa Iterumx'}
                  className="w-full h-full object-contain bg-[#0b1536]"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center relative">
                  <div
                    onClick={canEditLandingImage ? () => fileInputRef.current?.click() : undefined}
                    className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg mb-4 bg-white/10 border-2 border-[#6fd638] ${
                      canEditLandingImage ? 'cursor-pointer transition-transform hover:scale-105' : ''
                    }`}
                  >
                    <PictureOutlined style={{ fontSize: 44, color: '#6fd638' }} />
                  </div>

                  <h3
                    className="text-xl md:text-2xl text-white font-light tracking-wide mb-2"
                    style={{ fontWeight: 300 }}
                  >
                    Vista General del Sistema Iterumx
                  </h3>

                  <p
                    className="text-sm text-slate-300 max-w-lg font-light mb-6"
                    style={{ fontWeight: 300 }}
                  >
                    Contabilización automática de CFDI 4.0, cálculo de impuestos y estados financieros en tiempo real.
                  </p>

                  {canEditLandingImage && (
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      <Button
                        type="primary"
                        icon={<UploadOutlined />}
                        loading={uploadingImage}
                        onClick={() => fileInputRef.current?.click()}
                        style={{ backgroundColor: '#57A82C', borderColor: '#57A82C' }}
                      >
                        Subir Imagen del Programa
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Sección 5: Planes y Precios */}
      <section id="planes-saas" className="py-16 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-10">
            <Tag color="green" className="uppercase tracking-wider px-3 py-1 mb-2">
              Planes Escalables con 14 Días de Prueba Gratis
            </Tag>
            <Title level={2} className="m-0 !font-normal" style={{ fontWeight: 400 }}>
              Elige el plan ideal para el tamaño de tu despacho o empresa
            </Title>
            <div className="flex items-center justify-center gap-3 mt-6">
              <span className={`text-sm ${!annualBilling ? 'text-slate-900' : 'text-slate-500'}`}>
                Facturación Mensual
              </span>
              <Switch
                checked={annualBilling}
                onChange={setAnnualBilling}
                style={{ backgroundColor: annualBilling ? '#57A82C' : undefined }}
              />
              <span className={`text-sm ${annualBilling ? 'text-slate-900' : 'text-slate-500'}`}>
                Facturación Anual
              </span>
              <Tag color="success" className="m-0">
                Ahorra 20%
              </Tag>
            </div>
          </div>

          <Row gutter={[20, 20]} align="stretch">
            {plans.map((plan) => {
              const displayPrice = annualBilling
                ? plan.annual_monthly_equivalent
                : plan.monthly_price;
              const cycleParam = annualBilling ? 'annual' : 'monthly';

              return (
                <Col xs={24} md={12} xl={6} key={plan.code}>
                  <Card
                    className={`h-full flex flex-col justify-between rounded-2xl transition-all ${
                      plan.highlight
                        ? 'border-2 border-blue-600 shadow-xl relative'
                        : 'border border-slate-200 shadow-sm'
                    }`}
                    bodyStyle={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 24 }}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <Tag
                          color={plan.highlight ? 'blue' : 'default'}
                          className="uppercase text-[11px]"
                        >
                          {plan.badge}
                        </Tag>
                        <span className="text-xs font-mono text-slate-400 uppercase">{plan.code}</span>
                      </div>

                      <Title level={4} className="m-0 !font-normal" style={{ fontWeight: 400 }}>
                        {plan.name}
                      </Title>
                      <p className="text-xs text-slate-500 mt-1 min-h-[34px]">{plan.tagline}</p>

                      <div className="my-5 pb-5 border-b border-slate-100">
                        <div className="flex items-baseline gap-1 flex-wrap">
                          <span className="text-3xl text-slate-900">
                            {formatMoney(displayPrice)}
                          </span>
                          <span className="text-xs text-slate-500">MXN / mes + IVA</span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1">
                          {annualBilling
                            ? `Facturado anualmente (${formatMoney(plan.annual_total)} MXN + IVA / año)`
                            : 'Precios más IVA · Facturación mes a mes sin plazos forzosos'}
                        </div>
                      </div>

                      <div className="space-y-2.5 mb-6">
                        {(plan.features || []).map((feat, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs text-slate-700">
                            <CheckCircleFilled
                              className="mt-0.5 flex-shrink-0"
                              style={{ color: '#57A82C' }}
                            />
                            <span>{feat}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <Button
                      type={plan.highlight ? 'primary' : 'default'}
                      size="large"
                      block
                      onClick={() => navigate(`/register?plan=${plan.code}&cycle=${cycleParam}`)}
                      style={
                        plan.highlight
                          ? { backgroundColor: '#1E2C5E', borderColor: '#1E2C5E' }
                          : undefined
                      }
                      className="mt-auto"
                    >
                      Comenzar con {plan.name.replace('Iterumx ', '')}
                    </Button>
                  </Card>
                </Col>
              );
            })}
          </Row>

          {/* Formas de Pago Disponibles */}
          <div className="mt-8 p-5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CreditCardOutlined className="text-2xl text-indigo-600" />
              <div>
                <div className="text-sm text-slate-900">
                  Múltiples Formas de Pago al concluir tus 14 días de prueba gratuita
                </div>
                <div className="text-xs text-slate-500">
                  Emisión automática de tu comprobante fiscal CFDI 4.0 deducible al 100%.
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tag color="geekblue" className="m-0">Tarjetas Visa / Mastercard / Amex</Tag>
              <Tag color="green" className="m-0">Transferencia SPEI Referenciada</Tag>
              <Tag color="gold" className="m-0">Efectivo en OXXO y 7-Eleven</Tag>
            </div>
          </div>

          {/* Bloque de Seguridad e Infraestructura AWS */}
          <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6 md:p-8 shadow-sm">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-start gap-4">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm"
                  style={{ backgroundColor: '#1E2C5E', color: '#6fd638' }}
                >
                  <SafetyCertificateOutlined style={{ fontSize: 28 }} />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-base md:text-lg text-slate-900">
                      Información Alojada en Servidores Seguros de AWS
                    </span>
                    <Tag color="blue" className="m-0">
                      Amazon Web Services
                    </Tag>
                  </div>
                  <p className="text-xs md:text-sm text-slate-600 m-0 leading-relaxed max-w-3xl">
                    Toda la información contable, fiscal y CFDIs de tu despacho y tus clientes se guarda en
                    servidores seguros de AWS (Amazon Web Services) con su debida protección,
                    cifrado de extremo a extremo, aislamiento por empresa, monitoreo continuo 24/7 y respaldos
                    automatizados para garantizar la máxima confidencialidad e integridad de tus datos.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap md:flex-col gap-2 flex-shrink-0 text-xs text-slate-700">
                <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200">
                  <CheckCircleFilled style={{ color: '#57A82C' }} />
                  <span>Cifrado SSL / TLS y Protección de Datos</span>
                </div>
                <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200">
                  <CheckCircleFilled style={{ color: '#57A82C' }} />
                  <span>Infraestructura Cloud AWS de Alta Disponibilidad</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Sección 6: Preguntas Frecuentes (FAQ) */}
      <section id="faq-iterumx" className="py-16 px-6 bg-slate-50 border-t border-slate-200">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <Tag color="purple" className="uppercase tracking-wider px-3 py-1 mb-2">
              <QuestionCircleOutlined className="mr-1" /> Preguntas Frecuentes
            </Tag>
            <Title level={2} className="m-0 !font-normal" style={{ fontWeight: 400 }}>
              Resolvemos tus dudas sobre Iterumx
            </Title>
          </div>

          <Collapse
            accordion
            items={FAQ_ITEMS}
            className="bg-white rounded-xl shadow-sm border border-slate-200"
          />
        </div>
      </section>

      {/* Footer con Imagen Binaria y Redes Sociales */}
      <footer
        className="relative overflow-hidden text-white py-14 px-6 border-t border-slate-800"
        style={{ backgroundColor: '#06122c' }}
      >
        <img
          src="/api/assets/landing-footer-bg"
          alt=""
          aria-hidden="true"
          onError={(e) => {
            if (!e.currentTarget.src.endsWith('/footer-binary-bg.jpg')) {
              e.currentTarget.src = '/footer-binary-bg.jpg';
            }
          }}
          className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none select-none"
          style={{
            opacity: 0.78,
            filter: 'contrast(1.05) saturate(1.05)',
          }}
        />

        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(90deg, rgba(6, 16, 40, 0.78) 0%, rgba(9, 24, 60, 0.58) 50%, rgba(6, 16, 40, 0.78) 100%)',
          }}
        />

        <div className="max-w-7xl mx-auto relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="bg-white/95 backdrop-blur px-4 py-2.5 rounded-xl shadow-lg">
            <IterumxLogo size="sm" showSubtitle subtitle="PLATAFORMA CONTABLE Y FISCAL" />
          </div>

          <div
            className="text-xs md:text-sm text-slate-100 text-center font-light tracking-wide space-y-2"
            style={{
              fontWeight: 300,
              textShadow: '0 1px 10px rgba(0, 0, 0, 0.65)',
            }}
          >
            <div>
              © {new Date().getFullYear()} <span className="text-white">Iterumx</span> — Plataforma de
              Contabilidad Fiscal e Inteligencia Financiera.
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
              <Link
                to="/terminos-y-condiciones"
                className="text-slate-100 hover:text-emerald-300 underline underline-offset-4 transition-colors"
              >
                Términos y Condiciones
              </Link>
              <span className="text-slate-400">•</span>
              <Link
                to="/aviso-de-privacidad"
                className="text-slate-100 hover:text-emerald-300 underline underline-offset-4 transition-colors"
              >
                Aviso de Privacidad
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="https://www.youtube.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="YouTube"
              title="YouTube"
              className="w-11 h-11 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/25 border border-white/30 backdrop-blur-sm transition-all hover:scale-105 shadow-md"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="#FFFFFF"
                className="w-5 h-5"
              >
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
            </a>

            <a
              href="https://www.instagram.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram"
              title="Instagram"
              className="w-11 h-11 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/25 border border-white/30 backdrop-blur-sm transition-all hover:scale-105 shadow-md"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="#FFFFFF"
                className="w-5 h-5"
              >
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
              </svg>
            </a>

            <a
              href="https://www.facebook.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Facebook"
              title="Facebook"
              className="w-11 h-11 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/25 border border-white/30 backdrop-blur-sm transition-all hover:scale-105 shadow-md"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="#FFFFFF"
                className="w-5 h-5"
              >
                <path d="M22.675 0h-21.35C.597 0 0 .597 0 1.326v21.348C0 23.403.597 24 1.325 24H12.82v-9.294H9.692v-3.622h3.128V8.413c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.313h3.587l-.467 3.622h-3.12V24h6.116c.73 0 1.323-.597 1.323-1.326V1.326C24 .597 23.403 0 22.675 0z" />
              </svg>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default SaasLanding;
