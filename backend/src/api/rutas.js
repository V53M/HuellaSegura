// API REST de la plataforma web de la fundación. Exige sesión de ADMIN_FUNDACION o PERSONAL_FUNDACION,
// y cada consulta se limita a la fundación del usuario (req.usuario.fundacion_id).
import { Router } from 'express';
import { consulta, enTransaccion } from '../db/db.js';
import { bus } from '../eventos.js';
import { ErrorGeocodificacion, geocodificar } from '../geocodificacion/geocodificacion.js';
import { resumenLatencias } from '../notificaciones/metricas.js';
import { ROLES_FUNDACION, autenticar, exigirRol } from '../auth/middleware.js';
import { hashContrasena, LARGO_MINIMO } from '../auth/contrasenas.js';
import { revocarSesionesDe } from '../auth/sesiones.js';
import { POLITICA } from '../auth/politica.js';
import { SQL_CONSENTIDO, registrarConsentimiento, registrarYAvisar, revocarConsentimiento } from '../auth/consentimiento.js';
import { acusarNotificacion, cerrarAlerta, declararExcepcion, responderAlerta } from './acciones.js';
import { ErrorApi, manejar, numero } from './comunes.js';

export const api = Router();
api.use(autenticar(), exigirRol(ROLES_FUNDACION));
const fid = (req) => req.usuario.fundacion_id;
const soloAdmin = exigirRol('ADMIN_FUNDACION');

// Regla de bienestar (§8.3): collar + soporte + rastreador ≤ 2 % del peso del animal.
const MASA_COLLAR_G = 71;
export const PESO_MINIMO_KG = MASA_COLLAR_G / 0.02 / 1000;

const ESPECIES = new Set(['PERRO', 'GATO', 'OTRO']);

async function adopcionDeLaFundacion(req, id) {
  const { rows } = await consulta(`SELECT id, adoptante_id FROM adopcion WHERE id = $1 AND fundacion_id = $2`, [id, fid(req)]);
  if (!rows[0]) throw new ErrorApi(404, 'Adopción no encontrada');
  return rows[0].id;
}

async function adoptanteDeLaAdopcion(req, id) {
  const { rows } = await consulta(`SELECT adoptante_id FROM adopcion WHERE id = $1 AND fundacion_id = $2`, [id, fid(req)]);
  if (!rows[0]) throw new ErrorApi(404, 'Adopción no encontrada');
  return rows[0].adoptante_id;
}

// ---------- Parámetros de la fundación ----------

api.get('/parametros', manejar(async (req) => {
  const { rows } = await consulta(
    `SELECT p.*, f.nombre AS fundacion, $2::real AS peso_minimo_kg
       FROM parametros_fundacion p JOIN fundacion f ON f.id = p.fundacion_id WHERE fundacion_id = $1`,
    [fid(req), PESO_MINIMO_KG],
  );
  return rows[0];
}));

api.put('/parametros', soloAdmin, manejar(async (req) => {
  const b = req.body ?? {};
  const { rows } = await consulta(
    `UPDATE parametros_fundacion SET radio_m_defecto = $2, umbral_permanencia_min = $3, horas_para_escalar = $4,
            min_sin_senal = $5, error_m_respaldo = $6, usar_histeresis = $7, actualizado_en = now()
      WHERE fundacion_id = $1 RETURNING *`,
    [
      fid(req),
      numero(b.radio_m_defecto, 'radio_m_defecto', { min: 10 }),
      numero(b.umbral_permanencia_min, 'umbral_permanencia_min', { min: 0.1 }),
      numero(b.horas_para_escalar, 'horas_para_escalar', { min: 0.01 }),
      numero(b.min_sin_senal, 'min_sin_senal', { min: 0.1 }),
      numero(b.error_m_respaldo, 'error_m_respaldo', { min: 0 }),
      b.usar_histeresis !== false,
    ],
  );
  bus.emit('seguimiento', { parametros: true, fundacionId: fid(req) });
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
           ORDER BY x.fin DESC LIMIT 1) AS excepcion_vigente,
         ${SQL_CONSENTIDO} AS consentimiento_vigente
    FROM adopcion a
    JOIN animal an ON an.id = a.animal_id
    JOIN adoptante ad ON ad.id = a.adoptante_id
    LEFT JOIN asignacion_dispositivo asg ON asg.adopcion_id = a.id AND asg.hasta IS NULL
    LEFT JOIN zona_segura z ON z.adopcion_id = a.id
    LEFT JOIN estado_seguimiento e ON e.adopcion_id = a.id
    LEFT JOIN posicion p ON p.id = e.ultima_posicion_id
   WHERE a.fundacion_id = $1 AND a.activa`;

api.get('/seguimiento', manejar(async (req) => {
  const { rows } = await consulta(`${SELECT_SEGUIMIENTO} ORDER BY an.nombre`, [fid(req)]);
  return rows;
}));

// Expediente de evidencia de una adopción.
api.get('/adopciones/:id', manejar(async (req) => {
  const id = await adopcionDeLaFundacion(req, req.params.id);
  const [{ rows: [resumen] }, { rows: transiciones }, { rows: excepciones }, { rows: alertas }, { rows: conexiones }] =
    await Promise.all([
      consulta(`${SELECT_SEGUIMIENTO} AND a.id = $2`, [fid(req), id]),
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
  const id = await adopcionDeLaFundacion(req, req.params.id);
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
  const { animal = {}, adoptante = {}, dispositivo_uid, zona = {}, consentimiento = {} } = req.body ?? {};
  if (!animal.nombre?.trim()) throw new ErrorApi(400, 'Falta el nombre del animal');
  // Ley 1581: sin la autorización firmada no se puede hacer seguimiento.
  if (consentimiento.firmado !== true) throw new ErrorApi(400, 'Falta la autorización de tratamiento de datos firmada por el adoptante');
  if (consentimiento.version !== POLITICA.version) throw new ErrorApi(409, `La política vigente es la versión ${POLITICA.version}`);
  if (!ESPECIES.has(animal.especie)) throw new ErrorApi(400, 'Especie inválida');
  if (!adoptante.nombre?.trim()) throw new ErrorApi(400, 'Falta el nombre del adoptante');
  const peso = numero(animal.peso_kg, 'peso_kg', { min: 0.1 });
  const lat = numero(zona.lat, 'lat', { min: -90, max: 90 });
  const lon = numero(zona.lon, 'lon', { min: -180, max: 180 });
  const { rows: [param] } = await consulta(`SELECT radio_m_defecto FROM parametros_fundacion WHERE fundacion_id = $1`, [fid(req)]);
  const radio = numero(zona.radio_m ?? param.radio_m_defecto, 'radio_m', { min: 10, max: 5000 });
  const uid = dispositivo_uid?.trim() || null;
  if (uid && peso < PESO_MINIMO_KG) {
    throw new ErrorApi(400, `El animal pesa ${peso} kg: con un collar de ${MASA_COLLAR_G} g el mínimo es ${PESO_MINIMO_KG.toFixed(2)} kg (regla del 2 %)`);
  }

  const adopcionId = await enTransaccion(async (c) => {
    const { rows: [an] } = await c.query(
      `INSERT INTO animal (fundacion_id, nombre, especie, peso_kg) VALUES ($1, $2, $3, $4) RETURNING id`,
      [fid(req), animal.nombre.trim(), animal.especie, peso],
    );
    const { rows: [ad] } = await c.query(
      `INSERT INTO adoptante (nombre, telefono, direccion) VALUES ($1, $2, $3) RETURNING id`,
      [adoptante.nombre.trim(), adoptante.telefono?.trim() || null, adoptante.direccion?.trim() || null],
    );
    const { rows: [adop] } = await c.query(
      `INSERT INTO adopcion (animal_id, adoptante_id, fundacion_id) VALUES ($1, $2, $3) RETURNING id`,
      [an.id, ad.id, fid(req)],
    );
    await c.query(
      `INSERT INTO zona_segura (adopcion_id, centro, radio_m) VALUES ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $4)`,
      [adop.id, lat, lon, radio],
    );
    await c.query(`INSERT INTO estado_seguimiento (adopcion_id) VALUES ($1)`, [adop.id]);
    await registrarConsentimiento(c, {
      adoptanteId: ad.id, medio: 'FORMATO_FIRMADO', evidencia: consentimiento.evidencia?.trim() || null, registradoPor: req.usuario.id,
    });
    if (uid) {
      await c.query(`INSERT INTO dispositivo (dispositivo_uid, modelo) VALUES ($1, 'TK911 Pro 4G') ON CONFLICT DO NOTHING`, [uid]);
      const { rowCount } = await c.query(`SELECT 1 FROM asignacion_dispositivo WHERE dispositivo_uid = $1 AND hasta IS NULL`, [uid]);
      if (rowCount) throw new ErrorApi(409, `El collar ${uid} ya está asignado a otra adopción`);
      await c.query(`INSERT INTO asignacion_dispositivo (dispositivo_uid, adopcion_id) VALUES ($1, $2)`, [uid, adop.id]);
    }
    return adop.id;
  });
  bus.emit('seguimiento', { adopcionId, fundacionId: fid(req) });
  return { adopcion_id: adopcionId };
}));

api.put('/adopciones/:id/zona', manejar(async (req) => {
  const id = await adopcionDeLaFundacion(req, req.params.id);
  const b = req.body ?? {};
  const lat = numero(b.lat, 'lat', { min: -90, max: 90 });
  const lon = numero(b.lon, 'lon', { min: -180, max: 180 });
  const radio = numero(b.radio_m, 'radio_m', { min: 10, max: 5000 });
  await consulta(
    `INSERT INTO zona_segura (adopcion_id, centro, radio_m) VALUES ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $4)
     ON CONFLICT (adopcion_id) DO UPDATE SET centro = EXCLUDED.centro, radio_m = EXCLUDED.radio_m, actualizada_en = now()`,
    [id, lat, lon, radio],
  );
  bus.emit('seguimiento', { adopcionId: id, fundacionId: fid(req) });
  return { ok: true };
}));

// Ubicar la zona segura escribiendo la dirección del adoptante (o coordenadas) en vez de marcarla en el mapa.
api.get('/geocodificar', manejar(async (req) => {
  try {
    return await geocodificar(req.query.q);
  } catch (err) {
    if (err instanceof ErrorGeocodificacion && err.deEntrada) throw new ErrorApi(400, err.message);
    console.error('[geocodificar]', err.message);
    throw new ErrorApi(502, 'El servicio de direcciones no respondió. Seleccione el punto en el mapa.');
  }
}));

// Excepción que el adoptante comunicó por teléfono a la fundación (desde la app la declara él mismo).
api.post('/adopciones/:id/excepciones', manejar(async (req) => {
  const id = await adopcionDeLaFundacion(req, req.params.id);
  return declararExcepcion(id, req.body);
}));

// ---------- Consentimiento y acceso del adoptante ----------

api.get('/politica', manejar(async () => POLITICA));

api.get('/adopciones/:id/consentimiento', manejar(async (req) => {
  const adoptanteId = await adoptanteDeLaAdopcion(req, req.params.id);
  const [{ rows: consentimientos }, { rows: [acceso] }] = await Promise.all([
    consulta(`SELECT id, version_politica, medio, evidencia, aceptado_en, revocado_en, motivo_revocacion
                FROM consentimiento WHERE adoptante_id = $1 ORDER BY aceptado_en DESC`, [adoptanteId]),
    consulta(`SELECT correo, activo, ultimo_acceso FROM usuario WHERE adoptante_id = $1`, [adoptanteId]),
  ]);
  return { politica_vigente: POLITICA.version, consentimientos, acceso: acceso ?? null };
}));

// Formato firmado que la fundación recibe en papel (o por correo) y registra aquí.
api.post('/adopciones/:id/consentimiento', manejar(async (req) => {
  const adoptanteId = await adoptanteDeLaAdopcion(req, req.params.id);
  return registrarYAvisar({
    adoptanteId, medio: 'FORMATO_FIRMADO', evidencia: req.body?.evidencia?.trim() || null, registradoPor: req.usuario.id,
  });
}));

// Revocación comunicada a la fundación. El seguimiento se detiene de inmediato.
api.delete('/adopciones/:id/consentimiento', manejar(async (req) => {
  const adoptanteId = await adoptanteDeLaAdopcion(req, req.params.id);
  const motivo = req.body?.motivo?.trim();
  if (!motivo) throw new ErrorApi(400, 'Indique el motivo o el medio por el que el adoptante revocó la autorización');
  return { revocados: await revocarConsentimiento(adoptanteId, `Registrada por la fundación: ${motivo}`) };
}));

// Cuenta del adoptante para la app móvil, con una contraseña temporal que la fundación le entrega.
api.post('/adopciones/:id/acceso', manejar(async (req) => {
  const adoptanteId = await adoptanteDeLaAdopcion(req, req.params.id);
  const correo = req.body?.correo?.trim().toLowerCase();
  if (!correo || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) throw new ErrorApi(400, 'Correo inválido');
  const contrasena = req.body?.contrasena;
  if (typeof contrasena !== 'string' || contrasena.length < LARGO_MINIMO) {
    throw new ErrorApi(400, `La contraseña temporal debe tener al menos ${LARGO_MINIMO} caracteres`);
  }
  const { rows: [nombre] } = await consulta(`SELECT nombre FROM adoptante WHERE id = $1`, [adoptanteId]);
  const hash = await hashContrasena(contrasena);
  try {
    const { rows: [u] } = await consulta(
      `INSERT INTO usuario (correo, nombre, rol, adoptante_id, hash_contrasena) VALUES ($1, $2, 'ADOPTANTE', $3, $4)
       ON CONFLICT (adoptante_id) WHERE adoptante_id IS NOT NULL
       DO UPDATE SET correo = EXCLUDED.correo, hash_contrasena = EXCLUDED.hash_contrasena, activo = TRUE
       RETURNING id, correo, activo`,
      [correo, nombre.nombre, adoptanteId, hash],
    );
    await revocarSesionesDe(u.id); // una contraseña nueva cierra las sesiones anteriores
    return u;
  } catch (err) {
    if (err.code === '23505') throw new ErrorApi(409, 'Ese correo ya está en uso');
    throw err;
  }
}));

// ---------- Alertas ----------

api.get('/alertas', manejar(async (req) => {
  const soloAbiertas = req.query.abiertas === '1';
  const { rows } = await consulta(
    `SELECT al.*, an.nombre AS animal, ad.nombre AS adoptante, ad.telefono, e.estado,
            (SELECT COALESCE(json_agg(json_build_object(
                      'id', n.id, 'tipo', n.tipo, 'destinatario', n.destinatario, 'canal', n.canal,
                      'condicion_en', n.condicion_en, 'enviada_en', n.enviada_en, 'entregada_en', n.entregada_en,
                      'leida_en', n.leida_en, 'error', n.error) ORDER BY n.id), '[]')
               FROM notificacion n WHERE n.alerta_id = al.id) AS notificaciones
       FROM alerta al
       JOIN adopcion a ON a.id = al.adopcion_id
       JOIN animal an ON an.id = a.animal_id
       JOIN adoptante ad ON ad.id = a.adoptante_id
       LEFT JOIN estado_seguimiento e ON e.adopcion_id = a.id
      WHERE al.fundacion_id = $1 ${soloAbiertas ? 'AND al.resuelta_en IS NULL' : ''}
      ORDER BY al.resuelta_en IS NULL DESC, al.creada_en DESC LIMIT 200`,
    [fid(req)],
  );
  return rows;
}));

async function alertaDeLaFundacion(req, id) {
  const { rows } = await consulta(`SELECT * FROM alerta WHERE id = $1 AND fundacion_id = $2`, [id, fid(req)]);
  if (!rows[0]) throw new ErrorApi(404, 'Alerta no encontrada');
  return rows[0];
}

// Respuesta que el adoptante dio por teléfono (desde la app responde él mismo).
api.post('/alertas/:id/responder', manejar(async (req) => {
  const alerta = await alertaDeLaFundacion(req, req.params.id);
  await responderAlerta(alerta, req.body?.respuesta);
  return alertaDeLaFundacion(req, alerta.id);
}));

// Cierre por la fundación (única salida de ESCALADA). La verificación alimenta la métrica de falsos positivos.
api.post('/alertas/:id/cerrar', manejar(async (req) => {
  const alerta = await alertaDeLaFundacion(req, req.params.id);
  await cerrarAlerta(alerta, req.body?.resultado_verificacion ?? null);
  return alertaDeLaFundacion(req, alerta.id);
}));

// ---------- Notificaciones y latencia (OE5) ----------

async function notificacionDeLaFundacion(req, id) {
  const { rows } = await consulta(
    `SELECT n.id FROM notificacion n JOIN alerta al ON al.id = n.alerta_id
      WHERE n.id = $1 AND al.fundacion_id = $2 AND n.destinatario = 'FUNDACION'`,
    [id, fid(req)],
  );
  if (!rows[0]) throw new ErrorApi(404, 'Notificación no encontrada');
  return rows[0].id;
}

// Acuses de la plataforma web: al recibir el aviso y al abrirlo.
api.post('/notificaciones/:id/entregada', manejar(async (req) => acusarNotificacion(await notificacionDeLaFundacion(req, req.params.id))));
api.post('/notificaciones/:id/leida', manejar(async (req) =>
  acusarNotificacion(await notificacionDeLaFundacion(req, req.params.id), { leida: true })));

api.get('/metricas/latencia', manejar(async (req) => {
  const { rows } = await consulta(
    `SELECT n.* FROM notificacion n JOIN alerta al ON al.id = n.alerta_id WHERE al.fundacion_id = $1`,
    [fid(req)],
  );
  return resumenLatencias(rows);
}));

// ---------- Usuarios de la fundación (solo administradores) ----------

const ROLES_PERSONAL = new Set(['ADMIN_FUNDACION', 'PERSONAL_FUNDACION']);

api.get('/usuarios', soloAdmin, manejar(async (req) => {
  const { rows } = await consulta(
    `SELECT id, correo, nombre, rol, activo, creado_en, ultimo_acceso FROM usuario WHERE fundacion_id = $1 ORDER BY nombre`,
    [fid(req)],
  );
  return rows;
}));

api.post('/usuarios', soloAdmin, manejar(async (req) => {
  const b = req.body ?? {};
  const correo = b.correo?.trim().toLowerCase();
  if (!correo || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) throw new ErrorApi(400, 'Correo inválido');
  if (!b.nombre?.trim()) throw new ErrorApi(400, 'Falta el nombre');
  if (!ROLES_PERSONAL.has(b.rol)) throw new ErrorApi(400, 'Rol inválido (ADMIN_FUNDACION o PERSONAL_FUNDACION)');
  if (typeof b.contrasena !== 'string' || b.contrasena.length < LARGO_MINIMO) {
    throw new ErrorApi(400, `La contraseña temporal debe tener al menos ${LARGO_MINIMO} caracteres`);
  }
  try {
    const { rows: [u] } = await consulta(
      `INSERT INTO usuario (correo, nombre, rol, fundacion_id, hash_contrasena) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, correo, nombre, rol, activo, creado_en`,
      [correo, b.nombre.trim(), b.rol, fid(req), await hashContrasena(b.contrasena)],
    );
    return u;
  } catch (err) {
    if (err.code === '23505') throw new ErrorApi(409, 'Ese correo ya está en uso');
    throw err;
  }
}));

// Activar o desactivar una cuenta. Desactivarla cierra sus sesiones.
api.patch('/usuarios/:id', soloAdmin, manejar(async (req) => {
  const activo = req.body?.activo;
  if (typeof activo !== 'boolean') throw new ErrorApi(400, 'Indique activo: true o false');
  if (Number(req.params.id) === req.usuario.id && !activo) throw new ErrorApi(400, 'No puede desactivar su propia cuenta');
  const { rows: [u] } = await consulta(
    `UPDATE usuario SET activo = $3 WHERE id = $1 AND fundacion_id = $2 RETURNING id, correo, nombre, rol, activo`,
    [req.params.id, fid(req), activo],
  );
  if (!u) throw new ErrorApi(404, 'Usuario no encontrado');
  if (!activo) await revocarSesionesDe(u.id);
  return u;
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
  notificaciones: `SELECT n.id, n.alerta_id, al.adopcion_id, n.tipo, n.destinatario, n.canal, n.condicion_en, n.creada_en,
                          n.enviada_en, n.entregada_en, n.leida_en, n.error,
                          EXTRACT(EPOCH FROM n.creada_en - n.condicion_en) AS deteccion_s,
                          EXTRACT(EPOCH FROM n.enviada_en - n.condicion_en) AS envio_s,
                          EXTRACT(EPOCH FROM n.entregada_en - n.condicion_en) AS entrega_s,
                          EXTRACT(EPOCH FROM n.leida_en - n.condicion_en) AS lectura_s
                     FROM notificacion n JOIN alerta al ON al.id = n.alerta_id
                    WHERE al.fundacion_id = $1 ORDER BY n.condicion_en, n.id`,
};

const celdaCsv = (v) => {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

api.get('/exportar/:tabla.csv', manejar(async (req, res) => {
  const sql = EXPORTES[req.params.tabla];
  if (!sql) throw new ErrorApi(404, 'Exporte no disponible');
  const { rows, fields } = await consulta(sql, [fid(req)]);
  const columnas = fields.map((f) => f.name);
  const csv = [columnas.join(','), ...rows.map((r) => columnas.map((c) => celdaCsv(r[c])).join(','))].join('\n');
  res.type('text/csv').attachment(`${req.params.tabla}.csv`).send(csv);
}));

// ---------- Tiempo casi real (Server-Sent Events) ----------

api.get('/eventos', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const enviar = (tipo) => (datos) => res.write(`event: ${tipo}\ndata: ${JSON.stringify(datos)}\n\n`);
  // Solo los eventos de la fundación del usuario.
  const deMiFundacion = (fn) => (d) => d.fundacionId === fid(req) && fn(d);
  const alSeguimiento = deMiFundacion(enviar('seguimiento'));
  const alAlerta = deMiFundacion(enviar('alerta'));
  const alNotificacion = deMiFundacion(enviar('notificacion'));
  bus.on('seguimiento', alSeguimiento);
  bus.on('alerta', alAlerta);
  bus.on('notificacion', alNotificacion);
  const latido = setInterval(() => res.write(': latido\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(latido);
    bus.off('seguimiento', alSeguimiento);
    bus.off('alerta', alAlerta);
    bus.off('notificacion', alNotificacion);
  });
});
