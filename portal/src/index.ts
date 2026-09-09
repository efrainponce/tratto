// tratto-portal — el portal de Tratto para Tratto: clientes, oportunidades (= cotizaciones) y proyectos.
//
//   GET  /                 la app (una sola página; decide sola si pide login)
//   POST /setup            crear el PRIMER usuario (pide ADMIN_TOKEN)
//   POST /login · /logout  cookie de sesión
//   *    /api/*            con sesión — ver api.ts
//   GET  /c/<token>        la cotización pública (sin login) — ver publico-html.ts
//   POST /c/<token>/aceptar
import type { Env } from './env';
import { createSession, destroySession, hashPassword, login, normalizeEmail, passwordProblem, sessionCookie, sessionToken, sessionUser, validEmail } from './auth';
import { ajustes, apiRoutes, body, ganar, json, lineasDe, totales } from './api';
import { appPage, appIcon } from './app-html';
import { paginaCotizacion, type CotizacionPublica } from './publico-html';

async function userCount(env: Env): Promise<number> {
  const r = await env.DB.prepare(`SELECT count(*) AS n FROM users`).first<{ n: number }>();
  return r?.n ?? 0;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    if (req.method === 'GET' && path === '/') {
      return new Response(appPage(), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }
    if (req.method === 'GET' && path === '/icon.svg') {
      return new Response(appIcon(), { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
    }
    if (req.method === 'GET' && path === '/manifest.json') {
      return json({
        name: 'Portal Tratto', short_name: 'Tratto', start_url: '/', scope: '/', display: 'standalone',
        background_color: '#f7f4ee', theme_color: '#1f4d3f',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      }, 200, { 'cache-control': 'public, max-age=3600' });
    }
    if (req.method === 'GET' && path === '/health') return json({ ok: true, env: env.ENVIRONMENT });

    // ── cotización pública ──
    let x: RegExpMatchArray | null;
    if ((x = path.match(/^\/c\/([A-Za-z0-9_-]{10,})(\/aceptar)?$/))) {
      const token = x[1];
      const c = await env.DB.prepare(
        `SELECT o.*, c.nombre AS empresa, k.nombre AS contacto, k.puesto
           FROM oportunidades o JOIN clientes c ON c.id = o.cliente_id LEFT JOIN contactos k ON k.id = o.contacto_id
          WHERE o.token = ?`,
      ).bind(token).first<CotizacionPublica & { id: number }>();
      if (!c) return new Response('Esta cotización no existe o el enlace ya no es válido.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });

      if (req.method === 'POST' && x[2]) {
        const b = await body<{ nombre: string }>(req);
        const nombre = String(b?.nombre ?? '').trim().slice(0, 120);
        if (!nombre) return json({ error: 'escribe tu nombre' }, 400);
        if (c.etapa === 'ganada') return json({ ok: true });
        if (c.etapa === 'perdida') return json({ error: 'esta cotización ya no está disponible' }, 409);
        await env.DB.prepare(`UPDATE oportunidades SET etapa = 'ganada', aceptada_at = datetime('now'), aceptada_por = ?1, updated_at = datetime('now') WHERE id = ?2`).bind(nombre, c.id).run();
        await ganar(env, c.id);
        return json({ ok: true });
      }
      if (req.method !== 'GET' || x[2]) return json({ error: 'not found' }, 404);

      // Cuenta la vista salvo que la abra alguien con sesión en el portal (Efraín revisándola).
      const yo = sessionToken(req) ? await sessionUser(env, req) : null;
      if (!yo) {
        ctx.waitUntil(env.DB.prepare(`INSERT INTO vistas (oportunidad_id) VALUES (?)`).bind(c.id).run());
      }
      const lineas = await lineasDe(env, c.id);
      return new Response(paginaCotizacion(c, lineas, totales(lineas, c.iva), await ajustes(env), token), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
      });
    }

    // ── sesión ──
    if (req.method === 'POST' && path === '/setup') {
      const b = await body<{ token: string; email: string; name: string; password: string }>(req);
      if (!b) return json({ error: 'JSON requerido' }, 400);
      if ((await userCount(env)) > 0) return json({ error: 'ya hay usuarios; entra con tu cuenta' }, 409);
      if (!env.ADMIN_TOKEN || b.token !== env.ADMIN_TOKEN) return json({ error: 'ADMIN_TOKEN incorrecto' }, 401);
      const email = normalizeEmail(b.email);
      if (!validEmail(email)) return json({ error: 'correo inválido' }, 400);
      const name = String(b.name ?? '').trim();
      if (!name) return json({ error: 'nombre requerido' }, 400);
      const bad = passwordProblem(b.password);
      if (bad) return json({ error: bad }, 400);
      const res = await env.DB.prepare(`INSERT INTO users (email, name, password_hash, role) VALUES (?1, ?2, ?3, 'admin')`)
        .bind(email, name, await hashPassword(b.password)).run();
      const token = await createSession(env, Number(res.meta.last_row_id));
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie(env, token) });
    }

    if (req.method === 'POST' && path === '/login') {
      const b = await body<{ email: string; password: string }>(req);
      if (!b) return json({ error: 'JSON requerido' }, 400);
      const r = await login(env, b.email, b.password);
      if ('error' in r) return json({ error: r.error }, r.status);
      const token = await createSession(env, r.user.id);
      return json({ ok: true, user: r.user }, 200, { 'set-cookie': sessionCookie(env, token) });
    }

    if (req.method === 'POST' && path === '/logout') {
      const token = sessionToken(req);
      if (token) await destroySession(env, token);
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie(env, null) });
    }

    // ── API con sesión ──
    if (path.startsWith('/api/')) {
      const me = await sessionUser(env, req);
      if (!me) return json({ error: 'sin sesión', setup: (await userCount(env)) === 0 }, 401);
      return apiRoutes(req, env, url, me);
    }

    return new Response('not found', { status: 404 });
  },
};
