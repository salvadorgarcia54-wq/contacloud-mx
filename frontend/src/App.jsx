import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import { Layout } from './components/Layout';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import StaffUsers from './pages/StaffUsers';
import ChartOfAccounts from './pages/ChartOfAccounts';
import JournalEntries from './pages/JournalEntries';
import CfdiUpload from './pages/CfdiUpload';
import AccountLedger from './pages/AccountLedger';
import TrialBalance from './pages/TrialBalance';
import IncomeStatement from './pages/IncomeStatement';
import BalanceSheet from './pages/BalanceSheet';
import BankReconciliation from './pages/BankReconciliation';
import ClientPortal from './pages/ClientPortal';
import CfdiViewer from './pages/CfdiViewer';
import JournalViewer from './pages/JournalViewer';
import FiscalIva from './pages/FiscalIva';
import FiscalConciliacionIva from './pages/FiscalConciliacionIva';
import FiscalIeps from './pages/FiscalIeps';
import FiscalIsr from './pages/FiscalIsr';
import FiscalComplementosPago from './pages/FiscalComplementosPago';
import FiscalDiot from './pages/FiscalDiot';
import FiscalContabilidadElectronica from './pages/FiscalContabilidadElectronica';
import FiscalInversiones from './pages/FiscalInversiones';
import FiscalValidador69b from './pages/FiscalValidador69b';
import AuditLog from './pages/AuditLog';
import TempPasswords from './pages/TempPasswords';
import TechnicalSupport from './pages/TechnicalSupport';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/cfdi-viewer/:uuid" element={<CfdiViewer />} />
          <Route path="/journal-viewer/:entryId" element={<JournalViewer />} />
          
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="clients" element={<Clients />} />
            <Route path="users" element={<StaffUsers />} />
            <Route path="temp-passwords" element={<TempPasswords />} />
            <Route path="audit-log" element={<AuditLog />} />
            <Route path="accounts/:clientId" element={<ChartOfAccounts />} />
            <Route path="journal/:clientId" element={<JournalEntries />} />
            <Route path="cfdi-upload/:clientId" element={<CfdiUpload />} />
            <Route path="ledger/:clientId" element={<AccountLedger />} />
            <Route path="trial-balance/:clientId" element={<TrialBalance />} />
            <Route path="income-statement/:clientId" element={<IncomeStatement />} />
            <Route path="balance-sheet/:clientId" element={<BalanceSheet />} />
            <Route path="bank-reconciliation/:clientId" element={<BankReconciliation />} />
            <Route path="fiscal-iva/:clientId" element={<FiscalIva />} />
            <Route path="fiscal-conciliacion-iva/:clientId" element={<FiscalConciliacionIva />} />
            <Route path="fiscal-ieps/:clientId" element={<FiscalIeps />} />
            <Route path="fiscal-isr/:clientId" element={<FiscalIsr />} />
            <Route path="fiscal-complementos/:clientId" element={<FiscalComplementosPago />} />
            <Route path="fiscal-diot/:clientId" element={<FiscalDiot />} />
            <Route path="fiscal-contabilidad-electronica/:clientId" element={<FiscalContabilidadElectronica />} />
            <Route path="fiscal-inversiones/:clientId" element={<FiscalInversiones />} />
            <Route path="fiscal-validador-69b/:clientId" element={<FiscalValidador69b />} />
            <Route path="portal" element={<ClientPortal />} />
            <Route path="support" element={<TechnicalSupport />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
