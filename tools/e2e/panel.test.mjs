// E2E del Panel de Control (demo estática). Uso: node demo/build.mjs && node tools/e2e/panel.test.mjs
// Recorre login (3 roles, errores, recuperación de contraseña), todas las secciones y todas las acciones de escritura,
// exportaciones, IA simulada, copias de seguridad, persistencia tras recargar y ausencia de errores de consola.
import { launch } from './helper.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TMP = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');
fs.mkdirSync(TMP, { recursive: true });
const PW = 'Demo2025!';
const t = await launch({ port: Number(process.env.PANEL_TEST_PORT) || 4183 });
const URL = t.base + 'panel/index.html';
let step = 0;
const ok = m => console.log('  ok -', m);
const section = m => console.log('\n# ' + m);
const shot = async (p, name) => { await p.screenshot({ path: path.join(TMP, 'panel-' + String(++step).padStart(2, '0') + '-' + name + '.png') }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open() {
  const p = await t.newPage();
  await p.addInitScript(() => sessionStorage.setItem('demo-card-shown', '1'));
  await p.goto(URL);
  await p.waitForSelector('#loginEmail');
  return p;
}
const db = p => p.evaluate(() => JSON.parse(localStorage.getItem('demo-db')));
const idle = p => p.waitForFunction(() => typeof STATE !== 'undefined' && !STATE.loadingCount && !document.querySelector('.skeleton-visible'), null, { timeout: 15000 });
async function login(p, email, pw = PW) {
  await p.fill('#loginEmail', email);
  await p.fill('#loginPassword', pw);
  await p.click('#loginBtn');
}
async function loginAdmin(p) {
  await login(p, 'admin@example.com');
  await p.waitForSelector('#appLayout', { state: 'visible', timeout: 8000 });
  await p.waitForFunction(() => document.querySelectorAll('#kpiGrid .kpi-card').length === 4, null, { timeout: 8000 });
  await idle(p);
}
// 'centrosCreditos' existe en el router pero no tiene entrada en el menú lateral (vista inalcanzable en el original): se abre por showView.
const go = async (p, v) => { if (await p.locator(`.sb-item[data-view="${v}"]`).count()) await p.dispatchEvent(`.sb-item[data-view="${v}"]`, 'click'); else await p.evaluate(x => showView(x), v); await p.waitForTimeout(500); await idle(p); };
const toasts = p => p.locator('#toastContainer').innerText();
async function waitToast(p, re, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const txt = await toasts(p);
    if (re.test(txt)) { await p.evaluate(() => { const c = document.getElementById('toastContainer'); if (c) c.innerHTML = ''; }); return txt; }  // se "consume" el aviso para no confundirlo con el siguiente
    await sleep(150);
  }
  throw new Error('No apareció el aviso ' + re + '. Avisos: ' + (await toasts(p)));
}
const solBy = async (p, re) => (await db(p)).solicitudes.find(s => re.test(s.razon_social));
async function openSol(p, re) {
  const s = await solBy(p, re);
  assert.ok(s, 'solicitud ' + re);
  await p.evaluate(u => abrirExpediente(u), s.uuid);
  await p.waitForSelector('#modalTabs', { state: 'visible', timeout: 10000 });
  await p.waitForSelector('#modalSkeleton', { state: 'hidden' });
  return s;
}
const closeExp = async p => { await p.evaluate(() => cerrarModalExp()); await p.waitForTimeout(200); };
const confirmar = async p => { await p.click('#confirmBtnAccept'); };
/** Llama a una función api* directamente (para probar validaciones de sesión/rol). */
const api = (p, name, ...args) => p.evaluate(([n, a]) => new Promise(res => google.script.run.withSuccessHandler(r => res({ r })).withFailureHandler(e => res({ err: e.message }))[n](...a)), [name, args]);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

// La base compartida puede haber sido sembrada por OTRA app (formulario/portal): el panel debe inicializar sus tablas por su cuenta.
{
  const pf = await t.newPage();
  await pf.goto(t.base + 'formulario/index.html');
  await pf.evaluate(() => localStorage.clear());
  await pf.reload(); await pf.waitForTimeout(1500);
  const seeded = await pf.evaluate(() => { const d = JSON.parse(localStorage.getItem('demo-db') || 'null'); return d ? { panelInit: !!d._panelInit, backups: (d.backups || []).length } : null; });
  console.log('  (base sembrada por el formulario:', JSON.stringify(seeded) + ')');
  await pf.close();
}
let p = await open();

// ── 1. Login ─────────────────────────────────────────────────────────────────
section('Login');
await p.click('.odm-pill'); await p.waitForTimeout(400);
await shot(p, 'login-panel-demo');
await p.click('.odm-card .odm-x');
await shot(p, 'login');
await p.click('#loginBtn');
await p.waitForSelector('#loginError', { state: 'visible' });
assert.match(await p.textContent('#loginError'), /requeridos/); ok('campos vacíos');
await login(p, 'admin@example.com', 'incorrecta');
await p.waitForFunction(() => /Credenciales incorrectas/.test(document.getElementById('loginError').textContent));
ok('contraseña errónea');
await login(p, 'nadie@example.com', PW);
await p.waitForFunction(() => /Credenciales incorrectas/.test(document.getElementById('loginError').textContent)); ok('usuario inexistente');
await login(p, 'inactivo@example.com', PW);
await p.waitForFunction(() => /inactiva/.test(document.getElementById('loginError').textContent)); ok('usuario inactivo');
for (const who of ['operaciones@example.com', 'consultas@example.com']) {
  await login(p, who, PW);
  await p.waitForFunction(() => /restringido a administradores/.test(document.getElementById('loginError').textContent));
  assert.ok(!(await p.evaluate(() => sessionStorage.getItem('hd_panel_token'))), 'no debe guardar token de un no-admin');
  ok('rol ' + who.split('@')[0] + ': acceso denegado al panel');
}

// Acceso rápido DEMO
await p.click('.odm-pill'); await p.waitForTimeout(300);
await p.click('.odm-acc[data-email="operaciones@example.com"]');
await p.waitForFunction(() => /restringido/.test(document.getElementById('loginError').textContent)); ok('acceso rápido (rol sin acceso)');

// Recuperar contraseña con el código de la bandeja simulada
section('Recuperar contraseña');
await p.evaluate(() => toggleAuthMode('recover'));
await p.fill('#recoverEmail', 'nadie@example.com');
await p.click('#recoverBtn');
await p.waitForFunction(() => /No existe una cuenta/.test(document.getElementById('recoverError').textContent)); ok('correo no registrado');
await p.fill('#recoverEmail', 'consultas@example.com');
await p.click('#recoverBtn');
await p.waitForSelector('#recoverCodeField', { state: 'visible' });
await p.waitForSelector('.odm-toast .code', { timeout: 5000 }); ok('aviso de correo simulado con código');
const codigo = (await db(p)).outbox[0].code;
assert.match(codigo, /^\d{6}$/);
await p.fill('#recoverCodigo', '000000'); await p.fill('#recoverPassword', 'Nueva2025!'); await p.click('#recoverBtn');
await p.waitForFunction(() => /incorrecto/.test(document.getElementById('recoverError').textContent)); ok('código incorrecto');
await p.fill('#recoverCodigo', codigo); await p.click('#recoverBtn');
await waitToast(p, /restablecida correctamente/); ok('contraseña restablecida con el código de la bandeja');
const c2 = await api(p, 'apiLogin', 'consultas@example.com', 'Nueva2025!');
assert.equal(c2.r.ok, true); ok('login con la nueva contraseña');
await p.evaluate(() => { document.getElementById('loginError').style.display = 'none'; });

// Validaciones de sesión/rol directamente sobre el "backend"
section('Validaciones de sesión y rol');
assert.match((await api(p, 'apiGetSolicitudes', 'token-falso', {})).err, /Sesión inválida o expirada/);
assert.match((await api(p, 'apiActualizarEstado', { uuid: 'x', accion: 'APROBADA' })).err, /No autorizado o sesión expirada/);
assert.match((await api(p, 'apiActualizarEstado', { token: c2.r.token, uuid: 'x', accion: 'APROBADA' })).err, /No autorizado o sesión expirada/);
assert.match((await api(p, 'apiCrearUsuario', { token: c2.r.token, email: 'a@example.com', nombre: 'A', password: 'Demo2025!' })).r.error, /No tienes permisos para crear usuarios/);
assert.match((await api(p, 'apiListarBackups', { token: c2.r.token })).r.error, /Acceso denegado/);
assert.match((await api(p, 'apiEliminarDocumento', c2.r.token, 'x')).err, /No tienes permisos para eliminar documentos/);
assert.match((await api(p, 'apiGuardarConfiguracion', c2.r.token, 'Centros', {}, 'codigo', '')).err, /No tienes permisos para guardar configuraciones/);
assert.match((await api(p, 'apiEditarSolicitud', { token: c2.r.token, uuid: 'x', datos: {} })).r.error, /No tienes permisos para editar solicitudes/);
assert.equal((await api(p, 'apiGetSolicitudes', c2.r.token, { pagina: 1, limite: 2 })).r.data.length, 2);  // lectura permitida a cualquier sesión válida
assert.deepEqual((await api(p, 'apiGetUsuarios', c2.r.token)).r, { ok: false, error: 'No tienes permisos.' });
ok('lectura con cualquier sesión; escritura y administración solo ADMIN');
{ const dd = await db(p); assert.ok(dd.operacionesCentros.length === 8 && dd.backups.length === 3 && dd.auditoria.length > 10 && Object.keys(dd.analisisIA).length === 2 && dd.plantillaImportacion.length === 7); ok('tablas del panel inicializadas (operaciones, copias, auditoría, IA, plantilla) — ' + Math.round(JSON.stringify(dd).length / 1024) + ' KB en localStorage'); }
await api(p, 'apiLogout', c2.r.token);
assert.match((await api(p, 'apiGetSolicitudes', c2.r.token, {})).err, /Sesión inválida/); ok('logout invalida el token');

// Login correcto
section('Dashboard');
await p.evaluate(() => toggleAuthMode('login'));
await loginAdmin(p);
await p.waitForTimeout(1200);
assert.ok(await p.locator('#sbUserName').textContent().then(x => /Alicia/.test(x)));
await shot(p, 'dashboard');
ok('login admin y dashboard');
let d = await db(p);
const kpiNums = await p.$$eval('#kpiGrid .kpi-num', els => els.map(e => e.textContent));
await p.waitForTimeout(1200);
const kpiNums2 = await p.$$eval('#kpiGrid .kpi-num', els => els.map(e => Number(e.textContent)));
assert.ok(kpiNums2[0] > 0, 'KPI total > 0'); ok('KPIs: ' + kpiNums2.join(' / '));
// Periodo
for (const per of ['ALL', 'HOY', 'ESTA_SEMANA', 'ESTE_ANIO', 'ESTE_MES']) {
  await p.selectOption('#dbPeriodo', per); await p.waitForTimeout(600); await idle(p);
}
await p.selectOption('#dbPeriodo', 'ALL'); await p.waitForTimeout(600); await idle(p);
await p.waitForFunction(() => Number(document.querySelector('#kpiGrid .kpi-num').textContent) === STATE.kpis.total);
assert.equal(await p.evaluate(() => STATE.kpis.total), d.solicitudes.length); ok('periodo ALL = total de la base (' + d.solicitudes.length + ')');
await p.selectOption('#dbPeriodo', 'CUSTOM');
await p.fill('#dbFechaInicio', '2020-01-01'); await p.fill('#dbFechaFin', '2020-12-31');
await p.evaluate(() => aplicarFechasPersonalizadasDashboard()); await p.waitForTimeout(600); await idle(p);
await p.waitForFunction(() => STATE.kpis && STATE.kpis.total === 0); ok('periodo personalizado sin datos');
await p.selectOption('#dbPeriodo', 'ALL'); await p.waitForTimeout(600); await idle(p);
await p.click('button[onclick="cambiarTipoGraficaTendencia(1)"]'); await p.click('button[onclick="cambiarTipoGraficaEstados(1)"]'); ok('gráficas: cambio de tipo');
await shot(p, 'dashboard-todo');
// KPIs → solicitudes filtradas
await p.click('.kpi-card.kpi-pending'); await p.waitForTimeout(700); await idle(p);
const nPend = await p.$$eval('#solicitudesTableBody tr', r => r.length);
assert.equal(nPend, d.solicitudes.filter(s => ['PENDIENTE_REVISION'].includes(s.estado_codigo)).length); ok('KPI Pendientes → solicitudes filtradas (' + nPend + ')');

// Exportaciones del dashboard
section('Exportaciones del dashboard');
await go(p, 'dashboard');
await p.selectOption('#dbPeriodo', 'ALL'); await p.waitForTimeout(500); await idle(p);
async function descarga(fn, re) {
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), fn()]);
  const name = dl.suggestedFilename();
  assert.match(name, re);
  const file = path.join(TMP, name); await dl.saveAs(file); const buf = fs.readFileSync(file); fs.unlinkSync(file);
  return { name, buf };
}
let x = await descarga(async () => { await p.click('.btn-export-trigger'); await p.click('#dbExportDropdown a[onclick*="exportarDashboardExcel"]'); }, /^Cuadra_Reporte_Creditos_.*\.xlsx$/);
assert.equal(x.buf.slice(0, 2).toString(), 'PK'); assert.ok(x.buf.includes(Buffer.from('CENTROS DEMO - REPORTE DE CREDITOS'))); ok('dashboard → Excel real (' + x.name + ')');
x = await descarga(async () => { await p.click('.btn-export-trigger'); await p.click('#dbExportDropdown a[onclick*="exportarDashboardCSV"]'); }, /^Cuadra_Reporte_Creditos_.*\.csv$/);
assert.ok(x.buf.toString().includes('Razon Social,Codigo Solicitud') && x.buf.toString().split('\n').length > 20); ok('dashboard → CSV');
await p.click('.btn-export-trigger');
let [pop] = await Promise.all([t.ctx.waitForEvent('page'), p.click('#dbExportDropdown a[onclick*="\'slides\'"]')]);
await pop.waitForLoadState(); assert.match(await pop.textContent('body'), /Presentación simulada/); assert.match(await pop.textContent('body'), /REPORTE/); ok('dashboard → presentación (Slides simulado) con gráficos'); await pop.close();
await p.click('.btn-export-trigger');
[pop] = await Promise.all([t.ctx.waitForEvent('page'), p.click('#dbExportDropdown a[onclick*="\'pdf\'"]')]);
await pop.waitForLoadState().catch(() => {}); ok('dashboard → PDF (pestaña nueva: ' + pop.url().slice(0, 5) + ')'); await pop.close();

// ── Solicitudes ──────────────────────────────────────────────────────────────
section('Solicitudes: listado, filtros y búsqueda');
await go(p, 'solicitudes');
await p.evaluate(() => limpiarFiltrosSolicitudes()); await p.waitForTimeout(500); await idle(p);
await shot(p, 'solicitudes');
const total = async () => (await p.textContent('#resultCount')).trim();
assert.equal(await total(), d.solicitudes.length + ' registros'); ok('total ' + await total());
await p.fill('#searchInput', 'zafiro'); await p.evaluate(() => filtrarSolicitudes()); await p.waitForTimeout(500); await idle(p);
assert.equal(await total(), '1 registro'); ok('búsqueda por razón social');
await p.fill('#searchInput', '990100004'); await p.evaluate(() => filtrarSolicitudes()); await p.waitForTimeout(500); await idle(p);
assert.equal(await total(), '1 registro'); ok('búsqueda por NIT');
await p.fill('#searchInput', 'CDISLA'); await p.evaluate(() => filtrarSolicitudes()); await p.waitForTimeout(500); await idle(p);
assert.ok(parseInt(await total()) >= 3); ok('búsqueda por centro');
await p.evaluate(() => limpiarFiltrosSolicitudes()); await p.waitForTimeout(500); await idle(p);
for (const [est, fn] of [['PENDIENTE', s => s.estado_codigo === 'PENDIENTE_REVISION'], ['APROBADA', s => ['ACTIVA', 'APROBADA', 'POR_VENCER'].includes(s.estado_codigo) || s.estado_codigo.startsWith('BLOQUEADO')], ['VENCIDO', s => s.estado_codigo === 'VENCIDO']]) {
  await p.click(`#viewSolicitudes .chip[data-estado="${est}"]`); await p.waitForTimeout(500); await idle(p);
  const n = parseInt(await total());
  // los estados por vencer/vencido se recalculan por fecha (365 días desde la aprobación)
  assert.ok(n > 0, 'chip ' + est); ok('chip ' + est + ' → ' + n);
}
await p.click('#viewSolicitudes .chip[data-estado=""]');
await p.selectOption('#filtroSolicitudTipo', 'RENOVACION'); await p.waitForTimeout(400); await idle(p);
assert.equal(parseInt(await total()), d.solicitudes.filter(s => s.tipo_solicitud === 'RENOVACION').length); ok('filtro por tipo');
await p.selectOption('#filtroSolicitudTipo', '');
await p.selectOption('#filtroSolicitudFilial', 'SI'); await p.waitForTimeout(400); await idle(p);
assert.equal(parseInt(await total()), d.solicitudes.filter(s => s.es_filial === 'SI').length); ok('filtro filial');
await p.selectOption('#filtroSolicitudFilial', '');
await p.selectOption('#filtroSolicitudCentro', 'CDSUR'); await p.waitForTimeout(400); await idle(p);
assert.ok(parseInt(await total()) >= 5); ok('filtro por centro');
await p.selectOption('#filtroSolicitudCentro', '');
await p.selectOption('#filtroSolicitudPeriodo', 'ALL'); await p.waitForTimeout(300);
await p.selectOption('#filtroSolicitudPeriodo', 'HOY'); await p.waitForTimeout(500); await idle(p);
const nHoy = parseInt(await total()); ok('filtro periodo HOY → ' + nHoy);
await p.selectOption('#filtroSolicitudPeriodo', 'ESTE_ANO'); await p.waitForTimeout(500); await idle(p);
ok('filtro periodo ESTE_ANO → ' + await total());
await p.evaluate(() => limpiarFiltrosSolicitudes()); await p.waitForTimeout(500); await idle(p);
// Búsqueda global
await p.fill('#globalSearch', 'aurora'); await p.waitForTimeout(700); await idle(p);
assert.equal(await total(), '1 registro'); ok('búsqueda global'); await p.evaluate(() => limpiarBusquedaGlobal()); await p.waitForTimeout(600); await idle(p);
// Exportaciones
x = await descarga(async () => { await p.click('button[onclick="toggleExportSolicitudesDropdown(event)"]'); await p.click('a[onclick*="exportarSolicitudesExcel"]'); }, /^Cuadra_Solicitudes_.*\.xlsx$/);
assert.equal(x.buf.slice(0, 2).toString(), 'PK'); ok('solicitudes → Excel');
x = await descarga(async () => { await p.click('button[onclick="toggleExportSolicitudesDropdown(event)"]'); await p.click('a[onclick*="exportarSolicitudesCSV"]'); }, /^Cuadra_Export_Solicitudes_.*\.csv$/);
assert.ok(x.buf.toString().includes('20260') || x.buf.toString().includes('Codigo Solicitud')); assert.equal(x.buf.toString().trim().split('\n').length, d.solicitudes.length + 1); ok('solicitudes → CSV (' + d.solicitudes.length + ' filas)');
// Paginación
await p.evaluate(() => cambiarSizeSolicitudes(10)); await p.waitForTimeout(500); await idle(p);
assert.equal(await p.locator('#solicitudesTableBody tr').count(), 10);
await p.evaluate(() => irPaginaSolicitudes(2)); await p.waitForTimeout(500); await idle(p);
assert.equal(await p.locator('#solicitudesTableBody tr').count(), 10); ok('paginación');
await p.evaluate(() => cambiarSizeSolicitudes(100)); await p.waitForTimeout(500); await idle(p);

// ── Detalle de expediente ────────────────────────────────────────────────────
section('Expediente: detalle, documentos, IA');
await p.fill('#searchInput', 'Cerámicas'); await p.evaluate(() => filtrarSolicitudes()); await p.waitForTimeout(500); await idle(p);
await p.click('#solicitudesTableBody tr'); // clic real en la fila
await p.waitForSelector('#modalTabs', { state: 'visible' }); await p.waitForSelector('#modalSkeleton', { state: 'hidden' });
assert.match(await p.textContent('#modalExpSubtitulo'), /Cerámicas/);
assert.match(await p.textContent('#iRepLegal'), /Martín Ficticio Ospina/);
await shot(p, 'expediente-info');
ok('detalle de solicitud desde la tabla');
assert.equal(await p.locator('#btnAprobar').isDisabled(), true); ok('aprobar bloqueado hasta ejecutar IA');
await p.click('#tabDocumentos'); await p.waitForSelector('#docsList .doc-item', { state: 'visible' });
const nDocs0 = await p.locator('#docsList .doc-item').count();
assert.equal(nDocs0, 5 + 3); ok('documentos del expediente: ' + nDocs0);
await shot(p, 'expediente-docs');
// visor de PDF
await p.click('#docsList .doc-item a.doc-item-link');
await p.waitForSelector('#pnlDocViewer iframe'); assert.match(await p.textContent('#pnlDocViewer'), /Vista simulada de Google Drive/);
const src = await p.getAttribute('#pnlDocViewer iframe', 'src'); assert.match(src, /^blob:/); assert.equal(await p.evaluate(async u => (await (await fetch(u)).text()).slice(0, 5), src), '%PDF-');
await shot(p, 'visor-pdf');
await p.click('#pnlDocViewer .pnl-vw-x'); ok('visor de PDF de ejemplo');
// subir documento
await p.setInputFiles('#uploadDocFile', { name: 'Certificacion_bancaria.pdf', mimeType: 'application/pdf', buffer: PDF });
await waitToast(p, /Documento subido y registrado/);
await p.waitForFunction(n => document.querySelectorAll('#docsList .doc-item').length === n + 1, nDocs0);
ok('subida de documento adicional (Drive simulado)');
await p.setInputFiles('#uploadDocFile', { name: 'foto.png', mimeType: 'image/png', buffer: PNG });
await waitToast(p, /Solo se permiten archivos en formato PDF/); ok('solo PDF');
// eliminar
await p.locator('#docsList .doc-item', { hasText: 'Certificacion_bancaria.pdf' }).locator('button.doc-item-link').click();
await confirmar(p); await waitToast(p, /Documento eliminado con éxito/);
await p.waitForFunction(n => document.querySelectorAll('#docsList .doc-item').length === n, nDocs0); ok('eliminar documento');
// IA
await p.click('#tabIa');
await p.click('#btnAnalizarIA');
await p.waitForSelector('#iaResultado', { state: 'visible', timeout: 15000 });
assert.equal((await p.textContent('#iaNit')).trim(), '990100019-9');
assert.match(await p.textContent('#iaObservaciones'), /ANÁLISIS SIMULADO/i);
assert.match(await p.textContent('#iaObservaciones'), /Cámara de Comercio/);
await shot(p, 'ia-resultado');
ok('IA simulada (informe con aviso visible)');
assert.equal(await p.locator('#iaSavedBadge').isVisible(), true); assert.equal(await p.locator('#btnAprobar').isDisabled(), false); ok('IA guardada automáticamente → aprobar habilitado');
assert.ok((await db(p)).analisisIA[(await solBy(p, /Cerámicas/)).uuid]);
await p.evaluate(() => { const b = document.querySelector('#iaObservaciones .btn-ver-doc'); b && b.scrollIntoView(); });
const verLink = p.locator('#iaObservaciones a.btn-ver-doc').first();
if (await verLink.count()) { await verLink.click(); await p.waitForSelector('#pnlDocViewer iframe'); await p.click('#pnlDocViewer .pnl-vw-x'); ok('botón "Ver" de la IA abre el visor'); }
await closeExp(p);

// ── Acciones de estado ───────────────────────────────────────────────────────
section('IA guardada de ejemplo');
{
  await openSol(p, /Constructora Ejemplo/); await p.click('#tabIa');
  assert.equal(await p.locator('#iaResultado').isVisible(), true); assert.equal(await p.locator('#iaSavedBadge').isVisible(), true);
  assert.equal((await p.textContent('#iaNit')).trim(), '990100001-1'); ok('expediente aprobado muestra su análisis IA guardado');
  await closeExp(p);
}
section('Acciones: aprobar con distribución de cupos');
d = await db(p);
await p.evaluate(() => { document.getElementById('searchInput').value = ''; limpiarFiltrosSolicitudes(); }); await p.waitForTimeout(500); await idle(p);
const zaf = await openSol(p, /Zafiro/);
await p.click('#tabIa'); await p.click('#btnAnalizarIA');
await p.waitForSelector('#iaResultado', { state: 'visible', timeout: 15000 });
assert.equal(await p.locator('#iaAlertaFirma').isVisible(), true); ok('IA: alerta de segunda firma (monto alto)');
await p.click('#btnAprobar');
await p.waitForSelector('#confirmCentrosDistribucion .confirm-cupo-input', { timeout: 8000 });
const inputs = p.locator('#confirmCentrosDistribucion .confirm-cupo-input');
assert.equal(await inputs.count(), 3);
assert.equal(await p.inputValue('#confirmCorreoRep'), zaf.correo_rep);
assert.match(await p.inputValue('#confirmCorreoEjecutivo'), /@example\.com/);
await inputs.nth(0).fill('10000000'); await inputs.nth(1).fill('12000000'); await inputs.nth(2).fill('8000000');
await p.waitForTimeout(200);
assert.equal((await p.inputValue('#confirmMontoAprobado')).replace(/\D/g, ''), '30000000'); ok('distribución de cupos suma 30.000.000');
await shot(p, 'aprobar-modal');
await p.fill('#confirmComentario', 'Aprobado tras revisión documental.');
await confirmar(p);
await waitToast(p, /Solicitud aprobada correctamente/, 90000);
ok('aprobación (PDF de la carta generado en el cliente)');
d = await db(p);
const zaf2 = d.solicitudes.find(s => s.uuid === zaf.uuid);
assert.equal(zaf2.estado_codigo, 'APROBADA'); assert.deepEqual(JSON.parse(zaf2.cupos_distribuidos_json), { CDNORTE: 10000000, CDCENTRO: 12000000, CDSUR: 8000000 });
assert.ok(d.documentos.some(x => x.uuid_solicitud === zaf.uuid && x.tipo_documento === 'CARTA_APROBACION'));
const mails = d.outbox.filter(m => /Zafiro/.test(m.subject));
assert.ok(mails.length >= 4, 'correo al representante + 3 centros'); assert.ok(mails.some(m => m.to === zaf.correo_rep && /Carta de aprobación/.test(m.subject)));
assert.ok(d.auditoria.some(a => a.accion === 'APROBADA' && a.codigo_solicitud === zaf.codigo_solicitud && a.actor === 'admin@example.com'));
assert.ok(d.historialEstados.some(h => h.uuid === zaf.uuid && h.estado_nuevo === 'APROBADA'));
ok('estado, cupos, carta, correos simulados (' + mails.length + '), auditoría e historial');
await p.waitForSelector('#modalExpediente.hidden', { state: 'attached' });

section('Acciones: aprobar sin enviar carta y escapado de la carta');
{
  const uni = await openSol(p, /Urbanizadora Ejemplar/);
  await p.click('#tabIa'); await p.click('#btnAnalizarIA'); await p.waitForSelector('#iaResultado', { state: 'visible', timeout: 15000 });
  await p.click('#btnAprobar'); await p.waitForSelector('#confirmCentrosDistribucion .confirm-cupo-input', { timeout: 8000 });
  await p.evaluate(() => document.getElementById('confirmEnviarCarta').click());
  const nMails = (await db(p)).outbox.length;
  await confirmar(p);
  await waitToast(p, /Solicitud aprobada correctamente/, 20000);
  const dd = await db(p);
  assert.equal(dd.solicitudes.find(x => x.uuid === uni.uuid).estado_codigo, 'APROBADA'); assert.equal(dd.outbox.length, nMails);
  ok('aprobación sin carta: cambia el estado y no envía correos');
  const tok = await p.evaluate(() => sessionStorage.getItem('hd_panel_token'));
  await api(p, 'apiEditarSolicitud', { token: tok, uuid: uni.uuid, datos: { razon_social: '<img src=x onerror=alert(1)>Evil S.A.' } });
  const carta = (await api(p, 'apiGetHtmlCarta', { token: tok, uuid: uni.uuid, cuposDistribuidos: { CDNORTE: 5000000 } })).r;
  assert.equal(carta.ok, true); assert.ok(!carta.html.includes('<img src=x') && carta.html.includes('&lt;img src=x')); assert.match(carta.pdfName, /^Carta_Aprobacion_Credito_/);
  ok('la carta HTML escapa los datos del cliente');
  assert.equal((await api(p, 'apiGetHtmlCarta', { token: 'x', uuid: uni.uuid })).r.ok, false);
  await api(p, 'apiEditarSolicitud', { token: tok, uuid: uni.uuid, datos: { razon_social: uni.razon_social } });
}

section('Acciones: devolver, rechazar, editar, eliminar');
// Devolver
const clin = await openSol(p, /Hidr[aá]ulicos Vital/);
await p.click('#btnDevolver'); await p.fill('#confirmComentario', 'Falta la cámara de comercio vigente.'); await confirmar(p);
await waitToast(p, /devuelta para subsanación correctamente/);
d = await db(p); assert.equal(d.solicitudes.find(s => s.uuid === clin.uuid).estado_codigo, 'DEVUELTA');
assert.ok(d.outbox.some(m => /devuelta/i.test(m.subject) && m.to === clin.correo_rep && /subsanar/.test(m.html))); ok('devolver: correo de subsanación simulado');
// Rechazar
const puente = await openSol(p, /Puente Azul/);
await p.click('#btnRechazar'); await p.fill('#confirmComentario', 'No cumple indicadores.'); await confirmar(p);
await waitToast(p, /rechazada correctamente/);
d = await db(p); assert.equal(d.solicitudes.find(s => s.uuid === puente.uuid).estado_codigo, 'RECHAZADA'); ok('rechazar');
// Editar
const petro = await openSol(p, /Asfaltos Litoral/);
await p.click('#btnEditarSolicitud'); await p.waitForSelector('#modalEditarSolicitud:not(.hidden)');
await p.fill('#edit_ciudad', 'Barranquilla'); await p.fill('#edit_comentarios', 'Editado desde la prueba E2E');
await p.click('button[onclick="guardarEdicionSolicitud()"]'); await confirmar(p);
await waitToast(p, /Solicitud actualizada con éxito/);
d = await db(p); const pe = d.solicitudes.find(s => s.uuid === petro.uuid);
assert.equal(pe.ciudad, 'Barranquilla'); assert.equal(pe.comentarios, 'Editado desde la prueba E2E');
assert.ok(d.auditoria.some(a => a.accion === 'EDITAR_SOLICITUD')); ok('editar solicitud');
await p.waitForSelector('#modalTabs', { state: 'visible' });
await p.click('#btnEditarSolicitud'); await p.fill('#edit_razon_social', ''); await p.click('button[onclick="guardarEdicionSolicitud()"]');
await waitToast(p, /Razón social es requerida/); ok('validación de edición'); await p.evaluate(() => cerrarEditarSolicitud());
await closeExp(p);
// Eliminar
const coop = await openSol(p, /Vivienda Sol/);
await p.click('#btnEliminarSolicitud'); await confirmar(p);
await waitToast(p, /Solicitud eliminada con éxito/);
d = await db(p); assert.ok(!d.solicitudes.some(s => s.uuid === coop.uuid)); assert.ok(d.auditoria.some(a => a.accion === 'ELIMINAR_SOLICITUD')); ok('eliminar solicitud');
await shot(p, 'solicitudes-tras-acciones');

// ── Notificaciones ───────────────────────────────────────────────────────────
section('Notificaciones');
await go(p, 'dashboard');
await p.click('#btnNotif'); await p.waitForSelector('#notifList li.notif-item');
const nUnread = await p.locator('#notifList li.unread').count();
assert.ok(nUnread > 0); ok('bandeja con ' + nUnread + ' sin leer');
await shot(p, 'notificaciones-dropdown');
await p.locator('#notifList li.unread').first().click();
await p.waitForSelector('#modalTabs', { state: 'visible' }); await closeExp(p);
d = await db(p); assert.equal((d.notificacionesLeidas['admin@example.com'] || []).length, 1); ok('abrir una notificación la marca como leída');
await p.evaluate(() => marcarTodasLeidas()); await p.waitForTimeout(700);
d = await db(p); assert.ok(d.notificacionesLeidas['admin@example.com'].length >= 10); ok('marcar todas como leídas');
await p.evaluate(() => toggleNotifPanel && document.getElementById('notifDropdown').classList.remove('show'));
await go(p, 'notificaciones'); await p.waitForSelector('#notifListSeccion li, #notifListSeccion .notif-item, #notifListSeccion > *', { timeout: 8000 });
await shot(p, 'notificaciones-seccion');
const unreadBtn = p.locator('#notifListSeccion button[onclick*="Unread"], #notifListSeccion [title*="no le"]').first();
const nSec = await p.locator('#notifListSeccion > *').count(); assert.ok(nSec > 5); ok('sección Notificaciones (' + nSec + ' elementos)');
const noLeer = await p.evaluate(() => { const b = Array.from(document.querySelectorAll('#notifListSeccion button')).find(x => /no le[ií]d/i.test(x.title + x.textContent + (x.getAttribute('onclick') || ''))); if (b) { b.click(); return true; } return false; });
if (noLeer) { await p.waitForTimeout(700); d = await db(p); ok('marcar una como no leída'); }

// ── Créditos ─────────────────────────────────────────────────────────────────
section('Créditos');
await go(p, 'creditos');
await p.waitForSelector('#crudTableBody tr[onclick]');
await shot(p, 'creditos');
const cTotal = () => p.textContent('#crudCountBadge').then(x => parseInt(x.replace(/\D/g, '')));
const waitCount = n => p.waitForFunction(x => parseInt((document.getElementById('crudCountBadge').textContent || '').replace(/[^0-9]/g, '')) === x, n, { timeout: 8000 });
const nCred0 = await cTotal(); assert.ok(nCred0 >= 15); ok('créditos virtuales por centro: ' + nCred0);
await p.fill('#crudSearch', 'constructora ejemplo'); await p.evaluate(() => cargarCrud()); await p.waitForTimeout(500); await idle(p);
assert.equal(await cTotal(), 2); ok('búsqueda de créditos');
await p.evaluate(() => limpiarFiltrosCrud()); await p.waitForTimeout(500); await idle(p);
await p.selectOption('#crudFilterEstado', 'Vencido'); await p.waitForTimeout(500); await idle(p);
const nVenc = await cTotal(); assert.ok(nVenc >= 2); ok('filtro estado Vencido → ' + nVenc);
await p.selectOption('#crudFilterEstado', 'Por Vencer'); await p.waitForTimeout(500); await idle(p);
assert.ok(await cTotal() >= 3); ok('filtro estado Por Vencer');
await p.selectOption('#crudFilterEstado', 'Bloqueado Corporativo'); await p.waitForTimeout(500); await idle(p);
assert.ok(await cTotal() >= 1); ok('filtro Bloqueado Corporativo');
await p.evaluate(() => limpiarFiltrosCrud()); await p.waitForTimeout(500); await idle(p);
await p.selectOption('#crudFilterCentro', 'CDCOSTA'); await p.waitForTimeout(500); await idle(p);
assert.ok(await cTotal() >= 3); ok('filtro por centro');
await p.evaluate(() => limpiarFiltrosCrud()); await p.waitForTimeout(500); await idle(p);
await p.selectOption('#crudFilterVig', 'No Vigente'); await p.waitForTimeout(500); await idle(p); ok('filtro vigencia → ' + await cTotal());
await p.evaluate(() => limpiarFiltrosCrud()); await p.waitForTimeout(500); await idle(p);
await p.selectOption('#crudFilterPerfil', 'SI'); await p.waitForTimeout(500); await idle(p);
const nPerfSi = await cTotal(); assert.ok(nPerfSi > 0 && nPerfSi < nCred0); ok('filtro perfil creado → ' + nPerfSi);
await p.evaluate(() => limpiarFiltrosCrud()); await p.waitForTimeout(500); await idle(p);
// detalle
await p.click('#crudTableBody tr[onclick] td.col-empresa');
await p.waitForSelector('#mCreditoRazonSocial', { state: 'visible' }); assert.ok((await p.textContent('#mCreditoId')).length > 5); ok('detalle de crédito');
await p.evaluate(() => cerrarModalCreditoDetalle());
// exportaciones
x = await descarga(async () => { await p.click('button[onclick="toggleExportCreditosDropdown(event)"]'); await p.click('a[onclick*="exportarCreditosExcel"]'); }, /^Cuadra_Creditos_.*\.xlsx$/);
assert.equal(x.buf.slice(0, 2).toString(), 'PK'); ok('créditos → Excel');
x = await descarga(async () => { await p.click('button[onclick="toggleExportCreditosDropdown(event)"]'); await p.click('a[onclick*="exportarCSVCrud"]'); }, /^Cuadra_Export_Base_Creditos_.*\.csv$/);
assert.equal(x.buf.toString().trim().split('\n').length, nCred0 + 1); ok('créditos → CSV');
// marcar perfil creado
const chk = p.locator('.perfil-creado-chk:not(:checked)').first();
const rowIdx = await chk.getAttribute('data-rowidx');
await chk.click(); await confirmar(p); await waitToast(p, /perfil creado actualizado/);
d = await db(p); assert.ok(JSON.parse(d.solicitudes.find(s => s.uuid === rowIdx.split('_')[0]).perfil_creado)[rowIdx.split('_')[1]]);
assert.ok(d.auditoria.some(a => a.accion === 'TOGGLE_PERFIL_CREADO')); ok('marcar perfil creado');
// editar crédito
const cr = p.locator('#crudTableBody tr[onclick]').first();
const idx = (await cr.locator('input.perfil-creado-chk').getAttribute('data-rowidx'));
await cr.locator('.btn-edit').click(); await p.waitForSelector('#modalCrud:not(.hidden)');
await p.waitForTimeout(400);
await p.fill('#crud_monto', '7777000'); await p.fill('#crud_novedades', 'Editado en E2E'); await p.selectOption('#crud_estado_credito', 'Bloqueado Gerencia');
await p.fill('#crud_razon_bloqueo', 'Prueba E2E');
await p.click('#crudSaveBtn'); await waitToast(p, /Crédito actualizado correctamente/);
d = await db(p); const so = d.solicitudes.find(s => s.uuid === idx.split('_')[0]);
assert.equal(JSON.parse(so.cupos_distribuidos_json)[idx.split('_')[1]], 7777000); assert.equal(so.estado_codigo, 'BLOQUEADO_GERENCIA'); ok('editar crédito (monto, estado, novedades)');
// crear crédito nuevo
await p.evaluate(() => abrirModalCrud(null)); await p.waitForSelector('#modalCrud:not(.hidden)'); await p.waitForTimeout(500);
await p.click('#crudSaveBtn'); await waitToast(p, /razón social es obligatoria/); ok('validación de crédito nuevo');
await p.fill('#crud_razon_social', 'Empresa Nueva E2E S.A.S.'); await p.fill('#crud_nit', '990100901');
await p.selectOption('#crud_centro', 'CDANDES'); await p.fill('#crud_monto', '12000000'); await p.fill('#crud_novedades', 'Crédito manual E2E');
await p.click('#crudSaveBtn'); await waitToast(p, /Crédito creado correctamente/);
d = await db(p); const nueva = d.solicitudes.find(s => s.razon_social === 'Empresa Nueva E2E S.A.S.');
assert.ok(nueva); assert.equal(nueva.identificacion, '990100901'); assert.equal(nueva.estado_codigo, 'APROBADA');
await waitCount(nCred0 + 1); ok('crear crédito nuevo (nueva solicitud aprobada)');
// crear crédito mismo NIT, otro centro → fusiona
await p.evaluate(() => abrirModalCrud(null)); await p.waitForSelector('#modalCrud:not(.hidden)'); await p.waitForTimeout(500);
await p.fill('#crud_razon_social', 'Empresa Nueva E2E S.A.S.'); await p.fill('#crud_nit', '990100901');
await p.selectOption('#crud_centro', 'CDCOSTA'); await p.fill('#crud_monto', '5000000');
await p.click('#crudSaveBtn'); await waitToast(p, /Crédito creado correctamente/);
d = await db(p); assert.equal(d.solicitudes.filter(s => s.identificacion === '990100901').length, 1); assert.deepEqual(JSON.parse(d.solicitudes.find(s => s.identificacion === '990100901').cupos_distribuidos_json), { CDANDES: 12000000, CDCOSTA: 5000000 });
await waitCount(nCred0 + 2); ok('crédito con NIT existente se fusiona en la misma solicitud');
// eliminar crédito
await p.fill('#crudSearch', 'Empresa Nueva E2E'); await p.evaluate(() => cargarCrud()); await p.waitForTimeout(500); await idle(p);
await p.locator('#crudTableBody tr[onclick]').first().locator('.btn-del').click(); await confirmar(p); await waitToast(p, /Crédito eliminado correctamente/);
d = await db(p); assert.deepEqual(Object.keys(JSON.parse(d.solicitudes.find(s => s.identificacion === '990100901').cupos_distribuidos_json)).length, 1); ok('eliminar crédito');
await p.evaluate(() => limpiarFiltrosCrud()); await p.waitForTimeout(500); await idle(p);
// importación masiva
await p.click('button[onclick="abrirConfirmacionImportacion()"]');
await p.waitForFunction(() => /registros pendientes/.test(document.getElementById('confirmMsg').textContent));
assert.match(await p.textContent('#confirmMsg'), /6/); ok('importación: 6 filas pendientes');
await shot(p, 'importar-confirm');
await confirmar(p);
await waitToast(p, /Proceso completado/, 20000);
d = await db(p);
const tpl = d.plantillaImportacion; assert.equal(tpl.filter(r => r.estadoImportacion === 'Procesado').length, 6); assert.equal(tpl.filter(r => r.estadoImportacion === 'Error').length, 1);
assert.match(tpl.find(r => r.estadoImportacion === 'Error').detalleError, /Centro no identificado/);
const ga = d.solicitudes.find(s => s.razon_social.startsWith('Grupo Andino')); assert.deepEqual(JSON.parse(ga.cupos_distribuidos_json), { CDNORTE: 8000000, CDCENTRO: 6000000 });
assert.equal(d.solicitudes.find(s => s.razon_social.startsWith('Comercial R')).estado_codigo, 'BLOQUEADO_CORPORATIVO');
ok('importación masiva: unifica por NIT, actualiza duplicado, marca error de centro');
await p.click('button[onclick="abrirConfirmacionImportacion()"]');
await p.waitForFunction(() => /No se encontraron registros pendientes/.test(document.getElementById('confirmMsg').textContent)); await p.click('#confirmBtnAccept'); ok('segunda importación: sin pendientes');
await shot(p, 'creditos-tras-importar');

// ── Centros y créditos ───────────────────────────────────────────────────────
section('Centros y créditos');
await go(p, 'centrosCreditos');
await p.waitForSelector('#centrosCreditosTableBody tr td');
assert.equal(await p.locator('#centrosCreditosTableBody tr').count(), 8);
await shot(p, 'centros-creditos');
await p.fill('#centrosSearchInput', 'costa'); await p.evaluate(() => filtrarCentrosCreditos()); await p.waitForTimeout(300);
assert.equal(await p.locator('#centrosCreditosTableBody tr').count(), 1); ok('centros: listado y búsqueda');
await p.locator('#centrosCreditosTableBody tr td').nth(1).click(); await p.waitForTimeout(400);
await shot(p, 'centro-detalle'); await p.evaluate(() => cerrarModalCentro()); ok('detalle de centro');
await p.fill('#centrosSearchInput', ''); await p.evaluate(() => filtrarCentrosCreditos());

// ── Auditoría ────────────────────────────────────────────────────────────────
section('Auditoría');
await go(p, 'auditoria');
await p.waitForSelector('#auditoriaTableBody tr td');
const nAud = await p.locator('#auditoriaTableBody tr').count(); assert.ok(nAud >= 25);
const audText = await p.textContent('#auditoriaTableBody');
for (const w of ['Solicitud aprobada', 'Edición de solicitud', 'Eliminación de solicitud', 'Importación masiva', 'Registro manual de crédito', 'Procesando con IA', 'Documento adicional subido', 'Cambio estado de perfil contable']) assert.ok(audText.includes(w), 'auditoría: ' + w);
await shot(p, 'auditoria');
ok('auditoría con ' + nAud + ' eventos, incluidos los de esta prueba');
await p.locator('#auditoriaTableBody .btn-sol-direct').first().click();
await p.waitForSelector('#modalTabs', { state: 'visible' }); await closeExp(p); ok('abrir expediente desde auditoría');

// ── Configuración ────────────────────────────────────────────────────────────
section('Configuración');
await go(p, 'configuracion');
const cfgTabs = await p.$$eval('.catalog-tab', els => els.map(e => e.dataset.value));
assert.deepEqual(cfgTabs.sort(), ['Centros', 'Comerciales', 'Monedas', 'Operaciones_Centros', 'TiposDocumento', 'TiposSolicitud']);
d = await db(p);
const expected = { Comerciales: d.comerciales.length, Centros: d.centros.length, Operaciones_Centros: d.operacionesCentros.length, Monedas: d.monedas.length, TiposDocumento: d.tiposDocumento.length, TiposSolicitud: d.tiposSolicitud.length };
for (const tab of cfgTabs) {
  await p.click(`.catalog-tab[data-value="${tab}"]`); await p.waitForTimeout(500); await idle(p);
  await p.waitForFunction(n => document.querySelectorAll('#configTableBody tr').length === n, expected[tab]);
}
ok('6 catálogos cargados'); await shot(p, 'configuracion');
await p.click('.catalog-tab[data-value="Centros"]'); await p.waitForTimeout(500); await idle(p);
await p.evaluate(() => abrirConfigFormModal()); await p.waitForSelector('#modalConfiguracion:not(.hidden)');
await p.fill('#cfgInput_codigo', 'CDNUEVO'); await p.fill('#cfgInput_nombre', 'Centro Demo Nuevo'); await p.fill('#cfgInput_nit', '900.000.009-9'); await p.fill('#cfgInput_razon', 'CENTRO DEMO NUEVO S.A.S'); await p.fill('#cfgInput_monto_minimo', '6000000');
await p.evaluate(() => guardarRegistroConfig()); await waitToast(p, /Registro guardado correctamente/);
d = await db(p); assert.equal(d.centros.find(h => h.codigo === 'CDNUEVO').monto_minimo, 6000000); ok('crear centro (configuración de centros)');
await p.evaluate(() => abrirConfigFormModal()); await p.waitForSelector('#modalConfiguracion:not(.hidden)');
for (const [k, v] of [['codigo', 'CDNUEVO'], ['nombre', 'Dup'], ['nit', '1'], ['razon', 'Dup'], ['monto_minimo', '1']]) await p.fill('#cfgInput_' + k, v);
await p.evaluate(() => guardarRegistroConfig()); await p.waitForSelector('#processLoaderError, .proc-error, [class*="proc"]', { timeout: 5000 }).catch(() => {});
await p.waitForTimeout(800);
assert.equal((await db(p)).centros.filter(h => h.codigo === 'CDNUEVO').length, 1); ok('clave duplicada rechazada');
await p.evaluate(() => { if (typeof PROCESS_LOADER !== 'undefined') PROCESS_LOADER.hide(); cerrarConfigFormModal(); });
const editIdx = await p.evaluate(() => CONFIG_STATE.rows.findIndex(r => r[0] === 'CDNUEVO'));
await p.evaluate(i => abrirConfigFormModal(i), editIdx); await p.waitForSelector('#modalConfiguracion:not(.hidden)');
await p.fill('#cfgInput_nombre', 'Centro Demo Nuevo (editado)'); await p.evaluate(() => guardarRegistroConfig()); await waitToast(p, /Registro guardado/);
assert.equal((await db(p)).centros.find(h => h.codigo === 'CDNUEVO').nombre, 'Centro Demo Nuevo (editado)'); ok('editar centro');
await p.evaluate(() => eliminarRegistroConfig('CDNUEVO')); await confirmar(p); await waitToast(p, /Registro eliminado con éxito/);
assert.ok(!(await db(p)).centros.some(h => h.codigo === 'CDNUEVO')); ok('eliminar centro');
// Comerciales alimentan ejecutivos
await p.click('.catalog-tab[data-value="Comerciales"]'); await p.waitForTimeout(500); await idle(p);
await p.evaluate(() => abrirConfigFormModal()); await p.waitForSelector('#modalConfiguracion:not(.hidden)');
await p.fill('#cfgInput_nombre', 'Nora'); await p.fill('#cfgInput_apellido', 'Ventas'); await p.fill('#cfgInput_correo', 'nora@example.com');
await p.evaluate(() => guardarRegistroConfig()); await waitToast(p, /Registro guardado/);
d = await db(p); assert.ok(d.comerciales.some(c => c.correo === 'nora@example.com') && d.ejecutivos.includes('nora@example.com')); ok('catálogo de comerciales sincroniza ejecutivos');

// ── Usuarios ─────────────────────────────────────────────────────────────────
section('Usuarios');
await go(p, 'usuarios'); await p.waitForSelector('#usuariosTableBody tr td');
d = await db(p);
assert.equal(await p.locator('#usuariosTableBody tr').count(), d.usuarios.length);
await shot(p, 'usuarios');
await p.evaluate(() => abrirCrearUsuarioModal()); await p.waitForSelector('#modalCrearUsuario:not(.hidden)');
await p.fill('#mUserNombre', 'Nuevo Admin E2E'); await p.fill('#mUserEmail', 'admin@example.com'); await p.fill('#mUserPassword', 'Clave12345!'); await p.selectOption('#mUserRol', 'ADMIN');
await p.evaluate(() => guardarNuevoUsuario()); await waitToast(p, /Ya existe un usuario con ese correo/); ok('crear usuario: correo duplicado rechazado');
await p.fill('#mUserEmail', 'nuevo.e2e@example.com');
await p.setInputFiles('#mUserFirmaInput', { name: 'firma.png', mimeType: 'image/png', buffer: PNG });
await p.waitForTimeout(300);
await p.evaluate(() => guardarNuevoUsuario()); await waitToast(p, /Usuario registrado con éxito/);
d = await db(p); const nu = d.usuarios.find(u => u.email === 'nuevo.e2e@example.com'); assert.ok(nu && nu.rol === 'ADMIN' && nu.firma_data.startsWith('data:image/png')); ok('crear usuario con firma');
await p.fill('#usuariosSearchInput', 'nuevo.e2e'); await p.evaluate(() => filtrarUsuariosFrontend()); await p.waitForTimeout(1500);
assert.equal(await p.locator('#usuariosTableBody tr').count(), 1); ok('búsqueda de usuarios'); await p.fill('#usuariosSearchInput', ''); await p.evaluate(() => filtrarUsuariosFrontend());
// editar
await p.evaluate(() => abrirEditarUsuarioModal('nuevo.e2e@example.com')); await p.waitForSelector('#modalEditarUsuario:not(.hidden), #mEditUserNombre');
await p.fill('#mEditUserNombre', 'Nuevo Admin Editado'); await p.fill('#mEditUserPassword', 'Otra12345!'); await p.selectOption('#mEditUserRol', 'CONSULTAS');
await p.evaluate(() => guardarEdicionUsuario()); await waitToast(p, /Usuario actualizado con éxito/);
d = await db(p); const ne = d.usuarios.find(u => u.email === 'nuevo.e2e@example.com'); assert.equal(ne.nombre, 'Nuevo Admin Editado'); assert.equal(ne.rol, 'CONSULTAS'); assert.equal(ne.password, 'Otra12345!'); ok('editar usuario (nombre, rol, contraseña)');
await p.evaluate(() => abrirEditarUsuarioModal('nuevo.e2e@example.com'));
await p.fill('#mEditUserPassword', 'corta'); await p.evaluate(() => guardarEdicionUsuario()); await waitToast(p, /al menos 8 caracteres/); ok('contraseña corta rechazada');
await p.evaluate(() => cerrarEditarUsuarioModal());
// activar / desactivar y rol
const fila = p.locator('#usuariosTableBody tr', { hasText: 'nuevo.e2e@example.com' });
await fila.locator('input[type=checkbox]').evaluate(e => e.click()); await waitToast(p, /desactivado con éxito/);
assert.equal((await db(p)).usuarios.find(u => u.email === 'nuevo.e2e@example.com').activo, 'FALSE');
assert.equal((await api(p, 'apiLogin', 'nuevo.e2e@example.com', 'Otra12345!')).r.ok, false); ok('desactivar usuario → no puede iniciar sesión');
await fila.locator('input[type=checkbox]').evaluate(e => e.click()); await waitToast(p, /activado con éxito/);
await fila.locator('select').selectOption('ADMIN'); await waitToast(p, /Rol del usuario actualizado a ADMIN/);
assert.equal((await api(p, 'apiLogin', 'nuevo.e2e@example.com', 'Otra12345!')).r.rol, 'ADMIN'); ok('reactivar y cambiar rol');
// auto-eliminación
assert.match((await api(p, 'apiEliminarUsuario', { token: await p.evaluate(() => sessionStorage.getItem('hd_panel_token')), email: 'admin@example.com' })).r.error, /No puedes eliminar tu propia cuenta/); ok('no se puede eliminar la propia cuenta');
await p.evaluate(() => confirmarEliminarUsuario('nuevo.e2e@example.com', 'Nuevo')); await confirmar(p); await waitToast(p, /Usuario eliminado correctamente/);
assert.ok(!(await db(p)).usuarios.some(u => u.email === 'nuevo.e2e@example.com')); ok('eliminar usuario');

// ── Copias de seguridad ──────────────────────────────────────────────────────
section('Copias de seguridad');
await go(p, 'backups'); await p.waitForSelector('#backupsTableBody tr td');
assert.equal(await p.locator('#backupsTableBody tr').count(), 3); await shot(p, 'backups');
await p.evaluate(() => crearBackupManual()); await waitToast(p, /Copia de seguridad manual generada con éxito/);
await p.waitForFunction(() => document.querySelectorAll('#backupsTableBody tr').length === 4); ok('backup manual (4 copias)');
const totalAntes = (await db(p)).solicitudes.length;
// Alteramos datos y restauramos la copia manual recién creada
const manualId = (await db(p)).backups.find(b => /_Manual$/.test(b.name) && b.data !== 'seed').id;
await api(p, 'apiEliminarSolicitud', { token: await p.evaluate(() => sessionStorage.getItem('hd_panel_token')), uuid: (await db(p)).solicitudes[0].uuid });
assert.equal((await db(p)).solicitudes.length, totalAntes - 1);
await p.evaluate(id => abrirFlujoRestauracion(id, 'copia'), manualId);
await p.click('button[onclick="confirmarAdvertenciaBackup()"]');
await p.waitForSelector('#modalBackupConfirmar:not(.hidden)');
await p.waitForSelector('.odm-toast .code', { timeout: 5000 });
const cod = (await db(p)).codigos['RESTORE_CODE_admin@example.com'].codigo; assert.match(cod, /^\d{6}$/); ok('código de restauración enviado a la bandeja simulada');
await p.fill('#inputConfirmarBackupText', '000000'); await p.click('#btnRestaurarBackupDefinitivo');
await waitToast(p, /incorrecto o ha expirado/); ok('código de restauración incorrecto');
await p.evaluate(id => abrirFlujoRestauracion(id, 'copia'), manualId);
await p.click('button[onclick="confirmarAdvertenciaBackup()"]'); await p.waitForSelector('#modalBackupConfirmar:not(.hidden)');
const cod2 = (await db(p)).codigos['RESTORE_CODE_admin@example.com'].codigo;
await p.fill('#inputConfirmarBackupText', cod2); await p.click('#btnRestaurarBackupDefinitivo');
await shot(p, 'restaurando');
await waitToast(p, /Restauración completada con éxito/, 20000);
d = await db(p); assert.equal(d.solicitudes.length, totalAntes); assert.ok(d.backups.some(b => /PreRestauracion/.test(b.name))); assert.ok(d.auditoria.some(a => a.accion === 'RESTAURAR_BACKUP')); ok('restauración: datos recuperados y copia de prevención creada');
await p.waitForTimeout(2000); await idle(p);

// ── Persistencia y sesión ────────────────────────────────────────────────────
section('Persistencia');
const antes = await db(p);
await p.reload();
await p.waitForSelector('#appLayout', { state: 'visible', timeout: 8000 }); await idle(p);
await go(p, 'solicitudes');
assert.equal((await p.textContent('#resultCount')).trim(), antes.solicitudes.length + ' registros'); ok('la sesión y los datos persisten tras recargar');
const p2 = await open(); await p2.waitForTimeout(300);
assert.equal((await p2.evaluate(() => sessionStorage.getItem('hd_panel_token'))), null); ok('otra pestaña (sessionStorage) pide login');
await p2.close();
// Tema
await p.click('#btnThemeToggle'); await p.waitForTimeout(300); await p.click('#btnThemeToggle');
// Recargar vista
await p.click('#btnRecargar'); await p.waitForTimeout(500); await idle(p);
// Cerrar sesión
const tokAdmin = await p.evaluate(() => sessionStorage.getItem('hd_panel_token'));
await p.evaluate(() => cerrarSesion()); await confirmar(p);
await p.waitForSelector('#loginScreen', { state: 'visible' });
assert.equal(await p.evaluate(() => sessionStorage.getItem('hd_panel_token')), null); ok('cerrar sesión');
assert.match((await api(p, 'apiGetSolicitudes', tokAdmin, {})).err || '', /Sesión inválida/); ok('el token anterior deja de valer');

// Restablecer datos (botón DEMO) no debe dar errores
section('Restablecer datos de la demo');
await p.click('.odm-pill'); await p.waitForTimeout(300);
p.once('dialog', dlg => dlg.accept());
await p.click('.odm-card [data-act=reset]');
await p.waitForSelector('#loginEmail'); await p.waitForTimeout(500);
d = await db(p); assert.ok(d.solicitudes.length >= 29 && !d.solicitudes.some(s => s.razon_social.startsWith('Empresa Nueva'))); ok('restablecer datos vuelve a la semilla');

// ── Resultado ────────────────────────────────────────────────────────────────
// Benignos: Chrome aborta la navegación interna del visor de PDF (extensión + blob:) al cerrar el visor o la pestaña.
const benign = x => x.type === 'requestfailed' && x.msg === 'net::ERR_ABORTED' && /^(blob:|chrome-extension:)/.test(x.url);
const ignorados = t.problems.filter(benign).length;
t.problems = t.problems.filter(x => !benign(x));
console.log('\nproblemas de consola/red:', t.problems.length ? t.problems : 'ninguno', ignorados ? '(' + ignorados + ' abortos benignos del visor de PDF ignorados)' : '');
await t.close();
assert.equal(t.problems.length, 0, 'No debe haber errores de consola: ' + JSON.stringify(t.problems));
console.log('\nPANEL E2E OK');
