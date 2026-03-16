import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import App from './App';
import './styles/globals.css';

const container = document.getElementById('root');
const root = createRoot(container);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <SocketProvider>
            <App />
            <Toaster
              position="top-center"
              toastOptions={{
                duration: 4000,
                style: {
                  fontFamily: 'Heebo, Assistant, Arial, sans-serif',
                  direction: 'rtl',
                  textAlign: 'right',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '500',
                },
                success: {
                  style: {
                    background: '#ECFDF5',
                    color: '#065F46',
                    border: '1px solid #6EE7B7',
                  },
                  iconTheme: {
                    primary: '#10B981',
                    secondary: '#ECFDF5',
                  },
                },
                error: {
                  style: {
                    background: '#FEF2F2',
                    color: '#991B1B',
                    border: '1px solid #FCA5A5',
                  },
                  iconTheme: {
                    primary: '#EF4444',
                    secondary: '#FEF2F2',
                  },
                },
              }}
            />
          </SocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
