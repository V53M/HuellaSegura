import { useState } from 'react';
import { BatteryFull, BatteryLow, BatteryMedium, MagnifyingGlass, MapPin, SpinnerGap } from '@phosphor-icons/react';
import { api } from '../api.js';
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

const PRECISION = {
  PREDIO: 'Predio (cruce y placa)',
  CRUCE: 'Esquina del cruce',
  COORDENADAS: 'Coordenadas',
  APROXIMADA: 'Aproximada',
};

/**
 * Busca la dirección del adoptante (o unas coordenadas) y propone dónde centrar la zona.
 * El punto elegido se puede ajustar después con un clic en el mapa.
 */
function BuscadorDireccion({ zona, onCambio, onEnfocar, direccionSugerida }) {
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState({ cargando: false, error: null, resultado: null });
  const [elegido, setElegido] = useState(null);

  const elegir = (c) => {
    setElegido(c);
    onCambio({ ...zona, lat: c.lat, lon: c.lon });
    onEnfocar?.({ lat: c.lat, lon: c.lon });
  };

  const buscar = async (consulta) => {
    const q = (consulta ?? texto).trim();
    if (!q) return;
    setTexto(q);
    setElegido(null);
    setEstado({ cargando: true, error: null, resultado: null });
    try {
      const resultado = await api.geocodificar(q);
      setEstado({ cargando: false, error: null, resultado });
      if (resultado.candidatos.length === 1) elegir(resultado.candidatos[0]);
    } catch (err) {
      setEstado({ cargando: false, error: err.message, resultado: null });
    }
  };

  const r = estado.resultado;
  return (
    <div className="buscador">
      <form className="buscador-fila" onSubmit={(e) => { e.preventDefault(); buscar(); }}>
        <input
          value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Dirección o coordenadas"
          placeholder="Cra 32A # 12-34  o  3.4516, -76.5320"
        />
        <button className="boton" type="submit" disabled={estado.cargando || !texto.trim()}>
          {estado.cargando ? <SpinnerGap className="girando" size={14} aria-hidden="true" /> : <MagnifyingGlass size={14} aria-hidden="true" />}
          Buscar
        </button>
      </form>
      {direccionSugerida && !texto && !r && (
        <button className="enlace pequeno" type="button" onClick={() => buscar(direccionSugerida)}>
          Usar la dirección del adoptante: {direccionSugerida}
        </button>
      )}
      {estado.cargando && <p className="tenue pequeno">Buscando en OpenStreetMap. Puede tardar unos segundos.</p>}
      {estado.error && <p className="error pequeno">{estado.error}</p>}
      {r && (
        <>
          {r.interpretacion && <p className="tenue pequeno">Interpretación: {r.interpretacion}</p>}
          {r.aviso && <p className="aviso">{r.aviso}</p>}
          {r.candidatos.length === 0 && <p className="tenue pequeno">Sin resultados. Seleccione el punto en el mapa.</p>}
          {r.candidatos.length > 0 && (
            <ul className="candidatos">
              {r.candidatos.map((c) => (
                <li key={`${c.lat},${c.lon}`}>
                  <button
                    type="button" className={`candidato ${elegido === c ? 'elegido' : ''}`} onClick={() => elegir(c)}
                    aria-pressed={elegido === c}
                  >
                    <span className="candidato-titulo">{c.etiqueta ?? 'Sin nombre de barrio'}</span>
                    <span className="candidato-detalle">
                      <span>{PRECISION[c.precision]}</span>
                      <span className="mono">{c.lat.toFixed(5)}, {c.lon.toFixed(5)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Editor de zona segura: el centro se fija escribiendo la dirección o con un clic en el mapa,
 * y el radio con el control deslizante.
 */
export function EditorZona({ zona, onCambio, errorM, onEnfocar, direccionSugerida }) {
  const pocoMargen = errorM != null && zona.radio_m < 2 * errorM;
  return (
    <div className="editor-zona">
      <BuscadorDireccion zona={zona} onCambio={onCambio} onEnfocar={onEnfocar} direccionSugerida={direccionSugerida} />
      <p className="ayuda">
        <MapPin className="icono" size={14} weight="fill" aria-hidden="true" />
        {zona.lat == null ? 'Escriba la dirección o seleccione el punto en el mapa.' : 'Ajuste el centro con un clic en el mapa.'}
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
