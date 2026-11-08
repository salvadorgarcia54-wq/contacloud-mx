import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('contacloud_token');
  if (token && token !== 'undefined' && token !== 'null') {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('contacloud_token');
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  getMe: () => api.get('/auth/me'),
  changePassword: (current_password, new_password) => api.post('/auth/change-password', { current_password, new_password }),
};

export const usersApi = {
  list: () => api.get('/users'),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  toggleAccess: (id, is_active, temp_password = null) =>
    api.post(`/users/${id}/toggle-access`, { is_active, temp_password }),
  delete: (id, temp_password = null) =>
    api.delete(`/users/${id}`, { params: temp_password ? { temp_password } : {} }),
};

export const clientsApi = {
  list: (params) => api.get('/clients', { params }),
  get: (id) => api.get(`/clients/${id}`),
  create: (data) => api.post('/clients', data),
  update: (id, data) => api.put(`/clients/${id}`, data),
  delete: (id, temp_password = null) =>
    api.delete(`/clients/${id}`, { params: temp_password ? { temp_password } : {} }),
  createPortalUser: (clientId, data) => api.post(`/clients/${clientId}/portal-user`, data),
  initDefaultAccounts: (clientId) => api.post(`/accounts/client/${clientId}/init-default`),
  backup: (clientId) => api.get(`/clients/${clientId}/backup`, { responseType: 'blob' }),
  restore: (clientId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/clients/${clientId}/restore`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const accountsApi = {
  getSatCatalog: (params) => api.get('/accounts/sat-catalog', { params }),
  getClientAccounts: (clientId, params) => api.get(`/accounts/client/${clientId}`, { params }),
  create: (data) => api.post('/accounts', data),
  update: (id, data) => api.put(`/accounts/${id}`, data),
  delete: (id) => api.delete(`/accounts/${id}`),
  initDefault: (clientId) => api.post(`/accounts/client/${clientId}/init-default`),
  applyDefaultAccounts: (clientId) => api.post(`/accounts/client/${clientId}/apply-defaults`),
  bulkUpdateClassification: (clientId, data) => api.post(`/accounts/client/${clientId}/bulk-classification`, data),
};

export const journalsApi = {
  listByClient: (clientId, params) => api.get(`/journals/client/${clientId}`, { params }),
  getNextNumber: (clientId, params) => api.get(`/journals/client/${clientId}/next-number`, { params }),
  getNextNumbers: (clientId, params) => api.get(`/journals/client/${clientId}/next-numbers`, { params }),
  get: (id) => api.get(`/journals/${id}`),
  create: (data) => api.post('/journals/', data),
  update: (id, data) => api.put(`/journals/${id}`, data),
  delete: (id) => api.delete(`/journals/${id}`),
  cancel: (id) => api.post(`/journals/${id}/cancel`),
  getYearEndClose: (clientId, year) => api.get(`/journals/client/${clientId}/year-end-close/${year}`),
  createYearEndClose: (clientId, year) => api.post(`/journals/client/${clientId}/year-end-close/${year}`),
  revertYearEndClose: (clientId, year) => api.post(`/journals/client/${clientId}/year-end-close/${year}/revert`),
  uploadCfdi: (clientId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/journals/client/${clientId}/cfdi-upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const cfdiApi = {
  upload: (clientId, type, files) => {
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    return api.post(`/cfdi/${clientId}/upload?type=${type}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  list: (clientId, type, isPosted, year, month) => {
    const params = { type };
    if (isPosted !== undefined && isPosted !== null && isPosted !== 'all') params.is_posted = isPosted;
    if (year && year !== 'all') params.year = year;
    if (month && month !== 'all') params.month = month;
    return api.get(`/cfdi/${clientId}/list`, { params });
  },
  assignAccount: (clientId, data) => api.post(`/cfdi/${clientId}/assign-account`, data),
  generateEntry: (clientId, data) => api.post(`/cfdi/${clientId}/generate-entry`, data),
  batchGenerate: (clientId, data) => api.post(`/cfdi/${clientId}/batch-generate`, data),
  deleteInvoice: (clientId, invoiceId, deleteEntry = true) => api.delete(`/cfdi/${clientId}/invoice/${invoiceId}?delete_entry=${deleteEntry}`),
  clearInvoices: (clientId, type = null) => api.post(`/cfdi/${clientId}/clear-invoices${type ? `?type=${type}` : ''}`),
  getViewerData: (identifier) => api.get(`/cfdi/viewer/${identifier}`),
};

export const reportsApi = {
  trialBalance: (clientId, paramsOrYear, month, options = {}) => {
    let params;
    if (typeof paramsOrYear === 'object') {
      params = paramsOrYear;
    } else {
      params = { year: paramsOrYear, month, ...options };
    }
    return api.get(`/reports/trial-balance/${clientId}`, { params });
  },
  incomeStatement: (clientId, paramsOrYear, month) => {
    const params = typeof paramsOrYear === 'object' ? paramsOrYear : { year: paramsOrYear, month };
    return api.get(`/reports/income-statement/${clientId}`, { params });
  },
  balanceSheet: (clientId, paramsOrYear, month, level = 'mayor') => {
    let params;
    if (typeof paramsOrYear === 'object' && paramsOrYear !== null) {
      params = { level: 'mayor', ...paramsOrYear };
    } else {
      params = { year: paramsOrYear, month, level };
    }
    return api.get(`/reports/balance-sheet/${clientId}`, { params });
  },
  accountLedger: (clientId, paramsOrAccountId, dateFrom, dateTo) => {
    let params;
    if (typeof paramsOrAccountId === 'object' && paramsOrAccountId !== null) {
      params = paramsOrAccountId;
    } else {
      params = { account_id: paramsOrAccountId, date_from: dateFrom, date_to: dateTo };
    }
    return api.get(`/reports/account-ledger/${clientId}`, { params });
  },
};

export const bankApi = {
  listAccounts: (clientId) => api.get(`/bank/accounts/client/${clientId}`),
  createAccount: (data) => api.post('/bank/accounts', data),
  updateAccount: (id, data) => api.put(`/bank/accounts/${id}`, data),
  uploadStatement: (bankAccountId, file, year = null, month = null, clientId = null) => {
    const formData = new FormData();
    formData.append('bank_account_id', bankAccountId);
    if (year) formData.append('year', year);
    if (month) formData.append('month', month);
    if (clientId) formData.append('client_id', clientId);
    formData.append('file', file);
    return api.post('/bank/statements/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  listStatements: (bankAccountId) => api.get(`/bank/statements/${bankAccountId}`),
  getStatementDetail: (statementId) => api.get(`/bank/statements/${statementId}/detail`),
  getTransactions: (statementId) => api.get(`/bank/statements/${statementId}/transactions`),
  autoReconcile: (statementId) => api.post(`/bank/reconcile/${statementId}`),
  manualReconcile: (data) => api.post('/bank/reconcile-manual', data),
  reconciliationReport: (statementId) => api.get(`/bank/reconciliation-report/${statementId}`),
};

export const fiscalApi = {
  getIvaReport: (clientId, params) => api.get(`/fiscal/iva/${clientId}`, { params }),
  getConciliacionIva: (clientId, params) => api.get(`/fiscal/conciliacion-iva/${clientId}`, { params }),
  getIepsReport: (clientId, params) => api.get(`/fiscal/ieps/${clientId}`, { params }),
  generarTraspasoIeps: (clientId, data) => api.post(`/fiscal/ieps/${clientId}/generar-traspaso`, data),
  exportIepsInformativaTxt: (clientId, params) => api.get(`/fiscal/ieps/${clientId}/export-informativa-txt`, { params, responseType: 'blob' }),
  getIsrReport: (clientId, params) => api.get(`/fiscal/isr/${clientId}`, { params }),
  saveIsrParameters: (clientId, data) => api.post(`/fiscal/isr/${clientId}/parameters`, data),
  generarProvisionIsr: (clientId, data) => api.post(`/fiscal/isr/${clientId}/generar-provision`, data),
  getComplementosReport: (clientId, params) => api.get(`/fiscal/complementos-pago/${clientId}`, { params }),
  getDiotReport: (clientId, params) => api.get(`/fiscal/diot/${clientId}`, { params }),
  exportDiotTxt: (clientId, params) => api.get(`/fiscal/diot/${clientId}/export-txt`, { params, responseType: 'blob' }),
  getContabilidadInfo: (clientId, params) => api.get(`/fiscal/contabilidad-electronica/${clientId}/info`, { params }),
  getCatalogoXml: (clientId) => api.get(`/fiscal/contabilidad-electronica/${clientId}/catalogo-xml`, { responseType: 'blob' }),
  getBalanzaXml: (clientId, params) => api.get(`/fiscal/contabilidad-electronica/${clientId}/balanza-xml`, { params, responseType: 'blob' }),
  getPolizasXml: (clientId, params) => api.get(`/fiscal/contabilidad-electronica/${clientId}/polizas-xml`, { params, responseType: 'blob' }),
  getInversionesReport: (clientId, params) => api.get(`/fiscal/inversiones/${clientId}`, { params }),
  prepareInvestmentType: (clientId, data) => api.post(`/fiscal/inversiones/${clientId}/prepare-type`, data),
  createInversion: (clientId, data) => api.post(`/fiscal/inversiones/${clientId}`, data),
  updateInversion: (clientId, assetId, data) => api.put(`/fiscal/inversiones/${clientId}/${assetId}`, data),
  deleteInversion: (clientId, assetId) => api.delete(`/fiscal/inversiones/${clientId}/${assetId}`),
  generarPolizaDepreciacion: (clientId, data) => api.post(`/fiscal/inversiones/${clientId}/generar-poliza-depreciacion`, data),
  generarTraspasoIva: (clientId, data) => api.post(`/fiscal/iva/${clientId}/generar-traspaso`, data),
  getValidador69bReport: (clientId, params) => api.get(`/fiscal/validador-69b/${clientId}`, { params }),
  checkRfcs69b: (data) => api.post('/fiscal/validador-69b/check-rfcs', data),
  listSatBlacklistCatalog: (params) => api.get('/fiscal/validador-69b/catalog/list', { params }),
  addSatBlacklistEntry: (data) => api.post('/fiscal/validador-69b/catalog/add', data),
  deleteSatBlacklistEntry: (id) => api.delete(`/fiscal/validador-69b/catalog/${id}`),
  uploadSatBlacklistCsv: (listType, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/fiscal/validador-69b/catalog/upload-csv?list_type=${encodeURIComponent(listType)}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const exportApi = {
  toXlsx: (data) => api.post('/export/xlsx', data, { responseType: 'blob' }),
};

export const auditApi = {
  getLogs: (params) => api.get('/audit-logs', { params }),
  getStats: (days = 30) => api.get('/audit-logs/stats', { params: { days } }),
  getTimeAnalytics: (params) => api.get('/audit-logs/time-analytics', { params }),
  deleteByPeriod: (params) => api.delete('/audit-logs/by-period', { params }),
  deleteSingle: (logId) => api.delete(`/audit-logs/${logId}`),
};

export const tempPasswordsApi = {
  list: () => api.get('/temp-passwords'),
  create: (data) => api.post('/temp-passwords', data),
  verify: (token, purpose = null) => api.post('/temp-passwords/verify', { token, purpose }),
  revoke: (id) => api.post(`/temp-passwords/${id}/revoke`),
  delete: (id) => api.delete(`/temp-passwords/${id}`),
};

export const supportApi = {
  getInfo: () => api.get('/support/info'),
  updateConfig: (data) => api.put('/support/config', data),
  listTickets: (params) => api.get('/support/tickets', { params }),
  createTicket: (data) => api.post('/support/tickets', data),
  updateTicket: (id, data) => api.put(`/support/tickets/${id}`, data),
  deleteTicket: (id) => api.delete(`/support/tickets/${id}`),
};
