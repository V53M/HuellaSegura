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
const DESTINATARIO = { FUNDACION: 'Fundación', ADOPTANTE: 'Adoptante' };
const ERRORES_ENVIO = {
  SIN_TOKEN: 'sin app registrada',
  FCM_NO_CONFIGURADO: 'push sin configurar en el servidor',
  UNREGISTERED: 'la app ya no está instalada',
};

const segundos = (s) => {
  if (s == null) return '—';
  if (s < 60) return `${s.toFixed(1).replace('.', ',')} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
};
const latenciaDe = (desde, hasta) => (desde && hasta ? (new Date(hasta) - new Date(desde)) / 1000 : null);

/** Estado de entrega de cada notificación de una alerta: la evidencia de que se avisó a tiempo. */
function Entregas({ notificaciones }) {
  if (!notificaciones?.length) return null;
  return (
    <>
      <dt>Avisos</dt>
      <dd>
        <ul className="entregas">
          {notificaciones.map((n) => (
            <li key={n.id}>
              <span>{DESTINATARIO[n.destinatario]}{n.tipo === 'ESCALADA' ? ' (escalada)' : ''}: </span>
              {n.entregada_en ? (
                <span>
                  recibida en <span className="mono">{segundos(latenciaDe(n.condicion_en, n.entregada_en))}</span>
                  {n.leida_en && <span className="tenue"> · leída</span>}
                </span>
              ) : n.error ? (
                <span className="tenue">no enviada, {ERRORES_ENVIO[n.error] ?? n.error}</span>
              ) : (
                <span className="tenue">{n.enviada_en ? 'enviada, sin acuse de recibo' : 'pendiente'}</span>
              )}
            </li>
          ))}
        </ul>
      </dd>
    </>
  );
}

/** Mediana y p95 de la latencia de alerta (umbral cumplido → aviso recibido), por destinatario. */
function ResumenLatencia({ version }) {
  const [grupos, setGrupos] = useState(null);
  useEffect(() => {
    api.latencia().then(setGrupos).catch(() => setGrupos(null));
  }, [version]);
  const nuevas = grupos?.filter((g) => g.tipo === 'NUEVA') ?? [];
  if (nuevas.length === 0) return null;
  return (
    <section className="resumen-latencia" aria-label="Latencia de alerta">
      <h3>Latencia de alerta (umbral cumplido → aviso recibido)</h3>
      <div className="grupo-latencias">
        {nuevas.map((g) => (
          <div key={g.destinatario} className="latencia">
            <div className="tenue pequeno">{DESTINATARIO[g.destinatario]}</div>
            <div>
              mediana <span className="mono">{segundos(g.entrega.mediana_s)}</span> · p95{' '}
              <span className="mono">{segundos(g.entrega.p95_s)}</span>
            </div>
            <div className="tenue pequeno">
              {g.entrega.n} de {g.total} recibidas
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

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
          {['alertas', 'notificaciones', 'transiciones', 'posiciones'].map((t) => (
            <a key={t} className="boton" href={`/api/exportar/${t}.csv`}>
              <DownloadSimple size={14} aria-hidden="true" /> <span className="mono">{t}.csv</span>
            </a>
          ))}
        </div>
      </div>
      <ResumenLatencia version={version} />
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
              <Entregas notificaciones={a.notificaciones} />
              {a.resultado_verificacion && <><dt>Verificación</dt><dd>{VERIFICACION[a.resultado_verificacion]}</dd></>}
            </dl>
            <AccionesAlerta alerta={a} />
          </article>
        ))}
      </div>
    </div>
  );
}
