// Toma las capturas reales de la demo (navegador headless) y compone la portada tipo mockup.
// Uso: node demo/build.mjs && node tools/screenshots.mjs
import { launch } from './e2e/helper.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const t = await launch({ port: 4900 + Math.floor(Math.random() * 90), viewport: { width: 1440, height: 900 } });
const noCard = p => p.addInitScript(() => sessionStorage.setItem('demo-card-shown', '1'));
const shot = async (p, n) => { await p.addStyleTag({ content: '#toastContainer,.toast-container{display:none!important}' }).catch(() => {}); return p.screenshot({ path: path.join(OUT, n + '.png') }); };
const view = async (p, v, wait = 900) => { await p.dispatchEvent(`.sb-item[data-view="${v}"]`, 'click'); await p.waitForTimeout(wait); };
const login = async (p, email, okSel) => {
  await p.fill('#loginEmail', email); await p.fill('#loginPassword', 'Demo2025!'); await p.click('#loginBtn');
  await p.waitForSelector(okSel, { timeout: 10000 }); await p.waitForTimeout(1500);
};

// 1. Índice
let p = await t.newPage(); await noCard(p); await p.goto(t.base); await p.waitForTimeout(1500); await shot(p, '01-indice');

// 2. Login con accesos rápidos (panel de la demo abierto)
p = await t.newPage(); await p.goto(t.base + 'panel/index.html'); await p.waitForSelector('#loginEmail'); await p.waitForTimeout(1600); await shot(p, '02-login-accesos-rapidos');

// 3. Panel (admin)
p = await t.newPage(); await noCard(p); await p.goto(t.base + 'panel/index.html'); await p.waitForSelector('#loginEmail');
await login(p, 'admin@example.com', '#appLayout');
await p.waitForTimeout(1500); await shot(p, '03-panel-dashboard');
await view(p, 'solicitudes'); await shot(p, '04-panel-solicitudes');
await p.locator('#solicitudesTableBody tr').first().click().catch(() => {}); await p.waitForTimeout(1200); await shot(p, '05-panel-detalle-solicitud');
await p.keyboard.press('Escape'); await p.evaluate(() => { try { closeModal && closeModal(); } catch (e) {} });
await view(p, 'creditos'); await shot(p, '06-panel-creditos');
await view(p, 'usuarios'); await shot(p, '07-panel-usuarios');
await view(p, 'auditoria'); await shot(p, '08-panel-auditoria');
await view(p, 'backups'); await shot(p, '09-panel-copias');

// 4. Portal (operaciones)
p = await t.newPage(); await noCard(p); await p.goto(t.base + 'portal/index.html'); await p.waitForSelector('#loginEmail');
await login(p, 'operaciones@example.com', '#appContent.visible');
await shot(p, '10-portal-dashboard');
await view(p, 'creditos'); await shot(p, '11-portal-creditos');
await view(p, 'notificaciones'); await shot(p, '12-portal-notificaciones');

// 5. Formulario
p = await t.newPage(); await noCard(p); await p.goto(t.base + 'formulario/index.html'); await p.waitForTimeout(1500); await shot(p, '13-formulario-bienvenida');
await p.check('#chkWelcomeTerms', { force: true }); await p.check('#chkWelcomeData', { force: true }); await p.click('#btnWelcomeAccept'); await p.waitForSelector('#centroCheckGrid .centro-check-item', { timeout: 15000 }); await p.waitForTimeout(800); await shot(p, '14-formulario-paso1');

console.log('Capturas en', OUT, fs.readdirSync(OUT).length, 'archivos'); console.log('problemas:', t.problems);
await t.close();
