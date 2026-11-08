// Worker espacial: clasificación con ST_DWithin (PostGIS) y la regla central de las 3 condiciones
// simultáneas para alerta_abandono PENDIENTE (contexto del proyecto, §5).
// Pruebas puras: sin base de datos, los booleanos de ST_DWithin se simulan como los devolvería el motor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, clasificar, clasificarLado, estadoInicial, evaluar } from '../src/motor/motor.js';

const MIN = 60_000;
const T0 = Date.UTC(2027, 0, 10, 12, 0, 0);
const PARAMS = { umbral_permanencia_min: 20, horas_para_escalar: 2, min_sin_senal: 60, usar_histeresis: true };
const RADIO = 100;
const ERROR = 30;

/** Los dos booleanos que calcula PostGIS con ST_DWithin, replicando la SQL del servicio. */
const desdePostGIS = (distancia_m, radio_m = RADIO, error_m = ERROR, usar_histeresis = true) => ({
  distancia_m,
  radio_m,
  usar_histeresis,
  dentro_con_margen: distancia_m <= Math.max(radio_m - error_m, 0), // ST_DWithin(radio − error)
  puede_estar_dentro: distancia_m <= radio_m + error_m, // ST_DWithin(radio + error)
});

/** Posiciones por minuto a la distancia indicada; `lado` opcional viene de PostGIS. */
const pos = (min, distancia_m, extra = {}) => ({
  tipo: 'POSICION', t: T0 + min * MIN, distancia_m, error_m: ERROR, radio_m: RADIO, valida: true, ...extra,
});
const tick = (min) => ({ tipo: 'TICK', t: T0 + min * MIN });
const serie = (desde, hasta, distancia) => Array.from({ length: hasta - desde + 1 }, (_, i) => pos(desde + i, distancia));

function correr(eventos, { params = PARAMS, excepcion = null } = {}) {
  let estado = estadoInicial(T0);
  const transiciones = [];
  const acciones = [];
  for (const ev of eventos) {
    const r = evaluar({ estado, params, excepcion }, ev);
    estado = r.estado;
    transiciones.push(...r.transiciones);
    acciones.push(...r.acciones);
  }
  return { estado, transiciones, acciones, alertas: acciones.filter((a) => a.tipo === 'CREAR_ALERTA').length };
}

test('clasificarLado coincide con clasificar (respaldo Haversine) salvo en el borde exacto', () => {
  // PostGIS usa ≤ (borde cerrado); Haversine usa <. Fuera del borde exacto deben dar lo mismo.
  for (let d = 0; d <= 200; d += 5) {
    if (d === RADIO - ERROR || d === RADIO + ERROR) continue; // ahí difieren por ≤ vs <
    const esperado = clasificar(d, ERROR, RADIO, true);
    assert.equal(clasificarLado(desdePostGIS(d)), esperado, `distancia=${d}`);
  }
});

test('clasificarLado con histéresis desactivada usa el borde único', () => {
  assert.equal(clasificarLado(desdePostGIS(90, RADIO, ERROR, false)), 'DENTRO');
  assert.equal(clasificarLado(desdePostGIS(110, RADIO, ERROR, false)), 'FUERA');
  assert.equal(clasificarLado(desdePostGIS(100, RADIO, ERROR, false)), 'DENTRO'); // borde incluido
});

test('ST_DWithin con error mayor que el radio no produce falsos FUERA (GREATEST en la SQL)', () => {
  // Radio 10 m, error 40 m: la SQL usa GREATEST(radio − error, 0) para que ST_DWithin no evalúe un radio negativo.
  const dentro = desdePostGIS(5, 10, 40); // 5 m de un radio de 10 m: claramente dentro
  assert.equal(dentro.dentro_con_margen, 5 <= Math.max(10 - 40, 0), 'se evalúa contra 0, no contra −30');
  // Histéresis honesta: 5 ≤ 0 es false, pero 5 ≤ 10 + 40 sigue siendo true → INCIERTO, no FUERA.
  assert.equal(clasificarLado(dentro), 'INCIERTO');
  // y una posición lejana sí es FUERA: no está ni en radio + error.
  assert.equal(clasificarLado(desdePostGIS(80, 10, 40)), 'FUERA');
  // el respaldo Haversine da el mismo INCIERTO en el caso borde.
  assert.equal(clasificar(5, 40, 10), 'INCIERTO');
});

test('el motor usa el lado calculado por PostGIS si viene en el evento', () => {
  // Distancia 60 m con error 30 y radio 100: Haversine diría INCIERTO, pero PostGIS dice DENTRO
  // (60 ≤ 100 − 30 = 70). El lado del evento debe imponerse sobre la clasificación local.
  const evento = { ...pos(1, 60), lado: 'DENTRO' };
  const r = correr([pos(0, 300), pos(1, 300), evento]);
  assert.equal(r.estado.estado, E.DENTRO, 'lado DENTRO manda sobre la distancia');
  assert.ok(r.transiciones.some((x) => x.causa === 'REGRESO_A_ZONA'));
});

test('sin lado en el evento, el motor clasifica con Haversine (compatibilidad)', () => {
  const r = correr([pos(0, 20), pos(1, 250)]);
  assert.equal(r.estado.estado, E.FUERA_EN_GRACIA);
});

// ── Regla central: alerta_abandono PENDIENTE solo con las 3 condiciones simultáneas ──

test('condición 1: DENTRO de la zona nunca alerta, aunque pase el tiempo', () => {
  const r = correr([...serie(0, 90, 20)]); // 90 min dentro, umbral 20 min
  assert.equal(r.estado.estado, E.DENTRO);
  assert.equal(r.alertas, 0);
});

test('condición 1: FUERA pero con posición inválida no inicia la salida', () => {
  // Posiciones a 250 m pero sin fix válido: son evidencia, no inician la ventana del umbral.
  const r = correr([pos(0, 20), pos(1, 250, { valida: false }), pos(2, 250, { valida: false }), pos(3, 250, { valida: false })]);
  assert.equal(r.estado.estado, E.DENTRO);
  assert.equal(r.transiciones.length, 0);
  assert.equal(r.alertas, 0);
});

test('condición 2: FUERA menos tiempo que el umbral no alerta', () => {
  const r = correr([...serie(0, 5, 20), ...serie(6, 19, 250)]); // 14 min fuera < 20 min
  assert.equal(r.estado.estado, E.FUERA_EN_GRACIA);
  assert.equal(r.alertas, 0);
});

test('condición 3: FUERA con excepción activa que solape ahora no alerta', () => {
  const excepcion = { inicio: T0, fin: T0 + 120 * MIN };
  const r = correr([...serie(0, 5, 20), ...serie(6, 90, 400)], { excepcion });
  assert.equal(r.estado.estado, E.EXCEPCION);
  assert.equal(r.alertas, 0);
});

test('condición 3: la excepción que NO solape el instante actual no libera de alertar', () => {
  // Excepción de la madrugada (00:00–06:00) ya vencida; la salida es a las 12:00.
  const excepcion = { inicio: T0 - 6 * 60 * MIN, fin: T0 - 60 * MIN };
  const r = correr([...serie(0, 5, 20), ...serie(6, 40, 250)], { excepcion });
  assert.equal(r.estado.estado, E.ALERTA);
  assert.equal(r.alertas, 1);
});

test('las 3 condiciones juntas: PENDIENTE hacia la fundación', () => {
  const r = correr([...serie(0, 5, 20), ...serie(6, 40, 250)]);
  // 1) FUERA del radio, 2) ≥ 20 min consecutivos, 3) sin excepción activa.
  assert.equal(r.estado.estado, E.ALERTA);
  assert.equal(r.alertas, 1);
  assert.equal(r.transiciones.find((x) => x.hacia === E.ALERTA).causa, 'UMBRAL_SUPERADO');
});

test('las 2 primeras condiciones con excepción vigente en el instante del umbral: no alerta', () => {
  // Sale a los 5 min, el umbral se cumpliría a los 25, pero la excepción cubre ese instante.
  const excepcion = { inicio: T0, fin: T0 + 30 * MIN };
  const r = correr([...serie(0, 5, 20), ...serie(6, 40, 250)], { excepcion });
  assert.equal(r.alertas, 0, 'la excepción activa bloquea la alerta');
  // Al vencer la excepción el umbral empieza a contar de nuevo: a los 10 min aún no se cumple.
  assert.equal(r.estado.estado, E.FUERA_EN_GRACIA);
});

test('el lado PostGIS DENTRO regresa incluso con la excepción vencida', () => {
  const excepcion = { inicio: T0, fin: T0 + 30 * MIN };
  const r = correr(
    [pos(0, 20), pos(5, 300), tick(40), pos(50, 300, { lado: 'DENTRO' })],
    { excepcion, params: { ...PARAMS, min_sin_senal: 120 } },
  );
  assert.equal(r.estado.estado, E.DENTRO);
  assert.equal(r.alertas, 0);
});
