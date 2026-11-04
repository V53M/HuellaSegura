// Métricas de latencia y cliente FCM (sin red: fetch simulado).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { latencias, percentil, resumenLatencias } from '../src/notificaciones/metricas.js';
import { ErrorFcm, crearClienteFcm, firmarJwt } from '../src/notificaciones/fcm.js';

test('percentil interpola entre rangos', () => {
  assert.equal(percentil([], 0.5), null);
  assert.equal(percentil([7], 0.95), 7);
  assert.equal(percentil([4, 1, 3, 2], 0.5), 2.5);
  assert.equal(percentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21], 0.95), 20);
  assert.ok(Math.abs(percentil([10, 20], 0.95) - 19.5) < 1e-9);
});

const T = Date.UTC(2027, 1, 1, 12, 0, 0);
const iso = (s) => new Date(T + s * 1000).toISOString();

test('latencias se miden desde el cumplimiento de la condición', () => {
  const l = latencias({ condicion_en: iso(0), creada_en: iso(12), enviada_en: iso(12.5), entregada_en: iso(14), leida_en: null });
  assert.deepEqual(l, { deteccion_s: 12, envio_s: 12.5, entrega_s: 14, lectura_s: null });
});

test('resumenLatencias agrupa por destinatario y tipo, y cuenta las no entregadas', () => {
  const filas = [
    { destinatario: 'FUNDACION', tipo: 'NUEVA', condicion_en: iso(0), creada_en: iso(10), enviada_en: iso(10), entregada_en: iso(11) },
    { destinatario: 'FUNDACION', tipo: 'NUEVA', condicion_en: iso(0), creada_en: iso(5), enviada_en: iso(5), entregada_en: iso(7) },
    { destinatario: 'FUNDACION', tipo: 'NUEVA', condicion_en: iso(0), creada_en: iso(5), enviada_en: iso(5), entregada_en: null },
    { destinatario: 'ADOPTANTE', tipo: 'NUEVA', condicion_en: iso(0), creada_en: iso(5), enviada_en: null, entregada_en: null },
  ];
  const r = resumenLatencias(filas);
  const fund = r.find((g) => g.destinatario === 'FUNDACION');
  assert.equal(fund.total, 3);
  assert.equal(fund.no_entregadas, 1);
  assert.equal(fund.entrega.n, 2);
  assert.equal(fund.entrega.mediana_s, 9);
  assert.equal(fund.entrega.max_s, 11);
  const adop = r.find((g) => g.destinatario === 'ADOPTANTE');
  assert.deepEqual(adop.entrega, { n: 0, mediana_s: null, p95_s: null, max_s: null });
  assert.equal(adop.no_entregadas, 1);
});

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const CRED = {
  project_id: 'huellasegura-piloto',
  client_email: 'fcm@huellasegura-piloto.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  token_uri: 'https://oauth2.googleapis.com/token',
};

test('firmarJwt produce un JWT RS256 verificable con el alcance de FCM', () => {
  const jwt = firmarJwt(CRED, 1_000);
  const [cab, cuerpo, firma] = jwt.split('.');
  assert.ok(createVerify('RSA-SHA256').update(`${cab}.${cuerpo}`).verify(publicKey, firma, 'base64url'));
  const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
  assert.equal(datos.iss, CRED.client_email);
  assert.equal(datos.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  assert.equal(datos.exp - datos.iat, 3600);
});

/** fetch simulado que responde según la URL y guarda las peticiones. */
function fetchFalso(respuestaFcm) {
  const llamadas = [];
  const fetch = async (url, opciones) => {
    llamadas.push({ url, opciones });
    if (url === CRED.token_uri) return { ok: true, status: 200, json: async () => ({ access_token: 'tok-1', expires_in: 3600 }) };
    return respuestaFcm();
  };
  return { fetch, llamadas };
}

test('enviar pide un token de acceso una vez y manda un mensaje de prioridad alta', async () => {
  const { fetch, llamadas } = fetchFalso(() => ({ ok: true, status: 200, json: async () => ({ name: 'projects/x/messages/42' }) }));
  const fcm = crearClienteFcm({ credenciales: CRED, fetch, ahora: () => T });
  assert.equal(fcm.configurado, true);
  const id = await fcm.enviar({ token: 'abc', titulo: 'Hola', cuerpo: 'Mundo', datos: { alerta_id: 7 } });
  await fcm.enviar({ token: 'abc', titulo: 'Hola', cuerpo: 'Mundo' });
  assert.equal(id, 'projects/x/messages/42');
  assert.equal(llamadas.filter((l) => l.url === CRED.token_uri).length, 1); // el token de acceso se reutiliza
  const envio = llamadas.find((l) => l.url.includes('messages:send'));
  assert.equal(envio.url, 'https://fcm.googleapis.com/v1/projects/huellasegura-piloto/messages:send');
  assert.equal(envio.opciones.headers.Authorization, 'Bearer tok-1');
  const { message } = JSON.parse(envio.opciones.body);
  assert.equal(message.android.priority, 'HIGH');
  assert.deepEqual(message.data, { alerta_id: '7' });
});

test('un token desregistrado se reporta como inválido', async () => {
  const { fetch } = fetchFalso(() => ({
    ok: false, status: 404,
    json: async () => ({ error: { status: 'NOT_FOUND', message: 'Requested entity was not found.', details: [{ errorCode: 'UNREGISTERED' }] } }),
  }));
  const fcm = crearClienteFcm({ credenciales: CRED, fetch, ahora: () => T });
  await assert.rejects(fcm.enviar({ token: 'viejo', titulo: 'a', cuerpo: 'b' }), (err) => {
    assert.ok(err instanceof ErrorFcm);
    assert.equal(err.codigo, 'UNREGISTERED');
    assert.equal(err.tokenInvalido, true);
    return true;
  });
});

test('un error temporal de FCM no da de baja el token', async () => {
  const { fetch } = fetchFalso(() => ({ ok: false, status: 503, json: async () => { throw new Error('sin cuerpo'); } }));
  const fcm = crearClienteFcm({ credenciales: CRED, fetch, ahora: () => T });
  await assert.rejects(fcm.enviar({ token: 'abc', titulo: 'a', cuerpo: 'b' }), (err) => err.status === 503 && !err.tokenInvalido);
});

test('OAuth rechazado y FCM sin configurar fallan con un error claro', async () => {
  const fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid_grant' }) });
  await assert.rejects(crearClienteFcm({ credenciales: CRED, fetch }).enviar({ token: 'a' }), /OAuth de Google rechazó/);
  const apagado = crearClienteFcm({ credenciales: null });
  assert.equal(apagado.configurado, false);
  await assert.rejects(apagado.enviar({ token: 'a' }), (err) => err.codigo === 'FCM_NO_CONFIGURADO');
});
