#!/usr/bin/env node
/**
 * scan-secrets.mjs — Escáner de secretos y datos personales sin dependencias.
 * Recorre TODO el repo (excepto .git y node_modules), incluida la carpeta site/ si existe.
 *
 *   node tools/scan-secrets.mjs            → informe legible; código de salida 1 si hay hallazgos
 *   node tools/scan-secrets.mjs --json     → informe en JSON
 *
 * Reglas: claves de API (Google/Gemini, AWS, GitHub, Slack, Stripe, OpenAI…), claves privadas, JWT,
 * IDs de despliegue/recursos de Google (AKfycb…, spreadsheets/d/, folders/, IDs de Drive), hashes,
 * asignaciones de contraseñas/secretos, cadenas JDBC, IPs, correos de dominios reales (solo se
 * permiten example.com/.org/.net y noreply), teléfonos, NIT y archivos de datos (xlsx, pdf, sql…).
 * Los marcadores TU_* y los valores de la demo (Demo2025!) están en lista blanca.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const TEXT_EXT = /\.(js|mjs|cjs|json|html|htm|css|md|yml|yaml|txt|svg|example|toml|xml|csv)$/i;
const SELF = path.join('tools', 'scan-secrets.mjs');

const ALLOW_VALUE = /^(TU_[A-Z0-9_]+|Demo2025!|demo-[a-z0-9-]+|0{8}-0{4}-0{4}-0{4}-0{12})$/;
const ALLOW_EMAIL = /@(example\.(com|org|net)|[a-z0-9-]+\.example\.com|localhost|users\.noreply\.github\.com)$/i;
const ALLOW_EMAIL_LOCAL = /^(noreply|no-reply)$/i;
// Correo público del autor: solo se admite como autoría en README/LICENSE/package.json
const AUTHOR_EMAIL = 'andrescabrales322@gmail.com';

const RULES = [
  { id: 'google-api-key', re: /AIza[0-9A-Za-z_-]{35}/g },
  { id: 'gemini-key-AQ', re: /\bAQ\.[A-Za-z0-9_-]{30,}/g },
  { id: 'aws-access-key', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', re: /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{30,}/g },
  { id: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { id: 'stripe/openai-key', re: /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{16,}|\bsk-[A-Za-z0-9]{32,}/g },
  { id: 'private-key', re: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY( BLOCK)?-----/g },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { id: 'gas-deployment-id', re: /AKfycb[A-Za-z0-9_-]{20,}/g },
  { id: 'gas-script-id', re: /"scriptId"\s*:\s*"(?!TU_)[A-Za-z0-9_-]{20,}"/g },
  { id: 'google-sheet-id', re: /spreadsheets\/d\/(?!e\/)[A-Za-z0-9_-]{25,}/g },
  { id: 'google-drive-id', re: /(?:drive\.google\.com\/(?:file\/d|drive\/folders)|lh3\.googleusercontent\.com\/d)\/[A-Za-z0-9_-]{20,}/g,
    only: v => !/\/TU_[A-Z_]+$/.test(v) },
  { id: 'google-id-literal', re: /['"](1[A-Za-z0-9_-]{32,44})['"]/g,
    only: (v, line, m) => /[A-Z]/.test(m[1]) && /[a-z]/.test(m[1]) && /\d/.test(m[1]) },
  { id: 'sha256-hash', re: /\b[a-f0-9]{64}\b/g },
  { id: 'md5/sha1-hash', re: /\b(?:[a-f0-9]{32}|[a-f0-9]{40})\b/g, only: (v, line) => !/(uuid|hex|crc|sourceMappingURL)/i.test(line) },
  { id: 'password-literal', re: /\b(pass(?:word|wd)?|pwd|secret|api[_-]?key|token|clave)\b\s*[:=]\s*['"]([^'"\n]{4,})['"]/gi,
    only: (v, line, m) => !ALLOW_VALUE.test(m[2]) && !/^(TU_|\$\{|\$\(|<|\{\{|%|\*+$|password$|contrase|Ej:|xxx)/i.test(m[2]) && !/(placeholder|label|type=|textContent|innerHTML|Ingres|Nueva|Repet|Confirm|Escribe)/i.test(line) },
  { id: 'jdbc-url', re: /jdbc:[a-z]+:\/\/[^\s'"`]+/gi, only: v => !/\$\{|TU_|localhost/.test(v) },
  { id: 'private-ip', re: /\b(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g },
  { id: 'phone-co', re: /(?<![\d.#])(\+?57[\s-]?)?3[0-2]\d[\s-]?\d{3}[\s-]?\d{4}(?![\d.])/g,
    only: (v, line) => !/(0000|1234567|font|width|rgba|#[0-9a-f]{6})/i.test(line) && !/000/.test(v) && !/(3\d\d\s?456\s?7890)/.test(v) },
  { id: 'nit', re: /\b(?:8|9)\d{2}[.\s]?\d{3}[.\s]?\d{3}-\d\b/g, only: v => !/^900\.000\.00\d-\d$/.test(v) && !/^9901000[0-9]{2}-[0-9]$/.test(v) },
  { id: 'email-real-domain', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    only: v => { const l = v.split('@')[0]; return !(ALLOW_EMAIL.test(v) || ALLOW_EMAIL_LOCAL.test(l)) && !/\.(png|jpg|svg|css|js|woff2?|mjs)$/i.test(v); } }
];

function* walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) yield* walk(p); else yield p;
  }
}

const findings = [];
let scanned = 0, skipped = 0;
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file);
  if (rel === SELF || rel.startsWith(path.join('tools', 'e2e', '.tmp'))) continue;
  const base = path.basename(file);
  if (!TEXT_EXT.test(file) && base !== '.gitignore') {
    if (/\.(xlsx?|docx?|pdf|zip|sql|bak|p12|pem|key)$/i.test(file) || /^\.env/.test(base)) findings.push({ rule: 'sensitive-file', file: rel, line: 0, match: '(archivo de datos / credenciales)' });
    skipped++; continue;
  }
  const text = fs.readFileSync(file, 'utf8');
  scanned++;
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.length > 30000) line = line.slice(0, 30000);
    for (const r of RULES) {
      r.re.lastIndex = 0;
      let m;
      while ((m = r.re.exec(line))) {
        const v = m[0];
        if (m.index === r.re.lastIndex) r.re.lastIndex++;
        if (ALLOW_VALUE.test(v)) continue;
        if (r.only && !r.only(v, line, m)) continue;
        if (r.id === 'email-real-domain' && v.toLowerCase() === AUTHOR_EMAIL && /^(README|LICENSE|package)/i.test(base)) continue;
        findings.push({ rule: r.id, file: rel, line: i + 1, match: v.length > 90 ? v.slice(0, 90) + '…' : v });
      }
    }
  });
}

if (JSON_OUT) console.log(JSON.stringify({ scanned, skipped, findings }, null, 2));
else {
  console.log('Escaneo de secretos — ' + scanned + ' archivos de texto analizados, ' + skipped + ' binarios/omitidos');
  console.log('Reglas: ' + RULES.map(r => r.id).concat('sensitive-file').join(', '));
  if (!findings.length) console.log('\n✅ Sin hallazgos.');
  else {
    console.log('\n❌ ' + findings.length + ' hallazgo(s):\n');
    const by = {};
    findings.forEach(f => (by[f.rule] = by[f.rule] || []).push(f));
    for (const [rule, list] of Object.entries(by)) {
      console.log('■ ' + rule + ' (' + list.length + ')');
      list.slice(0, 40).forEach(f => console.log('   ' + f.file + ':' + f.line + '  ' + f.match));
      if (list.length > 40) console.log('   … y ' + (list.length - 40) + ' más');
    }
  }
}
process.exit(findings.length ? 1 : 0);
