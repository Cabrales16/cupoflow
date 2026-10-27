/* Backend simulado del Índice: getUrls() devuelve rutas relativas del propio sitio. */
(function () {
  const O = window.DemoKit;
  O.appConfig = { name: 'indice', title: 'Índice', quick: [], notes: ['Elige una de las 3 herramientas. Los manuales de usuario originales están alojados en un sitio externo y no forman parte de la demo.'], autoOpen: false };
  O.handlers.getUrls = () => ({ formulario: './formulario/index.html', panel: './panel/index.html', operaciones: './portal/index.html' });
})();
