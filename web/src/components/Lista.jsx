import { ESPECIES, ESTADOS, hace } from '../formato.js';
import { Bateria, Estado } from './comunes.jsx';

const PRIORIDAD = ['ESCALADA', 'ALERTA', 'SIN_SEÑAL', 'FUERA_EN_GRACIA', 'EXCEPCION', 'DENTRO'];

export default function Lista({ seguimiento, onSeleccionar, onNueva }) {
  const conteo = Object.fromEntries(Object.keys(ESTADOS).map((k) => [k, 0]));
  seguimiento.forEach((s) => (conteo[s.estado ?? 'DENTRO'] += 1));
  const ordenados = [...seguimiento].sort(
    (a, b) => PRIORIDAD.indexOf(a.estado) - PRIORIDAD.indexOf(b.estado) || a.animal.localeCompare(b.animal),
  );

  return (
    <div className="panel-contenido">
      <div className="panel-cabecera">
        <h2>Animales en seguimiento</h2>
        <button className="boton primario" onClick={onNueva}>+ Nueva adopción</button>
      </div>
      <div className="resumen">
        {PRIORIDAD.map((k) => (
          <div key={k} className="resumen-item" style={{ '--c': ESTADOS[k].color }}>
            <strong>{conteo[k]}</strong>
            <span>{ESTADOS[k].corto}</span>
          </div>
        ))}
      </div>
      {ordenados.length === 0 && <p className="tenue">Todavía no hay adopciones. Registra la primera.</p>}
      <ul className="lista">
        {ordenados.map((s) => (
          <li key={s.adopcion_id}>
            <button className="tarjeta" onClick={() => onSeleccionar(s.adopcion_id)}>
              <span className="tarjeta-icono">{ESPECIES[s.especie]}</span>
              <span className="tarjeta-cuerpo">
                <span className="tarjeta-titulo">
                  <strong>{s.animal}</strong>
                  <Estado estado={s.estado} corto />
                </span>
                <span className="tenue pequeno">
                  {s.adoptante} · {s.dispositivo_uid ?? 'sin collar'}
                </span>
                <span className="tarjeta-pie pequeno">
                  <span>Último reporte {hace(s.ultimo_reporte)}</span>
                  <Bateria pct={s.bateria_pct} />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
