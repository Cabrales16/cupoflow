// Utilidades compartidas para pruebas E2E y capturas (Playwright + Chrome/Edge instalado, headless).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { startServer } from '../serve.mjs';

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
];
export const chromePath = process.env.CHROME_PATH || CANDIDATES.find(p => fs.existsSync(p));

export async function launch({ port = 4173, viewport = { width: 1440, height: 900 } } = {}) {
  const server = await startServer(port);
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const ctx = await browser.newContext({ viewport, locale: 'es-CO' });
  const base = 'http://localhost:' + port + '/';
  const problems = [];
  ctx.on('page', p => watch(p, problems));
  const newPage = async () => { const p = await ctx.newPage(); return p; };
  const close = async () => { await browser.close(); server.close(); };
  return { ctx, base, problems, newPage, close };
}

/** Registra errores de consola / excepciones / peticiones fallidas (ignora fuentes/CDN externos). */
export function watch(page, problems) {
  page.on('pageerror', e => problems.push({ type: 'pageerror', url: page.url(), msg: e.message }));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource/.test(t) && /(fonts\.g|cdn|cloudflare|jsdelivr|wikimedia|ipify)/.test(m.location().url || '')) return;
    problems.push({ type: 'console.error', url: page.url(), msg: t.slice(0, 300) });
  });
  page.on('requestfailed', r => {
    const u = r.url();
    if (/fonts\.g|cdnjs|jsdelivr|wikimedia|ipify|googleusercontent/.test(u)) return;
    problems.push({ type: 'requestfailed', url: u, msg: r.failure() && r.failure().errorText });
  });
}
