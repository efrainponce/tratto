// La bandeja. Una sola página, sin dependencias ni build: el Worker la sirve tal cual.
//
// El HTML NO lleva secretos. Pide el ADMIN_TOKEN al abrirse, lo guarda en
// localStorage del navegador y lo manda como Bearer en cada llamada a /admin/*,
// exactamente igual que los curl del README. Así la página puede ser pública sin
// exponer nada: sin token, no ve un solo mensaje.
export function inboxPage(): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bandeja · Tratto WhatsApp</title>
<style>
  :root {
    color-scheme: light dark;
    --bg:#fbfbfa; --panel:#fff; --line:#e6e6e3; --ink:#1c1c1a; --dim:#77776f;
    --mine:#dcf8c6; --theirs:#fff; --accent:#128c7e; --warn:#b45309; --warnbg:#fef3c7;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:#16181a; --panel:#1e2124; --line:#2e3236; --ink:#e8e6e3; --dim:#9a9a93;
      --mine:#155e4b; --theirs:#262a2e; --accent:#25d366; --warn:#fbbf24; --warnbg:#3a2f10;
    }
  }
  * { box-sizing:border-box }
  body { margin:0; height:100vh; display:flex; background:var(--bg); color:var(--ink);
         font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif }
  #list { width:320px; flex:none; border-right:1px solid var(--line); background:var(--panel);
          display:flex; flex-direction:column }
  #list header { padding:.9rem 1rem; border-bottom:1px solid var(--line); display:flex;
                 align-items:center; justify-content:space-between; gap:.5rem }
  #list h1 { font-size:15px; margin:0; font-weight:650 }
  #threads { overflow-y:auto; flex:1 }
  .t { padding:.75rem 1rem; border-bottom:1px solid var(--line); cursor:pointer }
  .t:hover { background:var(--bg) }
  .t.on { background:var(--bg); box-shadow:inset 3px 0 0 var(--accent) }
  .t .top { display:flex; justify-content:space-between; gap:.5rem; align-items:baseline }
  .t .who { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
  .t .when { font-size:11px; color:var(--dim); flex:none }
  .t .sub { font-size:12px; color:var(--dim); margin-top:.15rem;
            display:flex; gap:.4rem; align-items:center; flex-wrap:wrap }
  .tag { font-size:10px; padding:.05rem .4rem; border-radius:10px; border:1px solid var(--line);
         text-transform:uppercase; letter-spacing:.03em }
  .tag.lead { color:var(--accent); border-color:currentColor }
  .tag.human { color:var(--warn); border-color:currentColor }
  #pane { flex:1; display:flex; flex-direction:column; min-width:0 }
  #pane header { padding:.8rem 1.2rem; border-bottom:1px solid var(--line); background:var(--panel);
                 display:flex; align-items:center; gap:.8rem; flex-wrap:wrap }
  #pane header b { font-size:15px }
  #msgs { flex:1; overflow-y:auto; padding:1.2rem; display:flex; flex-direction:column; gap:.5rem }
  .m { max-width:min(65%,34rem); padding:.5rem .75rem; border-radius:10px; white-space:pre-wrap;
       word-wrap:break-word; border:1px solid var(--line) }
  .m.in  { align-self:flex-start; background:var(--theirs); border-bottom-left-radius:3px }
  .m.out { align-self:flex-end; background:var(--mine); border-bottom-right-radius:3px }
  .m .meta { font-size:10px; color:var(--dim); margin-top:.25rem; text-align:right }
  #composer { border-top:1px solid var(--line); padding:.75rem 1.2rem; background:var(--panel);
              display:flex; gap:.6rem; align-items:flex-end }
  textarea { flex:1; resize:none; font:inherit; padding:.55rem .7rem; border-radius:8px;
             border:1px solid var(--line); background:var(--bg); color:inherit; min-height:2.5rem }
  button { font:inherit; padding:.55rem 1rem; border-radius:8px; border:1px solid transparent;
           background:var(--accent); color:#fff; font-weight:600; cursor:pointer }
  button.ghost { background:transparent; color:var(--dim); border-color:var(--line); font-weight:500 }
  button:disabled { opacity:.45; cursor:default }
  .banner { padding:.55rem .9rem; border-radius:8px; font-size:13px;
            background:var(--warnbg); color:var(--warn); margin:0 1.2rem 0 }
  .empty { margin:auto; color:var(--dim) }
</style>
</head>
<body>
  <div id="list">
    <header>
      <h1>Bandeja</h1>
      <button class="ghost" id="logout" title="Olvidar el token">salir</button>
    </header>
    <div id="threads"></div>
  </div>
  <div id="pane">
    <header id="head"><span class="empty">Elige un hilo</span></header>
    <div id="msgs"></div>
    <div id="composer" hidden>
      <textarea id="text" rows="1" placeholder="Escribe… (Enter manda, Shift+Enter salta línea)"></textarea>
      <button id="send">Enviar</button>
    </div>
  </div>
<script>
(function () {
  var KEY = 'tratto_admin_token';
  var token = localStorage.getItem(KEY);
  if (!token) {
    token = window.prompt('ADMIN_TOKEN del gateway:');
    if (!token) { document.body.innerHTML = '<p class=empty>Sin token no hay bandeja.</p>'; return; }
    localStorage.setItem(KEY, token);
  }
  var current = location.hash.slice(1) || null;
  var threads = [];

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'authorization': 'Bearer ' + token }, opts.headers || {});
    return fetch(path, opts).then(function (r) {
      if (r.status === 401) {
        localStorage.removeItem(KEY);
        alert('Token rechazado. Recarga la página.');
        throw new Error('401');
      }
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }

  // Las fechas de D1 vienen en UTC sin zona; sin la Z el navegador las lee como locales
  // y todo aparece con seis horas de menos.
  function when(s) {
    if (!s) return '';
    var d = new Date(s.replace(' ', 'T') + 'Z');
    var mins = (Date.now() - d.getTime()) / 60000;
    if (mins < 1) return 'ahora';
    if (mins < 60) return Math.floor(mins) + ' min';
    if (mins < 1440) return Math.floor(mins / 60) + ' h';
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  }

  function isHuman(t) { return t.human_until && new Date(t.human_until.replace(' ', 'T') + 'Z') > new Date(); }

  function drawThreads() {
    document.getElementById('threads').innerHTML = threads.map(function (t) {
      var name = t.profile_name || ('+' + t.wa_from);
      var tags = '';
      if (!t.tenant_slug) tags += '<span class="tag lead">lead</span>';
      else tags += '<span class="tag">' + esc(t.tenant_slug) + '</span>';
      if (isHuman(t)) tags += '<span class="tag human">tú</span>';
      return '<div class="t' + (t.phone10 === current ? ' on' : '') + '" data-p="' + t.phone10 + '">' +
        '<div class="top"><span class="who">' + esc(name) + '</span>' +
        '<span class="when">' + when(t.last_seen) + '</span></div>' +
        '<div class="sub">' + tags + '<span>' + t.msg_count + ' msj</span></div></div>';
    }).join('') || '<p class="empty" style="padding:1rem">Nadie ha escrito todavía.</p>';

    Array.prototype.forEach.call(document.querySelectorAll('.t'), function (el) {
      el.onclick = function () { open(el.dataset.p); };
    });
  }

  function loadThreads() {
    return api('/admin/threads').then(function (r) { threads = r.body || []; drawThreads(); });
  }

  function open(p10) {
    current = p10;
    location.hash = p10;
    drawThreads();
    return api('/admin/thread?phone=' + p10).then(function (r) {
      var t = r.body.thread || {};
      var human = isHuman(t);
      var stale = t.last_seen &&
        (Date.now() - new Date(t.last_seen.replace(' ', 'T') + 'Z').getTime()) > 24 * 3600 * 1000;

      document.getElementById('head').innerHTML =
        '<b>' + esc(t.profile_name || ('+' + t.wa_from)) + '</b>' +
        '<span style="color:var(--dim)">+' + esc(t.wa_from) + '</span>' +
        (t.tenant_slug ? '<span class="tag">' + esc(t.tenant_slug) + '</span>'
                       : '<span class="tag lead">lead</span>') +
        '<button class="ghost" id="handoff" style="margin-left:auto">' +
        (human ? 'Devolver al agente' : 'Tomar el hilo') + '</button>';

      document.getElementById('handoff').onclick = function () {
        api('/admin/threads/handoff', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phone: p10, hours: human ? 0 : 6 }),
        }).then(function () { loadThreads().then(function () { open(p10); }); });
      };

      var msgs = r.body.messages || [];
      document.getElementById('msgs').innerHTML = msgs.map(function (m) {
        var body = m.body || ('(' + m.kind + ')');
        var by = m.direction === 'out'
          ? ({ human: 'tú', agent: 'agente', ack: 'acuse', error: 'error' }[m.author] || 'salida')
          : '';
        return '<div class="m ' + (m.direction === 'out' ? 'out' : 'in') + '">' + esc(body) +
          '<div class="meta">' + (by ? by + ' · ' : '') + when(m.created_at) + '</div></div>';
      }).join('');

      var box = document.getElementById('msgs');
      box.scrollTop = box.scrollHeight;

      var comp = document.getElementById('composer');
      comp.hidden = false;
      var ta = document.getElementById('text');
      var btn = document.getElementById('send');
      if (stale) {
        ta.disabled = btn.disabled = true;
        ta.placeholder = 'Ventana de 24 h cerrada — WhatsApp solo permite plantillas aprobadas.';
      } else {
        ta.disabled = btn.disabled = false;
        ta.placeholder = 'Escribe… (Enter manda, Shift+Enter salta línea)';
      }
    });
  }

  function send() {
    var ta = document.getElementById('text');
    var text = ta.value.trim();
    if (!text || !current) return;
    var btn = document.getElementById('send');
    btn.disabled = true;
    api('/admin/send', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: current, text: text }),
    }).then(function (r) {
      btn.disabled = false;
      if (!r.ok) { alert((r.body.error || 'falló') + '\\n\\n' + (r.body.detalle || '')); return; }
      ta.value = '';
      open(current);
      loadThreads();
    });
  }

  document.getElementById('send').onclick = send;
  document.getElementById('text').onkeydown = function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };
  document.getElementById('logout').onclick = function () {
    localStorage.removeItem(KEY); location.reload();
  };

  loadThreads().then(function () { if (current) open(current); });
  setInterval(function () {
    loadThreads().then(function () { if (current) open(current); });
  }, 15000);
})();
</script>
</body>
</html>`;
}
