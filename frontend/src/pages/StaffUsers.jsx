import React, { useState, useEffect } from 'react';
import {
  Table, Button, Input, Modal, Form, Select, Switch, Tag, Space,
  Avatar, Tooltip, Popconfirm, message, Alert, Card, Row, Col, AutoComplete, Upload
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, UserDeleteOutlined, UserOutlined, MailOutlined,
  PhoneOutlined, KeyOutlined, StopOutlined, CheckCircleOutlined,
  CameraOutlined, CopyOutlined, ReloadOutlined, TeamOutlined,
  SafetyCertificateOutlined, IdcardOutlined
} from '@ant-design/icons';
import { Navigate } from 'react-router-dom';
import { usersApi, clientsApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const { Option } = Select;

const POSITION_OPTIONS = [
  { value: 'Auxiliar Contable' },
  { value: 'Contador General' },
  { value: 'Contador Fiscal' },
  { value: 'Supervisor Contable' },
  { value: 'Auxiliar de Nóminas e IMSS' },
  { value: 'Auditor Fiscal' },
  { value: 'Practicante Contable' },
  { value: 'Gerente de Despacho' },
  { value: 'Socio / Titular' },
];

// Comprime y recorta una imagen seleccionada a un DataURL ligero (160x160)
const resizeImageToDataUrl = (file, maxSize = 160) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext('2d');

        // Recorte cuadrado centrado (cover)
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, maxSize, maxSize);
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, maxSize, maxSize);

        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const StaffUsers = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchText, setSearchText] = useState('');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [selectedAssignedClientIds, setSelectedAssignedClientIds] = useState([]);
  const [form] = Form.useForm();

  // Baja / Suspensión con contraseña temporal de 32 dígitos (UUID)
  const [bajaModalOpen, setBajaModalOpen] = useState(false);
  const [bajaActionType, setBajaActionType] = useState('delete'); // 'delete' | 'suspend'
  const [bajaTargetUser, setBajaTargetUser] = useState(null);
  const [bajaTempPassword, setBajaTempPassword] = useState('');
  const [executingBaja, setExecutingBaja] = useState(false);

  const isAdmin = currentUser?.role === 'admin';

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersRes, clientsRes] = await Promise.all([
        usersApi.list(),
        clientsApi.list({ limit: 1000 }),
      ]);
      setUsers(usersRes.data || []);
      setClients(clientsRes.data || []);
    } catch (err) {
      message.error('Error al cargar los usuarios del despacho');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const generateCustomPassword = () => {
    const adjectives = ['Conta', 'Fiscal', 'Auxiliar', 'Despacho', 'Gestion'];
    const symbols = ['#', '!', '$', '*'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const sym = symbols[Math.floor(Math.random() * symbols.length)];
    const digits = Math.floor(1000 + Math.random() * 9000);
    const pwd = `${adj}${sym}${digits}`;
    setGeneratedPassword(pwd);
    form.setFieldsValue({ password: pwd });
    message.info(`Contraseña generada: ${pwd}`);
  };

  const handleCopyPassword = () => {
    const pwd = form.getFieldValue('password');
    if (!pwd) {
      message.warning('Primero escriba o genere una contraseña');
      return;
    }
    navigator.clipboard.writeText(pwd);
    message.success('Contraseña copiada al portapapeles');
  };

  const handlePhotoUpload = async (file) => {
    const isImage = file.type.startsWith('image/');
    if (!isImage) {
      message.error('Solo se permiten archivos de imagen (JPG, PNG, WEBP)');
      return Upload.LIST_IGNORE;
    }
    try {
      const dataUrl = await resizeImageToDataUrl(file, 160);
      setPhotoPreview(dataUrl);
      form.setFieldsValue({ photo_url: dataUrl });
    } catch (e) {
      message.error('No se pudo procesar la foto seleccionada');
    }
    return false; // Evitar subida automática por HTTP
  };

  const openModal = (record = null) => {
    setEditingUser(record);
    setGeneratedPassword('');
    if (record) {
      const cleanIds = (record.assigned_client_ids || []).map(Number).filter(n => !Number.isNaN(n));
      setSelectedAssignedClientIds(cleanIds);
      setPhotoPreview(record.photo_url || null);
      setModalOpen(true);
      setTimeout(() => {
        form.setFieldsValue({
          username: record.username,
          full_name: record.full_name || '',
          position: record.position || 'Auxiliar Contable',
          email: record.email || '',
          phone: record.phone || '',
          photo_url: record.photo_url || null,
          can_create_clients: Boolean(record.can_create_clients),
          assigned_client_ids: cleanIds,
          role: record.role || 'accountant',
          is_active: record.is_active !== false,
          password: '',
        });
      }, 0);
    } else {
      setSelectedAssignedClientIds([]);
      setPhotoPreview(null);
      const defaultPwd = `Auxiliar#${Math.floor(1000 + Math.random() * 9000)}`;
      setGeneratedPassword(defaultPwd);
      setModalOpen(true);
      setTimeout(() => {
        form.resetFields();
        form.setFieldsValue({
          position: 'Auxiliar Contable',
          role: 'accountant',
          can_create_clients: false,
          assigned_client_ids: [],
          is_active: true,
          password: defaultPwd,
        });
      }, 0);
    }
  };

  const handleSaveUser = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const cleanClientIds = (selectedAssignedClientIds || []).map(Number).filter(n => !Number.isNaN(n));
      const payload = {
        ...values,
        photo_url: photoPreview || null,
        assigned_client_ids: cleanClientIds,
      };

      if (editingUser) {
        if (!payload.password || !payload.password.trim()) {
          delete payload.password;
        }
        await usersApi.update(editingUser.id, payload);
        message.success(`Datos de ${values.full_name || values.username} actualizados exitosamente.`);
      } else {
        await usersApi.create(payload);
        message.success(`Usuario "${values.username}" dado de alta exitosamente.`);
      }
      setModalOpen(false);
      await fetchData();
    } catch (err) {
      if (err?.errorFields) return;
      const detail = err?.response?.data?.detail || 'Error al guardar el usuario';
      message.error(detail);
    } finally {
      setSaving(false);
    }
  };

  const openBajaModal = (record, actionType = 'delete') => {
    setBajaTargetUser(record);
    setBajaActionType(actionType);
    setBajaTempPassword('');
    setBajaModalOpen(true);
  };

  const handleToggleAccess = async (record) => {
    if (record.is_active) {
      openBajaModal(record, 'suspend');
      return;
    }
    try {
      await usersApi.toggleAccess(record.id, true);
      message.success(`Acceso reactivado para ${record.full_name || record.username}`);
      await fetchData();
    } catch (err) {
      message.error(err?.response?.data?.detail || 'Error al cambiar el estado de acceso');
    }
  };

  const handleQuickToggleCreateClients = async (record, checked) => {
    try {
      await usersApi.update(record.id, { can_create_clients: checked });
      message.success(
        checked
          ? `${record.full_name || record.username} ahora tiene permiso para dar de alta clientes.`
          : `Se retiró el permiso de dar de alta clientes a ${record.full_name || record.username}.`
      );
      await fetchData();
    } catch (err) {
      message.error(err?.response?.data?.detail || 'Error al actualizar permiso');
    }
  };

  const handleExecuteBajaModal = async () => {
    if (!bajaTargetUser) return;
    if (!bajaTempPassword || !bajaTempPassword.trim()) {
      message.warning('Ingrese la contraseña temporal de 32 dígitos (UUID) para autorizar la baja.');
      return;
    }
    setExecutingBaja(true);
    try {
      if (bajaActionType === 'suspend') {
        await usersApi.toggleAccess(bajaTargetUser.id, false, bajaTempPassword.trim());
        message.success(`Acceso suspendido para ${bajaTargetUser.full_name || bajaTargetUser.username}`);
      } else {
        await usersApi.delete(bajaTargetUser.id, bajaTempPassword.trim());
        message.success(`Usuario ${bajaTargetUser.full_name || bajaTargetUser.username} dado de baja exitosamente.`);
        if (modalOpen && editingUser?.id === bajaTargetUser.id) {
          setModalOpen(false);
        }
      }
      setBajaModalOpen(false);
      setBajaTargetUser(null);
      setBajaTempPassword('');
      await fetchData();
    } catch (err) {
      message.error(err?.response?.data?.detail || 'Error al ejecutar la baja del usuario');
    } finally {
      setExecutingBaja(false);
    }
  };

  const clientsMap = React.useMemo(() => {
    const map = {};
    clients.forEach(c => {
      map[c.id] = c;
    });
    return map;
  }, [clients]);

  const filteredUsers = users.filter(u => {
    if (!searchText.trim()) return true;
    const q = searchText.toLowerCase();
    return (
      (u.username || '').toLowerCase().includes(q) ||
      (u.full_name || '').toLowerCase().includes(q) ||
      (u.position || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.phone || '').toLowerCase().includes(q)
    );
  });

  const columns = [
    {
      title: 'Usuario / Auxiliar',
      key: 'user',
      width: 260,
      render: (_, record) => (
        <div className="flex items-center gap-3">
          <Avatar
            size={48}
            src={record.photo_url || undefined}
            icon={!record.photo_url && <UserOutlined />}
            className="border border-blue-200 bg-blue-50 text-blue-600 flex-shrink-0"
          />
          <div className="min-w-0">
            <div className="font-bold text-gray-800 truncate">
              {record.full_name || record.username}
            </div>
            <div className="text-xs text-gray-500 font-mono">
              @{record.username}
            </div>
            {record.role === 'admin' && (
              <Tag color="gold" className="mt-0.5 text-[10px] font-semibold">
                TITULAR / ADMIN
              </Tag>
            )}
          </div>
        </div>
      ),
    },
    {
      title: 'Puesto',
      dataIndex: 'position',
      key: 'position',
      width: 170,
      render: (pos, record) => (
        <Tag color={record.role === 'admin' ? 'purple' : 'blue'} className="font-medium">
          <IdcardOutlined className="mr-1" />
          {pos || (record.role === 'admin' ? 'Socio / Titular' : 'Auxiliar Contable')}
        </Tag>
      ),
    },
    {
      title: 'Contacto (Correo y Teléfono)',
      key: 'contact',
      width: 230,
      render: (_, record) => (
        <div className="text-xs space-y-1">
          <div className="flex items-center gap-1.5 text-gray-700">
            <MailOutlined className="text-blue-500" />
            <span>{record.email || <span className="text-gray-400">Sin correo</span>}</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-700">
            <PhoneOutlined className="text-green-600" />
            <span>{record.phone || <span className="text-gray-400">Sin teléfono</span>}</span>
          </div>
        </div>
      ),
    },
    {
      title: 'Clientes Asignados',
      key: 'assigned_clients',
      render: (_, record) => {
        if (record.role === 'admin') {
          return (
            <Tag color="geekblue" className="font-semibold">
              Acceso Total ({clients.length} clientes)
            </Tag>
          );
        }
        const ids = record.assigned_client_ids || [];
        if (ids.length === 0) {
          return <span className="text-xs text-amber-600 font-medium">Sin clientes asignados</span>;
        }
        return (
          <div className="flex flex-wrap gap-1 max-w-xs">
            {ids.slice(0, 3).map(cid => {
              const c = clientsMap[cid];
              return (
                <Tag key={cid} color="cyan" className="text-xs m-0">
                  {c ? `${c.business_name}` : `ID #${cid}`}
                </Tag>
              );
            })}
            {ids.length > 3 && (
              <Tooltip
                title={ids
                  .slice(3)
                  .map(cid => clientsMap[cid]?.business_name || `ID #${cid}`)
                  .join(', ')}
              >
                <Tag color="blue" className="text-xs m-0 cursor-pointer">
                  +{ids.length - 3} más
                </Tag>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      title: 'Permiso Alta Clientes',
      key: 'can_create_clients',
      width: 170,
      align: 'center',
      render: (_, record) => {
        if (record.role === 'admin') {
          return <Tag color="green">Autorizado (Admin)</Tag>;
        }
        return (
          <Tooltip title="Activar o desactivar permiso para que este auxiliar pueda dar de alta nuevos clientes">
            <Switch
              checked={Boolean(record.can_create_clients)}
              disabled={!isAdmin}
              onChange={(checked) => handleQuickToggleCreateClients(record, checked)}
              checkedChildren="Sí puede"
              unCheckedChildren="No"
            />
          </Tooltip>
        );
      },
    },
    {
      title: 'Estado de Acceso',
      key: 'is_active',
      width: 150,
      align: 'center',
      render: (_, record) =>
        record.is_active ? (
          <Tag icon={<CheckCircleOutlined />} color="success" className="font-semibold">
            ACCESO ACTIVO
          </Tag>
        ) : (
          <Tag icon={<StopOutlined />} color="error" className="font-semibold">
            ACCESO CANCELADO
          </Tag>
        ),
    },
    {
      title: 'Acciones',
      key: 'actions',
      width: 150,
      align: 'center',
      render: (_, record) => {
        const isSelf = record.id === currentUser?.id;
        return (
          <Space size="middle">
            <Tooltip title="Editar usuario, clientes asignados o cambiar contraseña">
              <Button
                icon={<EditOutlined />}
                disabled={!isAdmin}
                onClick={() => openModal(record)}
              />
            </Tooltip>

            {isSelf ? (
              <Tooltip title="Cancelar acceso (No disponible para su propio usuario en sesión)">
                <Button
                  icon={<StopOutlined className="text-amber-600" />}
                  onClick={() =>
                    message.warning('No puede cancelar el acceso de su propio usuario administrador en sesión.')
                  }
                />
              </Tooltip>
            ) : record.is_active ? (
              <Tooltip title="Cancelar / suspender acceso (Requiere contraseña temporal de 32 dígitos)">
                <Button
                  icon={<StopOutlined className="text-amber-600" />}
                  onClick={() => openBajaModal(record, 'suspend')}
                />
              </Tooltip>
            ) : (
              <Popconfirm
                title={`¿Reactivar el acceso de ${record.full_name || record.username}?`}
                description="El usuario podrá volver a iniciar sesión con sus clientes asignados."
                onConfirm={() => handleToggleAccess(record)}
                okText="Sí, reactivar"
                cancelText="No"
              >
                <Tooltip title="Reactivar acceso">
                  <Button icon={<CheckCircleOutlined className="text-green-600" />} />
                </Tooltip>
              </Popconfirm>
            )}

            {isSelf ? (
              <Tooltip title="Dar de baja usuario (No disponible para su propio usuario en sesión)">
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    message.warning('No puede dar de baja su propio usuario administrador en sesión.')
                  }
                />
              </Tooltip>
            ) : (
              <Tooltip title="Dar de baja usuario (Requiere contraseña temporal de 32 dígitos)">
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => openBajaModal(record, 'delete')}
                />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  if (currentUser && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 m-0 flex items-center gap-2">
            <TeamOutlined className="text-blue-600" />
            Usuarios y Auxiliares del Despacho
          </h1>
          <p className="text-gray-500 m-0 text-sm">
            Administre a sus auxiliares contables, asigne los clientes con los que pueden trabajar, sus permisos y contraseñas de acceso.
          </p>
        </div>

        {isAdmin && (
          <Button
            type="primary"
            size="middle"
            icon={<PlusOutlined />}
            onClick={() => openModal(null)}
          >
            Dar de Alta Usuario / Auxiliar
          </Button>
        )}
      </div>

      {/* Barra de búsqueda */}
      <Card size="small" className="mb-4 shadow-sm">
        <Row gutter={16} align="middle" justify="space-between">
          <Col xs={24} md={10}>
            <Input.Search
              placeholder="Buscar por nombre, usuario, puesto, correo o teléfono..."
              allowClear
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </Col>
          <Col>
            <Space size="middle" className="text-xs text-gray-500">
              <span>
                Total usuarios: <strong className="text-gray-800">{users.length}</strong>
              </span>
              <span>
                Con acceso activo:{' '}
                <strong className="text-green-600">
                  {users.filter(u => u.is_active).length}
                </strong>
              </span>
              <span>
                Acceso cancelado:{' '}
                <strong className="text-red-600">
                  {users.filter(u => !u.is_active).length}
                </strong>
              </span>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* Tabla */}
      <Card size="small" className="shadow-sm">
        <Table
          columns={columns}
          dataSource={filteredUsers}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* Modal de Alta / Edición de Usuario del Despacho */}
      <Modal
        title={
          <div className="flex items-center gap-2 border-b pb-3 mb-2">
            <IdcardOutlined className="text-blue-600 text-xl" />
            <div>
              <span className="font-bold text-lg text-gray-800">
                {editingUser
                  ? `Editar Usuario del Despacho (@${editingUser.username})`
                  : 'Dar de Alta Nuevo Usuario / Auxiliar del Despacho'}
              </span>
              <p className="text-xs text-gray-500 m-0 font-normal">
                Configure sus datos personales, puesto, foto, contraseña, permiso de alta de clientes y empresas asignadas.
              </p>
            </div>
          </div>
        }
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        width={780}
        centered
        destroyOnClose
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              {editingUser && (
                editingUser.id === currentUser?.id ? (
                  <Tooltip title="No puede dar de baja su propio usuario administrador en sesión">
                    <Button
                      danger
                      type="primary"
                      icon={<UserDeleteOutlined />}
                      style={{ backgroundColor: '#dc2626', borderColor: '#dc2626', color: '#ffffff', fontWeight: 600 }}
                      onClick={() =>
                        message.warning('No puede dar de baja su propio usuario administrador en sesión.')
                      }
                    >
                      Dar de Baja Usuario
                    </Button>
                  </Tooltip>
                ) : (
                  <Button
                    danger
                    type="primary"
                    icon={<UserDeleteOutlined />}
                    style={{ backgroundColor: '#dc2626', borderColor: '#dc2626', color: '#ffffff', fontWeight: 600 }}
                    onClick={() => openBajaModal(editingUser, 'delete')}
                  >
                    Dar de Baja Usuario
                  </Button>
                )
              )}
            </div>
            <Space>
              <Button onClick={() => setModalOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="primary"
                loading={saving}
                onClick={handleSaveUser}
              >
                {editingUser ? 'Guardar Cambios' : 'Crear Usuario'}
              </Button>
            </Space>
          </div>
        }
      >
        <Form form={form} layout="vertical">
          {/* Sección superior: Foto de Perfil + Datos principales */}
          <Row gutter={20} align="middle" className="mb-2">
            <Col xs={24} sm={6} className="text-center">
              <div className="flex flex-col items-center p-3 bg-gray-50 rounded-lg border border-gray-200">
                <Avatar
                  size={84}
                  src={photoPreview || undefined}
                  icon={!photoPreview && <UserOutlined />}
                  className="mb-2 border-2 border-blue-300 bg-blue-50 text-blue-600 shadow-sm"
                />
                <Upload
                  showUploadList={false}
                  accept="image/*"
                  beforeUpload={handlePhotoUpload}
                >
                  <Button size="small" icon={<CameraOutlined />} className="text-xs">
                    {photoPreview ? 'Cambiar Foto' : 'Subir Foto'}
                  </Button>
                </Upload>
                {photoPreview && (
                  <Button
                    type="link"
                    danger
                    size="small"
                    className="text-xs p-0 mt-1"
                    onClick={() => {
                      setPhotoPreview(null);
                      form.setFieldsValue({ photo_url: null });
                    }}
                  >
                    Quitar foto
                  </Button>
                )}
              </div>
              <Form.Item name="photo_url" hidden>
                <Input />
              </Form.Item>
            </Col>

            <Col xs={24} sm={18}>
              <Row gutter={12}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="full_name"
                    label={<span className="font-semibold text-gray-700">Nombre Completo</span>}
                    rules={[{ required: true, message: 'Ingrese el nombre del auxiliar' }]}
                  >
                    <Input placeholder="Ej. Lic. María Fernanda Gómez" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="username"
                    label={<span className="font-semibold text-gray-700">Nombre de Usuario (Login)</span>}
                    rules={[{ required: true, message: 'Ingrese el nombre de usuario' }]}
                  >
                    <Input prefix={<UserOutlined className="text-gray-400" />} placeholder="Ej. mfgomez" />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={12}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="position"
                    label={<span className="font-semibold text-gray-700">Puesto en el Despacho</span>}
                    rules={[{ required: true, message: 'Indique el puesto' }]}
                  >
                    <AutoComplete
                      options={POSITION_OPTIONS}
                      placeholder="Ej. Auxiliar Contable"
                      filterOption={(inputValue, option) =>
                        option.value.toUpperCase().indexOf(inputValue.toUpperCase()) !== -1
                      }
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="role"
                    label={<span className="font-semibold text-gray-700">Nivel en el Sistema</span>}
                  >
                    <Select>
                      <Option value="accountant">Auxiliar / Contador (Clientes Asignados)</Option>
                      <Option value="admin">Administrador / Titular (Acceso Total)</Option>
                    </Select>
                  </Form.Item>
                </Col>
              </Row>
            </Col>
          </Row>

          {/* Correo y Teléfono */}
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="email"
                label={<span className="font-semibold text-gray-700">Correo Electrónico</span>}
                rules={[{ type: 'email', message: 'Ingrese un correo válido' }]}
              >
                <Input
                  prefix={<MailOutlined className="text-gray-400" />}
                  placeholder="Ej. auxiliar@garciasalas.mx"
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="phone"
                label={<span className="font-semibold text-gray-700">Teléfono / WhatsApp</span>}
              >
                <Input
                  prefix={<PhoneOutlined className="text-gray-400" />}
                  placeholder="Ej. 55 1234 5678"
                />
              </Form.Item>
            </Col>
          </Row>

          {/* Contraseña generada por el titular */}
          <Card size="small" className="mb-4 bg-blue-50/40 border-blue-200">
            <Row gutter={12} align="middle">
              <Col xs={24} sm={14}>
                <Form.Item
                  name="password"
                  className="m-0"
                  label={
                    <span className="font-semibold text-gray-800">
                      <KeyOutlined className="mr-1 text-blue-600" />
                      {editingUser
                        ? 'Nueva Contraseña (dejar en blanco para conservar la actual)'
                        : 'Contraseña de Acceso (Generada o personalizada por usted)'}
                    </span>
                  }
                  rules={
                    editingUser
                      ? []
                      : [{ required: true, message: 'Asigne o genere una contraseña' }]
                  }
                >
                  <Input
                    placeholder={
                      editingUser
                        ? 'Escriba o genere una nueva contraseña si desea cambiarla...'
                        : 'Escriba o genere la contraseña...'
                    }
                    className="font-mono font-bold text-blue-900"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={10} className="pt-5">
                <Space wrap>
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={generateCustomPassword}
                    size="middle"
                  >
                    Generar Contraseña
                  </Button>
                  <Tooltip title="Copiar contraseña al portapapeles">
                    <Button
                      icon={<CopyOutlined />}
                      onClick={handleCopyPassword}
                      size="middle"
                    >
                      Copiar
                    </Button>
                  </Tooltip>
                </Space>
              </Col>
            </Row>
          </Card>

          {/* Asignación de Clientes con los que puede trabajar */}
          <Form.Item
            noStyle
            shouldUpdate={(prev, curr) => prev.role !== curr.role}
          >
            {({ getFieldValue }) => {
              const selectedRole = getFieldValue('role');
              if (selectedRole === 'admin') {
                return (
                  <Alert
                    type="info"
                    showIcon
                    className="mb-4"
                    message="Los usuarios con nivel Administrador / Titular tienen acceso automático a todos los clientes y pueden dar de alta clientes."
                  />
                );
              }
              return (
                <div className="p-3 rounded-lg border border-gray-200 bg-gray-50/60 mb-4">
                  <div className="flex flex-wrap justify-between items-center mb-2 gap-2">
                    <span className="font-semibold text-gray-800">
                      Clientes Asignados con los que puede trabajar
                    </span>
                    <Space size="small">
                      <Button
                        size="small"
                        type="link"
                        onClick={() => {
                          const allIds = clients.map(c => Number(c.id));
                          setSelectedAssignedClientIds(allIds);
                          form.setFieldsValue({ assigned_client_ids: allIds });
                        }}
                      >
                        Seleccionar todos ({clients.length})
                      </Button>
                      <Button
                        size="small"
                        type="link"
                        danger
                        onClick={() => {
                          setSelectedAssignedClientIds([]);
                          form.setFieldsValue({ assigned_client_ids: [] });
                        }}
                      >
                        Limpiar selección
                      </Button>
                    </Space>
                  </div>

                  <div className="mb-3">
                    <Select
                      mode="multiple"
                      allowClear
                      placeholder="Seleccione los clientes asignados a este auxiliar..."
                      style={{ width: '100%' }}
                      value={selectedAssignedClientIds}
                      onChange={(vals) => {
                        const nextIds = (vals || []).map(Number);
                        setSelectedAssignedClientIds(nextIds);
                        form.setFieldsValue({ assigned_client_ids: nextIds });
                      }}
                      optionFilterProp="label"
                      options={clients.map(c => ({
                        value: Number(c.id),
                        label: `${c.rfc} - ${c.business_name}`,
                      }))}
                    />
                  </div>

                  <Row gutter={16} align="middle">
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="can_create_clients"
                        valuePropName="checked"
                        className="m-0"
                        label={
                          <span className="font-semibold text-gray-700">
                            <SafetyCertificateOutlined className="mr-1 text-green-600" />
                            ¿Permitir que dé de alta nuevos clientes?
                          </span>
                        }
                      >
                        <Switch
                          checkedChildren="Sí, autorizado para dar de alta clientes"
                          unCheckedChildren="No autorizado"
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="is_active"
                        valuePropName="checked"
                        className="m-0"
                        label={
                          <span className="font-semibold text-gray-700">
                            Estado de Acceso al Sistema
                          </span>
                        }
                      >
                        <Switch
                          checkedChildren="Acceso Activo"
                          unCheckedChildren="Acceso Cancelado"
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </div>
              );
            }}
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          <div className="flex items-center gap-2 text-red-600">
            <KeyOutlined />
            <span>
              {bajaActionType === 'suspend'
                ? 'Suspender Acceso de Auxiliar — Contraseña de 32 Dígitos'
                : 'Dar de Baja Auxiliar — Contraseña de 32 Dígitos'}
            </span>
          </div>
        }
        open={bajaModalOpen}
        onCancel={() => {
          setBajaModalOpen(false);
          setBajaTargetUser(null);
          setBajaTempPassword('');
        }}
        onOk={handleExecuteBajaModal}
        confirmLoading={executingBaja}
        okText={bajaActionType === 'suspend' ? 'Autorizar y Suspender Acceso' : 'Autorizar y Dar de Baja'}
        okButtonProps={{ danger: true }}
        cancelText="Cancelar"
        destroyOnClose
      >
        <div className="space-y-3">
          <Alert
            type="warning"
            showIcon
            message={`Usuario: ${bajaTargetUser?.full_name || bajaTargetUser?.username} (@${bajaTargetUser?.username})`}
            description="Ingresa una contraseña temporal vigente de 32 dígitos (formato UUID) generada en el módulo de Contraseñas Temporales. Nota: Si el usuario ya se encuentra dentro del sistema en este momento, no se le sacará de su sesión actual, pero la siguiente vez que intente iniciar sesión ya no se lo permitirá."
          />
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Contraseña Temporal de 32 Dígitos (UUID):
            </label>
            <Input
              prefix={<KeyOutlined className="text-gray-400" />}
              placeholder="Ej. a4f9c2e1-7b3d-48a6-9c0e-5d2f8b1a6e3c"
              value={bajaTempPassword}
              onChange={(e) => setBajaTempPassword(e.target.value)}
              className="font-mono"
              autoFocus
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default StaffUsers;
