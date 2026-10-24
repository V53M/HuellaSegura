import { ESTADOS } from '../formato.js';

export function Estado({ estado, corto = false }) {
  const e = ESTADOS[estado] ?? ESTADOS.DENTRO;
  return (
    <span className="estado" style={{ '--c': e.color }}>
      <span className="estado-punto" />
      {corto ? e.corto : e.nombre}
    </span>
  );
}

export function Bateria({ pct }) {
  if (pct == null) return <span className="tenue">—</span>;
  const baja = pct < 20;
  return (
    <span className={baja ? 'bateria baja' : 'bateria'} title="Batería del collar">
      🔋 {Math.round(pct)} %
    </span>
  );
}

/** Editor de zona segura: el centro se fija con un clic en el mapa y el radio con el control deslizante. */
export function EditorZona({ zona, onCambio, errorM }) {
  const pocoMargen = errorM != null && zona.radio_m < 2 * errorM;
  return (
    <div className="editor-zona">
      <p className="ayuda">
        {zona.lat == null ? '👆 Haz clic en el mapa sobre el domicilio del adoptante.' : '📍 Clic en el mapa para mover el centro.'}
      </p>
      <label className="campo">
        <span>
          Radio: <strong>{Math.round(zona.radio_m)} m</strong>
        </span>
        <input
          type="range" min="30" max="1000" step="10" value={zona.radio_m}
          onChange={(e) => onCambio({ ...zona, radio_m: Number(e.target.value) })}
        />
      </label>
      {pocoMargen && (
        <p className="aviso">
          Con un error GPS de {errorM} m, el animal solo cuenta como «dentro» a menos de {Math.max(0, zona.radio_m - errorM)} m
          del centro. Conviene un radio de al menos {2 * errorM} m.
        </p>
      )}
      {zona.lat != null && (
        <p className="tenue pequeno">
          Centro: {zona.lat.toFixed(5)}, {zona.lon.toFixed(5)}
        </p>
      )}
    </div>
  );
}
