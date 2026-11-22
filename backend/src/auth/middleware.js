// Middlewares de autenticación y autorización por rol.
import { tokenDePeticion, usuarioDeToken } from './sesiones.js';

export const ROLES_FUNDACION = ['ADMIN_FUNDACION', 'PERSONAL_FUNDACION'];

/** Carga req.usuario; responde 401 si no hay sesión vigente. `buscar` es inyectable para las pruebas. */
export const autenticar = (buscar = usuarioDeToken) => async (req, res, next) => {
  try {
    const usuario = await buscar(tokenDePeticion(req));
    if (!usuario) return res.status(401).json({ error: 'Inicie sesión para continuar' });
    req.usuario = usuario;
    next();
  } catch (err) {
    next(err);
  }
};

/** Solo deja pasar a los roles indicados (403 al resto). */
export const exigirRol = (...roles) => (req, res, next) => {
  if (!req.usuario || !roles.flat().includes(req.usuario.rol)) {
    return res.status(403).json({ error: 'No tiene permiso para esta acción' });
  }
  next();
};
