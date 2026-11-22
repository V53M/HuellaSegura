// Pruebas de integración de permisos y consentimiento contra una base PostGIS real.
//   npm run test:integracion      (necesita la base de docker compose con las migraciones aplicadas)
// Crea sus propias fundaciones y cuentas con un sufijo aleatorio, así que no toca los datos de la semilla.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { app } from '../../src/app.js';
import { pool } from '../../src/db/db.js';
import { hashContrasena } from '../../src/auth/contrasenas.js';
import { POLITICA } from '../../src/auth/politica.js';

const S = randomBytes(4).toString('hex');
const CLAVE = 'clave-de-prueba-123';
const correo = (quien) => `${quien}-${S}@pruebas.huellasegura.co`;
let servidor;
let base;
const datos = {};

/** Cliente HTTP con su propia cookie de sesión o token Bearer. */
function cliente() {
  let cookie = null;
  let bearer = null;
  const pedir = async (metodo, ruta, cuerpo, { formulario = false } = {}) => {
    const cabeceras = {};
    if (cookie) cabeceras.Cookie = cookie;
    if (bearer) cabeceras.Authorization = `Bearer ${bearer}`;
    if (cuerpo && !formulario) cabeceras['Content-Type'] = 'application/json';
    const r = await fetch(`${base}${ruta}`, { method: metodo, headers: cabeceras, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? null : sc.split(';')[0];
    const tipo = r.headers.get('content-type') ?? '';
    return { status: r.status, cuerpo: tipo.includes('json') ? await r.json() : await r.text() };
  };
  return {
    pedir,
    get: (r) => pedir('GET', r),
    post: (r, b) => pedir('POST', r, b ?? {}),
    put: (r, b) => pedir('PUT', r, b),
    delete: (r, b) => pedir('DELETE', r, b ?? {}),
    async iniciar(c, cliente = 'WEB') {
      const r = await pedir('POST', '/api/auth/iniciar', { correo: c, contrasena: CLAVE, cliente });
      if (r.cuerpo?.token) bearer = r.cuerpo.token;
      return r;
    },
  };
}

async function fundacion(nombre) {
  const { rows: [f] } = await pool.query(`INSERT INTO fundacion (nombre) VALUES ($1) RETURNING id`, [nombre]);
  await pool.query(`INSERT INTO parametros_fundacion (fundacion_id) VALUES ($1)`, [f.id]);
  return f.id;
}

async function usuario(c, rol, fundacionId) {
  await pool.query(
    `INSERT INTO usuario (correo, nombre, rol, fundacion_id, hash_contrasena) VALUES ($1, $1, $2, $3, $4)`,
    [c, rol, fundacionId, await hashContrasena(CLAVE)],
  );
}

const nuevaAdopcion = (uid, consentimiento) => ({
  animal: { nombre: `Prueba ${S}`, especie: 'PERRO', peso_kg: 10 },
  adoptante: { nombre: `Adoptante ${S}`, telefono: '300', direccion: 'Cali' },
  dispositivo_uid: uid,
  zona: { lat: 3.45, lon: -76.53, radio_m: 100 },
  consentimiento,
});

const posicionesDe = async (uid) =>
  Number((await pool.query(`SELECT count(*) FROM posicion WHERE dispositivo_uid = $1`, [uid])).rows[0].count);
const enviarPosicion = (uid, segundos) =>
  fetch(`${base}/ingesta/osmand?id=${uid}&lat=3.45&lon=-76.53&timestamp=${Math.floor(Date.now() / 1000) + segundos}`, { method: 'POST' });

before(async () => {
  servidor = app.listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;
  datos.fA = await fundacion(`Fundación A ${S}`);
  datos.fB = await fundacion(`Fundación B ${S}`);
  await usuario(correo('admin-a'), 'ADMIN_FUNDACION', datos.fA);
  await usuario(correo('personal-a'), 'PERSONAL_FUNDACION', datos.fA);
  await usuario(correo('admin-b'), 'ADMIN_FUNDACION', datos.fB);
});

after(async () => {
  await new Promise((r) => setTimeout(r, 500)); // deja terminar el motor, que procesa las posiciones en segundo plano
  servidor.close();
  await pool.end();
});

test('sin sesión la API responde 401', async () => {
  const r = await cliente().get('/api/seguimiento');
  assert.equal(r.status, 401);
  assert.equal((await cliente().get('/api/movil/adopciones')).status, 401);
});

test('inicio de sesión: contraseña errada, rol en el cliente equivocado y límite de intentos', async () => {
  const c = cliente();
  const mal = await c.pedir('POST', '/api/auth/iniciar', { correo: correo('admin-b'), contrasena: 'no-es-esta', cliente: 'WEB' });
  assert.equal(mal.status, 401);
  const noExiste = await c.pedir('POST', '/api/auth/iniciar', { correo: correo('nadie'), contrasena: 'no-es-esta', cliente: 'WEB' });
  assert.equal(noExiste.status, 401);
  assert.equal(noExiste.cuerpo.error, mal.cuerpo.error); // no revela qué correos existen
  assert.equal((await cliente().iniciar(correo('personal-a'), 'MOVIL')).status, 403);

  for (let i = 0; i < 5; i++) await c.pedir('POST', '/api/auth/iniciar', { correo: correo('bloqueado'), contrasena: 'x', cliente: 'WEB' });
  const bloqueado = await c.pedir('POST', '/api/auth/iniciar', { correo: correo('bloqueado'), contrasena: 'x', cliente: 'WEB' });
  assert.equal(bloqueado.status, 429);
});

test('una adopción no se registra sin la autorización firmada', async () => {
  const personal = cliente();
  assert.equal((await personal.iniciar(correo('personal-a'))).status, 200);
  const sin = await personal.post('/api/adopciones', nuevaAdopcion(null, {}));
  assert.equal(sin.status, 400);
  const vieja = await personal.post('/api/adopciones', nuevaAdopcion(null, { firmado: true, version: 'vieja' }));
  assert.equal(vieja.status, 409);
  const ok = await personal.post('/api/adopciones', nuevaAdopcion(`col-${S}`, { firmado: true, version: POLITICA.version, evidencia: 'Formato 001' }));
  assert.equal(ok.status, 200);
  datos.adopcionA = ok.cuerpo.adopcion_id;
  const cons = await personal.get(`/api/adopciones/${datos.adopcionA}/consentimiento`);
  assert.equal(cons.cuerpo.consentimientos[0].medio, 'FORMATO_FIRMADO');
  assert.equal(cons.cuerpo.consentimientos[0].evidencia, 'Formato 001');
});

test('una fundación no ve ni modifica los datos de otra', async () => {
  const b = cliente();
  await b.iniciar(correo('admin-b'));
  assert.equal((await b.get(`/api/adopciones/${datos.adopcionA}`)).status, 404);
  assert.equal((await b.put(`/api/adopciones/${datos.adopcionA}/zona`, { lat: 3, lon: -76, radio_m: 100 })).status, 404);
  assert.equal((await b.post(`/api/adopciones/${datos.adopcionA}/excepciones`, { motivo: 'PASEO', duracion_min: 5 })).status, 404);
  assert.equal((await b.get(`/api/adopciones/${datos.adopcionA}/consentimiento`)).status, 404);
  const seg = await b.get('/api/seguimiento');
  assert.ok(seg.cuerpo.every((s) => s.adopcion_id !== datos.adopcionA));
});

test('solo el administrador cambia parámetros y crea usuarios', async () => {
  const personal = cliente();
  await personal.iniciar(correo('personal-a'));
  const params = (await personal.get('/api/parametros')).cuerpo;
  assert.equal((await personal.put('/api/parametros', params)).status, 403);
  assert.equal((await personal.get('/api/usuarios')).status, 403);
  const admin = cliente();
  await admin.iniciar(correo('admin-a'));
  assert.equal((await admin.put('/api/parametros', params)).status, 200);
  const nuevo = await admin.post('/api/usuarios', { correo: correo('nuevo'), nombre: 'Nuevo', rol: 'PERSONAL_FUNDACION', contrasena: CLAVE });
  assert.equal(nuevo.status, 200);
  assert.equal((await admin.post('/api/usuarios', { correo: correo('nuevo'), nombre: 'Otro', rol: 'PERSONAL_FUNDACION', contrasena: CLAVE })).status, 409);
  const usuarios = (await admin.get('/api/usuarios')).cuerpo;
  assert.ok(usuarios.every((u) => !('hash_contrasena' in u)));
});

test('el adoptante entra solo por la app y solo ve lo suyo', async () => {
  const personal = cliente();
  await personal.iniciar(correo('personal-a'));
  const acceso = await personal.post(`/api/adopciones/${datos.adopcionA}/acceso`, { correo: correo('adoptante'), contrasena: CLAVE });
  assert.equal(acceso.status, 200);

  assert.equal((await cliente().iniciar(correo('adoptante'), 'WEB')).status, 403);
  const app = cliente();
  const r = await app.iniciar(correo('adoptante'), 'MOVIL');
  assert.equal(r.status, 200);
  assert.ok(r.cuerpo.token);
  const propias = await app.get('/api/movil/adopciones');
  assert.deepEqual(propias.cuerpo.map((a) => a.adopcion_id), [datos.adopcionA]);
  assert.equal(propias.cuerpo[0].consentimiento_vigente, true);
  assert.equal((await app.get('/api/seguimiento')).status, 403);
  assert.equal((await app.post('/api/movil/adopciones/999999999/excepciones', { motivo: 'PASEO', duracion_min: 5 })).status, 404);
  assert.equal((await app.post(`/api/movil/adopciones/${datos.adopcionA}/excepciones`, { motivo: 'PASEO', duracion_min: 5 })).status, 200);
  datos.app = app;
});

test('sin consentimiento vigente no se guardan posiciones; al aceptarlo de nuevo, sí', async () => {
  const uid = `col-${S}`;
  const antes = await posicionesDe(uid);
  await enviarPosicion(uid, 1);
  assert.equal(await posicionesDe(uid), antes + 1);

  const rev = await datos.app.delete('/api/movil/consentimiento', { motivo: 'prueba' });
  assert.equal(rev.cuerpo.revocados, 1);
  const estado = await datos.app.get('/api/movil/consentimiento');
  assert.equal(estado.cuerpo.vigente, null);
  await enviarPosicion(uid, 2);
  assert.equal(await posicionesDe(uid), antes + 1);

  assert.equal((await datos.app.post('/api/movil/consentimiento', { version: 'otra' })).status, 409);
  assert.equal((await datos.app.post('/api/movil/consentimiento', { version: POLITICA.version })).status, 200);
  await enviarPosicion(uid, 3);
  assert.equal(await posicionesDe(uid), antes + 2);
  const { rows: [c] } = await pool.query(
    `SELECT medio, evidencia FROM consentimiento c JOIN adopcion a ON a.adoptante_id = c.adoptante_id
      WHERE a.id = $1 AND c.revocado_en IS NULL`,
    [datos.adopcionA],
  );
  assert.equal(c.medio, 'APP');
  assert.match(c.evidencia, /^ip=/);
});

test('cerrar sesión invalida el token', async () => {
  assert.equal((await datos.app.post('/api/auth/salir')).status, 200);
  assert.equal((await datos.app.get('/api/movil/adopciones')).status, 401);
});
