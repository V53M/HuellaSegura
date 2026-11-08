// Límite de intentos fallidos de inicio de sesión, en memoria (una sola instancia de la API en el piloto).
export function crearLimitador({ maxFallos = 5, ventanaMs = 15 * 60_000, ahora = Date.now } = {}) {
  const fallos = new Map(); // clave → marcas de tiempo de los fallos dentro de la ventana
  let ultimaPoda = ahora();

  const vigentes = (clave) => {
    const desde = ahora() - ventanaMs;
    const lista = (fallos.get(clave) ?? []).filter((t) => t > desde);
    if (lista.length) fallos.set(clave, lista);
    else fallos.delete(clave);
    return lista;
  };

  // Sin poda, las claves de correos o IPs que nunca vuelven a consultarse crecen para siempre en memoria.
  const podar = () => {
    if (ahora() - ultimaPoda < ventanaMs) return;
    ultimaPoda = ahora();
    const desde = ahora() - ventanaMs;
    for (const [clave, lista] of fallos) {
      const v = lista.filter((t) => t > desde);
      if (v.length) fallos.set(clave, v);
      else fallos.delete(clave);
    }
  };

  return {
    /** Segundos que faltan para poder intentar de nuevo; 0 si se puede intentar ya. */
    espera(clave) {
      podar();
      const lista = vigentes(clave);
      if (lista.length < maxFallos) return 0;
      return Math.ceil((lista[0] + ventanaMs - ahora()) / 1000);
    },
    fallo(clave) {
      podar();
      fallos.set(clave, [...vigentes(clave), ahora()]);
    },
    exito(clave) {
      fallos.delete(clave);
    },
  };
}
