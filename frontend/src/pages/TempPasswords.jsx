import React, { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Button,
  Select,
  InputNumber,
  Input,
  Table,
  Tag,
  Space,
  Tooltip,
  Alert,
  Switch,
  Popconfirm,
  Typography,
  Row,
  Col,
  message,
} from 'antd';
import {
  KeyOutlined,
  CopyOutlined,
  WhatsAppOutlined,
  MailOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  StopOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Navigate } from 'react-router-dom';
import { tempPasswordsApi, usersApi, clientsApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text } = Typography;

const PURPOSE_OPTIONS = [
  {
    value: 'general',
    label: 'General — Baja de Clientes y Baja/Suspensión de Auxiliares',
  },
  {
    value: 'baja_cliente',
    label: 'Baja de Cliente — Autorización para dar de baja cliente',
  },
  {
    value: 'baja_auxiliar',
    label: 'Baja de Auxiliar — Autorización para suspender / dar de baja auxiliar',
  },
  {
    value: 'acceso_auxiliar',
    label: 'Acceso Temporal de Auxiliar — Contraseña de ingreso con vencimiento',
  },
];

const UNIT_OPTIONS = [
  { value: 'minutes', label: 'Minutos' },
  { value: 'hours', label: 'Horas' },
  { value: 'days', label: 'Días' },
  { value: 'months', label: 'Meses' },
];

const UNIT_LABELS = {
  minutes: 'Minuto(s)',
  hours: 'Hora(s)',
  days: 'Día(s)',
  months: 'Mes(es)',
};

const QUICK_PRESETS = [
  { label: '10 Minutos', value: 10, unit: 'minutes' },
  { label: '30 Minutos', value: 30, unit: 'minutes' },
  { label: '1 Hora', value: 1, unit: 'hours' },
  { label: '12 Horas', value: 12, unit: 'hours' },
  { label: '24 Horas', value: 24, unit: 'hours' },
  { label: '7 Días', value: 7, unit: 'days' },
  { label: '15 Días', value: 15, unit: 'days' },
  { label: '1 Mes', value: 1, unit: 'months' },
  { label: '3 Meses', value: 3, unit: 'months' },
  { label: '6 Meses', value: 6, unit: 'months' },
];

const formatRemainingTime = (seconds) => {
  if (seconds <= 0) return 'Vencida (0s)';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${String(h).padStart(2, '0')}h`);
  parts.push(`${String(m).padStart(2, '0')}m`);
  parts.push(`${String(s).padStart(2, '0')}s`);
  return parts.join(' ');
};

const formatDateTime = (isoStr) => {
  if (!isoStr) return '-';
  try {
    return new Date(isoStr).toLocaleString('es-MX', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoStr;
  }
};

const TempPasswords = () => {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';

  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  // Form states
  const [purpose, setPurpose] = useState('general');
  const [durationValue, setDurationValue] = useState(30);
  const [durationUnit, setDurationUnit] = useState('minutes');
  const [targetUserId, setTargetUserId] = useState(null);
  const [targetClientId, setTargetClientId] = useState(null);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [applyAsLoginPassword, setApplyAsLoginPassword] = useState(false);

  // Última contraseña recién generada para copiar/enviar rápido
  const [latestCreated, setLatestCreated] = useState(null);

  const fetchData = async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const [tpRes, uRes, cRes] = await Promise.all([
        tempPasswordsApi.list(),
        usersApi.list(),
        clientsApi.list({ limit: 1000 }),
      ]);
      setItems(tpRes.data || []);
      setUsers(uRes.data || []);
      setClients(cRes.data || []);
    } catch (err) {
      message.error('Error al cargar el módulo de contraseñas temporales');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [isAdmin]);

  // Reloj en vivo cada segundo para actualizar el vencimiento exacto
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  const handleSelectUser = (userId) => {
    setTargetUserId(userId || null);
    if (userId) {
      const u = users.find((x) => x.id === userId);
      if (u) {
        if (u.email) setRecipientEmail(u.email);
        if (u.phone) setRecipientPhone(u.phone);
      }
    }
  };

  const handleSelectClient = (clientId) => {
    setTargetClientId(clientId || null);
    if (clientId) {
      const c = clients.find((x) => x.id === clientId);
      if (c) {
        if (c.email) setRecipientEmail(c.email);
        if (c.phone) setRecipientPhone(c.phone);
      }
    }
  };

  const handleGenerate = async () => {
    if (!durationValue || durationValue < 1) {
      message.warning('Ingresa una duración válida mayor o igual a 1');
      return;
    }
    setCreating(true);
    try {
      const res = await tempPasswordsApi.create({
        purpose,
        duration_value: durationValue,
        duration_unit: durationUnit,
        target_user_id: targetUserId || null,
        target_client_id: targetClientId || null,
        recipient_email: recipientEmail || null,
        recipient_phone: recipientPhone || null,
        notes: notes || null,
        apply_as_login_password: Boolean(applyAsLoginPassword && targetUserId),
      });
      const created = res.data;
      setLatestCreated(created);
      setItems((prev) => [created, ...prev]);
      navigator.clipboard?.writeText(created.token_uuid).catch(() => {});
      message.success('Contraseña de 32 dígitos (UUID) generada y copiada al portapapeles');
    } catch (err) {
      message.error(err?.response?.data?.detail || 'Error al generar contraseña temporal');
    } finally {
      setCreating(false);
    }
  };

  const buildShareMessage = (record) => {
    const expStr = formatDateTime(record.expires_at);
    const durStr = `${record.duration_value} ${UNIT_LABELS[record.duration_unit] || record.duration_unit}`;
    const lines = [
      '🔐 *ITERUMX — CONTRASEÑA TEMPORAL DE 32 DÍGITOS (UUID)*',
      '',
      `🔑 Clave (UUID): ${record.token_uuid}`,
      `🔢 32 dígitos continuos: ${record.token_clean}`,
      `⏱️ Vigencia: ${durStr}`,
      `📅 Vence exactamente el: ${expStr}`,
    ];
    if (record.target_client_name) {
      lines.push(`🏢 Cliente: ${record.target_client_name}`);
    }
    if (record.target_user_name) {
      lines.push(`👤 Auxiliar: ${record.target_user_name}`);
    }
    if (record.notes) {
      lines.push(`📝 Nota: ${record.notes}`);
    }
    lines.push('', '⚠️ Una vez cumplido el tiempo de vigencia, esta contraseña se vence automáticamente.');
    return lines.join('\n');
  };

  const handleCopyToken = (tokenStr, label = 'Contraseña de 32 dígitos') => {
    navigator.clipboard.writeText(tokenStr);
    message.success(`${label} copiada al portapapeles: ${tokenStr}`);
  };

  const handleCopyFullMessage = (record) => {
    const msg = buildShareMessage(record);
    navigator.clipboard.writeText(msg);
    message.success('Mensaje completo con contraseña y vigencia copiado al portapapeles');
  };

  const handleSendWhatsApp = (record) => {
    const msg = buildShareMessage(record);
    const rawPhone = String(record.recipient_phone || recipientPhone || '').replace(/\D/g, '');
    let cleanPhone = rawPhone;
    if (cleanPhone.length === 10) {
      cleanPhone = `52${cleanPhone}`;
    }
    const url = cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleSendEmail = (record) => {
    const email = (record.recipient_email || recipientEmail || '').trim();
    const subject = `Contraseña Temporal de 32 Dígitos (UUID) — Vigencia: ${record.duration_value} ${
      UNIT_LABELS[record.duration_unit] || record.duration_unit
    }`;
    const body = buildShareMessage(record).replace(/\*/g, '');
    const mailtoUrl = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoUrl;
  };

  const handleRevoke = async (id) => {
    try {
      const res = await tempPasswordsApi.revoke(id);
      setItems((prev) => prev.map((it) => (it.id === id ? res.data : it)));
      if (latestCreated?.id === id) {
        setLatestCreated(res.data);
      }
      message.success('Contraseña revocada inmediatamente');
    } catch (err) {
      message.error('No se pudo revocar la contraseña');
    }
  };

  const handleDelete = async (id) => {
    try {
      await tempPasswordsApi.delete(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
      if (latestCreated?.id === id) {
        setLatestCreated(null);
      }
      message.success('Registro eliminado');
    } catch (err) {
      message.error('No se pudo eliminar el registro');
    }
  };

  const enrichedItems = useMemo(() => {
    return items.map((it) => {
      const expMs = it.expires_at ? new Date(it.expires_at).getTime() : 0;
      const remSec = Math.max(0, Math.floor((expMs - nowTick) / 1000));
      const isExpiredNow = expMs > 0 && nowTick >= expMs;
      let liveStatus = it.status;
      if (it.is_revoked) {
        liveStatus = 'revoked';
      } else if (isExpiredNow) {
        liveStatus = 'expired';
      } else {
        liveStatus = 'active';
      }
      return {
        ...it,
        liveRemainingSeconds: liveStatus === 'active' ? remSec : 0,
        liveStatus,
      };
    });
  }, [items, nowTick]);

  const columns = [
    {
      title: 'Contraseña de 32 Dígitos (Formato UUID)',
      dataIndex: 'token_uuid',
      key: 'token_uuid',
      width: 340,
      render: (val, record) => (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`font-mono text-xs font-bold px-2 py-1 rounded border select-all ${
                record.liveStatus === 'active'
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                  : 'bg-gray-100 text-gray-400 border-gray-200 line-through'
              }`}
            >
              {val}
            </span>
            <Tooltip title="Copiar contraseña UUID (con guiones)">
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={() => handleCopyToken(val, 'Contraseña UUID')}
              />
            </Tooltip>
          </div>
          <div className="text-[11px] text-gray-500 font-mono flex items-center gap-1">
            <span>32 dígitos: {record.token_clean}</span>
            <Button
              type="link"
              size="small"
              className="p-0 h-auto text-[11px]"
              onClick={() => handleCopyToken(record.token_clean, 'Clave de 32 dígitos continuos')}
            >
              Copiar sin guiones
            </Button>
          </div>
        </div>
      ),
    },
    {
      title: 'Uso / Destinatario',
      key: 'purpose',
      render: (_, record) => {
        const purposeLabel =
          PURPOSE_OPTIONS.find((p) => p.value === record.purpose)?.label.split('—')[0] || record.purpose;
        return (
          <div className="text-xs space-y-0.5">
            <div className="font-semibold text-gray-800">{purposeLabel}</div>
            {record.target_client_name && (
              <div className="text-blue-700">Cliente: {record.target_client_name}</div>
            )}
            {record.target_user_name && (
              <div className="text-purple-700">Auxiliar: {record.target_user_name}</div>
            )}
            {record.notes && <div className="text-gray-500 italic">"{record.notes}"</div>}
          </div>
        );
      },
    },
    {
      title: 'Vigencia Configurada',
      key: 'duration',
      width: 150,
      render: (_, record) => (
        <div className="text-xs">
          <Tag color="geekblue" className="font-semibold">
            {record.duration_value} {UNIT_LABELS[record.duration_unit] || record.duration_unit}
          </Tag>
          <div className="text-[11px] text-gray-500 mt-0.5">Usos: {record.used_count || 0}</div>
        </div>
      ),
    },
    {
      title: 'Vencimiento Exacto',
      key: 'expiration',
      width: 210,
      render: (_, record) => (
        <div className="text-xs">
          <div className="font-medium text-gray-800">{formatDateTime(record.expires_at)}</div>
          {record.liveStatus === 'active' ? (
            <div className="text-emerald-700 font-mono font-bold text-[11px] mt-0.5">
              <ClockCircleOutlined className="mr-1" />
              Restan: {formatRemainingTime(record.liveRemainingSeconds)}
            </div>
          ) : record.liveStatus === 'revoked' ? (
            <div className="text-red-600 font-semibold text-[11px] mt-0.5">Revocada manualmente</div>
          ) : (
            <div className="text-red-600 font-semibold text-[11px] mt-0.5">Tiempo agotado — Vencida</div>
          )}
        </div>
      ),
    },
    {
      title: 'Estado',
      key: 'status',
      width: 120,
      align: 'center',
      render: (_, record) => {
        if (record.liveStatus === 'active') {
          return (
            <Tag color="green" icon={<CheckCircleOutlined />} className="font-semibold">
              VIGENTE
            </Tag>
          );
        }
        if (record.liveStatus === 'revoked') {
          return (
            <Tag color="volcano" icon={<StopOutlined />} className="font-semibold">
              REVOCADA
            </Tag>
          );
        }
        return (
          <Tag color="red" icon={<CloseCircleOutlined />} className="font-semibold">
            VENCIDA
          </Tag>
        );
      },
    },
    {
      title: 'Copiar / Enviar / Acciones',
      key: 'actions',
      width: 240,
      align: 'center',
      render: (_, record) => (
        <Space size="small" wrap>
          <Tooltip title="Copiar contraseña de 32 dígitos">
            <Button
              size="small"
              type="primary"
              icon={<CopyOutlined />}
              onClick={() => handleCopyToken(record.token_uuid)}
            >
              Copiar
            </Button>
          </Tooltip>
          <Tooltip title="Enviar por WhatsApp">
            <Button
              size="small"
              style={{ backgroundColor: '#16a34a', borderColor: '#16a34a', color: '#fff' }}
              icon={<WhatsAppOutlined />}
              onClick={() => handleSendWhatsApp(record)}
            />
          </Tooltip>
          <Tooltip title="Enviar por Correo Electrónico">
            <Button
              size="small"
              icon={<MailOutlined className="text-blue-600" />}
              onClick={() => handleSendEmail(record)}
            />
          </Tooltip>
          {record.liveStatus === 'active' && (
            <Popconfirm
              title="¿Revocar esta contraseña ahora mismo?"
              description="La siguiente vez que intenten usarla ya no lo permitirá."
              onConfirm={() => handleRevoke(record.id)}
              okText="Sí, revocar"
              cancelText="Cancelar"
            >
              <Tooltip title="Vencer / Revocar inmediatamente">
                <Button size="small" danger icon={<StopOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
          <Popconfirm
            title="¿Eliminar este registro del historial?"
            onConfirm={() => handleDelete(record.id)}
            okText="Eliminar"
            cancelText="Cancelar"
          >
            <Tooltip title="Eliminar registro">
              <Button size="small" type="text" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="p-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Title level={3} className="m-0 flex items-center gap-2">
            <SafetyCertificateOutlined className="text-blue-600" />
            Generador de Contraseñas Aleatorias de 32 Dígitos (UUID)
          </Title>
          <Text type="secondary" className="text-xs">
            Módulo exclusivo del Socio / Titular para generar contraseñas temporales con vencimiento exacto por minutos,
            horas, días o meses (para dar de baja clientes o accesos de auxiliares).
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>
          Actualizar Lista
        </Button>
      </div>

      <Alert
        type="info"
        showIcon
        message="Comportamiento de vencimiento exacto y sesiones activas"
        description="Las contraseñas generadas tienen 32 dígitos hexadecimales (formato UUID) y se vencen en el segundo exacto en que se cumple el tiempo configurado. Si el acceso de un usuario se vence mientras ya está dentro del sistema trabajando, el sistema NO lo saca de su sesión actual; pero a la siguiente vez que intente usar la contraseña o iniciar sesión, ya no se lo permitirá."
      />

      <Card
        title={
          <span className="font-semibold">
            <KeyOutlined className="mr-2 text-blue-600" />
            Nueva Contraseña Aleatoria de 32 Dígitos (UUID)
          </span>
        }
        className="shadow-sm border-blue-100"
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Uso / Propósito de la Contraseña:
            </label>
            <Select
              style={{ width: '100%' }}
              value={purpose}
              options={PURPOSE_OPTIONS}
              onChange={(val) => setPurpose(val)}
            />
          </Col>

          <Col xs={24} md={12}>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Tiempo de Vigencia Exacto (Minutos, Horas, Días o Meses):
            </label>
            <div className="flex gap-2">
              <InputNumber
                min={1}
                max={9999}
                value={durationValue}
                onChange={(val) => setDurationValue(val || 1)}
                style={{ width: 130 }}
                addonBefore="Duración"
              />
              <Select
                value={durationUnit}
                options={UNIT_OPTIONS}
                onChange={(val) => setDurationUnit(val)}
                style={{ flex: 1 }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="text-[11px] text-gray-500 mr-1 self-center"> Selección rápida:</span>
              {QUICK_PRESETS.map((preset) => (
                <Tag
                  key={`${preset.value}-${preset.unit}`}
                  color={
                    durationValue === preset.value && durationUnit === preset.unit ? 'blue' : 'default'
                  }
                  className="cursor-pointer select-none text-[11px] m-0"
                  onClick={() => {
                    setDurationValue(preset.value);
                    setDurationUnit(preset.unit);
                  }}
                >
                  <ThunderboltOutlined className="mr-0.5" />
                  {preset.label}
                </Tag>
              ))}
            </div>
          </Col>

          <Col xs={24} md={8}>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Vincular a Cliente específico (Opcional):
            </label>
            <Select
              showSearch
              allowClear
              placeholder="Cualquier cliente (General)..."
              style={{ width: '100%' }}
              optionFilterProp="label"
              value={targetClientId}
              onChange={handleSelectClient}
              options={clients.map((c) => ({
                value: c.id,
                label: `${c.rfc} - ${c.business_name}`,
              }))}
            />
          </Col>

          <Col xs={24} md={8}>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Vincular a Auxiliar específico (Opcional):
            </label>
            <Select
              showSearch
              allowClear
              placeholder="Cualquier auxiliar (General)..."
              style={{ width: '100%' }}
              optionFilterProp="label"
              value={targetUserId}
              onChange={handleSelectUser}
              options={users
                .filter((u) => u.role !== 'admin')
                .map((u) => ({
                  value: u.id,
                  label: `${u.full_name || u.username} (@${u.username})`,
                }))}
            />
            {targetUserId && (
              <div className="mt-2 flex items-center gap-2 bg-purple-50 p-1.5 rounded border border-purple-200 text-xs">
                <Switch
                  size="small"
                  checked={applyAsLoginPassword}
                  onChange={(checked) => setApplyAsLoginPassword(checked)}
                />
                <span className="text-[11px] text-purple-900">
                  Establecer también como su contraseña de acceso temporal al sistema
                </span>
              </div>
            )}
          </Col>

          <Col xs={24} md={8}>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Nota / Referencia (Opcional):
            </label>
            <Input
              placeholder="Ej. Autorización baja de cliente o acceso temporal..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Col>

          <Col xs={24} md={8}>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Correo para envío rápido (Opcional):
            </label>
            <Input
              prefix={<MailOutlined className="text-gray-400" />}
              placeholder="correo@ejemplo.com"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
            />
          </Col>

          <Col xs={24} md={8}>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              WhatsApp para envío rápido (10 dígitos, Opcional):
            </label>
            <Input
              prefix={<WhatsAppOutlined className="text-green-600" />}
              placeholder="Ej. 5512345678"
              value={recipientPhone}
              onChange={(e) => setRecipientPhone(e.target.value)}
            />
          </Col>

          <Col xs={24} md={8} className="flex items-end">
            <Button
              type="primary"
              size="large"
              icon={<KeyOutlined />}
              loading={creating}
              onClick={handleGenerate}
              className="w-full font-semibold"
            >
              Generar Contraseña de 32 Dígitos (UUID)
            </Button>
          </Col>
        </Row>

        {latestCreated && (
          <div className="mt-6 p-4 rounded-lg bg-emerald-50 border-2 border-emerald-300">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase text-emerald-800 tracking-wide">
                  ✓ Contraseña de 32 Dígitos Generada Exitosamente (Vence el{' '}
                  {formatDateTime(latestCreated.expires_at)})
                </div>
                <div className="font-mono text-xl md:text-2xl font-extrabold text-emerald-950 mt-1 select-all">
                  {latestCreated.token_uuid}
                </div>
                <div className="font-mono text-xs text-emerald-700 mt-0.5 select-all">
                  32 dígitos sin guiones: <strong>{latestCreated.token_clean}</strong>
                </div>
              </div>

              <Space wrap>
                <Button
                  type="primary"
                  icon={<CopyOutlined />}
                  onClick={() => handleCopyToken(latestCreated.token_uuid)}
                >
                  Copiar Contraseña
                </Button>
                <Button
                  icon={<CopyOutlined />}
                  onClick={() => handleCopyFullMessage(latestCreated)}
                >
                  Copiar Mensaje Completo
                </Button>
                <Button
                  style={{ backgroundColor: '#16a34a', borderColor: '#16a34a', color: '#fff' }}
                  icon={<WhatsAppOutlined />}
                  onClick={() => handleSendWhatsApp(latestCreated)}
                >
                  Enviar por WhatsApp
                </Button>
                <Button
                  type="default"
                  icon={<MailOutlined className="text-blue-600" />}
                  onClick={() => handleSendEmail(latestCreated)}
                >
                  Enviar por Correo
                </Button>
              </Space>
            </div>
          </div>
        )}
      </Card>

      <Card
        size="small"
        title={
          <span className="font-semibold">
            Historial y Control de Contraseñas de 32 Dígitos ({enrichedItems.length})
          </span>
        }
      >
        <Table
          columns={columns}
          dataSource={enrichedItems}
          rowKey="id"
          loading={loading}
          size="small"
          pagination={{ pageSize: 15 }}
        />
      </Card>
    </div>
  );
};

export default TempPasswords;
