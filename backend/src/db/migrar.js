import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const carpeta = join(dirname(fileURLToPath(import.meta.url)), 'migraciones');

const archivos = (await readdir(carpeta)).filter((f) => f.endsWith('.sql')).sort();
for (const archivo of archivos) {
  await pool.query(await readFile(join(carpeta, archivo), 'utf8'));
  console.log(`migración aplicada: ${archivo}`);
}
await pool.end();
