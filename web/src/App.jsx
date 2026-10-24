import { useCallback, useEffect, useState } from 'react';
import { PawPrint, Siren, Warning } from '@phosphor-icons/react';
import { api, useEventosServidor } from './api.js';
import Mapa from './components/Mapa.jsx';
import Lista from './components/Lista.jsx';
import Detalle from './components/Detalle.jsx';
import NuevaAdopcion from './components/NuevaAdopcion.jsx';
import Alertas from './components/Alertas.jsx';
import Parametros from './components/Parametros.jsx';
import { EditorZona } from './components/comunes.jsx';

export default function App() {
  const [vista, setVista] = useState('seguimiento');
  const [panel, setPanel] = useState({ modo: 'lista' }); // lista · detalle · nueva · zona
  const [seguimiento, setSeguimiento] = useState([]);
  const [parametros, setParametros] = useState(null);
  const [recorrido, setRecorrido] = useState([]);
  const [horas, setHoras] = useState(1);
  const [zona, setZona] = useState(null); // zona en edición
  const [enfoque, setEnfoque] = useState(null);
  const [avisos, setAvisos] = useState([]);

  const alAlerta = useCallback((a) => {
    const id = Date.now() + Math.random();
    setAvisos((v) => [...v, { id, ...a }]);
    setTimeout(() => setAvisos((v) => v.filter((x) => x.id !== id)), 8000);
  }, []);
  const { version, conectado } = useEventosServidor(alAlerta);

  const cargarParametros = useCallback(() => api.parametros().then(setParametros), []);
  useEffect(() => {
    cargarParametros();
  }, [cargarParametros]);
  useEffect(() => {
    api.seguimiento().then(setSeguimiento);
  }, [version]);

  const seleccionId = panel.modo === 'detalle' || panel.modo === 'zona' ? panel.id : null;
  useEffect(() => {
    if (!seleccionId) return setRecorrido([]);
    api.recorrido(seleccionId, horas).then(setRecorrido);
  }, [seleccionId, horas, version]);

  const abrir = (id) => {
    setVista('seguimiento');
    setZona(null);
    setPanel({ modo: 'detalle', id });
    const s = seguimiento.find((x) => x.adopcion_id === id);
    const lat = s?.lat ?? s?.zona_lat;
    if (lat != null) setEnfoque({ lat, lon: s.lon ?? s.zona_lon });
  };

  const editarZona = () => {
    const s = seguimiento.find((x) => x.adopcion_id === panel.id);
    setZona({ lat: s?.zona_lat ?? null, lon: s?.zona_lon ?? null, radio_m: s?.radio_m ?? parametros.radio_m_defecto });
    setPanel({ modo: 'zona', id: panel.id });
  };

  const guardarZona = async () => {
    await api.guardarZona(panel.id, zona);
    setZona(null);
    setPanel({ modo: 'detalle', id: panel.id });
  };

  const nueva = () => {
    setZona({ lat: null, lon: null, radio_m: parametros?.radio_m_defecto ?? 120 });
    setPanel({ modo: 'nueva' });
  };

  const editando = panel.modo === 'zona' || panel.modo === 'nueva';
  const abiertas = seguimiento.filter((s) => s.estado === 'ALERTA' || s.estado === 'ESCALADA').length;
  const nombreDe = (id) => seguimiento.find((s) => s.adopcion_id === id)?.animal ?? `adopción ${id}`;

  return (
    <div className="app">
      <header className="barra">
        <div className="marca">
          <PawPrint className="icono" size={20} weight="fill" aria-hidden="true" />
          HuellaSegura
        </div>
        <nav className="pestanas">
          <button className={vista === 'seguimiento' ? 'activa' : ''} onClick={() => setVista('seguimiento')}>Seguimiento</button>
          <button className={vista === 'alertas' ? 'activa' : ''} onClick={() => setVista('alertas')}>
            Alertas {abiertas > 0 && <span className="insignia">{abiertas}</span>}
          </button>
          <button className={vista === 'parametros' ? 'activa' : ''} onClick={() => setVista('parametros')}>Parámetros</button>
        </nav>
        <div className="barra-derecha">
          {parametros?.fundacion && <span className="fundacion">{parametros.fundacion}</span>}
          <span className="separador" />
          <span className={`conexion ${conectado ? 'ok' : ''}`} title={conectado ? 'Recibiendo en tiempo real' : 'Sin conexión con el servidor'}>
            {conectado ? 'En vivo' : 'Desconectado'}
          </span>
        </div>
      </header>

      <main className={`cuerpo ${vista === 'seguimiento' ? '' : 'oculto'}`}>
        <aside className="panel">
          {panel.modo === 'lista' && <Lista seguimiento={seguimiento} onSeleccionar={abrir} onNueva={nueva} />}
          {panel.modo === 'detalle' && (
            <Detalle
              adopcionId={panel.id} version={version} parametros={parametros} horas={horas} onHoras={setHoras}
              onVolver={() => setPanel({ modo: 'lista' })} onEditarZona={editarZona} onCentrar={setEnfoque}
            />
          )}
          {panel.modo === 'zona' && (
            <div className="panel-contenido">
              <div className="panel-cabecera">
                <h2>Zona segura de {nombreDe(panel.id)}</h2>
              </div>
              <EditorZona zona={zona} onCambio={setZona} errorM={parametros?.error_m_respaldo} />
              <div className="grupo-botones">
                <button className="boton primario" onClick={guardarZona} disabled={zona.lat == null}>Guardar zona</button>
                <button className="boton fantasma" onClick={() => { setZona(null); setPanel({ modo: 'detalle', id: panel.id }); }}>Cancelar</button>
              </div>
            </div>
          )}
          {panel.modo === 'nueva' && (
            <NuevaAdopcion
              zona={zona} onZona={setZona} parametros={parametros}
              onCreada={(id) => { setZona(null); setPanel({ modo: 'detalle', id }); }}
              onCancelar={() => { setZona(null); setPanel({ modo: 'lista' }); }}
            />
          )}
        </aside>
        <Mapa
          seguimiento={seguimiento}
          seleccionId={seleccionId}
          onSeleccionar={abrir}
          recorrido={recorrido}
          edicion={zona}
          enfoque={enfoque}
          onClickMapa={editando ? (p) => setZona((z) => ({ ...z, ...p })) : null}
        />
      </main>

      {vista === 'alertas' && <Alertas version={version} onAbrir={abrir} />}
      {vista === 'parametros' && <Parametros onGuardado={cargarParametros} />}

      <div className="avisos" aria-live="polite">
        {avisos.map((a) => (
          <button key={a.id} className={`aviso-flotante ${a.tipo === 'ESCALADA' ? 'escalada' : ''}`} onClick={() => abrir(a.adopcionId)}>
            {a.tipo === 'ESCALADA'
              ? <Warning className="icono" size={16} weight="fill" aria-hidden="true" />
              : <Siren className="icono" size={16} weight="fill" aria-hidden="true" />}
            <span>
              {a.tipo === 'ESCALADA' ? 'Caso escalado: ' : 'Nueva alerta: '}
              <strong>{nombreDe(a.adopcionId)}</strong>
              <span className="tenue pequeno"> · Ver expediente</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
