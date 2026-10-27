// Ejecuta todas las pruebas E2E en serie: node tools/e2e/run-all.mjs
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = path.dirname(fileURLToPath(import.meta.url));
let fail = 0;
for (const t of ['indice', 'formulario', 'panel', 'portal', 'integracion']) {
  console.log('\n══ ' + t + ' ══');
  const r = spawnSync(process.execPath, [path.join(dir, t + '.test.mjs')], { stdio: 'inherit' });
  if (r.status !== 0) { fail++; console.log('✘ ' + t + ' FALLÓ'); }
}
console.log(fail ? '\n' + fail + ' suite(s) fallaron' : '\n✔ Todas las suites pasaron');
process.exit(fail ? 1 : 0);
