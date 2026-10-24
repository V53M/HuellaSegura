// Máquina de estados del seguimiento (OE3, CLAUDE.md §5).
// Función pura: no toca la BD ni el reloj. Recibe el estado actual, los parámetros de la fundación,
// la excepción relevante y un evento; devuelve el estado nuevo, las transiciones y las acciones.
// Todos los tiempos van en milisegundos desde epoch.

export const E = Object.freeze({
  DENTRO: 'DENTRO',
  FUERA_EN_GRACIA: 'FUERA_EN_GRACIA',
  EXCEPCION: 'EXCEPCION',
  ALERTA: 'ALERTA',
  ESCALADA: 'ESCALADA',
  SIN_SENAL: 'SIN_SEÑAL',
});

const MIN = 60_000;
const HORA = 60 * MIN;

/**
 * Clasifica una posición respecto a la zona.
 * Con histéresis: FUERA solo si distancia − error > radio; DENTRO solo si distancia + error < radio;
 * en medio, INCIERTO (se mantiene el estado anterior). Sin histéresis: borde único.
 */
export function clasificar(distanciaM, errorM, radioM, usarHisteresis = true) {
  if (!usarHisteresis) return distanciaM > radioM ? 'FUERA' : 'DENTRO';
  if (distanciaM - errorM > radioM) return 'FUERA';
  if (distanciaM + errorM < radioM) return 'DENTRO';
  return 'INCIERTO';
}

/** Distancia Haversine en metros (respaldo de PostGIS; la usan el simulador y las pruebas). */
export function distanciaM(lat1, lon1, lat2, lon2) {
  const R = 6_371_008.8;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function estadoInicial(t) {
  return {
    estado: E.DENTRO,
    desde: t,
    fuera_desde: null,
    estado_previo: null,
    ultimo_reporte: null,
    alerta_desde: null,
  };
}

/**
 * @param {object} ctx
 * @param {object} ctx.estado      { estado, desde, fuera_desde, estado_previo, ultimo_reporte, alerta_desde }
 * @param {object} ctx.params      { umbral_permanencia_min, horas_para_escalar, min_sin_senal, usar_histeresis }
 * @param {object|null} ctx.excepcion  la excepción más reciente que ya empezó: { inicio, fin }
 * @param {object} evento
 *   { tipo: 'POSICION', t, distancia_m, error_m, radio_m, valida }
 *   { tipo: 'TICK', t }
 *   { tipo: 'EXCEPCION', t }                    el adoptante acaba de declarar una excepción
 *   { tipo: 'CONEXION', t, conexion }           deviceOnline | deviceOffline | deviceUnknown
 *   { tipo: 'RESPUESTA_ADOPTANTE', t }
 *   { tipo: 'CIERRE_FUNDACION', t }
 * @returns {{ estado: object, transiciones: Array<{desde, hacia, causa, t}>, acciones: Array<{tipo, causa?, fuera_desde?}> }}
 */
export function evaluar(ctx, evento) {
  const p = ctx.params;
  const s = { ...ctx.estado };
  const t = evento.t;
  const transiciones = [];
  const acciones = [];

  const ir = (hacia, causa) => {
    if (s.estado === hacia) return;
    transiciones.push({ desde: s.estado, hacia, causa, t });
    s.estado = hacia;
    s.desde = t;
  };

  // Mientras no hay señal, el estado "de fondo" (estado_previo) sigue su curso: si el animal salió y el
  // collar se apagó, el umbral sigue contando. Perder la señal estando fuera es evidencia (§5).
  const efectivo = () => (s.estado === E.SIN_SENAL ? s.estado_previo : s.estado);
  const cambiarEfectivo = (hacia, causa) => {
    if (s.estado !== E.SIN_SENAL) return ir(hacia, causa);
    if (s.estado_previo === hacia) return;
    transiciones.push({ desde: s.estado_previo, hacia, causa: `${causa}_SIN_SEÑAL`, t });
    s.estado_previo = hacia;
  };

  const excepcionVigente = (en) => ctx.excepcion != null && ctx.excepcion.inicio <= en && en < ctx.excepcion.fin;

  const evaluarTiempo = () => {
    switch (efectivo()) {
      case E.FUERA_EN_GRACIA:
        if (excepcionVigente(t)) {
          cambiarEfectivo(E.EXCEPCION, 'EXCEPCION_DECLARADA');
        } else if (t - s.fuera_desde >= p.umbral_permanencia_min * MIN) {
          acciones.push({ tipo: 'CREAR_ALERTA', fuera_desde: s.fuera_desde });
          s.alerta_desde = t;
          cambiarEfectivo(E.ALERTA, 'UMBRAL_SUPERADO');
        }
        break;
      case E.EXCEPCION:
        if (!excepcionVigente(t)) {
          // El umbral vuelve a contar desde el fin de la excepción.
          s.fuera_desde = ctx.excepcion && ctx.excepcion.fin <= t ? ctx.excepcion.fin : t;
          cambiarEfectivo(E.FUERA_EN_GRACIA, 'EXCEPCION_VENCIDA');
          evaluarTiempo();
        }
        break;
      case E.ALERTA:
        if (t - s.alerta_desde >= p.horas_para_escalar * HORA) {
          acciones.push({ tipo: 'ESCALAR_ALERTA' });
          cambiarEfectivo(E.ESCALADA, 'SIN_RESPUESTA_ADOPTANTE');
        }
        break;
      default:
        break;
    }
  };

  const regresar = () => {
    if (s.estado === E.ALERTA) acciones.push({ tipo: 'RESOLVER_ALERTA', causa: 'VOLVIO' });
    s.fuera_desde = null;
    s.alerta_desde = null;
    ir(E.DENTRO, 'REGRESO_A_ZONA');
  };

  const aplicarLado = (lado) => {
    switch (s.estado) {
      case E.DENTRO:
        if (lado === 'FUERA') {
          s.fuera_desde = t;
          if (excepcionVigente(t)) ir(E.EXCEPCION, 'SALIDA_CON_EXCEPCION');
          else ir(E.FUERA_EN_GRACIA, 'SALIDA_DE_ZONA');
        }
        break;
      case E.FUERA_EN_GRACIA:
      case E.EXCEPCION:
      case E.ALERTA:
        if (lado === 'DENTRO') regresar();
        else evaluarTiempo();
        break;
      default: // ESCALADA: solo la cierra la fundación; las posiciones se guardan pero no cambian el estado.
        break;
    }
  };

  switch (evento.tipo) {
    case 'POSICION': {
      // Una posición atrasada (llegó después de otra más nueva) no decide nada.
      if (s.ultimo_reporte != null && t < s.ultimo_reporte) break;
      s.ultimo_reporte = t;
      if (s.estado === E.SIN_SENAL) {
        const previo = s.estado_previo ?? E.DENTRO;
        s.estado_previo = null;
        ir(previo, 'SEÑAL_RECUPERADA');
      }
      // Posiciones de baja calidad: se guardan como evidencia, pero no cambian el estado.
      if (!evento.valida) {
        evaluarTiempo();
        break;
      }
      aplicarLado(clasificar(evento.distancia_m, evento.error_m, evento.radio_m, p.usar_histeresis));
      break;
    }

    case 'TICK':
    case 'EXCEPCION':
      evaluarTiempo();
      if (
        evento.tipo === 'TICK' &&
        s.estado !== E.SIN_SENAL &&
        s.ultimo_reporte != null &&
        t - s.ultimo_reporte >= p.min_sin_senal * MIN
      ) {
        s.estado_previo = s.estado;
        ir(E.SIN_SENAL, 'SIN_REPORTES');
      }
      break;

    case 'CONEXION':
      if ((evento.conexion === 'deviceOffline' || evento.conexion === 'deviceUnknown') && s.estado !== E.SIN_SENAL) {
        s.estado_previo = s.estado;
        ir(E.SIN_SENAL, `EVENTO_${evento.conexion}`);
      }
      break;

    case 'RESPUESTA_ADOPTANTE':
      // La respuesta cierra la ALERTA y abre una nueva ventana de umbral; si sigue fuera sin excepción, volverá a alertar.
      if (efectivo() === E.ALERTA) {
        acciones.push({ tipo: 'RESOLVER_ALERTA', causa: 'RESPUESTA_ADOPTANTE' });
        s.alerta_desde = null;
        s.fuera_desde = t;
        if (excepcionVigente(t)) cambiarEfectivo(E.EXCEPCION, 'RESPUESTA_ADOPTANTE');
        else cambiarEfectivo(E.FUERA_EN_GRACIA, 'RESPUESTA_ADOPTANTE');
      }
      break;

    case 'CIERRE_FUNDACION':
      if (efectivo() === E.ALERTA || efectivo() === E.ESCALADA) {
        acciones.push({ tipo: 'RESOLVER_ALERTA', causa: 'CIERRE_FUNDACION' });
        s.alerta_desde = null;
        s.fuera_desde = null;
        cambiarEfectivo(E.DENTRO, 'CIERRE_FUNDACION');
      }
      break;

    default:
      throw new Error(`Evento desconocido: ${evento.tipo}`);
  }

  return { estado: s, transiciones, acciones };
}
