// Escenarios de aceptación del motor sobre trazas sintéticas (CLAUDE.md §7.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, clasificar, distanciaM, estadoInicial, evaluar } from '../src/motor/motor.js';

const MIN = 60_000;
const T0 = Date.UTC(2027, 0, 10, 12, 0, 0);
const PARAMS = { umbral_permanencia_min: 20, horas_para_escalar: 2, min_sin_senal: 15, usar_histeresis: true };
const RADIO = 100;
const ERROR = 30;

/** Ejecuta una lista de eventos y devuelve el estado final con todo lo producido. */
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

/** Una posición por minuto a la distancia indicada (en metros desde el centro de la zona). */
const pos = (min, distancia_m, extra = {}) => ({
  tipo: 'POSICION', t: T0 + min * MIN, distancia_m, error_m: ERROR, radio_m: RADIO, valida: true, ...extra,
});
const tick = (min) => ({ tipo: 'TICK', t: T0 + min * MIN });
const serie = (desde, hasta, distancia) => Array.from({ length: hasta - desde + 1 }, (_, i) => pos(desde + i, distancia));

test('clasificar aplica histéresis y borde único', () => {
  assert.equal(clasificar(140, 30, 100), 'FUERA');
  assert.equal(clasificar(60, 30, 100), 'DENTRO');
  assert.equal(clasificar(110, 30, 100), 'INCIERTO');
  assert.equal(clasificar(90, 30, 100), 'INCIERTO');
  assert.equal(clasificar(110, 30, 100, false), 'FUERA');
  assert.equal(clasificar(90, 30, 100, false), 'DENTRO');
});

test('distanciaM: 0,001° de latitud ≈ 111 m', () => {
  const d = distanciaM(3.45, -76.53, 3.451, -76.53);
  assert.ok(Math.abs(d - 111.2) < 1, `d=${d}`);
});

test('salida corta: vuelve antes del umbral y no alerta', () => {
  const r = correr([...serie(0, 5, 20), ...serie(6, 15, 250), ...serie(16, 20, 20)]);
  assert.equal(r.estado.estado, E.DENTRO);
  assert.equal(r.alertas, 0);
  assert.deepEqual(r.transiciones.map((x) => x.hacia), [E.FUERA_EN_GRACIA, E.DENTRO]);
});

test('salida prolongada: alerta al superar el umbral', () => {
  const r = correr([...serie(0, 5, 20), ...serie(6, 40, 250)]);
  assert.equal(r.estado.estado, E.ALERTA);
  assert.equal(r.alertas, 1);
  const alerta = r.transiciones.find((x) => x.hacia === E.ALERTA);
  assert.equal(alerta.t, T0 + 26 * MIN); // salió en el minuto 6 + umbral de 20
  assert.equal(alerta.causa, 'UMBRAL_SUPERADO');
});

test('el tick alerta aunque no lleguen más posiciones dentro del umbral', () => {
  const r = correr([pos(0, 20), pos(1, 250), tick(10), tick(21)], { params: { ...PARAMS, min_sin_senal: 60 } });
  assert.equal(r.estado.estado, E.ALERTA);
});

test('salida con excepción vigente: no alerta', () => {
  const excepcion = { inicio: T0, fin: T0 + 120 * MIN };
  const r = correr([...serie(0, 5, 20), ...serie(6, 90, 400)], { excepcion });
  assert.equal(r.estado.estado, E.EXCEPCION);
  assert.equal(r.alertas, 0);
});

test('excepción declarada estando fuera en gracia pasa a EXCEPCION', () => {
  const excepcion = { inicio: T0 + 10 * MIN, fin: T0 + 60 * MIN };
  const r = correr([pos(0, 20), pos(5, 300), { tipo: 'EXCEPCION', t: T0 + 10 * MIN }, pos(30, 300)], { excepcion });
  assert.equal(r.estado.estado, E.EXCEPCION);
  assert.equal(r.alertas, 0);
});

test('excepción vencida estando fuera: el umbral cuenta desde el fin de la excepción', () => {
  const excepcion = { inicio: T0, fin: T0 + 30 * MIN };
  const r = correr([pos(0, 20), pos(5, 300), tick(31), tick(45), tick(50)], { excepcion, params: { ...PARAMS, min_sin_senal: 120 } });
  assert.equal(r.estado.estado, E.ALERTA);
  const alerta = r.transiciones.find((x) => x.hacia === E.ALERTA);
  assert.equal(alerta.t, T0 + 50 * MIN);
  assert.ok(r.transiciones.some((x) => x.causa === 'EXCEPCION_VENCIDA'));
});

test('saltos aislados por error de medición: no alertan', () => {
  const eventos = serie(0, 60, 40).map((e, i) => (i % 10 === 5 ? { ...e, distancia_m: 160 } : e));
  const r = correr(eventos);
  assert.equal(r.alertas, 0);
  assert.equal(r.estado.estado, E.DENTRO);
});

test('posiciones inválidas no cambian el estado', () => {
  const r = correr([pos(0, 20), pos(1, 900, { valida: false }), pos(2, 900, { valida: false })]);
  assert.equal(r.estado.estado, E.DENTRO);
  assert.equal(r.transiciones.length, 0);
});

test('posición atrasada se ignora', () => {
  const r = correr([pos(0, 20), pos(10, 20), pos(5, 500)]);
  assert.equal(r.estado.estado, E.DENTRO);
});

test('histéresis reduce alertas en el borde frente al borde único', () => {
  // El animal deambula justo en el borde de la zona (entre 85 y 125 m) durante 2 horas.
  const borde = Array.from({ length: 121 }, (_, i) => pos(i, 105 + 20 * Math.sin(i / 3)));
  const con = correr(borde);
  const sin = correr(borde, { params: { ...PARAMS, usar_histeresis: false } });
  assert.equal(con.alertas, 0);
  assert.ok(sin.transiciones.length > con.transiciones.length);
});

test('pérdida de señal fuera de la zona: SIN_SEÑAL y el umbral sigue contando', () => {
  const r = correr([pos(0, 20), pos(1, 300), pos(2, 300), tick(10), tick(17), tick(25)]);
  assert.equal(r.estado.estado, E.SIN_SENAL);
  assert.equal(r.estado.estado_previo, E.ALERTA);
  assert.equal(r.alertas, 1);
  assert.ok(r.transiciones.some((x) => x.causa === 'UMBRAL_SUPERADO_SIN_SEÑAL'));
});

test('recupera la señal y reevalúa', () => {
  const r = correr([pos(0, 20), tick(16), pos(20, 20)]);
  assert.deepEqual(r.transiciones.map((x) => x.hacia), [E.SIN_SENAL, E.DENTRO]);
  assert.equal(r.estado.estado_previo, null);
});

test('evento deviceOffline de Traccar lleva a SIN_SEÑAL', () => {
  const r = correr([pos(0, 20), { tipo: 'CONEXION', t: T0 + MIN, conexion: 'deviceOffline' }]);
  assert.equal(r.estado.estado, E.SIN_SENAL);
  assert.equal(r.transiciones[0].causa, 'EVENTO_deviceOffline');
  const online = correr([pos(0, 20), { tipo: 'CONEXION', t: T0 + MIN, conexion: 'deviceOnline' }]);
  assert.equal(online.estado.estado, E.DENTRO);
});

test('alerta sin respuesta escala; ESCALADA ignora el regreso y solo la cierra la fundación', () => {
  const base = [pos(0, 20), pos(1, 300), pos(22, 300)];
  const r = correr([...base, pos(60, 300), pos(142, 300), pos(150, 20), { tipo: 'CIERRE_FUNDACION', t: T0 + 160 * MIN }]);
  const hacia = r.transiciones.map((x) => x.hacia);
  assert.deepEqual(hacia, [E.FUERA_EN_GRACIA, E.ALERTA, E.ESCALADA, E.DENTRO]);
  assert.equal(r.transiciones.at(-1).causa, 'CIERRE_FUNDACION');
  assert.deepEqual(r.acciones.map((a) => a.tipo), ['CREAR_ALERTA', 'ESCALAR_ALERTA', 'RESOLVER_ALERTA']);
});

test('respuesta del adoptante cierra la alerta y abre una nueva ventana', () => {
  const r = correr([pos(0, 20), pos(1, 300), pos(22, 300), { tipo: 'RESPUESTA_ADOPTANTE', t: T0 + 25 * MIN }, pos(30, 300)]);
  assert.equal(r.estado.estado, E.FUERA_EN_GRACIA);
  assert.equal(r.estado.fuera_desde, T0 + 25 * MIN);
  const r2 = correr([pos(0, 20), pos(1, 300), pos(22, 300), { tipo: 'RESPUESTA_ADOPTANTE', t: T0 + 25 * MIN }, pos(46, 300)]);
  assert.equal(r2.alertas, 2);
});

test('el animal vuelve estando en alerta: se resuelve la alerta', () => {
  const r = correr([pos(0, 20), pos(1, 300), pos(22, 300), pos(30, 20)]);
  assert.equal(r.estado.estado, E.DENTRO);
  assert.deepEqual(r.acciones.at(-1), { tipo: 'RESOLVER_ALERTA', causa: 'VOLVIO' });
});

test('respuesta o cierre fuera de alerta no hacen nada', () => {
  const r = correr([pos(0, 20), { tipo: 'RESPUESTA_ADOPTANTE', t: T0 + MIN }, { tipo: 'CIERRE_FUNDACION', t: T0 + 2 * MIN }]);
  assert.equal(r.transiciones.length, 0);
});

test('evento desconocido lanza error', () => {
  assert.throws(() => correr([{ tipo: 'OTRO', t: T0 }]));
});
