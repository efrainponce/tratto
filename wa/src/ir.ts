// Botones de plantilla que sirven para cualquier cliente. El botón de URL de una
// plantilla de Meta solo admite la variable AL FINAL y con el dominio fijo, así
// que las plantillas apuntan a https://wa.usetratto.com/ir/{{1}} con
// {{1}} = "<tenant>/<ruta>" (p. ej. "janing/oportunidades/10") y aquí se
// redirige al portal de ese cliente (`tenants.portal_url`). Cliente nuevo = una
// fila en `tenants`, no plantillas nuevas.
import type { Env } from './env';

const notFound = () => new Response('not found', { status: 404 });

export async function irAlPortal(env: Env, url: URL): Promise<Response> {
  // Meta puede mandar las "/" del sufijo codificadas (%2F): se decodifica antes de partir.
  let resto: string;
  try { resto = decodeURIComponent(url.pathname.slice('/ir/'.length)); } catch { return notFound(); }
  const corte = resto.indexOf('/');
  const slug = corte === -1 ? resto : resto.slice(0, corte);
  const ruta = corte === -1 ? '' : resto.slice(corte + 1);
  if (!/^[a-z0-9-]+$/.test(slug)) return notFound();

  const t = await env.DB.prepare(`SELECT portal_url FROM tenants WHERE slug = ?`)
    .bind(slug).first<{ portal_url: string | null }>();
  if (!t?.portal_url) return notFound();

  const base = new URL(t.portal_url.replace(/\/?$/, '/'));
  const destino = new URL(ruta.replace(/^\/+/, ''), base);
  // Nunca fuera del portal de ESE cliente: "//otro.com", "https://otro.com" o
  // "\\otro.com" en la ruta no vuelven esto un redirect abierto.
  if (destino.origin !== base.origin) return notFound();
  if (url.search) destino.search = url.search;
  return Response.redirect(destino.toString(), 302);
}
