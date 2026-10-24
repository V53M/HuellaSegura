import pg from 'pg';

// BIGINT (ids) como número de JS: no habrá más de 2^53 filas en el prototipo.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));

export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://huellasegura:huellasegura_local@localhost:5433/huellasegura',
});

export const consulta = (texto, valores) => pool.query(texto, valores);

/** Ejecuta fn(cliente) dentro de una transacción. */
export async function enTransaccion(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    cliente.release();
  }
}
