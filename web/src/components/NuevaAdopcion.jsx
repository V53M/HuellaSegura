import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { EditorZona } from './comunes.jsx';

export default function NuevaAdopcion({ zona, onZona, parametros, onEnfocar, onCreada, onCancelar }) {
  const [f, setF] = useState({ nombre: '', especie: 'PERRO', peso_kg: '', adoptante: '', telefono: '', direccion: '', uid: '' });
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [politica, setPolitica] = useState(null);
  const [firmado, setFirmado] = useState(false);
  const [evidencia, setEvidencia] = useState('');
  useEffect(() => {
    api.politica().then(setPolitica).catch(() => {});
  }, []);
  const campo = (k) => ({ value: f[k], onChange: (e) => setF({ ...f, [k]: e.target.value }) });
  const pesoBajo = f.uid && f.peso_kg && Number(f.peso_kg) < parametros?.peso_minimo_kg;

  const enviar = async (e) => {
    e.preventDefault();
    if (zona.lat == null) return setError('Seleccione en el mapa el centro de la zona segura.');
    setEnviando(true);
    setError(null);
    try {
      const r = await api.crearAdopcion({
        animal: { nombre: f.nombre, especie: f.especie, peso_kg: Number(f.peso_kg) },
        adoptante: { nombre: f.adoptante, telefono: f.telefono, direccion: f.direccion },
        dispositivo_uid: f.uid,
        zona,
        consentimiento: { firmado, version: politica?.version, evidencia },
      });
      onCreada(r.adopcion_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="panel-contenido">
      <div className="panel-cabecera">
        <h2>Nueva adopción</h2>
        <button className="boton fantasma" type="button" onClick={onCancelar}>Cancelar</button>
      </div>
      <form className="formulario" onSubmit={enviar}>
        <fieldset>
          <legend>Animal</legend>
          <label className="campo"><span>Nombre</span><input required {...campo('nombre')} /></label>
          <div className="fila-form">
            <label className="campo"><span>Especie</span>
              <select {...campo('especie')}>
                <option value="PERRO">Perro</option>
                <option value="GATO">Gato</option>
                <option value="OTRO">Otro</option>
              </select>
            </label>
            <label className="campo"><span>Peso (kg)</span><input required type="number" step="0.1" min="0.1" {...campo('peso_kg')} /></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Adoptante</legend>
          <label className="campo"><span>Nombre</span><input required {...campo('adoptante')} /></label>
          <label className="campo"><span>Teléfono</span><input {...campo('telefono')} /></label>
          <label className="campo"><span>Dirección</span><input {...campo('direccion')} /></label>
        </fieldset>
        <fieldset>
          <legend>Collar</legend>
          <label className="campo">
            <span>Identificador (ID impreso en el equipo o IMEI)</span>
            <input className="mono" placeholder="Opcional" {...campo('uid')} />
          </label>
          {pesoBajo && (
            <p className="aviso">Peso por debajo de {parametros.peso_minimo_kg.toFixed(2)} kg: el collar superaría el 2 % del peso corporal.</p>
          )}
        </fieldset>
        <fieldset>
          <legend>Autorización de datos (Ley 1581)</legend>
          {politica && (
            <details className="politica">
              <summary className="pequeno">Qué autoriza el adoptante (versión <span className="mono">{politica.version}</span>)</summary>
              <ul className="simple pequeno">{politica.resumen.map((t) => <li key={t}>{t}</li>)}</ul>
            </details>
          )}
          <label className="interruptor">
            <input type="checkbox" required checked={firmado} onChange={(e) => setFirmado(e.target.checked)} />
            El adoptante firmó la autorización de tratamiento de datos
          </label>
          <label className="campo">
            <span>Referencia del formato firmado</span>
            <input placeholder="Ej.: FA-2027-014, archivado en la carpeta de la adopción" value={evidencia} onChange={(e) => setEvidencia(e.target.value)} />
          </label>
        </fieldset>
        <fieldset>
          <legend>Zona segura</legend>
          <EditorZona
            zona={zona} onCambio={onZona} errorM={parametros?.error_m_respaldo} onEnfocar={onEnfocar}
            direccionSugerida={f.direccion.trim() || null}
          />
        </fieldset>
        {error && <p className="error">{error}</p>}
        <button className="boton primario" disabled={enviando}>Registrar adopción</button>
      </form>
    </div>
  );
}
