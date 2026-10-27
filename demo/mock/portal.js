/* ============================================================================
 * portal.js — Backend SIMULADO del Portal de Consulta de Créditos (src/portal).
 *
 * Réplica de Codigo.js: mismos api*, mismos argumentos, misma forma de retorno y
 * mismos mensajes. Servicios externos simulados:
 *   - MySQL/JDBC + CacheService  → db.solicitudes en localStorage (sin caché: siempre datos frescos)
 *   - Hoja "Usuarios"/catálogos  → db.usuarios / db.centros / db.tiposSolicitud / ...
 *   - GmailApp                   → DemoKit.mail (bandeja simulada)
 *   - Sheets/Drive (export)      → archivo .xlsx real generado en el navegador (Blob)
 *   - PropertiesService          → db.notificacionesLeidas[email]
 * ========================================================================== */
(function () {
  'use strict';
  const O = window.DemoKit;
  const H = O.handlers;

  const ROL_ADMIN = 'ADMIN';
  const ROL_CONSULTAS = 'CONSULTAS';   // en el original se llama OPERACIONES.ROL_OPERACIONES (solo lectura)
  const ESTADOS_CREDITO = ['APROBADA', 'ACTIVA', 'VENCIDO', 'VENCIDA', 'POR_VENCER', 'BLOQUEADO_CORPORATIVO', 'BLOQUEADO_GERENCIA'];
  const DAY = 86400000;

  O.appConfig = {
    name: 'portal',
    title: 'Portal de Consulta',
    quick: [
      { email: 'admin@example.com', nombre: 'Alicia Administradora', rol: 'ADMIN', desc: 'Ve todo, marca perfiles y comenta' },
      { email: 'operaciones@example.com', nombre: 'Rafael Operaciones', rol: 'OPERACIONES', desc: 'Puede marcar perfil creado y comentar' },
      { email: 'consultas@example.com', nombre: 'Camila Consultas', rol: 'CONSULTAS', desc: 'Solo lectura (acciones de escritura denegadas)' },
      { email: 'comercial1@example.com', nombre: 'Esteban Comercial', rol: 'CONSULTAS', desc: 'Ejecutivo comercial: solo lectura' }
    ],
    notes: [
      'Prueba <b>Créditos → Exportar → Excel</b>: se genera un .xlsx real en tu navegador (en producción se crea una hoja de Google Sheets y se abre su enlace de exportación).',
      'Los cambios (perfil creado, comentarios) se guardan en la misma base local que usa el <b>Panel</b>: haz un cambio aquí y compruébalo allí.'
    ],
    autoOpen: true
  };

  // ── Utilidades de fecha ───────────────────────────────────────────────────
  const pad = O.pad;
  /** Interpreta 'YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss' o ISO como fecha LOCAL (evita desfases de zona horaria). */
  function parseDate(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    const s = String(v).trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  const dmy = v => { const d = parseDate(v); return d ? pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() : ''; };
  const parseDmy = s => { const p = String(s || '').split('/'); return p.length === 3 ? new Date(+p[2], +p[1] - 1, +p[0]) : null; };
  const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

  // ── Datos semilla específicos del portal (idempotente) ────────────────────
  // Ajusta vencimientos de documentos para que las notificaciones (vencidos en los últimos 30
  // días / por vencer en 15) tengan contenido siempre, y normaliza la vigencia al vocabulario
  // del original ('Vigente' | 'Por Vencer' | 'No Vigente').
  function ensurePortalSeed(db) {
    if (db._portalSeeded) return false;
    const hoy = startOfDay(new Date());
    const offsets = [-20, 3, -5, 9, 14, -28, 6, -12];
    let k = 0;
    (db.solicitudes || []).forEach(s => {
      if (!ESTADOS_CREDITO.includes(String(s.estado_codigo || '').toUpperCase())) return;
      if (k < offsets.length) s.fecha_venc_doc = O.ymd(new Date(hoy.getTime() + offsets[k++] * DAY));
      else {
        const fa = parseDate(s.fecha_aprobacion);
        const venc = fa ? new Date(startOfDay(fa).getTime() + 365 * DAY) : hoy;
        s.fecha_venc_doc = O.ymd(venc.getTime() > hoy.getTime() + 20 * DAY ? venc : new Date(hoy.getTime() + (40 + k++ * 9) * DAY));
      }
      const v = parseDate(s.fecha_venc_doc);
      if (!v) return;
      const dias = Math.ceil((startOfDay(v) - hoy) / DAY);
      s.vigencia_doc = dias < 0 ? 'No Vigente' : dias <= 15 ? 'Por Vencer' : 'Vigente';
    });
    db._portalSeeded = true;
    return true;
  }
  O.onSeed(db => { ensurePortalSeed(db); });
  // Si la base ya fue creada por otra app (índice/panel) antes de abrir el portal, se aplica aquí.
  function ensureSeed() { if (!O.read(db => !!db._portalSeeded)) O.tx(db => { ensurePortalSeed(db); }); }

  // ── Sesión ────────────────────────────────────────────────────────────────
  function session(token) { ensureSeed(); return O.getSession(token || ''); }
  const rolOf = s => String(s.rol || '').toUpperCase();

  // ── Mapeo solicitud → créditos virtuales (réplica de mapSolicitudToCreditos_) ──
  function computeAccion(estadoCodigo, fechaAprobacion) {
    let accion = String(estadoCodigo || '').trim().toUpperCase();
    const necesita = ['APROBADA', 'ACTIVA', 'POR_VENCER', 'VENCIDO', 'VENCIDA'].includes(accion);
    const fA = parseDate(fechaAprobacion);
    if (necesita && fA) {
      const dias = Math.ceil((startOfDay(fA).getTime() + 365 * DAY - startOfDay(new Date()).getTime()) / DAY);
      if (dias <= 0) return 'VENCIDO';
      if (dias <= 15) return 'POR_VENCER';
      if (['VENCIDO', 'VENCIDA', 'POR_VENCER'].includes(accion)) return 'ACTIVA';
    }
    return accion;
  }

  function creditosDe(db) {
    let creditos = [];
    (db.solicitudes || []).forEach(sol => {
      const estado = String(sol.estado_codigo || '').toUpperCase();
      if (!ESTADOS_CREDITO.includes(estado)) return;
      const accion = computeAccion(estado, sol.fecha_aprobacion);
      let cupos = {};
      try { if (sol.cupos_distribuidos_json && sol.cupos_distribuidos_json !== '{}') cupos = JSON.parse(sol.cupos_distribuidos_json); } catch (_) {}
      const cods = String(sol.centro_codigo || '').split(',').map(c => c.trim()).filter(Boolean);
      if (!Object.keys(cupos).length && cods.length) {
        const por = Math.floor((Number(sol.monto) || 0) / cods.length);
        cods.forEach(c => cupos[c] = por);
      }
      const rawPc = String(sol.perfil_creado || '').trim();
      let pcObj = null, pcBool = false;
      if (rawPc.startsWith('{')) { try { pcObj = JSON.parse(rawPc); } catch (_) { pcBool = rawPc.toUpperCase() === 'TRUE'; } }
      else pcBool = rawPc.toUpperCase() === 'TRUE' || rawPc === '1';
      Object.keys(cupos).forEach(cod => {
        const h = (db.centros || []).find(x => x.codigo === cod) || { nombre: cod };
        const monto = cupos[cod] || 0;
        creditos.push({
          _rowIdx: sol.uuid + '_' + cod,
          id: sol.codigo_solicitud + '_' + cod,
          solicitado_por: sol.ejecutivo_cuenta || '',
          razon_social: sol.razon_social || '',
          nit: sol.identificacion || '',
          centro: cod + ' - ' + (h.nombre || cod),
          centro_codigo: cod,
          monto: '$' + Number(monto).toLocaleString('es-CO'),
          monto_num: monto,
          fecha_aprobacion: dmy(sol.fecha_aprobacion),
          estado_credito: (accion === 'VENCIDA' || accion === 'VENCIDO') ? 'Vencido' :
                          (accion === 'POR VENCER' || accion === 'POR_VENCER') ? 'Por Vencer' :
                          (accion === 'BLOQUEADO CORPORATIVO' || accion === 'BLOQUEADO_CORPORATIVO') ? 'Bloqueado Corporativo' :
                          (accion === 'BLOQUEADO GERENCIA' || accion === 'BLOQUEADO_GERENCIA') ? 'Bloqueado Gerencia' : 'Activo',
          fecha_recibido_doc: dmy(sol.fecha_recibido_doc),
          fecha_venc_doc: dmy(sol.fecha_venc_doc),
          vigencia_doc: sol.vigencia_doc || 'Vigente',
          facturacion_electronica: sol.fact_email || '',
          aprobado_por: sol.aceptado_por || '',
          novedades: sol.comentarios || '',
          perfil_creado: (pcObj ? !!pcObj[cod] : pcBool) ? 'TRUE' : 'FALSE'
        });
      });
    });
    creditos.sort((a, b) => {
      const dA = (parseDmy(a.fecha_aprobacion) || 0), dB = (parseDmy(b.fecha_aprobacion) || 0);
      return (dB - dA) || String(b.id_credito || '').localeCompare(String(a.id_credito || ''));
    });
    return creditos;
  }

  /** Aplica los filtros de apiConsultarCreditos (mismo orden y semántica que el original). */
  function consultar(p) {
    return O.read(db => {
      let cr = creditosDe(db);
      if (p.busqueda) {
        const q = String(p.busqueda).toLowerCase();
        cr = cr.filter(c => (c.razon_social || '').toLowerCase().includes(q) || (c.nit || '').toLowerCase().includes(q) ||
          (c.centro || '').toLowerCase().includes(q) || (c.solicitado_por || '').toLowerCase().includes(q));
      }
      if (p.estado && p.estado !== 'TODOS') cr = cr.filter(c => String(c.estado_credito || '').toLowerCase() === String(p.estado).toLowerCase());
      if (p.centro && p.centro !== 'TODOS') {
        const h = String(p.centro).toLowerCase();
        cr = cr.filter(c => String(c.centro_codigo || '').toLowerCase() === h || String(c.centro || '').toLowerCase().includes(h));
      }
      if (p.vigencia && p.vigencia !== 'TODOS') cr = cr.filter(c => String(c.vigencia_doc || '').toLowerCase() === String(p.vigencia).toLowerCase());
      if (p.perfil && p.perfil !== 'TODOS') {
        const v = p.perfil === 'SI' ? 'TRUE' : 'FALSE';
        cr = cr.filter(c => String(c.perfil_creado || '').toUpperCase() === v);
      }
      if (p.fechaInicio || p.fechaFin) {
        const min = p.fechaInicio ? new Date(p.fechaInicio + 'T00:00:00') : null;
        const max = p.fechaFin ? new Date(p.fechaFin + 'T23:59:59') : null;
        cr = cr.filter(c => {
          const d = parseDmy(c.fecha_aprobacion);
          if (!d) return false;
          if (min && d < min) return false;
          if (max && d > max) return false;
          return true;
        });
      }
      return cr;
    });
  }

  function readIdsOf(email) {
    return O.read(db => (db.notificacionesLeidas || {})[String(email || '').toLowerCase()] || []);
  }

  // ── apiConsultarCreditos ──────────────────────────────────────────────────
  H.apiConsultarCreditos = function (payload) {
    payload = payload || {};
    const s = session(payload.token);
    if (!s) return { ok: false, error: 'Sesión inválida o expirada.' };
    const pagina = payload.pagina ? Math.max(1, parseInt(payload.pagina) || 1) : 0;
    const limite = payload.pagina ? Math.min(500, parseInt(payload.limite) || 100) : 0;
    const creditos = consultar(payload);
    const total = creditos.length;
    const readIds = readIdsOf(s.email);
    if (pagina > 0) {
      const off = (pagina - 1) * limite;
      return { ok: true, payload_json: JSON.stringify({ creditos: creditos.slice(off, off + limite), total, readIds }) };
    }
    return { ok: true, payload_json: JSON.stringify({ creditos, total, readIds }) };
  };

  H.apiMarcarNotificacionesComoLeidas = function (token, ids) {
    const s = session(token);
    if (!s) return { ok: false, error: 'Sesión inválida.' };
    if (!s.email) return { ok: false, error: 'Email de usuario no encontrado en la sesión.' };
    if (Array.isArray(ids)) O.tx(db => { (db.notificacionesLeidas = db.notificacionesLeidas || {})[s.email.toLowerCase()] = ids; });
    return { ok: true };
  };

  // NOTA: en el original estas dos funciones leen `res.creditos` (que apiConsultarCreditos ya no
  // devuelve, solo payload_json) y por tanto siempre dan 0 / []. Aquí se implementa el
  // comportamiento previsto por el diseño.
  H.apiGetEstadisticasPortal = function (token, force, fechaInicio, fechaFin) {
    const s = session(token);
    if (!s) return { ok: false, error: 'Sesión inválida.' };
    const creditos = consultar({ fechaInicio, fechaFin });
    const hoy = startOfDay(new Date());
    let total = 0, activos = 0, vigentes = 0, no_vigentes = 0, por_vencer = 0;
    const nits = new Set();
    creditos.forEach(c => {
      total++;
      const estado = String(c.estado_credito || '').trim().toLowerCase();
      const vig = String(c.vigencia_doc || '').trim().toLowerCase();
      if (estado === 'activo' || estado === 'por vencer') activos++;
      if (vig === 'vigente') vigentes++;
      if (vig === 'no vigente') no_vigentes++;
      if (c.nit) nits.add(String(c.nit).trim());
      const fv = parseDmy(c.fecha_venc_doc);
      if (fv && !isNaN(fv)) { const d = Math.ceil((fv - hoy) / DAY); if (d >= 0 && d <= 15) por_vencer++; }
    });
    return { ok: true, total, activos, vigentes, no_vigentes, por_vencer, empresas: nits.size };
  };

  H.apiGetCentrosPortal = function (token) {
    const s = session(token);
    if (!s) return [];
    return [...new Set(consultar({}).map(c => c.centro_codigo).filter(Boolean))].sort();
  };

  // ── apiGetConfiguracion ───────────────────────────────────────────────────
  H.apiGetConfiguracion = function (token, sheetName) {
    const s = session(token);
    if (!s) return { headers: [], rows: [], error: 'Sesión inválida o expirada.' };
    const allowed = ['Centros', 'TiposSolicitud', 'Monedas', 'TiposDocumento', 'Comerciales'];
    if (!sheetName || !allowed.includes(sheetName)) return { headers: [], rows: [] };   // el original captura el error y devuelve vacío
    return O.read(db => {
      switch (sheetName) {
        case 'Centros': return { headers: ['codigo', 'nombre', 'nit', 'razon_social'], rows: (db.centros || []).map(h => [h.codigo, h.nombre, h.nit, h.razon]) };
        case 'TiposSolicitud': return { headers: ['codigo', 'nombre'], rows: (db.tiposSolicitud || []).map(x => [x.codigo, x.nombre]) };
        case 'Monedas': return { headers: ['codigo', 'nombre'], rows: (db.monedas || []).map(x => [x.codigo, x.nombre]) };
        case 'TiposDocumento': return { headers: ['codigo', 'nombre'], rows: (db.tiposDocumento || []).map(x => [x.codigo, x.nombre]) };
        default: return { headers: ['nombre', 'apellido', 'correo'], rows: (db.comerciales || []).map(x => [x.nombre, x.apellido, x.correo]) };
      }
    });
  };

  // ── apiTogglePerfilCreado ─────────────────────────────────────────────────
  // El original bloquea el rol CONSULTAS (solo lectura); ADMIN y OPERACIONES pueden modificar.
  H.apiTogglePerfilCreado = function (payload) {
    payload = payload || {};
    const s = session(payload.token);
    if (!s) return { ok: false, error: 'Sesión inválida o expirada.' };
    if (rolOf(s) === ROL_CONSULTAS) return { ok: false, error: 'No tienes permisos para realizar esta acción.' };
    const parts = String(payload.rowIdx || '').split('_');
    const uuid = parts[0], centro = parts[1];
    if (!uuid || !centro) return { ok: false, error: 'Índice de fila o código de centro inválido.' };
    O.tx(db => {
      const sol = (db.solicitudes || []).find(x => x.uuid === uuid);
      if (!sol) return;                       // UPDATE sin filas afectadas: el original responde ok igualmente
      const raw = String(sol.perfil_creado || '').trim();
      let pc = {};
      if (raw.startsWith('{')) { try { pc = JSON.parse(raw); } catch (_) {} }
      if (payload.checked) pc[centro] = true; else delete pc[centro];
      sol.perfil_creado = JSON.stringify(pc);
    });
    return { ok: true };
  };

  // ── apiGetSolicitudesEjecutivo ────────────────────────────────────────────
  // El original NO filtra por ejecutivo: devuelve todas las solicitudes (todos los estados) y el
  // filtrado por texto/estado lo aplica el cliente (o el payload, si se envía).
  H.apiGetSolicitudesEjecutivo = function (payload) {
    payload = payload || {};
    const s = session(payload.token);
    if (!s) return { ok: false, error: 'Sesión inválida o expirada.' };
    let list = O.read(db => (db.solicitudes || []).map(x => {
      const fe = parseDate(x.fecha_envio);
      return {
        codigo_solicitud: x.codigo_solicitud, tipo_solicitud: x.tipo_solicitud, razon_social: x.razon_social,
        identificacion: x.identificacion, ejecutivo_cuenta: x.ejecutivo_cuenta || '', comentarios: x.comentarios || '',
        estado_codigo: x.estado_codigo, fecha_aprobacion: x.fecha_aprobacion || '', centro_codigo: x.centro_codigo || '',
        monto: x.monto || 0,
        fecha_envio: fe ? O.ymd(fe) + ' ' + pad(fe.getHours()) + ':' + pad(fe.getMinutes()) : '',
        uuid: x.uuid
      };
    }));
    list.sort((a, b) => (b.fecha_envio || '').localeCompare(a.fecha_envio || ''));
    if (payload.busqueda) {
      const q = String(payload.busqueda).toLowerCase();
      list = list.filter(x => (x.razon_social || '').toLowerCase().includes(q) || (x.identificacion || '').toLowerCase().includes(q) ||
        (x.codigo_solicitud || '').toLowerCase().includes(q) || (x.ejecutivo_cuenta || '').toLowerCase().includes(q));
    }
    if (payload.estado && payload.estado !== 'TODOS') list = list.filter(x => (x.estado_codigo || '').toUpperCase() === String(payload.estado).toUpperCase());
    return { ok: true, payload_json: JSON.stringify({ solicitudes: list }) };
  };

  // ── apiGuardarComentarioEjecutivo ─────────────────────────────────────────
  const escHtml = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  H.apiGuardarComentarioEjecutivo = function (payload) {
    payload = payload || {};
    const s = session(payload.token);
    if (!s) return { ok: false, error: 'Sesión inválida o expirada.' };
    if (rolOf(s) === ROL_CONSULTAS) return { ok: false, error: 'No tienes permisos para realizar esta acción.' };
    const uuid = String(payload.uuid || '').trim();
    const comentario = String(payload.comentario || '').trim();
    if (!uuid) return { ok: false, error: 'UUID de solicitud requerido.' };
    O.tx(db => {
      const sol = (db.solicitudes || []).find(x => x.uuid === uuid);
      if (sol) sol.comentarios = comentario;
      if (comentario) {
        const title = sol ? sol.codigo_solicitud + (sol.razon_social ? ' - ' + sol.razon_social : '') : uuid;
        let admins = (db.usuarios || []).filter(u => String(u.rol).toUpperCase() === ROL_ADMIN &&
          ['TRUE', '1', 'SI'].includes(String(u.activo == null ? 'TRUE' : u.activo).toUpperCase())).map(u => u.email);
        if (!admins.length) admins = ['creditos@example.com'];
        O.mail({
          to: admins.join(','), subject: 'Nuevo comentario en la solicitud ' + title,
          html: '<div style="font-family:Arial,sans-serif;font-size:14px;color:#333">El usuario <strong>' + escHtml(s.email) + '</strong> ha añadido/modificado un comentario en la solicitud <strong>' + escHtml(title) + '</strong>:<br><br>' +
                '<div style="background:#f8fcfc;padding:15px;border-left:4px solid #d08b43">' + escHtml(comentario).replace(/\n/g, '<br>') + '</div><br><p>Puedes acceder a la plataforma para revisar los detalles completos.</p></div>'
        }, db);
      }
    });
    return { ok: true };
  };

  // ── Exportación a Excel ───────────────────────────────────────────────────
  // Contrato original: { ok:true, url } y el frontend hace window.open(url). Aquí `url` es un blob:
  // con un .xlsx REAL; window.open se intercepta para las URL generadas por este mock y dispara una
  // descarga con nombre de archivo (en lugar de abrir una pestaña en blanco).
  const exportNames = {};
  const _open = window.open;
  window.open = function (url) {
    if (url && exportNames[url]) {
      const a = document.createElement('a');
      a.href = url; a.download = exportNames[url]; a.style.display = 'none';
      document.body.appendChild(a); a.click(); a.remove();
      return null;
    }
    return _open.apply(window, arguments);
  };

  H.apiExportarCreditosExcelOperaciones = function (token, filtros) {
    const s = session(token);
    if (!s) return { ok: false, error: 'Sesión inválida o expirada.' };
    const creditos = consultar(filtros || {});
    const d = new Date(Date.now() - 5 * 3600000);            // GMT-5, igual que el original
    const stamp = d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + '_' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds());
    const nombre = 'Cuadra_Operaciones_Creditos_' + stamp + '.xlsx';
    const rows = [['Razón social', 'Identificación (NIT)', 'Centro asignado', 'Monto cupo', 'Fecha aprobación', 'Estado crédito',
      'Fecha venc. doc.', 'Vigencia doc.', 'Correo facturación', 'Aprobado por', 'Novedades', 'Solicitado por']];
    creditos.forEach(c => rows.push([c.razon_social || '', c.nit || '', c.centro || '',
      c.monto ? Number(String(c.monto).replace(/[^0-9.-]/g, '')) || 0 : 0,
      c.fecha_aprobacion || '', c.estado_credito || '', c.fecha_venc_doc || '', c.vigencia_doc || '',
      c.facturacion_electronica || '', c.aprobado_por || '', c.novedades || '', c.solicitado_por || '']));
    const blob = new Blob([O.makeXlsx([{ name: 'Creditos', rows }])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    exportNames[url] = nombre;
    return { ok: true, url };
  };

  // ── Autenticación ─────────────────────────────────────────────────────────
  O.installAuth({ app: 'portal', roles: ['ADMIN', 'CONSULTAS', 'OPERACIONES'] });

  // Recuperación de contraseña: se sustituye la versión genérica de auth.js por la del portal
  // original (mensaje genérico que no revela si el correo existe, mínimo 6 caracteres y bloqueo
  // tras 5 intentos fallidos durante 30 minutos).
  H.apiEnviarCodigoRecuperacion = function (email) {
    email = String(email || '').trim().toLowerCase();
    if (!email) return { ok: false, error: 'El correo es requerido.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Correo no válido.' };
    const MSG = 'Si el correo está registrado, recibirás un código de recuperación en breve.';
    return O.tx(db => {
      if (!O.findUser(db, email)) return { ok: true, message: MSG };
      const codigo = String(Math.floor(100000 + Math.random() * 900000));
      db.codigos['REC_CODE_' + email] = { codigo, exp: Date.now() + 600000, intentos: 0 };
      O.mail({
        to: email, subject: 'Recuperación de contraseña — CupoFlow Créditos', code: codigo,
        html: '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;text-align:center;padding:30px"><h2 style="color:#0e362f">Recuperación de Contraseña</h2>' +
              '<p style="color:#555">Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en el Portal de Créditos. Ingresa el siguiente código:</p>' +
              '<div style="border:2px dashed #d08b43;border-radius:10px;padding:20px;font-size:36px;font-weight:800;letter-spacing:10px;color:#3c796c">' + codigo + '</div>' +
              '<p style="color:#999;font-size:12px">Este código expira en 10 minutos. Correo simulado por la demo.</p></div>'
      }, db);
      return { ok: true };
    });
  };

  H.apiRestablecerPassword = function (email, codigo, nuevo) {
    email = String(email || '').trim().toLowerCase(); codigo = String(codigo || '').trim(); nuevo = String(nuevo || '').trim();
    if (!email || !codigo || !nuevo) return { ok: false, error: 'Todos los campos son obligatorios.' };
    if (nuevo.length < 6) return { ok: false, error: 'La nueva contraseña debe tener al menos 6 caracteres.' };
    return O.tx(db => {
      const kI = 'intentos_reset_' + email;
      let it = db.codigos[kI];
      if (it && it.exp < Date.now()) { delete db.codigos[kI]; it = null; }
      const n = it ? it.n : 0;
      if (n >= 5) return { ok: false, error: 'Demasiados intentos fallidos. Solicita un nuevo código de recuperación más tarde.' };
      const fail = msg => { db.codigos[kI] = { n: n + 1, exp: Date.now() + 1800000 }; return { ok: false, error: msg }; };
      const c = db.codigos['REC_CODE_' + email];
      if (!c || c.exp < Date.now()) return fail('El código de recuperación ha expirado o no ha sido solicitado.');
      if (c.codigo !== codigo) return fail('El código de recuperación ingresado es incorrecto.');
      delete db.codigos[kI];
      const u = O.findUser(db, email);
      if (!u) return { ok: false, error: 'Usuario no encontrado.' };
      u.password = nuevo;
      delete db.codigos['REC_CODE_' + email];
      return { ok: true };
    });
  };
})();
