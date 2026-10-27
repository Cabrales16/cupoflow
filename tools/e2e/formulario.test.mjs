// E2E del Formulario de solicitud de crédito (demo estática).
// Uso: node demo/build.mjs && node tools/e2e/formulario.test.mjs
import { launch } from './helper.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');
fs.mkdirSync(TMP, { recursive: true });

const t = await launch({ port: Number(process.env.E2E_PORT) || 4180 + Math.floor(Math.random() * 400) });
const results = [];
let shotN = 0;

async function step(name, fn) {
  const started = Date.now();
  try { await fn(); results.push([name, true]); console.log('  OK  ' + name + ' (' + (Date.now() - started) + ' ms)'); }
  catch (e) { results.push([name, false, e]); console.log('  FALLA ' + name + '\n       ' + String(e.message).split('\n').slice(0, 6).join('\n       ')); throw e; }
}

// ── PDFs de prueba (mínimos y válidos) ─────────────────────────────────────────
function makePdf(text) {
  const content = 'BT /F1 14 Tf 50 750 Td (' + text.replace(/[\\()]/g, '\\$&') + ') Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = pdf.length;
  pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return Buffer.from(pdf, 'latin1');
}
const file = (name, text, mimeType = 'application/pdf') => ({ name, mimeType, buffer: makePdf(text) });
const F = {
  rut:    file('RUT.pdf', 'Registro Unico Tributario - RUT - DIAN - Formulario 001 (documento de prueba ficticio)'),
  camara: file('Camara_Comercio.pdf', 'Camara de Comercio - Certificado de Existencia y Representacion Legal (documento de prueba ficticio)'),
  cedula: file('cedula_rep_legal.pdf', 'Copia de cedula de ciudadania (documento de prueba ficticio)'),
  eeff:   file('estados_financieros_2024.pdf', 'Estados financieros comparativos (documento de prueba ficticio)'),
  eeff2:  file('estados_financieros_2023.pdf', 'Estados financieros comparativos 2023 (documento de prueba ficticio)'),
  texto:  { name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('esto no es un pdf') },
  carta:  file('Carta_cedula.pdf', 'Carta de imposibilidad de adjuntar cedula - informacion confidencial')
};

// ── utilidades de página ────────────────────────────────────────────────────────
const dbOf = p => p.evaluate(() => JSON.parse(localStorage.getItem('demo-db')));
const shot = async (p, name) => { await p.screenshot({ path: path.join(TMP, 'formulario-' + String(++shotN).padStart(2, '0') + '-' + name + '.png'), fullPage: false }); };
const cleanToasts = p => p.evaluate(() => document.querySelectorAll('.odm-toast').forEach(e => e.remove()));
async function modalText(p) { await p.waitForSelector('#_valModal', { timeout: 8000 }); return (await p.textContent('#_valModal')).replace(/\s+/g, ' ').trim(); }
async function closeModal(p) { await p.click('#_valModal button'); await p.waitForSelector('#_valModal', { state: 'detached' }); }
async function expectModal(p, re) { const tx = await modalText(p); assert.match(tx, re, 'modal inesperado: ' + tx); await closeModal(p); }
const call = (p, name, ...args) => p.evaluate(([n, a]) => new Promise(res => google.script.run
  .withSuccessHandler(r => res({ ok: true, res: r })).withFailureHandler(e => res({ ok: false, err: e.message }))[n](...a)), [name, args]);
async function lastCode(p, email) {
  const db = await dbOf(p);
  const m = db.outbox.find(x => x.to === email && x.code);
  assert.ok(m, 'no hay correo con código para ' + email);
  return m.code;
}
async function next(p, id) { await cleanToasts(p); await p.locator('#' + id).scrollIntoViewIfNeeded(); await p.click('#' + id); await p.waitForTimeout(350); }
async function pickCsel(p, wrapId, index = 0) {
  await p.click('#' + wrapId + '_trigger');
  await p.locator('#' + wrapId + '_list .csel-opt').nth(index).click();
}
async function openForm(p, query = '') {
  await p.goto(t.base + 'formulario/index.html' + query);
  await p.waitForSelector('#centroCheckGrid .centro-check-item', { timeout: 15000 });
}
async function acceptWelcome(p) {
  await p.waitForSelector('#welcomeModal:not(.hidden)', { timeout: 8000 });
  await p.check('#chkWelcomeTerms', { force: true });
  await p.check('#chkWelcomeData', { force: true });
  await p.click('#btnWelcomeAccept');
  await p.waitForSelector('#welcomeModal', { state: 'hidden' });
}

const EMAIL = 'representante.demo@example.com';
let codigo = null, uuidNueva = null;

try {
  const p = await t.newPage();
  await p.addInitScript(() => { window.__err = []; });

  // ─────────────────────────────────────────────────────────────── carga y catálogos
  await step('carga inicial: catálogos, centros y comerciales', async () => {
    await openForm(p);
    const n = await p.locator('#centroCheckGrid .centro-check-item').count();
    assert.equal(n, 8, 'deben verse 8 centros del catálogo');
    await acceptWelcome(p);
    await shot(p, 'paso1-inicio');
    assert.equal(await p.locator('#tipoSolicitudGrid .tipo-card').count() >= 3, true);
    // el asistente y el panel de estado existen
    assert.ok(await p.locator('#chatFab').count());
  });

  await step('paso 1: validaciones (tipo y centro obligatorios)', async () => {
    await next(p, 'btnNext1');
    await expectModal(p, /tipo de solicitud/i);
    await p.locator('#tipoSolicitudGrid .tipo-card').first().click();
    await next(p, 'btnNext1');
    await expectModal(p, /al menos un centro/i);
    await p.locator('#centroCheckGrid .centro-check-item').nth(0).click();
    await p.locator('#centroCheckGrid .centro-check-item').nth(6).click();
    assert.equal(await p.inputValue('#centro_codigo'), 'CDNORTE,CDISLA');
    await shot(p, 'paso1-seleccion');
    await next(p, 'btnNext1');
    assert.ok(await p.isVisible('#step2'));
  });

  await step('paso 2: exige RUT y Cámara; IA simulada rechaza archivo no PDF y documento equivocado', async () => {
    await next(p, 'btnNext2');
    await expectModal(p, /Documentos obligatorios requeridos/i);
    await p.setInputFiles('#iaFileInput2', F.texto);
    await expectModal(p, /Formato no v[aá]lido/i);
    await p.setInputFiles('#iaFileInput2', F.eeff);
    await expectModal(p, /Documento no v[aá]lido detectado/i);
    await p.setInputFiles('#iaFileInput2', [F.rut, F.camara, F.cedula]);
    await expectModal(p, /Demasiados documentos/i);
  });

  await step('paso 2: autocompletar con IA simulada (RUT + Cámara de Comercio)', async () => {
    await p.setInputFiles('#iaFileInput2', [F.rut, F.camara]);
    await p.waitForSelector('#iaSuccessBanner2:not(.hidden)', { timeout: 15000 });
    assert.match(await p.inputValue('#razon_social'), /\S{4,}/);
    assert.match(await p.inputValue('#nit'), /^\d{9}$/);
    assert.ok(await p.inputValue('#direccion'));
    assert.ok(await p.locator('.odm-toast', { hasText: 'IA simulada' }).count(), 'debe avisar que la IA es simulada');
    await shot(p, 'paso2-ia');
  });

  await step('paso 2: campos obligatorios y datos del representante', async () => {
    await cleanToasts(p);
    await p.fill('#nombre_rep_legal', '');
    await next(p, 'btnNext2');
    await expectModal(p, /Nombre del representante legal/i);
    await p.fill('#nombre_rep_legal', 'Andrea Ficticia Pérez');
    await next(p, 'btnNext2');
    await expectModal(p, /Tipo de identificaci/i);
    await pickCsel(p, 'csel_tipo_id', 0);
    await p.fill('#num_id_rep', '52100200');
    await p.fill('#cargo_rep', 'Representante Legal');
    await p.fill('#tel_rep_num', '3001234567');
    await p.fill('#correo_rep', EMAIL);
    await next(p, 'btnNext2');
    await expectModal(p, /Responsabilidad fiscal/i);
    await p.locator('.fiscal-row:has(input[value="48"])').click();
    await next(p, 'btnNext2');
    await expectModal(p, /Ejecutivo de cuenta/i);
    await pickCsel(p, 'csel_ejecutivo', 1);
    assert.match(await p.inputValue('#ejecutivo_cuenta'), /@example\.com$/);
    await shot(p, 'paso2-completo');
    await next(p, 'btnNext2');
    assert.ok(await p.isVisible('#step3'));
  });

  await step('paso 3: contactos y facturación', async () => {
    await next(p, 'btnNext3');
    await expectModal(p, /tel[eé]fono del contacto de Tesorer/i);
    await p.fill('#cont_tes_nombre', 'Tomás Tesorería');
    await p.fill('#cont_tes_tel_num', '3000000001');
    await p.fill('#cont_tes_email', 'tesoreria@ejemplo-demo.example.com');
    await p.fill('#cont_cp_nombre', 'Paula Pagos');
    await p.fill('#cont_cp_tel_num', '3000000002');
    await p.fill('#cont_cp_email', 'pagos@ejemplo-demo.example.com');
    await next(p, 'btnNext3');
    await expectModal(p, /Fecha de corte/i);
    await p.fill('#fact_fecha_corte', 'Último día hábil del mes');
    await p.fill('#fact_docs_req', 'Orden de compra y planilla de seguridad social');
    await p.fill('#fact_email', 'facturacion@ejemplo-demo.example.com');
    await shot(p, 'paso3-completo');
    await next(p, 'btnNext3');
    assert.ok(await p.isVisible('#step4'));
  });

  await step('paso 4: documentos obligatorios, límites (30 MB, solo PDF) y vigencias', async () => {
    await shot(p, 'paso4-vacio');
    await next(p, 'btnNext4');
    const tx = await modalText(p);
    assert.match(tx, /Faltan los siguientes documentos/i);
    await closeModal(p);
    await p.setInputFiles('#docInput_CEDULA_REP', F.texto);
    await expectModal(p, /no es un PDF v[aá]lido/i);
    // archivo de 31 MB creado dentro del navegador (evita transferirlo por el protocolo de pruebas)
    await p.evaluate(() => {
      const input = document.getElementById('docInput_CEDULA_REP'), dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(31 * 1024 * 1024)], 'enorme.pdf', { type: 'application/pdf' }));
      input.files = dt.files; input.dispatchEvent(new Event('change'));
    });
    await expectModal(p, /supera el l[ií]mite de 30 MB/i);
    await p.setInputFiles('#docInput_CEDULA_REP', F.cedula);
    await p.setInputFiles('#docInput_ESTADOS_FIN', [F.eeff, F.eeff2]);
    await next(p, 'btnNext4');
    await expectModal(p, /fecha de vigencia/i);
    // Fecha de vigencia del certificado (≤ 30 días): se elige desde el selector de fecha
    await p.evaluate(() => {
      const d = new Date(); d.setDate(d.getDate() - 5);
      dtpInit('CERT_EXISTENCIA'); dtpSelect('CERT_EXISTENCIA', d.getFullYear(), d.getMonth(), d.getDate());
    });
    await shot(p, 'paso4-completo');
    await next(p, 'btnNext4');
    assert.ok(await p.isVisible('#step5'));
  });

  await step('paso 5: resumen, términos y verificación de correo (código incorrecto)', async () => {
    await shot(p, 'paso5-resumen');
    assert.match(await p.textContent('#summaryCard'), /Centro Demo Norte/);
    assert.equal(await p.isDisabled('#btnSubmit'), true, 'el envío está bloqueado hasta verificar el correo');
    await p.evaluate(() => submitForm());
    await expectModal(p, /aceptar los t[eé]rminos/i);
    await p.check('#acepta', { force: true });
    await p.evaluate(() => submitForm());
    await expectModal(p, /verificar tu correo/i);
    await p.click('#btnSendVerification');
    await p.waitForSelector('#verify-input-row', { state: 'visible' });
    const code = await lastCode(p, EMAIL);
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/, 'código de 6 caracteres sin ambiguos');
    assert.ok(await p.locator('.odm-toast .code', { hasText: code }).count(), 'el código se muestra en pantalla');
    await shot(p, 'paso5-codigo-en-pantalla');
    await p.fill('#verification_code', '123');
    await p.click('#btnVerifyCode');
    assert.match(await p.textContent('#verification-status'), /6 caracteres/);
    await p.fill('#verification_code', code === 'ZZZZZZ' ? 'AAAAAA' : 'ZZZZZZ');
    await p.click('#btnVerifyCode');
    await p.waitForFunction(() => /incorrecto/i.test(document.getElementById('verification-status').textContent));
  });

  await step('paso 5: código correcto, envío final y confirmación', async () => {
    await cleanToasts(p);
    await p.fill('#verification_code', await lastCode(p, EMAIL));
    await p.click('#btnVerifyCode');
    await p.waitForFunction(() => document.querySelector('.verification-success-icon'), null, { timeout: 8000 });
    await shot(p, 'paso5-verificado');
    await cleanToasts(p);
    await p.click('#btnSubmit');
    await p.waitForFunction(() => /Solicitud enviada/i.test((document.querySelector('#uploadModal .modal-title') || {}).textContent || ''), null, { timeout: 90000 });
    codigo = (await p.textContent('#uploadModal .modal-sub strong')).trim();
    assert.match(codigo, /^\d{8}-SOL-[A-Z0-9]+-[A-Z0-9]{4}$/, 'tipo NUEVA → prefijo SOL (igual que el original)');
    await shot(p, 'envio-exito');
    console.log('       código de solicitud:', codigo);
  });

  await step('la solicitud queda en localStorage con el esquema del seed (y para el Panel)', async () => {
    const db = await dbOf(p);
    const s = db.solicitudes.find(x => x.codigo_solicitud === codigo);
    assert.ok(s, 'solicitud no encontrada en db.solicitudes');
    uuidNueva = s.uuid;
    const ref = db.solicitudes.find(x => x.codigo_solicitud !== codigo);
    const faltan = Object.keys(ref).filter(k => !(k in s));
    assert.deepEqual(faltan, [], 'faltan claves del esquema seed: ' + faltan);
    assert.equal(s.estado_codigo, 'PENDIENTE_REVISION');
    assert.equal(s.estado_sync, 'SINCRONIZADO');
    assert.equal(s.tipo_solicitud, 'NUEVA');
    assert.equal(s.centro_codigo, 'CDNORTE,CDISLA');
    assert.equal(s.monto, 15000000);
    assert.equal(s.moneda, 'COP');
    assert.equal(s.correo_rep, EMAIL);
    assert.equal(s.nombre_rep_legal, 'Andrea Ficticia Pérez');
    assert.match(s.fact_fecha_exp_cert, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(s.fact_email, 'facturacion@ejemplo-demo.example.com');
    assert.equal(JSON.parse(s.contactos_json).length, 4);
    assert.equal(s.es_filial, 'NO');
    assert.match(s.ip_dispositivo, /^203\.0\.113\./, 'IP simulada (sin llamar a ipify)');
    assert.match(s.fecha_envio, /^\d{4}-\d{2}-\d{2}T/);
    const docs = db.documentos.filter(d => d.uuid_solicitud === s.uuid);
    const tipos = docs.map(d => d.tipo_documento).sort();
    assert.deepEqual(tipos, ['CEDULA_REP', 'CERT_EXISTENCIA', 'ESTADOS_FIN', 'FORMATO_SOLICITUD', 'RUT']);
    const fmt = docs.find(d => d.tipo_documento === 'FORMATO_SOLICITUD');
    console.log('       formato PDF: ' + fmt.nombre_archivo + ' (' + fmt.tamano_bytes + ' bytes, ' + (fmt.tamano_bytes === 150000 ? 'generado por el "servidor" simulado' : 'generado en el navegador con html2canvas/jsPDF') + ')');
    docs.forEach(d => { assert.ok(d.drive_file_id && d.nombre_archivo && d.tamano_bytes > 0 && d.estado_sync === 'SINCRONIZADO'); assert.equal(d.buffer, undefined); });
    assert.equal(Object.keys(db.formStaging || {}).length, 0, 'el staging debe vaciarse al finalizar');
    // correos simulados: solicitante, área de crédito y ejecutivo
    const mails = db.outbox.filter(m => (m.subject || '').includes(codigo));
    assert.ok(db.outbox.find(m => m.to === EMAIL && /Solicitud de crédito recibida/.test(m.subject) && (m.attachments || []).length), 'correo al solicitante con adjunto');
    assert.ok(mails.find(m => m.to === 'creditos@example.com'), 'correo al área de crédito');
    assert.ok(mails.find(m => m.to === s.ejecutivo_cuenta), 'correo al ejecutivo');
    // el Panel la ve
    const pp = await t.newPage();
    await pp.goto(t.base + 'panel/index.html');
    await pp.waitForTimeout(500);
    assert.ok((await dbOf(pp)).solicitudes.some(x => x.codigo_solicitud === codigo));
    await pp.close();
  });

  await step('cerrar el modal de éxito recarga el formulario vacío y sin borrador', async () => {
    await p.click('#btnModalClose');
    await p.waitForSelector('#centroCheckGrid .centro-check-item', { timeout: 15000 });
    assert.equal(await p.evaluate(() => Object.keys(localStorage).filter(k => /draft|borrador/i.test(k)).length), 0);
  });

  // ─────────────────────────────────────────────────────────────── estado por código
  await step('consultar estado por código de radicado (encontrado / no existe / vacío)', async () => {
    await openForm(p);
    await acceptWelcome(p);
    await cleanToasts(p);
    await p.click('#btnOpenConsultarPanel');
    await p.fill('#txtConsultarCodigo', codigo.toLowerCase());
    await p.click('#btnPerformConsultation');
    await p.waitForSelector('#statusResultContainer .status-card');
    const tx = await p.textContent('#statusResultContainer');
    assert.match(tx, /Pendiente de revisi[oó]n/);
    assert.ok(tx.includes(codigo));
    await shot(p, 'estado-encontrado');
    await p.fill('#txtConsultarCodigo', '20990101-HOM-NOEXISTE-0000');
    await p.click('#btnPerformConsultation');
    await p.waitForSelector('#statusResultContainer .status-error-box');
    assert.match(await p.textContent('#statusResultContainer'), /No se encontr[oó] ninguna solicitud/);
    await p.fill('#txtConsultarCodigo', '');
    await p.click('#btnPerformConsultation');
    assert.ok(await p.locator('#txtConsultarCodigo.input-error').count());
    // una solicitud del seed ya aprobada
    const db = await dbOf(p);
    const act = db.solicitudes.find(s => s.estado_codigo === 'ACTIVA');
    const r = await call(p, 'apiGetSolicitudStatusByCodigo', act.codigo_solicitud);
    assert.equal(r.res.success, true); assert.equal(r.res.estado, 'ACTIVA');
    assert.equal((await call(p, 'apiGetSolicitudStatusByCodigo', '')).res.success, false);
  });

  // ─────────────────────────────────────────────────────────────── subsanación
  await step('subsanación: solicitud DEVUELTA con enlace ?subsanar=uuid (archivo no PDF, envío sin nada, envío OK)', async () => {
    const db = await dbOf(p);
    const dev = db.solicitudes.filter(s => s.estado_codigo === 'DEVUELTA');
    assert.ok(dev.length >= 2, 'el seed debe traer 2 DEVUELTA');
    const s = dev[0];
    await openForm(p, '?subsanar=' + s.uuid);
    await p.waitForSelector('#modalSubsanar:not(.hidden)');
    await p.waitForFunction(r => document.getElementById('subsanarRazon').textContent === r, s.razon_social);
    await p.waitForTimeout(900);   // el frontend vuelve a abrir el modal a los 400 ms
    await p.waitForFunction(r => document.getElementById('subsanarRazon').textContent === r, s.razon_social);
    assert.match(await p.textContent('#subsanarObservaciones'), /certificado de existencia/i);
    assert.ok((await p.textContent('#subsanarCodigo')).includes(s.codigo_solicitud));
    await shot(p, 'subsanar-abierto');
    assert.equal(await p.isDisabled('#btnEnviarSubsanar'), true, 'sin documentos ni firma el botón está deshabilitado');
    await p.setInputFiles('#subsanarFile_RUT', F.texto);
    await expectModal(p, /Solo se admiten documentos en formato/i);
    await p.setInputFiles('#subsanarFile_CERT_EXISTENCIA', F.camara);
    await p.waitForFunction(() => document.getElementById('subsanarName_CERT_EXISTENCIA').textContent.includes('Camara_Comercio.pdf'));
    assert.equal(await p.isDisabled('#btnEnviarSubsanar'), false);
    await shot(p, 'subsanar-con-archivo');
    await p.click('#btnEnviarSubsanar');
    await p.waitForSelector('#subsanarSuccessState', { state: 'visible' });
    await shot(p, 'subsanar-exito');
    const db2 = await dbOf(p);
    const s2 = db2.solicitudes.find(x => x.uuid === s.uuid);
    assert.equal(s2.estado_codigo, 'PENDIENTE_REVISION');
    assert.match(s2.comentarios, /Subsanaci[oó]n registrada/);
    assert.ok(db2.documentos.find(d => d.uuid_solicitud === s.uuid && d.tipo_documento === 'CERT_EXISTENCIA' && d.nombre_archivo === 'Camara_Comercio.pdf'));
    assert.ok(db2.outbox.find(m => m.to === 'creditos@example.com' && /Subsanaci/.test(m.subject) && m.subject.includes(s.codigo_solicitud)));
  });

  await step('subsanación con segunda firma OTP (2.ª DEVUELTA) y errores de identificador/OTP', async () => {
    const db = await dbOf(p);
    const s = db.solicitudes.filter(x => x.estado_codigo === 'DEVUELTA')[0];
    assert.ok(s, 'queda otra DEVUELTA');
    await openForm(p, '?subsanar=' + s.codigo_solicitud);           // también acepta el código
    await p.waitForFunction(r => document.getElementById('subsanarRazon').textContent === r, s.razon_social);
    await p.waitForTimeout(900);   // el frontend reabre el modal a los 400 ms (checkSubsanarUrlParam se invoca dos veces)
    await p.selectOption('#subsanarRepSelect', '1');
    const email2 = 'segundo.firmante@example.com';
    await p.fill('#subsanarRepEmail', email2);
    await p.click('#btnSubsanarSendOtp');
    await p.waitForSelector('#subsanarOtpBox', { state: 'visible' });
    await p.fill('#subsanarOtpInput', 'QQQQQQ');
    await p.click('#btnSubsanarVerifyOtp');
    await p.waitForSelector('#subsanarOtpError', { state: 'visible' });
    assert.match(await p.textContent('#subsanarOtpError'), /incorrecto/i);
    await cleanToasts(p);
    await p.fill('#subsanarOtpInput', await lastCode(p, email2));
    await p.click('#btnSubsanarVerifyOtp');
    await p.waitForSelector('#subsanarOtpSuccessBadge', { state: 'visible' });
    await shot(p, 'subsanar-segunda-firma');
    await p.click('#btnEnviarSubsanar');
    await p.waitForSelector('#subsanarSuccessState', { state: 'visible' });
    const s2 = (await dbOf(p)).solicitudes.find(x => x.uuid === s.uuid);
    assert.equal(s2.estado_codigo, 'PENDIENTE_REVISION');
    assert.equal(s2.segunda_firma_correo, email2);
    assert.equal(s2.segunda_firma_metodo, 'OTP_EMAIL');
    assert.match(s2.segunda_firma_fecha, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    // identificador inexistente
    await openForm(p, '?subsanar=00000000-0000-0000-0000-000000000000');
    await p.waitForFunction(() => /No se encontr[oó] la solicitud/.test(document.getElementById('subsanarObservaciones').textContent));
    await shot(p, 'subsanar-no-existe');
    // API: sin datos
    const r1 = await call(p, 'apiSubsanarDocumentos', { uuid: s.uuid, files: [], segunda_firma: null });
    assert.match(r1.res.error, /al menos un documento/);
    const r2 = await call(p, 'apiSubsanarDocumentos', { uuid: '', files: [] });
    assert.match(r2.res.error, /obligatorio/);
    const r3 = await call(p, 'apiGetSolicitudSubsanar', '');
    assert.equal(r3.res.ok, false);
  });

  // ─────────────────────────────────────────────────────────────── OTP y validaciones de API
  await step('OTP: intentos máximos, expiración y reemplazo de código', async () => {
    const em = 'otp.prueba@example.com';
    assert.equal((await call(p, 'apiSendVerificationCode', '')).ok, false);
    assert.equal((await call(p, 'apiVerifyCode', '', 'AAAAAA')).res, false);
    assert.equal((await call(p, 'apiSendVerificationCode', em)).res, true);
    const c1 = await lastCode(p, em);
    assert.equal((await call(p, 'apiSendVerificationCode', em)).res, true);
    const c2 = (await dbOf(p)).codigos['verify_' + em].code;
    const mal = c2 === 'AAAAAA' ? 'BBBBBB' : 'AAAAAA';
    if (c1 !== c2) assert.equal((await call(p, 'apiVerifyCode', em, c1)).res, false, 'el código anterior deja de valer');
    for (let i = 0; i < 4; i++) assert.equal((await call(p, 'apiVerifyCode', em, mal)).res, false);   // 5 fallos con el anterior
    const bloq = await call(p, 'apiVerifyCode', em, c2);
    assert.equal(bloq.ok, false); assert.match(bloq.err, /m[aá]ximo de intentos/);
    await call(p, 'apiSendVerificationCode', em);                                  // nuevo código reinicia intentos
    const c3 = (await dbOf(p)).codigos['verify_' + em].code;
    assert.equal((await call(p, 'apiVerifyCode', em, c3)).res, true);
    // expiración (10 min): se adelanta el reloj tocando la fecha guardada
    await p.evaluate(em => { const d = JSON.parse(localStorage.getItem('demo-db')); d.codigos['verify_' + em].exp = Date.now() - 1; localStorage.setItem('demo-db', JSON.stringify(d)); }, em);
    assert.equal((await call(p, 'apiVerifyCode', em, c3)).res, false, 'código expirado');
  });

  await step('validaciones del servidor: campos, PDF, 30 MB, documentos faltantes, sesión expirada', async () => {
    const r0 = await call(p, 'apiStartSubmission', { razon_social: 'X' });
    assert.equal(r0.err, 'Completa todos los campos requeridos.');
    const base = {
      tipo_solicitud: 'RENOVACION', centro_codigo: 'cdsur', razon_social: 'Prueba Ñandú S.A.S.', nombre_comercial: 'Ñandú', identificacion: '990300001', direccion: 'Calle 1', ciudad: 'Cali',
      departamento: 'Valle', nombre_rep_legal: 'Rep Prueba', tipo_id_rep: 'CC', num_id_rep: '1', cargo_rep: 'Gerente', tel_rep: '+57 3000000000', correo_rep: 'rep@example.com',
      responsabilidad_fiscal: '48', ejecutivo_cuenta: 'comercial1@example.com', fact_fecha_corte: 'x', fact_docs_req: 'y', fact_email: 'f@example.com', monto: 0, moneda: 'COP',
      contactos_json: JSON.stringify([{ area: 'Tesorería', tel: '1', email: 'a@example.com' }, { area: 'Cuentas por pagar', tel: '', email: '' }])
    };
    const r1 = await call(p, 'apiStartSubmission', base);
    assert.equal(r1.err, 'Completa todos los campos requeridos.', 'faltan los contactos obligatorios de Cuentas por pagar');
    base.contactos_json = JSON.stringify([{ area: 'Tesorería', tel: '1', email: 'a@example.com' }, { area: 'Cuentas por pagar', tel: '2', email: 'c@example.com' }]);
    const st = await call(p, 'apiStartSubmission', base);
    assert.equal(st.ok, true);
    assert.match(st.res.codigo_solicitud, /^\d{8}-REN-PRUEBA-[0-9A-F]{4}$/, 'el código normaliza tildes y símbolos como generarCodigoSolicitud_');
    const { uuid } = st.res;
    assert.equal((await dbOf(p)).formStaging[uuid].sol.centro_codigo, 'CDSUR', 'centro en mayúsculas');
    assert.equal((await dbOf(p)).formStaging[uuid].sol.monto, 5000000, 'monto recalculado desde el catálogo si viene vacío');
    const rs = await call(p, 'apiGetSolicitudStatusByCodigo', st.res.codigo_solicitud);
    assert.equal(rs.res.estado, 'BORRADOR');
    // un segundo inicio con el mismo NIT descarta el borrador anterior
    const st2 = await call(p, 'apiStartSubmission', base);
    assert.equal(Object.keys((await dbOf(p)).formStaging).length, 1);
    const uuid2 = st2.res.uuid;
    // subida
    const init = (o) => call(p, 'apiInitUploadDocumento', Object.assign({ uuid: uuid2, tipo_documento: 'RUT', docs_folder_id: st2.res.docs_folder_id, nombre_archivo: 'a.pdf', mime: 'application/pdf' }, o));
    assert.equal((await init({ mime: 'image/png' })).err, 'Todos los documentos deben ser PDF.');
    assert.equal((await init({ uuid: '' })).err, 'No se pudo validar la sesión.');
    assert.equal((await init({ tipo_documento: '' })).err, 'Falta tipo_documento.');
    assert.equal((await init({ docs_folder_id: '' })).err, 'Carpeta no válida.');
    const ok = await init({});
    assert.match(ok.res.nombre_final, /^RUT - a\.pdf$/);
    assert.equal((await call(p, 'apiUploadChunk', { upload_key: 'UP_x', chunk_base64: 'QQ==', start: 0, end: 0, total: 1 })).err, 'La carga tardó demasiado. Intenta nuevamente.');
    assert.equal((await call(p, 'apiUploadChunk', { upload_key: ok.res.upload_key, chunk_base64: '', total: 1 })).err, 'Chunk incompleto.');
    assert.equal((await call(p, 'apiUploadChunk', { upload_key: ok.res.upload_key, chunk_base64: 'QQ==', start: 0, end: 0, total: 40 * 1024 * 1024 })).err, 'Un archivo supera el límite de 30 MB.');
    const ok2 = await init({});
    const c1 = await call(p, 'apiUploadChunk', { upload_key: ok2.res.upload_key, chunk_base64: 'QQ==', start: 0, end: 0, total: 2 });
    assert.deepEqual(c1.res, { done: false });
    const c2 = await call(p, 'apiUploadChunk', { upload_key: ok2.res.upload_key, chunk_base64: 'QQ==', start: 1, end: 1, total: 2 });
    assert.equal(c2.res.done, true); assert.ok(c2.res.drive_file_id);
    assert.equal((await call(p, 'apiRegistrarDocumentoEnCola', { uuid: uuid2, tipo_documento: 'RUT' })).err, 'Completa todos los campos requeridos.');
    assert.equal((await call(p, 'apiRegistrarDocumentoEnCola', { uuid: uuid2, tipo_documento: 'RUT', drive_file_id: c2.res.drive_file_id, nombre_archivo: 'a.pdf', tamano_bytes: 2 })).res.ok, true);
    // finalizar sin documentos completos
    const fin = await call(p, 'apiFinalizarSolicitud', { uuid: uuid2 });
    assert.match(fin.err, /^Faltan documentos: Certificado de existencia y representaci[oó]n legal; /);
    assert.doesNotMatch(fin.err, /RUT/, 'el RUT ya está cargado');
    assert.equal((await call(p, 'apiFinalizarSolicitud', {})).err, 'No se pudo validar la sesión.');
    assert.equal((await call(p, 'apiFinalizarSolicitud', { uuid: 'no-existe' })).err, 'Solicitud no encontrada.');
    assert.equal((await call(p, 'apiGuardarPdfSolicitud', { uuid: uuid2, pdfBase64: '' })).err, 'PDF vacío.');
    assert.equal((await call(p, 'apiGuardarPdfSolicitud', { uuid: uuid2, pdfBase64: 'QQ==' })).res.ok, true);
    // con cartas de imposibilidad no se exigen cédula ni estados financieros
    for (const [tipo, n] of [['CERT_EXISTENCIA', 'c.pdf'], ['CARTA_SIN_CEDULA', 'k.pdf'], ['CARTA_SIN_EEFF', 'e.pdf']])
      await call(p, 'apiRegistrarDocumentoEnCola', { uuid: uuid2, tipo_documento: tipo, drive_file_id: 'f-' + tipo, nombre_archivo: n, tamano_bytes: 10 });
    const fin2 = await call(p, 'apiFinalizarSolicitud', { codigo_solicitud: st2.res.codigo_solicitud.toLowerCase() });
    assert.equal(fin2.ok, true);
    const db = await dbOf(p);
    assert.ok(db.solicitudes.find(s => s.uuid === uuid2), 'finalizada por código');
    assert.equal((await call(p, 'apiFinalizarSolicitud', { uuid: uuid2 })).res.ok, true, 'finalizar dos veces no duplica');
    assert.equal(db.solicitudes.filter(s => s.uuid === uuid2).length, 1);
  });

  await step('IA simulada: extracción y validación de carta de cédula', async () => {
    assert.match((await call(p, 'apiExtractFormDataFromDocs', [])).err, /al menos un archivo PDF/);
    assert.match((await call(p, 'apiExtractFormDataFromDocs', [{ name: 'x.pdf' }])).err, /No se recibieron archivos PDF v/);
    const b64 = F.rut.buffer.toString('base64');
    const r = await call(p, 'apiExtractFormDataFromDocs', [{ name: 'documento_1.pdf', base64: 'data:application/pdf;base64,' + b64 }]);
    assert.equal(r.res.es_documento_valido, true);
    assert.equal(r.res.tipo_documento_detectado, 'RUT', 'clasifica por contenido del PDF aunque el nombre sea genérico');
    assert.match(r.res.nit, /^\d{9}$/); assert.ok(Array.isArray(r.res.representantes_disponibles));
    const bad = await call(p, 'apiExtractFormDataFromDocs', [{ name: 'balance_general.pdf', base64: F.eeff.buffer.toString('base64') }]);
    assert.equal(bad.res.es_documento_valido, false);
    const c1 = await call(p, 'apiValidateCartaCedula', { name: 'Carta_cedula.pdf', base64: F.carta.buffer.toString('base64') });
    assert.equal(c1.res.es_valido, true); assert.ok(c1.res.motivo);
    const c2 = await call(p, 'apiValidateCartaCedula', { name: 'cedula.pdf', base64: F.cedula.buffer.toString('base64') });
    assert.equal(c2.res.es_valido, false);
    assert.equal((await call(p, 'apiValidateCartaCedula', null)).res.es_valido, false);
    const lg = await call(p, 'apiGetLogoBase64');
    assert.equal(lg.res.ok, true); assert.ok(lg.res.b64.length > 100);
    assert.equal((await call(p, 'apiTestEnviarPdfClienteSide', 'QQ==')).res.ok, true);
    const cat = await call(p, 'apiGetCatalogos');
    assert.deepEqual(Object.keys(cat.res).sort(), ['centros', 'comerciales', 'monedas', 'tiposDocumento', 'tiposSolicitud']);
    assert.ok((await call(p, 'apiGetEjecutivos')).res.length >= 5);
  });

  // ─────────────────────────────────────────────────────────────── asistente FAQ
  await step('asistente virtual: chips, texto libre, aviso de respuesta simulada', async () => {
    await openForm(p);
    await acceptWelcome(p);
    await cleanToasts(p);
    await p.click('#chatFab');
    await p.waitForSelector('#chatWindow:not(.hidden)');
    await p.locator('.chat-chip', { hasText: 'Requisitos' }).click();
    await p.waitForFunction(() => document.querySelectorAll('.msg-bot:not(.loading)').length >= 2);
    let txt = await p.locator('.msg-bot:not(.loading)').last().textContent();
    assert.match(txt, /simulada/i, 'la primera respuesta avisa que es simulada');
    assert.match(txt, /RUT/); assert.match(txt, /Estados financieros/i);
    await shot(p, 'chat-requisitos');
    await p.fill('#chatInput', '¿Cuánto demora el estudio?');
    await p.press('#chatInput', 'Enter');
    await p.waitForFunction(() => document.querySelectorAll('.msg-bot:not(.loading)').length >= 3 && !document.querySelector('.msg-bot.loading'));
    txt = await p.locator('.msg-bot:not(.loading)').last().textContent();
    assert.match(txt, /15 d[ií]as h[aá]biles/);
    assert.doesNotMatch(txt, /simulada/i, 'el aviso solo va en la primera respuesta');
    await p.fill('#chatInput', 'blablabla');
    await p.press('#chatInput', 'Enter');
    await p.waitForFunction(() => document.querySelectorAll('.msg-bot:not(.loading)').length >= 4 && !document.querySelector('.msg-bot.loading'));
    assert.match(await p.locator('.msg-bot:not(.loading)').last().textContent(), /creditos@example\.com/);
    await shot(p, 'chat-conversacion');
  });

  // ─────────────────────────────────────────────────────────────── borradores y recarga
  await step('borrador: guardar, recargar, restaurar; y los datos de la demo persisten tras recargar', async () => {
    await openForm(p);
    await acceptWelcome(p);
    await p.locator('#tipoSolicitudGrid .tipo-card').nth(2).click();
    await p.locator('#centroCheckGrid .centro-check-item').nth(2).click();
    await cleanToasts(p);
    await p.locator('#step1 button', { hasText: 'Guardar borrador' }).click();
    await p.waitForSelector('#_draftToast');
    await p.reload();
    await p.waitForSelector('#centroCheckGrid .centro-check-item', { timeout: 15000 });
    await acceptWelcome(p);
    await p.waitForSelector('#draftBanner', { state: 'visible', timeout: 8000 });
    await p.waitForSelector('#draftBannerBtns button', { timeout: 8000 });
    await shot(p, 'borrador-banner');
    await p.locator('#draftBannerBtns button', { hasText: 'Restaurar' }).click();
    await p.waitForFunction(() => document.getElementById('tipo_solicitud').value === 'RENOVACION');
    assert.equal(await p.inputValue('#centro_codigo'), 'CDSUR');
    await shot(p, 'borrador-restaurado');
    assert.ok((await dbOf(p)).solicitudes.some(s => s.codigo_solicitud === codigo), 'la solicitud enviada sigue en la base tras recargar');
  });

  await step('guía de la demo: tarjeta con radicado de ejemplo y enlace de subsanación', async () => {
    // las dos DEVUELTA del seed ya se subsanaron arriba: se restablece una para ver el enlace en la guía
    await p.evaluate(() => { const d = JSON.parse(localStorage.getItem('demo-db')); d.solicitudes.filter(s => /Subsanaci/.test(s.comentarios)).forEach(s => { s.estado_codigo = 'DEVUELTA'; }); localStorage.setItem('demo-db', JSON.stringify(d)); });
    await cleanToasts(p);
    await p.click('.odm-pill');
    const card = await p.textContent('.odm-card');
    assert.match(card, /Sin cuentas ni contraseñas/);
    assert.match(card, /\d{8}-HOM-/);
    assert.ok(await p.locator('.odm-card a[href^="?subsanar="]').count());
    await shot(p, 'guia-demo');
    await p.click('.odm-card .odm-acc >> nth=0');          // abre el panel de estado con el radicado
    await p.waitForSelector('#statusResultContainer .status-card', { timeout: 8000 });
    await shot(p, 'guia-demo-estado');
  });

  // ─────────────────────────────────────────────────────────────── limpieza
  const problemas = t.problems.filter(x => !/ERR_INTERNET_DISCONNECTED|net::ERR_NAME_NOT_RESOLVED/.test(x.msg || ''));
  console.log('\nproblemas de consola/red:', problemas.length ? problemas : 'ninguno');
  assert.equal(problemas.length, 0, 'no debe haber errores de consola ni excepciones');
  console.log('\nTODO OK — ' + results.length + ' pasos');
} catch (e) {
  console.error('\nFALLÓ:', e.message);
  console.log('problemas:', t.problems);
  try { const pgs = t.ctx.pages(); if (pgs.length) await pgs[pgs.length - 1].screenshot({ path: path.join(TMP, 'formulario-FALLA.png') }); } catch (_) {}
  process.exitCode = 1;
} finally {
  await t.close();
}
