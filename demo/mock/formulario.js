/* ============================================================================
 * formulario.js — Backend SIMULADO del Formulario de solicitud de crédito.
 *
 * Reemplaza a Code.js / Email.js / Trigger.js del Apps Script original:
 *   - MySQL / Sheets / Drive  → base localStorage (DemoKit.read / DemoKit.tx)
 *   - Gmail                   → DemoKit.mail (bandeja simulada)
 *   - Gemini (chat/extracción)→ respuestas canned por palabras clave (con aviso)
 *   - CacheService (OTP)      → db.codigos con expiración
 * Respeta el contrato (argumentos y retorno) que espera el frontend sin modificarlo.
 * ========================================================================== */
(function () {
  'use strict';
  const O = window.DemoKit;
  const H = O.handlers;

  /* ───────────────────────── Constantes (espejo de APP) ───────────────────────── */
  const MAX_FILE_BYTES = 30 * 1024 * 1024;
  const UPLOAD_TTL_MS = 600 * 1000;
  const OTP_TTL_MS = 600 * 1000;
  const OTP_MAX_INTENTOS = 5;
  const CREDITOS_EMAIL = 'creditos@example.com';
  const RECEPCION_EMAIL = 'recepcion@example.com';
  const SOPORTE_EMAIL = 'soporte-ti@example.com';

  /* ───────────────────────── Helpers ───────────────────────── */
  const str = v => String(v == null ? '' : v).trim();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nowIso = () => new Date().toISOString();

  function safeName(s) {
    return str(s).replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ').replace(/\s+/g, ' ').slice(0, 120);
  }

  /** Igual que normalizePublicError_ de Code.js. */
  function normalizePublicError(err) {
    const msg = (err && err.message) ? String(err.message) : String(err || 'Error');
    if (/jdbc|connection|mysql|access denied|database/i.test(msg)) return 'Tuvimos un inconveniente al guardar los datos de tu solicitud en nuestro sistema. Por favor, espera un momento e intenta enviar de nuevo.';
    if (/Faltan datos/i.test(msg)) return 'Completa todos los campos requeridos.';
    if (/UUID invalido/i.test(msg)) return 'No se pudo validar la sesión.';
    if (/Sesion.*expirada/i.test(msg)) return 'La carga tardó demasiado. Intenta nuevamente.';
    if (/Supera 30MB/i.test(msg)) return 'Un archivo supera el límite de 30 MB.';
    if (/Solo PDF/i.test(msg)) return 'Todos los documentos deben ser PDF.';
    if (/Faltan documentos:/i.test(msg)) return msg;
    if (/Debes aceptar/i.test(msg)) return 'Debes aceptar los términos y condiciones.';
    if (/Servidor ocupado/i.test(msg)) return 'El servidor está procesando otras solicitudes. Por favor, intenta de nuevo en 30 segundos.';
    return msg;
  }
  const fail = msg => { throw new Error(normalizePublicError(new Error(msg))); };

  /** Igual que generarCodigoSolicitud_ (Code.js). */
  function generarCodigoSolicitud(razonSocial, tipoSolicitud, uuid) {
    const d = new Date();
    const dateStr = d.getFullYear() + O.pad(d.getMonth() + 1) + O.pad(d.getDate());
    const partes = str(razonSocial).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/);
    const p1 = (partes[0] || 'SIN').toUpperCase().slice(0, 10);
    const pfx = { AMPLIACION: 'AMP', RENOVACION: 'REN', HOMOLOGACION: 'HOM' }[tipoSolicitud] || 'SOL';
    const hash = (uuid ? uuid.replace(/-/g, '').slice(0, 4) : Math.random().toString(36).substring(2, 6)).toUpperCase();
    return dateStr + '-' + pfx + '-' + p1 + '-' + hash;
  }

  const sqlDate = v => {
    const t = str(v); const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? m[3] + '-' + m[2] + '-' + m[1] : t.slice(0, 10);   // el cliente envía DD/MM/AAAA; la semilla usa AAAA-MM-DD
  };
  const sqlDateTime = d => O.ymdhms(d || new Date());

  function docNombre(db, codigo) {
    const f = (db.tiposDocumento || []).find(x => x.codigo === codigo);
    return f ? f.nombre : codigo;
  }

  function looksLikeEmail(s) { return s && s.indexOf('@') !== -1; }

  function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

  function b64Bytes(b64) {
    const s = str(b64);
    const clean = s.indexOf(',') >= 0 ? s.split(',')[1] : s;
    return Math.floor(clean.length * 3 / 4) - (clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0);
  }
  /** Decodifica hasta `max` caracteres iniciales de un base64 (o data URL) como latin1 para buscar texto. */
  function b64Head(b64, max) {
    try {
      const s = str(b64);
      const clean = (s.indexOf(',') >= 0 ? s.split(',')[1] : s).slice(0, Math.ceil((max || 200000) / 3) * 4);
      return atob(clean);
    } catch (_) { return ''; }
  }

  /* ───────────────────────── Correos simulados ───────────────────────── */
  function mailShell(titulo, cuerpo) {
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;background:#f4f9f9;font-family:Arial,sans-serif">' +
      '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 8px">' +
      '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden">' +
      '<tr><td style="background:#3c796c;padding:18px 28px;color:#fff"><span style="font-size:20px;font-weight:bold">demo<span style="color:#d08b43">H</span>otel</span>' +
      '<span style="float:right;font-size:11px;font-weight:bold;padding-top:6px">Area de crédito y cartera</span>' +
      '<div style="height:3px;background:#d08b43;margin-top:12px"></div></td></tr>' +
      '<tr><td style="padding:32px 28px;color:#333;font-size:14px;line-height:1.6"><h2 style="margin:0 0 16px;color:#0e362f;font-size:19px">' + esc(titulo) + '</h2>' + cuerpo + '</td></tr>' +
      '<tr><td style="background:#f4f9f9;padding:14px 28px;text-align:center;font-size:11px;color:#999;border-top:1px solid #e0e0e0">' +
      '&copy; ' + new Date().getFullYear() + ' CupoFlow S.A.S. &middot; Créditos Corporativos &middot; <b>Correo simulado de la demo</b></td></tr>' +
      '</table></td></tr></table></body></html>';
  }
  function sendCodeMail(email, code) {
    O.mail({
      to: email, subject: 'Código de verificación – Solicitud de Crédito CupoFlow', code,
      html: mailShell('Código de Verificación',
        '<p style="text-align:center">Estás a un paso de finalizar tu solicitud de crédito. Ingresa el siguiente código de 6 caracteres en el formulario:</p>' +
        '<div style="background:#f8fcfc;border:2px dashed #cae2e1;border-radius:10px;padding:18px;margin:22px 0;text-align:center"><span style="font-size:34px;font-weight:800;color:#0e362f;letter-spacing:10px">' + esc(code) + '</span></div>' +
        '<p style="text-align:center;font-size:12px;color:#888">Este código expirará en 10 minutos por motivos de seguridad.<br>Si no solicitaste este código, puedes ignorar este mensaje.</p>')
    });
  }
  function centrosNombres(db, codes) {
    return String(codes || '').split(',').map(s => s.trim()).filter(Boolean).map(c => {
      const h = (db.centros || []).find(x => x.codigo === c);
      return h ? h.nombre : c;
    });
  }
  function sendSolicitudMails(db, sol, pdfName) {
    const centros = centrosNombres(db, sol.centro_codigo);
    const chips = centros.map(n => '<span style="display:inline-block;background:#f1f9f8;border:1px solid #e2f0f0;padding:4px 10px;margin:3px 3px 3px 0;border-radius:100px;font-size:11.5px;font-weight:600">' + esc(n) + '</span>').join('') || '—';
    const fecha = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
    const tabla = '<table width="100%" cellpadding="6" style="border:1px solid #eef4f4;border-radius:6px;margin:14px 0;font-size:13px">' +
      '<tr><td style="color:#888;width:38%">Código de solicitud</td><td><b>' + esc(sol.codigo_solicitud) + '</b></td></tr>' +
      '<tr><td style="color:#888">Razón social</td><td><b>' + esc(sol.razon_social) + '</b></td></tr>' +
      '<tr><td style="color:#888">Centros</td><td>' + chips + '</td></tr>' +
      '<tr><td style="color:#888">Fecha de envío</td><td><b>' + esc(fecha) + '</b></td></tr></table>';
    const cc = [];
    if (str(sol.fact_inscripcion).toUpperCase() === 'SI') cc.push(RECEPCION_EMAIL);
    if (looksLikeEmail(sol.ejecutivo_cuenta)) cc.push(sol.ejecutivo_cuenta);
    const adj = [pdfName];
    if (sol.correo_rep) {
      O.mail({
        to: sol.correo_rep, cc: cc.join(', '), attachments: adj,
        subject: 'Solicitud de crédito recibida – ' + sol.razon_social,
        html: mailShell('Hemos recibido tu solicitud de crédito',
          '<p>Hola <b>' + esc(sol.nombre_rep_legal) + '</b>, recibimos correctamente tu solicitud. El Área de Crédito y Cartera la revisará y te responderá por este medio en un plazo de hasta 15 días hábiles desde que los documentos estén completos.</p>' +
          tabla + '<p style="font-size:12px;color:#888">Con tu código puedes consultar el estado en el formulario (botón «Consultar estado»). Se adjunta el formato OX-F-GFI-18.</p>')
      }, db);
    }
    O.mail({
      to: CREDITOS_EMAIL, attachments: adj,
      subject: '[Nueva solicitud] ' + sol.razon_social + ' – ' + sol.codigo_solicitud,
      html: mailShell('Nueva solicitud de crédito', '<p>El cliente radicó una nueva solicitud desde el formulario público.</p>' + tabla +
        '<p style="font-size:12px;color:#888">Representante: ' + esc(sol.nombre_rep_legal) + ' &lt;' + esc(sol.correo_rep) + '&gt; · Ejecutivo: ' + esc(sol.ejecutivo_cuenta) + '</p>')
    }, db);
    if (looksLikeEmail(sol.ejecutivo_cuenta)) {
      O.mail({
        to: sol.ejecutivo_cuenta, attachments: adj,
        subject: '[Nueva solicitud de crédito] ' + sol.razon_social + ' – ' + sol.codigo_solicitud,
        html: mailShell('Tu cliente radicó una solicitud de crédito', tabla + '<p>Puedes seguir el avance en el Portal de consulta.</p>')
      }, db);
    }
  }

  /* ───────────────────────── Catálogos ───────────────────────── */
  H.apiGetCatalogos = () => O.read(db => ({
    tiposSolicitud: db.tiposSolicitud || [], tiposDocumento: db.tiposDocumento || [],
    monedas: db.monedas || [], centros: db.centros || [], comerciales: db.comerciales || []
  }));
  H.apiGetEjecutivos = () => O.read(db => (db.ejecutivos || []).slice());
  H.getScriptUrl = () => location.origin + location.pathname;

  /* ───────────────────────── Verificación de correo (OTP) ───────────────────────── */
  const OTP_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  H.apiSendVerificationCode = function (email) {
    if (!email) fail('Email is required');
    let code = '';
    const buf = new Uint32Array(6);
    (crypto || window.crypto).getRandomValues(buf);
    for (let i = 0; i < 6; i++) code += OTP_CHARS.charAt(buf[i] % OTP_CHARS.length);
    O.tx(db => {
      db.codigos = db.codigos || {};
      db.codigos['verify_' + email] = { code, exp: Date.now() + OTP_TTL_MS };
      delete db.codigos['intentos_otp_' + email];
    });
    sendCodeMail(email, code);
    return true;
  };

  H.apiVerifyCode = function (email, code) {
    if (!email || !code) return false;
    let res;
    try {
      res = O.tx(db => {
        db.codigos = db.codigos || {};
        const kI = 'intentos_otp_' + email, kV = 'verify_' + email;
        const now = Date.now();
        let it = db.codigos[kI];
        if (it && it.exp < now) { delete db.codigos[kI]; it = null; }
        const intentos = it ? it.n : 0;
        if (intentos >= OTP_MAX_INTENTOS) return { err: 'Superaste el número máximo de intentos permitidos. Por favor, solicita un nuevo código de verificación.' };
        const v = db.codigos[kV];
        if (v && v.exp < now) delete db.codigos[kV];
        const cached = db.codigos[kV];
        if (cached && cached.code === code) { delete db.codigos[kI]; return { ok: true }; }
        db.codigos[kI] = { n: intentos + 1, exp: now + OTP_TTL_MS };
        return { ok: false };
      });
    } catch (e) { throw e; }
    if (res.err) throw new Error(normalizePublicError(new Error(res.err)));
    return res.ok;
  };

  /* ───────────────────────── Iniciar solicitud ───────────────────────── */
  H.apiStartSubmission = function (payload) {
    payload = payload || {};
    const tipo_solicitud = str(payload.tipo_solicitud);
    const centro = str(payload.centro_codigo).toUpperCase();
    const razon = str(payload.razon_social);
    const ident = str(payload.identificacion);
    const correo = str(payload.correo_rep);
    let monto = Number(String(payload.monto || '').replace(/[^0-9]/g, '')) || 0;
    const moneda = str(payload.moneda || 'COP').toUpperCase();

    const g = k => str(payload[k]);
    const faltan = [];
    if (!tipo_solicitud) faltan.push('tipo_solicitud');
    if (!centro) faltan.push('centro_codigo');
    if (!razon) faltan.push('razon_social');
    if (!g('nombre_comercial')) faltan.push('nombre_comercial');
    if (!ident) faltan.push('identificacion');
    if (!g('direccion')) faltan.push('direccion');
    if (!g('ciudad')) faltan.push('ciudad');
    if (!g('departamento')) faltan.push('departamento');
    if (!g('nombre_rep_legal')) faltan.push('nombre_rep_legal');
    if (!g('tipo_id_rep')) faltan.push('tipo_id_rep');
    if (!g('num_id_rep')) faltan.push('num_id_rep');
    if (!g('cargo_rep')) faltan.push('cargo_rep');
    if (!g('tel_rep')) faltan.push('tel_rep');
    if (!correo) faltan.push('correo_rep');
    if (!g('responsabilidad_fiscal')) faltan.push('responsabilidad_fiscal');
    if (!g('ejecutivo_cuenta')) faltan.push('ejecutivo_cuenta');
    if (!g('fact_fecha_corte')) faltan.push('fact_fecha_corte');
    if (!g('fact_docs_req')) faltan.push('fact_docs_req');
    if (!g('fact_email')) faltan.push('fact_email');
    if (!moneda) faltan.push('moneda');

    let contactos = [];
    try { contactos = JSON.parse(payload.contactos_json || '[]'); } catch (_) { contactos = []; }
    if (!Array.isArray(contactos)) contactos = [];
    ['Tesorería', 'Cuentas por pagar'].forEach(area => {
      const c = contactos.find(x => x && x.area === area) || {};
      if (!str(c.tel)) faltan.push('contacto_' + area + '_tel');
      if (!str(c.email)) faltan.push('contacto_' + area + '_email');
    });
    if (faltan.length) fail('Faltan datos obligatorios: ' + faltan.join(', '));

    return O.tx(db => {
      if (!monto && centro) {
        monto = centro.split(',').map(c => c.trim()).filter(Boolean).reduce((sum, cod) => {
          const h = (db.centros || []).find(x => String(x.codigo || '').trim().toUpperCase() === cod);
          return sum + (h ? Number(h.monto_minimo || h.monto || 0) : 0);
        }, 0);
      }
      const uuid = O.uuid();
      const codigo = generarCodigoSolicitud(razon, tipo_solicitud, uuid);
      const carpeta = 'demo-folder-' + uuid.slice(0, 8);
      db.formStaging = db.formStaging || {};
      // Limpiar staging anterior del mismo NIT (igual que el original)
      Object.keys(db.formStaging).forEach(k => { if (db.formStaging[k].sol.identificacion === ident) delete db.formStaging[k]; });

      const fechaDilig = g('fecha_diligenciamiento') || nowIso().slice(0, 10);
      db.formStaging[uuid] = {
        creada: nowIso(),
        docs: [],
        sol: {
          uuid, codigo_solicitud: codigo, estado_sync: 'SINCRONIZADO', tipo_solicitud,
          centro_codigo: centro, razon_social: razon, nombre_comercial: g('nombre_comercial'), identificacion: ident,
          direccion: g('direccion'), ciudad: g('ciudad'), departamento: g('departamento'), cod_postal: g('cod_postal'),
          nombre_rep_legal: g('nombre_rep_legal'), tipo_id_rep: g('tipo_id_rep'), num_id_rep: g('num_id_rep'),
          cargo_rep: g('cargo_rep'), tel_rep: g('tel_rep'), correo_rep: correo,
          responsabilidad_fiscal: g('responsabilidad_fiscal'), contactos_json: g('contactos_json') || '[]',
          fact_fecha_corte: g('fact_fecha_corte'), fact_fecha_exp_cert: sqlDate(payload.fact_fecha_expedicion_cert),
          fact_fecha_exp_carta: sqlDate(payload.fact_fecha_expedicion_carta), fact_inscripcion: g('fact_inscripcion') || 'NO',
          fact_docs_req: g('fact_docs_req'), fact_email: g('fact_email'), fact_email_cc: g('fact_email_cc'),
          refs_otros_centros: g('refs_otros_centros') || 'NO', monto, moneda, ejecutivo_cuenta: g('ejecutivo_cuenta'),
          fecha_diligenciamiento: sqlDate(fechaDilig), carpeta_drive_id: carpeta, fecha_envio: '',
          estado_codigo: 'BORRADOR', comentarios: g('comentarios'), firma_url: '', ip_dispositivo: g('ip_dispositivo'),
          fecha_aprobacion: '', aceptado_por: '', cupos_distribuidos_json: '{}', fecha_recibido_doc: '', fecha_venc_doc: '',
          vigencia_doc: '', perfil_creado: '', razon_bloqueo: '', es_filial: g('es_filial') || 'NO',
          segunda_firma_nombre: '', segunda_firma_cargo: '', segunda_firma_correo: '', segunda_firma_fecha: '',
          segunda_firma_ip: '', segunda_firma_metodo: ''
        }
      };
      return { success: true, uuid, codigo_solicitud: codigo, carpeta_drive_id: carpeta, docs_folder_id: carpeta };
    });
  };

  /* ───────────────────────── Carga de documentos (resumible, simulada) ───────────────────────── */
  const uploads = {};   // upload_key → { uuid, tipo, nombre, exp, recibidos }

  H.apiInitUploadDocumento = function (payload) {
    payload = payload || {};
    const uuid = str(payload.uuid), tipo = str(payload.tipo_documento), folder = str(payload.docs_folder_id);
    const nameRaw = str(payload.nombre_archivo) || (tipo + '.pdf');
    const mime = str(payload.mime || 'application/pdf');
    if (!uuid) fail('UUID invalido.');
    if (!tipo) fail('Falta tipo_documento.');
    if (!folder) fail('Carpeta no válida.');
    if (mime !== 'application/pdf') fail('Solo PDF.');
    const clean = safeName(nameRaw).replace(/\.pdf$/i, '') + '.pdf';
    const finalName = tipo + ' - ' + clean;
    const key = 'UP_' + uuid + '_' + tipo + '_' + O.uuid();
    uploads[key] = { uuid, tipo, nombre: finalName, exp: Date.now() + UPLOAD_TTL_MS, recibidos: 0 };
    return { upload_key: key, nombre_final: finalName };
  };

  H.apiUploadChunk = function (payload) {
    payload = payload || {};
    const key = str(payload.upload_key), chunk = String(payload.chunk_base64 || '');
    const start = Number(payload.start || 0), end = Number(payload.end || 0), total = Number(payload.total || 0);
    if (!key || !chunk || !total) fail('Chunk incompleto.');
    const up = uploads[key];
    if (!up || up.exp < Date.now()) { delete uploads[key]; fail('Sesion de upload expirada.'); }
    if (total > MAX_FILE_BYTES) { delete uploads[key]; fail('Supera 30MB'); }
    up.recibidos = Math.max(up.recibidos, end + 1);
    if (end + 1 >= total) {
      delete uploads[key];
      return { done: true, drive_file_id: 'demo-file-' + up.uuid.slice(0, 8) + '-' + up.tipo.toLowerCase() + '-' + O.uuid().slice(0, 6) };
    }
    return { done: false };
  };

  function upsertDoc(stg, uuid, tipo, driveId, nombre, bytes, hash, fecha) {
    const d = { uuid_solicitud: uuid, tipo_documento: tipo, drive_file_id: driveId, nombre_archivo: nombre, tamano_bytes: bytes, hash_sha256: hash || '', estado_sync: 'SINCRONIZADO', fecha_subida: fecha || nowIso() };
    const i = stg.docs.findIndex(x => x.tipo_documento === tipo);
    if (i >= 0) stg.docs[i] = d; else stg.docs.push(d);
  }

  H.apiRegistrarDocumentoEnCola = function (payload) {
    payload = payload || {};
    const uuid = str(payload.uuid), tipo = str(payload.tipo_documento), fid = str(payload.drive_file_id), nombre = str(payload.nombre_archivo);
    const bytes = Number(payload.tamano_bytes || 0);
    if (!uuid || !tipo || !fid || !nombre || !bytes) fail('Faltan datos para registrar documento.');
    O.tx(db => {
      const stg = (db.formStaging || {})[uuid];
      if (!stg) fail('Solicitud no encontrada.');
      upsertDoc(stg, uuid, tipo, fid, nombre, bytes, str(payload.hash_sha256), payload.fecha_subida ? String(payload.fecha_subida) : nowIso());
    });
    return { ok: true };
  };

  H.apiGuardarPdfSolicitud = function (payload) {
    payload = payload || {};
    const uuid = str(payload.uuid), pdf = String(payload.pdfBase64 || '');
    const fileName = str(payload.fileName || 'OX-F-GFI-18.pdf');
    if (!uuid) fail('UUID inválido.');
    if (!pdf) fail('PDF vacío.');
    const fid = 'demo-file-' + uuid.slice(0, 8) + '-formato';
    O.tx(db => {
      const stg = (db.formStaging || {})[uuid];
      if (!stg) fail('Solicitud no encontrada.');
      upsertDoc(stg, uuid, 'FORMATO_SOLICITUD', fid, fileName, b64Bytes(pdf), '', nowIso());
    });
    return { ok: true, fileId: fid };
  };

  /* ───────────────────────── Finalizar ───────────────────────── */
  H.apiFinalizarSolicitud = function (payload) {
    payload = payload || {};
    const uuid = str(payload.uuid), codigo = str(payload.codigo_solicitud);
    if (!uuid && !codigo) fail('UUID invalido.');
    const out = O.tx(db => {
      db.formStaging = db.formStaging || {};
      let stg = null;
      if (uuid) stg = db.formStaging[uuid] || null;
      else if (codigo) stg = Object.values(db.formStaging).find(s => s.sol.codigo_solicitud.toUpperCase() === codigo.toUpperCase()) || null;
      if (!stg) {
        const ya = db.solicitudes.find(s => (uuid && s.uuid === uuid) || (codigo && s.codigo_solicitud.toUpperCase() === codigo.toUpperCase()));
        if (ya) return { yaEnviada: true };
        fail('Solicitud no encontrada.');
      }
      const sol = stg.sol;
      const adj = new Set(stg.docs.map(d => d.tipo_documento));
      const req = ['CERT_EXISTENCIA', 'RUT'];
      if (!adj.has('CARTA_SIN_CEDULA')) req.push('CEDULA_REP');
      if (!adj.has('CARTA_SIN_EEFF')) req.push('ESTADOS_FIN');
      const faltantes = req.filter(x => !adj.has(x));
      if (faltantes.length) fail('Faltan documentos: ' + faltantes.map(c => docNombre(db, c)).join('; '));

      // Formato PDF: si el cliente no lo generó, el "servidor" lo genera (PdfGenerator.js)
      const pdfName = 'OX-F-GFI-18_' + safeName(sol.razon_social).slice(0, 80) + '.pdf';
      if (!adj.has('FORMATO_SOLICITUD')) {
        upsertDoc(stg, sol.uuid, 'FORMATO_SOLICITUD', 'demo-file-' + sol.uuid.slice(0, 8) + '-formato', pdfName, 150000, '', nowIso());
      }

      // Sincronización staging → principal: reemplaza solicitudes anteriores con el mismo NIT
      const previas = db.solicitudes.filter(s => s.identificacion === sol.identificacion && s.uuid !== sol.uuid).map(s => s.uuid);
      if (previas.length) {
        db.solicitudes = db.solicitudes.filter(s => previas.indexOf(s.uuid) < 0);
        db.documentos = db.documentos.filter(d => previas.indexOf(d.uuid_solicitud) < 0);
      }
      const final = Object.assign({}, sol, { fecha_envio: nowIso(), estado_codigo: 'PENDIENTE_REVISION', estado_sync: 'SINCRONIZADO' });
      db.solicitudes.push(final);
      stg.docs.forEach(d => db.documentos.push(Object.assign({}, d, { estado_sync: 'SINCRONIZADO' })));
      delete db.formStaging[sol.uuid];
      sendSolicitudMails(db, final, pdfName);
      db.auditoria = db.auditoria || [];
      db.auditoria.push({ fecha: nowIso(), usuario: final.correo_rep, accion: 'SOLICITUD_RADICADA', detalle: final.codigo_solicitud, origen: 'FORMULARIO' });
      return { ok: true };
    });
    if (out && !out.yaEnviada) O.toast('<b>Solicitud radicada</b><br>Ya puedes verla en el <a href="' + (O.basePath || './') + 'panel/index.html">Panel</a> (estado Pendiente de revisión).', 9000);
    return { ok: true };
  };

  /* ───────────────────────── Consulta de estado ───────────────────────── */
  H.apiGetSolicitudStatusByCodigo = function (codigo) {
    try {
      if (!codigo) throw new Error('Código de radicado requerido.');
      const cod = String(codigo).trim().toUpperCase();
      return O.read(db => {
        const s = db.solicitudes.find(x => String(x.codigo_solicitud).toUpperCase() === cod);
        if (s) return { success: true, codigo: s.codigo_solicitud, razon_social: s.razon_social, fecha_envio: s.fecha_envio || '', estado: s.estado_codigo, comentarios: s.comentarios || '' };
        const g = Object.values(db.formStaging || {}).find(x => x.sol.codigo_solicitud.toUpperCase() === cod);
        if (g) return { success: true, codigo: g.sol.codigo_solicitud, razon_social: g.sol.razon_social, fecha_envio: '', estado: 'BORRADOR', comentarios: g.sol.comentarios || '' };
        return { success: false, message: 'No se encontró ninguna solicitud con el radicado ingresado.' };
      });
    } catch (e) { return { success: false, message: e.message }; }
  };

  /* ───────────────────────── Subsanación ───────────────────────── */
  function buscarSolicitud(db, raw) {
    const low = raw.toLowerCase();
    return db.solicitudes.find(s => s.uuid.toLowerCase() === low || s.codigo_solicitud === raw) || null;
  }

  H.apiGetSolicitudSubsanar = function (uuidOrCode) {
    try {
      if (!uuidOrCode) throw new Error('Parámetro de solicitud requerido.');
      const raw = String(uuidOrCode).trim();
      return O.read(db => {
        let sol = null;
        const s = buscarSolicitud(db, raw);
        if (s) {
          const ia = (db.analisisIA || {})[s.uuid] || {};
          let reps = Array.isArray(ia.representantes_disponibles) ? ia.representantes_disponibles : null;
          if (!reps) {
            reps = [
              { nombre: String(s.nombre_rep_legal || '').toUpperCase(), cargo: 'REPRESENTANTE LEGAL PRINCIPAL', num_id: s.num_id_rep || '' },
              { nombre: 'SUPLENTE DEMO ' + String(s.razon_social || '').split(' ')[0].toUpperCase(), cargo: 'REPRESENTANTE LEGAL SUPLENTE', num_id: '' }
            ];
          }
          sol = {
            uuid: s.uuid, codigo_solicitud: s.codigo_solicitud, razon_social: s.razon_social, identificacion: s.identificacion,
            observaciones: s.comentarios || '', estado: s.estado_codigo || '', carpeta_drive_id: s.carpeta_drive_id || '',
            requiere_segunda_firma: ia.requiere_segunda_firma != null ? !!ia.requiere_segunda_firma : (s.es_filial === 'SI' || Number(s.monto) >= 25000000),
            representantes_disponibles: reps,
            segunda_firma_nombre: s.segunda_firma_nombre || '', segunda_firma_cargo: s.segunda_firma_cargo || '',
            segunda_firma_correo: s.segunda_firma_correo || '', segunda_firma_fecha: s.segunda_firma_fecha || ''
          };
        } else {
          const g = Object.values(db.formStaging || {}).find(x => x.sol.uuid === raw || x.sol.codigo_solicitud === raw);
          if (g) sol = {
            uuid: g.sol.uuid, codigo_solicitud: g.sol.codigo_solicitud, razon_social: g.sol.razon_social, identificacion: g.sol.identificacion,
            observaciones: g.sol.comentarios || '', estado: 'ERROR', carpeta_drive_id: g.sol.carpeta_drive_id, requiere_segunda_firma: false,
            representantes_disponibles: [], segunda_firma_nombre: '', segunda_firma_cargo: '', segunda_firma_correo: '', segunda_firma_fecha: ''
          };
        }
        if (!sol) throw new Error('No se encontró la solicitud de crédito con el identificador proporcionado.');
        return { ok: true, solicitud: sol };
      });
    } catch (e) { return { ok: false, error: e.message }; }
  };

  H.apiSubsanarDocumentos = function (payload) {
    try {
      payload = payload || {};
      const uuid = str(payload.uuid);
      const files = payload.files || [];
      const seg = payload.segunda_firma || null;
      if (!uuid) throw new Error('UUID de la solicitud es obligatorio.');
      if (!files.length && (!seg || !seg.correo || !seg.nombre)) throw new Error('Debes adjuntar al menos un documento o completar la validación de segunda firma para subsanar.');
      const res = O.tx(db => {
        const s = buscarSolicitud(db, uuid);
        if (!s) throw new Error('No se encontró la solicitud en el sistema.');
        const now = new Date();
        const saved = [];
        files.forEach(f => {
          if (!f || !f.base64) return;
          let tipo = str(f.tipo || 'OTRO').toUpperCase();
          if (tipo === 'OTRO') tipo = 'OTRO_DOC';
          const nombre = safeName(f.name || (tipo + '_subsanacion.pdf'));
          const i = db.documentos.findIndex(d => d.uuid_solicitud === s.uuid && d.tipo_documento === tipo);
          const doc = {
            uuid_solicitud: s.uuid, tipo_documento: tipo, drive_file_id: 'demo-file-' + s.uuid.slice(0, 8) + '-' + tipo.toLowerCase() + '-sub' + O.uuid().slice(0, 4),
            nombre_archivo: nombre, tamano_bytes: b64Bytes(f.base64), hash_sha256: '', estado_sync: 'SINCRONIZADO', fecha_subida: now.toISOString()
          };
          if (i >= 0) db.documentos[i] = doc; else db.documentos.push(doc);
          saved.push({ tipo, name: nombre });
        });
        let coment = '\n[Subsanación registrada el ' + now.toISOString().slice(0, 10) + ']';
        if (seg && seg.correo && seg.nombre) {
          // Igual que el original: no se re-verifica el OTP en el servidor (lo afirma el cliente).
          s.segunda_firma_nombre = str(seg.nombre); s.segunda_firma_cargo = str(seg.cargo);
          s.segunda_firma_correo = str(seg.correo); s.segunda_firma_fecha = sqlDateTime(now);
          s.segunda_firma_ip = str(seg.ip); s.segunda_firma_metodo = 'OTP_EMAIL';
          coment += ' - Segunda firma electrónica validada vía OTP por ' + s.segunda_firma_nombre + ' (' + s.segunda_firma_correo + ') IP: ' + (s.segunda_firma_ip || 'N/A');
        }
        s.estado_codigo = 'PENDIENTE_REVISION';
        s.comentarios = (s.comentarios || '') + coment;
        let body = '<p>El expediente <b>' + esc(s.codigo_solicitud) + '</b> de <b>' + esc(s.razon_social) + '</b> ha sido subsanado por el cliente.</p><ul><li>Documentos nuevos subidos: ' + saved.length + '</li>';
        if (seg && seg.correo) body += '<li>Segunda firma electrónica refrendada por: ' + esc(seg.nombre) + ' (' + esc(seg.correo) + ') [Validado OTP]</li>';
        body += '<li>Estado actualizado a: PENDIENTE para reevaluación.</li></ul><p>Puede revisar el expediente en el Panel de Control.</p>';
        O.mail({ to: CREDITOS_EMAIL, subject: '[Subsanación/Doble Firma] Recibida para la solicitud ' + s.codigo_solicitud + ' – ' + s.razon_social, html: mailShell('Subsanación recibida', body), attachments: saved.map(x => x.name) }, db);
        db.auditoria = db.auditoria || [];
        db.auditoria.push({ fecha: nowIso(), usuario: (seg && seg.correo) || s.correo_rep, accion: 'SUBSANACION', detalle: s.codigo_solicitud, origen: 'FORMULARIO' });
        return { ok: true, codigo_solicitud: s.codigo_solicitud, archivos_subidos: saved.length, segunda_firma_registrada: !!(seg && seg.correo), mensaje: 'Subsanación procesada y enviada a reevaluación exitosamente.' };
      });
      return res;
    } catch (e) { return { ok: false, error: e.message }; }
  };

  /* ───────────────────────── Logo / PDF de prueba ───────────────────────── */
  H.apiGetLogoBase64 = function () {
    try {
      const c = document.createElement('canvas'); c.width = 420; c.height = 84;
      const x = c.getContext('2d');
      x.font = '400 56px "Century Gothic", "Trebuchet MS", Arial, sans-serif';
      x.textBaseline = 'middle'; x.fillStyle = '#ffffff';
      x.fillText('demo', 6, 40);
      const w1 = x.measureText('demo').width; x.fillStyle = '#d08b43'; x.fillText('H', 6 + w1, 40);
      const w2 = x.measureText('H').width; x.fillStyle = '#ffffff'; x.fillText('otel', 6 + w1 + w2, 40);
      return { ok: true, b64: c.toDataURL('image/png').split(',')[1] };
    } catch (_) { return { ok: false }; }
  };

  H.apiTestEnviarPdfClienteSide = function (pdfBase64) {
    if (!pdfBase64) throw new Error('PDF vacío.');
    O.mail({
      to: SOPORTE_EMAIL, subject: '[PRUEBA html2canvas] OX-F-GFI-18 — Formulario de Crédito', attachments: ['OX-F-GFI-18_TEST_CLIENT.pdf'],
      html: mailShell('Prueba de PDF', '<p>PDF generado con <b>html2canvas + jsPDF</b> (client-side rendering) desde la página de prueba.</p>')
    });
    return { ok: true };
  };

  /* ───────────────────────── IA simulada: extracción y validación ───────────────────────── */
  const EMPRESAS_IA = [
    { razon_social: 'COMERCIALIZADORA EJEMPLO DEL CARIBE S.A.S.', nombre_comercial: 'EJEMPLO CARIBE', nit: '990200101', dv: '4', direccion: 'CALLE 45 # 12-30 OFICINA 501', ciudad: 'BARRANQUILLA', departamento: 'ATLANTICO', rep: 'ANDREA FICTICIA PEREZ', id: '52100200' },
    { razon_social: 'INVERSIONES MUESTRA ANDINA S.A.S.', nombre_comercial: 'MUESTRA ANDINA', nit: '990200202', dv: '7', direccion: 'CARRERA 7 # 71-21 TORRE B', ciudad: 'BOGOTA', departamento: 'CUNDINAMARCA', rep: 'CARLOS IMAGINARIO RUIZ', id: '80300400' },
    { razon_social: 'SERVICIOS DEMOSTRATIVOS DEL VALLE LTDA', nombre_comercial: 'DEMO VALLE', nit: '990200303', dv: '1', direccion: 'AVENIDA 6N # 25-50', ciudad: 'CALI', departamento: 'VALLE DEL CAUCA', rep: 'LUISA SIMULADA GOMEZ', id: '31500600' },
    { razon_social: 'TECNOLOGIAS PROTOTIPO S.A.', nombre_comercial: 'PROTOTIPO TECH', nit: '990200404', dv: '9', direccion: 'CALLE 10 # 43D-30 LOCAL 2', ciudad: 'MEDELLIN', departamento: 'ANTIOQUIA', rep: 'JORGE INVENTADO LOPEZ', id: '71700800' }
  ];
  const NEGATIVOS = /c[eé]dula|cedula|estados?[ _-]*financ|balance|renta|extracto|factura|contrato|datacr|experian|referencia|pasaporte/i;
  const RE_RUT = /registro\s+[uú]nico\s+tributario|formulario\s+001|\bRUT\b|dian/i;
  const RE_CAM = /c[aá]mara\s+de\s+comercio|matr[ií]cula\s+mercantil|existencia\s+y\s+representaci|camara|c[aá]mara|existencia/i;

  function clasificarPdf(f) {
    const head = b64Head(f.base64, 200000);
    const name = String(f.name || '');
    if (RE_CAM.test(head) && !NEGATIVOS.test(name)) return 'CAMARA_COMERCIO';
    if (RE_RUT.test(head) && !NEGATIVOS.test(name)) return 'RUT';
    if (/\brut\b|^rut|_rut|rut_|rut\./i.test(name)) return 'RUT';
    if (RE_CAM.test(name) || /cert|comercio/i.test(name)) return 'CAMARA_COMERCIO';
    if (NEGATIVOS.test(name) || NEGATIVOS.test(head)) return 'OTRO';
    return null;   // indeterminado: se asigna alternando RUT / CÁMARA
  }
  function demoAviso(msg) { if (O.toast) O.toast('<b>IA simulada</b><br>' + msg, 7000); }

  H.apiExtractFormDataFromDocs = async function (files) {
    if (!files || !files.length) throw new Error('Debes proporcionar al menos un archivo PDF.');
    const validos = files.filter(f => f && f.base64);
    if (!validos.length) throw new Error('No se recibieron archivos PDF válidos en Base64.');
    await O.sleep(900);   // "análisis" de la IA
    let alt = 0; try { alt = Number(sessionStorage.getItem('demo-ia-alt') || 0); } catch (_) {}
    const tipos = validos.map((f, i) => {
      let t = clasificarPdf(f);
      if (!t) { t = ((alt + i) % 2 === 0) ? 'RUT' : 'CAMARA_COMERCIO'; }
      return t;
    });
    if (validos.length === 1 && clasificarPdf(validos[0]) == null) { try { sessionStorage.setItem('demo-ia-alt', String(alt + 1)); } catch (_) {} }
    const valido = tipos.some(t => t === 'RUT' || t === 'CAMARA_COMERCIO');
    const seed = hashStr(validos.map(f => (f.name || '') + b64Bytes(f.base64)).join('|'));
    const e = EMPRESAS_IA[seed % EMPRESAS_IA.length];
    demoAviso(valido ? 'Los datos extraídos son <b>ficticios</b> (no se lee el PDF real). En producción los extrae Gemini.' : 'Documento rechazado por la validación simulada (por nombre/contenido).');
    const base = { es_documento_valido: valido, tipo_documento_detectado: tipos[0] || 'OTRO', tipo_documento_detectado_2: validos.length > 1 ? tipos[1] : null };
    if (!valido) return Object.assign(base, { razon_social: null, nombre_comercial: null, nit: null, digito_verificacion: null, direccion: null, ciudad: null, departamento: null, cod_postal: null, nombre_rep_legal: null, tipo_id_rep: null, num_id_rep: null, cargo_rep: null, tel_rep_num: null, correo_rep: null, correo_facturas: null, fecha_constitucion: null, representantes_disponibles: null });
    return Object.assign(base, {
      razon_social: e.razon_social, nombre_comercial: e.nombre_comercial, nit: e.nit, digito_verificacion: e.dv,
      direccion: e.direccion, ciudad: e.ciudad, departamento: e.departamento, cod_postal: '110110',
      nombre_rep_legal: e.rep, tipo_id_rep: 'CC', num_id_rep: e.id, cargo_rep: 'REPRESENTANTE LEGAL', tel_rep_num: '3001234567',
      correo_rep: null, correo_facturas: null, fecha_constitucion: '2015-03-18',
      representantes_disponibles: [{ nombre: e.rep, cargo: 'REPRESENTANTE LEGAL PRINCIPAL', num_id: e.id }, { nombre: 'SUPLENTE FICTICIO DE ' + e.nombre_comercial, cargo: 'GERENTE SUPLENTE', num_id: null }]
    });
  };

  H.apiValidateCartaCedula = async function (fileObj) {
    try {
      if (!fileObj || !fileObj.base64) throw new Error('No se recibió el archivo.');
      await O.sleep(700);
      const name = String(fileObj.name || ''), head = b64Head(fileObj.base64, 200000);
      let ok = true, motivo = 'Análisis simulado: el documento parece una carta que justifica la ausencia de la cédula del representante legal.';
      if (/carta|imposib|confidencial|justific/i.test(head) || /carta|imposib|confidencial|justific/i.test(name)) { ok = true; }
      else if (/c[eé]dula|cedula|\brut\b|estados?[ _-]*financ|renta|factura/i.test(name)) { ok = false; motivo = 'Análisis simulado: el archivo parece una cédula u otro documento, no una carta de justificación.'; }
      demoAviso('Validación de carta <b>simulada</b> (por nombre/contenido del PDF).');
      return { es_valido: ok, motivo };
    } catch (e) { return { es_valido: false, motivo: e.message || String(e) }; }
  };

  /* ───────────────────────── Asistente virtual (Gemini simulado) ───────────────────────── */
  const KB = [
    [/requisit|document|papeles|que necesit|qu[eé] debo (adjuntar|presentar)|rut|c[aá]mara|existencia|c[eé]dula|estados? financ|renta/i,
      '**Requisitos de la solicitud**\n- Solo personas jurídicas constituidas en Colombia (no personas naturales).\n- Documentos en PDF: **RUT** reciente (menos de 30 días), **Certificado de Existencia y Representación Legal** (menos de 30 días), **cédula del representante legal**, **Estados financieros** de los últimos 2 años y, opcionalmente, la declaración de renta del último año.\n- Si no puedes adjuntar la cédula o los estados financieros, puedes subir una carta de imposibilidad firmada por el representante legal.'],
    [/cu[aá]nto (demora|tarda)|tiempo|demora|tarda|plazo de respuesta|respuesta|cu[aá]ndo/i,
      '**Tiempos de respuesta**\nEl estudio de crédito toma hasta **15 días hábiles** desde que los documentos estén completos. Puedes consultar el estado en cualquier momento con el botón «Consultar estado» usando tu código de radicado.'],
    [/anticipo|plazo|condicion|pago|fiar|fiado|evento|30 d[ií]as|30%/i,
      '**Plazos y condiciones**\n- Todo evento requiere un **anticipo del 30%** obligatorio (no se fía el 100% de los eventos).\n- El plazo de pago es de **30 días calendario** tras la radicación de la factura.\n- Los cupos aprobados tienen vigencia de **1 año**; luego requieren renovación documental.'],
    [/firma|otp|c[oó]digo|verific|correo electr/i,
      '**Firma y verificación**\nAl final del formulario debes verificar tu correo: te enviamos un código de 6 caracteres que expira en 10 minutos (máximo 5 intentos). Al validarlo, el representante legal confirma electrónicamente la solicitud.'],
    [/qui[eé]n|persona natural|extranjer|pueden solicitar|clientes?|empresas?/i,
      '**¿Quiénes pueden solicitar crédito?**\nSolo personas jurídicas constituidas en Colombia. Las personas naturales y las empresas extranjeras sin representación local no pueden acceder al crédito corporativo.'],
    [/homologa/i,
      '**Homologación**\nEs el estudio de un crédito nuevo: el cliente que aún no tiene cupo con CupoFlow presenta su documentación para que el Área de Crédito y Cartera evalúe y apruebe un cupo por centro.'],
    [/renovaci|ampliaci|cupo|vigencia|vence/i,
      '**Renovación y ampliación**\nLa **renovación** actualiza los documentos de un cupo vigente (se hace cada año) y la **ampliación** solicita más cupo o más centros. Ambas se tramitan con este mismo formulario eligiendo el tipo de solicitud correspondiente.'],
    [/estado|radicado|consult|seguimiento|devuelta|subsan/i,
      '**Estado y subsanación**\nUsa «Consultar estado» con tu código de radicado. Si la solicitud fue **devuelta**, recibirás un enlace para subsanar: allí adjuntas los documentos corregidos y, si aplica, la segunda firma.'],
    [/contacto|soporte|humano|ayuda|tel[eé]fono|correo de|escribir/i,
      '**Soporte**\nSi necesitas ayuda directa, escribe al Área de Crédito y Cartera: **creditos@example.com** (correo ficticio de la demo).']
  ];
  const KB_DEFAULT = 'Puedo ayudarte con dudas sobre el proceso de solicitud de crédito: **requisitos y documentos**, **tiempos de respuesta**, **plazos y anticipos**, **firma con código**, **homologación/renovación** y **subsanación**. Si necesitas soporte humano escribe a **creditos@example.com**.';

  H.apiChatWithGemini = async function (chatHistory) {
    if (!Array.isArray(chatHistory) || !chatHistory.length) throw new Error('Historial de chat inválido.');
    await O.sleep(500);
    const users = chatHistory.filter(m => m && m.role === 'user');
    const last = users.length ? String((users[users.length - 1].parts || [{}])[0].text || '') : '';
    const hit = KB.find(k => k[0].test(last));
    let text = hit ? hit[1] : KB_DEFAULT;
    if (users.length <= 1) text = '**Respuesta simulada de la demo** (en producción responde Gemini con esta misma información oficial).\n\n' + text;
    return {
      candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }],
      usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 },
      modelVersion: 'demo-simulado'
    };
  };

  /* ───────────────────────── IP simulada (evita llamar a api.ipify.org) ───────────────────────── */
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  if (realFetch) {
    window.fetch = function (url, opts) {
      if (/api\.ipify\.org/.test(String(url && url.url ? url.url : url))) {
        return Promise.resolve(new Response(JSON.stringify({ ip: '203.0.113.' + (10 + Math.floor(Math.random() * 200)) }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(url, opts);
    };
  }

  /* ───────────────────────── Semilla, accesos y guía de la demo ───────────────────────── */
  O.onSeed(db => {
    db.formStaging = db.formStaging || {};
    // El formulario real emite tipo_solicitud = NUEVA (el catálogo seed solo trae HOMOLOGACION): se agrega para que las vistas que resuelven el nombre por catálogo lo muestren.
    if (!(db.tiposSolicitud || []).some(t => t.codigo === 'NUEVA')) db.tiposSolicitud.unshift({ codigo: 'NUEVA', nombre: 'Nueva solicitud (crédito nuevo)' });
  });

  function muestra() {
    const sols = O.db().solicitudes || [];
    const de = est => sols.filter(s => s.estado_codigo === est);
    return { pendiente: de('PENDIENTE_REVISION')[0], activa: de('ACTIVA')[0], devueltas: de('DEVUELTA') };
  }

  function abrirEstado(codigo) {
    const btn = document.getElementById('btnOpenConsultarPanel');
    if (typeof window.openConsultarPanel === 'function') window.openConsultarPanel(); else if (btn) btn.click();
    setTimeout(() => {
      const inp = document.getElementById('txtConsultarCodigo'); if (inp) inp.value = codigo;
      const go = document.getElementById('btnPerformConsultation'); if (go) go.click();
    }, 350);
  }

  const cfg = {
    name: 'formulario', title: 'Formulario', autoOpen: false,
    get quick() {
      const m = muestra(), q = [];
      if (m.pendiente) q.push({ email: m.pendiente.codigo_solicitud, rol: 'CLIENTE', nombre: 'Consultar estado (pendiente)', desc: 'Abre el panel de estado con este radicado' });
      if (m.activa) q.push({ email: m.activa.codigo_solicitud, rol: 'CLIENTE', nombre: 'Consultar estado (aprobada)', desc: 'Radicado de una solicitud ya aprobada' });
      m.devueltas.slice(0, 2).forEach((s, i) => q.push({ email: s.uuid, rol: 'CLIENTE', nombre: 'Subsanar solicitud devuelta ' + (i + 1), desc: s.razon_social }));
      return q;
    },
    fillLogin: function (val) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(val)) location.href = location.pathname + '?subsanar=' + encodeURIComponent(val);
      else abrirEstado(val);
    },
    get notes() {
      const m = muestra(), n = [];
      n.push('<b>Sin cuentas ni contraseñas:</b> usa cualquier correo ficticio. El código de verificación (6 caracteres) aparecerá <b>en pantalla</b> y en la bandeja simulada.');
      n.push('<b>Autocompletar con IA (simulada):</b> en el paso 2 sube dos PDF cualquiera; si se llaman <span class="odm-pw">RUT.pdf</span> y <span class="odm-pw">Camara_Comercio.pdf</span> se clasifican correctamente. Los datos extraídos son ficticios. Un archivo llamado «estados financieros» o «cédula» será rechazado.');
      if (m.pendiente) n.push('<b>Consultar estado:</b> radicado de ejemplo <span class="odm-pw">' + esc(m.pendiente.codigo_solicitud) + '</span>' + (m.activa ? ' (aprobada: <span class="odm-pw">' + esc(m.activa.codigo_solicitud) + '</span>)' : '') + '.');
      if (m.devueltas.length) n.push('<b>Subsanar:</b> abre <a href="?subsanar=' + esc(m.devueltas[0].uuid) + '" style="color:#7a3f00;font-weight:700">?subsanar=' + esc(m.devueltas[0].uuid.slice(0, 13)) + '…</a> (solicitud devuelta de «' + esc(m.devueltas[0].razon_social) + '»).');
      n.push('Al terminar, la solicitud aparece en el <b>Panel</b> como «Pendiente de revisión». Los archivos que subas no salen de tu navegador: solo se guardan sus metadatos.');
      return n;
    }
  };
  O.appConfig = cfg;
})();
