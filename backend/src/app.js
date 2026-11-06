// Aplicación Express sin arrancar: la usan server.js y las pruebas de integración.
import express from 'express';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './api/rutas.js';
import { auth } from './api/auth.js';
import { movil } from './api/movil.js';
import { ingesta } from './ingesta/ingesta.js';

export const app = express();
// Detrás de un proxy (Nginx con HTTPS) req.ip debe ser la del cliente, no la del proxy.
if (process.env.DETRAS_DE_PROXY === '1') app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.use('/ingesta', ingesta);
app.use('/api/auth', auth);
app.use('/api/movil', movil);
app.use('/api', api);
app.get('/salud', (_req, res) => res.json({ ok: true }));

// En producción la API sirve también la web compilada (web/dist).
const web = join(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(web)) {
  app.use(express.static(web));
  app.get(/^\/(?!api|ingesta).*/, (_req, res) => res.sendFile(join(web, 'index.html')));
}

