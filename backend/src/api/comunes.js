// Utilidades compartidas por los routers de la API.
export class ErrorApi extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

export const manejar = (fn) => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (r !== undefined) res.json(r);
  } catch (err) {
    if (err instanceof ErrorApi) return res.status(err.status).json({ error: err.message });
    console.error('[api]', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

export const numero = (v, nombre, { min = -Infinity, max = Infinity } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ErrorApi(400, `${nombre} inválido`);
  return n;
};

/** IP y agente de la petición, para la evidencia de sesiones y consentimientos. */
export const origen = (req) => ({ ip: req.ip ?? null, agente: req.get('User-Agent') ?? null });
