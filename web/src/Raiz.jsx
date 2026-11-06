import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import App from './App.jsx';
import Ingreso from './components/Ingreso.jsx';

/** Decide entre la pantalla de inicio de sesión y la plataforma, según la sesión. */
export default function Raiz() {
  const [usuario, setUsuario] = useState(undefined); // undefined: verificando · null: sin sesión

  useEffect(() => {
    api.yo().then(setUsuario).catch(() => setUsuario(null));
    const vencida = () => setUsuario(null);
    window.addEventListener('sesion-vencida', vencida);
    return () => window.removeEventListener('sesion-vencida', vencida);
  }, []);

  const salir = useCallback(async () => {
    await api.salir().catch(() => {});
    setUsuario(null);
  }, []);

  if (usuario === undefined) return null;
  if (!usuario) return <Ingreso onIngreso={setUsuario} />;
  return <App usuario={usuario} onSalir={salir} />;
}
