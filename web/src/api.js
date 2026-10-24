import { useEffect, useRef, useState } from 'react';

async function pedir(ruta, opciones = {}) {
  const r = await fetch(`/api${ruta}`, {
    ...opciones,
    headers: opciones.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const datos = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) throw new Error(datos?.error ?? `Error ${r.status}`);
  return datos;
}

export const api = {
  seguimiento: () => pedir('/seguimiento'),
  adopcion: (id) => pedir(`/adopciones/${id}`),
  recorrido: (id, horas = 6) => pedir(`/adopciones/${id}/recorrido?horas=${horas}`),
  crearAdopcion: (datos) => pedir('/adopciones', { method: 'POST', body: datos }),
  guardarZona: (id, zona) => pedir(`/adopciones/${id}/zona`, { method: 'PUT', body: zona }),
  geocodificar: (q) => pedir(`/geocodificar?${new URLSearchParams({ q })}`),
  declararExcepcion: (id, motivo, duracion_min) =>
    pedir(`/adopciones/${id}/excepciones`, { method: 'POST', body: { motivo, duracion_min } }),
  alertas: (abiertas) => pedir(`/alertas${abiertas ? '?abiertas=1' : ''}`),
  responderAlerta: (id, respuesta) => pedir(`/alertas/${id}/responder`, { method: 'POST', body: { respuesta } }),
  cerrarAlerta: (id, resultado_verificacion) =>
    pedir(`/alertas/${id}/cerrar`, { method: 'POST', body: { resultado_verificacion } }),
  parametros: () => pedir('/parametros'),
  guardarParametros: (p) => pedir('/parametros', { method: 'PUT', body: p }),
};

/**
 * Se suscribe a los eventos del servidor (SSE). Devuelve un contador que sube con cada cambio
 * (con un pequeño retardo para agrupar ráfagas), útil como dependencia de los efectos que recargan datos.
 */
export function useEventosServidor(alAlerta) {
  const [version, setVersion] = useState(0);
  const [conectado, setConectado] = useState(false);
  const alAlertaRef = useRef(alAlerta);
  alAlertaRef.current = alAlerta;

  useEffect(() => {
    const fuente = new EventSource('/api/eventos');
    let temporizador = null;
    const subir = () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => setVersion((v) => v + 1), 250);
    };
    fuente.onopen = () => setConectado(true);
    fuente.onerror = () => setConectado(false);
    fuente.addEventListener('seguimiento', subir);
    fuente.addEventListener('alerta', (e) => {
      subir();
      alAlertaRef.current?.(JSON.parse(e.data));
    });
    return () => {
      clearTimeout(temporizador);
      fuente.close();
    };
  }, []);

  return { version, conectado };
}
