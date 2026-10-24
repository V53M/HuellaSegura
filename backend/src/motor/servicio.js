// Conecta la máquina de estados pura (motor.js) con la base de datos.
// Cada adopción se procesa en serie para que dos posiciones simultáneas no pisen el estado.
import { consulta, enTransaccion } from '../db/db.js';
import { bus } from '../eventos.js';
import { estadoInicial, evaluar } from './motor.js';

const colas = new Map();
function enCola(adopcionId, fn) {
  const anterior = colas.get(adopcionId) ?? Promise.resolve();
  const actual = anterior.then(fn, fn);
  colas.set(adopcionId, actual.catch(() => {}));
  return actual;
}

const ms = (fecha) => (fecha == null ? null : new Date(fecha).getTime());
const fecha = (n) => (n == null ? null : new Date(n));

async function cargarContexto(cliente, adopcionId, t) {
  const { rows } = await cliente.query(
    `SELECT a.fundacion_id, e.estado, e.desde, e.fuera_desde, e.estado_previo, e.ultimo_reporte, e.alerta_id,
            al.creada_en AS alerta_desde,
            pf.umbral_permanencia_min, pf.horas_para_escalar, pf.min_sin_senal, pf.usar_histeresis, pf.error_m_respaldo
       FROM adopcion a
       JOIN parametros_fundacion pf ON pf.fundacion_id = a.fundacion_id
       LEFT JOIN estado_seguimiento e ON e.adopcion_id = a.id
       LEFT JOIN alerta al ON al.id = e.alerta_id
      WHERE a.id = $1 AND a.activa
        FOR UPDATE OF a`,
    [adopcionId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const { rows: exc } = await cliente.query(
    `SELECT inicio, fin FROM excepcion WHERE adopcion_id = $1 AND inicio <= $2 ORDER BY fin DESC LIMIT 1`,
    [adopcionId, fecha(t)],
  );
  const estado = r.estado
    ? {
        estado: r.estado,
        desde: ms(r.desde),
        fuera_desde: ms(r.fuera_desde),
        estado_previo: r.estado_previo,
        ultimo_reporte: ms(r.ultimo_reporte),
        alerta_desde: ms(r.alerta_desde),
      }
    : estadoInicial(t);
  return {
    fundacionId: r.fundacion_id,
    alertaId: r.alerta_id,
    errorRespaldo: r.error_m_respaldo,
    ctx: {
      estado,
      params: {
        umbral_permanencia_min: r.umbral_permanencia_min,
        horas_para_escalar: r.horas_para_escalar,
        min_sin_senal: r.min_sin_senal,
        usar_histeresis: r.usar_histeresis,
      },
      excepcion: exc[0] ? { inicio: ms(exc[0].inicio), fin: ms(exc[0].fin) } : null,
    },
  };
}

async function guardar(cliente, adopcionId, cargado, resultado, posicionId, avisos) {
  const s = resultado.estado;
  let alertaId = cargado.alertaId;

  for (const accion of resultado.acciones) {
    if (accion.tipo === 'CREAR_ALERTA') {
      const { rows } = await cliente.query(
        `INSERT INTO alerta (adopcion_id, fundacion_id, creada_en, fuera_desde) VALUES ($1, $2, $3, $4) RETURNING id`,
        [adopcionId, cargado.fundacionId, fecha(s.alerta_desde), fecha(accion.fuera_desde)],
      );
      alertaId = rows[0].id;
      avisos.push({ tipo: 'NUEVA', alertaId, adopcionId, fundacionId: cargado.fundacionId });
    } else if (accion.tipo === 'ESCALAR_ALERTA' && alertaId) {
      await cliente.query(`UPDATE alerta SET escalada_en = now() WHERE id = $1`, [alertaId]);
      avisos.push({ tipo: 'ESCALADA', alertaId, adopcionId, fundacionId: cargado.fundacionId });
    } else if (accion.tipo === 'RESOLVER_ALERTA' && alertaId) {
      await cliente.query(
        `UPDATE alerta SET resuelta_en = now(), causa_resolucion = $2 WHERE id = $1 AND resuelta_en IS NULL`,
        [alertaId, accion.causa],
      );
      alertaId = null;
    }
  }

  await cliente.query(
    `INSERT INTO estado_seguimiento (adopcion_id, estado, desde, fuera_desde, estado_previo, ultimo_reporte, ultima_posicion_id, alerta_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (adopcion_id) DO UPDATE SET
       estado = EXCLUDED.estado, desde = EXCLUDED.desde, fuera_desde = EXCLUDED.fuera_desde,
       estado_previo = EXCLUDED.estado_previo, ultimo_reporte = EXCLUDED.ultimo_reporte,
       ultima_posicion_id = COALESCE(EXCLUDED.ultima_posicion_id, estado_seguimiento.ultima_posicion_id),
       alerta_id = EXCLUDED.alerta_id`,
    [adopcionId, s.estado, fecha(s.desde), fecha(s.fuera_desde), s.estado_previo, fecha(s.ultimo_reporte), posicionId ?? null, alertaId],
  );

  for (const tr of resultado.transiciones) {
    await cliente.query(
      `INSERT INTO transicion_estado (adopcion_id, desde, hacia, causa, posicion_id, ocurrida_en) VALUES ($1, $2, $3, $4, $5, $6)`,
      [adopcionId, tr.desde, tr.hacia, tr.causa, posicionId ?? null, fecha(tr.t)],
    );
  }
  return resultado.transiciones.length > 0 || resultado.acciones.length > 0;
}

/** Aplica un evento a una adopción. `armarEvento(cargado)` permite usar datos del contexto (p. ej. el error de respaldo). */
function aplicar(adopcionId, t, armarEvento, posicionId) {
  return enCola(adopcionId, async () => {
    const avisos = []; // se publican solo después del COMMIT
    const cambio = await enTransaccion(async (cliente) => {
      const cargado = await cargarContexto(cliente, adopcionId, t);
      if (!cargado) return null;
      const resultado = evaluar(cargado.ctx, armarEvento(cargado));
      const huboCambio = await guardar(cliente, adopcionId, cargado, resultado, posicionId, avisos);
      return { huboCambio, estado: resultado.estado.estado };
    });
    for (const aviso of avisos) bus.emit('alerta', aviso);
    if (cambio && (cambio.huboCambio || posicionId)) bus.emit('seguimiento', { adopcionId, ...cambio, posicionId: posicionId ?? null });
    return cambio;
  });
}

/** Adopción a la que estaba asignado el collar en el instante t. */
async function adopcionDeDispositivo(uid, t) {
  const { rows } = await consulta(
    `SELECT ad.adopcion_id FROM asignacion_dispositivo ad JOIN adopcion a ON a.id = ad.adopcion_id
      WHERE ad.dispositivo_uid = $1 AND ad.desde <= $2 AND (ad.hasta IS NULL OR ad.hasta > $2) AND a.activa
      ORDER BY ad.desde DESC LIMIT 1`,
    [uid, fecha(t)],
  );
  return rows[0]?.adopcion_id ?? null;
}

export async function procesarPosicion(uid, posicionId) {
  const { rows } = await consulta(
    `SELECT p.fix_time, p.valida, p.precision_m FROM posicion p WHERE p.id = $1`,
    [posicionId],
  );
  if (!rows[0]) return null;
  const t = ms(rows[0].fix_time);
  const adopcionId = await adopcionDeDispositivo(uid, t);
  if (!adopcionId) return null;
  const { rows: zona } = await consulta(
    `SELECT z.radio_m, ST_Distance(p.geom, z.centro) AS distancia_m
       FROM posicion p, zona_segura z WHERE p.id = $1 AND z.adopcion_id = $2`,
    [posicionId, adopcionId],
  );
  if (!zona[0]) return null; // sin zona definida no hay nada que evaluar
  return aplicar(
    adopcionId,
    t,
    (cargado) => ({
      tipo: 'POSICION',
      t,
      distancia_m: zona[0].distancia_m,
      error_m: rows[0].precision_m ?? cargado.errorRespaldo,
      radio_m: zona[0].radio_m,
      valida: rows[0].valida,
    }),
    posicionId,
  );
}

export async function procesarConexion(uid, tipo, ocurridoEn = Date.now()) {
  const adopcionId = await adopcionDeDispositivo(uid, ocurridoEn);
  if (!adopcionId) return null;
  return aplicar(adopcionId, ocurridoEn, () => ({ tipo: 'CONEXION', t: ocurridoEn, conexion: tipo }));
}

/** EXCEPCION, RESPUESTA_ADOPTANTE o CIERRE_FUNDACION, desde la API. */
export function eventoManual(adopcionId, tipo, t = Date.now()) {
  return aplicar(adopcionId, t, () => ({ tipo, t }));
}

/** Revisa todo lo que depende del tiempo: umbrales, excepciones vencidas, escaladas y pérdida de señal. */
export async function tick(t = Date.now()) {
  const { rows } = await consulta(
    `SELECT e.adopcion_id FROM estado_seguimiento e JOIN adopcion a ON a.id = e.adopcion_id WHERE a.activa`,
  );
  for (const { adopcion_id } of rows) {
    await aplicar(adopcion_id, t, () => ({ tipo: 'TICK', t }));
  }
}
