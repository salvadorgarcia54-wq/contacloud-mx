import React, { useState, useEffect } from 'react';
import {
  Card, Table, Row, Col, Select, DatePicker, Input, Button,
  Typography, Tag, Statistic, Space, Avatar, Tooltip,
  Alert, Tabs, Modal, Popconfirm, Progress, message
} from 'antd';
import {
  HistoryOutlined,
  UserOutlined,
  ReloadOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  SearchOutlined,
  CloudUploadOutlined,
  CheckCircleOutlined,
  SafetyCertificateOutlined,
  AuditOutlined,
  ApartmentOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusCircleOutlined,
  BarChartOutlined,
  ClearOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { Navigate } from 'react-router-dom';
import { auditApi, clientsApi, usersApi } from '../api/client';
import { exportToExcel, exportToPdfWithLogo } from '../utils/exportPaperwork';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;
const { Option } = Select;

const MODULE_COLORS = {
  'Pólizas': 'blue',
  'CFDIs': 'purple',
  'Cierre Anual': 'green',
  'Clientes': 'cyan',
  'Respaldos': 'geekblue',
  'Activos Fijos': 'orange',
  'Fiscal': 'gold',
  'Usuarios / Auxiliares': 'magenta',
  'Contraseñas Temporales (UUID)': 'volcano',
  'Seguridad': 'red',
};

const ACTION_ICONS = {
  'CREAR_POLIZA': <PlusCircleOutlined className="text-green-600" />,
  'EDITAR_POLIZA': <EditOutlined className="text-blue-600" />,
  'ELIMINAR_POLIZA': <DeleteOutlined className="text-red-600" />,
  'CIERRE_EJERCICIO': <CheckCircleOutlined className="text-emerald-600" />,
  'REVERTIR_CIERRE': <ExclamationCircleOutlined className="text-amber-600" />,
  'CARGA_CFDI': <CloudUploadOutlined className="text-purple-600" />,
  'ELIMINAR_CFDI': <DeleteOutlined className="text-red-500" />,
  'CREAR_CLIENTE': <PlusCircleOutlined className="text-cyan-600" />,
  'BAJA_CLIENTE': <DeleteOutlined className="text-red-600" />,
  'DESCARGAR_RESPALDO': <CloudUploadOutlined className="text-indigo-600" />,
  'RESTAURAR_RESPALDO': <CheckCircleOutlined className="text-indigo-600" />,
  'CREAR_USUARIO': <UserOutlined className="text-magenta-600" />,
  'ESTATUS_ACCESO': <SafetyCertificateOutlined className="text-amber-600" />,
  'BAJA_USUARIO': <DeleteOutlined className="text-red-600" />,
  'TRASPASO_IVA': <AuditOutlined className="text-gold-600" />,
  'DEPRECIACION_ACTIVOS': <AuditOutlined className="text-orange-600" />,
};

const formatDuration = (totalSeconds) => {
  const secs = Math.max(0, Math.round(Number(totalSeconds || 0)));
  if (secs === 0) return '0m 00s';
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const remSecs = secs % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(remSecs).padStart(2, '0')}s`;
  }
  return `${minutes}m ${String(remSecs).padStart(2, '0')}s`;
};

const formatHoursDecimal = (totalSeconds) => {
  const hrs = Number(totalSeconds || 0) / 3600;
  return `${hrs.toFixed(2)} hrs`;
};

const AuditLog = () => {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';

  const [activeTab, setActiveTab] = useState('history'); // 'history' | 'time_analytics'
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [stats, setStats] = useState(null);
  const [timeAnalytics, setTimeAnalytics] = useState(null);
  const [usersList, setUsersList] = useState([]);
  const [clientsList, setClientsList] = useState([]);

  // Filtros
  const [selectedUser, setSelectedUser] = useState(undefined);
  const [selectedClient, setSelectedClient] = useState(undefined);
  const [selectedModule, setSelectedModule] = useState(undefined);
  const [selectedAction, setSelectedAction] = useState(undefined);
  const [searchText, setSearchText] = useState('');
  const [dateRange, setDateRange] = useState([dayjs().subtract(30, 'day'), dayjs()]);

  // Modal de borrado de actividades por periodo (Exclusivo Socio / Titular)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteDateRange, setDeleteDateRange] = useState([dayjs().startOf('month'), dayjs().endOf('month')]);
  const [deleteUserId, setDeleteUserId] = useState(undefined);
  const [deleteClientId, setDeleteClientId] = useState(undefined);
  const [deleteModule, setDeleteModule] = useState(undefined);
  const [deleteAllHistory, setDeleteAllHistory] = useState(false);
  const [deletingLogs, setDeletingLogs] = useState(false);

  useEffect(() => {
    loadAuxiliariesAndClients();
    loadStats();
  }, []);

  useEffect(() => {
    loadLogs(page, pageSize);
    loadTimeAnalytics();
  }, [page, pageSize, selectedUser, selectedClient, selectedModule, selectedAction, dateRange]);

  const loadAuxiliariesAndClients = async () => {
    try {
      const [uRes, cRes] = await Promise.all([
        usersApi.list(),
        clientsApi.list({ limit: 1000 })
      ]);
      setUsersList(uRes.data || []);
      setClientsList(cRes.data || []);
    } catch (err) {
      console.error('Error cargando catálogos:', err);
    }
  };

  const loadStats = async () => {
    try {
      const res = await auditApi.getStats(30);
      setStats(res.data || null);
    } catch (err) {
      console.error('Error cargando estadísticas de auditoría:', err);
    }
  };

  const buildFilterParams = () => {
    const params = {};
    if (selectedUser) params.user_id = selectedUser;
    if (selectedClient) params.client_id = selectedClient;
    if (selectedModule) params.module = selectedModule;
    if (selectedAction) params.action = selectedAction;
    if (searchText && searchText.trim()) params.search = searchText.trim();
    if (dateRange && dateRange[0] && dateRange[1]) {
      params.date_from = dateRange[0].format('YYYY-MM-DD');
      params.date_to = dateRange[1].format('YYYY-MM-DD');
    }
    return params;
  };

  const loadLogs = async (p = page, ps = pageSize) => {
    setLoading(true);
    try {
      const params = {
        ...buildFilterParams(),
        page: p,
        page_size: ps,
      };
      const res = await auditApi.getLogs(params);
      setLogs(res.data?.items || []);
      setTotal(res.data?.total || 0);
    } catch (err) {
      console.error('Error cargando bitácora:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadTimeAnalytics = async () => {
    try {
      const params = buildFilterParams();
      const res = await auditApi.getTimeAnalytics(params);
      setTimeAnalytics(res.data || null);
    } catch (err) {
      console.error('Error cargando analítica de tiempos:', err);
    }
  };

  const handleRefresh = () => {
    setPage(1);
    loadStats();
    loadLogs(1, pageSize);
    loadTimeAnalytics();
  };

  const handleFilterByUser = (userId) => {
    setSelectedUser(userId === selectedUser ? undefined : userId);
    setPage(1);
  };

  const handleDeleteSingleLog = async (logId) => {
    if (!isAdmin) return;
    try {
      await auditApi.deleteSingle(logId);
      message.success('Actividad eliminada permanentemente');
      handleRefresh();
    } catch (err) {
      message.error(err?.response?.data?.detail || 'No se pudo eliminar la actividad');
    }
  };

  const handleOpenDeleteByPeriodModal = () => {
    if (!isAdmin) return;
    setDeleteDateRange(dateRange && dateRange[0] && dateRange[1] ? dateRange : [dayjs().startOf('month'), dayjs()]);
    setDeleteUserId(selectedUser);
    setDeleteClientId(selectedClient);
    setDeleteModule(selectedModule);
    setDeleteAllHistory(false);
    setDeleteModalOpen(true);
  };

  const handleExecuteDeleteByPeriod = async () => {
    if (!isAdmin) return;
    if (!deleteAllHistory && (!deleteDateRange || !deleteDateRange[0] || !deleteDateRange[1])) {
      message.warning('Selecciona el rango de fechas del periodo que deseas borrar.');
      return;
    }
    setDeletingLogs(true);
    try {
      const params = {
        delete_all: deleteAllHistory,
      };
      if (!deleteAllHistory && deleteDateRange && deleteDateRange[0] && deleteDateRange[1]) {
        params.date_from = deleteDateRange[0].format('YYYY-MM-DD');
        params.date_to = deleteDateRange[1].format('YYYY-MM-DD');
      }
      if (deleteUserId) params.user_id = deleteUserId;
      if (deleteClientId) params.client_id = deleteClientId;
      if (deleteModule) params.module = deleteModule;

      const res = await auditApi.deleteByPeriod(params);
      message.success(res.data?.message || 'Actividades del periodo eliminadas permanentemente.');
      setDeleteModalOpen(false);
      handleRefresh();
    } catch (err) {
      message.error(err?.response?.data?.detail || 'Error al eliminar actividades del periodo');
    } finally {
      setDeletingLogs(false);
    }
  };

  // Exportar Bitácora o Reporte de Tiempos a Excel y PDF con el logotipo oficial
  const buildExportPayload = () => {
    if (activeTab === 'time_analytics' && timeAnalytics) {
      const columnsDef = [
        { key: 'categoria', title: 'Tipo de Desglose', align: 'center', format: 'text', width: 18 },
        { key: 'concepto', title: 'Cliente / Actividad / Auxiliar', align: 'left', format: 'text', width: 38 },
        { key: 'identificador', title: 'RFC / Módulo / Rol', align: 'center', format: 'text', width: 18 },
        { key: 'actividades', title: 'N° Actividades', align: 'center', format: 'text', width: 15 },
        { key: 'tiempo_formato', title: 'Tiempo Invertido', align: 'center', format: 'text', width: 18 },
        { key: 'horas', title: 'Horas (Decimal)', align: 'right', format: 'text', width: 15 },
        { key: 'promedio', title: 'Promedio / Actividad', align: 'center', format: 'text', width: 18 },
        { key: 'porcentaje', title: '% del Tiempo', align: 'right', format: 'text', width: 14 },
      ];

      const rows = [];

      rows.push({
        categoria: '',
        concepto: 'I. TIEMPO INVERTIDO POR CLIENTE / EMPRESA',
        identificador: '',
        actividades: '',
        tiempo_formato: '',
        horas: '',
        promedio: '',
        porcentaje: '',
        _rowType: 'section',
      });

      (timeAnalytics.by_client || []).forEach((c) => {
        rows.push({
          categoria: 'CLIENTE',
          concepto: c.client_name,
          identificador: c.client_rfc,
          actividades: String(c.activities_count),
          tiempo_formato: formatDuration(c.total_seconds),
          horas: formatHoursDecimal(c.total_seconds),
          promedio: formatDuration(c.avg_seconds),
          porcentaje: `${c.percentage}%`,
          _rowType: 'normal',
        });
      });

      rows.push({
        categoria: '',
        concepto: 'II. TIEMPO INVERTIDO POR TIPO DE ACTIVIDAD Y MÓDULO',
        identificador: '',
        actividades: '',
        tiempo_formato: '',
        horas: '',
        promedio: '',
        porcentaje: '',
        _rowType: 'section',
      });

      (timeAnalytics.by_activity || []).forEach((a) => {
        rows.push({
          categoria: 'ACTIVIDAD',
          concepto: a.action,
          identificador: a.module,
          actividades: String(a.activities_count),
          tiempo_formato: formatDuration(a.total_seconds),
          horas: formatHoursDecimal(a.total_seconds),
          promedio: formatDuration(a.avg_seconds),
          porcentaje: `${a.percentage}%`,
          _rowType: 'normal',
        });
      });

      rows.push({
        categoria: '',
        concepto: 'III. TIEMPO INVERTIDO POR AUXILIAR / USUARIO',
        identificador: '',
        actividades: '',
        tiempo_formato: '',
        horas: '',
        promedio: '',
        porcentaje: '',
        _rowType: 'section',
      });

      (timeAnalytics.by_user || []).forEach((u) => {
        rows.push({
          categoria: 'AUXILIAR',
          concepto: `${u.full_name} (@${u.username})`,
          identificador: u.role === 'admin' ? 'Socio / Titular' : 'Auxiliar',
          actividades: String(u.activities_count),
          tiempo_formato: formatDuration(u.total_seconds),
          horas: formatHoursDecimal(u.total_seconds),
          promedio: formatDuration(u.avg_seconds),
          porcentaje: `${u.percentage}%`,
          _rowType: 'normal',
        });
      });

      rows.push({
        categoria: 'TOTAL',
        concepto: 'TIEMPO TOTAL INVERTIDO EN EL PERIODO',
        identificador: '',
        actividades: String(timeAnalytics.total_activities || 0),
        tiempo_formato: formatDuration(timeAnalytics.total_seconds || 0),
        horas: formatHoursDecimal(timeAnalytics.total_seconds || 0),
        promedio: formatDuration(timeAnalytics.avg_seconds_per_activity || 0),
        porcentaje: '100%',
        _rowType: 'total',
      });

      const summaryCards = [
        {
          label: 'Tiempo Total Invertido',
          value: formatDuration(timeAnalytics.total_seconds || 0),
          sublabel: formatHoursDecimal(timeAnalytics.total_seconds || 0),
        },
        {
          label: 'Total Actividades',
          value: String(timeAnalytics.total_activities || 0),
          sublabel: `Promedio: ${formatDuration(timeAnalytics.avg_seconds_per_activity || 0)}`,
        },
        {
          label: 'Clientes Atendidos',
          value: String((timeAnalytics.by_client || []).length),
          sublabel: 'Con tiempo registrado',
        },
        {
          label: 'Periodo Analizado',
          value: dateRange && dateRange[0] && dateRange[1]
            ? `${dateRange[0].format('DD/MM/YY')} - ${dateRange[1].format('DD/MM/YY')}`
            : 'General',
          sublabel: 'Supervisión de tiempos',
        },
      ];

      return {
        title: 'REPORTE DE TIEMPOS INVERTIDOS POR CLIENTE Y POR ACTIVIDAD',
        subtitle: 'Análisis de Tiempo Efectivo por Empresa, Módulo Contable/Fiscal y Auxiliar',
        clientName: 'GARCIA SALAS — ASESORES DE NEGOCIO',
        clientRfc: 'DESPACHO CONTABLE Y FISCAL',
        period: dateRange && dateRange[0] && dateRange[1]
          ? `${dateRange[0].format('DD/MM/YYYY')} al ${dateRange[1].format('DD/MM/YYYY')}`
          : 'General',
        columns: columnsDef,
        rows,
        summaryCards,
        notes: 'Reporte de control de tiempos invertidos generado en ContaCloud MX.',
        filename: `Reporte_Tiempos_Invertidos_${dayjs().format('YYYYMMDD')}.xlsx`,
      };
    }

    const columnsDef = [
      { key: 'fecha', title: 'Fecha y Hora', align: 'center', format: 'text', width: 20 },
      { key: 'usuario', title: 'Auxiliar / Usuario', align: 'left', format: 'text', width: 24 },
      { key: 'empresa', title: 'Empresa / Cliente', align: 'left', format: 'text', width: 32 },
      { key: 'modulo', title: 'Módulo', align: 'center', format: 'text', width: 16 },
      { key: 'accion', title: 'Acción', align: 'center', format: 'text', width: 18 },
      { key: 'tiempo', title: 'Tiempo Invertido', align: 'center', format: 'text', width: 15 },
      { key: 'descripcion', title: 'Descripción de la Actividad', align: 'left', format: 'text', width: 45 },
    ];

    const rows = logs.map(it => ({
      fecha: dayjs(it.created_at).format('DD/MM/YYYY hh:mm A'),
      usuario: `${it.user_full_name || it.username} (@${it.username})`,
      empresa: it.client_name ? `${it.client_name} (${it.client_rfc})` : 'Sistema Global / Administrativo',
      modulo: it.module,
      accion: it.action,
      tiempo: formatDuration(it.duration_seconds || 120),
      descripcion: it.description,
      _rowType: 'normal'
    }));

    const summaryCards = [
      { label: 'Total Actividades', value: String(total), sublabel: 'En el periodo consultado' },
      {
        label: 'Tiempo Total Periodo',
        value: formatDuration(timeAnalytics?.total_seconds || 0),
        sublabel: formatHoursDecimal(timeAnalytics?.total_seconds || 0),
      },
      { label: 'Actividades Hoy', value: String(stats?.total_today || 0), sublabel: 'Movimientos del día' },
      {
        label: 'Rango de Fecha',
        value: dateRange && dateRange[0] && dateRange[1]
          ? `${dateRange[0].format('DD/MM/YY')} - ${dateRange[1].format('DD/MM/YY')}`
          : 'Todo',
        sublabel: 'Periodo de supervisión',
      },
    ];

    return {
      title: 'BITÁCORA DE ACTIVIDADES Y TIEMPOS POR AUXILIAR',
      subtitle: 'Supervisión de Productividad, Tiempos Invertidos y Control de Movimientos',
      clientName: 'GARCIA SALAS — ASESORES DE NEGOCIO',
      clientRfc: 'DESPACHO CONTABLE Y FISCAL',
      period: dateRange && dateRange[0] && dateRange[1]
        ? `${dateRange[0].format('DD/MM/YYYY')} al ${dateRange[1].format('DD/MM/YYYY')}`
        : 'General',
      columns: columnsDef,
      rows,
      summaryCards,
      notes: 'Registro de auditoría interna de ContaCloud MX. Documento confidencial para uso exclusivo del Titular del Despacho.',
      filename: `Bitacora_Actividades_${dayjs().format('YYYYMMDD')}.xlsx`
    };
  };

  const handleExportExcel = () => exportToExcel(buildExportPayload());
  const handleExportPdf = () => exportToPdfWithLogo(buildExportPayload());

  const columns = [
    {
      title: 'Fecha y Hora',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 145,
      render: (d) => (
        <div>
          <div className="font-semibold text-xs text-gray-800">
            {dayjs(d).format('DD/MM/YYYY')}
          </div>
          <div className="text-[11px] text-gray-500 font-mono">
            {dayjs(d).format('hh:mm:ss A')}
          </div>
        </div>
      ),
    },
    {
      title: 'Auxiliar / Usuario',
      key: 'user',
      width: 205,
      render: (_, r) => (
        <div className="flex items-center gap-2.5">
          <Avatar
            src={r.photo_url}
            icon={!r.photo_url && <UserOutlined />}
            className="bg-blue-600 shrink-0"
            size="small"
          />
          <div className="truncate">
            <div className="font-bold text-xs text-gray-900 truncate" title={r.user_full_name || r.username}>
              {r.user_full_name || r.username}
            </div>
            <div className="text-[11px] text-gray-500">
              @{r.username} • <span className="text-blue-700 font-medium">{r.user_role === 'admin' ? 'Titular' : 'Auxiliar'}</span>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: 'Empresa / Cliente',
      key: 'client',
      width: 210,
      render: (_, r) => r.client_name ? (
        <div>
          <div className="font-semibold text-xs text-gray-800 truncate" title={r.client_name}>
            {r.client_name}
          </div>
          <div className="text-[11px] font-mono text-blue-900 font-bold">
            {r.client_rfc}
          </div>
        </div>
      ) : (
        <Tag color="default" className="text-[11px] font-sans">
          Administrativo / General
        </Tag>
      ),
    },
    {
      title: 'Módulo / Acción',
      key: 'module_action',
      width: 185,
      render: (_, r) => (
        <div className="space-y-1">
          <Tag color={MODULE_COLORS[r.module] || 'blue'} className="text-[11px] font-semibold px-2 py-0 m-0">
            {r.module}
          </Tag>
          <div className="flex items-center gap-1 text-xs">
            {ACTION_ICONS[r.action] || <AuditOutlined className="text-gray-500" />}
            <span className="font-semibold text-[11px] text-gray-800 font-mono">{r.action}</span>
          </div>
        </div>
      ),
    },
    {
      title: 'Tiempo Invertido',
      dataIndex: 'duration_seconds',
      key: 'duration_seconds',
      width: 130,
      align: 'center',
      render: (secs) => (
        <Tag color="geekblue" icon={<ClockCircleOutlined />} className="font-mono font-bold text-xs m-0">
          {formatDuration(secs || 120)}
        </Tag>
      ),
    },
    {
      title: 'Descripción de la Actividad',
      dataIndex: 'description',
      key: 'description',
      render: (desc, r) => (
        <div>
          <div className="text-xs text-gray-900 font-medium leading-relaxed">
            {desc}
          </div>
          {r.entity_id && (
            <div className="text-[10px] text-gray-400 font-mono mt-0.5">
              Ref ID / Folio: <strong>{r.entity_id}</strong> {r.ip_address ? `• IP: ${r.ip_address}` : ''}
            </div>
          )}
        </div>
      ),
    },
    ...(isAdmin
      ? [
          {
            title: 'Borrar',
            key: 'delete_action',
            width: 70,
            align: 'center',
            render: (_, r) => (
              <Popconfirm
                title="¿Eliminar permanentemente esta actividad?"
                onConfirm={() => handleDeleteSingleLog(r.id)}
                okText="Eliminar"
                cancelText="Cancelar"
                okButtonProps={{ danger: true }}
              >
                <Tooltip title="Eliminar esta actividad permanentemente (Solo Socio/Titular)">
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Tooltip>
              </Popconfirm>
            ),
          },
        ]
      : []),
  ];

  const clientTimeColumns = [
    {
      title: 'Cliente / Empresa',
      key: 'client',
      render: (_, r) => (
        <div>
          <div className="font-bold text-xs text-gray-900">{r.client_name}</div>
          <div className="text-[11px] font-mono text-blue-700 font-semibold">{r.client_rfc}</div>
        </div>
      ),
    },
    {
      title: 'Actividades Realizadas',
      dataIndex: 'activities_count',
      key: 'activities_count',
      width: 190,
      render: (cnt, r) => (
        <div className="text-xs">
          <div className="font-bold text-gray-800">{cnt} actividades</div>
          <div className="text-[11px] text-gray-500">
            Pólizas: {r.journals_count} • CFDIs: {r.cfdis_count} • Otros: {r.other_count}
          </div>
        </div>
      ),
    },
    {
      title: 'Auxiliares Involucrados',
      key: 'users',
      width: 220,
      render: (_, r) => (
        <div className="flex flex-wrap gap-1">
          {(r.users_involved || []).map((uName, idx) => (
            <Tag key={idx} color="purple" className="text-[11px] m-0">
              {uName}
            </Tag>
          ))}
        </div>
      ),
    },
    {
      title: 'Promedio por Actividad',
      dataIndex: 'avg_seconds',
      key: 'avg_seconds',
      width: 150,
      align: 'center',
      render: (val) => <span className="font-mono text-xs text-gray-700">{formatDuration(val)}</span>,
    },
    {
      title: 'Tiempo Total Invertido',
      dataIndex: 'total_seconds',
      key: 'total_seconds',
      width: 180,
      align: 'right',
      render: (val) => (
        <div>
          <Tag color="blue" icon={<ClockCircleOutlined />} className="font-mono font-bold text-xs m-0">
            {formatDuration(val)}
          </Tag>
          <div className="text-[11px] font-mono text-gray-500 mt-0.5">{formatHoursDecimal(val)}</div>
        </div>
      ),
    },
    {
      title: '% del Tiempo Total',
      dataIndex: 'percentage',
      key: 'percentage',
      width: 170,
      render: (pct) => <Progress percent={pct} size="small" status="active" />,
    },
  ];

  const activityTimeColumns = [
    {
      title: 'Actividad / Acción',
      dataIndex: 'action',
      key: 'action',
      render: (a) => (
        <Space size={6}>
          {ACTION_ICONS[a] || <AuditOutlined className="text-gray-500" />}
          <span className="font-bold text-xs font-mono text-gray-800">{a}</span>
        </Space>
      ),
    },
    {
      title: 'Módulo',
      dataIndex: 'module',
      key: 'module',
      width: 160,
      render: (m) => (
        <Tag color={MODULE_COLORS[m] || 'blue'} className="font-semibold text-xs">
          {m}
        </Tag>
      ),
    },
    {
      title: 'Veces Realizada',
      dataIndex: 'activities_count',
      key: 'activities_count',
      width: 130,
      align: 'center',
      render: (cnt) => <span className="font-bold text-xs">{cnt}</span>,
    },
    {
      title: 'Clientes Atendidos',
      dataIndex: 'clients_count',
      key: 'clients_count',
      width: 140,
      align: 'center',
      render: (cnt) => <Tag color="cyan">{cnt} empresa(s)</Tag>,
    },
    {
      title: 'Tiempo Promedio',
      dataIndex: 'avg_seconds',
      key: 'avg_seconds',
      width: 140,
      align: 'center',
      render: (val) => <span className="font-mono text-xs">{formatDuration(val)}</span>,
    },
    {
      title: 'Tiempo Total Invertido',
      dataIndex: 'total_seconds',
      key: 'total_seconds',
      width: 170,
      align: 'right',
      render: (val) => (
        <div>
          <Tag color="geekblue" icon={<ClockCircleOutlined />} className="font-mono font-bold text-xs m-0">
            {formatDuration(val)}
          </Tag>
          <div className="text-[11px] font-mono text-gray-500 mt-0.5">{formatHoursDecimal(val)}</div>
        </div>
      ),
    },
    {
      title: '% del Tiempo',
      dataIndex: 'percentage',
      key: 'percentage',
      width: 160,
      render: (pct) => <Progress percent={pct} size="small" strokeColor="#7c3aed" />,
    },
  ];

  if (currentUser && currentUser.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen print:p-0 print:bg-white font-sans">
      {/* Encabezado */}
      <div className="flex flex-wrap justify-between items-center mb-5 gap-4">
        <div>
          <Title level={2} className="m-0 flex items-center gap-2 text-gray-800">
            <HistoryOutlined className="text-blue-600" />
            Bitácora de Actividades y Tiempos Invertidos
          </Title>
          <Text type="secondary" className="text-xs">
            Supervisión de productividad, tiempos invertidos en cada actividad y en cada cliente, y depuración de historial por periodos.
          </Text>
        </div>
        <Space wrap>
          {isAdmin && (
            <Button
              danger
              type="primary"
              icon={<ClearOutlined />}
              onClick={handleOpenDeleteByPeriodModal}
              className="font-semibold shadow-sm"
            >
              Borrar Actividades por Periodo
            </Button>
          )}
          <Button
            type="primary"
            icon={<FileExcelOutlined />}
            onClick={handleExportExcel}
            className="bg-emerald-600 hover:bg-emerald-700 border-emerald-600 font-semibold shadow-sm"
          >
            Exportar Excel (.xlsx)
          </Button>
          <Button
            type="primary"
            icon={<FilePdfOutlined />}
            onClick={handleExportPdf}
            className="bg-sky-500 hover:bg-sky-600 border-sky-500 font-semibold shadow-sm"
            style={{ backgroundColor: '#0ea5e9', borderColor: '#0ea5e9', color: '#ffffff' }}
          >
            PDF Membretado
          </Button>
          <Button icon={<ReloadOutlined />} onClick={handleRefresh}>
            Actualizar
          </Button>
        </Space>
      </div>

      {/* Tarjetas de Métricas Generales */}
      <Row gutter={[16, 16]} className="mb-6">
        <Col xs={12} sm={6}>
          <Card size="small" className="shadow-sm border-l-4 border-l-blue-600 bg-white">
            <Statistic
              title={<span className="text-xs font-bold text-gray-500 uppercase">Actividades en Periodo</span>}
              value={timeAnalytics?.total_activities ?? total}
              valueStyle={{ fontWeight: 800, color: '#1e40af' }}
              prefix={<HistoryOutlined className="text-blue-500 mr-1" />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="shadow-sm border-l-4 border-l-emerald-600 bg-white">
            <Statistic
              title={<span className="text-xs font-bold text-gray-500 uppercase">Tiempo Total Invertido</span>}
              value={formatDuration(timeAnalytics?.total_seconds || 0)}
              valueStyle={{ fontWeight: 800, color: '#047857', fontSize: 20 }}
              prefix={<ClockCircleOutlined className="text-emerald-500 mr-1" />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="shadow-sm border-l-4 border-l-purple-600 bg-white">
            <Statistic
              title={<span className="text-xs font-bold text-gray-500 uppercase">Promedio por Actividad</span>}
              value={formatDuration(timeAnalytics?.avg_seconds_per_activity || 0)}
              valueStyle={{ fontWeight: 800, color: '#6b21a8', fontSize: 20 }}
              prefix={<BarChartOutlined className="text-purple-500 mr-1" />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="shadow-sm border-l-4 border-l-amber-500 bg-white">
            <Statistic
              title={<span className="text-xs font-bold text-gray-500 uppercase">Clientes con Actividad</span>}
              value={(timeAnalytics?.by_client || []).length}
              valueStyle={{ fontWeight: 800, color: '#b45309' }}
              prefix={<ApartmentOutlined className="text-amber-500 mr-1" />}
            />
          </Card>
        </Col>
      </Row>

      {/* Desglose de Productividad y Tiempo por Auxiliar (Tarjetas Ejecutivas) */}
      <Card
        size="small"
        className="mb-6 shadow-sm border border-gray-200 bg-white"
        title={
          <div className="flex justify-between items-center py-1">
            <span className="font-bold text-sm text-gray-800 flex items-center gap-2">
              <AuditOutlined className="text-blue-600" />
              Productividad y Tiempo Invertido por Auxiliar (Últimos 30 días)
            </span>
            <span className="text-xs text-gray-500 font-normal">
              Haz clic en cualquier auxiliar para filtrar sus actividades y tiempos
            </span>
          </div>
        }
      >
        <Row gutter={[16, 16]}>
          {(stats?.user_stats || []).map((u) => {
            const isSelected = selectedUser === u.user_id;
            return (
              <Col xs={24} sm={12} md={8} lg={6} key={u.user_id}>
                <div
                  onClick={() => handleFilterByUser(u.user_id)}
                  className={`p-3.5 rounded-lg border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50/70 shadow-md ring-2 ring-blue-300'
                      : 'border-gray-200 bg-gray-50/60 hover:bg-white hover:border-blue-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2.5">
                    <Avatar
                      src={u.photo_url}
                      icon={!u.photo_url && <UserOutlined />}
                      size={44}
                      className={u.role === 'admin' ? 'bg-blue-700' : 'bg-purple-600'}
                    />
                    <div className="truncate flex-1">
                      <div className="font-bold text-sm text-gray-900 truncate">
                        {u.full_name}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {u.position}
                      </div>
                      <div className="text-[11px] font-mono text-gray-400">
                        @{u.username}
                      </div>
                    </div>
                  </div>

                  <div className="mb-2 bg-indigo-50 border border-indigo-200 rounded px-2 py-1 flex items-center justify-between text-xs">
                    <span className="text-indigo-800 font-semibold">
                      <ClockCircleOutlined className="mr-1" />
                      Tiempo Invertido:
                    </span>
                    <span className="font-mono font-bold text-indigo-900">
                      {formatDuration(u.total_seconds || 0)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200/70 text-xs font-mono">
                    <div className="bg-white p-1.5 rounded border border-gray-100 text-center">
                      <div className="text-[10px] text-gray-500 font-sans">Total Acciones</div>
                      <div className="font-bold text-blue-700 text-sm">{u.total_actions}</div>
                    </div>
                    <div className="bg-white p-1.5 rounded border border-gray-100 text-center">
                      <div className="text-[10px] text-gray-500 font-sans">Pólizas Creadas</div>
                      <div className="font-bold text-emerald-700 text-sm">{u.journals_created}</div>
                    </div>
                    <div className="bg-white p-1.5 rounded border border-gray-100 text-center">
                      <div className="text-[10px] text-gray-500 font-sans">Pólizas Editadas</div>
                      <div className="font-bold text-amber-700 text-sm">{u.journals_edited}</div>
                    </div>
                    <div className="bg-white p-1.5 rounded border border-gray-100 text-center">
                      <div className="text-[10px] text-gray-500 font-sans">CFDIs Cargados</div>
                      <div className="font-bold text-purple-700 text-sm">{u.cfdis_uploaded}</div>
                    </div>
                  </div>

                  <div className="mt-2 text-[10px] text-gray-400 truncate text-right">
                    {u.last_activity_at ? `Última: ${dayjs(u.last_activity_at).format('DD/MM/YY hh:mm a')}` : 'Sin movimientos'}
                  </div>
                </div>
              </Col>
            );
          })}
        </Row>
      </Card>

      {/* Barra de Filtros */}
      <Card size="small" className="mb-4 shadow-sm bg-white border border-gray-200">
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} sm={12} md={5}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Auxiliar:</label>
            <Select
              allowClear
              placeholder="Todos los auxiliares"
              value={selectedUser}
              onChange={setSelectedUser}
              style={{ width: '100%' }}
            >
              {usersList.map((u) => (
                <Option key={u.id} value={u.id}>
                  {u.full_name || u.username} (@{u.username})
                </Option>
              ))}
            </Select>
          </Col>

          <Col xs={24} sm={12} md={5}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Empresa / Cliente:</label>
            <Select
              allowClear
              placeholder="Todas las empresas"
              value={selectedClient}
              onChange={setSelectedClient}
              style={{ width: '100%' }}
              showSearch
              filterOption={(input, option) =>
                (option?.children ?? '').toLowerCase().includes(input.toLowerCase())
              }
            >
              {clientsList.map((c) => (
                <Option key={c.id} value={c.id}>
                  {c.business_name} ({c.rfc})
                </Option>
              ))}
            </Select>
          </Col>

          <Col xs={12} sm={6} md={3}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Módulo:</label>
            <Select
              allowClear
              placeholder="Todos"
              value={selectedModule}
              onChange={setSelectedModule}
              style={{ width: '100%' }}
            >
              <Option value="Pólizas">Pólizas</Option>
              <Option value="CFDIs">CFDIs</Option>
              <Option value="Cierre Anual">Cierre Anual</Option>
              <Option value="Clientes">Clientes</Option>
              <Option value="Respaldos">Respaldos</Option>
              <Option value="Activos Fijos">Activos Fijos</Option>
              <Option value="Fiscal">Fiscal</Option>
              <Option value="Usuarios / Auxiliares">Usuarios</Option>
            </Select>
          </Col>

          <Col xs={12} sm={6} md={3}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Acción:</label>
            <Select
              allowClear
              placeholder="Todas"
              value={selectedAction}
              onChange={setSelectedAction}
              style={{ width: '100%' }}
            >
              <Option value="CREAR_POLIZA">Crear Póliza</Option>
              <Option value="EDITAR_POLIZA">Editar Póliza</Option>
              <Option value="ELIMINAR_POLIZA">Eliminar Póliza</Option>
              <Option value="CIERRE_EJERCICIO">Cierre Ejercicio</Option>
              <Option value="REVERTIR_CIERRE">Revertir Cierre</Option>
              <Option value="CARGA_CFDI">Cargar CFDIs</Option>
              <Option value="CREAR_CLIENTE">Crear Cliente</Option>
              <Option value="DESCARGAR_RESPALDO">Descargar Respaldo</Option>
              <Option value="RESTAURAR_RESPALDO">Restaurar Respaldo</Option>
            </Select>
          </Col>

          <Col xs={24} sm={12} md={4}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Periodo:</label>
            <RangePicker
              value={dateRange}
              onChange={setDateRange}
              format="DD/MM/YYYY"
              style={{ width: '100%' }}
            />
          </Col>

          <Col xs={24} sm={12} md={4}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Buscar Texto:</label>
            <Input
              placeholder="Folio, descripción, RFC..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onPressEnter={() => {
                loadLogs(1, pageSize);
                loadTimeAnalytics();
              }}
              prefix={<SearchOutlined className="text-gray-400" />}
              allowClear
            />
          </Col>
        </Row>
      </Card>

      {/* Pestañas: Historial Cronológico vs. Tiempos Invertidos por Cliente y Actividad */}
      <Card size="small" className="shadow-sm border border-gray-200 bg-white">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'history',
              label: (
                <span className="font-semibold flex items-center gap-1.5">
                  <HistoryOutlined />
                  Historial Cronológico de Actividades ({total})
                </span>
              ),
              children: (
                <div>
                  <Table
                    columns={columns}
                    dataSource={logs}
                    rowKey="id"
                    loading={loading}
                    size="small"
                    bordered
                    pagination={{
                      current: page,
                      pageSize: pageSize,
                      total: total,
                      showSizeChanger: true,
                      pageSizeOptions: ['15', '25', '50', '100'],
                      onChange: (p, ps) => {
                        setPage(p);
                        setPageSize(ps);
                      },
                      showTotal: (tot, range) => `${range[0]}-${range[1]} de ${tot} actividades`,
                    }}
                    expandable={{
                      expandedRowRender: (record) => (
                        <div className="bg-gray-50 p-3 rounded text-xs font-mono space-y-1 text-gray-700">
                          <div><strong>ID Registro de Auditoría:</strong> #{record.id}</div>
                          <div><strong>Rol del Usuario:</strong> {record.user_role}</div>
                          <div><strong>Tiempo Invertido en la Actividad:</strong> {formatDuration(record.duration_seconds || 120)}</div>
                          {record.ip_address && <div><strong>Dirección IP:</strong> {record.ip_address}</div>}
                          {record.details && (
                            <div className="mt-1">
                              <strong>Parámetros Detallados:</strong>
                              <pre className="bg-white p-2 rounded border border-gray-200 text-[11px] overflow-x-auto mt-0.5">
                                {record.details}
                              </pre>
                            </div>
                          )}
                        </div>
                      ),
                      rowExpandable: (record) => Boolean(record.details || record.ip_address),
                    }}
                  />
                </div>
              ),
            },
            {
              key: 'time_analytics',
              label: (
                <span className="font-semibold flex items-center gap-1.5">
                  <ClockCircleOutlined />
                  Tiempos Invertidos por Cliente y por Actividad
                </span>
              ),
              children: (
                <div className="space-y-6 pt-2">
                  <Alert
                    type="info"
                    showIcon
                    message="Resumen de Tiempos Invertidos por Empresa y por Actividad"
                    description="Aquí puedes revisar cuánto tiempo se ha invertido en cada cliente y en cada tipo de actividad contable/fiscal dentro del periodo seleccionado. Puedes exportar este reporte a Excel (.xlsx) o PDF Membretado con los botones superiores."
                  />

                  <Card
                    size="small"
                    title={
                      <span className="font-bold text-sm text-gray-800">
                        <ApartmentOutlined className="mr-2 text-blue-600" />
                        1. Tiempo Invertido por Cliente / Empresa ({(timeAnalytics?.by_client || []).length})
                      </span>
                    }
                  >
                    <Table
                      columns={clientTimeColumns}
                      dataSource={timeAnalytics?.by_client || []}
                      rowKey={(r) => String(r.client_id || r.client_name)}
                      size="small"
                      bordered
                      pagination={{ pageSize: 15 }}
                    />
                  </Card>

                  <Card
                    size="small"
                    title={
                      <span className="font-bold text-sm text-gray-800">
                        <ClockCircleOutlined className="mr-2 text-purple-600" />
                        2. Tiempo Invertido por Tipo de Actividad y Módulo ({(timeAnalytics?.by_activity || []).length})
                      </span>
                    }
                  >
                    <Table
                      columns={activityTimeColumns}
                      dataSource={timeAnalytics?.by_activity || []}
                      rowKey={(r) => `${r.module}-${r.action}`}
                      size="small"
                      bordered
                      pagination={{ pageSize: 15 }}
                    />
                  </Card>
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* Modal para Borrar Actividades por Periodo (Exclusivo Socio / Titular) */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-red-600">
            <ClearOutlined />
            <span>Borrar Actividades por Periodo (Exclusivo Socio / Titular)</span>
          </div>
        }
        open={deleteModalOpen}
        onCancel={() => setDeleteModalOpen(false)}
        onOk={handleExecuteDeleteByPeriod}
        confirmLoading={deletingLogs}
        okText="Eliminar Actividades Permanentemente"
        okButtonProps={{ danger: true }}
        cancelText="Cancelar"
        width={560}
        destroyOnClose
      >
        <div className="space-y-4">
          <Alert
            type="warning"
            showIcon
            message="Eliminación Permanente de Actividades"
            description="Las actividades dentro del periodo seleccionado se borrarán de forma definitiva de la base de datos para que ya no se muestren en la bitácora. Esta acción solo puede ser realizada por el Socio / Titular."
          />

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Selección rápida de periodo a borrar:
            </label>
            <div className="flex flex-wrap gap-1.5">
              <Tag
                color={!deleteAllHistory ? 'blue' : 'default'}
                className="cursor-pointer text-xs px-2.5 py-0.5"
                onClick={() => {
                  setDeleteAllHistory(false);
                  setDeleteDateRange([dayjs(), dayjs()]);
                }}
              >
                Solo Hoy
              </Tag>
              <Tag
                color={!deleteAllHistory ? 'blue' : 'default'}
                className="cursor-pointer text-xs px-2.5 py-0.5"
                onClick={() => {
                  setDeleteAllHistory(false);
                  setDeleteDateRange([dayjs().subtract(7, 'day'), dayjs()]);
                }}
              >
                Últimos 7 días
              </Tag>
              <Tag
                color={!deleteAllHistory ? 'blue' : 'default'}
                className="cursor-pointer text-xs px-2.5 py-0.5"
                onClick={() => {
                  setDeleteAllHistory(false);
                  setDeleteDateRange([dayjs().startOf('month'), dayjs().endOf('month')]);
                }}
              >
                Mes Actual ({dayjs().format('MMMM YYYY')})
              </Tag>
              <Tag
                color={!deleteAllHistory ? 'blue' : 'default'}
                className="cursor-pointer text-xs px-2.5 py-0.5"
                onClick={() => {
                  setDeleteAllHistory(false);
                  const prev = dayjs().subtract(1, 'month');
                  setDeleteDateRange([prev.startOf('month'), prev.endOf('month')]);
                }}
              >
                Mes Anterior
              </Tag>
              <Tag
                color={deleteAllHistory ? 'red' : 'default'}
                className="cursor-pointer text-xs px-2.5 py-0.5 font-semibold"
                onClick={() => setDeleteAllHistory(true)}
              >
                Todo el Historial Completo
              </Tag>
            </div>
          </div>

          {!deleteAllHistory && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Rango de Fechas a Borrar:
              </label>
              <RangePicker
                value={deleteDateRange}
                onChange={(vals) => setDeleteDateRange(vals)}
                format="DD/MM/YYYY"
                style={{ width: '100%' }}
              />
            </div>
          )}

          <Row gutter={12}>
            <Col span={12}>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Filtrar por Auxiliar (Opcional):
              </label>
              <Select
                allowClear
                placeholder="Todos los auxiliares"
                value={deleteUserId}
                onChange={setDeleteUserId}
                style={{ width: '100%' }}
              >
                {usersList.map((u) => (
                  <Option key={u.id} value={u.id}>
                    {u.full_name || u.username}
                  </Option>
                ))}
              </Select>
            </Col>
            <Col span={12}>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Filtrar por Cliente (Opcional):
              </label>
              <Select
                allowClear
                showSearch
                placeholder="Todos los clientes"
                value={deleteClientId}
                onChange={setDeleteClientId}
                style={{ width: '100%' }}
                filterOption={(input, option) =>
                  (option?.children ?? '').toLowerCase().includes(input.toLowerCase())
                }
              >
                {clientsList.map((c) => (
                  <Option key={c.id} value={c.id}>
                    {c.business_name} ({c.rfc})
                  </Option>
                ))}
              </Select>
            </Col>
          </Row>
        </div>
      </Modal>
    </div>
  );
};

export default AuditLog;
