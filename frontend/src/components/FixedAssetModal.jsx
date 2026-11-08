import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal, Input, Select, DatePicker, Checkbox, InputNumber, Button,
  Tooltip, message, Tag, Alert, Space, Spin
} from 'antd';
import {
  PlusOutlined, CheckOutlined, FileTextOutlined, SyncOutlined, EllipsisOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { fiscalApi, accountsApi } from '../api/client';

const { Option } = Select;

export const DEFAULT_INVESTMENT_TYPES = [
  { code: '151-00-000', label: '151-00-000 - Terrenos', sat_rate: 0.0, prefix: '151', max_ded: null },
  { code: '152-00-000', label: '152-00-000 - Edificios', sat_rate: 5.0, prefix: '152', max_ded: null },
  { code: '153-00-000', label: '153-00-000 - Maquinaria y equipo', sat_rate: 10.0, prefix: '153', max_ded: null },
  { code: '154-00-000', label: '154-00-000 - Automóviles, autobuses, camiones de carga, tractocamiones, montacargas y remolques', sat_rate: 25.0, prefix: '154', max_ded: 175000.0 },
  { code: '155-00-000', label: '155-00-000 - Mobiliario y equipo de oficina', sat_rate: 10.0, prefix: '155', max_ded: null },
  { code: '156-00-000', label: '156-00-000 - Equipo de cómputo', sat_rate: 30.0, prefix: '156', max_ded: null },
  { code: '157-00-000', label: '157-00-000 - Equipo de comunicación', sat_rate: 10.0, prefix: '157', max_ded: null },
  { code: '158-00-000', label: '158-00-000 - Activos biológicos, vegetales y semovientes', sat_rate: 25.0, prefix: '158', max_ded: null },
  { code: '159-00-000', label: '159-00-000 - Obras en proceso de activos fijos', sat_rate: 0.0, prefix: '159', max_ded: null },
  { code: '160-00-000', label: '160-00-000 - Otros activos fijos', sat_rate: 10.0, prefix: '160', max_ded: null },
  { code: '161-00-000', label: '161-00-000 - Ferrocarriles', sat_rate: 5.0, prefix: '161', max_ded: null },
  { code: '162-00-000', label: '162-00-000 - Embarcaciones', sat_rate: 6.0, prefix: '162', max_ded: null },
  { code: '163-00-000', label: '163-00-000 - Aviones', sat_rate: 10.0, prefix: '163', max_ded: null },
  { code: '164-00-000', label: '164-00-000 - Troqueles, moldes, matrices y herramental', sat_rate: 35.0, prefix: '164', max_ded: null },
  { code: '165-00-000', label: '165-00-000 - Equipo de comunicaciones telefónicas', sat_rate: 10.0, prefix: '165', max_ded: null },
  { code: '166-00-000', label: '166-00-000 - Equipo de comunicación satelital', sat_rate: 8.0, prefix: '166', max_ded: null },
  { code: '167-00-000', label: '167-00-000 - Equipo de adaptaciones para personas con capacidades diferentes', sat_rate: 100.0, prefix: '167', max_ded: null },
  { code: '168-00-000', label: '168-00-000 - Maquinaria y equipo de generación de energía de fuentes renovables', sat_rate: 100.0, prefix: '168', max_ded: null },
  { code: '169-00-000', label: '169-00-000 - Otra maquinaria y equipo', sat_rate: 10.0, prefix: '169', max_ded: null },
  { code: '170-00-000', label: '170-00-000 - Adaptaciones y mejoras', sat_rate: 5.0, prefix: '170', max_ded: null },
];

export const USO_CFDI_TO_MAYOR_MAP = {
  I01: '152-00-000',
  I02: '155-00-000',
  I03: '154-00-000',
  I04: '156-00-000',
  I05: '164-00-000',
  I06: '165-00-000',
  I07: '166-00-000',
  I08: '153-00-000',
  TERRENOS: '151-00-000',
  ADAPTACIONES: '170-00-000',
  INTANGIBLES: '160-00-000',
};

const FixedAssetModal = ({
  open,
  onCancel,
  onSuccess,
  clientId,
  initialAsset = null,
  cfdiInvoice = null,
  pendingCfdis = [],
}) => {
  const [saving, setSaving] = useState(false);
  const [preparingType, setPreparingType] = useState(false);
  const [accounts, setAccounts] = useState([]);

  // Estado del formulario idéntico a la imagen solicitada
  const [description, setDescription] = useState('');
  const [assetType, setAssetType] = useState('');
  const [acquisitionDate, setAcquisitionDate] = useState(dayjs());
  const [depreciationStartDate, setDepreciationStartDate] = useState(dayjs());
  const [hasDisposal, setHasDisposal] = useState(false);
  const [disposalDate, setDisposalDate] = useState(dayjs());
  const [moi, setMoi] = useState(0.0);
  const [depreciationRate, setDepreciationRate] = useState(0.0);
  const [deductibleMoi, setDeductibleMoi] = useState(0.0);
  const [deductibleDepreciationRate, setDeductibleDepreciationRate] = useState(0.0);
  const [salePrice, setSalePrice] = useState(0.0);

  // Cuentas contables
  const [assetAccountId, setAssetAccountId] = useState(null);
  const [depreciationAccountId, setDepreciationAccountId] = useState(null);
  const [expenseAccountId, setExpenseAccountId] = useState(null);
  const [nonDeductibleAccountId, setNonDeductibleAccountId] = useState(null);

  // CFDI vinculado (cuando se detecta UsoCFDI I01..I08)
  const [activeCfdi, setActiveCfdi] = useState(null);

  // Sub-modal para el botón [...] de creación rápida o selección de subcuenta
  const [quickAccountModal, setQuickAccountModal] = useState(null); // { field: 'activo'|'depreciacion'|'gasto'|'no_deducible', name: '', parentNumber: '' }
  const [creatingSubaccount, setCreatingSubaccount] = useState(false);

  const loadAccounts = async () => {
    if (!clientId) return;
    try {
      const res = await accountsApi.getClientAccounts(clientId, { active_only: false });
      setAccounts(res.data || []);
    } catch (err) {
      console.error('Error loading accounts in FixedAssetModal:', err);
    }
  };

  useEffect(() => {
    if (open && clientId) {
      loadAccounts();
    }
  }, [open, clientId]);

  // Inicializar valores cuando se abre el modal (para edición, desde CFDI detectado, o nuevo)
  useEffect(() => {
    if (!open) return;

    if (initialAsset && initialAsset.id) {
      // Modo Edición
      setActiveCfdi(null);
      setDescription(initialAsset.description || initialAsset.name || '');
      const rawType = initialAsset.asset_type || '156-00-000';
      const resolvedType = USO_CFDI_TO_MAYOR_MAP[rawType] || rawType;
      setAssetType(resolvedType);
      setAcquisitionDate(initialAsset.acquisition_date ? dayjs(initialAsset.acquisition_date) : dayjs());
      setDepreciationStartDate(initialAsset.depreciation_start_date ? dayjs(initialAsset.depreciation_start_date) : dayjs());
      setHasDisposal(Boolean(initialAsset.has_disposal));
      setDisposalDate(initialAsset.disposal_date ? dayjs(initialAsset.disposal_date) : dayjs());
      setMoi(Number(initialAsset.moi || 0));
      setDepreciationRate(Number(initialAsset.depreciation_rate ?? initialAsset.tasa_anual_lisr ?? 0));
      setDeductibleMoi(Number(initialAsset.deductible_moi ?? initialAsset.moi ?? 0));
      setDeductibleDepreciationRate(Number(initialAsset.deductible_depreciation_rate ?? initialAsset.tasa_anual_lisr ?? 0));
      setSalePrice(Number(initialAsset.sale_price || 0));
      setAssetAccountId(initialAsset.asset_account_id || null);
      setDepreciationAccountId(initialAsset.depreciation_account_id || null);
      setExpenseAccountId(initialAsset.expense_account_id || null);
      setNonDeductibleAccountId(initialAsset.non_deductible_account_id || null);
    } else if (cfdiInvoice) {
      // Modo Captura automática desde CFDI con UsoCFDI 'I' (Inversión)
      applyCfdiToForm(cfdiInvoice);
    } else {
      // Modo Nuevo Activo Fijo en blanco
      setActiveCfdi(null);
      setDescription('');
      setAssetType('');
      const today = dayjs();
      setAcquisitionDate(today);
      setDepreciationStartDate(today);
      setHasDisposal(false);
      setDisposalDate(today);
      setMoi(0.0);
      setDepreciationRate(0.0);
      setDeductibleMoi(0.0);
      setDeductibleDepreciationRate(0.0);
      setSalePrice(0.0);
      setAssetAccountId(null);
      setDepreciationAccountId(null);
      setExpenseAccountId(null);
      setNonDeductibleAccountId(null);
    }
  }, [open, initialAsset, cfdiInvoice]);

  const applyCfdiToForm = async (inv) => {
    setActiveCfdi(inv);
    const rawUse = (inv.cfdi_use || 'I04').trim().toUpperCase();
    const matchedType = USO_CFDI_TO_MAYOR_MAP[rawUse] || (
      DEFAULT_INVESTMENT_TYPES.find(t => t.code === rawUse) ? rawUse : '156-00-000'
    );

    const descText = inv.description
      ? `${inv.description} (Fact. ${inv.folio || inv.uuid?.slice(0, 8)})`
      : `Inversión ${rawUse} - ${inv.issuer_name || inv.partner_name || ''} (Fact. ${inv.folio || ''})`;

    const invDate = inv.date ? dayjs(inv.date) : dayjs();
    const invSubtotal = Number(inv.subtotal || inv.total || 0);

    setDescription(descText);
    setAssetType(matchedType);
    setAcquisitionDate(invDate);
    setDepreciationStartDate(invDate);
    setHasDisposal(false);
    setDisposalDate(invDate);
    setMoi(invSubtotal);
    setSalePrice(0.0);

    // Disparar preparación automática de tasas SAT y creación/selección de subcuenta contable
    await handleTypeSelect(matchedType, descText, invSubtotal, true);
  };

  // Al elegir el Tipo de inversión: poner por default las tasas fiscales del SAT y crear/seleccionar subcuenta
  const handleTypeSelect = async (selectedType, customDesc = undefined, customMoi = undefined, autoCreateSub = true) => {
    setAssetType(selectedType);
    const currentDesc = customDesc !== undefined ? customDesc : description;
    const currentMoi = customMoi !== undefined ? customMoi : moi;

    const localCfg = DEFAULT_INVESTMENT_TYPES.find(t => t.code === selectedType);
    if (localCfg) {
      setDepreciationRate(localCfg.sat_rate);
      setDeductibleDepreciationRate(localCfg.sat_rate);
      if (localCfg.max_ded && currentMoi > localCfg.max_ded) {
        setDeductibleMoi(localCfg.max_ded);
      } else {
        setDeductibleMoi(currentMoi);
      }
    }

    if (!clientId) return;
    setPreparingType(true);
    try {
      const res = await fiscalApi.prepareInvestmentType(clientId, {
        asset_type: selectedType,
        description: currentDesc,
        moi: currentMoi,
        create_subaccount: autoCreateSub,
      });
      const info = res.data;
      if (info) {
        setDepreciationRate(info.depreciation_rate);
        setDeductibleDepreciationRate(info.deductible_depreciation_rate);
        setDeductibleMoi(info.deductible_moi);

        await loadAccounts();

        if (info.accounts?.asset_account?.id) {
          setAssetAccountId(info.accounts.asset_account.id);
        }
        if (info.accounts?.depreciation_account?.id) {
          setDepreciationAccountId(info.accounts.depreciation_account.id);
        }
        if (info.accounts?.expense_account?.id) {
          setExpenseAccountId(info.accounts.expense_account.id);
        }
        if (info.accounts?.non_deductible_account?.id) {
          setNonDeductibleAccountId(info.accounts.non_deductible_account.id);
        }
      }
    } catch (err) {
      console.error('Error preparing investment type accounts:', err);
    } finally {
      setPreparingType(false);
    }
  };

  // Cuando cambia el MOI, actualizar automáticamente el MOI deducible sugerido (respetando tope LISR si es I03)
  const handleMoiChange = (val) => {
    const numVal = Number(val || 0);
    setMoi(numVal);
    const localCfg = DEFAULT_INVESTMENT_TYPES.find(t => t.code === assetType);
    if (localCfg?.max_ded && numVal > localCfg.max_ded) {
      setDeductibleMoi(localCfg.max_ded);
    } else {
      setDeductibleMoi(numVal);
    }
  };

  // Opciones ordenadas para cada selector de Cuentas
  const buildAccountOptions = (preferredPrefixes = []) => {
    const sorted = [...accounts].sort((a, b) => {
      const aPref = preferredPrefixes.some(p => (a.account_number || '').startsWith(p));
      const bPref = preferredPrefixes.some(p => (b.account_number || '').startsWith(p));
      if (aPref && !bPref) return -1;
      if (!aPref && bPref) return 1;
      return (a.account_number || '').localeCompare(b.account_number || '');
    });

    return sorted.map(acc => ({
      value: acc.id,
      label: `${acc.account_number} - ${acc.name}${acc.level >= 3 ? '' : ' (Mayor)'}`,
    }));
  };

  // Construir catálogo de Tipos basado en las Cuentas de Mayor del Catálogo de Cuentas (151-00-000 a 170-00-000)
  const mayorTypeOptions = useMemo(() => {
    const mayorAccountsMap = new Map();
    accounts.forEach(acc => {
      const num = (acc.account_number || '').trim();
      if (num.endsWith('-00-000')) {
        const prefixNum = parseInt(num.slice(0, 3), 10);
        if (prefixNum >= 151 && prefixNum <= 170) {
          mayorAccountsMap.set(num, acc);
        }
      }
    });

    return DEFAULT_INVESTMENT_TYPES.map(t => {
      const catalogAcc = mayorAccountsMap.get(t.code);
      return {
        ...t,
        label: catalogAcc ? `${catalogAcc.account_number} - ${catalogAcc.name}` : t.label,
      };
    });
  }, [accounts]);

  const selectedTypeObj = useMemo(
    () => mayorTypeOptions.find(t => t.code === assetType) || DEFAULT_INVESTMENT_TYPES.find(t => t.code === assetType),
    [mayorTypeOptions, assetType]
  );

  const assetOptions = useMemo(
    () => buildAccountOptions(selectedTypeObj ? [selectedTypeObj.prefix, '15', '16', '17'] : ['15', '16', '17']),
    [accounts, selectedTypeObj]
  );
  const deprecOptions = useMemo(
    () => buildAccountOptions(['171', '172']),
    [accounts]
  );
  const expenseOptions = useMemo(
    () => buildAccountOptions(['613', '614', '601']),
    [accounts]
  );
  const nonDeductibleOptions = useMemo(
    () => buildAccountOptions(['601-83', '601', '613']),
    [accounts]
  );

  // Botón [...] para crear una nueva subcuenta contable automáticamente o con nombre personalizado
  const handleOpenQuickSubaccount = (field) => {
    let defaultName = description || 'NUEVA SUBCUENTA ACTIVO FIJO';
    if (field === 'depreciacion') defaultName = `DEPRECIACIÓN ACUM. ${description || ''}`.trim();
    if (field === 'gasto') defaultName = `GASTO DEPRECIACIÓN ${description || ''}`.trim();
    if (field === 'no_deducible') defaultName = `DEPRECIACIÓN NO DEDUCIBLE ${description || ''}`.trim();

    setQuickAccountModal({
      field,
      name: defaultName,
    });
  };

  const handleConfirmQuickSubaccount = async () => {
    if (!quickAccountModal || !clientId) return;
    if (!assetType) {
      message.warning('Seleccione primero el Tipo de inversión.');
      return;
    }
    setCreatingSubaccount(true);
    try {
      const res = await fiscalApi.prepareInvestmentType(clientId, {
        asset_type: assetType,
        description: quickAccountModal.name || description,
        moi,
        create_subaccount: true,
      });
      await loadAccounts();
      if (res.data?.accounts?.asset_account?.id && quickAccountModal.field === 'activo') {
        setAssetAccountId(res.data.accounts.asset_account.id);
        message.success(`Subcuenta ${res.data.accounts.asset_account.account_number} asignada.`);
      }
      setQuickAccountModal(null);
    } catch (err) {
      message.error('No se pudo crear la subcuenta.');
    } finally {
      setCreatingSubaccount(false);
    }
  };

  const handleSave = async () => {
    if (!description.trim()) {
      message.warning('Por favor ingrese la Descripción del activo fijo.');
      return;
    }
    if (!assetType) {
      message.warning('Por favor seleccione el Tipo de inversión.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        description: description.trim(),
        asset_type: assetType,
        acquisition_date: acquisitionDate ? acquisitionDate.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        depreciation_start_date: depreciationStartDate ? depreciationStartDate.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        has_disposal: hasDisposal,
        disposal_date: hasDisposal && disposalDate ? disposalDate.format('YYYY-MM-DD') : null,
        moi: Number(moi || 0),
        depreciation_rate: Number(depreciationRate || 0),
        deductible_moi: Number(deductibleMoi || 0),
        deductible_depreciation_rate: Number(deductibleDepreciationRate || 0),
        sale_price: Number(salePrice || 0),
        asset_account_id: assetAccountId,
        depreciation_account_id: depreciationAccountId,
        expense_account_id: expenseAccountId,
        non_deductible_account_id: nonDeductibleAccountId,
        cfdi_invoice_id: activeCfdi?.id || initialAsset?.cfdi_invoice_id || null,
        cfdi_uuid: activeCfdi?.uuid || initialAsset?.cfdi_uuid || null,
      };

      let saved;
      if (initialAsset && initialAsset.id) {
        const res = await fiscalApi.updateInversion(clientId, initialAsset.id, payload);
        saved = res.data;
        message.success('Activo fijo actualizado correctamente.');
      } else {
        const res = await fiscalApi.createInversion(clientId, payload);
        saved = res.data;
        message.success('Activo fijo registrado y subcuenta contable vinculada.');
      }

      if (onSuccess) {
        onSuccess(saved, activeCfdi);
      }
    } catch (err) {
      console.error('Error saving fixed asset:', err);
      message.error(err?.response?.data?.detail || 'Error al guardar el activo fijo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        title={
          <div className="flex items-center justify-between pr-6">
            <span className="text-base font-bold text-gray-800">
              {initialAsset?.id ? 'Editar Activo Fijo / Inversión' : 'Captura de Inversión / Activo Fijo'}
            </span>
            {activeCfdi && (
              <Tag color="gold" className="font-mono text-xs">
                CFDI Uso: {activeCfdi.cfdi_use} • Folio: {activeCfdi.folio || activeCfdi.uuid?.slice(0, 8)}
              </Tag>
            )}
          </div>
        }
        open={open}
        onCancel={onCancel}
        width={680}
        footer={[
          <Button key="cancel" onClick={onCancel}>
            Cancelar
          </Button>,
          <Button
            key="save"
            type="primary"
            icon={<CheckOutlined />}
            loading={saving}
            onClick={handleSave}
            className="bg-blue-600 font-semibold"
          >
            Guardar Activo Fijo
          </Button>,
        ]}
      >
        <Spin spinning={preparingType} tip="Preparando subcuenta contable y tasas SAT...">
          <div className="bg-[#e8edf5] p-5 rounded-md border border-slate-300 space-y-3 text-xs text-gray-800">
            {/* Banner si se detectó un CFDI con uso Inversión (I) */}
            {(activeCfdi || pendingCfdis.length > 0) && !initialAsset?.id && (
              <div className="bg-amber-50 border border-amber-300 rounded p-2.5 mb-3 text-xs flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong className="text-amber-900 block">
                    🏛️ CFDI con Uso de Inversión ({activeCfdi?.cfdi_use || 'I'}) detectado
                  </strong>
                  {activeCfdi ? (
                    <span className="text-amber-800 text-[11px]">
                      Proveedor: <strong>{activeCfdi.issuer_name || activeCfdi.partner_name}</strong> | Subtotal (MOI): <strong>${Number(activeCfdi.subtotal || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</strong>
                    </span>
                  ) : (
                    <span className="text-amber-800 text-[11px]">
                      Seleccione un CFDI de inversión para precargar sus datos automáticamente:
                    </span>
                  )}
                </div>
                {pendingCfdis.length > 0 && (
                  <Select
                    size="small"
                    placeholder="Elegir CFDI Uso I..."
                    value={activeCfdi?.uuid}
                    onChange={(u) => {
                      const found = pendingCfdis.find(c => c.uuid === u);
                      if (found) applyCfdiToForm(found);
                    }}
                    style={{ minWidth: 220 }}
                  >
                    {pendingCfdis.map(c => (
                      <Option key={c.uuid} value={c.uuid}>
                        [{c.cfdi_use}] {c.folio} - ${(c.subtotal || 0).toLocaleString('es-MX')} ({c.issuer_name?.slice(0, 18)})
                      </Option>
                    ))}
                  </Select>
                )}
              </div>
            )}

            {/* Descripción */}
            <div className="grid grid-cols-12 items-center gap-2">
              <label className="col-span-3 font-medium text-gray-800">Descripción</label>
              <div className="col-span-9">
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ej. LAPTOP DELL LATITUDE / AUTOMÓVIL NISSAN VERSA..."
                  size="small"
                  className="bg-white"
                />
              </div>
            </div>

            {/* Tipo (Cuentas de Mayor de Activo Fijo 151-00-000 a 170-00-000) */}
            <div className="grid grid-cols-12 items-center gap-2">
              <label className="col-span-3 font-medium text-gray-800">Tipo</label>
              <div className="col-span-9">
                <Select
                  showSearch
                  value={assetType || undefined}
                  onChange={(val) => handleTypeSelect(val, undefined, undefined, true)}
                  placeholder="Seleccione la cuenta de mayor de activo fijo (151-00-000 a 170-00-000)..."
                  size="small"
                  className="w-full bg-white"
                  filterOption={(input, option) =>
                    (option?.children ?? '').toString().toLowerCase().includes(input.toLowerCase())
                  }
                >
                  {mayorTypeOptions.map((t) => (
                    <Option key={t.code} value={t.code}>
                      {t.label} ({t.sat_rate}% SAT)
                    </Option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Fecha de adquisición */}
            <div className="grid grid-cols-12 items-center gap-2 pt-1">
              <label className="col-span-5 font-medium text-gray-800">Fecha de adquisición</label>
              <div className="col-span-5">
                <DatePicker
                  value={acquisitionDate}
                  onChange={(d) => {
                    setAcquisitionDate(d);
                    if (d && (!depreciationStartDate || depreciationStartDate.isBefore(d))) {
                      setDepreciationStartDate(d);
                    }
                  }}
                  format="DD/MM/YYYY"
                  size="small"
                  allowClear={false}
                  className="w-full bg-white"
                />
              </div>
            </div>

            {/* Fecha de inicio de la depreciación */}
            <div className="grid grid-cols-12 items-center gap-2">
              <label className="col-span-5 font-medium text-gray-800">Fecha de inicio de la depreciación</label>
              <div className="col-span-5">
                <DatePicker
                  value={depreciationStartDate}
                  onChange={(d) => setDepreciationStartDate(d)}
                  format="DD/MM/YYYY"
                  size="small"
                  allowClear={false}
                  className="w-full bg-white"
                />
              </div>
            </div>

            {/* Fecha de baja (con checkbox integrado como en la imagen) */}
            <div className="grid grid-cols-12 items-center gap-2">
              <label className="col-span-5 font-medium text-gray-800">Fecha de baja</label>
              <div className="col-span-5 flex items-center gap-1.5 bg-white px-2 py-0.5 rounded border border-gray-300">
                <Checkbox
                  checked={hasDisposal}
                  onChange={(e) => setHasDisposal(e.target.checked)}
                />
                <DatePicker
                  value={disposalDate}
                  onChange={(d) => setDisposalDate(d)}
                  format="DD/MM/YYYY"
                  size="small"
                  disabled={!hasDisposal}
                  allowClear={false}
                  variant="borderless"
                  className="w-full p-0"
                />
              </div>
            </div>

            {/* MOI */}
            <div className="grid grid-cols-12 items-center gap-2 pt-1">
              <label className="col-span-5 font-medium text-gray-800">MOI</label>
              <div className="col-span-4">
                <InputNumber
                  value={moi}
                  onChange={handleMoiChange}
                  min={0}
                  step={100}
                  precision={2}
                  size="small"
                  className="w-full bg-white text-right"
                  formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(v) => v.replace(/\$\s?|(,*)/g, '')}
                />
              </div>
            </div>

            {/* Porcentaje de depreciación */}
            <div className="grid grid-cols-12 items-center gap-2">
              <label className="col-span-5 font-medium text-gray-800">Porcentaje de depreciación</label>
              <div className="col-span-4">
                <InputNumber
                  value={depreciationRate}
                  onChange={(v) => setDepreciationRate(Number(v || 0))}
                  min={0}
                  max={100}
                  step={1}
                  precision={2}
                  size="small"
                  className="w-full bg-white text-right"
                />
              </div>
              <div className="col-span-3 text-[11px] text-gray-500">% anual (editable)</div>
            </div>

            {/* MOI deducible */}
            <div className="grid grid-cols-12 items-center gap-2">
              <label className="col-span-5 font-medium text-gray-800">MOI deducible</label>
              <div className="col-span-4">
                <InputNumber
                  value={deductibleMoi}
                  onChange={(v) => setDeductibleMoi(Number(v || 0))}
                  min={0}
                  step={100}
                  precision={2}
                  size="small"
                  className="w-full bg-white text-right"
                  formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(v) => v.replace(/\$\s?|(,*)/g, '')}
                />
              </div>
              {(assetType === '154-00-000' || assetType === 'I03') && moi > 175000 && (
                <div className="col-span-3 text-[10px] text-amber-700 leading-tight">
                  Tope Art. 36 LISR ($175,000), modificable
                </div>
              )}
            </div>

            {/* Porcentaje de depreciación deducible */}
            <div className="grid grid-cols-12 items-center gap-2">
              <label className="col-span-5 font-medium text-gray-800">Porcentaje de depreciación deducible</label>
              <div className="col-span-4">
                <InputNumber
                  value={deductibleDepreciationRate}
                  onChange={(v) => setDeductibleDepreciationRate(Number(v || 0))}
                  min={0}
                  max={100}
                  step={1}
                  precision={2}
                  size="small"
                  className="w-full bg-white text-right"
                />
              </div>
              <div className="col-span-3 text-[11px] text-blue-700 font-medium">Tasa SAT (editable)</div>
            </div>

            {/* Precio de venta */}
            <div className="grid grid-cols-12 items-center gap-2">
              <label className="col-span-5 font-medium text-gray-800">Precio de venta</label>
              <div className="col-span-4">
                <InputNumber
                  value={salePrice}
                  onChange={(v) => setSalePrice(Number(v || 0))}
                  min={0}
                  step={100}
                  precision={2}
                  size="small"
                  className="w-full bg-white text-right"
                  formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(v) => v.replace(/\$\s?|(,*)/g, '')}
                />
              </div>
            </div>

            {/* Sección Cuentas */}
            <div className="pt-2 border-t border-slate-300">
              <div className="font-semibold text-gray-800 mb-2">Cuentas</div>

              {/* Activo */}
              <div className="grid grid-cols-12 items-center gap-2 mb-2">
                <label className="col-span-3 pl-2 text-gray-800">Activo</label>
                <div className="col-span-8">
                  <Select
                    showSearch
                    value={assetAccountId}
                    onChange={setAssetAccountId}
                    options={assetOptions}
                    placeholder="Subcuenta de Activo Fijo (se crea o elige aquí)..."
                    size="small"
                    className="w-full bg-white"
                    filterOption={(input, option) =>
                      (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                  />
                </div>
                <div className="col-span-1">
                  <Tooltip title="Crear nueva subcuenta automática o personalizada">
                    <Button
                      size="small"
                      className="w-full px-0 bg-gray-100 border-gray-300 font-bold"
                      onClick={() => handleOpenQuickSubaccount('activo')}
                    >
                      ...
                    </Button>
                  </Tooltip>
                </div>
              </div>

              {/* Depreciacion */}
              <div className="grid grid-cols-12 items-center gap-2 mb-2">
                <label className="col-span-3 pl-2 text-gray-800">Depreciacion</label>
                <div className="col-span-8">
                  <Select
                    showSearch
                    value={depreciationAccountId}
                    onChange={setDepreciationAccountId}
                    options={deprecOptions}
                    placeholder="Cuenta de Depreciación Acumulada (171)..."
                    size="small"
                    className="w-full bg-white"
                    filterOption={(input, option) =>
                      (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                  />
                </div>
                <div className="col-span-1">
                  <Tooltip title="Actualizar o elegir cuenta de depreciación">
                    <Button
                      size="small"
                      className="w-full px-0 bg-gray-100 border-gray-300 font-bold"
                      onClick={() => handleTypeSelect(assetType || 'I04', description, moi, false)}
                    >
                      ...
                    </Button>
                  </Tooltip>
                </div>
              </div>

              {/* Gasto */}
              <div className="grid grid-cols-12 items-center gap-2 mb-2">
                <label className="col-span-3 pl-2 text-gray-800">Gasto</label>
                <div className="col-span-8">
                  <Select
                    showSearch
                    value={expenseAccountId}
                    onChange={setExpenseAccountId}
                    options={expenseOptions}
                    placeholder="Cuenta de Gasto por Depreciación (613)..."
                    size="small"
                    className="w-full bg-white"
                    filterOption={(input, option) =>
                      (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                  />
                </div>
                <div className="col-span-1">
                  <Tooltip title="Actualizar o elegir cuenta de gasto">
                    <Button
                      size="small"
                      className="w-full px-0 bg-gray-100 border-gray-300 font-bold"
                      onClick={() => handleTypeSelect(assetType || 'I04', description, moi, false)}
                    >
                      ...
                    </Button>
                  </Tooltip>
                </div>
              </div>

              {/* No deducible */}
              <div className="grid grid-cols-12 items-center gap-2">
                <label className="col-span-3 pl-2 text-gray-800">No deducible</label>
                <div className="col-span-8">
                  <Select
                    showSearch
                    value={nonDeductibleAccountId}
                    onChange={setNonDeductibleAccountId}
                    options={nonDeductibleOptions}
                    placeholder="Cuenta de Gastos No Deducibles (601-83)..."
                    size="small"
                    className="w-full bg-white"
                    filterOption={(input, option) =>
                      (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                  />
                </div>
                <div className="col-span-1">
                  <Tooltip title="Actualizar o elegir cuenta no deducible">
                    <Button
                      size="small"
                      className="w-full px-0 bg-gray-100 border-gray-300 font-bold"
                      onClick={() => handleTypeSelect(assetType || 'I04', description, moi, false)}
                    >
                      ...
                    </Button>
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>
        </Spin>
      </Modal>

      {/* Mini-modal al pulsar [...] en Activo para crear una nueva subcuenta con nombre específico */}
      <Modal
        title="Crear Nueva Subcuenta Contable de Activo Fijo"
        open={Boolean(quickAccountModal)}
        onCancel={() => setQuickAccountModal(null)}
        onOk={handleConfirmQuickSubaccount}
        confirmLoading={creatingSubaccount}
        okText="Crear y Seleccionar Subcuenta"
        cancelText="Cancelar"
        width={460}
      >
        {quickAccountModal && (
          <div className="space-y-3 py-2 text-xs">
            <p className="text-gray-600 m-0">
              Se creará automáticamente el siguiente número consecutivo de subcuenta afectable bajo el rubro de <strong>{selectedTypeObj?.label || 'Activo Fijo'}</strong>:
            </p>
            <div>
              <label className="block font-bold mb-1">Nombre de la Subcuenta:</label>
              <Input
                value={quickAccountModal.name}
                onChange={(e) => setQuickAccountModal({ ...quickAccountModal, name: e.target.value })}
                placeholder="Nombre de la subcuenta..."
              />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};

export default FixedAssetModal;
