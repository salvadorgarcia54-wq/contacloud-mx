import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Spin, Alert, Button, Tag, Space, Tooltip } from 'antd';
import { 
  PrinterOutlined, 
  CloseOutlined, 
  FileSearchOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  CalendarOutlined,
  NumberOutlined
} from '@ant-design/icons';
import { journalsApi, clientsApi } from '../api/client';
import dayjs from 'dayjs';

export default function JournalViewer() {
  const { entryId } = useParams();
  const [data, setData] = useState(null);
  const [clientInfo, setClientInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!entryId) return;
    setLoading(true);
    journalsApi.get(entryId)
      .then(async (res) => {
        setData(res.data);
        setError(null);
        document.title = `Póliza ${res.data?.entry_type?.toUpperCase() || ''} No. ${res.data?.entry_number || entryId}`;
        
        if (res.data?.client_id) {
          try {
            const clientRes = await clientsApi.get(res.data.client_id);
            setClientInfo(clientRes.data);
          } catch (e) {
            console.error('Error fetching client info:', e);
          }
        }
      })
      .catch((err) => {
        console.error('Error al cargar póliza:', err);
        setError(err?.response?.data?.detail || 'No se pudo cargar la información de la póliza.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [entryId]);

  const handlePrint = () => {
    window.print();
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
    const dt = dayjs(isoStr);
    if (!dt.isValid()) return isoStr;
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return `${dt.format('DD')} de ${months[dt.month()]} de ${dt.format('YYYY')}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6">
        <Spin size="large" />
        <span className="mt-4 text-gray-600 font-medium font-mono text-sm">
          Cargando póliza contable #{entryId}...
        </span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-white p-6 rounded-lg shadow">
          <Alert
            message="Póliza no encontrada"
            description={error || 'No se encontró la póliza contable especificada.'}
            type="error"
            showIcon
          />
          <div className="mt-4 text-center">
            <Button onClick={() => window.close()}>Cerrar ventana</Button>
          </div>
        </div>
      </div>
    );
  }

  const lines = data.lines || [];
  const totalDebe = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalHaber = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebe - totalHaber) < 0.01;

  const typeConfig = {
    ingreso: { label: 'PÓLIZA DE INGRESOS', color: 'green', bg: 'bg-green-50', border: 'border-green-600', text: 'text-green-800' },
    egreso: { label: 'PÓLIZA DE EGRESOS', color: 'red', bg: 'bg-red-50', border: 'border-red-600', text: 'text-red-800' },
    diario: { label: 'PÓLIZA DE DIARIO', color: 'blue', bg: 'bg-blue-50', border: 'border-blue-600', text: 'text-blue-800' },
  }[data.entry_type?.toLowerCase()] || { label: 'PÓLIZA CONTABLE', color: 'default', bg: 'bg-gray-50', border: 'border-gray-600', text: 'text-gray-800' };

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white text-slate-900 py-6 px-4 font-sans">
      {/* BARRA SUPERIOR DE ACCIONES (Oculta al imprimir) */}
      <div className="max-w-4xl mx-auto mb-4 flex justify-between items-center print:hidden">
        <Space>
          <Tag color={typeConfig.color} className="font-bold text-sm px-3 py-1">
            {typeConfig.label}
          </Tag>
          <span className="text-gray-500 font-mono text-sm">
            ID Interno: {data.id}
          </span>
        </Space>
        <Space>
          <Button type="primary" icon={<PrinterOutlined />} onClick={handlePrint}>
            Imprimir Póliza / PDF
          </Button>
          <Button icon={<CloseOutlined />} onClick={() => window.close()}>
            Cerrar
          </Button>
        </Space>
      </div>

      {/* DOCUMENTO PRINCIPAL (Hoja de Póliza Contable) */}
      <div className="max-w-4xl mx-auto bg-white p-8 md:p-10 rounded-lg shadow-sm border border-gray-200 print:shadow-none print:border-none print:p-0">
        
        {/* ENCABEZADO DE LA EMPRESA */}
        <div className="border-b-2 border-slate-800 pb-4 mb-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-xl md:text-2xl font-bold uppercase tracking-wide text-slate-900 m-0">
                {clientInfo?.business_name || 'CONTABILIDAD GENERAL'}
              </h1>
              <div className="text-sm font-mono text-slate-600 mt-1">
                RFC: <strong className="text-slate-800">{clientInfo?.rfc || '-'}</strong>
                {clientInfo?.tax_regime && (
                  <span className="ml-3 text-slate-500">| Régimen: {clientInfo.tax_regime}</span>
                )}
              </div>
            </div>

            {/* CAJA DE TIPO Y NÚMERO */}
            <div className={`text-right border-2 ${typeConfig.border} ${typeConfig.bg} rounded px-4 py-2`}>
              <div className={`text-xs font-bold uppercase ${typeConfig.text} tracking-wider`}>
                {typeConfig.label}
              </div>
              <div className="text-2xl font-bold font-mono text-slate-900">
                No. {data.entry_number}
              </div>
            </div>
          </div>
        </div>

        {/* METADATOS DE LA PÓLIZA */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-md border border-slate-200 mb-6 text-sm">
          <div>
            <div className="text-xs text-slate-500 font-semibold uppercase">Fecha de Aplicación:</div>
            <div className="font-medium text-slate-900 font-mono">
              {formatDate(data.date)} ({dayjs(data.date).format('DD/MM/YYYY')})
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-500 font-semibold uppercase">Referencia:</div>
            <div className="font-medium text-slate-900 font-mono">
              {data.reference || 'Sin referencia'}
            </div>
          </div>

          <div className="md:col-span-2">
            <div className="text-xs text-slate-500 font-semibold uppercase">Concepto General de la Póliza:</div>
            <div className="font-medium text-slate-900 mt-0.5">
              {data.description || 'Sin concepto'}
            </div>
          </div>

          {/* VINCULACIÓN CON CFDI SAT */}
          {data.cfdi_uuid && (
            <div className="md:col-span-2 pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-semibold uppercase">UUID / Folio Fiscal SAT:</span>
                <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                  {data.cfdi_uuid}
                </span>
                {data.cfdi_total && (
                  <span className="text-xs text-slate-600 font-mono">
                    (Total CFDI: <strong>{formatMoney(data.cfdi_total)}</strong>)
                  </span>
                )}
              </div>
              <a
                href={`/cfdi-viewer/${data.cfdi_uuid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="print:hidden text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 underline"
              >
                <FileSearchOutlined /> Ver comprobante CFDI XML completo
              </a>
            </div>
          )}
        </div>

        {/* TABLA DE ASIENTOS CONTABLES */}
        <div className="mb-6">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
            Desglose de Asientos y Movimientos Contables
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono border-collapse border border-slate-300">
              <thead>
                <tr className="bg-slate-200 text-slate-700 border-b border-slate-300">
                  <th className="border border-slate-300 p-2 text-center w-10">#</th>
                  <th className="border border-slate-300 p-2 text-left w-28">Cuenta</th>
                  <th className="border border-slate-300 p-2 text-left">Nombre de la Cuenta</th>
                  <th className="border border-slate-300 p-2 text-left">Concepto del Movimiento</th>
                  <th className="border border-slate-300 p-2 text-right w-28">Cargos (Debe)</th>
                  <th className="border border-slate-300 p-2 text-right w-28">Abonos (Haber)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {lines.map((l, index) => (
                  <tr key={l.id || index} className="hover:bg-slate-50">
                    <td className="border border-slate-300 p-2 text-center text-slate-500 font-semibold">
                      {index + 1}
                    </td>
                    <td className="border border-slate-300 p-2 font-bold text-slate-900">
                      {l.account_number || '-'}
                    </td>
                    <td className="border border-slate-300 p-2 text-slate-800 font-sans">
                      {l.account_name || 'Cuenta Contable'}
                    </td>
                    <td className="border border-slate-300 p-2 text-slate-600 font-sans">
                      {l.description || data.description || '-'}
                    </td>
                    <td className="border border-slate-300 p-2 text-right font-medium text-slate-900">
                      {Number(l.debit) > 0 ? formatMoney(l.debit) : ''}
                    </td>
                    <td className="border border-slate-300 p-2 text-right font-medium text-slate-900">
                      {Number(l.credit) > 0 ? formatMoney(l.credit) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {/* FILA DE TOTALES */}
                <tr className="bg-slate-100 font-bold border-t-2 border-slate-800">
                  <td colSpan={4} className="border border-slate-300 p-2 text-right uppercase tracking-wider">
                    Sumas Iguales:
                  </td>
                  <td className="border border-slate-300 p-2 text-right font-mono text-sm text-green-700">
                    {formatMoney(totalDebe)}
                  </td>
                  <td className="border border-slate-300 p-2 text-right font-mono text-sm text-red-700">
                    {formatMoney(totalHaber)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* VERIFICACIÓN DE CUADRE */}
        <div className="flex justify-between items-center p-3 bg-slate-50 rounded border border-slate-200 mb-8 text-xs font-mono">
          <div>
            Diferencia de Cuadre: <strong className={isBalanced ? 'text-green-600' : 'text-red-600'}>
              {formatMoney(Math.abs(totalDebe - totalHaber))}
            </strong>
          </div>
          <div>
            {isBalanced ? (
              <span className="text-green-700 font-bold flex items-center gap-1">
                <CheckCircleOutlined /> PÓLIZA CUADRADA CORRECTAMENTE
              </span>
            ) : (
              <span className="text-red-600 font-bold">
                ⚠ ATENCIÓN: PÓLIZA DESCUADRADA
              </span>
            )}
          </div>
        </div>

        {/* SECCIÓN DE FIRMAS CONTABLES */}
        <div className="grid grid-cols-3 gap-6 pt-10 text-center text-xs text-slate-600 font-sans border-t border-slate-200">
          <div>
            <div className="border-t border-slate-400 pt-2 font-semibold">
              Elaboró
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">Contabilidad</div>
          </div>
          <div>
            <div className="border-t border-slate-400 pt-2 font-semibold">
              Revisó
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">Auditoría / Supervisor</div>
          </div>
          <div>
            <div className="border-t border-slate-400 pt-2 font-semibold">
              Autorizó
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">Gerencia / Dirección</div>
          </div>
        </div>

      </div>
    </div>
  );
}
