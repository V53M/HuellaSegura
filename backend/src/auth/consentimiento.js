// Consentimiento del adoptante (Ley 1581 de 2012). Sin uno vigente, el seguimiento de sus adopciones se detiene.
import { consulta } from '../db/db.js';
import { bus } from '../eventos.js';
import { POLITICA } from './politica.js';

/** Fundaciones con adopciones activas de este adoptante, para avisar a sus plataformas del cambio. */
async function avisar(adoptanteId) {
  const { rows } = await consulta(
    `SELECT id, fundacion_id FROM adopcion WHERE adoptante_id = $1 AND activa`,
    [adoptanteId],
  );
  for (const a of rows) bus.emit('seguimiento', { adopcionId: a.id, fundacionId: a.fundacion_id, consentimiento: true });
}

/** Registra un consentimiento nuevo. Si ya hay uno vigente de la misma versión, lo devuelve sin duplicarlo. */
export async function registrarConsentimiento(cliente, { adoptanteId, medio, evidencia = null, registradoPor = null }) {
  const { rows: [vigente] } = await cliente.query(
    `SELECT * FROM consentimiento WHERE adoptante_id = $1 AND revocado_en IS NULL AND version_politica = $2 LIMIT 1`,
    [adoptanteId, POLITICA.version],
  );
  if (vigente) return vigente;
  const { rows: [c] } = await cliente.query(
    `INSERT INTO consentimiento (adoptante_id, version_politica, medio, evidencia, registrado_por)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [adoptanteId, POLITICA.version, medio, evidencia?.slice(0, 500) ?? null, registradoPor],
  );
  return c;
}

export async function registrarYAvisar(datos) {
  const c = await registrarConsentimiento({ query: consulta }, datos);
  await avisar(datos.adoptanteId);
  return c;
}

/** Revoca todos los consentimientos vigentes del adoptante. Devuelve cuántos revocó. */
export async function revocarConsentimiento(adoptanteId, motivo) {
  const { rowCount } = await consulta(
    `UPDATE consentimiento SET revocado_en = now(), motivo_revocacion = $2 WHERE adoptante_id = $1 AND revocado_en IS NULL`,
    [adoptanteId, motivo?.slice(0, 500) || null],
  );
  await avisar(adoptanteId);
  return rowCount;
}

/** Fragmento SQL: ¿el adoptante de la adopción `a` tiene consentimiento vigente? */
export const SQL_CONSENTIDO = `EXISTS (SELECT 1 FROM consentimiento c WHERE c.adoptante_id = a.adoptante_id AND c.revocado_en IS NULL)`;
