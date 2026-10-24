// Lectura de direcciones colombianas y geometría para ubicarlas. Funciones puras (sin red).
//
// En Colombia "Carrera 32A # 12-34" significa: el predio está sobre la Carrera 32A, a 34 m de la esquina
// con la Calle 12, en dirección a la Calle 13. Por eso se ubica con el cruce de las dos vías y no con el
// nombre de la vía sola, que en Cali se repite en barrios distintos.

const TIPOS = [
  [/^(carrera|cra|kra|kr|cr|ak|avenida carrera)$/, 'Carrera'],
  [/^(calle|cll|cl|ac|avenida calle)$/, 'Calle'],
  [/^(transversal|transv|tv|tr)$/, 'Transversal'],
  [/^(diagonal|diag|dg)$/, 'Diagonal'],
  [/^(avenida|av)$/, 'Avenida'],
];

// La vía cruzada de una carrera es una calle y viceversa. En una avenida no se puede saber.
const CRUCE = { Carrera: 'Calle', Transversal: 'Calle', Calle: 'Carrera', Diagonal: 'Carrera' };

// La letra de la vía (32A) no puede ser el comienzo de una palabra: "5 Oeste" no es "5O", "12 bis" no es "12B".
const NUM = String.raw`(\d{1,3})\s*(?:([a-z])(?![a-z]))?\s*(bis)?`;
// En Cali la "Calle 5 Oeste" es otra vía distinta de la "Calle 5": el sufijo cardinal es parte del nombre.
const CARDINAL = String.raw`(sur|norte|oeste|este)?`;
const PATRON = new RegExp(
  String.raw`^(avenida carrera|avenida calle|[a-z]+)\.?\s*${NUM}\s*${CARDINAL}\s*(?:#|no\.?|n[°º]|numero)?\s*${NUM}\s*${CARDINAL}\s*(?:[-–]\s*(\d{1,3}))?`,
);
const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Lee una dirección del tipo "Cra 32A # 12-34", "Calle 5 No. 38-20 apto 301" o "Cl 12 bis 4 - 15".
 * @returns {null | { via: {tipo, numero, letra, bis}, cruce: {tipo, numero, letra, bis} | null, placa: number | null }}
 */
export function parsearDireccion(texto) {
  if (!texto) return null;
  const limpio = sinTildes(String(texto).toLowerCase()).replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = limpio.match(PATRON);
  if (!m) return null;
  const tipo = TIPOS.find(([re]) => re.test(m[1]))?.[1];
  if (!tipo) return null;
  const via = { tipo, numero: Number(m[2]), letra: m[3]?.toUpperCase() ?? '', bis: Boolean(m[4]), cardinal: capital(m[5]) };
  const tipoCruce = CRUCE[tipo];
  const cruce = tipoCruce
    ? { tipo: tipoCruce, numero: Number(m[6]), letra: m[7]?.toUpperCase() ?? '', bis: Boolean(m[8]), cardinal: capital(m[9]) }
    : null;
  return { via, cruce, placa: m[10] ? Number(m[10]) : null };
}

/** Nombre legible: "Carrera 32A", "Calle 12 Bis", "Calle 5 Oeste". */
export function nombreVia({ tipo, numero, letra, bis, cardinal }) {
  return `${tipo} ${numero}${letra}${bis ? ' Bis' : ''}${cardinal ? ` ${cardinal}` : ''}`;
}

const sufijo = (cardinal) => (cardinal ? ` ${cardinal}$` : '$');

/**
 * Expresión regular (sintaxis de Overpass y de JS) que acepta las variantes con que OpenStreetMap escribe
 * el nombre: "Carrera 32A", "Carrera 32 A", "Carrera 32A Bis", "Avenida Calle 5". El sufijo cardinal debe coincidir.
 */
export function regexNombreOsm({ tipo, numero, letra, bis, cardinal }) {
  const l = letra ? ` ?${letra}` : '';
  const b = bis ? ' ?[Bb]is' : '';
  return `^(Avenida )?${tipo} ${numero}${l}${b}${sufijo(cardinal)}`;
}

const LETRAS = 'ABCDEFGH';

/**
 * Regex de las vías cruzadas que vienen después (hacia donde avanza la placa): con la Calle 12 son la
 * 12A, 12B… y la 13, porque entre dos números suele haber vías con letra.
 */
export function regexSiguientes({ tipo, numero, letra, cardinal }) {
  const desde = letra ? LETRAS.indexOf(letra) + 1 : 0;
  const conLetra = desde < LETRAS.length ? `${numero} ?[${LETRAS.slice(desde)}]|` : '';
  return `^(Avenida )?${tipo} (${conLetra}${numero + 1})( ?[Bb]is)?${sufijo(cardinal)}`;
}

/** La vía cruzada siguiente o anterior por número (12 → 13 / 11), para buscarla por nombre exacto. */
export const viaSiguiente = (v) => ({ ...v, numero: v.numero + 1, letra: '', bis: false });
export const viaAnterior = (v) => ({ ...v, numero: Math.max(0, v.numero - 1), letra: '', bis: false });

/** Regex de las vías cruzadas anteriores: con la Calle 12B son la 12A, la 12 y la 11 (con o sin letra). */
export function regexAnteriores({ tipo, numero, letra, cardinal }) {
  const previas = letra ? LETRAS.slice(0, LETRAS.indexOf(letra)) : '';
  const mismas = letra ? (previas ? `${numero}( ?[${previas}])?|` : `${numero}|`) : '';
  return `^(Avenida )?${tipo} (${mismas}${Math.max(0, numero - 1)}( ?[${LETRAS}])?)( ?[Bb]is)?${sufijo(cardinal)}`;
}

/** "3.4516, -76.532" o "3.4516 -76.532" → { lat, lon }. Acepta solo valores plausibles para Colombia. */
export function parsearCoordenadas(texto) {
  const m = String(texto ?? '').trim().match(/^(-?\d{1,2}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (lat < -5 || lat > 14 || lon < -82 || lon > -66) return null;
  return { lat, lon };
}

// ---------- Geometría ----------

const R = 6_371_008.8;
const rad = Math.PI / 180;

export function distanciaM(a, b) {
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Punto a `metros` de `desde`, en la dirección de `hacia` (aproximación plana, válida a escala de cuadra). */
export function avanzar(desde, hacia, metros) {
  const d = distanciaM(desde, hacia);
  if (d === 0) return { ...desde };
  const f = metros / d;
  return { lat: desde.lat + (hacia.lat - desde.lat) * f, lon: desde.lon + (hacia.lon - desde.lon) * f };
}

/** Une puntos a menos de `radioM` (una vía de doble calzada da varios nodos en el mismo cruce). */
export function agrupar(puntos, radioM = 60) {
  const grupos = [];
  for (const p of puntos) {
    const g = grupos.find((x) => distanciaM(x.centro, p) <= radioM);
    if (g) {
      g.puntos.push(p);
      g.centro = {
        lat: g.puntos.reduce((s, q) => s + q.lat, 0) / g.puntos.length,
        lon: g.puntos.reduce((s, q) => s + q.lon, 0) / g.puntos.length,
      };
    } else {
      grupos.push({ centro: { lat: p.lat, lon: p.lon }, puntos: [p] });
    }
  }
  return grupos.map((g) => g.centro);
}

/** El punto de `lista` más cercano a `p`, si está a menos de `maxM`. */
export function masCercano(p, lista, maxM) {
  let mejor = null;
  let dMejor = Infinity;
  for (const q of lista) {
    const d = distanciaM(p, q);
    if (d < dMejor) {
      dMejor = d;
      mejor = q;
    }
  }
  return dMejor <= maxM ? mejor : null;
}

/**
 * Puntos donde se cortan dos conjuntos de líneas (coordenadas GeoJSON [lon, lat]). Cálculo plano: a escala
 * de ciudad el error es despreciable. Se tolera un 2 % de cada segmento porque en OpenStreetMap las vías
 * a veces terminan justo antes de la otra en vez de compartir el nodo.
 */
export function interseccionesLineas(lineasA, lineasB) {
  const puntos = [];
  for (const a of lineasA) {
    for (let i = 0; i < a.length - 1; i++) {
      const [p1, p2] = [a[i], a[i + 1]];
      for (const b of lineasB) {
        for (let j = 0; j < b.length - 1; j++) {
          const [p3, p4] = [b[j], b[j + 1]];
          const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
          if (d === 0) continue; // paralelas
          const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
          const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
          if (t >= -0.02 && t <= 1.02 && u >= -0.02 && u <= 1.02) {
            puntos.push({ lon: p1[0] + t * (p2[0] - p1[0]), lat: p1[1] + t * (p2[1] - p1[1]) });
          }
        }
      }
    }
  }
  return puntos;
}

/**
 * Ubica el predio a partir del cruce: avanza `placa` metros desde la esquina hacia la siguiente vía cruzada,
 * o se aleja de la anterior si la siguiente no aparece. Sin referencia de dirección, queda en la esquina.
 */
export function ubicarPlaca(esquina, siguientes, anteriores, placa) {
  if (!placa) return { punto: esquina, conPlaca: false };
  const metros = Math.min(placa, 150);
  const sig = masCercano(esquina, siguientes, 400);
  if (sig) return { punto: avanzar(esquina, sig, metros), conPlaca: true };
  const ant = masCercano(esquina, anteriores, 400);
  if (ant) return { punto: avanzar(esquina, ant, -metros), conPlaca: true };
  return { punto: esquina, conPlaca: false };
}
