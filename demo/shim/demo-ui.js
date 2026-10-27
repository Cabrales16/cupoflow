/* ============================================================================
 * demo-ui.js — Capa visual de la demo: distintivo "DEMO", accesos rápidos por
 * rol, botón de restablecer datos, avisos de servicios simulados y bandeja de
 * correos simulados. Es independiente de la lógica de cada frontend.
 * ========================================================================== */
(function () {
  'use strict';
  const O = window.DemoKit;

  // Cada app puede sobreescribir O.appConfig desde su mock.
  O.appConfig = O.appConfig || { name: 'app', title: 'Demo', quick: null, fillLogin: null, notes: [] };

  const css = `
  #demo-root{all:initial;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  #demo-root *{box-sizing:border-box;font-family:inherit}
  .odm-pill{position:fixed;left:14px;bottom:14px;z-index:2147483000;background:#0e362f;color:#fff;border:1px solid #d08b43;border-radius:999px;
    padding:8px 14px;font-size:12.5px;font-weight:700;cursor:pointer;display:flex;gap:8px;align-items:center;box-shadow:0 6px 24px rgba(0,0,0,.35);letter-spacing:.3px}
  .odm-pill:hover{background:#154A41}
  .odm-dot{width:8px;height:8px;border-radius:50%;background:#d08b43;box-shadow:0 0 0 0 rgba(208, 139, 67,.7);animation:odmp 2s infinite}
  @keyframes odmp{70%{box-shadow:0 0 0 8px rgba(208, 139, 67,0)}100%{box-shadow:0 0 0 0 rgba(208, 139, 67,0)}}
  .odm-card{position:fixed;left:14px;bottom:60px;z-index:2147483001;width:min(380px,calc(100vw - 28px));max-height:calc(100vh - 90px);overflow:auto;
    background:#fff;color:#0e362f;border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.4);border:1px solid #d7e6e6;display:none}
  .odm-card.open{display:block}
  .odm-h{background:#0e362f;color:#fff;padding:14px 16px;border-radius:14px 14px 0 0;display:flex;justify-content:space-between;align-items:center}
  .odm-h b{font-size:14px}.odm-h span{font-size:11px;color:#d08b43;display:block;margin-top:2px}
  .odm-x{background:none;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1}
  .odm-b{padding:14px 16px;font-size:12.5px;line-height:1.5}
  .odm-b p{margin:0 0 10px}
  .odm-sec{font-size:10.5px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:#6a8d89;margin:14px 0 6px}
  .odm-acc{display:flex;width:100%;text-align:left;gap:10px;align-items:center;border:1px solid #d7e6e6;background:#f8fcfc;border-radius:10px;padding:8px 10px;margin-bottom:6px;cursor:pointer;color:#0e362f}
  .odm-acc:hover{border-color:#d08b43;background:#fff6f0}
  .odm-role{font-size:10px;font-weight:800;padding:3px 7px;border-radius:6px;background:#0e362f;color:#fff;min-width:74px;text-align:center}
  .odm-role.OPERACIONES{background:#3c796c}.odm-role.CONSULTAS{background:#6a8d89}.odm-role.CLIENTE{background:#d08b43;color:#0e362f}
  .odm-acc small{display:block;color:#6a8d89;font-size:11px}
  .odm-btn{border:1px solid #d7e6e6;background:#fff;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;color:#0e362f;margin:0 6px 6px 0}
  .odm-btn:hover{border-color:#d08b43}.odm-btn.danger{color:#b42318;border-color:#f3c5c0;background:#fff5f4}
  .odm-note{background:#fff2e6;border:1px solid #f5cea4;border-radius:8px;padding:8px 10px;font-size:11.5px;margin-bottom:6px}
  .odm-pw{font-family:ui-monospace,Consolas,monospace;background:#eef6f6;padding:1px 6px;border-radius:5px}
  .odm-toast-wrap{position:fixed;right:14px;top:14px;z-index:2147483002;display:flex;flex-direction:column;gap:8px;width:min(360px,calc(100vw - 28px))}
  .odm-toast{background:#0e362f;color:#fff;border-left:4px solid #d08b43;border-radius:10px;padding:11px 13px;font-size:12.5px;line-height:1.45;box-shadow:0 10px 30px rgba(0,0,0,.35);animation:odmin .25s ease}
  .odm-toast b{color:#d08b43}.odm-toast .code{display:block;font-size:26px;letter-spacing:6px;font-weight:800;color:#fff;margin:4px 0;font-family:ui-monospace,Consolas,monospace}
  .odm-toast a{color:#d08b43;cursor:pointer;text-decoration:underline}
  @keyframes odmin{from{transform:translateY(-8px);opacity:0}to{transform:none;opacity:1}}
  .odm-modal{position:fixed;inset:0;z-index:2147483003;background:rgba(10, 30, 29,.6);display:none;align-items:center;justify-content:center;padding:18px}
  .odm-modal.open{display:flex}
  .odm-mbox{background:#fff;color:#0e362f;border-radius:14px;width:min(980px,100%);height:min(640px,100%);display:flex;flex-direction:column;overflow:hidden}
  .odm-mh{padding:12px 16px;background:#0e362f;color:#fff;display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:700}
  .odm-mb{display:flex;flex:1;min-height:0}
  .odm-list{width:300px;border-right:1px solid #e3eeee;overflow:auto;background:#f8fcfc}
  .odm-item{padding:10px 12px;border-bottom:1px solid #e3eeee;cursor:pointer;font-size:12px}
  .odm-item.sel{background:#fff2e6}.odm-item b{display:block;font-size:12.5px}.odm-item span{color:#6a8d89}
  .odm-view{flex:1;display:flex;flex-direction:column;min-width:0}
  .odm-meta{padding:10px 14px;font-size:12px;border-bottom:1px solid #e3eeee;background:#fff}
  .odm-view iframe{flex:1;border:0;width:100%}
  .odm-empty{padding:30px;color:#6a8d89;font-size:13px;text-align:center}
  @media(max-width:700px){.odm-list{width:120px}}
  `;

  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(k => e.setAttribute(k, attrs[k]));
    if (html != null) e.innerHTML = html;
    return e;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let root, card, pill, toasts, modal;

  // ── Toasts ───────────────────────────────────────────────────────────────────
  O.toast = function (html, ms) {
    if (!toasts) return;
    const t = el('div', { class: 'odm-toast' }, html);
    toasts.appendChild(t);
    setTimeout(() => t.remove(), ms || 9000);
    return t;
  };

  /** Registra un correo simulado. Si se pasa `db` (dentro de un O.tx) lo escribe ahí; si no, abre su propia tx. */
  O.mail = function (mail, db) {
    const m = Object.assign({ id: O.uuid(), fecha: new Date().toISOString(), to: '', subject: '', html: '', code: null }, mail);
    if (db) (db.outbox = db.outbox || []).unshift(m); else O.tx(d => { (d.outbox = d.outbox || []).unshift(m); });
    if (m.code) {
      O.toast('<b>📧 Correo simulado</b> a <b>' + esc(m.to) + '</b><br>' + esc(m.subject) +
        '<span class="code">' + esc(m.code) + '</span>En producción este código llegaría por correo. <a data-mail="' + esc(m.id) + '">Ver correo</a>', 14000);
    } else {
      O.toast('<b>📧 Correo simulado</b> a <b>' + esc(m.to) + '</b><br>' + esc(m.subject) + '<br><a data-mail="' + esc(m.id) + '">Abrir en la bandeja simulada</a>', 8000);
    }
    updateCounter();
    return m;
  };

  function updateCounter() {
    const n = (O.db().outbox || []).length;
    const c = document.getElementById('odm-outbox-n');
    if (c) c.textContent = n;
  }

  // ── Bandeja simulada ────────────────────────────────────────────────────────
  function openOutbox(selId) {
    const list = O.db().outbox || [];
    modal.classList.add('open');
    const box = modal.querySelector('.odm-mb');
    if (!list.length) { box.innerHTML = '<div class="odm-empty" style="flex:1">La bandeja está vacía. Cuando la app “envíe” un correo (códigos de verificación, aprobaciones, alertas…), aparecerá aquí.</div>'; return; }
    const sel = list.find(x => x.id === selId) || list[0];
    box.innerHTML = '<div class="odm-list">' + list.map(m =>
      '<div class="odm-item ' + (m.id === sel.id ? 'sel' : '') + '" data-id="' + esc(m.id) + '"><b>' + esc(m.subject) + '</b><span>Para: ' + esc(m.to) + '<br>' + new Date(m.fecha).toLocaleString('es-CO') + '</span></div>').join('') +
      '</div><div class="odm-view"><div class="odm-meta"><b>Asunto:</b> ' + esc(sel.subject) + '<br><b>Para:</b> ' + esc(sel.to) +
      (sel.cc ? '<br><b>CC:</b> ' + esc(sel.cc) : '') + (sel.attachments && sel.attachments.length ? '<br><b>Adjuntos:</b> ' + sel.attachments.map(esc).join(', ') : '') +
      '</div><iframe sandbox="" srcdoc=""></iframe></div>';
    box.querySelector('iframe').srcdoc = sel.html || '<p style="font-family:sans-serif;padding:20px">' + esc(sel.text || '(sin contenido)') + '</p>';
    box.querySelectorAll('.odm-item').forEach(i => i.onclick = () => openOutbox(i.getAttribute('data-id')));
  }
  O.openOutbox = openOutbox;

  // ── Login rápido ────────────────────────────────────────────────────────────
  function visible(e) { return e && e.offsetParent !== null; }
  function setVal(input, v) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function defaultFill(email, pw) {
    const inputs = Array.from(document.querySelectorAll('input')).filter(visible);
    const pass = inputs.find(i => i.type === 'password');
    const mail = inputs.find(i => i.type === 'email' || /mail|correo|user/i.test(i.id + i.name + i.placeholder));
    if (!pass || !mail) { O.toast('<b>Accesos rápidos</b><br>No hay un formulario de inicio de sesión visible en esta pantalla.'); return; }
    setVal(mail, email); setVal(pass, pw);
    const scope = pass.closest('form') || pass.closest('div[id*="login" i]') || document;
    const btn = Array.from(scope.querySelectorAll('button')).find(b => visible(b) && (b.type === 'submit' || /login|ingres|entrar|iniciar/i.test(b.id + ' ' + b.textContent)));
    if (btn) btn.click(); else if (pass.form) pass.form.requestSubmit ? pass.form.requestSubmit() : pass.form.submit();
  }
  O.quickLogin = function (email, pw) { (O.appConfig.fillLogin || defaultFill)(email, pw || O.DEMO_PASSWORD); };

  function buildCard() {
    const cfg = O.appConfig;
    const accounts = (cfg.quick || O.DEMO_ACCOUNTS).map(a =>
      '<button class="odm-acc" data-email="' + esc(a.email) + '"><span class="odm-role ' + esc(a.rol) + '">' + esc(a.rol) + '</span><span><b>' + esc(a.nombre || a.email) + '</b><small>' + esc(a.email) + ' · ' + esc(a.desc || '') + '</small></span></button>').join('');
    const notes = (cfg.notes || []).map(n => '<div class="odm-note">' + n + '</div>').join('');
    const nav = '<a class="odm-btn" style="text-decoration:none;display:inline-block" href="' + O.basePath + 'index.html">🏠 Índice</a>' +
      '<a class="odm-btn" style="text-decoration:none;display:inline-block" href="' + O.basePath + 'formulario/index.html">📝 Formulario</a>' +
      '<a class="odm-btn" style="text-decoration:none;display:inline-block" href="' + O.basePath + 'panel/index.html">🛠️ Panel</a>' +
      '<a class="odm-btn" style="text-decoration:none;display:inline-block" href="' + O.basePath + 'portal/index.html">🔎 Portal</a>';
    card.innerHTML =
      '<div class="odm-h"><div><b>Modo demostración</b><span>' + esc(cfg.title || 'Sistema de créditos') + ' · datos 100 % ficticios</span></div><button class="odm-x" aria-label="Cerrar">×</button></div>' +
      '<div class="odm-b">' +
      '<p>Esta es una demo interactiva: no hay servidor. Todo (usuarios, solicitudes, cambios) vive en <b>tu navegador</b> (localStorage) y nada sale de él.</p>' +
      '<div class="odm-note">🔌 <b>Servicios simulados:</b> correo (Gmail), Google Drive, autenticación/OAuth, IA (Gemini) y exportaciones. Verás avisos cuando ocurran.</div>' + notes +
      (accounts ? '<div class="odm-sec">Accesos rápidos · contraseña <span class="odm-pw">' + esc(O.DEMO_PASSWORD) + '</span></div>' + accounts : '') +
      '<div class="odm-sec">Herramientas</div>' +
      '<button class="odm-btn" data-act="outbox">📬 Bandeja simulada (<span id="odm-outbox-n">0</span>)</button>' +
      '<button class="odm-btn danger" data-act="reset">↺ Restablecer datos</button>' +
      '<div class="odm-sec">Ir a</div>' + nav +
      '</div>';
    card.querySelector('.odm-x').onclick = () => card.classList.remove('open');
    card.querySelectorAll('.odm-acc').forEach(b => b.onclick = () => { card.classList.remove('open'); O.quickLogin(b.getAttribute('data-email')); });
    card.querySelector('[data-act=outbox]').onclick = () => openOutbox();
    card.querySelector('[data-act=reset]').onclick = () => {
      if (confirm('Se borrarán todos los cambios que hiciste y se restaurarán los datos de ejemplo. ¿Continuar?')) O.resetAll(true);
    };
    updateCounter();
  }

  function init() {
    // basePath: ruta relativa a la raíz del sitio (definida por el build: window.__DEMO_BASE__)
    O.basePath = window.__DEMO_BASE__ || './';
    root = el('div', { id: 'demo-root' });
    const style = el('style'); style.textContent = css; root.appendChild(style);
    pill = el('button', { class: 'odm-pill', 'aria-label': 'Abrir panel de la demo' }, '<span class="odm-dot"></span>DEMO · ' + esc(O.appConfig.title || ''));
    card = el('div', { class: 'odm-card' });
    toasts = el('div', { class: 'odm-toast-wrap' });
    modal = el('div', { class: 'odm-modal' }, '<div class="odm-mbox"><div class="odm-mh"><span>📬 Bandeja de correos simulados</span><button class="odm-x" aria-label="Cerrar">×</button></div><div class="odm-mb"></div></div>');
    root.append(pill, card, toasts, modal);
    document.body.appendChild(root);
    buildCard();
    pill.onclick = () => { buildCard(); card.classList.toggle('open'); };
    modal.querySelector('.odm-x').onclick = () => modal.classList.remove('open');
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
    toasts.addEventListener('click', e => { const id = e.target && e.target.getAttribute && e.target.getAttribute('data-mail'); if (id) openOutbox(id); });
    // Abrir automáticamente el panel de accesos rápidos en pantallas de login (solo la primera vez por sesión)
    setTimeout(() => {
      const hasLogin = Array.from(document.querySelectorAll('input[type=password]')).some(visible);
      if (hasLogin && O.appConfig.autoOpen !== false && !sessionStorage.getItem('demo-card-shown')) {
        sessionStorage.setItem('demo-card-shown', '1'); card.classList.add('open');
      }
    }, 900);
    O._readyHooks.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
