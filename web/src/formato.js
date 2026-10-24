import { amber, amberDark, blue, blueDark, green, greenDark, plum, plumDark, red, redDark, slate, slateDark } from '@radix-ui/colors';
import { Cat, Dog, PawPrint } from '@phosphor-icons/react';

// color: punto del estado (paso 9 de Radix). texto: solo los estados que piden atención llevan texto de color (paso 11).
export const ESTADOS = {
  DENTRO: { nombre: 'Dentro de la zona', corto: 'Dentro', color: 'var(--estado-dentro)' },
  FUERA_EN_GRACIA: { nombre: 'Fuera, en periodo de gracia', corto: 'Fuera (gracia)', color: 'var(--estado-gracia)', texto: 'var(--amber-11)' },
  EXCEPCION: { nombre: 'Salida con excepción declarada', corto: 'Excepción', color: 'var(--estado-excepcion)' },
  ALERTA: { nombre: 'Alerta: superó el umbral', corto: 'Alerta', color: 'var(--estado-alerta)', texto: 'var(--red-11)' },
  ESCALADA: { nombre: 'Escalada a la fundación', corto: 'Escalada', color: 'var(--estado-escalada)', texto: 'var(--plum-11)' },
  'SIN_SEÑAL': { nombre: 'Sin señal del collar', corto: 'Sin señal', color: 'var(--estado-sinsenal)', texto: 'var(--slate-11)' },
};

/** Colores hex para MapLibre, que no entiende variables CSS ni colores display-p3. Mismos pasos de Radix que en estilos.css. */
export function coloresEstado(oscuro) {
  const [g, a, b, r, p, s] = oscuro
    ? [greenDark.green9, amberDark.amber9, blueDark.blue9, redDark.red9, plumDark.plum9, slateDark.slate9]
    : [green.green9, amber.amber9, blue.blue9, red.red9, plum.plum9, slate.slate9];
  return { DENTRO: g, FUERA_EN_GRACIA: a, EXCEPCION: b, ALERTA: r, ESCALADA: p, 'SIN_SEÑAL': s };
}

export const CAUSAS = {
  SALIDA_DE_ZONA: 'Salió de la zona segura',
  SALIDA_CON_EXCEPCION: 'Salió con una excepción vigente',
  REGRESO_A_ZONA: 'Regresó a la zona segura',
  EXCEPCION_DECLARADA: 'El adoptante declaró una excepción',
  EXCEPCION_VENCIDA: 'Venció la excepción estando fuera',
  UMBRAL_SUPERADO: 'Superó el umbral de permanencia',
  SIN_RESPUESTA_ADOPTANTE: 'El adoptante no respondió a tiempo',
  RESPUESTA_ADOPTANTE: 'El adoptante respondió la alerta',
  CIERRE_FUNDACION: 'La fundación cerró el caso',
  SIN_REPORTES: 'El collar dejó de reportar',
  'SEÑAL_RECUPERADA': 'El collar volvió a reportar',
  EVENTO_deviceOffline: 'Traccar: dispositivo desconectado',
  EVENTO_deviceUnknown: 'Traccar: estado desconocido',
};

export function causa(c) {
  if (CAUSAS[c]) return CAUSAS[c];
  if (c?.endsWith('_SIN_SEÑAL')) return `${causa(c.slice(0, -'_SIN_SEÑAL'.length))} (sin señal)`;
  return c;
}

export const MOTIVOS = { PASEO: 'Paseo', VETERINARIA: 'Veterinaria', VIAJE: 'Viaje' };
export const ESPECIES = { PERRO: Dog, GATO: Cat, OTRO: PawPrint };

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
export function hace(fecha) {
  if (!fecha) return '—';
  const s = (new Date(fecha).getTime() - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(Math.round(s), 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}

export const fechaHora = (f) =>
  f ? new Date(f).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'medium', hour12: false }) : '—';

export function duracion(desde, hasta = Date.now()) {
  if (!desde) return '—';
  const s = Math.max(0, Math.round((new Date(hasta) - new Date(desde)) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  const h = Math.floor(s / 3600);
  if (h < 48) return `${h} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(h / 24)} días ${h % 24} h`;
}

/** Polígono GeoJSON que aproxima un círculo de radio en metros. */
export function circulo(lon, lat, radioM, pasos = 64) {
  const coords = [];
  for (let i = 0; i <= pasos; i++) {
    const a = (i / pasos) * 2 * Math.PI;
    coords.push([
      lon + (radioM * Math.sin(a)) / (111_320 * Math.cos((lat * Math.PI) / 180)),
      lat + (radioM * Math.cos(a)) / 111_320,
    ]);
  }
  return { type: 'Polygon', coordinates: [coords] };
}
