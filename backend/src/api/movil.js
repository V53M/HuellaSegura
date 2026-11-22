// API de la app móvil del adoptante (Authorization: Bearer). El adoptante solo ve sus propias adopciones.
import { Router } from 'express';
import { consulta } from '../db/db.js';
import { autenticar, exigirRol } from '../auth/middleware.js';
import { POLITICA } from '../auth/politica.js';
import { SQL_CONSENTIDO, registrarYAvisar, revocarConsentimiento } from '../auth/consentimiento.js';
import { acusarNotificacion, declararExcepcion, responderAlerta } from './acciones.js';
import { ErrorApi, manejar, origen } from './comunes.js';

export const movil = Router();
movil.use(autenticar(), exigirRol('ADOPTANTE'));
const aid = (req) => req.usuario.adoptante_id;

// Lo que ve el adoptante: su animal, si está en casa y si hay algo que responder.
// No se le muestra la bitácora ni las verificaciones de la fundación.
movil.get('/adopciones', manejar(async (req) => {
  const { rows } = await consulta(
    `SELECT a.id AS adopcion_id, an.nombre AS animal, an.especie, f.nombre AS fundacion,
            e.estado, e.desde AS estado_desde, e.ultimo_reporte,
            ST_Y(z.centro::geometry) AS zona_lat, ST_X(z.centro::geometry) AS zona_lon, z.radio_m,
            p.lat, p.lon, p.fix_time, p.bateria_pct,
            (SELECT json_build_object('motivo', x.motivo, 'inicio', x.inicio, 'fin', x.fin)
               FROM excepcion x WHERE x.adopcion_id = a.id AND x.inicio <= now() AND x.fin > now()
              ORDER BY x.fin DESC LIMIT 1) AS excepcion_vigente,
            (SELECT json_build_object('id', al.id, 'creada_en', al.creada_en, 'fuera_desde', al.fuera_desde,
                                      'respondida_en', al.respondida_en, 'escalada_en', al.escalada_en)
               FROM alerta al WHERE al.adopcion_id = a.id AND al.resuelta_en IS NULL
              ORDER BY al.creada_en DESC LIMIT 1) AS alerta_abierta,
            ${SQL_CONSENTIDO} AS consentimiento_vigente
       FROM adopcion a
       JOIN animal an ON an.id = a.animal_id
       JOIN fundacion f ON f.id = a.fundacion_id
       LEFT JOIN zona_segura z ON z.adopcion_id = a.id
       LEFT JOIN estado_seguimiento e ON e.adopcion_id = a.id
       LEFT JOIN posicion p ON p.id = e.ultima_posicion_id
      WHERE a.adoptante_id = $1 AND a.activa
      ORDER BY an.nombre`,
    [aid(req)],
  );
  return rows;
}));

async function adopcionPropia(req, id) {
  const { rows } = await consulta(`SELECT id FROM adopcion WHERE id = $1 AND adoptante_id = $2 AND activa`, [id, aid(req)]);
  if (!rows[0]) throw new ErrorApi(404, 'Adopción no encontrada');
  return rows[0].id;
}

movil.post('/adopciones/:id/excepciones', manejar(async (req) => declararExcepcion(await adopcionPropia(req, req.params.id), req.body)));

movil.post('/alertas/:id/responder', manejar(async (req) => {
  const { rows: [alerta] } = await consulta(
    `SELECT al.* FROM alerta al JOIN adopcion a ON a.id = al.adopcion_id WHERE al.id = $1 AND a.adoptante_id = $2`,
    [req.params.id, aid(req)],
  );
  if (!alerta) throw new ErrorApi(404, 'Alerta no encontrada');
  await responderAlerta(alerta, req.body?.respuesta);
  return { ok: true };
}));

// ---------- Consentimiento (Ley 1581) ----------

movil.get('/consentimiento', manejar(async (req) => {
  const { rows } = await consulta(
    `SELECT id, version_politica, medio, aceptado_en, revocado_en FROM consentimiento
      WHERE adoptante_id = $1 ORDER BY aceptado_en DESC`,
    [aid(req)],
  );
  const vigente = rows.find((c) => !c.revocado_en) ?? null;
  return { politica: POLITICA, vigente, al_dia: vigente?.version_politica === POLITICA.version, historial: rows };
}));

movil.post('/consentimiento', manejar(async (req) => {
  if (req.body?.version !== POLITICA.version) throw new ErrorApi(409, `La política vigente es la versión ${POLITICA.version}`);
  const { ip, agente } = origen(req);
  return registrarYAvisar({ adoptanteId: aid(req), medio: 'APP', evidencia: `ip=${ip}; agente=${agente}`, registradoPor: req.usuario.id });
}));

// Revocar detiene el seguimiento de inmediato: el motor deja de procesar y no se guardan nuevas posiciones.
movil.delete('/consentimiento', manejar(async (req) => ({
  revocados: await revocarConsentimiento(aid(req), req.body?.motivo?.trim() || 'Revocado por el adoptante desde la app'),
})));

// ---------- Push y acuses ----------

movil.post('/tokens', manejar(async (req) => {
  const token = req.body?.token?.trim();
  if (!token || token.length > 4096) throw new ErrorApi(400, 'Token inválido');
  const plataforma = req.body?.plataforma ?? 'ANDROID';
  if (!['ANDROID', 'WEB'].includes(plataforma)) throw new ErrorApi(400, 'Plataforma inválida (ANDROID o WEB)');
  const { rows: [t] } = await consulta(
    `INSERT INTO token_push (adoptante_id, token, plataforma) VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET adoptante_id = EXCLUDED.adoptante_id, plataforma = EXCLUDED.plataforma,
       activo = TRUE, desactivado_en = NULL, motivo_baja = NULL, registrado_en = now()
     RETURNING id, plataforma, registrado_en`,
    [aid(req), token, plataforma],
  );
  return t;
}));

async function notificacionPropia(req, id) {
  const { rows } = await consulta(
    `SELECT n.id FROM notificacion n
       JOIN alerta al ON al.id = n.alerta_id JOIN adopcion a ON a.id = al.adopcion_id
      WHERE n.id = $1 AND a.adoptante_id = $2 AND n.destinatario = 'ADOPTANTE'`,
    [id, aid(req)],
  );
  if (!rows[0]) throw new ErrorApi(404, 'Notificación no encontrada');
  return rows[0].id;
}

movil.post('/notificaciones/:id/entregada', manejar(async (req) => acusarNotificacion(await notificacionPropia(req, req.params.id))));
movil.post('/notificaciones/:id/leida', manejar(async (req) =>
  acusarNotificacion(await notificacionPropia(req, req.params.id), { leida: true })));
