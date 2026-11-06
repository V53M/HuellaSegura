import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agrupar, avanzar, distanciaM, masCercano, nombreVia, parsearCoordenadas, parsearDireccion, regexNombreOsm,
  interseccionesLineas, regexAnteriores, regexSiguientes, ubicarPlaca, viaAnterior, viaSiguiente,
} from '../src/geocodificacion/direccion.js';

test('lee direcciones con las abreviaturas usuales', () => {
  const casos = {
    'Carrera 32A # 12-34': ['Carrera 32A', 'Calle 12', 34],
    'Cra 32 A No. 12 - 34, Barrio Colseguros': ['Carrera 32A', 'Calle 12', 34],
    'kr 5 #10-20': ['Carrera 5', 'Calle 10', 20],
    'Cl 5 # 38-20 apto 301': ['Calle 5', 'Carrera 38', 20],
    'CALLE 12 BIS N° 4-15': ['Calle 12 Bis', 'Carrera 4', 15],
    'Transversal 29 # 26B-10': ['Transversal 29', 'Calle 26B', 10],
    'Diagonal 26 # 28-35': ['Diagonal 26', 'Carrera 28', 35],
    'Calle 5 Oeste # 8': ['Calle 5 Oeste', 'Carrera 8', null],
    'Carrera 4 # 9 oeste - 50': ['Carrera 4', 'Calle 9 Oeste', 50],
    'Avenida Calle 70 # 5-40': ['Calle 70', 'Carrera 5', 40],
  };
  for (const [texto, [via, cruce, placa]] of Object.entries(casos)) {
    const d = parsearDireccion(texto);
    assert.ok(d, texto);
    assert.equal(nombreVia(d.via), via, texto);
    assert.equal(nombreVia(d.cruce), cruce, texto);
    assert.equal(d.placa, placa, texto);
  }
});

test('una avenida sin tipo no tiene vía cruzada deducible', () => {
  const d = parsearDireccion('Av 6N # 23-45');
  assert.equal(d.via.tipo, 'Avenida');
  assert.equal(d.cruce, null);
});

test('rechaza textos que no son direcciones', () => {
  for (const t of ['', null, 'Barrio San Antonio', 'Conjunto Los Pinos casa 4', 'Carrera sin número']) {
    assert.equal(parsearDireccion(t), null, String(t));
  }
});

test('regex de nombre acepta las variantes de OpenStreetMap', () => {
  const re = new RegExp(regexNombreOsm({ tipo: 'Carrera', numero: 32, letra: 'A', bis: false }));
  for (const n of ['Carrera 32A', 'Carrera 32 A']) assert.ok(re.test(n), n);
  for (const n of ['Carrera 32', 'Carrera 32B', 'Carrera 132A', 'Carrera 32A Bis', 'Carrera 32A Sur']) assert.ok(!re.test(n), n);
  // El sufijo cardinal es parte del nombre: "Calle 5 Oeste" y "Calle 5" son vías distintas.
  const oeste = new RegExp(regexNombreOsm({ tipo: 'Calle', numero: 5, letra: '', bis: false, cardinal: 'Oeste' }));
  assert.ok(oeste.test('Calle 5 Oeste') && !oeste.test('Calle 5'));
  // En Cali varias vías principales se llaman "Avenida Calle 5", "Avenida Carrera 1"…
  assert.ok(new RegExp(regexNombreOsm({ tipo: 'Calle', numero: 5, letra: '', bis: false })).test('Avenida Calle 5'));
  assert.ok(new RegExp(regexSiguientes({ tipo: 'Calle', numero: 5, letra: '', cardinal: 'Oeste' })).test('Calle 6 Oeste'));
  const bis = new RegExp(regexNombreOsm({ tipo: 'Calle', numero: 12, letra: '', bis: true }));
  assert.ok(bis.test('Calle 12 Bis'));
  assert.ok(!bis.test('Calle 12'));
});

test('vías cruzadas siguientes y anteriores incluyen las que llevan letra', () => {
  const sig = new RegExp(regexSiguientes({ tipo: 'Calle', numero: 12, letra: '' }));
  for (const n of ['Calle 12A', 'Calle 12 B', 'Calle 13']) assert.ok(sig.test(n), n);
  for (const n of ['Calle 12', 'Calle 11', 'Calle 14', 'Calle 123', 'Calle 13 Sur']) assert.ok(!sig.test(n), n);
  const sigB = new RegExp(regexSiguientes({ tipo: 'Calle', numero: 12, letra: 'B' }));
  assert.ok(sigB.test('Calle 12C') && sigB.test('Calle 13') && !sigB.test('Calle 12A'));
  const ant = new RegExp(regexAnteriores({ tipo: 'Calle', numero: 12, letra: '' }));
  for (const n of ['Calle 11', 'Calle 11A', 'Calle 11 Bis']) assert.ok(ant.test(n), n);
  for (const n of ['Calle 12', 'Calle 12A', 'Calle 10']) assert.ok(!ant.test(n), n);
  const antB = new RegExp(regexAnteriores({ tipo: 'Calle', numero: 12, letra: 'B' }));
  for (const n of ['Calle 12', 'Calle 12A', 'Calle 11C']) assert.ok(antB.test(n), n);
  assert.ok(!antB.test('Calle 12C'));
});

test('lee coordenadas y descarta las que no son de Colombia', () => {
  assert.deepEqual(parsearCoordenadas('3.4516, -76.5320'), { lat: 3.4516, lon: -76.532 });
  assert.deepEqual(parsearCoordenadas(' 3.4516 -76.5320 '), { lat: 3.4516, lon: -76.532 });
  assert.equal(parsearCoordenadas('40.4168, -3.7038'), null);
  assert.equal(parsearCoordenadas('Carrera 5'), null);
});

test('avanzar y agrupar', () => {
  const a = { lat: 3.45, lon: -76.53 };
  const b = { lat: 3.451, lon: -76.53 }; // ~111 m al norte
  const p = avanzar(a, b, 34);
  assert.ok(Math.abs(distanciaM(a, p) - 34) < 0.5);
  assert.ok(p.lat > a.lat);
  assert.equal(agrupar([a, { lat: 3.4501, lon: -76.5301 }, b]).length, 2);
  assert.equal(masCercano(a, [b], 50), null);
  assert.deepEqual(masCercano(a, [b], 200), b);
});

test('intersecciones de líneas: cruce en X, en T y paralelas', () => {
  const carrera = [[[-76.53, 3.44], [-76.53, 3.46]]]; // norte-sur
  const calle = [[[-76.54, 3.45], [-76.52, 3.45]]]; // oriente-occidente
  const [p] = interseccionesLineas(carrera, calle);
  assert.ok(Math.abs(p.lat - 3.45) < 1e-9 && Math.abs(p.lon + 76.53) < 1e-9);
  const enT = [[[-76.54, 3.45], [-76.5301, 3.45]]]; // termina 11 m antes de la carrera
  assert.equal(interseccionesLineas(carrera, enT).length, 1);
  const paralela = [[[-76.52, 3.44], [-76.52, 3.46]]];
  assert.equal(interseccionesLineas(carrera, paralela).length, 0);
  assert.equal(nombreVia(viaSiguiente({ tipo: 'Calle', numero: 12, letra: 'B', bis: false })), 'Calle 13');
  assert.equal(nombreVia(viaAnterior({ tipo: 'Calle', numero: 12, letra: '', bis: true })), 'Calle 11');
});

test('ubicar placa: hacia la siguiente, lejos de la anterior o en la esquina', () => {
  const esquina = { lat: 3.45, lon: -76.53 };
  const norte = { lat: 3.451, lon: -76.53 };
  const sur = { lat: 3.449, lon: -76.53 };
  const conSiguiente = ubicarPlaca(esquina, [norte], [], 40);
  assert.ok(conSiguiente.conPlaca && conSiguiente.punto.lat > esquina.lat);
  const conAnterior = ubicarPlaca(esquina, [], [sur], 40);
  assert.ok(conAnterior.conPlaca && conAnterior.punto.lat > esquina.lat);
  assert.deepEqual(ubicarPlaca(esquina, [], [], 40), { punto: esquina, conPlaca: false });
  assert.deepEqual(ubicarPlaca(esquina, [norte], [], null), { punto: esquina, conPlaca: false });
});
