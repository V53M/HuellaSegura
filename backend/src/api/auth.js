// Inicio y cierre de sesión. La web recibe una cookie HttpOnly; la app móvil, el token en el cuerpo.
import { Router } from 'express';
import { consulta } from '../db/db.js';
import { HASH_RELLENO, LARGO_MINIMO, hashContrasena, verificarContrasena } from '../auth/contrasenas.js';
import { crearLimitador } from '../auth/limite.js';
import { autenticar } from '../auth/middleware.js';
import { cookieSesion, crearSesion, revocarSesion, revocarSesionesDe } from '../auth/sesiones.js';
import { ErrorApi, manejar, origen } from './comunes.js';

export const auth = Router();
const limitador = crearLimitador();

auth.post('/iniciar', manejar(async (req, res) => {
  const correo = String(req.body?.correo ?? '').trim().toLowerCase();
  const contrasena = String(req.body?.contrasena ?? '');
  const cliente = req.body?.cliente === 'MOVIL' ? 'MOVIL' : 'WEB';
  const clave = `${correo}|${req.ip}`;
  const espera = limitador.espera(clave);
  if (espera > 0) {
    res.set('Retry-After', String(espera));
    throw new ErrorApi(429, `Demasiados intentos. Intente de nuevo en ${Math.ceil(espera / 60)} min.`);
  }

  const { rows: [u] } = await consulta(
    `SELECT u.id, u.correo, u.nombre, u.rol, u.fundacion_id, u.adoptante_id, u.hash_contrasena, f.nombre AS fundacion
       FROM usuario u LEFT JOIN fundacion f ON f.id = u.fundacion_id
      WHERE lower(u.correo) = $1 AND u.activo`,
    [correo],
  );
  // Se verifica siempre (aunque el correo no exista) para que el tiempo de respuesta no revele qué correos hay.
  const valida = await verificarContrasena(contrasena, u?.hash_contrasena ?? HASH_RELLENO);
  if (!u || !valida) {
    limitador.fallo(clave);
    throw new ErrorApi(401, 'Correo o contraseña incorrectos');
  }
  // La web es de la fundación y la app es del adoptante.
  if ((cliente === 'WEB') === (u.rol === 'ADOPTANTE')) {
    throw new ErrorApi(403, u.rol === 'ADOPTANTE' ? 'Use la app móvil para ingresar' : 'Ingrese desde la plataforma web');
  }
  limitador.exito(clave);

  const { token, vence } = await crearSesion(u.id, cliente, origen(req));
  const { hash_contrasena, ...usuario } = u;
  if (cliente === 'WEB') {
    res.set('Set-Cookie', cookieSesion(token, vence));
    return { usuario };
  }
  return { usuario, token, vence_en: vence };
}));

auth.post('/salir', autenticar(), manejar(async (req, res) => {
  await revocarSesion(req.usuario.sesion_id);
  res.set('Set-Cookie', cookieSesion('', new Date(0)));
  return { ok: true };
}));

auth.get('/yo', autenticar(), manejar(async (req) => {
  const { rows: [f] } = await consulta(`SELECT nombre FROM fundacion WHERE id = $1`, [req.usuario.fundacion_id]);
  const { sesion_id, ...usuario } = req.usuario;
  return { ...usuario, fundacion: f?.nombre ?? null };
}));

// Cambiar la contraseña (p. ej. la temporal que entregó la fundación). Cierra las demás sesiones.
auth.post('/contrasena', autenticar(), manejar(async (req) => {
  const { actual, nueva } = req.body ?? {};
  const { rows: [u] } = await consulta(`SELECT hash_contrasena FROM usuario WHERE id = $1`, [req.usuario.id]);
  if (!(await verificarContrasena(String(actual ?? ''), u.hash_contrasena))) throw new ErrorApi(401, 'La contraseña actual no es correcta');
  if (typeof nueva !== 'string' || nueva.length < LARGO_MINIMO) {
    throw new ErrorApi(400, `La nueva contraseña debe tener al menos ${LARGO_MINIMO} caracteres`);
  }
  await consulta(`UPDATE usuario SET hash_contrasena = $2 WHERE id = $1`, [req.usuario.id, await hashContrasena(nueva)]);
  await revocarSesionesDe(req.usuario.id, req.usuario.sesion_id);
  return { ok: true };
}));
