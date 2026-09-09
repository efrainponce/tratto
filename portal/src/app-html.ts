// La app: una sola página, sin dependencias ni build, servida tal cual por el Worker.
// Celular primero (barra de navegación abajo), en pantalla grande columna centrada.
//
// Vistas: board de oportunidades (inicio) → oportunidad (= la cotización) · proyectos ·
// clientes → cliente (con contactos) · catálogo. Ajustes y contraseña en el menú ⋮.
//
// El HTML no lleva secretos ni datos: todo lo pide a /api/* con la cookie de sesión.
// Sin sesión, /api/me responde 401 y la página muestra el login (o el alta del
// primer usuario si la tabla está vacía).
//
// Está en String.raw para que las barras invertidas del JS lleguen tal cual; por eso
// aquí adentro NO puede haber acentos graves (`) ni "${".

export function appIcon(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1f4d3f"/><path d="M18 18h28v8H36v22h-8V26H18z" fill="#fff"/></svg>`;
}

export function appPage(): string {
  return String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="theme-color" content="#f7f4ee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#161412" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Tratto">
<meta name="robots" content="noindex">
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap">
<title>Portal Tratto</title>
<style>
  :root {
    color-scheme: light dark;
    --bg:#f7f4ee; --paper:#fff; --sunken:#efeae0; --line:#e4dfd3; --ink:#2b2925; --ink2:#726d61; --ink3:#918b7c;
    --accent:#1f4d3f; --accent-ink:#fff; --soft:#e3ece6; --warn:#8a5a00; --warnbg:#fdf1d6;
    --danger:#b42318; --dangerbg:#fde8e6; --hover:#f3f0e9; --shadow:0 1px 2px rgba(43,41,37,.05), 0 10px 30px -22px rgba(43,41,37,.35);
    --display:'Familjen Grotesk','Inter',system-ui,sans-serif; --body:'Inter',system-ui,-apple-system,sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:#161412; --paper:#1f1c18; --sunken:#121009; --line:#2e2a24; --ink:#efe9dd; --ink2:#aaa294; --ink3:#7f786c;
      --accent:#8cc4a8; --accent-ink:#10201a; --soft:#1e2f28; --warn:#fbbf24; --warnbg:#3a2f10;
      --danger:#f87171; --dangerbg:#3a1a18; --hover:#26221d; --shadow:0 1px 2px rgba(0,0,0,.3);
    }
  }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent }
  html { -webkit-text-size-adjust:100% }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 var(--body); min-height:100dvh }
  button, input, select, textarea { font:inherit; color:inherit }
  button { cursor:pointer; border:0; background:none; padding:0 }
  a { color:var(--accent) }
  [hidden] { display:none !important }
  h1, h2, h3 { font-family:var(--display); letter-spacing:-.01em; margin:0 }
  h1 { font-size:26px; line-height:1.15 } h2 { font-size:19px } h3 { font-size:16px }
  small, .dim { color:var(--ink2) }
  .mono { font-variant-numeric:tabular-nums }

  /* ── auth ── */
  #auth { min-height:100dvh; display:flex; align-items:center; justify-content:center; padding:1.5rem }
  .card { background:var(--paper); border:1px solid var(--line); border-radius:16px; padding:1.6rem 1.4rem; width:100%; max-width:22rem; box-shadow:var(--shadow) }
  .card h1 { display:flex; align-items:center; gap:.5rem; font-size:22px; margin-bottom:.2rem }
  .card p { margin:0 0 1rem; color:var(--ink2); font-size:14px }
  .brandmark { width:28px; height:28px; border-radius:8px; background:var(--accent); color:var(--accent-ink); display:inline-grid; place-items:center; font:700 17px var(--display) }

  label { display:block; font-size:12.5px; color:var(--ink2); margin:.7rem 0 .25rem; font-weight:500 }
  input, select, textarea { width:100%; padding:.62rem .75rem; border-radius:10px; border:1px solid var(--line); background:var(--paper); font-size:16px }
  input:focus, select:focus, textarea:focus { outline:2px solid var(--accent); outline-offset:-1px }
  textarea { resize:vertical; min-height:5rem; line-height:1.45 }
  .err { color:var(--danger); font-size:13px; margin:.6rem 0 0; min-height:1.2em }

  .btn { display:inline-flex; align-items:center; justify-content:center; gap:.4rem; padding:.62rem 1rem; border-radius:10px; font-weight:600; font-size:14.5px; border:1px solid transparent; white-space:nowrap; text-decoration:none }
  .btn.primary { background:var(--accent); color:var(--accent-ink) }
  .btn.ghost { background:var(--paper); color:var(--accent); border-color:var(--line) }
  .btn.danger { color:var(--danger); background:var(--paper); border-color:var(--line) }
  .btn.sm { padding:.4rem .7rem; font-size:13px; border-radius:8px }
  .btn.block { width:100% }
  .btn:disabled { opacity:.5; cursor:default }

  /* ── shell ── */
  #app { display:flex; flex-direction:column; min-height:100dvh }
  .topbar { position:sticky; top:0; z-index:5; background:color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter:blur(10px);
            border-bottom:1px solid var(--line); padding:calc(.5rem + env(safe-area-inset-top)) 1rem .5rem; display:flex; align-items:center; gap:.7rem; min-height:54px }
  .topbar .brand { display:flex; align-items:center; gap:.5rem; font:700 18px var(--display); text-decoration:none; color:var(--ink) }
  .topbar nav { display:none; gap:.2rem; margin-left:.5rem }
  .topbar nav a, .bottomnav a { text-decoration:none; color:var(--ink2); font-weight:500; padding:.4rem .7rem; border-radius:8px; font-size:14.5px }
  .topbar nav a.on { color:var(--accent); background:var(--soft) }
  .topbar .grow { flex:1 }
  .bottomnav { position:fixed; bottom:0; left:0; right:0; z-index:5; display:flex; background:var(--paper); border-top:1px solid var(--line);
               padding:.3rem .4rem calc(.3rem + env(safe-area-inset-bottom)) }
  .bottomnav a { flex:1; text-align:center; font-size:11.5px; display:flex; flex-direction:column; align-items:center; gap:.15rem; padding:.35rem .2rem }
  .bottomnav a svg { width:22px; height:22px }
  .bottomnav a.on { color:var(--accent) }
  main { flex:1; width:100%; max-width:52rem; margin:0 auto; padding:1rem 1rem 6rem }
  main.wide { max-width:none }
  @media (min-width:760px) {
    .topbar nav { display:flex }
    .bottomnav { display:none }
    main { padding:1.5rem 1.5rem 3rem }
  }
  .head { display:flex; align-items:center; gap:.7rem; margin-bottom:1rem; flex-wrap:wrap }
  .head h1 { flex:1; min-width:0 }
  .head .back { color:var(--ink2); font-size:22px; line-height:1; width:36px; height:36px; display:grid; place-items:center; border-radius:50%; margin-left:-.5rem }
  .head .back:hover { background:var(--hover) }

  /* ── board ── */
  .board { display:flex; gap:.6rem; overflow-x:auto; scroll-snap-type:x mandatory; margin:0 -1rem; padding:0 1rem 1rem; -webkit-overflow-scrolling:touch }
  @media (min-width:760px) { .board { margin:0 -1.5rem; padding:0 1.5rem 1rem } }
  .col { flex:none; width:min(82vw, 270px); scroll-snap-align:start; background:var(--sunken); border-radius:14px; padding:.55rem; display:flex; flex-direction:column; gap:.45rem; max-height:calc(100dvh - 190px) }
  .col h3 { display:flex; justify-content:space-between; align-items:baseline; padding:.15rem .35rem .3rem; font-size:12.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink2); font-family:var(--body); font-weight:600 }
  .col h3 b { font-weight:600; color:var(--ink3) }
  .col .cards { overflow-y:auto; display:flex; flex-direction:column; gap:.45rem; flex:1; min-height:3rem }
  .kcard { display:block; background:var(--paper); border:1px solid var(--line); border-radius:10px; padding:.6rem .7rem; text-decoration:none; color:inherit; font-size:14px; cursor:pointer; text-align:left; width:100% }
  .kcard:hover { border-color:var(--ink3) }
  .kcard .f { font-size:11.5px; color:var(--ink3); font-weight:600; letter-spacing:.03em; display:flex; justify-content:space-between }
  .kcard .c { font-weight:600; margin:.1rem 0 }
  .kcard .n { color:var(--ink2); font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
  .kcard .a { font:600 14px var(--display); margin-top:.3rem }
  .col .vacio { color:var(--ink3); font-size:13px; text-align:center; padding:.8rem 0 }

  /* ── listas ── */
  .search { display:flex; gap:.5rem; margin-bottom:.6rem }
  .list { display:flex; flex-direction:column; gap:.5rem }
  .item { display:block; background:var(--paper); border:1px solid var(--line); border-radius:12px; padding:.8rem .95rem; text-decoration:none; color:inherit; box-shadow:var(--shadow) }
  .item:hover { border-color:var(--ink3) }
  .item .r1 { display:flex; justify-content:space-between; gap:.6rem; align-items:baseline }
  .item .r1 b { font-weight:600; font-size:15.5px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
  .item .r2 { display:flex; gap:.5rem; align-items:center; color:var(--ink2); font-size:13.5px; margin-top:.15rem; flex-wrap:wrap }
  .item .amt { font-family:var(--display); font-weight:600; font-size:15px; white-space:nowrap }
  .tag { font-size:11px; padding:.1rem .5rem; border-radius:6px; background:var(--sunken); color:var(--ink2); text-transform:uppercase; letter-spacing:.04em; font-weight:600; white-space:nowrap }
  .tag.cotizada, .tag.negociacion, .tag.construccion, .tag.arranque { background:var(--warnbg); color:var(--warn) }
  .tag.ganada, .tag.en_renta { background:var(--accent); color:var(--accent-ink) }
  .tag.perdida { background:var(--dangerbg); color:var(--danger) }
  .empty { text-align:center; color:var(--ink2); padding:3rem 1rem }
  .empty p { margin:.3rem 0 1rem }

  /* ── paneles ── */
  .panel { background:var(--paper); border:1px solid var(--line); border-radius:14px; padding:1rem 1rem; box-shadow:var(--shadow); margin-bottom:.9rem }
  .panel h2 { font-size:16px; margin-bottom:.6rem; display:flex; justify-content:space-between; align-items:center; gap:.5rem }
  .panel h2 button, .panel h2 a { font-size:13.5px; font-weight:600; color:var(--accent); text-decoration:none; font-family:var(--body) }
  .kv { display:grid; grid-template-columns:auto 1fr; gap:.35rem 1rem; font-size:14.5px }
  .kv span:nth-child(odd) { color:var(--ink2) }
  .kv a { text-decoration:none }
  .row-item { display:flex; gap:.6rem; align-items:center; padding:.55rem 0; border-bottom:1px solid var(--line); font-size:14.5px }
  .row-item:last-child { border:0 }
  .row-item .info { flex:1; min-width:0 } .row-item .info small { display:block; color:var(--ink2); font-size:12.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
  .row-item.off .info { opacity:.5 }
  .row-item .price { font:600 14px var(--display); white-space:nowrap }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:0 .8rem }
  .grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:0 .8rem }
  @media (max-width:480px) { .grid3 { grid-template-columns:1fr 1fr } .grid3 > :first-child { grid-column:1 / -1 } }
  .estado-bar { display:flex; gap:.5rem; align-items:center; flex-wrap:wrap; margin-bottom:.9rem; font-size:14px }
  .estado-bar select { width:auto; padding:.4rem 2rem .4rem .7rem; font-size:14px }
  .actions { display:flex; gap:.5rem; flex-wrap:wrap; margin:.6rem 0 1rem }

  /* ── editor de cotización ── */
  .lineas { display:flex; flex-direction:column; gap:.5rem }
  .linea { background:var(--sunken); border-radius:10px; padding:.7rem .75rem; display:grid; grid-template-columns:1fr auto; gap:.4rem .6rem }
  .linea input.concepto { font-weight:600; background:transparent; border-color:transparent; padding:.3rem .4rem; margin:0 -.4rem }
  .linea input.concepto:focus, .linea textarea:focus, .linea input.num:focus { background:var(--paper); border-color:var(--line) }
  .linea textarea { grid-column:1 / -1; background:transparent; border-color:transparent; min-height:2.2rem; font-size:13.5px; padding:.3rem .4rem; margin:0 -.4rem; color:var(--ink2) }
  .linea .nums { grid-column:1 / -1; display:flex; gap:.5rem; align-items:center; font-size:13.5px; color:var(--ink2) }
  .linea .nums label { margin:0; font-size:12px }
  .linea input.num { width:6.5rem; text-align:right; padding:.35rem .5rem; font-size:15px; background:var(--paper) }
  .linea input.num.qty { width:4.2rem }
  .linea .imp { margin-left:auto; font:600 15px var(--display); color:var(--ink); white-space:nowrap }
  .linea .del { color:var(--ink3); font-size:20px; line-height:1; width:32px; height:32px; border-radius:50%; display:grid; place-items:center }
  .linea .del:hover { background:var(--dangerbg); color:var(--danger) }
  .addrow { display:flex; gap:.5rem; margin-top:.6rem }
  .addrow select { flex:1; font-size:14.5px; padding:.5rem .6rem }
  .totales { display:grid; grid-template-columns:1fr auto; gap:.25rem 1rem; font-size:14px; color:var(--ink2); margin-top:.7rem; padding-top:.6rem; border-top:1px solid var(--line) }
  .totales .t { color:var(--ink); font:600 18px var(--display) }
  .savebar { position:fixed; left:0; right:0; bottom:calc(58px + env(safe-area-inset-bottom)); z-index:6; display:flex; justify-content:center; padding:.5rem 1rem; pointer-events:none }
  @media (min-width:760px) { .savebar { bottom:1rem } }
  .savebar .btn { pointer-events:auto; box-shadow:0 8px 24px -8px rgba(0,0,0,.35) }

  /* ── menús / modales ── */
  .menu { position:relative }
  .dd { position:absolute; right:0; top:40px; background:var(--paper); border:1px solid var(--line); border-radius:10px; min-width:13rem; box-shadow:0 8px 28px -8px rgba(0,0,0,.35); z-index:10; padding:.3rem 0; overflow:hidden }
  .dd button { display:block; width:100%; text-align:left; padding:.6rem 1rem; font-size:14.5px }
  .dd button:hover { background:var(--hover) }
  .dd button.danger { color:var(--danger) }
  .iconbtn { width:38px; height:38px; border-radius:50%; display:inline-grid; place-items:center; color:var(--ink2); font-size:20px }
  .iconbtn:hover { background:var(--hover) }
  #modal { position:fixed; inset:0; background:rgba(20,18,15,.5); display:flex; align-items:flex-end; justify-content:center; z-index:20 }
  @media (min-width:600px) { #modal { align-items:center; padding:1rem } }
  .sheet { background:var(--paper); width:100%; max-width:32rem; max-height:90dvh; overflow-y:auto; border-radius:16px 16px 0 0; padding:1.1rem 1.2rem calc(1.2rem + env(safe-area-inset-bottom)) }
  @media (min-width:600px) { .sheet { border-radius:16px } }
  .sheet h2 { margin:0 0 .5rem }
  .sheet .row { display:flex; gap:.5rem; margin-top:1.1rem; justify-content:flex-end; flex-wrap:wrap }
  .sheet .row .left { margin-right:auto }
  #toast { position:fixed; left:50%; bottom:calc(72px + env(safe-area-inset-bottom)); transform:translateX(-50%); background:var(--ink); color:var(--bg); padding:.6rem 1rem; border-radius:10px; font-size:14px; z-index:30; max-width:90%; box-shadow:0 4px 16px rgba(0,0,0,.3) }
  @media (min-width:760px) { #toast { bottom:1.5rem } }
  .fab { position:fixed; right:1rem; bottom:calc(66px + env(safe-area-inset-bottom)); z-index:6; width:52px; height:52px; border-radius:16px; background:var(--accent); color:var(--accent-ink); font-size:28px; display:grid; place-items:center; box-shadow:0 8px 24px -6px rgba(0,0,0,.4) }
  @media (min-width:760px) { .fab { bottom:1.5rem; right:1.5rem } }
</style>
</head>
<body>

<div id="auth" hidden>
  <form class="card" id="loginForm" hidden autocomplete="on">
    <h1><span class="brandmark">T</span>Tratto</h1>
    <p>Oportunidades, cotizaciones y proyectos</p>
    <label>Correo</label><input name="email" type="email" autocomplete="username" required autocapitalize="none">
    <label>Contraseña</label><input name="password" type="password" autocomplete="current-password" required>
    <div class="err" id="loginErr"></div>
    <button class="btn primary block" type="submit" style="margin-top:1rem">Entrar</button>
  </form>
  <form class="card" id="setupForm" hidden autocomplete="off">
    <h1><span class="brandmark">T</span>Primer usuario</h1>
    <p>No hay cuentas todavía. Crea la tuya.</p>
    <label>ADMIN_TOKEN del Worker</label><input name="token" type="password" required>
    <label>Tu nombre</label><input name="name" required>
    <label>Correo</label><input name="email" type="email" required autocapitalize="none">
    <label>Contraseña (mín. 8)</label><input name="password" type="password" autocomplete="new-password" required minlength="8">
    <div class="err" id="setupErr"></div>
    <button class="btn primary block" type="submit" style="margin-top:1rem">Crear cuenta y entrar</button>
  </form>
</div>

<div id="app" hidden>
  <header class="topbar">
    <a class="brand" href="#/"><span class="brandmark">T</span>Tratto</a>
    <nav>
      <a href="#/" data-nav="board">Oportunidades</a>
      <a href="#/proyectos" data-nav="proyectos">Proyectos</a>
      <a href="#/clientes" data-nav="clientes">Clientes</a>
      <a href="#/catalogo" data-nav="catalogo">Catálogo</a>
    </nav>
    <div class="grow"></div>
    <div class="menu">
      <button class="iconbtn" id="menuBtn" aria-label="Menú">&#8942;</button>
      <div class="dd" id="menu" hidden>
        <button data-act="ajustes">Datos de Tratto</button>
        <button data-act="password">Cambiar contraseña</button>
        <button data-act="logout" class="danger">Salir</button>
      </div>
    </div>
  </header>
  <main id="view"></main>
  <nav class="bottomnav">
    <a href="#/" data-nav="board"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/></svg>Oportunidades</a>
    <a href="#/proyectos" data-nav="proyectos"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>Proyectos</a>
    <a href="#/clientes" data-nav="clientes"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-5-6.7"/></svg>Clientes</a>
    <a href="#/catalogo" data-nav="catalogo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>Catálogo</a>
  </nav>
</div>

<div id="modal" hidden><div class="sheet" id="sheet"></div></div>

<script>
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var me = null, cfg = null;
  var ETIQ = { nueva:'Nueva', cotizada:'Cotizada', negociacion:'Negociación', ganada:'Ganada', perdida:'Perdida',
               entrevistas:'Entrevistas', construccion:'Construcción', arranque:'Arranque', en_renta:'En renta', terminado:'Terminado',
               unico:'Pago único', mensual:'Mensual' };

  // ── util ──
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  function utc(s) { return s ? new Date(s.replace(' ', 'T') + (s.length === 10 ? 'T12:00:00' : 'Z')) : null; }
  var fmtMoney = new Intl.NumberFormat('es-MX', { style:'currency', currency:'MXN', minimumFractionDigits:2 });
  function mxn(n) { return fmtMoney.format(Number(n) || 0); }
  function fecha(s) { var d = utc(s); return d ? d.toLocaleDateString('es-MX', { day:'numeric', month:'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : ''; }
  function hace(s) {
    var d = utc(s); if (!d) return '';
    var m = Math.round((Date.now() - d.getTime()) / 60000);
    if (m < 1) return 'ahora'; if (m < 60) return 'hace ' + m + ' min';
    var h = Math.round(m / 60); if (h < 24) return 'hace ' + h + ' h';
    var dd = Math.round(h / 24); if (dd < 7) return 'hace ' + dd + ' d';
    return fecha(s);
  }
  function tag(v) { return '<span class="tag ' + esc(v) + '">' + esc(ETIQ[v] || v) + '</span>'; }
  function phoneDigits(p) { var d = String(p || '').replace(/[^0-9]/g, ''); return d.length === 10 ? '52' + d : d; }
  function waLink(p, text) { var d = phoneDigits(p); return d ? 'https://wa.me/' + d + (text ? '?text=' + encodeURIComponent(text) : '') : null; }
  function totales(lineas, iva) {
    var t = { unico:{ subtotal:0, iva:0, total:0, lineas:0 }, mensual:{ subtotal:0, iva:0, total:0, lineas:0 } };
    lineas.forEach(function (l) { var b = l.periodicidad === 'unico' ? t.unico : t.mensual; b.subtotal += (Number(l.cantidad) || 0) * (Number(l.precio) || 0); b.lineas++; });
    [t.unico, t.mensual].forEach(function (b) { b.subtotal = Math.round(b.subtotal * 100) / 100; b.iva = Math.round(b.subtotal * iva) / 100; b.total = Math.round((b.subtotal + b.iva) * 100) / 100; });
    return t;
  }
  function resumenTotales(t) {
    var parts = [];
    if (t.unico.lineas) parts.push(mxn(t.unico.total));
    if (t.mensual.lineas) parts.push(mxn(t.mensual.total) + '/mes');
    return parts.join(' + ') || 'sin líneas';
  }
  function opciones(list, sel, labels) { return list.map(function (v) { return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(labels ? labels(v) : (ETIQ[v] || v)) + '</option>'; }).join(''); }
  function formData(form) { var o = {}; new FormData(form).forEach(function (v, k) { o[k] = v; }); return o; }

  var toastTimer;
  function toast(msg) {
    var el = $('toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3000);
  }
  function copiar(text) {
    var done = function () { toast('Enlace copiado'); };
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(done, function () { prompt('Copia el enlace:', text); });
    prompt('Copia el enlace:', text);
  }
  function api(path, data) {
    var opts = { credentials:'same-origin' };
    if (data !== undefined) { opts.method = 'POST'; opts.headers = { 'content-type':'application/json' }; opts.body = JSON.stringify(data); }
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && path.indexOf('/api/') === 0) { showAuth(!!j.setup); throw new Error('401'); }
        if (!r.ok) throw new Error(j.error || ('error ' + r.status));
        return j;
      });
    });
  }
  function fail(err) { if (err.message !== '401') toast(err.message); }

  // ── modal ──
  function openSheet(html) { $('sheet').innerHTML = html; $('modal').hidden = false; var f = $('sheet').querySelector('input:not([type=hidden]),textarea,select'); if (f && !window.matchMedia('(pointer: coarse)').matches) f.focus(); var x = $('sheet').querySelector('[data-x]'); if (x) x.onclick = closeSheet; }
  function closeSheet() { $('modal').hidden = true; $('sheet').innerHTML = ''; }
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeSheet(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
  function confirmar(msg, ok) {
    openSheet('<h2>' + esc(msg) + '</h2><div class="row"><button class="btn ghost" data-x>Cancelar</button><button class="btn danger" data-ok>Sí, adelante</button></div>');
    $('sheet').querySelector('[data-ok]').onclick = function () { closeSheet(); ok(); };
  }
  // Formulario en sheet: html de campos + submit → api(url, datos) → onOk(respuesta).
  function sheetForm(titulo, campos, url, onOk, extra) {
    openSheet('<h2>' + esc(titulo) + '</h2><form id="sf">' + campos + '<div class="err" id="sfErr"></div><div class="row">' + (extra || '') +
      '<button type="button" class="btn ghost" data-x>Cancelar</button><button class="btn primary">Guardar</button></div></form>');
    $('sf').onsubmit = function (e) {
      e.preventDefault();
      var d = formData(e.target);
      e.target.querySelectorAll('input[type=checkbox]').forEach(function (c) { d[c.name] = c.checked; });
      api(url, d).then(function (r) { closeSheet(); onOk(r); }).catch(function (err) { $('sfErr').textContent = err.message; });
    };
    return $('sf');
  }

  // ── auth ──
  function showAuth(setup) { $('app').hidden = true; $('auth').hidden = false; $('loginForm').hidden = setup; $('setupForm').hidden = !setup; }
  $('loginForm').onsubmit = function (e) { e.preventDefault(); $('loginErr').textContent = ''; api('/login', formData(e.target)).then(boot).catch(function (err) { $('loginErr').textContent = err.message; }); };
  $('setupForm').onsubmit = function (e) { e.preventDefault(); $('setupErr').textContent = ''; api('/setup', formData(e.target)).then(boot).catch(function (err) { $('setupErr').textContent = err.message; }); };

  // ── menú ──
  $('menuBtn').onclick = function (e) { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; };
  document.addEventListener('click', function () { $('menu').hidden = true; });
  $('menu').onclick = function (e) {
    var act = e.target.getAttribute('data-act'); if (!act) return;
    if (act === 'logout') api('/logout', {}).then(function () { me = null; showAuth(false); });
    if (act === 'password') sheetForm('Cambiar contraseña', '<label>Actual</label><input name="actual" type="password" required autocomplete="current-password"><label>Nueva (mín. 8)</label><input name="nueva" type="password" required minlength="8" autocomplete="new-password">', '/api/password', function () { toast('Contraseña cambiada'); });
    if (act === 'ajustes') sheetAjustes();
  };
  function sheetAjustes() {
    var a = cfg.ajustes;
    sheetForm('Datos de Tratto en la cotización',
      '<div class="grid2"><div><label>Razón social</label><input name="razon_social" value="' + esc(a.razon_social) + '"></div><div><label>RFC</label><input name="rfc" value="' + esc(a.rfc) + '"></div></div>' +
      '<label>Domicilio</label><input name="domicilio" value="' + esc(a.domicilio) + '">' +
      '<div class="grid3"><div><label>Correo</label><input name="correo" value="' + esc(a.correo) + '"></div><div><label>Teléfono</label><input name="telefono" value="' + esc(a.telefono) + '"></div><div><label>Web</label><input name="web" value="' + esc(a.web) + '"></div></div>' +
      '<div class="grid2"><div><label>Vigencia (días)</label><input name="vigencia_dias" type="number" value="' + esc(a.vigencia_dias) + '"></div><div><label>IVA %</label><input name="iva" type="number" step="0.5" value="' + esc(a.iva) + '"></div></div>' +
      '<label>"Qué incluye" por defecto (un renglón por punto)</label><textarea name="alcance" rows="6">' + esc(a.alcance) + '</textarea>' +
      '<label>Condiciones por defecto (un renglón por punto)</label><textarea name="condiciones" rows="5">' + esc(a.condiciones) + '</textarea>',
      '/api/ajustes', function (r) { cfg.ajustes = r.ajustes; toast('Guardado'); });
  }

  // ── router ──
  function boot() {
    return api('/api/me').then(function (j) { me = j.user; cfg = j; $('auth').hidden = true; $('app').hidden = false; route(); }).catch(fail);
  }
  window.addEventListener('hashchange', function () { if (me) route(); });
  function nav(name, wide) {
    document.querySelectorAll('[data-nav]').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-nav') === name); });
    $('view').classList.toggle('wide', !!wide);
  }
  function route() {
    var h = location.hash || '#/'; var m;
    closeSheet(); window.onbeforeunload = null;
    if (h === '#/' || h === '#') return viewBoard();
    if ((m = h.match(/^#\/o\/(\d+)$/))) return viewOportunidad(Number(m[1]));
    if (h === '#/proyectos') return viewProyectos();
    if (h === '#/clientes') return viewClientes();
    if ((m = h.match(/^#\/cl\/(\d+)$/))) return viewCliente(Number(m[1]));
    if (h === '#/catalogo') return viewCatalogo();
    location.hash = '#/';
  }
  function render(html) { window.scrollTo(0, 0); $('view').innerHTML = html; }

  // ── board de oportunidades ──
  function board(cols, items, colOf, cardHtml, onCard) {
    var html = '<div class="board">' + cols.map(function (c) {
      var its = items.filter(function (i) { return colOf(i) === c; });
      return '<div class="col"><h3>' + esc(ETIQ[c] || c) + '<b>' + its.length + '</b></h3><div class="cards">' + (its.map(cardHtml).join('') || '<div class="vacio">—</div>') + '</div></div>';
    }).join('') + '</div>';
    return html;
  }
  function viewBoard() {
    nav('board', true);
    api('/api/board').then(function (r) {
      var html = '<div class="head"><h1>Oportunidades</h1><button class="btn primary" id="nueva">+ Nueva</button></div>';
      if (!r.oportunidades.length) html += '<div class="empty"><p>Todavía no hay oportunidades.</p><button class="btn primary" onclick="document.getElementById(\'nueva\').click()">Crear la primera</button></div>';
      else html += board(cfg.etapas, r.oportunidades, function (o) { return o.etapa; }, function (o) {
        return '<a class="kcard" href="#/o/' + o.id + '"><div class="f"><span>' + esc(o.folio) + '</span><span>' + esc(hace(o.updated_at)) + '</span></div><div class="c">' + esc(o.cliente) + '</div><div class="n">' + esc(o.nombre) + '</div><div class="a">' + esc(resumenTotales(o.totales)) + '</div></a>';
      });
      render(html);
      $('nueva').onclick = sheetNuevaOportunidad;
    }).catch(fail);
  }
  function sheetNuevaOportunidad(clienteId) {
    api('/api/clientes').then(function (r) {
      var sel = '<option value="">Cliente nuevo…</option>' + r.clientes.map(function (c) { return '<option value="' + c.id + '"' + (c.id === clienteId ? ' selected' : '') + '>' + esc(c.nombre) + '</option>'; }).join('');
      var f = sheetForm('Nueva oportunidad',
        '<label>Cliente</label><select name="cliente_id" id="selCli">' + sel + '</select>' +
        '<div id="nuevoCli"' + (clienteId ? ' hidden' : '') + '><label>Nombre del cliente nuevo</label><input name="cliente_nombre" placeholder="Empresa"></div>' +
        '<label>Nombre de la oportunidad</label><input name="nombre" value="Portal a la medida">',
        '/api/oportunidades', function (o) { location.hash = '#/o/' + o.id; });
      $('selCli').onchange = function () { $('nuevoCli').hidden = !!this.value; };
    }).catch(fail);
  }

  // ── oportunidad (= la cotización) ──
  function viewOportunidad(id) {
    nav('board');
    api('/api/oportunidades/' + id).then(function (r) {
      var o = r.oportunidad, lineas = r.lineas.map(function (l) { return { periodicidad:l.periodicidad, concepto:l.concepto, descripcion:l.descripcion || '', cantidad:Number(l.cantidad), precio:Number(l.precio) }; });
      var dirty = false, link = location.origin + '/c/' + o.token;
      var html = '<div class="head"><button class="back" id="back">&#8592;</button><h1>' + esc(o.folio) + '</h1>' +
        '<div class="menu"><button class="iconbtn" id="omBtn" aria-label="Opciones">&#8942;</button><div class="dd" id="om" hidden><button data-act="dup">Duplicar como nueva</button><button data-act="del" class="danger">Eliminar</button></div></div></div>';
      html += '<div class="estado-bar"><select id="etapa">' + opciones(cfg.etapas, o.etapa) + '</select><a href="#/cl/' + o.cliente_id + '" style="font-weight:600;text-decoration:none">' + esc(o.cliente) + '</a>' +
        '<span class="dim">' + (r.vistas.length ? '· abierta ' + r.vistas.length + (r.vistas.length === 1 ? ' vez' : ' veces') + ', última ' + esc(hace(r.vistas[0].created_at)) : '· nadie ha abierto el enlace') + '</span>' +
        (o.aceptada_por ? '<span class="dim">· aceptada por ' + esc(o.aceptada_por) + '</span>' : '') + (r.proyecto ? '<a href="#/proyectos" style="text-decoration:none">· proyecto ' + esc(r.proyecto.folio) + '</a>' : '') + '</div>';
      html += '<div class="actions"><a class="btn ghost sm" href="' + esc(link) + '" target="_blank" rel="noopener">Ver como cliente</a><button class="btn ghost sm" id="copiar">Copiar enlace</button>' +
        (waLink(o.contacto_telefono) ? '<a class="btn primary sm" id="waBtn" href="#">Mandar por WhatsApp</a>' : '<button class="btn ghost sm" disabled title="El contacto no tiene teléfono">Mandar por WhatsApp</button>') + '</div>';

      html += '<div class="panel"><label style="margin-top:0">Nombre</label><input id="nombre" value="' + esc(o.nombre) + '" maxlength="200">' +
        '<label>Atención a</label><select id="contacto"><option value="">— sin contacto —</option>' + opciones(r.contactos.map(function (k) { return k.id; }), o.contacto_id, function (v) { var k = r.contactos.filter(function (x) { return x.id === v; })[0]; return k.nombre + (k.puesto ? ' · ' + k.puesto : ''); }) + '</select>' +
        '<div class="grid3"><div><label>Fecha</label><input id="fecha" type="date" value="' + esc(o.fecha) + '"></div><div><label>Vigencia, días</label><input id="vigencia" type="number" min="1" value="' + esc(o.vigencia_dias) + '"></div><div><label>IVA %</label><input id="iva" type="number" min="0" step="0.5" value="' + esc(o.iva) + '"></div></div></div>';
      html += '<div class="panel"><h2>Inversión inicial<small style="font-weight:400">se paga una vez</small></h2><div class="lineas" id="lu"></div><div class="addrow"><select id="addU"></select></div><div class="totales" id="tu"></div></div>';
      html += '<div class="panel"><h2>Renta mensual<small style="font-weight:400">cada mes</small></h2><div class="lineas" id="lm"></div><div class="addrow"><select id="addM"></select></div><div class="totales" id="tm"></div></div>';
      html += '<div class="panel"><h2>Qué incluye</h2><small>Un renglón por punto. Sale como lista en la cotización.</small><textarea id="alcance" rows="7">' + esc(o.alcance) + '</textarea></div>';
      html += '<div class="panel"><h2>Condiciones</h2><small>Un renglón por punto.</small><textarea id="condiciones" rows="6">' + esc(o.condiciones) + '</textarea></div>';
      html += '<div class="panel"><h2>Notas internas</h2><small>No salen en la cotización.</small><textarea id="notas" rows="3">' + esc(o.notas) + '</textarea></div>';
      html += '<div class="savebar"><button class="btn primary" id="guardar" hidden>Guardar cambios</button></div>';
      render(html);

      function marcar() { if (!dirty) { dirty = true; $('guardar').hidden = false; } }
      function catOpts(per) { return '<option value="">+ Agregar concepto…</option>' + r.catalogo.filter(function (k) { return k.periodicidad === per; }).map(function (k) { return '<option value="' + k.id + '">' + esc(k.concepto) + ' · ' + mxn(k.precio) + '</option>'; }).join('') + '<option value="libre">Concepto libre</option>'; }
      function lineaHtml(l, i) {
        return '<div class="linea" data-i="' + i + '"><input class="concepto" value="' + esc(l.concepto) + '" placeholder="Concepto"><button class="del" title="Quitar">&times;</button>' +
          '<textarea rows="2" placeholder="Descripción (opcional)">' + esc(l.descripcion) + '</textarea>' +
          '<div class="nums"><label>Cant.</label><input class="num qty" type="number" min="0" step="1" value="' + esc(l.cantidad) + '"><label>Precio</label><input class="num price" type="number" min="0" step="100" value="' + esc(l.precio) + '"><span class="imp">' + mxn(l.cantidad * l.precio) + '</span></div></div>';
      }
      function recalc() {
        var iva = Number($('iva').value) || 0, t = totales(lineas, iva);
        ['unico', 'mensual'].forEach(function (per) {
          var b = t[per];
          $(per === 'unico' ? 'tu' : 'tm').innerHTML = b.lineas ? '<span>Subtotal</span><span class="mono">' + mxn(b.subtotal) + '</span><span>IVA ' + iva + '%</span><span class="mono">' + mxn(b.iva) + '</span><span class="t">Total' + (per === 'mensual' ? ' / mes' : '') + '</span><span class="t mono">' + mxn(b.total) + '</span>' : '';
        });
      }
      function pintar() {
        ['unico', 'mensual'].forEach(function (per) {
          $(per === 'unico' ? 'lu' : 'lm').innerHTML = lineas.map(function (l, i) { return l.periodicidad === per ? lineaHtml(l, i) : ''; }).join('') || '<small>Sin conceptos.</small>';
        });
        $('addU').innerHTML = catOpts('unico'); $('addM').innerHTML = catOpts('mensual');
        recalc();
        document.querySelectorAll('.linea').forEach(function (el) {
          var i = Number(el.getAttribute('data-i')), l = lineas[i];
          el.querySelector('.concepto').oninput = function () { l.concepto = this.value; marcar(); };
          el.querySelector('textarea').oninput = function () { l.descripcion = this.value; marcar(); };
          el.querySelector('.qty').oninput = function () { l.cantidad = Number(this.value) || 0; el.querySelector('.imp').textContent = mxn(l.cantidad * l.precio); marcar(); recalc(); };
          el.querySelector('.price').oninput = function () { l.precio = Number(this.value) || 0; el.querySelector('.imp').textContent = mxn(l.cantidad * l.precio); marcar(); recalc(); };
          el.querySelector('.del').onclick = function () { lineas.splice(i, 1); marcar(); pintar(); };
        });
      }
      pintar();
      ['addU', 'addM'].forEach(function (sid) {
        $(sid).onchange = function () {
          var per = sid === 'addU' ? 'unico' : 'mensual', v = this.value; if (!v) return;
          var k = r.catalogo.filter(function (x) { return String(x.id) === v; })[0];
          lineas.push(k ? { periodicidad:per, concepto:k.concepto, descripcion:k.descripcion || '', cantidad:1, precio:Number(k.precio) } : { periodicidad:per, concepto:'', descripcion:'', cantidad:1, precio:0 });
          marcar(); pintar();
          if (!k) { var last = $(per === 'unico' ? 'lu' : 'lm').querySelector('.linea:last-child .concepto'); if (last) last.focus(); }
        };
      });
      ['nombre', 'contacto', 'fecha', 'vigencia', 'alcance', 'condiciones', 'notas'].forEach(function (i) { $(i).oninput = marcar; $(i).onchange = marcar; });
      $('iva').oninput = function () { marcar(); recalc(); };
      function guardar() {
        var d = { nombre:$('nombre').value, contacto_id:Number($('contacto').value) || null, fecha:$('fecha').value, vigencia_dias:Number($('vigencia').value), iva:Number($('iva').value), alcance:$('alcance').value, condiciones:$('condiciones').value, notas:$('notas').value, lineas:lineas };
        $('guardar').disabled = true;
        return api('/api/oportunidades/' + id, d).then(function () { dirty = false; $('guardar').hidden = true; $('guardar').disabled = false; toast('Guardado'); }).catch(function (e) { $('guardar').disabled = false; fail(e); throw e; });
      }
      var siGuardado = function (go) { return dirty ? guardar().then(go) : Promise.resolve().then(go); };
      $('guardar').onclick = guardar;
      document.addEventListener('keydown', function onKey(e) {
        if (location.hash !== '#/o/' + id) { document.removeEventListener('keydown', onKey); return; }
        if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (dirty) guardar(); }
      });
      window.onbeforeunload = function () { return dirty ? true : undefined; };
      $('back').onclick = function () { if (dirty && !confirm('Hay cambios sin guardar. ¿Salir de todos modos?')) return; dirty = false; window.onbeforeunload = null; location.hash = '#/'; };

      $('etapa').onchange = function () {
        var et = this.value;
        api('/api/oportunidades/' + id + '/etapa', { etapa: et }).then(function (x) {
          if (x.proyecto_id) { toast('Ganada. Proyecto creado.'); if (!r.proyecto) viewOportunidad(id); } else toast('Etapa: ' + ETIQ[et]);
        }).catch(fail);
      };
      $('copiar').onclick = function () { siGuardado(function () { copiar(link); }); };
      var wb = $('waBtn');
      if (wb) wb.onclick = function (e) {
        e.preventDefault();
        var nombre = (o.contacto || '').split(' ')[0];
        var msg = (nombre ? 'Hola ' + nombre + ', ' : 'Hola, ') + 'te comparto la cotización ' + o.folio + ' de Tratto para ' + o.cliente + ':\n' + link + '\n\nAhí mismo la puedes guardar en PDF o aceptarla. Cualquier duda, aquí estoy.';
        siGuardado(function () {
          window.open(waLink(o.contacto_telefono, msg), '_blank');
          if (o.etapa === 'nueva') api('/api/oportunidades/' + id + '/etapa', { etapa:'cotizada' }).then(function () { o.etapa = 'cotizada'; $('etapa').value = 'cotizada'; });
        });
      };
      $('omBtn').onclick = function (e) { e.stopPropagation(); $('om').hidden = !$('om').hidden; };
      document.addEventListener('click', function () { var m = $('om'); if (m) m.hidden = true; }, { once:true });
      $('om').onclick = function (e) {
        var act = e.target.getAttribute('data-act'); if (!act) return;
        if (act === 'dup') siGuardado(function () { return api('/api/oportunidades/' + id + '/duplicar', {}).then(function (n) { location.hash = '#/o/' + n.id; toast('Nueva: ' + n.folio); }); }).catch(fail);
        if (act === 'del') confirmar('¿Eliminar la oportunidad ' + o.folio + '?', function () { api('/api/oportunidades/' + id + '/eliminar', {}).then(function () { dirty = false; window.onbeforeunload = null; location.hash = '#/'; }).catch(fail); });
      };
    }).catch(fail);
  }

  // ── proyectos ──
  function viewProyectos() {
    nav('proyectos', true);
    api('/api/proyectos').then(function (r) {
      var html = '<div class="head"><h1>Proyectos</h1></div>';
      if (!r.proyectos.length) html += '<div class="empty"><p>Sin proyectos. Se crean solos cuando una oportunidad se marca ganada.</p><a class="btn primary" href="#/">Ir a oportunidades</a></div>';
      else html += board(cfg.estados_proyecto, r.proyectos, function (p) { return p.estado; }, function (p) {
        return '<button class="kcard" data-p="' + p.id + '"><div class="f"><span>' + esc(p.folio) + '</span><span>' + (p.inicio ? 'inicio ' + esc(fecha(p.inicio)) : '') + '</span></div><div class="c">' + esc(p.cliente) + '</div><div class="n">' + esc(p.nombre) + '</div><div class="a">' + mxn(p.renta_mensual) + '/mes</div></button>';
      });
      render(html);
      document.querySelectorAll('[data-p]').forEach(function (b) { b.onclick = function () { sheetProyecto(r.proyectos.filter(function (p) { return String(p.id) === b.getAttribute('data-p'); })[0]); }; });
    }).catch(fail);
  }
  function sheetProyecto(p) {
    var f = sheetForm(p.folio + ' · ' + p.cliente,
      '<label>Nombre</label><input name="nombre" required value="' + esc(p.nombre) + '">' +
      '<div class="grid3"><div><label>Estado</label><select name="estado">' + opciones(cfg.estados_proyecto, p.estado) + '</select></div><div><label>Inicio</label><input name="inicio" type="date" value="' + esc(p.inicio) + '"></div><div><label>Renta mensual (sin IVA)</label><input name="renta_mensual" type="number" step="100" value="' + esc(p.renta_mensual) + '"></div></div>' +
      '<label>Notas</label><textarea name="notas" rows="4">' + esc(p.notas) + '</textarea>' +
      '<small><a href="#/cl/' + p.cliente_id + '">Ver cliente</a>' + (p.oportunidad_id ? ' · <a href="#/o/' + p.oportunidad_id + '">' + esc(p.oportunidad_folio) + '</a>' : '') + '</small>',
      '/api/proyectos/' + p.id, function () { toast('Guardado'); route(); },
      '<button type="button" class="btn danger left" id="delP">Eliminar</button>');
    $('delP').onclick = function () { confirmar('¿Eliminar el proyecto ' + p.folio + '?', function () { api('/api/proyectos/' + p.id + '/eliminar', {}).then(route).catch(fail); }); };
  }

  // ── clientes ──
  var busqueda = '';
  function viewClientes() {
    nav('clientes');
    render('<div class="head"><h1>Clientes</h1></div><div class="search"><input id="q" type="search" placeholder="Buscar empresa, contacto, teléfono…" value="' + esc(busqueda) + '"></div><div class="list" id="lista"></div><button class="fab" id="nuevo" aria-label="Nuevo cliente">+</button>');
    var t;
    $('q').oninput = function () { busqueda = this.value; clearTimeout(t); t = setTimeout(cargar, 250); };
    $('nuevo').onclick = function () { sheetCliente(null); };
    cargar();
    function cargar() {
      api('/api/clientes?q=' + encodeURIComponent(busqueda)).then(function (r) {
        if (!r.clientes.length) { $('lista').innerHTML = '<div class="empty"><p>' + (busqueda ? 'Nada con esa búsqueda.' : 'Todavía no hay clientes.') + '</p></div>'; return; }
        $('lista').innerHTML = r.clientes.map(function (c) {
          return '<a class="item" href="#/cl/' + c.id + '"><div class="r1"><b>' + esc(c.nombre) + '</b><small>' + esc(hace(c.updated_at)) + '</small></div>' +
            '<div class="r2">' + (c.contacto ? '<span>' + esc(c.contacto) + '</span>' : '') + (c.giro ? '<span>· ' + esc(c.giro) + '</span>' : '') + '<span>· ' + c.n_oportunidades + ' opp · ' + c.n_proyectos + ' proy</span></div></a>';
        }).join('');
      }).catch(fail);
    }
  }
  function camposCliente(c) {
    c = c || {};
    return '<label>Empresa *</label><input name="nombre" required maxlength="200" value="' + esc(c.nombre) + '">' +
      '<div class="grid3"><div><label>Giro</label><input name="giro" value="' + esc(c.giro) + '"></div><div><label>Ciudad</label><input name="ciudad" value="' + esc(c.ciudad) + '"></div><div><label>RFC</label><input name="rfc" value="' + esc(c.rfc) + '"></div></div>' +
      '<label>Notas</label><textarea name="notas" rows="2">' + esc(c.notas) + '</textarea>';
  }
  function camposContacto(k) {
    k = k || {};
    return '<label>Nombre *</label><input name="nombre" required value="' + esc(k.nombre) + '"><label>Puesto</label><input name="puesto" value="' + esc(k.puesto) + '">' +
      '<div class="grid2"><div><label>Teléfono (10 dígitos)</label><input name="telefono" type="tel" inputmode="tel" value="' + esc(k.telefono) + '"></div><div><label>Correo</label><input name="correo" type="email" value="' + esc(k.correo) + '"></div></div>';
  }
  function sheetCliente(c) {
    if (c) return sheetForm('Editar cliente', camposCliente(c), '/api/clientes/' + c.id, function () { toast('Guardado'); route(); });
    sheetForm('Nuevo cliente', camposCliente(null) + '<h3 style="margin-top:1rem">Contacto (opcional)</h3>' + camposContacto(null).replace(/name="/g, 'name="contacto_').replace('required', ''), '/api/clientes', function (r) { location.hash = '#/cl/' + r.id; });
  }
  function viewCliente(id) {
    nav('clientes');
    api('/api/clientes/' + id).then(function (r) {
      var c = r.cliente;
      var html = '<div class="head"><button class="back" onclick="location.hash=\'#/clientes\'">&#8592;</button><h1>' + esc(c.nombre) + '</h1>' +
        '<div class="menu"><button class="iconbtn" id="cmBtn" aria-label="Opciones">&#8942;</button><div class="dd" id="cm" hidden><button data-act="edit">Editar cliente</button><button data-act="del" class="danger">Eliminar cliente</button></div></div></div>';
      var datos = [c.giro, c.ciudad, c.rfc ? 'RFC ' + c.rfc : ''].filter(Boolean).map(esc).join(' · ');
      if (datos || c.notas) html += '<div class="estado-bar"><span class="dim">' + datos + '</span>' + (c.notas ? '<span class="dim" style="white-space:pre-wrap">' + esc(c.notas) + '</span>' : '') + '</div>';

      html += '<div class="panel"><h2>Contactos<button id="addK">+ Agregar</button></h2>' + (r.contactos.map(function (k) {
        return '<div class="row-item"><div class="info">' + esc(k.nombre) + (k.puesto ? ' <small style="display:inline">· ' + esc(k.puesto) + '</small>' : '') + '<small>' + [k.telefono, k.correo].filter(Boolean).map(esc).join(' · ') + '</small></div>' +
          (waLink(k.telefono) ? '<a class="btn ghost sm" href="' + waLink(k.telefono) + '" target="_blank" rel="noopener">WhatsApp</a>' : '') + '<button class="btn ghost sm" data-k="' + k.id + '">Editar</button></div>';
      }).join('') || '<small>Sin contactos.</small>') + '</div>';

      html += '<div class="panel"><h2>Oportunidades<button id="addO">+ Nueva</button></h2>' + (r.oportunidades.map(function (o) {
        return '<a class="item" href="#/o/' + o.id + '" style="box-shadow:none;margin-bottom:.4rem"><div class="r1"><b>' + esc(o.folio) + ' · ' + esc(o.nombre) + '</b><span class="amt">' + esc(resumenTotales(o.totales)) + '</span></div><div class="r2">' + tag(o.etapa) + '<span>' + esc(fecha(o.fecha)) + '</span></div></a>';
      }).join('') || '<small>Ninguna todavía.</small>') + '</div>';

      html += '<div class="panel"><h2>Proyectos</h2>' + (r.proyectos.map(function (p) {
        return '<div class="row-item"><div class="info">' + esc(p.folio) + ' · ' + esc(p.nombre) + '</div>' + tag(p.estado) + '<span class="price">' + mxn(p.renta_mensual) + '/mes</span></div>';
      }).join('') || '<small>Ninguno todavía.</small>') + '</div>';
      render(html);

      $('cmBtn').onclick = function (e) { e.stopPropagation(); $('cm').hidden = !$('cm').hidden; };
      document.addEventListener('click', function () { var m = $('cm'); if (m) m.hidden = true; }, { once:true });
      $('cm').onclick = function (e) {
        var act = e.target.getAttribute('data-act');
        if (act === 'edit') sheetCliente(c);
        if (act === 'del') confirmar('¿Eliminar a ' + c.nombre + ' con sus contactos, oportunidades y proyectos?', function () { api('/api/clientes/' + id + '/eliminar', {}).then(function () { location.hash = '#/clientes'; }).catch(fail); });
      };
      $('addK').onclick = function () { sheetForm('Nuevo contacto', '<input type="hidden" name="cliente_id" value="' + id + '">' + camposContacto(null), '/api/contactos', function () { viewCliente(id); }); };
      document.querySelectorAll('[data-k]').forEach(function (b) {
        b.onclick = function () {
          var k = r.contactos.filter(function (x) { return String(x.id) === b.getAttribute('data-k'); })[0];
          sheetForm('Editar contacto', camposContacto(k), '/api/contactos/' + k.id, function () { viewCliente(id); }, '<button type="button" class="btn danger left" id="delK">Eliminar</button>');
          $('delK').onclick = function () { api('/api/contactos/' + k.id + '/eliminar', {}).then(function () { closeSheet(); viewCliente(id); }).catch(fail); };
        };
      });
      $('addO').onclick = function () { api('/api/oportunidades', { cliente_id: id }).then(function (o) { location.hash = '#/o/' + o.id; }).catch(fail); };
    }).catch(fail);
  }

  // ── catálogo ──
  function viewCatalogo() {
    nav('catalogo');
    api('/api/catalogo').then(function (r) {
      var html = '<div class="head"><h1>Catálogo</h1></div><div class="panel">' +
        (r.catalogo.map(function (k) { return '<div class="row-item' + (k.activo ? '' : ' off') + '"><div class="info">' + esc(k.concepto) + ' <span class="tag">' + esc(ETIQ[k.periodicidad]) + '</span><small>' + esc(k.descripcion || '') + '</small></div><span class="price">' + mxn(k.precio) + (k.periodicidad === 'mensual' ? '/mes' : '') + '</span><button class="btn ghost sm" data-cat="' + k.id + '">Editar</button></div>'; }).join('') || '<small>Vacío.</small>') +
        '</div><small>Al crear una oportunidad entra el primer concepto activo de pago único y el primero mensual.</small><button class="fab" id="nuevo" aria-label="Nuevo concepto">+</button>';
      render(html);
      $('nuevo').onclick = function () { sheetCatalogo(null); };
      document.querySelectorAll('[data-cat]').forEach(function (b) { b.onclick = function () { sheetCatalogo(r.catalogo.filter(function (k) { return String(k.id) === b.getAttribute('data-cat'); })[0]); }; });
    }).catch(fail);
  }
  function sheetCatalogo(k) {
    k = k || {};
    sheetForm(k.id ? 'Editar concepto' : 'Nuevo concepto', (k.id ? '<input type="hidden" name="id" value="' + k.id + '">' : '') +
      '<label>Concepto</label><input name="concepto" required value="' + esc(k.concepto) + '"><label>Descripción</label><textarea name="descripcion" rows="3">' + esc(k.descripcion) + '</textarea>' +
      '<div class="grid3"><div><label>Periodicidad</label><select name="periodicidad">' + opciones(['unico', 'mensual'], k.periodicidad || 'mensual') + '</select></div><div><label>Precio</label><input name="precio" type="number" step="100" value="' + esc(k.precio == null ? '' : k.precio) + '"></div><div><label>Orden</label><input name="orden" type="number" value="' + esc(k.orden == null ? 0 : k.orden) + '"></div></div>' +
      '<label><input type="checkbox" name="activo" style="width:auto;margin-right:.4rem"' + (k.activo === 0 ? '' : ' checked') + '>Activo</label>',
      '/api/catalogo', function () { viewCatalogo(); },
      k.id ? '<button type="button" class="btn danger left" id="delC">Eliminar</button>' : '');
    if (k.id) $('delC').onclick = function () { api('/api/catalogo/' + k.id + '/eliminar', {}).then(function () { closeSheet(); viewCatalogo(); }).catch(fail); };
  }

  boot();
})();
</script>
</body>
</html>`;
}
