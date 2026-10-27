/* ============================================================================
 * panel.js — Backend SIMULADO del Panel de Control (app admin).
 *
 * Replica, sobre la "base de datos" en localStorage (DemoKit.tx / DemoKit.read),
 * el contrato de las funciones `api*` de src/panel/*.js que invoca el frontend
 * (JS_*.html), SIN modificar dicho frontend.
 *
 * Servicios externos simulados (siempre con aviso visible):
 *   - Gmail          → DemoKit.mail (bandeja simulada del panel DEMO)
 *   - Drive          → documentos = metadatos; visor con PDF de ejemplo generado
 *   - Sheets/Slides  → archivos .xlsx/.csv reales generados en el navegador
 *   - Gemini (IA)    → informe de ejemplo derivado de los datos del expediente
 *   - Session/OAuth  → auth.js (sesiones en localStorage)
 * ========================================================================== */
(function () {
  'use strict';
  const O = window.DemoKit;
  const H = O.handlers;
  const toast = (html, ms) => O.toast(html, ms || 5500);

  // ── Personalización del panel flotante DEMO ─────────────────────────────────
  function visible(e) { return !!(e && e.offsetParent !== null); }
  function setVal(input, v) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function fillLogin(email, pw) {
    const e = document.getElementById('loginEmail'), p = document.getElementById('loginPassword'), b = document.getElementById('loginBtn');
    if (visible(e) && visible(p) && b) { setVal(e, email); setVal(p, pw); b.click(); return; }
    // Ya hay una sesión abierta: se cierra y se vuelve a entrar con la cuenta elegida.
    try {
      sessionStorage.setItem('demo-panel-pending', JSON.stringify({ email, pw }));
      const t = sessionStorage.getItem('hd_panel_token');
      if (t) H.apiLogout(t);
      sessionStorage.removeItem('hd_panel_token'); sessionStorage.removeItem('hd_user_email');
    } catch (_) {}
    location.reload();
  }
  O.appConfig = {
    name: 'panel', title: 'Panel de control',
    quick: [
      { email: 'admin@example.com', nombre: 'Alicia Administradora', rol: 'ADMIN', desc: 'Único rol con acceso al panel: todo el sistema' },
      { email: 'operaciones@example.com', nombre: 'Rafael Operaciones', rol: 'OPERACIONES', desc: 'Verás el rechazo: el panel es solo para ADMIN' },
      { email: 'consultas@example.com', nombre: 'Camila Consultas', rol: 'CONSULTAS', desc: 'Verás el rechazo: el panel es solo para ADMIN' },
      { email: 'inactivo@example.com', nombre: 'Usuario Inactivo', rol: 'CONSULTAS', desc: 'Cuenta desactivada: no puede entrar' }
    ],
    fillLogin,
    notes: [
      '🤖 <b>IA (Gemini) simulada</b> y 📁 <b>Drive simulado</b>: el análisis genera un informe de ejemplo y “Ver PDF” abre un PDF generado en tu navegador.',
      '📥 <b>Importación masiva</b>: la “hoja” de plantilla trae filas de ejemplo (nuevas, duplicadas y con error). Restablece los datos para repetirla.',
      '🔐 <b>Restaurar copias</b>: el código de seguridad llega a la bandeja simulada (y como aviso).'
    ],
    autoOpen: true
  };
  O.installAuth({ app: 'panel', roles: null });

  // ── Utilidades generales ────────────────────────────────────────────────────
  const DAY = 86400000;
  const pad = O.pad;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  const digits9 = s => String(s || '').replace(/[^0-9]/g, '').trim().substring(0, 9);
  const codes = s => String(s || '').split(',').map(c => c.trim()).filter(Boolean);
  const ascii = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MES3 = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const money = (n, mon) => (mon === 'USD' ? 'USD $' : '$') + Number(n || 0).toLocaleString('es-CO');
  const hoy0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

  /** Parseo tolerante de fechas: 'yyyy-MM-dd' (local), 'yyyy-MM-dd HH:mm:ss' (local), ISO y 'dd/MM/yyyy'. */
  function pd(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    const d = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(s) ? s.replace(' ', 'T') : s);
    return isNaN(d) ? null : d;
  }
  const ddmmyyyy = v => { const d = pd(v); return d ? O.dmy(d) : ''; };
  const hashStr = s => { let h = 0; String(s).split('').forEach(c => { h = (h * 31 + c.charCodeAt(0)) >>> 0; }); return h; };

  function needSes(token) {
    const s = O.getSession(token || '');
    if (!s) throw new Error('Sesión inválida o expirada.');
    return s;
  }

  /** Transacción con inicialización perezosa de las tablas propias del panel. */
  function T(fn) { return O.tx(db => { init(db); return fn(db); }); }

  function findSol(db, idOrCode) {
    const raw = String(idOrCode || '').trim();
    if (!raw) return null;
    const hex = raw.replace(/-/g, '').toLowerCase();
    return (db.solicitudes || []).find(s => String(s.uuid).replace(/-/g, '').toLowerCase() === hex || s.codigo_solicitud === raw) || null;
  }

  function centroList(db) {
    return (db.centros || []).map(h => ({
      codigo: String(h.codigo || '').trim(), nombre: String(h.nombre || '').trim(), nit: String(h.nit || '').trim(),
      razon: String(h.razon || '').trim(), monto_minimo: num(h.monto_minimo) || 5000000
    }));
  }

  function audit(db, actor, accion, codigo, meta, when) {
    const a = db.auditoria = db.auditoria || [];
    const id = a.length ? (num(a[a.length - 1].id) + 1) : 1;
    a.push({
      id, fecha_evento: (when || new Date()).toISOString(), actor: actor || 'sistema', accion: accion || 'EVENTO',
      codigo_solicitud: codigo || '', metadata_json: meta ? JSON.stringify(meta) : '{}'
    });
    if (a.length > 1500) a.splice(0, a.length - 1500);
  }

  // ── Estados ─────────────────────────────────────────────────────────────────
  function normEstado(estado) {
    let c = String(estado || '').toUpperCase().trim();
    if (c === 'RECHAZADA' || c === 'RECHAZADA TEMPORALMENTE') c = 'RECHAZADA';
    else if (c === 'DEVUELTA' || c === 'OBSERVADA') c = 'DEVUELTA';
    else if (c === 'EN_ANALISIS' || c === 'ANALISIS') c = 'EN_ANALISIS';
    else if (c === 'PENDIENTE') c = 'PENDIENTE_REVISION';
    else if (c === 'VENCIDA' || c === 'VENCIDO') c = 'VENCIDO';
    else if (c === 'BLOQUEADO CORPORATIVO' || c === 'BLOQUEADO_CORPORATIVO') c = 'BLOQUEADO_CORPORATIVO';
    else if (c === 'BLOQUEADO GERENCIA' || c === 'BLOQUEADO_GERENCIA') c = 'BLOQUEADO_GERENCIA';
    else if (c === 'POR VENCER' || c === 'POR_VENCER') c = 'POR_VENCER';
    return c;
  }
  const ESTADOS_VALIDOS = ['PENDIENTE_REVISION', 'EN_ANALISIS', 'EN_REVISION', 'APROBADA', 'ACTIVA', 'POR_VENCER', 'VENCIDO', 'RECHAZADA', 'DEVUELTA', 'BLOQUEADO_CORPORATIVO', 'BLOQUEADO_GERENCIA'];
  const ESTADOS_CREDITO = ['APROBADA', 'ACTIVA', 'VENCIDO', 'VENCIDA', 'POR_VENCER', 'BLOQUEADO_CORPORATIVO', 'BLOQUEADO_GERENCIA'];

  /** Espejo de dbComputeAccion_: 365 días desde la aprobación; <= 15 días => POR_VENCER. */
  function computeAccion(estadoCodigo, fechaAprobacion) {
    const accion = String(estadoCodigo || '').trim().toUpperCase();
    const necesita = ['APROBADA', 'ACTIVA', 'POR_VENCER', 'VENCIDO', 'VENCIDA'].includes(accion);
    if (necesita && fechaAprobacion) {
      const f = pd(fechaAprobacion);
      if (f) {
        const hoy = hoy0(); f.setHours(0, 0, 0, 0);
        const fVenc = new Date(f.getTime() + 365 * DAY);
        const dias = Math.ceil((fVenc.getTime() - hoy.getTime()) / DAY);
        if (dias <= 0) return 'VENCIDO';
        if (dias <= 15) return 'POR_VENCER';
        if (['VENCIDO', 'VENCIDA', 'POR_VENCER'].includes(accion)) return 'ACTIVA';
      }
    }
    return accion;
  }
  const accionDe = s => computeAccion(s.estado_codigo, s.fecha_aprobacion);

  function toLight(s) {
    return {
      uuid: s.uuid, codigo_solicitud: String(s.codigo_solicitud || ''), estado_sync: 'SINCRONIZADO',
      tipo_solicitud: String(s.tipo_solicitud || ''), centro_codigo: String(s.centro_codigo || ''),
      razon_social: String(s.razon_social || ''), nombre_comercial: String(s.razon_social || ''),
      identificacion: String(s.identificacion || ''), monto: num(s.monto), moneda: String(s.moneda || 'COP'),
      fecha_envio: String(s.fecha_envio || ''), accion: accionDe(s), es_filial: String(s.es_filial || 'NO'),
      comentarios: String(s.comentarios || '')
    };
  }
  const DETAIL_KEYS = ['codigo_solicitud', 'tipo_solicitud', 'centro_codigo', 'razon_social', 'nombre_comercial', 'identificacion', 'direccion', 'ciudad', 'departamento',
    'cod_postal', 'nombre_rep_legal', 'tipo_id_rep', 'num_id_rep', 'cargo_rep', 'tel_rep', 'correo_rep', 'responsabilidad_fiscal', 'fact_fecha_corte',
    'fact_fecha_exp_cert', 'fact_fecha_exp_carta', 'fact_inscripcion', 'fact_docs_req', 'fact_email', 'fact_email_cc', 'ejecutivo_cuenta',
    'fecha_diligenciamiento', 'carpeta_drive_id', 'fecha_envio', 'comentarios', 'firma_url', 'ip_dispositivo', 'aceptado_por', 'fecha_recibido_doc',
    'fecha_venc_doc', 'vigencia_doc', 'perfil_creado', 'razon_bloqueo', 'segunda_firma_nombre', 'segunda_firma_cargo', 'segunda_firma_correo',
    'segunda_firma_fecha', 'segunda_firma_ip', 'segunda_firma_metodo'];
  function toDetail(s) {
    const o = { uuid: s.uuid, estado_sync: 'SINCRONIZADO', contactos_json: s.contactos_json || '[]' };
    DETAIL_KEYS.forEach(k => { o[k] = String(s[k] == null ? '' : s[k]); });
    o.refs_otros_centros = String(s.refs_otros_centros || 'NO');
    o.monto = num(s.monto); o.moneda = String(s.moneda || 'COP');
    o.accion = accionDe(s);
    o.fecha_aprobacion = String(s.fecha_aprobacion || '');
    o.cupos_distribuidos_json = String(s.cupos_distribuidos_json || '{}');
    o.es_filial = String(s.es_filial || 'NO');
    return o;
  }

  // ── Periodos y filtros ──────────────────────────────────────────────────────
  function periodoRango(periodo) {
    if (!periodo || periodo.type === 'ALL') return { ini: null, fin: null };
    const now = new Date(); let ini = null, fin = null;
    switch (periodo.type) {
      case 'HOY': ini = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
      case 'ESTA_SEMANA': {
        const day = now.getDay(), diff = now.getDate() - day + (day === 0 ? -6 : 1);
        ini = new Date(now.getFullYear(), now.getMonth(), diff); break;
      }
      case 'ESTE_MES': ini = new Date(now.getFullYear(), now.getMonth(), 1); break;
      // El frontend de Solicitudes/Créditos envía ESTE_ANO (sin Ñ) y el Dashboard ESTE_ANIO; se aceptan ambos.
      case 'ESTE_ANIO': case 'ESTE_ANO': ini = new Date(now.getFullYear(), 0, 1); break;
      case 'CUSTOM':
        if (periodo.inicio) ini = pd(periodo.inicio);
        if (periodo.fin) { fin = pd(periodo.fin); if (fin) fin = new Date(fin.getFullYear(), fin.getMonth(), fin.getDate(), 23, 59, 59); }
        break;
    }
    return { ini, fin };
  }
  function enPeriodo(s, periodo) {
    const r = periodoRango(periodo);
    if (!r.ini && !r.fin) return true;
    const f = pd(s.fecha_envio);
    if (!f) return false;
    if (r.ini && f < r.ini) return false;
    if (r.fin && f > r.fin) return false;
    return true;
  }

  function kpisDe(db, periodo) {
    const k = { total: 0, pendientes: 0, aprobadas: 0, vencidas: 0, rechazadas: 0, tipos: { NUEVA: 0, AMPLIACION: 0, RENOVACION: 0, HOMOLOGACION: 0 } };
    (db.solicitudes || []).filter(s => enPeriodo(s, periodo)).forEach(s => {
      const a = String(accionDe(s)).toUpperCase();
      k.total++;
      if (['APROBADA', 'ACTIVA', 'POR_VENCER'].includes(a) || a.includes('BLOQUEADO')) k.aprobadas++;
      else if (a === 'VENCIDO' || a === 'VENCIDA') k.vencidas++;
      else if (!a || a.includes('PENDIENTE')) k.pendientes++;
      else k.rechazadas++;
      const t = ascii(s.tipo_solicitud).trim().toUpperCase();
      if (k.tipos[t] !== undefined) k.tipos[t]++;
    });
    return k;
  }

  function filtrarSolicitudes(db, filtro) {
    filtro = filtro || {};
    const q = filtro.busqueda ? O.norm(filtro.busqueda) : '';
    const tipo = filtro.tipo ? ascii(filtro.tipo).trim().toUpperCase() : '';
    const estados = (filtro.estados || []).map(e => String(e || '').toUpperCase().trim());
    let list = (db.solicitudes || []).filter(s => {
      if (q) {
        const hay = [s.razon_social, s.codigo_solicitud, s.identificacion, s.nombre_rep_legal, s.centro_codigo, s.tipo_solicitud].some(v => O.norm(v).includes(q));
        if (!hay) return false;
      }
      if (!enPeriodo(s, filtro.periodo)) return false;
      if (tipo && ascii(s.tipo_solicitud).trim().toUpperCase() !== tipo) return false;
      if (filtro.filial && String(s.es_filial || 'NO') !== filtro.filial) return false;
      if (filtro.centro && !String(s.centro_codigo || '').toLowerCase().includes(String(filtro.centro).toLowerCase())) return false;
      if (estados.length) {
        const a = accionDe(s);
        const ok = estados.some(e => {
          if (e === 'PENDIENTE') return ['', 'PENDIENTE', 'PENDIENTE_REVISION'].includes(a);
          if (e === 'APROBADA') return ['APROBADA', 'ACTIVA', 'POR_VENCER'].includes(a) || a.startsWith('BLOQUEADO');
          if (e === 'RECHAZADA' || e === 'RECHAZADA TEMPORALMENTE') return a === 'RECHAZADA';
          if (e === 'EN_REVISION') return a === 'EN_REVISION';
          if (e === 'VENCIDO') return a === 'VENCIDO';
          return false;
        });
        if (!ok) return false;
      }
      return true;
    });
    list.sort((a, b) => String(b.fecha_envio || '').localeCompare(String(a.fecha_envio || '')));
    return list;
  }

  // ── Tendencias (dashboard) ──────────────────────────────────────────────────
  function tendenciasDe(db, periodo) {
    const registros = [];
    (db.solicitudes || []).filter(s => enPeriodo(s, periodo)).forEach(s => {
      const f = pd(s.fecha_envio); if (!f) return;
      registros.push({ fecha: f, tipo: ascii(s.tipo_solicitud).trim().toUpperCase() });
    });
    const blank = label => ({ label, nueva: 0, ampliacion: 0, renovacion: 0, homologacion: 0 });
    const add = (o, t) => { if (t === 'NUEVA') o.nueva++; else if (t === 'AMPLIACION') o.ampliacion++; else if (t === 'RENOVACION') o.renovacion++; else if (t === 'HOMOLOGACION') o.homologacion++; };
    const now = new Date();
    const semanaInicio = () => { const t = new Date(now.getTime()); const day = t.getDay(); t.setDate(t.getDate() - day + (day === 0 ? -6 : 1)); return t; };
    const custom = periodo && periodo.type === 'CUSTOM' && periodo.inicio && periodo.fin;

    // diario
    let start = new Date(), end = new Date();
    if (custom) { start = new Date(periodo.inicio + 'T00:00:00'); end = new Date(periodo.fin + 'T23:59:59'); }
    else if (periodo && periodo.type === 'ESTE_MES') start = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (periodo && periodo.type === 'ESTA_SEMANA') start = semanaInicio();
    else start.setDate(now.getDate() - 14);
    if (Math.ceil(Math.abs(end - start) / DAY) > 45) { start = new Date(end); start.setDate(end.getDate() - 29); }
    const dCounts = {}, dKeys = [];
    for (let c = new Date(start); c <= end; c.setDate(c.getDate() + 1)) {
      const k = O.ymd(c); dCounts[k] = blank(pad(c.getDate()) + ' ' + MES3[c.getMonth()]); dKeys.push(k);
    }
    registros.forEach(r => { const o = dCounts[O.ymd(r.fecha)]; if (o) add(o, r.tipo); });

    // semanal
    function semana(d) {
      const date = new Date(d.getTime()); date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
      const w1 = new Date(date.getFullYear(), 0, 4);
      return 1 + Math.round(((date.getTime() - w1.getTime()) / DAY - 3 + (w1.getDay() + 6) % 7) / 7);
    }
    let s2 = new Date(), e2 = new Date();
    if (custom) { s2 = new Date(periodo.inicio + 'T00:00:00'); e2 = new Date(periodo.fin + 'T23:59:59'); }
    else if (periodo && (periodo.type === 'ESTE_ANIO' || periodo.type === 'ESTE_ANO')) s2 = new Date(now.getFullYear(), 0, 1);
    else if (periodo && periodo.type === 'ESTA_SEMANA') s2 = semanaInicio();
    else s2.setDate(now.getDate() - 7 * 8);
    const wCounts = {}, wKeys = [];
    for (let c = new Date(s2); c <= e2; c.setDate(c.getDate() + 7)) {
      const k = c.getFullYear() + '-W' + semana(c);
      if (!wCounts[k]) { wCounts[k] = blank('Sem ' + semana(c)); wKeys.push(k); }
    }
    registros.forEach(r => { const o = wCounts[r.fecha.getFullYear() + '-W' + semana(r.fecha)]; if (o) add(o, r.tipo); });

    // mensual
    let s3 = new Date(), e3 = new Date();
    if (custom) { s3 = new Date(periodo.inicio + 'T00:00:00'); e3 = new Date(periodo.fin + 'T23:59:59'); }
    else if (periodo && periodo.type === 'ESTA_SEMANA') s3 = semanaInicio();
    else { s3.setMonth(now.getMonth() - 5); s3.setDate(1); }
    const mCounts = {}, mKeys = [];
    for (let c = new Date(s3); c <= e3;) {
      const k = c.getFullYear() + '-' + (c.getMonth() + 1);
      if (!mCounts[k]) { mCounts[k] = blank(MES3[c.getMonth()] + ' ' + String(c.getFullYear()).substring(2)); mKeys.push(k); }
      c.setDate(1); c.setMonth(c.getMonth() + 1);
    }
    registros.forEach(r => { const o = mCounts[r.fecha.getFullYear() + '-' + (r.fecha.getMonth() + 1)]; if (o) add(o, r.tipo); });

    return { diario: dKeys.map(k => dCounts[k]), semanal: wKeys.map(k => wCounts[k]), mensual: mKeys.map(k => mCounts[k]) };
  }

  // ── Créditos virtuales ──────────────────────────────────────────────────────
  function creditosDeSol(sol, centros) {
    let cupos = {};
    try { if (sol.cupos_distribuidos_json && sol.cupos_distribuidos_json !== '{}') cupos = JSON.parse(sol.cupos_distribuidos_json); } catch (_) {}
    const cods = codes(sol.centro_codigo);
    if (Object.keys(cupos).length === 0 && cods.length) {
      const por = Math.floor(num(sol.monto) / cods.length);
      cods.forEach(c => { cupos[c] = por; });
    }
    const out = [];
    for (const cod in cupos) {
      const h = centros.find(x => x.codigo === cod) || { nombre: cod };
      const monto = cupos[cod] || 0;
      let perfil = 'FALSE';
      const rawPc = String(sol.perfil_creado || '').trim();
      if (rawPc.startsWith('{')) { try { perfil = JSON.parse(rawPc)[cod] ? 'TRUE' : 'FALSE'; } catch (_) { perfil = rawPc.toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE'; } }
      else perfil = (rawPc.toUpperCase() === 'TRUE' || rawPc === '1') ? 'TRUE' : 'FALSE';
      const acc = sol._accion;
      out.push({
        _rowIdx: sol.uuid + '_' + cod, id: sol.codigo_solicitud + '_' + cod, solicitado_por: sol.ejecutivo_cuenta || '',
        razon_social: sol.razon_social || '', nit: sol.identificacion || '', centro: cod + ' - ' + h.nombre, centro_codigo: cod,
        monto: '$' + Number(monto).toLocaleString('es-CO'), monto_num: monto,
        fecha_aprobacion: sol.fecha_aprobacion ? ddmmyyyy(sol.fecha_aprobacion) : '',
        estado_credito: (acc === 'VENCIDA' || acc === 'VENCIDO') ? 'Vencido' : (acc === 'POR VENCER' || acc === 'POR_VENCER') ? 'Por Vencer' :
          (acc === 'BLOQUEADO CORPORATIVO' || acc === 'BLOQUEADO_CORPORATIVO') ? 'Bloqueado Corporativo' :
          (acc === 'BLOQUEADO GERENCIA' || acc === 'BLOQUEADO_GERENCIA') ? 'Bloqueado Gerencia' : 'Vigente',
        fecha_recibido_doc: sol.fecha_recibido_doc ? ddmmyyyy(sol.fecha_recibido_doc) : '',
        fecha_venc_doc: sol.fecha_venc_doc ? ddmmyyyy(sol.fecha_venc_doc) : '',
        vigencia_doc: sol.vigencia_doc || 'Vigente', facturacion_electronica: sol.fact_email || '', aprobado_por: sol.aceptado_por || '',
        novedades: sol.comentarios || '', razon_bloqueo: sol.razon_bloqueo || '', perfil_creado: perfil,
        creado_en: sol.fecha_envio || '', es_filial: sol.es_filial || 'NO'
      });
    }
    return out;
  }

  function creditosDe(db, filtros) {
    filtros = filtros || {};
    const centros = centroList(db);
    let creds = [];
    (db.solicitudes || []).forEach(s => {
      const acc = accionDe(s);
      if (!ESTADOS_CREDITO.includes(acc)) return;
      creds = creds.concat(creditosDeSol(Object.assign({}, s, { _accion: acc }), centros));
    });
    if (filtros.busqueda) {
      const q = String(filtros.busqueda).toLowerCase();
      creds = creds.filter(c => c.razon_social.toLowerCase().includes(q) || c.nit.toLowerCase().includes(q) || c.centro.toLowerCase().includes(q) || c.solicitado_por.toLowerCase().includes(q));
    }
    if (filtros.estado && filtros.estado !== 'TODOS') creds = creds.filter(c => c.estado_credito.toLowerCase() === String(filtros.estado).toLowerCase());
    if (filtros.centro && filtros.centro !== 'TODOS') {
      const h = String(filtros.centro).toLowerCase();
      creds = creds.filter(c => c.centro_codigo.toLowerCase() === h || c.centro.toLowerCase().includes(h));
    }
    if (filtros.vigencia && filtros.vigencia !== 'TODOS') creds = creds.filter(c => c.vigencia_doc.toLowerCase() === String(filtros.vigencia).toLowerCase());
    if (filtros.fechaInicio || filtros.fechaFin) {
      const min = filtros.fechaInicio ? new Date(filtros.fechaInicio + 'T00:00:00') : null;
      const max = filtros.fechaFin ? new Date(filtros.fechaFin + 'T23:59:59') : null;
      creds = creds.filter(c => {
        const d = pd(c.fecha_aprobacion); if (!d) return false;
        return !((min && d < min) || (max && d > max));
      });
    }
    if (filtros.montoMin !== undefined && filtros.montoMin !== '') { const v = Number(filtros.montoMin); if (!isNaN(v)) creds = creds.filter(c => c.monto_num >= v); }
    if (filtros.montoMax !== undefined && filtros.montoMax !== '') { const v = Number(filtros.montoMax); if (!isNaN(v)) creds = creds.filter(c => c.monto_num <= v); }
    if (filtros.perfilCreado && filtros.perfilCreado !== 'TODOS') {
      const v = filtros.perfilCreado === 'SI' ? 'TRUE' : 'FALSE';
      creds = creds.filter(c => String(c.perfil_creado).toUpperCase() === v);
    }
    const t = c => { const d = pd(c.fecha_aprobacion); return d ? d.getTime() : 0; };
    creds.sort((a, b) => t(b) - t(a));
    return creds;
  }

  // ── Documentos ──────────────────────────────────────────────────────────────
  const docsDe = (db, uuid) => (db.documentos || []).filter(d => d.uuid_solicitud === uuid);
  let _seqFile = 0;
  const newFileId = () => 'demo-file-' + Date.now().toString(36) + '-' + (++_seqFile);
  const uploadedPdf = new Map();   // drive_file_id → base64 (solo memoria; se pierde al recargar)

  // ── Distribuciones ──────────────────────────────────────────────────────────
  function ejecutivoEmail(db, nombre) {
    const n = String(nombre || '').trim().toLowerCase();
    if (!n) return '';
    const c = (db.comerciales || []).find(x => {
      const nom = String(x.nombre || '').trim().toLowerCase(), full = (nom + ' ' + String(x.apellido || '').trim().toLowerCase()).trim();
      return String(x.correo || '').toLowerCase() === n || full === n || nom === n || n.includes(nom);
    });
    return c ? String(c.correo || '').trim() : '';
  }

  // =========================================================================
  //  Inicialización de las tablas propias del panel (semilla perezosa)
  // =========================================================================
  const SNAP_KEYS = ['solicitudes', 'documentos', 'analisisIA', 'centros', 'comerciales', 'ejecutivos', 'operacionesCentros', 'monedas', 'tiposDocumento',
    'tiposSolicitud', 'usuarios', 'plantillaImportacion', 'notificacionesLeidas', 'historialEstados'];
  function snapshot(db) {
    const o = {};
    SNAP_KEYS.forEach(k => { if (db[k] !== undefined) o[k] = JSON.parse(JSON.stringify(db[k])); });
    return JSON.stringify(o);
  }
  function pushBackup(db, name, origin, dataKey, snap) {
    db.backupData = db.backupData || {};
    db.backups = db.backups || [];
    if (snap) db.backupData[dataKey] = snap;
    db.backups.push({ id: 'demo-backup-' + dataKey + '-' + Date.now().toString(36), name, created: Date.now(), origin: origin || 'Sistema', data: dataKey });
    // Límite para no llenar localStorage: se conservan las últimas 6 copias con contenido.
    const conContenido = db.backups.filter(b => db.backupData[b.data]);
    while (conContenido.length > 6) {
      const old = conContenido.shift();
      const usados = db.backups.filter(b => b.data === old.data).length;
      if (usados <= 1 && old.data !== 'seed') delete db.backupData[old.data];
      else if (old.data !== 'seed') break;
      else break;
    }
    return db.backups[db.backups.length - 1];
  }

  function init(db) {
    if (db._panelInit) return;
    db._panelInit = 1;
    const now = new Date();
    db.solicitudes = db.solicitudes || []; db.documentos = db.documentos || [];
    db.auditoria = db.auditoria || []; db.analisisIA = db.analisisIA || {}; db.notificacionesLeidas = db.notificacionesLeidas || {};
    db.backups = db.backups || []; db.backupData = db.backupData || {}; db.historialEstados = db.historialEstados || [];
    db.codigos = db.codigos || {}; db.outbox = db.outbox || []; db.sesiones = db.sesiones || {};

    // El vocabulario original de vigencia documental es Vigente / Por Vencer / No Vigente.
    db.solicitudes.forEach(s => { if (s.vigencia_doc === 'Vencido') s.vigencia_doc = 'No Vigente'; });

    // Hoja Operaciones_Centros (correos de operaciones de cada centro)
    if (!db.operacionesCentros) {
      db.operacionesCentros = (db.centros || []).map(h => ({ codigo: h.codigo, nombre: h.nombre, nit: h.nit, correo_operaciones: 'operaciones.' + String(h.codigo).toLowerCase() + '@example.com' }));
    }

    // Documentos de apoyo para que el análisis de IA muestre un caso "limpio" (Pisos y Cerámicas Blanca)
    const limpia = db.solicitudes.find(s => /Cer[aá]micas Blanca/i.test(s.razon_social || ''));
    if (limpia && !docsDe(db, limpia.uuid).some(d => /datacredito/i.test(d.nombre_archivo))) {
      [['SOPORTE', 'Reporte_Datacredito.pdf', 210000], ['SOPORTE', 'Reporte_Inspektor_Compliance.pdf', 164000], ['SOPORTE', 'Referencias_comerciales.pdf', 98000]].forEach((x, i) => {
        db.documentos.push({ uuid_solicitud: limpia.uuid, tipo_documento: x[0], drive_file_id: 'demo-file-extra-' + (i + 1), nombre_archivo: x[1], tamano_bytes: x[2], hash_sha256: '', estado_sync: 'SINCRONIZADO', fecha_subida: limpia.fecha_envio });
      });
    }

    // Hoja PLANTILLA_IMPORTAR_CREDITOS (en producción se edita en Google Sheets)
    if (!db.plantillaImportacion) {
      const d = n => O.dmy(O.addDays(now, -n));
      const base = { fechaRecDoc: d(3), fechaVenDoc: O.dmy(O.addDays(now, 300)), vigenciaDoc: 'Vigente', aprobadoPor: '', novedades: '', estadoImportacion: '', detalleError: '' };
      const fila = (cliente, nit, centro, monto, fechaAprob, estadoCredito, extra) => Object.assign({}, base, { cliente, nit, centro, monto, fechaAprob, estadoCredito, factEmail: 'facturas@' + ascii(cliente).toLowerCase().replace(/[^a-z]/g, '').slice(0, 10) + '.example.com' }, extra || {});
      const ex = db.solicitudes.find(s => /Constructora Ejemplo/.test(s.razon_social || ''));
      db.plantillaImportacion = [
        fila('Grupo Andino de Obras S.A.S.', '901234567', 'Centro Demo Norte', 8000000, d(20), 'Vigente', { novedades: 'Cliente histórico (Excel 2024)' }),
        fila('Grupo Andino de Obras S.A.S.', '901234567', 'Centro Demo Central', 6000000, d(20), 'Vigente'),
        fila('Comercial Río Azul Ltda.', '901234568', 'Centro Demo Sur', 5500000, d(90), 'BLOQUEADO CORPORATIVO', { novedades: 'Bloqueado por mora en cartera' }),
        fila('Obras Marítimas del Caribe S.A.', '901234569', 'CDCOSTA', 9000000, d(400), 'Vigente', { vigenciaDoc: 'No Vigente' }),
        fila(ex ? ex.razon_social : 'Constructora Ejemplo S.A.S.', ex ? digits9(ex.identificacion) : '990100001', 'Centro Demo Norte', 15000000, d(5), 'Vigente', { novedades: 'Duplicado: solo actualiza la fecha' }),
        fila('Construcciones Fantasma S.A.', '901234570', 'Centro Inexistente Norte', 4000000, d(10), 'Vigente'),
        fila('Distribuidora Histórica Ltda.', '901234571', 'Centro Demo Andes', 7000000, d(60), 'Vigente', { estadoImportacion: 'Procesado' })
      ];
    }

    // Copias de seguridad de ejemplo (contenido = estado inicial de la demo)
    if (!db.backups.length) {
      const snap = snapshot(db);
      const dia = n => O.ymd(O.addDays(now, -n));
      db.backupData.seed = snap;
      [[1, 'Backup_' + dia(1), 'Cron Automático (Diario)', 2], [2, 'Backup_' + dia(2), 'Cron Automático (Diario)', 2],
       [4, 'Backup_' + dia(4) + '_02-14-33_Manual', 'admin@example.com', 15]].forEach((b, i) => {
        db.backups.push({ id: 'demo-backup-seed-' + (i + 1), name: b[1], created: O.addDays(now, -b[0]).setHours(b[3], 5, 0, 0), origin: b[2], data: 'seed' });
      });
    }

    // Análisis de IA guardados de ejemplo + histórico de auditoría
    if (!Object.keys(db.analisisIA).length) {
      db.solicitudes.filter(s => /Constructora Ejemplo|Transportes Demo/.test(s.razon_social || '')).forEach(s => {
        const ia = buildIA(db, s, docsDe(db, s.uuid));
        db.analisisIA[s.uuid] = Object.assign({}, ia, { uuid: s.uuid, codigo_solicitud: s.codigo_solicitud, nit_verificado: ia.nit, analizado_por: 'admin@example.com', fecha_analisis: (pd(s.fecha_envio) ? O.addDays(pd(s.fecha_envio), 1) : now).toISOString() });
      });
    }
    if (!db.auditoria.length) {
      const ev = [];
      db.solicitudes.forEach(s => {
        const st = normEstado(s.estado_codigo), f = pd(s.fecha_aprobacion) || pd(s.fecha_envio);
        if (!f) return;
        if (s.fecha_aprobacion && ['ACTIVA', 'APROBADA', 'POR_VENCER', 'VENCIDO', 'BLOQUEADO_CORPORATIVO', 'BLOQUEADO_GERENCIA'].includes(st)) {
          ev.push({ f: new Date(f.getTime() + 3600000), a: 'APROBADA', c: s.codigo_solicitud, m: { uuid: s.uuid, comentarios: '', timestamp: f.toISOString() } });
        } else if (st === 'RECHAZADA') ev.push({ f: new Date(f.getTime() + 3600000), a: 'RECHAZADA TEMPORALMENTE', c: s.codigo_solicitud, m: { uuid: s.uuid, comentarios: s.comentarios || '' } });
        else if (st === 'DEVUELTA') ev.push({ f: O.addDays(pd(s.fecha_envio), 1), a: 'DEVUELTA', c: s.codigo_solicitud, m: { uuid: s.uuid, comentarios: s.comentarios || '' } });
      });
      Object.keys(db.analisisIA).forEach(u => {
        const a = db.analisisIA[u], f = pd(a.fecha_analisis);
        ev.push({ f: new Date(f.getTime() - 60000), a: 'PROCESAR_IA', c: a.codigo_solicitud, m: { uuid: u, docs_analizados: ['RUT', 'CERT_EXISTENCIA', 'ESTADOS_FIN', 'FORMATO_SOLICITUD'], alerta_vigencia: a.alerta_vigencia } });
        ev.push({ f, a: 'GUARDAR_RESULTADO_IA', c: a.codigo_solicitud, m: { uuid: u } });
      });
      ev.sort((x, y) => x.f - y.f).forEach(e => audit(db, 'admin@example.com', e.a, e.c, e.m, e.f));
    }
  }
  O.onSeed(init);

  // =========================================================================
  //  Solicitudes
  // =========================================================================
  H.apiGetKpis = function (token) {
    needSes(token);
    return T(db => kpisDe(db, null));
  };

  H.apiGetSolicitudes = function (token, filtro) {
    needSes(token);
    return T(db => {
      filtro = filtro || {};
      const all = filtrarSolicitudes(db, filtro);
      // Compatibilidad: JS_CentrosCreditos llama con {} y espera un array (el original devuelve {data,total}
      // y ese frontend falla con "solicitudes.forEach is not a function"; aquí se devuelve un array).
      if (!Object.keys(filtro).length) return all.slice(0, 500).map(toLight);
      const pagina = Math.max(1, parseInt(filtro.pagina) || 1);
      const limite = Math.min(500, parseInt(filtro.limite) || 100);
      return { data: all.slice((pagina - 1) * limite, pagina * limite).map(toLight), total: all.length };
    });
  };

  H.apiGetDetalleSolicitud = function (token, uuid) {
    needSes(token);
    return T(db => { const s = findSol(db, uuid); return s ? toDetail(s) : null; });
  };

  H.apiGetDetallesAprobacion = function (token, uuid) {
    needSes(token);
    return T(db => {
      const sol = findSol(db, uuid);
      if (!sol) throw new Error('Solicitud no encontrada: ' + uuid);
      let correoEj = ejecutivoEmail(db, sol.ejecutivo_cuenta);
      if (!correoEj || correoEj.toLowerCase().includes('ejecutivo-defecto@example.com')) correoEj = 'ejecutivo-por-defecto@example.com';
      const centros = centroList(db);
      const sel = codes(sol.centro_codigo).map(cod => {
        const h = centros.find(x => x.codigo === cod), r = (db.operacionesCentros || []).find(x => x.codigo === cod);
        return { codigo: cod, nombre: h ? h.nombre : cod, nit: h ? h.nit : '', razon: h ? h.razon : cod, monto_minimo: h ? h.monto_minimo : 5000000,
          correo_operaciones: r && r.correo_operaciones ? r.correo_operaciones : 'Sin correo registrado' };
      });
      return { monto: num(sol.monto), moneda: sol.moneda || 'COP', representante_legal: sol.nombre_rep_legal, correo_rep: sol.correo_rep,
        ejecutivo_cuenta: sol.ejecutivo_cuenta, correo_ejecutivo: correoEj, centros_seleccionados: sel };
    });
  };

  // ── Correos simulados ───────────────────────────────────────────────────────
  function mailShell(titulo, cuerpo) {
    return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="margin:0;background:#fff;font-family:Arial,sans-serif">' +
      '<div style="background:#3c796c;padding:18px 36px 0"><table width="100%"><tr><td style="font-size:24px;color:#fff;font-weight:400">demo<span style="color:#d08b43">H</span>otel</td>' +
      '<td style="text-align:right;color:#fff;font-size:11px;font-weight:bold">Área de crédito y cartera</td></tr></table><div style="height:3px;background:#d08b43;margin-top:14px"></div>' +
      '<div style="font-size:10px;color:#afd9cd;padding:4px 0 10px">www.example.com · CALLE 00 # 00-00, Ciudad, País</div></div>' +
      '<div style="padding:32px 36px"><h2 style="color:#0e362f;font-size:18px;margin:0 0 14px">' + esc(titulo) + '</h2>' + cuerpo + '</div>' +
      '<div style="background:#f4f9f9;padding:18px;text-align:center;border-top:1px solid #e0e0e0;font-size:11px;color:#9a9a9a">Mensaje automático del Sistema de Créditos CupoFlow (correo simulado por la demo).<br>© ' + new Date().getFullYear() + ' CupoFlow S.A.S.</div></body></html>';
  }
  const fechaCorreo = () => { const d = new Date(); return 'Bogotá, ' + d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear(); };
  function tablaCupos(cupos, centros, mon) {
    let total = 0, i = 0, filas = '';
    for (const cod in cupos) {
      const v = parseFloat(cupos[cod]) || 0; if (v <= 0) continue;
      const h = centros.find(x => x.codigo === cod) || { nombre: cod, nit: '', razon: cod };
      total += v;
      filas += '<tr style="background:' + (i++ % 2 ? '#f8fcfc' : '#fff') + '"><td style="padding:10px 14px;font-weight:700;color:#0e362f;border-bottom:1px solid #cae2e1">' + esc(h.nombre) +
        '</td><td style="padding:10px 14px;font-size:12px;color:#466A6A;border-bottom:1px solid #cae2e1">' + esc(h.razon) + '<br>NIT: ' + esc(h.nit || '—') +
        '</td><td style="padding:10px 14px;text-align:right;font-weight:800;color:#d08b43;border-bottom:1px solid #cae2e1">' + esc(mon) + ' ' + v.toLocaleString('es-CO') + '</td></tr>';
    }
    return '<table width="100%" style="border-collapse:collapse;border:1px solid #cae2e1;margin:10px 0"><tr style="background:#f1f9f8;font-size:11px;text-transform:uppercase;color:#466A6A"><th style="padding:10px 14px;text-align:left">Centro</th><th style="padding:10px 14px;text-align:left">Razón social / NIT</th><th style="padding:10px 14px;text-align:right">Cupo asignado</th></tr>' +
      filas + '<tr style="background:#f8fcfc"><td colspan="2" style="padding:10px 14px;font-weight:700">Total aprobado</td><td style="padding:10px 14px;text-align:right;font-weight:800;color:#d08b43">' + esc(mon) + ' ' + total.toLocaleString('es-CO') + '</td></tr></table>';
  }

  // ── Cambio de estado ────────────────────────────────────────────────────────
  H.apiActualizarEstado = function (payload) {
    payload = payload || {};
    const ses = O.getSession(payload.token || '');
    if (!ses || ses.rol !== 'ADMIN') throw new Error('No autorizado o sesión expirada.');
    const uuid = String(payload.uuid || '').trim();
    const accion = String(payload.accion || '').trim().toUpperCase();
    const comentarios = String(payload.comentarios || '').trim();
    if (!uuid) throw new Error('UUID de solicitud requerido.');
    if (!accion) throw new Error('Acción requerida.');
    return T(db => {
      const sol = findSol(db, uuid);
      if (!sol) throw new Error('Solicitud no encontrada: ' + uuid);
      const estadoNuevo = normEstado(accion);
      if (!ESTADOS_VALIDOS.includes(estadoNuevo)) throw new Error('Estado no reconocido: ' + accion);
      const centros = centroList(db);
      const mon = sol.moneda || 'COP';
      const enviarCarta = payload.enviarCarta !== false;   // el original ignora este flag y exige siempre el correo (ver informe)

      if (accion === 'APROBADA') {
        const montoAprobado = Number(payload.montoTotalAprobado);
        if (enviarCarta) {
          const correoRep = String(payload.correoRep || '').trim();
          const correoEj = String(payload.correoEjecutivo || '').trim();
          if (!correoRep) throw new Error('El correo del representante legal es obligatorio para la aprobación.');
          const cupos = (payload.cuposDistribuidos && typeof payload.cuposDistribuidos === 'object') ? payload.cuposDistribuidos : {};
          const razonSafe = String(sol.razon_social || '').trim().replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').slice(0, 80);
          const pdfName = payload.pdfCartaNombre || ('Carta_Aprobacion_Credito_' + razonSafe + '.pdf');
          const pdfSize = payload.pdfCartaBase64 && payload.pdfCartaBase64.length > 100 ? Math.floor(payload.pdfCartaBase64.length * 0.75) : 95000;
          // Documento "CARTA_APROBACION" (metadatos; en producción se guarda en la carpeta de Drive de la solicitud)
          db.documentos = db.documentos.filter(d => !(d.uuid_solicitud === sol.uuid && d.tipo_documento === 'CARTA_APROBACION'));
          const fid = newFileId();
          if (payload.pdfCartaBase64 && payload.pdfCartaBase64.length > 100 && payload.pdfCartaBase64.length < 900000) uploadedPdf.set(fid, payload.pdfCartaBase64);
          db.documentos.push({ uuid_solicitud: sol.uuid, tipo_documento: 'CARTA_APROBACION', drive_file_id: fid, nombre_archivo: pdfName, tamano_bytes: pdfSize, hash_sha256: '', estado_sync: 'SINCRONIZADO', fecha_subida: new Date().toISOString() });

          const docs = docsDe(db, sol.uuid);
          const adjFormato = docs.find(d => d.tipo_documento === 'FORMATO_SOLICITUD'), adjRut = docs.find(d => d.tipo_documento === 'RUT');
          const cuposTabla = Object.keys(cupos).length ? cupos : (() => { const o = {}; codes(sol.centro_codigo).forEach(c => { o[c] = '—'; }); return o; })();
          const montoTxt = mon + ' ' + (montoAprobado > 0 ? montoAprobado : num(sol.monto)).toLocaleString('es-CO');
          const cuerpo = '<p style="color:#777;font-size:13px">' + esc(fechaCorreo()) + '</p><p style="color:#555;font-size:14px;line-height:1.6">Nos complace informarle que su solicitud de crédito ha sido aprobada. A continuación encontrará el resumen y la distribución del cupo autorizado.</p>' +
            '<p style="font-size:13px"><b>Razón social:</b> ' + esc(sol.razon_social) + '<br><b>Radicado:</b> ' + esc(sol.codigo_solicitud) + '</p>' + tablaCupos(cupos, centros, mon) +
            '<p style="font-size:14px"><b>Monto aprobado:</b> ' + esc(montoTxt) + '</p><p style="color:#555;font-size:14px;line-height:1.6">Adjunto encontrará la carta formal de aprobación y el formato de solicitud original.</p>';
          O.mail({ to: correoRep, cc: correoEj || undefined, subject: 'Carta de aprobación de crédito – ' + sol.razon_social, html: mailShell('Solicitud de crédito aprobada', cuerpo),
            attachments: [pdfName].concat(adjFormato ? [adjFormato.nombre_archivo] : []) }, db);
          // Ráfaga a las operaciones de cada centro (sin un aviso por correo: se resume en uno solo)
          let nCentros = 0;
          codes(sol.centro_codigo).forEach(cod => {
            const r = (db.operacionesCentros || []).find(x => x.codigo === cod);
            if (!r || !r.correo_operaciones) return;
            const hn = r.nombre || cod;
            db.outbox.unshift({ id: O.uuid(), fecha: new Date().toISOString(), code: null, to: r.correo_operaciones,
              subject: 'Carta de aprobación de crédito – ' + sol.razon_social + ' – ' + hn,
              html: mailShell('Aprobación de crédito corporativo — ' + hn, '<p style="font-size:14px;color:#555;line-height:1.6">Estimado equipo de Operaciones de <b>' + esc(hn) + '</b>, se aprobó un crédito corporativo para <b>' + esc(sol.razon_social) + '</b> (NIT: ' + esc(sol.identificacion) + '). Adjuntos: carta de aprobación, RUT y formulario de solicitud. Por favor registrar el cupo aprobado.</p>'),
              attachments: [pdfName].concat(adjRut ? [adjRut.nombre_archivo] : []).concat(adjFormato ? [adjFormato.nombre_archivo] : []) });
            nCentros++;
          });
          if (nCentros) toast('<b>📧 Correos simulados a operaciones</b><br>Se registraron ' + nCentros + ' correos a los centros de la solicitud en la bandeja simulada.');
        }
        const hoy = new Date();
        sol.fecha_aprobacion = O.ymdhms(hoy);
        sol.aceptado_por = payload.aceptadoPor || 'Area de credito y cartera';
        sol.cupos_distribuidos_json = JSON.stringify(payload.cuposDistribuidos || {});
        sol.fecha_recibido_doc = O.ymd(hoy);
        sol.fecha_venc_doc = O.ymd(new Date(Date.now() + 365 * DAY));
        sol.vigencia_doc = 'Vigente';
        if (montoAprobado > 0) sol.monto_aprobado = montoAprobado;
        sol.comentario_decision = comentarios;
      }

      if (accion === 'RECHAZADA TEMPORALMENTE' || accion === 'DEVUELTA') {
        let correoEj = ejecutivoEmail(db, sol.ejecutivo_cuenta);
        if (!correoEj || correoEj.toLowerCase().includes('ejecutivo-defecto@example.com')) correoEj = 'ejecutivo-por-defecto@example.com';
        const correoRep = String(sol.correo_rep || '').trim();
        if (correoRep) {
          const devuelta = accion === 'DEVUELTA';
          const titulo = devuelta ? 'Solicitud de crédito devuelta para subsanación' : 'Estado de su solicitud de crédito';
          const link = 'https://formulario.example.com/?subsanar=' + encodeURIComponent(sol.uuid);
          const cuerpo = '<p style="color:#777;font-size:13px">' + esc(fechaCorreo()) + '</p><p style="font-size:14px;color:#555">Estimado(a) representante legal de <b>' + esc(sol.razon_social) + '</b> (Radicado: <b>' + esc(sol.codigo_solicitud) + '</b>),</p>' +
            '<p style="font-size:14px;color:#555;line-height:1.6">' + (devuelta ? 'Hemos revisado su solicitud de crédito y encontramos observaciones en la documentación que requieren ser subsanadas para poder continuar con el estudio.' : 'Agradecemos su interés en establecer una línea de crédito con nosotros. Tras revisar su expediente, por el momento no podemos proceder con la aprobación de acuerdo con nuestras políticas internas de riesgo.') + '</p>' +
            (comentarios ? '<div style="background:#fff3ed;border-left:4px solid #ea580c;padding:14px;margin:18px 0"><b style="color:#7c2d12;font-size:13px">Observaciones del Comité de Crédito:</b><p style="margin:6px 0 0;white-space:pre-wrap;color:#431407;font-size:13.5px">' + esc(comentarios) + '</p></div>' : '') +
            '<p style="text-align:center;margin:26px 0"><a href="' + esc(link) + '" style="background:#d08b43;color:#fff;padding:13px 28px;text-decoration:none;font-weight:bold;border-radius:8px">Adjuntar / Subsanar documentos pendientes →</a></p>';
          O.mail({ to: correoRep, cc: correoEj, subject: titulo + ' – ' + sol.razon_social, html: mailShell(titulo, cuerpo) }, db);
        }
      }

      const antes = normEstado(sol.estado_codigo);
      sol.estado_codigo = estadoNuevo;
      sol.comentarios = comentarios;
      if (estadoNuevo === 'RECHAZADA' || estadoNuevo === 'DEVUELTA') sol.comentario_decision = comentarios;
      if (estadoNuevo.startsWith('BLOQUEADO')) sol.razon_bloqueo = comentarios || accion;
      if (antes !== estadoNuevo) {
        db.historialEstados.push({ uuid: sol.uuid, estado_anterior: antes, estado_nuevo: estadoNuevo, cambiado_por: ses.email, comentario: comentarios, cambiado_en: new Date().toISOString() });
      }
      audit(db, ses.email, accion, sol.codigo_solicitud, { uuid: sol.uuid, comentarios, timestamp: new Date().toISOString() });
      return { ok: true, codigo_solicitud: sol.codigo_solicitud, accion };
    });
  };

  H.apiEditarSolicitud = function (payload) {
    payload = payload || {};
    const ses = O.getSession(payload.token || '');
    if (!ses || ses.rol !== 'ADMIN') return { ok: false, error: 'No tienes permisos para editar solicitudes.' };
    const uuid = String(payload.uuid || '').trim();
    if (!uuid) return { ok: false, error: 'UUID requerido.' };
    const d = payload.datos || {};
    return T(db => {
      const s = findSol(db, uuid);
      if (!s) return { ok: false, error: 'Solicitud no encontrada.' };
      ['razon_social', 'nombre_comercial', 'identificacion', 'direccion', 'ciudad', 'departamento', 'cod_postal', 'responsabilidad_fiscal',
        'nombre_rep_legal', 'tipo_id_rep', 'cargo_rep', 'correo_rep', 'tipo_solicitud', 'centro_codigo', 'moneda', 'ejecutivo_cuenta', 'comentarios',
        'vigencia_doc', 'es_filial', 'fact_email', 'fact_email_cc', 'fact_fecha_corte'].forEach(k => { if (d[k] !== undefined) s[k] = String(d[k]); });
      if (d.num_id_rep !== undefined) s.num_id_rep = String(d.num_id_rep).replace(/^'/, '');
      if (d.tel_rep !== undefined) s.tel_rep = String(d.tel_rep).replace(/^'/, '');
      if (d.monto !== undefined) s.monto = Number(d.monto) || 0;
      if (d.fecha_recibido_doc !== undefined) s.fecha_recibido_doc = d.fecha_recibido_doc ? O.ymd(pd(d.fecha_recibido_doc) || new Date()) : '';
      if (d.fecha_venc_doc !== undefined) s.fecha_venc_doc = d.fecha_venc_doc ? O.ymd(pd(d.fecha_venc_doc) || new Date()) : '';
      audit(db, ses.email, 'EDITAR_SOLICITUD', s.codigo_solicitud, { uuid: s.uuid, datos: d });
      return { ok: true };
    });
  };

  H.apiEliminarSolicitud = function (payload) {
    payload = payload || {};
    const ses = O.getSession(payload.token || '');
    if (!ses || ses.rol !== 'ADMIN') return { ok: false, error: 'No tienes permisos para eliminar solicitudes.' };
    const uuid = String(payload.uuid || '').trim();
    if (!uuid) return { ok: false, error: 'UUID requerido.' };
    return T(db => {
      const s = findSol(db, uuid);
      const codigo = s ? s.codigo_solicitud : '';
      if (s) {
        db.solicitudes = db.solicitudes.filter(x => x !== s);
        delete db.analisisIA[s.uuid];
        db.documentos = db.documentos.filter(d => d.uuid_solicitud !== s.uuid);
        Object.keys(db.notificacionesLeidas).forEach(k => { db.notificacionesLeidas[k] = (db.notificacionesLeidas[k] || []).filter(u => u !== s.uuid); });
      }
      audit(db, ses.email, 'ELIMINAR_SOLICITUD', codigo, { uuid });
      return { ok: true };
    });
  };

  // ── Dashboard ───────────────────────────────────────────────────────────────
  H.apiGetDashboardComboData = function (token, force, periodo) {
    needSes(token);
    return T(db => {
      const kpis = kpisDe(db, periodo);
      kpis.pendientesGlobales = (periodo && periodo.type !== 'ALL') ? kpisDe(db, { type: 'ALL' }).pendientes : kpis.pendientes;
      const all = filtrarSolicitudes(db, { periodo });
      return { kpis, recientes: { data: all.slice(0, 8).map(toLight), total: all.length }, tendencias: tendenciasDe(db, periodo) };
    });
  };

  // ── Notificaciones ──────────────────────────────────────────────────────────
  H.apiGetNotificacionesLeidas = function (token) {
    const s = needSes(token);
    return T(db => (db.notificacionesLeidas[s.email.toLowerCase()] || []).slice());
  };
  H.apiMarcarNotificacionesLeidas = function (token, uuids) {
    const s = needSes(token);
    if (!uuids || !uuids.length) return { ok: true };
    return T(db => {
      const k = s.email.toLowerCase(), set = new Set(db.notificacionesLeidas[k] || []);
      uuids.forEach(u => set.add(String(u)));
      db.notificacionesLeidas[k] = Array.from(set);
      return { ok: true };
    });
  };
  H.apiMarcarNotificacionesUnread = function (token, uuids) {
    const s = needSes(token);
    if (!uuids || !uuids.length) return { ok: true };
    return T(db => {
      const k = s.email.toLowerCase(), quitar = new Set(uuids.map(String));
      db.notificacionesLeidas[k] = (db.notificacionesLeidas[k] || []).filter(u => !quitar.has(u));
      return { ok: true };
    });
  };

  // =========================================================================
  //  Configuración (catálogos)
  // =========================================================================
  const CFG = {
    Comerciales: { tabla: 'comerciales', cols: ['nombre', 'apellido', 'correo'] },
    Centros: { tabla: 'centros', cols: ['codigo', 'nombre', 'nit', 'razon', 'monto_minimo'] },
    Operaciones_Centros: { tabla: 'operacionesCentros', cols: ['codigo', 'nombre', 'nit', 'correo_operaciones'] },
    Monedas: { tabla: 'monedas', cols: ['codigo', 'nombre'] },
    TiposDocumento: { tabla: 'tiposDocumento', cols: ['codigo', 'nombre'] },
    TiposSolicitud: { tabla: 'tiposSolicitud', cols: ['codigo', 'nombre'] }
  };
  function cfgSheet(name) {
    const c = CFG[name];
    if (!c) throw new Error('No existe la hoja de configuración: ' + name);
    return c;
  }
  function cfgSync(db, name) {
    if (name === 'Comerciales') db.ejecutivos = (db.comerciales || []).map(c => c.correo).filter(Boolean).sort();
  }

  H.apiGetConfiguracion = function (token, sheetName) {
    needSes(token);
    if (!sheetName) throw new Error('Nombre de hoja requerido.');
    return T(db => {
      const c = cfgSheet(sheetName);
      return { headers: c.cols.slice(), rows: (db[c.tabla] || []).map(r => c.cols.map(k => (r[k] === undefined || r[k] === null) ? '' : r[k])) };
    });
  };

  H.apiGuardarConfiguracion = function (token, sheetName, datos, idCol, idVal) {
    const ses = O.getSession(token || '');
    if (!ses || ses.rol !== 'ADMIN') throw new Error('No tienes permisos para guardar configuraciones.');
    if (!sheetName) throw new Error('Nombre de hoja requerido.');
    return T(db => {
      const c = cfgSheet(sheetName);
      if (c.cols.indexOf(idCol) === -1) throw new Error('Columna identificadora no encontrada: ' + idCol);
      const tabla = db[c.tabla] = db[c.tabla] || [];
      datos = datos || {};
      const fila = {};
      c.cols.forEach(k => { const v = datos[k] !== undefined ? datos[k] : ''; fila[k] = (k === 'monto_minimo' && v !== '' && isFinite(Number(v))) ? Number(v) : v; });
      let idx = -1;
      if (idVal) idx = tabla.findIndex(r => String(r[idCol] == null ? '' : r[idCol]).trim() === String(idVal).trim());
      if (idx !== -1) tabla[idx] = Object.assign({}, tabla[idx], fila);
      else {
        const nuevo = String(datos[idCol] || '').trim();
        if (nuevo && tabla.some(r => String(r[idCol] == null ? '' : r[idCol]).trim() === nuevo)) throw new Error('Ya existe un registro con ' + idCol + ' igual a "' + nuevo + '".');
        tabla.push(fila);
      }
      cfgSync(db, sheetName);
      return { ok: true };
    });
  };

  H.apiEliminarConfiguracion = function (token, sheetName, idCol, idVal) {
    const ses = O.getSession(token || '');
    if (!ses || ses.rol !== 'ADMIN') throw new Error('No tienes permisos para eliminar configuraciones.');
    if (!sheetName || !idCol || !idVal) throw new Error('Datos incompletos para eliminar.');
    return T(db => {
      const c = cfgSheet(sheetName);
      if (c.cols.indexOf(idCol) === -1) throw new Error('Columna identificadora no encontrada: ' + idCol);
      const tabla = db[c.tabla] || [];
      const i = tabla.findIndex(r => String(r[idCol] == null ? '' : r[idCol]).trim() === String(idVal).trim());
      if (i !== -1) tabla.splice(i, 1);
      cfgSync(db, sheetName);
      return { ok: true };
    });
  };

  // =========================================================================
  //  Auditoría
  // =========================================================================
  H.apiGetLogAuditoria = function (token, limite) {
    const ses = O.getSession(token || '');
    if (!ses) return [];
    return T(db => {
      const a = db.auditoria || [];
      const count = Math.min(a.length, limite || 100);
      return a.slice(a.length - count).reverse().map(r => {
        let uuid = '';
        try { const m = JSON.parse(r.metadata_json || '{}'); uuid = String(m.uuid || m.solicitud_uuid || '').trim(); } catch (_) {}
        return { id: String(r.id), fecha_evento: r.fecha_evento, actor: r.actor, accion: r.accion, codigo_solicitud: r.codigo_solicitud, uuid, metadata_json: r.metadata_json || '{}' };
      });
    });
  };

  // =========================================================================
  //  Documentos (Drive simulado)
  // =========================================================================
  H.apiGetDocumentosSolicitud = function (token, uuid) {
    needSes(token);
    if (!uuid) throw new Error('UUID de solicitud requerido.');
    return T(db => {
      const s = findSol(db, uuid), id = s ? s.uuid : String(uuid).trim().toLowerCase();
      return docsDe(db, id).map(d => ({ uuid_solicitud: d.uuid_solicitud, tipo_documento: d.tipo_documento, drive_file_id: d.drive_file_id, nombre_archivo: d.nombre_archivo,
        tamano_bytes: num(d.tamano_bytes), hash_sha256: d.hash_sha256 || '', estado_sync: d.estado_sync || 'SINCRONIZADO', fecha_subida: d.fecha_subida || '' }));
    });
  };

  H.apiSubirDocumentoAdicional = function (payload) {
    payload = payload || {};
    const ses = O.getSession(payload.token || '');
    if (!ses || ses.rol !== 'ADMIN') throw new Error('No tienes permisos para subir documentos.');
    const uuid = String(payload.uuid || '').trim(), tipo = String(payload.tipo_documento || '').trim(), nombre = String(payload.nombre_archivo || '').trim(), b64 = String(payload.base64 || '').trim();
    if (!uuid) throw new Error('UUID de solicitud requerido.');
    if (!tipo) throw new Error('Tipo de documento requerido.');
    if (!nombre) throw new Error('Nombre de archivo requerido.');
    if (!b64) throw new Error('Contenido base64 del archivo requerido.');
    return T(db => {
      const sol = findSol(db, uuid);
      if (!sol) throw new Error('Solicitud no encontrada: ' + uuid);
      if (!sol.carpeta_drive_id) throw new Error('No se encontró la carpeta en Drive asignada a esta solicitud.');
      const fid = newFileId();
      if (b64.length < 900000) uploadedPdf.set(fid, b64);
      db.documentos.push({ uuid_solicitud: sol.uuid, tipo_documento: tipo, drive_file_id: fid, nombre_archivo: nombre,
        tamano_bytes: num(payload.tamano_bytes) || Math.floor(b64.length * 0.75), hash_sha256: '', estado_sync: 'SINCRONIZADO', fecha_subida: new Date().toISOString() });
      audit(db, ses.email, 'SUBIR_DOCUMENTO_ADICIONAL', sol.codigo_solicitud, { uuid: sol.uuid, tipo, nombre, file_id: fid });
      toast('<b>📁 Google Drive simulado</b><br>“' + esc(nombre) + '” se registró como documento del expediente (solo metadatos; el archivo no sale de tu navegador).');
      return { ok: true, file_id: fid };
    });
  };

  H.apiEliminarDocumento = function (token, fileId) {
    const ses = O.getSession(token || '');
    if (!ses || ses.rol !== 'ADMIN') throw new Error('No tienes permisos para eliminar documentos.');
    if (!fileId) throw new Error('ID de archivo requerido.');
    return T(db => {
      const d = db.documentos.find(x => x.drive_file_id === fileId);
      if (!d) throw new Error('Documento no encontrado en la base de datos.');
      const sol = findSol(db, d.uuid_solicitud);
      db.documentos = db.documentos.filter(x => x !== d);
      uploadedPdf.delete(fileId);
      audit(db, ses.email, 'ELIMINAR_DOCUMENTO', sol ? sol.codigo_solicitud : '', { uuidSolicitud: d.uuid_solicitud, tipo: d.tipo_documento, nombre: d.nombre_archivo, file_id: fileId });
      return { ok: true };
    });
  };

  // ── Visor de documentos (sustituye el enlace a Drive por un PDF de ejemplo) ─
  function b64ToBlob(b64, type) {
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type });
  }
  const viewerCss = '.pnl-vw{position:fixed;inset:0;z-index:2147483100;background:rgba(10, 30, 29,.65);display:flex;align-items:center;justify-content:center;padding:18px;font-family:system-ui,sans-serif}' +
    '.pnl-vw-box{background:#fff;border-radius:14px;width:min(960px,100%);height:min(88vh,760px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.45)}' +
    '.pnl-vw-h{background:#0e362f;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:14px}' +
    '.pnl-vw-h b{display:block}.pnl-vw-h small{color:#d08b43}.pnl-vw-x{background:none;border:0;color:#fff;font-size:24px;cursor:pointer;line-height:1}' +
    '.pnl-vw-n{background:#fff2e6;border-bottom:1px solid #f5cea4;padding:8px 16px;font-size:12px;color:#5f390e}.pnl-vw iframe{flex:1;border:0;width:100%}.pnl-vw-f{display:flex;gap:16px;align-items:center;padding:9px 16px;border-top:1px solid #e3eeee;font-size:12.5px;background:#f8fcfc}.pnl-vw-f a{color:#0e362f;font-weight:700}.pnl-vw-f span{color:#6a8d89;margin-left:auto}';
  function openViewer(fileId) {
    const info = O.read(db => {
      const d = (db.documentos || []).find(x => x.drive_file_id === fileId);
      if (!d) return null;
      const s = (db.solicitudes || []).find(x => x.uuid === d.uuid_solicitud);
      return { d: Object.assign({}, d), s: s ? { codigo: s.codigo_solicitud, razon: s.razon_social, nit: s.identificacion } : null };
    });
    const nombre = info ? info.d.nombre_archivo : 'Documento';
    let url, nota;
    if (uploadedPdf.has(fileId)) {
      try { url = URL.createObjectURL(b64ToBlob(uploadedPdf.get(fileId), 'application/pdf')); nota = 'Muestra el PDF que subiste en esta sesión (se conserva solo en memoria).'; } catch (_) {}
    }
    if (!url) {
      const lines = ['Documento de ejemplo generado por la demo (no es un archivo real).', '', 'Archivo: ' + ascii(nombre), 'Tipo: ' + (info ? info.d.tipo_documento : '-'),
        info && info.s ? 'Solicitud: ' + info.s.codigo : '', info && info.s ? 'Empresa: ' + ascii(info.s.razon) + ' (NIT ' + info.s.nit + ')' : '', '',
        'En produccion, este visor abre el PDF original almacenado en Google Drive.', 'Aqui Drive esta simulado: solo se guardan metadatos del documento.'];
      url = O.demoPdfUrl(ascii(nombre), lines);
      nota = 'Vista simulada de Google Drive: se muestra un PDF de ejemplo generado en tu navegador.';
    }
    const wrap = document.createElement('div');
    wrap.className = 'pnl-vw';
    wrap.innerHTML = '<style>' + viewerCss + '</style><div class="pnl-vw-box"><div class="pnl-vw-h"><div><b>' + esc(nombre) + '</b><small>' + esc(info ? info.d.tipo_documento : '') + (info && info.s ? ' · ' + esc(info.s.codigo) : '') + '</small></div><button class="pnl-vw-x" aria-label="Cerrar visor">×</button></div>' +
      '<div class="pnl-vw-n">📁 ' + esc(nota) + '</div><iframe title="Visor de documento" src="' + esc(url) + '"></iframe>' +
      '<div class="pnl-vw-f"><a href="' + esc(url) + '" target="_blank" rel="noopener">Abrir en pestaña nueva</a><a href="' + esc(url) + '" download="' + esc(nombre) + '">Descargar PDF</a><span>¿No se ve el documento? Tu navegador puede no incluir visor de PDF integrado.</span></div></div>';
    const cerrar = () => { wrap.remove(); };
    wrap.querySelector('.pnl-vw-x').onclick = cerrar;
    wrap.addEventListener('click', e => { if (e.target === wrap) cerrar(); });
    wrap.id = 'pnlDocViewer';
    document.body.appendChild(wrap);
  }
  document.addEventListener('click', e => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    const href = a.getAttribute('href') || '';
    let m = href.match(/^https:\/\/drive\.google\.com\/file\/d\/([^/]+)\/view/);
    if (m) { e.preventDefault(); e.stopPropagation(); openViewer(decodeURIComponent(m[1])); return; }
    if (/^https:\/\/drive\.google\.com\/drive\/folders\//.test(href)) {
      e.preventDefault(); e.stopPropagation();
      toast('<b>📁 Google Drive simulado</b><br>En producción este botón abre la carpeta de Drive del expediente. En la demo los archivos son solo metadatos; usa “Ver PDF” en la pestaña Documentos.');
    }
  }, true);

  // Las descargas de Excel devuelven una URL blob: se convierten en descarga con nombre de archivo correcto.
  const dlNames = {};
  const _open = window.open;
  window.open = function (url) {
    if (typeof url === 'string' && dlNames[url]) {
      const a = document.createElement('a'); a.href = url; a.download = dlNames[url];
      document.body.appendChild(a); a.click(); a.remove();
      return null;
    }
    return _open.apply(window, arguments);
  };
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  function blobXlsx(nombre, sheets) {
    const url = URL.createObjectURL(b64ToBlob(O.makeXlsxBase64(sheets), XLSX_MIME));
    dlNames[url] = nombre;
    toast('<b>📊 Google Sheets simulado</b><br>El Excel “' + esc(nombre) + '” se generó en tu navegador (en producción se crea una hoja en Drive).');
    return { ok: true, url };
  }
  const stamp = () => { const d = new Date(); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()); };
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';

  // =========================================================================
  //  Exportaciones
  // =========================================================================
  function labelPeriodo(p) {
    if (!p || p.type === 'ALL') return 'Todo el Historial';
    return { HOY: 'Hoy', ESTA_SEMANA: 'Esta Semana', ESTE_MES: 'Este Mes', ESTE_ANIO: 'Este Anio', ESTE_ANO: 'Este Anio' }[p.type] || (p.type === 'CUSTOM' ? 'Rango ' + (p.inicio || '') + ' a ' + (p.fin || '') : 'Todo');
  }
  function filasDashboard(db, periodo, limite) {
    return filtrarSolicitudes(db, { periodo }).slice(0, limite).map(s => ({
      razon: s.razon_social || '', codigo: s.codigo_solicitud || '', nit: s.identificacion || '', rep: s.nombre_rep_legal || '', centros: s.centro_codigo || '',
      tipo: s.tipo_solicitud || '', estado: accionDe(s), fecha: s.fecha_envio || ''
    }));
  }

  H.apiExportarDashboardExcel = function (token, periodo) {
    needSes(token);
    return T(db => {
      const k = kpisDe(db, periodo), filas = filasDashboard(db, periodo, 500), lab = labelPeriodo(periodo);
      const rows = [['CENTROS DEMO - REPORTE DE CREDITOS'], [], ['Periodo:', lab, '', '', '', 'Generado:', O.ymdhms(new Date())], [],
        ['INDICADORES DE RENDIMIENTO (KPIs)'],
        ['Total Solicitudes', k.total, '', 'Aprobadas', k.aprobadas], ['Pendientes', k.pendientes, '', 'Rechazadas', k.rechazadas], ['Vencidas', k.vencidas, '', '', ''], [],
        ['DETALLE DE SOLICITUDES'],
        ['Razon Social / Empresa', 'Codigo Solicitud', 'Identificacion', 'Representante', 'Centros', 'Tipo Solicitud', 'Estado Actual', 'Fecha Envio']];
      if (filas.length) filas.forEach(f => rows.push([f.razon, f.codigo, f.nit, f.rep, f.centros, f.tipo, f.estado, f.fecha]));
      else rows.push(['No se encontraron registros para este periodo.']);
      return blobXlsx('Cuadra_Reporte_Creditos_' + lab.replace(/\s+/g, '_') + '.xlsx', [{ name: 'Resumen de Creditos', rows }]);
    });
  };

  H.apiExportarDashboardCSV = function (token, periodo) {
    needSes(token);
    return T(db => {
      let csv = '\uFEFFRazon Social,Codigo Solicitud,Identificacion,Representante,Centros,Tipo Solicitud,Estado,Fecha Envio\r\n';
      filasDashboard(db, periodo, 500).forEach(f => { csv += [f.razon, f.codigo, f.nit, f.rep, f.centros, f.tipo, f.estado, f.fecha].map(q).join(',') + '\r\n'; });
      return csv;
    });
  };

  H.apiExportarDashboardPresentacion = function (token, periodo, base64Dona, base64Barras, formato) {
    needSes(token);
    return T(db => {
      const k = kpisDe(db, periodo), lab = labelPeriodo(periodo), filas = filasDashboard(db, periodo, 6);
      if (formato === 'pdf') {
        const lines = ['Periodo: ' + ascii(lab), 'Generado: ' + O.ymdhms(new Date()), '', 'Total recibidas: ' + k.total, 'Pendientes: ' + k.pendientes, 'Aprobadas: ' + k.aprobadas, 'Vencidas: ' + k.vencidas, '', 'Ultimas solicitudes:']
          .concat(filas.map(f => '- ' + ascii(f.razon).slice(0, 34) + ' | ' + f.codigo.slice(0, 22) + ' | ' + f.estado)).concat(['', 'Reporte simulado: en produccion se exporta desde Google Slides.']);
        toast('<b>📑 Reporte PDF simulado</b><br>Documento generado en tu navegador (en producción: Google Slides exportado a PDF).');
        return { ok: true, url: O.demoPdfUrl('CupoFlow - Reporte financiero', lines) };
      }
      const img = s => (typeof s === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s)) ? s : '';
      const dona = img(base64Dona), barras = img(base64Barras);
      const card = (t, v, c) => '<div class="k" style="border-top:6px solid ' + c + '"><small>' + t + '</small><b style="color:' + c + '">' + v + '</b></div>';
      const html = '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>CupoFlow - Presentación (simulada)</title><style>body{margin:0;background:#e8f2f1;font-family:Arial,sans-serif;color:#1d3b3c}' +
        '.bn{background:#fff2e6;border-bottom:1px solid #f5cea4;padding:10px 20px;font-size:13px;color:#5f390e}.s{width:min(960px,94vw);aspect-ratio:16/9;margin:22px auto;background:#f8fcfc;border-radius:6px;box-shadow:0 8px 30px rgba(0,0,0,.18);position:relative;overflow:hidden;padding:0}' +
        '.s h2{margin:0;background:#1b3235;color:#ca711f;padding:2.2% 5%;font-size:22px}.in{padding:3% 5%}.cover{background:#fff}.cover:after{content:"";position:absolute;right:0;top:0;width:30%;height:100%;background:#1b3235;clip-path:polygon(100% 0,100% 100%,0 100%)}' +
        '.cover h1{font-size:46px;margin:0 0 10px;color:#1d3b3c}.gold{color:#ca711f;font-weight:700}.ks{display:flex;gap:3%}.k{flex:1;background:#fff;border:1px solid #e2f0f0;padding:6% 2%;text-align:center}.k b{display:block;font-size:44px;margin-top:8px}.k small{font-size:12px;color:#638c8c;font-weight:700}' +
        'table{width:100%;border-collapse:collapse;font-size:12px}th{background:#1b3235;color:#fff;padding:7px;text-align:left}td{padding:6px 7px;border-bottom:1px solid #e2f0f0}img{max-width:100%;max-height:78%}</style></head><body>' +
        '<div class="bn">🖥️ <b>Presentación simulada.</b> En producción se crea una presentación de Google Slides con estos mismos indicadores; aquí se genera en tu navegador.</div>' +
        '<div class="s cover"><div class="in" style="padding-top:8%"><small style="color:#638c8c;font-weight:700">CENTROS DEMO · SISTEMA DE CRÉDITOS</small><p class="gold">' + esc(lab.toUpperCase()) + '</p><h1>REPORTE<br>FINANCIERO</h1><small style="color:#93b9b9">Generado: ' + esc(O.ymdhms(new Date())) + '</small></div></div>' +
        '<div class="s"><h2>Indicadores Clave (KPIs)</h2><div class="in"><div class="ks">' + card('TOTAL RECIBIDAS', k.total, '#1b3235') + card('PENDIENTES', k.pendientes, '#ca711f') + card('APROBADAS', k.aprobadas, '#16a34a') + card('VENCIDAS', k.vencidas, '#dc2626') + '</div></div></div>' +
        (dona ? '<div class="s"><h2>Distribución por Estado</h2><div class="in" style="text-align:center"><img alt="Gráfico de estados" src="' + dona + '"></div></div>' : '') +
        (barras ? '<div class="s"><h2>Evolución de Solicitudes</h2><div class="in" style="text-align:center"><img alt="Gráfico de tendencia" src="' + barras + '"></div></div>' : '') +
        '<div class="s"><h2>Últimas Solicitudes</h2><div class="in"><table><tr><th>Empresa</th><th>Código</th><th>Tipo</th><th>Estado</th><th>Fecha</th></tr>' +
        filas.map(f => '<tr><td>' + esc(f.razon.slice(0, 30)) + '</td><td>' + esc(f.codigo) + '</td><td>' + esc(f.tipo) + '</td><td>' + esc(f.estado) + '</td><td>' + esc(String(f.fecha).slice(0, 10)) + '</td></tr>').join('') + '</table></div></div></body></html>';
      toast('<b>🖥️ Google Slides simulado</b><br>Presentación generada en tu navegador y abierta en una pestaña nueva.');
      return { ok: true, url: URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })) };
    });
  };

  H.apiExportarSolicitudesExcel = function (token, filtro) {
    needSes(token);
    return T(db => {
      const f = Object.assign({}, filtro || {});
      const rows = [['Código de solicitud', 'Razón social', 'Identificación (NIT)', 'Tipo de solicitud', 'Filial', 'Monto', 'Moneda', 'Centro(es)', 'Estado', 'Fecha de envío']];
      filtrarSolicitudes(db, f).slice(0, 500).forEach(s => rows.push([s.codigo_solicitud || '', s.razon_social || '', s.identificacion || '', s.tipo_solicitud || '', s.es_filial || 'NO', num(s.monto), s.moneda || 'COP', s.centro_codigo || '', accionDe(s), s.fecha_envio || '']));
      return blobXlsx('Cuadra_Solicitudes_' + stamp() + '.xlsx', [{ name: 'Solicitudes', rows }]);
    });
  };

  H.apiExportarSolicitudesCSV = function (token, filtro) {
    needSes(token);
    return T(db => {
      let csv = '\uFEFFCodigo Solicitud,Razon Social,Identificacion,Tipo Solicitud,Filial,Monto,Moneda,Centros,Estado,Fecha Envio\r\n';
      filtrarSolicitudes(db, Object.assign({}, filtro || {})).slice(0, 500).forEach(s => {
        csv += [q(s.codigo_solicitud), q(s.razon_social), q(s.identificacion), q(s.tipo_solicitud), q(s.es_filial || 'NO'), num(s.monto), q(s.moneda || 'COP'), q(s.centro_codigo), q(accionDe(s)), q(s.fecha_envio)].join(',') + '\r\n';
      });
      return csv;
    });
  };

  H.apiExportarCreditosExcel = function (token, filtros) {
    needSes(token);
    return T(db => {
      const rows = [['ID Crédito', 'Razón social', 'Identificación (NIT)', 'Centro asignado', 'Monto cupo', 'Fecha aprobación', 'Estado', 'Vigencia doc.', 'Fecha venc. doc.', 'Correo facturación', 'Razón bloqueo']];
      creditosDe(db, filtros).forEach(c => rows.push([c.id, c.razon_social, c.nit, c.centro, Number(String(c.monto).replace(/[^0-9.-]/g, '')) || 0, c.fecha_aprobacion, c.estado_credito, c.vigencia_doc, c.fecha_venc_doc, c.facturacion_electronica, c.razon_bloqueo]));
      return blobXlsx('Cuadra_Creditos_' + stamp() + '.xlsx', [{ name: 'Creditos', rows }]);
    });
  };

  H.apiExportarCreditosCSV = function (token, filtros) {
    needSes(token);
    return T(db => {
      let csv = '\uFEFFID Credito;Razon Social;NIT;Centro;Monto;Fecha Aprobacion;Estado;Vigencia Doc;Fecha Venc Doc;Correo Facturacion;Razon Bloqueo\r\n';
      creditosDe(db, filtros).forEach(c => { csv += [c.id, c.razon_social, c.nit, c.centro, c.monto, c.fecha_aprobacion, c.estado_credito, c.vigencia_doc, c.fecha_venc_doc, c.facturacion_electronica, c.razon_bloqueo].map(q).join(';') + '\r\n'; });
      return csv;
    });
  };

  // =========================================================================
  //  Créditos
  // =========================================================================
  H.apiGetCreditos = function (token, filtros) {
    needSes(token);
    return T(db => {
      filtros = filtros || {};
      const pagina = Math.max(1, parseInt(filtros.pagina) || 1);
      const limite = Math.min(500, parseInt(filtros.limite) || 100);
      const todos = creditosDe(db, filtros);
      return { data: todos.slice((pagina - 1) * limite, pagina * limite), total: todos.length };
    });
  };

  H.apiGetEstadisticasCreditos = function (token) {
    const ses = O.getSession(token || '');
    if (!ses) return { total: 0, activos: 0, vigentes: 0, no_vigentes: 0, empresas: 0 };
    return T(db => {
      const st = { total: 0, activos: 0, vigentes: 0, no_vigentes: 0, empresas: new Set() };
      creditosDe(db, {}).forEach(c => {
        st.total++;
        if (String(c.estado_credito).trim().toLowerCase() === 'activo') st.activos++;
        const v = String(c.vigencia_doc).trim().toLowerCase();
        if (v === 'vigente') st.vigentes++;
        if (v === 'no vigente') st.no_vigentes++;
        if (String(c.nit).trim()) st.empresas.add(String(c.nit).trim());
      });
      return { total: st.total, activos: st.activos, vigentes: st.vigentes, no_vigentes: st.no_vigentes, empresas: st.empresas.size };
    });
  };

  const parseIdx = raw => { const p = String(raw || '').split('_'); return { uuid: p[0], centro: p[1] }; };
  const parseCupos = s => { try { return (s.cupos_distribuidos_json && s.cupos_distribuidos_json !== '{}') ? JSON.parse(s.cupos_distribuidos_json) : {}; } catch (_) { return {}; } };
  function perfilObj(sol) {
    const raw = String(sol.perfil_creado || '').trim();
    let o = {};
    if (raw.startsWith('{')) { try { o = JSON.parse(raw); } catch (_) {} }
    else if (raw.toUpperCase() === 'TRUE' || raw === '1') codes(sol.centro_codigo).forEach(c => { o[c] = true; });
    return o;
  }

  H.apiActualizarCredito = function (payload) {
    payload = payload || {};
    const ses = O.getSession(payload.token || '');
    if (!ses || ses.rol !== 'ADMIN') return { ok: false, error: 'No tienes permisos para editar créditos.' };
    const { uuid, centro } = parseIdx(payload.rowIdx), d = payload.datos || {};
    if (!uuid || !centro) return { ok: false, error: 'Identificador de crédito virtual inválido.' };
    return T(db => {
      const sol = findSol(db, uuid);
      if (!sol) return { ok: false, error: 'La solicitud origen no existe.' };
      const cupos = parseCupos(sol);
      cupos[centro] = Number(String(d.monto || '').replace(/[^0-9]/g, '')) || 0;
      let dbAcc = accionDe(sol) || 'APROBADA';
      if (d.estado_credito) {
        const st = String(d.estado_credito).toLowerCase();
        if (st === 'vencido' || st === 'inactivo') dbAcc = 'VENCIDO';
        else if (st.includes('corporativo')) dbAcc = 'BLOQUEADO CORPORATIVO';
        else if (st.includes('gerencia')) dbAcc = 'BLOQUEADO GERENCIA';
        else if (st.includes('vencer')) dbAcc = 'POR VENCER';
        else if (st === 'vigente' || st === 'activo') dbAcc = 'APROBADA';
      }
      if (d.perfil_creado !== undefined) {
        const pc = perfilObj(sol);
        if (d.perfil_creado === 'TRUE' || d.perfil_creado === true) pc[centro] = true; else delete pc[centro];
        sol.perfil_creado = JSON.stringify(pc);
      }
      sol.cupos_distribuidos_json = JSON.stringify(cupos);
      if (d.fecha_recibido_doc) sol.fecha_recibido_doc = O.ymd(pd(d.fecha_recibido_doc) || new Date());
      if (d.fecha_venc_doc) sol.fecha_venc_doc = O.ymd(pd(d.fecha_venc_doc) || new Date());
      sol.vigencia_doc = d.vigencia_doc || sol.vigencia_doc || 'Vigente';
      sol.comentarios = d.novedades !== undefined ? d.novedades : (sol.comentarios || '');
      sol.estado_codigo = normEstado(dbAcc);
      sol.razon_bloqueo = d.razon_bloqueo !== undefined ? d.razon_bloqueo : (sol.razon_bloqueo || '');
      audit(db, ses.email, 'ACTUALIZAR_CREDITO', sol.codigo_solicitud, { centro, datos: d });
      return { ok: true };
    });
  };

  H.apiEliminarCredito = function (payload) {
    payload = payload || {};
    const ses = O.getSession(payload.token || '');
    if (!ses || ses.rol !== 'ADMIN') return { ok: false, error: 'No tienes permisos para eliminar créditos.' };
    const { uuid, centro } = parseIdx(payload.rowIdx);
    if (!uuid || !centro) return { ok: false, error: 'Identificador de crédito virtual inválido.' };
    return T(db => {
      const sol = findSol(db, uuid);
      if (!sol) return { ok: false, error: 'La solicitud origen no existe.' };
      const cupos = parseCupos(sol);
      delete cupos[centro];
      sol.cupos_distribuidos_json = JSON.stringify(cupos);
      sol.estado_codigo = Object.keys(cupos).length === 0 ? 'RECHAZADA' : normEstado(accionDe(sol));
      audit(db, ses.email, 'ELIMINAR_CREDITO', sol.codigo_solicitud, { centro });
      return { ok: true };
    });
  };

  H.apiGetCentrosEnCreditos = function (token) {
    if (!O.getSession(token || '')) return [];
    return T(db => {
      const set = new Set();
      db.solicitudes.forEach(s => {
        const st = normEstado(s.estado_codigo);
        if (['APROBADA', 'ACTIVA', 'VENCIDO', 'POR_VENCER'].includes(st) || st.startsWith('BLOQUEADO')) codes(s.centro_codigo).forEach(c => set.add(c));
      });
      return Array.from(set).sort();
    });
  };

  H.apiTogglePerfilCreado = function (payload) {
    payload = payload || {};
    const ses = O.getSession(payload.token || '');
    if (!ses || ses.rol !== 'ADMIN') return { ok: false, error: 'No tienes permisos para modificar el estado de perfil creado.' };
    const { uuid, centro } = parseIdx(payload.rowIdx);
    if (!uuid || !centro) return { ok: false, error: 'Índice de fila o código de centro inválido.' };
    return T(db => {
      const sol = findSol(db, uuid);
      if (!sol) return { ok: false, error: 'Registro de crédito no encontrado.' };
      const pc = perfilObj(sol);
      if (payload.checked) pc[centro] = true; else delete pc[centro];
      sol.perfil_creado = JSON.stringify(pc);
      audit(db, ses.email, 'TOGGLE_PERFIL_CREADO', sol.codigo_solicitud, { checked: payload.checked });
      return { ok: true };
    });
  };

  H.apiGetTodosCentros = function (token) {
    needSes(token);
    return T(db => centroList(db));
  };

  function codigoSolicitud(razon, tipo, uuid) {
    const partes = ascii(razon || '').replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/);
    const pfx = { AMPLIACION: 'AMP', RENOVACION: 'REN', HOMOLOGACION: 'HOM' }[tipo] || 'SOL';
    return stamp().slice(0, 8) + '-' + pfx + '-' + (partes[0] || 'SIN').toUpperCase().slice(0, 10) + '-' + String(uuid).replace(/-/g, '').slice(0, 4).toUpperCase();
  }
  function nuevaSolicitudBase(db, o) {
    const uuid = O.uuid(), ahora = new Date();
    return Object.assign({
      uuid, codigo_solicitud: codigoSolicitud(o.razon_social, 'NUEVA', uuid), estado_sync: 'SINCRONIZADO', tipo_solicitud: 'NUEVA', centro_codigo: '',
      razon_social: '', nombre_comercial: '', identificacion: '', direccion: '', ciudad: '', departamento: '', cod_postal: '', nombre_rep_legal: '', tipo_id_rep: '',
      num_id_rep: '', cargo_rep: '', tel_rep: '', correo_rep: '', responsabilidad_fiscal: '', contactos_json: '[]', fact_fecha_corte: '', fact_fecha_exp_cert: '',
      fact_fecha_exp_carta: '', fact_inscripcion: '', fact_docs_req: '', fact_email: '', fact_email_cc: '', refs_otros_centros: 'NO', monto: 0, moneda: 'COP',
      ejecutivo_cuenta: '', fecha_diligenciamiento: O.ymd(ahora), carpeta_drive_id: 'demo-folder-' + uuid.slice(0, 8), fecha_envio: ahora.toISOString(), estado_codigo: 'APROBADA',
      comentarios: '', firma_url: '', ip_dispositivo: '', fecha_aprobacion: '', aceptado_por: 'Area de credito y cartera', cupos_distribuidos_json: '{}',
      fecha_recibido_doc: '', fecha_venc_doc: '', vigencia_doc: 'Vigente', perfil_creado: '', razon_bloqueo: '', es_filial: 'NO'
    }, o);
  }
  const solAprobadaPorNit = (db, nit) => {
    let found = null;
    db.solicitudes.forEach(s => { if (digits9(s.identificacion) === nit && ESTADOS_CREDITO.includes(accionDe(s))) found = s; });
    return found;
  };

  H.apiCrearCredito = function (payload) {
    payload = payload || {};
    const ses = O.getSession(payload.token || '');
    if (!ses || ses.rol !== 'ADMIN') return { ok: false, error: 'No tienes permisos para crear créditos.' };
    const d = payload.datos || {};
    const razon = String(d.razon_social || '').trim(), nit = digits9(d.nit), centro = String(d.centro || '').trim().toUpperCase(), monto = Number(d.monto) || 0;
    if (!razon) return { ok: false, error: 'La Razón Social es requerida.' };
    if (!nit) return { ok: false, error: 'El NIT es requerido.' };
    if (!centro) return { ok: false, error: 'El Centro es requerido.' };
    if (monto <= 0) return { ok: false, error: 'El monto debe ser mayor a cero.' };
    return T(db => {
      const perfilNuevo = d.perfil_creado === 'TRUE' || d.perfil_creado === true;
      const ahora = new Date(), hoyS = O.ymd(ahora), vencS = O.ymd(new Date(Date.now() + 365 * DAY));
      const ex = solAprobadaPorNit(db, nit);
      if (ex) {
        const cupos = parseCupos(ex); cupos[centro] = monto;
        const lista = codes(ex.centro_codigo); if (!lista.includes(centro)) lista.push(centro);
        ex.centro_codigo = lista.join(',');
        ex.monto = Object.values(cupos).reduce((a, b) => a + b, 0);
        ex.cupos_distribuidos_json = JSON.stringify(cupos);
        ex.estado_codigo = 'APROBADA'; ex.aceptado_por = 'Area de credito y cartera';
        ex.fecha_aprobacion = hoyS; ex.fecha_recibido_doc = hoyS; ex.fecha_venc_doc = vencS; ex.vigencia_doc = 'Vigente';
        const pc = perfilObj(ex); if (perfilNuevo) pc[centro] = true; else delete pc[centro];
        ex.perfil_creado = JSON.stringify(pc);
        if (d.novedades) ex.comentarios = d.novedades;
      } else {
        const pc = {}; if (perfilNuevo) pc[centro] = true;
        db.solicitudes.push(nuevaSolicitudBase(db, {
          razon_social: razon, nombre_comercial: razon, identificacion: nit, centro_codigo: centro, monto, moneda: d.moneda || 'COP', ejecutivo_cuenta: ses.email || 'creditos@example.com',
          cupos_distribuidos_json: JSON.stringify({ [centro]: monto }), comentarios: d.novedades || '', fecha_aprobacion: hoyS, fecha_recibido_doc: hoyS, fecha_venc_doc: vencS,
          perfil_creado: perfilNuevo ? JSON.stringify(pc) : '', fact_email: d.facturacion_electronica || ''
        }));
      }
      audit(db, ses.email, 'CREAR_CREDITO_MANUAL', nit, { centro, monto });
      return { ok: true };
    });
  };

  // ── Importación masiva (hoja PLANTILLA_IMPORTAR_CREDITOS simulada) ──────────
  function resolveCentro(raw, centros) {
    if (!raw) return null;
    const n = ascii(raw).toUpperCase().trim();
    for (const h of centros) {
      const nom = ascii(h.nombre).toUpperCase();
      if (n.includes(h.codigo.toUpperCase()) || n.includes(nom) || nom.includes(n)) return h.codigo;
    }
    return null;
  }
  function estadoAuto(fechaAprob, estadoImportado) {
    const e = String(estadoImportado || '').toUpperCase().trim();
    if (e.includes('BLOQUEADO CORPORATIVO') || e.includes('BLOQUEADO_CORPORATIVO')) return 'BLOQUEADO CORPORATIVO';
    if (e.includes('BLOQUEADO GERENCIA') || e.includes('BLOQUEADO_GERENCIA')) return 'BLOQUEADO GERENCIA';
    const f = pd(fechaAprob) || new Date(); f.setHours(0, 0, 0, 0);
    const dias = Math.round((hoy0().getTime() - f.getTime()) / DAY);
    if (dias >= 365) return 'VENCIDO';
    if (dias >= 350) return 'POR VENCER';
    return 'APROBADA';
  }
  function vigenciaAuto(venc, rec) {
    const r = pd(rec) || new Date(), v = pd(venc) || new Date(r.getTime() + 365 * DAY);
    v.setHours(0, 0, 0, 0);
    const dias = Math.round((v.getTime() - hoy0().getTime()) / DAY);
    return dias < 0 ? 'No Vigente' : dias <= 30 ? 'Por Vencer' : 'Vigente';
  }

  H.apiGetPlantillaStats = function (payload) {
    payload = payload || {};
    const ses = O.getSession(payload.token || '');
    if (!ses || ses.rol !== 'ADMIN') return { ok: false, error: 'No tienes permisos.' };
    return T(db => {
      const rows = db.plantillaImportacion || [];
      if (!rows.length) return { ok: true, pendientes: 0, total: 0, procesadas: 0, errores: 0 };
      let p = 0, ok = 0, er = 0;
      rows.forEach(r => { const v = String(r.estadoImportacion || '').trim(); if (v === 'Procesado') ok++; else if (v === 'Error') er++; else p++; });
      return { ok: true, total: rows.length, pendientes: p, procesadas: ok, errores: er };
    });
  };

  H.apiProcesarPlantillaImportacion = function (payload) {
    payload = payload || {};
    const ses = O.getSession(payload.token || '');
    if (!ses || ses.rol !== 'ADMIN') return { ok: false, error: 'No tienes permisos para realizar la importación.' };
    return T(db => {
      const rows = db.plantillaImportacion || [];
      if (!rows.length) return { ok: false, error: 'La hoja PLANTILLA_IMPORTAR_CREDITOS no contiene datos para importar.' };
      const centros = centroList(db);
      const filas = [];
      rows.forEach((r, i) => {
        const nit = digits9(r.nit), monto = Number(String(r.monto == null ? '' : r.monto).replace(/[^0-9]/g, '')) || 0;
        if (String(r.estadoImportacion || '').trim() !== 'Procesado' && nit && String(r.cliente || '').trim() && String(r.centro || '').trim() && monto > 0) {
          filas.push({ i, r, nit, monto, cliente: String(r.cliente).trim(), centroRaw: String(r.centro).trim() });
        }
      });
      if (!filas.length) return { ok: true, creados: 0, actualizados: 0, errores: 0, mensaje: 'No hay registros nuevos pendientes de procesar.' };

      const existentes = {}, existNitCentro = new Set();
      db.solicitudes.forEach(s => {
        if (!ESTADOS_CREDITO.includes(accionDe(s))) return;
        const n = digits9(s.identificacion) || s.identificacion;
        existentes[n] = s;
      });
      Object.keys(existentes).forEach(n => codes(existentes[n].centro_codigo).forEach(h => existNitCentro.add(n + '_' + h)));
      const marcar = (i, estado, detalle) => { rows[i].estadoImportacion = estado; rows[i].detalleError = detalle; };
      let creados = 0, actualizados = 0, erroresBD = 0;
      const invalidas = [], validas = [], batch = new Set();

      filas.forEach(f => {
        const cod = resolveCentro(f.centroRaw, centros);
        if (!cod) { invalidas.push(f); marcar(f.i, 'Error', 'Centro no identificado a partir del nombre.'); return; }
        f.cod = cod;
        const key = f.nit + '_' + cod;
        if (existNitCentro.has(key)) {
          const s = existentes[f.nit];
          if (s) {
            const acc = estadoAuto(f.r.fechaAprob, f.r.estadoCredito);
            s.fecha_aprobacion = O.ymd(pd(f.r.fechaAprob) || new Date());
            s.estado_codigo = normEstado(acc);
            marcar(f.i, 'Procesado', 'Se sobreescribió la fecha de aprobación del crédito existente.');
            actualizados++;
          }
          return;
        }
        if (batch.has(key)) { invalidas.push(f); marcar(f.i, 'Error', 'Duplicado: Este NIT y centro se repiten en la misma plantilla de importación.'); return; }
        batch.add(key); validas.push(f);
      });

      const grupos = {};
      validas.forEach(f => {
        const g = grupos[f.nit] = grupos[f.nit] || { nit: f.nit, cliente: f.cliente, factEmail: f.r.factEmail || '', aprobadoPor: String(f.r.aprobadoPor || '').trim() || 'Area de credito y cartera', novedades: String(f.r.novedades || '').trim(), cupos: {}, filas: [], fechaAprob: f.r.fechaAprob, fechaRecDoc: f.r.fechaRecDoc, fechaVenDoc: f.r.fechaVenDoc, estadoCredito: f.r.estadoCredito };
        g.cupos[f.cod] = (g.cupos[f.cod] || 0) + f.monto; g.filas.push(f.i);
        if (f.r.novedades && !g.novedades.includes(String(f.r.novedades).trim())) g.novedades += (g.novedades ? ' | ' : '') + String(f.r.novedades).trim();
        if (f.r.fechaAprob) g.fechaAprob = f.r.fechaAprob;
        if (f.r.estadoCredito) g.estadoCredito = f.r.estadoCredito;
      });
      Object.keys(grupos).forEach(n => {
        const g = grupos[n];
        try {
          const acc = estadoAuto(g.fechaAprob, g.estadoCredito);
          const aprob = pd(g.fechaAprob) || new Date(), rec = pd(g.fechaRecDoc) || new Date(), ven = pd(g.fechaVenDoc) || new Date(rec.getTime() + 365 * DAY);
          const vig = vigenciaAuto(g.fechaVenDoc, g.fechaRecDoc);
          const ex = existentes[n];
          if (ex) {
            const cupos = parseCupos(ex);
            for (const h in g.cupos) cupos[h] = (cupos[h] || 0) + g.cupos[h];
            const lista = codes(ex.centro_codigo); Object.keys(g.cupos).forEach(h => { if (!lista.includes(h)) lista.push(h); });
            Object.assign(ex, { centro_codigo: lista.join(','), monto: Object.values(cupos).reduce((a, b) => a + b, 0), cupos_distribuidos_json: JSON.stringify(cupos), estado_codigo: normEstado(acc),
              aceptado_por: g.aprobadoPor, fecha_aprobacion: O.ymd(aprob), fecha_recibido_doc: O.ymd(rec), fecha_venc_doc: O.ymd(ven), vigencia_doc: vig,
              comentarios: (ex.comentarios ? ex.comentarios + ' | ' : '') + (g.novedades || '') });
            const pc = perfilObj(ex); Object.keys(g.cupos).forEach(h => { pc[h] = true; }); ex.perfil_creado = JSON.stringify(pc);
            actualizados++;
          } else {
            const pc = {}; Object.keys(g.cupos).forEach(h => { pc[h] = true; });
            const s = nuevaSolicitudBase(db, { razon_social: g.cliente, nombre_comercial: g.cliente, identificacion: n, centro_codigo: Object.keys(g.cupos).join(','), monto: Object.values(g.cupos).reduce((a, b) => a + b, 0),
              moneda: 'COP', ejecutivo_cuenta: ses.email || 'creditos@example.com', cupos_distribuidos_json: JSON.stringify(g.cupos), comentarios: g.novedades, estado_codigo: normEstado(acc),
              fecha_aprobacion: O.ymd(aprob), fecha_recibido_doc: O.ymd(rec), fecha_venc_doc: O.ymd(ven), vigencia_doc: vig, aceptado_por: g.aprobadoPor, perfil_creado: JSON.stringify(pc), fact_email: g.factEmail });
            db.solicitudes.push(s);
            existentes[n] = s;
            creados++;
          }
          g.filas.forEach(i => marcar(i, 'Procesado', ''));
        } catch (e) {
          g.filas.forEach(i => marcar(i, 'Error', 'Error BD: ' + e.message));
          erroresBD += g.filas.length;
        }
      });
      audit(db, ses.email, 'IMPORTAR_LOTES_PLANTILLA', 'MULTIPLES', { total: validas.length });
      const errores = invalidas.length + erroresBD;
      return { ok: true, creados, actualizados, errores, interrumpidoPorConexion: false,
        mensaje: 'Proceso completado. Registros unificados e importados: ' + creados + ' creados, ' + actualizados + ' actualizados. Filas con errores: ' + errores + '.' };
    });
  };

  // =========================================================================
  //  Usuarios
  // =========================================================================
  const ROLES = ['ADMIN', 'OPERACIONES', 'CONSULTAS'];
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const MAX_FIRMA = 900000;

  function firmaData(b64) {
    if (!b64) return '';
    if (!/^[A-Za-z0-9+/=]+$/.test(b64)) throw new Error('La firma debe ser una imagen PNG válida.');
    if (b64.length > MAX_FIRMA) throw new Error('La imagen de firma es demasiado grande para la demo (máx. ~650 KB).');
    return 'data:image/png;base64,' + b64;
  }
  const adminSes = token => { const s = O.getSession(token || ''); return s && s.rol === 'ADMIN' ? s : null; };

  H.apiGetUsuarios = function (token) {
    if (!adminSes(token)) return { ok: false, error: 'No tienes permisos.' };
    return T(db => ({ ok: true, usuarios: (db.usuarios || []).filter(u => String(u.email || '').trim()).map(u => ({
      email: String(u.email).trim(), nombre: String(u.nombre || '').trim(), rol: String(u.rol || '').trim(),
      activo: String(u.activo).trim().toUpperCase() === 'TRUE', ultimo_login: String(u.ultimo_login || '').trim(),
      firmaId: String(u.firma_drive_id || '').trim(), firmaUrl: u.firma_data || '' })) }));
  };

  H.apiCrearUsuario = function (payload) {
    payload = payload || {};
    if (!adminSes(payload.token)) return { ok: false, error: 'No tienes permisos para crear usuarios.' };
    const email = String(payload.email || '').trim().toLowerCase(), nombre = String(payload.nombre || '').trim();
    const rol = String(payload.rol || 'CONSULTAS').trim().toUpperCase(), password = String(payload.password || '').trim();
    if (!email || !nombre || !password) return { ok: false, error: 'Correo, nombre y contraseña son requeridos.' };
    if (!EMAIL_RE.test(email)) return { ok: false, error: 'Correo no válido.' };
    if (!ROLES.includes(rol)) return { ok: false, error: 'Rol no válido. Usa ADMIN o CONSULTAS.' };
    try {
      return T(db => {
        if (O.findUser(db, email)) return { ok: false, error: 'Ya existe un usuario con ese correo.' };
        const fd = firmaData(payload.firmaBase64);
        db.usuarios.push({ email, nombre, rol, password, activo: 'TRUE', ultimo_login: '', firma_drive_id: fd ? 'demo-firma-' + Date.now().toString(36) : '', firma_data: fd });
        return { ok: true };
      });
    } catch (e) { return { ok: false, error: e.message }; }
  };

  H.apiCambiarPassword = function (payload) {
    payload = payload || {};
    const ses = O.getSession(payload.token || '');
    if (!ses) return { ok: false, error: 'Sesión inválida.' };
    const actual = String(payload.passwordActual || '').trim(), nuevo = String(payload.passwordNuevo || '').trim();
    if (!actual || !nuevo) return { ok: false, error: 'Ambas contraseñas son requeridas.' };
    if (nuevo.length < 8) return { ok: false, error: 'La nueva contraseña debe tener al menos 8 caracteres.' };
    return T(db => {
      const u = O.findUser(db, ses.email);
      if (!u) return { ok: false, error: 'Usuario no encontrado.' };
      if (u.password !== actual) return { ok: false, error: 'La contraseña actual es incorrecta.' };
      u.password = nuevo;
      return { ok: true };
    });
  };
  H.apiEnviarCodigoRegistro = function () { return { ok: false, error: 'El registro público de usuarios está deshabilitado.' }; };
  H.apiRegistrarUsuario = function () { return { ok: false, error: 'El registro público de usuarios está deshabilitado.' }; };

  H.apiToggleUsuario = function (payload) {
    payload = payload || {};
    if (!adminSes(payload.token)) return { ok: false, error: 'No tienes permisos.' };
    const email = String(payload.email || '').trim().toLowerCase();
    return T(db => {
      const u = O.findUser(db, email);
      if (!u) return { ok: false, error: 'Usuario no encontrado.' };
      if (payload.activo !== undefined) u.activo = payload.activo !== false ? 'TRUE' : 'FALSE';
      if (payload.rol !== undefined) {
        const rol = String(payload.rol || '').trim().toUpperCase();
        if (!ROLES.includes(rol)) return { ok: false, error: 'Rol no válido.' };
        u.rol = rol;
      }
      return { ok: true };
    });
  };

  H.apiEditarUsuario = function (payload) {
    payload = payload || {};
    if (!adminSes(payload.token)) return { ok: false, error: 'No tienes permisos para editar usuarios.' };
    const orig = String(payload.emailOriginal || '').trim().toLowerCase(), nd = payload.nuevosDatos || {};
    const email = String(nd.email || '').trim().toLowerCase(), nombre = String(nd.nombre || '').trim(), rol = String(nd.rol || '').trim().toUpperCase(), pw = String(nd.password || '').trim();
    if (!orig || !email || !nombre || !rol) return { ok: false, error: 'Todos los campos excepto la contraseña son obligatorios.' };
    if (!EMAIL_RE.test(email)) return { ok: false, error: 'Correo no válido.' };
    if (!ROLES.includes(rol)) return { ok: false, error: 'Rol no válido. Usa ADMIN o CONSULTAS.' };
    try {
      return T(db => {
        const u = O.findUser(db, orig);
        if (!u) return { ok: false, error: 'El usuario a editar no existe.' };
        if (email !== orig && O.findUser(db, email)) return { ok: false, error: 'Ya existe otro usuario registrado con el nuevo correo.' };
        if (pw && pw.length < 8) return { ok: false, error: 'La nueva contraseña debe tener al menos 8 caracteres.' };
        const fd = nd.firmaBase64 ? firmaData(nd.firmaBase64) : '';
        u.email = email; u.nombre = nombre; u.rol = rol;
        if (pw) u.password = pw;
        if (fd) { u.firma_data = fd; u.firma_drive_id = 'demo-firma-' + Date.now().toString(36); }
        else if (nd.eliminarFirma && u.firma_drive_id) { u.firma_data = ''; u.firma_drive_id = ''; }
        if (email !== orig) Object.keys(db.sesiones || {}).forEach(t => { if (db.sesiones[t].email === orig) db.sesiones[t].email = email; });
        return { ok: true };
      });
    } catch (e) { return { ok: false, error: 'El usuario se guardó, pero no se pudo subir la firma: ' + e.message }; }
  };

  H.apiEliminarUsuario = function (payload) {
    payload = payload || {};
    const ses = adminSes(payload.token);
    if (!ses) return { ok: false, error: 'No tienes permisos para eliminar usuarios.' };
    const email = String(payload.email || '').trim().toLowerCase();
    if (!email) return { ok: false, error: 'El correo es requerido.' };
    if (ses.email.toLowerCase() === email) return { ok: false, error: 'No puedes eliminar tu propia cuenta de administrador.' };
    return T(db => {
      const u = O.findUser(db, email);
      if (!u) return { ok: false, error: 'Usuario no encontrado.' };
      db.usuarios = db.usuarios.filter(x => x !== u);
      Object.keys(db.sesiones || {}).forEach(t => { if (String(db.sesiones[t].email).toLowerCase() === email) delete db.sesiones[t]; });
      return { ok: true };
    });
  };

  // =========================================================================
  //  Copias de seguridad
  // =========================================================================
  const tsBackup = () => { const d = new Date(); return O.ymd(d) + '_' + pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds()); };
  function sesAdminBackup(payload) {
    const ses = O.getSession((payload || {}).token || '');
    if (!ses) return { error: 'Sesión inválida o expirada.' };
    if (ses.rol !== 'ADMIN') return { error: 'Acceso denegado. Se requiere rol de Administrador.' };
    return { ses };
  }

  H.apiListarBackups = function (payload) {
    const r = sesAdminBackup(payload);
    if (r.error) return { ok: false, error: r.error };
    return T(db => ({ ok: true, backups: db.backups.map(b => ({ id: b.id, name: b.name, created: b.created })).sort((a, b) => b.name.localeCompare(a.name)) }));
  };

  H.apiCrearBackupManual = function (payload) {
    const r = sesAdminBackup(payload);
    if (r.error) return { ok: false, error: r.error };
    return T(db => {
      pushBackup(db, 'Backup_' + tsBackup() + '_Manual', r.ses.email, 'm' + Date.now().toString(36), snapshot(db));
      return { ok: true };
    });
  };

  H.apiEnviarCodigoRestauracion = function (payload) {
    const r = sesAdminBackup(payload);
    if (r.error) return { ok: false, error: r.error };
    return T(db => {
      const codigo = String(Math.floor(100000 + Math.random() * 900000));
      db.codigos['RESTORE_CODE_' + r.ses.email] = { codigo, exp: Date.now() + 300000, intentos: (db.codigos['RESTORE_CODE_' + r.ses.email] || {}).intentos || 0 };
      O.mail({ to: r.ses.email, subject: 'Código de seguridad para restauración - CupoFlow', code: codigo,
        html: mailShell('Código de Verificación', '<p style="font-size:14px;color:#555;line-height:1.6">Has solicitado iniciar la restauración de una copia de seguridad en el Sistema de Créditos. Ingresa el siguiente código de 6 dígitos:</p><div style="border:2px dashed #d08b43;border-radius:10px;padding:20px;text-align:center;font-size:36px;font-weight:800;letter-spacing:10px;color:#3c796c">' + codigo + '</div><p style="font-size:12px;color:#999">Este código expira en 5 minutos.</p>') }, db);
      return { ok: true };
    });
  };

  H.apiRestaurarBackup = async function (payload) {
    payload = payload || {};
    const r = sesAdminBackup(payload);
    if (r.error) return { ok: false, error: r.error };
    const res = T(db => {
      const k = 'RESTORE_CODE_' + r.ses.email, c = db.codigos[k];
      if (c && c.intentos >= 5) { delete db.codigos[k]; return { ok: false, error: 'Demasiados intentos fallidos. Solicita un nuevo código de verificación.' }; }
      if (!c || c.exp < Date.now() || c.codigo !== String(payload.codigoVerificacion || '').trim()) {
        if (c) c.intentos = (c.intentos || 0) + 1;
        return { ok: false, error: 'El código de verificación ingresado es incorrecto o ha expirado.' };
      }
      delete db.codigos[k];
      if (!payload.backupFolderId) return { ok: false, error: 'ID de carpeta de backup no suministrado.' };
      const b = db.backups.find(x => x.id === payload.backupFolderId);
      if (!b) return { ok: false, error: 'No se pudo acceder a la carpeta de la copia de seguridad seleccionada.' };
      if (!db.backupData[b.data]) return { ok: false, error: 'La carpeta seleccionada no contiene archivos de copia de seguridad válidos (Sheet_*.csv o DB_*.csv).' };
      pushBackup(db, 'Backup_' + tsBackup() + '_PreRestauracion', 'Proceso de Restauración (' + r.ses.email + ')', 'p' + Date.now().toString(36), snapshot(db));
      return { ok: true, b: b.name, snap: db.backupData[b.data] };
    });
    if (!res.ok) return res;
    await O.sleep(2200);   // deja ver el avance de los pasos en la interfaz
    T(db => {
      const data = JSON.parse(res.snap);
      Object.keys(data).forEach(k => { db[k] = data[k]; });
      audit(db, r.ses.email, 'RESTAURAR_BACKUP', '', { backup: res.b });
    });
    return { ok: true, message: 'Restauración completada desde ' + res.b + '.' };
  };

  // =========================================================================
  //  Carta de aprobación (HTML → PDF en el cliente)
  // =========================================================================
  function numeroALetras(num0) {
    const U = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
    const D = ['', 'diez', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
    const E = { 11: 'once', 12: 'doce', 13: 'trece', 14: 'catorce', 15: 'quince', 16: 'dieciséis', 17: 'diecisiete', 18: 'dieciocho', 19: 'diecinueve', 21: 'veintiún', 22: 'veintidós', 23: 'veintitrés', 24: 'veinticuatro', 25: 'veinticinco', 26: 'veintiséis', 27: 'veintisiete', 28: 'veintiocho', 29: 'veintinueve' };
    const C = ['', 'cien', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
    function w(n) {
      if (n === 0) return 'cero';
      let s = '';
      if (n >= 1000000000) { const g = Math.floor(n / 1000000000); s += (g === 1 ? 'mil' : w(g) + ' mil') + ' millones '; n %= 1000000000; }
      if (n >= 1000000) { const g = Math.floor(n / 1000000); s += (g === 1 ? 'un millón' : w(g) + ' millones') + ' '; n %= 1000000; }
      if (n >= 1000) { const g = Math.floor(n / 1000); s += (g === 1 ? 'mil' : w(g) + ' mil') + ' '; n %= 1000; }
      if (n >= 100) { const c = Math.floor(n / 100), r = n % 100; s += (c === 1 && r > 0 ? 'ciento' : C[c]) + ' '; n = r; }
      if (n >= 10) {
        if (E[n]) { s += E[n]; n = 0; }
        else { const dd = Math.floor(n / 10), u = n % 10; s += (dd === 2 && u > 0) ? 'veinti' + U[u] : D[dd] + (u > 0 ? ' y ' + U[u] : ''); n = 0; }
      }
      if (n > 0) s += U[n];
      return s.trim().replace(/\s+/g, ' ');
    }
    const l = w(Math.floor(num0)); return l.charAt(0).toUpperCase() + l.slice(1);
  }

  function cartaHtml(db, sol, cupos, aceptadoPor, firmanteEmail) {
    const centros = centroList(db);
    const codigosH = codes(sol.centro_codigo);
    let total = 0;
    if (cupos && typeof cupos === 'object') for (const c in cupos) total += parseFloat(cupos[c]) || 0;
    if (total === 0) total = parseFloat(sol.monto) || 0;
    if (!cupos || !Object.keys(cupos).length) { cupos = {}; const por = total / (codigosH.length || 1); codigosH.forEach(c => { cupos[c] = por; }); }
    const mon = sol.moneda || 'COP', sim = mon === 'USD' ? 'USD $' : '$';
    const letras = numeroALetras(total) + (mon === 'COP' ? ' de pesos' : mon === 'USD' ? ' dólares' : ' ' + mon);
    const usr = O.findUser(db, firmanteEmail || '');
    const firmaImg = usr && usr.firma_data && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(usr.firma_data) ? '<img src="' + usr.firma_data + '" style="height:40px;display:block">' : '';
    const d = new Date(), fechaTxt = 'Bogotá, ' + d.getDate() + ' de ' + MESES[d.getMonth()] + ' del ' + d.getFullYear();
    const fdoc = ddmmyyyy(sol.fecha_diligenciamiento || sol.fecha_envio) || O.dmy(d);
    let i = 0, filas = '';
    for (const cod in cupos) {
      const v = parseFloat(cupos[cod]) || 0; if (v <= 0) continue; i++;
      const h = centros.find(x => x.codigo === cod) || { nombre: cod, razon: cod };
      filas += '<tr><td style="padding:6px 10px;font-size:9.5pt;border-bottom:1px solid #d8ebe7;' + (i % 2 === 0 ? 'background:#f4fbfa;' : 'background:#fff;') + '">' + esc(String(h.razon || h.nombre || cod).toUpperCase()) + '</td><td style="padding:6px 10px;font-size:9.5pt;text-align:right;font-weight:bold;border-bottom:1px solid #d8ebe7;' + (i % 2 === 0 ? 'background:#f4fbfa;' : 'background:#fff;') + '">' + esc(sim + v.toLocaleString('es-CO')) + '</td></tr>';
    }
    const head = '<div style="background:#3c796c;border-bottom:5px solid #d08b43;width:100%"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#3c796c"><tr><td style="width:220px;padding:16px 18px 5px 30px;border-right:1px solid #598d82;background:#3c796c"><span style="font-size:22pt;color:#fff;font-family:Arial,sans-serif">demo<span style="color:#d08b43">H</span>otel</span><br><span style="font-size:6pt;color:#9edbca;letter-spacing:2px">HOSPITALITY MANAGEMENT GROUP</span></td><td style="padding:16px 30px 5px 18px;text-align:right;vertical-align:top;font-size:9.5pt;font-weight:bold;color:#fff;font-family:Arial,sans-serif;background:#3c796c">Area de cr&eacute;dito y cartera</td></tr><tr><td style="padding:0 18px 14px 30px;font-size:7.5pt;color:#afe1d5;border-right:1px solid #598d82;background:#3c796c">www.example.com</td><td style="padding:0 30px 14px 18px;font-size:7.5pt;color:#afe1d5;text-align:right;background:#3c796c">CALLE 00 # 00-00, Ciudad, País</td></tr></table></div>';
    const foot = '<div style="background:#3c796c;border-top:5px solid #d08b43;position:absolute;bottom:0;left:0;right:0;padding:10px 30px;color:#fff;font-size:9pt;font-family:Arial,sans-serif"><i style="color:#d08b43">Destinos únicos, experiencias inolvidables</i><span style="float:right;font-weight:bold">Area de cr&eacute;dito y cartera</span></div>';
    const pg = 'width:816px;height:1056px;position:relative;overflow:hidden;background:#fff;font-family:Calibri,Arial,sans-serif;font-size:10pt;color:#1a1a1a;';
    const p = 'font-size:10pt;text-align:justify;margin-bottom:12px;line-height:1.6;';
    const rz = esc(sol.razon_social);
    const html = '<style>.carta-pdf *{margin:0;padding:0;box-sizing:border-box}.carta-pdf{font-family:Calibri,Arial,sans-serif;font-size:10pt;color:#1a1a1a}.carta-pdf .page{width:816px;height:1056px;position:relative;overflow:hidden;background:#fff}</style>' +
      '<div class="carta-pdf"><div class="page" style="' + pg + '">' + head + '<div style="padding:20px 42px 120px 42px"><div style="margin-bottom:16px">' + esc(fechaTxt) + '</div>' +
      '<div style="margin-bottom:16px;line-height:1.6">Se&ntilde;ores:<br><strong>' + rz + '</strong><br>Sr. ' + esc(sol.nombre_rep_legal || 'Representante Legal') + '<br>Representante Legal</div>' +
      '<div style="font-weight:bold;margin-bottom:16px">Asunto: Aprobaci&oacute;n de cr&eacute;dito</div><div style="' + p + '">Cordial saludo,</div>' +
      '<div style="' + p + '">Nos complace informar que hemos aprobado un cupo de cr&eacute;dito para utilizar en nuestros centros por un valor de <strong>' + esc(sim + total.toLocaleString('es-CO')) + ' (' + esc(letras) + ')</strong>, el cual estar&aacute; distribuido de la siguiente manera:</div>' +
      '<table style="width:100%;border-collapse:collapse;margin:14px 0;border:1px solid #3c796c"><thead><tr><th style="background:#3c796c;color:#fff;padding:8px 10px;text-align:left;font-size:10pt">CENTRO</th><th style="background:#3c796c;color:#fff;padding:8px 10px;width:180px;text-align:right">CUPO</th></tr></thead><tbody>' + filas + '</tbody>' +
      '<tfoot><tr><td style="border-top:2px solid #3c796c;font-weight:bold;background:#e5f3f0;padding:7px 10px">TOTAL APROBADO</td><td style="border-top:2px solid #3c796c;font-weight:bold;background:#e5f3f0;padding:7px 10px;text-align:right">' + esc(sim + total.toLocaleString('es-CO')) + '</td></tr></tfoot></table></div>' + foot + '</div>' +
      '<div class="page" style="' + pg + '">' + head + '<div style="padding:20px 42px 120px 42px">' +
      '<div style="' + p + 'margin-top:16px">Este cupo de cr&eacute;dito tiene un plazo de pago de treinta (30) d&iacute;as despu&eacute;s de recibida la factura. En caso de que en alguno de nuestros centros <strong>' + rz + '</strong> llegue al l&iacute;mite del cr&eacute;dito asignado, el cliente deber&aacute; pagar por anticipado los pedidos y/o despachos. Para efectos contables la facturaci&oacute;n debe ser emitida por el centro que preste el servicio.</div>' +
      '<div style="' + p + '">Para cada solicitud de suministro de materiales o de alquiler de maquinaria se debe enviar una carta firmada por una de las personas autorizadas detallando los servicios autorizados, las personas que se beneficiar&aacute;n de los mismos, y la informaci&oacute;n necesaria para la elaboraci&oacute;n, radicaci&oacute;n y cobro de la respectiva factura.</div>' +
      '<div style="' + p + '">Si a <strong>' + rz + '</strong> existiera alg&uacute;n error en la facturaci&oacute;n, el Cliente deber&aacute;, dentro de los 5 (cinco) d&iacute;as h&aacute;biles de recibida la factura, notificar por escrito al Centro del cargo objetado, exponiendo las razones que motivan la objeci&oacute;n.</div>' +
      '<div style="' + p + '">La presente tiene fecha de validez por un a&ntilde;o a partir de la recepci&oacute;n inicial de la documentaci&oacute;n para el estudio de cr&eacute;dito sin importar que se expidan aprobaciones posteriores a la emisi&oacute;n del mismo.</div>' +
      '<div style="margin-bottom:24px"><strong>Fecha de Recepci&oacute;n documentaci&oacute;n inicial:</strong> ' + esc(fdoc) + '</div>' +
      '<div style="margin-top:28px;line-height:1.5">Cordialmente,<div style="height:45px">' + firmaImg + '</div><div style="font-weight:bold;margin-top:10px">' + esc(aceptadoPor || 'Area de credito y cartera') + '</div>' + (usr ? '<div style="font-size:9.5pt;margin-top:2px">' + esc(usr.nombre) + '</div>' : '') + '</div></div>' + foot + '</div></div>';
    const razonSafe = String(sol.razon_social || '').trim().replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').slice(0, 80);
    return { html, pdfName: 'Carta_Aprobacion_Credito_' + razonSafe + '.pdf' };
  }

  H.apiGetHtmlCarta = function (payload) {
    payload = payload || {};
    const ses = O.getSession(payload.token || '');
    if (!ses || ses.rol !== 'ADMIN') return { ok: false, error: 'Sin permisos.' };
    try {
      return T(db => {
        const sol = findSol(db, payload.uuid);
        if (!sol) throw new Error('Solicitud no encontrada para generar HTML.');
        const r = cartaHtml(db, sol, payload.cuposDistribuidos, payload.aceptadoPor, ses.email);
        return { ok: true, html: r.html, pdfName: r.pdfName };
      });
    } catch (e) { return { ok: false, error: e.message }; }
  };

  // =========================================================================
  //  IA (Gemini) SIMULADA
  // =========================================================================
  function cop(n, mon) { return (mon || 'COP') + ' ' + Math.round(n).toLocaleString('es-CO'); }
  function buildIA(db, sol, docs) {
    const hoy = hoy0(), fcorte = O.ymd(hoy), h = hashStr(sol.uuid), mon = sol.moneda || 'COP', monto = num(sol.monto);
    const has = t => docs.find(d => d.tipo_documento === t);
    const hasName = re => docs.find(d => re.test(O.norm(d.nombre_archivo)));
    const centros = centroList(db), lista = codes(sol.centro_codigo).map(c => (centros.find(x => x.codigo === c) || { nombre: c }).nombre);
    const segunda = sol.es_filial === 'SI' || monto >= 40000000;
    const y = hoy.getFullYear(), items = [];
    const add = (e, concepto, detalle) => items.push({ e, concepto, detalle });

    const cert = has('CERT_EXISTENCIA');
    if (cert) {
      const fexp = pd(sol.fact_fecha_exp_cert) || pd(sol.fecha_envio) || hoy;
      const dias = Math.max(0, Math.round((hoy - new Date(fexp.getFullYear(), fexp.getMonth(), fexp.getDate())) / DAY));
      if (dias <= 30) add('✅', 'Cámara de Comercio', 'Vigente, fecha de expedición ' + O.dmy(fexp) + ' (' + dias + ' días transcurridos a la fecha actual de corte: ' + fcorte + ').');
      else add('❌', 'Cámara de Comercio', 'No vigente, fecha de expedición ' + O.dmy(fexp) + ' supera el plazo de 30 días (' + dias + ' días transcurridos a la fecha actual de corte: ' + fcorte + ').');
    } else add('❌', 'Cámara de Comercio', 'No se adjuntó el certificado de existencia y representación legal en el expediente.');
    const cons = y - (4 + (h % 16));
    add('✅', 'Antigüedad de la Empresa', 'Matrícula mercantil del ' + pad(1 + h % 27) + '/' + pad(1 + h % 12) + '/' + cons + ' (' + (y - cons) + ' años de operación).');
    if (segunda) add('⚠️', 'Facultades del Representante', 'El representante legal tiene facultades limitadas por cuantía; se recomienda validar autorización de junta o segunda firma para el monto solicitado.');
    else add('✅', 'Facultades del Representante', 'El representante legal principal cuenta con facultades sin limitación de cuantía.');
    add('✅', 'Cruce de Identidad y Firmas', 'Nombre y cédula de ' + (sol.nombre_rep_legal || 'el representante') + ' (' + (sol.tipo_id_rep || 'CC') + ' ' + (sol.num_id_rep || '—') + ') coinciden en todos los anexos.');
    if (has('RUT')) add('✅', 'RUT', 'Archivo RUT presente y correspondiente al NIT ' + sol.identificacion + '.'); else add('❌', 'RUT', 'No se adjuntó el archivo RUT en el expediente.');
    const eeff = has('ESTADOS_FIN');
    if (!eeff) add('❌', 'Estados Financieros', 'No se adjuntaron los estados financieros exigidos en el expediente.');
    else if (h % 4 === 0) add('⚠️', 'Estados Financieros', 'Periodos ' + (y - 2) + ' y ' + (y - 1) + ' presentes, pero falta la firma visible del Contador / Revisor Fiscal.');
    else add('✅', 'Estados Financieros', 'Periodos ' + (y - 2) + ' y ' + (y - 1) + ' completos, firmados por el Representante Legal y el Contador; la Razón Social coincide.');
    items.push({ e: '✅', concepto: 'Centros con "X"', detalle: '', centros: lista });
    add('✅', 'Correo de Recepción de Facturas', (sol.fact_email || 'sin correo') + ' coincide plenamente con el registrado en el expediente.');
    add('✅', 'Consistencia Empresarial', 'El NIT y la Razón Social son idénticos en todos los archivos del expediente.');
    const dc = hasName(/datacredito|experian|cifin|transunion|centrales/);
    if (dc) { add('✅', 'Análisis de Datacrédito', 'Score ' + (700 + h % 240) + ' / 950 (riesgo bajo), sin moras activas ni deudas castigadas.'); add('✅', 'Aptitud Crediticia (Score Datacrédito)', 'Calificación A. Apto para el monto solicitado de ' + cop(monto, mon) + '.'); }
    else { add('⚠️', 'Análisis de Datacrédito', 'No se adjuntó reporte de Datacrédito al expediente.'); add('⚠️', 'Aptitud Crediticia (Score Datacrédito)', 'Sin reporte no es posible calificar el riesgo; se sugiere revisión adicional antes de aprobar ' + cop(monto, mon) + '.'); }
    if (!eeff) add('⚠️', 'Capacidad de Pago y Flujo de Caja', 'Sin estados financieros no es posible evaluar la capacidad de pago frente a ' + cop(monto, mon) + '.');
    else if (segunda) add('❌', 'Capacidad de Pago y Flujo de Caja', 'La capacidad monetaria no cubre con holgura el cupo solicitado de ' + cop(monto, mon) + '. Se requiere una segunda firma / respaldo adicional.');
    else add('✅', 'Capacidad de Pago y Flujo de Caja', 'Los ingresos y la liquidez soportan plenamente el cupo solicitado de ' + cop(monto, mon) + '.');
    const min = Math.round(monto * (segunda ? 0.4 : 0.7) / 1000000) * 1000000, max = Math.round(monto * (segunda ? 0.7 : 1.2) / 1000000) * 1000000;
    const insp = hasName(/inspektor|compliance|sarlaft|listas|ofac/);
    if (insp) add('✅', 'Análisis de Inspektor / Compliance', 'Sin coincidencias en listas restrictivas ni alertas SARLAFT para la empresa ni para el Representante Legal.');
    else add('⚠️', 'Análisis de Inspektor / Compliance', 'No se adjuntó el reporte de Inspektor en el expediente.');
    const otros = docs.filter(d => ['SOPORTE', 'ADICIONAL', 'OTRO_DOC'].includes(d.tipo_documento) && !/datacredito|inspektor|compliance/i.test(O.norm(d.nombre_archivo)));
    if (otros.length) add('✅', 'Otros Documentos y Soportes', 'Soportes adicionales válidos y consistentes: ' + otros.map(d => d.nombre_archivo).join(', ') + '.');
    else add('⚠️', 'Otros Documentos y Soportes', 'No registra documentos adicionales.');

    const alerta = items.some(i => i.e !== '✅');
    const razonUp = String(sol.razon_social || '').toUpperCase();
    let md = '# 🧪 ANÁLISIS SIMULADO (MODO DEMO)\n' +
      'Este informe lo generó un **simulador local**: no se llamó a Gemini ni se leyó el contenido de los PDF. Las conclusiones se derivan de los datos ficticios del expediente.\n\n' +
      '# 📋 RESUMEN DEL ESTUDIO DE CRÉDITO\n\n## DATOS GENERALES DE LA COMPAÑÍA (Extraídos de OX-F-GFI-18)\n\n' +
      '🏢 Empresa / Razón Social: ' + razonUp + '\n🆔 NIT: ' + sol.identificacion + '\n👤 Representante Legal: ' + (sol.nombre_rep_legal || '—') + '\n📧 Correo Extraído: ' + (sol.fact_email || sol.correo_rep || '—') + '\n\n## 🔍 ESTADO DE LAS VALIDACIONES\n\n';
    items.forEach(i => {
      md += i.e + ' ' + i.concepto + ':' + (i.detalle ? ' ' + i.detalle : '') + '\n';
      if (i.centros) i.centros.forEach(n => { md += '- ' + n + '\n'; });
      if (i.concepto.startsWith('Capacidad')) md += '💡 Sugerencia de Monto (Mínimo y Máximo): entre **' + cop(min, mon) + '** y **' + cop(max, mon) + '** según el nivel de endeudamiento observado.\n';
    });
    if (eeff) {
      const ing = monto * (10 + h % 6), ut = ing * 0.06, act = ing * 0.7, pas = act * (segunda ? 0.78 : 0.52);
      const r = (a, b) => '| ' + a + ' | ' + b + ' |';
      md += '\n## 📊 RESUMEN Y CIFRAS CLAVE DE ESTADOS FINANCIEROS\n\n' +
        '**' + razonUp + '** reporta ingresos operacionales de **' + cop(ing, mon) + '** en **' + (y - 1) + '**, con utilidad neta de **' + cop(ut, mon) + '** y un endeudamiento de **' + (segunda ? '78%' : '52%') + '**. ' +
        (segunda ? 'La **liquidez es ajustada** frente al cupo solicitado, por lo que se recomienda una **segunda firma**.' : 'La **liquidez es saludable** y la **capacidad de pago** cubre el cupo solicitado de **' + cop(monto, mon) + '**.') + '\n\n' +
        '| Rubro Financiero | ' + (y - 1) + ' | ' + (y - 2) + ' |\n| :--- | :--- | :--- |\n' +
        r('Ingresos Operacionales', cop(ing, mon) + ' | ' + cop(ing * 0.88, mon)) + '\n' + r('Utilidad Operacional', cop(ut * 1.4, mon) + ' | ' + cop(ut * 1.1, mon)) + '\n' +
        r('Utilidad Neta', cop(ut, mon) + ' | ' + cop(ut * 0.8, mon)) + '\n' + r('Valor Activo Total', cop(act, mon) + ' | ' + cop(act * 0.9, mon)) + '\n' +
        r('Total Pasivo', cop(pas, mon) + ' | ' + cop(pas * 0.92, mon)) + '\n' + r('Patrimonio', cop(act - pas, mon) + ' | ' + cop((act - pas) * 0.88, mon)) + '\n' +
        r('Razón Corriente', (segunda ? '1.05' : '1.62') + ' | ' + (segunda ? '1.11' : '1.48')) + '\n' + r('Nivel de Endeudamiento (%)', (segunda ? '78%' : '52%') + ' | ' + (segunda ? '74%' : '55%')) + '\n';
    }
    md += '\n## 📈 CONCLUSIÓN DEL DICTAMEN\n\nESTADO DE LA SOLICITUD: ' + (alerta ? '**PENDIENTE DE REVISIÓN**' : '**APROBADA**') + '\n\n📝 OBSERVACIONES GENERALES:\n\n' +
      (alerta ? 'Se detectaron hallazgos (⚠️/❌) que el analista debe revisar antes de decidir sobre el cupo de **' + cop(monto, mon) + '**.' : 'Todas las validaciones resultaron satisfactorias; el cupo de **' + cop(monto, mon) + '** es viable.') + '\n';
    return {
      nit: sol.identificacion, razon_social: razonUp, representante_legal: String(sol.nombre_rep_legal || '').toUpperCase(),
      alerta_vigencia: alerta, requiere_segunda_firma: segunda,
      representantes_disponibles: [{ nombre: String(sol.nombre_rep_legal || '').toUpperCase(), cargo: sol.cargo_rep ? String(sol.cargo_rep).toUpperCase() : 'REPRESENTANTE LEGAL', num_id: sol.num_id_rep || null }].concat(segunda ? [{ nombre: 'SUPLENTE DE ' + String(sol.nombre_rep_legal || '').toUpperCase().split(' ')[0], cargo: 'REPRESENTANTE LEGAL SUPLENTE', num_id: null }] : []),
      observaciones_auditoria: md
    };
  }

  function guardarIA(db, sol, r, actor) {
    db.analisisIA[sol.uuid] = {
      uuid: sol.uuid, codigo_solicitud: sol.codigo_solicitud, nit_verificado: r.nit_verificado || r.nit, nit: r.nit_verificado || r.nit, razon_social: r.razon_social,
      representante_legal: r.representante_legal, alerta_vigencia: !!r.alerta_vigencia, requiere_segunda_firma: !!r.requiere_segunda_firma,
      representantes_disponibles: r.representantes_disponibles || [], observaciones_auditoria: r.observaciones_auditoria, analizado_por: actor, fecha_analisis: new Date().toISOString(), esGuardado: true
    };
    const nit = String(r.nit_verificado || r.nit || '').trim();
    if (nit) sol.identificacion = nit;
  }

  H.ejecutarAuditoriaIA = async function (uuidSolicitud, token) {
    const ses = needSes(token);
    const info = T(db => {
      const sol = findSol(db, uuidSolicitud);
      if (!sol) throw new Error('Solicitud no encontrada para auditar: ' + uuidSolicitud);
      const docs = docsDe(db, sol.uuid).filter(d => ['RUT', 'CERT_EXISTENCIA', 'ESTADOS_FIN', 'FORMATO_SOLICITUD'].includes(d.tipo_documento) || /soporte|adicional/i.test(d.tipo_documento));
      if (!docs.some(d => ['RUT', 'CERT_EXISTENCIA', 'ESTADOS_FIN'].includes(d.tipo_documento))) {
        throw new Error('No se encontraron documentos del tipo RUT, CERT_EXISTENCIA o ESTADOS_FIN para esta solicitud. Verifica que el expediente tenga documentos cargados.');
      }
      return { uuid: sol.uuid };
    });
    toast('<b>🤖 IA (Gemini) simulada</b><br>Analizando el expediente con un modelo de ejemplo. No se envía ningún dato fuera de tu navegador.', 6000);
    await O.sleep(1800 + Math.random() * 900);
    return T(db => {
      const sol = findSol(db, info.uuid);
      if (!sol) throw new Error('Solicitud no encontrada para auditar: ' + uuidSolicitud);
      const docs = docsDe(db, sol.uuid);
      const r = buildIA(db, sol, docs);
      guardarIA(db, sol, r, ses.email);
      audit(db, ses.email, 'PROCESAR_IA', sol.codigo_solicitud, { uuid: sol.uuid, docs_analizados: docs.map(d => d.tipo_documento), alerta_vigencia: r.alerta_vigencia });
      return Object.assign({}, r, { esGuardado: true, simulado: true });
    });
  };

  H.apiGuardarResultadoIA = function (payload) {
    payload = payload || {};
    const ses = needSes(payload.token);
    const uuid = String(payload.uuid || '').trim();
    if (!uuid) throw new Error('UUID requerido.');
    return T(db => {
      const sol = findSol(db, uuid);
      if (!sol) throw new Error('Solicitud no encontrada: ' + uuid);
      guardarIA(db, sol, payload, ses.email);
      audit(db, ses.email, 'GUARDAR_RESULTADO_IA', sol.codigo_solicitud, { uuid: sol.uuid, resultado: { nit: payload.nit_verificado || payload.nit, razon_social: payload.razon_social, alerta_vigencia: !!payload.alerta_vigencia } });
      return { ok: true };
    });
  };

  H.apiGetResultadoIA = function (token, uuid) {
    needSes(token);
    return T(db => {
      const sol = findSol(db, uuid);
      const a = sol ? db.analisisIA[sol.uuid] : null;
      return a ? Object.assign({}, a, { esGuardado: true }) : null;
    });
  };

  // ── Entrega en orden ─────────────────────────────────────────────────────────
  // El frontend original lanza a veces dos peticiones seguidas a la misma función (p. ej. lista sin
  // filtro y luego filtrada). Con latencia aleatoria las respuestas podrían llegar desordenadas y la
  // pantalla mostraría la vieja. Latencia constante => los temporizadores respetan el orden de llamada.
  O.latency = { min: 170, max: 170 };

  // ── Inicio de sesión rápido tras cerrar una sesión existente (accesos rápidos DEMO) ──
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      let p = null;
      try { p = JSON.parse(sessionStorage.getItem('demo-panel-pending') || 'null'); sessionStorage.removeItem('demo-panel-pending'); } catch (_) {}
      if (p) fillLogin(p.email, p.pw);
    }, 1100);
  });
})();
