// Convierte una dirección (o unas coordenadas) en candidatos de ubicación para la zona segura.
//
// 1. Coordenadas escritas a mano: se usan tal cual.
// 2. Dirección colombiana ("Cra 32A # 12-34"): cruce exacto de las dos vías y, si hay placa, se avanza
//    esos metros hacia la siguiente vía cruzada. El cruce se calcula con la geometría de las vías que da
//    Nominatim (rápido); si ahí no aparece, se pregunta a Overpass, más completo pero a veces muy lento.
// 3. Si no se puede leer o no hay cruce: búsqueda libre en Nominatim, marcada como aproximada.
//
// Ambos servicios son gratuitos y piden: identificarse (User-Agent), no más de una petición por segundo
// y guardar en caché. https://operations.osmfoundation.org/policies/nominatim/
import {
  agrupar, distanciaM, interseccionesLineas, nombreVia, parsearCoordenadas, parsearDireccion, regexAnteriores,
  regexNombreOsm, regexSiguientes, ubicarPlaca, viaAnterior, viaSiguiente,
} from './direccion.js';

const NOMINATIM = process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org';
const OVERPASS = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
const CONTACTO = process.env.GEOCODIFICACION_CONTACTO; // correo opcional que Nominatim pide para contactar al operador
const AGENTE = `HuellaSegura/0.1 (prototipo academico, Universidad ECCI${CONTACTO ? `; ${CONTACTO}` : ''})`;

// Área metropolitana de Cali (incluye Yumbo y Jamundí, donde también puede vivir un adoptante).
const CAJA = { sur: 3.28, oeste: -76.65, norte: 3.6, este: -76.42 };
const CENTRO_CALI = { lat: 3.4516, lon: -76.532 };
const MAX_CANDIDATOS = 5;

export class ErrorGeocodificacion extends Error {
  constructor(mensaje, { deEntrada = false } = {}) {
    super(mensaje);
    this.deEntrada = deEntrada; // true: el texto recibido no sirve; false: falló un servicio externo
  }
}

// ---------- Ritmo y caché ----------

/** Garantiza al menos `ms` entre llamadas sucesivas al mismo servicio. */
function limitador(ms) {
  let siguiente = 0;
  let cola = Promise.resolve();
  return (fn) => {
    const turno = cola.then(async () => {
      const espera = siguiente - Date.now();
      if (espera > 0) await new Promise((r) => setTimeout(r, espera));
      siguiente = Date.now() + ms;
      return fn();
    });
    cola = turno.catch(() => {});
    return turno;
  };
}
const turnoNominatim = limitador(1100);
const turnoOverpass = limitador(1000);

const cache = new Map();
const VIGENCIA_MS = 24 * 3600 * 1000;
function enCache(clave, calcular) {
  const hit = cache.get(clave);
  if (hit && Date.now() - hit.t < VIGENCIA_MS) return hit.valor;
  const valor = calcular().then(
    (v) => v,
    (err) => {
      cache.delete(clave); // no guardar fallos
      throw err;
    },
  );
  cache.set(clave, { t: Date.now(), valor });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return valor;
}

async function pedirJson(url, { esperaMs = 15_000, ...opciones } = {}) {
  const r = await fetch(url, {
    ...opciones,
    headers: { 'User-Agent': AGENTE, Accept: 'application/json', ...opciones.headers },
    signal: AbortSignal.timeout(esperaMs),
  });
  if (!r.ok) throw new ErrorGeocodificacion(`${new URL(url).host} respondió ${r.status}`);
  return r.json();
}

// ---------- Servicios ----------

/** Geometría (líneas [lon, lat]) de todos los tramos de una vía en el área metropolitana, según Nominatim. */
async function lineasNominatim(via) {
  const url = `${NOMINATIM}/search?${new URLSearchParams({
    q: `${nombreVia(via)}, Cali`, format: 'jsonv2', countrycodes: 'co', limit: 40, polygon_geojson: 1,
    dedupe: 0, // sin esto Nominatim junta los tramos homónimos y devuelve solo unos pocos
    viewbox: `${CAJA.oeste},${CAJA.norte},${CAJA.este},${CAJA.sur}`, bounded: 1,
  })}`;
  const resultados = await turnoNominatim(() => pedirJson(url));
  const nombre = new RegExp(regexNombreOsm(via));
  return resultados
    .filter((r) => nombre.test(r.name ?? '') && r.geojson)
    .flatMap((r) => {
      if (r.geojson.type === 'LineString') return [r.geojson.coordinates];
      if (r.geojson.type === 'MultiLineString') return r.geojson.coordinates;
      return [];
    });
}

/** Cruces calculados con la geometría de Nominatim. Devuelve null si no hay ninguno (se pasa a Overpass). */
async function crucesNominatim(via, cruce, conPlaca) {
  const lineasVia = await lineasNominatim(via);
  if (!lineasVia.length) return null;
  const esquinas = agrupar(interseccionesLineas(lineasVia, await lineasNominatim(cruce)));
  if (!esquinas.length) return null;
  let siguientes = [];
  let anteriores = [];
  if (conPlaca) {
    siguientes = agrupar(interseccionesLineas(lineasVia, await lineasNominatim(viaSiguiente(cruce))));
    if (!siguientes.length) anteriores = agrupar(interseccionesLineas(lineasVia, await lineasNominatim(viaAnterior(cruce))));
  }
  return { esquinas, siguientes, anteriores };
}

/** Cruces de la vía con la cruzada, las siguientes y las anteriores, en una sola consulta a Overpass. */
async function crucesOverpass(via, cruce) {
  const caja = `${CAJA.sur},${CAJA.oeste},${CAJA.norte},${CAJA.este}`;
  const way = (regex, nombre) => `way["highway"]["name"~"${regex}"](${caja})->.${nombre};`;
  const consulta = [
    '[out:json][timeout:20];',
    way(regexNombreOsm(via), 'a'), way(regexNombreOsm(cruce), 'b'),
    way(regexSiguientes(cruce), 'c'), way(regexAnteriores(cruce), 'd'),
    'node(w.a)(w.b)->.x; node(w.a)(w.c)->.y; node(w.a)(w.d)->.z;',
    // Cada "out count" sirve de separador entre los tres conjuntos.
    '.x out; .x out count; .y out; .y out count; .z out;',
  ].join('');
  const datos = await turnoOverpass(() =>
    pedirJson(OVERPASS, {
      esperaMs: 45_000,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: consulta }),
    }),
  );
  const conjuntos = [[], [], []];
  let i = 0;
  for (const e of datos.elements ?? []) {
    if (e.type === 'count') i += 1;
    else if (e.type === 'node' && i < 3) conjuntos[i].push({ lat: e.lat, lon: e.lon });
  }
  const [esquinas, siguientes, anteriores] = conjuntos;
  return { esquinas: agrupar(esquinas), siguientes: agrupar(siguientes), anteriores: agrupar(anteriores) };
}

/** Barrio y municipio de un punto, para que la fundación distinga entre candidatos. */
async function etiquetaDe({ lat, lon }) {
  try {
    const url = `${NOMINATIM}/reverse?${new URLSearchParams({ format: 'jsonv2', lat, lon, zoom: 17, addressdetails: 1 })}`;
    const r = await turnoNominatim(() => pedirJson(url));
    const a = r.address ?? {};
    const barrio = a.neighbourhood ?? a.suburb ?? a.quarter ?? a.city_district;
    const municipio = a.city ?? a.town ?? a.village ?? a.municipality;
    return [barrio, municipio].filter(Boolean).join(', ') || null;
  } catch {
    return null; // la etiqueta es una ayuda; sin ella el candidato sigue siendo útil
  }
}

async function busquedaLibre(texto) {
  const url = `${NOMINATIM}/search?${new URLSearchParams({
    q: texto, format: 'jsonv2', countrycodes: 'co', limit: MAX_CANDIDATOS, addressdetails: 1,
    viewbox: `${CAJA.oeste},${CAJA.norte},${CAJA.este},${CAJA.sur}`, bounded: 1,
  })}`;
  const r = await turnoNominatim(() => pedirJson(url));
  return r.map((x) => ({
    lat: Number(x.lat),
    lon: Number(x.lon),
    etiqueta: x.display_name.split(', ').slice(0, 3).join(', '),
    precision: 'APROXIMADA',
  }));
}

// ---------- Punto de entrada ----------

/**
 * @returns {Promise<{ interpretacion: string|null, candidatos: Array<{lat, lon, etiqueta, precision}>, aviso: string|null }>}
 *   precision: COORDENADAS · PREDIO (cruce + placa) · CRUCE (esquina) · APROXIMADA (búsqueda libre)
 */
export function geocodificar(texto) {
  const q = String(texto ?? '').trim().slice(0, 200);
  if (q.length < 3) throw new ErrorGeocodificacion('Escriba una dirección o unas coordenadas.', { deEntrada: true });
  return enCache(q.toLowerCase(), () => resolver(q));
}

async function resolver(q) {
  const coords = parsearCoordenadas(q);
  if (coords) {
    return { interpretacion: 'Coordenadas', candidatos: [{ ...coords, etiqueta: await etiquetaDe(coords), precision: 'COORDENADAS' }], aviso: null };
  }

  const dir = parsearDireccion(q);
  if (dir?.cruce) {
    const interpretacion = `${nombreVia(dir.via)} con ${nombreVia(dir.cruce)}${dir.placa ? `, a ${dir.placa} m de la esquina` : ''}`;
    const { esquinas, siguientes, anteriores } =
      (await crucesNominatim(dir.via, dir.cruce, Boolean(dir.placa))) ?? (await crucesOverpass(dir.via, dir.cruce));
    if (esquinas.length) {
      const ordenadas = esquinas
        .sort((a, b) => distanciaM(a, CENTRO_CALI) - distanciaM(b, CENTRO_CALI))
        .slice(0, MAX_CANDIDATOS);
      const candidatos = [];
      for (const esquina of ordenadas) {
        const { punto, conPlaca } = ubicarPlaca(esquina, siguientes, anteriores, dir.placa);
        candidatos.push({ ...punto, etiqueta: await etiquetaDe(punto), precision: conPlaca ? 'PREDIO' : 'CRUCE' });
      }
      const aviso = candidatos.length > 1
        ? 'Ese cruce existe en varios lugares: elija el barrio correcto.'
        : null;
      return { interpretacion, candidatos, aviso };
    }
    const candidatos = await busquedaLibre(`${nombreVia(dir.via)}, Cali`);
    return {
      interpretacion,
      candidatos,
      aviso: candidatos.length
        ? `No se encontró el cruce en el mapa. Se muestra la ${nombreVia(dir.via)}, que puede repetirse en varios barrios: verifique y ajuste el punto en el mapa.`
        : null,
    };
  }

  // "Barrio" no forma parte del nombre en OpenStreetMap. Sin municipio, Nominatim puede preferir un lugar
  // homónimo de Yumbo o Jamundí: primero se busca en Cali y, si no aparece nada, sin restringir.
  const limpio = q.replace(/^\s*(barrio|b\/|urbanizaci[oó]n|urb\.?)\s+/i, '');
  const nombraMunicipio = /\b(cali|yumbo|jamundi|jamundí|palmira|candelaria)\b/i.test(limpio);
  let candidatos = await busquedaLibre(nombraMunicipio ? limpio : `${limpio}, Cali`);
  if (!candidatos.length && !nombraMunicipio) candidatos = await busquedaLibre(limpio);
  return {
    interpretacion: null,
    candidatos,
    aviso: candidatos.length ? 'Resultado aproximado: verifique y ajuste el punto en el mapa.' : null,
  };
}
