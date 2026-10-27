// Genera assets/cover.png: portada tipo mockup con capturas dentro de marcos de navegador.
// Uso: node tools/screenshots.mjs && node tools/cover.mjs
import { launch } from './e2e/helper.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const img = n => 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'assets', 'screenshots', n + '.png')).toString('base64');
const frame = (src, url, cls) => `<div class="win ${cls}"><div class="bar"><i></i><i></i><i></i><span>${url}</span></div><img src="${src}"></div>`;
const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:1600px;height:840px;overflow:hidden;font-family:Segoe UI,Arial,sans-serif;color:#fff;
background:radial-gradient(1200px 700px at 15% 10%,#1b6255 0,#0e362f 55%,#092420 100%);position:relative}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:60px 60px}
h1{position:absolute;left:70px;top:70px;margin:0;font:800 46px/1.08 Georgia,serif;letter-spacing:-1px}h1 b{color:#d08b43}
p.sub{position:absolute;left:72px;top:230px;width:520px;font-size:21px;line-height:1.5;color:#c8e1dd;margin:0}
.chips{position:absolute;left:72px;top:400px;width:520px}.chips span{display:inline-block;margin:0 8px 10px 0;padding:8px 14px;border:1px solid #d08b43;border-radius:999px;font-size:15px;color:#f7d4ac;background:rgba(208, 139, 67,.1)}
.tag{position:absolute;left:72px;bottom:60px;font-size:16px;color:#8eb9b3;letter-spacing:.5px}
.win{position:absolute;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 30px 70px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.12)}
.bar{height:34px;background:#e9f1f1;display:flex;align-items:center;padding:0 12px;gap:7px}.bar i{width:11px;height:11px;border-radius:50%;background:#ff5f57}.bar i:nth-child(2){background:#ff8b2d}.bar i:nth-child(3){background:#28c840}
.bar span{margin-left:14px;background:#fff;color:#556;border-radius:6px;padding:3px 14px;font-size:12px;flex:0 1 380px;white-space:nowrap}
.win img{display:block;width:100%}
.w1{left:700px;top:60px;width:800px;transform:rotate(-1.2deg)}.w2{left:940px;top:330px;width:640px;transform:rotate(1.5deg)}.w3{left:600px;top:470px;width:520px;transform:rotate(-2.5deg)}
</style><div class="grid"></div>
<h1><b>CupoFlow</b><br>credit limits, simplified</h1>
<p class="sub">Solicitud, aprobación y consulta de cupos de crédito para una distribuidora de materiales de construcción. Demo interactiva 100&nbsp;% en el navegador.</p>
<div class="chips"><span>JavaScript</span><span>Demo en GitHub Pages</span><span>4 roles</span><span>Datos ficticios</span><span>Sin servidor</span></div>
<div class="tag">DEMO INTERACTIVA · CUENTAS DE PRUEBA INCLUIDAS</div>
${frame(img('03-panel-dashboard'), 'cabrales16.github.io/cupoflow/panel', 'w1')}
${frame(img('11-portal-creditos'), '…/portal · Portal de consulta', 'w2')}
${frame(img('14-formulario-paso1'), '…/formulario · Solicitud', 'w3')}`;
const t = await launch({ port: 4990, viewport: { width: 1600, height: 840 } });
const p = await t.newPage();
await p.setContent(html); await p.waitForTimeout(600);
await p.screenshot({ path: path.join(ROOT, 'assets', 'cover.png') });
await t.close(); console.log('assets/cover.png listo');
