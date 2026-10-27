// Integración entre apps: lo que se aprueba en el Panel aparece en el Portal; "Restablecer datos" restaura la semilla.
import { launch } from './helper.mjs';
import assert from 'node:assert/strict';

const t = await launch({ port: 4600 + Math.floor(Math.random() * 300) });
const api = (p, n, ...a) => p.evaluate(([n, a]) => new Promise((res, rej) => google.script.run.withSuccessHandler(res).withFailureHandler(e => rej(new Error(e.message)))[n](...a)), [n, a]);
const panel = await t.newPage(); await panel.goto(t.base + 'panel/index.html');
const portal = await t.newPage(); await portal.goto(t.base + 'portal/index.html');
const form = await t.newPage(); await form.goto(t.base + 'formulario/index.html');
await form.waitForTimeout(800);

const adm = await api(panel, 'apiLogin', 'admin@example.com', 'Demo2025!');
const sols = await api(panel, 'apiGetSolicitudes', adm.token, { limite: 500 });
const list = Array.isArray(sols) ? sols : (sols.data || sols.solicitudes);
const pend = list.find(s => /Zafiro/.test(s.razon_social));
assert.ok(pend, 'solicitud pendiente de semilla');

const rs = await api(portal, 'apiLogin', 'operaciones@example.com', 'Demo2025!');
const before = JSON.parse((await api(portal, 'apiConsultarCreditos', { token: rs.token, limite: 500 })).payload_json);
assert.ok(!before.creditos.some(c => /Zafiro/.test(c.razon_social)), 'aún no debe haber crédito');

await api(panel, 'apiActualizarEstado', { token: adm.token, uuid: pend.uuid, accion: 'APROBADA', comentarios: 'Integración', correoRep: 'rep@example.com', correoEjecutivo: 'comercial1@example.com',
  cuposDistribuidos: { CDNORTE: 20000000, CDCENTRO: 20000000 }, montoTotalAprobado: 40000000, aceptadoPor: 'Área de crédito (demo)', enviarCarta: false });
const after = JSON.parse((await api(portal, 'apiConsultarCreditos', { token: rs.token, limite: 500 })).payload_json);
const z = after.creditos.filter(c => /Zafiro/.test(c.razon_social));
assert.equal(z.length, 2, 'Portal debe ver 2 créditos (uno por centro)');
console.log('✔ aprobado en Panel → visible en Portal:', z.map(c => c.centro_codigo || c.centro).join(', '));

// Restablecer datos
await panel.evaluate(() => DemoKit.resetAll(false)); await panel.reload(); await panel.waitForTimeout(500);
const st = await panel.evaluate(() => JSON.parse(localStorage.getItem('demo-db')).solicitudes.find(s => /Zafiro/.test(s.razon_social)).estado_codigo);
assert.equal(st, 'PENDIENTE_REVISION'); console.log('✔ restablecer datos restaura la semilla');
console.log('problemas:', t.problems);
assert.equal(t.problems.length, 0);
await t.close();
console.log('INTEGRACION OK');
