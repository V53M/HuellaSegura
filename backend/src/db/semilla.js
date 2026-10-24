// Datos de demostración: una fundación ficticia y tres adopciones en Cali con collares simulados.
// Parámetros cortos para ver el ciclo completo en minutos; la fundación los cambia desde la web.
import { pool, enTransaccion } from './db.js';

const ADOPCIONES = [
  { animal: 'Luna', especie: 'PERRO', peso: 12.5, adoptante: 'Adoptante de prueba 1', barrio: 'San Antonio', lat: 3.4497, lon: -76.5393, uid: 'sim-001' },
  { animal: 'Tomás', especie: 'GATO', peso: 4.2, adoptante: 'Adoptante de prueba 2', barrio: 'Granada', lat: 3.4610, lon: -76.5320, uid: 'sim-002' },
  { animal: 'Canela', especie: 'PERRO', peso: 8.0, adoptante: 'Adoptante de prueba 3', barrio: 'El Ingenio', lat: 3.3880, lon: -76.5240, uid: 'sim-003' },
];

await enTransaccion(async (c) => {
  const { rowCount } = await c.query(`SELECT 1 FROM fundacion LIMIT 1`);
  if (rowCount) {
    console.log('La base ya tiene datos; no se siembra de nuevo.');
    return;
  }
  const { rows: [f] } = await c.query(`INSERT INTO fundacion (nombre) VALUES ('Fundación de demostración') RETURNING id`);
  await c.query(
    `INSERT INTO parametros_fundacion (fundacion_id, radio_m_defecto, umbral_permanencia_min, horas_para_escalar, min_sin_senal, error_m_respaldo)
     VALUES ($1, 120, 2, 0.05, 1.5, 30)`,
    [f.id],
  );
  for (const a of ADOPCIONES) {
    const { rows: [an] } = await c.query(
      `INSERT INTO animal (fundacion_id, nombre, especie, peso_kg) VALUES ($1, $2, $3, $4) RETURNING id`,
      [f.id, a.animal, a.especie, a.peso],
    );
    const { rows: [ad] } = await c.query(
      `INSERT INTO adoptante (nombre, telefono, direccion) VALUES ($1, '300 000 0000', $2) RETURNING id`,
      [a.adoptante, `Barrio ${a.barrio}, Cali`],
    );
    const { rows: [adop] } = await c.query(
      `INSERT INTO adopcion (animal_id, adoptante_id, fundacion_id) VALUES ($1, $2, $3) RETURNING id`,
      [an.id, ad.id, f.id],
    );
    await c.query(
      `INSERT INTO zona_segura (adopcion_id, centro, radio_m) VALUES ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, 120)`,
      [adop.id, a.lat, a.lon],
    );
    await c.query(`INSERT INTO estado_seguimiento (adopcion_id) VALUES ($1)`, [adop.id]);
    await c.query(`INSERT INTO dispositivo (dispositivo_uid, modelo) VALUES ($1, 'Simulador')`, [a.uid]);
    await c.query(`INSERT INTO asignacion_dispositivo (dispositivo_uid, adopcion_id, desde) VALUES ($1, $2, now() - interval '1 day')`, [a.uid, adop.id]);
  }
  console.log(`Semilla lista: ${ADOPCIONES.length} adopciones (${ADOPCIONES.map((a) => a.uid).join(', ')}).`);
});
await pool.end();
