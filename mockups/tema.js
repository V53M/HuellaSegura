/* Tema claro/oscuro de los mockups. Igual que web/src/tema.js: la paleta
   Radix se activa con la clase .dark-theme en <html>. Arranca según el
   sistema y permite forzar el modo con el botón flotante. */

const CLAVE = 'hs-mockup-tema';
const consulta = matchMedia('(prefers-color-scheme: dark)');

function guardado() {
  try { return localStorage.getItem(CLAVE); } catch { return null; }
}

/** Forzar tema al abrir: mockups/index.html?tema=oscuro (o claro). */
function forzado() {
  const t = new URLSearchParams(location.search).get('tema');
  return t === 'oscuro' || t === 'claro' ? t : null;
}

function aplicar(modo) {
  const oscuro = modo ? modo === 'oscuro' : consulta.matches;
  document.documentElement.classList.toggle('dark-theme', oscuro);
  const btn = document.getElementById('conmutador-tema');
  if (btn) {
    btn.innerHTML = oscuro
      ? '&#9789; Tema oscuro'
      : '&#9788; Tema claro';
  }
}

function iniciar() {
  const inicial = forzado() || guardado();
  aplicar(inicial);
  consulta.addEventListener('change', () => { if (!inicial) aplicar(); });

  // Botón flotante: alterna y recuerda la elección.
  const btn = document.createElement('button');
  btn.id = 'conmutador-tema';
  btn.className = 'conmutador-tema';
  btn.type = 'button';
  btn.addEventListener('click', () => {
    const oscuro = document.documentElement.classList.contains('dark-theme');
    const nuevo = oscuro ? 'claro' : 'oscuro';
    try { localStorage.setItem(CLAVE, nuevo); } catch { /* modo privado */ }
    aplicar(nuevo);
  });
  document.body.appendChild(btn);
  aplicar(inicial);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}
