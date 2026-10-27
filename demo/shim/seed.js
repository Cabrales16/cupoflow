/* ============================================================================
 * seed.js — Datos semilla 100 % FICTICIOS de la demo.
 *
 * Nada de lo que hay aquí corresponde a personas, empresas o NIT reales.
 * Las fechas son relativas a "hoy" para que los estados por vencer / vencido
 * y las alertas siempre se vean realistas.
 * ========================================================================== */
(function () {
  'use strict';
  const O = window.DemoKit;

  const DEMO_PASSWORD = 'Demo2025!';
  O.DEMO_PASSWORD = DEMO_PASSWORD;

  // Cuentas de acceso rápido (las usa demo-ui.js y el README).
  O.DEMO_ACCOUNTS = [
    { email: 'admin@example.com',     nombre: 'Alicia Administradora', rol: 'ADMIN',     apps: 'Panel + Portal', desc: 'Control total: aprueba, edita, gestiona usuarios y copias' },
    { email: 'operaciones@example.com',  nombre: 'Rafael Operaciones',       rol: 'OPERACIONES',  apps: 'Portal',         desc: 'Consulta créditos, marca perfiles y comenta (lectura/escritura)' },
    { email: 'consultas@example.com', nombre: 'Camila Consultas',      rol: 'CONSULTAS', apps: 'Portal',         desc: 'Solo lectura de créditos vigentes' },
    { email: 'comercial1@example.com',nombre: 'Esteban Comercial',     rol: 'CONSULTAS', apps: 'Portal',         desc: 'Ejecutivo comercial: ve las solicitudes de sus clientes' }
  ];

  const CENTROS = [
    ['CDNORTE',  'Centro Demo Norte',  'CENTRO DEMO NORTE S.A.S',        '900.000.001-1', 5000000,  'Bogotá'],
    ['CDCENTRO', 'Centro Demo Central', 'DISTRIBUIDORA DEMO CENTRO S.A.S.',  '900.000.002-2', 5000000,  'Bogotá'],
    ['CDSUR',    'Centro Demo Sur',    'CENTRO DEMO SUR S.A.S',          '900.000.003-3', 5000000,  'Medellín'],
    ['CDCOSTA',  'Centro Demo Costa',  'INVERSIONES DEMO COSTA S.A.S',  '900.000.004-4', 5000000,  'Cartagena'],
    ['CDANDES',  'Centro Demo Andes',  'CENTRO DEMO ANDES S.A.S',        '900.000.005-5', 5000000,  'Bucaramanga'],
    ['CDVALLE',  'Centro Demo Valle',  'DESARROLLOS DEMO VALLE S.A.S',  '900.000.006-6', 5000000,  'Cali'],
    ['CDISLA',   'Centro Demo Isla',   'PROYECTOS DEMO ISLA S.A.S',     '900.000.007-7', 10000000, 'San Andrés'],
    ['CDBOSQUE', 'Centro Demo Bosque', 'CENTRO DEMO BOSQUE S.A.S',       '900.000.008-8', 10000000, 'Manizales']
  ];

  const COMERCIALES = [
    ['Esteban', 'Comercial', 'comercial1@example.com'],
    ['Lucía', 'Ventas', 'comercial2@example.com'],
    ['Mateo', 'Cuentas', 'comercial3@example.com'],
    ['Valentina', 'Corporativa', 'comercial4@example.com'],
    ['Sebastián', 'Obras', 'comercial5@example.com']
  ];

  // [razón social, nit, ciudad, depto, rep legal, centros, monto, estado, díasAtrásEnvío, díasAtrásDecisión, tipo, filial]
  const EMPRESAS = [
    // ── Vigentes / activas ──
    ['Constructora Ejemplo S.A.S.',        '990100001-1', 'Bogotá',       'Cundinamarca', 'Camilo Ficticio Rojas',       ['CDNORTE','CDCENTRO'],          30000000, 'ACTIVA',    140, 120, 'HOMOLOGACION', 'NO'],
    ['Transportes Demo del Valle S.A.',    '990100002-2', 'Cali',         'Valle del Cauca','Marcela Inventada Cruz',    ['CDVALLE'],                     12000000, 'ACTIVA',    100,  85, 'HOMOLOGACION', 'NO'],
    ['Constructora Aurora Ltda.',     '990100003-3', 'Medellín',     'Antioquia',    'Daniel Simulado Pérez',       ['CDSUR','CDCOSTA'],             24000000, 'APROBADA',   60,  45, 'HOMOLOGACION', 'NO'],
    ['Ferretería Andina S.A.S.',            '990100004-4', 'Bucaramanga',  'Santander',    'Paola Muestra Gómez',         ['CDANDES'],                     8000000,  'ACTIVA',    200, 180, 'RENOVACION',   'NO'],
    ['Ingenieros Horizonte S.A.S.',       '990100005-5', 'Bogotá',       'Cundinamarca', 'Andrés Prueba Molina',        ['CDNORTE','CDCENTRO','CDANDES'],45000000, 'ACTIVA',    250, 230, 'AMPLIACION',   'NO'],
    ['Obras y Montajes Nova S.A.S.', '990100006-6', 'Cartagena',    'Bolívar',      'Sofía Demo Arias',            ['CDCOSTA','CDISLA'],            36000000, 'APROBADA',   30,  20, 'HOMOLOGACION', 'NO'],
    ['Prefabricados Ejemplar S.A.',         '990100007-7', 'Bogotá',       'Cundinamarca', 'Julián Ficticio Vargas',      ['CDCENTRO'],                    15000000, 'ACTIVA',    300, 270, 'RENOVACION',   'NO'],
    ['Acabados Cóndor S.A.S.',          '990100008-8', 'Medellín',     'Antioquia',    'Natalia Imaginaria Ríos',     ['CDSUR','CDNORTE'],             20000000, 'ACTIVA',    170, 150, 'HOMOLOGACION', 'SI'],
    ['Logística Sur Global Ltda.',         '990100009-9', 'Cali',         'Valle del Cauca','Óscar Supuesto Beltrán',    ['CDVALLE','CDSUR'],             18000000, 'ACTIVA',    130, 110, 'AMPLIACION',   'NO'],
    ['Maderas del Bosque S.A.S.',            '990100010-0', 'Manizales',    'Caldas',       'Isabel Anónima Duarte',       ['CDBOSQUE'],                    10000000, 'APROBADA',   20,  12, 'HOMOLOGACION', 'NO'],
    // ── Por vencer (decisión hace ~350-360 días) ──
    ['Inmobiliaria Cumbre S.A.S.',         '990100011-1', 'Bogotá',       'Cundinamarca', 'Ricardo Falso Mendoza',       ['CDNORTE'],                     9000000,  'POR_VENCER',420, 356, 'HOMOLOGACION', 'NO'],
    ['Estructuras Faro Demo S.A.',             '990100012-2', 'Medellín',     'Antioquia',    'Diana Ejemplo Salazar',       ['CDSUR','CDCENTRO'],            16000000, 'POR_VENCER',400, 352, 'RENOVACION',   'NO'],
    ['Cementos Río Claro S.A.S.',         '990100013-3', 'Cali',         'Valle del Cauca','Felipe Fantasía Toro',      ['CDVALLE'],                     7000000,  'POR_VENCER',410, 358, 'HOMOLOGACION', 'NO'],
    // ── Vencidas (decisión hace > 365 días) ──
    ['Pinturas Brújula S.A.S.',          '990100014-4', 'Bogotá',       'Cundinamarca', 'Laura Ilusoria Correa',       ['CDCENTRO'],                    6000000,  'VENCIDO',   560, 520, 'HOMOLOGACION', 'NO'],
    ['Minerales Cordillera Ltda.',         '990100015-5', 'Bucaramanga',  'Santander',    'Héctor Ilustrativo Mora',     ['CDANDES','CDNORTE'],           14000000, 'VENCIDO',   600, 480, 'HOMOLOGACION', 'NO'],
    // ── Bloqueadas ──
    ['Importadora Delta Norte S.A.S.',     '990100016-6', 'Bogotá',       'Cundinamarca', 'Gabriela Teórica Nieto',      ['CDNORTE','CDSUR'],             22000000, 'BLOQUEADO_CORPORATIVO', 210, 190, 'HOMOLOGACION', 'NO'],
    ['Obras Civiles Mar S.A.S.',    '990100017-7', 'Cartagena',    'Bolívar',      'Tomás Hipotético Lara',       ['CDCOSTA'],                     11000000, 'BLOQUEADO_GERENCIA',   240, 220, 'AMPLIACION',   'NO'],
    // ── Pendientes de revisión ──
    ['Grupo Constructor Zafiro S.A.S.',    '990100018-8', 'Bogotá',       'Cundinamarca', 'Verónica Creada Peña',        ['CDNORTE','CDCENTRO','CDSUR'],  40000000, 'PENDIENTE_REVISION', 2, 0, 'HOMOLOGACION', 'NO'],
    ['Pisos y Cerámicas Blanca S.A.S.',     '990100019-9', 'Medellín',     'Antioquia',    'Martín Ficticio Ospina',      ['CDSUR'],                       6500000,  'PENDIENTE_REVISION', 1, 0, 'HOMOLOGACION', 'NO'],
    ['Asfaltos Litoral S.A.',          '990100020-0', 'Cartagena',    'Bolívar',      'Carolina Modelo Ibáñez',      ['CDCOSTA','CDISLA'],            60000000, 'PENDIENTE_REVISION', 3, 0, 'AMPLIACION',   'SI'],
    ['Hidráulicos Vital Demo S.A.S.',          '990100021-1', 'Cali',         'Valle del Cauca','Ignacio Muestra Benítez',   ['CDVALLE'],                     8500000,  'PENDIENTE_REVISION', 0, 0, 'RENOVACION',   'NO'],
    ['Ingeniería Puente Azul S.A.S.',      '990100022-2', 'Bucaramanga',  'Santander',    'Adriana Prototipo León',      ['CDANDES'],                     9500000,  'PENDIENTE_REVISION', 4, 0, 'HOMOLOGACION', 'NO'],
    // ── En análisis ──
    ['Urbanizadora Ejemplar del Norte',     '990100023-3', 'Bogotá',       'Cundinamarca', 'Rodrigo Ficción Castaño',     ['CDNORTE','CDCENTRO'],          25000000, 'EN_ANALISIS', 8, 0, 'HOMOLOGACION', 'NO'],
    ['Cooperativa de Vivienda Sol Naciente',           '990100024-4', 'Manizales',    'Caldas',       'Patricia Ejemplo Giraldo',    ['CDBOSQUE'],                    10000000, 'EN_ANALISIS', 6, 0, 'HOMOLOGACION', 'NO'],
    ['Diseño y Obra Alba S.A.S.',          '990100025-5', 'Medellín',     'Antioquia',    'Sergio Imaginado Uribe',      ['CDSUR','CDISLA'],              32000000, 'EN_ANALISIS', 7, 0, 'AMPLIACION',   'NO'],
    // ── Devueltas (para subsanar) ──
    ['Distribuidora Pacífico S.A.S.',      '990100026-6', 'Cali',         'Valle del Cauca','Lorena Ficticia Mejía',     ['CDVALLE','CDCOSTA'],           13000000, 'DEVUELTA', 12, 0, 'HOMOLOGACION', 'NO'],
    ['Vías Regionales Colibrí S.A.',    '990100027-7', 'Bogotá',       'Cundinamarca', 'Ernesto Supuesto Cárdenas',   ['CDNORTE'],                     28000000, 'DEVUELTA', 15, 0, 'HOMOLOGACION', 'NO'],
    // ── Rechazadas ──
    ['Comercializadora Espejismo S.A.S.',  '990100028-8', 'Bogotá',       'Cundinamarca', 'Nicolás Irreal Quintero',     ['CDCENTRO'],                    9000000,  'RECHAZADA', 45, 40, 'HOMOLOGACION', 'NO'],
    ['Ferretería Aventura Fantasma S.A.S.',   '990100029-9', 'Cartagena',    'Bolívar',      'Juliana Inexistente Bravo',   ['CDCOSTA','CDISLA'],            17000000, 'RECHAZADA', 75, 70, 'RENOVACION',   'NO']
  ];

  const DOCS_BASE = [
    ['CERT_EXISTENCIA', 'Certificado_existencia_representacion.pdf'],
    ['CEDULA_REP',      'Cedula_representante_legal.pdf'],
    ['RUT',             'RUT.pdf'],
    ['ESTADOS_FIN',     'Estados_financieros_2_anios.pdf'],
    ['FORMATO_SOLICITUD','Formato_solicitud_credito.pdf']
  ];

  const pad = O.pad;
  function iso(d) { return new Date(d).toISOString(); }
  function sqlDT(d) { d = new Date(d); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function sqlD(d) { d = new Date(d); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  // PRNG determinista para que la semilla sea reproducible.
  let s = 20250101;
  function rand() { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }
  function hex(n) { let r = ''; for (let i = 0; i < n; i++) r += Math.floor(rand() * 16).toString(16); return r; }
  function fakeUuid() { return hex(8) + '-' + hex(4) + '-4' + hex(3) + '-a' + hex(3) + '-' + hex(12); }

  O.buildSeed = function (db) {
    const now = new Date();
    const dayMs = 86400000;
    const ago = d => new Date(now.getTime() - d * dayMs - Math.floor(rand() * 6) * 3600000);

    // ── Catálogos ────────────────────────────────────────────────────────────
    db.centros = CENTROS.map(h => ({ codigo: h[0], nombre: h[1], nit: h[3], razon: h[2], monto_minimo: h[4], ciudad: h[5] }));
    db.tiposSolicitud = [
      { codigo: 'HOMOLOGACION', nombre: 'Homologación (crédito nuevo)' },
      { codigo: 'RENOVACION',   nombre: 'Renovación de crédito' },
      { codigo: 'AMPLIACION',   nombre: 'Ampliación de cupo' }
    ];
    db.monedas = [{ codigo: 'COP', nombre: 'Peso colombiano (COP)' }, { codigo: 'USD', nombre: 'Dólar estadounidense (USD)' }];
    db.tiposDocumento = [
      { codigo: 'CERT_EXISTENCIA',   nombre: 'Certificado de existencia y representación legal' },
      { codigo: 'CEDULA_REP',        nombre: 'Cédula del representante legal' },
      { codigo: 'RUT',               nombre: 'RUT' },
      { codigo: 'ESTADOS_FIN',       nombre: 'Estados financieros' },
      { codigo: 'FORMATO_SOLICITUD', nombre: 'Formato de solicitud de crédito' },
      { codigo: 'DECL_RENTA',        nombre: 'Declaración de renta' },
      { codigo: 'REFERENCIAS',       nombre: 'Referencias comerciales' },
      { codigo: 'CARTA_APROBACION',  nombre: 'Carta de aprobación' },
      { codigo: 'OTRO_DOC',          nombre: 'Otro documento' }
    ];
    db.comerciales = COMERCIALES.map(c => ({ nombre: c[0], apellido: c[1], correo: c[2] }));
    db.ejecutivos = COMERCIALES.map(c => c[2]).sort();

    // ── Usuarios (contraseña demo en claro: es una demo pública, cuentas ficticias) ──
    db.usuarios = O.DEMO_ACCOUNTS.map(a => ({
      email: a.email, nombre: a.nombre, rol: a.rol, password: DEMO_PASSWORD, activo: 'TRUE',
      ultimo_login: '', firma_drive_id: ''
    }));
    db.usuarios.push({ email: 'inactivo@example.com', nombre: 'Usuario Inactivo', rol: 'CONSULTAS', password: DEMO_PASSWORD, activo: 'FALSE', ultimo_login: '', firma_drive_id: '' });

    // ── Solicitudes ──────────────────────────────────────────────────────────
    db.solicitudes = [];
    db.documentos = [];
    EMPRESAS.forEach((e, i) => {
      const [razon, nit, ciudad, depto, rep, centros, monto, estado, dEnv, dDec, tipo, filial] = e;
      const uuid = fakeUuid();
      const envio = ago(dEnv);
      const decidida = ['ACTIVA','APROBADA','POR_VENCER','VENCIDO','BLOQUEADO_CORPORATIVO','BLOQUEADO_GERENCIA','RECHAZADA'].includes(estado);
      const decision = decidida ? ago(dDec) : null;
      const ejecutivo = COMERCIALES[i % COMERCIALES.length][2];
      const cupos = {};
      const reparto = Math.floor(monto / centros.length / 1000000) * 1000000;
      centros.forEach(h => cupos[h] = reparto);
      const aprobada = ['ACTIVA','APROBADA','POR_VENCER','VENCIDO','BLOQUEADO_CORPORATIVO','BLOQUEADO_GERENCIA'].includes(estado);
      const dominio = razon.split(' ')[0].toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
      const codigo = sqlD(envio).replace(/-/g, '') + '-' + ({ AMPLIACION: 'AMP', RENOVACION: 'REN', HOMOLOGACION: 'HOM' }[tipo]) + '-' +
        razon.normalize('NFD').replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/)[0].toUpperCase().slice(0, 10) + '-' + uuid.replace(/-/g, '').slice(0, 4).toUpperCase();
      const perfil = {};
      if (aprobada && i % 2 === 0) centros.forEach(h => perfil[h] = true);
      else if (aprobada && i % 3 === 0 && centros.length) perfil[centros[0]] = true;

      db.solicitudes.push({
        uuid, codigo_solicitud: codigo, estado_sync: 'SINCRONIZADO', tipo_solicitud: tipo,
        centro_codigo: centros.join(','),
        razon_social: razon, nombre_comercial: razon.replace(/ (S\.A\.S\.?|S\.A\.?|Ltda\.?)$/i, ''),
        identificacion: nit, direccion: 'Calle ' + (10 + i) + ' # ' + (20 + i) + '-' + (30 + i), ciudad, departamento: depto, cod_postal: '1' + pad(i) + '001',
        nombre_rep_legal: rep, tipo_id_rep: 'CC', num_id_rep: String(10000000 + i * 7919), cargo_rep: 'Representante Legal',
        tel_rep: '300' + String(1000000 + i * 1543).slice(0, 7), correo_rep: 'representante' + (i + 1) + '@' + dominio + '.example.com',
        responsabilidad_fiscal: 'O-13', contactos_json: '[]',
        fact_fecha_corte: 'Último día hábil del mes', fact_fecha_exp_cert: sqlD(ago(dEnv + 5)), fact_fecha_exp_carta: sqlD(ago(dEnv + 4)),
        fact_inscripcion: 'Portal de proveedores', fact_docs_req: 'Orden de compra',
        fact_email: 'facturacion@' + dominio + '.example.com', fact_email_cc: '',
        refs_otros_centros: 'NO', monto, moneda: 'COP', ejecutivo_cuenta: ejecutivo,
        fecha_diligenciamiento: sqlD(envio), carpeta_drive_id: 'demo-folder-' + (i + 1),
        fecha_envio: iso(envio), estado_codigo: estado === 'ACTIVA' || estado === 'POR_VENCER' || estado === 'VENCIDO' ? estado : estado,
        comentarios: estado === 'DEVUELTA' ? 'Falta el certificado de existencia vigente (máx. 30 días).' :
                     estado === 'RECHAZADA' ? 'No cumple los indicadores financieros mínimos de la política.' :
                     estado === 'BLOQUEADO_CORPORATIVO' ? 'Bloqueo por mora en cartera.' :
                     estado === 'BLOQUEADO_GERENCIA' ? 'Bloqueo por decisión de gerencia.' : '',
        firma_url: '', ip_dispositivo: '190.0.' + (i % 250) + '.' + ((i * 7) % 250),
        fecha_aprobacion: decision ? sqlDT(decision) : '',
        aceptado_por: aprobada ? 'Área de Crédito y Cartera (demo)' : '',
        cupos_distribuidos_json: aprobada ? JSON.stringify(cupos) : '{}',
        fecha_recibido_doc: aprobada ? sqlD(ago(dEnv + 2)) : '',
        fecha_venc_doc: aprobada ? sqlD(new Date(decision.getTime() + 60 * dayMs)) : '',
        vigencia_doc: aprobada ? (new Date(decision.getTime() + 60 * dayMs) < now ? 'Vencido' : 'Vigente') : '',
        perfil_creado: Object.keys(perfil).length ? JSON.stringify(perfil) : '',
        razon_bloqueo: estado.startsWith('BLOQUEADO') ? (estado === 'BLOQUEADO_CORPORATIVO' ? 'Mora en cartera superior a 60 días' : 'Decisión de gerencia comercial') : '',
        es_filial: filial,
        segunda_firma_nombre: filial === 'SI' ? 'Representante Matriz Ficticio' : '',
        segunda_firma_cargo: filial === 'SI' ? 'Gerente General' : '',
        segunda_firma_correo: filial === 'SI' ? 'matriz' + (i + 1) + '@' + dominio + '.example.com' : '',
        segunda_firma_fecha: filial === 'SI' ? sqlDT(ago(dEnv - 1)) : '',
        segunda_firma_ip: filial === 'SI' ? '190.1.2.3' : '',
        segunda_firma_metodo: filial === 'SI' ? 'CODIGO_CORREO' : ''
      });

      // Documentos (metadatos; el visor muestra un PDF de ejemplo generado en el navegador)
      DOCS_BASE.forEach((d, k) => {
        if (estado === 'DEVUELTA' && d[0] === 'CERT_EXISTENCIA') return;
        db.documentos.push({
          uuid_solicitud: uuid, tipo_documento: d[0], drive_file_id: 'demo-file-' + (i + 1) + '-' + (k + 1),
          nombre_archivo: d[1], tamano_bytes: 180000 + Math.floor(rand() * 900000), hash_sha256: '', estado_sync: 'SINCRONIZADO',
          fecha_subida: iso(envio)
        });
      });
      if (aprobada) {
        db.documentos.push({
          uuid_solicitud: uuid, tipo_documento: 'CARTA_APROBACION', drive_file_id: 'demo-file-' + (i + 1) + '-carta',
          nombre_archivo: 'Carta_Aprobacion_Credito_' + razon.replace(/[^A-Za-z0-9]+/g, '_') + '.pdf', tamano_bytes: 95000,
          hash_sha256: '', estado_sync: 'SINCRONIZADO', fecha_subida: iso(decision)
        });
      }
    });

    // ── Estructuras vacías que cada app puebla en su propio onSeed ─────────────
    db.sesiones = {};          // token → { email, nombre, rol, app, ts }
    db.codigos = {};           // 'REC_CODE_email' / verificación de correo → { codigo, exp, intentos }
    db.outbox = [];            // correos "enviados" (simulados)
    db.auditoria = [];
    db.analisisIA = {};
    db.notificacionesLeidas = {};
    db.backups = [];
    db.configuracion = [];
  };
})();
