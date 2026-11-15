import React, { useState, useEffect } from 'react';
import {
  Card,
  Row,
  Col,
  Button,
  Typography,
  Table,
  Tag,
  Form,
  Input,
  Select,
  Modal,
  Tabs,
  Space,
  Collapse,
  Alert,
  Tooltip,
  Popconfirm,
  Badge,
  message,
} from 'antd';
import {
  CustomerServiceOutlined,
  WhatsAppOutlined,
  MailOutlined,
  PhoneOutlined,
  DesktopOutlined,
  CheckCircleOutlined,
  PlusOutlined,
  CopyOutlined,
  SettingOutlined,
  EditOutlined,
  DeleteOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SendOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { supportApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useClient } from '../components/Layout';

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;

const MODULE_OPTIONS = [
  'General / Inicio',
  'Clientes y Accesos',
  'Catálogo de Cuentas',
  'Pólizas Contables',
  'Cargar CFDI (Emitidos / Recibidos / Nómina)',
  'Libro Mayor / Balanza / Estados Financieros',
  'Cálculo Mensual de IVA / Conciliación IVA',
  'Cálculo Mensual e Informativa de IEPS',
  'Cálculo de ISR',
  'Complementos de Pago (REP)',
  'DIOT / Contabilidad Electrónica',
  'Inversiones / Activos Fijos',
  'Validador 69-B / 49-B',
  'Conciliación Bancaria',
  'Contraseñas Temporales / Bitácora',
];

const CATEGORY_OPTIONS = [
  'Falla o Error en Sistema',
  'Duda Contable / Fiscal',
  'Lectura de CFDI / XML / Nómina',
  'Accesos, Usuarios y Contraseñas',
  'Respaldo / Restauración de Información',
  'Solicitud de Mejora o Ajuste',
];

const TechnicalSupport = () => {
  const { user } = useAuth();
  const { selectedClient, clients } = useClient();

  const [loading, setLoading] = useState(true);
  const [supportInfo, setSupportInfo] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [activeTab, setActiveTab] = useState('tickets');

  // Crear ticket
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [ticketForm] = Form.useForm();
  const [createdTicketModal, setCreatedTicketModal] = useState(null);

  // Editar / atender ticket
  const [editingTicket, setEditingTicket] = useState(null);
  const [savingUpdate, setSavingUpdate] = useState(false);
  const [updateForm] = Form.useForm();

  // Configurar datos de soporte (solo Admin/Socio)
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configForm] = Form.useForm();

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [infoRes, ticketsRes] = await Promise.all([
        supportApi.getInfo(),
        supportApi.listTickets({ status: statusFilter }),
      ]);
      setSupportInfo(infoRes.data);
      setTickets(ticketsRes.data || []);
    } catch (err) {
      console.error('Error cargando soporte técnico:', err);
      message.error('No se pudo cargar la información de soporte técnico.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, [statusFilter]);

  useEffect(() => {
    if (selectedClient) {
      ticketForm.setFieldsValue({ client_id: Number(selectedClient) });
    }
  }, [selectedClient, ticketForm]);

  const cfg = supportInfo?.config || {
    support_name: 'Mesa de Ayuda — Iterumx',
    whatsapp_number: '5215500000000',
    support_email: 'soporte@iterumx.com',
    support_phone: '(55) 0000-0000',
    business_hours: 'Lunes a Viernes de 9:00 a 18:00 hrs',
    remote_tool: 'AnyDesk / TeamViewer',
  };

  const diag = supportInfo?.diagnostics || {};

  const formatTicketSummaryText = (t) => {
    return (
      `🛠️ *REPORTE DE SOPORTE TÉCNICO — ${t.folio}*\n` +
      `• *Fecha:* ${t.created_at}\n` +
      `• *Usuario:* ${t.user_full_name} (${t.username})\n` +
      `• *Cliente/Empresa:* ${t.client_name || 'General (Sin cliente específico)'}\n` +
      `• *Módulo:* ${t.module_name || 'General'}\n` +
      `• *Categoría:* ${t.category}\n` +
      `• *Prioridad:* ${t.priority}\n` +
      `• *Estado:* ${t.status}\n` +
      `• *Asunto:* ${t.subject}\n` +
      `• *Descripción:* ${t.description}` +
      (t.resolution_notes ? `\n• *Solución / Notas:* ${t.resolution_notes}` : '')
    );
  };

  const handleSendWhatsAppTicket = (t) => {
    const cleanPhone = (cfg.whatsapp_number || '').replace(/\D/g, '');
    const text = encodeURIComponent(formatTicketSummaryText(t));
    const url = cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${text}`
      : `https://wa.me/?text=${text}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleSendEmailTicket = (t) => {
    const subject = encodeURIComponent(`[${t.folio}] Soporte Técnico (${t.priority}): ${t.subject}`);
    const body = encodeURIComponent(formatTicketSummaryText(t).replace(/\*/g, ''));
    window.location.href = `mailto:${cfg.support_email || ''}?subject=${subject}&body=${body}`;
  };

  const handleCopyTicket = (t) => {
    navigator.clipboard.writeText(formatTicketSummaryText(t).replace(/\*/g, ''));
    message.success(`Reporte ${t.folio} copiado al portapapeles.`);
  };

  const handleDirectWhatsApp = () => {
    const cleanPhone = (cfg.whatsapp_number || '').replace(/\D/g, '');
    const activeClientLabel =
      clients.find((c) => c.value === String(selectedClient))?.label || 'General';
    const text = encodeURIComponent(
      `Hola, solicito apoyo de Soporte Técnico.\n` +
        `• Usuario: ${user?.full_name || user?.username}\n` +
        `• Empresa activa: ${activeClientLabel}\n` +
        `• Detalle de la consulta: `
    );
    const url = cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${text}`
      : `https://wa.me/?text=${text}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleDirectEmail = () => {
    const subject = encodeURIComponent(
      `Solicitud de Soporte Técnico — ${user?.full_name || user?.username}`
    );
    const activeClientLabel =
      clients.find((c) => c.value === String(selectedClient))?.label || 'General';
    const body = encodeURIComponent(
      `Usuario: ${user?.full_name || user?.username}\n` +
        `Empresa activa: ${activeClientLabel}\n` +
        `Navegador: ${navigator.userAgent}\n\n` +
        `Descripción del requerimiento:\n`
    );
    window.location.href = `mailto:${cfg.support_email || ''}?subject=${subject}&body=${body}`;
  };

  const handleCopyDiagnostics = () => {
    const activeClientLabel =
      clients.find((c) => c.value === String(selectedClient))?.label || 'Ninguno seleccionado';
    const text =
      `=== DIAGNÓSTICO TÉCNICO DEL SISTEMA ===\n` +
      `Versión: ${diag.app_version || 'Iterumx'}\n` +
      `Estado API: ${diag.api_status || 'Operativo'}\n` +
      `Base de Datos: ${diag.db_status || 'Conectada'}\n` +
      `Hora Servidor: ${diag.server_time || ''}\n` +
      `Usuario: ${user?.full_name || user?.username} (Rol: ${user?.role})\n` +
      `Cliente Activo: ${activeClientLabel}\n` +
      `URL Actual: ${window.location.origin}\n`;
    navigator.clipboard.writeText(text);
    message.success('Ficha de diagnóstico técnico copiada al portapapeles.');
  };

  const handleCreateTicket = async (values) => {
    setCreatingTicket(true);
    try {
      const res = await supportApi.createTicket(values);
      message.success(`Ticket de soporte ${res.data.folio} registrado exitosamente.`);
      ticketForm.resetFields();
      if (selectedClient) {
        ticketForm.setFieldsValue({
          category: 'Falla o Error en Sistema',
          priority: 'Media',
          client_id: Number(selectedClient),
        });
      }
      setCreatedTicketModal(res.data);
      setActiveTab('tickets');
      await fetchAll();
    } catch (err) {
      message.error(err?.response?.data?.detail || 'No se pudo registrar el ticket de soporte.');
    } finally {
      setCreatingTicket(false);
    }
  };

  const openEditTicketModal = (ticket) => {
    setEditingTicket(ticket);
    updateForm.setFieldsValue({
      status: ticket.status,
      priority: ticket.priority,
      resolution_notes: ticket.resolution_notes || '',
    });
  };

  const handleSaveTicketUpdate = async () => {
    try {
      const values = await updateForm.validateFields();
      setSavingUpdate(true);
      await supportApi.updateTicket(editingTicket.id, values);
      message.success(`Ticket ${editingTicket.folio} actualizado correctamente.`);
      setEditingTicket(null);
      await fetchAll();
    } catch (err) {
      message.error(err?.response?.data?.detail || 'Error al actualizar el ticket.');
    } finally {
      setSavingUpdate(false);
    }
  };

  const handleDeleteTicket = async (id) => {
    try {
      await supportApi.deleteTicket(id);
      message.success('Ticket eliminado.');
      await fetchAll();
    } catch (err) {
      message.error(err?.response?.data?.detail || 'No se pudo eliminar el ticket.');
    }
  };

  const openConfigModal = () => {
    configForm.setFieldsValue(cfg);
    setConfigModalOpen(true);
  };

  const handleSaveConfig = async () => {
    try {
      const values = await configForm.validateFields();
      setSavingConfig(true);
      await supportApi.updateConfig(values);
      message.success('Datos de contacto de Soporte Técnico actualizados.');
      setConfigModalOpen(false);
      await fetchAll();
    } catch (err) {
      message.error(err?.response?.data?.detail || 'No se pudo guardar la configuración.');
    } finally {
      setSavingConfig(false);
    }
  };

  const filteredTickets = tickets.filter((t) => {
    if (!searchText) return true;
    const term = searchText.toLowerCase();
    return (
      (t.folio || '').toLowerCase().includes(term) ||
      (t.subject || '').toLowerCase().includes(term) ||
      (t.description || '').toLowerCase().includes(term) ||
      (t.user_full_name || '').toLowerCase().includes(term) ||
      (t.client_name || '').toLowerCase().includes(term) ||
      (t.module_name || '').toLowerCase().includes(term)
    );
  });

  const priorityTag = (p) => {
    const colors = {
      Baja: 'default',
      Media: 'blue',
      Alta: 'orange',
      Urgente: 'red',
    };
    return <Tag color={colors[p] || 'blue'}>{p}</Tag>;
  };

  const statusTag = (s) => {
    const colors = {
      Abierto: 'processing',
      'En Proceso': 'warning',
      Resuelto: 'success',
      Cerrado: 'default',
    };
    return <Tag color={colors[s] || 'default'} className="font-semibold">{s}</Tag>;
  };

  const columns = [
    {
      title: 'Folio',
      dataIndex: 'folio',
      key: 'folio',
      width: 145,
      render: (f) => <span className="font-mono font-bold text-xs text-blue-800">{f}</span>,
    },
    {
      title: 'Fecha',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 130,
      render: (d) => <span className="text-xs text-gray-600">{d}</span>,
    },
    {
      title: 'Usuario / Cliente',
      key: 'user_client',
      width: 210,
      render: (_, r) => (
        <div>
          <div className="font-semibold text-xs text-gray-800">{r.user_full_name}</div>
          <div className="text-[11px] text-gray-500 truncate max-w-[195px]">
            {r.client_name || 'Consulta General'}
          </div>
        </div>
      ),
    },
    {
      title: 'Módulo / Categoría',
      key: 'mod_cat',
      width: 200,
      render: (_, r) => (
        <div>
          <div className="text-xs font-medium text-indigo-800">{r.module_name || 'General'}</div>
          <div className="text-[11px] text-gray-500">{r.category}</div>
        </div>
      ),
    },
    {
      title: 'Asunto y Descripción',
      key: 'subject',
      render: (_, r) => (
        <div>
          <div className="font-semibold text-xs text-gray-900">{r.subject}</div>
          <div className="text-xs text-gray-600 whitespace-pre-line">{r.description}</div>
          {r.resolution_notes && (
            <div className="mt-1 p-1.5 bg-emerald-50 border border-emerald-200 rounded text-[11px] text-emerald-900">
              <strong>Respuesta / Solución:</strong> {r.resolution_notes}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Prioridad',
      dataIndex: 'priority',
      key: 'priority',
      width: 95,
      align: 'center',
      render: priorityTag,
    },
    {
      title: 'Estado',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      align: 'center',
      render: statusTag,
    },
    {
      title: 'Acciones',
      key: 'actions',
      width: 165,
      align: 'center',
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="Enviar ticket por WhatsApp">
            <Button
              size="small"
              icon={<WhatsAppOutlined />}
              onClick={() => handleSendWhatsAppTicket(r)}
              className="text-emerald-600 border-emerald-300 hover:bg-emerald-50"
            />
          </Tooltip>
          <Tooltip title="Enviar ticket por Correo">
            <Button
              size="small"
              icon={<MailOutlined />}
              onClick={() => handleSendEmailTicket(r)}
              className="text-blue-600 border-blue-300 hover:bg-blue-50"
            />
          </Tooltip>
          <Tooltip title="Copiar resumen del ticket">
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() => handleCopyTicket(r)}
            />
          </Tooltip>
          {user?.role !== 'client' && (
            <Tooltip title="Actualizar estado / Agregar nota de solución">
              <Button
                size="small"
                type="primary"
                ghost
                icon={<EditOutlined />}
                onClick={() => openEditTicketModal(r)}
              />
            </Tooltip>
          )}
          {user?.role === 'admin' && (
            <Popconfirm
              title="¿Eliminar este ticket de soporte?"
              onConfirm={() => handleDeleteTicket(r.id)}
              okText="Sí, eliminar"
              cancelText="Cancelar"
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const faqItems = [
    {
      key: '1',
      label: '¿Cómo cambiar de empresa o cliente activo en el sistema?',
      children: (
        <p className="text-xs text-gray-700 m-0">
          Por seguridad contable, el selector de clientes únicamente se encuentra habilitado en la pantalla de{' '}
          <strong>Inicio</strong>. Si se encuentra dentro de cualquier otro módulo, presione el botón{' '}
          <strong>"Cambiar en Inicio"</strong> ubicado en la barra superior para regresar al tablero principal y elegir otra empresa.
        </p>
      ),
    },
    {
      key: '2',
      label: '¿Cómo contabilizar CFDI Emitidos, Recibidos y de Nómina?',
      children: (
        <p className="text-xs text-gray-700 m-0">
          En el módulo <strong>Cargar CFDI</strong> existen tres pestañas independientes: <em>CFDI Emitidos</em>,{' '}
          <em>CFDI Recibidos</em> y <em>CFDI de Nómina</em>. Arrastre los archivos XML en la pestaña correspondiente; el sistema recordará la cuenta contable por RFC y clave SAT, y en el caso de Nómina registrará automáticamente las percepciones, el ISR retenido (<code>216-01-000</code>), IMSS y la provisión de sueldos por pagar (<code>210-01-000</code>).
        </p>
      ),
    },
    {
      key: '3',
      label: '¿Cómo autorizar la baja de un cliente o la suspensión de un auxiliar?',
      children: (
        <p className="text-xs text-gray-700 m-0">
          El socio/titular puede ingresar al módulo <strong>Contraseñas Temporales</strong> y generar un código aleatorio de 32 dígitos con vigencia por minutos, horas, días o meses. Dicho código se utiliza al dar de baja un cliente o cambiar el acceso de un usuario auxiliar.
        </p>
      ),
    },
    {
      key: '4',
      label: '¿Cómo generar un respaldo completo de un cliente?',
      children: (
        <p className="text-xs text-gray-700 m-0">
          En el módulo <strong>Clientes</strong>, utilice el botón de <strong>Respaldo (.json)</strong> en la fila del cliente deseado para descargar su catálogo de cuentas, pólizas, CFDIs y activos fijos, o el botón de <strong>Restaurar</strong> para recuperar un respaldo previo.
        </p>
      ),
    },
  ];

  return (
    <div className="p-2">
      {/* Encabezado */}
      <div className="flex flex-wrap justify-between items-center mb-5 gap-4">
        <div>
          <Title level={2} className="m-0 flex items-center gap-2">
            <CustomerServiceOutlined className="text-blue-600" />
            Centro de Soporte Técnico y Mesa de Ayuda
          </Title>
          <Text type="secondary" className="text-sm">
            {cfg.support_name} • Horario: {cfg.business_hours}
          </Text>
        </div>

        <Space wrap>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setActiveTab('nuevo')}
            className="bg-blue-600 hover:bg-blue-700 font-semibold"
          >
            Levantar Nuevo Ticket
          </Button>
          {user?.role === 'admin' && (
            <Button icon={<SettingOutlined />} onClick={openConfigModal}>
              Configurar Datos de Contacto
            </Button>
          )}
          <Button icon={<ReloadOutlined />} onClick={fetchAll} loading={loading}>
            Actualizar
          </Button>
        </Space>
      </div>

      {/* Tarjetas de Canales de Contacto y Diagnóstico */}
      <Row gutter={[16, 16]} className="mb-6">
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" className="shadow-sm border-emerald-200 bg-emerald-50/30 h-full">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-bold text-emerald-800 uppercase">Soporte vía WhatsApp</div>
                <div className="text-base font-bold text-gray-900 mt-1">{cfg.whatsapp_number}</div>
                <div className="text-xs text-gray-500 mt-0.5">Atención rápida y envío de capturas</div>
              </div>
              <WhatsAppOutlined className="text-2xl text-emerald-600" />
            </div>
            <Button
              type="primary"
              size="small"
              icon={<WhatsAppOutlined />}
              onClick={handleDirectWhatsApp}
              className="mt-3 w-full bg-emerald-600 hover:bg-emerald-700 border-emerald-600 font-semibold"
            >
              Iniciar Chat por WhatsApp
            </Button>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card size="small" className="shadow-sm border-blue-200 bg-blue-50/30 h-full">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-bold text-blue-800 uppercase">Correo Electrónico</div>
                <div className="text-sm font-bold text-gray-900 mt-1 break-all">{cfg.support_email}</div>
                <div className="text-xs text-gray-500 mt-0.5">Envío de archivos XML o reportes</div>
              </div>
              <MailOutlined className="text-2xl text-blue-600" />
            </div>
            <Button
              type="primary"
              size="small"
              icon={<MailOutlined />}
              onClick={handleDirectEmail}
              className="mt-3 w-full font-semibold"
            >
              Redactar Correo a Soporte
            </Button>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card size="small" className="shadow-sm border-indigo-200 bg-indigo-50/30 h-full">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-bold text-indigo-800 uppercase">Teléfono y Asistencia Remota</div>
                <div className="text-base font-bold text-gray-900 mt-1">{cfg.support_phone}</div>
                <div className="text-xs text-gray-600 mt-0.5">
                  <DesktopOutlined className="mr-1" />
                  Remoto: <strong>{cfg.remote_tool}</strong>
                </div>
              </div>
              <PhoneOutlined className="text-2xl text-indigo-600" />
            </div>
            <div className="mt-3 text-[11px] text-indigo-900 bg-indigo-100/70 px-2 py-1 rounded">
              Horario: {cfg.business_hours}
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card size="small" className="shadow-sm border-slate-200 bg-slate-50/60 h-full">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-bold text-slate-700 uppercase">Estado del Sistema</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <Badge status="success" />
                  <span className="text-xs font-semibold text-emerald-700">
                    {diag.api_status || 'Operativo (En línea)'}
                  </span>
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {diag.app_version || 'Iterumx'} • {diag.db_status || 'Multi-Empresa Conectada'}
                </div>
              </div>
              <ToolOutlined className="text-xl text-slate-600" />
            </div>
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={handleCopyDiagnostics}
              className="mt-3 w-full text-xs"
            >
              Copiar Ficha de Diagnóstico
            </Button>
          </Card>
        </Col>
      </Row>

      {/* Pestañas Principales */}
      <Card className="shadow-sm">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'tickets',
              label: (
                <span
                  className="font-semibold text-sm px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-all"
                  style={
                    activeTab === 'tickets'
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
                  🎫 Historial de Tickets de Soporte ({tickets.length})
                </span>
              ),
              children: (
                <div>
                  <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                    <Space wrap>
                      <span className="text-xs font-semibold text-gray-600">Estado:</span>
                      <Select
                        value={statusFilter}
                        onChange={setStatusFilter}
                        style={{ width: 170 }}
                        size="middle"
                      >
                        <Option value="all">Todos los estados</Option>
                        <Option value="Abierto">Abierto</Option>
                        <Option value="En Proceso">En Proceso</Option>
                        <Option value="Resuelto">Resuelto</Option>
                        <Option value="Cerrado">Cerrado</Option>
                      </Select>
                    </Space>

                    <Input
                      placeholder="Buscar por folio, asunto, módulo o usuario..."
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      style={{ width: 300 }}
                      allowClear
                    />
                  </div>

                  <Table
                    dataSource={filteredTickets}
                    columns={columns}
                    rowKey="id"
                    size="small"
                    loading={loading}
                    pagination={{ pageSize: 15 }}
                    scroll={{ x: 1050 }}
                  />
                </div>
              ),
            },
            {
              key: 'nuevo',
              label: (
                <span
                  className="font-semibold text-sm px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-all"
                  style={
                    activeTab === 'nuevo'
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
                  <PlusOutlined className="mr-1" />
                  Levantar Nuevo Reporte / Ticket
                </span>
              ),
              children: (
                <div className="max-w-3xl">
                  <Alert
                    type="info"
                    showIcon
                    className="mb-4"
                    message="Registre su solicitud o reporte técnico. Al guardar el ticket se generará un folio único que podrá enviar con un clic por WhatsApp o Correo Electrónico al equipo de soporte."
                  />
                  <Form
                    form={ticketForm}
                    layout="vertical"
                    onFinish={handleCreateTicket}
                    initialValues={{
                      category: 'Falla o Error en Sistema',
                      priority: 'Media',
                      module_name: 'General / Inicio',
                      client_id: selectedClient ? Number(selectedClient) : undefined,
                    }}
                  >
                    <Row gutter={16}>
                      <Col xs={24} sm={12}>
                        <Form.Item
                          name="category"
                          label="Categoría del Reporte"
                          rules={[{ required: true, message: 'Seleccione una categoría' }]}
                        >
                          <Select>
                            {CATEGORY_OPTIONS.map((c) => (
                              <Option key={c} value={c}>{c}</Option>
                            ))}
                          </Select>
                        </Form.Item>
                      </Col>

                      <Col xs={24} sm={12}>
                        <Form.Item
                          name="priority"
                          label="Nivel de Prioridad"
                          rules={[{ required: true, message: 'Seleccione la prioridad' }]}
                        >
                          <Select>
                            <Option value="Baja">Baja — Consulta general</Option>
                            <Option value="Media">Media — Afectación parcial</Option>
                            <Option value="Alta">Alta — Requiere atención pronta</Option>
                            <Option value="Urgente">Urgente — Bloqueo operativo</Option>
                          </Select>
                        </Form.Item>
                      </Col>

                      <Col xs={24} sm={12}>
                        <Form.Item name="module_name" label="Módulo del Sistema Relacionado">
                          <Select showSearch>
                            {MODULE_OPTIONS.map((m) => (
                              <Option key={m} value={m}>{m}</Option>
                            ))}
                          </Select>
                        </Form.Item>
                      </Col>

                      <Col xs={24} sm={12}>
                        <Form.Item name="client_id" label="Empresa / Cliente Relacionado (Opcional)">
                          <Select
                            allowClear
                            showSearch
                            placeholder="Seleccionar cliente si aplica"
                            options={clients.map((c) => ({
                              value: Number(c.value),
                              label: c.label,
                            }))}
                            filterOption={(input, option) =>
                              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                            }
                          />
                        </Form.Item>
                      </Col>

                      <Col xs={24}>
                        <Form.Item
                          name="subject"
                          label="Asunto Breve"
                          rules={[{ required: true, message: 'Ingrese el asunto del reporte' }]}
                        >
                          <Input placeholder="Ej. Duda en asiento de nómina o ajuste en reporte mensual..." maxLength={200} />
                        </Form.Item>
                      </Col>

                      <Col xs={24}>
                        <Form.Item
                          name="description"
                          label="Descripción Detallada del Problema o Solicitud"
                          rules={[{ required: true, message: 'Describa el detalle del requerimiento' }]}
                        >
                          <TextArea
                            rows={4}
                            placeholder="Describa qué acción estaba realizando, el número de póliza o UUID de CFDI involucrado y qué resultado esperaba..."
                          />
                        </Form.Item>
                      </Col>
                    </Row>

                    <div className="flex justify-end gap-2">
                      <Button onClick={() => setActiveTab('tickets')}>Cancelar</Button>
                      <Button
                        type="primary"
                        htmlType="submit"
                        icon={<SendOutlined />}
                        loading={creatingTicket}
                        className="bg-blue-600 hover:bg-blue-700 font-semibold"
                      >
                        Registrar Ticket de Soporte
                      </Button>
                    </div>
                  </Form>
                </div>
              ),
            },
            {
              key: 'faq',
              label: (
                <span
                  className="font-semibold text-sm px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-all"
                  style={
                    activeTab === 'faq'
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
                  <QuestionCircleOutlined className="mr-1" />
                  Guía Rápida y Preguntas Frecuentes
                </span>
              ),
              children: <Collapse items={faqItems} defaultActiveKey={['1', '2']} />,
            },
          ]}
        />
      </Card>

      {/* Modal cuando se crea un ticket para enviarlo por WhatsApp o Correo */}
      <Modal
        title={
          <span className="text-emerald-700 font-bold">
            <CheckCircleOutlined className="mr-2" />
            Ticket {createdTicketModal?.folio} Registrado
          </span>
        }
        open={Boolean(createdTicketModal)}
        onCancel={() => setCreatedTicketModal(null)}
        footer={[
          <Button key="close" onClick={() => setCreatedTicketModal(null)}>
            Cerrar
          </Button>,
          <Button
            key="copy"
            icon={<CopyOutlined />}
            onClick={() => handleCopyTicket(createdTicketModal)}
          >
            Copiar Texto
          </Button>,
          <Button
            key="email"
            icon={<MailOutlined />}
            onClick={() => handleSendEmailTicket(createdTicketModal)}
          >
            Enviar por Correo
          </Button>,
          <Button
            key="wa"
            type="primary"
            icon={<WhatsAppOutlined />}
            className="bg-emerald-600 hover:bg-emerald-700 border-emerald-600"
            onClick={() => handleSendWhatsAppTicket(createdTicketModal)}
          >
            Enviar por WhatsApp
          </Button>,
        ]}
      >
        {createdTicketModal && (
          <div className="space-y-2 text-xs text-gray-700">
            <p>
              Su reporte ha quedado guardado en la bitácora de soporte con el folio{' '}
              <strong className="font-mono text-blue-700">{createdTicketModal.folio}</strong>.
            </p>
            <pre className="p-3 bg-slate-50 border rounded whitespace-pre-wrap font-sans text-xs">
              {formatTicketSummaryText(createdTicketModal).replace(/\*/g, '')}
            </pre>
          </div>
        )}
      </Modal>

      {/* Modal para actualizar estado y nota de solución de un ticket */}
      <Modal
        title={`Atender Ticket ${editingTicket?.folio || ''}`}
        open={Boolean(editingTicket)}
        onCancel={() => setEditingTicket(null)}
        onOk={handleSaveTicketUpdate}
        confirmLoading={savingUpdate}
        okText="Guardar Cambios"
        cancelText="Cancelar"
      >
        <Form form={updateForm} layout="vertical">
          <Form.Item name="status" label="Estado del Ticket" rules={[{ required: true }]}>
            <Select>
              <Option value="Abierto">Abierto</Option>
              <Option value="En Proceso">En Proceso</Option>
              <Option value="Resuelto">Resuelto</Option>
              <Option value="Cerrado">Cerrado</Option>
            </Select>
          </Form.Item>
          <Form.Item name="priority" label="Prioridad" rules={[{ required: true }]}>
            <Select>
              <Option value="Baja">Baja</Option>
              <Option value="Media">Media</Option>
              <Option value="Alta">Alta</Option>
              <Option value="Urgente">Urgente</Option>
            </Select>
          </Form.Item>
          <Form.Item name="resolution_notes" label="Notas de Solución / Respuesta Técnica">
            <TextArea rows={4} placeholder="Escriba la respuesta o acciones aplicadas para resolver este ticket..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal para configurar los datos de contacto de soporte (solo Socio/Titular) */}
      <Modal
        title="Configurar Canales de Soporte Técnico"
        open={configModalOpen}
        onCancel={() => setConfigModalOpen(false)}
        onOk={handleSaveConfig}
        confirmLoading={savingConfig}
        okText="Guardar Configuración"
        cancelText="Cancelar"
      >
        <Form form={configForm} layout="vertical">
          <Form.Item
            name="support_name"
            label="Nombre del Área o Responsable de Soporte"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="whatsapp_number"
            label="Número de WhatsApp (con lada internacional, ej. 5215512345678)"
            rules={[{ required: true }]}
          >
            <Input placeholder="521..." />
          </Form.Item>
          <Form.Item
            name="support_email"
            label="Correo Electrónico de Soporte"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="support_phone"
            label="Teléfono de Atención"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="business_hours"
            label="Horario de Atención"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="remote_tool"
            label="Herramienta de Asistencia Remota"
            rules={[{ required: true }]}
          >
            <Input placeholder="AnyDesk / TeamViewer" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default TechnicalSupport;
