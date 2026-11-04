import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fechaHora } from '../formato.js';

const ROLES = { ADMIN_FUNDACION: 'Administrador', PERSONAL_FUNDACION: 'Personal' };

/** Cuentas del personal de la fundación (solo administradores). */
export default function Usuarios({ usuario }) {
  const [lista, setLista] = useState(null);
  const [f, setF] = useState({ nombre: '', correo: '', rol: 'PERSONAL_FUNDACION', contrasena: '' });
  const [mensaje, setMensaje] = useState(null);
  const cargar = () => api.usuarios().then(setLista);
  useEffect(() => {
    cargar();
  }, []);
  const campo = (k) => ({ value: f[k], onChange: (e) => setF({ ...f, [k]: e.target.value }) });

  const crear = async (e) => {
    e.preventDefault();
    setMensaje(null);
    try {
      const u = await api.crearUsuario(f);
      setF({ nombre: '', correo: '', rol: 'PERSONAL_FUNDACION', contrasena: '' });
      setMensaje({ ok: true, texto: `Cuenta creada para ${u.correo}. Entréguele la contraseña temporal por un medio seguro.` });
      cargar();
    } catch (err) {
      setMensaje({ ok: false, texto: err.message });
    }
  };

  const cambiar = async (u) => {
    try {
      await api.activarUsuario(u.id, !u.activo);
      cargar();
    } catch (err) {
      setMensaje({ ok: false, texto: err.message });
    }
  };

  return (
    <div className="pagina estrecha">
      <h2>Usuarios de la fundación</h2>
      <p className="tenue" style={{ margin: '4px 0 16px' }}>
        El personal ve las adopciones y atiende alertas. Solo los administradores cambian parámetros y crean cuentas.
      </p>
      <ul className="lista-usuarios">
        {lista?.map((u) => (
          <li key={u.id} className={u.activo ? '' : 'inactivo'}>
            <div>
              <strong>{u.nombre}</strong> <span className="tenue pequeno">· {ROLES[u.rol]}</span>
              <div className="tenue pequeno">
                <span className="mono">{u.correo}</span> · último ingreso {u.ultimo_acceso ? <span className="mono">{fechaHora(u.ultimo_acceso)}</span> : 'nunca'}
              </div>
            </div>
            {u.id !== usuario.id && (
              <button className="boton" onClick={() => cambiar(u)}>{u.activo ? 'Desactivar' : 'Activar'}</button>
            )}
          </li>
        ))}
      </ul>
      <form className="formulario" onSubmit={crear}>
        <fieldset>
          <legend>Nueva cuenta</legend>
          <label className="campo"><span>Nombre</span><input required {...campo('nombre')} /></label>
          <label className="campo"><span>Correo</span><input type="email" required {...campo('correo')} /></label>
          <div className="fila-form">
            <label className="campo"><span>Rol</span>
              <select {...campo('rol')}>
                {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="campo"><span>Contraseña temporal</span><input type="text" minLength={8} required autoComplete="off" {...campo('contrasena')} /></label>
          </div>
        </fieldset>
        <button className="boton primario">Crear cuenta</button>
        {mensaje && <p className={mensaje.ok ? 'exito' : 'error'}>{mensaje.texto}</p>}
      </form>
    </div>
  );
}
