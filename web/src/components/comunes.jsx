import { BatteryFull, BatteryLow, BatteryMedium, MapPin } from '@phosphor-icons/react';
import { ESPECIES, ESTADOS } from '../formato.js';

export function Estado({ estado, corto = false }) {
  const e = ESTADOS[estado] ?? ESTADOS.DENTRO;
  return (
    <span className="estado" style={{ '--c': e.color, '--t': e.texto }}>
      <span className="estado-punto" />
      {corto ? e.corto : e.nombre}
    </span>
  );
}

export function IconoEspecie({ especie, size = 16 }) {
  const Icono = ESPECIES[especie] ?? ESPECIES.OTRO;
  return <Icono className="icono" size={size} weight="duotone" aria-hidden="true" />;
}

export function Bateria({ pct }) {
  if (pct == null) return <span className="tenue">—</span>;
  const baja = pct < 20;
  const Icono = pct >= 60 ? BatteryFull : pct >= 20 ? BatteryMedium : BatteryLow;
  return (
    <span className={baja ? 'bateria baja' : 'bateria'} title="Batería del collar">
      <Icono className="icono" size={14} weight={baja ? 'fill' : 'regular'} aria-hidden="true" />
      <span className="mono">{Math.round(pct)} %</span>
    </span>
  );
}

/** Editor de zona segura: el centro se fija con un clic en el mapa y el radio con el control deslizante. */
export function EditorZona({ zona, onCambio, errorM }) {
  const pocoMargen = errorM != null && zona.radio_m < 2 * errorM;
  return (
    <div className="editor-zona">
      <p className="ayuda">
        <MapPin className="icono" size={14} weight="fill" aria-hidden="true" />
        {zona.lat == null ? 'Seleccione el domicilio en el mapa.' : 'Clic en el mapa para mover el centro.'}
      </p>
      <label className="campo">
        <span>
          Radio: <strong className="mono">{Math.round(zona.radio_m)} m</strong>
        </span>
        <input
          type="range" min="30" max="1000" step="10" value={zona.radio_m}
          onChange={(e) => onCambio({ ...zona, radio_m: Number(e.target.value) })}
        />
      </label>
      {pocoMargen && (
        <p className="aviso">
          Con un error GPS de {errorM} m, el animal solo cuenta como «dentro» a menos de {Math.max(0, zona.radio_m - errorM)} m
          del centro. Radio recomendado: {2 * errorM} m o más.
        </p>
      )}
      {zona.lat != null && (
        <p className="tenue pequeno">
          Centro: <span className="mono">{zona.lat.toFixed(5)}, {zona.lon.toFixed(5)}</span>
        </p>
      )}
    </div>
  );
}
