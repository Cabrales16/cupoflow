// E2E del Portal de Consulta de Créditos (demo estática). Uso: node demo/build.mjs && node tools/e2e/portal.test.mjs
import { launch } from './helper.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');
fs.mkdirSync(TMP, { recursive: true });
const PW = 'Demo2025!';
const t = await launch();
const URL = t.base + 'portal/index.html';
let step = 0;
const ok = m => console.log('  ok -', m);
const shot = async (p, name) => { await p.screenshot({ path: path.join(TMP, 'portal-' + String(++step).padStart(2, '0') + '-' + name + '.png') }); };

async function open(showCard = false) {
  const p = await t.newPage();
  if (!showCard) await p.addInitScript(() => sessionStorage.setItem('demo-card-shown', '1'));
  await p.goto(URL);
  await p.waitForSelector('#loginEmail');
  return p;
}
async function login(p, email, pw = PW) {
  await p.fill('#loginEmail', email);
  await p.fill('#loginPassword', pw);
  await p.click('#loginBtn');
}
async function loginOk(email) {
  const p = await open();
  await login(p, email);
  await p.waitForSelector('#appContent.visible', { timeout: 8000 });
  await p.waitForFunction(() => document.querySelectorAll('.kpi-value').length && Array.from(document.querySelectorAll('.kpi-value')).some(e => e.style.display === 'block'), null, { timeout: 8000 });
  return p;
}
const view = async (p, v) => { await p.dispatchEvent(`.sb-item[data-view="${v}"]`, 'click'); await p.waitForTimeout(700); };
const toastText = async p => (await p.locator('#toastContainer').innerText()).trim();
const db = p => p.evaluate(() => JSON.parse(localStorage.getItem('demo-db')));
const rowsN = p => p.locator('#creditosTableBody tr[onclick]').count();

// ── 0. Reset a semilla limpia ────────────────────────────────────────────────
let p = await open();
await p.evaluate(() => { localStorage.clear(); });
await p.reload(); await p.waitForSelector('#loginEmail');
await p.click('.odm-pill');
await p.waitForTimeout(500);
await shot(p, 'login-con-panel-demo');
await p.click('.odm-card .odm-x');
await p.waitForTimeout(300);
await shot(p, 'login');

// ── 1. Login: errores ────────────────────────────────────────────────────────
await login(p, 'admin@example.com', 'incorrecta');
await p.waitForSelector('#loginError', { state: 'visible' });
assert.equal((await p.textContent('#loginError')).trim(), 'Credenciales incorrectas.'); ok('contraseña errónea');
await login(p, 'nadie@example.com', PW);
await p.waitForTimeout(700);
assert.equal((await p.textContent('#loginError')).trim(), 'Credenciales incorrectas.'); ok('usuario inexistente');
await login(p, 'inactivo@example.com', PW);
await p.waitForFunction(() => /inactiva/.test(document.getElementById('loginError').textContent));
ok('usuario inactivo -> "Tu cuenta está inactiva..."');
await p.fill('#loginEmail', ''); await p.fill('#loginPassword', ''); await p.click('#loginBtn');
assert.match(await p.textContent('#loginError'), /requeridos/); ok('campos vacíos');

// ── 2. Recuperar contraseña con código de la bandeja simulada ─────────────────
await p.click('text=¿Olvidaste tu contraseña?');
await p.fill('#recoverEmail', 'consultas@example.com');
await p.click('#recoverBtn');
await p.waitForSelector('#recoverCodeField', { state: 'visible' });
await p.waitForTimeout(300);
let d = await db(p);
const mail = d.outbox.find(m => m.to === 'consultas@example.com' && m.code);
assert.ok(mail && /^\d{6}$/.test(mail.code), 'código en la bandeja simulada'); ok('correo simulado con código ' + mail.code);
await shot(p, 'recuperar-paso2');
await p.fill('#recoverCodigo', '000000'); await p.fill('#recoverPassword', 'Nueva2025');
await p.click('#recoverBtn');
await p.waitForFunction(() => /incorrecto/.test(document.getElementById('recoverError').textContent));
ok('código incorrecto rechazado');
await p.fill('#recoverPassword', 'abc');
await p.click('#recoverBtn');
assert.match(await p.textContent('#recoverError'), /al menos 6/); ok('contraseña corta rechazada (cliente)');
await p.fill('#recoverCodigo', mail.code); await p.fill('#recoverPassword', 'Nueva2025');
await p.click('#recoverBtn');
await p.waitForSelector('#loginEmail', { state: 'visible' });
await p.waitForTimeout(500);
await login(p, 'consultas@example.com', PW);
await p.waitForFunction(() => /Credenciales/.test(document.getElementById('loginError').textContent));
ok('la contraseña antigua ya no funciona');
await login(p, 'consultas@example.com', 'Nueva2025');
await p.waitForSelector('#appContent.visible');
ok('login con la contraseña nueva');
// correo inexistente: mensaje genérico (no revela la existencia); se restablece la clave original
d = await db(p); d.usuarios.find(u => u.email === 'consultas@example.com').password = PW;
await p.evaluate(x => localStorage.setItem('demo-db', JSON.stringify(x)), d);
await p.close();

// ── 3. Los 4 roles entran; sidebar/rol ───────────────────────────────────────
const roles = { 'admin@example.com': 'ADMIN', 'operaciones@example.com': 'OPERACIONES', 'consultas@example.com': 'CONSULTAS', 'comercial1@example.com': 'CONSULTAS' };
for (const [email, rol] of Object.entries(roles)) {
  const q = await loginOk(email);
  assert.equal(await q.evaluate(() => APP.rol), rol);
  assert.equal((await q.textContent('#sidebarUserEmail')).trim(), email);
  ok('login ' + email + ' (' + rol + ')');
  await q.close();
}

// ── 4. Recorrido completo con ADMIN ──────────────────────────────────────────
p = await loginOk('admin@example.com');
await p.waitForTimeout(800);
await shot(p, 'dashboard-admin');
const kpis = await p.$$eval('.kpi-card .kpi-value', els => els.map(e => e.textContent.trim()));
console.log('  KPIs:', kpis);
assert.ok(kpis.some(v => Number(v) > 0), 'KPIs con datos'); ok('dashboard con KPIs');
assert.ok((await p.locator('#dbPeriodo').count()) === 1);
await p.selectOption('#dbPeriodo', 'ESTE_ANIO'); await p.waitForTimeout(800); ok('filtro de periodo del dashboard');
await p.selectOption('#dbPeriodo', 'ALL'); await p.waitForTimeout(600);

// Créditos
await view(p, 'creditos');
await p.waitForSelector('#creditosTableBody tr[onclick]');
const totalAll = await rowsN(p);
const countText = await p.textContent('#countText');
console.log('  créditos visibles:', totalAll, '|', countText.trim());
assert.ok(totalAll >= 20, 'lista de créditos');
await shot(p, 'creditos');
// centros del filtro
const optsCentro = await p.$$eval('#filterCentro option', o => o.map(x => x.value));
assert.ok(optsCentro.length > 5, 'filtro de centros poblado: ' + optsCentro); ok('filtro de centros (' + (optsCentro.length - 1) + ')');
// búsqueda
await p.fill('#filterBusqueda', 'constructora'); await p.waitForTimeout(900);
let n = await rowsN(p);
assert.ok(n > 0 && n < totalAll, 'búsqueda: ' + n);
assert.ok((await p.$$eval('#creditosTableBody tr[onclick]', r => r.every(x => /constructora/i.test(x.textContent)))));
ok('búsqueda por texto (' + n + ' resultados)');
await p.fill('#filterBusqueda', 'zzzz-no-existe'); await p.waitForTimeout(900);
assert.equal(await rowsN(p), 0);
assert.ok(/Sin resultados/.test(await p.textContent('#creditosTableBody'))); ok('búsqueda sin resultados');
await p.click('#btnLimpiarFiltros'); await p.waitForTimeout(900);
assert.equal(await rowsN(p), totalAll); ok('limpiar filtros');
// filtros por selects
for (const [id, val] of [['filterEstado', 'Vencido'], ['filterEstado', 'Bloqueado Corporativo'], ['filterEstado', 'Por Vencer'], ['filterVigencia', 'No Vigente'], ['filterVigencia', 'Por Vencer'], ['filterPerfil', 'SI'], ['filterCentro', 'CDNORTE']]) {
  await p.selectOption('#' + id, val); await p.waitForTimeout(900);
  n = await rowsN(p);
  assert.ok(n > 0 && n < totalAll, `${id}=${val}: ${n}`);
  ok(`filtro ${id}=${val} -> ${n}`);
  await p.selectOption('#' + id, id === 'filterCentro' ? 'TODOS' : 'TODOS'); await p.waitForTimeout(500);
}
await p.selectOption('#filterPeriodo', 'ESTE_ANO'); await p.waitForTimeout(900);
ok('filtro por periodo (' + (await rowsN(p)) + ')');
await p.selectOption('#filterPeriodo', 'ALL'); await p.waitForTimeout(700);
// detalle
await p.click('#creditosTableBody tr[onclick] >> nth=0', { position: { x: 30, y: 10 } });
await p.waitForSelector('#drawerPanel.open');
await p.waitForTimeout(500);
await shot(p, 'detalle-credito');
assert.ok((await p.textContent('#drawerBody')).length > 50); ok('drawer de detalle');
await p.evaluate(() => cerrarDrawer()); await p.waitForTimeout(500);

// Perfil creado (ADMIN permitido)
const chk = p.locator('#creditosTableBody .perfil-creado-chk').first();
const rowIdx = await chk.getAttribute('data-rowidx');
const before = await chk.isChecked();
await chk.click({ force: true });
await p.click('#confirmBtnAccept');
await p.waitForFunction(() => /perfil creado actualizado/i.test(document.getElementById('toastContainer').textContent));
d = await db(p);
const [uuid, hot] = rowIdx.split('_');
const pc = JSON.parse(d.solicitudes.find(s => s.uuid === uuid).perfil_creado || '{}');
assert.equal(!!pc[hot], !before); ok('ADMIN cambia perfil creado (persistido en db.solicitudes: ' + JSON.stringify(pc) + ')');
// persistencia tras recargar la vista
await view(p, 'creditos'); await p.waitForTimeout(600);
assert.equal(await p.locator(`#creditosTableBody .perfil-creado-chk[data-rowidx="${rowIdx}"]`).isChecked(), !before); ok('el cambio se ve tras recargar la lista');

// Exportar Excel
await p.locator('#viewCreditos button:has-text("Exportar")').first().click();
const [dl] = await Promise.all([
  p.waitForEvent('download', { timeout: 10000 }),
  p.click('#crudExportDropdown a:has-text("Excel")')
]);
const xfile = path.join(TMP, 'portal-export.xlsx');
await dl.saveAs(xfile);
const buf = fs.readFileSync(xfile);
assert.equal(buf.subarray(0, 2).toString(), 'PK'); // firma ZIP
const txt = buf.toString('latin1');
assert.ok(txt.includes('xl/worksheets/sheet1.xml') && txt.includes('[Content_Types].xml') && txt.includes('xl/workbook.xml'), 'estructura xlsx');
assert.ok(buf.includes(Buffer.from('Identificación (NIT)')) && buf.includes(Buffer.from('Constructora Ejemplo')), 'contenido xlsx');
assert.match(dl.suggestedFilename(), /^Cuadra_Operaciones_Creditos_\d{8}_\d{6}\.xlsx$/);
const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6])); assert.ok(eocd > 0, 'EOCD zip');
assert.equal(buf.readUInt16LE(eocd + 10), 5, '5 archivos en el zip');
const filas = (txt.match(/<row /g) || []).length;
assert.equal(filas, totalAll + 1, 'filas = créditos + cabecera');
ok('exportación Excel: ' + dl.suggestedFilename() + ' (zip válido, ' + filas + ' filas)');

// CSV
await p.locator('#viewCreditos button:has-text("Exportar")').first().click();
const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), p.click('#crudExportDropdown a:has-text("CSV")')]);
assert.match(dl2.suggestedFilename(), /\.csv$/i); ok('exportación CSV (cliente) ' + dl2.suggestedFilename());

// Notificaciones
const badge = (await p.textContent('#notifBadge')).trim();
assert.ok(Number(badge) > 0, 'badge de notificaciones: ' + badge);
await p.click('#btnNotif'); await p.waitForTimeout(400);
await shot(p, 'notif-dropdown');
await p.click('#notifDropdown .notif-mark-all');
await p.waitForTimeout(800);
assert.ok(await p.locator('#notifBadge.hidden').count() === 1); ok('marcar todas leídas (badge ' + badge + ' -> 0)');
d = await db(p);
assert.ok((d.notificacionesLeidas['admin@example.com'] || []).length > 0); ok('lecturas persistidas por usuario');
await view(p, 'notificaciones'); await p.waitForTimeout(600);
await shot(p, 'notificaciones');

// Solicitudes + comentario (ADMIN)
await view(p, 'solicitudes');
await p.waitForSelector('#solicitudesTableBodyPortal tr td');
await p.waitForTimeout(500);
const nSol = await p.locator('#solicitudesTableBodyPortal tr').count();
assert.ok(nSol >= 10); ok('vista solicitudes (' + nSol + ' en página, ' + (await p.textContent('#countTextSol')).replace(/<.*?>/g, '').trim() + ' total)');
await shot(p, 'solicitudes');
await p.fill('#filterBusquedaSol', 'zafiro'); await p.waitForTimeout(700);
assert.equal(await p.locator('#solicitudesTableBodyPortal tr').count(), 1); ok('búsqueda en solicitudes');
await p.locator('#solicitudesTableBodyPortal button:has-text("Comentar")').first().click();
await p.fill('#mComentarioTexto', 'Cliente confirmó documentos por teléfono.');
await shot(p, 'modal-comentario');
await p.click('#btnGuardarComentarioPortal');
await p.waitForFunction(() => /Comentario guardado/i.test(document.getElementById('toastContainer').textContent));
d = await db(p);
assert.equal(d.solicitudes.find(s => /Zafiro/.test(s.razon_social)).comentarios, 'Cliente confirmó documentos por teléfono.');
assert.ok(d.outbox.some(m => /Nuevo comentario/.test(m.subject) && m.to.includes('admin@example.com'))); ok('comentario guardado + correo simulado a admins');
await p.click('#btnLimpiarFiltrosSol'); await p.waitForTimeout(500);
await p.selectOption('#filterEstadoSol', 'RECHAZADA'); await p.waitForTimeout(700);
ok('filtro estado en solicitudes (' + (await p.locator('#solicitudesTableBodyPortal tr td.td-mono').count()) + ')');

// Persistencia tras recargar (sesión en sessionStorage)
await p.reload();
await p.waitForSelector('#appContent.visible', { timeout: 8000 });
ok('sesión restaurada tras recargar');
d = await db(p);
assert.equal(d.solicitudes.find(s => /Zafiro/.test(s.razon_social)).comentarios, 'Cliente confirmó documentos por teléfono.'); ok('comentario persiste tras recargar');

// Cerrar sesión
const tokenAdmin = await p.evaluate(() => sessionStorage.getItem('hd_res_token'));
assert.ok((await db(p)).sesiones[tokenAdmin]);
await p.dispatchEvent('.sb-item[title="Cerrar Sesión"]', 'click');
await p.click('#confirmBtnAccept');
await p.waitForSelector('#loginScreen', { state: 'visible' });
await p.waitForTimeout(600);
assert.equal(await p.evaluate(() => sessionStorage.getItem('hd_res_token')), null);
d = await db(p); assert.ok(!d.sesiones[tokenAdmin], 'sesión eliminada en el "servidor"');
await shot(p, 'tras-logout'); ok('cierre de sesión');
await p.close();

// ── 5. OPERACIONES: puede comentar y marcar perfil ───────────────────────────────
p = await loginOk('operaciones@example.com');
await view(p, 'creditos'); await p.waitForSelector('#creditosTableBody tr[onclick]');
const chkR = p.locator('#creditosTableBody .perfil-creado-chk').nth(1);
const beforeR = await chkR.isChecked();
await chkR.click({ force: true }); await p.click('#confirmBtnAccept');
await p.waitForFunction(() => /perfil creado actualizado/i.test(document.getElementById('toastContainer').textContent));
assert.equal(await chkR.isChecked(), !beforeR); ok('OPERACIONES marca perfil creado');
await view(p, 'solicitudes'); await p.waitForSelector('#solicitudesTableBodyPortal tr td');
await p.locator('#solicitudesTableBodyPortal button:has-text("Comentar")').first().click();
await p.fill('#mComentarioTexto', 'Comentario de Operaciones'); await p.click('#btnGuardarComentarioPortal');
await p.waitForFunction(() => /Comentario guardado/i.test(document.getElementById('toastContainer').textContent));
ok('OPERACIONES comenta'); await p.close();

// ── 6. CONSULTAS y ejecutivo comercial: solo lectura (acciones denegadas) ──────
for (const email of ['consultas@example.com', 'comercial1@example.com']) {
  p = await loginOk(email);
  await view(p, 'creditos'); await p.waitForSelector('#creditosTableBody tr[onclick]');
  const c = p.locator('#creditosTableBody .perfil-creado-chk').first();
  const b0 = await c.isChecked();
  await c.click({ force: true }); await p.click('#confirmBtnAccept');
  await p.waitForFunction(() => /No tienes permisos/i.test(document.getElementById('toastContainer').textContent));
  await p.waitForTimeout(300);
  assert.equal(await c.isChecked(), b0, 'el checkbox se revierte');
  ok(email + ': perfil creado denegado ("No tienes permisos para realizar esta acción.")');
  await shot(p, 'denegado-' + email.split('@')[0]);
  await view(p, 'solicitudes'); await p.waitForSelector('#solicitudesTableBodyPortal tr td');
  const before = (await db(p)).solicitudes.map(s => s.comentarios).join('|');
  await p.locator('#solicitudesTableBodyPortal button:has-text("Comentar")').first().click();
  await p.fill('#mComentarioTexto', 'intento no permitido'); await p.click('#btnGuardarComentarioPortal');
  await p.waitForFunction(() => /No tienes permisos/i.test(document.getElementById('toastContainer').textContent));
  assert.equal((await db(p)).solicitudes.map(s => s.comentarios).join('|'), before, 'la db no cambia'); ok(email + ': comentario denegado y sin cambios en la base');
  // el ejecutivo comercial ve las mismas solicitudes que todos (el original no filtra por ejecutivo)
  await p.close();
}

// ── 7. Sesión inválida en el "servidor" ───────────────────────────────────────
p = await loginOk('admin@example.com');
d = await db(p); d.sesiones = {};
await p.evaluate(x => localStorage.setItem('demo-db', JSON.stringify(x)), d);
await view(p, 'creditos');
await p.waitForFunction(() => /Sesión inválida o expirada/.test(document.getElementById('toastContainer').textContent));
ok('sesión expirada -> "Sesión inválida o expirada."');
await p.close();

// ── 8. Contrato directo de la API (casos límite) ──────────────────────────────
p = await open();
const api = (fn, ...a) => p.evaluate(([fn, a]) => new Promise((res, rej) => google.script.run.withSuccessHandler(res).withFailureHandler(e => rej(e.message))[fn](...a)), [fn, a]);
const lg = await api('apiLogin', 'admin@example.com', PW);
assert.ok(lg.ok && lg.token && lg.rol === 'ADMIN');
const tk = lg.token;
assert.deepEqual(await api('apiGetConfiguracion', tk, 'Usuarios'), { headers: [], rows: [] }); ok('apiGetConfiguracion niega hojas no permitidas');
const cfg = await api('apiGetConfiguracion', tk, 'Centros'); assert.equal(cfg.rows.length, 8);
assert.equal((await api('apiGetConfiguracion', 'x', 'Centros')).error, 'Sesión inválida o expirada.');
const est = await api('apiGetEstadisticasPortal', tk, false, '', ''); assert.ok(est.ok && est.total > 0 && est.empresas > 0); ok('apiGetEstadisticasPortal ' + JSON.stringify(est));
assert.ok((await api('apiGetCentrosPortal', tk)).length >= 8); assert.deepEqual(await api('apiGetCentrosPortal', 'x'), []);
assert.equal((await api('apiTogglePerfilCreado', { token: tk, rowIdx: 'abc', checked: true })).error, 'Índice de fila o código de centro inválido.');
assert.equal((await api('apiGuardarComentarioEjecutivo', { token: tk, uuid: '' })).error, 'UUID de solicitud requerido.');
const pag = JSON.parse((await api('apiConsultarCreditos', { token: tk, pagina: 2, limite: 5 })).payload_json);
assert.equal(pag.creditos.length, 5); assert.ok(pag.total > 5); ok('paginación (pág. 2 de 5 filas, total ' + pag.total + ')');
const gen = await api('apiEnviarCodigoRecuperacion', 'fantasma@example.com');
assert.ok(gen.ok && /Si el correo está registrado/.test(gen.message)); ok('recuperación no revela si el correo existe');
assert.equal((await api('apiEnviarCodigoRecuperacion', 'mal')).error, 'Correo no válido.');
await p.close();

// ── 9. Sin errores de consola ────────────────────────────────────────────────
console.log('problemas:', t.problems);
assert.deepEqual(t.problems, [], 'no debe haber errores de consola/página');
console.log('\nPORTAL E2E OK');
await t.close();
