import React, { useState, useEffect, useRef } from 'react';
import {
  Drawer,
  Input,
  Button,
  Tag,
  Tabs,
  Select,
  Badge,
  Tooltip,
  Spin,
  Alert,
  Empty,
} from 'antd';
import {
  RobotOutlined,
  SendOutlined,
  SafetyCertificateOutlined,
  BookOutlined,
  MessageOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  FileExclamationOutlined,
  ArrowRightOutlined,
  ReloadOutlined,
  CloseOutlined,
  BulbOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { iterumbotApi } from '../api/client';
import { useClient } from './Layout';
import { useAuth } from '../contexts/AuthContext';

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

const QUICK_PROMPTS = [
  '¿Cuál es la utilidad acumulada de este cliente en 2026?',
  '¿Qué proveedores tienen facturas PPD pendientes de complemento de pago?',
  '¿Cuánto IVA a cargo o a favor trae en octubre?',
  'Ejecutar auditoría de saldos contrarios a su naturaleza y CFDIs sin póliza',
  '¿A qué cuenta 601 mando consumos en restaurantes y cuál es el tope LISR?',
  '¿Cuáles son los topes de deducibilidad LISR en automóviles y viáticos?',
];

const SAT_ADVISOR_CARDS = [
  {
    title: 'Automóviles y Equipo de Transporte',
    law: 'Art. 36 fracc. II y Art. 28 fracc. XIII LISR',
    accounts: ['154-01-000 Automóviles (Activo)', '601-55-000 Mantenimiento de transporte', '601-46-000 Arrendamiento de transporte'],
    summary:
      'Inversión deducible hasta $175,000 MXN (combustión) o $250,000 MXN (híbridos/eléctricos). Arrendamiento puro deducible hasta $200/día o $285/día. Gastos e IVA acreditable proporcionales al tope.',
    prompt: '¿Cuáles son los topes de deducibilidad en automóviles y a qué cuenta 601 van sus gastos?',
  },
  {
    title: 'Viáticos y Gastos de Viaje',
    law: 'Art. 28 fracc. V LISR',
    accounts: ['601-49-000 Viáticos y gastos de viaje', '601-83-000 Gastos no deducibles (excedente)'],
    summary:
      'Aplican fuera de una faja de 50 km del establecimiento. Alimentación hasta $750/día en México y $1,500/día en el extranjero. Hospedaje en el extranjero hasta $3,850/día y renta de auto hasta $850/día.',
    prompt: '¿A qué cuenta 601 mando viáticos y gastos de viaje y cuáles son sus topes LISR?',
  },
  {
    title: 'Consumos en Restaurantes y Atención a Clientes',
    law: 'Art. 28 fracc. XX LISR / Art. 5 LIVA',
    accounts: ['601-50-000 Atención a clientes / Restaurantes (8.5%)', '601-83-000 Gastos no deducibles (91.5%)'],
    summary:
      'Sólo es deducible el 8.5% pagando con tarjeta de crédito/débito o monedero electrónico (nunca efectivo). El 91.5% restante va a 601-83 No deducibles. Bares son 100% no deducibles.',
    prompt: '¿A qué cuenta 601 mando un consumo en restaurante y cuánto es deducible?',
  },
  {
    title: 'Combustibles y Lubricantes',
    law: 'Art. 27 fracc. III LISR',
    accounts: ['601-48-000 Combustibles y lubricantes', '601-57-000 Peajes'],
    summary:
      'Obligatorio pagar con tarjeta, transferencia SPEI, cheque o monedero autorizado desde $1.00 MXN (incluso si es menor a $2,000). Si el CFDI es pagado en efectivo (01), es 100% no deducible.',
    prompt: '¿A qué cuenta 601 mando gasolina y combustibles y qué requisitos pide LISR?',
  },
  {
    title: 'Honorarios y Servicios Profesionales',
    law: 'Art. 27 fracc. VIII y Art. 106 LISR',
    accounts: ['601-26-000 Honorarios a personas físicas', '601-28-000 Honorarios a personas morales', '216-03 / 216-10 Retenciones'],
    summary:
      'Deducibles hasta que estén efectivamente pagados en el ejercicio. Si una Persona Moral paga a Persona Física: retener 10% ISR (o 1.25% RESICO) y 2/3 partes de IVA (10.6667%).',
    prompt: '¿A qué cuenta 601 van los honorarios y qué retenciones aplican?',
  },
  {
    title: 'Catálogo General de Gastos 601-xx-xxx',
    law: 'Anexo 24 SAT — Código Agrupador',
    accounts: ['601-45 Arrendamiento inmuebles', '601-52 Energía eléctrica CFE', '601-56 Papelería', '601-68 Teléfono e Internet'],
    summary:
      'Consulta la lista completa de subcuentas 601-01 a 601-84 para clasificar gastos operativos generales.',
    prompt: 'Muéstrame la guía de cuentas 601 del Código Agrupador SAT',
  },
];

const IterumbotWidget = () => {
  const { user } = useAuth();
  const { selectedClient, clients } = useClient();
  const navigate = useNavigate();

  const effectiveClientId =
    user?.role === 'client'
      ? user?.client_id || user?.company?.id
      : selectedClient || sessionStorage.getItem('contacloud_active_client_session');

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(10);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditData, setAuditData] = useState(null);
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'bot',
      text:
        'Hola, soy **Iterumbot**, tu Copiloto Contable y Fiscal con Inteligencia Artificial.\n\n' +
        'Puedo ayudarte en tiempo real con:\n' +
        '1. **Consultas en lenguaje natural** sobre el cliente activo (utilidad acumulada, proveedores con PPD pendientes, cálculo de IVA del mes, saldos en bancos).\n' +
        '2. **Auditoría automática de anomalías** (saldos contrarios a su naturaleza y CFDIs sin póliza contable).\n' +
        '3. **Asesoría de Código Agrupador SAT (`601-xx-xxx`) y topes LISR / LIVA** (automóviles, viáticos, restaurantes, combustibles).',
      quick_links: [],
    },
  ]);

  const chatEndRef = useRef(null);

  const activeClientLabel =
    clients?.find((c) => String(c.value) === String(effectiveClientId))?.label ||
    (auditData?.client ? `${auditData.client.rfc} - ${auditData.client.business_name}` : null);

  const loadAudit = async (cid = effectiveClientId, y = year, m = month) => {
    if (!cid) {
      setAuditData(null);
      return;
    }
    setAuditLoading(true);
    try {
      const res = await iterumbotApi.getAudit(cid, { year: y, month: m });
      setAuditData(res.data || null);
      if (res.data?.period) {
        if (!y) setYear(res.data.period.year);
        if (!m) setMonth(res.data.period.month);
      }
    } catch (err) {
      console.error('Iterumbot audit error:', err);
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    if (effectiveClientId) {
      loadAudit(effectiveClientId, null, null);
    } else {
      setAuditData(null);
    }
  }, [effectiveClientId]);

  useEffect(() => {
    if (open && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open]);

  const handleSendMessage = async (customPrompt = null) => {
    const textToSend = (customPrompt !== null ? customPrompt : inputValue).trim();
    if (!textToSend || sending) return;

    const userMsg = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: textToSend,
    };
    setMessages((prev) => [...prev, userMsg]);
    if (customPrompt === null) {
      setInputValue('');
    }
    setSending(true);
    setActiveTab('chat');

    try {
      const res = await iterumbotApi.chat({
        message: textToSend,
        client_id: effectiveClientId ? Number(effectiveClientId) : null,
        year,
        month,
      });
      const data = res.data || {};
      if (data.audit_data) {
        setAuditData(data.audit_data);
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `b-${Date.now()}`,
          sender: 'bot',
          text: data.reply || 'Aquí tienes el resultado de tu consulta.',
          quick_links: data.quick_links || [],
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'bot',
          text: 'Ocurrió un inconveniente al consultar a Iterumbot. Por favor intenta nuevamente.',
          quick_links: [],
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const formatMXN = (val) =>
    new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
    }).format(Number(val || 0));

  const renderFormattedText = (rawText) => {
    const lines = String(rawText || '').split('\n');
    return lines.map((line, idx) => {
      if (line.startsWith('### ')) {
        return (
          <div key={idx} className="text-sm text-indigo-950 mt-1 mb-1.5 border-b border-indigo-100 pb-1">
            {line.replace('### ', '')}
          </div>
        );
      }
      if (line.startsWith('#### ')) {
        return (
          <div key={idx} className="text-xs text-slate-800 mt-2 mb-1 uppercase tracking-wide">
            {line.replace('#### ', '')}
          </div>
        );
      }
      const cleanLine = line.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`(.*?)`/g, '$1');
      if (line.trim() === '') {
        return <div key={idx} className="h-1.5" />;
      }
      return (
        <div key={idx} className="text-xs text-slate-700 leading-relaxed">
          {cleanLine}
        </div>
      );
    });
  };

  const totalAlerts =
    (auditData?.contrary_balances_count || 0) + (auditData?.unposted_all_count || 0);

  return (
    <>
      {/* Botón Flotante Iterumbot disponible en toda la pantalla */}
      <div
        style={{
          position: 'fixed',
          right: 24,
          bottom: 24,
          zIndex: 1050,
        }}
      >
        <Tooltip
          title={
            effectiveClientId
              ? `Iterumbot IA — Copiloto Contable y Fiscal (${totalAlerts} alertas detectadas)`
              : 'Iterumbot IA — Copiloto Contable y Fiscal del Despacho'
          }
          placement="left"
        >
          <Badge count={totalAlerts} overflowCount={99} offset={[-4, 4]}>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex items-center gap-2.5 px-4 py-3 rounded-full text-white shadow-xl transition-all hover:scale-105 cursor-pointer border border-white/20"
              style={{
                background: 'linear-gradient(135deg, #1E2C5E 0%, #4f46e5 60%, #0d9488 100%)',
              }}
            >
              <span className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-lg">
                <RobotOutlined />
              </span>
              <div className="text-left pr-1">
                <div className="text-xs leading-none tracking-wide">Iterumbot IA</div>
                <div className="text-[10px] text-emerald-200 leading-tight mt-0.5">
                  Copiloto Contable y Fiscal
                </div>
              </div>
            </button>
          </Badge>
        </Tooltip>
      </div>

      {/* Panel Deslizante de Iterumbot */}
      <Drawer
        title={
          <div className="flex items-center justify-between w-full pr-2 font-normal">
            <div className="flex items-center gap-2.5">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-lg shadow-sm"
                style={{
                  background: 'linear-gradient(135deg, #1E2C5E 0%, #4f46e5 100%)',
                }}
              >
                <RobotOutlined />
              </div>
              <div>
                <div className="text-sm text-slate-900 flex items-center gap-2">
                  <span>Iterumbot</span>
                  <Tag color="geekblue" className="text-[10px] m-0 font-normal">
                    Copiloto IA
                  </Tag>
                </div>
                <div className="text-[11px] text-slate-500">
                  {activeClientLabel ? `Cliente activo: ${activeClientLabel}` : 'Asesor Contable, Fiscal y SAT 601'}
                </div>
              </div>
            </div>
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={() => setOpen(false)}
            />
          </div>
        }
        placement="right"
        width={480}
        closable={false}
        onClose={() => setOpen(false)}
        open={open}
        styles={{ body: { padding: '12px 16px', display: 'flex', flexDirection: 'column', height: '100%' } }}
      >
        {/* Barra de Periodo y Cliente */}
        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Periodo de consulta:</span>
            <Select
              size="small"
              value={year}
              onChange={(y) => {
                setYear(y);
                if (effectiveClientId) loadAudit(effectiveClientId, y, month);
              }}
              style={{ width: 82 }}
            >
              {[2024, 2025, 2026, 2027].map((yr) => (
                <Option key={yr} value={yr}>
                  {yr}
                </Option>
              ))}
            </Select>
            <Select
              size="small"
              value={month}
              onChange={(m) => {
                setMonth(m);
                if (effectiveClientId) loadAudit(effectiveClientId, year, m);
              }}
              style={{ width: 112 }}
            >
              {MONTHS_OPTIONS.map((mo) => (
                <Option key={mo.value} value={mo.value}>
                  {mo.label}
                </Option>
              ))}
            </Select>
          </div>

          {effectiveClientId && (
            <Button
              size="small"
              icon={<ReloadOutlined spin={auditLoading} />}
              onClick={() => loadAudit(effectiveClientId, year, month)}
            >
              Escaneo IA
            </Button>
          )}
        </div>

        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          size="small"
          items={[
            {
              key: 'chat',
              label: (
                <span className="flex items-center gap-1.5 text-xs">
                  <MessageOutlined /> Chat Copiloto IA
                </span>
              ),
            },
            {
              key: 'audit',
              label: (
                <span className="flex items-center gap-1.5 text-xs">
                  <SafetyCertificateOutlined /> Auditoría IA
                  {totalAlerts > 0 && (
                    <Tag color="warning" className="m-0 text-[10px] px-1.5 py-0">
                      {totalAlerts}
                    </Tag>
                  )}
                </span>
              ),
            },
            {
              key: 'sat',
              label: (
                <span className="flex items-center gap-1.5 text-xs">
                  <BookOutlined /> Asesor SAT / LISR
                </span>
              ),
            },
          ]}
        />

        {/* PESTAÑA 1: CHAT EN LENGUAJE NATURAL */}
        {activeTab === 'chat' && (
          <div className="flex flex-col flex-1 min-h-0">
            {/* Sugerencias rápidas */}
            <div className="mb-2.5">
              <div className="text-[11px] text-slate-500 mb-1 flex items-center gap-1">
                <BulbOutlined className="text-amber-500" /> Preguntas rápidas sugeridas:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_PROMPTS.map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSendMessage(q)}
                    className="text-left text-[11px] px-2.5 py-1 rounded-full bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 transition-colors cursor-pointer"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* Historial de conversación */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 py-2 border-y border-slate-100">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[90%] rounded-xl p-3 ${
                      m.sender === 'user'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-50 border border-slate-200 text-slate-800'
                    }`}
                  >
                    {m.sender === 'user' ? (
                      <div className="text-xs">{m.text}</div>
                    ) : (
                      <div className="space-y-0.5">{renderFormattedText(m.text)}</div>
                    )}

                    {m.quick_links && m.quick_links.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-slate-200/80 flex flex-wrap gap-1.5">
                        {m.quick_links.map((lnk, i) => (
                          <Button
                            key={i}
                            size="small"
                            type="primary"
                            ghost
                            icon={<ArrowRightOutlined />}
                            onClick={() => {
                              navigate(lnk.path);
                              setOpen(false);
                            }}
                            className="text-[11px]"
                          >
                            {lnk.label}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-500 flex items-center gap-2">
                    <Spin size="small" /> Iterumbot está analizando las pólizas y CFDIs en vivo...
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input para escribir pregunta */}
            <div className="pt-3 flex gap-2">
              <Input
                placeholder="Pregúntale a Iterumbot sobre utilidad, PPD, IVA, anomalías o cuentas 601..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onPressEnter={() => handleSendMessage()}
                disabled={sending}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={() => handleSendMessage()}
                loading={sending}
                style={{ backgroundColor: '#1E2C5E', borderColor: '#1E2C5E' }}
              >
                Enviar
              </Button>
            </div>
          </div>
        )}

        {/* PESTAÑA 2: AUDITORÍA AUTOMÁTICA DE ANOMALÍAS CON IA */}
        {activeTab === 'audit' && (
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {!effectiveClientId ? (
              <Alert
                type="warning"
                showIcon
                message="Selecciona un cliente en Inicio"
                description="Para que Iterumbot ejecute la auditoría automática de saldos contrarios a su naturaleza y CFDIs sin póliza, selecciona primero una empresa activa."
              />
            ) : auditLoading ? (
              <div className="py-12 text-center">
                <Spin />
                <div className="text-xs text-slate-500 mt-2">
                  Auditando balanza, cuentas de mayor y CFDIs del cliente...
                </div>
              </div>
            ) : (
              <>
                {/* 1. Saldos contrarios a su naturaleza */}
                <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-800 flex items-center gap-1.5">
                      <WarningOutlined className="text-amber-500" />
                      1. Saldos Contrarios a su Naturaleza
                    </span>
                    <Tag color={auditData?.contrary_balances_count > 0 ? 'error' : 'success'} className="m-0 text-[11px]">
                      {auditData?.contrary_balances_count || 0} detectados
                    </Tag>
                  </div>

                  {auditData?.contrary_balances?.length > 0 ? (
                    <div className="space-y-2">
                      {auditData.contrary_balances.map((item) => (
                        <div
                          key={item.account_id}
                          className="p-2 rounded-lg bg-rose-50/70 border border-rose-200 text-xs"
                        >
                          <div className="flex justify-between items-center">
                            <span className="font-mono text-rose-900">
                              {item.account_number} — {item.name}
                            </span>
                            <span className="font-mono text-rose-700">
                              {formatMXN(item.balance)}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600 mt-0.5">
                            Naturaleza {item.nature}: {item.explanation}
                          </div>
                        </div>
                      ))}
                      <Button
                        size="small"
                        type="link"
                        className="p-0"
                        onClick={() => {
                          navigate(`/trial-balance/${effectiveClientId}`);
                          setOpen(false);
                        }}
                      >
                        Revisar en Balanza de Comprobación →
                      </Button>
                    </div>
                  ) : (
                    <div className="text-xs text-emerald-700 flex items-center gap-1.5 py-1">
                      <CheckCircleOutlined /> Ninguna cuenta presenta saldo contrario a su naturaleza en {auditData?.period?.label}.
                    </div>
                  )}
                </div>

                {/* 2. CFDIs sin póliza contable generada */}
                <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-800 flex items-center gap-1.5">
                      <FileExclamationOutlined className="text-orange-500" />
                      2. CFDIs Cargados sin Póliza Contable
                    </span>
                    <Tag color={auditData?.unposted_all_count > 0 ? 'warning' : 'success'} className="m-0 text-[11px]">
                      {auditData?.unposted_month_count || 0} en el mes / {auditData?.unposted_all_count || 0} total
                    </Tag>
                  </div>

                  {(auditData?.unposted_month_items?.length > 0 || auditData?.unposted_all_items?.length > 0) ? (
                    <div className="space-y-1.5">
                      {(auditData.unposted_month_items?.length > 0
                        ? auditData.unposted_month_items
                        : auditData.unposted_all_items
                      )
                        .slice(0, 6)
                        .map((cf) => (
                          <div
                            key={cf.id}
                            className="p-2 rounded bg-amber-50/60 border border-amber-200 text-xs flex justify-between items-center gap-2"
                          >
                            <div className="truncate">
                              <div className="text-slate-800 truncate">
                                [{cf.cfdi_type.toUpperCase()}] {cf.counterparty_name}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono">
                                {cf.date} • RFC: {cf.counterparty_rfc}
                              </div>
                            </div>
                            <span className="font-mono text-amber-900 whitespace-nowrap">
                              {formatMXN(cf.total)}
                            </span>
                          </div>
                        ))}
                      <Button
                        size="small"
                        type="primary"
                        ghost
                        block
                        onClick={() => {
                          navigate(`/cfdi-upload/${effectiveClientId}`);
                          setOpen(false);
                        }}
                      >
                        Ir a Cargar CFDI para Generar Pólizas →
                      </Button>
                    </div>
                  ) : (
                    <div className="text-xs text-emerald-700 flex items-center gap-1.5 py-1">
                      <CheckCircleOutlined /> Todos los CFDIs tienen póliza contable generada.
                    </div>
                  )}
                </div>

                {/* 3. Proveedores con PPD pendiente de complemento */}
                <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-800">
                      3. Proveedores con Facturas PPD sin Complemento (REP)
                    </span>
                    <Tag color={auditData?.ppd_pending_count > 0 ? 'purple' : 'success'} className="m-0 text-[11px]">
                      {auditData?.ppd_pending_count || 0} PPD
                    </Tag>
                  </div>

                  {auditData?.ppd_providers?.length > 0 ? (
                    <div className="space-y-1.5">
                      {auditData.ppd_providers.slice(0, 5).map((p) => (
                        <div
                          key={p.rfc}
                          className="p-2 rounded bg-purple-50/50 border border-purple-200 text-xs flex justify-between items-center"
                        >
                          <div className="truncate pr-2">
                            <div className="text-slate-800 truncate">{p.name}</div>
                            <div className="text-[10px] font-mono text-slate-500">
                              {p.rfc} • {p.count} factura(s) PPD
                            </div>
                          </div>
                          <span className="font-mono text-purple-900 whitespace-nowrap">
                            {formatMXN(p.total)}
                          </span>
                        </div>
                      ))}
                      <Button
                        size="small"
                        type="link"
                        className="p-0"
                        onClick={() => {
                          navigate(`/fiscal-complementos/${effectiveClientId}`);
                          setOpen(false);
                        }}
                      >
                        Abrir Control de Complementos de Pago →
                      </Button>
                    </div>
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Sin facturas PPD pendientes" />
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* PESTAÑA 3: ASESORÍA DE CÓDIGO AGRUPADOR SAT Y LISR / LIVA */}
        {activeTab === 'sat' && (
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            <Alert
              type="info"
              showIcon
              message="Asesor de Cuentas 601-xx-xxx y Topes de Deducibilidad LISR / LIVA"
              description="Haz clic en cualquier rubro para que Iterumbot te muestre las cuentas contables exactas y el fundamento legal."
            />

            {SAT_ADVISOR_CARDS.map((card, i) => (
              <div
                key={i}
                className="p-3 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 transition-all space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-900">{card.title}</span>
                  <Tag color="geekblue" className="m-0 text-[10px] font-normal">
                    {card.law}
                  </Tag>
                </div>
                <div className="flex flex-wrap gap-1">
                  {card.accounts.map((acc, j) => (
                    <Tag key={j} color="cyan" className="m-0 text-[10px] font-mono font-normal">
                      {acc}
                    </Tag>
                  ))}
                </div>
                <div className="text-[11px] text-slate-600 leading-relaxed">{card.summary}</div>
                <div>
                  <Button
                    size="small"
                    type="link"
                    className="p-0 text-xs"
                    onClick={() => handleSendMessage(card.prompt)}
                  >
                    Consultar detalle en el Chat de Iterumbot →
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </>
  );
};

export default IterumbotWidget;
