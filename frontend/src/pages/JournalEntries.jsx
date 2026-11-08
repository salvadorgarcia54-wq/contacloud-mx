import React, { useState, useEffect, useMemo } from 'react';
import { 
  Table, Button, DatePicker, Select, Input, InputNumber, Modal, Form, 
  Space, Tag, Popconfirm, message, Alert, Typography, Row, Col, Card, Tooltip 
} from 'antd';
import { 
  PlusOutlined, DeleteOutlined, EditOutlined, MinusCircleOutlined, 
  SearchOutlined, FileTextOutlined, CheckCircleOutlined, CloseCircleOutlined,
  FileSearchOutlined, QuestionCircleOutlined, ExportOutlined,
  LockOutlined, UnlockOutlined, RollbackOutlined, AuditOutlined, PrinterOutlined
} from '@ant-design/icons';
import { useParams, useSearchParams } from 'react-router-dom';
import { journalsApi, accountsApi, clientsApi } from '../api/client';
import dayjs from 'dayjs';

const { Option } = Select;
const { RangePicker } = DatePicker;
const { Text, Title } = Typography;

const formatMoney = (val) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val || 0);

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

const JournalEntries = () => {
  const { clientId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [entries, setEntries] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [clientInfo, setClientInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedRowKeys, setExpandedRowKeys] = useState([]);
  const [highlightedEntryId, setHighlightedEntryId] = useState(null);
  
  // Centered Modal State
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [nextNumbers, setNextNumbers] = useState({ ingreso: 1, egreso: 1, diario: 1 });
  const [isManualNumber, setIsManualNumber] = useState(false);
  const [currentEntryType, setCurrentEntryType] = useState('diario');
  const [form] = Form.useForm();
  const watchedFormDate = Form.useWatch('date', form);
  
  // Filters
  const [dateRange, setDateRange] = useState(null);
  const [typeFilter, setTypeFilter] = useState('todas');
  const [searchText, setSearchText] = useState('');

  // Search inputs per line and Add Account Modal State
  const [searchInputs, setSearchInputs] = useState({});
  const [isAddAccountModalOpen, setIsAddAccountModalOpen] = useState(false);
  const [targetLineIndex, setTargetLineIndex] = useState(null);
  const [accountForm] = Form.useForm();
  const [savingAccount, setSavingAccount] = useState(false);

  // Póliza de Cierre de Ejercicio State
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [closeYear, setCloseYear] = useState(dayjs().year());
  const [closeData, setCloseData] = useState(null);
  const [closeLoading, setCloseLoading] = useState(false);
  const [executingClose, setExecutingClose] = useState(false);
  const [revertingClose, setRevertingClose] = useState(false);

  const isResultadoAccountNumber = (accNum) => {
    const clean = String(accNum || '').trim();
    return clean.length > 0 && ['4', '5', '6', '7'].includes(clean[0]);
  };

  // Detectar ejercicios cerrados a partir de las pólizas con referencia CIERRE-20xx
  const closedYearsMap = useMemo(() => {
    const map = {};
    (entries || []).forEach(e => {
      const ref = String(e.reference || '').trim().toUpperCase();
      if (ref.startsWith('CIERRE-') && !e.is_cancelled) {
        const y = parseInt(ref.replace('CIERRE-', ''), 10);
        if (!isNaN(y)) {
          map[y] = e;
        }
      }
    });
    return map;
  }, [entries]);

  const isSelectedFormYearClosed = useMemo(() => {
    if (!watchedFormDate) return false;
    const y = dayjs(watchedFormDate).year();
    return Boolean(closedYearsMap[y]);
  }, [watchedFormDate, closedYearsMap]);

  // Cuentas contables formateadas para el Select: mostrar visualmente únicamente cuentas Afectables
  const accountOptions = useMemo(() => {
    const usedAccountIds = new Set(
      (editingEntry?.lines || []).map(l => l.account_id).filter(Boolean)
    );
    const opts = accounts
      .filter(a => a.classification === 'Afectable' || usedAccountIds.has(a.id))
      .map(a => {
        const isResultado = isResultadoAccountNumber(a.account_number);
        const lockedByClose = isSelectedFormYearClosed && isResultado;
        return {
          value: a.id,
          label: lockedByClose
            ? `🔒 ${a.account_number} - ${a.name} (Ejercicio cerrado)`
            : `${a.account_number} - ${a.name}`,
          accountNumber: a.account_number,
          accountName: a.name,
          classification: a.classification,
          isAfectable: true,
          disabled: lockedByClose
        };
      });

    const optIds = new Set(opts.map(o => o.value));
    (editingEntry?.lines || []).forEach(l => {
      if (l.account_id && !optIds.has(l.account_id) && (l.account_number || l.account_name)) {
        optIds.add(l.account_id);
        opts.push({
          value: l.account_id,
          label: `${l.account_number || ''} - ${l.account_name || ''}`,
          accountNumber: l.account_number || '',
          accountName: l.account_name || '',
          classification: 'Afectable',
          isAfectable: true,
          disabled: false
        });
      }
    });

    return opts;
  }, [accounts, isSelectedFormYearClosed, editingEntry]);

  const filterAccountOption = (input, option) => {
    if (!input) return true;
    const cleanInput = input.toLowerCase().replace(/[-\s]/g, '');
    const cleanLabel = String(option?.label || '').toLowerCase().replace(/[-\s]/g, '');
    const cleanNum = String(option?.accountNumber || '').toLowerCase().replace(/[-\s]/g, '');
    return cleanLabel.includes(cleanInput) || cleanNum.includes(cleanInput);
  };

  const promptAddAccount = (typed, lineIndex) => {
    const formatted = formatAccountNumber(typed) || typed;
    Modal.confirm({
      title: 'Cuenta inexistente, ¿desea agregar cuenta?',
      icon: <QuestionCircleOutlined style={{ color: '#faad14' }} />,
      content: (
        <div>
          <p className="mb-2 text-gray-700">
            La cuenta <strong className="font-mono text-blue-700">{formatted}</strong> no existe en el catálogo de cuentas de esta empresa.
          </p>
          <p className="text-xs text-gray-500 mb-0">
            ¿Desea capturarla y agregarla como nueva cuenta afectable al catálogo de cuentas?
          </p>
        </div>
      ),
      okText: 'Sí',
      cancelText: 'No',
      okButtonProps: { type: 'primary' },
      onOk: () => {
        openAddAccountModal(formatted, lineIndex);
      }
    });
  };

  const openAddAccountModal = (formattedNum, lineIndex) => {
    setTargetLineIndex(lineIndex);
    accountForm.resetFields();

    let suggestedParentId = undefined;
    let suggestedSatCode = '';
    let suggestedNature = 'deudora';

    const parts = (formattedNum || '').split('-');
    if (parts.length === 3) {
      const parentNum2 = `${parts[0]}-${parts[1]}-000`;
      const parentNum1 = `${parts[0]}-00-000`;
      const parent = accounts.find(a => a.account_number === parentNum2) || accounts.find(a => a.account_number === parentNum1);
      if (parent) {
        suggestedParentId = parent.id;
        suggestedSatCode = parent.sat_group_code || '';
        suggestedNature = parent.nature || 'deudora';
      }
    } else if (parts.length === 2) {
      const parentNum1 = `${parts[0]}-00-000`;
      const parent = accounts.find(a => a.account_number === parentNum1);
      if (parent) {
        suggestedParentId = parent.id;
        suggestedSatCode = parent.sat_group_code || '';
        suggestedNature = parent.nature || 'deudora';
      }
    }

    accountForm.setFieldsValue({
      parent_id: suggestedParentId,
      account_number: formattedNum,
      name: '',
      classification: 'Afectable',
      nature: suggestedNature,
      sat_group_code: suggestedSatCode,
      level: 3,
      is_active: true
    });

    setIsAddAccountModalOpen(true);
  };

  const handleSaveNewAccount = async () => {
    try {
      const values = await accountForm.validateFields();
      setSavingAccount(true);
      const formattedNumber = formatAccountNumber(values.account_number);
      const payload = {
        ...values,
        account_number: formattedNumber,
        client_id: parseInt(clientId, 10),
      };

      const res = await accountsApi.create(payload);
      message.success('Cuenta contable agregada exitosamente al catálogo.');

      await fetchAccounts();

      if (targetLineIndex !== null && res.data?.id) {
        form.setFieldValue(['lines', targetLineIndex, 'account_id'], res.data.id);
      }

      setIsAddAccountModalOpen(false);
    } catch (err) {
      const errorMsg = err?.response?.data?.detail || 'Error al guardar la nueva cuenta';
      message.error(errorMsg);
    } finally {
      setSavingAccount(false);
    }
  };

  const fetchEntries = async () => {
    setLoading(true);
    try {
      const res = await journalsApi.listByClient(clientId);
      setEntries(res.data || []);
    } catch (err) {
      setError('Error al cargar pólizas contables');
    } finally {
      setLoading(false);
    }
  };

  const fetchAccounts = async () => {
    try {
      // Filtrar solo cuentas activas para ahorrar memoria y agilizar captura
      const res = await accountsApi.getClientAccounts(clientId, { active_only: true });
      setAccounts(res.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (clientId) {
      fetchEntries().then(() => fetchAccounts());
      clientsApi.get(clientId).then(r => setClientInfo(r.data)).catch(() => {});
    }
  }, [clientId]);

  // Calcular localmente los números consecutivos por tipo de póliza
  const calculateNextNumbersLocal = (year, entryList = entries) => {
    const y = year || dayjs().year();
    const nums = { ingreso: 1, egreso: 1, diario: 1 };
    ['ingreso', 'egreso', 'diario'].forEach(t => {
      const max = (entryList || [])
        .filter(e => e.entry_type === t && dayjs(e.date).year() === y)
        .reduce((m, e) => Math.max(m, e.entry_number || 0), 0);
      nums[t] = max + 1;
    });
    return nums;
  };

  // Obtener números consecutivos desde la API y sincronizar
  const fetchNextNumbers = async (targetYear) => {
    const y = targetYear || (form.getFieldValue('date') ? form.getFieldValue('date').year() : dayjs().year());
    const localNums = calculateNextNumbersLocal(y);
    setNextNumbers(localNums);
    try {
      const res = await journalsApi.getNextNumbers(clientId, { year: y });
      if (res?.data) {
        setNextNumbers(res.data);
        return res.data;
      }
    } catch (e) {
      console.error('Error fetching next numbers, using local:', e);
    }
    return localNums;
  };

  // Cuadrar la póliza de forma automática con un cargo o abono
  const handleAutoBalance = () => {
    const lines = form.getFieldValue('lines') || [];
    if (lines.length === 0) {
      message.warning('No hay movimientos en la póliza.');
      return;
    }

    const totalD = lines.reduce((acc, l) => acc + (Number(l?.debit) || 0), 0);
    const totalH = lines.reduce((acc, l) => acc + (Number(l?.credit) || 0), 0);
    const diff = Math.round(Math.abs(totalD - totalH) * 100) / 100;

    if (diff < 0.01) {
      message.info('La póliza ya se encuentra cuadrada.');
      return;
    }

    // Determinar si falta Cargo (Debe) o Abono (Haber)
    // Si totalD > totalH, falta Abono (Haber) para igualar el Debe
    // Si totalH > totalD, falta Cargo (Debe) para igualar el Haber
    const needCredit = totalD > totalH;

    // Buscar una línea que ya tenga cuenta elegida y que tenga importes en cero (o vacíos)
    let targetIdx = lines.findIndex(l => 
      l?.account_id && 
      (Number(l?.debit) || 0) === 0 && 
      (Number(l?.credit) || 0) === 0
    );

    // Si no hay línea en cero con cuenta elegida:
    if (targetIdx === -1) {
      // Verificar si hay alguna línea con importes en cero pero sin cuenta elegida
      const emptyWithoutAccount = lines.some(l => 
        !l?.account_id && 
        (Number(l?.debit) || 0) === 0 && 
        (Number(l?.credit) || 0) === 0
      );

      if (emptyWithoutAccount) {
        message.warning('Para cuadrar la póliza automáticamente, primero elija la cuenta contable en el movimiento donde desea aplicar el importe.');
        return;
      }

      // Si todas las líneas tienen importes mayores a cero
      message.warning('Para cuadrar la póliza automáticamente, agregue una nueva línea de movimiento y elija su cuenta contable.');
      return;
    }

    const targetLine = lines[targetIdx];
    const acc = accounts.find(a => a.id === targetLine.account_id);
    const accName = acc ? `${acc.account_number} - ${acc.name}` : `Movimiento #${targetIdx + 1}`;

    const updatedLines = [...lines];
    if (needCredit) {
      updatedLines[targetIdx] = {
        ...targetLine,
        credit: diff,
        debit: 0
      };
      message.success(`Póliza cuadrada automáticamente con Abono de ${formatMoney(diff)} en ${accName}`);
    } else {
      updatedLines[targetIdx] = {
        ...targetLine,
        debit: diff,
        credit: 0
      };
      message.success(`Póliza cuadrada automáticamente con Cargo de ${formatMoney(diff)} en ${accName}`);
    }

    form.setFieldsValue({ lines: updatedLines });
  };

  // Abrir Modal Centrado para Nueva Póliza
  const handleOpenNewEntry = async () => {
    form.resetFields();
    setEditingEntry(null);
    setIsManualNumber(false);
    const currentDate = dayjs();
    const defaultType = 'diario';
    setCurrentEntryType(defaultType);

    // Consecutivos instantáneos en memoria
    const localNums = calculateNextNumbersLocal(currentDate.year());
    setNextNumbers(localNums);
    const initialNumber = localNums[defaultType] || 1;

    form.setFieldsValue({
      entry_type: defaultType,
      entry_number: initialNumber,
      date: currentDate,
      description: '',
      reference: '',
      cfdi_uuid: '',
      lines: [
        { account_id: undefined, description: '', debit: 0, credit: 0 },
        { account_id: undefined, description: '', debit: 0, credit: 0 }
      ]
    });
    setIsModalVisible(true);

    // Sincronizar en segundo plano con el backend
    try {
      const res = await journalsApi.getNextNumbers(clientId, { year: currentDate.year() });
      if (res?.data) {
        setNextNumbers(res.data);
        const curType = form.getFieldValue('entry_type') || defaultType;
        if (!isManualNumber) {
          form.setFieldsValue({ entry_number: res.data[curType] || 1 });
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Abrir Modal Centrado para Editar Póliza
  const handleOpenEditEntry = async (record) => {
    setEditingEntry(record);
    setIsManualNumber(true); // En edición se conserva el folio capturado
    if (record.entry_type) {
      setCurrentEntryType(record.entry_type);
    }
    try {
      setLoading(true);
      const fullRes = await journalsApi.get(record.id);
      const entry = fullRes.data;
      setEditingEntry(entry);
      setCurrentEntryType(entry.entry_type);
      
      form.setFieldsValue({
        entry_type: entry.entry_type,
        entry_number: entry.entry_number,
        date: dayjs(entry.date),
        description: entry.description,
        reference: entry.reference || '',
        cfdi_uuid: entry.cfdi_uuid || '',
        lines: (entry.lines || []).map(l => ({
          account_id: l.account_id,
          description: l.description || entry.description,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0
        }))
      });
      setIsModalVisible(true);
    } catch (e) {
      message.error('Error al cargar detalle de la póliza');
    } finally {
      setLoading(false);
    }
  };

  // Si se navega desde el Contabilizador de CFDI con ?entryId=XX, abrir automáticamente esa póliza en particular
  useEffect(() => {
    const entryIdParam = searchParams.get('entryId');
    if (entryIdParam) {
      const targetId = parseInt(entryIdParam, 10);
      if (!isNaN(targetId)) {
        setHighlightedEntryId(targetId);
        setExpandedRowKeys(prev => (prev.includes(targetId) ? prev : [...prev, targetId]));
        handleOpenEditEntry({ id: targetId });
      }
    }
  }, [searchParams]);

  // Cambio de tipo de póliza para actualizar número consecutivo automático inmediatamente
  const handleTypeChange = (newType) => {
    setCurrentEntryType(newType);
    if (editingEntry) return; // No cambiar número en edición
    if (!isManualNumber) {
      const num = nextNumbers[newType] || 1;
      form.setFieldsValue({ entry_number: num });
    }
  };

  // Cambio de fecha para recalcular consecutivo por ejercicio fiscal
  const handleDateChange = async (newDate) => {
    if (!newDate || editingEntry) return;
    const curYear = newDate.year();
    const curType = form.getFieldValue('entry_type') || 'diario';
    const nums = await fetchNextNumbers(curYear);
    if (!isManualNumber && nums) {
      form.setFieldsValue({ entry_number: nums[curType] || 1 });
    }
  };

  const handleDelete = async (id) => {
    try {
      await journalsApi.delete(id);
      message.success('Póliza eliminada');
      fetchEntries();
    } catch (err) {
      const errorMsg = err?.response?.data?.detail || 'Error al eliminar póliza';
      message.error(errorMsg);
    }
  };

  // --- Cierre de Ejercicio (Cancelación de Cuentas de Resultados contra 304-01-xxx / 304-02-xxx) ---
  const fetchYearEndCloseInfo = async (targetYear) => {
    const y = targetYear || closeYear || dayjs().year();
    setCloseLoading(true);
    try {
      const res = await journalsApi.getYearEndClose(clientId, y);
      setCloseData(res.data);
    } catch (err) {
      message.error(err?.response?.data?.detail || `Error al consultar cierre del ejercicio ${y}`);
      setCloseData(null);
    } finally {
      setCloseLoading(false);
    }
  };

  const handleOpenCloseModal = async (initialYear) => {
    // Determinar año sugerido: si hay filtro de fechas usar ese año, o el año más reciente con pólizas, o el actual
    let defaultY = initialYear;
    if (!defaultY) {
      if (dateRange && dateRange[0]) {
        defaultY = dateRange[0].year();
      } else if (entries.length > 0) {
        defaultY = dayjs(entries[0].date).year();
      } else {
        defaultY = dayjs().year();
      }
    }
    setCloseYear(defaultY);
    setCloseModalOpen(true);
    await fetchYearEndCloseInfo(defaultY);
  };

  const handleExecuteClose = async () => {
    setExecutingClose(true);
    try {
      const res = await journalsApi.createYearEndClose(clientId, closeYear);
      message.success(res.data?.message || `Póliza de cierre del ejercicio ${closeYear} generada exitosamente.`);
      await Promise.all([fetchEntries(), fetchAccounts(), fetchYearEndCloseInfo(closeYear)]);
    } catch (err) {
      message.error(err?.response?.data?.detail || 'Error al generar la póliza de cierre de ejercicio');
    } finally {
      setExecutingClose(false);
    }
  };

  const handleRevertClose = async (targetYear) => {
    const y = targetYear || closeYear;
    setRevertingClose(true);
    try {
      const res = await journalsApi.revertYearEndClose(clientId, y);
      message.success(res.data?.message || `Póliza de cierre del ejercicio ${y} revertida exitosamente.`);
      await Promise.all([fetchEntries(), fetchAccounts()]);
      if (closeModalOpen) {
        await fetchYearEndCloseInfo(y);
      }
    } catch (err) {
      message.error(err?.response?.data?.detail || 'Error al revertir la póliza de cierre de ejercicio');
    } finally {
      setRevertingClose(false);
    }
  };

  const onSaveEntry = async () => {
    try {
      const values = await form.validateFields();
      const lines = values.lines || [];

      if (lines.length === 0) {
        message.error('La póliza debe contener al menos un movimiento contable.');
        return;
      }

      const totalDebe = lines.reduce((sum, l) => sum + (Number(l?.debit) || 0), 0);
      const totalHaber = lines.reduce((sum, l) => sum + (Number(l?.credit) || 0), 0);
      
      if (Math.abs(totalDebe - totalHaber) > 0.01) {
        message.error(`La póliza está descuadrada. Debe ($${totalDebe.toFixed(2)}) y Haber ($${totalHaber.toFixed(2)}) deben ser iguales.`);
        return;
      }

      if (totalDebe <= 0) {
        message.error('Los importes de la póliza deben ser mayores a cero.');
        return;
      }

      for (let i = 0; i < lines.length; i++) {
        const acc = accounts.find(a => a.id === lines[i]?.account_id);
        if (acc && acc.classification !== 'Afectable') {
          message.error(`El movimiento #${i + 1} tiene seleccionada la cuenta ${acc.account_number} (${acc.name}) que es de Acumulación. En las pólizas solo se permite seleccionar cuentas Afectables.`);
          return;
        }

        const d = Number(lines[i]?.debit) || 0;
        const c = Number(lines[i]?.credit) || 0;
        if (d > 0 && c > 0) {
          message.error(`El movimiento #${i + 1} tiene capturado tanto Cargo ($${d.toFixed(2)}) como Abono ($${c.toFixed(2)}). Cada movimiento debe tener solo Cargo o solo Abono.`);
          return;
        }
        if (d <= 0 && c <= 0) {
          message.error(`El movimiento #${i + 1} debe tener un importe mayor a cero en Cargo o en Abono.`);
          return;
        }
      }

      setLoading(true);
      const payload = {
        client_id: parseInt(clientId, 10),
        entry_number: values.entry_number ? parseInt(values.entry_number, 10) : undefined,
        entry_type: values.entry_type,
        date: values.date.format('YYYY-MM-DD'),
        description: values.description,
        reference: values.reference ? values.reference.trim() : null,
        cfdi_uuid: values.cfdi_uuid ? values.cfdi_uuid.trim() : null,
        lines: lines.map((l, idx) => ({
          account_id: l.account_id,
          description: (l.description || values.description || '').trim(),
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          line_order: idx + 1
        }))
      };

      if (editingEntry) {
        await journalsApi.update(editingEntry.id, payload);
        message.success('Póliza actualizada exitosamente');
      } else {
        await journalsApi.create(payload);
        message.success('Póliza guardada exitosamente');
      }

      setIsModalVisible(false);
      fetchEntries();
    } catch (err) {
      const errorMsg = err?.response?.data?.detail || 'Error al guardar la póliza';
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const filteredEntries = entries.filter(e => {
    if (typeFilter !== 'todas' && e.entry_type !== typeFilter) return false;
    if (searchText) {
      const text = searchText.toLowerCase().trim();
      const descMatch = (e.description || '').toLowerCase().includes(text);
      const refMatch = (e.reference || '').toLowerCase().includes(text);
      const uuidMatch = (e.cfdi_uuid || '').toLowerCase().includes(text);
      const numMatch = String(e.entry_number || '').includes(text);
      if (!descMatch && !refMatch && !uuidMatch && !numMatch) return false;
    }
    if (dateRange && dateRange[0] && dateRange[1]) {
      const edate = dayjs(e.date);
      if (edate.isBefore(dateRange[0], 'day') || edate.isAfter(dateRange[1], 'day')) return false;
    }
    return true;
  });

  // Ordenar por fecha de más antigua a más reciente y después por número consecutivo
  const sortedEntries = [...filteredEntries].sort((a, b) => {
    const dateA = dayjs(a.date).valueOf();
    const dateB = dayjs(b.date).valueOf();
    if (dateA !== dateB) return dateA - dateB; // de fecha más antigua a fecha más reciente

    const numDiff = (a.entry_number || 0) - (b.entry_number || 0);
    if (numDiff !== 0) return numDiff;

    return (a.id || 0) - (b.id || 0);
  });

  const columns = [
    { 
      title: 'No.', 
      dataIndex: 'entry_number', 
      key: 'entry_number', 
      width: 80,
      align: 'center',
      sorter: (a, b) => (a.entry_number || 0) - (b.entry_number || 0),
      render: (num) => <span className="font-bold text-gray-800">{num}</span>
    },
    { 
      title: 'Tipo', 
      dataIndex: 'entry_type', 
      key: 'entry_type',
      width: 100,
      sorter: (a, b) => {
        const typePriority = { ingreso: 3, egreso: 2, diario: 1 };
        return (typePriority[a.entry_type] || 0) - (typePriority[b.entry_type] || 0);
      },
      render: t => {
        let color = 'blue';
        if (t === 'ingreso') color = 'green';
        if (t === 'egreso') color = 'red';
        return <Tag color={color} className="font-semibold">{t?.toUpperCase()}</Tag>;
      }
    },
    { 
      title: 'Fecha', 
      dataIndex: 'date', 
      key: 'date', 
      width: 110,
      sorter: (a, b) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf(),
      render: d => dayjs(d).format('DD/MM/YYYY')
    },
    { 
      title: 'Concepto General', 
      dataIndex: 'description', 
      key: 'description',
      render: (text) => <span className="font-medium text-gray-700">{text || '-'}</span>
    },
    { 
      title: 'Referencia', 
      dataIndex: 'reference', 
      key: 'reference',
      width: 150,
      render: (ref) => {
        if (!ref) return <span className="text-gray-400">-</span>;
        const cleanRef = String(ref).trim().toUpperCase();
        if (cleanRef.startsWith('CIERRE-')) {
          return (
            <Tag color="purple" className="font-bold">
              <LockOutlined className="mr-1" />
              {cleanRef}
            </Tag>
          );
        }
        return <Tag color="cyan">{ref}</Tag>;
      }
    },
    { 
      title: 'CFDI / UUID', 
      dataIndex: 'cfdi_uuid', 
      key: 'cfdi_uuid',
      width: 160,
      render: (uuid) => uuid ? (
        <Tooltip title={`Ver CFDI XML (${uuid})`}>
          <a
            href={`/cfdi-viewer/${uuid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block group"
          >
            <Tag color="geekblue" className="font-mono text-xs cursor-pointer group-hover:border-blue-500 group-hover:bg-blue-100 transition-colors flex items-center gap-1">
              <span>{uuid.length > 13 ? `${uuid.slice(0, 13)}...` : uuid}</span>
              <FileSearchOutlined style={{ fontSize: '11px' }} />
            </Tag>
          </a>
        </Tooltip>
      ) : <span className="text-gray-400">-</span>
    },
    { 
      title: 'Total Debe', 
      dataIndex: 'total_debit', 
      key: 'total_debit', 
      align: 'right',
      width: 130,
      sorter: (a, b) => Number(a.total_debit || 0) - Number(b.total_debit || 0),
      render: val => <span className="font-semibold text-gray-800">{formatMoney(val)}</span>
    },
    { 
      title: 'Total Haber', 
      dataIndex: 'total_credit', 
      key: 'total_credit', 
      align: 'right',
      width: 130,
      sorter: (a, b) => Number(a.total_credit || 0) - Number(b.total_credit || 0),
      render: val => <span className="font-semibold text-gray-800">{formatMoney(val)}</span>
    },
    {
      title: 'Acciones',
      key: 'actions',
      width: 150,
      align: 'center',
      render: (_, record) => {
        const cleanRef = String(record.reference || '').trim().toUpperCase();
        const isClosingEntry = cleanRef.startsWith('CIERRE-');
        const entryYear = dayjs(record.date).year();
        const isYearClosed = Boolean(closedYearsMap[entryYear]);
        const hasResultado = Boolean(
          record.has_resultado_accounts ||
          (record.lines || []).some(l => isResultadoAccountNumber(l.account_number))
        );
        const lockedByClose = !isClosingEntry && isYearClosed && hasResultado;

        if (isClosingEntry) {
          const closingYear = parseInt(cleanRef.replace('CIERRE-', ''), 10) || entryYear;
          return (
            <Space size="small">
              <Tooltip title="Ver detalle de Póliza de Cierre de Ejercicio">
                <Button
                  type="text"
                  icon={<AuditOutlined className="text-purple-600 hover:text-purple-800 text-base" />}
                  onClick={() => handleOpenCloseModal(closingYear)}
                  size="small"
                />
              </Tooltip>
              <Popconfirm
                title={`¿Revertir Póliza de Cierre ${closingYear}?`}
                description={`Se eliminará la póliza ${cleanRef} y se desbloquearán las cuentas de resultados del ejercicio ${closingYear}.`}
                onConfirm={() => handleRevertClose(closingYear)}
                okText="Sí, revertir cierre"
                cancelText="Cancelar"
                okButtonProps={{ danger: true }}
              >
                <Tooltip title={`Revertir Póliza de Cierre ${closingYear}`}>
                  <Button
                    danger
                    type="link"
                    size="small"
                    icon={<RollbackOutlined />}
                    loading={revertingClose}
                    className="px-1 font-semibold text-xs"
                  >
                    Revertir
                  </Button>
                </Tooltip>
              </Popconfirm>
            </Space>
          );
        }

        if (lockedByClose) {
          return (
            <Space size="small">
              <Tooltip title={`Ejercicio ${entryYear} cerrado: las cuentas de resultados no pueden modificarse a menos que revierta la Póliza de Cierre (CIERRE-${entryYear}).`}>
                <Tag color="gold" className="m-0 cursor-not-allowed">
                  <LockOutlined className="mr-1" /> Cerrado {entryYear}
                </Tag>
              </Tooltip>
            </Space>
          );
        }

        return (
          <Space size="small">
            <Tooltip title="Consultar / Editar póliza">
              <Button 
                type="text" 
                icon={<EditOutlined className="text-blue-600 hover:text-blue-800 text-base" />} 
                onClick={() => handleOpenEditEntry(record)} 
                size="small" 
              />
            </Tooltip>
            <Popconfirm 
              title="¿Eliminar póliza?" 
              description="Esta acción eliminará la póliza y sus asientos contables."
              onConfirm={() => handleDelete(record.id)}
              okText="Sí, eliminar"
              cancelText="Cancelar"
            >
              <Button danger type="text" icon={<DeleteOutlined className="text-base" />} size="small" />
            </Popconfirm>
          </Space>
        );
      }
    }
  ];

  const closedYearsList = Object.keys(closedYearsMap).map(Number).sort((a, b) => b - a);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 m-0">Pólizas Contables</h1>
          {clientInfo && (
            <p className="text-gray-500 m-0 text-sm">
              Empresa: <span className="font-semibold text-gray-700">{clientInfo.business_name}</span> ({clientInfo.rfc})
            </p>
          )}
        </div>
        <Space wrap>
          <Button
            icon={<AuditOutlined />}
            onClick={() => handleOpenCloseModal()}
            size="middle"
            className="border-purple-600 text-purple-700 hover:border-purple-700 hover:text-purple-800 font-semibold bg-purple-50/60"
          >
            Póliza de Cierre de Ejercicio
          </Button>
          <Button 
            type="primary" 
            icon={<PlusOutlined />} 
            onClick={handleOpenNewEntry}
            size="middle"
          >
            Nueva Póliza
          </Button>
        </Space>
      </div>

      {error && <Alert message={error} type="error" className="mb-4" showIcon />}

      {/* Banner de Ejercicios Cerrados */}
      {closedYearsList.length > 0 && (
        <Alert
          type="warning"
          showIcon
          icon={<LockOutlined />}
          className="mb-4 border-purple-200 bg-purple-50/70"
          message={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong className="text-purple-900">
                  Ejercicio(s) Fiscal(es) Cerrado(s): {closedYearsList.join(', ')}
                </strong>{' '}
                — Las cuentas de resultados (Ingresos, Costos y Gastos 4xx–7xx) de {closedYearsList.length === 1 ? 'ese ejercicio' : 'esos ejercicios'} se encuentran canceladas y bloqueadas contra modificaciones.
              </span>
              <Space size="small">
                {closedYearsList.map(y => (
                  <Button
                    key={y}
                    size="small"
                    onClick={() => handleOpenCloseModal(y)}
                    icon={<UnlockOutlined />}
                    className="border-purple-400 text-purple-800 text-xs font-medium"
                  >
                    Ver / Revertir Cierre {y}
                  </Button>
                ))}
              </Space>
            </div>
          }
        />
      )}

      {/* Filtros */}
      <Card size="small" className="mb-4 shadow-sm bg-white">
        <Row gutter={[16, 12]} align="middle">
          <Col xs={24} md={8}>
            <RangePicker 
              className="w-full" 
              onChange={setDateRange} 
              format="DD/MM/YYYY"
              placeholder={['Fecha inicial', 'Fecha final']}
            />
          </Col>
          <Col xs={12} md={4}>
            <Select value={typeFilter} onChange={setTypeFilter} className="w-full">
              <Option value="todas">Todos los tipos</Option>
              <Option value="ingreso">Ingresos</Option>
              <Option value="egreso">Egresos</Option>
              <Option value="diario">Diario</Option>
            </Select>
          </Col>
          <Col xs={24} md={12}>
            <Input.Search 
              placeholder="Buscar por concepto, referencia, CFDI o número de póliza..." 
              allowClear 
              onSearch={setSearchText} 
              onChange={e => setSearchText(e.target.value)} 
              className="w-full" 
            />
          </Col>
        </Row>
      </Card>

      {/* Tabla de Pólizas */}
      <Card size="small" className="shadow-sm bg-white overflow-hidden p-0">
        <Table 
          columns={columns} 
          dataSource={sortedEntries} 
          rowKey="id"
          loading={loading}
          rowClassName={(record) =>
            record.id === highlightedEntryId
              ? 'bg-blue-50/80 ring-1 ring-blue-300'
              : ''
          }
          onRow={(record) => ({
            onDoubleClick: () => {
              const cleanRef = String(record.reference || '').trim().toUpperCase();
              const entryYear = dayjs(record.date).year();
              if (cleanRef.startsWith('CIERRE-')) {
                const closingYear = parseInt(cleanRef.replace('CIERRE-', ''), 10) || entryYear;
                handleOpenCloseModal(closingYear);
                return;
              }
              const isYearClosed = Boolean(closedYearsMap[entryYear]);
              const hasResultado = Boolean(
                record.has_resultado_accounts ||
                (record.lines || []).some(l => isResultadoAccountNumber(l.account_number))
              );
              if (isYearClosed && hasResultado) {
                message.warning(
                  `El ejercicio ${entryYear} ya cuenta con Póliza de Cierre (CIERRE-${entryYear}). No se permiten modificaciones a pólizas con cuentas de resultados de ese ejercicio a menos que revierta primero la póliza de cierre.`
                );
                return;
              }
              handleOpenEditEntry(record);
            },
            style: { cursor: 'pointer' },
            title: 'Haga doble clic para consultar o editar esta póliza'
          })}
          pagination={{ 
            defaultPageSize: 20, 
            pageSizeOptions: ['10', '20', '50', '100'],
            showSizeChanger: true,
            showTotal: (total, range) => `${range[0]}-${range[1]} de ${total} pólizas`
          }}
          expandable={{
            expandedRowKeys,
            onExpandedRowsChange: setExpandedRowKeys,
            expandedRowRender: record => (
              <div className="bg-gray-50 p-3 rounded">
                <p className="font-semibold text-xs text-gray-600 mb-2 uppercase tracking-wide">
                  Movimientos Contables de la Póliza {record.entry_number} ({record.entry_type?.toUpperCase()})
                </p>
                <Table 
                  dataSource={record.lines} 
                  pagination={false} 
                  rowKey="id"
                  size="small"
                  bordered
                  columns={[
                    { 
                      title: 'Cuenta Contable', 
                      dataIndex: 'account_id', 
                      render: (id, row) => {
                        const acc = accounts.find(a => a.id === id);
                        return (
                          <span className="font-mono text-xs">
                            {row.account_number || acc?.account_number || id} - {row.account_name || acc?.name}
                          </span>
                        );
                      }
                    },
                    { 
                      title: 'Concepto / Referencia', 
                      dataIndex: 'description', 
                      render: (v) => v || record.description || '-' 
                    },
                    { 
                      title: 'Debe', 
                      dataIndex: 'debit', 
                      align: 'right',
                      width: 140,
                      render: v => <span className="font-mono">{formatMoney(v)}</span> 
                    },
                    { 
                      title: 'Haber', 
                      dataIndex: 'credit', 
                      align: 'right',
                      width: 140,
                      render: v => <span className="font-mono">{formatMoney(v)}</span> 
                    },
                  ]}
                />
              </div>
            )
          }}
        />
      </Card>

      {/* VENTANA DE CAPTURA AL CENTRO DEL MONITOR (MODAL CENTRADO) */}
      <Modal
        title={
          <div className="flex items-center gap-2 border-b pb-3 mb-2">
            <FileTextOutlined className="text-blue-600 text-xl" />
            <div>
              <span className="font-bold text-lg text-gray-800">
                {editingEntry ? `Consultar / Editar Póliza Contable ${editingEntry.entry_number || ''}` : 'Captura de Póliza Contable'}
              </span>
              <p className="text-xs text-gray-500 m-0 font-normal">
                {editingEntry 
                  ? 'Consulte o modifique los datos generales y asientos contables de la póliza.' 
                  : 'Capture los datos generales y los movimientos con validación estricta de partida doble.'}
              </p>
            </div>
          </div>
        }
        open={isModalVisible}
        onCancel={() => {
          setIsModalVisible(false);
          if (searchParams.get('entryId')) {
            setSearchParams({}, { replace: true });
          }
        }}
        width={1000}
        centered
        forceRender
        destroyOnClose
        maskClosable={false}
        footer={[
          editingEntry?.id && (
            <Button
              key="print_view"
              icon={<PrinterOutlined />}
              onClick={() => window.open(`/journal-viewer/${editingEntry.id}`, '_blank', 'noopener,noreferrer')}
            >
              Ver / Imprimir Póliza
            </Button>
          ),
          <Button
            key="cancel"
            onClick={() => {
              setIsModalVisible(false);
              if (searchParams.get('entryId')) {
                setSearchParams({}, { replace: true });
              }
            }}
          >
            Cancelar
          </Button>,
          <Button key="save" type="primary" onClick={onSaveEntry} loading={loading}>
            {editingEntry ? 'Actualizar Póliza' : 'Guardar Póliza'}
          </Button>
        ].filter(Boolean)}
      >
        <Form form={form} layout="vertical">
          {isSelectedFormYearClosed && (
            <Alert
              type="warning"
              showIcon
              icon={<LockOutlined />}
              className="mb-3 text-xs border-amber-300 bg-amber-50"
              message={
                <span>
                  <strong>Ejercicio {dayjs(watchedFormDate).year()} cerrado:</strong> Las cuentas de resultados (Ingresos, Costos y Gastos <code>4xx–7xx</code>) se encuentran canceladas y bloqueadas para este ejercicio. Para registrar o modificar movimientos en cuentas de resultados de {dayjs(watchedFormDate).year()}, primero revierta la Póliza de Cierre (<code>CIERRE-{dayjs(watchedFormDate).year()}</code>).
                </span>
              }
            />
          )}
          {/* Fila 1: Tipo, Número de Póliza Consecutivo Automático y Fecha */}
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item 
                name="entry_type" 
                label={<span className="font-semibold text-gray-700">Tipo de Póliza</span>} 
                rules={[{ required: true, message: 'Seleccione el tipo' }]}
              >
                <Select onChange={handleTypeChange} size="middle">
                  <Option value="ingreso">
                    <Tag color="green" className="m-0 font-medium">Ingreso</Tag>
                  </Option>
                  <Option value="egreso">
                    <Tag color="red" className="m-0 font-medium">Egreso</Tag>
                  </Option>
                  <Option value="diario">
                    <Tag color="blue" className="m-0 font-medium">Diario</Tag>
                  </Option>
                </Select>
              </Form.Item>
            </Col>

            <Col xs={24} md={8}>
              <Form.Item 
                name="entry_number" 
                label={
                  <div className="flex items-center justify-between w-full">
                    <span className="font-semibold text-gray-700">Número de Póliza</span>
                    {!editingEntry && (
                      <Tag color={isManualNumber ? "orange" : "blue"} className="ml-2 font-normal">
                        {isManualNumber ? "Folio Manual" : "Consecutivo Automático"}
                      </Tag>
                    )}
                  </div>
                }
                rules={[{ required: true, message: 'El número de póliza es requerido' }]}
                extra={
                  !editingEntry && (
                    <div className="flex items-center justify-between mt-1 text-xs">
                      <span className="text-gray-500 font-medium">
                        {isManualNumber 
                          ? "Modo manual activo" 
                          : `Siguiente consecutivo para ${currentEntryType?.toUpperCase()}`}
                      </span>
                      <Button 
                        type="link" 
                        size="small" 
                        className="p-0 text-xs h-auto text-blue-600 hover:text-blue-800"
                        onClick={() => {
                          if (isManualNumber) {
                            setIsManualNumber(false);
                            const curType = form.getFieldValue('entry_type') || 'diario';
                            form.setFieldsValue({ entry_number: nextNumbers[curType] || 1 });
                          } else {
                            setIsManualNumber(true);
                          }
                        }}
                      >
                        {isManualNumber ? "Usar consecutivo automático" : "Personalizar folio"}
                      </Button>
                    </div>
                  )
                }
              >
                <InputNumber 
                  min={1} 
                  className={`w-full ${!editingEntry && !isManualNumber ? 'bg-blue-50/50 font-bold text-blue-800 border-blue-200' : ''}`}
                  disabled={!editingEntry && !isManualNumber}
                  placeholder="Automático" 
                  size="middle"
                />
              </Form.Item>
            </Col>

            <Col xs={24} md={8}>
              <Form.Item 
                name="date" 
                label={<span className="font-semibold text-gray-700">Fecha</span>} 
                rules={[{ required: true, message: 'Seleccione la fecha' }]}
              >
                <DatePicker 
                  className="w-full" 
                  format="DD/MM/YYYY" 
                  size="middle"
                  onChange={handleDateChange}
                />
              </Form.Item>
            </Col>
          </Row>

          {/* Fila 2: Concepto General, Referencia General y CFDI */}
          <Row gutter={16}>
            <Col xs={24} md={10}>
              <Form.Item 
                name="description" 
                label={<span className="font-medium text-gray-700">Concepto General</span>} 
                rules={[{ required: true, message: 'Ingrese el concepto general' }]}
              >
                <Input placeholder="Ej. Pago de factura de servicios de internet mensual" />
              </Form.Item>
            </Col>

            <Col xs={24} md={7}>
              <Form.Item 
                name="reference" 
                label={<span className="font-medium text-gray-700">Referencia General</span>}
                extra="Cheque, factura, transferencia..."
              >
                <Input placeholder="Ej. TR-98432 o CHQ-402" />
              </Form.Item>
            </Col>

            <Col xs={24} md={7}>
              <Form.Item 
                name="cfdi_uuid" 
                label={
                  <div className="flex items-center justify-between w-full">
                    <span className="font-medium text-gray-700">CFDI / Folio Fiscal</span>
                    {editingEntry?.cfdi_uuid && (
                      <a
                        href={`/cfdi-viewer/${editingEntry.cfdi_uuid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:text-blue-800 font-normal flex items-center gap-1 ml-2"
                      >
                        <FileSearchOutlined /> Ver CFDI XML
                      </a>
                    )}
                  </div>
                }
                extra="UUID del CFDI vinculado"
              >
                <Input placeholder="Ej. 4A8C4301-B2C1-..." />
              </Form.Item>
            </Col>
          </Row>

          {/* Sección de Movimientos Contables */}
          <div className="mt-2 mb-2">
            <div className="flex justify-between items-center mb-2">
              <span className="font-bold text-gray-700 text-sm">
                Movimientos de la Póliza (Cuentas Afectables)
              </span>
            </div>

            {/* Encabezado de columnas de movimientos */}
            <Row gutter={8} className="px-2 py-1.5 mb-1.5 text-xs font-semibold text-gray-700 bg-gray-100 rounded border border-gray-200">
              <Col span={9}>Cuenta Contable</Col>
              <Col span={7}>Concepto del Movimiento</Col>
              <Col span={3} className="text-right pr-2">Cargo (Debe)</Col>
              <Col span={3} className="text-right pr-2">Abono (Haber)</Col>
              <Col span={2} className="text-center">Acción</Col>
            </Row>

            <Form.List name="lines">
              {(fields, { add, remove }) => (
                <>
                  <div className="max-h-[320px] overflow-y-auto pr-1">
                    {fields.map(({ key, name, ...restField }, idx) => (
                      <Row key={key} gutter={8} align="middle" className="mb-2 bg-gray-50/80 p-2 rounded border border-gray-100">
                        <Col span={9}>
                          <Form.Item 
                            {...restField} 
                            name={[name, 'account_id']} 
                            rules={[
                              { required: true, message: 'Seleccione cuenta afectable' },
                              {
                                validator: (_, val) => {
                                  if (!val) return Promise.resolve();
                                  const acc = accounts.find(a => a.id === val);
                                  if (acc && acc.classification !== 'Afectable') {
                                    return Promise.reject(new Error('Solo se permiten cuentas Afectables'));
                                  }
                                  return Promise.resolve();
                                }
                              }
                            ]}
                            className="m-0"
                          >
                            <Select 
                              showSearch 
                              placeholder="Seleccionar cuenta afectable (3-2-3)..." 
                              filterOption={filterAccountOption}
                              options={accountOptions}
                              size="middle"
                              onSearch={(text) => setSearchInputs(prev => ({ ...prev, [name]: text }))}
                              onInputKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const typed = (searchInputs[name] || '').trim();
                                  if (typed) {
                                    const cleanTyped = typed.replace(/[-\s]/g, '').toLowerCase();
                                    const formatted = formatAccountNumber(typed);
                                    const match = accounts.find(a => {
                                      const cleanNum = (a.account_number || '').replace(/[-\s]/g, '').toLowerCase();
                                      return cleanNum === cleanTyped || a.account_number === typed || a.account_number === formatted;
                                    });

                                    if (!match) {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      promptAddAccount(typed, name);
                                    } else if (match.classification !== 'Afectable') {
                                      e.preventDefault();
                                      message.warning(`La cuenta ${match.account_number} es de Acumulación y no puede recibir pólizas. Solo se pueden seleccionar cuentas Afectables.`);
                                    }
                                  }
                                }
                              }}
                              notFoundContent={
                                <div className="p-3 text-center">
                                  <div className="text-gray-700 font-medium mb-1">
                                    Cuenta inexistente
                                  </div>
                                  <div className="text-xs text-gray-500 mb-2 font-mono">
                                    {searchInputs[name] ? `"${searchInputs[name]}" no existe en el catálogo` : 'No hay cuentas afectables que coincidan'}
                                  </div>
                                  {searchInputs[name] && (
                                    <Button 
                                      type="primary" 
                                      size="small" 
                                      icon={<PlusOutlined />}
                                      onClick={() => promptAddAccount(searchInputs[name], name)}
                                    >
                                      ¿Desea agregar cuenta?
                                    </Button>
                                  )}
                                </div>
                              }
                            />
                          </Form.Item>
                        </Col>

                        <Col span={7}>
                          <Form.Item 
                            {...restField} 
                            name={[name, 'description']} 
                            className="m-0"
                          >
                            <Input placeholder={`Concepto movimiento ${idx + 1}`} size="middle" />
                          </Form.Item>
                        </Col>

                        <Col span={3}>
                          <Form.Item
                            noStyle
                            shouldUpdate={(prevValues, currentValues) => {
                              const prevC = prevValues?.lines?.[name]?.credit;
                              const currC = currentValues?.lines?.[name]?.credit;
                              const prevD = prevValues?.lines?.[name]?.debit;
                              const currD = currentValues?.lines?.[name]?.debit;
                              return prevC !== currC || prevD !== currD;
                            }}
                          >
                            {({ getFieldValue }) => {
                              const creditVal = Number(getFieldValue(['lines', name, 'credit'])) || 0;
                              const hasCredit = creditVal > 0;
                              return (
                                <Tooltip title={hasCredit ? "Inválido: el movimiento ya tiene un Abono capturado" : ""}>
                                  <Form.Item 
                                    {...restField} 
                                    name={[name, 'debit']} 
                                    initialValue={0}
                                    className="m-0"
                                    rules={[
                                      {
                                        validator: async (_, value) => {
                                          const cVal = Number(form.getFieldValue(['lines', name, 'credit'])) || 0;
                                          const dVal = Number(value) || 0;
                                          if (dVal > 0 && cVal > 0) {
                                            return Promise.reject(new Error('Solo Cargo o Abono'));
                                          }
                                          return Promise.resolve();
                                        }
                                      }
                                    ]}
                                  >
                                    <InputNumber 
                                      min={0} 
                                      precision={2} 
                                      className={`w-full ${hasCredit ? 'bg-gray-100 opacity-60 cursor-not-allowed' : ''}`} 
                                      placeholder="0.00" 
                                      size="middle" 
                                      disabled={hasCredit}
                                      onChange={(val) => {
                                        const num = Number(val) || 0;
                                        if (num > 0) {
                                          const lines = form.getFieldValue('lines') || [];
                                          if (lines[name] && (Number(lines[name].credit) || 0) > 0) {
                                            lines[name].credit = 0;
                                            form.setFieldsValue({ lines: [...lines] });
                                          }
                                        }
                                      }}
                                    />
                                  </Form.Item>
                                </Tooltip>
                              );
                            }}
                          </Form.Item>
                        </Col>

                        <Col span={3}>
                          <Form.Item
                            noStyle
                            shouldUpdate={(prevValues, currentValues) => {
                              const prevC = prevValues?.lines?.[name]?.credit;
                              const currC = currentValues?.lines?.[name]?.credit;
                              const prevD = prevValues?.lines?.[name]?.debit;
                              const currD = currentValues?.lines?.[name]?.debit;
                              return prevC !== currC || prevD !== currD;
                            }}
                          >
                            {({ getFieldValue }) => {
                              const debitVal = Number(getFieldValue(['lines', name, 'debit'])) || 0;
                              const hasDebit = debitVal > 0;
                              return (
                                <Tooltip title={hasDebit ? "Inválido: el movimiento ya tiene un Cargo capturado" : ""}>
                                  <Form.Item 
                                    {...restField} 
                                    name={[name, 'credit']} 
                                    initialValue={0}
                                    className="m-0"
                                    rules={[
                                      {
                                        validator: async (_, value) => {
                                          const dVal = Number(form.getFieldValue(['lines', name, 'debit'])) || 0;
                                          const cVal = Number(value) || 0;
                                          if (cVal > 0 && dVal > 0) {
                                            return Promise.reject(new Error('Solo Cargo o Abono'));
                                          }
                                          return Promise.resolve();
                                        }
                                      }
                                    ]}
                                  >
                                    <InputNumber 
                                      min={0} 
                                      precision={2} 
                                      className={`w-full ${hasDebit ? 'bg-gray-100 opacity-60 cursor-not-allowed' : ''}`} 
                                      placeholder="0.00" 
                                      size="middle" 
                                      disabled={hasDebit}
                                      onChange={(val) => {
                                        const num = Number(val) || 0;
                                        if (num > 0) {
                                          const lines = form.getFieldValue('lines') || [];
                                          if (lines[name] && (Number(lines[name].debit) || 0) > 0) {
                                            lines[name].debit = 0;
                                            form.setFieldsValue({ lines: [...lines] });
                                          }
                                        }
                                      }}
                                    />
                                  </Form.Item>
                                </Tooltip>
                              );
                            }}
                          </Form.Item>
                        </Col>

                        <Col span={2} className="text-center">
                          <Tooltip title="Borrar movimiento">
                            <Button 
                              type="text" 
                              danger 
                              icon={<DeleteOutlined className="text-base text-red-500 hover:text-red-700" />} 
                              onClick={() => remove(name)} 
                              disabled={fields.length <= 1}
                            />
                          </Tooltip>
                        </Col>
                      </Row>
                    ))}
                  </div>

                  <Button 
                    type="dashed" 
                    onClick={() => add({ account_id: undefined, description: '', debit: 0, credit: 0 })} 
                    block 
                    icon={<PlusOutlined />}
                    className="mt-2"
                  >
                    Agregar Línea de Movimiento
                  </Button>
                </>
              )}
            </Form.List>
          </div>

          {/* Panel de Comprobación y Cuadre de Partida Doble */}
          <Form.Item shouldUpdate className="m-0 mt-4">
            {() => {
              const lines = form.getFieldValue('lines') || [];
              const totalD = lines.reduce((acc, l) => acc + (Number(l?.debit) || 0), 0);
              const totalH = lines.reduce((acc, l) => acc + (Number(l?.credit) || 0), 0);
              const diff = Math.round(Math.abs(totalD - totalH) * 100) / 100;
              const isCuadrada = diff < 0.01 && totalD > 0;

              return (
                <div className={`p-4 rounded-lg border flex flex-wrap justify-between items-center gap-4 ${
                  isCuadrada 
                    ? 'bg-green-50 border-green-200 text-green-900' 
                    : diff > 0.01 
                      ? 'bg-red-50 border-red-200 text-red-900' 
                      : 'bg-gray-50 border-gray-200'
                }`}>
                  <div className="flex items-center gap-2">
                    {isCuadrada ? (
                      <>
                        <CheckCircleOutlined className="text-green-600 text-xl" />
                        <span className="font-bold text-green-800">Partida Doble Cuadrada</span>
                      </>
                    ) : diff > 0.01 ? (
                      <>
                        <CloseCircleOutlined className="text-red-600 text-xl" />
                        <span className="font-bold text-red-800">
                          Póliza Descuadrada por {formatMoney(diff)}
                        </span>
                      </>
                    ) : (
                      <span className="text-gray-500 font-medium">Capture los importes de los movimientos</span>
                    )}
                  </div>

                  <div className="flex items-center gap-6 text-base">
                    <div>
                      <span className="text-xs text-gray-500 block font-medium">Total Debe</span>
                      <span className="font-bold text-gray-800 text-lg">{formatMoney(totalD)}</span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500 block font-medium">Total Haber</span>
                      <span className="font-bold text-gray-800 text-lg">{formatMoney(totalH)}</span>
                    </div>

                    <div className="pl-3 border-l border-gray-300">
                      <Tooltip 
                        title={
                          isCuadrada 
                            ? "La póliza ya se encuentra cuadrada" 
                            : diff > 0.01
                              ? "Cuadrar la póliza automáticamente asignando la diferencia al movimiento con cuenta contable elegida"
                              : "Capture los importes para cuadrar la póliza"
                        }
                      >
                        <Button
                          type="primary"
                          icon={<CheckCircleOutlined />}
                          disabled={isCuadrada || diff < 0.01}
                          onClick={handleAutoBalance}
                          className={
                            diff > 0.01 
                              ? "bg-blue-600 hover:bg-blue-700 shadow-sm font-semibold h-10 px-4" 
                              : "h-10 px-4"
                          }
                        >
                          Cuadrar Póliza {diff > 0.01 ? `(${formatMoney(diff)})` : ''}
                        </Button>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              );
            }}
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal para Capturar Nueva Cuenta del Catálogo de Cuentas */}
      <Modal
        title={
          <div className="flex items-center justify-between pr-6">
            <span className="font-bold text-gray-800">Capturar Nueva Cuenta del Catálogo de Cuentas</span>
            <a 
              href={`/accounts/${clientId}`} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-normal"
            >
              <ExportOutlined /> Abrir Catálogo Completo
            </a>
          </div>
        }
        open={isAddAccountModalOpen}
        onOk={handleSaveNewAccount}
        onCancel={() => setIsAddAccountModalOpen(false)}
        confirmLoading={savingAccount}
        width={620}
        okText="Guardar y Asignar al Movimiento"
        cancelText="Cancelar"
        destroyOnClose
      >
        <Alert 
          message="La cuenta no existía en el catálogo. Se creará como cuenta Afectable y se asignará automáticamente a este movimiento." 
          type="info" 
          showIcon 
          className="mb-4 text-xs" 
        />
        <Form form={accountForm} layout="vertical">
          <Form.Item name="parent_id" label={<span className="font-semibold text-gray-700">Cuenta de Mayor / Padre (Opcional)</span>}>
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
                  accountForm.setFieldsValue({
                    nature: parent.nature,
                    sat_group_code: parent.sat_group_code
                  });
                }
              }}
            />
          </Form.Item>

          <Row gutter={16}>
            <Col span={14}>
              <Form.Item 
                name="account_number" 
                label={<span className="font-semibold text-gray-700">Número de Cuenta (3-2-3)</span>}
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
                extra="Estructura 3-2-3: XXX (Rubro) - XX (Subcuenta) - XXX (Detalle)"
              >
                <Input 
                  placeholder="Ej. 102-01-002" 
                  onBlur={(e) => {
                    const formatted = formatAccountNumber(e.target.value);
                    accountForm.setFieldsValue({ account_number: formatted });
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item 
                name="classification" 
                label={<span className="font-semibold text-gray-700">Tipo de Cuenta</span>} 
                rules={[{ required: true, message: 'Seleccione la clasificación' }]}
                extra="Debe ser Afectable para recibir pólizas"
              >
                <Select>
                  <Option value="Afectable">
                    <span className="text-green-600 font-semibold">Afectable (Pólizas)</span>
                  </Option>
                  <Option value="Acumulación">
                    <span className="text-blue-600 font-semibold">Acumulación</span>
                  </Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item 
            name="name" 
            label={<span className="font-semibold text-gray-700">Nombre de la Cuenta</span>} 
            rules={[{ required: true, message: 'Ingrese el nombre de la cuenta' }]}
          >
            <Input placeholder="Ej. Banco Santander Cta 1234" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                name="sat_group_code" 
                label={<span className="font-semibold text-gray-700">Código Agrupador SAT</span>} 
                rules={[{ required: true, message: 'Ingrese el código SAT' }]}
              >
                <Input placeholder="Ej. 102.01" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                name="nature" 
                label={<span className="font-semibold text-gray-700">Naturaleza Contable</span>} 
                rules={[{ required: true, message: 'Seleccione la naturaleza' }]}
              >
                <Select>
                  <Option value="deudora">Deudora (Activo / Costos / Gastos)</Option>
                  <Option value="acreedora">Acreedora (Pasivo / Capital / Ingresos)</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Modal de Póliza de Cierre de Ejercicio */}
      <Modal
        title={
          <div className="flex items-center justify-between pr-8 border-b pb-3 mb-2">
            <div className="flex items-center gap-2">
              <AuditOutlined className="text-purple-700 text-xl" />
              <div>
                <span className="font-bold text-lg text-gray-800">
                  Póliza de Cierre de Ejercicio ({closeYear})
                </span>
                <p className="text-xs text-gray-500 m-0 font-normal">
                  Cancelación automática de cuentas de resultados (4xx–7xx) contra Utilidad (304-01-xxx) o Pérdida (304-02-xxx) del ejercicio.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-600">Ejercicio:</span>
              <Select
                value={closeYear}
                onChange={(y) => {
                  setCloseYear(y);
                  fetchYearEndCloseInfo(y);
                }}
                style={{ width: 110 }}
                size="middle"
              >
                {[2022, 2023, 2024, 2025, 2026, 2027].map(y => (
                  <Option key={y} value={y}>
                    {y} {closedYearsMap[y] ? '🔒' : ''}
                  </Option>
                ))}
              </Select>
            </div>
          </div>
        }
        open={closeModalOpen}
        onCancel={() => setCloseModalOpen(false)}
        width={960}
        centered
        footer={[
          <Button key="close" onClick={() => setCloseModalOpen(false)}>
            Cerrar Ventana
          </Button>,
          closeData?.is_closed ? (
            <Popconfirm
              key="revert"
              title={`¿Revertir la Póliza de Cierre del Ejercicio ${closeYear}?`}
              description={`Se eliminará la póliza CIERRE-${closeYear} y se permitirá nuevamente capturar o modificar pólizas en cuentas de resultados de ${closeYear}.`}
              onConfirm={() => handleRevertClose(closeYear)}
              okText="Sí, Revertir Póliza de Cierre"
              cancelText="Cancelar"
              okButtonProps={{ danger: true }}
            >
              <Button
                danger
                type="primary"
                icon={<RollbackOutlined />}
                loading={revertingClose}
              >
                Revertir Póliza de Cierre ({closeYear})
              </Button>
            </Popconfirm>
          ) : (
            <Button
              key="execute"
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={executingClose}
              disabled={closeLoading || !closeData || (closeData?.lines_preview || []).length === 0}
              onClick={handleExecuteClose}
              className="bg-purple-700 hover:bg-purple-800 border-purple-700 font-semibold"
            >
              Generar Póliza de Cierre {closeYear}
            </Button>
          )
        ]}
      >
        {closeLoading ? (
          <div className="py-12 text-center text-gray-500">
            Calculando saldos de cuentas de resultados del ejercicio {closeYear}...
          </div>
        ) : !closeData ? (
          <Alert
            type="error"
            showIcon
            message={`No se pudo obtener la información de cierre para el ejercicio ${closeYear}.`}
          />
        ) : (
          <div>
            {/* Estado del Ejercicio */}
            {closeData.is_closed ? (
              <Alert
                type="success"
                showIcon
                icon={<LockOutlined />}
                className="mb-4 border-purple-300 bg-purple-50"
                message={
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-purple-900">
                        Ejercicio {closeYear} Cerrado (Póliza de Diario #{closeData.closing_entry?.entry_number} - Ref: {closeData.closing_entry?.reference})
                      </span>
                      <div className="text-xs text-purple-800 mt-0.5">
                        Las cuentas de resultados del ejercicio {closeYear} están canceladas en $0.00 y bloqueadas contra cualquier modificación. Si necesita hacer ajustes en {closeYear}, utilice el botón <strong>"Revertir Póliza de Cierre"</strong>.
                      </div>
                    </div>
                    <Tag color="purple" className="font-bold text-xs m-0">
                      CERRADO 31/12/{closeYear}
                    </Tag>
                  </div>
                }
              />
            ) : (
              <Alert
                type="info"
                showIcon
                className="mb-4 text-xs"
                message={
                  <span>
                    Al generar la <strong>Póliza de Cierre del Ejercicio {closeYear}</strong> (con fecha <code>31/12/{closeYear}</code> y referencia <code>CIERRE-{closeYear}</code>), se cancelarán todas las cuentas de resultados (Ingresos, Costos y Gastos <code>4xx–7xx</code>) contra la cuenta afectable automática{' '}
                    <strong>{closeData.result_account?.account_number} - "{closeData.result_account?.name}"</strong> y quedará bloqueada cualquier modificación posterior a las cuentas de resultados de {closeYear}.
                  </span>
                }
              />
            )}

            {/* Tarjetas de Resumen del Resultado y Cuenta Automática */}
            <Row gutter={12} className="mb-4">
              <Col xs={24} md={6}>
                <div className="p-3 rounded border bg-green-50/70 border-green-200">
                  <div className="text-xs text-green-700 font-semibold uppercase">Ingresos Netos (4xx)</div>
                  <div className="text-base font-bold text-green-900 mt-0.5">
                    {formatMoney(closeData.total_ingresos)}
                  </div>
                </div>
              </Col>
              <Col xs={24} md={6}>
                <div className="p-3 rounded border bg-red-50/70 border-red-200">
                  <div className="text-xs text-red-700 font-semibold uppercase">Costos y Gastos (5xx–7xx)</div>
                  <div className="text-base font-bold text-red-900 mt-0.5">
                    {formatMoney(closeData.total_egresos)}
                  </div>
                </div>
              </Col>
              <Col xs={24} md={5}>
                <div className={`p-3 rounded border ${closeData.is_profit ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'}`}>
                  <div className="text-xs font-semibold uppercase text-gray-700">
                    {closeData.is_profit ? `Utilidad ${closeYear}` : `Pérdida ${closeYear}`}
                  </div>
                  <div className={`text-base font-bold mt-0.5 ${closeData.is_profit ? 'text-blue-900' : 'text-amber-900'}`}>
                    {formatMoney(Math.abs(closeData.net_result || 0))}
                  </div>
                </div>
              </Col>
              <Col xs={24} md={7}>
                <div className="p-3 rounded border bg-purple-50 border-purple-200 h-full flex flex-col justify-center">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-purple-800 uppercase">
                      Cuenta Afectable Automática
                    </span>
                    <Tag color={closeData.result_account?.already_exists ? 'geekblue' : 'green'} className="m-0 text-[10px]">
                      {closeData.result_account?.already_exists ? 'Existente en catálogo' : 'Se creará automáticamente'}
                    </Tag>
                  </div>
                  <div className="font-mono font-bold text-xs text-purple-950 mt-1 truncate" title={`${closeData.result_account?.account_number} - ${closeData.result_account?.name}`}>
                    {closeData.result_account?.account_number} - {closeData.result_account?.name}
                  </div>
                </div>
              </Col>
            </Row>

            {/* Tabla de Movimientos de la Póliza de Cierre */}
            {(closeData.lines_preview || []).length === 0 ? (
              <Alert
                type="warning"
                showIcon
                message={`No existen saldos pendientes en cuentas de resultados (4xx–7xx) en el ejercicio ${closeYear} para cancelar.`}
              />
            ) : (
              <Table
                dataSource={closeData.lines_preview || []}
                rowKey={(r, idx) => `${r.account_number}-${idx}`}
                size="small"
                bordered
                pagination={false}
                scroll={{ y: 320 }}
                columns={[
                  {
                    title: 'Cuenta Contable',
                    dataIndex: 'account_number',
                    width: 140,
                    render: (num, row) => (
                      <span className={`font-mono text-xs font-semibold ${row.is_result_capital_line ? 'text-purple-800 font-bold' : 'text-gray-800'}`}>
                        {num}
                      </span>
                    )
                  },
                  {
                    title: 'Nombre de la Cuenta',
                    dataIndex: 'account_name',
                    render: (name, row) => (
                      <div>
                        <span className={row.is_result_capital_line ? 'font-bold text-purple-900' : 'text-gray-800'}>
                          {name}
                        </span>
                        {row.is_result_capital_line && (
                          <Tag color="purple" className="ml-2 text-[10px]">
                            {closeData.is_profit ? '304-01 Utilidad' : '304-02 Pérdida'}
                          </Tag>
                        )}
                      </div>
                    )
                  },
                  {
                    title: 'Concepto del Asiento de Cierre',
                    dataIndex: 'description',
                    render: (desc) => <span className="text-xs text-gray-600">{desc}</span>
                  },
                  {
                    title: 'Cargo (Debe)',
                    dataIndex: 'debit',
                    align: 'right',
                    width: 140,
                    render: (val, row) => (
                      <span className={`font-mono text-xs ${Number(val) > 0 ? (row.is_result_capital_line ? 'font-bold text-purple-900' : 'font-semibold text-gray-900') : 'text-gray-300'}`}>
                        {Number(val) > 0 ? formatMoney(val) : '-'}
                      </span>
                    )
                  },
                  {
                    title: 'Abono (Haber)',
                    dataIndex: 'credit',
                    align: 'right',
                    width: 140,
                    render: (val, row) => (
                      <span className={`font-mono text-xs ${Number(val) > 0 ? (row.is_result_capital_line ? 'font-bold text-purple-900' : 'font-semibold text-gray-900') : 'text-gray-300'}`}>
                        {Number(val) > 0 ? formatMoney(val) : '-'}
                      </span>
                    )
                  }
                ]}
                summary={() => (
                  <Table.Summary fixed>
                    <Table.Summary.Row className="bg-gray-100 font-bold">
                      <Table.Summary.Cell index={0} colSpan={3} align="right">
                        SUMAS IGUALES DE LA PÓLIZA DE CIERRE ({closeYear}):
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={1} align="right">
                        <span className="font-mono text-emerald-800">
                          {formatMoney(closeData.total_debit)}
                        </span>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={2} align="right">
                        <span className="font-mono text-emerald-800">
                          {formatMoney(closeData.total_credit)}
                        </span>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                )}
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default JournalEntries;
