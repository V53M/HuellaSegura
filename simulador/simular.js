#!/usr/bin/env node
// Simulador de trayectorias (CLAUDE.md §7.3). Envía posiciones con el protocolo OsmAnd:
// por defecto al endpoint directo de la API; con --destino http://<host>:5055/ las manda a Traccar.
//
//   node simular.js --escenario salida_prolongada --uid sim-001
//   node simular.js --demo            (tres collares a la vez)
//
// Escenarios: dentro · salida_corta · salida_prolongada · con_excepcion · saltos · sin_senal · borde
// La duración se adapta al umbral de permanencia que tenga configurado la fundación.

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
    return acc;
  }, []),
);

const API = args.api ?? 'http://localhost:3000';
const DESTINO = args.destino ?? `${API}/ingesta/osmand`;
const INTERVALO_S = Number(args.intervalo ?? 5);
const PRECISION = args.precision ? Number(args.precision) : null; // el TK911 Pro puede no reportarla

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const json = async (ruta, opciones) => {
  const r = await fetch(`${API}${ruta}`, opciones);
  if (!r.ok) throw new Error(`${ruta}: ${r.status} ${await r.text()}`);
  return r.json();
};

/** Punto a `d` metros del centro en el rumbo `b` (radianes). */
function desplazar(lat, lon, d, b) {
  return {
    lat: lat + (d * Math.cos(b)) / 111_320,
    lon: lon + (d * Math.sin(b)) / (111_320 * Math.cos((lat * Math.PI) / 180)),
  };
}

/** Cada escenario devuelve la lista de distancias (m) al centro, una por envío; null = el collar no reporta. */
function trayectoria(escenario, r, n, errorM) {
  const quieto = (k, d) => Array.from({ length: Math.max(1, Math.round(k)) }, () => d * (0.7 + 0.6 * Math.random()));
  const caminar = (de, a, k) => Array.from({ length: k }, (_, i) => de + ((a - de) * (i + 1)) / k);
  switch (escenario) {
    case 'dentro':
      return quieto(3 * n, 0.25 * r);
    case 'salida_corta':
      return [...quieto(3, 0.2 * r), ...caminar(0.2 * r, 2.2 * r, 3), ...quieto(0.4 * n, 2.2 * r), ...caminar(2.2 * r, 0.2 * r, 3), ...quieto(n, 0.2 * r)];
    case 'salida_prolongada':
    case 'con_excepcion':
      return [...quieto(3, 0.2 * r), ...caminar(0.2 * r, 3 * r, 4), ...quieto(2.5 * n, 3 * r), ...caminar(3 * r, 0.2 * r, 4), ...quieto(3, 0.2 * r)];
    case 'saltos': // salto aislado más allá del borde + error cada 4 envíos
      return [...quieto(3 * n, 0.3 * r).map((d, i) => (i % 4 === 3 ? r + errorM + 25 : d)), ...quieto(3, 0.3 * r)];
    case 'sin_senal':
      return [...quieto(3, 0.2 * r), ...caminar(0.2 * r, 2.5 * r, 3), ...quieto(3, 2.5 * r), null];
    case 'borde': // deambula sobre el borde: sirve para comparar con y sin histéresis
      return Array.from({ length: Math.round(4 * n) }, (_, i) => r + 0.8 * errorM * Math.sin(i / 2));
    default:
      throw new Error(`Escenario desconocido: ${escenario}`);
  }
}

async function simular(uid, escenario) {
  const [seguimiento, params] = await Promise.all([json('/api/seguimiento'), json('/api/parametros')]);
  const adop = seguimiento.find((s) => s.dispositivo_uid === uid);
  if (!adop) throw new Error(`No hay una adopción activa con el collar ${uid}`);
  const lat = Number(args.lat ?? adop.zona_lat);
  const lon = Number(args.lon ?? adop.zona_lon);
  const r = Number(adop.radio_m);
  const n = (params.umbral_permanencia_min * 60) / INTERVALO_S; // envíos que caben en un umbral
  const distancias = trayectoria(escenario, r, n, PRECISION ?? params.error_m_respaldo);
  const etiqueta = `[${uid} · ${adop.animal} · ${escenario}]`;

  if (escenario === 'con_excepcion') {
    const minutos = Math.ceil((distancias.length * INTERVALO_S) / 60) + 1;
    await json(`/api/adopciones/${adop.adopcion_id}/excepciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: 'PASEO', duracion_min: minutos }),
    });
    console.log(`${etiqueta} excepción PASEO declarada por ${minutos} min`);
  }

  console.log(`${etiqueta} ${distancias.length} envíos cada ${INTERVALO_S} s (radio ${r} m, umbral ${params.umbral_permanencia_min} min)`);
  const rumbo = Math.random() * 2 * Math.PI;
  let bateria = 90 + Math.random() * 10;
  for (const [i, d] of distancias.entries()) {
    if (d == null) {
      console.log(`${etiqueta} el collar deja de reportar (se apagó o se lo quitaron)`);
      return;
    }
    const p = desplazar(lat, lon, d, rumbo + 0.15 * Math.sin(i / 5));
    bateria = Math.max(5, bateria - 0.05);
    const q = new URLSearchParams({
      id: uid, lat: p.lat.toFixed(6), lon: p.lon.toFixed(6),
      timestamp: String(Math.floor(Date.now() / 1000)), batt: bateria.toFixed(0),
      ...(PRECISION != null ? { accuracy: String(PRECISION) } : {}),
    });
    const res = await fetch(`${DESTINO}?${q}`, { method: 'POST' });
    if (!res.ok) console.warn(`${etiqueta} envío ${i + 1}: HTTP ${res.status} ${await res.text()}`);
    if (args.verbose) console.log(`${etiqueta} ${i + 1}/${distancias.length} a ${d.toFixed(0)} m`);
    await esperar(INTERVALO_S * 1000);
  }
  console.log(`${etiqueta} terminado`);
}

if (args.demo) {
  await Promise.all([
    simular('sim-001', 'salida_prolongada'),
    simular('sim-002', 'con_excepcion'),
    simular('sim-003', 'saltos'),
  ]);
} else {
  await simular(args.uid ?? 'sim-001', args.escenario ?? 'salida_prolongada');
}
