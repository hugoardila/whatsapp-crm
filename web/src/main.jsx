import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import AdvisorPortal from './AdvisorPortal.jsx';
import CotizacionesApp from './CotizacionesApp.jsx';
import './index.css';

function Root() {
  const [hash, setHash] = useState(() => window.location.hash || '');
  useEffect(() => {
    const fn = () => setHash(window.location.hash || '');
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
  }, []);
  if (String(hash).startsWith('#/asesor')) {
    return <AdvisorPortal />;
  }
  if (String(hash).startsWith('#/cotizaciones')) {
    return <CotizacionesApp />;
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
