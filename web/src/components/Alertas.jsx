import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { duracion, fechaHora, hace } from '../formato.js';
import { Estado } from './comunes.jsx';

const VERIFICACION = {
  VERDADERA: 'Verdadera (el animal estaba en riesgo)',
  SALIDA_LEGITIMA: 'Falso positivo: salida legítima',
  ERROR_POSICION: 'Falso positivo: error de posición',
};
const RESOLUCION = { VOLVIO: 'El animal volvió', RESPUESTA_ADOPTANTE: 'Respondió el adoptante', CIERRE_FUNDACION: 'Cerrada por la fundación' };

/** Botones para responder (simulando al adoptante) o cerrar una alerta con su verificación. */
export function AccionesAlerta({ alerta }) {
  const [verificacion, setVerificacion] = useState(alerta.resultado_verificacion ?? '');
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const hacer = async (fn) => {
    setOcupado(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="acciones-alerta">
      {!alerta.resuelta_en && !alerta.escalada_en && (
        <button
          className="boton" disabled={ocupado}
          onClick={() => {
            const r = window.prompt('Respuesta del adoptante (demo):', 'Está conmigo, salimos a caminar');
            if (r !== null) hacer(() => api.responderAlerta(alerta.id, r));
          }}
        >
          Simular respuesta del adoptante
        </button>
      )}
      <div className="fila-form">
        <select value={verificacion} onChange={(e) => setVerificacion(e.target.value)}>
          <option value="">Verificación telefónica…</option>
          {Object.entries(VERIFICACION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button
          className="boton primario" disabled={ocupado || (!verificacion && !!alerta.resuelta_en)}
          onClick={() => hacer(() => api.cerrarAlerta(alerta.id, verificacion || null))}
        >
          {alerta.resuelta_en ? 'Guardar verificación' : 'Cerrar caso'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export default function Alertas({ version, onAbrir }) {
  const [alertas, setAlertas] = useState(null);
  const [soloAbiertas, setSoloAbiertas] = useState(false);

  useEffect(() => {
    api.alertas(soloAbiertas).then(setAlertas);
  }, [version, soloAbiertas]);

  return (
    <div className="pagina">
      <div className="pagina-cabecera">
        <h2>Bandeja de alertas</h2>
        <label className="interruptor">
          <input type="checkbox" checked={soloAbiertas} onChange={(e) => setSoloAbiertas(e.target.checked)} />
          Solo abiertas
        </label>
        <div className="grupo-botones exportes">
          <span className="tenue pequeno">Exportar (OE5):</span>
          <a className="boton" href="/api/exportar/alertas.csv">alertas.csv</a>
          <a className="boton" href="/api/exportar/transiciones.csv">transiciones.csv</a>
          <a className="boton" href="/api/exportar/posiciones.csv">posiciones.csv</a>
        </div>
      </div>
      {alertas?.length === 0 && <p className="tenue">No hay alertas.</p>}
      <div className="tabla-alertas">
        {alertas?.map((a) => (
          <article key={a.id} className={`fila-alerta ${a.resuelta_en ? 'resuelta' : a.escalada_en ? 'escalada' : 'abierta'}`}>
            <div>
              <button className="enlace" onClick={() => onAbrir(a.adopcion_id)}><strong>{a.animal}</strong></button>
              <div className="tenue pequeno">{a.adoptante} · {a.telefono}</div>
              <div className="pequeno">Estado actual: <Estado estado={a.estado} corto /></div>
            </div>
            <div className="pequeno">
              <div>Creada: {fechaHora(a.creada_en)} ({hace(a.creada_en)})</div>
              <div>Fuera desde: {fechaHora(a.fuera_desde)}</div>
              {a.escalada_en && <div>Escalada: {fechaHora(a.escalada_en)}</div>}
              {a.respondida_en && <div>Respuesta: «{a.respuesta ?? '—'}» ({fechaHora(a.respondida_en)})</div>}
              {a.resuelta_en && (
                <div>
                  Resuelta: {RESOLUCION[a.causa_resolucion] ?? a.causa_resolucion} tras {duracion(a.creada_en, a.resuelta_en)}
                </div>
              )}
              {a.resultado_verificacion && <div>Verificación: {VERIFICACION[a.resultado_verificacion]}</div>}
            </div>
            <AccionesAlerta alerta={a} />
          </article>
        ))}
      </div>
    </div>
  );
}
