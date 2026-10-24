// API REST para la plataforma web (v1).
// Pendiente: autenticación y roles (Ley 1581). Por ahora toda la API actúa como la fundación FUNDACION_ID.
import { Router } from 'express';
import { consulta, enTransaccion } from '../db/db.js';
import { bus } from '../eventos.js';
import { eventoManual } from '../motor/servicio.js';

export const api = Router();
const FUNDACION_ID = Number(process.env.FUNDACION_ID ?? 1);

// Regla de bienestar (§8.3): collar + soporte + rastreador ≤ 2 % del peso del animal.
const MASA_COLLAR_G = 71;
export const PESO_MINIMO_KG = MASA_COLLAR_G / 0.02 / 1000;

const MOTIVOS = new Set(['PASEO', 'VETERINARIA', 'VIAJE']);
const ESPECIES = new Set(['PERRO', 'GATO', 'OTRO']);
const VERIFICACIONES = new Set(['VERDADERA', 'SALIDA_LEGITIMA', 'ERROR_POSICION']);

class ErrorApi extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

const manejar = (fn) => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (r !== undefined) res.json(r);
  } catch (err) {
    if (err instanceof ErrorApi) return res.status(err.status).json({ error: err.message });
    console.error('[api]', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

const numero = (v, nombre, { min = -Infinity, max = Infinity } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ErrorApi(400, `${nombre} inválido`);
  return n;
};

async function adopcionDeLaFundacion(id) {
  const { rows } = await consulta(`SELECT id FROM adopcion WHERE id = $1 AND fundacion_id = $2`, [id, FUNDACION_ID]);
  if (!rows[0]) throw new ErrorApi(404, 'Adopción no encontrada');
  return rows[0].id;
}

// ---------- Parámetros de la fundación ----------

api.get('/parametros', manejar(async () => {
  const { rows } = await consulta(
    `SELECT p.*, f.nombre AS fundacion, $2::real AS peso_minimo_kg
       FROM parametros_fundacion p JOIN fundacion f ON f.id = p.fundacion_id WHERE fundacion_id = $1`,
    [FUNDACION_ID, PESO_MINIMO_KG],
  );
  return rows[0];
}));

api.put('/parametros', manejar(async (req) => {
  const b = req.body ?? {};
  const { rows } = await consulta(
    `UPDATE parametros_fundacion SET radio_m_defecto = $2, umbral_permanencia_min = $3, horas_para_escalar = $4,
            min_sin_senal = $5, error_m_respaldo = $6, usar_histeresis = $7, actualizado_en = now()
      WHERE fundacion_id = $1 RETURNING *`,
    [
      FUNDACION_ID,
      numero(b.radio_m_defecto, 'radio_m_defecto', { min: 10 }),
      numero(b.umbral_permanencia_min, 'umbral_permanencia_min', { min: 0.1 }),
      numero(b.horas_para_escalar, 'horas_para_escalar', { min: 0.01 }),
      numero(b.min_sin_senal, 'min_sin_senal', { min: 0.1 }),
      numero(b.error_m_respaldo, 'error_m_respaldo', { min: 0 }),
      b.usar_histeresis !== false,
    ],
  );
  bus.emit('seguimiento', { parametros: true });
  return rows[0];
}));

// ---------- Tablero de seguimiento ----------

const SELECT_SEGUIMIENTO = `
  SELECT a.id AS adopcion_id, a.fecha_entrega,
         an.id AS animal_id, an.nombre AS animal, an.especie, an.peso_kg,
         ad.id AS adoptante_id, ad.nombre AS adoptante, ad.telefono, ad.direccion,
         asg.dispositivo_uid,
         ST_Y(z.centro::geometry) AS zona_lat, ST_X(z.centro::geometry) AS zona_lon, z.radio_m,
         e.estado, e.desde AS estado_desde, e.fuera_desde, e.estado_previo, e.ultimo_reporte, e.alerta_id,
         p.lat, p.lon, p.fix_time, p.bateria_pct, p.precision_m, p.valida,
         ST_Distance(p.geom, z.centro) AS distancia_m,
         (SELECT json_build_object('motivo', x.motivo, 'inicio', x.inicio, 'fin', x.fin)
            FROM excepcion x WHERE x.adopcion_id = a.id AND x.inicio <= now() AND x.fin > now()
           ORDER BY x.fin DESC LIMIT 1) AS excepcion_vigente
    FROM adopcion a
    JOIN animal an ON an.id = a.animal_id
    JOIN adoptante ad ON ad.id = a.adoptante_id
    LEFT JOIN asignacion_dispositivo asg ON asg.adopcion_id = a.id AND asg.hasta IS NULL
    LEFT JOIN zona_segura z ON z.adopcion_id = a.id
    LEFT JOIN estado_seguimiento e ON e.adopcion_id = a.id
    LEFT JOIN posicion p ON p.id = e.ultima_posicion_id
   WHERE a.fundacion_id = $1 AND a.activa`;

api.get('/seguimiento', manejar(async () => {
  const { rows } = await consulta(`${SELECT_SEGUIMIENTO} ORDER BY an.nombre`, [FUNDACION_ID]);
  return rows;
}));

// Expediente de evidencia de una adopción.
api.get('/adopciones/:id', manejar(async (req) => {
  const id = await adopcionDeLaFundacion(req.params.id);
  const [{ rows: [resumen] }, { rows: transiciones }, { rows: excepciones }, { rows: alertas }, { rows: conexiones }] =
    await Promise.all([
      consulta(`${SELECT_SEGUIMIENTO} AND a.id = $2`, [FUNDACION_ID, id]),
      consulta(`SELECT id, desde, hacia, causa, posicion_id, ocurrida_en FROM transicion_estado
                 WHERE adopcion_id = $1 ORDER BY ocurrida_en DESC, id DESC LIMIT 200`, [id]),
      consulta(`SELECT * FROM excepcion WHERE adopcion_id = $1 ORDER BY inicio DESC LIMIT 50`, [id]),
      consulta(`SELECT * FROM alerta WHERE adopcion_id = $1 ORDER BY creada_en DESC LIMIT 50`, [id]),
      consulta(`SELECT ec.tipo, ec.ocurrido_en FROM evento_conexion ec
                  JOIN asignacion_dispositivo ad ON ad.dispositivo_uid = ec.dispositivo_uid AND ad.adopcion_id = $1
                 WHERE ec.ocurrido_en >= ad.desde ORDER BY ec.ocurrido_en DESC LIMIT 50`, [id]),
    ]);
  return { ...resumen, transiciones, excepciones, alertas, conexiones };
}));

api.get('/adopciones/:id/recorrido', manejar(async (req) => {
  const id = await adopcionDeLaFundacion(req.params.id);
  const horas = numero(req.query.horas ?? 6, 'horas', { min: 0.1, max: 24 * 31 });
  const { rows } = await consulta(
    `SELECT p.id, p.lat, p.lon, p.fix_time, p.precision_m, p.valida, p.bateria_pct
       FROM posicion p
       JOIN asignacion_dispositivo ad ON ad.dispositivo_uid = p.dispositivo_uid AND ad.adopcion_id = $1
      WHERE p.fix_time >= ad.desde AND (ad.hasta IS NULL OR p.fix_time < ad.hasta)
        AND p.fix_time >= now() - make_interval(secs => $2)
      ORDER BY p.fix_time LIMIT 5000`,
    [id, horas * 3600],
  );
  return rows;
}));

// Alta de una adopción con su animal, adoptante, collar y zona segura.
api.post('/adopciones', manejar(async (req) => {
  const { animal = {}, adoptante = {}, dispositivo_uid, zona = {} } = req.body ?? {};
  if (!animal.nombre?.trim()) throw new ErrorApi(400, 'Falta el nombre del animal');
  if (!ESPECIES.has(animal.especie)) throw new ErrorApi(400, 'Especie inválida');
  if (!adoptante.nombre?.trim()) throw new ErrorApi(400, 'Falta el nombre del adoptante');
  const peso = numero(animal.peso_kg, 'peso_kg', { min: 0.1 });
  const lat = numero(zona.lat, 'lat', { min: -90, max: 90 });
  const lon = numero(zona.lon, 'lon', { min: -180, max: 180 });
  const { rows: [param] } = await consulta(`SELECT radio_m_defecto FROM parametros_fundacion WHERE fundacion_id = $1`, [FUNDACION_ID]);
  const radio = numero(zona.radio_m ?? param.radio_m_defecto, 'radio_m', { min: 10, max: 5000 });
  const uid = dispositivo_uid?.trim() || null;
  if (uid && peso < PESO_MINIMO_KG) {
    throw new ErrorApi(400, `El animal pesa ${peso} kg: con un collar de ${MASA_COLLAR_G} g el mínimo es ${PESO_MINIMO_KG.toFixed(2)} kg (regla del 2 %)`);
  }

  const adopcionId = await enTransaccion(async (c) => {
    const { rows: [an] } = await c.query(
      `INSERT INTO animal (fundacion_id, nombre, especie, peso_kg) VALUES ($1, $2, $3, $4) RETURNING id`,
      [FUNDACION_ID, animal.nombre.trim(), animal.especie, peso],
    );
    const { rows: [ad] } = await c.query(
      `INSERT INTO adoptante (nombre, telefono, direccion) VALUES ($1, $2, $3) RETURNING id`,
      [adoptante.nombre.trim(), adoptante.telefono?.trim() || null, adoptante.direccion?.trim() || null],
    );
    const { rows: [adop] } = await c.query(
      `INSERT INTO adopcion (animal_id, adoptante_id, fundacion_id) VALUES ($1, $2, $3) RETURNING id`,
      [an.id, ad.id, FUNDACION_ID],
    );
    await c.query(
      `INSERT INTO zona_segura (adopcion_id, centro, radio_m) VALUES ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $4)`,
      [adop.id, lat, lon, radio],
    );
    await c.query(`INSERT INTO estado_seguimiento (adopcion_id) VALUES ($1)`, [adop.id]);
    if (uid) {
      await c.query(`INSERT INTO dispositivo (dispositivo_uid, modelo) VALUES ($1, 'TK911 Pro 4G') ON CONFLICT DO NOTHING`, [uid]);
      const { rowCount } = await c.query(`SELECT 1 FROM asignacion_dispositivo WHERE dispositivo_uid = $1 AND hasta IS NULL`, [uid]);
      if (rowCount) throw new ErrorApi(409, `El collar ${uid} ya está asignado a otra adopción`);
      await c.query(`INSERT INTO asignacion_dispositivo (dispositivo_uid, adopcion_id) VALUES ($1, $2)`, [uid, adop.id]);
    }
    return adop.id;
  });
  bus.emit('seguimiento', { adopcionId });
  return { adopcion_id: adopcionId };
}));

api.put('/adopciones/:id/zona', manejar(async (req) => {
  const id = await adopcionDeLaFundacion(req.params.id);
  const b = req.body ?? {};
  const lat = numero(b.lat, 'lat', { min: -90, max: 90 });
  const lon = numero(b.lon, 'lon', { min: -180, max: 180 });
  const radio = numero(b.radio_m, 'radio_m', { min: 10, max: 5000 });
  await consulta(
    `INSERT INTO zona_segura (adopcion_id, centro, radio_m) VALUES ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $4)
     ON CONFLICT (adopcion_id) DO UPDATE SET centro = EXCLUDED.centro, radio_m = EXCLUDED.radio_m, actualizada_en = now()`,
    [id, lat, lon, radio],
  );
  bus.emit('seguimiento', { adopcionId: id });
  return { ok: true };
}));

// Excepción declarada (en v1 la registra la web en nombre del adoptante; luego vendrá de la app móvil).
api.post('/adopciones/:id/excepciones', manejar(async (req) => {
  const id = await adopcionDeLaFundacion(req.params.id);
  const motivo = req.body?.motivo;
  if (!MOTIVOS.has(motivo)) throw new ErrorApi(400, 'Motivo inválido (PASEO, VETERINARIA o VIAJE)');
  const duracion = numero(req.body?.duracion_min, 'duracion_min', { min: 1, max: 60 * 24 * 14 }); // acotada: máx. 14 días
  const { rows: [exc] } = await consulta(
    `INSERT INTO excepcion (adopcion_id, motivo, inicio, fin) VALUES ($1, $2, now(), now() + make_interval(mins => $3)) RETURNING *`,
    [id, motivo, duracion],
  );
  await eventoManual(id, 'EXCEPCION');
  return exc;
}));

// ---------- Alertas ----------

api.get('/alertas', manejar(async (req) => {
  const soloAbiertas = req.query.abiertas === '1';
  const { rows } = await consulta(
    `SELECT al.*, an.nombre AS animal, ad.nombre AS adoptante, ad.telefono, e.estado
       FROM alerta al
       JOIN adopcion a ON a.id = al.adopcion_id
       JOIN animal an ON an.id = a.animal_id
       JOIN adoptante ad ON ad.id = a.adoptante_id
       LEFT JOIN estado_seguimiento e ON e.adopcion_id = a.id
      WHERE al.fundacion_id = $1 ${soloAbiertas ? 'AND al.resuelta_en IS NULL' : ''}
      ORDER BY al.resuelta_en IS NULL DESC, al.creada_en DESC LIMIT 200`,
    [FUNDACION_ID],
  );
  return rows;
}));

async function alertaDeLaFundacion(id) {
  const { rows } = await consulta(`SELECT * FROM alerta WHERE id = $1 AND fundacion_id = $2`, [id, FUNDACION_ID]);
  if (!rows[0]) throw new ErrorApi(404, 'Alerta no encontrada');
  return rows[0];
}

// Respuesta del adoptante (en v1 se simula desde la web).
api.post('/alertas/:id/responder', manejar(async (req) => {
  const alerta = await alertaDeLaFundacion(req.params.id);
  if (alerta.resuelta_en) throw new ErrorApi(409, 'La alerta ya está resuelta');
  await consulta(`UPDATE alerta SET respondida_en = now(), respuesta = $2 WHERE id = $1`, [alerta.id, req.body?.respuesta?.trim() || null]);
  await eventoManual(alerta.adopcion_id, 'RESPUESTA_ADOPTANTE');
  return alertaDeLaFundacion(alerta.id);
}));

// Cierre por la fundación (única salida de ESCALADA). La verificación alimenta la métrica de falsos positivos.
api.post('/alertas/:id/cerrar', manejar(async (req) => {
  const alerta = await alertaDeLaFundacion(req.params.id);
  const verificacion = req.body?.resultado_verificacion ?? null;
  if (verificacion && !VERIFICACIONES.has(verificacion)) throw new ErrorApi(400, 'Resultado de verificación inválido');
  if (verificacion) await consulta(`UPDATE alerta SET resultado_verificacion = $2 WHERE id = $1`, [alerta.id, verificacion]);
  if (!alerta.resuelta_en) await eventoManual(alerta.adopcion_id, 'CIERRE_FUNDACION');
  return alertaDeLaFundacion(alerta.id);
}));

// ---------- Exportes para el OE5 ----------

const EXPORTES = {
  posiciones: `SELECT p.id, ad.adopcion_id, p.dispositivo_uid, p.fix_time, p.server_time, p.recibido_en, p.lat, p.lon,
                      p.precision_m, p.satelites, p.bateria_pct, p.valida
                 FROM posicion p JOIN asignacion_dispositivo ad ON ad.dispositivo_uid = p.dispositivo_uid
                 JOIN adopcion a ON a.id = ad.adopcion_id
                WHERE a.fundacion_id = $1 AND p.fix_time >= ad.desde AND (ad.hasta IS NULL OR p.fix_time < ad.hasta)
                ORDER BY p.fix_time`,
  transiciones: `SELECT t.* FROM transicion_estado t JOIN adopcion a ON a.id = t.adopcion_id
                  WHERE a.fundacion_id = $1 ORDER BY t.ocurrida_en`,
  alertas: `SELECT * FROM alerta WHERE fundacion_id = $1 ORDER BY creada_en`,
};

const celdaCsv = (v) => {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

api.get('/exportar/:tabla.csv', manejar(async (req, res) => {
  const sql = EXPORTES[req.params.tabla];
  if (!sql) throw new ErrorApi(404, 'Exporte no disponible');
  const { rows, fields } = await consulta(sql, [FUNDACION_ID]);
  const columnas = fields.map((f) => f.name);
  const csv = [columnas.join(','), ...rows.map((r) => columnas.map((c) => celdaCsv(r[c])).join(','))].join('\n');
  res.type('text/csv').attachment(`${req.params.tabla}.csv`).send(csv);
}));

// ---------- Tiempo casi real (Server-Sent Events) ----------

api.get('/eventos', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const enviar = (tipo) => (datos) => res.write(`event: ${tipo}\ndata: ${JSON.stringify(datos)}\n\n`);
  const alSeguimiento = enviar('seguimiento');
  const alAlerta = enviar('alerta');
  bus.on('seguimiento', alSeguimiento);
  bus.on('alerta', alAlerta);
  const latido = setInterval(() => res.write(': latido\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(latido);
    bus.off('seguimiento', alSeguimiento);
    bus.off('alerta', alAlerta);
  });
});
