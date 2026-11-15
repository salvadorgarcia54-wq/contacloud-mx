import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  Card,
  Table,
  Row,
  Col,
  Select,
  Button,
  Typography,
  Alert,
  Spin,
  Tag,
  Statistic,
  Tabs,
  Input,
  InputNumber,
  Space,
  Checkbox,
  Tooltip,
  Modal,
  message,
} from 'antd';
import {
  CalculatorOutlined,
  PrinterOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  CheckCircleOutlined,
  SearchOutlined,
  UndoOutlined,
  FileSearchOutlined,
  SwapOutlined,
  EyeOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  SaveOutlined,
  TableOutlined,
  CalendarOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { fiscalApi, clientsApi } from '../api/client';
import { exportToExcel, exportToPdfWithLogo } from '../utils/exportPaperwork';

const { Title } = Typography;
const { Option } = Select;

const monthNames = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const FiscalIsr = () => {
  const { clientId } = useParams();
  const [loading, setLoading] = useState(true);
  const [savingParams, setSavingParams] = useState(false);
  const [clientInfo, setClientInfo] = useState(null);
  const [data, setData] = useState(null);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(2);
  const [selectedRegime, setSelectedRegime] = useState(null);
  const [activeTab, setActiveTab] = useState('cedula');
  const [searchEmitidos, setSearchEmitidos] = useState('');
  const [searchRecibidos, setSearchRecibidos] = useState('');
  const [error, setError] = useState(null);

  // Parámetros editables en vivo en el papel de trabajo
  const [coeficienteUtilidad, setCoeficienteUtilidad] = useState(0);
  const [perdidasFiscales, setPerdidasFiscales] = useState(0);
  const [ptuPagada, setPtuPagada] = useState(0);
  const [estimulosFiscales, setEstimulosFiscales] = useState(0);
  const [ingresosAdicionales, setIngresosAdicionales] = useState(0);
  const [deduccionesAdicionales, setDeduccionesAdicionales] = useState(0);
  const [pagosProvManual, setPagosProvManual] = useState(null);
  const [retencionesManual, setRetencionesManual] = useState(null);
  const [applyCuAllYear, setApplyCuAllYear] = useState(true);

  // Modales
  const [provisionModalVisible, setProvisionModalVisible] = useState(false);
  const [generatingProvision, setGeneratingProvision] = useState(false);
  const [tarifaModalVisible, setTarifaModalVisible] = useState(false);

  // Almacenamiento local para comprobantes omitidos por cliente y periodo
  const storageKey = `fiscal_isr_omitted_${clientId}_${year}_${month}`;
  const [omittedIds, setOmittedIds] = useState(() => {
    try {
      const saved = localStorage.getItem(`fiscal_isr_omitted_${clientId}_${year}_${month}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`fiscal_isr_omitted_${clientId}_${year}_${month}`);
      setOmittedIds(saved ? JSON.parse(saved) : []);
    } catch {
      setOmittedIds([]);
    }
  }, [clientId, year, month]);

  const toggleOmit = (id) => {
    setOmittedIds((prev) => {
      const updated = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(storageKey, JSON.stringify(updated));
      } catch (e) {
        console.error('Error guardando omisiones ISR:', e);
      }
      return updated;
    });
  };

  const resetOmitted = () => {
    setOmittedIds([]);
    try {
      localStorage.removeItem(storageKey);
    } catch (e) {
      console.error('Error al restablecer omisiones ISR:', e);
    }
  };

  const formatMoney = (val) => {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
    }).format(val || 0);
  };

  const fetchData = async (regimeOverride = selectedRegime) => {
    setLoading(true);
    setError(null);
    try {
      const params = { year, month };
      if (regimeOverride) params.regime = regimeOverride;

      const [clientRes, isrRes] = await Promise.all([
        clientsApi.get(clientId),
        fiscalApi.getIsrReport(clientId, params),
      ]);
      const d = isrRes.data;
      setClientInfo(clientRes.data);
      setData(d);
      setSelectedRegime(d.active_regime);

      const p = d.parameters || {};
      setCoeficienteUtilidad(Number(p.coeficiente_utilidad || 0));
      setPerdidasFiscales(Number(p.perdidas_fiscales || 0));
      setPtuPagada(Number(p.ptu_pagada || 0));
      setEstimulosFiscales(Number(p.estimulos_fiscales || 0));
      setIngresosAdicionales(Number(p.ingresos_adicionales || 0));
      setDeduccionesAdicionales(Number(p.deducciones_adicionales || 0));
      setPagosProvManual(p.pagos_provisionales_manual !== null && p.pagos_provisionales_manual !== undefined ? Number(p.pagos_provisionales_manual) : null);
      setRetencionesManual(p.retenciones_manual !== null && p.retenciones_manual !== undefined ? Number(p.retenciones_manual) : null);
    } catch (err) {
      console.error('Error fetching ISR calculation:', err);
      setError('No se pudo cargar el papel de trabajo de ISR Provisional del periodo.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (clientId) {
      setSelectedRegime(null);
      fetchData(null);
    }
  }, [clientId]);

  useEffect(() => {
    if (clientId) {
      fetchData(selectedRegime);
    }
  }, [year, month]);

  const handleRegimeChange = (val) => {
    setSelectedRegime(val);
    fetchData(val);
  };

  const handleSaveParameters = async () => {
    setSavingParams(true);
    try {
      await fiscalApi.saveIsrParameters(clientId, {
        year,
        month,
        regime_code: selectedRegime || data?.active_regime || '601',
        coeficiente_utilidad: Number(coeficienteUtilidad || 0),
        perdidas_fiscales: Number(perdidasFiscales || 0),
        ptu_pagada: Number(ptuPagada || 0),
        estimulos_fiscales: Number(estimulosFiscales || 0),
        ingresos_adicionales: Number(ingresosAdicionales || 0),
        deducciones_adicionales: Number(deduccionesAdicionales || 0),
        pagos_provisionales_manual: pagosProvManual !== null && pagosProvManual !== '' ? Number(pagosProvManual) : null,
        retenciones_manual: retencionesManual !== null && retencionesManual !== '' ? Number(retencionesManual) : null,
        apply_cu_all_year: applyCuAllYear,
      });
      message.success('Parámetros fiscales de ISR guardados y actualizados en la cédula anual.');
      await fetchData(selectedRegime);
    } catch (err) {
      console.error('Error saving ISR params:', err);
      message.error(err?.response?.data?.detail || 'No se pudieron guardar los parámetros fiscales.');
    } finally {
      setSavingParams(false);
    }
  };

  // Separación de comprobantes del mes ordenados de la fecha más antigua a la más reciente
  const allInvoices = useMemo(
    () =>
      [...(data?.invoices || [])].sort(
        (a, b) => (a.date || '').localeCompare(b.date || '') || (a.id || 0) - (b.id || 0)
      ),
    [data?.invoices]
  );
  const activeRegime = selectedRegime || data?.active_regime || '601';

  const REGIME_OPTIONS_MAP = {
    '601': '601 — Personas Morales: Régimen General de Ley (Coef. Utilidad × 30%)',
    '626_PM': '626 — Personas Morales: RESICO (Flujo de Efectivo × 30%)',
    '626_PF': '626 — Personas Físicas: RESICO (Tasas Fijas 1.00% a 2.50%)',
    '612': '612 — Personas Físicas: Act. Empresariales y Profesionales (Tarifa Art. 96)',
    '606_CIEGA': '606 — Personas Físicas: Arrendamiento — Deducción Ciega (35% + Predial)',
    '606_COMPROBADA': '606 — Personas Físicas: Arrendamiento — Deducción Comprobada (CFDI)',
    '625': '625 — Personas Físicas: Plataformas Tecnológicas / Digitales (Art. 113-A)',
  };

  // Solo permitir elegir el régimen con el que se dio de alta el cliente (y en Arrendamiento 606 las dos opciones: Ciega o Comprobada)
  const allowedRegimeCodes = useMemo(() => {
    if (data?.allowed_regime_codes && data.allowed_regime_codes.length > 0) {
      return data.allowed_regime_codes;
    }
    if (activeRegime === '606_CIEGA' || activeRegime === '606_COMPROBADA') {
      return ['606_CIEGA', '606_COMPROBADA'];
    }
    return [activeRegime];
  }, [data, activeRegime]);

  // Filtrar según régimen: en 601 entran todos los nominales (PUE y PPD); en flujo (626_PM, 626_PF, 612) entran los efectivamente cobrados/pagados
  const emitidosAll = useMemo(() => {
    return allInvoices.filter((i) => i.cfdi_type === 'emitido' && (activeRegime === '601' ? i.is_nominal : i.is_effective));
  }, [allInvoices, activeRegime]);

  const recibidosAll = useMemo(() => {
    return allInvoices.filter((i) => i.cfdi_type === 'recibido' && i.is_effective);
  }, [allInvoices]);

  const activeEmitidosAll = useMemo(
    () => emitidosAll.filter((i) => !omittedIds.includes(i.id)),
    [emitidosAll, omittedIds]
  );
  const activeRecibidosAll = useMemo(
    () => recibidosAll.filter((i) => !omittedIds.includes(i.id)),
    [recibidosAll, omittedIds]
  );

  // Sumatorias de CFDIs activos (no omitidos) del mes seleccionado
  const activeEmitidosTotals = useMemo(() => {
    return activeEmitidosAll.reduce(
      (acc, r) => {
        acc.subtotal += Number(r.subtotal) || 0;
        acc.iva += Number(r.iva) || 0;
        acc.retencion_isr += Number(r.retencion_isr) || 0;
        acc.retencion_iva += Number(r.retencion_iva) || 0;
        acc.total += Number(r.total) || 0;
        return acc;
      },
      { subtotal: 0, iva: 0, retencion_isr: 0, retencion_iva: 0, total: 0 }
    );
  }, [activeEmitidosAll]);

  const activeRecibidosTotals = useMemo(() => {
    return activeRecibidosAll.reduce(
      (acc, r) => {
        acc.subtotal += Number(r.subtotal) || 0;
        acc.iva += Number(r.iva) || 0;
        acc.retencion_isr += Number(r.retencion_isr) || 0;
        acc.retencion_iva += Number(r.retencion_iva) || 0;
        acc.total += Number(r.total) || 0;
        return acc;
      },
      { subtotal: 0, iva: 0, retencion_isr: 0, retencion_iva: 0, total: 0 }
    );
  }, [activeRecibidosAll]);

  // Cálculo dinámico en vivo considerando omisiones de CFDI y edición de parámetros
  const dynamicCalc = useMemo(() => {
    if (!data?.summary) return null;
    const s = data.summary;

    // Si hay CFDIs en el mes, ajustar por los CFDIs omitidos; si no hay CFDIs pero hay contabilidad, usar base contable
    const omittedEmitidosSubtotal = emitidosAll
      .filter((i) => omittedIds.includes(i.id))
      .reduce((sum, r) => sum + (Number(r.subtotal) || 0), 0);
    const omittedEmitidosRetIsr = emitidosAll
      .filter((i) => omittedIds.includes(i.id))
      .reduce((sum, r) => sum + (Number(r.retencion_isr) || 0), 0);
    const omittedRecibidosSubtotal = recibidosAll
      .filter((i) => omittedIds.includes(i.id))
      .reduce((sum, r) => sum + (Number(r.subtotal) || 0), 0);

    const ingAnteriores = Number(s.ingresos_anteriores || 0);
    const baseIngMes = Math.max(0, Math.round((Number(s.ingresos_base_mes || 0) - omittedEmitidosSubtotal) * 100) / 100);
    const ingAdicMes = Number(ingresosAdicionales || 0);
    const ingMesTotal = Math.round((baseIngMes + ingAdicMes) * 100) / 100;
    const ingAcumulados = Math.round((ingAnteriores + ingMesTotal) * 100) / 100;

    // Deducciones de meses anteriores
    const dedAnteriores = Math.max(0, Math.round((Number(s.deducciones_acumuladas || 0) - Number(s.deducciones_mes || 0)) * 100) / 100);
    const baseDedGastosMes = Math.max(0, Math.round((Number(s.deducciones_gastos_mes || 0) - omittedRecibidosSubtotal) * 100) / 100);
    const depMes = Number(s.depreciacion_mes || 0);
    const dedAdicMes = Number(deduccionesAdicionales || 0);
    const dedMesTotal = Math.round((baseDedGastosMes + depMes + dedAdicMes) * 100) / 100;
    const dedAcumuladas = Math.round((dedAnteriores + dedMesTotal) * 100) / 100;

    const cu = Number(coeficienteUtilidad || 0);
    const ptu = Number(ptuPagada || 0);
    const perdidas = Number(perdidasFiscales || 0);
    const estimulos = Number(estimulosFiscales || 0);

    const pagosProvPrevios =
      pagosProvManual !== null && pagosProvManual !== '' && !Number.isNaN(Number(pagosProvManual))
        ? Number(pagosProvManual)
        : Number(s.pagos_provisionales_anteriores || 0);

    const retAnteriores = Math.max(0, Math.round((Number(s.retenciones_isr_acumuladas || 0) - Number(s.retenciones_isr_mes || 0)) * 100) / 100);
    const retMesAuto = Math.max(0, Math.round((Number(s.retenciones_isr_mes || 0) - omittedEmitidosRetIsr) * 100) / 100);
    const retMes =
      retencionesManual !== null && retencionesManual !== '' && !Number.isNaN(Number(retencionesManual))
        ? Number(retencionesManual)
        : retMesAuto;
    const retAcumuladas = Math.round((retAnteriores + retMes) * 100) / 100;

    let utilidadFiscal = 0;
    let baseGravable = 0;
    let tasaAplicada = 30.0;
    let isrCausado = 0;
    let extraArt96 = null;
    let extraResicoPf = null;
    let extraArrendamiento = null;
    let extraPlataformas = null;
    let dedMesFinal = dedMesTotal;
    let dedAcumFinal = dedAcumuladas;

    const isMonthlyNonCumulative = ['626_PF', '606_CIEGA', '606_COMPROBADA', '625'].includes(activeRegime);

    // Helper para evaluar tarifa unitaria mensual (1 mes) Art. 116 / Art. 96 LISR
    const evalTarifaUnitaria = (baseMes) => {
      const tarifaUnit = data?.tarifa_art96_unitaria || data?.tarifa_art96_mes || [];
      let bracket = tarifaUnit[0] || { lim_inf: 0.01, lim_sup: 746.04, cuota_fija: 0, tasa_excedente: 1.92 };
      for (const b of tarifaUnit) {
        if (b.lim_sup === null || baseMes <= b.lim_sup) {
          bracket = b;
          break;
        }
      }
      const limInf = baseMes > 0 ? Number(bracket.lim_inf) : 0;
      const excedente = Math.max(0, Math.round((baseMes - limInf) * 100) / 100);
      const tasaExc = Number(bracket.tasa_excedente || 1.92);
      const impMarginal = Math.round(excedente * (tasaExc / 100.0) * 100) / 100;
      const cuotaFija = baseMes > 0 ? Number(bracket.cuota_fija || 0) : 0;
      const isrCalc = Math.round((impMarginal + cuotaFija) * 100) / 100;
      return {
        isr: isrCalc,
        tasa: tasaExc,
        detail: {
          limite_inferior: limInf,
          limite_superior: bracket.lim_sup,
          excedente,
          tasa_excedente: tasaExc,
          impuesto_marginal: impMarginal,
          cuota_fija: cuotaFija,
        },
      };
    };

    if (activeRegime === '601') {
      utilidadFiscal = Math.round(ingAcumulados * cu * 100) / 100;
      baseGravable = Math.max(0, Math.round((utilidadFiscal - ptu - perdidas - estimulos) * 100) / 100);
      tasaAplicada = 30.0;
      isrCausado = Math.round(baseGravable * 0.3 * 100) / 100;
    } else if (activeRegime === '626_PM') {
      utilidadFiscal = Math.max(0, Math.round((ingAcumulados - dedAcumuladas) * 100) / 100);
      baseGravable = Math.max(0, Math.round((utilidadFiscal - ptu - perdidas - estimulos) * 100) / 100);
      tasaAplicada = 30.0;
      isrCausado = Math.round(baseGravable * 0.3 * 100) / 100;
    } else if (activeRegime === '626_PF') {
      // RESICO Persona Física: tasa directa mensual sobre ingresos cobrados del mes
      const table = data?.tabla_resico_pf || [];
      let rowSelected = table[table.length - 1] || { lim_inf: 0.01, lim_sup: 25000, tasa: 1.0 };
      for (const r of table) {
        if (ingMesTotal <= r.lim_sup) {
          rowSelected = r;
          break;
        }
      }
      tasaAplicada = ingMesTotal > 0 ? Number(rowSelected.tasa) : 1.0;
      utilidadFiscal = ingMesTotal;
      baseGravable = ingMesTotal;
      isrCausado = Math.round(ingMesTotal * (tasaAplicada / 100.0) * 100) / 100;
      dedMesFinal = 0;
      dedAcumFinal = 0;
      extraResicoPf = {
        lim_inf: rowSelected.lim_inf,
        lim_sup: rowSelected.lim_sup,
        tasa: tasaAplicada,
        excede_tope: ingMesTotal > 3500000,
      };
    } else if (activeRegime === '606_CIEGA' || activeRegime === '606_COMPROBADA') {
      // Arrendamiento Personas Físicas (Art. 115 y 116 LISR) — Cálculo Mensual No Acumulativo
      const dedCiega35 = Math.round(ingMesTotal * 0.35 * 100) / 100;
      const predialMes = dedAdicMes;
      const totalDedCiega = Math.round((dedCiega35 + predialMes) * 100) / 100;
      const totalDedComprobada = Math.round((baseDedGastosMes + depMes + dedAdicMes) * 100) / 100;

      const baseCiega = Math.max(0, Math.round((ingMesTotal - totalDedCiega - perdidas - estimulos) * 100) / 100);
      const baseComprobada = Math.max(0, Math.round((ingMesTotal - totalDedComprobada - perdidas - estimulos) * 100) / 100);

      const calcCiega = evalTarifaUnitaria(baseCiega);
      const calcComprobada = evalTarifaUnitaria(baseComprobada);

      if (activeRegime === '606_CIEGA') {
        dedMesFinal = totalDedCiega;
        dedAcumFinal = Math.round((dedAnteriores + totalDedCiega) * 100) / 100;
        utilidadFiscal = Math.max(0, Math.round((ingMesTotal - totalDedCiega) * 100) / 100);
        baseGravable = baseCiega;
        isrCausado = calcCiega.isr;
        tasaAplicada = calcCiega.tasa;
        extraArt96 = calcCiega.detail;
      } else {
        dedMesFinal = totalDedComprobada;
        dedAcumFinal = Math.round((dedAnteriores + totalDedComprobada) * 100) / 100;
        utilidadFiscal = Math.max(0, Math.round((ingMesTotal - totalDedComprobada) * 100) / 100);
        baseGravable = baseComprobada;
        isrCausado = calcComprobada.isr;
        tasaAplicada = calcComprobada.tasa;
        extraArt96 = calcComprobada.detail;
      }

      extraArrendamiento = {
        modalidad: activeRegime === '606_CIEGA' ? 'Deducción Ciega (35% + Predial)' : 'Deducción Comprobada (CFDI)',
        deduccion_ciega_35: dedCiega35,
        impuesto_predial: predialMes,
        total_ded_ciega: totalDedCiega,
        isr_ciega: Math.max(0, Math.round((calcCiega.isr - retMes) * 100) / 100),
        gastos_comprobados_cfdi: baseDedGastosMes,
        depreciacion_inmueble: depMes,
        total_ded_comprobada: totalDedComprobada,
        isr_comprobada: Math.max(0, Math.round((calcComprobada.isr - retMes) * 100) / 100),
        conviene_ciega: totalDedCiega >= totalDedComprobada,
        ahorro_estimado: Math.abs(Math.round((calcCiega.isr - calcComprobada.isr) * 100) / 100),
      };
    } else if (activeRegime === '625') {
      // Plataformas Tecnológicas / Digitales (Art. 113-A, 113-B y 113-C LISR)
      let tasaPlat = 2.1;
      if ([1.0, 2.1, 4.0].includes(Math.round(cu * 100) / 100)) {
        tasaPlat = Math.round(cu * 100) / 100;
      } else if ([0.01, 0.021, 0.04].includes(Math.round(cu * 1000) / 1000)) {
        tasaPlat = Math.round(cu * 100 * 100) / 100;
      }
      const actividadLabels = {
        2.1: 'Transporte terrestre de pasajeros y entrega de bienes (2.10%)',
        4.0: 'Prestación de servicios de hospedaje (4.00%)',
        1.0: 'Enajenación de bienes y prestación de servicios (1.00%)',
      };
      tasaAplicada = tasaPlat;
      utilidadFiscal = ingMesTotal;
      baseGravable = ingMesTotal;
      dedMesFinal = 0;
      dedAcumFinal = 0;
      isrCausado = Math.round(ingMesTotal * (tasaPlat / 100.0) * 100) / 100;
      extraPlataformas = {
        tasa_actividad: tasaPlat,
        actividad_nombre: actividadLabels[tasaPlat] || actividadLabels[2.1],
        ingresos_plataforma: baseIngMes,
        ingresos_directos_usuarios: ingAdicMes,
        isr_directos: Math.round(ingAdicMes * (tasaPlat / 100.0) * 100) / 100,
      };
    } else {
      // 612: Persona Física Actividades Empresariales y Profesionales (Tarifa Art. 96 LISR elevada al mes)
      utilidadFiscal = Math.max(0, Math.round((ingAcumulados - dedAcumuladas) * 100) / 100);
      baseGravable = Math.max(0, Math.round((utilidadFiscal - ptu - perdidas - estimulos) * 100) / 100);
      const tarifa = data?.tarifa_art96_mes || [];
      let bracket = tarifa[0] || { lim_inf: 0.01, lim_sup: 746.04, cuota_fija: 0, tasa_excedente: 1.92 };
      for (const b of tarifa) {
        if (b.lim_sup === null || baseGravable <= b.lim_sup) {
          bracket = b;
          break;
        }
      }
      const limInf = baseGravable > 0 ? Number(bracket.lim_inf) : 0;
      const excedente = Math.max(0, Math.round((baseGravable - limInf) * 100) / 100);
      const tasaExc = Number(bracket.tasa_excedente || 1.92);
      const impMarginal = Math.round(excedente * (tasaExc / 100.0) * 100) / 100;
      const cuotaFija = baseGravable > 0 ? Number(bracket.cuota_fija || 0) : 0;
      isrCausado = Math.round((impMarginal + cuotaFija) * 100) / 100;
      tasaAplicada = tasaExc;
      extraArt96 = {
        limite_inferior: limInf,
        limite_superior: bracket.lim_sup,
        excedente,
        tasa_excedente: tasaExc,
        impuesto_marginal: impMarginal,
        cuota_fija: cuotaFija,
      };
    }

    const acreditamientos = isMonthlyNonCumulative
      ? Math.round((retMes + estimulos) * 100) / 100
      : Math.round((pagosProvPrevios + retAcumuladas) * 100) / 100;

    const diffNeto = Math.round((isrCausado - acreditamientos) * 100) / 100;
    const isrACargo = Math.max(0, diffNeto);
    const saldoAFavor = Math.max(0, -diffNeto);

    return {
      isMonthlyNonCumulative,
      ingAnteriores,
      baseIngMes,
      ingAdicMes,
      ingMesTotal,
      ingAcumulados,
      dedAnteriores,
      baseDedGastosMes,
      depMes,
      dedAdicMes,
      dedMesTotal: dedMesFinal,
      dedAcumuladas: dedAcumFinal,
      cu,
      utilidadFiscal,
      ptu,
      perdidas,
      estimulos,
      baseGravable,
      tasaAplicada,
      isrCausado,
      pagosProvPrevios: isMonthlyNonCumulative ? 0 : pagosProvPrevios,
      retMes,
      retAcumuladas: isMonthlyNonCumulative ? retMes : retAcumuladas,
      isrACargo,
      saldoAFavor,
      extraArt96,
      extraResicoPf,
      extraArrendamiento,
      extraPlataformas,
    };
  }, [
    data,
    activeRegime,
    emitidosAll,
    recibidosAll,
    omittedIds,
    coeficienteUtilidad,
    perdidasFiscales,
    ptuPagada,
    estimulosFiscales,
    ingresosAdicionales,
    deduccionesAdicionales,
    pagosProvManual,
    retencionesManual,
  ]);

  const handleExecuteProvision = async () => {
    if (!dynamicCalc) return;
    setGeneratingProvision(true);
    try {
      const res = await fiscalApi.generarProvisionIsr(clientId, {
        year,
        month,
        isr_a_cargo: dynamicCalc.isrACargo,
        regime_code: activeRegime,
      });
      message.success(res.data.message || 'Póliza de provisión de ISR generada con éxito.');
      setProvisionModalVisible(false);
      await fetchData(activeRegime);
    } catch (err) {
      console.error('Error al generar provisión de ISR:', err);
      message.error(err?.response?.data?.detail || 'No se pudo generar la póliza de provisión de ISR.');
    } finally {
      setGeneratingProvision(false);
    }
  };

  // Construcción de payload para Exportar Excel (.xlsx) y PDF Membretado
  const buildIsrExportPayload = () => {
    if (!data || !dynamicCalc) return null;

    const columnsDef = [
      { key: 'concepto', title: 'Concepto / Rubro Fiscal LISR', align: 'left', format: 'text', width: 46 },
      { key: 'referencia', title: 'Fundamento / Base', align: 'left', format: 'text', width: 28 },
      { key: 'mes_actual', title: `Mes (${monthNames[month - 1]})`, align: 'right', format: 'currency', width: 18 },
      { key: 'acumulado', title: `Acumulado Ene-${monthNames[month - 1].slice(0, 3)}`, align: 'right', format: 'currency', width: 20 },
    ];

    const rows = [];
    rows.push({
      concepto: `I. DETERMINACIÓN DE PAGO PROVISIONAL DE ISR — ${data.regime_info?.name || activeRegime}`,
      referencia: data.regime_info?.fundamento || '',
      mes_actual: '',
      acumulado: '',
      _rowType: 'section',
    });

    if (activeRegime === '601') {
      rows.push({
        concepto: '(+) Ingresos Nominales de Meses Anteriores',
        referencia: 'Art. 14 LISR',
        mes_actual: 0,
        acumulado: dynamicCalc.ingAnteriores,
        _rowType: 'normal',
      });
      rows.push({
        concepto: '(+) Ingresos Nominales Facturados / Devengados del Mes',
        referencia: 'Cuentas 401 / CFDI Emitidos',
        mes_actual: dynamicCalc.baseIngMes,
        acumulado: dynamicCalc.baseIngMes,
        _rowType: 'normal',
      });
      if (dynamicCalc.ingAdicMes !== 0) {
        rows.push({
          concepto: '(+) Otros Ingresos Nominales / Anticipos / Ajuste',
          referencia: 'Captura en Papel de Trabajo',
          mes_actual: dynamicCalc.ingAdicMes,
          acumulado: dynamicCalc.ingAdicMes,
          _rowType: 'normal',
        });
      }
      rows.push({
        concepto: '(=) TOTAL DE INGRESOS NOMINALES ACUMULADOS',
        referencia: `Enero a ${monthNames[month - 1]} ${year}`,
        mes_actual: dynamicCalc.ingMesTotal,
        acumulado: dynamicCalc.ingAcumulados,
        _rowType: 'subtotal',
      });
      rows.push({
        concepto: `(×) Coeficiente de Utilidad Aplicado (${(dynamicCalc.cu * 100).toFixed(4)}% / factor ${dynamicCalc.cu.toFixed(4)})`,
        referencia: 'Art. 14 Fracc. I LISR',
        mes_actual: '',
        acumulado: dynamicCalc.utilidadFiscal,
        _rowType: 'normal',
      });
      rows.push({
        concepto: '(-) PTU Pagada en el Ejercicio Disminuible',
        referencia: 'Art. 14 Fracc. II LISR',
        mes_actual: 0,
        acumulado: dynamicCalc.ptu,
        _rowType: 'normal',
      });
      rows.push({
        concepto: '(-) Pérdidas Fiscales de Ejercicios Anteriores por Amortizar',
        referencia: 'Art. 57 LISR',
        mes_actual: 0,
        acumulado: dynamicCalc.perdidas,
        _rowType: 'normal',
      });
      if (dynamicCalc.estimulos > 0) {
        rows.push({
          concepto: '(-) Estímulos Fiscales Aplicables',
          referencia: 'LIF / LISR',
          mes_actual: 0,
          acumulado: dynamicCalc.estimulos,
          _rowType: 'normal',
        });
      }
      rows.push({
        concepto: '(=) BASE GRAVABLE PARA EL PAGO PROVISIONAL',
        referencia: 'Utilidad Fiscal Base',
        mes_actual: '',
        acumulado: dynamicCalc.baseGravable,
        _rowType: 'subtotal',
      });
      rows.push({
        concepto: '(×) ISR Causado a la Tasa del 30.00% (Art. 9 LISR)',
        referencia: 'Tasa Corporativa 30%',
        mes_actual: '',
        acumulado: dynamicCalc.isrCausado,
        _rowType: 'normal',
      });
      rows.push({
        concepto: '(-) Pagos Provisionales Efectuados con Anterioridad',
        referencia: 'Declaraciones previas del ejercicio',
        mes_actual: 0,
        acumulado: dynamicCalc.pagosProvPrevios,
        _rowType: 'normal',
      });
      rows.push({
        concepto: '(-) ISR Retenido por el Sistema Financiero / Terceros',
        referencia: 'CFDI / Constancias',
        mes_actual: dynamicCalc.retMes,
        acumulado: dynamicCalc.retAcumuladas,
        _rowType: 'normal',
      });
    } else if (activeRegime === '626_PF') {
      rows.push({
        concepto: '(+) Ingresos Efectivamente Cobrados en el Mes (Sin IVA)',
        referencia: 'Art. 113-E LISR (Flujo de Efectivo)',
        mes_actual: dynamicCalc.ingMesTotal,
        acumulado: dynamicCalc.ingAcumulados,
        _rowType: 'subtotal',
      });
      rows.push({
        concepto: `(×) Tasa Mensual RESICO Aplicada (${dynamicCalc.tasaAplicada.toFixed(2)}%)`,
        referencia: 'Tabla Mensual Art. 113-E LISR',
        mes_actual: dynamicCalc.isrCausado,
        acumulado: dynamicCalc.isrCausado,
        _rowType: 'normal',
      });
      rows.push({
        concepto: '(-) ISR Retenido por Personas Morales en el Mes (1.25%)',
        referencia: 'Art. 113-J LISR (CFDI Emitidos)',
        mes_actual: dynamicCalc.retMes,
        acumulado: dynamicCalc.retMes,
        _rowType: 'normal',
      });
    } else if (activeRegime === '606_CIEGA' || activeRegime === '606_COMPROBADA') {
      rows.push({
        concepto: '(+) Ingresos por Arrendamiento Efectivamente Cobrados en el Mes',
        referencia: 'Art. 114 y 116 LISR',
        mes_actual: dynamicCalc.ingMesTotal,
        acumulado: dynamicCalc.ingAcumulados,
        _rowType: 'subtotal',
      });
      if (activeRegime === '606_CIEGA' && dynamicCalc.extraArrendamiento) {
        rows.push({
          concepto: '(-) Deducción Opcional "Ciega" del 35% sobre Ingresos Cobrados',
          referencia: 'Art. 115 Párr. 2 LISR (Sin comprobación)',
          mes_actual: dynamicCalc.extraArrendamiento.deduccion_ciega_35,
          acumulado: dynamicCalc.extraArrendamiento.deduccion_ciega_35,
          _rowType: 'normal',
        });
        rows.push({
          concepto: '(-) Impuesto Predial Pagado del Inmueble Arrendado',
          referencia: 'Art. 115 Fracc. I LISR',
          mes_actual: dynamicCalc.extraArrendamiento.impuesto_predial,
          acumulado: dynamicCalc.extraArrendamiento.impuesto_predial,
          _rowType: 'normal',
        });
      } else {
        rows.push({
          concepto: '(-) Gastos de Mantenimiento, Predial y Erogaciones Comprobadas con CFDI',
          referencia: 'Art. 115 LISR (CFDI Recibidos Pagados)',
          mes_actual: dynamicCalc.baseDedGastosMes + dynamicCalc.dedAdicMes,
          acumulado: dynamicCalc.dedAcumuladas - Number(data.summary?.depreciacion_acumulada || 0),
          _rowType: 'normal',
        });
        rows.push({
          concepto: '(-) Deducción de Inversiones / Construcciones y Mejoras',
          referencia: 'Art. 115 Fracc. VI LISR',
          mes_actual: dynamicCalc.depMes,
          acumulado: Number(data.summary?.depreciacion_acumulada || 0),
          _rowType: 'normal',
        });
      }
      rows.push({
        concepto: '(=) BASE GRAVABLE MENSUAL DE ARRENDAMIENTO',
        referencia: 'Tarifa Mensual Art. 116 LISR',
        mes_actual: dynamicCalc.baseGravable,
        acumulado: dynamicCalc.baseGravable,
        _rowType: 'subtotal',
      });
      if (dynamicCalc.extraArt96) {
        rows.push({
          concepto: `(-) Límite Inferior (${formatMoney(dynamicCalc.extraArt96.limite_inferior)}) | Excedente × ${dynamicCalc.extraArt96.tasa_excedente}% + Cuota Fija (${formatMoney(dynamicCalc.extraArt96.cuota_fija)})`,
          referencia: 'Tarifa Mensual Art. 116 LISR',
          mes_actual: dynamicCalc.isrCausado,
          acumulado: dynamicCalc.isrCausado,
          _rowType: 'normal',
        });
      }
      rows.push({
        concepto: '(-) ISR Retenido por Personas Morales Arrendatarias (10%)',
        referencia: 'Art. 116 Párr. 5 LISR',
        mes_actual: dynamicCalc.retMes,
        acumulado: dynamicCalc.retMes,
        _rowType: 'normal',
      });
    } else if (activeRegime === '625') {
      rows.push({
        concepto: '(+) Ingresos Obtenidos Mediante Intermediarios / Plataformas Digitales',
        referencia: 'Art. 113-A LISR (CFDI / Constancias)',
        mes_actual: dynamicCalc.baseIngMes,
        acumulado: dynamicCalc.ingAcumulados - dynamicCalc.ingAdicMes,
        _rowType: 'normal',
      });
      rows.push({
        concepto: '(+) Ingresos Cobrados Directamente de los Usuarios de la Plataforma',
        referencia: 'Art. 113-B LISR',
        mes_actual: dynamicCalc.ingAdicMes,
        acumulado: dynamicCalc.ingAdicMes,
        _rowType: 'normal',
      });
      rows.push({
        concepto: '(=) TOTAL DE INGRESOS MENSUALES POR PLATAFORMAS TECNOLÓGICAS',
        referencia: dynamicCalc.extraPlataformas?.actividad_nombre || 'Art. 113-A LISR',
        mes_actual: dynamicCalc.ingMesTotal,
        acumulado: dynamicCalc.ingAcumulados,
        _rowType: 'subtotal',
      });
      rows.push({
        concepto: `(×) Tasa de Retención / Pago Art. 113-A LISR (${dynamicCalc.tasaAplicada.toFixed(2)}%) = ISR Causado`,
        referencia: 'Tasa por Actividad en Plataforma Digital',
        mes_actual: dynamicCalc.isrCausado,
        acumulado: dynamicCalc.isrCausado,
        _rowType: 'normal',
      });
      rows.push({
        concepto: '(-) ISR Retenido por la Plataforma Tecnológica en el Mes',
        referencia: 'Constancia de Retenciones CFDI',
        mes_actual: dynamicCalc.retMes,
        acumulado: dynamicCalc.retMes,
        _rowType: 'normal',
      });
    } else {
      // 626_PM y 612
      rows.push({
        concepto: '(+) Ingresos Efectivamente Cobrados Acumulados',
        referencia: 'CFDI PUE y Complementos de Pago',
        mes_actual: dynamicCalc.ingMesTotal,
        acumulado: dynamicCalc.ingAcumulados,
        _rowType: 'normal',
      });
      rows.push({
        concepto: '(-) Compras y Gastos Efectivamente Pagados',
        referencia: 'CFDI Recibidos Pagados',
        mes_actual: dynamicCalc.baseDedGastosMes + dynamicCalc.dedAdicMes,
        acumulado: dynamicCalc.dedAcumuladas - Number(data.summary?.depreciacion_acumulada || 0),
        _rowType: 'normal',
      });
      rows.push({
        concepto: '(-) Deducción de Inversiones (Depreciación Fiscal del Ejercicio)',
        referencia: 'Cédula de Activos Fijos',
        mes_actual: dynamicCalc.depMes,
        acumulado: Number(data.summary?.depreciacion_acumulada || 0),
        _rowType: 'normal',
      });
      rows.push({
        concepto: '(=) UTILIDAD FISCAL EN FLUJO DE EFECTIVO',
        referencia: 'Ingresos Cobrados − Deducciones Pagadas',
        mes_actual: Math.max(0, dynamicCalc.ingMesTotal - dynamicCalc.dedMesTotal),
        acumulado: dynamicCalc.utilidadFiscal,
        _rowType: 'subtotal',
      });
      rows.push({
        concepto: '(-) PTU Pagada y Pérdidas Fiscales de Ejercicios Anteriores',
        referencia: 'Disminuciones de Base',
        mes_actual: 0,
        acumulado: dynamicCalc.ptu + dynamicCalc.perdidas + dynamicCalc.estimulos,
        _rowType: 'normal',
      });
      rows.push({
        concepto: '(=) BASE GRAVABLE ACUMULADA PARA ISR',
        referencia: activeRegime === '612' ? `Tarifa Art. 96 LISR (${month} meses)` : 'Art. 212 LISR (30%)',
        mes_actual: '',
        acumulado: dynamicCalc.baseGravable,
        _rowType: 'subtotal',
      });
      if (activeRegime === '612' && dynamicCalc.extraArt96) {
        rows.push({
          concepto: `(-) Límite Inferior (${formatMoney(dynamicCalc.extraArt96.limite_inferior)}) | Excedente × ${dynamicCalc.extraArt96.tasa_excedente}% + Cuota Fija (${formatMoney(dynamicCalc.extraArt96.cuota_fija)})`,
          referencia: 'Tarifa Art. 96 LISR Anexo 8 RMF',
          mes_actual: '',
          acumulado: dynamicCalc.isrCausado,
          _rowType: 'normal',
        });
      } else {
        rows.push({
          concepto: '(×) ISR Causado a la Tasa del 30.00% (Art. 9 LISR)',
          referencia: 'Tasa Corporativa 30%',
          mes_actual: '',
          acumulado: dynamicCalc.isrCausado,
          _rowType: 'normal',
        });
      }
      rows.push({
        concepto: '(-) Pagos Provisionales Efectuados con Anterioridad',
        referencia: 'Declaraciones previas del ejercicio',
        mes_actual: 0,
        acumulado: dynamicCalc.pagosProvPrevios,
        _rowType: 'normal',
      });
      rows.push({
        concepto: '(-) ISR Retenido Acreditable Acumulado',
        referencia: 'Retenciones de ISR en CFDI',
        mes_actual: dynamicCalc.retMes,
        acumulado: dynamicCalc.retAcumuladas,
        _rowType: 'normal',
      });
    }

    rows.push({
      concepto: '(=) IMPUESTO SOBRE LA RENTA (ISR) PROVISIONAL A CARGO DEL PERIODO',
      referencia: 'Enterar antes del día 17 del mes siguiente',
      mes_actual: dynamicCalc.isrACargo,
      acumulado: dynamicCalc.isrACargo,
      _rowType: 'total',
    });

    // Sección II: Resumen de Comprobantes Emitidos del Mes
    if (activeEmitidosAll.length > 0) {
      rows.push({
        concepto: `II. RELACIÓN DE CFDI DE INGRESOS DEL MES DE ${monthNames[month - 1].toUpperCase()} (${activeEmitidosAll.length} COMPROBANTES)`,
        referencia: 'Folio Fiscal / Cliente',
        mes_actual: '',
        acumulado: '',
        _rowType: 'section',
      });
      activeEmitidosAll.forEach((inv) => {
        rows.push({
          concepto: `${inv.date} | Folio ${inv.folio} — ${inv.name || inv.rfc}`,
          referencia: `${inv.rfc} (${inv.payment_method})${inv.retencion_isr > 0 ? ` · Ret ISR: ${formatMoney(inv.retencion_isr)}` : ''}`,
          mes_actual: Number(inv.subtotal || 0),
          acumulado: Number(inv.total || 0),
          _rowType: 'normal',
        });
      });
    }

    const summaryCards = [
      {
        label: dynamicCalc.isMonthlyNonCumulative ? 'Ingresos Cobrados del Mes' : 'Ingresos Acumulados',
        value: formatMoney(dynamicCalc.isMonthlyNonCumulative ? dynamicCalc.ingMesTotal : dynamicCalc.ingAcumulados),
        sublabel: `Mes actual: ${formatMoney(dynamicCalc.ingMesTotal)}`,
      },
      {
        label: 'Base Gravable de ISR',
        value: formatMoney(dynamicCalc.baseGravable),
        sublabel:
          activeRegime === '601'
            ? `Coeficiente Utilidad: ${dynamicCalc.cu.toFixed(4)}`
            : activeRegime === '626_PF'
            ? `Tasa RESICO: ${dynamicCalc.tasaAplicada.toFixed(2)}%`
            : activeRegime === '606_CIEGA'
            ? `Deducción Ciega 35%: ${formatMoney(dynamicCalc.dedMesTotal)}`
            : activeRegime === '625'
            ? `Tasa Plataforma: ${dynamicCalc.tasaAplicada.toFixed(2)}%`
            : `Deducciones: ${formatMoney(dynamicCalc.isMonthlyNonCumulative ? dynamicCalc.dedMesTotal : dynamicCalc.dedAcumuladas)}`,
      },
      {
        label: 'ISR Causado (−) Acreditamientos',
        value: formatMoney(dynamicCalc.isrCausado),
        sublabel: `Pagos Ant.: ${formatMoney(dynamicCalc.pagosProvPrevios)} | Ret.: ${formatMoney(dynamicCalc.retAcumuladas)}`,
      },
      {
        label: '(=) ISR PROVISIONAL A CARGO',
        value: formatMoney(dynamicCalc.isrACargo),
        sublabel: dynamicCalc.isrACargo > 0 ? 'Enterar en declaración mensual' : 'Sin pago a cargo en el periodo',
      },
    ];

    return {
      title: 'PAPEL DE TRABAJO — DETERMINACIÓN DE PAGO PROVISIONAL DE ISR',
      subtitle: `${data.regime_info?.name || activeRegime} · ${data.regime_info?.fundamento || ''}`,
      clientName: clientInfo?.business_name || '',
      clientRfc: clientInfo?.rfc || '',
      period: `${String(month).padStart(2, '0')} - ${monthNames[month - 1]} ${year}`,
      columns: columnsDef,
      rows,
      summaryCards,
      notes: `Papel de trabajo elaborado conforme a la Ley del Impuesto Sobre la Renta (LISR). Comprobantes omitidos manualmente: ${omittedIds.length}.`,
      filename: `Papel_Trabajo_ISR_${clientInfo?.rfc || clientId}_${year}_${String(month).padStart(2, '0')}.xlsx`,
    };
  };

  const handleExportExcel = () => {
    const payload = buildIsrExportPayload();
    if (payload) exportToExcel(payload);
  };

  const handleExportPdf = () => {
    const payload = buildIsrExportPayload();
    if (payload) exportToPdfWithLogo(payload);
  };

  // Filtrado por búsqueda en pestañas de CFDIs
  const emitidos = emitidosAll.filter((i) => {
    if (!searchEmitidos) return true;
    const term = searchEmitidos.toLowerCase();
    return (
      (i.rfc || '').toLowerCase().includes(term) ||
      (i.name || '').toLowerCase().includes(term) ||
      (i.folio || '').toLowerCase().includes(term) ||
      (i.uuid || '').toLowerCase().includes(term)
    );
  });

  const recibidos = recibidosAll.filter((i) => {
    if (!searchRecibidos) return true;
    const term = searchRecibidos.toLowerCase();
    return (
      (i.rfc || '').toLowerCase().includes(term) ||
      (i.name || '').toLowerCase().includes(term) ||
      (i.folio || '').toLowerCase().includes(term) ||
      (i.uuid || '').toLowerCase().includes(term)
    );
  });

  // Columnas para Cédula Anual Acumulada (Enero al Mes Seleccionado)
  const cedulaColumns = [
    {
      title: 'Periodo / Mes',
      dataIndex: 'month_name',
      key: 'month_name',
      fixed: 'left',
      width: 115,
      render: (val, r) => (
        <span className={`font-semibold text-xs ${r.month === month ? 'text-blue-700 font-bold' : 'text-gray-800'}`}>
          {String(r.month).padStart(2, '0')} - {val}
        </span>
      ),
    },
    {
      title: activeRegime === '601' ? 'Ingresos del Mes (Nominales)' : 'Ingresos Cobrados Mes',
      dataIndex: 'ingresos_mes',
      key: 'ingresos_mes',
      align: 'right',
      width: 130,
      render: (v) => <span className="font-mono text-xs">{formatMoney(v)}</span>,
    },
    {
      title: 'Ingresos Acumulados',
      dataIndex: 'ingresos_acumulados',
      key: 'ingresos_acumulados',
      align: 'right',
      width: 140,
      render: (v) => <span className="font-mono text-xs font-semibold text-blue-800">{formatMoney(v)}</span>,
    },
    ...(activeRegime === '601'
      ? [
          {
            title: 'Coef. Utilidad',
            dataIndex: 'coeficiente_utilidad',
            key: 'coeficiente_utilidad',
            align: 'right',
            width: 105,
            render: (v) => <span className="font-mono text-xs text-purple-700 font-semibold">{Number(v || 0).toFixed(4)}</span>,
          },
          {
            title: 'Utilidad Estimada',
            dataIndex: 'utilidad_fiscal',
            key: 'utilidad_fiscal',
            align: 'right',
            width: 130,
            render: (v) => <span className="font-mono text-xs">{formatMoney(v)}</span>,
          },
        ]
      : activeRegime === '626_PF' || activeRegime === '625'
      ? []
      : [
          {
            title: activeRegime === '606_CIEGA' ? 'Ded. Ciega (35% + Predial)' : 'Deducciones Mes',
            dataIndex: 'deducciones_mes',
            key: 'deducciones_mes',
            align: 'right',
            width: 135,
            render: (v) => <span className="font-mono text-xs text-purple-700">{formatMoney(v)}</span>,
          },
          {
            title: 'Deducciones Acum.',
            dataIndex: 'deducciones_acumuladas',
            key: 'deducciones_acumuladas',
            align: 'right',
            width: 135,
            render: (v) => <span className="font-mono text-xs font-semibold text-purple-800">{formatMoney(v)}</span>,
          },
        ]),
    {
      title: 'Base Gravable ISR',
      dataIndex: 'base_gravable',
      key: 'base_gravable',
      align: 'right',
      width: 135,
      render: (v) => <span className="font-mono text-xs font-bold text-gray-900">{formatMoney(v)}</span>,
    },
    {
      title: 'Tasa %',
      dataIndex: 'tasa_aplicada',
      key: 'tasa_aplicada',
      align: 'center',
      width: 80,
      render: (v) => <Tag color="geekblue" className="m-0 font-mono text-[11px]">{Number(v || 0).toFixed(2)}%</Tag>,
    },
    {
      title: 'ISR Causado',
      dataIndex: 'isr_causado',
      key: 'isr_causado',
      align: 'right',
      width: 120,
      render: (v) => <span className="font-mono text-xs font-semibold text-amber-800">{formatMoney(v)}</span>,
    },
    {
      title: '(-) Pagos Prov. Ant.',
      dataIndex: 'pagos_provisionales_anteriores',
      key: 'pagos_provisionales_anteriores',
      align: 'right',
      width: 130,
      render: (v) => <span className="font-mono text-xs text-gray-600">{formatMoney(v)}</span>,
    },
    {
      title: '(-) Retenciones ISR',
      dataIndex: 'retenciones_isr_acumuladas',
      key: 'retenciones_isr_acumuladas',
      align: 'right',
      width: 125,
      render: (v, r) => (
        <span className="font-mono text-xs text-emerald-700">
          {formatMoney(['626_PF', '606_CIEGA', '606_COMPROBADA', '625'].includes(activeRegime) ? r.retenciones_isr_mes : v)}
        </span>
      ),
    },
    {
      title: '(=) ISR A CARGO',
      dataIndex: 'isr_a_cargo',
      key: 'isr_a_cargo',
      align: 'right',
      fixed: 'right',
      width: 135,
      render: (v) => (
        <span className={`font-mono text-xs font-bold ${v > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
          {formatMoney(v)}
        </span>
      ),
    },
  ];

  const invoiceColumns = (isEmitido) => [
    {
      title: (
        <Tooltip title="Marcar casilla para omitir este CFDI del cálculo de ISR Provisional">
          <div className="text-center font-bold text-red-600 text-xs cursor-help">Omitir</div>
        </Tooltip>
      ),
      key: 'omit',
      width: 65,
      align: 'center',
      render: (_, record) => {
        const isOmitted = omittedIds.includes(record.id);
        return (
          <Checkbox checked={isOmitted} onChange={() => toggleOmit(record.id)} />
        );
      },
    },
    {
      title: 'Fecha',
      dataIndex: 'date',
      key: 'date',
      width: 100,
    },
    {
      title: 'Folio / UUID',
      dataIndex: 'folio',
      key: 'folio',
      width: 135,
      render: (folio, record) => {
        const isOmitted = omittedIds.includes(record.id);
        const displayFolio = folio || (record.uuid ? record.uuid.substring(0, 8) : 'S/F');
        return (
          <div className="flex items-center gap-1.5">
            {record.uuid ? (
              <a
                href={`/cfdi-viewer/${record.uuid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-semibold"
              >
                <span className={`font-mono text-xs ${isOmitted ? 'line-through text-gray-400' : 'hover:underline'}`}>
                  {displayFolio}
                </span>
                <FileSearchOutlined className="text-[11px]" />
              </a>
            ) : (
              <span className="font-mono text-xs">{displayFolio}</span>
            )}
          </div>
        );
      },
    },
    {
      title: isEmitido ? 'RFC Cliente' : 'RFC Proveedor',
      dataIndex: 'rfc',
      key: 'rfc',
      width: 130,
      render: (rfc) => <span className="font-mono text-xs">{rfc}</span>,
    },
    {
      title: isEmitido ? 'Cliente / Receptor' : 'Proveedor / Emisor',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name) => <span className="font-medium text-xs text-gray-800">{name}</span>,
    },
    {
      title: 'Método',
      dataIndex: 'payment_method',
      key: 'payment_method',
      width: 85,
      align: 'center',
      render: (m) => (
        <Tag color={m === 'PUE' ? 'cyan' : m === 'PAGO' ? 'blue' : 'orange'} className="text-[11px] px-1.5 m-0">
          {m || 'PUE'}
        </Tag>
      ),
    },
    {
      title: isEmitido ? 'Subtotal (Ingreso ISR)' : 'Subtotal (Deducción ISR)',
      dataIndex: 'subtotal',
      key: 'subtotal',
      align: 'right',
      width: 145,
      render: (val) => (
        <span className={`font-mono font-semibold ${isEmitido ? 'text-blue-700' : 'text-purple-700'}`}>
          {formatMoney(val)}
        </span>
      ),
    },
    {
      title: 'IVA',
      dataIndex: 'iva',
      key: 'iva',
      align: 'right',
      width: 110,
      render: (val) => <span className="font-mono text-xs text-gray-600">{formatMoney(val)}</span>,
    },
    {
      title: 'Ret. ISR',
      dataIndex: 'retencion_isr',
      key: 'retencion_isr',
      align: 'right',
      width: 110,
      render: (val) =>
        val > 0 ? <span className="font-mono font-bold text-emerald-700">{formatMoney(val)}</span> : '-',
    },
    {
      title: 'Total CFDI',
      dataIndex: 'total',
      key: 'total',
      align: 'right',
      width: 125,
      render: (val) => <span className="font-mono font-bold text-gray-900">{formatMoney(val)}</span>,
    },
  ];

  // Reemplazar la última fila de la cédula anual con los valores dinámicos editados en pantalla
  const cedulaMensualDisplay = useMemo(() => {
    if (!data?.cedula_mensual || !dynamicCalc) return [];
    return data.cedula_mensual.map((r) => {
      if (r.month !== month) return r;
      return {
        ...r,
        ingresos_mes: dynamicCalc.ingMesTotal,
        ingresos_acumulados: dynamicCalc.ingAcumulados,
        deducciones_mes: dynamicCalc.dedMesTotal,
        deducciones_acumuladas: dynamicCalc.dedAcumuladas,
        coeficiente_utilidad: dynamicCalc.cu,
        utilidad_fiscal: dynamicCalc.utilidadFiscal,
        base_gravable: dynamicCalc.baseGravable,
        tasa_aplicada: dynamicCalc.tasaAplicada,
        isr_causado: dynamicCalc.isrCausado,
        pagos_provisionales_anteriores: dynamicCalc.pagosProvPrevios,
        retenciones_isr_mes: dynamicCalc.retMes,
        retenciones_isr_acumuladas: dynamicCalc.retAcumuladas,
        isr_a_cargo: dynamicCalc.isrACargo,
      };
    });
  }, [data, dynamicCalc, month]);

  return (
    <div className="p-6 print:p-0">
      {/* Encabezado Principal */}
      <div className="flex flex-wrap justify-between items-center mb-4 print:hidden gap-4">
        <div>
          <Title level={2} className="m-0 flex items-center gap-2">
            <CalculatorOutlined className="text-indigo-600" />
            Papel de Trabajo — Cálculo de ISR Provisional
          </Title>
          {clientInfo && (
            <p className="text-gray-500 m-0 text-sm">
              Empresa: <span className="font-semibold text-gray-700">{clientInfo.business_name}</span> ({clientInfo.rfc})
              {data?.regime_info && (
                <Tag color="geekblue" className="ml-2 font-semibold text-xs">
                  {data.regime_info.short_name}
                </Tag>
              )}
            </p>
          )}
        </div>
        <Space wrap>
          <Button
            icon={<TableOutlined />}
            onClick={() => setTarifaModalVisible(true)}
            disabled={!data}
          >
            Ver Tablas / Tarifas LISR
          </Button>
          <Button
            type="primary"
            icon={<FileExcelOutlined />}
            onClick={handleExportExcel}
            disabled={!data}
            className="bg-emerald-600 hover:bg-emerald-700 border-emerald-600 font-semibold shadow-sm"
          >
            Exportar Excel (.xlsx)
          </Button>
          <Button
            type="primary"
            icon={<FilePdfOutlined />}
            onClick={handleExportPdf}
            disabled={!data}
            className="bg-sky-500 hover:bg-sky-600 border-sky-500 font-semibold shadow-sm"
            style={{ backgroundColor: '#0ea5e9', borderColor: '#0ea5e9', color: '#ffffff' }}
          >
            PDF Membretado
          </Button>
          <Button icon={<PrinterOutlined />} onClick={() => window.print()} size="middle">
            Imprimir
          </Button>
        </Space>
      </div>

      {/* Barra de Filtros: Año, Mes, Régimen y Póliza de Provisión */}
      <Card size="small" className="mb-4 shadow-sm bg-white print:hidden">
        <Row gutter={[12, 12]} align="middle">
          <Col xs={12} sm={4} md={2}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Ejercicio</label>
            <Select value={year} onChange={setYear} style={{ width: '100%' }}>
              {[2024, 2025, 2026, 2027].map((y) => (
                <Option key={y} value={y}>{y}</Option>
              ))}
            </Select>
          </Col>
          <Col xs={12} sm={6} md={4}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Mes de Declaración</label>
            <Select value={month} onChange={setMonth} style={{ width: '100%' }}>
              {monthNames.map((mName, idx) => (
                <Option key={idx + 1} value={idx + 1}>
                  {String(idx + 1).padStart(2, '0')} - {mName}
                </Option>
              ))}
            </Select>
          </Col>
          <Col xs={24} sm={14} md={8}>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-semibold text-gray-600">
                Modalidad / Régimen Fiscal LISR
              </label>
              <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                {allowedRegimeCodes.length > 1
                  ? '606 - Arrendamiento: Elija Ciega o Comprobada'
                  : `Régimen Registrado: ${data?.regime_info?.short_name || activeRegime}`}
              </span>
            </div>
            <Tooltip
              title={
                allowedRegimeCodes.length > 1
                  ? 'Para clientes en Arrendamiento (606) puede elegir entre Deducción Ciega (35% + Predial) o Deducción Comprobada (CFDI).'
                  : 'El régimen de cálculo corresponde exclusivamente al régimen fiscal con el que fue dado de alta el cliente.'
              }
            >
              <Select
                value={activeRegime}
                onChange={handleRegimeChange}
                disabled={allowedRegimeCodes.length <= 1}
                style={{ width: '100%' }}
              >
                {allowedRegimeCodes.map((code) => (
                  <Option key={code} value={code}>
                    {REGIME_OPTIONS_MAP[code] || code}
                  </Option>
                ))}
              </Select>
            </Tooltip>
          </Col>
          <Col xs={24} sm={24} md={10} className="flex flex-wrap justify-start md:justify-end items-end gap-2 pt-1 md:pt-5">
            {data?.provision_poliza && (
              <Tooltip title="Ver póliza de provisión de ISR generada en el visor">
                <a
                  href={`/journal-viewer/${data.provision_poliza.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center"
                >
                  <Tag color="success" className="font-semibold text-xs py-1 px-2.5 cursor-pointer border-emerald-300 flex items-center gap-1.5 shadow-sm">
                    <CheckCircleOutlined className="text-emerald-600" />
                    <span>Póliza Diario #{data.provision_poliza.entry_number} ({formatMoney(data.provision_poliza.amount)})</span>
                    <EyeOutlined className="text-[11px] text-emerald-700" />
                  </Tag>
                </a>
              </Tooltip>
            )}
            <Button
              type="primary"
              className="bg-indigo-600 hover:bg-indigo-700 border-indigo-600 font-semibold flex items-center gap-1.5 shadow-sm"
              icon={<SwapOutlined />}
              onClick={() => setProvisionModalVisible(true)}
              disabled={loading || !data || !dynamicCalc || dynamicCalc.isrACargo <= 0}
            >
              {data?.provision_poliza ? 'Actualizar Póliza Provisión ISR' : 'Generar Póliza Provisión ISR'}
            </Button>
          </Col>
        </Row>
      </Card>

      {error && <Alert message={error} type="error" className="mb-4 print:hidden" showIcon />}

      {loading ? (
        <div className="text-center py-12"><Spin size="large" /></div>
      ) : data && dynamicCalc ? (
        <>
          {/* Panel Interactivo de Parámetros Fiscales del Ejercicio / Periodo */}
          <Card
            size="small"
            className="mb-4 shadow-sm border-indigo-100 bg-indigo-50/20 print:hidden"
            title={
              <div className="flex flex-wrap justify-between items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-950 flex items-center gap-1.5">
                  <SettingOutlined className="text-indigo-600" />
                  Parámetros Fiscales del Papel de Trabajo ({monthNames[month - 1]} {year})
                </span>
                <div className="flex items-center gap-2">
                  {(activeRegime === '606_CIEGA' || activeRegime === '606_COMPROBADA') && (
                    <Space size={4}>
                      <Button
                        size="small"
                        type={activeRegime === '606_CIEGA' ? 'primary' : 'default'}
                        onClick={() => handleRegimeChange('606_CIEGA')}
                        className="text-[11px] font-semibold"
                      >
                        Opción A: Deducción Ciega (35% + Predial)
                      </Button>
                      <Button
                        size="small"
                        type={activeRegime === '606_COMPROBADA' ? 'primary' : 'default'}
                        onClick={() => handleRegimeChange('606_COMPROBADA')}
                        className="text-[11px] font-semibold"
                      >
                        Opción B: Deducción Comprobada (CFDI)
                      </Button>
                    </Space>
                  )}
                  <span className="text-[11px] text-gray-500 font-normal">
                    {data.regime_info?.fundamento}
                  </span>
                </div>
              </div>
            }
          >
            <Row gutter={[12, 12]} align="bottom">
              {activeRegime === '601' && (
                <Col xs={12} sm={6} md={4}>
                  <label className="block mb-1 text-xs font-semibold text-indigo-900">
                    Coeficiente de Utilidad (CU)
                  </label>
                  <InputNumber
                    value={coeficienteUtilidad}
                    onChange={(v) => setCoeficienteUtilidad(v || 0)}
                    min={0}
                    max={1}
                    step={0.0001}
                    precision={4}
                    style={{ width: '100%' }}
                    placeholder="Ej. 0.1450"
                  />
                </Col>
              )}

              {activeRegime === '625' && (
                <Col xs={24} sm={12} md={7}>
                  <label className="block mb-1 text-xs font-semibold text-indigo-900">
                    Actividad en Plataforma Digital (Art. 113-A LISR)
                  </label>
                  <Select
                    value={[1, 2.1, 4].includes(Number(coeficienteUtilidad)) ? Number(coeficienteUtilidad) : 2.1}
                    onChange={(v) => setCoeficienteUtilidad(v)}
                    style={{ width: '100%' }}
                  >
                    <Option value={2.1}>2.10% — Transporte terrestre de pasajeros y entrega de bienes</Option>
                    <Option value={4.0}>4.00% — Prestación de servicios de hospedaje (Airbnb / Booking)</Option>
                    <Option value={1.0}>1.00% — Enajenación de bienes y prestación de servicios (MercadoLibre / Amazon)</Option>
                  </Select>
                </Col>
              )}

              {!['626_PF', '625'].includes(activeRegime) && (
                <>
                  <Col xs={12} sm={6} md={4}>
                    <label className="block mb-1 text-xs font-semibold text-gray-700">
                      Pérdidas Fiscales por Amortizar ($)
                    </label>
                    <InputNumber
                      value={perdidasFiscales}
                      onChange={(v) => setPerdidasFiscales(v || 0)}
                      min={0}
                      step={1000}
                      precision={2}
                      style={{ width: '100%' }}
                      formatter={(value) => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      parser={(value) => value.replace(/\$\s?|(,*)/g, '')}
                    />
                  </Col>
                  {!['606_CIEGA', '606_COMPROBADA'].includes(activeRegime) && (
                    <Col xs={12} sm={6} md={3}>
                      <label className="block mb-1 text-xs font-semibold text-gray-700">
                        PTU Disminuible ($)
                      </label>
                      <InputNumber
                        value={ptuPagada}
                        onChange={(v) => setPtuPagada(v || 0)}
                        min={0}
                        step={500}
                        precision={2}
                        style={{ width: '100%' }}
                        formatter={(value) => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                        parser={(value) => value.replace(/\$\s?|(,*)/g, '')}
                      />
                    </Col>
                  )}
                </>
              )}

              <Col xs={12} sm={6} md={activeRegime === '625' ? 5 : 3}>
                <label className="block mb-1 text-xs font-semibold text-gray-700">
                  {activeRegime === '625'
                    ? 'Ingresos Directos de Usuarios ($)'
                    : 'Otros Ingresos Mes ($)'}
                </label>
                <InputNumber
                  value={ingresosAdicionales}
                  onChange={(v) => setIngresosAdicionales(v || 0)}
                  step={500}
                  precision={2}
                  style={{ width: '100%' }}
                  formatter={(value) => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(value) => value.replace(/\$\s?|(,*)/g, '')}
                />
              </Col>

              {['626_PM', '612', '606_CIEGA', '606_COMPROBADA'].includes(activeRegime) && (
                <Col xs={12} sm={6} md={4}>
                  <label className="block mb-1 text-xs font-semibold text-gray-700">
                    {activeRegime === '606_CIEGA'
                      ? 'Impuesto Predial Pagado ($)'
                      : activeRegime === '606_COMPROBADA'
                      ? 'Predial / Gastos Adicionales ($)'
                      : 'Deducción Adicional / Nómina ($)'}
                  </label>
                  <InputNumber
                    value={deduccionesAdicionales}
                    onChange={(v) => setDeduccionesAdicionales(v || 0)}
                    step={1000}
                    precision={2}
                    style={{ width: '100%' }}
                    formatter={(value) => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                    parser={(value) => value.replace(/\$\s?|(,*)/g, '')}
                  />
                </Col>
              )}

              {!dynamicCalc.isMonthlyNonCumulative && (
                <Col xs={12} sm={6} md={4}>
                  <Tooltip title="Se calcula automáticamente sumando el ISR a cargo de los meses anteriores del ejercicio. Captura un monto si deseas ajustarlo manualmente.">
                    <label className="block mb-1 text-xs font-semibold text-gray-700 cursor-help">
                      Pagos Prov. Anteriores ($)
                    </label>
                  </Tooltip>
                  <InputNumber
                    value={pagosProvManual !== null ? pagosProvManual : dynamicCalc.pagosProvPrevios}
                    onChange={(v) => setPagosProvManual(v)}
                    min={0}
                    step={500}
                    precision={2}
                    style={{ width: '100%' }}
                    formatter={(value) => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                    parser={(value) => value.replace(/\$\s?|(,*)/g, '')}
                  />
                </Col>
              )}

              <Col xs={12} sm={6} md={4}>
                <Tooltip title="Se extrae automáticamente de las retenciones de ISR en los CFDIs emitidos (10% Arrendamiento PM, 1.25% RESICO, o retención de Plataforma Tecnológica).">
                  <label className="block mb-1 text-xs font-semibold text-gray-700 cursor-help">
                    {activeRegime === '625'
                      ? 'ISR Retenido Plataforma ($)'
                      : activeRegime === '606_CIEGA' || activeRegime === '606_COMPROBADA'
                      ? 'ISR Retenido 10% PM ($)'
                      : 'ISR Retenido Mes ($)'}
                  </label>
                </Tooltip>
                <InputNumber
                  value={retencionesManual !== null ? retencionesManual : dynamicCalc.retMes}
                  onChange={(v) => setRetencionesManual(v)}
                  min={0}
                  step={100}
                  precision={2}
                  style={{ width: '100%' }}
                  formatter={(value) => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(value) => value.replace(/\$\s?|(,*)/g, '')}
                />
              </Col>

              <Col xs={24} sm={12} md={3}>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={savingParams}
                  onClick={handleSaveParameters}
                  style={{ width: '100%' }}
                  className="font-semibold"
                >
                  Guardar Parámetros
                </Button>
              </Col>
            </Row>

            {/* Comparativo Automático Arrendamiento: Deducción Ciega (35%) vs Deducción Comprobada (CFDI) */}
            {(activeRegime === '606_CIEGA' || activeRegime === '606_COMPROBADA') && dynamicCalc.extraArrendamiento && (
              <div className="mt-3 pt-3 border-t border-indigo-200 flex flex-wrap justify-between items-center gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="font-bold text-indigo-950">
                    Comparativo Fiscal Arrendamiento (Art. 115 LISR):
                  </span>
                  <span>
                    Deducción Ciega (35% + Predial):{' '}
                    <strong className="text-purple-800">{formatMoney(dynamicCalc.extraArrendamiento.total_ded_ciega)}</strong>
                    {' '}→ ISR a Cargo: <strong className="text-indigo-800">{formatMoney(dynamicCalc.extraArrendamiento.isr_ciega)}</strong>
                  </span>
                  <span>
                    Deducción Comprobada (CFDI):{' '}
                    <strong className="text-purple-800">{formatMoney(dynamicCalc.extraArrendamiento.total_ded_comprobada)}</strong>
                    {' '}→ ISR a Cargo: <strong className="text-indigo-800">{formatMoney(dynamicCalc.extraArrendamiento.isr_comprobada)}</strong>
                  </span>
                </div>
                <Tag color={dynamicCalc.extraArrendamiento.conviene_ciega ? 'green' : 'blue'} className="m-0 font-bold">
                  Recomendación: Conviene {dynamicCalc.extraArrendamiento.conviene_ciega ? 'Deducción Ciega (35%)' : 'Deducción Comprobada (CFDI)'}
                  {dynamicCalc.extraArrendamiento.ahorro_estimado > 0
                    ? ` (Ahorro: ${formatMoney(dynamicCalc.extraArrendamiento.ahorro_estimado)})`
                    : ''}
                </Tag>
              </div>
            )}
          </Card>

          {/* Aviso de Comprobantes Omitidos */}
          {omittedIds.length > 0 && (
            <Alert
              type="warning"
              showIcon
              className="mb-4 print:hidden shadow-sm border-amber-300"
              message={
                <div className="flex flex-wrap justify-between items-center gap-2">
                  <span>
                    <strong>Atención:</strong> Se han marcado <strong>{omittedIds.length}</strong> comprobante(s) para ser <strong>omitidos del cálculo de ISR</strong>.
                  </span>
                  <Button size="small" icon={<UndoOutlined />} onClick={resetOmitted} danger>
                    Restablecer todos (Incluir todos)
                  </Button>
                </div>
              }
            />
          )}

          {/* 4 Tarjetas Ejecutivas de Determinación de ISR */}
          <Row gutter={[16, 16]} className="mb-6">
            <Col xs={24} sm={12} lg={6}>
              <Card className="shadow-sm border-blue-200 bg-blue-50/30">
                <Statistic
                  title={
                    <span className="font-semibold text-blue-900 uppercase text-xs">
                      {activeRegime === '601'
                        ? 'INGRESOS NOMINALES ACUMULADOS'
                        : dynamicCalc.isMonthlyNonCumulative
                        ? 'INGRESOS COBRADOS DEL MES'
                        : 'INGRESOS COBRADOS ACUMULADOS'}
                    </span>
                  }
                  value={dynamicCalc.isMonthlyNonCumulative ? dynamicCalc.ingMesTotal : dynamicCalc.ingAcumulados}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#1d4ed8', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-600 flex justify-between">
                  <span>Mes actual: <strong>{formatMoney(dynamicCalc.ingMesTotal)}</strong></span>
                  <span>Acum.: {formatMoney(dynamicCalc.ingAcumulados)}</span>
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className="shadow-sm border-purple-200 bg-purple-50/30">
                <Statistic
                  title={
                    <span className="font-semibold text-purple-900 uppercase text-xs">
                      BASE GRAVABLE DE ISR
                    </span>
                  }
                  value={dynamicCalc.baseGravable}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#7e22ce', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-600">
                  {activeRegime === '601' ? (
                    <span>Coeficiente de Utilidad: <strong>{dynamicCalc.cu.toFixed(4)}</strong> ({(dynamicCalc.cu * 100).toFixed(2)}%)</span>
                  ) : activeRegime === '626_PF' ? (
                    <span>Sin deducciones (Art. 113-E LISR)</span>
                  ) : activeRegime === '606_CIEGA' ? (
                    <span>(-) Ded. Ciega 35% + Predial: <strong>{formatMoney(dynamicCalc.dedMesTotal)}</strong></span>
                  ) : activeRegime === '606_COMPROBADA' ? (
                    <span>(-) Deducción Comprobada Mes: <strong>{formatMoney(dynamicCalc.dedMesTotal)}</strong></span>
                  ) : activeRegime === '625' ? (
                    <span>{dynamicCalc.extraPlataformas?.actividad_nombre}</span>
                  ) : (
                    <span>(-) Deducciones Acum.: <strong>{formatMoney(dynamicCalc.dedAcumuladas)}</strong></span>
                  )}
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className="shadow-sm border-amber-200 bg-amber-50/30">
                <Statistic
                  title={
                    <span className="font-semibold text-amber-900 uppercase text-xs">
                      ISR CAUSADO ({dynamicCalc.tasaAplicada.toFixed(2)}%)
                    </span>
                  }
                  value={dynamicCalc.isrCausado}
                  precision={2}
                  prefix="$"
                  valueStyle={{ color: '#b45309', fontWeight: 'bold' }}
                />
                <div className="mt-2 text-xs text-gray-600 flex justify-between">
                  <span>(-) Pagos Ant.: <strong>{formatMoney(dynamicCalc.pagosProvPrevios)}</strong></span>
                  <span>(-) Ret. ISR: <strong>{formatMoney(dynamicCalc.retAcumuladas)}</strong></span>
                </div>
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card className={`shadow-sm border-2 ${dynamicCalc.isrACargo > 0 ? 'border-red-400 bg-red-50/40' : 'border-emerald-400 bg-emerald-50/40'}`}>
                <Statistic
                  title={
                    <span className={`font-bold uppercase text-xs ${dynamicCalc.isrACargo > 0 ? 'text-red-900' : 'text-emerald-900'}`}>
                      (=) ISR PROVISIONAL A CARGO
                    </span>
                  }
                  value={dynamicCalc.isrACargo}
                  precision={2}
                  prefix="$"
                  valueStyle={{
                    color: dynamicCalc.isrACargo > 0 ? '#dc2626' : '#16a34a',
                    fontWeight: 'bold',
                    fontSize: '1.5rem',
                  }}
                />
                <div className="mt-2 text-xs font-semibold text-gray-700">
                  {dynamicCalc.isrACargo > 0
                    ? 'Enterar antes del día 17 del mes siguiente'
                    : 'Impuesto cubierto con pagos previos / retenciones'}
                </div>
              </Card>
            </Col>
          </Row>

          {/* Cédula Paso a Paso y Conciliación Contable vs CFDI */}
          <Row gutter={[16, 16]} className="mb-6">
            <Col xs={24} lg={13}>
              <Card
                title={
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-gray-800">
                      Cédula de Determinación del Pago Provisional de ISR ({monthNames[month - 1]} {year})
                    </span>
                    <Tag color="blue" className="m-0">{data.regime_info?.short_name}</Tag>
                  </div>
                }
                size="small"
                className="shadow-sm h-full"
              >
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-gray-50 text-gray-600 font-bold">
                      <th className="py-2 px-2 text-left">Concepto / Determinación Fiscal</th>
                      <th className="py-2 px-2 text-right">Mes ({monthNames[month - 1].slice(0, 3)})</th>
                      <th className="py-2 px-2 text-right">Acumulado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {activeRegime === '601' ? (
                      <>
                        <tr>
                          <td className="py-2 px-2 text-gray-600">(+) Ingresos Nominales de Meses Anteriores</td>
                          <td className="py-2 px-2 text-right font-mono text-gray-400">-</td>
                          <td className="py-2 px-2 text-right font-mono">{formatMoney(dynamicCalc.ingAnteriores)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-2 text-gray-700">(+) Ingresos Nominales del Periodo</td>
                          <td className="py-2 px-2 text-right font-mono font-semibold text-blue-700">{formatMoney(dynamicCalc.ingMesTotal)}</td>
                          <td className="py-2 px-2 text-right font-mono">{formatMoney(dynamicCalc.ingMesTotal)}</td>
                        </tr>
                        <tr className="bg-blue-50/50 font-bold">
                          <td className="py-2 px-2 text-blue-950">(=) Total de Ingresos Nominales Acumulados</td>
                          <td className="py-2 px-2 text-right font-mono text-blue-900">{formatMoney(dynamicCalc.ingMesTotal)}</td>
                          <td className="py-2 px-2 text-right font-mono text-blue-900">{formatMoney(dynamicCalc.ingAcumulados)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-2 text-purple-900 font-medium">
                            (×) Coeficiente de Utilidad Aplicado ({dynamicCalc.cu.toFixed(4)})
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-gray-400">-</td>
                          <td className="py-2 px-2 text-right font-mono font-semibold text-purple-800">{formatMoney(dynamicCalc.utilidadFiscal)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-2 text-gray-600">(-) PTU Pagada y Pérdidas Fiscales de Ejercicios Anteriores</td>
                          <td className="py-2 px-2 text-right font-mono text-gray-400">-</td>
                          <td className="py-2 px-2 text-right font-mono text-gray-700">{formatMoney(dynamicCalc.ptu + dynamicCalc.perdidas + dynamicCalc.estimulos)}</td>
                        </tr>
                        <tr className="bg-purple-50/50 font-bold">
                          <td className="py-2 px-2 text-purple-950">(=) Base Gravable para el Pago Provisional</td>
                          <td className="py-2 px-2 text-right font-mono text-gray-400">-</td>
                          <td className="py-2 px-2 text-right font-mono text-purple-950">{formatMoney(dynamicCalc.baseGravable)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-2 text-gray-800 font-semibold">(×) Tasa de ISR Art. 9 LISR (30.00%) = ISR Causado</td>
                          <td className="py-2 px-2 text-right font-mono text-gray-400">-</td>
                          <td className="py-2 px-2 text-right font-mono font-bold text-amber-800">{formatMoney(dynamicCalc.isrCausado)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-2 text-gray-600">(-) Pagos Provisionales Efectuados con Anterioridad</td>
                          <td className="py-2 px-2 text-right font-mono text-gray-400">-</td>
                          <td className="py-2 px-2 text-right font-mono text-emerald-700">{formatMoney(dynamicCalc.pagosProvPrevios)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-2 text-gray-600">(-) ISR Retenido al Contribuyente Acumulado</td>
                          <td className="py-2 px-2 text-right font-mono text-emerald-700">{formatMoney(dynamicCalc.retMes)}</td>
                          <td className="py-2 px-2 text-right font-mono text-emerald-700">{formatMoney(dynamicCalc.retAcumuladas)}</td>
                        </tr>
                      </>
                    ) : activeRegime === '626_PF' ? (
                      <>
                        <tr className="bg-blue-50/50 font-bold">
                          <td className="py-2 px-2 text-blue-950">(+) Ingresos Efectivamente Cobrados en el Mes (Sin IVA)</td>
                          <td className="py-2 px-2 text-right font-mono text-blue-900">{formatMoney(dynamicCalc.ingMesTotal)}</td>
                          <td className="py-2 px-2 text-right font-mono text-blue-900">{formatMoney(dynamicCalc.ingAcumulados)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-2 text-purple-900 font-medium">
                            (×) Tasa Mensual Tabla RESICO Art. 113-E LISR ({dynamicCalc.tasaAplicada.toFixed(2)}%)
                          </td>
                          <td className="py-2 px-2 text-right font-mono font-bold text-amber-800">{formatMoney(dynamicCalc.isrCausado)}</td>
                          <td className="py-2 px-2 text-right font-mono text-gray-500">-</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-2 text-gray-600">
                            (-) ISR Retenido por Personas Morales en el Mes (1.25% Art. 113-J LISR)
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-emerald-700">{formatMoney(dynamicCalc.retMes)}</td>
                          <td className="py-2 px-2 text-right font-mono text-emerald-700">{formatMoney(dynamicCalc.retMes)}</td>
                        </tr>
                      </>
                    ) : activeRegime === '606_CIEGA' || activeRegime === '606_COMPROBADA' ? (
                      <>
                        <tr className="bg-blue-50/50 font-bold">
                          <td className="py-2 px-2 text-blue-950">(+) Ingresos por Arrendamiento Cobrados en el Mes (Art. 114 LISR)</td>
                          <td className="py-2 px-2 text-right font-mono text-blue-900">{formatMoney(dynamicCalc.ingMesTotal)}</td>
                          <td className="py-2 px-2 text-right font-mono text-blue-900">{formatMoney(dynamicCalc.ingAcumulados)}</td>
                        </tr>
                        {activeRegime === '606_CIEGA' && dynamicCalc.extraArrendamiento ? (
                          <>
                            <tr>
                              <td className="py-2 px-2 text-purple-900 font-medium">
                                (-) Deducción Opcional "Ciega" del 35% (Art. 115 Párr. 2 LISR)
                              </td>
                              <td className="py-2 px-2 text-right font-mono text-purple-700">
                                {formatMoney(dynamicCalc.extraArrendamiento.deduccion_ciega_35)}
                              </td>
                              <td className="py-2 px-2 text-right font-mono text-gray-400">-</td>
                            </tr>
                            <tr>
                              <td className="py-2 px-2 text-gray-600">
                                (-) Impuesto Predial Pagado en el Periodo (Art. 115 Fracc. I LISR)
                              </td>
                              <td className="py-2 px-2 text-right font-mono text-purple-700">
                                {formatMoney(dynamicCalc.extraArrendamiento.impuesto_predial)}
                              </td>
                              <td className="py-2 px-2 text-right font-mono text-gray-400">-</td>
                            </tr>
                          </>
                        ) : (
                          <>
                            <tr>
                              <td className="py-2 px-2 text-gray-600">
                                (-) Gastos de Mantenimiento, Predial y Erogaciones con CFDI (Art. 115 LISR)
                              </td>
                              <td className="py-2 px-2 text-right font-mono text-purple-700">
                                {formatMoney(dynamicCalc.baseDedGastosMes + dynamicCalc.dedAdicMes)}
                              </td>
                              <td className="py-2 px-2 text-right font-mono text-purple-700">
                                {formatMoney(dynamicCalc.dedAcumuladas - Number(data.summary?.depreciacion_acumulada || 0))}
                              </td>
                            </tr>
                            <tr>
                              <td className="py-2 px-2 text-gray-600">
                                (-) Deducción de Inversiones / Construcciones (Art. 115 Fracc. VI LISR)
                              </td>
                              <td className="py-2 px-2 text-right font-mono text-purple-700">{formatMoney(dynamicCalc.depMes)}</td>
                              <td className="py-2 px-2 text-right font-mono text-purple-700">
                                {formatMoney(Number(data.summary?.depreciacion_acumulada || 0))}
                              </td>
                            </tr>
                          </>
                        )}
                        {dynamicCalc.perdidas > 0 && (
                          <tr>
                            <td className="py-2 px-2 text-gray-600">(-) Pérdidas Fiscales por Amortizar</td>
                            <td className="py-2 px-2 text-right font-mono">{formatMoney(dynamicCalc.perdidas)}</td>
                            <td className="py-2 px-2 text-right font-mono text-gray-400">-</td>
                          </tr>
                        )}
                        <tr className="bg-purple-50/50 font-bold">
                          <td className="py-2 px-2 text-purple-950">(=) Base Gravable Mensual de Arrendamiento (Art. 116 LISR)</td>
                          <td className="py-2 px-2 text-right font-mono text-purple-950">{formatMoney(dynamicCalc.baseGravable)}</td>
                          <td className="py-2 px-2 text-right font-mono text-gray-400">-</td>
                        </tr>
                        {dynamicCalc.extraArt96 && (
                          <tr className="bg-amber-50/40">
                            <td className="py-2 px-2 text-amber-950">
                              Tarifa Mensual Art. 116 LISR: Lím. Inf. {formatMoney(dynamicCalc.extraArt96.limite_inferior)} | Excedente × {dynamicCalc.extraArt96.tasa_excedente}% + Cuota Fija {formatMoney(dynamicCalc.extraArt96.cuota_fija)}
                            </td>
                            <td className="py-2 px-2 text-right font-mono font-bold text-amber-800">{formatMoney(dynamicCalc.isrCausado)}</td>
                            <td className="py-2 px-2 text-right font-mono text-gray-400">-</td>
                          </tr>
                        )}
                        <tr>
                          <td className="py-2 px-2 text-gray-600">
                            (-) ISR Retenido por Personas Morales Arrendatarias (10% Art. 116 LISR)
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-emerald-700">{formatMoney(dynamicCalc.retMes)}</td>
                          <td className="py-2 px-2 text-right font-mono text-emerald-700">{formatMoney(dynamicCalc.retMes)}</td>
                        </tr>
                      </>
                    ) : activeRegime === '625' ? (
                      <>
                        <tr>
                          <td className="py-2 px-2 text-gray-700">
                            (+) Ingresos Obtenidos Mediante Intermediarios / Plataformas Digitales
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-blue-700">{formatMoney(dynamicCalc.baseIngMes)}</td>
                          <td className="py-2 px-2 text-right font-mono text-blue-700">
                            {formatMoney(dynamicCalc.ingAcumulados - dynamicCalc.ingAdicMes)}
                          </td>
                        </tr>
                        <tr>
                          <td className="py-2 px-2 text-gray-700">
                            (+) Ingresos Cobrados Directamente de los Usuarios (Art. 113-B LISR)
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-blue-700">{formatMoney(dynamicCalc.ingAdicMes)}</td>
                          <td className="py-2 px-2 text-right font-mono text-blue-700">{formatMoney(dynamicCalc.ingAdicMes)}</td>
                        </tr>
                        <tr className="bg-blue-50/50 font-bold">
                          <td className="py-2 px-2 text-blue-950">(=) Total de Ingresos Mensuales por Plataformas Tecnológicas</td>
                          <td className="py-2 px-2 text-right font-mono text-blue-900">{formatMoney(dynamicCalc.ingMesTotal)}</td>
                          <td className="py-2 px-2 text-right font-mono text-blue-900">{formatMoney(dynamicCalc.ingAcumulados)}</td>
                        </tr>
                        <tr className="bg-amber-50/40">
                          <td className="py-2 px-2 text-amber-950 font-medium">
                            (×) Tasa Art. 113-A LISR ({dynamicCalc.tasaAplicada.toFixed(2)}% — {dynamicCalc.extraPlataformas?.actividad_nombre})
                          </td>
                          <td className="py-2 px-2 text-right font-mono font-bold text-amber-800">{formatMoney(dynamicCalc.isrCausado)}</td>
                          <td className="py-2 px-2 text-right font-mono text-gray-400">-</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-2 text-gray-600">
                            (-) ISR Retenido por la Plataforma Tecnológica (Constancia CFDI)
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-emerald-700">{formatMoney(dynamicCalc.retMes)}</td>
                          <td className="py-2 px-2 text-right font-mono text-emerald-700">{formatMoney(dynamicCalc.retMes)}</td>
                        </tr>
                      </>
                    ) : (
                      <>
                        <tr>
                          <td className="py-2 px-2 text-gray-700 font-medium">(+) Ingresos Efectivamente Cobrados</td>
                          <td className="py-2 px-2 text-right font-mono text-blue-700">{formatMoney(dynamicCalc.ingMesTotal)}</td>
                          <td className="py-2 px-2 text-right font-mono font-semibold text-blue-800">{formatMoney(dynamicCalc.ingAcumulados)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-2 text-gray-600">(-) Compras y Gastos Efectivamente Pagados</td>
                          <td className="py-2 px-2 text-right font-mono text-purple-700">{formatMoney(dynamicCalc.baseDedGastosMes + dynamicCalc.dedAdicMes)}</td>
                          <td className="py-2 px-2 text-right font-mono text-purple-700">{formatMoney(dynamicCalc.dedAcumuladas - Number(data.summary?.depreciacion_acumulada || 0))}</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-2 text-gray-600">(-) Deducción de Inversiones (Depreciación Fiscal)</td>
                          <td className="py-2 px-2 text-right font-mono text-purple-700">{formatMoney(dynamicCalc.depMes)}</td>
                          <td className="py-2 px-2 text-right font-mono text-purple-700">{formatMoney(Number(data.summary?.depreciacion_acumulada || 0))}</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-2 text-gray-600">(-) PTU Pagada y Pérdidas Fiscales de Ejercicios Anteriores</td>
                          <td className="py-2 px-2 text-right font-mono text-gray-400">-</td>
                          <td className="py-2 px-2 text-right font-mono">{formatMoney(dynamicCalc.ptu + dynamicCalc.perdidas + dynamicCalc.estimulos)}</td>
                        </tr>
                        <tr className="bg-purple-50/50 font-bold">
                          <td className="py-2 px-2 text-purple-950">(=) Base Gravable Acumulada para ISR</td>
                          <td className="py-2 px-2 text-right font-mono text-gray-500">-</td>
                          <td className="py-2 px-2 text-right font-mono text-purple-950">{formatMoney(dynamicCalc.baseGravable)}</td>
                        </tr>
                        {activeRegime === '612' && dynamicCalc.extraArt96 && (
                          <tr className="bg-amber-50/40">
                            <td className="py-2 px-2 text-amber-950">
                              Tarifa Art. 96 LISR ({month} meses): Lím. Inf. {formatMoney(dynamicCalc.extraArt96.limite_inferior)} | Excedente × {dynamicCalc.extraArt96.tasa_excedente}% + Cuota Fija {formatMoney(dynamicCalc.extraArt96.cuota_fija)}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-gray-400">-</td>
                            <td className="py-2 px-2 text-right font-mono font-bold text-amber-800">{formatMoney(dynamicCalc.isrCausado)}</td>
                          </tr>
                        )}
                        {activeRegime === '626_PM' && (
                          <tr>
                            <td className="py-2 px-2 text-gray-800 font-semibold">(×) Tasa de ISR Art. 9 LISR (30.00%) = ISR Causado</td>
                            <td className="py-2 px-2 text-right font-mono text-gray-400">-</td>
                            <td className="py-2 px-2 text-right font-mono font-bold text-amber-800">{formatMoney(dynamicCalc.isrCausado)}</td>
                          </tr>
                        )}
                        <tr>
                          <td className="py-2 px-2 text-gray-600">(-) Pagos Provisionales Efectuados con Anterioridad</td>
                          <td className="py-2 px-2 text-right font-mono text-gray-400">-</td>
                          <td className="py-2 px-2 text-right font-mono text-emerald-700">{formatMoney(dynamicCalc.pagosProvPrevios)}</td>
                        </tr>
                        <tr>
                          <td className="py-2 px-2 text-gray-600">(-) ISR Retenido Acreditable Acumulado</td>
                          <td className="py-2 px-2 text-right font-mono text-emerald-700">{formatMoney(dynamicCalc.retMes)}</td>
                          <td className="py-2 px-2 text-right font-mono text-emerald-700">{formatMoney(dynamicCalc.retAcumuladas)}</td>
                        </tr>
                      </>
                    )}
                    <tr className={`${dynamicCalc.isrACargo > 0 ? 'bg-red-50 text-red-900' : 'bg-emerald-50 text-emerald-900'} font-bold text-sm`}>
                      <td className="py-2.5 px-2">(=) ISR PROVISIONAL A CARGO DEL PERIODO</td>
                      <td className="py-2.5 px-2 text-right font-mono">{formatMoney(dynamicCalc.isrACargo)}</td>
                      <td className="py-2.5 px-2 text-right font-mono">{formatMoney(dynamicCalc.isrACargo)}</td>
                    </tr>
                  </tbody>
                </table>
              </Card>
            </Col>

            <Col xs={24} lg={11}>
              <Card
                title="Conciliación Contable vs. Bóveda CFDI del Mes"
                size="small"
                className="shadow-sm h-full"
              >
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-gray-50 text-gray-600 font-bold">
                      <th className="py-2 px-2 text-left">Rubro / Cuenta Contable / CFDI</th>
                      <th className="py-2 px-2 text-right">Importe del Mes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    <tr>
                      <td className="py-2 px-2 text-gray-600">401-00-000 Ingresos Contables Devengados</td>
                      <td className="py-2 px-2 text-right font-mono font-semibold">{formatMoney(data.contabilidad?.cta_401_ingresos)}</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-2 text-gray-600">702-00-000 Productos Financieros (Intereses a favor)</td>
                      <td className="py-2 px-2 text-right font-mono">{formatMoney(data.contabilidad?.cta_702_productos_fin)}</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-2 text-blue-800 font-medium">CFDI Emitidos Nominales (Subtotal PUE + PPD)</td>
                      <td className="py-2 px-2 text-right font-mono font-semibold text-blue-700">{formatMoney(data.cfdi_totals?.emitidos_nominal_subtotal)}</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-2 text-blue-800 font-medium">CFDI Emitidos Efectivamente Cobrados (Subtotal)</td>
                      <td className="py-2 px-2 text-right font-mono font-semibold text-blue-700">{formatMoney(activeEmitidosTotals.subtotal)}</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-2 text-gray-600">501 / 601 Costos y Gastos Contables del Mes</td>
                      <td className="py-2 px-2 text-right font-mono">
                        {formatMoney((data.contabilidad?.cta_501_costos || 0) + (data.contabilidad?.cta_601_gastos || 0))}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 px-2 text-purple-800 font-medium">CFDI Recibidos Efectivamente Pagados (Subtotal)</td>
                      <td className="py-2 px-2 text-right font-mono font-semibold text-purple-700">{formatMoney(activeRecibidosTotals.subtotal)}</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-2 text-purple-800 font-medium">Depreciación Fiscal de Inversiones del Mes</td>
                      <td className="py-2 px-2 text-right font-mono font-semibold text-purple-700">{formatMoney(data.contabilidad?.depreciacion_inversiones_mes)}</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-2 text-emerald-800 font-medium">ISR Retenido en CFDI Emitidos del Mes</td>
                      <td className="py-2 px-2 text-right font-mono font-bold text-emerald-700">{formatMoney(activeEmitidosTotals.retencion_isr)}</td>
                    </tr>
                  </tbody>
                </table>
              </Card>
            </Col>
          </Row>

          {/* Pestañas: 1) Cédula Anual Acumulada, 2) CFDI Ingresos, 3) CFDI Deducciones */}
          <Card size="small" className="shadow-sm">
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  key: 'cedula',
                  label: (
                    <span
                      className="font-semibold text-sm px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-all"
                      style={
                        activeTab === 'cedula'
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
                      <CalendarOutlined />
                      Cédula Anual Acumulada (Enero a {monthNames[month - 1]} {year})
                    </span>
                  ),
                  children: (
                    <div>
                      <div className="text-xs text-gray-500 mb-3">
                        Evolución acumulada mes por mes de los pagos provisionales de ISR durante el ejercicio fiscal {year} bajo el régimen <strong>{data.regime_info?.name}</strong>.
                      </div>
                      <Table
                        columns={cedulaColumns}
                        dataSource={cedulaMensualDisplay}
                        rowKey="month"
                        pagination={false}
                        size="small"
                        bordered
                        scroll={{ x: 1100 }}
                        rowClassName={(r) => (r.month === month ? 'bg-indigo-50/60 font-semibold' : '')}
                      />
                    </div>
                  ),
                },
                {
                  key: 'emitidos',
                  label: (
                    <span
                      className="font-semibold text-sm px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-all"
                      style={
                        activeTab === 'emitidos'
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
                      <ArrowUpOutlined />
                      CFDI de Ingresos y Retenciones ISR ({activeEmitidosAll.length} de {emitidosAll.length})
                    </span>
                  ),
                  children: (
                    <div>
                      <div className="flex flex-wrap justify-between items-center mb-3 gap-2">
                        <div className="text-xs text-gray-500">
                          {activeRegime === '601'
                            ? 'Comprobantes fiscales emitidos devengados en el mes (PUE y PPD conforme al Art. 17 LISR).'
                            : 'Comprobantes fiscales emitidos efectivamente cobrados en el mes (Flujo de efectivo).'}
                        </div>
                        <Input
                          placeholder="Buscar por RFC, cliente o folio..."
                          prefix={<SearchOutlined className="text-gray-400" />}
                          value={searchEmitidos}
                          onChange={(e) => setSearchEmitidos(e.target.value)}
                          style={{ width: 280 }}
                          size="small"
                          allowClear
                        />
                      </div>
                      <Table
                        columns={invoiceColumns(true)}
                        dataSource={emitidos}
                        rowKey="id"
                        pagination={{ pageSize: 15 }}
                        size="small"
                        bordered
                        rowClassName={(record) => (omittedIds.includes(record.id) ? 'bg-amber-50/50 opacity-60' : '')}
                        summary={() => (
                          <Table.Summary.Row className="bg-blue-50/60 font-bold text-xs">
                            <Table.Summary.Cell index={0} colSpan={6} align="right">
                              TOTAL CFDI EMITIDOS ACTIVOS ({activeEmitidosAll.length} comprobantes):
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={1} align="right" className="font-mono text-blue-800">
                              {formatMoney(activeEmitidosTotals.subtotal)}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={2} align="right" className="font-mono">
                              {formatMoney(activeEmitidosTotals.iva)}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={3} align="right" className="font-mono text-emerald-700">
                              {formatMoney(activeEmitidosTotals.retencion_isr)}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={4} align="right" className="font-mono">
                              {formatMoney(activeEmitidosTotals.total)}
                            </Table.Summary.Cell>
                          </Table.Summary.Row>
                        )}
                      />
                    </div>
                  ),
                },
                {
                  key: 'recibidos',
                  label: (
                    <span
                      className="font-semibold text-sm px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-all"
                      style={
                        activeTab === 'recibidos'
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
                      <ArrowDownOutlined />
                      CFDI Deducciones Autorizadas ({activeRecibidosAll.length} de {recibidosAll.length})
                    </span>
                  ),
                  children: (
                    <div>
                      <div className="flex flex-wrap justify-between items-center mb-3 gap-2">
                        <div className="text-xs text-gray-500">
                          Comprobantes de compras y gastos efectivamente pagados en el mes (excluye activos fijos `I01..I08`, los cuales se deducen vía depreciación mensual).
                        </div>
                        <Input
                          placeholder="Buscar por RFC, proveedor o folio..."
                          prefix={<SearchOutlined className="text-gray-400" />}
                          value={searchRecibidos}
                          onChange={(e) => setSearchRecibidos(e.target.value)}
                          style={{ width: 280 }}
                          size="small"
                          allowClear
                        />
                      </div>
                      <Table
                        columns={invoiceColumns(false)}
                        dataSource={recibidos}
                        rowKey="id"
                        pagination={{ pageSize: 15 }}
                        size="small"
                        bordered
                        rowClassName={(record) => (omittedIds.includes(record.id) ? 'bg-amber-50/50 opacity-60' : '')}
                        summary={() => (
                          <Table.Summary.Row className="bg-purple-50/60 font-bold text-xs">
                            <Table.Summary.Cell index={0} colSpan={6} align="right">
                              TOTAL DEDUCCIONES CFDI PAGADAS ({activeRecibidosAll.length} comprobantes):
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={1} align="right" className="font-mono text-purple-800">
                              {formatMoney(activeRecibidosTotals.subtotal)}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={2} align="right" className="font-mono">
                              {formatMoney(activeRecibidosTotals.iva)}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={3} align="right" className="font-mono">
                              {formatMoney(activeRecibidosTotals.retencion_isr)}
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={4} align="right" className="font-mono">
                              {formatMoney(activeRecibidosTotals.total)}
                            </Table.Summary.Cell>
                          </Table.Summary.Row>
                        )}
                      />
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        </>
      ) : null}

      {/* Modal para Generar Póliza Contable de Provisión de ISR Provisional */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-indigo-900 text-base font-bold">
            <SwapOutlined />
            <span>Póliza de Provisión Mensual de ISR — {monthNames[month - 1]} {year}</span>
          </div>
        }
        open={provisionModalVisible}
        onCancel={() => setProvisionModalVisible(false)}
        width={680}
        footer={[
          <Button key="cancel" onClick={() => setProvisionModalVisible(false)}>
            Cancelar
          </Button>,
          <Button
            key="submit"
            type="primary"
            className="bg-indigo-600 hover:bg-indigo-700 border-indigo-600 font-semibold"
            loading={generatingProvision}
            onClick={handleExecuteProvision}
          >
            {data?.provision_poliza ? 'Confirmar y Actualizar Póliza' : 'Confirmar y Generar Póliza'}
          </Button>,
        ]}
      >
        {dynamicCalc && (
          <div className="py-2 text-sm">
            <div className="bg-gray-50 border border-gray-200 rounded p-3 mb-4 space-y-1 text-xs">
              <div><strong>Empresa:</strong> {clientInfo?.business_name} ({clientInfo?.rfc})</div>
              <div><strong>Régimen Fiscal:</strong> {data?.regime_info?.name}</div>
              <div><strong>Tipo de Póliza:</strong> Póliza de Diario (Cierre mensual de impuestos)</div>
              <div>
                <strong>Fecha Contable:</strong>{' '}
                <span className="font-semibold text-indigo-800">
                  {new Date(year, month, 0).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </span>
              </div>
              <div><strong>Concepto:</strong> <span className="font-semibold">Provisión de ISR Provisional del mes de {monthNames[month - 1]} {year}</span></div>
            </div>

            <div className="border border-gray-200 rounded overflow-hidden mb-4 shadow-sm">
              <table className="w-full text-xs">
                <thead className="bg-indigo-50 text-indigo-950 font-bold border-b border-indigo-100">
                  <tr>
                    <th className="py-2 px-3 text-left">Cuenta Contable</th>
                    <th className="py-2 px-3 text-left">Concepto del Movimiento</th>
                    <th className="py-2 px-3 text-right">Debe (Cargo)</th>
                    <th className="py-2 px-3 text-right">Haber (Abono)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr>
                    <td className="py-2.5 px-3 font-mono font-semibold text-gray-800">611-01-000</td>
                    <td className="py-2.5 px-3 text-gray-700">Impuesto Sobre la Renta (Provisión de ISR del mes)</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-indigo-700">
                      {formatMoney(dynamicCalc.isrACargo)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-gray-400">-</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-mono font-semibold text-gray-800">213-02-000</td>
                    <td className="py-2.5 px-3 text-gray-700">ISR por pagar (Pasivo de pago provisional mensual)</td>
                    <td className="py-2.5 px-3 text-right font-mono text-gray-400">-</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-red-700">
                      {formatMoney(dynamicCalc.isrACargo)}
                    </td>
                  </tr>
                </tbody>
                <tfoot className="bg-gray-100 font-bold border-t border-gray-300">
                  <tr>
                    <td colSpan={2} className="py-2 px-3 text-right text-emerald-700">SUMAS IGUALES:</td>
                    <td className="py-2 px-3 text-right font-mono">{formatMoney(dynamicCalc.isrACargo)}</td>
                    <td className="py-2 px-3 text-right font-mono">{formatMoney(dynamicCalc.isrACargo)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal de Tablas y Tarifas Oficiales LISR (Art. 96 acumulada, Art. 116 mensual, RESICO Art. 113-E y Plataformas Art. 113-A) */}
      <Modal
        title={`Tablas y Tarifas Oficiales LISR — ${monthNames[month - 1]} ${year}`}
        open={tarifaModalVisible}
        onCancel={() => setTarifaModalVisible(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setTarifaModalVisible(false)}>
            Cerrar
          </Button>,
        ]}
        width={780}
      >
        <div className="space-y-4 text-xs">
          <div>
            <div className="font-bold text-indigo-900 mb-2">
              {activeRegime === '606_CIEGA' || activeRegime === '606_COMPROBADA'
                ? `1. Tarifa Mensual Unitaria Art. 116 LISR para Arrendamiento (1 Mes — Anexo 8 RMF)`
                : `1. Tarifa Acumulada Art. 96 LISR para ${monthNames[month - 1]} (${month} mes(es) — Régimen 612 PF)`}
            </div>
            <table className="w-full border border-gray-200 text-xs">
              <thead className="bg-gray-100 font-bold">
                <tr>
                  <th className="py-1.5 px-2 text-right border-b">Límite Inferior ($)</th>
                  <th className="py-1.5 px-2 text-right border-b">Límite Superior ($)</th>
                  <th className="py-1.5 px-2 text-right border-b">Cuota Fija ($)</th>
                  <th className="py-1.5 px-2 text-right border-b">% Sobre Excedente</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-mono">
                {((activeRegime === '606_CIEGA' || activeRegime === '606_COMPROBADA'
                  ? data?.tarifa_art96_unitaria
                  : data?.tarifa_art96_mes) || []).map((row, i) => (
                  <tr key={i} className={dynamicCalc?.extraArt96?.limite_inferior === row.lim_inf ? 'bg-amber-100 font-bold' : ''}>
                    <td className="py-1 px-2 text-right">{formatMoney(row.lim_inf)}</td>
                    <td className="py-1 px-2 text-right">{row.lim_sup ? formatMoney(row.lim_sup) : 'En adelante'}</td>
                    <td className="py-1 px-2 text-right">{formatMoney(row.cuota_fija)}</td>
                    <td className="py-1 px-2 text-right">{Number(row.tasa_excedente).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <div className="font-bold text-emerald-900 mb-2">
              2. Tabla Mensual RESICO Personas Físicas Art. 113-E LISR (Régimen 626 PF)
            </div>
            <table className="w-full border border-gray-200 text-xs">
              <thead className="bg-gray-100 font-bold">
                <tr>
                  <th className="py-1.5 px-2 text-right border-b">Límite Inferior Mensual ($)</th>
                  <th className="py-1.5 px-2 text-right border-b">Hasta Ingresos Cobrados ($)</th>
                  <th className="py-1.5 px-2 text-right border-b">Tasa Fija RESICO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-mono">
                {(data?.tabla_resico_pf || []).map((row, i) => (
                  <tr key={i} className={dynamicCalc?.extraResicoPf?.lim_sup === row.lim_sup ? 'bg-emerald-100 font-bold' : ''}>
                    <td className="py-1 px-2 text-right">{formatMoney(row.lim_inf)}</td>
                    <td className="py-1 px-2 text-right">{formatMoney(row.lim_sup)}</td>
                    <td className="py-1 px-2 text-right">{Number(row.tasa).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <div className="font-bold text-purple-900 mb-2">
              3. Tasas de Retención y Pago de Plataformas Tecnológicas Art. 113-A LISR (Régimen 625 PF)
            </div>
            <table className="w-full border border-gray-200 text-xs">
              <thead className="bg-gray-100 font-bold">
                <tr>
                  <th className="py-1.5 px-2 text-left border-b">Actividad Económica en Plataforma Digital</th>
                  <th className="py-1.5 px-2 text-left border-b">Fundamento LISR</th>
                  <th className="py-1.5 px-2 text-right border-b">Tasa ISR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(data?.tabla_plataformas || [
                  { code: 'TRANSPORTE', label: 'Prestación de servicios de transporte terrestre de pasajeros y de entrega de bienes', tasa: 2.1, fundamento: 'Art. 113-A Fracc. I LISR' },
                  { code: 'HOSPEDAJE', label: 'Prestación de servicios de hospedaje', tasa: 4.0, fundamento: 'Art. 113-A Fracc. II LISR' },
                  { code: 'ENAJENACION', label: 'Enajenación de bienes y prestación de servicios', tasa: 1.0, fundamento: 'Art. 113-A Fracc. III LISR' },
                ]).map((row, i) => (
                  <tr key={i} className={activeRegime === '625' && Number(dynamicCalc?.tasaAplicada) === Number(row.tasa) ? 'bg-purple-100 font-bold' : ''}>
                    <td className="py-1 px-2 text-left">{row.label}</td>
                    <td className="py-1 px-2 text-left font-mono text-[11px]">{row.fundamento}</td>
                    <td className="py-1 px-2 text-right font-mono">{Number(row.tasa).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default FiscalIsr;
