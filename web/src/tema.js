// Tema claro/oscuro según el sistema. Las escalas de Radix se activan con la clase .dark-theme en <html>.
const consulta = matchMedia('(prefers-color-scheme: dark)');

export const esOscuro = () => consulta.matches;

function aplicar() {
  document.documentElement.classList.toggle('dark-theme', consulta.matches);
}

aplicar();
consulta.addEventListener('change', aplicar);

/** Llama a fn(oscuro) cada vez que el sistema cambia de tema. Devuelve la función para dejar de escuchar. */
export function alCambiarTema(fn) {
  const manejador = () => fn(consulta.matches);
  consulta.addEventListener('change', manejador);
  return () => consulta.removeEventListener('change', manejador);
}
