// La cotización como la ve el prospecto: una página pública por enlace (/c/<token>),
// sin login, pensada para abrirse en el celular desde WhatsApp. "Guardar PDF" es el
// diálogo de impresión del navegador con CSS de impresión; no hay generador de PDF
// en el Worker (si un día hace falta, janing/worker/lib/pdf/cotizacion.ts usa pdf-lib).
import type { Linea, Totales } from './api';

export interface CotizacionPublica {
  folio: string; nombre: string; fecha: string; vigencia_dias: number; moneda: string; iva: number;
  etapa: string; alcance: string | null; condiciones: string | null; aceptada_at: string | null; aceptada_por: string | null;
  empresa: string; contacto: string | null; puesto: string | null;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function mxn(n: number, moneda = 'MXN'): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: moneda, minimumFractionDigits: 2 }).format(n);
}

export function fechaLarga(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function vence(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Texto plano con un renglón por punto → lista. Líneas vacías se ignoran. */
function lista(txt: string | null): string {
  const items = (txt ?? '').split('\n').map(s => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
  return items.length ? `<ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '';
}

function tabla(titulo: string, nota: string, lineas: Linea[], b: Totales['unico'], iva: number, moneda: string, sufijo = ''): string {
  if (!lineas.length) return '';
  // La columna de cantidad solo aparece si alguna línea no es 1: casi nunca.
  const conCant = lineas.some(l => Number(l.cantidad) !== 1);
  const rows = lineas.map(l => `
    <tr>
      <td class="c"><b>${esc(l.concepto)}</b>${l.descripcion ? `<small>${esc(l.descripcion)}</small>` : ''}</td>
      ${conCant ? `<td class="n">${esc(l.cantidad)}</td>` : ''}
      <td class="n">${mxn(l.cantidad * l.precio, moneda)}${sufijo}</td>
    </tr>`).join('');
  return `
  <section class="bloque">
    <div class="bh"><h2>${esc(titulo)}</h2><p>${esc(nota)}</p></div>
    <table>
      <thead><tr><th>Concepto</th>${conCant ? '<th class="n">Cant.</th>' : ''}<th class="n">Importe</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="${conCant ? 2 : 1}">Subtotal</td><td class="n">${mxn(b.subtotal, moneda)}</td></tr>
        <tr><td colspan="${conCant ? 2 : 1}">IVA ${esc(iva)}%</td><td class="n">${mxn(b.iva, moneda)}</td></tr>
        <tr class="tot"><td colspan="${conCant ? 2 : 1}">Total${sufijo ? ' mensual' : ''}</td><td class="n">${mxn(b.total, moneda)}${sufijo}</td></tr>
      </tfoot>
    </table>
  </section>`;
}

export function paginaCotizacion(c: CotizacionPublica, lineas: Linea[], t: Totales, a: Record<string, string>, token: string): string {
  const unico = lineas.filter(l => l.periodicidad === 'unico');
  const mensual = lineas.filter(l => l.periodicidad === 'mensual');
  const venceEl = vence(c.fecha, c.vigencia_dias);
  const hoy = new Date().toISOString().slice(0, 10);
  const aceptada = c.etapa === 'ganada';
  const vencida = !aceptada && venceEl < hoy;
  const puedeAceptar = !aceptada && !vencida && c.etapa !== 'perdida';

  const banner = aceptada
    ? `<div class="banner ok">Cotización aceptada${c.aceptada_por ? ` por <b>${esc(c.aceptada_por)}</b>` : ''}${c.aceptada_at ? ` el ${esc(fechaLarga(c.aceptada_at.slice(0, 10)))}` : ''}. Gracias por la confianza.</div>`
    : vencida
      ? `<div class="banner warn">Esta cotización venció el ${esc(fechaLarga(venceEl))}. Escríbenos y la actualizamos.</div>`
      : '';

  const contacto = [a.correo, a.telefono, a.web].filter(Boolean).map(esc).join(' · ');
  const legal = [a.razon_social, a.rfc ? `RFC ${a.rfc}` : '', a.domicilio].filter(Boolean).map(esc).join(' · ');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#1f4d3f">
<title>${esc(c.folio)} · ${esc(c.nombre)} · Tratto</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap">
<style>
  :root { --bg:#f7f4ee; --paper:#fff; --sunken:#efeae0; --line:#e4dfd3; --ink:#2b2925; --ink2:#726d61; --ink3:#918b7c;
          --accent:#1f4d3f; --accent-ink:#fff; --soft:#e3ece6; --warn:#8a5a00; --warnbg:#fdf1d6; --okbg:#dff1e6;
          --display:'Familjen Grotesk','Inter',system-ui,sans-serif; --body:'Inter',system-ui,-apple-system,sans-serif }
  * { box-sizing:border-box }
  html { -webkit-text-size-adjust:100% }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 var(--body) }
  .wrap { max-width:46rem; margin:0 auto; padding:1.25rem 1rem 4rem }
  .paper { background:var(--paper); border:1px solid var(--line); border-radius:16px; padding:1.5rem 1.25rem; box-shadow:0 1px 2px rgba(43,41,37,.04), 0 12px 32px -20px rgba(43,41,37,.25) }
  @media (min-width:600px) { .wrap { padding:2.5rem 1.5rem 5rem } .paper { padding:2.5rem 2.5rem } }

  .top { display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; margin-bottom:1.75rem }
  .brand { display:flex; align-items:center; gap:.55rem; font-family:var(--display); font-weight:700; font-size:22px; letter-spacing:-.01em }
  .brand i { width:32px; height:32px; border-radius:9px; background:var(--accent); color:var(--accent-ink); display:grid; place-items:center; font-style:normal; font-size:19px }
  .meta { text-align:right; font-size:13px; color:var(--ink2); line-height:1.5 }
  .meta b { display:block; color:var(--ink); font-family:var(--display); font-size:17px; letter-spacing:.01em }

  .banner { border-radius:10px; padding:.7rem .95rem; font-size:14px; margin:0 0 1.25rem }
  .banner.ok { background:var(--okbg); color:var(--accent) }
  .banner.warn { background:var(--warnbg); color:var(--warn) }

  .para { display:grid; grid-template-columns:1fr; gap:.25rem 1.5rem; padding:1rem 1.1rem; background:var(--sunken); border-radius:12px; margin-bottom:1.5rem; font-size:14px }
  @media (min-width:600px) { .para { grid-template-columns:1fr 1fr } }
  .para span { color:var(--ink3); font-size:12px; text-transform:uppercase; letter-spacing:.06em; display:block; margin-bottom:.1rem }
  .para b { font-weight:600 }
  h1 { font-family:var(--display); font-size:clamp(24px, 4.5vw, 32px); line-height:1.15; letter-spacing:-.015em; margin:0 0 .5rem }
  .lede { color:var(--ink2); margin:0 0 1.75rem; font-size:15px }

  h2 { font-family:var(--display); font-size:19px; margin:0 }
  .bloque { margin:0 0 1.75rem }
  .bh { display:flex; flex-wrap:wrap; align-items:baseline; gap:.2rem .8rem; margin-bottom:.6rem }
  .bh p { margin:0; color:var(--ink3); font-size:13px }
  table { width:100%; border-collapse:collapse; font-size:14.5px }
  th { text-align:left; font-size:11.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--ink3); font-weight:600; padding:.4rem 0; border-bottom:1px solid var(--line) }
  td { padding:.7rem 0; border-bottom:1px solid var(--line); vertical-align:top }
  td.c small { display:block; color:var(--ink2); font-size:13px; margin-top:.15rem; line-height:1.45 }
  .n { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums }
  td.n { padding-left:.8rem }
  tfoot td { border:0; padding:.3rem 0; color:var(--ink2); font-size:14px }
  tfoot tr:first-child td { padding-top:.7rem }
  tfoot tr.tot td { color:var(--ink); font-weight:700; font-size:17px; font-family:var(--display); padding-top:.5rem; border-top:2px solid var(--ink) }
  .mes { font-size:.75em; color:var(--ink2); font-weight:500; font-family:var(--body) }

  .alcance ul { margin:.25rem 0 0; padding-left:1.2rem } .alcance li { margin:.3rem 0 }
  .cond { font-size:13.5px; color:var(--ink2) } .cond ul { margin:.25rem 0 0; padding-left:1.2rem } .cond li { margin:.25rem 0 }
  .firma { margin-top:2rem; padding-top:1.25rem; border-top:1px solid var(--line); font-size:13px; color:var(--ink2) }
  .firma b { color:var(--ink) }

  .acciones { position:sticky; bottom:0; display:flex; gap:.6rem; padding:.85rem 0 calc(.85rem + env(safe-area-inset-bottom)); background:linear-gradient(transparent, var(--bg) 35%) }
  .btn { flex:1; text-align:center; border:0; border-radius:12px; padding:.85rem 1rem; font:600 15px var(--body); cursor:pointer; text-decoration:none }
  .btn.primary { background:var(--accent); color:var(--accent-ink) }
  .btn.ghost { background:var(--paper); color:var(--accent); border:1px solid var(--line) }
  .btn:disabled { opacity:.5 }
  #modal { position:fixed; inset:0; background:rgba(43,41,37,.45); display:flex; align-items:flex-end; justify-content:center; padding:0; z-index:10 }
  @media (min-width:600px) { #modal { align-items:center; padding:1rem } }
  .sheet { background:var(--paper); width:100%; max-width:26rem; border-radius:16px 16px 0 0; padding:1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom)) }
  @media (min-width:600px) { .sheet { border-radius:16px } }
  .sheet h3 { margin:0 0 .35rem; font-family:var(--display); font-size:19px }
  .sheet p { margin:0 0 1rem; color:var(--ink2); font-size:14px }
  .sheet input { width:100%; padding:.7rem .8rem; border:1px solid var(--line); border-radius:10px; font:16px var(--body); background:var(--bg); color:var(--ink) }
  .sheet .row { display:flex; gap:.6rem; margin-top:1rem }
  .err { color:#b42318; font-size:13px; min-height:1.2em; margin:.4rem 0 0 }
  [hidden] { display:none !important }

  @media print {
    @page { margin:14mm 12mm }
    body { background:#fff; font-size:12.5px }
    .wrap { max-width:none; padding:0 }
    .paper { border:0; box-shadow:none; padding:0; border-radius:0 }
    .acciones, #modal { display:none !important }
    .para { background:#f3f1ec; -webkit-print-color-adjust:exact; print-color-adjust:exact }
    .bloque, .para, .firma { break-inside:avoid }
    a { color:inherit; text-decoration:none }
  }
</style>
</head>
<body>
<div class="wrap">
  <article class="paper">
    <header class="top">
      <div class="brand"><i>T</i>Tratto</div>
      <div class="meta"><b>${esc(c.folio)}</b>${esc(fechaLarga(c.fecha))}<br>Vigente hasta el ${esc(fechaLarga(venceEl))}</div>
    </header>
    ${banner}
    <div class="para">
      <div><span>Preparada para</span><b>${esc(c.empresa)}</b></div>
      ${c.contacto ? `<div><span>Atención</span><b>${esc(c.contacto)}</b>${c.puesto ? ` · ${esc(c.puesto)}` : ''}</div>` : ''}
    </div>
    <h1>${esc(c.nombre)}</h1>
    <p class="lede">Un portal hecho a la medida de cómo trabaja tu equipo, construido a partir de entrevistas con quienes venden, compran y validan. Listo en 5 semanas.</p>

    ${c.alcance?.trim() ? `<section class="bloque alcance"><div class="bh"><h2>Qué incluye</h2></div>${lista(c.alcance)}</section>` : ''}

    ${tabla('Inversión inicial', 'Se paga una sola vez, al arrancar.', unico, t.unico, c.iva, c.moneda)}
    ${tabla('Renta mensual', 'A partir de la entrega del portal. Sin cobro por usuario.', mensual, t.mensual, c.iva, c.moneda, '<span class="mes"> / mes</span>')}

    ${c.condiciones?.trim() ? `<section class="bloque cond"><div class="bh"><h2>Condiciones</h2></div>${lista(c.condiciones)}</section>` : ''}

    <footer class="firma">
      <b>${esc(a.razon_social || 'Tratto')}</b>${contacto ? ` · ${contacto}` : ''}${legal && legal !== esc(a.razon_social || '') ? `<br>${legal}` : ''}
      <br>Cotización ${esc(c.folio)} · Precios en ${esc(c.moneda)} · IVA ${esc(c.iva)}% incluido en los totales
    </footer>
  </article>

  <div class="acciones">
    <button class="btn ghost" onclick="window.print()">Guardar PDF</button>
    ${puedeAceptar ? `<button class="btn primary" id="aceptar">Aceptar cotización</button>` : ''}
  </div>
</div>

<div id="modal" hidden>
  <form class="sheet" id="form">
    <h3>Aceptar ${esc(c.folio)}</h3>
    <p>Escribe tu nombre para confirmar. Nosotros te contactamos para arrancar.</p>
    <input name="nombre" placeholder="Tu nombre" required maxlength="120" autocomplete="name">
    <div class="err" id="err"></div>
    <div class="row">
      <button type="button" class="btn ghost" id="cancelar">Cancelar</button>
      <button type="submit" class="btn primary" id="ok">Confirmar</button>
    </div>
  </form>
</div>

<script>
(function(){
  var b=document.getElementById('aceptar'); if(!b) return;
  var modal=document.getElementById('modal'), form=document.getElementById('form'), err=document.getElementById('err');
  b.onclick=function(){ modal.hidden=false; form.nombre.focus(); };
  document.getElementById('cancelar').onclick=function(){ modal.hidden=true; };
  modal.onclick=function(e){ if(e.target===modal) modal.hidden=true; };
  form.onsubmit=function(e){
    e.preventDefault(); err.textContent=''; document.getElementById('ok').disabled=true;
    fetch('/c/${esc(token)}/aceptar',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({nombre:form.nombre.value})})
      .then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j.error||'no se pudo'); location.reload(); }); })
      .catch(function(x){ err.textContent=x.message; document.getElementById('ok').disabled=false; });
  };
})();
</script>
</body>
</html>`;
}
