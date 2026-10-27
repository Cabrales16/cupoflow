/* ============================================================================
 * store.js — "Base de datos" simulada persistida en localStorage.
 *
 * Todas las apps (índice, formulario, panel, portal) comparten la misma base
 * porque se sirven desde el mismo origen. Uso desde los handlers:
 *
 *   DemoKit.read(db => db.solicitudes.filter(...))      // solo lectura
 *   DemoKit.tx(db => { db.solicitudes.push(x); return x; })  // lectura+escritura
 *
 * `tx` recarga el estado desde localStorage en cada llamada (así funcionan
 * varias pestañas a la vez) y lo guarda al terminar si no lanzó excepción.
 * ========================================================================== */
(function () {
  'use strict';
  const O = window.DemoKit;
  const KEY = 'demo-db';
  const SEED_VERSION = 3;              // súbelo cuando cambie la estructura de la semilla

  function seed() {
    const db = { _v: SEED_VERSION, _seededAt: new Date().toISOString() };
    O.buildSeed(db);                                     // seed.js
    return db;
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (_) {}
    if (raw) {
      try {
        const db = JSON.parse(raw);
        if (db && db._v === SEED_VERSION) return runHooks(db, true);
      } catch (_) {}
    }
    const db = runHooks(seed(), false);
    save(db);
    return db;
  }

  // Las extensiones de semilla (onSeed) de CADA app se ejecutan una vez por base de datos,
  // la primera vez que esa app la carga (así no importa qué página sembró la base primero).
  function runHooks(db, persist) {
    const app = window.__DEMO_APP__ || 'app';
    db._hooks = db._hooks || {};
    if (!db._hooks[app]) {
      db._hooks[app] = true;
      O._seedHooks.forEach(fn => fn(db));
      if (persist) save(db);
    }
    return db;
  }

  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch (e) { console.error('[Demo] No se pudo guardar en localStorage (¿cuota llena?):', e.message); throw e; }
  }

  O.read = fn => fn(load());
  O.tx = fn => { const db = load(); const r = fn(db); save(db); return r; };

  /** Borra todos los datos de la demo (base + sesiones + borradores) y recarga. */
  O.resetAll = function (reload) {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      keys.forEach(k => localStorage.removeItem(k));
      sessionStorage.clear();
    } catch (_) {}
    if (reload !== false) location.reload();
  };

  O.db = load;          // atajo de solo lectura (no persiste cambios)
})();
