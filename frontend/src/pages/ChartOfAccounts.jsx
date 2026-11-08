import React, { useEffect, useState, useMemo } from 'react';
import { 
  Table, Button, Modal, Form, Input, Select, Tag, Space, message, 
  Popconfirm, Alert, Switch, Card, Badge, Tooltip, Row, Col, Dropdown 
} from 'antd';
import { 
  PlusOutlined, EditOutlined, DeleteOutlined, BuildOutlined, 
  SearchOutlined, CheckCircleOutlined, CloseCircleOutlined, FilterOutlined, SwapOutlined 
} from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import { accountsApi, clientsApi } from '../api/client';

const { Option } = Select;

// Formatea números de cuenta a estructura 3 2 3 (XXX-XX-XXX)
const formatAccountNumber = (val) => {
  if (!val) return '';
  const clean = String(val).trim();
  if (clean.includes('-')) {
    const parts = clean.split('-').map(p => p.trim());
    if (parts.length === 3) {
      return `${parts[0].padStart(3, '0').slice(0, 3)}-${parts[1].padStart(2, '0').slice(0, 2)}-${parts[2].padStart(3, '0').slice(0, 3)}`;
    } else if (parts.length === 2) {
      return `${parts[0].padStart(3, '0').slice(0, 3)}-${parts[1].padStart(2, '0').slice(0, 2)}-000`;
    }
  }
  const digits = clean.replace(/\D/g, '');
  if (digits.length >= 8) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 8)}`;
  } else if (digits.length <= 3) {
    return `${digits.padStart(3, '0')}-00-000`;
  } else if (digits.length <= 5) {
    return `${digits.slice(0, 3)}-${digits.slice(3).padStart(2, '0')}-000`;
  } else {
    return `${digits.slice(0, 3)}-${digits.slice(3, 5).padStart(2, '0')}-${digits.slice(5).padStart(3, '0').slice(0, 3)}`;
  }
};

const ChartOfAccounts = () => {
  const { clientId } = useParams();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Filters
  const [searchText, setSearchText] = useState('');
  const [onlyActive, setOnlyActive] = useState(true);
  const [classificationFilter, setClassificationFilter] = useState('todas');

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [form] = Form.useForm();
  const [clientInfo, setClientInfo] = useState({ business_name: 'Cargando...' });

  const fetchAccounts = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await accountsApi.getClientAccounts(clientId);
      const data = res.data || [];
      // Sorteo natural por el primer dígito y número de cuenta completo (1xx, 2xx, 3xx, etc.)
      data.sort((a, b) => a.account_number.localeCompare(b.account_number));
      setAccounts(data);
      
      const clientRes = await clientsApi.get(clientId).catch(() => ({ data: { business_name: 'Cliente' } }));
      if (clientRes?.data) setClientInfo(clientRes.data);
    } catch (err) {
      setError('Error al cargar el catálogo de cuentas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (clientId) fetchAccounts();
  }, [clientId]);

  // Manejo de activación / desactivación directa en tabla
  const handleToggleActive = async (accountId, isChecked) => {
    try {
      await accountsApi.update(accountId, { is_active: isChecked });
      setAccounts(prev => prev.map(acc => acc.id === accountId ? { ...acc, is_active: isChecked } : acc));
      message.success(isChecked ? 'Cuenta activada' : 'Cuenta desactivada para ahorrar memoria');
    } catch (err) {
      message.error('Error al actualizar estado de la cuenta');
    }
  };

  // Cambio directo de Clasificación (Acumulación <-> Afectable) en cada fila
  const handleToggleClassification = async (record, explicitVal = null) => {
    const currentClass = record.classification || 'Acumulación';
    const nextClass = explicitVal || (currentClass === 'Acumulación' ? 'Afectable' : 'Acumulación');
    if (nextClass === currentClass) return;
    try {
      await accountsApi.update(record.id, { classification: nextClass });
      setAccounts(prev =>
        prev.map(acc => (acc.id === record.id ? { ...acc, classification: nextClass } : acc))
      );
      message.success(`Cuenta ${record.account_number} cambiada a "${nextClass}"`);
    } catch (err) {
      message.error(err?.response?.data?.detail || 'Error al cambiar clasificación de la cuenta');
    }
  };

  // Cambio masivo de clasificación para las subcuentas actualmente filtradas en pantalla
  const handleBulkClassification = async (targetClass) => {
    const eligible = filteredAccounts.filter(
      a => !(targetClass === 'Afectable' && (a.account_number || '').endsWith('-00-000'))
    );
    if (eligible.length === 0) {
      message.warning('No hay subcuentas en la vista actual para actualizar.');
      return;
    }
    try {
      setLoading(true);
      const ids = eligible.map(a => a.id);
      const res = await accountsApi.bulkUpdateClassification(clientId, {
        account_ids: ids,
        classification: targetClass,
      });
      setAccounts(prev =>
        prev.map(acc => (ids.includes(acc.id) ? { ...acc, classification: targetClass } : acc))
      );
      message.success(res.data?.message || `Se actualizaron las cuentas a "${targetClass}".`);
    } catch (err) {
      message.error(err?.response?.data?.detail || 'Error al actualizar la clasificación');
    } finally {
      setLoading(false);
    }
  };

  const showModal = (account = null, parent = null) => {
    setEditingAccount(account);
    form.resetFields();

    if (account) {
      form.setFieldsValue({
        ...account,
        account_number: formatAccountNumber(account.account_number),
        classification: account.classification || 'Acumulación',
        is_active: account.is_active !== false,
      });
    } else if (parent) {
      // Sugerir número de subcuenta y valores por defecto basados en la cuenta padre
      const parentNum = parent.account_number || '';
      const parts = parentNum.split('-');
      let suggestedNum = '';
      let suggestedClass = 'Afectable';
      let suggestedLevel = 3;

      if (parts.length === 3) {
        if (parts[1] === '00' && parts[2] === '000') {
          // Padre es Nivel 1 (ej. 102-00-000) -> Crear subcuenta Nivel 2 (ej. 102-01-000)
          const siblings = accounts.filter(a => a.account_number.startsWith(`${parts[0]}-`) && a.account_number !== parentNum);
          let maxSeg2 = 0;
          siblings.forEach(s => {
            const sp = s.account_number.split('-');
            const val = parseInt(sp[1], 10);
            if (!isNaN(val) && val > maxSeg2) maxSeg2 = val;
          });
          const nextSeg2 = String(maxSeg2 + 1).padStart(2, '0');
          suggestedNum = `${parts[0]}-${nextSeg2}-000`;
          suggestedClass = 'Acumulación';
          suggestedLevel = 2;
        } else if (parts[2] === '000') {
          // Padre es Nivel 2 (ej. 102-01-000) -> Crear detalle Nivel 3 (ej. 102-01-001)
          const siblings = accounts.filter(a => a.account_number.startsWith(`${parts[0]}-${parts[1]}-`) && a.account_number !== parentNum);
          let maxSeg3 = 0;
          siblings.forEach(s => {
            const sp = s.account_number.split('-');
            const val = parseInt(sp[2], 10);
            if (!isNaN(val) && val > maxSeg3) maxSeg3 = val;
          });
          const nextSeg3 = String(maxSeg3 + 1).padStart(3, '0');
          suggestedNum = `${parts[0]}-${parts[1]}-${nextSeg3}`;
          suggestedClass = 'Afectable';
          suggestedLevel = 3;
        } else {
          suggestedNum = `${parentNum.slice(0, 7)}1`;
        }
      }

      form.setFieldsValue({
        parent_id: parent.id,
        account_number: suggestedNum,
        sat_group_code: parent.sat_group_code || '',
        nature: parent.nature || 'deudora',
        classification: suggestedClass,
        level: suggestedLevel,
        is_active: true
      });
    } else {
      form.setFieldsValue({
        nature: 'deudora',
        classification: 'Afectable',
        is_active: true,
        level: 3
      });
    }
    setIsModalVisible(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const formattedNumber = formatAccountNumber(values.account_number);
      const payload = {
        ...values,
        account_number: formattedNumber,
        client_id: parseInt(clientId, 10),
      };

      if (editingAccount) {
        await accountsApi.update(editingAccount.id, payload);
        message.success('Cuenta contable actualizada');
      } else {
        await accountsApi.create(payload);
        message.success('Nueva cuenta agregada exitosamente');
      }
      setIsModalVisible(false);
      fetchAccounts();
    } catch (err) {
      const errorMsg = err?.response?.data?.detail || 'Error al guardar la cuenta';
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await accountsApi.delete(id);
      message.success('Cuenta desactivada');
      fetchAccounts();
    } catch (err) {
      message.error('Error al desactivar cuenta');
    }
  };

  const handleInitDefault = async () => {
    try {
      setLoading(true);
      await clientsApi.initDefaultAccounts(clientId);
      message.success('Catálogo SAT Anexo 24 (estructura 3-2-3) inicializado con éxito');
      fetchAccounts();
    } catch (err) {
      const errorMsg = err?.response?.data?.detail || 'Error al inicializar catálogo';
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyDefaults = async () => {
    try {
      setLoading(true);
      const res = await accountsApi.applyDefaultAccounts(clientId);
      message.success(res.data?.message || 'Cuentas predeterminadas aplicadas con éxito');
      setOnlyActive(true);
      await fetchAccounts();
    } catch (err) {
      const errorMsg = err?.response?.data?.detail || 'Error al aplicar cuentas predeterminadas';
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Filtrado reactivo en memoria
  const filteredAccounts = useMemo(() => {
    return accounts.filter(acc => {
      if (onlyActive && !acc.is_active) return false;
      if (classificationFilter !== 'todas' && acc.classification !== classificationFilter) return false;
      if (searchText) {
        const text = searchText.toLowerCase().trim();
        const numMatch = (acc.account_number || '').toLowerCase().includes(text);
        const nameMatch = (acc.name || '').toLowerCase().includes(text);
        const satMatch = (acc.sat_group_code || '').toLowerCase().includes(text);
        if (!numMatch && !nameMatch && !satMatch) return false;
      }
      return true;
    });
  }, [accounts, onlyActive, classificationFilter, searchText]);

  // Métricas
  const totalCount = accounts.length;
  const activeCount = accounts.filter(a => a.is_active).length;
  const inactiveCount = totalCount - activeCount;

  const columns = [
    { 
      title: 'Número (3-2-3)', 
      dataIndex: 'account_number', 
      key: 'account_number',
      width: 150,
      sorter: (a, b) => a.account_number.localeCompare(b.account_number),
      defaultSortOrder: 'ascend',
      render: (num, record) => {
        const isHeader = record.level === 1 || num.endsWith('-00-000');
        const isLevel2 = record.level === 2 || num.endsWith('-000');
        return (
          <span style={{ 
            fontFamily: 'monospace', 
            fontWeight: isHeader ? 'bold' : isLevel2 ? '600' : 'normal',
            paddingLeft: record.level === 3 ? 16 : record.level === 2 ? 8 : 0,
            color: !record.is_active ? '#999' : isHeader ? '#1890ff' : 'inherit'
          }}>
            {num}
          </span>
        );
      }
    },
    { 
      title: 'Nombre de la Cuenta', 
      dataIndex: 'name', 
      key: 'name',
      render: (text, record) => {
        const isHeader = record.level === 1 || record.account_number.endsWith('-00-000');
        return (
          <span style={{ 
            fontWeight: isHeader ? 'bold' : 'normal',
            paddingLeft: record.level === 3 ? 16 : record.level === 2 ? 8 : 0,
            color: !record.is_active ? '#999' : 'inherit'
          }}>
            {text}
            {!record.is_active && <Tag color="default" className="ml-2">Inactiva</Tag>}
          </span>
        );
      }
    },
    { 
      title: 'Clasificación', 
      dataIndex: 'classification', 
      key: 'classification',
      width: 175,
      filters: [
        { text: 'Acumulación', value: 'Acumulación' },
        { text: 'Afectable', value: 'Afectable' },
      ],
      onFilter: (value, record) => record.classification === value,
      render: (classification, record) => {
        const isAcum = (classification || 'Acumulación') === 'Acumulación';
        return (
          <div className="flex items-center gap-1.5">
            <Tag color={isAcum ? 'blue' : 'green'} style={{ fontWeight: 500, margin: 0 }}>
              {classification || 'Acumulación'}
            </Tag>
            <Tooltip title={`Cambiar a ${isAcum ? 'Afectable (permite capturar pólizas)' : 'Acumulación (cuenta concentradora)'}`}>
              <Button
                size="small"
                type="default"
                icon={<SwapOutlined />}
                onClick={() => handleToggleClassification(record)}
                className={`text-[11px] px-1.5 h-6 flex items-center ${
                  isAcum
                    ? 'border-green-300 text-green-700 hover:border-green-500 hover:text-green-800 bg-green-50/50'
                    : 'border-blue-300 text-blue-700 hover:border-blue-500 hover:text-blue-800 bg-blue-50/50'
                }`}
              >
                {isAcum ? 'Afectable' : 'Acumulación'}
              </Button>
            </Tooltip>
          </div>
        );
      }
    },
    { 
      title: 'Nivel', 
      dataIndex: 'level', 
      key: 'level',
      width: 70,
      align: 'center',
      render: (level) => <Tag color={level === 1 ? 'geekblue' : level === 2 ? 'cyan' : 'default'}>{level}</Tag>
    },
    { 
      title: 'Naturaleza', 
      dataIndex: 'nature', 
      key: 'nature',
      width: 110,
      render: (text) => {
        const isDeudora = (text || '').toLowerCase().startsWith('d');
        return (
          <Tag color={isDeudora ? 'orange' : 'purple'}>
            {isDeudora ? 'DEUDORA' : 'ACREEDORA'}
          </Tag>
        );
      }
    },
    { 
      title: 'Código SAT', 
      dataIndex: 'sat_group_code', 
      key: 'sat_group_code',
      width: 120,
      render: (code) => code ? <span className="text-gray-600 font-mono text-xs">{code}</span> : '-'
    },
    { 
      title: 'Activa', 
      dataIndex: 'is_active', 
      key: 'is_active',
      width: 100,
      align: 'center',
      render: (isActive, record) => (
        <Tooltip title={isActive ? 'Desactivar cuenta para ahorrar memoria' : 'Activar cuenta contable'}>
          <Switch 
            checked={isActive} 
            onChange={(checked) => handleToggleActive(record.id, checked)}
            checkedChildren="Sí" 
            unCheckedChildren="No"
            size="small"
          />
        </Tooltip>
      )
    },
    {
      title: 'Acciones',
      key: 'actions',
      width: 130,
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="Agregar subcuenta a esta cuenta">
            <Button 
              type="text" 
              icon={<PlusOutlined />} 
              onClick={() => showModal(null, record)} 
              size="small" 
              className="text-blue-600"
            />
          </Tooltip>
          <Tooltip title="Editar cuenta">
            <Button 
              type="text" 
              icon={<EditOutlined />} 
              onClick={() => showModal(record)} 
              size="small" 
            />
          </Tooltip>
          <Popconfirm 
            title="¿Desactivar cuenta contable?" 
            description="La cuenta se marcará como inactiva para ahorrar memoria."
            onConfirm={() => handleDelete(record.id)}
            okText="Sí, desactivar"
            cancelText="Cancelar"
          >
            <Button type="text" danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center mb-4 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 m-0">Catálogo de Cuentas</h1>
          <p className="text-gray-500 m-0 text-sm">
            Cliente: <span className="font-semibold text-gray-700">{clientInfo.business_name}</span> &nbsp;|&nbsp;
            Estructura: <span className="font-semibold text-blue-600 font-mono">3-2-3 (XXX-XX-XXX)</span>
          </p>
        </div>
        <Space wrap>
          {accounts.length === 0 && (
            <Button icon={<BuildOutlined />} onClick={handleInitDefault} loading={loading}>
              Inicializar Catálogo SAT
            </Button>
          )}
          <Popconfirm
            title="¿Dejar activas solo las cuentas predeterminadas?"
            description="Se aplicará la configuración modelo de Gabriela Velasquez Moreno (440 cuentas activas y 640 desactivadas)."
            onConfirm={handleApplyDefaults}
            okText="Sí, aplicar"
            cancelText="Cancelar"
          >
            <Button 
              icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />} 
              loading={loading}
              style={{ borderColor: '#52c41a', color: '#2b8a3e', fontWeight: 500 }}
            >
              Cuentas Predeterminadas
            </Button>
          </Popconfirm>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => showModal()}>
            Agregar Cuenta
          </Button>
        </Space>
      </div>

      {/* Banner informativo de filtros y memoria */}
      <Card size="small" className="mb-4 shadow-sm bg-white">
        <Row gutter={[16, 12]} align="middle">
          <Col xs={24} md={7}>
            <Input 
              prefix={<SearchOutlined className="text-gray-400" />}
              placeholder="Buscar por número, nombre o código SAT..."
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              allowClear
            />
          </Col>
          <Col xs={24} md={8}>
            <Space align="center" wrap>
              <span className="text-sm font-medium text-gray-700">Clasificación:</span>
              <Select 
                value={classificationFilter} 
                onChange={setClassificationFilter} 
                style={{ width: 135 }}
                size="middle"
              >
                <Option value="todas">Todas</Option>
                <Option value="Acumulación">Acumulación</Option>
                <Option value="Afectable">Afectable</Option>
              </Select>
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'set_afectable',
                      label: (
                        <span className="text-green-700 font-semibold">
                          Marcar subcuentas en pantalla como Afectable
                        </span>
                      ),
                      onClick: () => handleBulkClassification('Afectable'),
                    },
                    {
                      key: 'set_acumulacion',
                      label: (
                        <span className="text-blue-700 font-semibold">
                          Marcar subcuentas en pantalla como Acumulación
                        </span>
                      ),
                      onClick: () => handleBulkClassification('Acumulación'),
                    },
                  ],
                }}
                trigger={['click']}
              >
                <Tooltip title="Elegir si las subcuentas mostradas en pantalla serán Afectables o de Acumulación">
                  <Button icon={<SwapOutlined />} size="middle" className="font-medium text-indigo-700 border-indigo-300 bg-indigo-50/40">
                    Elegir Afectable / Acumulación
                  </Button>
                </Tooltip>
              </Dropdown>
            </Space>
          </Col>
          <Col xs={24} md={5}>
            <Space align="center">
              <Switch 
                checked={onlyActive} 
                onChange={setOnlyActive} 
                checkedChildren="Predeterminadas" 
                unCheckedChildren="Todas" 
              />
              <span className="text-sm text-gray-700 font-medium">
                {onlyActive ? 'Mostrando cuentas predeterminadas (activas)' : 'Mostrar todas (activas e inactivas)'}
              </span>
            </Space>
          </Col>
          <Col xs={24} md={4} className="text-right">
            <Space size="middle">
              <Tooltip title="Cuentas predeterminadas activas">
                <Badge count={activeCount} overflowCount={9999} style={{ backgroundColor: '#52c41a' }} />
                <span className="text-xs text-gray-500 ml-1">Activas</span>
              </Tooltip>
              <Tooltip title="Cuentas predeterminadas inactivas / secundarias">
                <Badge count={inactiveCount} overflowCount={9999} style={{ backgroundColor: '#d9d9d9', color: '#666' }} />
                <span className="text-xs text-gray-500 ml-1">Inactivas</span>
              </Tooltip>
            </Space>
          </Col>
        </Row>
      </Card>

      {error && <Alert message={error} type="error" className="mb-4" showIcon />}

      {/* Tabla del Catálogo */}
      <Card size="small" className="shadow-sm bg-white overflow-hidden p-0">
        <Table 
          columns={columns} 
          dataSource={filteredAccounts} 
          rowKey="id" 
          loading={loading}
          pagination={{ 
            defaultPageSize: 50, 
            pageSizeOptions: ['25', '50', '100', '200', '500'],
            showSizeChanger: true,
            showTotal: (total, range) => `${range[0]}-${range[1]} de ${total} cuentas`
          }}
          size="middle"
          bordered
        />
      </Card>

      {/* Modal para Crear / Editar Cuenta */}
      <Modal
        title={editingAccount ? `Editar Cuenta: ${editingAccount.account_number}` : 'Agregar Cuenta Contable'}
        open={isModalVisible}
        onOk={handleSave}
        onCancel={() => setIsModalVisible(false)}
        confirmLoading={loading}
        width={600}
        okText="Guardar Cuenta"
        cancelText="Cancelar"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="parent_id" label="Cuenta de Mayor / Padre (Opcional)">
            <Select 
              showSearch 
              placeholder="Seleccionar cuenta padre para jerarquía" 
              allowClear
              optionFilterProp="label"
              filterOption={(input, option) =>
                String(option?.label || '').toLowerCase().includes(input.toLowerCase())
              }
              options={accounts.filter(a => a.level < 3).map(a => ({
                value: a.id,
                label: `${a.account_number} - ${a.name} (${a.classification})`
              }))}
              onChange={(parentId) => {
                const parent = accounts.find(a => a.id === parentId);
                if (parent) {
                  const parts = parent.account_number.split('-');
                  if (parts[1] === '00' && parts[2] === '000') {
                    // Sugerir subcuenta Nivel 2
                    form.setFieldsValue({
                      nature: parent.nature,
                      classification: 'Acumulación',
                      level: 2,
                      sat_group_code: parent.sat_group_code
                    });
                  } else {
                    // Sugerir cuenta detalle Nivel 3
                    form.setFieldsValue({
                      nature: parent.nature,
                      classification: 'Afectable',
                      level: 3,
                      sat_group_code: parent.sat_group_code
                    });
                  }
                }
              }}
            />
          </Form.Item>

          <Row gutter={16}>
            <Col span={14}>
              <Form.Item 
                name="account_number" 
                label="Número de Cuenta (3-2-3)" 
                rules={[
                  { required: true, message: 'Ingrese el número de cuenta' },
                  { 
                    validator: (_, value) => {
                      if (!value) return Promise.resolve();
                      const formatted = formatAccountNumber(value);
                      if (/^\d{3}-\d{2}-\d{3}$/.test(formatted)) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error('Debe seguir la estructura 3-2-3 (XXX-XX-XXX)'));
                    }
                  }
                ]}
                extra="Estructura estricta 3-2-3: XXX (Rubro) - XX (Subcuenta) - XXX (Detalle)"
              >
                <Input 
                  placeholder="Ej. 102-01-001" 
                  onBlur={(e) => {
                    const formatted = formatAccountNumber(e.target.value);
                    form.setFieldsValue({ account_number: formatted });
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item 
                name="classification" 
                label="Tipo de Cuenta" 
                rules={[{ required: true, message: 'Seleccione la clasificación' }]}
                extra="Acumulación (suma subcuentas) o Afectable (recibe pólizas)"
              >
                <Select>
                  <Option value="Acumulación">
                    <span className="text-blue-600 font-semibold">Acumulación</span>
                  </Option>
                  <Option value="Afectable">
                    <span className="text-green-600 font-semibold">Afectable</span>
                  </Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item 
            name="name" 
            label="Nombre de la Cuenta" 
            rules={[{ required: true, message: 'Ingrese el nombre de la cuenta' }]}
          >
            <Input placeholder="Ej. BBVA Bancomer S.A." />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                name="sat_group_code" 
                label="Código Agrupador SAT (Anexo 24)" 
                rules={[{ required: true, message: 'Ingrese o seleccione el código SAT' }]}
              >
                <Input placeholder="Ej. 102.01" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                name="nature" 
                label="Naturaleza Contable" 
                rules={[{ required: true, message: 'Seleccione la naturaleza' }]}
              >
                <Select>
                  <Option value="deudora">Deudora (Activo / Costos / Gastos)</Option>
                  <Option value="acreedora">Acreedora (Pasivo / Capital / Ingresos)</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16} align="middle">
            <Col span={12}>
              <Form.Item name="level" label="Nivel de Acumulación">
                <Select>
                  <Option value={1}>Nivel 1 (Mayor: XXX-00-000)</Option>
                  <Option value={2}>Nivel 2 (Subcuenta: XXX-XX-000)</Option>
                  <Option value={3}>Nivel 3 (Detalle / Auxiliar: XXX-XX-XXX)</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="is_active" label="Estado en Memoria" valuePropName="checked">
                <Switch checkedChildren="Activa (en uso)" unCheckedChildren="Inactiva (ahorrar memoria)" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
};

export default ChartOfAccounts;
