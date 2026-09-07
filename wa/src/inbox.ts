// La bandeja (/inbox): rutas de sesión + API que usa la página. Cada persona entra
// con su cuenta (tabla `users`); lo que hace sobre los hilos lleva su nombre.
//
//   GET  /inbox                 la página (una sola, decide sola si pide login)
//   GET  /inbox/manifest.json   para "añadir a pantalla de inicio" en el cel
//   POST /inbox/setup           crear el PRIMER usuario (pide ADMIN_TOKEN)
//   POST /inbox/login           correo + contraseña → cookie de sesión
//   POST /inbox/logout
//   *    /inbox/api/*           con sesión: hilos, mensajes, enviar, usuarios…
import type { Env } from './env';
import * as ops from './ops';
import {
  createSession, destroySession, hashPassword, login, normalizeEmail, passwordProblem,
  sessionCookie, sessionToken, sessionUser, validEmail, verifyPassword, type User,
} from './auth';
import { inboxPage, inboxIcon } from './inbox-html';
import { serve as serveMedia } from './media';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

async function body<T>(req: Request): Promise<T | null> {
  // Todo lo que muta viene como JSON desde la página. Exigir el content-type es un
  // freno barato extra contra CSRF (un <form> no puede mandarlo).
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) return null;
  try { return await req.json<T>(); } catch { return null; }
}

async function userCount(env: Env): Promise<number> {
  const r = await env.DB.prepare(`SELECT count(*) AS n FROM users`).first<{ n: number }>();
  return r?.n ?? 0;
}

export async function inboxRoutes(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/$/, '') || '/inbox';

  if (req.method === 'GET' && path === '/inbox') {
    return new Response(inboxPage(), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  if (req.method === 'GET' && path === '/inbox/manifest.json') {
    return json({
      name: 'Bandeja Tratto', short_name: 'Bandeja', start_url: '/inbox', scope: '/inbox',
      display: 'standalone', background_color: '#111b21', theme_color: '#008069',
      icons: [{ src: '/inbox/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    }, 200, { 'cache-control': 'public, max-age=3600' });
  }
  if (req.method === 'GET' && path === '/inbox/icon.svg') {
    return new Response(inboxIcon(), {
      headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' },
    });
  }

  // ── sesión ──────────────────────────────────────────────────────────────────

  // Primer usuario. Solo funciona mientras la tabla está vacía y exige el
  // ADMIN_TOKEN: así la página puede ser pública sin que cualquiera se nombre admin.
  if (req.method === 'POST' && path === '/inbox/setup') {
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

    const res = await env.DB.prepare(
      `INSERT INTO users (email, name, password_hash, role) VALUES (?1, ?2, ?3, 'admin')`,
    ).bind(email, name, await hashPassword(b.password)).run();
    const token = await createSession(env, Number(res.meta.last_row_id));
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(env, token) });
  }

  if (req.method === 'POST' && path === '/inbox/login') {
    const b = await body<{ email: string; password: string }>(req);
    if (!b) return json({ error: 'JSON requerido' }, 400);
    const r = await login(env, b.email, b.password);
    if ('error' in r) return json({ error: r.error }, r.status);
    const token = await createSession(env, r.user.id);
    return json({ ok: true, user: publicUser(r.user) }, 200, { 'set-cookie': sessionCookie(env, token) });
  }

  if (req.method === 'POST' && path === '/inbox/logout') {
    const token = sessionToken(req);
    if (token) await destroySession(env, token);
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(env, null) });
  }

  // ── API con sesión ──────────────────────────────────────────────────────────

  if (!path.startsWith('/inbox/api/')) return new Response('not found', { status: 404 });

  const user = await sessionUser(env, req);
  if (!user) {
    // `setup: true` le dice a la página que muestre el alta del primer usuario en
    // vez del login. Es la única pista que se da sin sesión.
    const setup = (await userCount(env)) === 0;
    return json({ error: 'sin sesión', setup }, 401);
  }
  const by = user.name;
  const api = path.slice('/inbox/api'.length);

  if (req.method === 'GET' && api === '/me') return json({ user: publicUser(user) });

  if (req.method === 'GET' && api === '/threads') {
    return ops.toResponse(await ops.listThreads(env, {
      tenant: url.searchParams.get('tenant'),
      leads: url.searchParams.get('leads') === '1',
    }));
  }
  if (req.method === 'GET' && api === '/thread') {
    return ops.toResponse(await ops.getThread(env, url.searchParams.get('phone') ?? ''));
  }
  if (req.method === 'GET' && api === '/tenants') return ops.toResponse(await ops.listTenants(env));

  // Fotos y documentos del hilo. Con sesión basta: quien ve la bandeja ve todo.
  if (req.method === 'GET' && api.startsWith('/media/')) {
    return serveMedia(env, decodeURIComponent(api.slice('/media/'.length)));
  }

  if (req.method === 'POST' && api === '/send') {
    const b = await body<{ phone: string; text: string }>(req);
    if (!b) return json({ error: 'JSON requerido' }, 400);
    return ops.toResponse(await ops.sendHuman(env, { phone: b.phone, text: b.text, by }));
  }
  if (req.method === 'POST' && api === '/handoff') {
    const b = await body<{ phone: string; hours?: number | null }>(req);
    if (!b) return json({ error: 'JSON requerido' }, 400);
    return ops.toResponse(await ops.handoff(env, { phone: b.phone, hours: b.hours, by }));
  }
  if (req.method === 'POST' && api === '/assign') {
    const b = await body<{ phone: string; tenant: string | null }>(req);
    if (!b) return json({ error: 'JSON requerido' }, 400);
    return ops.toResponse(await ops.assign(env, { phone: b.phone, tenant: b.tenant || null }));
  }
  if (req.method === 'POST' && api === '/lead') {
    const b = await body<{ phone: string; status: string }>(req);
    if (!b) return json({ error: 'JSON requerido' }, 400);
    return ops.toResponse(await ops.setLeadStatus(env, b));
  }

  // Mi contraseña.
  if (req.method === 'POST' && api === '/password') {
    const b = await body<{ current: string; next: string }>(req);
    if (!b) return json({ error: 'JSON requerido' }, 400);
    const bad = passwordProblem(b.next);
    if (bad) return json({ error: bad }, 400);
    const row = await env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?`)
      .bind(user.id).first<{ password_hash: string }>();
    if (!row || !(await verifyPassword(String(b.current ?? ''), row.password_hash))) {
      return json({ error: 'la contraseña actual no coincide' }, 401);
    }
    await env.DB.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`)
      .bind(await hashPassword(b.next), user.id).run();
    return json({ ok: true });
  }

  // ── usuarios (solo admin) ───────────────────────────────────────────────────

  if (api.startsWith('/users')) {
    if (user.role !== 'admin') return json({ error: 'solo administradores' }, 403);

    if (req.method === 'GET' && api === '/users') {
      const { results } = await env.DB.prepare(
        `SELECT id, email, name, role, active, created_at, last_login_at FROM users ORDER BY name`,
      ).all();
      return json(results);
    }

    // Alta. La contraseña la pone el admin y se la pasa a la persona; ella la
    // cambia después desde su menú. Sin correo de invitación: no hace falta aún.
    if (req.method === 'POST' && api === '/users') {
      const b = await body<{ email: string; name: string; password: string; role?: string }>(req);
      if (!b) return json({ error: 'JSON requerido' }, 400);
      const email = normalizeEmail(b.email);
      if (!validEmail(email)) return json({ error: 'correo inválido' }, 400);
      const name = String(b.name ?? '').trim();
      if (!name) return json({ error: 'nombre requerido' }, 400);
      const bad = passwordProblem(b.password);
      if (bad) return json({ error: bad }, 400);
      const dup = await env.DB.prepare(`SELECT 1 AS yes FROM users WHERE email = ?`).bind(email).first();
      if (dup) return json({ error: 'ese correo ya tiene cuenta' }, 409);
      await env.DB.prepare(
        `INSERT INTO users (email, name, password_hash, role) VALUES (?1, ?2, ?3, ?4)`,
      ).bind(email, name, await hashPassword(b.password), b.role === 'admin' ? 'admin' : 'agente').run();
      return json({ ok: true });
    }

    // Edición: activar/desactivar, rol, nombre, resetear contraseña.
    if (req.method === 'POST' && api === '/users/update') {
      const b = await body<{
        id: number; active?: boolean; role?: string; name?: string; password?: string;
      }>(req);
      if (!b || !b.id) return json({ error: 'id requerido' }, 400);
      const target = await env.DB.prepare(`SELECT id, role, active FROM users WHERE id = ?`)
        .bind(b.id).first<{ id: number; role: string; active: number }>();
      if (!target) return json({ error: 'no existe' }, 404);

      // Nadie se quita a sí mismo el admin ni se desactiva: sería quedarse fuera.
      if (target.id === user.id && (b.active === false || (b.role && b.role !== 'admin'))) {
        return json({ error: 'no puedes desactivarte ni quitarte el admin a ti mismo' }, 400);
      }
      const sets: string[] = [];
      const vals: unknown[] = [];
      if (typeof b.active === 'boolean') { sets.push('active = ?'); vals.push(b.active ? 1 : 0); }
      if (b.role) { sets.push('role = ?'); vals.push(b.role === 'admin' ? 'admin' : 'agente'); }
      if (typeof b.name === 'string' && b.name.trim()) { sets.push('name = ?'); vals.push(b.name.trim()); }
      if (typeof b.password === 'string') {
        const bad = passwordProblem(b.password);
        if (bad) return json({ error: bad }, 400);
        sets.push('password_hash = ?'); vals.push(await hashPassword(b.password));
      }
      if (sets.length === 0) return json({ error: 'nada que cambiar' }, 400);
      vals.push(b.id);
      await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
      // Desactivar o resetear contraseña cierra sus sesiones.
      if (b.active === false || typeof b.password === 'string') {
        await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(b.id).run();
      }
      return json({ ok: true });
    }
  }

  return new Response('not found', { status: 404 });
}

function publicUser(u: User) {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}
