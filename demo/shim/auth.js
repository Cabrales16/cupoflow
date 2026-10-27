/* ============================================================================
 * auth.js — Autenticación simulada compartida por el Panel y el Portal.
 *
 * Réplica del contrato de Auth.js (panel) y Código.js (portal):
 *   apiLogin(email, password)            → { ok, token, nombre, rol, email } | { ok:false, error }
 *   apiVerificarSesion(token)            → { ok, email, nombre, rol } | { ok:false }
 *   apiLogout(token)                     → { ok:true }
 *   apiEnviarCodigoRecuperacion(email)   → { ok } | { ok:false, error }   (correo SIMULADO)
 *   apiRestablecerPassword(email, codigo, nuevoPassword)
 *   apiGetDefaultEmail()                 → ''   (en producción: cuenta Google activa)
 *
 * Uso:  DemoKit.installAuth({ app: 'panel', roles: null })  // null = cualquier rol
 *       DemoKit.installAuth({ app: 'portal', roles: ['ADMIN','CONSULTAS','OPERACIONES'] })
 * ========================================================================== */
(function () {
  'use strict';
  const O = window.DemoKit;
  const TTL_MS = 4 * 60 * 60 * 1000;

  /** Devuelve la sesión válida (y la renueva) o null. Úsala en los handlers protegidos. */
  O.getSession = function (token) {
    if (!token) return null;
    return O.tx(db => {
      const s = (db.sesiones || {})[token];
      if (!s) return null;
      if (Date.now() - s.ts > TTL_MS) { delete db.sesiones[token]; return null; }
      s.ts = Date.now();
      return { email: s.email, nombre: s.nombre, rol: s.rol };
    });
  };

  O.findUser = (db, email) => (db.usuarios || []).find(u => String(u.email).trim().toLowerCase() === String(email || '').trim().toLowerCase());

  O.installAuth = function (opts) {
    const H = O.handlers;
    const allowed = opts.roles;

    H.apiLogin = function (email, password) {
      if (!email || !password) return { ok: false, error: 'Correo y contraseña son requeridos.' };
      return O.tx(db => {
        const u = O.findUser(db, email);
        if (!u) return { ok: false, error: 'Credenciales incorrectas.' };
        if (!['TRUE', '1', 'SI', 'ACTIVO'].includes(String(u.activo).toUpperCase())) return { ok: false, error: 'Tu cuenta está inactiva. Contacta al administrador.' };
        const rol = String(u.rol).toUpperCase();
        if (allowed && !allowed.includes(rol)) return { ok: false, error: 'No tienes acceso a este portal.' };
        if (u.password !== password) return { ok: false, error: 'Credenciales incorrectas.' };
        const token = O.token();
        db.sesiones[token] = { email: u.email, nombre: u.nombre, rol, app: opts.app, ts: Date.now() };
        u.ultimo_login = O.ymdhms(new Date());
        return { ok: true, token, nombre: u.nombre, rol, email: u.email };
      });
    };

    H.apiVerificarSesion = function (token) {
      const s = O.getSession(token);
      return s ? { ok: true, email: s.email, nombre: s.nombre, rol: s.rol } : { ok: false };
    };

    H.apiLogout = function (token) {
      O.tx(db => { if (token) delete db.sesiones[token]; });
      return { ok: true };
    };

    H.apiEnviarCodigoRecuperacion = function (email) {
      email = String(email || '').trim().toLowerCase();
      if (!email) return { ok: false, error: 'El correo es requerido.' };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Correo no válido.' };
      return O.tx(db => {
        if (!O.findUser(db, email)) return { ok: false, error: 'No existe una cuenta registrada con este correo.' };
        const codigo = String(Math.floor(100000 + Math.random() * 900000));
        db.codigos['REC_CODE_' + email] = { codigo, exp: Date.now() + 600000, intentos: 0 };
        O.mail({
          to: email, subject: 'Recuperación de contraseña — CupoFlow Créditos', code: codigo,
          html: '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;text-align:center;padding:30px"><h2 style="color:#0e362f">Recuperación de contraseña</h2>' +
                '<p style="color:#555">Ingresa este código junto con tu nueva contraseña:</p><div style="border:2px dashed #d08b43;border-radius:10px;padding:20px;font-size:36px;font-weight:800;letter-spacing:10px;color:#3c796c">' + codigo +
                '</div><p style="color:#999;font-size:12px">Correo simulado por la demo. Este código expira en 10 minutos.</p></div>'
        }, db);
        return { ok: true };
      });
    };

    H.apiRestablecerPassword = function (email, codigo, nuevo) {
      email = String(email || '').trim().toLowerCase(); codigo = String(codigo || '').trim(); nuevo = String(nuevo || '').trim();
      if (!email || !codigo || !nuevo) return { ok: false, error: 'Todos los campos son obligatorios.' };
      if (nuevo.length < 8) return { ok: false, error: 'La nueva contraseña debe tener al menos 8 caracteres.' };
      return O.tx(db => {
        const k = 'REC_CODE_' + email, c = db.codigos[k];
        if (c && c.intentos >= 5) { delete db.codigos[k]; return { ok: false, error: 'Demasiados intentos fallidos. Solicita un nuevo código de recuperación.' }; }
        if (!c || c.exp < Date.now()) return { ok: false, error: 'El código de recuperación ha expirado o no ha sido solicitado.' };
        if (c.codigo !== codigo) { c.intentos++; return { ok: false, error: 'El código de recuperación ingresado es incorrecto.' }; }
        const u = O.findUser(db, email);
        if (!u) return { ok: false, error: 'Usuario no encontrado.' };
        u.password = nuevo;
        delete db.codigos[k];
        return { ok: true };
      });
    };

    H.apiGetDefaultEmail = function () { return ''; };
  };
})();
