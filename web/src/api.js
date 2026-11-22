import { useEffect, useRef, useState } from 'react';

async function pedir(ruta, opciones = {}) {
  const r = await fetch(`/api${ruta}`, {
    ...opciones,
    headers: opciones.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const datos = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  // Sesión vencida o revocada: la raíz de la app vuelve a la pantalla de inicio de sesión.
  if (r.status === 401 && !ruta.startsWith('/auth/')) window.dispatchEvent(new Event('sesion-vencida'));
  if (!r.ok) throw new Error(datos?.error ?? `Error ${r.status}`);
  return datos;
}

export const api = {
  iniciarSesion: (correo, contrasena) => pedir('/auth/iniciar', { method: 'POST', body: { correo, contrasena, cliente: 'WEB' } }),
  salir: () => pedir('/auth/salir', { method: 'POST' }),
  yo: () => pedir('/auth/yo'),
  cambiarContrasena: (actual, nueva) => pedir('/auth/contrasena', { method: 'POST', body: { actual, nueva } }),
  politica: () => pedir('/politica'),
  consentimiento: (id) => pedir(`/adopciones/${id}/consentimiento`),
  registrarConsentimiento: (id, evidencia) => pedir(`/adopciones/${id}/consentimiento`, { method: 'POST', body: { evidencia } }),
  revocarConsentimiento: (id, motivo) => pedir(`/adopciones/${id}/consentimiento`, { method: 'DELETE', body: { motivo } }),
  crearAcceso: (id, correo, contrasena) => pedir(`/adopciones/${id}/acceso`, { method: 'POST', body: { correo, contrasena } }),
  usuarios: () => pedir('/usuarios'),
  crearUsuario: (u) => pedir('/usuarios', { method: 'POST', body: u }),
  activarUsuario: (id, activo) => pedir(`/usuarios/${id}`, { method: 'PATCH', body: { activo } }),
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
  acusarEntrega: (id) => pedir(`/notificaciones/${id}/entregada`, { method: 'POST' }),
  marcarLeida: (id) => pedir(`/notificaciones/${id}/leida`, { method: 'POST' }),
  latencia: () => pedir('/metricas/latencia'),
  parametros: () => pedir('/parametros'),
  guardarParametros: (p) => pedir('/parametros', { method: 'PUT', body: p }),
};

/**
 * Se suscribe a los eventos del servidor (SSE). Devuelve un contador que sube con cada cambio
 * (con un pequeño retardo para agrupar ráfagas), útil como dependencia de los efectos que recargan datos.
 */
export function useEventosServidor(alNotificar) {
  const [version, setVersion] = useState(0);
  const [conectado, setConectado] = useState(false);
  const alNotificarRef = useRef(alNotificar);
  alNotificarRef.current = alNotificar;

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
    fuente.addEventListener('alerta', subir);
    // Cada notificación a la fundación se acusa al llegar: así se mide la latencia de la alerta (OE5).
    fuente.addEventListener('notificacion', (e) => {
      const n = JSON.parse(e.data);
      api.acusarEntrega(n.id).catch(() => {});
      subir();
      alNotificarRef.current?.(n);
    });
    return () => {
      clearTimeout(temporizador);
      fuente.close();
    };
  }, []);

  return { version, conectado };
}
