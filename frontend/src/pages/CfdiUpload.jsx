import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Tabs, Upload, Table, Button, Card, Typography, Tag, Select, 
  message, notification, Space, Tooltip, Row, Col, Input, Popconfirm, Badge, Alert, Modal 
} from 'antd';
import { 
  InboxOutlined, FileTextOutlined, CheckCircleOutlined, 
  FileAddOutlined, DeleteOutlined, SyncOutlined, 
  ArrowRightOutlined, SearchOutlined, FileSearchOutlined,
  FundOutlined, FileExcelOutlined, FilePdfOutlined, PrinterOutlined,
  IdcardOutlined, EyeOutlined
} from '@ant-design/icons';
import { useParams, Link } from 'react-router-dom';
import { cfdiApi, accountsApi, clientsApi } from '../api/client';
import { exportToExcel, exportToPdfWithLogo } from '../utils/exportPaperwork';
import FixedAssetModal from '../components/FixedAssetModal';
import dayjs from 'dayjs';

const { Dragger } = Upload;
const { Title, Text } = Typography;

const formatMoney = (val) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val || 0);

const formaPagoLabels = {
  '01': '01 Efectivo',
  '02': '02 Cheque nominativo',
  '03': '03 Transferencia electrónica',
  '04': '04 Tarjeta de crédito',
  '28': '28 Tarjeta de débito',
  '99': '99 Por definir'
};

const currentYear = dayjs().year();
const yearOptions = [
  { value: 'all', label: 'Todos los Años' },
  ...[currentYear + 1, currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4].map(y => ({
    value: y,
    label: `${y}`
  }))
];

const CfdiUpload = () => {
  const { clientId } = useParams();
  const [activeTab, setActiveTab] = useState('emitido'); // 'emitido' | 'recibido'
  const [clientInfo, setClientInfo] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'pending' | 'posted'
  const [validatorFilter, setValidatorFilter] = useState('all'); // 'all' | 'any_observation' | 'missing_fuel' | 'regime_mismatch'
  const [selectedYear, setSelectedYear] = useState(dayjs().year());
  const [selectedMonth, setSelectedMonth] = useState('all');

  // Modal para detalle de carga por lote
  const [uploadModalData, setUploadModalData] = useState(null);
  const [inversionModalCfdi, setInversionModalCfdi] = useState(null);
  const [detectedInversionCfdis, setDetectedInversionCfdis] = useState([]);
  const [nominaDetailRecord, setNominaDetailRecord] = useState(null);
  const pendingFilesRef = useRef([]);
  const uploadTimeoutRef = useRef(null);

  // Conteo dinámico de comprobantes por mes para el año seleccionado
  const monthCounts = useMemo(() => {
    const counts = {};
    invoices.forEach(inv => {
      if (inv.date) {
        const m = dayjs(inv.date).month() + 1;
        counts[m] = (counts[m] || 0) + 1;
      }
    });
    return counts;
  }, [invoices]);

  const monthOptions = useMemo(() => [
    { value: 'all', label: `Todos los Meses (${invoices.length})` },
    { value: 1, label: `01 - Enero (${monthCounts[1] || 0})` },
    { value: 2, label: `02 - Febrero (${monthCounts[2] || 0})` },
    { value: 3, label: `03 - Marzo (${monthCounts[3] || 0})` },
    { value: 4, label: `04 - Abril (${monthCounts[4] || 0})` },
    { value: 5, label: `05 - Mayo (${monthCounts[5] || 0})` },
    { value: 6, label: `06 - Junio (${monthCounts[6] || 0})` },
    { value: 7, label: `07 - Julio (${monthCounts[7] || 0})` },
    { value: 8, label: `08 - Agosto (${monthCounts[8] || 0})` },
    { value: 9, label: `09 - Septiembre (${monthCounts[9] || 0})` },
    { value: 10, label: `10 - Octubre (${monthCounts[10] || 0})` },
    { value: 11, label: `11 - Noviembre (${monthCounts[11] || 0})` },
    { value: 12, label: `12 - Diciembre (${monthCounts[12] || 0})` },
  ], [invoices, monthCounts]);

  // Cargar datos (obteniendo el año completo para conocer la distribución mensual)
  const fetchInvoices = async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const res = await cfdiApi.list(clientId, activeTab, undefined, selectedYear, 'all');
      setInvoices(res.data || []);
      setSelectedRowKeys([]);
    } catch (err) {
      message.error('Error al cargar la lista de CFDIs.');
    } finally {
      setLoading(false);
    }
  };

  const fetchAccounts = async () => {
    if (!clientId) return;
    try {
      const res = await accountsApi.getClientAccounts(clientId, { active_only: true });
      setAccounts(res.data || []);
    } catch (err) {
      console.error('Error al cargar cuentas:', err);
    }
  };

  useEffect(() => {
    if (clientId) {
      clientsApi.get(clientId).then(r => setClientInfo(r.data)).catch(() => {});
      fetchAccounts();
    }
  }, [clientId]);

  useEffect(() => {
    fetchInvoices();
  }, [clientId, activeTab, selectedYear]);

  // Procesar lote agrupado de archivos XML para evitar bloqueos concurrentes
  const processBatchUpload = async (filesToUpload) => {
    if (!filesToUpload || filesToUpload.length === 0) return;
    setUploading(true);
    try {
      const res = await cfdiApi.upload(clientId, activeTab, filesToUpload);
      const successCount = res.data?.success_count || 0;
      const errors = res.data?.errors || [];
      const uploadedInvoices = res.data?.invoices || [];
      const blacklistWarnings = res.data?.blacklist_warnings || [];

      if (blacklistWarnings.length > 0) {
        notification.warning({
          message: `🚨 ALERTA FISCAL SAT (Art. 69-B / 49-B): ${blacklistWarnings.length} CFDI(s) con RFC señalado`,
          description: (
            <div className="text-xs space-y-1 mt-1">
              {blacklistWarnings.slice(0, 4).map((w, idx) => (
                <div key={idx} className="text-red-700 font-semibold">
                  • {w.rfc} ({w.name}): <strong>Listado {w.list_type} — {w.situation}</strong> (Folio {w.folio})
                </div>
              ))}
              <div className="pt-1 text-gray-600">
                Revise el módulo <strong>Validador 69-B / 49-B SAT</strong> para evaluar el riesgo de deducibilidad y acreditamiento (EDOS).
              </div>
            </div>
          ),
          duration: 12,
        });
      }

      if (activeTab === 'recibido') {
        const missingFuelUploaded = uploadedInvoices.filter(inv => inv.missing_fuel_complement);
        const fuelCashUploaded = uploadedInvoices.filter(inv => inv.fuel_paid_in_cash);
        const regimeMismatchUploaded = uploadedInvoices.filter(inv => inv.regime_mismatch);
        const personalDeductionUploaded = uploadedInvoices.filter(inv => inv.is_personal_deduction_use);
        if (
          missingFuelUploaded.length > 0 ||
          fuelCashUploaded.length > 0 ||
          regimeMismatchUploaded.length > 0 ||
          personalDeductionUploaded.length > 0
        ) {
          notification.warning({
            message: `⚠️ Validadores de CFDI Recibidos: Observaciones detectadas`,
            description: (
              <div className="text-xs space-y-1 mt-1">
                {missingFuelUploaded.length > 0 && (
                  <div className="text-orange-700 font-semibold">
                    • ⛽ {missingFuelUploaded.length} comprobante(s) de combustible sin su Complemento de Combustible ({missingFuelUploaded.slice(0, 3).map(i => i.folio).join(', ')}).
                  </div>
                )}
                {fuelCashUploaded.length > 0 && (
                  <div className="text-red-700 font-semibold">
                    • 💵🚫 {fuelCashUploaded.length} comprobante(s) de combustible pagado(s) en Efectivo — No deducible ({fuelCashUploaded.slice(0, 3).map(i => i.folio).join(', ')}).
                  </div>
                )}
                {regimeMismatchUploaded.length > 0 && (
                  <div className="text-pink-700 font-semibold">
                    • ⚠️ {regimeMismatchUploaded.length} comprobante(s) con Régimen Fiscal Receptor distinto al registrado del cliente ({regimeMismatchUploaded.slice(0, 3).map(i => `${i.folio}: XML ${i.receiver_tax_regime} ≠ Cliente ${i.expected_client_regime}`).join('; ')}).
                  </div>
                )}
                {personalDeductionUploaded.length > 0 && (
                  <div className="text-purple-700 font-semibold">
                    • 🩺 {personalDeductionUploaded.length} comprobante(s) con Clave de Uso CFDI Tipo D — Deducción Personal ({personalDeductionUploaded.slice(0, 3).map(i => `${i.folio}: ${i.cfdi_use}`).join(', ')}).
                  </div>
                )}
              </div>
            ),
            duration: 10,
          });
        }
      }

      // Detectar automáticamente si alguno de los CFDIs cargados tiene UsoCFDI de Inversión (I01..I08)
      const invCfdis = uploadedInvoices.filter(inv =>
        (inv.cfdi_use || '').trim().toUpperCase().startsWith('I')
      );

      if (invCfdis.length > 0) {
        setDetectedInversionCfdis(invCfdis);
        setInversionModalCfdi(invCfdis[0]);
        notification.info({
          message: `Se detectó ${invCfdis.length} CFDI con Uso de Inversión (${invCfdis.map(i => i.cfdi_use).join(', ')})`,
          description: 'Se abrió automáticamente la ventana de captura de Activo Fijo con las tasas fiscales del SAT precargadas.',
          duration: 7,
        });
      } else {
        setUploadModalData({
          visible: true,
          totalFiles: filesToUpload.length,
          successCount,
          errors,
        });
      }

      if (successCount > 0) {
        message.success(`Se procesaron ${successCount} comprobante(s) correctamente.`);
      }
      fetchInvoices();
    } catch (err) {
      console.error('Error al subir archivos en lote:', err);
      const errDetail = err?.response?.data?.detail || 'Error al procesar los archivos XML.';
      notification.error({
        message: 'Error en la carga de CFDI',
        description: errDetail,
        duration: 9,
      });
    } finally {
      setUploading(false);
    }
  };

  // Manejo de Carga de Archivos agrupando archivos simultáneos en una sola petición
  const handleCustomUpload = ({ file, onSuccess }) => {
    pendingFilesRef.current.push(file);
    if (uploadTimeoutRef.current) {
      clearTimeout(uploadTimeoutRef.current);
    }
    uploadTimeoutRef.current = setTimeout(() => {
      const batch = [...pendingFilesRef.current];
      pendingFilesRef.current = [];
      processBatchUpload(batch);
    }, 150);
    onSuccess("ok");
  };

  // Asignar cuenta contable manualmente a un CFDI
  const handleAccountChange = async (invoiceId, accountId) => {
    try {
      await cfdiApi.assignAccount(clientId, {
        invoice_id: invoiceId,
        account_id: accountId
      });
      message.success('Cuenta contable asignada y guardada en memoria.');
      setInvoices(prev => prev.map(inv => {
        if (inv.id === invoiceId) {
          const acc = accounts.find(a => a.id === accountId);
          return {
            ...inv,
            assigned_account_id: accountId,
            account: acc ? {
              id: acc.id,
              account_number: acc.account_number,
              name: acc.name,
              classification: acc.classification
            } : null
          };
        }
        return inv;
      }));
    } catch (err) {
      message.error(err?.response?.data?.detail || 'Error al asignar cuenta');
    }
  };

  // Generar póliza individual
  const handleGenerateEntry = async (invoiceId) => {
    try {
      setLoading(true);
      const res = await cfdiApi.generateEntry(clientId, { invoice_id: invoiceId });
      message.success(
        `Póliza #${res.data?.entry_number} (${res.data?.entry_type?.toUpperCase()}) generada exitosamente.`
      );
      fetchInvoices();
      fetchAccounts(); // Refrescar cuentas por si se dio de alta cliente/proveedor nuevo
    } catch (err) {
      message.error(err?.response?.data?.detail || 'Error al generar póliza');
    } finally {
      setLoading(false);
    }
  };

  // Valida que el CFDI tenga una cuenta contable asignada válida (afectable y activa)
  const isAccountValid = (record) => {
    if (!record || !record.assigned_account_id) return false;
    const acc = accounts.find(a => a.id === record.assigned_account_id);
    if (acc) {
      return acc.classification === 'Afectable' && acc.is_active;
    }
    return Boolean(record.account?.classification === 'Afectable');
  };

  // Generación masiva de pólizas con cuenta contable válida
  const handleBatchGenerate = async () => {
    const idsToProcess = targetInvoices.map(inv => inv.id);
    if (idsToProcess.length === 0) {
      message.warning('No hay comprobantes pendientes con cuenta contable válida para generar pólizas.');
      return;
    }

    try {
      setLoading(true);
      const res = await cfdiApi.batchGenerate(clientId, { invoice_ids: idsToProcess });
      const successCount = res.data?.success_count || 0;
      if (successCount > 0) {
        message.success(`Se generaron exitosamente ${successCount} pólizas contables.`);
      }

      // Si quedan comprobantes pendientes sin cuenta válida, informar amablemente
      const unassignedCount = displayedInvoices.filter(inv => !inv.is_posted && !isAccountValid(inv)).length;
      if (unassignedCount > 0) {
        notification.info({
          message: 'Comprobantes pendientes de cuenta',
          description: `Se procesaron las facturas con cuenta válida. Aún quedan ${unassignedCount} comprobantes pendientes a los que debe asignar su cuenta contable en el recuadro correspondiente.`,
          duration: 7,
        });
      }

      if (res.data?.errors?.length > 0) {
        message.warning(`Advertencias: ${res.data.errors.join('; ')}`);
      }
      setSelectedRowKeys([]);
      fetchInvoices();
      fetchAccounts();
    } catch (err) {
      message.error(err?.response?.data?.detail || 'Error al procesar pólizas en lote');
    } finally {
      setLoading(false);
    }
  };

  // Eliminar CFDI de la lista (y su póliza generada si aplica)
  const handleDeleteInvoice = async (invoiceId) => {
    try {
      await cfdiApi.deleteInvoice(clientId, invoiceId, true);
      message.success('Comprobante eliminado correctamente.');
      setInvoices(prev => prev.filter(inv => inv.id !== invoiceId));
      fetchAccounts();
    } catch (err) {
      message.error(err?.response?.data?.detail || 'Error al eliminar');
    }
  };

  // Limpiar todos los CFDIs de la pestaña activa
  const handleClearInvoices = async () => {
    try {
      setLoading(true);
      const res = await cfdiApi.clearInvoices(clientId, activeTab);
      message.success(res.data?.message || 'Lista limpiada correctamente.');
      fetchInvoices();
      fetchAccounts();
    } catch (err) {
      message.error(err?.response?.data?.detail || 'Error al limpiar la lista');
    } finally {
      setLoading(false);
    }
  };

  // Generación de opciones de cuentas contables priorizadas por contexto: únicamente cuentas afectables activas
  const getAccountOptionsForRecord = (record) => {
    const isPago = record?.tipo_comprobante === 'P' || record?.payment_method === 'PAGO';
    const isInversion = (record?.cfdi_use || '').trim().toUpperCase().startsWith('I');
    return accounts
      .filter(a => a.classification === 'Afectable' && a.is_active)
      .sort((a, b) => {
        if (isPago) {
          const aIsBank = a.account_number.startsWith('102') || a.account_number.startsWith('101');
          const bIsBank = b.account_number.startsWith('102') || b.account_number.startsWith('101');
          if (aIsBank && !bIsBank) return -1;
          if (!aIsBank && bIsBank) return 1;
        } else if (isInversion) {
          const aIsAsset = a.account_number.startsWith('15') || a.account_number.startsWith('16') || a.account_number.startsWith('17');
          const bIsAsset = b.account_number.startsWith('15') || b.account_number.startsWith('16') || b.account_number.startsWith('17');
          if (aIsAsset && !bIsAsset) return -1;
          if (!aIsAsset && bIsAsset) return 1;
        } else if (activeTab === 'emitido') {
          const aIs4 = a.account_number.startsWith('4');
          const bIs4 = b.account_number.startsWith('4');
          if (aIs4 && !bIs4) return -1;
          if (!aIs4 && bIs4) return 1;
        } else {
          const aIs65 = a.account_number.startsWith('6') || a.account_number.startsWith('5');
          const bIs65 = b.account_number.startsWith('6') || b.account_number.startsWith('5');
          if (aIs65 && !bIs65) return -1;
          if (!aIs65 && bIs65) return 1;
        }
        return a.account_number.localeCompare(b.account_number);
      })
      .map(a => ({
        value: a.id,
        label: `${a.account_number} - ${a.name}`
      }));
  };

  // Comprobantes filtrados por año y mes (base para conteos de validadores en el periodo seleccionado)
  const periodFilteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      if (selectedYear !== 'all') {
        const invYear = dayjs(inv.date).year();
        if (invYear !== Number(selectedYear)) return false;
      }
      if (selectedMonth !== 'all') {
        const invMonth = dayjs(inv.date).month() + 1;
        if (invMonth !== Number(selectedMonth)) return false;
      }
      return true;
    });
  }, [invoices, selectedYear, selectedMonth]);

  const missingFuelCount = useMemo(
    () => periodFilteredInvoices.filter(inv => inv.missing_fuel_complement).length,
    [periodFilteredInvoices]
  );
  const fuelCashCount = useMemo(
    () => periodFilteredInvoices.filter(inv => inv.fuel_paid_in_cash).length,
    [periodFilteredInvoices]
  );
  const regimeMismatchCount = useMemo(
    () => periodFilteredInvoices.filter(inv => inv.regime_mismatch).length,
    [periodFilteredInvoices]
  );
  const personalDeductionUseCount = useMemo(
    () => periodFilteredInvoices.filter(inv => inv.is_personal_deduction_use || (inv.cfdi_type === 'recibido' && (inv.cfdi_use || '').trim().toUpperCase().startsWith('D'))).length,
    [periodFilteredInvoices]
  );
  const anyObservationCount = useMemo(
    () => periodFilteredInvoices.filter(
      inv =>
        inv.missing_fuel_complement ||
        inv.fuel_paid_in_cash ||
        inv.regime_mismatch ||
        inv.is_personal_deduction_use ||
        (inv.cfdi_type === 'recibido' && (inv.cfdi_use || '').trim().toUpperCase().startsWith('D'))
    ).length,
    [periodFilteredInvoices]
  );

  // Filtrado en tabla y ordenamiento de fecha más antigua a fecha más reciente
  const displayedInvoices = invoices
    .filter(inv => {
      if (statusFilter === 'pending' && inv.is_posted) return false;
      if (statusFilter === 'posted' && !inv.is_posted) return false;

      if (activeTab === 'recibido') {
        const isUseD = inv.is_personal_deduction_use || (inv.cfdi_use || '').trim().toUpperCase().startsWith('D');
        if (validatorFilter === 'missing_fuel' && !inv.missing_fuel_complement) return false;
        if (validatorFilter === 'fuel_cash' && !inv.fuel_paid_in_cash) return false;
        if (validatorFilter === 'regime_mismatch' && !inv.regime_mismatch) return false;
        if (validatorFilter === 'personal_deduction_use' && !isUseD) return false;
        if (
          validatorFilter === 'any_observation' &&
          !(inv.missing_fuel_complement || inv.fuel_paid_in_cash || inv.regime_mismatch || isUseD)
        ) {
          return false;
        }
      }

      if (selectedYear !== 'all') {
        const invYear = dayjs(inv.date).year();
        if (invYear !== Number(selectedYear)) return false;
      }
      if (selectedMonth !== 'all') {
        const invMonth = dayjs(inv.date).month() + 1;
        if (invMonth !== Number(selectedMonth)) return false;
      }

      if (searchText) {
        const q = searchText.toLowerCase().trim();
        const matchPartner = (inv.partner_name || '').toLowerCase().includes(q);
        const matchRfc = (inv.partner_rfc || '').toLowerCase().includes(q);
        const matchFolio = (inv.folio || '').toLowerCase().includes(q);
        const matchUuid = (inv.uuid || '').toLowerCase().includes(q);
        const matchDesc = (inv.description || '').toLowerCase().includes(q);
        return matchPartner || matchRfc || matchFolio || matchUuid || matchDesc;
      }
      return true;
    })
    .sort((a, b) => {
      const diff = dayjs(a.date).valueOf() - dayjs(b.date).valueOf();
      if (diff !== 0) return diff;
      return (a.id || 0) - (b.id || 0);
    });

  // Comprobantes pendientes que ya tienen una cuenta contable válida asignada
  const validPendingInvoices = displayedInvoices.filter(inv => !inv.is_posted && isAccountValid(inv));
  const selectedValidInvoices = displayedInvoices.filter(inv => 
    selectedRowKeys.includes(inv.id) && !inv.is_posted && isAccountValid(inv)
  );
  const targetInvoices = selectedRowKeys.length > 0 ? selectedValidInvoices : validPendingInvoices;
  const canGenerate = targetInvoices.length > 0;

  const isNominaTab = activeTab === 'nomina';
  const partnerColumnTitle = activeTab === 'emitido'
    ? 'Nombre del Cliente'
    : (activeTab === 'nomina' ? 'Trabajador / Datos Generales' : 'Nombre del Proveedor');

  const nominaTotalsSummary = useMemo(() => {
    if (!isNominaTab) return null;
    let percepciones = 0;
    let deducciones = 0;
    let isr = 0;
    let imss = 0;
    let otrosPagos = 0;
    let neto = 0;
    const uniqueEmployees = new Set();
    displayedInvoices.forEach(r => {
      const nd = r.nomina_data || {};
      percepciones += Number(nd.total_percepciones ?? r.subtotal ?? 0);
      deducciones += Number(nd.total_deducciones ?? 0);
      isr += Number(nd.isr_retenido ?? r.retencion_isr ?? 0);
      imss += Number(nd.imss_retenido ?? 0);
      otrosPagos += Number(nd.total_otros_pagos ?? 0);
      neto += Number(r.total ?? 0);
      if (r.partner_rfc) uniqueEmployees.add(r.partner_rfc);
    });
    return {
      recibos: displayedInvoices.length,
      empleados: uniqueEmployees.size,
      percepciones,
      deducciones,
      isr,
      imss,
      otrosPagos,
      neto
    };
  }, [isNominaTab, displayedInvoices]);

  const nominaColumns = [
    {
      title: 'Fecha / Pago',
      dataIndex: 'date',
      key: 'date',
      width: 115,
      sorter: (a, b) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf(),
      render: (d, record) => {
        const nd = record.nomina_data || {};
        return (
          <div>
            <div className="text-xs font-semibold text-gray-800">{dayjs(d).format('DD/MM/YYYY')}</div>
            {nd.fecha_pago && (
              <div className="text-[10px] text-blue-700 font-mono">Pago: {nd.fecha_pago}</div>
            )}
          </div>
        );
      }
    },
    {
      title: 'Folio / UUID',
      dataIndex: 'uuid',
      key: 'uuid',
      width: 135,
      render: (uuid, record) => (
        <div>
          <div className="font-semibold text-gray-800 text-xs mb-0.5">{record.folio || 'S/F'}</div>
          {uuid ? (
            <Tooltip title={`Ver Recibo de Nómina CFDI (${uuid})`}>
              <a
                href={`/cfdi-viewer/${uuid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block group"
              >
                <Tag color="geekblue" className="font-mono text-[10px] m-0 cursor-pointer group-hover:border-blue-500 group-hover:bg-blue-100 transition-colors flex items-center gap-1">
                  <span>{uuid.slice(0, 8)}...</span>
                  <FileSearchOutlined style={{ fontSize: '10px' }} />
                </Tag>
              </a>
            </Tooltip>
          ) : <span className="text-gray-400">-</span>}
        </div>
      )
    },
    {
      title: 'Trabajador y Datos Generales (RFC / CURP / NSS)',
      dataIndex: 'partner_name',
      key: 'partner_name',
      width: 295,
      render: (name, record) => {
        const nd = record.nomina_data || {};
        return (
          <div>
            <div className="flex items-center justify-between gap-1">
              <span className="font-bold text-xs text-gray-900 line-clamp-1" title={name}>
                {name || record.receiver_name || 'Trabajador'}
              </span>
              {nd.num_empleado && (
                <Tag color="blue" className="text-[10px] m-0 px-1 py-0 font-mono">
                  Emp #{nd.num_empleado}
                </Tag>
              )}
            </div>
            <div className="text-[11px] text-gray-600 font-mono flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
              <span><strong>RFC:</strong> {record.partner_rfc || record.receiver_rfc}</span>
              {nd.curp && <span><strong>CURP:</strong> {nd.curp}</span>}
              {nd.nss && <span><strong>NSS:</strong> {nd.nss}</span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {nd.puesto && (
                <Tag className="text-[10px] m-0 px-1.5 py-0 bg-slate-100 text-slate-700 border-slate-300">
                  👔 {nd.puesto}
                </Tag>
              )}
              {nd.departamento && (
                <Tag className="text-[10px] m-0 px-1.5 py-0 bg-slate-50 text-slate-600 border-slate-200">
                  🏢 {nd.departamento}
                </Tag>
              )}
              {nd.salario_diario_integrado > 0 && (
                <Tag color="cyan" className="text-[10px] m-0 px-1 py-0 font-mono">
                  SDI: {formatMoney(nd.salario_diario_integrado)}
                </Tag>
              )}
              <Button
                type="link"
                size="small"
                icon={<EyeOutlined />}
                onClick={() => setNominaDetailRecord(record)}
                className="p-0 h-auto text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 ml-1"
              >
                Ver Datos Generales
              </Button>
            </div>
          </div>
        );
      }
    },
    {
      title: 'Periodo / Tipo / Días',
      key: 'periodo_nomina',
      width: 170,
      render: (_, record) => {
        const nd = record.nomina_data || {};
        const isExtra = (nd.tipo_nomina || 'O') === 'E';
        return (
          <div className="text-xs">
            <div className="flex items-center gap-1 mb-0.5">
              <Tag color={isExtra ? 'purple' : 'green'} className="text-[10px] m-0 px-1.5 py-0 font-bold">
                {nd.tipo_nomina_label || 'Ordinaria'} ({nd.tipo_nomina || 'O'})
              </Tag>
              <Tag className="text-[10px] m-0 px-1 py-0 font-mono">
                {nd.num_dias_pagados || 0} días
              </Tag>
            </div>
            {nd.fecha_inicial_pago && nd.fecha_final_pago ? (
              <div className="text-[11px] font-mono text-gray-600">
                {nd.fecha_inicial_pago} → {nd.fecha_final_pago}
              </div>
            ) : (
              <div className="text-[11px] text-gray-400">Periodo estándar</div>
            )}
            {nd.registro_patronal && (
              <div className="text-[10px] text-gray-400 font-mono">
                Reg. Pat: {nd.registro_patronal}
              </div>
            )}
          </div>
        );
      }
    },
    {
      title: 'Percepciones',
      key: 'percepciones',
      align: 'right',
      width: 115,
      render: (_, record) => {
        const nd = record.nomina_data || {};
        const totP = Number(nd.total_percepciones ?? record.subtotal ?? 0);
        return (
          <div>
            <div className="text-xs font-semibold text-gray-800">{formatMoney(totP)}</div>
            {(nd.total_gravado > 0 || nd.total_exento > 0) && (
              <div className="text-[10px] text-gray-500 font-mono">
                G: {formatMoney(nd.total_gravado)} | E: {formatMoney(nd.total_exento)}
              </div>
            )}
          </div>
        );
      }
    },
    {
      title: 'ISR Retenido',
      key: 'isr_retenido',
      align: 'right',
      width: 95,
      render: (_, record) => {
        const nd = record.nomina_data || {};
        const v = Number(nd.isr_retenido ?? record.retencion_isr ?? 0);
        return v > 0 ? <span className="text-xs text-red-600 font-semibold">-{formatMoney(v)}</span> : <span className="text-gray-400 text-xs">-</span>;
      }
    },
    {
      title: 'IMSS / Otras Ded.',
      key: 'otras_ded',
      align: 'right',
      width: 115,
      render: (_, record) => {
        const nd = record.nomina_data || {};
        const imss = Number(nd.imss_retenido || 0);
        const info = Number(nd.infonavit_retenido || 0);
        const otras = Number(nd.otras_deducciones || 0);
        const sumOther = imss + info + otras;
        return sumOther > 0 ? (
          <div>
            <div className="text-xs text-orange-700 font-medium">-{formatMoney(sumOther)}</div>
            {imss > 0 && <div className="text-[10px] text-gray-500 font-mono">IMSS: {formatMoney(imss)}</div>}
          </div>
        ) : <span className="text-gray-400 text-xs">-</span>;
      }
    },
    {
      title: 'Otros Pagos / Sub.',
      key: 'otros_pagos',
      align: 'right',
      width: 105,
      render: (_, record) => {
        const nd = record.nomina_data || {};
        const op = Number(nd.total_otros_pagos || 0);
        return op > 0 ? (
          <Tooltip title={nd.subsidio_causado > 0 ? `Subsidio al Empleo Causado: ${formatMoney(nd.subsidio_causado)}` : 'Otros pagos de nómina'}>
            <span className="text-xs text-emerald-700 font-medium">+{formatMoney(op)}</span>
          </Tooltip>
        ) : <span className="text-gray-400 text-xs">-</span>;
      }
    },
    {
      title: 'Neto Pagado',
      dataIndex: 'total',
      key: 'total',
      align: 'right',
      width: 110,
      render: v => <span className="font-bold text-gray-900 text-xs">{formatMoney(v)}</span>
    }
  ];

  const columns = [
    {
      title: 'Fecha',
      dataIndex: 'date',
      key: 'date',
      width: 105,
      sorter: (a, b) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf(),
      render: d => <span className="text-xs font-medium">{dayjs(d).format('DD/MM/YYYY')}</span>
    },
    {
      title: 'Folio',
      dataIndex: 'folio',
      key: 'folio',
      width: 90,
      render: f => <span className="font-semibold text-gray-800 text-xs">{f || 'S/F'}</span>
    },
    {
      title: 'Folio Fiscal',
      dataIndex: 'uuid',
      key: 'uuid',
      width: 125,
      render: uuid => uuid ? (
        <Tooltip title={`Ver CFDI XML (${uuid})`}>
          <a
            href={`/cfdi-viewer/${uuid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block group"
          >
            <Tag color="geekblue" className="font-mono text-[11px] cursor-pointer group-hover:border-blue-500 group-hover:bg-blue-100 transition-colors flex items-center gap-1">
              <span>{uuid.slice(0, 8)}...</span>
              <FileSearchOutlined style={{ fontSize: '10px' }} />
            </Tag>
          </a>
        </Tooltip>
      ) : <span className="text-gray-400">-</span>
    },
    {
      title: partnerColumnTitle,
      dataIndex: 'partner_name',
      key: 'partner_name',
      width: 265,
      render: (name, record) => {
        const isPago = record.tipo_comprobante === 'P' || record.payment_method === 'PAGO';
        return (
          <div>
            <div className="flex items-center gap-1">
              <span className="font-medium text-xs text-gray-800 line-clamp-1" title={name}>
                {name || 'Público en General'}
              </span>
              {isPago && (
                <Tag color="purple" className="text-[10px] m-0 leading-tight px-1 py-0 font-bold">
                  PAGO
                </Tag>
              )}
              {record.es_moneda_extranjera && (
                <Tooltip
                  title={`CFDI en ${record.moneda}: Total original $${Number(record.total_moneda_original || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${record.moneda} × TC $${Number(record.tipo_cambio || 1).toFixed(4)} = ${formatMoney(record.total)} MXN`}
                >
                  <Tag color="geekblue" className="text-[10px] m-0 leading-tight px-1.5 py-0 font-bold cursor-help">
                    🌎 {record.moneda} • TC ${Number(record.tipo_cambio || 1).toFixed(4)}
                  </Tag>
                </Tooltip>
              )}
            </div>
            <div className="text-[11px] text-gray-500 font-mono flex flex-wrap items-center gap-1">
              <span>{record.partner_rfc}</span>
              {record.clave_prod_serv && (
                <span className="text-gray-400">
                  • SAT: {record.clave_prod_serv}
                </span>
              )}
              {(record.sat_alerts || []).map((al, idx) => (
                <Tooltip
                  key={idx}
                  title={`ALERTA SAT Art. ${al.list_type} (${al.situation}) — Oficio: ${al.oficio || 'S/N'}. ${al.motivo || ''}`}
                >
                  <Link to={`/fiscal-validador-69b/${clientId}`}>
                    <Tag color="red" className="text-[10px] m-0 px-1 py-0 font-bold cursor-pointer">
                      🚨 {al.list_type}: {al.situation}
                    </Tag>
                  </Link>
                </Tooltip>
              ))}
            </div>
            {activeTab === 'recibido' && (
              record.missing_fuel_complement ||
              (record.is_fuel_cfdi && record.has_fuel_complement) ||
              record.fuel_paid_in_cash ||
              record.regime_mismatch ||
              record.is_personal_deduction_use ||
              (record.cfdi_use || '').trim().toUpperCase().startsWith('D')
            ) && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {record.missing_fuel_complement && (
                  <Tooltip title={record.fuel_validation_message || 'Comprobante de combustible sin su Complemento de Combustible en el XML.'}>
                    <Tag color="volcano" className="text-[10px] m-0 px-1.5 py-0 font-bold border-orange-400 cursor-help">
                      ⛽ Sin Complemento de Combustible
                    </Tag>
                  </Tooltip>
                )}
                {record.is_fuel_cfdi && record.has_fuel_complement && (
                  <Tooltip title={record.fuel_validation_message || 'Cuenta con Complemento de Combustible válido en el XML.'}>
                    <Tag color="cyan" className="text-[10px] m-0 px-1.5 py-0 font-semibold cursor-help">
                      ⛽ Complemento Combustible OK
                    </Tag>
                  </Tooltip>
                )}
                {record.fuel_paid_in_cash && (
                  <Tooltip title={record.fuel_cash_validation_message || 'En comprobantes de combustible la forma de pago en ningún caso debe ser en efectivo (Art. 27 Fracc. III LISR).'}>
                    <Tag color="red" className="text-[10px] m-0 px-1.5 py-0 font-bold border-red-500 cursor-help">
                      💵🚫 Combustible en Efectivo (No Deducible)
                    </Tag>
                  </Tooltip>
                )}
                {record.regime_mismatch && (
                  <Tooltip title={record.regime_validation_message || `El CFDI contiene el Régimen Fiscal Receptor ${record.receiver_tax_regime_label || record.receiver_tax_regime}, pero el cliente está registrado con ${record.expected_client_regime_label || record.expected_client_regime}.`}>
                    <Tag color="magenta" className="text-[10px] m-0 px-1.5 py-0 font-bold border-pink-400 cursor-help">
                      ⚠️ Régimen Incorrecto: XML {record.receiver_tax_regime} ≠ Cliente {record.expected_client_regime}
                    </Tag>
                  </Tooltip>
                )}
                {(record.is_personal_deduction_use || (record.cfdi_use || '').trim().toUpperCase().startsWith('D')) && (
                  <Tooltip title={record.personal_deduction_validation_message || `Clave de Uso CFDI ${(record.cfdi_use || '').trim().toUpperCase()} corresponde a una Deducción Personal (Declaración Anual).`}>
                    <Tag color="purple" className="text-[10px] m-0 px-1.5 py-0 font-bold border-purple-400 cursor-help">
                      🩺 Uso CFDI Tipo D ({(record.cfdi_use || '').trim().toUpperCase()} - Deducción Personal)
                    </Tag>
                  </Tooltip>
                )}
              </div>
            )}
            {isPago && (record.related_folio || record.related_uuid) && (
              <div className="text-[10px] text-purple-600 font-medium">
                🔗 Factura PPD: {record.related_folio || `${(record.related_uuid || '').slice(0, 10)}...`}
              </div>
            )}
          </div>
        );
      }
    },
    {
      title: 'Método',
      dataIndex: 'payment_method',
      key: 'payment_method',
      width: 90,
      align: 'center',
      render: (m, record) => {
        const isPago = record.tipo_comprobante === 'P' || m === 'PAGO';
        if (isPago) {
          return <Tag color="purple" className="text-xs font-bold">PAGO</Tag>;
        }
        return (
          <Tag color={m === 'PUE' ? 'green' : 'orange'} className="text-xs font-bold">
            {m || 'PUE'}
          </Tag>
        );
      }
    },
    {
      title: 'Forma Pago',
      dataIndex: 'payment_form',
      key: 'payment_form',
      width: 110,
      render: (fp, record) => {
        if (activeTab === 'recibido' && record.fuel_paid_in_cash) {
          return (
            <Tooltip title={record.fuel_cash_validation_message || 'En comprobantes de combustible la forma de pago en ningún caso debe ser en efectivo (Art. 27 Fracc. III LISR).'}>
              <Tag color="red" className="text-[11px] font-bold m-0 px-1.5 py-0 border-red-500 cursor-help">
                💵🚫 01 Efectivo
              </Tag>
            </Tooltip>
          );
        }
        return (
          <span className="text-xs text-gray-600" title={formaPagoLabels[fp] || fp}>
            {formaPagoLabels[fp] ? formaPagoLabels[fp].split(' ')[1] || fp : (fp || '99')}
          </span>
        );
      }
    },
    {
      title: activeTab === 'recibido' ? 'Uso / Régimen' : 'Uso CFDI',
      dataIndex: 'cfdi_use',
      key: 'cfdi_use',
      width: 120,
      align: 'center',
      render: (u, record) => {
        const cleanU = (u || 'G03').trim().toUpperCase();
        const isUseD = activeTab === 'recibido' && (record.is_personal_deduction_use || cleanU.startsWith('D'));
        return (
          <div className="flex flex-col items-center gap-0.5">
            {cleanU.startsWith('I') ? (
              <Tooltip title="Uso de Inversión detectado — Haz clic para abrir la ventana de captura de Activo Fijo y tasas SAT">
                <Tag
                  color="gold"
                  className="text-[11px] font-bold cursor-pointer hover:scale-105 transition m-0"
                  onClick={() => setInversionModalCfdi(record)}
                >
                  🏛️ {cleanU}
                </Tag>
              </Tooltip>
            ) : isUseD ? (
              <Tooltip title={record.personal_deduction_validation_message || `Clave de Uso CFDI ${cleanU} detectada: Deducción Personal (Declaración Anual).`}>
                <Tag color="purple" className="text-[11px] font-bold m-0 px-1.5 py-0 border-purple-400 cursor-help">
                  ⚠️ 🩺 {cleanU}
                </Tag>
              </Tooltip>
            ) : (
              <Tag className="text-[11px] m-0">{cleanU}</Tag>
            )}
            {activeTab === 'recibido' && record.receiver_tax_regime && (
              <Tooltip
                title={
                  record.regime_mismatch
                    ? record.regime_validation_message
                    : `Régimen Receptor XML: ${record.receiver_tax_regime_label || record.receiver_tax_regime} (Coincide con el alta del cliente)`
                }
              >
                <Tag
                  color={record.regime_mismatch ? 'magenta' : 'default'}
                  className={`text-[10px] m-0 px-1 py-0 cursor-help ${record.regime_mismatch ? 'font-bold border-pink-400' : 'text-gray-500'}`}
                >
                  {record.regime_mismatch ? `⚠️ Rég. ${record.receiver_tax_regime}` : `Rég. ${record.receiver_tax_regime}`}
                </Tag>
              </Tooltip>
            )}
          </div>
        );
      }
    },
    {
      title: 'Subtotal (MXN)',
      dataIndex: 'subtotal',
      key: 'subtotal',
      align: 'right',
      width: 115,
      render: (v, record) => (
        <div>
          <span className="text-xs text-gray-700">{formatMoney(v)}</span>
          {record.es_moneda_extranjera && (
            <div className="text-[10px] text-blue-600 font-mono">
              ${Number(record.subtotal_moneda_original || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {record.moneda}
            </div>
          )}
        </div>
      )
    },
    {
      title: 'IVA Trasl.',
      dataIndex: 'iva_trasladado',
      key: 'iva_trasladado',
      align: 'right',
      width: 100,
      render: (v, record) => (
        <div>
          <span className="text-xs text-gray-700">{formatMoney(v)}</span>
          {record.es_moneda_extranjera && Number(record.iva_moneda_original || 0) > 0 && (
            <div className="text-[10px] text-blue-600 font-mono">
              ${Number(record.iva_moneda_original || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {record.moneda}
            </div>
          )}
        </div>
      )
    },
    {
      title: 'Otros Imp.',
      dataIndex: 'otros_impuestos',
      key: 'otros_impuestos',
      align: 'right',
      width: 100,
      render: (v, record) => {
        const val = Number(v) || Math.round((Number(record.total || 0) - (Number(record.subtotal || 0) + Number(record.iva_trasladado || 0) - Number(record.retencion_isr || 0) - Number(record.retencion_iva || 0))) * 100) / 100;
        return val > 0.01 ? (
          <Tooltip title="IEPS / Hospedaje (ISH) registrado en cuenta 601-58-000 Otros impuestos y derechos">
            <Tag color="purple" className="text-xs font-semibold m-0">{formatMoney(val)}</Tag>
          </Tooltip>
        ) : <span className="text-gray-400 text-xs">-</span>;
      }
    },
    {
      title: 'Ret. ISR',
      dataIndex: 'retencion_isr',
      key: 'retencion_isr',
      align: 'right',
      width: 90,
      render: v => Number(v) > 0 ? <span className="text-xs text-red-600 font-medium">-{formatMoney(v)}</span> : <span className="text-gray-400 text-xs">-</span>
    },
    {
      title: 'Ret. IVA',
      dataIndex: 'retencion_iva',
      key: 'retencion_iva',
      align: 'right',
      width: 90,
      render: v => Number(v) > 0 ? <span className="text-xs text-red-600 font-medium">-{formatMoney(v)}</span> : <span className="text-gray-400 text-xs">-</span>
    },
    {
      title: 'Total (MXN)',
      dataIndex: 'total',
      key: 'total',
      align: 'right',
      width: 120,
      render: (v, record) => (
        <div>
          <span className="font-bold text-gray-900 text-xs">{formatMoney(v)}</span>
          {record.es_moneda_extranjera && (
            <div className="text-[10px] text-blue-700 font-mono font-semibold">
              ${Number(record.total_moneda_original || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {record.moneda}
            </div>
          )}
        </div>
      )
    },
    {
      title: 'Cuenta Contable',
      dataIndex: 'assigned_account_id',
      key: 'assigned_account_id',
      width: 255,
      render: (accountId, record) => {
        const isPago = record?.tipo_comprobante === 'P' || record?.payment_method === 'PAGO';
        const isInversion = (record?.cfdi_use || '').trim().toUpperCase().startsWith('I');
        const hasValid = isAccountValid(record);
        return (
          <div>
            <Select
              showSearch
              allowClear={true}
              disabled={record.is_posted}
              placeholder={isPago ? "Seleccionar Banco / Caja..." : (isInversion ? "Seleccionar Activo Fijo..." : "Seleccionar cuenta...")}
              value={hasValid ? accountId : undefined}
              onChange={(newVal) => handleAccountChange(record.id, newVal)}
              options={getAccountOptionsForRecord(record)}
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              className="w-full text-xs"
              size="small"
            />
            {isInversion && !record.is_posted && (
              <div className="mt-1">
                <Button
                  type="link"
                  size="small"
                  icon={<FundOutlined />}
                  onClick={() => setInversionModalCfdi(record)}
                  className="p-0 h-auto text-[11px] font-semibold text-amber-700 hover:text-amber-800"
                >
                  Capturar en Inversiones / Activos Fijos
                </Button>
              </div>
            )}
          </div>
        );
      }
    },
    {
      title: 'Acción',
      key: 'action',
      width: 160,
      align: 'center',
      fixed: 'right',
      render: (_, record) => {
        if (record.is_posted) {
          const entryId = record.journal_entry?.id || record.journal_entry_id;
          const targetJournalUrl = entryId
            ? `/journal/${clientId}?entryId=${entryId}`
            : `/journal/${clientId}`;
          return (
            <Space orientation="horizontal" size="small" align="center">
              <Space direction="vertical" size={2}>
                <Link to={targetJournalUrl} title="Abrir esta póliza en particular">
                  <Tag color="green" icon={<CheckCircleOutlined />} className="text-xs font-semibold m-0 cursor-pointer hover:opacity-85">
                    Póliza #{record.journal_entry?.entry_number} ({record.journal_entry?.entry_type?.toUpperCase()})
                  </Tag>
                </Link>
                <Link to={targetJournalUrl} className="text-[11px] text-blue-600 hover:underline font-medium">
                  Ver en Pólizas <ArrowRightOutlined className="text-[9px]" />
                </Link>
              </Space>
              <Popconfirm
                title="¿Eliminar comprobante y cancelar su póliza generada?"
                onConfirm={() => handleDeleteInvoice(record.id)}
                okText="Sí, borrar"
                cancelText="No"
                okButtonProps={{ danger: true }}
              >
                <Tooltip title="Eliminar comprobante y cancelar póliza">
                  <Button 
                    type="text" 
                    danger 
                    size="small" 
                    icon={<DeleteOutlined className="text-gray-400 hover:text-red-500" />} 
                  />
                </Tooltip>
              </Popconfirm>
            </Space>
          );
        }

        return (
          <Space orientation="horizontal" size="small">
            <Button
              type="primary"
              size="small"
              icon={<FileAddOutlined />}
              disabled={!isAccountValid(record)}
              onClick={() => handleGenerateEntry(record.id)}
              className="text-xs bg-blue-600 hover:bg-blue-700"
            >
              Generar Póliza
            </Button>
            <Popconfirm
              title="¿Retirar comprobante de la lista?"
              onConfirm={() => handleDeleteInvoice(record.id)}
              okText="Sí, borrar"
              cancelText="No"
              okButtonProps={{ danger: true }}
            >
              <Tooltip title="Retirar comprobante">
                <Button 
                  type="text" 
                  danger 
                  size="small" 
                  icon={<DeleteOutlined className="text-gray-400 hover:text-red-500" />} 
                />
              </Tooltip>
            </Popconfirm>
          </Space>
        );
      }
    }
  ];

  const activeColumns = isNominaTab
    ? [...nominaColumns, columns[columns.length - 2], columns[columns.length - 1]]
    : columns;

  const pendingCount = displayedInvoices.filter(i => !i.is_posted).length;
  const postedCount = displayedInvoices.filter(i => i.is_posted).length;

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const buildCfdiExportPayload = () => {
    const isRecibido = activeTab === 'recibido';
    const isNomina = activeTab === 'nomina';
    const periodLabel = selectedMonth === 'all'
      ? (selectedYear === 'all' ? 'Todos los periodos' : `Ejercicio ${selectedYear} (Todos los meses)`)
      : `${String(selectedMonth).padStart(2, '0')} - ${monthNames[Number(selectedMonth) - 1] || selectedMonth} ${selectedYear === 'all' ? '' : selectedYear}`;

    if (isNomina) {
      const nomCols = [
        { key: 'date', title: 'Fecha Emisión', align: 'center', format: 'text', width: 12 },
        { key: 'fecha_pago', title: 'Fecha Pago', align: 'center', format: 'text', width: 12 },
        { key: 'folio', title: 'Folio', align: 'center', format: 'text', width: 11 },
        { key: 'uuid', title: 'UUID Fiscal', align: 'left', format: 'text', width: 22 },
        { key: 'num_empleado', title: 'No. Emp.', align: 'center', format: 'text', width: 10 },
        { key: 'partner_rfc', title: 'RFC Trabajador', align: 'left', format: 'text', width: 15 },
        { key: 'curp', title: 'CURP', align: 'left', format: 'text', width: 19 },
        { key: 'nss', title: 'NSS (IMSS)', align: 'left', format: 'text', width: 14 },
        { key: 'partner_name', title: 'Nombre del Trabajador', align: 'left', format: 'text', width: 26 },
        { key: 'puesto_depto', title: 'Puesto / Depto', align: 'left', format: 'text', width: 20 },
        { key: 'periodo_pago', title: 'Periodo / Días', align: 'center', format: 'text', width: 20 },
        { key: 'percepciones', title: 'Percepciones', align: 'right', format: 'currency', width: 14 },
        { key: 'isr_retenido', title: 'ISR Retenido', align: 'right', format: 'currency', width: 13 },
        { key: 'imss_otras', title: 'IMSS / Otras Ded.', align: 'right', format: 'currency', width: 14 },
        { key: 'otros_pagos', title: 'Otros Pagos / Sub.', align: 'right', format: 'currency', width: 14 },
        { key: 'total', title: 'Neto Pagado', align: 'right', format: 'currency', width: 15 },
        { key: 'account_label', title: 'Cuenta Contable', align: 'left', format: 'text', width: 22 },
        { key: 'poliza_status', title: 'Póliza', align: 'center', format: 'text', width: 15 },
      ];

      let sumPerc = 0;
      let sumIsr = 0;
      let sumImssOtras = 0;
      let sumOtrosPagos = 0;
      let sumNeto = 0;

      const nomRows = displayedInvoices.map(r => {
        const nd = r.nomina_data || {};
        const perc = Number(nd.total_percepciones ?? r.subtotal ?? 0);
        const isr = Number(nd.isr_retenido ?? r.retencion_isr ?? 0);
        const imssOtr = Number(nd.imss_retenido || 0) + Number(nd.infonavit_retenido || 0) + Number(nd.otras_deducciones || 0);
        const otrP = Number(nd.total_otros_pagos || 0);
        const neto = Number(r.total || 0);

        sumPerc += perc;
        sumIsr += isr;
        sumImssOtras += imssOtr;
        sumOtrosPagos += otrP;
        sumNeto += neto;

        const accObj = accounts.find(a => a.id === r.assigned_account_id) || r.account;
        const accountLabel = accObj ? `${accObj.account_number} - ${accObj.name}` : 'Sin asignar';
        const polizaLabel = r.is_posted
          ? `Póliza #${r.journal_entry?.entry_number || ''} (${(r.journal_entry?.entry_type || '').toUpperCase()})`
          : 'Pendiente';

        return {
          date: r.date ? dayjs(r.date).format('DD/MM/YYYY') : '-',
          fecha_pago: nd.fecha_pago || '-',
          folio: r.folio || 'S/F',
          uuid: r.uuid || '-',
          num_empleado: nd.num_empleado || '-',
          partner_rfc: r.partner_rfc || '-',
          curp: nd.curp || '-',
          nss: nd.nss || '-',
          partner_name: r.partner_name || '-',
          puesto_depto: [nd.puesto, nd.departamento].filter(Boolean).join(' / ') || '-',
          periodo_pago: `${nd.fecha_inicial_pago || ''} a ${nd.fecha_final_pago || ''} (${nd.num_dias_pagados || 0}d)`,
          percepciones: perc,
          isr_retenido: isr,
          imss_otras: imssOtr,
          otros_pagos: otrP,
          total: neto,
          account_label: accountLabel,
          poliza_status: polizaLabel,
          _rowType: 'normal',
        };
      });

      nomRows.push({
        date: '',
        fecha_pago: '',
        folio: '',
        uuid: '',
        num_empleado: '',
        partner_rfc: '',
        curp: '',
        nss: '',
        partner_name: `TOTAL (${displayedInvoices.length} RECIBOS DE NÓMINA)`,
        puesto_depto: '',
        periodo_pago: '',
        percepciones: sumPerc,
        isr_retenido: sumIsr,
        imss_otras: sumImssOtras,
        otros_pagos: sumOtrosPagos,
        total: sumNeto,
        account_label: '',
        poliza_status: `${postedCount} contabilizados / ${pendingCount} pendientes`,
        _rowType: 'total',
      });

      return {
        title: 'CONTABILIZADOR DE CFDI DE NÓMINA (SUELDOS Y SALARIOS)',
        subtitle: 'Relación de Recibos Electrónicos de Nómina (Complemento 1.2), Datos Generales del Trabajador, Percepciones, Deducciones y Pólizas',
        clientName: clientInfo?.business_name || '',
        clientRfc: clientInfo?.rfc || '',
        period: periodLabel,
        columns: nomCols,
        rows: nomRows,
        summaryCards: [
          { label: 'Recibos de Nómina', value: `${displayedInvoices.length}`, sublabel: `${postedCount} contabilizados / ${pendingCount} pendientes` },
          { label: 'Total Percepciones', value: formatMoney(sumPerc), sublabel: `Otros pagos / Subsidio: ${formatMoney(sumOtrosPagos)}` },
          { label: 'ISR e IMSS Retenido', value: formatMoney(sumIsr + sumImssOtras), sublabel: `ISR: ${formatMoney(sumIsr)} | IMSS/Otras: ${formatMoney(sumImssOtras)}` },
          { label: 'Neto Pagado', value: formatMoney(sumNeto), sublabel: periodLabel },
        ],
        orientation: 'landscape',
        notes: 'Cifras expresadas en Pesos Mexicanos (MXN). Reporte generado desde el módulo Contabilizador de CFDI de Nómina.',
        filename: `CFDI_Nomina_${clientInfo?.rfc || clientId}_${selectedYear}_${selectedMonth}.xlsx`,
      };
    }

    const columnsDef = [
      { key: 'date', title: 'Fecha', align: 'center', format: 'text', width: 12 },
      { key: 'folio', title: 'Folio', align: 'center', format: 'text', width: 13 },
      { key: 'uuid', title: 'UUID Fiscal', align: 'left', format: 'text', width: 22 },
      { key: 'partner_rfc', title: isRecibido ? 'RFC Proveedor' : 'RFC Cliente', align: 'left', format: 'text', width: 15 },
      { key: 'partner_name', title: isRecibido ? 'Proveedor / Emisor' : 'Cliente / Receptor', align: 'left', format: 'text', width: 28 },
      { key: 'description', title: 'Concepto', align: 'left', format: 'text', width: 28 },
      { key: 'payment_method', title: 'Método', align: 'center', format: 'text', width: 9 },
      { key: 'payment_form', title: 'Forma Pago', align: 'left', format: 'text', width: 16 },
      { key: 'cfdi_use', title: isRecibido ? 'Uso / Régimen' : 'Uso CFDI', align: 'center', format: 'text', width: 14 },
      { key: 'subtotal', title: 'Subtotal', align: 'right', format: 'currency', width: 15 },
      { key: 'iva_trasladado', title: 'IVA 16%', align: 'right', format: 'currency', width: 14 },
      ...(isRecibido ? [{ key: 'otros_impuestos', title: 'IEPS / ISH', align: 'right', format: 'currency', width: 13 }] : []),
      { key: 'retencion_isr', title: 'Ret. ISR', align: 'right', format: 'currency', width: 13 },
      { key: 'retencion_iva', title: 'Ret. IVA', align: 'right', format: 'currency', width: 13 },
      { key: 'total', title: 'Total', align: 'right', format: 'currency', width: 15 },
      { key: 'account_label', title: 'Cuenta Contable', align: 'left', format: 'text', width: 24 },
      { key: 'poliza_status', title: 'Póliza', align: 'center', format: 'text', width: 16 },
      ...(isRecibido ? [{ key: 'observaciones', title: 'Observaciones Fiscales', align: 'left', format: 'text', width: 26 }] : []),
    ];

    let sumSubtotal = 0;
    let sumIva = 0;
    let sumOtros = 0;
    let sumRetIsr = 0;
    let sumRetIva = 0;
    let sumTotal = 0;

    const rows = displayedInvoices.map(r => {
      const isPago = r.tipo_comprobante === 'P' || r.payment_method === 'PAGO';
      const subVal = Number(r.subtotal || 0);
      const ivaVal = Number(r.iva_trasladado || 0);
      const otrosVal = Number(r.otros_impuestos) || (isRecibido && !isPago
        ? Math.max(0, Math.round((Number(r.total || 0) - (subVal + ivaVal - Number(r.retencion_isr || 0) - Number(r.retencion_iva || 0))) * 100) / 100)
        : 0);
      const retIsrVal = Number(r.retencion_isr || 0);
      const retIvaVal = Number(r.retencion_iva || 0);
      const totVal = Number(r.total || 0);

      sumSubtotal += subVal;
      sumIva += ivaVal;
      sumOtros += otrosVal;
      sumRetIsr += retIsrVal;
      sumRetIva += retIvaVal;
      sumTotal += totVal;

      const accObj = accounts.find(a => a.id === r.assigned_account_id) || r.account;
      const accountLabel = accObj ? `${accObj.account_number} - ${accObj.name}` : 'Sin asignar';
      const polizaLabel = r.is_posted
        ? `Póliza #${r.journal_entry?.entry_number || ''} (${(r.journal_entry?.entry_type || '').toUpperCase()})`
        : 'Pendiente';

      const obsList = [];
      if (isRecibido) {
        if (r.missing_fuel_complement) obsList.push('Sin Compl. Combustible');
        if (r.fuel_paid_in_cash) obsList.push('Combustible en Efectivo');
        if (r.regime_mismatch) obsList.push(`Régimen Receptor ${r.xml_receiver_regime || ''} ≠ ${r.expected_client_regime || ''}`);
        if (r.is_personal_deduction_use || (r.cfdi_use || '').trim().toUpperCase().startsWith('D')) {
          obsList.push(`Uso CFDI ${r.cfdi_use} (Deducción Personal)`);
        }
      }

      const cleanUse = isPago ? 'CP01' : (r.cfdi_use || '-');
      const useAndRegime = isRecibido && r.xml_receiver_regime ? `${cleanUse} / Rég.${r.xml_receiver_regime}` : cleanUse;

      return {
        date: r.date ? dayjs(r.date).format('DD/MM/YYYY') : '-',
        folio: r.folio || 'S/F',
        uuid: r.uuid || '-',
        partner_rfc: r.partner_rfc || '-',
        partner_name: r.partner_name || '-',
        description: r.description || '-',
        payment_method: isPago ? 'REP (P)' : (r.payment_method || 'PUE'),
        payment_form: formaPagoLabels[r.payment_form] || r.payment_form || '-',
        cfdi_use: useAndRegime,
        subtotal: subVal,
        iva_trasladado: ivaVal,
        otros_impuestos: otrosVal,
        retencion_isr: retIsrVal,
        retencion_iva: retIvaVal,
        total: totVal,
        account_label: accountLabel,
        poliza_status: polizaLabel,
        observaciones: obsList.length > 0 ? obsList.join(' | ') : 'Sin observaciones',
        _rowType: 'normal',
      };
    });

    rows.push({
      date: '',
      folio: '',
      uuid: '',
      partner_rfc: '',
      partner_name: `TOTAL (${displayedInvoices.length} COMPROBANTES)`,
      description: '',
      payment_method: '',
      payment_form: '',
      cfdi_use: '',
      subtotal: sumSubtotal,
      iva_trasladado: sumIva,
      otros_impuestos: sumOtros,
      retencion_isr: sumRetIsr,
      retencion_iva: sumRetIva,
      total: sumTotal,
      account_label: '',
      poliza_status: `${postedCount} contabilizados / ${pendingCount} pendientes`,
      observaciones: '',
      _rowType: 'total',
    });

    const summaryCards = [
      { label: 'Total Comprobantes', value: `${displayedInvoices.length}`, sublabel: `${postedCount} contabilizados / ${pendingCount} pendientes` },
      { label: 'Subtotal Acumulado', value: formatMoney(sumSubtotal), sublabel: isRecibido ? 'Gastos y compras' : 'Ingresos facturados' },
      { label: 'IVA 16% Acumulado', value: formatMoney(sumIva), sublabel: isRecibido ? 'IVA acreditable' : 'IVA trasladado' },
      { label: 'Total CFDI', value: formatMoney(sumTotal), sublabel: periodLabel },
    ];

    const tipoLabel = isRecibido ? 'CFDI RECIBIDOS (PROVEEDORES Y GASTOS)' : 'CFDI EMITIDOS (VENTAS A CLIENTES)';
    const fileSlug = isRecibido ? 'CFDI_Recibidos' : 'CFDI_Emitidos';

    return {
      title: `CONTABILIZADOR DE ${tipoLabel}`,
      subtitle: 'Relación de Comprobantes Fiscales Digitales por Internet (CFDI), Asignación Contable, Pólizas y Validadores Fiscales',
      clientName: clientInfo?.business_name || '',
      clientRfc: clientInfo?.rfc || '',
      period: periodLabel,
      columns: columnsDef,
      rows,
      summaryCards,
      orientation: 'landscape',
      notes: 'Cifras expresadas en Pesos Mexicanos (MXN). Reporte generado desde el módulo Contabilizador de CFDI.',
      filename: `${fileSlug}_${clientInfo?.rfc || clientId}_${selectedYear}_${selectedMonth}.xlsx`,
    };
  };

  const handleExportExcel = () => {
    if (displayedInvoices.length === 0) {
      message.warning('No hay comprobantes en la vista actual para exportar.');
      return;
    }
    exportToExcel(buildCfdiExportPayload());
  };

  const handleExportPdf = () => {
    if (displayedInvoices.length === 0) {
      message.warning('No hay comprobantes en la vista actual para exportar.');
      return;
    }
    exportToPdfWithLogo(buildCfdiExportPayload());
  };

  const handlePrint = () => {
    if (displayedInvoices.length === 0) {
      message.warning('No hay comprobantes en la vista actual para imprimir.');
      return;
    }
    exportToPdfWithLogo(buildCfdiExportPayload());
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex flex-wrap justify-between items-center gap-4">
        <div>
          <Title level={2} className="m-0 text-gray-800">
            Contabilizador de CFDI (Facturas Electrónicas)
          </Title>
          <Text type="secondary" className="text-sm">
            Empresa: <strong className="text-gray-700">{clientInfo ? `${clientInfo.rfc} - ${clientInfo.business_name}` : 'Cargando...'}</strong>
          </Text>
        </div>

        <Space wrap>
          <Button
            type="primary"
            icon={<FileExcelOutlined />}
            onClick={handleExportExcel}
            disabled={displayedInvoices.length === 0}
            className="bg-emerald-600 hover:bg-emerald-700 border-emerald-600 font-semibold shadow-sm"
          >
            Exportar Excel (.xlsx)
          </Button>
          <Button
            type="primary"
            icon={<FilePdfOutlined />}
            onClick={handleExportPdf}
            disabled={displayedInvoices.length === 0}
            className="bg-sky-500 hover:bg-sky-600 border-sky-500 font-semibold shadow-sm"
            style={{ backgroundColor: '#0ea5e9', borderColor: '#0ea5e9', color: '#ffffff' }}
          >
            PDF Membretado
          </Button>
          <Button
            icon={<PrinterOutlined />}
            onClick={handlePrint}
            disabled={displayedInvoices.length === 0}
          >
            Imprimir
          </Button>
          <Popconfirm
            title={`¿Limpiar todos los CFDI ${activeTab === 'emitido' ? 'emitidos' : (activeTab === 'nomina' ? 'de nómina' : 'recibidos')} de esta lista?`}
            description="Se retirarán de la tabla y se cancelarán sus pólizas automáticas asociadas si las tienen."
            onConfirm={handleClearInvoices}
            okText="Sí, limpiar lista"
            cancelText="Cancelar"
            okButtonProps={{ danger: true }}
          >
            <Button 
              danger 
              icon={<DeleteOutlined />} 
              disabled={invoices.length === 0}
            >
              Limpiar Lista
            </Button>
          </Popconfirm>
          <Button 
            icon={<SyncOutlined />} 
            onClick={() => { fetchInvoices(); fetchAccounts(); }}
          >
            Actualizar
          </Button>
          <Link to={`/journal/${clientId}`}>
            <Button icon={<FileTextOutlined />}>
              Ir a Pólizas
            </Button>
          </Link>
        </Space>
      </div>

      {/* Tabs: Emitidos vs Recibidos vs Nómina */}
      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key);
          setSelectedRowKeys([]);
          setValidatorFilter('all');
        }}
        size="large"
        className="mb-4 bg-white px-4 pt-2 rounded-t-lg shadow-sm"
        items={[
          {
            key: 'emitido',
            label: (
              <span className="font-semibold text-base px-2">
                📤 CFDI Emitidos (Ventas a Clientes)
                <Badge count={activeTab === 'emitido' ? pendingCount : 0} overflowCount={999} className="ml-2" />
              </span>
            )
          },
          {
            key: 'recibido',
            label: (
              <span className="font-semibold text-base px-2">
                📥 CFDI Recibidos (Gastos y Compras de Proveedores)
                <Badge count={activeTab === 'recibido' ? pendingCount : 0} overflowCount={999} className="ml-2" />
              </span>
            )
          },
          {
            key: 'nomina',
            label: (
              <span className="font-semibold text-base px-2">
                👥 CFDI de Nómina (Sueldos y Salarios)
                <Badge count={activeTab === 'nomina' ? pendingCount : 0} overflowCount={999} className="ml-2" />
              </span>
            )
          }
        ]}
      />

      {/* Zona de Carga Drag & Drop */}
      <Card size="small" className="mb-6 shadow-sm bg-white">
        <Dragger
          name="files"
          multiple
          accept=".xml"
          customRequest={handleCustomUpload}
          showUploadList={false}
          className="block w-full"
          style={{
            background: 'rgba(239, 246, 255, 0.35)',
            borderColor: '#93c5fd',
            borderRadius: '8px',
            padding: '16px',
          }}
        >
          <p className="ant-upload-drag-icon text-blue-500 mb-2">
            <InboxOutlined className="text-4xl" />
          </p>
          <p className="text-sm font-bold text-gray-700 m-0">
            {activeTab === 'emitido' 
              ? 'Haga clic o arrastre aquí los archivos XML de CFDI Emitidos (Facturas a Clientes)'
              : activeTab === 'nomina'
              ? 'Haga clic o arrastre aquí los archivos XML de CFDI de Nómina (Recibos de Sueldos y Salarios — Complemento 1.2)'
              : 'Haga clic o arrastre aquí los archivos XML de CFDI Recibidos (Facturas de Proveedores)'}
          </p>
          <p className="text-xs text-gray-500 mt-1 mb-0">
            {activeTab === 'nomina'
              ? 'Extrae automáticamente los datos generales del trabajador (RFC, CURP, NSS, No. Empleado, Puesto, Departamento, SDI, Periodo y Días Pagados), Percepciones, ISR Retenido, IMSS y Neto Pagado.'
              : 'Soporta carga única o por lote (CFDI 4.0 y 3.3). El sistema extraerá los datos y sugerirá automáticamente la cuenta contable por memoria de RFC y Clave SAT.'}
          </p>
        </Dragger>
      </Card>

      {/* Resumen Ejecutivo de Nómina (cuando está activa la pestaña de Nómina y hay recibos) */}
      {isNominaTab && nominaTotalsSummary && nominaTotalsSummary.recibos > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
            <div className="text-[11px] text-gray-500 font-semibold uppercase">Recibos / Empleados</div>
            <div className="text-lg font-bold text-slate-800 mt-0.5">
              {nominaTotalsSummary.recibos} <span className="text-xs font-normal text-gray-500">({nominaTotalsSummary.empleados} emp.)</span>
            </div>
          </div>
          <div className="bg-white border border-blue-200 rounded-lg p-3 shadow-sm">
            <div className="text-[11px] text-blue-700 font-semibold uppercase">Total Percepciones</div>
            <div className="text-base font-bold text-blue-900 mt-0.5 font-mono">{formatMoney(nominaTotalsSummary.percepciones)}</div>
          </div>
          <div className="bg-white border border-red-200 rounded-lg p-3 shadow-sm">
            <div className="text-[11px] text-red-700 font-semibold uppercase">ISR Retenido (002)</div>
            <div className="text-base font-bold text-red-700 mt-0.5 font-mono">-{formatMoney(nominaTotalsSummary.isr)}</div>
          </div>
          <div className="bg-white border border-orange-200 rounded-lg p-3 shadow-sm">
            <div className="text-[11px] text-orange-700 font-semibold uppercase">IMSS Retenido (001)</div>
            <div className="text-base font-bold text-orange-800 mt-0.5 font-mono">-{formatMoney(nominaTotalsSummary.imss)}</div>
          </div>
          <div className="bg-white border border-emerald-200 rounded-lg p-3 shadow-sm">
            <div className="text-[11px] text-emerald-700 font-semibold uppercase">Otros Pagos / Sub.</div>
            <div className="text-base font-bold text-emerald-800 mt-0.5 font-mono">+{formatMoney(nominaTotalsSummary.otrosPagos)}</div>
          </div>
          <div className="bg-slate-900 text-white rounded-lg p-3 shadow-sm">
            <div className="text-[11px] text-slate-300 font-semibold uppercase">Neto Pagado Total</div>
            <div className="text-base font-bold text-white mt-0.5 font-mono">{formatMoney(nominaTotalsSummary.neto)}</div>
          </div>
        </div>
      )}

      {/* Panel de Validadores Fiscales de CFDI Recibidos (Complemento de Combustible, Combustible en Efectivo, Régimen Fiscal y Uso CFDI Tipo D) */}
      {activeTab === 'recibido' && (missingFuelCount > 0 || fuelCashCount > 0 || regimeMismatchCount > 0 || personalDeductionUseCount > 0) && (
        <Alert
          type="warning"
          showIcon
          className="mb-4 border-amber-300 bg-amber-50/80 shadow-sm"
          message={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-amber-900 text-xs sm:text-sm">
                🔍 Validadores Fiscales en CFDI Recibidos ({anyObservationCount} comprobante{anyObservationCount === 1 ? '' : 's'} con observación en el periodo)
              </span>
              {validatorFilter !== 'all' && (
                <Button
                  size="small"
                  type="link"
                  onClick={() => setValidatorFilter('all')}
                  className="text-xs font-semibold p-0 h-auto text-blue-700"
                >
                  Quitar filtro de validador (Ver todos)
                </Button>
              )}
            </div>
          }
          description={
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
              {missingFuelCount > 0 && (
                <div
                  onClick={() => setValidatorFilter(validatorFilter === 'missing_fuel' ? 'all' : 'missing_fuel')}
                  className={`cursor-pointer px-2.5 py-1.5 rounded-md border transition flex items-center gap-2 ${
                    validatorFilter === 'missing_fuel'
                      ? 'bg-orange-100 border-orange-500 ring-2 ring-orange-300 font-bold text-orange-950'
                      : 'bg-white border-orange-300 hover:bg-orange-50 text-orange-900'
                  }`}
                >
                  <Tag color="volcano" className="m-0 font-bold text-[11px]">
                    ⛽ {missingFuelCount}
                  </Tag>
                  <span>
                    <strong>Sin Complemento de Combustible:</strong> Comprobante(s) de gasolina/diésel sin nodo <code>HidroYPetro</code> / <code>EstadoDeCuentaCombustible</code>
                  </span>
                  <span className="text-[11px] underline text-orange-700 ml-1">
                    {validatorFilter === 'missing_fuel' ? 'Mostrando solo estos' : 'Filtrar'}
                  </span>
                </div>
              )}

              {fuelCashCount > 0 && (
                <div
                  onClick={() => setValidatorFilter(validatorFilter === 'fuel_cash' ? 'all' : 'fuel_cash')}
                  className={`cursor-pointer px-2.5 py-1.5 rounded-md border transition flex items-center gap-2 ${
                    validatorFilter === 'fuel_cash'
                      ? 'bg-red-100 border-red-500 ring-2 ring-red-300 font-bold text-red-950'
                      : 'bg-white border-red-300 hover:bg-red-50 text-red-900'
                  }`}
                >
                  <Tag color="red" className="m-0 font-bold text-[11px]">
                    💵🚫 {fuelCashCount}
                  </Tag>
                  <span>
                    <strong>Combustible Pagado en Efectivo:</strong> En ningún caso el combustible debe pagarse en efectivo (Forma 01 — Art. 27 Fracc. III LISR)
                  </span>
                  <span className="text-[11px] underline text-red-700 ml-1">
                    {validatorFilter === 'fuel_cash' ? 'Mostrando solo estos' : 'Filtrar'}
                  </span>
                </div>
              )}

              {regimeMismatchCount > 0 && (
                <div
                  onClick={() => setValidatorFilter(validatorFilter === 'regime_mismatch' ? 'all' : 'regime_mismatch')}
                  className={`cursor-pointer px-2.5 py-1.5 rounded-md border transition flex items-center gap-2 ${
                    validatorFilter === 'regime_mismatch'
                      ? 'bg-pink-100 border-pink-500 ring-2 ring-pink-300 font-bold text-pink-950'
                      : 'bg-white border-pink-300 hover:bg-pink-50 text-pink-900'
                  }`}
                >
                  <Tag color="magenta" className="m-0 font-bold text-[11px]">
                    ⚠️ {regimeMismatchCount}
                  </Tag>
                  <span>
                    <strong>Régimen Fiscal Diferente al Cliente:</strong> El régimen receptor del XML no coincide con el alta del cliente ({clientInfo?.tax_regime || 'Registrado'})
                  </span>
                  <span className="text-[11px] underline text-pink-700 ml-1">
                    {validatorFilter === 'regime_mismatch' ? 'Mostrando solo estos' : 'Filtrar'}
                  </span>
                </div>
              )}

              {personalDeductionUseCount > 0 && (
                <div
                  onClick={() => setValidatorFilter(validatorFilter === 'personal_deduction_use' ? 'all' : 'personal_deduction_use')}
                  className={`cursor-pointer px-2.5 py-1.5 rounded-md border transition flex items-center gap-2 ${
                    validatorFilter === 'personal_deduction_use'
                      ? 'bg-purple-100 border-purple-500 ring-2 ring-purple-300 font-bold text-purple-950'
                      : 'bg-white border-purple-300 hover:bg-purple-50 text-purple-900'
                  }`}
                >
                  <Tag color="purple" className="m-0 font-bold text-[11px]">
                    🩺 {personalDeductionUseCount}
                  </Tag>
                  <span>
                    <strong>Uso CFDI Clave Tipo D:</strong> Deducción Personal (D01..D10) detectada en comprobantes recibidos
                  </span>
                  <span className="text-[11px] underline text-purple-700 ml-1">
                    {validatorFilter === 'personal_deduction_use' ? 'Mostrando solo estos' : 'Filtrar'}
                  </span>
                </div>
              )}
            </div>
          }
        />
      )}

      {/* Barra de Herramientas y Filtros */}
      <Card size="small" className="mb-4 shadow-sm bg-white">
        <Row gutter={[12, 12]} align="bottom">
          {/* Año */}
          <Col xs={12} sm={6} md={2}>
            <label className="block mb-1 text-xs font-bold text-gray-700">📅 Año</label>
            <Select
              value={selectedYear}
              onChange={setSelectedYear}
              className="w-full"
              options={yearOptions}
            />
          </Col>

          {/* Mes */}
          <Col xs={12} sm={6} md={4}>
            <label className="block mb-1 text-xs font-bold text-gray-700">🗓️ Mes</label>
            <Select
              value={selectedMonth}
              onChange={setSelectedMonth}
              className="w-full"
              options={monthOptions}
            />
          </Col>

          {/* Estado de Póliza */}
          <Col xs={12} sm={6} md={activeTab === 'recibido' ? 3 : 4}>
            <label className="block mb-1 text-xs font-bold text-gray-700">Estado Póliza</label>
            <Select
              value={statusFilter}
              onChange={setStatusFilter}
              className="w-full"
              options={[
                { value: 'all', label: `Todos (${invoices.length})` },
                { value: 'pending', label: `Pendientes (${pendingCount})` },
                { value: 'posted', label: `Generadas (${postedCount})` },
              ]}
            />
          </Col>

          {/* Filtro de Validadores Fiscales (solo en CFDI Recibidos) */}
          {activeTab === 'recibido' && (
            <Col xs={12} sm={6} md={5}>
              <label className="block mb-1 text-xs font-bold text-gray-700">🔍 Validador Fiscal</label>
              <Select
                value={validatorFilter}
                onChange={setValidatorFilter}
                className="w-full"
                options={[
                  { value: 'all', label: `Todos los Recibidos (${periodFilteredInvoices.length})` },
                  { value: 'any_observation', label: `⚠️ Con Observación (${anyObservationCount})` },
                  { value: 'missing_fuel', label: `⛽ Sin Compl. Combustible (${missingFuelCount})` },
                  { value: 'fuel_cash', label: `💵🚫 Combustible en Efectivo (${fuelCashCount})` },
                  { value: 'regime_mismatch', label: `⚠️ Régimen Incorrecto (${regimeMismatchCount})` },
                  { value: 'personal_deduction_use', label: `🩺 Uso CFDI Clave D (${personalDeductionUseCount})` },
                ]}
              />
            </Col>
          )}

          {/* Búsqueda por texto */}
          <Col xs={24} sm={6} md={activeTab === 'recibido' ? 4 : 8}>
            <label className="block mb-1 text-xs font-bold text-gray-700">Búsqueda</label>
            <Input.Search
              placeholder="Cliente/Proveedor, RFC, Folio..."
              allowClear
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              className="w-full"
              prefix={<SearchOutlined className="text-gray-400" />}
            />
          </Col>

          {/* Botón de Generar Pólizas */}
          <Col xs={24} md={6}>
            <Tooltip
              title={
                canGenerate 
                  ? (selectedRowKeys.length > 0 
                      ? `Generar pólizas para ${selectedValidInvoices.length} comprobante(s) seleccionado(s) con cuenta válida`
                      : `Generar pólizas automáticamente para ${validPendingInvoices.length} comprobante(s) que ya tienen cuenta válida asignada`)
                  : "No hay comprobantes pendientes con cuenta contable válida asignada"
              }
            >
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                disabled={!canGenerate}
                onClick={handleBatchGenerate}
                loading={loading}
                className={canGenerate ? "bg-green-600 hover:bg-green-700 w-full font-semibold shadow-sm" : "w-full"}
              >
                {selectedRowKeys.length > 0 
                  ? `Generar Pólizas Seleccionadas (${selectedValidInvoices.length})`
                  : `Generar Pólizas con Cuenta Válida (${validPendingInvoices.length})`}
              </Button>
            </Tooltip>
          </Col>
        </Row>

        {/* Resumen del periodo activo */}
        <div className="mt-3 pt-2 border-t border-gray-100 flex flex-wrap justify-between items-center text-xs text-gray-500">
          <div className="flex items-center flex-wrap gap-1">
            <span>Periodo visualizado:</span>
            <Tag color="blue" className="font-semibold text-xs ml-1">
              {selectedMonth === 'all' 
                ? (selectedYear === 'all' ? 'Todos los comprobantes históricos' : `Todo el año ${selectedYear}`)
                : `${monthOptions.find(m => m.value === selectedMonth)?.label || selectedMonth} ${selectedYear === 'all' ? '(Todos los años)' : selectedYear}`}
            </Tag>
            <span>
              • Mostrando <strong>{displayedInvoices.length}</strong> de <strong>{invoices.length}</strong> comprobantes 
              {pendingCount > 0 && <span className="text-amber-600 font-medium ml-1">({pendingCount} pendientes de póliza)</span>}
            </span>
          </div>

          {(selectedMonth !== 'all' || selectedYear !== 'all' || statusFilter !== 'all' || validatorFilter !== 'all' || searchText) && (
            <Button 
              type="link" 
              size="small" 
              className="text-xs p-0 text-blue-600 hover:underline"
              onClick={() => {
                setSelectedYear('all');
                setSelectedMonth('all');
                setStatusFilter('all');
                setValidatorFilter('all');
                setSearchText('');
              }}
            >
              Ver todos (Restablecer filtros)
            </Button>
          )}
        </div>
      </Card>

      {/* Guía Contable Informativa */}
      <Alert
        message={
          <div className="text-xs text-blue-900 leading-relaxed space-y-1">
            {isNominaTab ? (
              <>
                <div>
                  <strong>Lectura de CFDI de Nómina y Datos Generales:</strong> El sistema lee el Complemento de Nómina 1.2 extrayendo los datos generales del trabajador (<strong>Nombre, RFC, CURP, NSS, No. Empleado, Puesto, Departamento, Salario Base y SDI</strong>), así como el periodo de pago, días pagados, percepciones gravadas/exentas, deducciones (ISR e IMSS) y subsidio al empleo.
                </div>
                <div>
                  <strong>Contabilización Automática de Nómina:</strong> Al presionar <em>Generar Póliza</em>, se carga a la cuenta de gasto asignada (ej. <code>601-01-000 Sueldos y salarios</code>) y se abona a las cuentas de retenciones (<code>216-01-000 Impuestos retenidos de ISR por sueldos y salarios</code> / IMSS) y a la cuenta <code>210-01-000 Provisión de sueldos y salarios por pagar</code> por el neto a pagar.
                </div>
              </>
            ) : (
              <>
                <div>
                  <strong>Automatización Contable:</strong> Al presionar <em>Generar Póliza</em>, el sistema verifica o crea la subcuenta consecutiva afectable bajo {activeTab === 'emitido' ? '105-01-XXX (Clientes)' : '201-01-XXX (Proveedores)'} y memoriza la cuenta de {activeTab === 'emitido' ? 'ingresos' : 'gastos'} por RFC y clave SAT.
                </div>
                <div>
                  <strong>Políticas PPD y PUE:</strong> Las facturas <strong>PPD</strong> (Pago en Parcialidades o Diferido) se contabilizan contra <em>IVA por Trasladar / IVA por Acreditar Pendiente</em>. Las facturas <strong>PUE</strong> (Pago en Una Sola Exhibición) se liquidan automáticamente a través de la cuenta de Banco o Efectivo configurada.
                </div>
                <div>
                  <strong>🌎 Moneda Extranjera (Tipo de Cambio CFDI):</strong> Cuando un CFDI está expresado en moneda extranjera (<code>USD</code>, <code>EUR</code>, <code>CAD</code>, etc.), el sistema toma automáticamente el atributo <code>TipoCambio</code> (o <code>TipoCambioP</code> en Complementos de Pago) que viene en el XML para convertir todos los importes (Subtotal, Descuento, IVA, IEPS, Retenciones y Total) a <strong>Pesos Mexicanos (MXN)</strong> en la póliza contable.
                </div>
              </>
            )}
          </div>
        }
        type="info"
        showIcon
        className="mb-4"
      />

      {/* Tabla de Facturas */}
      <Card size="small" className="shadow-sm bg-white overflow-hidden p-0">
        <Table
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            getCheckboxProps: record => ({
              disabled: record.is_posted || !isAccountValid(record),
            }),
          }}
          rowClassName={record =>
            activeTab === 'recibido' &&
            (record.missing_fuel_complement ||
              record.fuel_paid_in_cash ||
              record.regime_mismatch ||
              record.is_personal_deduction_use ||
              (record.cfdi_use || '').trim().toUpperCase().startsWith('D'))
              ? 'bg-amber-50/40 hover:bg-amber-50/70'
              : ''
          }
          columns={activeColumns}
          dataSource={displayedInvoices}
          rowKey="id"
          loading={loading || uploading}
          scroll={{ x: 1550 }}
          pagination={{
            defaultPageSize: 15,
            pageSizeOptions: ['10', '15', '30', '50', '100'],
            showSizeChanger: true,
            showTotal: (total, range) => `${range[0]}-${range[1]} de ${total} comprobantes`,
          }}
          locale={{
            emptyText: (
              <div className="py-8 text-center text-gray-400">
                <FileTextOutlined className="text-3xl mb-2 block" />
                No hay comprobantes {activeTab === 'emitido' ? 'emitidos' : (activeTab === 'nomina' ? 'de nómina' : 'recibidos')} cargados aún.
                <div className="text-xs mt-1">Arrastre archivos XML arriba para comenzar a leer y contabilizar.</div>
              </div>
            )
          }}
        />
      </Card>

      {/* Modal de Datos Generales y Desglose del CFDI de Nómina */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-gray-800">
            <IdcardOutlined className="text-indigo-600 text-lg" />
            <span>Datos Generales del CFDI de Nómina — {nominaDetailRecord?.partner_name || nominaDetailRecord?.receiver_name}</span>
          </div>
        }
        open={Boolean(nominaDetailRecord)}
        onCancel={() => setNominaDetailRecord(null)}
        footer={[
          nominaDetailRecord?.uuid && (
            <Button
              key="viewer"
              href={`/cfdi-viewer/${nominaDetailRecord.uuid}`}
              target="_blank"
              rel="noopener noreferrer"
              icon={<FileSearchOutlined />}
            >
              Abrir Representación Impresa CFDI
            </Button>
          ),
          <Button key="close" type="primary" onClick={() => setNominaDetailRecord(null)}>
            Cerrar
          </Button>
        ]}
        width={860}
      >
        {nominaDetailRecord && (() => {
          const nd = nominaDetailRecord.nomina_data || {};
          return (
            <div className="space-y-4 text-xs">
              {/* Bloque 1: Datos Generales del Trabajador y Patrón */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div className="font-bold text-slate-800 text-sm mb-2 border-b border-slate-200 pb-1 flex justify-between items-center">
                  <span>👤 Datos Generales del Trabajador y Relación Laboral</span>
                  <Tag color="blue" className="font-mono m-0">UUID: {nominaDetailRecord.uuid}</Tag>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                  <div>
                    <span className="text-gray-500 block">Nombre del Empleado:</span>
                    <span className="font-bold text-gray-900">{nominaDetailRecord.partner_name || nominaDetailRecord.receiver_name || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">RFC del Empleado:</span>
                    <span className="font-mono font-bold text-gray-900">{nominaDetailRecord.partner_rfc || nominaDetailRecord.receiver_rfc || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">CURP:</span>
                    <span className="font-mono font-semibold text-gray-800">{nd.curp || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">No. Seguridad Social (NSS):</span>
                    <span className="font-mono font-semibold text-gray-800">{nd.nss || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Número de Empleado:</span>
                    <span className="font-mono font-bold text-indigo-700">{nd.num_empleado || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Departamento:</span>
                    <span className="font-semibold text-gray-800">{nd.departamento || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Puesto:</span>
                    <span className="font-semibold text-gray-800">{nd.puesto || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Registro Patronal:</span>
                    <span className="font-mono text-gray-800">{nd.registro_patronal || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Fecha Inicio Rel. Laboral:</span>
                    <span className="font-mono text-gray-800">{nd.fecha_inicio_rel_laboral || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Antigüedad:</span>
                    <span className="font-mono text-gray-800">{nd.antiguedad || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Salario Base Cot. (SBC):</span>
                    <span className="font-mono font-semibold text-gray-900">{formatMoney(nd.salario_base_cot_apor)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Salario Diario Integrado (SDI):</span>
                    <span className="font-mono font-semibold text-blue-800">{formatMoney(nd.salario_diario_integrado)}</span>
                  </div>
                </div>
              </div>

              {/* Bloque 2: Datos Generales del Periodo y Pago */}
              <div className="bg-blue-50/50 border border-blue-200 rounded-lg p-3">
                <div className="font-bold text-blue-900 text-sm mb-2 border-b border-blue-200 pb-1">
                  📅 Datos Generales de la Nómina y Periodo de Pago
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
                  <div>
                    <span className="text-gray-500 block">Tipo de Nómina:</span>
                    <Tag color={nd.tipo_nomina === 'E' ? 'purple' : 'green'} className="font-bold mt-0.5">
                      {nd.tipo_nomina_label || 'Ordinaria'} ({nd.tipo_nomina || 'O'})
                    </Tag>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Fecha de Pago:</span>
                    <span className="font-mono font-bold text-blue-900">{nd.fecha_pago || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Fecha Inicial Pago:</span>
                    <span className="font-mono text-gray-800">{nd.fecha_inicial_pago || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Fecha Final Pago:</span>
                    <span className="font-mono text-gray-800">{nd.fecha_final_pago || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Días Pagados:</span>
                    <span className="font-mono font-bold text-gray-900">{nd.num_dias_pagados || 0} días</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Periodicidad / Entidad:</span>
                    <span className="font-mono text-gray-800">{nd.periodicidad_pago || '-'} {nd.clave_ent_fed ? `(${nd.clave_ent_fed})` : ''}</span>
                  </div>
                </div>
              </div>

              {/* Bloque 3: Tablas de Percepciones y Deducciones */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-800 text-white px-3 py-1.5 font-bold flex justify-between">
                    <span>Percepciones y Otros Pagos</span>
                    <span>{formatMoney((nd.total_percepciones || 0) + (nd.total_otros_pagos || 0))}</span>
                  </div>
                  <table className="w-full text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 text-gray-600">
                        <th className="py-1 px-2 text-left">Clave</th>
                        <th className="py-1 px-2 text-left">Concepto</th>
                        <th className="py-1 px-2 text-right">Gravado</th>
                        <th className="py-1 px-2 text-right">Exento</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(nd.percepciones || []).map((p, idx) => (
                        <tr key={idx}>
                          <td className="py-1 px-2 font-mono text-gray-500">{p.tipo_percepcion}-{p.clave}</td>
                          <td className="py-1 px-2 text-gray-800">{p.concepto}</td>
                          <td className="py-1 px-2 text-right font-mono">{formatMoney(p.importe_gravado)}</td>
                          <td className="py-1 px-2 text-right font-mono">{formatMoney(p.importe_exento)}</td>
                        </tr>
                      ))}
                      {(nd.otros_pagos || []).map((op, idx) => (
                        <tr key={`op-${idx}`} className="bg-emerald-50/50">
                          <td className="py-1 px-2 font-mono text-emerald-700">OP-{op.tipo_otro_pago}</td>
                          <td className="py-1 px-2 text-emerald-900">
                            {op.concepto}
                            {op.subsidio_causado > 0 && <span className="block text-[10px] text-emerald-700">Subsidio Causado: {formatMoney(op.subsidio_causado)}</span>}
                          </td>
                          <td className="py-1 px-2 text-right font-mono">-</td>
                          <td className="py-1 px-2 text-right font-mono font-bold text-emerald-800">{formatMoney(op.importe)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-red-900 text-white px-3 py-1.5 font-bold flex justify-between">
                    <span>Deducciones y Retenciones</span>
                    <span>-{formatMoney(nd.total_deducciones || 0)}</span>
                  </div>
                  <table className="w-full text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 text-gray-600">
                        <th className="py-1 px-2 text-left">Tipo / Clave</th>
                        <th className="py-1 px-2 text-left">Concepto</th>
                        <th className="py-1 px-2 text-right">Importe</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(nd.deducciones || []).length === 0 ? (
                        <tr>
                          <td colSpan={3} className="py-3 text-center text-gray-400">Sin deducciones registradas</td>
                        </tr>
                      ) : (
                        (nd.deducciones || []).map((d, idx) => (
                          <tr key={idx}>
                            <td className="py-1 px-2 font-mono text-gray-500">{d.tipo_deduccion}-{d.clave}</td>
                            <td className="py-1 px-2 text-gray-800">{d.concepto}</td>
                            <td className="py-1 px-2 text-right font-mono text-red-700 font-semibold">-{formatMoney(d.importe)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Resumen Neto */}
              <div className="flex flex-wrap justify-end items-center gap-6 bg-slate-900 text-white p-3 rounded-lg">
                <div>
                  <span className="text-slate-400 mr-1">Total Percepciones:</span>
                  <span className="font-mono font-bold">{formatMoney(nd.total_percepciones || nominaDetailRecord.subtotal)}</span>
                </div>
                <div>
                  <span className="text-slate-400 mr-1">Otros Pagos:</span>
                  <span className="font-mono font-bold text-emerald-400">+{formatMoney(nd.total_otros_pagos || 0)}</span>
                </div>
                <div>
                  <span className="text-slate-400 mr-1">Total Deducciones:</span>
                  <span className="font-mono font-bold text-red-400">-{formatMoney(nd.total_deducciones || 0)}</span>
                </div>
                <div className="text-sm border-l border-slate-700 pl-4">
                  <span className="text-slate-300 mr-2 font-semibold">NETO PAGADO:</span>
                  <span className="font-mono font-bold text-base text-emerald-300">{formatMoney(nominaDetailRecord.total)}</span>
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Modal de Resultado Detallado de Carga de CFDI */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-gray-800">
            <InboxOutlined className="text-blue-600 text-lg" />
            <span>Resultado de la Carga de CFDI ({activeTab === 'emitido' ? 'Emitidos' : (activeTab === 'nomina' ? 'Nómina' : 'Recibidos')})</span>
          </div>
        }
        open={Boolean(uploadModalData?.visible)}
        onCancel={() => setUploadModalData(null)}
        footer={[
          <Button key="close" type="primary" onClick={() => setUploadModalData(null)}>
            Entendido
          </Button>
        ]}
        width={720}
      >
        {uploadModalData && (
          <div className="py-2 text-sm space-y-3">
            <div className="flex flex-wrap items-center gap-4 bg-gray-50 border p-3 rounded-lg text-xs">
              <div>Total de archivos enviados: <strong>{uploadModalData.totalFiles}</strong></div>
              <div>Cargados exitosamente: <strong className="text-emerald-700">{uploadModalData.successCount}</strong></div>
              <div>Rechazados / Omitidos: <strong className={uploadModalData.errors.length > 0 ? "text-red-600" : "text-gray-500"}>{uploadModalData.errors.length}</strong></div>
            </div>

            {uploadModalData.errors.length > 0 && (
              <div>
                <div className="text-xs font-bold text-red-700 mb-1.5 flex items-center gap-1">
                  <span>Motivos de comprobantes no agregados ({uploadModalData.errors.length}):</span>
                </div>
                <div className="max-h-60 overflow-y-auto border border-red-200 bg-red-50/40 rounded p-2.5 text-xs space-y-1.5 font-mono text-gray-800">
                  {uploadModalData.errors.map((err, idx) => (
                    <div key={idx} className="border-b border-red-100 last:border-b-0 pb-1">
                      {err}
                    </div>
                  ))}
                </div>
                <div className="text-[11px] text-gray-500 mt-2">
                  {activeTab === 'nomina' ? (
                    <span>* En la pestaña <strong>CFDI de Nómina</strong> únicamente se leen comprobantes con <code>TipoDeComprobante="N"</code> (Complemento de Nómina) donde la empresa ({clientInfo?.rfc}) figure como Patrón Emisor.</span>
                  ) : (
                    <span>* Recuerde que en CFDI {activeTab === 'emitido' ? 'Emitidos' : 'Recibidos'} la empresa ({clientInfo?.rfc}) debe ser el <strong>{activeTab === 'emitido' ? 'Emisor' : 'Receptor'}</strong>, y los recibos de nómina (Tipo N) se cargan en la 3ra pestaña <strong>CFDI de Nómina</strong>.</span>
                  )}
                </div>
              </div>
            )}

            {uploadModalData.successCount > 0 && (
              <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 p-2.5 rounded">
                Se agregaron <strong>{uploadModalData.successCount}</strong> comprobante(s) a la lista. 
                Si algunos no se muestran en la tabla inmediatamente, verifique el selector de <strong>Mes</strong> en la barra de herramientas (seleccione <em>"Todos los Meses"</em> para ver comprobantes con fecha de corte de fin de mes anterior).
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Ventana de Captura de Activo Fijo al detectar CFDI con Uso Inversión (I01..I08) */}
      <FixedAssetModal
        open={Boolean(inversionModalCfdi)}
        onCancel={() => {
          setInversionModalCfdi(null);
          setDetectedInversionCfdis([]);
        }}
        onSuccess={async (savedAsset, processedCfdi) => {
          await fetchAccounts();
          await fetchInvoices();
          if (processedCfdi && detectedInversionCfdis.length > 1) {
            const remaining = detectedInversionCfdis.filter(c => c.uuid !== processedCfdi.uuid);
            setDetectedInversionCfdis(remaining);
            if (remaining.length > 0) {
              setInversionModalCfdi(remaining[0]);
              return;
            }
          }
          setInversionModalCfdi(null);
          setDetectedInversionCfdis([]);
        }}
        clientId={clientId}
        cfdiInvoice={inversionModalCfdi}
        pendingCfdis={detectedInversionCfdis}
      />
    </div>
  );
};

export default CfdiUpload;
