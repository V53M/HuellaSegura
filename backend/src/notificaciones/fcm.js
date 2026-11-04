// Cliente mínimo de Firebase Cloud Messaging (API HTTP v1), sin dependencias.
// Se autentica con la cuenta de servicio del proyecto de Firebase: FCM_CREDENCIALES apunta a su archivo JSON.
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const ALCANCE = 'https://www.googleapis.com/auth/firebase.messaging';

export class ErrorFcm extends Error {
  constructor(mensaje, { codigo = null, status = null } = {}) {
    super(mensaje);
    this.codigo = codigo; // p. ej. UNREGISTERED o INVALID_ARGUMENT
    this.status = status;
  }

  /** El token ya no sirve (app desinstalada o token vencido): hay que darlo de baja. */
  get tokenInvalido() {
    return this.codigo === 'UNREGISTERED' || (this.codigo === 'INVALID_ARGUMENT' && this.status === 400);
  }
}

const base64url = (texto) => Buffer.from(texto).toString('base64url');

/** JWT firmado con RS256 que se cambia por un token de acceso de Google (OAuth 2.0, cuenta de servicio). */
export function firmarJwt(credenciales, ahoraS = Math.floor(Date.now() / 1000)) {
  const cabecera = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const cuerpo = base64url(JSON.stringify({
    iss: credenciales.client_email,
    scope: ALCANCE,
    aud: credenciales.token_uri,
    iat: ahoraS,
    exp: ahoraS + 3600,
  }));
  const firma = createSign('RSA-SHA256').update(`${cabecera}.${cuerpo}`).sign(credenciales.private_key, 'base64url');
  return `${cabecera}.${cuerpo}.${firma}`;
}

/** Convierte todos los valores a texto: FCM solo acepta strings en `data`. */
const comoTexto = (datos) => Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, String(v)]));

/**
 * @param {object} opciones
 * @param {object|null} opciones.credenciales  contenido del JSON de la cuenta de servicio (null = FCM apagado)
 * @param {Function} [opciones.fetch]           inyectable para las pruebas
 * @param {Function} [opciones.ahora]           reloj en ms, inyectable para las pruebas
 */
export function crearClienteFcm({ credenciales, fetch = globalThis.fetch, ahora = Date.now } = {}) {
  let acceso = null; // { token, vence }

  async function tokenDeAcceso() {
    if (acceso && acceso.vence - 60_000 > ahora()) return acceso.token;
    const r = await fetch(credenciales.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: firmarJwt(credenciales, Math.floor(ahora() / 1000)),
      }),
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok || !datos.access_token) throw new ErrorFcm(`OAuth de Google rechazó la cuenta de servicio (${r.status})`, { status: r.status });
    acceso = { token: datos.access_token, vence: ahora() + (datos.expires_in ?? 3600) * 1000 };
    return acceso.token;
  }

  return {
    configurado: credenciales != null,

    /** Envía una notificación a un teléfono. Devuelve el id del mensaje en FCM. */
    async enviar({ token, titulo, cuerpo, datos = {} }) {
      if (!credenciales) throw new ErrorFcm('FCM no está configurado', { codigo: 'FCM_NO_CONFIGURADO' });
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${credenciales.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await tokenDeAcceso()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: titulo, body: cuerpo },
            data: comoTexto(datos),
            // Prioridad alta: la alerta debe despertar el teléfono aunque esté en reposo.
            android: { priority: 'HIGH', notification: { channel_id: 'alertas' } },
          },
        }),
      });
      const respuesta = await r.json().catch(() => ({}));
      if (!r.ok) {
        const codigo = respuesta.error?.details?.find((d) => d.errorCode)?.errorCode ?? respuesta.error?.status ?? null;
        throw new ErrorFcm(respuesta.error?.message ?? `FCM respondió ${r.status}`, { codigo, status: r.status });
      }
      return respuesta.name;
    },
  };
}

/** Cliente a partir de las variables de entorno. Sin FCM_CREDENCIALES, las notificaciones push quedan registradas como no enviadas. */
export function clienteFcmDesdeEntorno() {
  const ruta = process.env.FCM_CREDENCIALES;
  if (!ruta) return crearClienteFcm({ credenciales: null });
  return crearClienteFcm({ credenciales: JSON.parse(readFileSync(ruta, 'utf8')) });
}
