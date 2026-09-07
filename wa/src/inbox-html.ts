// La bandeja: una sola página, sin dependencias ni build, servida tal cual por el
// Worker. Pensada para el celular primero (lista de chats → conversación, como
// WhatsApp) y en pantalla grande se abre a dos columnas.
//
// El HTML no lleva secretos ni datos: todo lo pide a /inbox/api/* con la cookie de
// sesión. Sin sesión, /inbox/api/me responde 401 y la página muestra el login (o el
// alta del primer usuario si la tabla está vacía).
//
// Está en String.raw para que las barras invertidas del JS lleguen tal cual; por eso
// aquí adentro NO puede haber acentos graves (`) ni "${".

export function inboxIcon(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#008069"/><path d="M32 14c-10.5 0-19 7.6-19 17 0 4.1 1.6 7.9 4.3 10.9L15 50l8.7-3.5C26.2 47.5 29 48 32 48c10.5 0 19-7.6 19-17S42.5 14 32 14z" fill="#fff"/><circle cx="24" cy="31" r="2.6" fill="#008069"/><circle cx="32" cy="31" r="2.6" fill="#008069"/><circle cx="40" cy="31" r="2.6" fill="#008069"/></svg>`;
}

export function inboxPage(): string {
  return String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="theme-color" content="#008069" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#202c33" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Bandeja">
<link rel="manifest" href="/inbox/manifest.json">
<link rel="icon" href="/inbox/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/inbox/icon.svg">
<title>Bandeja</title>
<style>
  :root {
    color-scheme: light dark;
    --chat:#efeae2; --panel:#fff; --bar:#f0f2f5; --line:#e9edef; --ink:#111b21; --dim:#667781;
    --mine:#d9fdd3; --theirs:#fff; --accent:#008069; --accent2:#25d366; --warn:#b45309; --warnbg:#fef3c7;
    --danger:#b42318; --hover:#f5f6f6; --sel:#f0f2f5; --shadow:0 1px .5px rgba(11,20,26,.13);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --chat:#0b141a; --panel:#111b21; --bar:#202c33; --line:#222d34; --ink:#e9edef; --dim:#8696a0;
      --mine:#005c4b; --theirs:#202c33; --accent:#00a884; --accent2:#00a884; --warn:#fbbf24; --warnbg:#3a2f10;
      --danger:#f87171; --hover:#202c33; --sel:#2a3942; --shadow:0 1px .5px rgba(0,0,0,.3);
    }
  }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent }
  html, body { height:100% }
  body { margin:0; background:var(--panel); color:var(--ink); overscroll-behavior:none;
         font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif }
  button, input, select, textarea { font:inherit; color:inherit }
  button { cursor:pointer; border:0; background:none; padding:0 }
  [hidden] { display:none !important }

  /* ── auth ── */
  #auth { min-height:100dvh; display:flex; align-items:center; justify-content:center; padding:1.5rem;
          background:linear-gradient(var(--accent) 0 0) top / 100% 220px no-repeat, var(--bar) }
  .card { background:var(--panel); border-radius:14px; padding:1.6rem 1.4rem; width:100%; max-width:22rem;
          box-shadow:0 6px 24px rgba(0,0,0,.18) }
  .card h1 { margin:0 0 .25rem; font-size:20px }
  .card p { margin:0 0 1.1rem; color:var(--dim); font-size:14px }
  .card label { display:block; font-size:13px; color:var(--dim); margin:.7rem 0 .25rem }
  .card input { width:100%; padding:.65rem .75rem; border-radius:8px; border:1px solid var(--line);
                background:var(--bar); font-size:16px }
  .card .primary { margin-top:1.2rem; width:100% }
  .err { color:var(--danger); font-size:13px; margin:.6rem 0 0; min-height:1.2em }

  .primary { background:var(--accent); color:#fff; font-weight:600; padding:.7rem 1.1rem; border-radius:24px }
  .primary:disabled { opacity:.5; cursor:default }
  .ghost { color:var(--accent); font-weight:600; padding:.45rem .8rem; border-radius:20px; border:1px solid var(--line) }
  .ghost.warn { color:var(--warn) }
  .iconbtn { width:40px; height:40px; border-radius:50%; display:inline-flex; align-items:center;
             justify-content:center; color:var(--dim); font-size:20px }
  .iconbtn:hover { background:var(--hover) }

  /* ── app shell ── */
  #app { display:flex; height:100dvh; overflow:hidden }
  #list { flex:1; min-width:0; display:flex; flex-direction:column; background:var(--panel) }
  #pane { flex:1; min-width:0; display:none; flex-direction:column; background:var(--chat) }
  body.open #list { display:none }
  body.open #pane { display:flex }
  @media (min-width: 760px) {
    #list { flex:none; width:380px; border-right:1px solid var(--line) }
    #pane { display:flex }
    body.open #list { display:flex }
    #back { display:none }
  }

  .bar { background:var(--bar); padding:.5rem .6rem .5rem .9rem; display:flex; align-items:center; gap:.6rem;
         min-height:60px; padding-top:calc(.5rem + env(safe-area-inset-top)) }
  .bar .title { font-weight:600; font-size:17px; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
  .bar .sub { font-size:12.5px; color:var(--dim); font-weight:400; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }

  .avatar { width:44px; height:44px; border-radius:50%; flex:none; display:flex; align-items:center;
            justify-content:center; color:#fff; font-weight:600; font-size:17px }
  .avatar.sm { width:36px; height:36px; font-size:15px }

  .chips { display:flex; gap:.4rem; padding:.55rem .9rem; border-bottom:1px solid var(--line); overflow-x:auto }
  .chip { font-size:13px; padding:.28rem .75rem; border-radius:16px; background:var(--bar); color:var(--dim); flex:none }
  .chip.on { background:var(--accent); color:#fff }
  @media (prefers-color-scheme: dark) { .chip.on { background:#0a332c; color:var(--accent) } }

  #threads { flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch }
  .t { display:flex; gap:.8rem; padding:.7rem .9rem; align-items:center; cursor:pointer }
  .t:hover { background:var(--hover) }
  .t.on { background:var(--sel) }
  .t .body { flex:1; min-width:0; border-bottom:1px solid var(--line); padding:.35rem 0; align-self:stretch }
  .t .top { display:flex; justify-content:space-between; gap:.5rem; align-items:baseline }
  .t .who { font-weight:500; font-size:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
  .t .when { font-size:12px; color:var(--dim); flex:none }
  .t.pending .when { color:var(--accent2); font-weight:600 }
  .t .prev { font-size:14px; color:var(--dim); display:flex; gap:.4rem; align-items:center; margin-top:.1rem }
  .t .prev span.text { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
  .t.pending .prev span.text { color:var(--ink) }
  .dot { width:9px; height:9px; border-radius:50%; background:var(--accent2); flex:none }
  .tag { font-size:10.5px; padding:.08rem .45rem; border-radius:6px; background:var(--bar); color:var(--dim);
         text-transform:uppercase; letter-spacing:.03em; flex:none; font-weight:600 }
  .tag.lead { background:var(--accent); color:#fff }
  .tag.human { background:var(--warnbg); color:var(--warn) }
  .empty { margin:auto; color:var(--dim); text-align:center; padding:2rem 1rem }

  /* ── conversación ── */
  #msgs { flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:.8rem 4% 1rem;
          display:flex; flex-direction:column; gap:.2rem }
  .day { align-self:center; font-size:12px; color:var(--dim); background:var(--panel); padding:.3rem .7rem;
         border-radius:8px; margin:.6rem 0 .4rem; box-shadow:var(--shadow) }
  .m { max-width:min(80%,36rem); padding:.4rem .55rem .3rem .65rem; border-radius:8px; white-space:pre-wrap;
       word-wrap:break-word; box-shadow:var(--shadow); position:relative; font-size:14.5px }
  .m.in  { align-self:flex-start; background:var(--theirs); border-top-left-radius:0 }
  .m.out { align-self:flex-end; background:var(--mine); border-top-right-radius:0 }
  .m + .m.in, .m + .m.out { margin-top:.15rem }
  .m.in + .m.out, .m.out + .m.in { margin-top:.5rem }
  .m .meta { font-size:11px; color:var(--dim); margin-top:.15rem; text-align:right; white-space:nowrap }
  .m .pic { display:block; max-width:100%; max-height:22rem; border-radius:6px; margin:-.15rem -.3rem .25rem -.4rem;
            width:calc(100% + .7rem); object-fit:cover; background:var(--bar); cursor:zoom-in }
  .m audio, .m video { display:block; max-width:100%; margin:.1rem 0 .3rem }
  .m .doc { display:flex; align-items:center; gap:.55rem; padding:.45rem .55rem; margin:0 0 .3rem;
            background:rgba(0,0,0,.06); border-radius:6px; color:inherit; text-decoration:none }
  @media (prefers-color-scheme: dark) { .m .doc { background:rgba(255,255,255,.06) } }
  .m .doc svg { width:26px; height:26px; flex:none; color:var(--accent) }
  .m .doc .n { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500 }
  .m .doc small { display:block; color:var(--dim); font-size:11.5px; font-weight:400 }
  .m .cap { white-space:pre-wrap }
  .m .meta b { font-weight:500 }
  .m.sys { align-self:center; background:var(--warnbg); color:var(--warn); font-size:12.5px; max-width:90%;
           border-radius:8px; text-align:center }
  .note { margin:0 4% .5rem; background:var(--warnbg); color:var(--warn); font-size:13px; padding:.5rem .8rem;
          border-radius:8px; text-align:center }

  #composer { background:var(--bar); padding:.45rem .6rem; display:flex; gap:.5rem; align-items:flex-end;
              padding-bottom:calc(.45rem + env(safe-area-inset-bottom)) }
  #text { flex:1; resize:none; border:0; border-radius:20px; padding:.6rem .9rem; background:var(--panel);
          font-size:16px; line-height:1.35; max-height:8rem; min-height:40px }
  #text:disabled { opacity:.6 }
  #send { width:44px; height:44px; border-radius:50%; background:var(--accent); color:#fff; flex:none;
          display:flex; align-items:center; justify-content:center }
  #send:disabled { opacity:.45 }
  #send svg { width:22px; height:22px; margin-left:3px }

  /* ── menús / modales ── */
  .menu { position:relative }
  .dd { position:absolute; right:0; top:44px; background:var(--panel); border-radius:10px; min-width:12rem;
        box-shadow:0 4px 18px rgba(0,0,0,.25); z-index:10; padding:.35rem 0; overflow:hidden }
  .dd button { display:block; width:100%; text-align:left; padding:.65rem 1rem; font-size:15px }
  .dd button:hover { background:var(--hover) }
  .dd button.danger { color:var(--danger) }
  #modal { position:fixed; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:flex-end;
           justify-content:center; z-index:20 }
  @media (min-width:600px) { #modal { align-items:center } }
  .sheet { background:var(--panel); width:100%; max-width:30rem; max-height:88dvh; overflow-y:auto;
           border-radius:16px 16px 0 0; padding:1.1rem 1.2rem calc(1.2rem + env(safe-area-inset-bottom)) }
  @media (min-width:600px) { .sheet { border-radius:16px } }
  .sheet h2 { margin:0 0 .8rem; font-size:17px; display:flex; justify-content:space-between; align-items:center }
  .sheet label { display:block; font-size:13px; color:var(--dim); margin:.6rem 0 .2rem }
  .sheet input, .sheet select { width:100%; padding:.6rem .7rem; border-radius:8px; border:1px solid var(--line);
                                background:var(--bar); font-size:16px }
  .sheet .row { display:flex; gap:.5rem; margin-top:1rem; justify-content:flex-end; flex-wrap:wrap }
  .sheet .kv { display:grid; grid-template-columns:auto 1fr; gap:.3rem .9rem; font-size:14px; margin:.4rem 0 .8rem }
  .sheet .kv span:nth-child(odd) { color:var(--dim) }
  .u { display:flex; align-items:center; gap:.7rem; padding:.55rem 0; border-bottom:1px solid var(--line) }
  .u .info { flex:1; min-width:0 } .u .info small { display:block; color:var(--dim); font-size:12.5px }
  .u.off .info { opacity:.5; text-decoration:line-through }
  .u select { width:auto; padding:.3rem .4rem; font-size:14px }
  .u .ghost { padding:.3rem .6rem; font-size:13px }
  #toast { position:fixed; left:50%; bottom:calc(5.5rem + env(safe-area-inset-bottom)); transform:translateX(-50%);
           background:#111b21; color:#fff; padding:.6rem 1rem; border-radius:10px; font-size:14px; z-index:30;
           max-width:90%; box-shadow:0 4px 16px rgba(0,0,0,.3) }
</style>
</head>
<body>

<div id="auth" hidden>
  <form class="card" id="loginForm" hidden autocomplete="on">
    <h1>Bandeja</h1>
    <p>WhatsApp de Tratto</p>
    <label>Correo</label><input name="email" type="email" autocomplete="username" required autocapitalize="none">
    <label>Contraseña</label><input name="password" type="password" autocomplete="current-password" required>
    <div class="err" id="loginErr"></div>
    <button class="primary" type="submit">Entrar</button>
  </form>
  <form class="card" id="setupForm" hidden autocomplete="off">
    <h1>Primer usuario</h1>
    <p>No hay cuentas todavía. Crea la tuya: será la administradora.</p>
    <label>ADMIN_TOKEN del gateway</label><input name="token" type="password" required>
    <label>Tu nombre</label><input name="name" required>
    <label>Correo</label><input name="email" type="email" required autocapitalize="none">
    <label>Contraseña (mín. 8)</label><input name="password" type="password" autocomplete="new-password" required minlength="8">
    <div class="err" id="setupErr"></div>
    <button class="primary" type="submit">Crear cuenta y entrar</button>
  </form>
</div>

<div id="app" hidden>
  <aside id="list">
    <div class="bar">
      <div class="avatar sm" id="meAvatar"></div>
      <div class="title">Bandeja<div class="sub" id="meName"></div></div>
      <div class="menu">
        <button class="iconbtn" id="menuBtn" aria-label="Menú">&#8942;</button>
        <div class="dd" id="menu" hidden>
          <button data-act="users" id="usersItem" hidden>Usuarios</button>
          <button data-act="password">Cambiar contraseña</button>
          <button data-act="notif" id="notifItem">Activar avisos</button>
          <button data-act="logout" class="danger">Salir</button>
        </div>
      </div>
    </div>
    <div class="chips">
      <button class="chip on" data-f="todos">Todos</button>
      <button class="chip" data-f="pendientes">Por contestar</button>
      <button class="chip" data-f="leads">Leads</button>
    </div>
    <div id="threads"></div>
  </aside>

  <main id="pane">
    <div class="bar">
      <button class="iconbtn" id="back" aria-label="Atrás">&#8592;</button>
      <div class="avatar sm" id="tAvatar"></div>
      <div class="title" id="tTitle"></div>
      <button class="ghost" id="handoff" hidden></button>
      <div class="menu">
        <button class="iconbtn" id="tMenuBtn" aria-label="Opciones">&#8942;</button>
        <div class="dd" id="tMenu" hidden>
          <button data-act="details">Detalles del contacto</button>
          <button data-act="refresh">Actualizar</button>
        </div>
      </div>
    </div>
    <div id="msgs"><div class="empty">Elige una conversación</div></div>
    <div class="note" id="note" hidden></div>
    <div id="composer" hidden>
      <textarea id="text" rows="1" placeholder="Escribe un mensaje"></textarea>
      <button id="send" aria-label="Enviar"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M1.1 21.8 23 12 1.1 2.2 1 9.8l15.6 2.2L1 14.2z"/></svg></button>
    </div>
  </main>
</div>

<div id="modal" hidden><div class="sheet" id="sheet"></div></div>

<script>
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var me = null, threads = [], current = null, filter = 'todos', tenants = [];
  var pollTimer = null, lastSig = '';
  var coarse = window.matchMedia('(pointer: coarse)').matches;

  // ── util ──
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  // Las fechas de D1 vienen en UTC sin zona; sin la Z el navegador las lee como
  // locales y todo aparece con seis horas de menos.
  function utc(s) { return s ? new Date(s.replace(' ', 'T') + 'Z') : null; }
  function hhmm(d) { return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }); }
  function sameDay(a, b) { return a.toDateString() === b.toDateString(); }
  function dayLabel(d) {
    var now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, now)) return 'Hoy';
    if (sameDay(d, y)) return 'Ayer';
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }
  function when(s) {
    var d = utc(s); if (!d) return '';
    var now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, now)) return hhmm(d);
    if (sameDay(d, y)) return 'Ayer';
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  }
  function pretty(p) {
    var d = String(p || '').replace(/[^0-9]/g, '');
    if (d.length >= 12 && d.slice(0, 2) === '52') d = d.slice(-10);
    return d.length === 10 ? '+52 ' + d.slice(0, 2) + ' ' + d.slice(2, 6) + ' ' + d.slice(6) : '+' + d;
  }
  var PALETTE = ['#e17076','#7bc862','#e5ca77','#65aadd','#a695e7','#ee7aae','#6ec9cb','#faa774'];
  function color(key) { var h = 0; for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0; return PALETTE[h % PALETTE.length]; }
  function initial(name) { return (name || '?').trim().charAt(0).toUpperCase(); }
  function avatar(el, name, key) { el.textContent = initial(name); el.style.background = color(key || name || '?'); }
  function nameOf(t) { return t.profile_name || pretty(t.wa_from); }
  function humanActive(t) { var d = utc(t.human_until); return !!(d && d > new Date()); }
  function kb(n) { n = Number(n) || 0; return n < 1e6 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  var DOC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>';
  // Lo que hay en el globo aparte del texto. La URL lleva la sesión (cookie), no firma.
  function mediaHtml(m) {
    if (!m.media_key) return '';
    var src = '/inbox/api/media/' + m.media_key.split('/').map(encodeURIComponent).join('/');
    var mime = m.media_mime || '', name = m.media_name || 'archivo';
    if (mime.indexOf('image/') === 0) return '<a href="' + src + '" target="_blank" rel="noopener"><img class="pic" src="' + src + '" alt="' + esc(name) + '" loading="lazy"></a>';
    if (mime.indexOf('audio/') === 0) return '<audio controls preload="none" src="' + src + '"></audio>';
    if (mime.indexOf('video/') === 0) return '<video controls preload="metadata" src="' + src + '"></video>';
    return '<a class="doc" href="' + src + '" target="_blank" rel="noopener">' + DOC_ICON +
      '<span class="n">' + esc(name) + '<small>' + kb(m.media_size) + '</small></span></a>';
  }
  function isPending(t) { return t.last_direction === 'in' && (!t.tenant_slug || humanActive(t)); }
  function stale(t) { var d = utc(t.last_seen); return !d || (Date.now() - d.getTime()) > 24 * 3600 * 1000; }

  var toastTimer;
  function toast(msg) {
    var el = $('toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3500);
  }

  function api(path, data) {
    var opts = { credentials: 'same-origin' };
    if (data !== undefined) { opts.method = 'POST'; opts.headers = { 'content-type': 'application/json' }; opts.body = JSON.stringify(data); }
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && path.indexOf('/inbox/api/') === 0) { showAuth(!!j.setup); throw new Error('401'); }
        return { ok: r.ok, status: r.status, body: j };
      });
    });
  }

  // ── auth ──
  function showAuth(setup) {
    stopPolling();
    $('app').hidden = true; $('auth').hidden = false;
    $('loginForm').hidden = setup; $('setupForm').hidden = !setup;
    document.body.classList.remove('open');
    var f = setup ? $('setupForm') : $('loginForm');
    var first = f.querySelector('input'); if (first) setTimeout(function () { first.focus(); }, 50);
  }
  function formData(f) { var o = {}; new FormData(f).forEach(function (v, k) { o[k] = v; }); return o; }
  $('loginForm').onsubmit = function (e) {
    e.preventDefault(); $('loginErr').textContent = '';
    var btn = this.querySelector('button'); btn.disabled = true;
    api('/inbox/login', formData(this)).then(function (r) {
      btn.disabled = false;
      if (!r.ok) { $('loginErr').textContent = r.body.error || 'no se pudo entrar'; return; }
      $('loginForm').reset(); boot();
    });
  };
  $('setupForm').onsubmit = function (e) {
    e.preventDefault(); $('setupErr').textContent = '';
    var btn = this.querySelector('button'); btn.disabled = true;
    api('/inbox/setup', formData(this)).then(function (r) {
      btn.disabled = false;
      if (!r.ok) { $('setupErr').textContent = r.body.error || 'no se pudo crear'; return; }
      boot();
    });
  };

  function boot() {
    api('/inbox/api/me').then(function (r) {
      me = r.body.user;
      $('auth').hidden = true; $('app').hidden = false;
      $('meName').textContent = me.name; avatar($('meAvatar'), me.name, me.email);
      $('usersItem').hidden = me.role !== 'admin';
      $('notifItem').hidden = !('Notification' in window) || Notification.permission === 'granted';
      api('/inbox/api/tenants').then(function (t) { tenants = t.body || []; });
      var hash = location.hash.slice(1);
      loadThreads().then(function () { if (hash) open(hash); });
      startPolling();
    }).catch(function () {});
  }

  // ── lista ──
  function loadThreads() {
    return api('/inbox/api/threads').then(function (r) {
      var prev = threads; threads = r.body || [];
      drawThreads(); notifyNew(prev, threads);
    });
  }
  function visible() {
    return threads.filter(function (t) {
      if (filter === 'leads') return !t.tenant_slug;
      if (filter === 'pendientes') return isPending(t);
      return true;
    });
  }
  function drawThreads() {
    var rows = visible();
    var pend = threads.filter(isPending).length;
    document.title = (pend ? '(' + pend + ') ' : '') + 'Bandeja';
    $('threads').innerHTML = rows.map(function (t) {
      var name = nameOf(t), human = humanActive(t), pending = isPending(t);
      var tags = t.tenant_slug ? '<span class="tag">' + esc(t.tenant_slug) + '</span>' : '<span class="tag lead">lead</span>';
      if (human) tags += '<span class="tag human">' + esc(t.human_by === me.name ? 'tú' : (t.human_by || 'humano')) + '</span>';
      var prefix = t.last_direction === 'out' ? '<span style="color:var(--dim)">&#10003;</span>' : '';
      return '<div class="t' + (t.phone10 === current ? ' on' : '') + (pending ? ' pending' : '') + '" data-p="' + t.phone10 + '">' +
        '<div class="avatar" style="background:' + color(t.phone10) + '">' + esc(initial(name)) + '</div>' +
        '<div class="body"><div class="top"><span class="who">' + esc(name) + '</span><span class="when">' + when(t.last_seen) + '</span></div>' +
        '<div class="prev">' + prefix + '<span class="text">' + esc(t.last_body || '') + '</span>' + tags + (pending ? '<span class="dot"></span>' : '') + '</div></div></div>';
    }).join('') || '<div class="empty">' + (filter === 'todos' ? 'Nadie ha escrito todavía.' : 'Nada por aquí.') + '</div>';
    Array.prototype.forEach.call(document.querySelectorAll('.t'), function (el) {
      el.onclick = function () { open(el.dataset.p); };
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) {
    c.onclick = function () {
      filter = c.dataset.f;
      Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (x) { x.classList.toggle('on', x === c); });
      drawThreads();
    };
  });

  // Aviso del navegador cuando entra algo por contestar y la pestaña no está al frente.
  function notifyNew(prev, now) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!prev.length || !document.hidden) return;   // ni en la primera carga ni con la pestaña al frente
    var seen = {}; prev.forEach(function (t) { seen[t.phone10] = t.last_seen; });
    now.forEach(function (t) {
      if (!isPending(t) || seen[t.phone10] === t.last_seen) return;
      try {
        var n = new Notification(nameOf(t), { body: t.last_body || '', tag: t.phone10, icon: '/inbox/icon.svg' });
        n.onclick = function () { window.focus(); open(t.phone10); };
      } catch (e) {}
    });
  }

  // ── conversación ──
  var thread = null;
  function open(p10) {
    current = p10; location.hash = p10;
    document.body.classList.add('open');
    drawThreads();
    return refreshThread(true);
  }
  function refreshThread(scrollToEnd) {
    if (!current) return Promise.resolve();
    var p10 = current;
    return api('/inbox/api/thread?phone=' + p10).then(function (r) {
      if (current !== p10) return;
      if (!r.ok) { toast(r.body.error || 'no se pudo abrir'); return; }
      thread = r.body.thread; var t = thread;
      var human = humanActive(t), mine = human && t.human_by === me.name;
      avatar($('tAvatar'), nameOf(t), t.phone10);
      var status = human
        ? ((mine ? 'Tuyo' : 'De ' + (t.human_by || 'alguien')) + ' hasta ' + hhmm(utc(t.human_until)))
        : (t.tenant_slug ? 'Agente de ' + t.tenant_slug : 'Lead · ' + (t.lead_status || 'nuevo'));
      $('tTitle').innerHTML = esc(nameOf(t)) + '<div class="sub">' + esc(status) + '</div>';
      var hb = $('handoff'); hb.hidden = false;
      hb.textContent = human ? 'Devolver' : 'Tomar';
      hb.className = 'ghost' + (human ? ' warn' : '');
      hb.onclick = function () {
        api('/inbox/api/handoff', { phone: p10, hours: human ? 0 : 6 }).then(function (r) {
          if (!r.ok) toast(r.body.error || 'falló');
          loadThreads(); refreshThread(false);
        });
      };

      var box = $('msgs');
      var atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
      var html = '', lastDay = null;
      (r.body.messages || []).forEach(function (m) {
        var d = utc(m.created_at);
        if (d && (!lastDay || !sameDay(d, lastDay))) { html += '<div class="day">' + dayLabel(d) + '</div>'; lastDay = d; }
        var media = mediaHtml(m);
        var body = m.body ? esc(m.body) : (media ? '' : esc('(' + m.kind + ')'));
        if (m.direction === 'out' && m.author === 'error') {
          html += '<div class="m sys">El agente falló: se mandó un aviso de error</div>';
        }
        var by = '';
        if (m.direction === 'out') {
          by = m.author === 'human' ? ((m.sent_by && m.sent_by !== me.name) ? m.sent_by : 'tú')
             : m.author === 'agent' ? 'agente' : m.author === 'ack' ? 'automático' : m.author === 'error' ? 'aviso' : '';
        }
        html += '<div class="m ' + (m.direction === 'out' ? 'out' : 'in') + '">' + media + (body ? '<span class="cap">' + body + '</span>' : '') +
          '<div class="meta">' + (by ? '<b>' + esc(by) + '</b> · ' : '') + (d ? hhmm(d) : '') + '</div></div>';
      });
      box.innerHTML = html || '<div class="empty">Sin mensajes</div>';
      if (scrollToEnd || atEnd) box.scrollTop = box.scrollHeight;

      var comp = $('composer'), ta = $('text'), btn = $('send'), note = $('note');
      comp.hidden = false;
      if (stale(t)) {
        ta.disabled = btn.disabled = true; ta.placeholder = 'Ventana cerrada';
        note.hidden = false;
        note.textContent = 'Hace más de 24 h que esta persona no escribe. WhatsApp solo permite responder con plantillas aprobadas, y no hay ninguna. Espera a que escriba de nuevo.';
      } else {
        ta.disabled = btn.disabled = false; ta.placeholder = 'Escribe un mensaje'; note.hidden = true;
      }
      if (scrollToEnd && !coarse && !ta.disabled) ta.focus();
    });
  }
  $('back').onclick = function () {
    current = null; thread = null; document.body.classList.remove('open');
    history.replaceState(null, '', location.pathname); drawThreads();
  };

  // ── enviar ──
  function autosize() { var ta = $('text'); ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 128) + 'px'; }
  $('text').oninput = autosize;
  function send() {
    var ta = $('text'), text = ta.value.trim();
    if (!text || !current) return;
    var btn = $('send'); btn.disabled = true;
    api('/inbox/api/send', { phone: current, text: text }).then(function (r) {
      btn.disabled = false;
      if (!r.ok) { toast((r.body.error || 'no se envió') + (r.body.detalle ? ': ' + r.body.detalle : '')); return; }
      ta.value = ''; autosize();
      refreshThread(true); loadThreads();
      if (!coarse) ta.focus();
    });
  }
  $('send').onclick = send;
  // En escritorio Enter manda; en el cel Enter salta línea y se manda con el botón,
  // igual que en WhatsApp.
  $('text').onkeydown = function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !coarse) { e.preventDefault(); send(); }
  };

  // ── menús ──
  function bindMenu(btnId, ddId, onAct) {
    var btn = $(btnId), dd = $(ddId);
    btn.onclick = function (e) { e.stopPropagation(); closeMenus(); dd.hidden = !dd.hidden; };
    Array.prototype.forEach.call(dd.querySelectorAll('button'), function (b) {
      b.onclick = function (e) { e.stopPropagation(); dd.hidden = true; onAct(b.dataset.act); };
    });
  }
  function closeMenus() { $('menu').hidden = true; $('tMenu').hidden = true; }
  document.addEventListener('click', closeMenus);

  bindMenu('menuBtn', 'menu', function (act) {
    if (act === 'logout') api('/inbox/logout', {}).then(function () { me = null; showAuth(false); });
    if (act === 'password') passwordSheet();
    if (act === 'users') usersSheet();
    if (act === 'notif') Notification.requestPermission().then(function (p) {
      $('notifItem').hidden = p === 'granted'; toast(p === 'granted' ? 'Avisos activados' : 'Avisos bloqueados');
    });
  });
  bindMenu('tMenuBtn', 'tMenu', function (act) {
    if (act === 'refresh') { refreshThread(false); loadThreads(); }
    if (act === 'details' && thread) detailsSheet(thread);
  });

  // ── modales ──
  function openSheet(html) { $('sheet').innerHTML = html; $('modal').hidden = false; }
  function closeSheet() { $('modal').hidden = true; $('sheet').innerHTML = ''; }
  $('modal').onclick = function (e) { if (e.target === this) closeSheet(); };
  function closeBtn() { return '<button class="iconbtn" data-close aria-label="Cerrar">&#10005;</button>'; }
  function wireClose() { var b = $('sheet').querySelector('[data-close]'); if (b) b.onclick = closeSheet; }

  function detailsSheet(t) {
    var opts = '<option value="">— sin cliente (lead) —</option>' + tenants.map(function (x) {
      return '<option value="' + esc(x.slug) + '"' + (x.slug === t.tenant_slug ? ' selected' : '') + '>' + esc(x.name) + '</option>';
    }).join('');
    var leadOpts = ['nuevo', 'contactado', 'descartado'].map(function (s) {
      return '<option' + ((t.lead_status || 'nuevo') === s ? ' selected' : '') + '>' + s + '</option>';
    }).join('');
    openSheet('<h2>' + esc(nameOf(t)) + closeBtn() + '</h2>' +
      '<div class="kv"><span>Teléfono</span><span>' + esc(pretty(t.wa_from)) + '</span>' +
      '<span>Primer mensaje</span><span>' + esc(when(t.first_seen)) + '</span>' +
      '<span>Mensajes</span><span>' + t.msg_count + '</span>' +
      '<span>Ruteo</span><span>' + esc(t.resolved_by) + '</span></div>' +
      '<label>Cliente</label><select id="dTenant">' + opts + '</select>' +
      (t.tenant_slug ? '' : '<label>Seguimiento del lead</label><select id="dLead">' + leadOpts + '</select>') +
      '<div class="row"><button class="primary" id="dSave">Guardar</button></div>');
    wireClose();
    $('dSave').onclick = function () {
      var tenant = $('dTenant').value || null;
      var ps = [];
      if (tenant !== t.tenant_slug) ps.push(api('/inbox/api/assign', { phone: t.phone10, tenant: tenant }));
      if ($('dLead') && $('dLead').value !== (t.lead_status || 'nuevo')) ps.push(api('/inbox/api/lead', { phone: t.phone10, status: $('dLead').value }));
      Promise.all(ps).then(function (rs) {
        var bad = rs.filter(function (r) { return !r.ok; })[0];
        if (bad) { toast(bad.body.error || 'falló'); return; }
        closeSheet(); loadThreads(); refreshThread(false);
      });
    };
  }

  function passwordSheet() {
    openSheet('<h2>Cambiar contraseña' + closeBtn() + '</h2>' +
      '<label>Actual</label><input id="pCur" type="password" autocomplete="current-password">' +
      '<label>Nueva (mín. 8)</label><input id="pNew" type="password" autocomplete="new-password">' +
      '<div class="err" id="pErr"></div><div class="row"><button class="primary" id="pSave">Guardar</button></div>');
    wireClose();
    $('pSave').onclick = function () {
      api('/inbox/api/password', { current: $('pCur').value, next: $('pNew').value }).then(function (r) {
        if (!r.ok) { $('pErr').textContent = r.body.error || 'falló'; return; }
        closeSheet(); toast('Contraseña cambiada');
      });
    };
  }

  function usersSheet() {
    api('/inbox/api/users').then(function (r) {
      var users = r.body || [];
      openSheet('<h2>Usuarios' + closeBtn() + '</h2>' +
        users.map(function (u) {
          var self = u.id === me.id;
          return '<div class="u' + (u.active ? '' : ' off') + '"><div class="avatar sm" style="background:' + color(u.email) + '">' + esc(initial(u.name)) + '</div>' +
            '<div class="info">' + esc(u.name) + (self ? ' (tú)' : '') + '<small>' + esc(u.email) + (u.last_login_at ? ' · entró ' + when(u.last_login_at) : ' · nunca ha entrado') + '</small></div>' +
            '<select data-role="' + u.id + '"' + (self ? ' disabled' : '') + '><option value="agente"' + (u.role === 'agente' ? ' selected' : '') + '>agente</option><option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>admin</option></select>' +
            '<button class="ghost" data-reset="' + u.id + '" title="Nueva contraseña">&#128273;</button>' +
            (self ? '' : '<button class="ghost' + (u.active ? ' warn' : '') + '" data-toggle="' + u.id + '" data-on="' + u.active + '">' + (u.active ? 'Baja' : 'Alta') + '</button>') +
            '</div>';
        }).join('') +
        '<h2 style="margin-top:1.2rem">Nuevo usuario</h2>' +
        '<label>Nombre</label><input id="nName">' +
        '<label>Correo</label><input id="nEmail" type="email" autocapitalize="none">' +
        '<label>Contraseña inicial (mín. 8)</label><input id="nPass" type="text" autocomplete="off">' +
        '<label>Rol</label><select id="nRole"><option value="agente">agente</option><option value="admin">admin</option></select>' +
        '<div class="err" id="nErr"></div>' +
        '<p style="font-size:13px;color:var(--dim);margin:.6rem 0 0">Pásale la contraseña por otro canal; la puede cambiar desde su menú.</p>' +
        '<div class="row"><button class="primary" id="nSave">Crear</button></div>');
      wireClose();
      var sheet = $('sheet');
      function upd(data) {
        return api('/inbox/api/users/update', data).then(function (r) {
          if (!r.ok) { toast(r.body.error || 'falló'); return false; }
          return true;
        });
      }
      Array.prototype.forEach.call(sheet.querySelectorAll('select[data-role]'), function (s) {
        s.onchange = function () { upd({ id: Number(s.dataset.role), role: s.value }).then(function (ok) { if (ok) toast('Rol actualizado'); }); };
      });
      Array.prototype.forEach.call(sheet.querySelectorAll('[data-toggle]'), function (b) {
        b.onclick = function () {
          var on = b.dataset.on === '1';
          if (on && !confirm('¿Dar de baja a este usuario? Se cierran sus sesiones.')) return;
          upd({ id: Number(b.dataset.toggle), active: !on }).then(function (ok) { if (ok) usersSheet(); });
        };
      });
      Array.prototype.forEach.call(sheet.querySelectorAll('[data-reset]'), function (b) {
        b.onclick = function () {
          var pw = prompt('Nueva contraseña para este usuario (mín. 8). Se cierran sus sesiones.');
          if (!pw) return;
          upd({ id: Number(b.dataset.reset), password: pw }).then(function (ok) { if (ok) toast('Contraseña cambiada'); });
        };
      });
      $('nSave').onclick = function () {
        $('nErr').textContent = '';
        api('/inbox/api/users', { name: $('nName').value, email: $('nEmail').value, password: $('nPass').value, role: $('nRole').value })
          .then(function (r) {
            if (!r.ok) { $('nErr').textContent = r.body.error || 'falló'; return; }
            toast('Usuario creado'); usersSheet();
          });
      };
    });
  }

  // ── polling ──
  function tick() {
    if (document.hidden) return;
    loadThreads().then(function () { if (current) refreshThread(false); }).catch(function () {});
  }
  function startPolling() { stopPolling(); pollTimer = setInterval(tick, 8000); }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && me) tick(); });
  window.addEventListener('focus', function () { if (me) tick(); });
  window.addEventListener('hashchange', function () {
    var h = location.hash.slice(1);
    if (me && h && h !== current) open(h);
  });

  boot();
})();
</script>
</body>
</html>`;
}
