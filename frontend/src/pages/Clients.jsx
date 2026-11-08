import React, { useState, useEffect } from 'react';
import { Table, Button, Input, Modal, Form, Select, Popconfirm, Tag, message, Space, Alert, Tooltip, Upload } from 'antd';
import {
  EditOutlined, DeleteOutlined, PlusOutlined, UserAddOutlined, BookOutlined,
  CloudDownloadOutlined, CloudUploadOutlined, InboxOutlined, KeyOutlined
} from '@ant-design/icons';
import { clientsApi, authApi } from '../api/client';
import { useClient } from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';

const { Search } = Input;
const { Option } = Select;

const TAX_REGIME_LABELS = {
  '601': '601 - General de Ley Personas Morales',
  '603': '603 - Personas Morales con Fines no Lucrativos',
  '605': '605 - Sueldos y Salarios e Ingresos Asimilados a Salarios',
  '606': '606 - Arrendamiento (Personas Físicas)',
  '606_CIEGA': '606 - Arrendamiento (Deducción Ciega 35%)',
  '606_COMPROBADA': '606 - Arrendamiento (Deducción Comprobada CFDI)',
  '612': '612 - Personas Físicas con Actividades Empresariales y Profesionales',
  '621': '621 - Incorporación Fiscal (RIF)',
  '625': '625 - Régimen de las Actividades Empresariales con Ingresos a través de Plataformas Tecnológicas',
  '626': '626 - Régimen Simplificado de Confianza (RESICO)',
  '626_PM': '626 - Régimen Simplificado de Confianza (Personas Morales)',
  '626_PF': '626 - Régimen Simplificado de Confianza (Personas Físicas)',
};

const normalizeRegimeCode = (rawRegime) => {
  const val = String(rawRegime || '').trim().toUpperCase();
  if (!val) return '';
  if (TAX_REGIME_LABELS[val]) return val;
  const match = val.match(/^(6\d{2})/);
  return match ? match[1] : val;
};

const formatTaxRegimeDisplay = (rawRegime, rfc) => {
  const val = String(rawRegime || '').trim();
  if (!val) return 'Sin especificar';
  const upper = val.toUpperCase();
  const isPf = String(rfc || '').trim().length >= 13;

  if (upper === '626') {
    return isPf
      ? '626 - Régimen Simplificado de Confianza (Personas Físicas)'
      : '626 - Régimen Simplificado de Confianza (Personas Morales)';
  }
  if (TAX_REGIME_LABELS[upper]) {
    return TAX_REGIME_LABELS[upper];
  }
  const codeMatch = upper.match(/^(6\d{2})/);
  if (codeMatch && TAX_REGIME_LABELS[codeMatch[1]]) {
    return TAX_REGIME_LABELS[codeMatch[1]];
  }
  return val;
};

const Clients = () => {
  const { refreshClients, setSelectedClient } = useClient();
  const { user } = useAuth();
  const canCreateClients = user?.role === 'admin' || Boolean(user?.can_create_clients);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchText, setSearchText] = useState('');
  
  // Modals state
  const [isClientModalVisible, setIsClientModalVisible] = useState(false);
  const [isPortalModalVisible, setIsPortalModalVisible] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [portalClient, setPortalClient] = useState(null);

  // Backup & Restore state
  const [backingUpId, setBackingUpId] = useState(null);
  const [restoreModalVisible, setRestoreModalVisible] = useState(false);
  const [restoreTargetClient, setRestoreTargetClient] = useState(null);
  const [restoreFile, setRestoreFile] = useState(null);
  const [restorePreview, setRestorePreview] = useState(null);
  const [restoring, setRestoring] = useState(false);

  // Baja con contraseña temporal de 32 dígitos (UUID)
  const [bajaClientModalOpen, setBajaClientModalOpen] = useState(false);
  const [bajaClientTarget, setBajaClientTarget] = useState(null);
  const [bajaTempPassword, setBajaTempPassword] = useState('');
  const [deletingClient, setDeletingClient] = useState(false);
  
  const [form] = Form.useForm();
  const [portalForm] = Form.useForm();

  const fetchClients = async () => {
    setLoading(true);
    setError(null);
    try {
      const [response, meRes] = await Promise.all([
        clientsApi.list(),
        user?.role !== 'admin' ? authApi.getMe().catch(() => ({ data: user })) : Promise.resolve({ data: user }),
      ]);
      const freshUser = meRes?.data || user;
      let list = response.data || [];
      if (freshUser && freshUser.role !== 'admin') {
        const allowedIds = new Set((freshUser.assigned_client_ids || []).map(Number));
        list = list.filter(c => allowedIds.has(Number(c.id)));
      }
      setClients(list);
    } catch (err) {
      setError('Error al cargar clientes. Intente de nuevo más tarde.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const handleSearch = (value) => setSearchText(value);

  const filteredClients = clients.filter(c => 
    c.rfc?.toLowerCase().includes(searchText.toLowerCase()) || 
    c.business_name?.toLowerCase().includes(searchText.toLowerCase())
  );

  const showClientModal = (client = null) => {
    setEditingClient(client);
    if (client) {
      form.setFieldsValue({
        ...client,
        tax_regime: normalizeRegimeCode(client.tax_regime) || client.tax_regime,
      });
    } else {
      form.resetFields();
    }
    setIsClientModalVisible(true);
  };

  const showPortalModal = (client) => {
    setPortalClient(client);
    portalForm.resetFields();
    setIsPortalModalVisible(true);
  };

  const handleSaveClient = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      if (editingClient) {
        await clientsApi.update(editingClient.id, values);
        message.success('Cliente actualizado con éxito');
      } else {
        const res = await clientsApi.create(values);
        message.success('Cliente creado con éxito');
        if (res.data?.id && setSelectedClient) {
          setSelectedClient(String(res.data.id));
        }
      }
      setIsClientModalVisible(false);
      await fetchClients();
      if (refreshClients) {
        await refreshClients();
      }
    } catch (err) {
      if (err.errorFields) {
        return; // Validation errors handled by Ant Form inline
      }
      const msg = err.response?.data?.detail || err.message || 'Error al guardar el cliente';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const openBajaClientModal = (client) => {
    setBajaClientTarget(client);
    setBajaTempPassword('');
    setBajaClientModalOpen(true);
  };

  const handleDeleteClient = async () => {
    if (!bajaClientTarget) return;
    if (!bajaTempPassword || !bajaTempPassword.trim()) {
      message.warning('Ingrese la contraseña temporal de 32 dígitos (UUID) para autorizar la baja del cliente.');
      return;
    }
    setDeletingClient(true);
    try {
      await clientsApi.delete(bajaClientTarget.id, bajaTempPassword.trim());
      message.success(`Cliente ${bajaClientTarget.business_name} dado de baja exitosamente`);
      setBajaClientModalOpen(false);
      setBajaClientTarget(null);
      setBajaTempPassword('');
      await fetchClients();
      if (refreshClients) {
        await refreshClients();
      }
    } catch (err) {
      const msg = err.response?.data?.detail || 'Error al dar de baja al cliente';
      message.error(msg);
    } finally {
      setDeletingClient(false);
    }
  };

  const handleInitCatalog = async (id) => {
    try {
      await clientsApi.initDefaultAccounts(id);
      message.success('Catálogo SAT inicializado con éxito');
    } catch (err) {
      const msg = err.response?.data?.detail || 'Error al inicializar catálogo';
      message.error(msg);
    }
  };

  const handleCreatePortalUser = async () => {
    try {
      const values = await portalForm.validateFields();
      await clientsApi.createPortalUser(portalClient.id, values);
      message.success(`Usuario de portal creado para ${portalClient.business_name}`);
      setIsPortalModalVisible(false);
    } catch (err) {
      if (err.errorFields) return;
      const msg = err.response?.data?.detail || 'Error al crear usuario de portal';
      message.error(msg);
    }
  };

  // Respaldar información del cliente y descargarla inmediatamente a la computadora
  const handleBackupClient = async (client) => {
    setBackingUpId(client.id);
    try {
      const res = await clientsApi.backup(client.id);
      const blob = new Blob([res.data], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
      link.href = url;
      link.setAttribute('download', `Respaldo_${client.rfc}_${dateStr}.json`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      message.success(`Respaldo de ${client.business_name} generado y descargado a su computadora.`);
    } catch (err) {
      message.error('Error al generar y descargar el respaldo del cliente.');
    } finally {
      setBackingUpId(null);
    }
  };

  // Abrir ventana para subir y restaurar respaldo
  const openRestoreModal = (client) => {
    setRestoreTargetClient(client);
    setRestoreFile(null);
    setRestorePreview(null);
    setRestoreModalVisible(true);
  };

  const handleSelectRestoreFile = (file) => {
    setRestoreFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        setRestorePreview({
          created_at: parsed.created_at,
          client_rfc: parsed.client?.rfc,
          client_name: parsed.client?.business_name,
          accounts: (parsed.accounts || []).length,
          entries: (parsed.journal_entries || []).length,
          invoices: (parsed.cfdi_invoices || []).length,
          assets: (parsed.fixed_assets || []).length,
          banks: (parsed.bank_accounts || []).length,
        });
      } catch (err) {
        message.error('El archivo seleccionado no es un archivo de respaldo (.json) válido.');
        setRestoreFile(null);
        setRestorePreview(null);
      }
    };
    reader.readAsText(file);
    return false;
  };

  const handleExecuteRestore = async () => {
    if (!restoreTargetClient || !restoreFile) {
      message.warning('Seleccione primero el archivo de respaldo (.json) desde su computadora.');
      return;
    }
    setRestoring(true);
    try {
      const res = await clientsApi.restore(restoreTargetClient.id, restoreFile);
      const r = res.data?.restored || {};
      message.success(
        `Respaldo restaurado para ${restoreTargetClient.business_name} (${r.accounts || 0} cuentas, ${r.journal_entries || 0} pólizas, ${r.cfdi_invoices || 0} CFDIs).`
      );
      setRestoreModalVisible(false);
      await fetchClients();
      if (refreshClients) {
        await refreshClients();
      }
    } catch (err) {
      const msg = err.response?.data?.detail || 'Error al restaurar el respaldo del cliente';
      message.error(msg);
    } finally {
      setRestoring(false);
    }
  };

  const columns = [
    { title: 'RFC', dataIndex: 'rfc', key: 'rfc' },
    { title: 'Razón Social', dataIndex: 'business_name', key: 'business_name' },
    {
      title: 'C.P. Fiscal',
      dataIndex: 'postal_code',
      key: 'postal_code',
      width: 110,
      render: (cp) =>
        cp ? (
          <Tag color="geekblue" className="font-mono font-semibold">
            {cp}
          </Tag>
        ) : (
          <span className="text-gray-400 text-xs">Sin C.P.</span>
        ),
    },
    {
      title: 'Régimen Fiscal',
      dataIndex: 'tax_regime',
      key: 'tax_regime',
      render: (taxRegime, record) => (
        <span className="font-medium text-gray-800">
          {formatTaxRegimeDisplay(taxRegime, record.rfc)}
        </span>
      ),
    },
    { title: 'Email', dataIndex: 'email', key: 'email' },
    { 
      title: 'Estado', 
      dataIndex: 'status', 
      key: 'status',
      render: (status) => (
        <Tag color={status === 'activo' ? 'green' : 'red'}>
          {(status || 'activo').toUpperCase()}
        </Tag>
      )
    },
    {
      title: 'Acciones',
      key: 'actions',
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="Editar cliente">
            <Button icon={<EditOutlined />} onClick={() => showClientModal(record)} />
          </Tooltip>
          <Tooltip title="Dar de baja cliente (Requiere contraseña temporal de 32 dígitos)">
            <Button danger icon={<DeleteOutlined />} onClick={() => openBajaClientModal(record)} />
          </Tooltip>
          <Tooltip title="Crear acceso al portal del cliente">
            <Button icon={<UserAddOutlined />} onClick={() => showPortalModal(record)} />
          </Tooltip>
          <Tooltip title="Inicializar catálogo de cuentas SAT">
            <Button icon={<BookOutlined />} onClick={() => handleInitCatalog(record.id)} />
          </Tooltip>
          <Tooltip title="Respaldar y descargar información del cliente a su computadora">
            <Button
              icon={<CloudDownloadOutlined className="text-blue-600" />}
              loading={backingUpId === record.id}
              onClick={() => handleBackupClient(record)}
            />
          </Tooltip>
          <Tooltip title="Subir y restaurar respaldo del cliente desde su computadora">
            <Button
              icon={<CloudUploadOutlined className="text-purple-600" />}
              onClick={() => openRestoreModal(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Gestión de Clientes</h1>
        <Tooltip title={!canCreateClients ? "No cuenta con permiso para dar de alta clientes. Solicítelo al titular del despacho." : ""}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!canCreateClients}
            onClick={() => showClientModal()}
          >
            Nuevo Cliente
          </Button>
        </Tooltip>
      </div>

      {error && <Alert message={error} type="error" className="mb-4" />}

      <div className="mb-4">
        <Search 
          placeholder="Buscar por RFC o Razón Social" 
          allowClear 
          onSearch={handleSearch} 
          onChange={(e) => handleSearch(e.target.value)}
          className="max-w-md" 
        />
      </div>

      <Table 
        columns={columns} 
        dataSource={filteredClients} 
        rowKey="id" 
        loading={loading}
        pagination={{ pageSize: 10 }}
      />

      <Modal
        title={editingClient ? 'Editar Cliente' : 'Nuevo Cliente'}
        open={isClientModalVisible}
        onOk={handleSaveClient}
        onCancel={() => setIsClientModalVisible(false)}
        confirmLoading={loading}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="rfc" label="RFC" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="business_name" label="Razón Social" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="tax_regime" label="Régimen Fiscal" rules={[{ required: true }]}>
            <Select placeholder="Seleccione el régimen fiscal registrado del contribuyente">
              <Option value="601">601 - General de Ley Personas Morales</Option>
              <Option value="626">626 - Régimen Simplificado de Confianza (RESICO PM / PF)</Option>
              <Option value="612">612 - Personas Físicas con Actividades Empresariales y Profesionales</Option>
              <Option value="606">606 - Arrendamiento (Personas Físicas)</Option>
              <Option value="625">625 - Plataformas Tecnológicas y Digitales (Personas Físicas)</Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="postal_code"
            label="Código Postal Fiscal (Verificador de XML CFDI 4.0)"
            rules={[
              { required: true, message: 'Ingrese el Código Postal del domicilio fiscal (5 dígitos)' },
              { pattern: /^\d{5}$/, message: 'El Código Postal debe constar de 5 dígitos numéricos (ej. 06600)' },
            ]}
          >
            <Input
              placeholder="Ej. 06600 (5 dígitos según Constancia de Situación Fiscal)"
              maxLength={5}
              className="font-mono"
            />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="status" label="Estado en el Sistema" initialValue="activo">
            <Select>
              <Option value="activo">Activo</Option>
              <Option value="inactivo">Inactivo</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Crear Acceso Portal - ${portalClient?.business_name}`}
        open={isPortalModalVisible}
        onOk={handleCreatePortalUser}
        onCancel={() => setIsPortalModalVisible(false)}
      >
        <Form form={portalForm} layout="vertical">
          <Form.Item name="username" label="Usuario" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="Contraseña" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          <div className="flex items-center gap-2">
            <CloudUploadOutlined className="text-purple-600 text-lg" />
            <span>
              Subir y Restaurar Respaldo — {restoreTargetClient?.business_name} ({restoreTargetClient?.rfc})
            </span>
          </div>
        }
        open={restoreModalVisible}
        onCancel={() => setRestoreModalVisible(false)}
        onOk={handleExecuteRestore}
        confirmLoading={restoring}
        okText="Restaurar Respaldo"
        cancelText="Cancelar"
        okButtonProps={{
          disabled: !restoreFile || !restorePreview,
          className: "bg-purple-600 hover:bg-purple-700"
        }}
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          className="mb-4 text-xs"
          message="Seleccione el archivo de respaldo (.json) descargado previamente en su computadora para restaurar el catálogo de cuentas, pólizas contables, CFDIs, activos fijos y conciliaciones bancarias de este cliente."
        />

        <Upload.Dragger
          accept=".json,application/json"
          multiple={false}
          showUploadList={false}
          beforeUpload={handleSelectRestoreFile}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined className="text-purple-600" />
          </p>
          <p className="ant-upload-text font-semibold text-sm">
            {restoreFile
              ? `Archivo seleccionado: ${restoreFile.name}`
              : 'Haga clic o arrastre aquí el archivo de respaldo (.json)'}
          </p>
          <p className="ant-upload-hint text-xs">
            Formato soportado: Respaldo_{restoreTargetClient?.rfc}_YYYYMMDD.json
          </p>
        </Upload.Dragger>

        {restorePreview && (
          <div className="mt-4 p-3 rounded border border-purple-200 bg-purple-50/60 text-xs space-y-1">
            <div className="font-bold text-purple-900 mb-1">
              Resumen del Respaldo Seleccionado:
            </div>
            <div>
              <strong>Empresa en el respaldo:</strong> {restorePreview.client_name} ({restorePreview.client_rfc})
            </div>
            {restorePreview.created_at && (
              <div>
                <strong>Fecha del respaldo:</strong> {new Date(restorePreview.created_at).toLocaleString('es-MX')}
              </div>
            )}
            <div className="pt-1 flex flex-wrap gap-2">
              <Tag color="blue">{restorePreview.accounts} Cuentas Contables</Tag>
              <Tag color="green">{restorePreview.entries} Pólizas</Tag>
              <Tag color="geekblue">{restorePreview.invoices} CFDIs</Tag>
              <Tag color="purple">{restorePreview.assets} Activos Fijos</Tag>
              <Tag color="cyan">{restorePreview.banks} Cuentas Bancarias</Tag>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title={
          <div className="flex items-center gap-2 text-red-600">
            <KeyOutlined />
            <span>Dar de Baja Cliente — Autorización con Contraseña de 32 Dígitos</span>
          </div>
        }
        open={bajaClientModalOpen}
        onCancel={() => {
          setBajaClientModalOpen(false);
          setBajaClientTarget(null);
          setBajaTempPassword('');
        }}
        onOk={handleDeleteClient}
        confirmLoading={deletingClient}
        okText="Autorizar y Dar de Baja"
        okButtonProps={{ danger: true }}
        cancelText="Cancelar"
        destroyOnClose
      >
        <div className="space-y-3">
          <Alert
            type="warning"
            showIcon
            message={`Cliente a dar de baja: ${bajaClientTarget?.business_name} (${bajaClientTarget?.rfc})`}
            description="Para confirmar la baja del cliente, pega a continuación una contraseña temporal vigente de 32 dígitos (formato UUID) generada por el Socio / Titular."
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

export default Clients;
