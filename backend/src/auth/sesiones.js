// Sesiones con token aleatorio. La web lo recibe en una cookie HttpOnly (EventSource no permite cabeceras);
// la app móvil, en el cuerpo de la respuesta, y lo envía como «Authorization: Bearer».
import { createHash, randomBytes } from 'node:crypto';
import { consulta } from '../db/db.js';

export const COOKIE = 'hs_sesion';
const DURACION_MS = { WEB: 12 * 3600_000, MOVIL: 30 * 24 * 3600_000 };

const hashToken = (token) => createHash('sha256').update(token).digest();

export async function crearSesion(usuarioId, cliente, { ip = null, agente = null } = {}) {
  const token = randomBytes(32).toString('base64url');
  const vence = new Date(Date.now() + DURACION_MS[cliente]);
  await consulta(
    `INSERT INTO sesion (usuario_id, token_hash, cliente, vence_en, ip, agente) VALUES ($1, $2, $3, $4, $5, $6)`,
    [usuarioId, hashToken(token), cliente, vence, ip, agente?.slice(0, 300) ?? null],
  );
  await consulta(`UPDATE usuario SET ultimo_acceso = now() WHERE id = $1`, [usuarioId]);
  return { token, vence };
}

/** Usuario dueño de un token vigente, o null. */
export async function usuarioDeToken(token) {
  if (!token) return null;
  const { rows } = await consulta(
    `SELECT u.id, u.correo, u.nombre, u.rol, u.fundacion_id, u.adoptante_id, s.id AS sesion_id, s.cliente
       FROM sesion s JOIN usuario u ON u.id = s.usuario_id
      WHERE s.token_hash = $1 AND s.revocada_en IS NULL AND s.vence_en > now() AND u.activo`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export const revocarSesion = (sesionId) => consulta(`UPDATE sesion SET revocada_en = now() WHERE id = $1`, [sesionId]);

/** Revoca todas las sesiones del usuario, salvo `excepto` (la sesión desde la que se hace el cambio). */
export const revocarSesionesDe = (usuarioId, excepto = null) =>
  consulta(
    `UPDATE sesion SET revocada_en = now() WHERE usuario_id = $1 AND revocada_en IS NULL AND id IS DISTINCT FROM $2`,
    [usuarioId, excepto],
  );

/** Lee el token de la cabecera Authorization o, si no viene, de la cookie. */
export function tokenDePeticion(req) {
  const auth = req.get('Authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim() || null;
  for (const parte of (req.get('Cookie') ?? '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === COOKIE) return decodeURIComponent(parte.slice(i + 1).trim()) || null;
  }
  return null;
}

/** Cabecera Set-Cookie. Secure se activa con COOKIE_SEGURA=1 (producción con HTTPS). */
export function cookieSesion(token, vence) {
  const partes = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  partes.push(token ? `Expires=${vence.toUTCString()}` : 'Max-Age=0');
  if (process.env.COOKIE_SEGURA === '1') partes.push('Secure');
  return partes.join('; ');
}
