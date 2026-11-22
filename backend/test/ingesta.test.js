// Pruebas de la capa de ingesta: control de acceso a /ingesta/osmand y validación de coordenadas.
// No tocan la base: se prueban las funciones puras exportadas por ingesta.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accesoDirectoPermitido, coordenadaValida } from '../src/ingesta/ingesta.js';

test('con secreto definido se exige la cabecera o el parámetro correctos', () => {
  const opciones = { secreto: 'secreto-largo', remoto: '200.45.1.7' };
  assert.equal(accesoDirectoPermitido({ ...opciones, cabecera: 'secreto-largo' }), true);
  assert.equal(accesoDirectoPermitido({ ...opciones, query: 'secreto-largo' }), true);
  assert.equal(accesoDirectoPermitido({ ...opciones, cabecera: 'otro' }), false);
  assert.equal(accesoDirectoPermitido({ ...opciones }), false);
  // El secreto gana aunque la petición venga de la propia máquina: así se prueba el despliegue real.
  assert.equal(accesoDirectoPermitido({ ...opciones, remoto: '127.0.0.1' }), false);
});

test('sin secreto solo se acepta desde la propia máquina', () => {
  const opciones = { secreto: null, cabecera: null };
  assert.equal(accesoDirectoPermitido({ ...opciones, remoto: '127.0.0.1' }), true);
  assert.equal(accesoDirectoPermitido({ ...opciones, remoto: '::1' }), true);
  assert.equal(accesoDirectoPermitido({ ...opciones, remoto: '::ffff:127.0.0.1' }), true);
  assert.equal(accesoDirectoPermitido({ ...opciones, remoto: '200.45.1.7' }), false);
  assert.equal(accesoDirectoPermitido({ ...opciones, remoto: null }), false);
  // Una IP local falsificada en X-Forwarded-For no basta: se evalúa el socket real (prueba en ingesta.js).
});

test('coordenadaValida acepta coordenadas reales y descarta tramas corruptas', () => {
  assert.equal(coordenadaValida(3.4516, -76.532), true);
  assert.equal(coordenadaValida(-90, 180), true);
  assert.equal(coordenadaValida(90.0001, 0), false);
  assert.equal(coordenadaValida(0, -180.5), false);
  assert.equal(coordenadaValida(NaN, -76), false);
  assert.equal(coordenadaValida(3.45, Infinity), false);
  assert.equal(coordenadaValida(null, null), false);
});
