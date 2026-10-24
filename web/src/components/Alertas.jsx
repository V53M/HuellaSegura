import { useEffect, useState } from 'react';
import { DownloadSimple } from '@phosphor-icons/react';
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
          <span className="tenue pequeno">Exportar (OE5)</span>
          {['alertas', 'transiciones', 'posiciones'].map((t) => (
            <a key={t} className="boton" href={`/api/exportar/${t}.csv`}>
              <DownloadSimple size={14} aria-hidden="true" /> <span className="mono">{t}.csv</span>
            </a>
          ))}
        </div>
      </div>
      {alertas?.length === 0 && <p className="tenue">Sin alertas.</p>}
      <div className="tabla-alertas" hidden={!alertas?.length}>
        {alertas?.map((a) => (
          <article key={a.id} className={`fila-alerta ${a.resuelta_en ? 'resuelta' : a.escalada_en ? 'escalada' : 'abierta'}`}>
            <div>
              <button className="enlace" onClick={() => onAbrir(a.adopcion_id)}>{a.animal}</button>
              <div className="tenue pequeno">{a.adoptante} · <span className="mono">{a.telefono}</span></div>
              <div className="pequeno" style={{ marginTop: 4 }}><Estado estado={a.estado} corto /></div>
            </div>
            <dl>
              <dt>Creada</dt>
              <dd><span className="mono">{fechaHora(a.creada_en)}</span> <span className="tenue">({hace(a.creada_en)})</span></dd>
              <dt>Fuera desde</dt>
              <dd className="mono">{fechaHora(a.fuera_desde)}</dd>
              {a.escalada_en && <><dt>Escalada</dt><dd className="mono">{fechaHora(a.escalada_en)}</dd></>}
              {a.respondida_en && (
                <><dt>Respuesta</dt><dd>«{a.respuesta ?? '—'}» <span className="mono tenue">{fechaHora(a.respondida_en)}</span></dd></>
              )}
              {a.resuelta_en && (
                <>
                  <dt>Resuelta</dt>
                  <dd>{RESOLUCION[a.causa_resolucion] ?? a.causa_resolucion} · <span className="mono">{duracion(a.creada_en, a.resuelta_en)}</span></dd>
                </>
              )}
              {a.resultado_verificacion && <><dt>Verificación</dt><dd>{VERIFICACION[a.resultado_verificacion]}</dd></>}
            </dl>
            <AccionesAlerta alerta={a} />
          </article>
        ))}
      </div>
    </div>
  );
}
