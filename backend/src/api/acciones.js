// Acciones sobre una adopción que pueden venir de la fundación (registradas por teléfono) o de la app del adoptante.
// Quien llama ya verificó que la adopción o la alerta le pertenecen.
import { consulta } from '../db/db.js';
import { eventoManual } from '../motor/servicio.js';
import { ErrorApi, numero } from './comunes.js';
import { latencias } from '../notificaciones/metricas.js';

const MOTIVOS = new Set(['PASEO', 'VETERINARIA', 'VIAJE']);
const VERIFICACIONES = new Set(['VERDADERA', 'SALIDA_LEGITIMA', 'ERROR_POSICION']);

export async function declararExcepcion(adopcionId, cuerpo) {
  const motivo = cuerpo?.motivo;
  if (!MOTIVOS.has(motivo)) throw new ErrorApi(400, 'Motivo inválido (PASEO, VETERINARIA o VIAJE)');
  const duracion = numero(cuerpo?.duracion_min, 'duracion_min', { min: 1, max: 60 * 24 * 14 }); // acotada: máx. 14 días
  const { rows: [exc] } = await consulta(
    `INSERT INTO excepcion (adopcion_id, motivo, inicio, fin) VALUES ($1, $2, now(), now() + make_interval(mins => $3)) RETURNING *`,
    [adopcionId, motivo, duracion],
  );
  await eventoManual(adopcionId, 'EXCEPCION');
  return exc;
}

export async function responderAlerta(alerta, respuesta) {
  if (alerta.resuelta_en) throw new ErrorApi(409, 'La alerta ya está resuelta');
  if (alerta.escalada_en) throw new ErrorApi(409, 'El caso ya fue escalado: lo cierra la fundación');
  await consulta(`UPDATE alerta SET respondida_en = now(), respuesta = $2 WHERE id = $1`, [alerta.id, respuesta?.trim() || null]);
  await eventoManual(alerta.adopcion_id, 'RESPUESTA_ADOPTANTE');
}

export async function cerrarAlerta(alerta, verificacion) {
  if (verificacion && !VERIFICACIONES.has(verificacion)) throw new ErrorApi(400, 'Resultado de verificación inválido');
  if (verificacion) await consulta(`UPDATE alerta SET resultado_verificacion = $2 WHERE id = $1`, [alerta.id, verificacion]);
  if (!alerta.resuelta_en) await eventoManual(alerta.adopcion_id, 'CIERRE_FUNDACION');
}

/**
 * Acuse de una notificación (web o app). Se marca con la hora del servidor y solo la primera vez:
 * incluye el viaje del acuse, así que la latencia medida es una cota superior.
 */
export async function acusarNotificacion(id, { leida = false } = {}) {
  const { rows } = await consulta(
    `UPDATE notificacion SET entregada_en = COALESCE(entregada_en, now())
            ${leida ? ', leida_en = COALESCE(leida_en, now())' : ''}
      WHERE id = $1 RETURNING id, condicion_en, creada_en, enviada_en, entregada_en, leida_en`,
    [id],
  );
  return { ...rows[0], ...latencias(rows[0]) };
}
