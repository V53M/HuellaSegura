// Contraseñas con scrypt (incluido en Node). Formato guardado: scrypt$N$r$p$sal$hash, en base64url.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const LARGO = 64;
export const LARGO_MINIMO = 8;

const derivar = (contrasena, sal, n, r, p) =>
  new Promise((ok, mal) => scrypt(contrasena, sal, LARGO, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? mal(e) : ok(k))));

export async function hashContrasena(contrasena) {
  if (typeof contrasena !== 'string' || contrasena.length < LARGO_MINIMO) {
    throw new Error(`La contraseña debe tener al menos ${LARGO_MINIMO} caracteres`);
  }
  const sal = randomBytes(16);
  const clave = await derivar(contrasena, sal, N, R, P);
  return ['scrypt', N, R, P, sal.toString('base64url'), clave.toString('base64url')].join('$');
}

/** Compara en tiempo constante. Un hash mal formado nunca valida. */
export async function verificarContrasena(contrasena, guardado) {
  const partes = String(guardado ?? '').split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt' || typeof contrasena !== 'string') return false;
  const [, n, r, p, sal, hash] = partes;
  const esperado = Buffer.from(hash, 'base64url');
  if (esperado.length !== LARGO) return false;
  const clave = await derivar(contrasena, Buffer.from(sal, 'base64url'), Number(n), Number(r), Number(p));
  return timingSafeEqual(clave, esperado);
}

/** Hash de relleno: se verifica contra él cuando el correo no existe, para no revelar qué correos están registrados. */
export const HASH_RELLENO = await hashContrasena(randomBytes(12).toString('hex'));
