import express from 'express';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './api/rutas.js';
import { ingesta } from './ingesta/ingesta.js';
import { tick } from './motor/servicio.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.use('/ingesta', ingesta);
app.use('/api', api);
app.get('/salud', (_req, res) => res.json({ ok: true }));

// En producción la API sirve también la web compilada (web/dist).
const web = join(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(web)) {
  app.use(express.static(web));
  app.get(/^\/(?!api|ingesta).*/, (_req, res) => res.sendFile(join(web, 'index.html')));
}

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
