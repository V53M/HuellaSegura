// Métricas de latencia de alerta para el OE5 (funciones puras).

/** Percentil con interpolación lineal entre rangos (el método por defecto de R y de NumPy). */
export function percentil(valores, p) {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const pos = (orden.length - 1) * p;
  const abajo = Math.floor(pos);
  const arriba = Math.ceil(pos);
  return orden[abajo] + (orden[arriba] - orden[abajo]) * (pos - abajo);
}

const segundos = (desde, hasta) =>
  desde == null || hasta == null ? null : (new Date(hasta).getTime() - new Date(desde).getTime()) / 1000;

/** Latencias de una notificación, en segundos. */
export function latencias(n) {
  return {
    deteccion_s: segundos(n.condicion_en, n.creada_en), // umbral cumplido → el motor lo detecta
    envio_s: segundos(n.condicion_en, n.enviada_en),
    entrega_s: segundos(n.condicion_en, n.entregada_en), // la latencia de alerta del OE5
    lectura_s: segundos(n.condicion_en, n.leida_en),
  };
}

const resumen = (valores) => ({
  n: valores.length,
  mediana_s: percentil(valores, 0.5),
  p95_s: percentil(valores, 0.95),
  max_s: valores.length ? Math.max(...valores) : null,
});

/**
 * Agrupa las notificaciones por destinatario y tipo.
 * `no_entregadas` cuenta las que nunca llegaron (sin token, error de FCM o sin acuse): también son un resultado.
 */
export function resumenLatencias(notificaciones) {
  const grupos = new Map();
  for (const n of notificaciones) {
    const clave = `${n.destinatario}·${n.tipo}`;
    if (!grupos.has(clave)) grupos.set(clave, { destinatario: n.destinatario, tipo: n.tipo, filas: [] });
    grupos.get(clave).filas.push(latencias(n));
  }
  return [...grupos.values()].map(({ destinatario, tipo, filas }) => {
    const entregas = filas.map((f) => f.entrega_s).filter((v) => v != null);
    return {
      destinatario,
      tipo,
      total: filas.length,
      no_entregadas: filas.length - entregas.length,
      deteccion: resumen(filas.map((f) => f.deteccion_s).filter((v) => v != null)),
      envio: resumen(filas.map((f) => f.envio_s).filter((v) => v != null)),
      entrega: resumen(entregas),
    };
  });
}
