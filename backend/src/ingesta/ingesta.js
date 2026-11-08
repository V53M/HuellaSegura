// Endpoints de ingesta (contexto del proyecto, §7.2).
// - /ingesta/posiciones y /ingesta/eventos: reenvío JSON de Traccar (forward.url / event.forward.url).
// - /ingesta/osmand: mismos parámetros que el protocolo OsmAnd de Traccar (:5055), para que el simulador
//   funcione sin Traccar en desarrollo. Se desactiva con INGESTA_DIRECTA=0.
import { Router } from 'express';
import { consulta } from '../db/db.js';
import { asignacionDe, procesarConexion, procesarPosicion } from '../motor/servicio.js';

export const ingesta = Router();

const EVENTOS_CONEXION = new Set(['deviceOnline', 'deviceOffline', 'deviceUnknown']);

let avisoSecreto = false;

/** Traccar solo puede reenviar con el secreto configurado; si falta, avisamos en el log (503) en vez de un 401 mudo. */
function exigirSecreto(req, res, next) {
  const secreto = process.env.TRACCAR_SECRET;
  if (!secreto) {
    if (!avisoSecreto) {
      console.error('[ingesta] TRACCAR_SECRET no está definido: se rechazan las posiciones de Traccar (configúrelo en backend/.env)');
      avisoSecreto = true;
    }
    return res.status(503).send('TRACCAR_SECRET no configurado');
  }
  if (req.get('X-Traccar-Secret') !== secreto) return res.status(401).end();
  next();
}

/**
 * Ingesta directa OsmAnd (simulador / Traccar Client sin Traccar en medio).
 * Si INGESTA_SECRET está definido se exige; si no, solo se acepta desde la propia máquina
 * (cualquier host remoto podría inyectar posiciones falsas conociendo el uid del collar).
 */
export function accesoDirectoPermitido({ secreto = process.env.INGESTA_SECRET, cabecera = null, query = null, remoto = null } = {}) {
  if (secreto) return cabecera === secreto || query === secreto;
  return esLocal(remoto);
}

const esLocal = (ip) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

/** Rangos válidos: descarta tramas corruptas antes de tocar la base. */
export function coordenadaValida(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/** Inserta una posición de forma idempotente. Devuelve el id si la fila es nueva; null si ya existía. */
export async function insertarPosicion(p) {
  const { rows } = await consulta(
    `INSERT INTO posicion (traccar_position_id, dispositivo_uid, fix_time, server_time, lat, lon, geom,
                           precision_m, satelites, velocidad_kn, bateria_pct, valida, atributos)
     VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography, $7, $8, $9, $10, $11, $12)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      p.traccarId ?? null, p.uid, p.fixTime, p.serverTime, p.lat, p.lon,
      p.precision ?? null, p.satelites ?? null, p.velocidadKn ?? null, p.bateria ?? null, p.valida, p.atributos ?? null,
    ],
  );
  return rows[0]?.id ?? null;
}

/**
 * Ley 1581: si el collar está asignado a una adopción cuyo adoptante no tiene consentimiento vigente,
 * la posición no se guarda. Un collar sin asignar (medición del error) sí se guarda: no hay datos de nadie.
 */
async function sinConsentimiento(uid, t) {
  const { adopcionId, consentido } = await asignacionDe(uid, new Date(t).getTime());
  return adopcionId != null && !consentido;
}

const procesarDespues = (fn) => setImmediate(() => fn().catch((err) => console.error('[motor]', err)));

async function existeDispositivo(uid) {
  const { rowCount } = await consulta(`SELECT 1 FROM dispositivo WHERE dispositivo_uid = $1 AND activo`, [uid]);
  return rowCount > 0;
}

ingesta.post('/posiciones', exigirSecreto, async (req, res) => {
  const { position, device } = req.body ?? {};
  if (!position || !device?.uniqueId) return res.status(400).end();
  if (!coordenadaValida(position.latitude, position.longitude)) return res.status(400).send('coordenadas inválidas');
  try {
    // Un collar no registrado se ignora con 200: si respondiéramos error, Traccar reintentaría para siempre.
    if (!(await existeDispositivo(device.uniqueId))) return res.status(200).json({ ignorada: true });
    if (await sinConsentimiento(device.uniqueId, position.fixTime)) return res.status(200).json({ ignorada: true, motivo: 'SIN_CONSENTIMIENTO' });
    const a = position.attributes ?? {};
    const id = await insertarPosicion({
      traccarId: position.id,
      uid: device.uniqueId,
      fixTime: position.fixTime,
      serverTime: position.serverTime ?? new Date(),
      lat: position.latitude,
      lon: position.longitude,
      precision: position.accuracy > 0 ? position.accuracy : null,
      satelites: a.sat,
      velocidadKn: position.speed,
      bateria: a.batteryLevel,
      valida: position.valid !== false,
      atributos: a,
    });
    res.status(200).json({ nueva: id != null });
    if (id) procesarDespues(() => procesarPosicion(device.uniqueId, id));
  } catch (err) {
    console.error('[ingesta]', err);
    res.status(500).end(); // Traccar reintenta
  }
});

ingesta.post('/eventos', exigirSecreto, async (req, res) => {
  const { event, device } = req.body ?? {};
  if (!event || !device?.uniqueId) return res.status(400).end();
  if (!EVENTOS_CONEXION.has(event.type)) return res.status(200).json({ ignorado: true });
  try {
    if (!(await existeDispositivo(device.uniqueId))) return res.status(200).json({ ignorado: true });
    const ocurrido = event.eventTime ? new Date(event.eventTime) : new Date();
    await consulta(
      `INSERT INTO evento_conexion (traccar_event_id, dispositivo_uid, tipo, ocurrido_en) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [event.id ?? null, device.uniqueId, event.type, ocurrido],
    );
    res.status(200).end();
    procesarDespues(() => procesarConexion(device.uniqueId, event.type, ocurrido.getTime()));
  } catch (err) {
    console.error('[ingesta]', err);
    res.status(500).end();
  }
});

// OsmAnd: ?id=<uid>&lat=..&lon=..&timestamp=<epoch s o ISO>&accuracy=..&batt=..&speed=..&valid=..
ingesta.all('/osmand', async (req, res) => {
  if (process.env.INGESTA_DIRECTA === '0') return res.status(404).end();
  const q = { ...req.query, ...(typeof req.body === 'object' ? req.body : {}) };
  const lat = Number(q.lat);
  const lon = Number(q.lon);
  if (!q.id || !Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).send('faltan id, lat o lon');
  if (!coordenadaValida(lat, lon)) return res.status(400).send('coordenadas inválidas');
  // El socket (no req.ip, que se falsifica con X-Forwarded-For) decide si viene de la propia máquina.
  const remoto = req.socket?.remoteAddress ?? req.ip;
  if (!accesoDirectoPermitido({ cabecera: req.get('X-Ingesta-Secret'), query: q.secreto, remoto })) {
    return res.status(401).send('secreto de ingesta ausente o inválido');
  }
  try {
    if (!(await existeDispositivo(q.id))) return res.status(404).send('dispositivo no registrado');
    const ts = q.timestamp ? (/^\d+$/.test(q.timestamp) ? new Date(Number(q.timestamp) * 1000) : new Date(q.timestamp)) : new Date();
    if (await sinConsentimiento(q.id, ts)) return res.status(200).send('ignorada: sin consentimiento');
    const id = await insertarPosicion({
      uid: q.id,
      fixTime: ts,
      serverTime: new Date(),
      lat,
      lon,
      precision: q.accuracy ? Number(q.accuracy) : null,
      velocidadKn: q.speed ? Number(q.speed) : null,
      bateria: q.batt ? Number(q.batt) : null,
      valida: q.valid !== 'false',
      atributos: { origen: 'osmand-directo' },
    });
    res.status(200).end();
    if (id) procesarDespues(() => procesarPosicion(q.id, id));
  } catch (err) {
    console.error('[ingesta]', err);
    res.status(500).end();
  }
});
