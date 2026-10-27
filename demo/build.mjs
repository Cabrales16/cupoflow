#!/usr/bin/env node
/**
 * build.mjs — Genera el sitio estático de la demo (carpeta ./site) a partir de:
 *   - src/<app>/*.html         (frontends REALES de Apps Script, sin modificar su lógica)
 *   - demo/shim/*.js           (emulación de google.script.run + base de datos en localStorage)
 *   - demo/mock/<app>.js       (backend simulado de cada app)
 *
 * Uso:  node demo/build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'site');

const APPS = [
  { key: 'indice',     out: 'index.html',            depth: 0 },
  { key: 'formulario', out: 'formulario/index.html', depth: 1 },
  { key: 'panel',      out: 'panel/index.html',      depth: 1 },
  { key: 'portal',     out: 'portal/index.html',     depth: 1 }
];
const SHIM_FILES = ['shim.js', 'store.js', 'seed.js', 'auth.js', 'xlsx.js', 'demo-ui.js'];
const VERSION = Date.now().toString(36);

const read = p => fs.readFileSync(p, 'utf8');
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

/** Resuelve <?!= include('X') ?> de forma recursiva (equivale al HtmlService.createTemplateFromFile). */
function render(dir, name, seen = []) {
  if (seen.includes(name)) throw new Error('include circular: ' + seen.concat(name).join(' → '));
  const file = path.join(dir, name + '.html');
  if (!fs.existsSync(file)) throw new Error('No existe el parcial ' + file);
  return read(file).replace(/<\?!=\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*\?>/g, (_, n) => render(dir, n, seen.concat(name)));
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// 1) Bundle común del shim
write(path.join(OUT, 'demo', 'common.js'),
  SHIM_FILES.map(f => '/* ── ' + f + ' ── */\n' + read(path.join(ROOT, 'demo', 'shim', f))).join('\n;\n'));

// 2) Assets
fs.cpSync(path.join(ROOT, 'assets', 'site'), path.join(OUT, 'assets'), { recursive: true });
write(path.join(OUT, '.nojekyll'), '');

// 3) Páginas
for (const app of APPS) {
  const rel = app.depth === 0 ? './' : '../';
  let html = render(path.join(SRC, app.key), 'Index');

  // Recursos externos de la marca → assets locales
  html = html
    .replace(/https:\/\/lh3\.googleusercontent\.com\/d\/TU_LOGO_BLANCO_DRIVE_ID/g, rel + 'assets/logo-blanco.svg')
    .replace(/https:\/\/lh3\.googleusercontent\.com\/d\/TU_LOGO_DRIVE_ID/g, rel + 'assets/logo.svg')
    .replace(/https:\/\/drive\.google\.com\/uc\?export=(?:download|view)&(?:amp;)?id=TU_LOGO_DRIVE_ID/g, rel + 'assets/logo.svg')
    .replace(/https:\/\/www\.example\.com\/favicon\.ico/g, rel + 'assets/favicon.svg');

  const mockFile = path.join(ROOT, 'demo', 'mock', app.key + '.js');
  let mockOut = '';
  if (fs.existsSync(mockFile)) {
    mockOut = 'demo/' + app.key + '.mock.js';
    write(path.join(OUT, mockOut), read(mockFile));
  }
  const inject =
    '\n<script>window.__DEMO_BASE__=' + JSON.stringify(rel) + ';window.__DEMO_APP__=' + JSON.stringify(app.key) + ';</script>' +
    '\n<script src="' + rel + 'demo/common.js?v=' + VERSION + '"></script>' +
    (mockOut ? '\n<script src="' + rel + mockOut + '?v=' + VERSION + '"></script>' : '') + '\n';

  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, m => m + inject);
  else html = inject + html;

  write(path.join(OUT, app.out), html);
  console.log('✔', app.out.padEnd(24), (html.length / 1024).toFixed(0) + ' KB', mockOut ? '(+mock)' : '(sin mock)');
}
console.log('Sitio generado en', OUT);
