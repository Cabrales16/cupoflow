/* ============================================================================
 * shim.js — Emulación de `google.script.run` / `google.script.host` /
 * `google.script.url` para ejecutar los frontends de Apps Script SIN modificar
 * su lógica, como sitio estático.
 *
 * Cada llamada `google.script.run.withSuccessHandler(ok).withFailureHandler(ko).apiXxx(...)`
 * se despacha a `DemoKit.handlers.apiXxx(...)` (backend simulado en el navegador).
 * Los handlers pueden ser síncronos o devolver una Promise.
 * ========================================================================== */
(function () {
  'use strict';

  const DemoKit = (window.DemoKit = window.DemoKit || {});
  DemoKit.handlers = DemoKit.handlers || {};
  DemoKit.latency = { min: 120, max: 320 };   // ms simulados de "red"
  DemoKit.trace = /[?&]trace=1/.test(location.search);

  const rnd = (a, b) => a + Math.random() * (b - a);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  DemoKit.sleep = sleep;

  // Apps Script serializa los argumentos y resultados (JSON). Se imita para evitar
  // compartir referencias entre el "servidor" y el "cliente".
  function clone(v) {
    if (v === undefined) return null;
    if (v instanceof Date) return v.toISOString();
    try { return JSON.parse(JSON.stringify(v)); } catch (_) { return v; }
  }

  function dispatch(name, args, ok, ko, userObj) {
    const h = DemoKit.handlers[name];
    const started = performance.now();
    (async () => {
      await sleep(rnd(DemoKit.latency.min, DemoKit.latency.max));
      if (typeof h !== 'function') {
        throw new Error('[Demo] La función de servidor "' + name + '" no está implementada en el backend simulado.');
      }
      return h.apply(null, args.map(clone));
    })().then(res => {
      if (DemoKit.trace) console.log('[gas]', name, args, '→', res, Math.round(performance.now() - started) + 'ms');
      if (ok) { try { ok(clone(res), userObj); } catch (e) { console.error('[Demo] Error en successHandler de ' + name, e); } }
    }).catch(err => {
      const e = err instanceof Error ? err : new Error(String(err));
      console.warn('[gas] ' + name + ' falló:', e.message);
      if (ko) { try { ko(e, userObj); } catch (e2) { console.error('[Demo] Error en failureHandler de ' + name, e2); } }
      else console.error('[gas] Excepción sin failureHandler en ' + name + ':', e.message);
    });
  }

  function runner(ok, ko, userObj) {
    return new Proxy({}, {
      get(_, prop) {
        if (prop === 'withSuccessHandler') return f => runner(f, ko, userObj);
        if (prop === 'withFailureHandler') return f => runner(ok, f, userObj);
        if (prop === 'withUserObject') return o => runner(ok, ko, o);
        if (typeof prop !== 'string') return undefined;
        return (...args) => dispatch(prop, args, ok, ko, userObj);
      }
    });
  }

  window.google = window.google || {};
  google.script = google.script || {};
  google.script.run = runner(null, null, undefined);
  google.script.host = {
    close() { console.info('[Demo] google.script.host.close()'); },
    setHeight() {}, setWidth() {},
    origin: location.origin,
    editor: { focus() {} }
  };
  google.script.url = {
    getLocation(cb) {
      const parameter = {}, parameters = {};
      new URLSearchParams(location.search).forEach((v, k) => {
        parameter[k] = v; (parameters[k] = parameters[k] || []).push(v);
      });
      cb({ hash: (location.hash || '').replace(/^#/, ''), parameter, parameters });
    }
  };

  // ── Utilidades varias para los mocks ────────────────────────────────────────
  DemoKit.uuid = function () {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  };
  DemoKit.token = () => (DemoKit.uuid() + DemoKit.uuid()).replace(/-/g, '');
  DemoKit.pad = n => String(n).padStart(2, '0');
  DemoKit.ymd = d => { d = new Date(d); return d.getFullYear() + '-' + DemoKit.pad(d.getMonth() + 1) + '-' + DemoKit.pad(d.getDate()); };
  DemoKit.ymdhms = d => { d = new Date(d); return DemoKit.ymd(d) + ' ' + DemoKit.pad(d.getHours()) + ':' + DemoKit.pad(d.getMinutes()) + ':' + DemoKit.pad(d.getSeconds()); };
  DemoKit.dmy = d => { d = new Date(d); return DemoKit.pad(d.getDate()) + '/' + DemoKit.pad(d.getMonth() + 1) + '/' + d.getFullYear(); };
  DemoKit.addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  DemoKit.money = n => '$' + Number(n || 0).toLocaleString('es-CO');
  DemoKit.norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  /** Genera un PDF mínimo (1 página, texto) y devuelve una URL blob. */
  DemoKit.demoPdfUrl = function (title, lines) {
    const esc = t => String(t).replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7E]/g, c => {
      const map = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ñ': 'n', 'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'Ñ': 'N', 'ü': 'u', '—': '-', '–': '-', '·': '-', '¿': '?', '¡': '!' };
      return map[c] || '?';
    });
    const all = [title].concat(lines || []);
    let y = 780, content = 'BT /F1 18 Tf 50 ' + y + ' Td (' + esc(all[0]) + ') Tj ET\n';
    for (let i = 1; i < all.length; i++) { y -= 22; content += 'BT /F1 11 Tf 50 ' + y + ' Td (' + esc(all[i]) + ') Tj ET\n'; }
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      '<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ];
    let pdf = '%PDF-1.4\n', offs = [];
    objs.forEach((o, i) => { offs.push(pdf.length); pdf += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    const xref = pdf.length;
    pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    pdf += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    return URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
  };

  /** Registro global de hooks: onSeed(fn) permite a cada app extender los datos semilla. */
  DemoKit._seedHooks = [];
  DemoKit.onSeed = fn => DemoKit._seedHooks.push(fn);
  DemoKit._readyHooks = [];
  DemoKit.onReady = fn => DemoKit._readyHooks.push(fn);
})();
