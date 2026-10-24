import { useEffect, useState } from 'react';
import { api } from '../api.js';

const CAMPOS = [
  { k: 'radio_m_defecto', etiqueta: 'Radio por defecto de la zona segura', unidad: 'm', paso: 10, ayuda: 'No puede ser menor que el error esperado del GPS.' },
  { k: 'umbral_permanencia_min', etiqueta: 'Umbral de permanencia', unidad: 'min', paso: 0.5, ayuda: 'Tiempo continuo fuera de la zona antes de alertar.' },
  { k: 'horas_para_escalar', etiqueta: 'Horas para escalar', unidad: 'h', paso: 0.05, ayuda: 'Si el adoptante no responde en este tiempo, el caso pasa a la fundación.' },
  { k: 'min_sin_senal', etiqueta: 'Minutos sin reporte para «sin señal»', unidad: 'min', paso: 0.5, ayuda: 'Ajústelo al intervalo de reporte del collar (Traccar: status.timeout).' },
  { k: 'error_m_respaldo', etiqueta: 'Error GPS de respaldo (p95)', unidad: 'm', paso: 1, ayuda: 'Se usa cuando el collar no reporta precisión. Valor final: medición en Cali (H3).' },
];

export default function Parametros({ onGuardado }) {
  const [p, setP] = useState(null);
  const [mensaje, setMensaje] = useState(null);

  useEffect(() => {
    api.parametros().then(setP);
  }, []);

  if (!p) return <div className="pagina"><p className="tenue">Cargando…</p></div>;

  const guardar = async (e) => {
    e.preventDefault();
    setMensaje(null);
    try {
      const nuevo = await api.guardarParametros(p);
      setP({ ...p, ...nuevo });
      setMensaje({ ok: true, texto: 'Parámetros guardados. El motor los usa desde la próxima evaluación.' });
      onGuardado?.();
    } catch (err) {
      setMensaje({ ok: false, texto: err.message });
    }
  };

  return (
    <div className="pagina estrecha">
      <h2>Parámetros del motor</h2>
      <p className="tenue">{p.fundacion}. Valores de demostración: los definitivos salen de la medición del error (hito H3) y de la fundación.</p>
      <form className="formulario" onSubmit={guardar}>
        {CAMPOS.map((c) => (
          <label key={c.k} className="campo">
            <span>{c.etiqueta}</span>
            <span className="con-unidad">
              <input type="number" step={c.paso} value={p[c.k]} onChange={(e) => setP({ ...p, [c.k]: e.target.value })} />
              <span className="tenue">{c.unidad}</span>
            </span>
            <small className="tenue">{c.ayuda}</small>
          </label>
        ))}
        <label className="interruptor">
          <input type="checkbox" checked={p.usar_histeresis} onChange={(e) => setP({ ...p, usar_histeresis: e.target.checked })} />
          Usar histéresis (desactívela solo para comparar alertas con y sin histéresis)
        </label>
        <p className="tenue pequeno">
          Regla de bienestar: el collar (≈ 71 g) no puede superar el 2 % del peso, así que solo se asigna a animales de {Number(p.peso_minimo_kg).toFixed(2)} kg o más.
        </p>
        <button className="boton primario">Guardar</button>
        {mensaje && <p className={mensaje.ok ? 'exito' : 'error'}>{mensaje.texto}</p>}
      </form>
    </div>
  );
}
