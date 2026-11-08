import React, { useState, useEffect, useMemo } from 'react';
import {
  Steps,
  Select,
  Button,
  Upload,
  Table,
  Card,
  Typography,
  Tag,
  Alert,
  Radio,
  Tooltip,
  Space,
  message,
} from 'antd';
import {
  UploadOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  FileDoneOutlined,
  PlusCircleOutlined,
  BankOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  PrinterOutlined,
  CalendarOutlined,
  SaveOutlined,
  BulbOutlined,
  FileSearchOutlined,
} from '@ant-design/icons';
import { useParams, Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { bankApi, accountsApi, reportsApi, cfdiApi, journalsApi, clientsApi } from '../api/client';
import { exportToExcel, exportToPdfWithLogo } from '../utils/exportPaperwork';

const { Step } = Steps;
const { Title, Text } = Typography;

const formatMoney = (val) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val || 0);

const stripAccents = (str) =>
  String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const isReconcilableBankAccount = (acc) => {
  if (!acc || acc.is_active === false) return false;
  const num = (acc.account_number || '').trim();
  const is10201or10202 =
    (num.startsWith('102-01-') && num !== '102-01-000') ||
    (num.startsWith('102-02-') && num !== '102-02-000');
  const isAfectable = (acc.classification || '').trim().toLowerCase() === 'afectable';
  return is10201or10202 && isAfectable;
};

const MONTH_OPTIONS = [
  { value: 1, label: '01 - Enero', name: 'Enero' },
  { value: 2, label: '02 - Febrero', name: 'Febrero' },
  { value: 3, label: '03 - Marzo', name: 'Marzo' },
  { value: 4, label: '04 - Abril', name: 'Abril' },
  { value: 5, label: '05 - Mayo', name: 'Mayo' },
  { value: 6, label: '06 - Junio', name: 'Junio' },
  { value: 7, label: '07 - Julio', name: 'Julio' },
  { value: 8, label: '08 - Agosto', name: 'Agosto' },
  { value: 9, label: '09 - Septiembre', name: 'Septiembre' },
  { value: 10, label: '10 - Octubre', name: 'Octubre' },
  { value: 11, label: '11 - Noviembre', name: 'Noviembre' },
  { value: 12, label: '12 - Diciembre', name: 'Diciembre' },
];

const currentYear = dayjs().year();
const YEAR_OPTIONS = [
  currentYear + 1,
  currentYear,
  currentYear - 1,
  currentYear - 2,
  currentYear - 3,
].map((y) => ({ value: y, label: `${y}` }));

const SPANISH_MONTHS = {
  ene: 1, enero: 1, jan: 1,
  feb: 2, febrero: 2,
  mar: 3, marzo: 3,
  abr: 4, abril: 4, apr: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6,
  jul: 7, julio: 7,
  ago: 8, agosto: 8, aug: 8,
  sep: 9, sept: 9, septiembre: 9, set: 9,
  oct: 10, octubre: 10,
  nov: 11, noviembre: 11,
  dic: 12, diciembre: 12, dec: 12,
};

function getStorageKey(clientId, accountId, year, month) {
  return `contacloud_bank_recon_${clientId}_${accountId}_${year}_${String(month).padStart(2, '0')}`;
}

function getSmartMemoryStorageKey(clientId) {
  return `contacloud_bank_smart_memory_${clientId}`;
}

// Palabras genéricas bancarias que se ignoran al comparar palabras clave de conceptos
const BANK_STOPWORDS = new Set([
  'spei',
  'transferencia',
  'traspaso',
  'banca',
  'electronica',
  'interbancaria',
  'interbancario',
  'bancomer',
  'bbva',
  'banorte',
  'santander',
  'banamex',
  'citibanamex',
  'hsbc',
  'scotiabank',
  'bajio',
  'inbursa',
  'azteca',
  'banregio',
  'cuenta',
  'orden',
  'abono',
  'cargo',
  'retiro',
  'deposito',
  'pago',
  'cobro',
  'fecha',
  'hora',
  'sucursal',
  'referencia',
  'folio',
  'rastreo',
  'clave',
  'concepto',
  'movimiento',
  'bancario',
  'bancaria',
  'cliente',
  'proveedor',
  'terceros',
  'mismo',
  'banco',
]);

// Normaliza la descripción de un movimiento bancario quitando folios/fechas/números variables
function normalizeBankConceptSignature(desc) {
  if (!desc) return '';
  let s = stripAccents(String(desc).toLowerCase());
  // Quitar paréntesis finales añadidos por descripción de pólizas "(107-01-001 ...)"
  s = s.replace(/\(\d{3}-\d{2}-\d{3}[^)]*\)/g, ' ');
  // Quitar fechas y horas
  s = s.replace(/\b\d{1,4}[-/.]\d{1,2}([-/.]\d{1,4})?\b/g, ' ');
  s = s.replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ');
  // Quitar tokens alfanuméricos con 3 o más dígitos (folios, referencias, rastreo, cuentas)
  s = s.replace(/\b[a-z]*\d{3,}[a-z0-9]*\b/g, ' ');
  // Quitar palabras de referencia sueltas
  s = s.replace(/\b(ref|folio|aut|autorizacion|rastreo|sec|num|no|cta|clabe)\b/g, ' ');
  // Dejar solo letras y espacios
  s = s.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

function extractBankConceptKeywords(desc) {
  const sig = normalizeBankConceptSignature(desc);
  if (!sig) return [];
  const words = sig.split(' ').filter((w) => w.length >= 4 && !BANK_STOPWORDS.has(w));
  return Array.from(new Set(words));
}

function loadSmartBankMemory(clientId) {
  if (!clientId) return [];
  try {
    const raw = localStorage.getItem(getSmartMemoryStorageKey(clientId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSmartBankMemoryRule(clientId, txType, description, accountId) {
  if (!clientId || !description || !accountId) return [];
  const cleanSig = normalizeBankConceptSignature(description);
  const keywords = extractBankConceptKeywords(description);
  if (!cleanSig && keywords.length === 0) return loadSmartBankMemory(clientId);

  const currentRules = loadSmartBankMemory(clientId);
  const normType = txType === 'abono' || txType === 'deposit' ? 'abono' : 'cargo';
  const nowIso = new Date().toISOString();

  const existingIdx = currentRules.findIndex(
    (r) => r.txType === normType && r.cleanSignature === cleanSig && cleanSig.length >= 3
  );

  const newRule = {
    txType: normType,
    cleanSignature: cleanSig,
    keywords,
    rawExample: String(description).slice(0, 160),
    accountId: Number(accountId),
    updatedAt: nowIso,
  };

  let nextRules;
  if (existingIdx >= 0) {
    nextRules = [...currentRules];
    nextRules[existingIdx] = newRule;
  } else {
    nextRules = [newRule, ...currentRules].slice(0, 500);
  }

  try {
    localStorage.setItem(getSmartMemoryStorageKey(clientId), JSON.stringify(nextRules));
  } catch (e) {
    console.warn('No se pudo guardar la memoria contable bancaria:', e);
  }
  return nextRules;
}

// Busca en la Memoria Inteligente si un movimiento bancario coincide con lo capturado en meses anteriores
function findSuggestedAccountFromMemory(bt, memoryRules, activeAccountIds) {
  if (!bt || !Array.isArray(memoryRules) || memoryRules.length === 0) return null;
  const normType = Number(bt.amount || 0) > 0 ? 'abono' : 'cargo';
  const btSig = normalizeBankConceptSignature(bt.description);
  const btKeywords = extractBankConceptKeywords(bt.description);

  if (!btSig && btKeywords.length === 0) return null;

  let bestAccountId = null;
  let bestScore = 0;

  for (const rule of memoryRules) {
    if (rule.txType !== normType) continue;
    const accId = Number(rule.accountId);
    if (!activeAccountIds.has(accId)) continue;

    let score = 0;
    const ruleSig = rule.cleanSignature || '';
    const ruleKeywords = Array.isArray(rule.keywords) ? rule.keywords : [];

    // 1. Coincidencia exacta de firma normalizada
    if (btSig && ruleSig && btSig === ruleSig && btSig.length >= 4) {
      score = 1000;
    } else if (
      btSig &&
      ruleSig &&
      btSig.length >= 6 &&
      ruleSig.length >= 6 &&
      (btSig.includes(ruleSig) || ruleSig.includes(btSig))
    ) {
      // 2. Contención de frase completa
      score = 600;
    } else if (btKeywords.length > 0 && ruleKeywords.length > 0) {
      // 3. Coincidencia por palabras clave significativas (ej. nombre de deudor/beneficiario o comisión)
      const matchedWords = btKeywords.filter((w) => ruleKeywords.includes(w));
      if (matchedWords.length >= 2) {
        score = 200 + matchedWords.length * 60;
      } else if (matchedWords.length === 1 && matchedWords[0].length >= 5) {
        score = 150 + matchedWords[0].length * 5;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestAccountId = accId;
    }
  }

  return bestAccountId;
}

function parseFlexibleDateClient(raw) {
  if (raw === null || raw === undefined) return null;
  const rawStr = String(raw).trim();
  if (!rawStr) return null;

  if (/^\d{5}(?:\.\d+)?$/.test(rawStr)) {
    const serial = Number(rawStr);
    if (serial >= 35000 && serial <= 60000) {
      const utcMs = Math.round((serial - 25569) * 86400 * 1000);
      const dt = new Date(utcMs);
      const y = dt.getUTCFullYear();
      const mo = dt.getUTCMonth() + 1;
      const d = dt.getUTCDate();
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  const s = rawStr.split('T')[0].split(' ')[0].trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let d = Number(m[1]);
    let mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (mo > 12 && d <= 12) {
      const tmp = d;
      d = mo;
      mo = tmp;
    }
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  const sClean = stripAccents(rawStr.toLowerCase().trim());
  m = sClean.match(/^(\d{1,2})[-/.\s]+([a-z]+)[-/.\s]+(\d{2,4})/);
  if (!m) {
    m = sClean.match(/^(\d{1,2})\s+de\s+([a-z]+)\s+(?:de\s+|del?\s+)?(\d{2,4})/);
  }
  if (m) {
    const d = Number(m[1]);
    const monKey = m[2].replace('.', '');
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const mo = SPANISH_MONTHS[monKey] || SPANISH_MONTHS[monKey.slice(0, 3)];
    if (mo && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return null;
}

function parseMoneyClient(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return raw;
  let s = String(raw).trim();
  if (!s || s === '-' || s === '--' || s.toLowerCase() === 'n/a') return 0;

  let isNeg = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    isNeg = true;
    s = s.slice(1, -1);
  } else if (s.endsWith('-')) {
    isNeg = true;
    s = s.slice(0, -1);
  } else if (s.startsWith('-')) {
    isNeg = true;
    s = s.slice(1);
  }

  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;

  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (s.includes(',')) {
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length === 2) {
      s = s.replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  }

  const num = Number(s);
  if (Number.isNaN(num)) return null;
  return isNeg ? -num : num;
}

function splitCsvLine(line, delimiter) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

async function extractRowsFromXlsxBuffer(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  let eocdPos = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos === -1) {
    throw new Error('El archivo .xlsx no tiene un formato ZIP válido.');
  }

  const cdCount = view.getUint16(eocdPos + 10, true);
  const cdOffset = view.getUint32(eocdPos + 16, true);

  const entries = {};
  let ptr = cdOffset;
  const decoder = new TextDecoder('utf-8');

  for (let i = 0; i < cdCount; i += 1) {
    if (ptr + 46 > bytes.length || view.getUint32(ptr, true) !== 0x02014b50) break;
    const compMethod = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);

    const fileName = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    entries[fileName] = { compMethod, compSize, localHeaderOffset };
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  const readZipEntryText = async (entryName) => {
    const entry = entries[entryName];
    if (!entry) return null;
    const lh = entry.localHeaderOffset;
    if (view.getUint32(lh, true) !== 0x04034b50) return null;
    const fnLen = view.getUint16(lh + 26, true);
    const exLen = view.getUint16(lh + 28, true);
    const dataStart = lh + 30 + fnLen + exLen;
    const rawSlice = bytes.subarray(dataStart, dataStart + entry.compSize);

    if (entry.compMethod === 0) {
      return decoder.decode(rawSlice);
    }
    if (entry.compMethod === 8) {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(rawSlice);
      writer.close();
      const resp = new Response(ds.readable);
      const ab = await resp.arrayBuffer();
      return decoder.decode(ab);
    }
    return null;
  };

  const sharedStrings = [];
  const ssXml = await readZipEntryText('xl/sharedStrings.xml');
  if (ssXml) {
    const doc = new DOMParser().parseFromString(ssXml, 'application/xml');
    const siNodes = doc.getElementsByTagName('si');
    for (let i = 0; i < siNodes.length; i += 1) {
      const tNodes = siNodes[i].getElementsByTagName('t');
      let textVal = '';
      for (let j = 0; j < tNodes.length; j += 1) {
        textVal += tNodes[j].textContent || '';
      }
      sharedStrings.push(textVal.trim());
    }
  }

  const colRefToIndex = (cellRef) => {
    if (!cellRef) return -1;
    const m = cellRef.match(/^([A-Z]+)/i);
    if (!m) return -1;
    const letters = m[1].toUpperCase();
    let idx = 0;
    for (let i = 0; i < letters.length; i += 1) {
      idx = idx * 26 + (letters.charCodeAt(i) - 64);
    }
    return idx - 1;
  };

  const sheetNames = Object.keys(entries)
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
    .sort();

  let bestRows = [];

  for (const sName of sheetNames) {
    const sheetXml = await readZipEntryText(sName);
    if (!sheetXml) continue;
    const doc = new DOMParser().parseFromString(sheetXml, 'application/xml');
    const rowNodes = doc.getElementsByTagName('row');
    const sheetRows = [];

    for (let i = 0; i < rowNodes.length; i += 1) {
      const cNodes = rowNodes[i].getElementsByTagName('c');
      const rowArr = [];
      let hasContent = false;

      for (let j = 0; j < cNodes.length; j += 1) {
        const c = cNodes[j];
        const ref = c.getAttribute('r') || '';
        const colIdx = colRefToIndex(ref);
        const targetIdx = colIdx >= 0 ? colIdx : j;
        while (rowArr.length <= targetIdx) rowArr.push('');

        const cType = c.getAttribute('t') || '';
        let val = '';
        if (cType === 'inlineStr') {
          const tNodes = c.getElementsByTagName('t');
          for (let k = 0; k < tNodes.length; k += 1) {
            val += tNodes[k].textContent || '';
          }
        } else {
          const vNode = c.getElementsByTagName('v')[0];
          const rawV = vNode ? vNode.textContent || '' : '';
          if (cType === 's') {
            const ssIdx = Number(rawV);
            val = sharedStrings[ssIdx] !== undefined ? sharedStrings[ssIdx] : rawV;
          } else {
            val = rawV;
          }
        }
        val = String(val).trim();
        if (val !== '') hasContent = true;
        rowArr[targetIdx] = val;
      }

      if (hasContent) {
        sheetRows.push(rowArr);
      }
    }

    if (sheetRows.length > bestRows.length) {
      bestRows = sheetRows;
    }
  }

  return bestRows;
}

function parseRowsClient(rows, customMap = null) {
  if (!rows || !rows.length) return { transactions: [], initialBalance: 0, finalBalance: 0 };

  let initialBalance = 0;
  let finalBalance = 0;

  rows.slice(0, 30).forEach((r) => {
    const joined = stripAccents(r.join(' ').toLowerCase());
    if (joined.includes('saldo inicial') || joined.includes('saldo anterior')) {
      for (const cell of r) {
        const v = parseMoneyClient(cell);
        if (v !== null && v !== 0) {
          initialBalance = v;
          break;
        }
      }
    }
    if (joined.includes('saldo final') || joined.includes('saldo actual') || joined.includes('saldo al corte')) {
      for (const cell of r) {
        const v = parseMoneyClient(cell);
        if (v !== null && v !== 0) {
          finalBalance = v;
          break;
        }
      }
    }
  });

  let headerIdx = null;
  const headerMap = customMap ? { ...customMap } : {};

  if (!customMap) {
    for (let idx = 0; idx < Math.min(rows.length, 50); idx += 1) {
      const rLow = rows[idx].map((c) =>
        stripAccents(String(c || '').toLowerCase().replace(/\s+/g, ' ').trim())
      );
      const hasDate = rLow.some((c) => ['fecha', 'date', 'f. oper', 'f.oper', 'dia'].some((k) => c.includes(k)));
      const hasAmt = rLow.some((c) =>
        [
          'cargo',
          'retiro',
          'abono',
          'deposito',
          'importe',
          'monto',
          'cantidad',
          'valor',
          'debit',
          'credit',
          'amount',
          'salida',
          'entrada',
          'egreso',
          'ingreso',
        ].some((k) => c.includes(k))
      );
      if (hasDate && hasAmt) {
        headerIdx = idx;
        rLow.forEach((colName, colI) => {
          if (!colName) return;
          if (['fecha', 'date', 'f. oper', 'f.oper'].some((k) => colName.includes(k)) || colName === 'dia') {
            if (headerMap.fecha === undefined) headerMap.fecha = colI;
          } else if (
            ['descrip', 'concepto', 'detalle', 'movimiento', 'leyenda', 'narrativa', 'observa'].some((k) =>
              colName.includes(k)
            )
          ) {
            if (headerMap.desc === undefined) headerMap.desc = colI;
          } else if (
            ['referencia', 'ref', 'folio', 'documento', 'cheque', 'autorizacion', 'rastreo'].some((k) =>
              colName.includes(k)
            )
          ) {
            if (headerMap.ref === undefined) headerMap.ref = colI;
          } else if (['cargo', 'retiro', 'debit', 'salida', 'egreso', 'disposicion'].some((k) => colName.includes(k))) {
            if (headerMap.cargo === undefined) headerMap.cargo = colI;
          } else if (['abono', 'deposit', 'credit', 'entrada', 'ingreso'].some((k) => colName.includes(k))) {
            if (headerMap.abono === undefined) headerMap.abono = colI;
          } else if (['importe', 'monto', 'cantidad', 'valor', 'amount'].some((k) => colName.includes(k))) {
            if (headerMap.importe === undefined) headerMap.importe = colI;
          } else if (['tipo', 'naturaleza', 'operacion', 'cod', 'c/a'].some((k) => colName.includes(k))) {
            if (headerMap.tipo === undefined) headerMap.tipo = colI;
          } else if (colName.includes('saldo') || colName.includes('balance')) {
            if (headerMap.saldo === undefined) headerMap.saldo = colI;
          }
        });
        break;
      }
    }
  }

  let startRow = headerIdx !== null ? headerIdx + 1 : 0;
  if (!customMap && headerIdx === null) {
    for (let idx = 0; idx < rows.length; idx += 1) {
      const r = rows[idx];
      let dateCol = null;
      for (let colI = 0; colI < Math.min(r.length, 5); colI += 1) {
        if (parseFlexibleDateClient(r[colI])) {
          dateCol = colI;
          break;
        }
      }
      if (dateCol !== null && r.length >= dateCol + 2) {
        startRow = idx;
        headerMap.fecha = dateCol;
        headerMap.desc = dateCol + 1;
        const rem = r.length - (dateCol + 2);
        if (rem >= 3) {
          headerMap.ref = dateCol + 2;
          headerMap.cargo = dateCol + 3;
          headerMap.abono = dateCol + 4;
        } else if (rem === 2) {
          headerMap.cargo = dateCol + 2;
          headerMap.abono = dateCol + 3;
        } else if (rem === 1) {
          headerMap.importe = dateCol + 2;
        }
        break;
      }
    }
  }

  const idxFecha = headerMap.fecha ?? 0;
  const idxDesc = headerMap.desc ?? idxFecha + 1;
  const idxRef = headerMap.ref;
  const idxCargo = headerMap.cargo;
  const idxAbono = headerMap.abono;
  const idxImporte = headerMap.importe;
  const idxTipo = headerMap.tipo;
  const idxSaldo = headerMap.saldo;

  const txs = [];
  let lastRunningBalance = null;

  for (let i = startRow; i < rows.length; i += 1) {
    const r = rows[i];
    if (!r || r.length <= idxFecha) continue;
    const dt = parseFlexibleDateClient(r[idxFecha]);
    if (!dt) continue;

    const desc = idxDesc !== undefined && idxDesc < r.length ? String(r[idxDesc] || '').trim() : '';
    const ref = idxRef !== undefined && idxRef < r.length ? String(r[idxRef] || '').trim() : '';

    let cargoVal = 0;
    let abonoVal = 0;

    if (idxCargo !== undefined || idxAbono !== undefined) {
      if (idxCargo !== undefined && idxCargo < r.length) {
        const c = parseMoneyClient(r[idxCargo]);
        if (c !== null) cargoVal = Math.abs(c);
      }
      if (idxAbono !== undefined && idxAbono < r.length) {
        const a = parseMoneyClient(r[idxAbono]);
        if (a !== null) abonoVal = Math.abs(a);
      }
    }

    if (cargoVal === 0 && abonoVal === 0 && idxImporte !== undefined && idxImporte < r.length) {
      const imp = parseMoneyClient(r[idxImporte]);
      if (imp !== null && imp !== 0) {
        const tipoStr =
          idxTipo !== undefined && idxTipo < r.length ? stripAccents(String(r[idxTipo] || '').toLowerCase()) : '';
        if (['cargo', 'retiro', 'salida', 'egreso', 'debito', '-'].some((k) => tipoStr.includes(k))) {
          cargoVal = Math.abs(imp);
        } else if (['abono', 'deposito', 'entrada', 'ingreso', 'credito', '+'].some((k) => tipoStr.includes(k))) {
          abonoVal = Math.abs(imp);
        } else if (imp < 0) {
          cargoVal = Math.abs(imp);
        } else {
          abonoVal = Math.abs(imp);
        }
      }
    }

    if (cargoVal === 0 && abonoVal === 0 && idxCargo === undefined && idxAbono === undefined && idxImporte === undefined) {
      for (let colI = Math.max(idxDesc + 1, idxFecha + 1); colI < r.length; colI += 1) {
        if (colI === idxSaldo || colI === idxRef) continue;
        const imp = parseMoneyClient(r[colI]);
        if (imp !== null && imp !== 0) {
          if (imp < 0) cargoVal = Math.abs(imp);
          else abonoVal = Math.abs(imp);
          break;
        }
      }
    }

    if (cargoVal === 0 && abonoVal === 0) continue;

    if (idxSaldo !== undefined && idxSaldo < r.length) {
      const sVal = parseMoneyClient(r[idxSaldo]);
      if (sVal !== null && sVal !== 0) lastRunningBalance = sVal;
    }

    const signed = abonoVal > 0 ? abonoVal : -cargoVal;
    txs.push({
      id: `bt-${i}`,
      date: dt,
      description: desc || (signed > 0 ? 'Depósito bancario' : 'Cargo bancario'),
      ref,
      reference: ref,
      amount: signed,
      cargo: cargoVal,
      abono: abonoVal,
      type: signed > 0 ? 'abono' : 'cargo',
      transaction_type: signed > 0 ? 'deposit' : 'withdrawal',
      reconciled: false,
      matchMode: 'cfdi',
      matchedCfdiId: null,
      manualAccountId: null,
      suggestedByMemory: false,
      generatedEntry: null,
    });
  }

  txs.sort((a, b) => a.date.localeCompare(b.date));

  if (finalBalance === 0 && lastRunningBalance !== null) {
    finalBalance = lastRunningBalance;
  } else if (finalBalance === 0 && txs.length > 0) {
    const net = txs.reduce((acc, t) => acc + t.amount, 0);
    finalBalance = Number((initialBalance + net).toFixed(2));
  }

  return { transactions: txs, initialBalance, finalBalance };
}

function extractRowsFromCsvText(text) {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (!lines.length) return [];

  const sample = lines.slice(0, 15);
  let delimiter = ',';
  let bestCount = 0;
  [',', ';', '\t', '|'].forEach((cand) => {
    const cnt = sample.reduce((acc, l) => acc + (l.split(cand).length - 1), 0);
    if (cnt > bestCount) {
      bestCount = cnt;
      delimiter = cand;
    }
  });

  return lines.map((l) => splitCsvLine(l, delimiter)).filter((r) => r.some((c) => c !== ''));
}

function computeSummaryClient(bankTxs, bookRows, initialBankBalance = 0, explicitBankBalance = null) {
  let inTransitDebits = 0;
  let inTransitCredits = 0;
  let bookBalance = 0;

  bookRows.forEach((b) => {
    const deb = b.type === 'debe' ? Number(b.amount || 0) : 0;
    const cred = b.type === 'haber' ? Number(b.amount || 0) : 0;
    bookBalance += deb - cred;
    if (!b.reconciled) {
      if (deb > 0) inTransitDebits += deb;
      if (cred > 0) inTransitCredits += cred;
    }
  });

  let unreconciledBankDeposits = 0;
  let unreconciledBankWithdrawals = 0;
  let bankNet = 0;

  bankTxs.forEach((t) => {
    const signed = Number(t.amount || 0);
    bankNet += signed;
    if (!t.reconciled) {
      if (signed > 0) unreconciledBankDeposits += Math.abs(signed);
      else unreconciledBankWithdrawals += Math.abs(signed);
    }
  });

  const bankBalance =
    explicitBankBalance !== null && explicitBankBalance !== 0
      ? Number(explicitBankBalance)
      : Number((initialBankBalance + bankNet).toFixed(2));

  const reconciledBalance = Number(
    (
      bankBalance +
      inTransitDebits -
      inTransitCredits -
      unreconciledBankDeposits +
      unreconciledBankWithdrawals
    ).toFixed(2)
  );
  const cleanBookBalance = Number(bookBalance.toFixed(2));
  const diff = Number((reconciledBalance - cleanBookBalance).toFixed(2));

  return {
    bankBalance: Number(bankBalance.toFixed(2)),
    inTransitDebits: Number(inTransitDebits.toFixed(2)),
    inTransitCredits: Number(inTransitCredits.toFixed(2)),
    bookBalance: cleanBookBalance,
    reconciledBalance,
    diff,
  };
}

const daysBetweenDates = (d1, d2) => {
  const t1 = new Date(d1).getTime();
  const t2 = new Date(d2).getTime();
  if (Number.isNaN(t1) || Number.isNaN(t2)) return 999;
  return Math.abs(Math.round((t1 - t2) / (1000 * 60 * 60 * 24)));
};

const BankReconciliation = () => {
  const { clientId } = useParams();
  const [currentStep, setCurrentStep] = useState(0);
  const [clientInfo, setClientInfo] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [allAccounts, setAllAccounts] = useState([]);
  const [cfdiEmitidos, setCfdiEmitidos] = useState([]);
  const [cfdiRecibidos, setCfdiRecibidos] = useState([]);
  const [smartMemoryRules, setSmartMemoryRules] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(dayjs().month() + 1);
  const [statementMeta, setStatementMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rowLoadingId, setRowLoadingId] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [rawPreviewRows, setRawPreviewRows] = useState([]);
  const [pendingFileName, setPendingFileName] = useState('');
  const [colMap, setColMap] = useState({ fecha: 0, desc: 1, cargo: 2, abono: 3, importe: undefined });
  const [savedMonthsVersion, setSavedMonthsVersion] = useState(0);
  const [bankPage, setBankPage] = useState(1);
  const [bankPageSize, setBankPageSize] = useState(25);
  const [bookPage, setBookPage] = useState(1);
  const [bookPageSize, setBookPageSize] = useState(25);
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'reconciled' | 'pending'

  // Data for reconciliation
  const [bankTransactions, setBankTransactions] = useState([]);
  const [bookEntries, setBookEntries] = useState([]);
  const [summary, setSummary] = useState({
    bankBalance: 0,
    inTransitDebits: 0,
    inTransitCredits: 0,
    bookBalance: 0,
    reconciledBalance: 0,
    diff: 0,
  });

  const saveMonthReconciliationToStorage = (accId, yr, mo, meta, bankTxs, books, sum) => {
    if (!clientId || !accId || !yr || !mo) return;
    try {
      const key = getStorageKey(clientId, accId, yr, mo);
      localStorage.setItem(
        key,
        JSON.stringify({
          statementMeta: meta,
          bankTransactions: bankTxs,
          bookEntries: books,
          summary: sum,
          savedAt: new Date().toISOString(),
        })
      );
      setSavedMonthsVersion((v) => v + 1);
    } catch (e) {
      console.warn('Error guardando conciliación en almacenamiento local:', e);
    }
  };

  // Alimenta la Memoria Inteligente tanto con lo guardado en otros meses como con las Pólizas de Ingreso/Egreso históricas
  const syncSmartMemoryFromHistory = (allAccs, journalsList) => {
    let rules = loadSmartBankMemory(clientId);
    const bankAccIds = new Set(allAccs.filter(isReconcilableBankAccount).map((a) => a.id));
    const taxAccNumbers = new Set(['118-01-000', '119-01-000', '208-01-000', '209-01-000']);
    const taxAccIds = new Set(allAccs.filter((a) => taxAccNumbers.has(a.account_number)).map((a) => a.id));

    // 1. Escanear conciliaciones guardadas de otros meses en localStorage
    try {
      const prefix = `contacloud_bank_recon_${clientId}_`;
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) {
          const parsed = JSON.parse(localStorage.getItem(k) || '{}');
          (parsed.bankTransactions || []).forEach((bt) => {
            if (bt.manualAccountId && bt.description) {
              const txType = Number(bt.amount || 0) > 0 ? 'abono' : 'cargo';
              rules = saveSmartBankMemoryRule(clientId, txType, bt.description, bt.manualAccountId);
            }
          });
        }
      }
    } catch (e) {
      console.warn('Error sincronizando memoria desde meses guardados:', e);
    }

    // 2. Escanear pólizas de Ingreso y Egreso previas en la base de datos (sin CFDI) que tocaron cuentas bancarias
    if (Array.isArray(journalsList)) {
      journalsList.forEach((entry) => {
        if (entry.is_cancelled || entry.cfdi_uuid) return;
        const eType = (entry.entry_type || '').toLowerCase();
        if (eType !== 'ingreso' && eType !== 'egreso') return;
        const lines = entry.lines || [];
        const hasBankLine = lines.some((l) => bankAccIds.has(l.account_id));
        if (!hasBankLine) return;

        const counterpartLine = lines.find(
          (l) => !bankAccIds.has(l.account_id) && !taxAccIds.has(l.account_id)
        );
        if (counterpartLine && counterpartLine.account_id) {
          const txType = eType === 'ingreso' ? 'abono' : 'cargo';
          const descText = counterpartLine.description || entry.description || '';
          if (descText) {
            rules = saveSmartBankMemoryRule(clientId, txType, descText, counterpartLine.account_id);
          }
        }
      });
    }

    setSmartMemoryRules(rules);
    return rules;
  };

  const loadClientContext = async () => {
    if (!clientId) return { allAccs: [], emitidos: [], recibidos: [], memoryRules: [] };
    try {
      const [cliRes, accRes, emiRes, recRes, jrnRes] = await Promise.all([
        clientsApi.get(clientId).catch(() => ({ data: null })),
        accountsApi.getClientAccounts(clientId, { active_only: true }).catch(() => ({ data: [] })),
        cfdiApi.list(clientId, 'emitido').catch(() => ({ data: [] })),
        cfdiApi.list(clientId, 'recibido').catch(() => ({ data: [] })),
        journalsApi.listByClient(clientId).catch(() => ({ data: [] })),
      ]);
      if (cliRes?.data) setClientInfo(cliRes.data);
      const allAccs = accRes.data || [];
      const emitidos = (emiRes.data || []).filter((c) => (c.tipo_comprobante || 'I').toUpperCase() !== 'P');
      const recibidos = (recRes.data || []).filter((c) => (c.tipo_comprobante || 'I').toUpperCase() !== 'P');
      const journalsList = jrnRes?.data || [];

      const reconcilable = allAccs.filter(isReconcilableBankAccount);
      setAllAccounts(allAccs);
      setAccounts(reconcilable);
      setCfdiEmitidos(emitidos);
      setCfdiRecibidos(recibidos);
      if (!selectedAccount && reconcilable.length > 0) {
        setSelectedAccount(reconcilable[0].id);
      }

      const memoryRules = syncSmartMemoryFromHistory(allAccs, journalsList);
      return { allAccs, emitidos, recibidos, memoryRules };
    } catch (e) {
      console.error(e);
      return { allAccs: [], emitidos: [], recibidos: [], memoryRules: [] };
    }
  };

  useEffect(() => {
    if (clientId) {
      setSelectedAccount(null);
      loadClientContext();
    }
  }, [clientId]);

  const fetchBookMovementsForPeriod = async (accId, yr, mo) => {
    if (!clientId || !accId || !yr || !mo) return [];
    const yrStr = String(yr);
    const moStr = String(mo).padStart(2, '0');
    const lastDay = new Date(Number(yr), Number(mo), 0).getDate();
    const dateFrom = `${yrStr}-${moStr}-01`;
    const dateTo = `${yrStr}-${moStr}-${String(lastDay).padStart(2, '0')}`;

    try {
      const ledgerRes = await reportsApi.accountLedger(clientId, {
        account_id: accId,
        date_from: dateFrom,
        date_to: dateTo,
        filter_mode: 'all',
      });
      const movs = ledgerRes?.data?.movements || [];
      return movs.map((m) => {
        const deb = Number(m.debit || 0);
        const cred = Number(m.credit || 0);
        const typePrefix = (m.entry_type || 'P')[0].toUpperCase();
        return {
          id: m.id,
          entry_id: m.entry_id,
          date: m.date,
          journal: `${typePrefix}-${m.entry_number}`,
          concept: m.description || '',
          debit: deb,
          credit: cred,
          amount: deb > 0 ? deb : cred,
          type: deb > 0 ? 'debe' : 'haber',
          reconciled: false,
        };
      });
    } catch (e) {
      console.warn('No se pudieron consultar movimientos en libros:', e);
      return [];
    }
  };

  // Empareja automáticamente movimientos bancarios:
  // 0) Revisa si ya existe póliza en libros para esta cuenta bancaria
  // 1) Relaciona con CFDI Emitidos (Abonos) y CFDI Recibidos (Cargos)
  // 2) Si no hay CFDI relacionado, consulta el Creador de Pólizas Inteligentes (Memoria Contable de meses anteriores)
  //    y pre-sugiere automáticamente la cuenta contable correspondiente
  const enrichAndMatchTransactions = (
    rawBankTxs,
    currentBooks,
    emitidosList,
    recibidosList,
    memoryRulesArg = null,
    allAccsArg = null
  ) => {
    const usedBookIds = new Set();
    const usedEmitidoIds = new Set();
    const usedRecibidoIds = new Set();

    const rulesToUse = memoryRulesArg || smartMemoryRules || loadSmartBankMemory(clientId);
    const accListToUse = allAccsArg || allAccounts;
    const activeAfectableIds = new Set(
      accListToUse
        .filter((a) => a.is_active !== false && (a.classification || '').trim().toLowerCase() === 'afectable')
        .map((a) => Number(a.id))
    );

    const nextBooks = currentBooks.map((b) => ({ ...b, reconciled: false }));
    const nextBank = rawBankTxs.map((bt, idx) => {
      const signed = Number(bt.amount || 0);
      const absAmt = Math.abs(signed);
      const isDeposit = signed > 0;
      const item = {
        ...bt,
        id: bt.id || `bt-${idx}`,
        amount: signed,
        type: isDeposit ? 'abono' : 'cargo',
        reconciled: Boolean(bt.reconciled),
        matchMode: bt.matchMode || 'cfdi',
        matchedCfdiId: bt.matchedCfdiId || null,
        manualAccountId: bt.manualAccountId || null,
        suggestedByMemory: Boolean(bt.suggestedByMemory),
        generatedEntry: bt.generatedEntry || null,
      };

      const findBestCfdi = (extraText = '') => {
        const candidates = isDeposit ? emitidosList : recibidosList;
        const usedSet = isDeposit ? usedEmitidoIds : usedRecibidoIds;
        const descNorm = stripAccents(`${item.description || ''} ${extraText || ''}`.toLowerCase());

        let bestCfdi = null;
        let bestScore = -999;

        for (const cfdi of candidates) {
          if (usedSet.has(cfdi.id)) continue;
          const cfdiTotal = Number(cfdi.total || 0);
          if (Math.abs(cfdiTotal - absAmt) <= 0.05) {
            let score = 100;
            const dDiff = daysBetweenDates(item.date, cfdi.date);
            score -= Math.min(dDiff, 40);

            const partnerName = stripAccents(
              (cfdi.partner_name || cfdi.receiver_name || cfdi.issuer_name || '').toLowerCase()
            );
            const partnerRfc = (cfdi.partner_rfc || cfdi.receiver_rfc || cfdi.issuer_rfc || '').toLowerCase();
            const words = partnerName.split(/\s+/).filter((w) => w.length >= 4);
            if (partnerRfc && descNorm.includes(partnerRfc)) score += 50;
            if (words.some((w) => descNorm.includes(w))) score += 35;
            if (cfdi.folio && descNorm.includes(String(cfdi.folio).toLowerCase())) score += 40;
            if (cfdi.uuid && descNorm.includes(String(cfdi.uuid).slice(0, 8).toLowerCase())) score += 60;

            if (score > bestScore) {
              bestScore = score;
              bestCfdi = cfdi;
            }
          }
        }
        if (bestCfdi) {
          usedSet.add(bestCfdi.id);
        }
        return bestCfdi;
      };

      // Si ya tenía una póliza generada en esta sesión/mes y sigue en libros, marcar como conciliado
      if (item.generatedEntry?.id) {
        const matchedJl = nextBooks.find((jl) => jl.entry_id === item.generatedEntry.id && !usedBookIds.has(jl.id));
        if (matchedJl) {
          item.reconciled = true;
          matchedJl.reconciled = true;
          usedBookIds.add(matchedJl.id);
          if (!item.matchedCfdiId && !item.manualAccountId) {
            const cMatch = findBestCfdi(matchedJl.concept);
            if (cMatch) item.matchedCfdiId = cMatch.id;
          }
          return item;
        }
      }

      // 0. Verificar si ya existe movimiento en libros de la cuenta bancaria con mismo importe y fecha cercana
      const expectedBookType = isDeposit ? 'debe' : 'haber';
      for (const jl of nextBooks) {
        if (usedBookIds.has(jl.id)) continue;
        if (jl.type !== expectedBookType) continue;
        if (Math.abs(absAmt - Number(jl.amount || 0)) < 0.01 && daysBetweenDates(item.date, jl.date) <= 7) {
          item.reconciled = true;
          jl.reconciled = true;
          usedBookIds.add(jl.id);
          item.generatedEntry = {
            id: jl.entry_id,
            journal: jl.journal,
            entry_type: isDeposit ? 'ingreso' : 'egreso',
          };
          if (!item.matchedCfdiId && !item.manualAccountId) {
            const cMatch = findBestCfdi(jl.concept);
            if (cMatch) item.matchedCfdiId = cMatch.id;
          }
          return item;
        }
      }

      // Conservar si el usuario ya había elegido CFDI o cuenta manual previamente
      if (item.matchedCfdiId) {
        item.matchMode = 'cfdi';
        return item;
      }
      if (item.manualAccountId && activeAfectableIds.has(Number(item.manualAccountId))) {
        item.matchMode = 'manual';
        return item;
      }

      // 1. Buscar CFDI Emitido (si es Abono) o CFDI Recibido (si es Cargo)
      const bestCfdi = findBestCfdi();

      if (bestCfdi) {
        item.matchedCfdiId = bestCfdi.id;
        item.matchMode = 'cfdi';
        item.suggestedByMemory = false;
      } else {
        // 2. Sin CFDI relacionado -> Consultar Memoria Contable Inteligente (capturas de meses anteriores)
        item.matchedCfdiId = null;
        item.matchMode = 'manual';
        const suggestedAccId = findSuggestedAccountFromMemory(item, rulesToUse, activeAfectableIds);
        if (suggestedAccId) {
          item.manualAccountId = suggestedAccId;
          item.suggestedByMemory = true;
        }
      }

      return item;
    });

    return { nextBank, nextBooks };
  };

  const loadPeriodReconciliation = async (accId, yr, mo, emitidosArg = null, recibidosArg = null) => {
    if (!clientId || !accId || !yr || !mo) return;
    setLoading(true);
    try {
      const emiList = emitidosArg || cfdiEmitidos;
      const recList = recibidosArg || cfdiRecibidos;
      const freshBooks = await fetchBookMovementsForPeriod(accId, yr, mo);
      const latestRules = loadSmartBankMemory(clientId);
      setSmartMemoryRules(latestRules);

      const savedRaw = localStorage.getItem(getStorageKey(clientId, accId, yr, mo));
      if (savedRaw) {
        const parsed = JSON.parse(savedRaw);
        const savedBankTxs = parsed.bankTransactions || [];
        const savedMeta = parsed.statementMeta || {
          period_year: yr,
          period_month: mo,
          file_name: 'Estado de cuenta guardado',
          initialBalance: 0,
          bankBalance: 0,
        };
        const { nextBank, nextBooks } = enrichAndMatchTransactions(
          savedBankTxs,
          freshBooks,
          emiList,
          recList,
          latestRules,
          allAccounts
        );
        const computedSum = computeSummaryClient(
          nextBank,
          nextBooks,
          savedMeta.initialBalance || 0,
          savedMeta.bankBalance || null
        );
        setStatementMeta(savedMeta);
        setBankTransactions(nextBank);
        setBookEntries(nextBooks);
        setSummary(computedSum);
        if (currentStep < 2) {
          setCurrentStep(2);
        }
      } else {
        const computedSum = computeSummaryClient([], freshBooks, 0, 0);
        setStatementMeta({
          period_year: yr,
          period_month: mo,
          file_name: null,
          initialBalance: 0,
          bankBalance: 0,
        });
        setBankTransactions([]);
        setBookEntries(freshBooks);
        setSummary(computedSum);
      }
    } catch (e) {
      console.warn('Error cargando periodo de conciliación:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedAccount && selectedYear && selectedMonth && allAccounts.length > 0) {
      loadPeriodReconciliation(selectedAccount, selectedYear, selectedMonth);
    }
  }, [selectedAccount, selectedYear, selectedMonth, allAccounts.length]);

  const monthSelectOptions = useMemo(() => {
    return MONTH_OPTIONS.map((m) => {
      const hasSaved =
        clientId && selectedAccount
          ? Boolean(localStorage.getItem(getStorageKey(clientId, selectedAccount, selectedYear, m.value)))
          : false;
      return {
        value: m.value,
        label: hasSaved ? `${m.label} ✓ (Con estado de cuenta)` : m.label,
      };
    });
  }, [clientId, selectedAccount, selectedYear, savedMonthsVersion]);

  const afectableAccountOptions = useMemo(() => {
    return allAccounts
      .filter((a) => a.is_active !== false && (a.classification || '').trim().toLowerCase() === 'afectable')
      .map((a) => ({
        value: a.id,
        label: `${a.account_number} - ${a.name}`,
      }));
  }, [allAccounts]);

  const emitidoOptions = useMemo(() => {
    return cfdiEmitidos.map((c) => ({
      value: c.id,
      label: `[${c.folio || c.uuid?.slice(0, 8)}] ${c.date} | ${c.partner_name || c.receiver_name || c.receiver_rfc} | ${formatMoney(c.total)} (${c.payment_method || 'PUE'})`,
      cfdi: c,
    }));
  }, [cfdiEmitidos]);

  const recibidoOptions = useMemo(() => {
    return cfdiRecibidos.map((c) => ({
      value: c.id,
      label: `[${c.folio || c.uuid?.slice(0, 8)}] ${c.date} | ${c.partner_name || c.issuer_name || c.issuer_rfc} | ${formatMoney(c.total)} (${c.payment_method || 'PUE'})`,
      cfdi: c,
    }));
  }, [cfdiRecibidos]);

  const resolveOrCreatePartnerAccount = async (partnerType, rfc, name, currentAccList) => {
    const cleanRfc = String(rfc || '').trim().toUpperCase();
    const cleanName = String(name || '').trim();
    const prefix = partnerType === 'cliente' ? '105-01-' : '201-01-';
    const parentNum = `${prefix}000`;
    const satCode = partnerType === 'cliente' ? '105.01' : '201.01';
    const nature = partnerType === 'cliente' ? 'deudora' : 'acreedora';

    const existingSubs = currentAccList.filter(
      (a) => (a.account_number || '').startsWith(prefix) && a.account_number !== parentNum
    );

    for (const acc of existingSubs) {
      const accNameUpper = String(acc.name || '').toUpperCase();
      if (cleanRfc && accNameUpper.includes(cleanRfc)) return acc;
      if (cleanName && (accNameUpper === cleanName.toUpperCase() || accNameUpper.includes(cleanName.toUpperCase()))) {
        return acc;
      }
    }

    let maxSeq = 0;
    existingSubs.forEach((acc) => {
      const parts = String(acc.account_number || '').split('-');
      if (parts.length === 3 && /^\d+$/.test(parts[2])) {
        const seq = Number(parts[2]);
        if (seq > maxSeq) maxSeq = seq;
      }
    });

    const nextSeqStr = String(maxSeq + 1).padStart(3, '0');
    const newAccountNumber = `${prefix}${nextSeqStr}`;
    const parentAcc = currentAccList.find((a) => a.account_number === parentNum);
    const displayName =
      cleanRfc && !cleanName.toUpperCase().includes(cleanRfc)
        ? `${cleanName || (partnerType === 'cliente' ? 'Cliente' : 'Proveedor')} (${cleanRfc})`
        : cleanName || `${partnerType === 'cliente' ? 'Cliente' : 'Proveedor'} ${nextSeqStr}`;

    const res = await accountsApi.create({
      client_id: Number(clientId),
      account_number: newAccountNumber,
      name: displayName.slice(0, 280),
      sat_group_code: satCode,
      level: 3,
      nature,
      classification: 'Afectable',
      is_active: true,
      parent_id: parentAcc ? parentAcc.id : null,
    });
    const createdAcc = res.data;
    setAllAccounts((prev) => [...prev, createdAcc]);
    return createdAcc;
  };

  const generatePolicyForBankTx = async (bt, currentAccList) => {
    const signedAmt = Number(bt.amount || 0);
    const absAmt = Number(Math.abs(signedAmt).toFixed(2));
    const isDeposit = signedAmt > 0;
    const entryType = isDeposit ? 'ingreso' : 'egreso';
    const bankAccObj = currentAccList.find((a) => a.id === selectedAccount);
    const bankLabel = bankAccObj ? `${bankAccObj.account_number} ${bankAccObj.name}` : 'Bancos';

    // CASO 1: Con CFDI Relacionado -> Cancelación de Cliente (105-01-xxx) o Proveedor (201-01-xxx)
    if (bt.matchedCfdiId) {
      const cfdiList = isDeposit ? cfdiEmitidos : cfdiRecibidos;
      const cfdi = cfdiList.find((c) => c.id === bt.matchedCfdiId);
      if (!cfdi) {
        throw new Error('No se encontró el CFDI seleccionado.');
      }

      const partnerRfc = isDeposit ? cfdi.receiver_rfc : cfdi.issuer_rfc;
      const partnerName = isDeposit ? cfdi.receiver_name || cfdi.partner_name : cfdi.issuer_name || cfdi.partner_name;
      const partnerType = isDeposit ? 'cliente' : 'proveedor';
      const partnerAcc = await resolveOrCreatePartnerAccount(partnerType, partnerRfc, partnerName, currentAccList);

      const folioStr = cfdi.folio || (cfdi.uuid ? cfdi.uuid.slice(0, 8) : 'S/F');
      const policyDesc = isDeposit
        ? `Cobro CFDI Emitido ${folioStr} - Cancelación Cliente ${partnerName || ''} (${bt.description || ''})`.trim()
        : `Pago CFDI Recibido ${folioStr} - Cancelación Proveedor ${partnerName || ''} (${bt.description || ''})`.trim();

      const lines = [];
      if (isDeposit) {
        lines.push({
          account_id: selectedAccount,
          debit: absAmt,
          credit: 0,
          description: `Entrada en ${bankLabel} - Cobro Factura ${folioStr}`,
          line_order: 1,
        });
        lines.push({
          account_id: partnerAcc.id,
          debit: 0,
          credit: absAmt,
          description: `Cancelación saldo Cliente ${partnerName || ''} - Factura ${folioStr}`,
          line_order: 2,
        });

        const ivaAmt = Number(cfdi.iva_trasladado || 0);
        if ((cfdi.payment_method || '').toUpperCase() === 'PPD' && ivaAmt > 0) {
          const acc209 = currentAccList.find((a) => a.account_number === '209-01-000');
          const acc208 = currentAccList.find((a) => a.account_number === '208-01-000');
          if (acc209 && acc208) {
            const prop = Number(cfdi.total || 0) > 0 ? Math.min(1, absAmt / Number(cfdi.total)) : 1;
            const ivaReclass = Number((ivaAmt * prop).toFixed(2));
            if (ivaReclass > 0) {
              lines.push({
                account_id: acc209.id,
                debit: ivaReclass,
                credit: 0,
                description: `Cancelación IVA trasladado no cobrado Factura ${folioStr}`,
                line_order: 3,
              });
              lines.push({
                account_id: acc208.id,
                debit: 0,
                credit: ivaReclass,
                description: `IVA trasladado cobrado Factura ${folioStr}`,
                line_order: 4,
              });
            }
          }
        }
      } else {
        lines.push({
          account_id: partnerAcc.id,
          debit: absAmt,
          credit: 0,
          description: `Cancelación saldo Proveedor ${partnerName || ''} - Factura ${folioStr}`,
          line_order: 1,
        });
        lines.push({
          account_id: selectedAccount,
          debit: 0,
          credit: absAmt,
          description: `Salida de ${bankLabel} - Pago Factura ${folioStr}`,
          line_order: 2,
        });

        const ivaAmt = Number(cfdi.iva_trasladado || 0);
        if ((cfdi.payment_method || '').toUpperCase() === 'PPD' && ivaAmt > 0) {
          const acc118 = currentAccList.find((a) => a.account_number === '118-01-000');
          const acc119 = currentAccList.find((a) => a.account_number === '119-01-000');
          if (acc118 && acc119) {
            const prop = Number(cfdi.total || 0) > 0 ? Math.min(1, absAmt / Number(cfdi.total)) : 1;
            const ivaReclass = Number((ivaAmt * prop).toFixed(2));
            if (ivaReclass > 0) {
              lines.push({
                account_id: acc118.id,
                debit: ivaReclass,
                credit: 0,
                description: `IVA acreditable efectivamente pagado Factura ${folioStr}`,
                line_order: 3,
              });
              lines.push({
                account_id: acc119.id,
                debit: 0,
                credit: ivaReclass,
                description: `Cancelación IVA pendiente de pago Factura ${folioStr}`,
                line_order: 4,
              });
            }
          }
        }
      }

      const entryRes = await journalsApi.create({
        client_id: Number(clientId),
        entry_type: entryType,
        date: bt.date,
        description: policyDesc.slice(0, 480),
        reference: (bt.ref || folioStr || 'CONCILIACION').slice(0, 140),
        cfdi_uuid: cfdi.uuid,
        cfdi_issuer_rfc: cfdi.issuer_rfc,
        cfdi_receiver_rfc: cfdi.receiver_rfc,
        cfdi_total: absAmt,
        lines,
      });
      return entryRes.data;
    }

    // CASO 2: Sin CFDI Relacionado -> Captura manual o cuenta sugerida por Memoria Inteligente
    if (bt.manualAccountId) {
      // Guardar en Memoria Contable Inteligente para próximos meses
      const updatedRules = saveSmartBankMemoryRule(
        clientId,
        isDeposit ? 'abono' : 'cargo',
        bt.description,
        bt.manualAccountId
      );
      setSmartMemoryRules(updatedRules);

      const targetAcc = currentAccList.find((a) => a.id === bt.manualAccountId);
      const targetName = targetAcc ? `${targetAcc.account_number} ${targetAcc.name}` : 'Cuenta asignada';
      const policyDesc = `${bt.description || (isDeposit ? 'Depósito bancario' : 'Cargo bancario')} (${targetName})`;

      const lines = isDeposit
        ? [
            {
              account_id: selectedAccount,
              debit: absAmt,
              credit: 0,
              description: bt.description || `Depósito en ${bankLabel}`,
              line_order: 1,
            },
            {
              account_id: bt.manualAccountId,
              debit: 0,
              credit: absAmt,
              description: bt.description || `Abono a ${targetName}`,
              line_order: 2,
            },
          ]
        : [
            {
              account_id: bt.manualAccountId,
              debit: absAmt,
              credit: 0,
              description: bt.description || `Cargo a ${targetName}`,
              line_order: 1,
            },
            {
              account_id: selectedAccount,
              debit: 0,
              credit: absAmt,
              description: bt.description || `Retiro de ${bankLabel}`,
              line_order: 2,
            },
          ];

      const entryRes = await journalsApi.create({
        client_id: Number(clientId),
        entry_type: entryType,
        date: bt.date,
        description: policyDesc.slice(0, 480),
        reference: (bt.ref || 'BANCOS').slice(0, 140),
        lines,
      });
      return entryRes.data;
    }

    throw new Error('Selecciona primero un CFDI relacionado o una Cuenta Contable para generar la póliza.');
  };

  const handleGenerateSingleRowPolicy = async (btRow) => {
    setRowLoadingId(btRow.id);
    try {
      const createdEntry = await generatePolicyForBankTx(btRow, allAccounts);
      const prefix = (createdEntry.entry_type || 'P')[0].toUpperCase();
      const folioLabel = `${prefix}-${createdEntry.entry_number}`;
      const isDeposit = Number(btRow.amount || 0) > 0;
      const absAmt = Math.abs(Number(btRow.amount || 0));

      const nextBank = bankTransactions.map((item) =>
        item.id === btRow.id
          ? {
              ...item,
              reconciled: true,
              generatedEntry: {
                id: createdEntry.id,
                entry_number: createdEntry.entry_number,
                entry_type: createdEntry.entry_type,
                journal: folioLabel,
              },
            }
          : item
      );

      const newBookRow = {
        id: `jl-gen-${createdEntry.id}`,
        entry_id: createdEntry.id,
        date: btRow.date,
        journal: folioLabel,
        concept: createdEntry.description || btRow.description,
        debit: isDeposit ? absAmt : 0,
        credit: isDeposit ? 0 : absAmt,
        amount: absAmt,
        type: isDeposit ? 'debe' : 'haber',
        reconciled: true,
      };

      const nextBooks = [...bookEntries, newBookRow].sort((a, b) => a.date.localeCompare(b.date));
      const updatedSummary = computeSummaryClient(
        nextBank,
        nextBooks,
        statementMeta?.initialBalance || 0,
        statementMeta?.bankBalance || null
      );

      setBankTransactions(nextBank);
      setBookEntries(nextBooks);
      setSummary(updatedSummary);
      saveMonthReconciliationToStorage(
        selectedAccount,
        selectedYear,
        selectedMonth,
        statementMeta,
        nextBank,
        nextBooks,
        updatedSummary
      );
      message.success(`Póliza ${folioLabel} (${createdEntry.entry_type.toUpperCase()}) generada y conciliada.`);
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || 'Error al generar la póliza';
      message.error(detail);
    } finally {
      setRowLoadingId(null);
    }
  };

  const finalizeClientTransactions = async (transactions, initialBalance, finalBalance, fileName) => {
    const firstDate = transactions[0].date;
    const [yrStr, moStr] = firstDate.split('-');
    const year = Number(yrStr);
    const month = Number(moStr);

    setSelectedYear(year);
    setSelectedMonth(month);

    const ctx = await loadClientContext();
    const books = await fetchBookMovementsForPeriod(selectedAccount, year, month);

    const { nextBank, nextBooks } = enrichAndMatchTransactions(
      transactions,
      books,
      ctx.emitidos,
      ctx.recibidos,
      ctx.memoryRules,
      ctx.allAccs
    );

    const computedSummary = computeSummaryClient(nextBank, nextBooks, initialBalance, finalBalance);
    const nextMeta = {
      period_year: year,
      period_month: month,
      file_name: fileName,
      initialBalance,
      bankBalance: computedSummary.bankBalance,
    };
    setStatementMeta(nextMeta);
    setBankTransactions(nextBank);
    setBookEntries(nextBooks);
    setSummary(computedSummary);
    saveMonthReconciliationToStorage(selectedAccount, year, month, nextMeta, nextBank, nextBooks, computedSummary);
  };

  const fallbackClientParse = async (file) => {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const isZipXlsx =
      file.name.toLowerCase().endsWith('.xlsx') ||
      (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04);

    let rows = [];
    if (isZipXlsx) {
      rows = await extractRowsFromXlsxBuffer(buffer);
    } else {
      let text = '';
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        text = new TextDecoder('windows-1252').decode(buffer);
      }
      rows = extractRowsFromCsvText(text);
    }

    const { transactions, initialBalance, finalBalance } = parseRowsClient(rows);
    if (!transactions.length) {
      setRawPreviewRows(rows.slice(0, 12));
      setPendingFileName(file.name);
      throw new Error(
        'No se detectaron automáticamente las columnas de Fecha e Importe/Cargo/Abono. Selecciona abajo a qué columna corresponde cada dato y haz clic en "Procesar Estado de Cuenta".'
      );
    }

    setRawPreviewRows([]);
    await finalizeClientTransactions(transactions, initialBalance, finalBalance, file.name);
    return transactions.length;
  };

  const handleManualColumnProcess = async () => {
    if (!rawPreviewRows.length) return;
    setLoading(true);
    setUploadError(null);
    try {
      const { transactions, initialBalance, finalBalance } = parseRowsClient(rawPreviewRows, colMap);
      if (!transactions.length) {
        setUploadError('No se encontraron filas con fecha e importe válidos en las columnas seleccionadas.');
        return;
      }
      await finalizeClientTransactions(transactions, initialBalance, finalBalance, pendingFileName);
      message.success(`Estado de cuenta cargado (${transactions.length} movimientos)`);
      setCurrentStep(2);
    } catch (e) {
      setUploadError(e.message || 'Error al procesar columnas');
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (options) => {
    const { file, onSuccess, onError } = options;
    setLoading(true);
    setUploadError(null);
    try {
      const count = await fallbackClientParse(file);
      message.success(`Estado de cuenta cargado (${count} movimientos)`);
      onSuccess('ok');
      setCurrentStep(2);
    } catch (fallbackErr) {
      onError(fallbackErr);
      const detail = fallbackErr?.message || 'Error al cargar el estado de cuenta';
      setUploadError(detail);
      message.error(detail);
    } finally {
      setLoading(false);
    }
  };

  const autoReconcileAndGeneratePolicies = async () => {
    setLoading(true);
    try {
      let currentAccs = [...allAccounts];
      const nextBank = bankTransactions.map((t) => ({ ...t }));
      const nextBooks = bookEntries.map((b) => ({ ...b }));
      const matchedBookIds = new Set(nextBooks.filter((b) => b.reconciled).map((b) => b.id));

      let reconciledExisting = 0;
      let generatedPolicies = 0;
      const errors = [];

      nextBank.forEach((bt) => {
        if (bt.reconciled) return;
        const btAbs = Math.abs(Number(bt.amount || 0));
        const expectedBookType = Number(bt.amount || 0) > 0 ? 'debe' : 'haber';

        for (const jl of nextBooks) {
          if (matchedBookIds.has(jl.id)) continue;
          if (jl.type !== expectedBookType) continue;
          if (Math.abs(btAbs - Number(jl.amount || 0)) < 0.01 && daysBetweenDates(bt.date, jl.date) <= 7) {
            bt.reconciled = true;
            jl.reconciled = true;
            matchedBookIds.add(jl.id);
            bt.generatedEntry = {
              id: jl.entry_id,
              journal: jl.journal,
              entry_type: expectedBookType === 'debe' ? 'ingreso' : 'egreso',
            };
            reconciledExisting += 1;
            break;
          }
        }
      });

      for (let i = 0; i < nextBank.length; i += 1) {
        const bt = nextBank[i];
        if (bt.reconciled) continue;
        if (!bt.matchedCfdiId && !bt.manualAccountId) continue;

        try {
          const createdEntry = await generatePolicyForBankTx(bt, currentAccs);
          const refreshedAccRes = await accountsApi
            .getClientAccounts(clientId, { active_only: true })
            .catch(() => ({ data: currentAccs }));
          currentAccs = refreshedAccRes.data || currentAccs;

          const prefix = (createdEntry.entry_type || 'P')[0].toUpperCase();
          const folioLabel = `${prefix}-${createdEntry.entry_number}`;
          const isDeposit = Number(bt.amount || 0) > 0;
          const absAmt = Math.abs(Number(bt.amount || 0));

          bt.reconciled = true;
          bt.generatedEntry = {
            id: createdEntry.id,
            entry_number: createdEntry.entry_number,
            entry_type: createdEntry.entry_type,
            journal: folioLabel,
          };

          nextBooks.push({
            id: `jl-gen-${createdEntry.id}`,
            entry_id: createdEntry.id,
            date: bt.date,
            journal: folioLabel,
            concept: createdEntry.description || bt.description,
            debit: isDeposit ? absAmt : 0,
            credit: isDeposit ? 0 : absAmt,
            amount: absAmt,
            type: isDeposit ? 'debe' : 'haber',
            reconciled: true,
          });
          generatedPolicies += 1;
        } catch (err) {
          errors.push(
            `${bt.date} (${formatMoney(bt.amount)}): ${err?.response?.data?.detail || err?.message || 'Error'}`
          );
        }
      }

      setAllAccounts(currentAccs);
      nextBooks.sort((a, b) => a.date.localeCompare(b.date));
      const updatedSummary = computeSummaryClient(
        nextBank,
        nextBooks,
        statementMeta?.initialBalance || 0,
        statementMeta?.bankBalance || null
      );
      setBankTransactions(nextBank);
      setBookEntries(nextBooks);
      setSummary(updatedSummary);
      saveMonthReconciliationToStorage(
        selectedAccount,
        selectedYear,
        selectedMonth,
        statementMeta,
        nextBank,
        nextBooks,
        updatedSummary
      );

      if (errors.length > 0) {
        message.warning(
          `Se generaron ${generatedPolicies} pólizas y se conciliaron ${reconciledExisting} movimientos (${errors.length} con error).`
        );
      } else {
        message.success(
          `Proceso completado: ${generatedPolicies} pólizas generadas automáticamente y ${
            reconciledExisting + generatedPolicies
          } movimientos conciliados.`
        );
      }
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || 'Error al conciliar movimientos';
      message.error(detail);
    } finally {
      setLoading(false);
    }
  };

  const updateBankTxRow = (rowId, patch) => {
    setBankTransactions((prev) => {
      const targetRow = prev.find((item) => item.id === rowId);
      let updatedRules = smartMemoryRules;

      // Si el usuario acaba de elegir una cuenta contable manual, guardarla en la Memoria Inteligente
      // y sugerirla también en otros movimientos similares del mismo mes que aún no tengan cuenta asignada
      if (targetRow && patch.manualAccountId) {
        const txType = Number(targetRow.amount || 0) > 0 ? 'abono' : 'cargo';
        updatedRules = saveSmartBankMemoryRule(clientId, txType, targetRow.description, patch.manualAccountId);
        setSmartMemoryRules(updatedRules);
      }

      const activeAfectableIds = new Set(
        allAccounts
          .filter((a) => a.is_active !== false && (a.classification || '').trim().toLowerCase() === 'afectable')
          .map((a) => Number(a.id))
      );

      let autoFilledSiblings = 0;
      const next = prev.map((item) => {
        if (item.id === rowId) {
          return { ...item, ...patch, suggestedByMemory: false };
        }
        // Si otro movimiento del mismo tipo no tiene CFDI ni cuenta manual y coincide con la nueva regla aprendida, sugerirla
        if (
          patch.manualAccountId &&
          !item.reconciled &&
          !item.matchedCfdiId &&
          !item.manualAccountId
        ) {
          const suggested = findSuggestedAccountFromMemory(item, updatedRules, activeAfectableIds);
          if (suggested === Number(patch.manualAccountId)) {
            autoFilledSiblings += 1;
            return {
              ...item,
              matchMode: 'manual',
              manualAccountId: suggested,
              suggestedByMemory: true,
            };
          }
        }
        return item;
      });

      if (autoFilledSiblings > 0) {
        message.info(
          `Memoria Inteligente: Se pre-asignó automáticamente la misma cuenta a ${autoFilledSiblings} movimiento(s) similar(es).`
        );
      }

      saveMonthReconciliationToStorage(
        selectedAccount,
        selectedYear,
        selectedMonth,
        statementMeta,
        next,
        bookEntries,
        summary
      );
      return next;
    });
  };

  const buildReconciliationExportPayload = () => {
    const selectedBankAccObj = accounts.find((a) => a.id === selectedAccount);
    const bankAccLabel = selectedBankAccObj
      ? `${selectedBankAccObj.account_number} - ${selectedBankAccObj.name}`
      : 'Cuenta Bancaria';
    const monthObj = MONTH_OPTIONS.find((m) => m.value === Number(selectedMonth));
    const periodLabel = `${monthObj ? monthObj.label : selectedMonth} ${selectedYear}`;

    const columnsDef = [
      { key: 'date', title: 'Fecha', align: 'center', format: 'text', width: 13 },
      { key: 'ref', title: 'Ref. / Póliza', align: 'center', format: 'text', width: 15 },
      { key: 'description', title: 'Descripción / Concepto', align: 'left', format: 'text', width: 34 },
      { key: 'relation', title: 'CFDI / Cuenta Contable Relacionada', align: 'left', format: 'text', width: 30 },
      { key: 'cargo', title: 'Cargo / Debe (-)', align: 'right', format: 'currency', width: 16 },
      { key: 'abono', title: 'Abono / Haber (+)', align: 'right', format: 'currency', width: 16 },
      { key: 'status', title: 'Estatus / Póliza', align: 'center', format: 'text', width: 18 },
    ];

    const rows = [];

    rows.push({
      date: '',
      ref: '',
      description: `I. MOVIMIENTOS DEL ESTADO DE CUENTA BANCARIO (${bankTransactions.length})`,
      relation: statementMeta?.file_name ? `Archivo: ${statementMeta.file_name}` : '',
      cargo: '',
      abono: '',
      status: '',
      _rowType: 'section',
    });

    let totalBankCargos = 0;
    let totalBankAbonos = 0;

    bankTransactions.forEach((bt) => {
      const signed = Number(bt.amount || 0);
      const isDeposit = signed > 0;
      const cargoVal = isDeposit ? 0 : Math.abs(signed);
      const abonoVal = isDeposit ? Math.abs(signed) : 0;
      totalBankCargos += cargoVal;
      totalBankAbonos += abonoVal;

      let relationLabel = 'Sin asignar';
      if (bt.matchedCfdiId) {
        const cfdiPool = isDeposit ? cfdiEmitidos : cfdiRecibidos;
        const cObj = cfdiPool.find((c) => c.id === bt.matchedCfdiId);
        if (cObj) {
          relationLabel = `CFDI ${cObj.folio || cObj.uuid?.slice(0, 8)} - ${
            cObj.partner_name || cObj.receiver_name || cObj.issuer_name || ''
          }`;
        }
      } else if (bt.manualAccountId) {
        const aObj = allAccounts.find((a) => a.id === bt.manualAccountId);
        if (aObj) {
          relationLabel = `${aObj.account_number} - ${aObj.name}`;
        }
      } else if (bt.reconciled && bt.generatedEntry?.journal) {
        relationLabel = `Póliza en Libros (${bt.generatedEntry.journal})`;
      }

      const statusLabel = bt.reconciled
        ? `Conciliado (${bt.generatedEntry?.journal || 'OK'})`
        : 'Pendiente';

      rows.push({
        date: bt.date,
        ref: bt.ref || '-',
        description: bt.description || '-',
        relation: relationLabel,
        cargo: cargoVal,
        abono: abonoVal,
        status: statusLabel,
        _rowType: 'normal',
      });
    });

    rows.push({
      date: '',
      ref: '',
      description: 'SUBTOTAL MOVIMIENTOS BANCARIOS DEL PERIODO',
      relation: '',
      cargo: totalBankCargos,
      abono: totalBankAbonos,
      status: `Neto: ${formatMoney(totalBankAbonos - totalBankCargos)}`,
      _rowType: 'subtotal',
    });

    rows.push({
      date: '',
      ref: '',
      description: `II. MOVIMIENTOS EN LIBROS CONTABLES (${bookEntries.length})`,
      relation: bankAccLabel,
      cargo: '',
      abono: '',
      status: '',
      _rowType: 'section',
    });

    let totalBookDebit = 0;
    let totalBookCredit = 0;

    bookEntries.forEach((b) => {
      const deb = b.type === 'debe' ? Number(b.amount || 0) : 0;
      const cred = b.type === 'haber' ? Number(b.amount || 0) : 0;
      totalBookDebit += deb;
      totalBookCredit += cred;

      rows.push({
        date: b.date,
        ref: b.journal || '-',
        description: b.concept || '-',
        relation: 'Auxiliar de Bancos en Libros',
        cargo: deb,
        abono: cred,
        status: b.reconciled ? 'Conciliado' : 'En Tránsito / Pendiente',
        _rowType: 'normal',
      });
    });

    rows.push({
      date: '',
      ref: '',
      description: 'SUBTOTAL MOVIMIENTOS EN LIBROS DEL PERIODO',
      relation: '',
      cargo: totalBookDebit,
      abono: totalBookCredit,
      status: `Saldo Libros: ${formatMoney(totalBookDebit - totalBookCredit)}`,
      _rowType: 'subtotal',
    });

    rows.push({
      date: '',
      ref: '',
      description: 'III. RESUMEN DE CONCILIACIÓN BANCARIA',
      relation: '',
      cargo: '',
      abono: '',
      status: '',
      _rowType: 'section',
    });

    rows.push({
      date: '',
      ref: '',
      description: 'Saldo final según Estado de Cuenta Bancario',
      relation: '',
      cargo: 0,
      abono: summary.bankBalance,
      status: '',
      _rowType: 'normal',
    });
    rows.push({
      date: '',
      ref: '(+)',
      description: 'Cargos en libros no correspondidos por el banco',
      relation: '',
      cargo: 0,
      abono: summary.inTransitDebits,
      status: '',
      _rowType: 'normal',
    });
    rows.push({
      date: '',
      ref: '(-)',
      description: 'Abonos en libros no correspondidos por el banco',
      relation: '',
      cargo: summary.inTransitCredits,
      abono: 0,
      status: '',
      _rowType: 'normal',
    });
    rows.push({
      date: '',
      ref: '(=)',
      description: 'SALDO BANCARIO CONCILIADO VS. SALDO EN LIBROS',
      relation: `Saldo en Libros: ${formatMoney(summary.bookBalance)}`,
      cargo: summary.bookBalance,
      abono: summary.reconciledBalance,
      status: `Dif: ${formatMoney(summary.diff)}`,
      _rowType: 'total',
    });

    const summaryCards = [
      {
        label: 'Cuenta Bancaria',
        value: selectedBankAccObj ? selectedBankAccObj.account_number : '-',
        sublabel: selectedBankAccObj ? selectedBankAccObj.name : '',
      },
      {
        label: 'Saldo según Banco',
        value: formatMoney(summary.bankBalance),
        sublabel: `${bankTransactions.length} movimientos en estado de cuenta`,
      },
      {
        label: 'Saldo en Libros',
        value: formatMoney(summary.bookBalance),
        sublabel: `${bookEntries.length} pólizas registradas en el mes`,
      },
      {
        label: 'Diferencia Conciliación',
        value: formatMoney(summary.diff),
        sublabel: Math.abs(summary.diff) < 0.01 ? 'Conciliación cuadrada' : 'Por conciliar',
      },
    ];

    return {
      title: `CONCILIACIÓN BANCARIA — ${bankAccLabel.toUpperCase()}`,
      subtitle: 'Papel de Trabajo de Conciliación entre Estado de Cuenta Bancario, CFDI y Auxiliar Contable en Libros',
      clientName: clientInfo?.business_name || '',
      clientRfc: clientInfo?.rfc || '',
      period: periodLabel,
      columns: columnsDef,
      rows,
      summaryCards,
      orientation: 'landscape',
      notes: 'Cifras en Pesos Mexicanos (MXN). Reporte generado desde el módulo de Conciliación Bancaria.',
      filename: `Conciliacion_Bancaria_${selectedBankAccObj?.account_number || 'Banco'}_${selectedYear}_${String(
        selectedMonth
      ).padStart(2, '0')}.xlsx`,
    };
  };

  const handleExportExcel = () => {
    exportToExcel(buildReconciliationExportPayload());
  };

  const handleExportPdf = () => {
    exportToPdfWithLogo(buildReconciliationExportPayload());
  };

  const bankColumns = [
    {
      title: 'Fecha',
      dataIndex: 'date',
      width: 100,
      render: (val) => <span className="font-mono text-xs">{val}</span>,
    },
    {
      title: 'Movimiento Bancario',
      dataIndex: 'description',
      width: 240,
      render: (val, record) => (
        <div>
          <div className="font-medium text-xs text-gray-800">{val}</div>
          {record.ref && <div className="text-[11px] text-gray-400 font-mono">Ref: {record.ref}</div>}
        </div>
      ),
    },
    {
      title: 'Cargo / Abono',
      dataIndex: 'amount',
      width: 130,
      align: 'right',
      render: (val) => {
        const isDeposit = Number(val || 0) > 0;
        return (
          <div>
            <div className={isDeposit ? 'text-green-600 font-bold text-xs' : 'text-red-600 font-bold text-xs'}>
              {formatMoney(val)}
            </div>
            <Tag color={isDeposit ? 'green' : 'volcano'} className="text-[10px] m-0 mt-0.5">
              {isDeposit ? 'ABONO (+)' : 'CARGO (-)'}
            </Tag>
          </div>
        );
      },
    },
    {
      title: 'Relacionar CFDI (Cliente/Proveedor) o Captura Manual de Cuenta',
      key: 'matching',
      render: (_, record) => {
        const isDeposit = Number(record.amount || 0) > 0;
        const cfdiPool = isDeposit ? emitidoOptions : recibidoOptions;
        const selectedCfdiObj = (isDeposit ? cfdiEmitidos : cfdiRecibidos).find(
          (c) => c.id === record.matchedCfdiId
        );
        const cfdiViewerUrl = selectedCfdiObj
          ? `/cfdi-viewer/${selectedCfdiObj.uuid || selectedCfdiObj.id}`
          : null;

        if (record.reconciled && record.generatedEntry) {
          return (
            <div className="text-xs text-gray-600 flex flex-wrap items-center gap-2">
              <Tag color="green" icon={<CheckCircleOutlined />} className="m-0">
                Conciliado en {record.generatedEntry.journal}
              </Tag>
              {selectedCfdiObj && (
                <>
                  <span className="text-[11px] text-blue-700">
                    ({isDeposit ? 'Cancelación de Cliente' : 'Cancelación de Proveedor'}:{' '}
                    <strong>{selectedCfdiObj.partner_name || selectedCfdiObj.receiver_name || selectedCfdiObj.issuer_name}</strong>)
                  </span>
                  <a
                    href={cfdiViewerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-0.5 rounded transition-colors"
                  >
                    <FileSearchOutlined />
                    Ver Factura ({selectedCfdiObj.folio || selectedCfdiObj.uuid?.slice(0, 8)})
                  </a>
                </>
              )}
            </div>
          );
        }

        return (
          <div className="space-y-1.5 py-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Radio.Group
                size="small"
                value={record.matchMode || (record.matchedCfdiId ? 'cfdi' : 'manual')}
                onChange={(e) => {
                  const nextMode = e.target.value;
                  if (nextMode === 'manual') {
                    updateBankTxRow(record.id, { matchMode: 'manual', matchedCfdiId: null });
                  } else {
                    updateBankTxRow(record.id, { matchMode: 'cfdi', manualAccountId: null });
                  }
                }}
              >
                <Radio.Button value="cfdi" className="text-[11px]">
                  <FileDoneOutlined className="mr-1" />
                  CFDI {isDeposit ? 'Emitido (Cliente)' : 'Recibido (Proveedor)'}
                </Radio.Button>
                <Radio.Button value="manual" className="text-[11px]">
                  <PlusCircleOutlined className="mr-1" />
                  Sin CFDI (Cuenta Manual)
                </Radio.Button>
              </Radio.Group>

              {selectedCfdiObj && cfdiViewerUrl && (
                <a
                  href={cfdiViewerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2.5 py-0.5 rounded transition-colors"
                >
                  <FileSearchOutlined />
                  Ver Factura CFDI →
                </a>
              )}
            </div>

            {(record.matchMode || 'cfdi') === 'cfdi' ? (
              <div>
                <Select
                  showSearch
                  allowClear
                  size="small"
                  style={{ width: '100%' }}
                  placeholder={
                    isDeposit
                      ? 'Seleccionar CFDI Emitido para cancelar saldo del Cliente (105-01-xxx)...'
                      : 'Seleccionar CFDI Recibido para cancelar saldo del Proveedor (201-01-xxx)...'
                  }
                  optionFilterProp="label"
                  value={record.matchedCfdiId}
                  options={cfdiPool}
                  onChange={(val) => {
                    updateBankTxRow(record.id, {
                      matchedCfdiId: val || null,
                      matchMode: val ? 'cfdi' : 'manual',
                    });
                  }}
                />
                {selectedCfdiObj && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-blue-700 mt-1 bg-blue-50 px-2 py-1 rounded border border-blue-100">
                    <div>
                      {isDeposit ? (
                        <span>
                          <strong>Póliza de Ingreso:</strong> Cargo a Bancos / Abono a Cliente{' '}
                          <strong>{selectedCfdiObj.partner_name || selectedCfdiObj.receiver_name}</strong> (105-01-xxx)
                        </span>
                      ) : (
                        <span>
                          <strong>Póliza de Egreso:</strong> Cargo a Proveedor{' '}
                          <strong>{selectedCfdiObj.partner_name || selectedCfdiObj.issuer_name}</strong> (201-01-xxx) /
                          Abono a Bancos
                        </span>
                      )}
                    </div>
                    {cfdiViewerUrl && (
                      <a
                        href={cfdiViewerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-blue-700 hover:text-blue-900 underline whitespace-nowrap"
                      >
                        <FileSearchOutlined className="mr-1" />
                        Ver Factura ({selectedCfdiObj.folio || selectedCfdiObj.uuid?.slice(0, 8)})
                      </a>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <Select
                  showSearch
                  allowClear
                  size="small"
                  style={{ width: '100%' }}
                  placeholder={
                    isDeposit
                      ? 'Selecciona a qué cuenta corresponde el ABONO (Genera Póliza de Ingreso)...'
                      : 'Selecciona a qué cuenta corresponde el CARGO (Genera Póliza de Egreso)...'
                  }
                  optionFilterProp="label"
                  value={record.manualAccountId}
                  options={afectableAccountOptions}
                  onChange={(val) => updateBankTxRow(record.id, { manualAccountId: val || null, matchMode: 'manual' })}
                />
                <div className="flex flex-wrap items-center justify-between gap-1 mt-0.5">
                  <span className="text-[11px] text-gray-500">
                    {isDeposit ? (
                      <span>
                        Genera <strong>Póliza de Ingreso</strong>: Cargo a Bancos /{' '}
                        <strong>Abono a la cuenta elegida</strong>.
                      </span>
                    ) : (
                      <span>
                        Genera <strong>Póliza de Egreso</strong>: <strong>Cargo a la cuenta elegida</strong> / Abono a
                        Bancos.
                      </span>
                    )}
                  </span>
                  {record.manualAccountId && record.suggestedByMemory && (
                    <Tag color="gold" className="m-0 text-[10px]" icon={<BulbOutlined />}>
                      Sugerida por Memoria Inteligente
                    </Tag>
                  )}
                  {record.manualAccountId && !record.suggestedByMemory && (
                    <Tag color="blue" className="m-0 text-[10px]">
                      ✓ Guardada en Memoria Inteligente
                    </Tag>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: 'Acción / Póliza',
      key: 'action',
      width: 175,
      align: 'center',
      render: (_, record) => {
        if (record.reconciled && record.generatedEntry) {
          const entryId = record.generatedEntry.id;
          return (
            <div className="flex flex-col items-center gap-1">
              <Tag color="green" className="m-0 font-semibold">
                ✓ Póliza {record.generatedEntry.journal}
              </Tag>
              {entryId && (
                <Link
                  to={`/journal/${clientId}?entryId=${entryId}`}
                  className="text-xs text-blue-600 hover:underline font-medium"
                >
                  Ver en Pólizas →
                </Link>
              )}
            </div>
          );
        }

        const isReady = Boolean(record.matchedCfdiId || record.manualAccountId);
        const isDeposit = Number(record.amount || 0) > 0;

        return (
          <Tooltip
            title={
              isReady
                ? `Generar Póliza de ${isDeposit ? 'Ingreso' : 'Egreso'} automáticamente`
                : 'Selecciona un CFDI o una Cuenta Contable para generar la póliza'
            }
          >
            <Button
              type="primary"
              size="small"
              disabled={!isReady}
              loading={rowLoadingId === record.id}
              onClick={() => handleGenerateSingleRowPolicy(record)}
            >
              Generar {isDeposit ? 'Ingreso' : 'Egreso'}
            </Button>
          </Tooltip>
        );
      },
    },
  ];

  const bookColumns = [
    { title: 'Fecha', dataIndex: 'date', width: 105 },
    {
      title: 'Póliza',
      dataIndex: 'journal',
      width: 100,
      render: (val, record) =>
        record.entry_id ? (
          <Link to={`/journal/${clientId}?entryId=${record.entry_id}`} className="text-blue-600 font-semibold underline">
            {val}
          </Link>
        ) : (
          val
        ),
    },
    { title: 'Concepto', dataIndex: 'concept' },
    {
      title: 'Debe / Haber',
      dataIndex: 'amount',
      align: 'right',
      width: 130,
      render: (val, record) => (
        <span className={record.type === 'haber' ? 'text-red-600 font-semibold' : 'text-green-600 font-semibold'}>
          {formatMoney(record.type === 'haber' ? -val : val)}
        </span>
      ),
    },
    {
      title: 'Estado',
      dataIndex: 'reconciled',
      width: 105,
      render: (val) => <Tag color={val ? 'green' : 'orange'}>{val ? 'Conciliado' : 'Pendiente'}</Tag>,
    },
  ];

  const maxPreviewCols = rawPreviewRows.reduce((m, r) => Math.max(m, r.length), 0);
  const colOptions = Array.from({ length: maxPreviewCols }, (_, i) => ({
    value: i,
    label: `Columna ${i + 1}`,
  }));

  const stats = useMemo(() => {
    const total = bankTransactions.length;
    const reconciled = bankTransactions.filter((t) => t.reconciled).length;
    const pending = total - reconciled;
    const withCfdi = bankTransactions.filter((t) => !t.reconciled && t.matchedCfdiId).length;
    const withManualAcc = bankTransactions.filter((t) => !t.reconciled && !t.matchedCfdiId && t.manualAccountId).length;
    const suggestedCount = bankTransactions.filter(
      (t) => !t.reconciled && !t.matchedCfdiId && t.manualAccountId && t.suggestedByMemory
    ).length;
    const unassigned = total - reconciled - withCfdi - withManualAcc;
    return { total, reconciled, pending, withCfdi, withManualAcc, suggestedCount, unassigned };
  }, [bankTransactions]);

  const filteredBankTransactions = useMemo(() => {
    if (statusFilter === 'reconciled') return bankTransactions.filter((t) => t.reconciled);
    if (statusFilter === 'pending') return bankTransactions.filter((t) => !t.reconciled);
    return bankTransactions;
  }, [bankTransactions, statusFilter]);

  const filteredBookEntries = useMemo(() => {
    if (statusFilter === 'reconciled') return bookEntries.filter((b) => b.reconciled);
    if (statusFilter === 'pending') return bookEntries.filter((b) => !b.reconciled);
    return bookEntries;
  }, [bookEntries, statusFilter]);

  const currentMonthLabel =
    MONTH_OPTIONS.find((m) => m.value === Number(selectedMonth))?.name || `Mes ${selectedMonth}`;

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap justify-between items-center gap-4">
        <div>
          <Title level={2} className="m-0">
            Conciliación Bancaria
          </Title>
          {clientInfo && (
            <Text type="secondary" className="text-sm">
              Empresa: <strong className="text-gray-700">{clientInfo.rfc} — {clientInfo.business_name}</strong>
            </Text>
          )}
        </div>

        <Space wrap>
          <Button
            type="primary"
            icon={<FileExcelOutlined />}
            onClick={handleExportExcel}
            disabled={!selectedAccount}
            className="bg-emerald-600 hover:bg-emerald-700 border-emerald-600 font-semibold shadow-sm"
          >
            Exportar Excel (.xlsx)
          </Button>
          <Button
            type="primary"
            icon={<FilePdfOutlined />}
            onClick={handleExportPdf}
            disabled={!selectedAccount}
            style={{ backgroundColor: '#0ea5e9', borderColor: '#0ea5e9', color: '#ffffff' }}
            className="font-semibold shadow-sm"
          >
            PDF Membretado
          </Button>
          <Button icon={<PrinterOutlined />} onClick={handleExportPdf} disabled={!selectedAccount}>
            Imprimir Reporte
          </Button>
        </Space>
      </div>

      <Card size="small" className="mb-6 bg-slate-50 border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                <BankOutlined className="mr-1 text-blue-600" />
                Cuenta Bancaria (102-01 / 102-02):
              </label>
              <Select
                showSearch
                optionFilterProp="label"
                value={selectedAccount}
                style={{ width: 320 }}
                placeholder="Seleccione cuenta bancaria..."
                onChange={(val) => setSelectedAccount(val)}
                options={accounts.map((a) => ({
                  value: a.id,
                  label: `${a.account_number} - ${a.name}`,
                }))}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                <CalendarOutlined className="mr-1 text-blue-600" />
                Ejercicio:
              </label>
              <Select
                value={selectedYear}
                style={{ width: 110 }}
                options={YEAR_OPTIONS}
                onChange={(yr) => setSelectedYear(yr)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Mes a Conciliar / Revisar:
              </label>
              <Select
                value={selectedMonth}
                style={{ width: 250 }}
                options={monthSelectOptions}
                onChange={(mo) => {
                  setSelectedMonth(mo);
                  if (currentStep < 2) setCurrentStep(2);
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Upload customRequest={handleUpload} accept=".csv,.xlsx,.xls,.txt" showUploadList={false}>
              <Button icon={<UploadOutlined />} loading={loading} disabled={!selectedAccount}>
                Cargar / Actualizar Estado de Cuenta ({currentMonthLabel})
              </Button>
            </Upload>
            {currentStep !== 2 && selectedAccount && (
              <Button type="primary" onClick={() => setCurrentStep(2)}>
                Ver Movimientos del Mes
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Steps current={currentStep} onChange={(s) => selectedAccount && setCurrentStep(s)} className="mb-6">
        <Step title="Seleccionar Cuenta" />
        <Step title="Cargar Estado de Cuenta" />
        <Step title={`Conciliar (${currentMonthLabel} ${selectedYear})`} />
        <Step title="Resumen e Impresión" />
      </Steps>

      {currentStep === 0 && (
        <Card className="max-w-lg mx-auto text-center">
          <Title level={4} className="mb-1">
            Selecciona la cuenta bancaria y el mes
          </Title>
          <p className="text-xs text-gray-500 mb-4">
            Únicamente cuentas afectables de Bancos Nacionales (
            <span className="font-mono font-semibold">102-01-xxx</span>) y Bancos Extranjeros (
            <span className="font-mono font-semibold">102-02-xxx</span>)
          </p>
          <Select
            showSearch
            optionFilterProp="label"
            value={selectedAccount}
            style={{ width: '100%', marginBottom: 20, textAlign: 'left' }}
            placeholder="Seleccione cuenta bancaria (102-01-xxx o 102-02-xxx)"
            onChange={(val) => setSelectedAccount(val)}
            notFoundContent="No hay cuentas afectables 102-01-xxx o 102-02-xxx activas"
            options={accounts.map((a) => ({
              value: a.id,
              label: `${a.account_number} - ${a.name}`,
            }))}
          />
          {accounts.length === 0 && (
            <Alert
              type="info"
              showIcon
              className="mb-4 text-left text-xs"
              message="No se encontraron cuentas bancarias afectables"
              description={
                <span>
                  Da de alta o activa una subcuenta afectable bajo <strong>102-01-xxx</strong> (Bancos nacionales) o{' '}
                  <strong>102-02-xxx</strong> (Bancos extranjeros) en el{' '}
                  <Link to={`/accounts/${clientId}`} className="font-semibold text-blue-600 underline">
                    Catálogo de Cuentas
                  </Link>
                  .
                </span>
              }
            />
          )}
          <div className="flex justify-center gap-3">
            <Button type="primary" disabled={!selectedAccount} onClick={() => setCurrentStep(1)}>
              Cargar Estado de Cuenta
            </Button>
            <Button disabled={!selectedAccount} onClick={() => setCurrentStep(2)}>
              Revisar Conciliación de {currentMonthLabel} {selectedYear}
            </Button>
          </div>
        </Card>
      )}

      {currentStep === 1 && (
        <Card className="max-w-3xl mx-auto text-center">
          <Title level={4}>
            Carga el archivo del banco (.csv o .xlsx) — {currentMonthLabel} {selectedYear}
          </Title>
          <p className="text-xs text-gray-500 mb-4">
            Al seleccionar tu archivo <strong>.xlsx</strong> o <strong>.csv</strong>, el sistema relaciona primero los CFDI emitidos/recibidos y después aplica tu <strong>Memoria Contable Inteligente</strong> para sugerir cuentas en movimientos sin CFDI.
          </p>
          <Upload customRequest={handleUpload} accept=".csv,.xlsx,.xls,.txt" showUploadList={false}>
            <Button type="primary" icon={<UploadOutlined />} size="large" loading={loading}>
              Seleccionar Archivo CSV / Excel (.xlsx)
            </Button>
          </Upload>

          {uploadError && (
            <Alert
              type="warning"
              showIcon
              className="mt-4 text-left"
              message="Atención al leer el archivo"
              description={uploadError}
            />
          )}

          {rawPreviewRows.length > 0 && (
            <div className="mt-6 text-left border rounded p-4 bg-gray-50">
              <p className="text-sm font-semibold mb-3">
                Vista previa de <strong>{pendingFileName}</strong> — indica qué columna corresponde a cada dato:
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div>
                  <label className="text-xs font-semibold block mb-1">Columna Fecha:</label>
                  <Select
                    size="small"
                    style={{ width: '100%' }}
                    value={colMap.fecha}
                    options={colOptions}
                    onChange={(v) => setColMap((prev) => ({ ...prev, fecha: v }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1">Columna Descripción:</label>
                  <Select
                    size="small"
                    style={{ width: '100%' }}
                    value={colMap.desc}
                    options={colOptions}
                    onChange={(v) => setColMap((prev) => ({ ...prev, desc: v }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1">Columna Cargo / Retiro:</label>
                  <Select
                    size="small"
                    allowClear
                    placeholder="Opcional"
                    style={{ width: '100%' }}
                    value={colMap.cargo}
                    options={colOptions}
                    onChange={(v) => setColMap((prev) => ({ ...prev, cargo: v }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1">Columna Abono / Depósito:</label>
                  <Select
                    size="small"
                    allowClear
                    placeholder="Opcional"
                    style={{ width: '100%' }}
                    value={colMap.abono}
                    options={colOptions}
                    onChange={(v) => setColMap((prev) => ({ ...prev, abono: v }))}
                  />
                </div>
              </div>
              <div className="overflow-x-auto max-h-48 border bg-white mb-4">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-gray-100 border-b">
                      {colOptions.map((c) => (
                        <th key={c.value} className="px-2 py-1 text-left font-semibold border-r">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rawPreviewRows.slice(0, 8).map((r, rIdx) => (
                      <tr key={rIdx} className="border-b">
                        {colOptions.map((c) => (
                          <td key={c.value} className="px-2 py-1 border-r truncate max-w-[160px]">
                            {r[c.value] || ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={handleManualColumnProcess}
                loading={loading}
              >
                Procesar Estado de Cuenta y Continuar
              </Button>
            </div>
          )}

          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={() => setCurrentStep(0)}>Atrás</Button>
            <Button onClick={() => setCurrentStep(2)}>Ir a Movimientos de {currentMonthLabel}</Button>
          </div>
        </Card>
      )}

      {currentStep === 2 && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
              <div className="flex items-center gap-3">
                <Button onClick={() => setCurrentStep(1)}>Cargar Otro Archivo</Button>
                <span className="text-xs text-gray-600">
                  Periodo activo: <strong>{currentMonthLabel} {selectedYear}</strong>
                  {statementMeta?.file_name && (
                    <span>
                      {' '}
                      | Archivo: <strong>{statementMeta.file_name}</strong>
                    </span>
                  )}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="primary"
                  icon={<SyncOutlined />}
                  onClick={autoReconcileAndGeneratePolicies}
                  loading={loading}
                >
                  Generar Pólizas y Conciliar Automáticamente ({stats.withCfdi + stats.withManualAcc})
                </Button>
                <Button type="default" onClick={() => setCurrentStep(3)}>
                  Ver Resumen del Mes →
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs bg-slate-50 p-2.5 rounded border border-slate-200">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-gray-600 mr-1">Mostrar filas:</span>
                <Tag
                  color={statusFilter === 'all' ? 'blue' : 'default'}
                  onClick={() => {
                    setStatusFilter('all');
                    setBankPage(1);
                    setBookPage(1);
                  }}
                  className={`cursor-pointer select-none px-3 py-1 text-xs ${
                    statusFilter === 'all' ? 'font-bold ring-2 ring-blue-300' : ''
                  }`}
                >
                  Todas ({currentMonthLabel}): {stats.total}
                </Tag>
                <Tag
                  color={statusFilter === 'reconciled' ? 'green' : 'default'}
                  onClick={() => {
                    setStatusFilter(statusFilter === 'reconciled' ? 'all' : 'reconciled');
                    setBankPage(1);
                    setBookPage(1);
                  }}
                  className={`cursor-pointer select-none px-3 py-1 text-xs ${
                    statusFilter === 'reconciled' ? 'font-bold ring-2 ring-green-300' : ''
                  }`}
                >
                  Conciliadas: {stats.reconciled}
                </Tag>
                <Tag
                  color={statusFilter === 'pending' ? 'orange' : 'default'}
                  onClick={() => {
                    setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending');
                    setBankPage(1);
                    setBookPage(1);
                  }}
                  className={`cursor-pointer select-none px-3 py-1 text-xs ${
                    statusFilter === 'pending' ? 'font-bold ring-2 ring-orange-300' : ''
                  }`}
                >
                  Pendientes de Conciliar: {stats.pending}
                </Tag>
              </div>
              <span className="text-[11px] text-gray-500">
                Haz clic en <strong>Conciliadas</strong> o <strong>Pendientes de Conciliar</strong> para filtrar la tabla
              </span>
            </div>
          </div>

          <Card
            size="small"
            title={
              <span className="font-semibold text-sm">
                <BankOutlined className="mr-2 text-blue-600" />
                Movimientos del Estado de Cuenta Bancario — {currentMonthLabel} {selectedYear} (
                {filteredBankTransactions.length}
                {statusFilter !== 'all' ? ` de ${bankTransactions.length}` : ''})
              </span>
            }
          >
            <Table
              columns={bankColumns}
              dataSource={filteredBankTransactions}
              rowKey="id"
              size="small"
              locale={{
                emptyText:
                  statusFilter === 'reconciled'
                    ? 'No hay movimientos conciliados en este periodo.'
                    : statusFilter === 'pending'
                    ? '¡Excelente! No hay movimientos pendientes de conciliar en este periodo.'
                    : `No se ha cargado estado de cuenta para ${currentMonthLabel} ${selectedYear}. Usa el botón "Cargar / Actualizar Estado de Cuenta" arriba.`,
              }}
              pagination={{
                current: bankPage,
                pageSize: bankPageSize,
                showSizeChanger: true,
                pageSizeOptions: ['10', '25', '50', '100', '200'],
                showTotal: (total, range) => `${range[0]}-${range[1]} de ${total} movimientos`,
                onChange: (page, pageSize) => {
                  setBankPage(page);
                  setBankPageSize(pageSize);
                },
                onShowSizeChange: (_, size) => {
                  setBankPage(1);
                  setBankPageSize(size);
                },
              }}
            />
          </Card>

          <Card
            size="small"
            title={
              <span className="font-semibold text-sm">
                Movimientos Contables en Libros de la Cuenta Bancaria — {currentMonthLabel} {selectedYear} (
                {filteredBookEntries.length}
                {statusFilter !== 'all' ? ` de ${bookEntries.length}` : ''})
              </span>
            }
          >
            <Table
              columns={bookColumns}
              dataSource={filteredBookEntries}
              rowKey="id"
              size="small"
              pagination={{
                current: bookPage,
                pageSize: bookPageSize,
                showSizeChanger: true,
                pageSizeOptions: ['10', '25', '50', '100', '200'],
                showTotal: (total, range) => `${range[0]}-${range[1]} de ${total} movimientos`,
                onChange: (page, pageSize) => {
                  setBookPage(page);
                  setBookPageSize(pageSize);
                },
                onShowSizeChange: (_, size) => {
                  setBookPage(1);
                  setBookPageSize(size);
                },
              }}
            />
          </Card>
        </div>
      )}

      {currentStep === 3 && (
        <Card
          className="max-w-2xl mx-auto shadow-md"
          title={
            <Title level={3} className="m-0 text-center">
              Resumen de Conciliación — {currentMonthLabel} {selectedYear}
            </Title>
          }
        >
          <div className="space-y-4 text-lg font-mono">
            <div className="flex justify-between">
              <span>Saldo según estado de cuenta bancario:</span>
              <strong>{formatMoney(summary.bankBalance)}</strong>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>(+) Cargos en libros no correspondidos por el banco:</span>
              <span>{formatMoney(summary.inTransitDebits)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>(-) Abonos en libros no correspondidos por el banco:</span>
              <span>{formatMoney(summary.inTransitCredits)}</span>
            </div>
            <div className="flex justify-between border-t-2 border-gray-400 pt-2 font-bold bg-gray-100 p-2">
              <span>= Saldo bancario conciliado:</span>
              <span>{formatMoney(summary.reconciledBalance)}</span>
            </div>
            <div className="flex justify-between pt-1 font-semibold">
              <span>Saldo en libros (contabilidad del periodo):</span>
              <span>{formatMoney(summary.bookBalance)}</span>
            </div>
            <div
              className={`flex justify-between border-t-2 border-gray-800 pt-2 font-bold ${
                Math.abs(summary.diff) < 0.01 ? 'text-green-600' : 'text-red-600'
              }`}
            >
              <span>Diferencia:</span>
              <span>{formatMoney(summary.diff)}</span>
            </div>
          </div>
          <div className="mt-8 text-center flex flex-wrap justify-center gap-3">
            <Button onClick={() => setCurrentStep(2)}>Volver a Movimientos</Button>
            <Button
              icon={<FileExcelOutlined />}
              onClick={handleExportExcel}
              className="bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
            >
              Exportar Excel (.xlsx)
            </Button>
            <Button
              icon={<PrinterOutlined />}
              onClick={handleExportPdf}
              style={{ backgroundColor: '#0ea5e9', borderColor: '#0ea5e9', color: '#ffffff' }}
            >
              Imprimir / PDF Membretado
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={() => {
                saveMonthReconciliationToStorage(
                  selectedAccount,
                  selectedYear,
                  selectedMonth,
                  statementMeta,
                  bankTransactions,
                  bookEntries,
                  summary
                );
                message.success(`Conciliación de ${currentMonthLabel} ${selectedYear} guardada.`);
              }}
            >
              Guardar Conciliación del Mes
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
};

export default BankReconciliation;
