import React, { useState, useEffect } from 'react';
import { Layout, Menu, message } from 'antd';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  DashboardOutlined,
  TeamOutlined,
  AccountBookOutlined,
  FileTextOutlined,
  UploadOutlined,
  SearchOutlined,
  BarChartOutlined,
  LineChartOutlined,
  PieChartOutlined,
  BankOutlined,
  BookOutlined,
  CalculatorOutlined,
  PayCircleOutlined,
  FileDoneOutlined,
  CodeOutlined,
  FundOutlined,
  IdcardOutlined,
  HistoryOutlined,
  SafetyCertificateOutlined,
  TableOutlined,
  KeyOutlined,
  CustomerServiceOutlined,
} from '@ant-design/icons';
import { useClient } from './Layout';
import { useAuth } from '../contexts/AuthContext';
import logoImg from '../assets/logo.png';

const { Sider } = Layout;

const Sidebar = ({ collapsed, onCollapse }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedClient: contextClient } = useClient();
  const { user } = useAuth();

  const [localClient, setLocalClient] = useState(() => {
    return sessionStorage.getItem('contacloud_active_client_session') || contextClient || null;
  });

  useEffect(() => {
    setLocalClient(sessionStorage.getItem('contacloud_active_client_session') || contextClient || null);
  }, [contextClient]);

  useEffect(() => {
    const onClientChange = (e) => {
      const nextId = e?.detail && String(e.detail).trim() !== '' ? String(e.detail) : null;
      setLocalClient(nextId);
    };
    window.addEventListener('contacloud:client-changed', onClientChange);
    return () => window.removeEventListener('contacloud:client-changed', onClientChange);
  }, []);

  const selectedClient = localClient;

  const handleMenuClick = ({ key }) => {
    const isClientRoute = !['/', '/clients', '/users', '/temp-passwords', '/audit-log', '/portal', '/support'].includes(key);
    
    if (isClientRoute && !selectedClient && user?.role !== 'client') {
      message.warning('Por favor, selecciona un cliente primero.');
      return;
    }

    // Replace the {clientId} placeholder with the actual selected client
    const targetPath = key.replace('{clientId}', selectedClient || '');
    navigate(targetPath);
  };

  const accountantItems = [
    { key: '/', icon: <DashboardOutlined />, label: 'Inicio' },
    { key: '/clients', icon: <TeamOutlined />, label: 'Clientes' },
    ...(user?.role === 'admin'
      ? [
          { key: '/users', icon: <IdcardOutlined />, label: 'Usuarios / Auxiliares' },
          { key: '/temp-passwords', icon: <KeyOutlined />, label: 'Contraseñas Temporales' },
          { key: '/audit-log', icon: <HistoryOutlined />, label: 'Bitácora de Actividades' },
        ]
      : []),
    { type: 'divider' },
    { type: 'group', label: 'CONTABILIDAD', children: [
        { key: '/accounts/{clientId}', icon: <AccountBookOutlined />, label: 'Catálogo de Cuentas' },
        { key: '/journal/{clientId}', icon: <FileTextOutlined />, label: 'Pólizas' },
        { key: '/cfdi-upload/{clientId}', icon: <UploadOutlined />, label: 'Cargar CFDI' },
      ]
    },
    { type: 'divider' },
    { type: 'group', label: 'CONSULTAS', children: [
        { key: '/ledger/{clientId}', icon: <SearchOutlined />, label: 'Libro Mayor' },
      ]
    },
    { type: 'divider' },
    { type: 'group', label: 'REPORTES', children: [
        { key: '/trial-balance/{clientId}', icon: <BarChartOutlined />, label: 'Balanza de Comprobación' },
        { key: '/income-statement/{clientId}', icon: <LineChartOutlined />, label: 'Estado de Resultados' },
        { key: '/balance-sheet/{clientId}', icon: <PieChartOutlined />, label: 'Balance General' },
      ]
    },
    { type: 'divider' },
    { type: 'group', label: 'REPORTES FISCALES', children: [
        { key: '/fiscal-iva/{clientId}', icon: <CalculatorOutlined />, label: 'Calculo IVA' },
        { key: '/fiscal-conciliacion-iva/{clientId}', icon: <TableOutlined />, label: 'Conciliación IVA Acreditable' },
        { key: '/fiscal-ieps/{clientId}', icon: <CalculatorOutlined />, label: 'Calculo e Informativa IEPS' },
        { key: '/fiscal-isr/{clientId}', icon: <BookOutlined />, label: 'Calculo ISR' },
        { key: '/fiscal-complementos/{clientId}', icon: <PayCircleOutlined />, label: 'Complementos de pago' },
        { key: '/fiscal-diot/{clientId}', icon: <FileDoneOutlined />, label: 'DIOT' },
        { key: '/fiscal-contabilidad-electronica/{clientId}', icon: <CodeOutlined />, label: 'Contabilidad Electronica' },
        { key: '/fiscal-inversiones/{clientId}', icon: <FundOutlined />, label: 'Inversiones' },
        { key: '/fiscal-validador-69b/{clientId}', icon: <SafetyCertificateOutlined />, label: 'Validador 69-B / 49-B' },
      ]
    },
    { type: 'divider' },
    { type: 'group', label: 'BANCOS', children: [
        { key: '/bank-reconciliation/{clientId}', icon: <BankOutlined />, label: 'Conciliación Bancaria' },
      ]
    },
    { type: 'divider' },
    { type: 'group', label: 'AYUDA Y ASISTENCIA', children: [
        { key: '/support', icon: <CustomerServiceOutlined />, label: 'Soporte Técnico' },
      ]
    }
  ];

  const clientItems = [
    { key: '/portal', icon: <DashboardOutlined />, label: 'Portal' },
    { type: 'divider' },
    { type: 'group', label: 'REPORTES', children: [
        { key: '/trial-balance/{clientId}', icon: <BarChartOutlined />, label: 'Balanza de Comprobación' },
        { key: '/income-statement/{clientId}', icon: <LineChartOutlined />, label: 'Estado de Resultados' },
        { key: '/balance-sheet/{clientId}', icon: <PieChartOutlined />, label: 'Balance General' },
      ]
    },
    { type: 'divider' },
    { type: 'group', label: 'REPORTES FISCALES', children: [
        { key: '/fiscal-iva/{clientId}', icon: <CalculatorOutlined />, label: 'Calculo IVA' },
        { key: '/fiscal-conciliacion-iva/{clientId}', icon: <TableOutlined />, label: 'Conciliación IVA Acreditable' },
        { key: '/fiscal-ieps/{clientId}', icon: <CalculatorOutlined />, label: 'Calculo e Informativa IEPS' },
        { key: '/fiscal-isr/{clientId}', icon: <BookOutlined />, label: 'Calculo ISR' },
        { key: '/fiscal-complementos/{clientId}', icon: <PayCircleOutlined />, label: 'Complementos de pago' },
        { key: '/fiscal-diot/{clientId}', icon: <FileDoneOutlined />, label: 'DIOT' },
        { key: '/fiscal-contabilidad-electronica/{clientId}', icon: <CodeOutlined />, label: 'Contabilidad Electronica' },
        { key: '/fiscal-inversiones/{clientId}', icon: <FundOutlined />, label: 'Inversiones' },
        { key: '/fiscal-validador-69b/{clientId}', icon: <SafetyCertificateOutlined />, label: 'Validador 69-B / 49-B' },
      ]
    },
    { type: 'divider' },
    { type: 'group', label: 'AYUDA Y ASISTENCIA', children: [
        { key: '/support', icon: <CustomerServiceOutlined />, label: 'Soporte Técnico' },
      ]
    }
  ];

  const menuItems = user?.role === 'client' ? clientItems : accountantItems;

  return (
    <Sider collapsible collapsed={collapsed} onCollapse={onCollapse} width={260} theme="dark">
      <div className="p-3 border-b border-gray-700/60 mb-2">
        <div className="bg-white rounded-lg py-2.5 px-3 flex items-center justify-center shadow-sm">
          <img 
            src={logoImg} 
            alt="Garcia Salas Asesores de Negocio" 
            className={`transition-all duration-300 object-contain ${
              collapsed ? 'h-8 w-8' : 'h-12 max-w-[205px]'
            }`} 
          />
        </div>
      </div>
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selectedClient ? location.pathname.replace(`/${selectedClient}`, '/{clientId}') : location.pathname]}
        onClick={handleMenuClick}
        items={menuItems}
      />
    </Sider>
  );
};

export default Sidebar;
