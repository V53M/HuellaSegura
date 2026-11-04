// Contraseñas, límite de intentos y permisos por rol (sin base de datos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HASH_RELLENO, hashContrasena, verificarContrasena } from '../src/auth/contrasenas.js';
import { crearLimitador } from '../src/auth/limite.js';
import { ROLES_FUNDACION, autenticar, exigirRol } from '../src/auth/middleware.js';
import { cookieSesion, tokenDePeticion } from '../src/auth/sesiones.js';

test('la contraseña se guarda con sal y solo valida la correcta', async () => {
  const a = await hashContrasena('perro-luna-2027');
  const b = await hashContrasena('perro-luna-2027');
  assert.notEqual(a, b); // sal distinta
  assert.match(a, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verificarContrasena('perro-luna-2027', a), true);
  assert.equal(await verificarContrasena('perro-luna-2028', a), false);
});

test('contraseñas cortas y hashes mal formados se rechazan', async () => {
  await assert.rejects(hashContrasena('corta'), /al menos 8/);
  await assert.rejects(hashContrasena(undefined), /al menos 8/);
  assert.equal(await verificarContrasena('lo-que-sea', 'texto-plano'), false);
  assert.equal(await verificarContrasena('lo-que-sea', 'scrypt$16384$8$1$c2Fs$Y29ydG8'), false); // hash truncado
  assert.equal(await verificarContrasena(null, HASH_RELLENO), false);
});

test('el limitador bloquea tras 5 fallos y se libera al pasar la ventana', () => {
  let t = 0;
  const l = crearLimitador({ maxFallos: 5, ventanaMs: 60_000, ahora: () => t });
  for (let i = 0; i < 4; i++) l.fallo('ana|1.2.3.4');
  assert.equal(l.espera('ana|1.2.3.4'), 0);
  l.fallo('ana|1.2.3.4');
  assert.equal(l.espera('ana|1.2.3.4'), 60);
  assert.equal(l.espera('otro|1.2.3.4'), 0); // la clave incluye el correo
  t = 30_000;
  assert.equal(l.espera('ana|1.2.3.4'), 30);
  t = 60_001;
  assert.equal(l.espera('ana|1.2.3.4'), 0);
});

test('un inicio de sesión exitoso borra los fallos', () => {
  const l = crearLimitador({ maxFallos: 2, ventanaMs: 60_000, ahora: () => 0 });
  l.fallo('x');
  l.exito('x');
  l.fallo('x');
  assert.equal(l.espera('x'), 0);
});

/** Petición y respuesta mínimas de Express. */
const peticion = (cabeceras = {}) => ({ get: (k) => cabeceras[k] });
function respuesta() {
  const r = { codigo: 200, cuerpo: null };
  r.status = (c) => { r.codigo = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  return r;
}

test('el token se lee de Bearer o de la cookie de sesión', () => {
  assert.equal(tokenDePeticion(peticion({ Authorization: 'Bearer abc' })), 'abc');
  assert.equal(tokenDePeticion(peticion({ Cookie: 'tema=oscuro; hs_sesion=xyz; otra=1' })), 'xyz');
  assert.equal(tokenDePeticion(peticion({ Cookie: 'hs_sesion_falsa=1' })), null);
  assert.equal(tokenDePeticion(peticion({})), null);
});

test('la cookie es HttpOnly y SameSite=Strict; Secure solo con COOKIE_SEGURA=1', () => {
  const c = cookieSesion('tok', new Date(Date.UTC(2027, 0, 1)));
  assert.match(c, /^hs_sesion=tok; Path=\/; HttpOnly; SameSite=Strict; Expires=/);
  assert.doesNotMatch(c, /Secure/);
  process.env.COOKIE_SEGURA = '1';
  assert.match(cookieSesion('', new Date(0)), /Max-Age=0; Secure$/);
  delete process.env.COOKIE_SEGURA;
});

test('autenticar responde 401 sin sesión y carga el usuario con sesión', async () => {
  const buscar = async (token) => (token === 'bueno' ? { id: 1, rol: 'PERSONAL_FUNDACION', fundacion_id: 7 } : null);
  const sin = respuesta();
  let paso = false;
  await autenticar(buscar)(peticion({}), sin, () => { paso = true; });
  assert.equal(sin.codigo, 401);
  assert.equal(paso, false);

  const req = peticion({ Authorization: 'Bearer bueno' });
  await autenticar(buscar)(req, respuesta(), () => { paso = true; });
  assert.equal(paso, true);
  assert.equal(req.usuario.fundacion_id, 7);
});

test('autenticar pasa los errores de la base al manejador de Express', async () => {
  let error = null;
  await autenticar(async () => { throw new Error('bd caída'); })(peticion({ Authorization: 'Bearer x' }), respuesta(), (e) => { error = e; });
  assert.equal(error?.message, 'bd caída');
});

test('exigirRol separa a la fundación del adoptante y al administrador del personal', () => {
  const probar = (rol, ...permitidos) => {
    const res = respuesta();
    let paso = false;
    exigirRol(...permitidos)({ usuario: rol ? { rol } : undefined }, res, () => { paso = true; });
    return paso ? 200 : res.codigo;
  };
  assert.equal(probar('PERSONAL_FUNDACION', ROLES_FUNDACION), 200);
  assert.equal(probar('ADMIN_FUNDACION', ROLES_FUNDACION), 200);
  assert.equal(probar('ADOPTANTE', ROLES_FUNDACION), 403);
  assert.equal(probar('PERSONAL_FUNDACION', 'ADMIN_FUNDACION'), 403);
  assert.equal(probar('ADOPTANTE', 'ADOPTANTE'), 200);
  assert.equal(probar(null, 'ADOPTANTE'), 403);
});
