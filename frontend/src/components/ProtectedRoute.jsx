import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from '../contexts/AuthContext';

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Spin size="large" tip="Cargando..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Al entrar a la raíz del dominio sin sesión activa, mostrar primero la Landing Page
    if (location.pathname === '/' || location.pathname === '') {
      return <Navigate to="/landing" replace />;
    }
    return <Navigate to="/login" replace />;
  }

  return children ? children : <Outlet />;
};

export default ProtectedRoute;
