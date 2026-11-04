// Crea una cuenta de la fundación desde la terminal (por ejemplo, el primer administrador del piloto).
//   npm run crear-usuario -- --correo ana@fundacion.org --nombre "Ana Pérez" --rol ADMIN_FUNDACION --fundacion 1
// La contraseña se pide por la terminal para que no quede en el historial del shell.
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { pool } from './db.js';
import { LARGO_MINIMO, hashContrasena } from '../auth/contrasenas.js';

const { values: v } = parseArgs({
  options: {
    correo: { type: 'string' },
    nombre: { type: 'string' },
    rol: { type: 'string', default: 'ADMIN_FUNDACION' },
    fundacion: { type: 'string' },
  },
});
if (!v.correo || !v.nombre || !v.fundacion || !['ADMIN_FUNDACION', 'PERSONAL_FUNDACION'].includes(v.rol)) {
  console.error('Uso: npm run crear-usuario -- --correo <correo> --nombre <nombre> --fundacion <id> [--rol ADMIN_FUNDACION|PERSONAL_FUNDACION]');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const contrasena = process.env.CONTRASENA ?? (await rl.question(`Contraseña (mínimo ${LARGO_MINIMO} caracteres): `));
rl.close();

try {
  const { rows: [u] } = await pool.query(
    `INSERT INTO usuario (correo, nombre, rol, fundacion_id, hash_contrasena) VALUES (lower($1), $2, $3, $4, $5) RETURNING id, correo, rol`,
    [v.correo.trim(), v.nombre.trim(), v.rol, Number(v.fundacion), await hashContrasena(contrasena)],
  );
  console.log(`Usuario creado: ${u.correo} (${u.rol}), id ${u.id}`);
} catch (err) {
  console.error(err.code === '23505' ? 'Ese correo ya está en uso.' : err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
