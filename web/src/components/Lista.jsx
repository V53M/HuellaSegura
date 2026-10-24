import { Plus } from '@phosphor-icons/react';
import { ESTADOS, hace } from '../formato.js';
import { Bateria, Estado, IconoEspecie } from './comunes.jsx';

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
        <h2>Seguimiento <span className="tenue mono">{seguimiento.length}</span></h2>
        <button className="boton primario" onClick={onNueva}>
          <Plus size={14} weight="bold" aria-hidden="true" /> Nueva adopción
        </button>
      </div>
      <div className="resumen sin-margen">
        {PRIORIDAD.map((k) => (
          <div key={k} className="resumen-item">
            <strong>{conteo[k]}</strong>
            <span style={{ '--c': ESTADOS[k].color }}>
              <span className="estado-punto" />
              {ESTADOS[k].corto}
            </span>
          </div>
        ))}
      </div>
      <div className="sin-margen">
        <div className="encabezado-casos" aria-hidden="true">
          <span />
          <span>Animal · Estado</span>
          <span>Último reporte</span>
        </div>
        {ordenados.length === 0 && <p className="vacio">Sin adopciones registradas.</p>}
        <ul className="tabla-casos">
          {ordenados.map((s) => (
            <li key={s.adopcion_id}>
              <button className="fila-caso" onClick={() => onSeleccionar(s.adopcion_id)}>
                <IconoEspecie especie={s.especie} size={18} />
                <span className="caso-cuerpo">
                  <span className="caso-titulo">
                    <strong>{s.animal}</strong>
                    <Estado estado={s.estado} corto />
                  </span>
                  <span className="caso-sub">
                    {s.adoptante} · <span className="mono">{s.dispositivo_uid ?? 'sin collar'}</span>
                  </span>
                </span>
                <span className="caso-derecha">
                  <span className="mono">{hace(s.ultimo_reporte)}</span>
                  <Bateria pct={s.bateria_pct} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
