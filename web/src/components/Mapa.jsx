import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { circulo, coloresEstado } from '../formato.js';
import { SVG_ESPECIE } from '../iconosMapa.js';
import { alCambiarTema, esOscuro } from '../tema.js';

const CALI = [-76.532, 3.4516];
const VACIO = { type: 'FeatureCollection', features: [] };

// Mapas base grises de CARTO sobre OpenStreetMap (sin clave). La atribución viene en el propio estilo.
const ESTILOS = {
  claro: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  oscuro: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
};
const estiloActual = () => (esOscuro() ? ESTILOS.oscuro : ESTILOS.claro);

// Recorrido y edición en índigo (el primario de la interfaz), con un tono por tema.
const TRAZO = { claro: '#3E63DD', oscuro: '#9EB1FF' };

function colorPorEstado(oscuro) {
  const c = coloresEstado(oscuro);
  return ['match', ['get', 'estado'], ...Object.entries(c).flat(), c.DENTRO];
}

/** Añade nuestras fuentes y capas. Se llama en cada 'style.load', porque setStyle borra lo que no es del estilo base. */
function agregarCapas(m) {
  const oscuro = esOscuro();
  const color = colorPorEstado(oscuro);
  const trazo = oscuro ? TRAZO.oscuro : TRAZO.claro;
  // Zonas y recorridos debajo de las etiquetas del mapa base, para que los nombres de calles sigan legibles.
  const primeraEtiqueta = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;

  m.addSource('zonas', { type: 'geojson', data: VACIO });
  m.addSource('recorrido', { type: 'geojson', data: VACIO });
  m.addSource('edicion', { type: 'geojson', data: VACIO });
  m.addLayer({
    id: 'zonas-relleno', type: 'fill', source: 'zonas',
    paint: { 'fill-color': color, 'fill-opacity': ['case', ['get', 'seleccionada'], 0.22, 0.1] },
  }, primeraEtiqueta);
  m.addLayer({
    id: 'zonas-borde', type: 'line', source: 'zonas',
    paint: { 'line-color': color, 'line-width': ['case', ['get', 'seleccionada'], 2, 1.25] },
  }, primeraEtiqueta);
  m.addLayer({
    id: 'recorrido-linea', type: 'line', source: 'recorrido', filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': trazo, 'line-width': 2, 'line-opacity': 0.85 },
  }, primeraEtiqueta);
  m.addLayer({
    id: 'recorrido-puntos', type: 'circle', source: 'recorrido', filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 2.5,
      'circle-color': ['case', ['get', 'valida'], trazo, oscuro ? '#696E77' : '#8B8D98'],
      'circle-stroke-color': oscuro ? '#111113' : '#FFFFFF', 'circle-stroke-width': 1,
    },
  });
  m.addLayer({
    id: 'edicion-relleno', type: 'fill', source: 'edicion',
    paint: { 'fill-color': trazo, 'fill-opacity': 0.14 },
  });
  m.addLayer({
    id: 'edicion-borde', type: 'line', source: 'edicion',
    paint: { 'line-color': trazo, 'line-width': 2, 'line-dasharray': [2, 1.5] },
  });
}

/**
 * Mapa de la fundación: zonas seguras coloreadas por estado, última posición de cada animal,
 * recorrido del seleccionado y, en modo edición, la zona que se está dibujando.
 */
export default function Mapa({ seguimiento, seleccionId, onSeleccionar, recorrido, edicion, onClickMapa, enfoque }) {
  const contenedor = useRef(null);
  const mapa = useRef(null);
  const marcadores = useRef(new Map());
  const clickRef = useRef(onClickMapa);
  const seleccionarRef = useRef(onSeleccionar);
  // Sube cada vez que el estilo termina de cargar (inicio y cambio de tema) para volver a volcar los datos.
  const [estilo, setEstilo] = useState(0);
  const encuadrado = useRef(false);
  clickRef.current = onClickMapa;
  seleccionarRef.current = onSeleccionar;

  useEffect(() => {
    const m = new maplibregl.Map({
      container: contenedor.current, style: estiloActual(), center: CALI, zoom: 12,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    m.on('style.load', () => {
      agregarCapas(m);
      setEstilo((n) => n + 1);
    });
    m.on('click', 'zonas-relleno', (e) => {
      if (clickRef.current) return;
      seleccionarRef.current?.(e.features[0].properties.id);
    });
    m.on('click', (e) => clickRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
    mapa.current = m;
    const dejarDeEscuchar = alCambiarTema(() => m.setStyle(estiloActual()));
    // El mapa sigue montado cuando se cambia de pestaña; al volver a mostrarse debe recalcular su tamaño.
    const observador = new ResizeObserver(() => m.resize());
    observador.observe(contenedor.current);
    return () => {
      dejarDeEscuchar();
      observador.disconnect();
      m.remove();
    };
  }, []);

  // Zonas y marcadores de última posición.
  useEffect(() => {
    const m = mapa.current;
    if (!estilo) return;
    const conZona = seguimiento.filter((s) => s.zona_lat != null);
    m.getSource('zonas').setData({
      type: 'FeatureCollection',
      features: conZona.map((s) => ({
        type: 'Feature',
        geometry: circulo(s.zona_lon, s.zona_lat, s.radio_m),
        properties: { id: s.adopcion_id, estado: s.estado ?? 'DENTRO', seleccionada: s.adopcion_id === seleccionId },
      })),
    });

    const vivos = new Set();
    for (const s of seguimiento) {
      if (s.lat == null) continue;
      vivos.add(s.adopcion_id);
      let mk = marcadores.current.get(s.adopcion_id);
      if (!mk) {
        const el = document.createElement('button');
        el.className = 'marcador';
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          seleccionarRef.current?.(Number(el.dataset.id));
        });
        mk = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([s.lon, s.lat]).addTo(m);
        marcadores.current.set(s.adopcion_id, mk);
      }
      const el = mk.getElement();
      el.dataset.id = s.adopcion_id;
      el.dataset.estado = s.estado;
      el.classList.toggle('seleccionado', s.adopcion_id === seleccionId);
      el.title = `${s.animal} · ${s.estado}`;
      el.setAttribute('aria-label', `${s.animal}, ${s.estado}`);
      const icono = document.createElement('span');
      icono.className = 'marcador-icono';
      icono.innerHTML = SVG_ESPECIE[s.especie] ?? SVG_ESPECIE.OTRO; // SVG estático del paquete, nunca datos del usuario
      const nombre = document.createElement('span');
      nombre.className = 'marcador-nombre';
      nombre.textContent = s.animal;
      el.replaceChildren(icono, nombre);
      mk.setLngLat([s.lon, s.lat]);
    }
    for (const [id, mk] of marcadores.current) {
      if (!vivos.has(id)) {
        mk.remove();
        marcadores.current.delete(id);
      }
    }

    if (!encuadrado.current && conZona.length) {
      const b = new maplibregl.LngLatBounds();
      conZona.forEach((s) => b.extend([s.zona_lon, s.zona_lat]));
      m.fitBounds(b, { padding: 80, maxZoom: 15, duration: 0 });
      encuadrado.current = true;
    }
  }, [estilo, seguimiento, seleccionId]);

  // Recorrido del animal seleccionado.
  useEffect(() => {
    if (!estilo) return;
    const pts = recorrido ?? [];
    mapa.current.getSource('recorrido').setData({
      type: 'FeatureCollection',
      features: [
        ...(pts.length > 1
          ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.filter((p) => p.valida).map((p) => [p.lon, p.lat]) } }]
          : []),
        ...pts.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { valida: p.valida } })),
      ],
    });
  }, [estilo, recorrido]);

  // Zona en edición.
  useEffect(() => {
    if (!estilo) return;
    mapa.current.getSource('edicion').setData(
      edicion?.lat != null
        ? { type: 'Feature', geometry: circulo(edicion.lon, edicion.lat, edicion.radio_m) }
        : VACIO,
    );
    mapa.current.getCanvas().style.cursor = onClickMapa ? 'crosshair' : '';
  }, [estilo, edicion, onClickMapa]);

  // Centrar en el animal seleccionado cuando se pide.
  useEffect(() => {
    if (!estilo || !enfoque) return;
    mapa.current.flyTo({ center: [enfoque.lon, enfoque.lat], zoom: Math.max(mapa.current.getZoom(), 15.5), duration: 600 });
  }, [enfoque]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={contenedor} className="mapa" />;
}
