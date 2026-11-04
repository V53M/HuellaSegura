// Enruta cada alerta del motor a sus destinatarios y deja la traza de tiempos de cada envío (OE5).
//   NUEVA    → fundación de origen (web) + adoptante (push FCM a cada teléfono registrado)
//   ESCALADA → fundación de origen (web): el caso pasa a sus manos
// La web y la app acusan recibo y lectura por la API; así se mide la latencia de punta a punta.
import { consulta } from '../db/db.js';
import { bus } from '../eventos.js';
import { clienteFcmDesdeEntorno } from './fcm.js';

const fecha = (n) => (n == null ? null : new Date(n));

function textoPush(tipo, animal, umbralMin) {
  return tipo === 'NUEVA'
    ? {
        titulo: `¿Dónde está ${animal}?`,
        cuerpo: `${animal} lleva más de ${Math.round(umbralMin)} min fuera de su zona segura. Abre la app y cuéntanos si todo está bien.`,
      }
    : { titulo: `Caso de ${animal} escalado`, cuerpo: `La fundación hará seguimiento del caso de ${animal}.` };
}

async function insertar(n) {
  const { rows } = await consulta(
    `INSERT INTO notificacion (alerta_id, tipo, destinatario, canal, token_push_id, condicion_en, enviada_en, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [n.alertaId, n.tipo, n.destinatario, n.canal, n.tokenId ?? null, n.condicionEn, n.enviadaEn ?? null, n.error ?? null],
  );
  return rows[0].id;
}

/** Procesa un aviso del motor ({ tipo, alertaId, adopcionId, fundacionId, condicionEn }). */
export async function notificar(aviso, fcm) {
  const { rows: [info] } = await consulta(
    `SELECT an.nombre AS animal, a.adoptante_id, pf.umbral_permanencia_min
       FROM adopcion a JOIN animal an ON an.id = a.animal_id
       JOIN parametros_fundacion pf ON pf.fundacion_id = a.fundacion_id
      WHERE a.id = $1`,
    [aviso.adopcionId],
  );
  if (!info) return [];
  const base = { alertaId: aviso.alertaId, tipo: aviso.tipo, condicionEn: fecha(aviso.condicionEn ?? Date.now()) };
  const ids = [];

  // Fundación: la notificación sale por SSE a la plataforma web en este mismo instante.
  const idWeb = await insertar({ ...base, destinatario: 'FUNDACION', canal: 'WEB', enviadaEn: new Date() });
  ids.push(idWeb);
  bus.emit('notificacion', {
    id: idWeb, tipo: aviso.tipo, alertaId: aviso.alertaId, adopcionId: aviso.adopcionId,
    fundacionId: aviso.fundacionId, destinatario: 'FUNDACION',
  });

  if (aviso.tipo !== 'NUEVA') return ids;

  // Adoptante: push a cada teléfono registrado. Si no hay ninguno, queda constancia: es un caso no entregado.
  const { rows: tokens } = await consulta(
    `SELECT id, token FROM token_push WHERE adoptante_id = $1 AND activo ORDER BY registrado_en DESC`,
    [info.adoptante_id],
  );
  if (tokens.length === 0) {
    ids.push(await insertar({ ...base, destinatario: 'ADOPTANTE', canal: 'FCM', error: 'SIN_TOKEN' }));
    return ids;
  }
  const { titulo, cuerpo } = textoPush(aviso.tipo, info.animal, info.umbral_permanencia_min);
  for (const t of tokens) {
    const id = await insertar({ ...base, destinatario: 'ADOPTANTE', canal: 'FCM', tokenId: t.id });
    ids.push(id);
    try {
      const proveedorId = await fcm.enviar({
        token: t.token, titulo, cuerpo,
        datos: { notificacion_id: id, alerta_id: aviso.alertaId, adopcion_id: aviso.adopcionId, tipo: aviso.tipo },
      });
      await consulta(`UPDATE notificacion SET enviada_en = now(), proveedor_id = $2 WHERE id = $1`, [id, proveedorId]);
    } catch (err) {
      await consulta(`UPDATE notificacion SET error = $2 WHERE id = $1`, [id, err.codigo ?? err.message]);
      if (err.tokenInvalido) {
        await consulta(
          `UPDATE token_push SET activo = FALSE, desactivado_en = now(), motivo_baja = $2 WHERE id = $1`,
          [t.id, err.codigo],
        );
      }
      if (err.codigo !== 'FCM_NO_CONFIGURADO') console.error(`[fcm] notificación ${id}:`, err.message);
    }
  }
  return ids;
}

/** Conecta el servicio al bus del motor. */
export function iniciarNotificaciones(fcm = clienteFcmDesdeEntorno()) {
  if (!fcm.configurado) console.log('[notificaciones] FCM sin configurar: las push al adoptante se registran sin enviarse');
  bus.on('alerta', (aviso) => {
    notificar(aviso, fcm).catch((err) => console.error('[notificaciones]', err));
  });
}
