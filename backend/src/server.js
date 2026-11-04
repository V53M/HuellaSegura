import { app } from './app.js';
import { tick } from './motor/servicio.js';
import { iniciarNotificaciones } from './notificaciones/notificaciones.js';

iniciarNotificaciones();

const puerto = Number(process.env.PORT ?? 3000);
app.listen(puerto, () => console.log(`HuellaSegura API en http://localhost:${puerto}`));

// Reloj del motor: umbrales, excepciones vencidas, escaladas y pérdida de señal no dependen de que lleguen posiciones.
const cadaMs = Number(process.env.TICK_SEGUNDOS ?? 15) * 1000;
let enCurso = false;
setInterval(async () => {
  if (enCurso) return;
  enCurso = true;
  try {
    await tick();
  } catch (err) {
    console.error('[tick]', err);
  } finally {
    enCurso = false;
  }
}, cadaMs);
