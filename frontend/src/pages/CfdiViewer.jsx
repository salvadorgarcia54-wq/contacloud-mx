import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Spin, Alert, Button, QRCode, message, Tooltip } from 'antd';
import { 
  PrinterOutlined, 
  DownloadOutlined, 
  SafetyCertificateOutlined, 
  CloseOutlined, 
  FileTextOutlined,
  CheckCircleOutlined
} from '@ant-design/icons';
import { cfdiApi } from '../api/client';

export default function CfdiViewer() {
  const { uuid } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!uuid) return;
    setLoading(true);
    cfdiApi.getViewerData(uuid)
      .then(res => {
        setData(res.data);
        setError(null);
        document.title = `CFDI ${res.data?.documento?.full_folio || uuid}`;
      })
      .catch(err => {
        console.error('Error al cargar CFDI para visor:', err);
        setError(err?.response?.data?.detail || 'No se pudo cargar la información del CFDI.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [uuid]);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadXml = () => {
    if (!data?.raw_xml) {
      message.info('El archivo XML original no está disponible para descarga directa.');
      return;
    }
    const blob = new Blob([data.raw_xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.documento?.serie || ''}${data.documento?.folio || data.timbre?.uuid || 'CFDI'}.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    message.success('Archivo XML descargado exitosamente');
  };

  const formatMoney = (val) => {
    const num = Number(val) || 0;
    return num.toLocaleString('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  const formatDate = (isoStr) => {
    if (!isoStr) return '-';
    // Format YYYY-MM-DDTHH:mm:ss to DD-MM-YYYY HH:mm:ss
    try {
      const parts = isoStr.split('T');
      if (parts.length === 2) {
        const [y, m, d] = parts[0].split('-');
        return `${d}-${m}-${y} ${parts[1]}`;
      }
      return isoStr;
    } catch {
      return isoStr;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6">
        <Spin size="large" />
        <span className="mt-4 text-gray-600 font-medium">Generando representación impresa del CFDI...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-white p-6 rounded-lg shadow">
          <Alert
            message="Comprobante no disponible"
            description={error || 'No se encontró información para el identificador proporcionado.'}
            type="error"
            showIcon
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => window.close()}>Cerrar</Button>
            <Button type="primary" onClick={() => navigate('/')}>Ir al Inicio</Button>
          </div>
        </div>
      </div>
    );
  }

  const {
    documento = {},
    emisor = {},
    receptor = {},
    cfdi_relacionado = {},
    timbre = {},
    conceptos = [],
    totales = {},
    sellos = {},
    nomina = null,
    qr_url = ''
  } = data;

  return (
    <div className="min-h-screen bg-slate-200 py-4 px-2 print:p-0 print:bg-white text-slate-800">
      <style>{`
        @media print {
          body {
            background-color: white !important;
            color: black !important;
          }
          .no-print {
            display: none !important;
          }
          .cfdi-sheet {
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
            max-width: 100% !important;
            width: 100% !important;
            border: none !important;
          }
        }
      `}</style>

      {/* Floating Action Bar (Top) */}
      <header className="no-print max-w-[960px] mx-auto mb-3 bg-white p-2.5 rounded-lg shadow-sm border border-slate-300 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <FileTextOutlined className="text-blue-600 text-lg" />
          <span className="font-bold text-gray-800 text-sm">Visor de CFDI 4.0</span>
          <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-mono font-medium">
            {documento.full_folio || timbre.uuid}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="primary"
            icon={<PrinterOutlined />}
            onClick={handlePrint}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Imprimir / Guardar PDF
          </Button>

          {data.raw_xml && (
            <Button
              icon={<DownloadOutlined />}
              onClick={handleDownloadXml}
            >
              Descargar XML
            </Button>
          )}

          {qr_url && (
            <Tooltip title="Verificar validez oficial en portal del SAT">
              <Button
                icon={<SafetyCertificateOutlined className="text-green-600" />}
                href={qr_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Validar en SAT
              </Button>
            </Tooltip>
          )}

          <Button
            icon={<CloseOutlined />}
            onClick={() => window.close()}
            title="Cerrar pestaña"
          >
            Cerrar
          </Button>
        </div>
      </header>

      {/* Printable Sheet (Standard MiAdminXML / SAT Style Layout) */}
      <main className="cfdi-sheet max-w-[960px] mx-auto bg-white p-5 rounded shadow-lg border border-slate-300 font-sans text-[11px] leading-tight">
        
        {/* ROW 1: EMISOR + CFDI RELACIONADO (Left) & DOCUMENTO (Right) */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-2.5">
          {/* Left Column (Emisor + Relacionado) */}
          <div className="md:col-span-7 flex flex-col justify-between">
            {/* Box Emisor */}
            <div className="border border-[#70a4e8] rounded-none overflow-hidden mb-2">
              <div className="bg-[#70a4e8] text-white font-bold px-2 py-0.5 tracking-wider text-[11px]">
                EMISOR
              </div>
              <div className="p-2 space-y-1 bg-white">
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Nombre:</span>
                  <span className="font-bold text-gray-900">{emisor.nombre}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">RFC:</span>
                  <span className="font-bold text-gray-900 font-mono">{emisor.rfc}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Régimen Fiscal:</span>
                  <span className="text-gray-800">{emisor.regimen_fiscal}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Lugar de expedición:</span>
                  <span className="text-gray-800 font-mono">{emisor.lugar_expedicion}</span>
                </div>
              </div>
            </div>

            {/* Box CFDI Relacionado */}
            <div className="border border-[#70a4e8] rounded-none overflow-hidden">
              <div className="bg-[#70a4e8] text-white font-bold px-2 py-0.5 tracking-wider text-[11px]">
                CFDI RELACIONADO
              </div>
              <div className="p-2 space-y-1 bg-white min-h-[42px]">
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Tipo de relación:</span>
                  <span className="text-gray-800">{cfdi_relacionado.tipo_relacion || ''}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">UUID:</span>
                  <span className="font-mono text-[10px] text-gray-800 break-all">
                    {cfdi_relacionado.cfdis?.length > 0 ? cfdi_relacionado.cfdis.join(', ') : (cfdi_relacionado.uuid || '')}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column (Documento) */}
          <div className="md:col-span-5">
            <div className="border border-[#70a4e8] rounded-none overflow-hidden h-full flex flex-col">
              <div className="bg-[#70a4e8] text-white font-bold px-2 py-0.5 tracking-wider text-[11px]">
                DOCUMENTO
              </div>
              <div className="p-2.5 flex-1 flex flex-col justify-between space-y-1 bg-white">
                {/* Folio destacado en Rojo */}
                <div className="text-right py-0.5">
                  <span className="text-red-600 font-bold text-lg tracking-wide font-sans">
                    {documento.full_folio || `${documento.serie || ''} ${documento.folio || 'S/F'}`}
                  </span>
                </div>

                <div className="space-y-1 pt-1 border-t border-slate-100">
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-semibold">Fecha de Emisión:</span>
                    <span className="text-gray-800 font-mono text-[11px]">{formatDate(documento.fecha_emision)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-semibold">Fecha Certificación:</span>
                    <span className="text-gray-800 font-mono text-[11px]">{formatDate(timbre.fecha_certificacion || documento.fecha_certificacion)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-semibold">No. de serie del CSD del SAT:</span>
                    <span className="text-gray-800 font-mono text-[10px]">{timbre.no_certificado_sat || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-semibold">No. de serie del CSD del emisor:</span>
                    <span className="text-gray-800 font-mono text-[10px]">{documento.no_certificado_digital || timbre.no_certificado_digital || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-semibold">Tipo de comprobante:</span>
                    <span className="font-bold text-gray-800">{documento.tipo_comprobante}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ROW 2: RECEPTOR (Left) & DATOS DEL TIMBRADO (Right) */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-2.5">
          {/* Box Receptor */}
          <div className="md:col-span-7">
            <div className="border border-[#70a4e8] rounded-none overflow-hidden h-full">
              <div className="bg-[#70a4e8] text-white font-bold px-2 py-0.5 tracking-wider text-[11px]">
                RECEPTOR
              </div>
              <div className="p-2 space-y-1 bg-white">
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Nombre:</span>
                  <span className="font-bold text-gray-900">{receptor.nombre}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">RFC:</span>
                  <span className="font-bold text-gray-900 font-mono">{receptor.rfc}</span>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <div>
                    <span className="text-gray-500 font-semibold mr-1">Residencia:</span>
                    <span className="text-gray-800">{receptor.residencia_fiscal || ''}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 font-semibold mr-1">NumRegIdTrib:</span>
                    <span className="text-gray-800 font-mono">{receptor.num_reg_id_trib || ''}</span>
                  </div>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Uso del CFDI:</span>
                  <span className="text-gray-800">{receptor.uso_cfdi}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Domicilio fiscal:</span>
                  <span className="text-gray-800 font-mono">{receptor.domicilio_fiscal}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Régimen fiscal:</span>
                  <span className="text-gray-800">{receptor.regimen_fiscal}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Box Timbre Fiscal */}
          <div className="md:col-span-5">
            <div className="border border-[#70a4e8] rounded-none overflow-hidden h-full flex flex-col">
              <div className="bg-[#70a4e8] text-white font-bold px-2 py-0.5 tracking-wider text-[11px]">
                DATOS DEL TIMBRADO
              </div>
              <div className="p-2.5 flex-1 flex flex-col justify-between space-y-1 bg-white">
                <div>
                  <span className="text-gray-500 font-semibold block text-[10px]">Folio Fiscal (UUID):</span>
                  <span className="font-mono font-bold text-blue-900 text-[11px] select-all break-all block">
                    {timbre.uuid}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 font-semibold">No. Certificado Digital:</span>
                  <span className="font-mono text-gray-800 text-[10px]">{timbre.no_certificado_digital || documento.no_certificado_digital || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 font-semibold">No. Certificado SAT:</span>
                  <span className="font-mono text-gray-800 text-[10px]">{timbre.no_certificado_sat || '-'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 font-semibold">Fecha Certificación:</span>
                  <span className="font-mono text-gray-800 text-[10px]">{formatDate(timbre.fecha_certificacion)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 font-semibold">RFC Prov. Certif.:</span>
                  <span className="font-mono text-gray-800 text-[10px]">{timbre.rfc_prov_certif || '-'}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ROW 3: CONCEPTOS TABLE */}
        <section className="mb-2.5">
          <div className="border border-[#70a4e8] overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-[#70a4e8] text-white text-[10px] uppercase font-bold tracking-tight">
                  <th className="py-1 px-1.5 border border-[#5b94dd] text-center w-[75px]">ClvProdServ</th>
                  <th className="py-1 px-1.5 border border-[#5b94dd] text-center w-[65px]">NoIdent</th>
                  <th className="py-1 px-1.5 border border-[#5b94dd] text-center w-[55px]">Cantidad</th>
                  <th className="py-1 px-1.5 border border-[#5b94dd] text-center w-[65px]">Clv. Unidad</th>
                  <th className="py-1 px-1.5 border border-[#5b94dd] text-center w-[65px]">Unidad</th>
                  <th className="py-1 px-2 border border-[#5b94dd]">Descripción</th>
                  <th className="py-1 px-1.5 border border-[#5b94dd] text-right w-[95px]">Valor Unitario</th>
                  <th className="py-1 px-1.5 border border-[#5b94dd] text-right w-[80px]">Descuento</th>
                  <th className="py-1 px-2 border border-[#5b94dd] text-right w-[100px]">Importe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {conceptos.map((item, idx) => (
                  <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="py-1 px-1.5 text-center font-mono text-[10px] text-gray-700 border-r border-slate-200">
                      {item.clave_prod_serv}
                    </td>
                    <td className="py-1 px-1.5 text-center font-mono text-[10px] text-gray-700 border-r border-slate-200">
                      {item.no_identificacion || '-'}
                    </td>
                    <td className="py-1 px-1.5 text-center font-mono text-[10px] text-gray-700 border-r border-slate-200">
                      {Number(item.cantidad || 1).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 4 })}
                    </td>
                    <td className="py-1 px-1.5 text-center font-mono text-[10px] text-gray-700 border-r border-slate-200">
                      {item.clave_unidad || '-'}
                    </td>
                    <td className="py-1 px-1.5 text-center text-[10px] text-gray-700 border-r border-slate-200">
                      {item.unidad || '-'}
                    </td>
                    <td className="py-1 px-2 text-[11px] text-gray-900 border-r border-slate-200 leading-normal">
                      <div className="font-medium">{item.descripcion}</div>
                    </td>
                    <td className="py-1 px-1.5 text-right font-mono text-[11px] text-gray-800 border-r border-slate-200">
                      {formatMoney(item.valor_unitario)}
                    </td>
                    <td className="py-1 px-1.5 text-right font-mono text-[11px] text-gray-800 border-r border-slate-200">
                      {item.descuento ? formatMoney(item.descuento) : '$ 0.00'}
                    </td>
                    <td className="py-1 px-2 text-right font-mono font-semibold text-[11px] text-gray-900">
                      {formatMoney(item.importe)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ROW 3.5: COMPLEMENTO DE NÓMINA 1.2 (SI APLICA) */}
        {nomina && (
          <section className="mb-2.5 space-y-2">
            {/* Datos Generales de la Nómina y del Trabajador */}
            <div className="border border-[#70a4e8] rounded-none overflow-hidden">
              <div className="bg-[#70a4e8] text-white font-bold px-2 py-0.5 tracking-wider text-[11px] flex justify-between items-center">
                <span>COMPLEMENTO DE NÓMINA (VERSIÓN {nomina.version || '1.2'}) — DATOS GENERALES DEL TRABAJADOR Y PERIODO</span>
                <span>NÓMINA {(nomina.tipo_nomina_label || 'ORDINARIA').toUpperCase()} ({nomina.tipo_nomina || 'O'})</span>
              </div>
              <div className="p-2 bg-white grid grid-cols-2 md:grid-cols-4 gap-2 text-[10.5px]">
                <div>
                  <span className="text-gray-500 font-semibold mr-1">No. Empleado:</span>
                  <span className="font-bold font-mono text-gray-900">{nomina.num_empleado || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">CURP:</span>
                  <span className="font-mono text-gray-900">{nomina.curp || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">NSS (IMSS):</span>
                  <span className="font-mono text-gray-900">{nomina.nss || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Registro Patronal:</span>
                  <span className="font-mono text-gray-900">{nomina.registro_patronal || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Departamento:</span>
                  <span className="text-gray-900 font-medium">{nomina.departamento || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Puesto:</span>
                  <span className="text-gray-900 font-medium">{nomina.puesto || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Fecha de Pago:</span>
                  <span className="font-mono font-bold text-blue-900">{nomina.fecha_pago || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Días Pagados:</span>
                  <span className="font-mono font-bold text-gray-900">{nomina.num_dias_pagados || 0}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Periodo de Pago:</span>
                  <span className="font-mono text-gray-900">{nomina.fecha_inicial_pago || '-'} al {nomina.fecha_final_pago || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Periodicidad:</span>
                  <span className="font-mono text-gray-900">{nomina.periodicidad_pago || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Salario Base Cot.:</span>
                  <span className="font-mono text-gray-900">{formatMoney(nomina.salario_base_cot_apor)}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Salario Diario Integrado:</span>
                  <span className="font-mono text-gray-900">{formatMoney(nomina.salario_diario_integrado)}</span>
                </div>
              </div>
            </div>

            {/* Desglose de Percepciones y Deducciones */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {/* Percepciones */}
              <div className="border border-[#70a4e8] overflow-hidden">
                <div className="bg-[#70a4e8] text-white font-bold px-2 py-0.5 text-[10px] flex justify-between">
                  <span>PERCEPCIONES</span>
                  <span>Total: {formatMoney(nomina.total_percepciones)}</span>
                </div>
                <table className="w-full text-[10px] border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-gray-700 border-b border-slate-200">
                      <th className="py-1 px-1.5 text-left">Tipo/Clv</th>
                      <th className="py-1 px-1.5 text-left">Concepto</th>
                      <th className="py-1 px-1.5 text-right">Gravado</th>
                      <th className="py-1 px-1.5 text-right">Exento</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(nomina.percepciones || []).map((p, i) => (
                      <tr key={i}>
                        <td className="py-1 px-1.5 font-mono text-gray-600">{p.tipo_percepcion}-{p.clave}</td>
                        <td className="py-1 px-1.5 text-gray-900">{p.concepto}</td>
                        <td className="py-1 px-1.5 text-right font-mono">{formatMoney(p.importe_gravado)}</td>
                        <td className="py-1 px-1.5 text-right font-mono">{formatMoney(p.importe_exento)}</td>
                      </tr>
                    ))}
                    {(nomina.otros_pagos || []).map((op, i) => (
                      <tr key={`op-${i}`} className="bg-emerald-50/40">
                        <td className="py-1 px-1.5 font-mono text-emerald-700">OP-{op.tipo_otro_pago}</td>
                        <td className="py-1 px-1.5 text-emerald-900">{op.concepto} {op.subsidio_causado > 0 ? `(Sub. Causado: ${formatMoney(op.subsidio_causado)})` : ''}</td>
                        <td className="py-1 px-1.5 text-right font-mono">-</td>
                        <td className="py-1 px-1.5 text-right font-mono font-semibold text-emerald-800">{formatMoney(op.importe)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Deducciones */}
              <div className="border border-[#70a4e8] overflow-hidden">
                <div className="bg-[#70a4e8] text-white font-bold px-2 py-0.5 text-[10px] flex justify-between">
                  <span>DEDUCCIONES</span>
                  <span>Total: {formatMoney(nomina.total_deducciones)}</span>
                </div>
                <table className="w-full text-[10px] border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-gray-700 border-b border-slate-200">
                      <th className="py-1 px-1.5 text-left">Tipo/Clv</th>
                      <th className="py-1 px-1.5 text-left">Concepto</th>
                      <th className="py-1 px-1.5 text-right">Importe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(nomina.deducciones || []).length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-2 text-center text-gray-400">Sin deducciones registradas</td>
                      </tr>
                    ) : (
                      (nomina.deducciones || []).map((d, i) => (
                        <tr key={i}>
                          <td className="py-1 px-1.5 font-mono text-gray-600">{d.tipo_deduccion}-{d.clave}</td>
                          <td className="py-1 px-1.5 text-gray-900">{d.concepto}</td>
                          <td className="py-1 px-1.5 text-right font-mono text-red-700 font-semibold">{formatMoney(d.importe)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* ROW 4: IMPORTE CON LETRA (Full Width) */}
        <section className="mb-2.5">
          <div className="border border-[#70a4e8] rounded-none overflow-hidden">
            <div className="bg-[#70a4e8] text-white font-bold px-2 py-0.5 tracking-wider text-[11px]">
              IMPORTE CON LETRA
            </div>
            <div className="p-2 bg-white font-bold text-gray-900 text-[11px] tracking-wide">
              {totales.importe_letra || 'N/D'}
            </div>
          </div>
        </section>

        {/* ROW 5: QR CODE + PAYMENT DETAILS (Left) & TOTALS TABLE (Right) */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-3">
          {/* Left: QR + Payment Data */}
          <div className="md:col-span-7 flex flex-row items-center gap-3 border border-slate-200 p-2 bg-white rounded">
            {/* QR Code */}
            <div className="flex-shrink-0 flex items-center justify-center p-1 bg-white border border-slate-200">
              {qr_url ? (
                <QRCode
                  value={qr_url}
                  size={105}
                  bordered={false}
                  errorLevel="M"
                />
              ) : (
                <div className="w-[105px] h-[105px] bg-slate-100 flex items-center justify-center text-[10px] text-gray-400">
                  QR N/A
                </div>
              )}
            </div>

            {/* Payment Details */}
            <div className="flex-1 space-y-1 text-[11px]">
              <div>
                <span className="text-gray-500 font-semibold mr-1">Forma de pago:</span>
                <span className="text-gray-800">{documento.forma_pago || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500 font-semibold mr-1">Método de pago:</span>
                <span className="text-gray-800">{documento.metodo_pago || '-'}</span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Moneda:</span>
                  <span className="text-gray-800 font-mono">{documento.moneda || 'MXN'}</span>
                </div>
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Versión CFDI:</span>
                  <span className="text-gray-800 font-mono">{documento.version || '4.0'}</span>
                </div>
              </div>
              {documento.tipo_cambio && (
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Tipo de cambio:</span>
                  <span className="text-gray-800 font-mono">{documento.tipo_cambio}</span>
                </div>
              )}
              {documento.condiciones_pago && (
                <div>
                  <span className="text-gray-500 font-semibold mr-1">Condiciones de pago:</span>
                  <span className="text-gray-800">{documento.condiciones_pago}</span>
                </div>
              )}
            </div>
          </div>

          {/* Right: Totals Breakdown Table */}
          <div className="md:col-span-5">
            <div className="border border-slate-300 rounded overflow-hidden">
              <table className="w-full text-[11px]">
                <tbody className="divide-y divide-slate-100 bg-white">
                  <tr>
                    <td className="py-1 px-3 text-gray-600 font-semibold">Subtotal:</td>
                    <td className="py-1 px-3 text-right font-mono text-gray-900">
                      {formatMoney(totales.subtotal)}
                    </td>
                  </tr>

                  {Number(totales.descuento || 0) > 0 && (
                    <tr>
                      <td className="py-1 px-3 text-gray-600 font-semibold">Descuento:</td>
                      <td className="py-1 px-3 text-right font-mono text-red-600">
                        - {formatMoney(totales.descuento)}
                      </td>
                    </tr>
                  )}

                  {Number(totales.ieps || 0) > 0 && (
                    <tr>
                      <td className="py-1 px-3 text-gray-600 font-semibold">IEPS:</td>
                      <td className="py-1 px-3 text-right font-mono text-gray-900">
                        {formatMoney(totales.ieps)}
                      </td>
                    </tr>
                  )}

                  <tr>
                    <td className="py-1 px-3 text-gray-600 font-semibold">IVA Trasladado (16%):</td>
                    <td className="py-1 px-3 text-right font-mono text-gray-900">
                      {formatMoney(totales.iva)}
                    </td>
                  </tr>

                  {Number(totales.retencion_isr || 0) > 0 && (
                    <tr>
                      <td className="py-1 px-3 text-gray-600 font-semibold">Retención ISR:</td>
                      <td className="py-1 px-3 text-right font-mono text-red-600">
                        - {formatMoney(totales.retencion_isr)}
                      </td>
                    </tr>
                  )}

                  {Number(totales.retencion_iva || 0) > 0 && (
                    <tr>
                      <td className="py-1 px-3 text-gray-600 font-semibold">Retención IVA:</td>
                      <td className="py-1 px-3 text-right font-mono text-red-600">
                        - {formatMoney(totales.retencion_iva)}
                      </td>
                    </tr>
                  )}

                  {Number(totales.impuestos_locales || 0) > 0 && (
                    <tr>
                      <td className="py-1 px-3 text-gray-600 font-semibold">
                        {totales.nombre_impuesto_local || 'Impuestos Locales'}
                        {totales.tasa_impuesto_local ? ` (${totales.tasa_impuesto_local}%)` : ''}:
                      </td>
                      <td className="py-1 px-3 text-right font-mono text-gray-900">
                        {formatMoney(totales.impuestos_locales)}
                      </td>
                    </tr>
                  )}

                  <tr className="bg-slate-100 border-t-2 border-slate-300">
                    <td className="py-1.5 px-3 text-gray-900 font-bold text-sm">TOTAL:</td>
                    <td className="py-1.5 px-3 text-right font-mono font-bold text-gray-900 text-sm">
                      {formatMoney(totales.total)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ROW 6: DIGITAL SEALS & CADENA ORIGINAL */}
        <section className="space-y-1.5 text-[9px] pt-1 border-t border-slate-200">
          <div>
            <span className="font-bold text-gray-700 block">Sello Digital del CFDI:</span>
            <pre className="font-mono bg-slate-50 border border-slate-200 p-1 text-[8px] leading-tight break-all whitespace-pre-wrap text-gray-600">
              {sellos.sello_cfdi || 'N/D'}
            </pre>
          </div>

          <div>
            <span className="font-bold text-gray-700 block">Sello del SAT:</span>
            <pre className="font-mono bg-slate-50 border border-slate-200 p-1 text-[8px] leading-tight break-all whitespace-pre-wrap text-gray-600">
              {sellos.sello_sat || 'N/D'}
            </pre>
          </div>

          <div>
            <span className="font-bold text-gray-700 block">Cadena Original del complemento de certificación digital del SAT:</span>
            <pre className="font-mono bg-slate-50 border border-slate-200 p-1 text-[8px] leading-tight break-all whitespace-pre-wrap text-gray-600">
              {sellos.cadena_original || 'N/D'}
            </pre>
          </div>
        </section>

        {/* ROW 7: OFFICIAL SAT LEGAL LEGEND */}
        <footer className="mt-3 pt-2 border-t border-slate-200 text-center text-gray-500 italic text-[10px]">
          Este documento es una representación impresa de un CFDI versión {documento.version || '4.0'}
        </footer>
      </main>
    </div>
  );
}
