import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ESPECIES, MOTIVOS, causa, duracion, fechaHora, hace } from '../formato.js';
import { Bateria, Estado } from './comunes.jsx';
import { AccionesAlerta } from './Alertas.jsx';

/** Expediente de evidencia de una adopción: estado actual, acciones y bitácora. */
export default function Detalle({ adopcionId, version, parametros, horas, onHoras, onVolver, onEditarZona, onCentrar }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [, setReloj] = useState(0);

  useEffect(() => {
    let vigente = true;
    api.adopcion(adopcionId).then((r) => vigente && setD(r)).catch((e) => setError(e.message));
    return () => {
      vigente = false;
    };
  }, [adopcionId, version]);

  // Refresca contadores ("hace X", duración en el estado) cada segundo.
  useEffect(() => {
    const i = setInterval(() => setReloj((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, []);

  if (error) return <div className="panel-contenido"><p className="error">{error}</p></div>;
  if (!d) return <div className="panel-contenido"><p className="tenue">Cargando…</p></div>;

  const alertaAbierta = d.alertas.find((a) => !a.resuelta_en);
  const umbralMs = (parametros?.umbral_permanencia_min ?? 0) * 60_000;
  const consumido = d.estado === 'FUERA_EN_GRACIA' && d.fuera_desde ? Math.min(1, (Date.now() - new Date(d.fuera_desde)) / umbralMs) : null;

  return (
    <div className="panel-contenido">
      <div className="panel-cabecera">
        <button className="boton fantasma" onClick={onVolver}>← Volver</button>
        <div className="grupo-botones">
          {d.lat != null && <button className="boton" onClick={() => onCentrar({ lat: d.lat, lon: d.lon })}>Centrar</button>}
          <button className="boton" onClick={onEditarZona}>Editar zona</button>
        </div>
      </div>

      <h2 className="titulo-animal">
        <span>{ESPECIES[d.especie]}</span> {d.animal}
      </h2>
      <div className="estado-grande">
        <Estado estado={d.estado} />
        <span className="tenue pequeno">desde {fechaHora(d.estado_desde)} · {duracion(d.estado_desde)}</span>
        {d.estado === 'SIN_SEÑAL' && d.estado_previo && (
          <span className="pequeno">Antes de perder la señal: <Estado estado={d.estado_previo} corto /></span>
        )}
      </div>

      {consumido != null && (
        <div className="umbral">
          <div className="umbral-barra"><span style={{ width: `${consumido * 100}%` }} /></div>
          <span className="pequeno">
            Fuera hace {duracion(d.fuera_desde)} de un umbral de {parametros.umbral_permanencia_min} min
          </span>
        </div>
      )}

      {alertaAbierta && (
        <div className={`caja-alerta ${alertaAbierta.escalada_en ? 'escalada' : ''}`}>
          <strong>{alertaAbierta.escalada_en ? '⚠️ Caso escalado a la fundación' : '🚨 Alerta activa'}</strong>
          <p className="pequeno">
            Creada {hace(alertaAbierta.creada_en)}. Fuera de la zona desde {fechaHora(alertaAbierta.fuera_desde)}.
            {alertaAbierta.respondida_en && ` El adoptante respondió: «${alertaAbierta.respuesta ?? 'sin comentario'}».`}
          </p>
          <AccionesAlerta alerta={alertaAbierta} />
        </div>
      )}

      <dl className="datos">
        <div><dt>Distancia al centro</dt><dd>{d.distancia_m != null ? `${Math.round(d.distancia_m)} m` : '—'} <span className="tenue">/ radio {Math.round(d.radio_m ?? 0)} m</span></dd></div>
        <div><dt>Último reporte</dt><dd>{hace(d.ultimo_reporte)}</dd></div>
        <div><dt>Batería</dt><dd><Bateria pct={d.bateria_pct} /></dd></div>
        <div><dt>Precisión</dt><dd>{d.precision_m != null ? `${Math.round(d.precision_m)} m` : `no reportada (se usa ${parametros?.error_m_respaldo} m)`}</dd></div>
        <div><dt>Collar</dt><dd>{d.dispositivo_uid ?? 'sin asignar'}</dd></div>
        <div><dt>Peso</dt><dd>{d.peso_kg} kg</dd></div>
        <div><dt>Adoptante</dt><dd>{d.adoptante}<br /><span className="tenue pequeno">{d.telefono} · {d.direccion}</span></dd></div>
        <div><dt>Entregado</dt><dd>{new Date(d.fecha_entrega).toLocaleDateString('es-CO')}</dd></div>
      </dl>

      <FormExcepcion adopcionId={d.adopcion_id} vigente={d.excepcion_vigente} />

      <section className="seccion">
        <div className="seccion-cabecera">
          <h3>Recorrido en el mapa</h3>
          <select value={horas} onChange={(e) => onHoras(Number(e.target.value))}>
            <option value={1}>Última hora</option>
            <option value={6}>Últimas 6 h</option>
            <option value={24}>Últimas 24 h</option>
            <option value={168}>Últimos 7 días</option>
          </select>
        </div>
      </section>

      <section className="seccion">
        <h3>Bitácora de estados</h3>
        {d.transiciones.length === 0 && <p className="tenue pequeno">Sin cambios de estado todavía.</p>}
        <ol className="bitacora">
          {d.transiciones.map((t) => (
            <li key={t.id}>
              <span className="bitacora-hora tenue pequeno">{fechaHora(t.ocurrida_en)}</span>
              <span className="bitacora-cambio">
                <Estado estado={t.desde} corto /> → <Estado estado={t.hacia} corto />
              </span>
              <span className="pequeno">{causa(t.causa)}</span>
            </li>
          ))}
        </ol>
      </section>

      {d.excepciones.length > 0 && (
        <section className="seccion">
          <h3>Excepciones declaradas</h3>
          <ul className="simple pequeno">
            {d.excepciones.map((x) => (
              <li key={x.id}>{MOTIVOS[x.motivo]}: {fechaHora(x.inicio)} → {fechaHora(x.fin)}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function FormExcepcion({ adopcionId, vigente }) {
  const [motivo, setMotivo] = useState('PASEO');
  const [minutos, setMinutos] = useState(60);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  const enviar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      await api.declararExcepcion(adopcionId, motivo, minutos);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section className="seccion">
      <h3>Excepción declarada</h3>
      {vigente ? (
        <p className="pequeno">
          ✅ {MOTIVOS[vigente.motivo]} vigente hasta {fechaHora(vigente.fin)} ({hace(vigente.fin)}).
        </p>
      ) : (
        <p className="tenue pequeno">Ninguna vigente.</p>
      )}
      <form className="fila-form" onSubmit={enviar}>
        <select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
          {Object.entries(MOTIVOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={minutos} onChange={(e) => setMinutos(Number(e.target.value))}>
          <option value={5}>5 min</option>
          <option value={30}>30 min</option>
          <option value={60}>1 hora</option>
          <option value={180}>3 horas</option>
          <option value={1440}>1 día</option>
          <option value={4320}>3 días</option>
        </select>
        <button className="boton" disabled={enviando}>Declarar</button>
      </form>
      <p className="tenue pequeno">Demo: en el producto final la declara el adoptante desde la app móvil.</p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
