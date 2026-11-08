import React, { useState, useEffect } from 'react';
import { Select, Button, Typography, Alert, Card, Row, Col, Spin, Tag, Space } from 'antd';
import { PrinterOutlined, SearchOutlined, CheckCircleOutlined, CloseCircleOutlined, FileExcelOutlined, FilePdfOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import { reportsApi } from '../api/client';
import { exportToExcel, exportToPdfWithLogo } from '../utils/exportPaperwork';

const { Title, Text } = Typography;
const { Option } = Select;

const formatMoney = (val) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val || 0);

const BalanceSheet = () => {
  const { clientId } = useParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [level, setLevel] = useState('mayor'); // 'mayor' (default) | 'all'

  useEffect(() => {
    if (clientId) {
      handleGenerate();
    }
  }, [clientId, level]);

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await reportsApi.balanceSheet(clientId, { year, month, level });
      setData(res.data);
    } catch (err) {
      setError('Error al generar el balance general');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => window.print();

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const buildBalanceExportPayload = () => {
    if (!data) return null;
    const columnsDef = [
      { key: 'rubro', title: 'Rubro / Clasificación', align: 'left', format: 'text', width: 22 },
      { key: 'name', title: 'Cuenta / Concepto', align: 'left', format: 'text', width: 42 },
      { key: 'amount', title: 'Importe (MXN)', align: 'right', format: 'currency', width: 22 },
    ];

    const rows = [];
    const pushSection = (sectionTitle, items, subtotalLabel, subtotalVal) => {
      rows.push({ rubro: sectionTitle, name: '', amount: '', _rowType: 'section' });
      (items || []).forEach(it => {
        rows.push({ rubro: '', name: `   ${it.name}`, amount: Number(it.amount || 0), _rowType: 'normal' });
      });
      rows.push({ rubro: '', name: subtotalLabel, amount: Number(subtotalVal || 0), _rowType: 'subtotal' });
    };

    pushSection('ACTIVO CIRCULANTE', data.activo_circulante?.items, 'Total Activo Circulante', data.activo_circulante?.total);
    pushSection('ACTIVO NO CIRCULANTE (FIJO)', data.activo_fijo?.items, 'Total Activo No Circulante', data.activo_fijo?.total);
    rows.push({ rubro: 'ACTIVO', name: 'TOTAL ACTIVO', amount: Number(data.total_activo || 0), _rowType: 'total' });

    pushSection('PASIVO A CORTO PLAZO', data.pasivo_corto?.items, 'Total Pasivo a Corto Plazo', data.pasivo_corto?.total);
    pushSection('PASIVO A LARGO PLAZO', data.pasivo_largo?.items, 'Total Pasivo a Largo Plazo', data.pasivo_largo?.total);
    rows.push({ rubro: 'PASIVO', name: 'TOTAL PASIVO', amount: Number(data.total_pasivo || 0), _rowType: 'subtotal' });

    pushSection('CAPITAL CONTABLE', data.capital?.items, 'Total Capital Contable', data.capital?.total);
    const totalPasivoCapital = data.total_pasivo_capital ?? ((Number(data.total_pasivo) || 0) + (Number(data.total_capital) || 0));
    rows.push({ rubro: 'PASIVO + CAPITAL', name: 'TOTAL PASIVO + CAPITAL CONTABLE', amount: totalPasivoCapital, _rowType: 'total' });

    const summaryCards = [
      { label: 'Total Activo', value: formatMoney(data.total_activo || 0), sublabel: 'Suma de recursos' },
      { label: 'Total Pasivo', value: formatMoney(data.total_pasivo || 0), sublabel: 'Obligaciones totales' },
      { label: 'Total Capital Contable', value: formatMoney(data.total_capital || 0), sublabel: 'Patrimonio neto' },
      { label: 'Total Pasivo + Capital', value: formatMoney(totalPasivoCapital), sublabel: isBalanced ? 'Balance cuadrado' : 'Diferencia detectada' },
    ];

    return {
      title: 'ESTADO DE SITUACIÓN FINANCIERA (BALANCE GENERAL)',
      subtitle: `Al ${new Date(year, month, 0).getDate()} de ${monthNames[month - 1]} de ${year} (${level === 'mayor' ? 'Cuentas de Mayor' : 'Detalle Completo'})`,
      clientName: data.business_name || '',
      clientRfc: data.rfc || '',
      period: `${String(month).padStart(2, '0')} - ${monthNames[month - 1]} ${year}`,
      columns: columnsDef,
      rows,
      summaryCards,
      notes: 'Estado Financiero elaborado conforme a las Normas de Información Financiera (NIF B-6). Cifras en Pesos Mexicanos (MXN).',
      filename: `Balance_General_${data.rfc || clientId}_${year}_${String(month).padStart(2, '0')}.xlsx`
    };
  };

  const handleExportExcel = () => {
    const payload = buildBalanceExportPayload();
    if (payload) exportToExcel(payload);
  };

  const handleExportPdf = () => {
    const payload = buildBalanceExportPayload();
    if (payload) exportToPdfWithLogo(payload);
  };

  const isBalanced = data && (data.is_balanced !== undefined ? data.is_balanced : Math.abs(data.total_activo - (data.total_pasivo + data.total_capital)) < 0.05);

  const renderSection = (title, items, total, totalLabel) => {
    const list = items || [];
    return (
      <div className="mb-6 font-mono text-xs">
        <div className="flex justify-between items-baseline border-b border-gray-300 pb-1 mb-2">
          <Text strong className="text-sm tracking-wide text-gray-800 uppercase">{title}</Text>
          <span className="text-[11px] text-gray-400 font-sans">{list.length} cuenta(s)</span>
        </div>
        
        <div className="space-y-1.5 my-2">
          {list.length === 0 ? (
            <div className="text-gray-400 italic text-[11px] py-1">Sin cuentas con saldo en este periodo</div>
          ) : (
            list.map((item, idx) => (
              <div key={idx} className="flex justify-between items-baseline hover:bg-gray-50/80 px-1 py-0.5 rounded transition-colors">
                <span className="text-gray-700 truncate pr-2" title={item.name}>
                  {item.name}
                </span>
                <span className={`font-semibold tabular-nums ${item.amount < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                  {formatMoney(item.amount)}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="flex justify-between font-bold text-xs border-t-2 border-gray-400 mt-2 pt-1.5 bg-gray-50/50 px-1">
          <span className="uppercase">{totalLabel}</span>
          <span className="tabular-nums text-gray-900">{formatMoney(total || 0)}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 print:p-0">
      <div className="flex justify-between items-center mb-6 print:hidden">
        <div>
          <Title level={2} className="m-0 text-gray-800">Balance General</Title>
          <Text type="secondary" className="text-xs">Estado de Posición Financiera a fecha de corte</Text>
        </div>
        <Space wrap>
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
          <Button icon={<PrinterOutlined />} onClick={handlePrint}>Imprimir</Button>
        </Space>
      </div>

      <div className="bg-white p-4 rounded-lg shadow-sm mb-6 flex flex-wrap gap-4 items-end print:hidden border border-gray-100">
        <div>
          <label className="block mb-1 text-xs font-bold text-gray-700">📅 Año</label>
          <Select value={year} onChange={setYear} style={{ width: 120 }}>
            {[2022, 2023, 2024, 2025, 2026, 2027].map(y => <Option key={y} value={y}>{y}</Option>)}
          </Select>
        </div>

        <div>
          <label className="block mb-1 text-xs font-bold text-gray-700">🗓️ Mes</label>
          <Select value={month} onChange={setMonth} style={{ width: 140 }}>
            <Option value={1}>01 - Enero</Option>
            <Option value={2}>02 - Febrero</Option>
            <Option value={3}>03 - Marzo</Option>
            <Option value={4}>04 - Abril</Option>
            <Option value={5}>05 - Mayo</Option>
            <Option value={6}>06 - Junio</Option>
            <Option value={7}>07 - Julio</Option>
            <Option value={8}>08 - Agosto</Option>
            <Option value={9}>09 - Septiembre</Option>
            <Option value={10}>10 - Octubre</Option>
            <Option value={11}>11 - Noviembre</Option>
            <Option value={12}>12 - Diciembre</Option>
          </Select>
        </div>

        <div>
          <label className="block mb-1 text-xs font-bold text-gray-700">🔍 Nivel de Presentación</label>
          <Select value={level} onChange={setLevel} style={{ width: 260 }}>
            <Option value="mayor">Solo Cuentas de Mayor con Saldo</Option>
            <Option value="all">Detallado (Con Subcuentas)</Option>
          </Select>
        </div>

        <Button type="primary" icon={<SearchOutlined />} onClick={handleGenerate} loading={loading} className="bg-blue-600">
          Actualizar Reporte
        </Button>
      </div>

      {error && <Alert message={error} type="error" className="mb-4 print:hidden" showIcon />}

      <Spin spinning={loading}>
        {data && (
          <Card className="shadow-lg print:shadow-none mx-auto border border-gray-200" style={{ maxWidth: '1050px' }}>
            {/* Encabezado Formal del Balance */}
            <div className="text-center border-b-4 border-double border-gray-800 pb-4 mb-6">
              <Title level={3} className="m-0 uppercase tracking-wide text-gray-900">{data.business_name || 'EMPRESA DEMO SA DE CV'}</Title>
              {data.rfc && <div className="text-xs font-mono font-bold text-gray-500 mt-0.5">RFC: {data.rfc}</div>}
              <Title level={4} className="m-0 mt-2 text-gray-700 tracking-wider">ESTADO DE SITUACIÓN FINANCIERA (BALANCE GENERAL)</Title>
              <div className="flex justify-center items-center gap-2 mt-1">
                <Text className="text-gray-600 text-xs font-medium">Al {new Date(year, month, 0).getDate()} de {['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'][month - 1]} de {year}</Text>
                <Tag color="blue" className="text-[10px] m-0 font-sans">
                  {level === 'mayor' ? 'Cuentas de Mayor con Saldo' : 'Detalle Completo'}
                </Tag>
              </div>
              <div className="text-[11px] text-gray-400 mt-1 italic">(Cifras expresadas en Pesos Mexicanos MXN)</div>
            </div>

            <Row gutter={40}>
              {/* Activo (Left Column) */}
              <Col xs={24} md={12} className="border-r border-gray-200/60 pr-6">
                <div className="bg-gray-800 text-white font-bold py-1.5 px-3 text-center text-sm rounded mb-4 tracking-wider uppercase">
                  ACTIVO
                </div>
                {renderSection('Activo Circulante', data.activo_circulante?.items, data.activo_circulante?.total, 'Total Activo Circulante')}
                {renderSection('Activo No Circulante (Fijo)', data.activo_fijo?.items, data.activo_fijo?.total, 'Total Activo No Circulante')}
                
                <div className="flex justify-between font-bold text-sm bg-gray-100 p-3 mt-8 border-t-2 border-b-4 border-double border-gray-800 font-mono">
                  <span className="uppercase">TOTAL ACTIVO</span>
                  <span className="tabular-nums text-gray-900">{formatMoney(data.total_activo || 0)}</span>
                </div>
              </Col>

              {/* Pasivo y Capital (Right Column) */}
              <Col xs={24} md={12} className="pl-6">
                <div className="bg-gray-800 text-white font-bold py-1.5 px-3 text-center text-sm rounded mb-4 tracking-wider uppercase">
                  PASIVO Y CAPITAL
                </div>
                {renderSection('Pasivo a Corto Plazo', data.pasivo_corto?.items, data.pasivo_corto?.total, 'Total Pasivo a Corto Plazo')}
                {renderSection('Pasivo a Largo Plazo', data.pasivo_largo?.items, data.pasivo_largo?.total, 'Total Pasivo a Largo Plazo')}
                
                <div className="flex justify-between font-bold text-xs bg-gray-50/80 border-t border-b border-gray-300 py-1.5 px-2 mb-6 font-mono">
                  <span className="uppercase">TOTAL PASIVO</span>
                  <span className="tabular-nums text-gray-900">{formatMoney(data.total_pasivo || 0)}</span>
                </div>

                {renderSection('Capital Contable', data.capital?.items, data.capital?.total, 'Total Capital Contable')}

                <div className="flex justify-between font-bold text-sm bg-gray-100 p-3 mt-8 border-t-2 border-b-4 border-double border-gray-800 font-mono">
                  <span className="uppercase">TOTAL PASIVO + CAPITAL</span>
                  <span className="tabular-nums text-gray-900">{formatMoney(data.total_pasivo_capital || ((data.total_pasivo || 0) + (data.total_capital || 0)))}</span>
                </div>
              </Col>
            </Row>

            {/* Certificación de Balance Cuadrado */}
            <div className="mt-8 flex justify-center print:hidden">
              {isBalanced ? (
                <Alert message="Balance Cuadrado: Total Activo = Total Pasivo + Capital Contable" type="success" showIcon icon={<CheckCircleOutlined />} className="text-xs" />
              ) : (
                <Alert message="Diferencia encontrada en el balance contable" type="error" showIcon icon={<CloseCircleOutlined />} className="text-xs" />
              )}
            </div>
          </Card>
        )}
      </Spin>
    </div>
  );
};

export default BalanceSheet;
