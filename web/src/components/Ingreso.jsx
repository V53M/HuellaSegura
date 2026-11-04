import { useState } from 'react';
import { PawPrint } from '@phosphor-icons/react';
import { api } from '../api.js';

/** Inicio de sesión del personal de la fundación. Los adoptantes ingresan por la app móvil. */
export default function Ingreso({ onIngreso }) {
  const [correo, setCorreo] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      await api.iniciarSesion(correo, contrasena);
      onIngreso(await api.yo());
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="ingreso">
      <form className="tarjeta-ingreso formulario" onSubmit={enviar}>
        <div className="marca">
          <PawPrint className="icono" size={22} weight="fill" aria-hidden="true" />
          HuellaSegura
        </div>
        <p className="tenue pequeno" style={{ margin: 0 }}>Plataforma de seguimiento de la fundación</p>
        <label className="campo">
          <span>Correo</span>
          <input type="email" autoComplete="username" required autoFocus value={correo} onChange={(e) => setCorreo(e.target.value)} />
        </label>
        <label className="campo">
          <span>Contraseña</span>
          <input type="password" autoComplete="current-password" required value={contrasena} onChange={(e) => setContrasena(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="boton primario" disabled={enviando}>{enviando ? 'Ingresando…' : 'Ingresar'}</button>
      </form>
    </main>
  );
}
