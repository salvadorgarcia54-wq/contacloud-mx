import React, { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../api/client';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => {
    const t = localStorage.getItem('contacloud_token');
    return t && t !== 'undefined' && t !== 'null' ? t : null;
  });
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const initAuth = async () => {
      const storedToken = localStorage.getItem('contacloud_token');
      if (storedToken && storedToken !== 'undefined' && storedToken !== 'null') {
        try {
          const response = await authApi.getMe();
          setUser(response.data);
          setToken(storedToken);
        } catch (error) {
          console.error("Auth validation failed", error);
          localStorage.removeItem('contacloud_token');
          setToken(null);
          setUser(null);
        }
      } else {
        localStorage.removeItem('contacloud_token');
        setToken(null);
        setUser(null);
      }
      setLoading(false);
    };

    initAuth();
  }, []);

  const login = async (username, password) => {
    const response = await authApi.login(username, password);
    const tokenVal = response.data?.access_token || response.data?.token;
    if (!tokenVal) {
      throw new Error("No access token received from server");
    }
    localStorage.removeItem('contacloud_selected_client');
    sessionStorage.removeItem('contacloud_active_client_session');
    localStorage.setItem('contacloud_token', tokenVal);
    setToken(tokenVal);
    
    if (response.data?.user) {
      setUser(response.data.user);
    } else {
      const meRes = await authApi.getMe();
      setUser(meRes.data);
    }
  };

  const setAuthSession = (tokenVal, userObj) => {
    localStorage.removeItem('contacloud_selected_client');
    sessionStorage.removeItem('contacloud_active_client_session');
    localStorage.setItem('contacloud_token', tokenVal);
    setToken(tokenVal);
    setUser(userObj);
  };

  const logout = () => {
    localStorage.removeItem('contacloud_token');
    localStorage.removeItem('contacloud_selected_client');
    sessionStorage.removeItem('contacloud_active_client_session');
    setToken(null);
    setUser(null);
    navigate('/login');
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, isAuthenticated: !!user, login, setAuthSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
