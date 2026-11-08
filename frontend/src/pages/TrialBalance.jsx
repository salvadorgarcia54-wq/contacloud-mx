import React, { useState, useEffect } from 'react';
import { Table, Select, Button, Typography, Alert, Space, Switch, Tag, Card, Row, Col, Tooltip } from 'antd';
import { PrinterOutlined, SearchOutlined, CheckCircleOutlined, FileExcelOutlined, FilePdfOutlined } from '@ant-design/icons';
import { useParams, Link } from 'react-router-dom';
import { reportsApi, clientsApi } from '../api/client';
import { exportToExcel, exportToPdfWithLogo } from '../utils/exportPaperwork';

const { Title } = Typography;
const { Option } = Select;

const formatMoney = (val) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val || 0);

const TrialBalance = () => {
  const { clientId } = useParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState([]);
  const [clientInfo, setClientInfo] = useState(null);
  
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [onlyActive, setOnlyActive] = useState(true);
  const [onlyWithMovement, setOnlyWithMovement] = useState(false);

  useEffect(() => {
    if (clientId) {
      clientsApi.get(clientId).then(res => setClientInfo(res.data)).catch(() => {});
      handleGenerate();
    }
  }, [clientId, year, month, onlyActive, onlyWithMovement]);

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await reportsApi.trialBalance(clientId, year, month, { 
        active_only: onlyActive,
        only_with_movement: onlyWithMovement 
      });
      setData(res.data || []);
    } catch (err) {
      setError('Error al generar la balanza de comprobación');
    } finally {
      setLoading(false);
    }
  };

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const buildExportPayload = () => {
    const columnsDef = [
      { key: 'account_number', title: 'Código (3-2-3)', align: 'left', format: 'text', width: 16 },
      { key: 'name', title: 'Cuenta Contable', align: 'left', format: 'text', width: 38 },
      { key: 'classification', title: 'Tipo', align: 'center', format: 'text', width: 14 },
      { key: 'initial_debit', title: 'Saldo Inicial Debe', align: 'right', format: 'currency', width: 18 },
      { key: 'initial_credit', title: 'Saldo Inicial Haber', align: 'right', format: 'currency', width: 18 },
      { key: 'movements_debit', title: 'Movimientos Debe', align: 'right', format: 'currency', width: 18 },
      { key: 'movements_credit', title: 'Movimientos Haber', align: 'right', format: 'currency', width: 18 },
      { key: 'final_debit', title: 'Saldo Final Debe', align: 'right', format: 'currency', width: 18 },
      { key: 'final_credit', title: 'Saldo Final Haber', align: 'right', format: 'currency', width: 18 },
    ];

    const rows = data.map(r => ({
      account_number: r.account_number,
      name: `${r.level === 3 ? '    ' : r.level === 2 ? '  ' : ''}${r.name}`,
      classification: r.classification || 'Acumulación',
      initial_debit: Number(r.initial_debit || 0),
      initial_credit: Number(r.initial_credit || 0),
      movements_debit: Number(r.movements_debit || 0),
      movements_credit: Number(r.movements_credit || 0),
      final_debit: Number(r.final_debit || 0),
      final_credit: Number(r.final_credit || 0),
      _rowType: r.level === 1 ? 'section' : r.level === 2 ? 'subtotal' : 'normal'
    }));

    rows.push({
      account_number: '',
      name: 'SUMAS IGUALES',
      classification: '',
      initial_debit: totals.initial_debit,
      initial_credit: totals.initial_credit,
      movements_debit: totals.movements_debit,
      movements_credit: totals.movements_credit,
      final_debit: totals.final_debit,
      final_credit: totals.final_credit,
      _rowType: 'total'
    });

    const summaryCards = [
      { label: 'Total Movimientos Debe', value: formatMoney(totals.movements_debit), sublabel: 'Cargos del periodo' },
      { label: 'Total Movimientos Haber', value: formatMoney(totals.movements_credit), sublabel: 'Abonos del periodo' },
      { label: 'Saldo Final Deudor', value: formatMoney(totals.final_debit), sublabel: 'Cuentas de mayor' },
      { label: 'Saldo Final Acreedor', value: formatMoney(totals.final_credit), sublabel: 'Cuentas de mayor' },
    ];

    return {
      title: 'BALANZA DE COMPROBACIÓN (ESTRUCTURA 3-2-3)',
      subtitle: 'Papel de Trabajo Contable y Fiscal con Desglose de Saldos Iniciales, Movimientos y Saldos Finales',
      clientName: clientInfo?.business_name || '',
      clientRfc: clientInfo?.rfc || '',
      period: `${String(month).padStart(2, '0')} - ${monthNames[month - 1]} ${year}`,
      columns: columnsDef,
      rows,
      summaryCards,
      notes: 'Cifras expresadas en Pesos Mexicanos (MXN). Las sumas iguales consideran únicamente las cuentas de mayor (Nivel 1) para evitar duplicidades.',
      filename: `Balanza_Comprobacion_${clientInfo?.rfc || clientId}_${year}_${String(month).padStart(2, '0')}.xlsx`
    };
  };

  const handleExportExcel = () => exportToExcel(buildExportPayload());
  const handleExportPdf = () => exportToPdfWithLogo(buildExportPayload());
  const handlePrint = () => exportToPdfWithLogo(buildExportPayload());

  const columns = [
    { 
      title: 'Código (3-2-3)', 
      dataIndex: 'account_number', 
      key: 'account_number', 
      width: 140,
      render: (text, record) => {
        const isL1 = record.level === 1 || text.endsWith('-00-000');
        const isL2 = record.level === 2 || text.endsWith('-000');
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        const targetUrl = `/ledger/${clientId}?account_id=${record.id || record.account_number}&date_from=${startDate}&date_to=${endDate}`;

        return (
          <span style={{ 
            paddingLeft: record.level === 3 ? 16 : record.level === 2 ? 8 : 0,
            display: 'inline-block'
          }}>
            <Link
              to={targetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 hover:underline print:text-black print:no-underline font-mono"
              style={{ 
                fontWeight: isL1 ? 'bold' : isL2 ? '600' : 'normal',
                color: isL1 ? '#1890ff' : isL2 ? '#096dd9' : '#1d39c4'
              }}
              title={`Ver libro mayor y auxiliares de ${text} - ${record.name} (${startDate} al ${endDate})`}
            >
              {text}
            </Link>
          </span>
        );
      }
    },
    { 
      title: 'Cuenta', 
      dataIndex: 'name', 
      key: 'name',
      render: (text, record) => {
        const isL1 = record.level === 1;
        const isL2 = record.level === 2;
        return (
          <span style={{ 
            fontWeight: isL1 ? 'bold' : isL2 ? '600' : 'normal',
            paddingLeft: record.level === 3 ? 16 : record.level === 2 ? 8 : 0
          }}>
            {text}
          </span>
        );
      }
    },
    {
      title: 'Tipo',
      dataIndex: 'classification',
      key: 'classification',
      width: 110,
      align: 'center',
      render: (c) => (
        <Tag color={c === 'Acumulación' ? 'blue' : 'green'} style={{ fontSize: '11px' }}>
          {c || 'Acumulación'}
        </Tag>
      )
    },
    { 
      title: 'Saldo Inicial', 
      children: [
        { 
          title: 'Debe', 
          dataIndex: 'initial_debit', 
          render: val => val > 0 ? formatMoney(val) : '-', 
          align: 'right',
          width: 120 
        },
        { 
          title: 'Haber', 
          dataIndex: 'initial_credit', 
          render: val => val > 0 ? formatMoney(val) : '-', 
          align: 'right',
          width: 120 
        }
      ]
    },
    { 
      title: 'Movimientos del Periodo', 
      children: [
        { 
          title: 'Debe', 
          dataIndex: 'movements_debit', 
          render: val => val > 0 ? formatMoney(val) : '-', 
          align: 'right',
          width: 120 
        },
        { 
          title: 'Haber', 
          dataIndex: 'movements_credit', 
          render: val => val > 0 ? formatMoney(val) : '-', 
          align: 'right',
          width: 120 
        }
      ]
    },
    { 
      title: 'Saldo Final', 
      children: [
        { 
          title: 'Debe', 
          dataIndex: 'final_debit', 
          render: val => val > 0 ? formatMoney(val) : '-', 
          align: 'right',
          width: 120 
        },
        { 
          title: 'Haber', 
          dataIndex: 'final_credit', 
          render: val => val > 0 ? formatMoney(val) : '-', 
          align: 'right',
          width: 120 
        }
      ]
    }
  ];

  // Cálculo de sumas iguales sobre cuentas de mayor (nivel 1)
  // Las cuentas de nivel 1 consolidan de manera estricta y sin omisiones ni duplicidades todas sus ramas
  const level1Codes = ['100-00-000', '200-00-000', '300-00-000', '400-00-000', '500-00-000', '600-00-000', '700-00-000', '800-00-000'];
  const rootRows = data.filter(r => level1Codes.includes(r.account_number) || r.level === 1);
  const rowsToSum = rootRows.length > 0 ? rootRows : data.filter(r => r.classification === 'Afectable');

  const totals = rowsToSum.reduce((acc, row) => {
    acc.initial_debit += Number(row.initial_debit) || 0;
    acc.initial_credit += Number(row.initial_credit) || 0;
    acc.movements_debit += Number(row.movements_debit) || 0;
    acc.movements_credit += Number(row.movements_credit) || 0;
    acc.final_debit += Number(row.final_debit) || 0;
    acc.final_credit += Number(row.final_credit) || 0;
    return acc;
  }, { initial_debit: 0, initial_credit: 0, movements_debit: 0, movements_credit: 0, final_debit: 0, final_credit: 0 });

  return (
    <div className="p-6 print:p-0">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center mb-4 print:hidden gap-4">
        <div>
          <Title level={2} className="m-0">Balanza de Comprobación</Title>
          {clientInfo && (
            <p className="text-gray-500 m-0 text-sm">
              Empresa: <span className="font-semibold text-gray-700">{clientInfo.business_name}</span> ({clientInfo.rfc})
            </p>
          )}
        </div>
        <Space wrap>
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
          <Button icon={<PrinterOutlined />} onClick={handlePrint} size="middle">
            Imprimir
          </Button>
        </Space>
      </div>

      {/* Filtros de periodo y memoria */}
      <Card size="small" className="mb-4 shadow-sm bg-white print:hidden">
        <Row gutter={[16, 12]} align="middle">
          <Col xs={12} sm={6} md={3}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Año</label>
            <Select value={year} onChange={setYear} style={{ width: '100%' }}>
              {[2022, 2023, 2024, 2025, 2026, 2027].map(y => <Option key={y} value={y}>{y}</Option>)}
            </Select>
          </Col>
          <Col xs={12} sm={6} md={4}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Mes</label>
            <Select value={month} onChange={setMonth} style={{ width: '100%' }}>
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
          </Col>
          <Col xs={12} sm={6} md={5}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Filtro de Memoria</label>
            <Space>
              <Switch 
                checked={onlyActive} 
                onChange={setOnlyActive} 
                checkedChildren="Activas" 
                unCheckedChildren="Todas" 
                size="small"
              />
              <span className="text-xs text-gray-700">Solo cuentas activas</span>
            </Space>
          </Col>
          <Col xs={12} sm={6} md={6}>
            <label className="block mb-1 text-xs font-semibold text-gray-600">Movimientos</label>
            <Space>
              <Switch 
                checked={onlyWithMovement} 
                onChange={setOnlyWithMovement} 
                checkedChildren="Con saldo" 
                unCheckedChildren="Todas" 
                size="small"
              />
              <span className="text-xs text-gray-700">Ocultar saldos en cero</span>
            </Space>
          </Col>
          <Col xs={24} md={6} className="text-right">
            <Button type="primary" icon={<SearchOutlined />} onClick={handleGenerate} loading={loading}>
              Consultar Balanza
            </Button>
          </Col>
        </Row>
      </Card>

      {error && <Alert message={error} type="error" className="mb-4 print:hidden" showIcon />}

      {/* Vista para impresión / tabla */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden p-4 print:shadow-none print:p-0">
        <div className="hidden print:block text-center mb-6">
          <Title level={3} className="m-0">Balanza de Comprobación (Estructura 3-2-3)</Title>
          <p className="m-0 font-semibold">{clientInfo?.business_name} - RFC: {clientInfo?.rfc}</p>
          <p className="text-sm text-gray-600">Periodo: {month.toString().padStart(2, '0')}/{year}</p>
        </div>

        <Table 
          columns={columns} 
          dataSource={data} 
          rowKey="account_number"
          loading={loading}
          pagination={false}
          size="small"
          bordered
          rowClassName={(record) => {
            if (record.level === 1) return 'bg-blue-50/40 font-bold';
            if (record.level === 2) return 'bg-gray-50/60 font-semibold';
            return '';
          }}
          summary={() => {
            const isInitBalanced = Math.abs(totals.initial_debit - totals.initial_credit) < 0.05;
            const isMovBalanced = Math.abs(totals.movements_debit - totals.movements_credit) < 0.05;
            const isFinBalanced = Math.abs(totals.final_debit - totals.final_credit) < 0.05;
            const allBalanced = isInitBalanced && isMovBalanced && isFinBalanced;

            return (
              <Table.Summary.Row className="bg-gray-100 font-bold">
                <Table.Summary.Cell index={0} colSpan={3} align="right">
                  <div className="flex items-center justify-end gap-2">
                    {allBalanced && <CheckCircleOutlined className="text-green-600 text-base" title="Sumas cuadradas" />}
                    <span className="text-blue-900 font-bold">SUMAS IGUALES</span>
                  </div>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">{formatMoney(totals.initial_debit)}</Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right">{formatMoney(totals.initial_credit)}</Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right">{formatMoney(totals.movements_debit)}</Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right">{formatMoney(totals.movements_credit)}</Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">{formatMoney(totals.final_debit)}</Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="right">{formatMoney(totals.final_credit)}</Table.Summary.Cell>
              </Table.Summary.Row>
            );
          }}
        />
      </div>
    </div>
  );
};

export default TrialBalance;
