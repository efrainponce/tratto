// API mínima de operación, para no depender de `wrangler d1 execute` cada vez que
// entra alguien nuevo. Bearer ADMIN_TOKEN; si el secret no está puesto, cerrado.
//
// Lo que toca hilos (listar, leer, contestar, tomar/soltar, re-rutear) vive en
// ops.ts y lo comparte con la bandeja: aquí solo cambia la puerta de entrada.
import type { Env } from './env';
import { phone10 } from './wa';
import * as ops from './ops';
import { hashPassword, normalizeEmail, passwordProblem, validEmail } from './auth';

function authed(req: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false;
  const h = req.headers.get('authorization') ?? '';
  return h === `Bearer ${env.ADMIN_TOKEN}`;
}

export async function adminRoutes(req: Request, env: Env, url: URL): Promise<Response> {
  if (!authed(req, env)) return new Response('unauthorized', { status: 401 });
  const path = url.pathname;

  // Alta/edición de cliente.
  //   POST /admin/tenants {slug, name, inbound_url?, ack_text?, active?}
  if (req.method === 'POST' && path === '/admin/tenants') {
    const b = await req.json<{
      slug: string; name: string; inbound_url?: string; ack_text?: string; active?: boolean;
    }>();
    if (!b.slug || !b.name) return Response.json({ error: 'slug y name requeridos' }, { status: 400 });
    await env.DB.prepare(
      `INSERT INTO tenants (slug, name, inbound_url, ack_text, active)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(slug) DO UPDATE SET
         name = excluded.name, inbound_url = excluded.inbound_url,
         ack_text = excluded.ack_text, active = excluded.active`,
    ).bind(b.slug, b.name, b.inbound_url ?? null, b.ack_text ?? null, b.active === false ? 0 : 1).run();
    return Response.json({ ok: true });
  }

  if (req.method === 'GET' && path === '/admin/tenants') {
    const { results } = await env.DB.prepare(`SELECT * FROM tenants ORDER BY slug`).all();
    return Response.json(results);
  }

  // Alta de teléfonos al directorio (uno o muchos).
  //   POST /admin/directory {tenant, people: [{phone, name?, role?}]}
  if (req.method === 'POST' && path === '/admin/directory') {
    const b = await req.json<{
      tenant: string; people: Array<{ phone: string; name?: string; role?: string }>;
    }>();
    if (!b.tenant || !Array.isArray(b.people)) {
      return Response.json({ error: 'tenant y people[] requeridos' }, { status: 400 });
    }
    const stmt = env.DB.prepare(
      `INSERT INTO directory (phone10, tenant_slug, name, role, source, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'manual', datetime('now'))
       ON CONFLICT(phone10) DO UPDATE SET
         tenant_slug = excluded.tenant_slug, name = excluded.name,
         role = excluded.role, updated_at = datetime('now')`,
    );
    const rows = b.people.filter(p => phone10(p.phone).length === 10);
    if (rows.length === 0) return Response.json({ error: 'ningún teléfono válido' }, { status: 400 });
    await env.DB.batch(rows.map(p => stmt.bind(phone10(p.phone), b.tenant, p.name ?? null, p.role ?? null)));
    return Response.json({ ok: true, alta: rows.length, ignorados: b.people.length - rows.length });
  }

  if (req.method === 'GET' && path === '/admin/directory') {
    const tenant = url.searchParams.get('tenant');
    const q = tenant
      ? env.DB.prepare(`SELECT * FROM directory WHERE tenant_slug = ? ORDER BY name`).bind(tenant)
      : env.DB.prepare(`SELECT * FROM directory ORDER BY tenant_slug, name`);
    const { results } = await q.all();
    return Response.json(results);
  }

  // Hilos: quién ha escrito, a qué cliente quedó ruteado, cuántos mensajes.
  //   GET /admin/threads?tenant=janing | ?leads=1
  if (req.method === 'GET' && path === '/admin/threads') {
    return ops.toResponse(await ops.listThreads(env, {
      tenant: url.searchParams.get('tenant'),
      leads: url.searchParams.get('leads') === '1',
    }));
  }

  // Re-rutear un número a mano (p. ej. un lead que se volvió cliente).
  //   POST /admin/threads/assign {phone, tenant|null}
  if (req.method === 'POST' && path === '/admin/threads/assign') {
    const b = await req.json<{ phone: string; tenant: string | null }>();
    return ops.toResponse(await ops.assign(env, b));
  }

  // Últimos mensajes, para depurar ruteos.
  //   GET /admin/messages?phone=…&tenant=…
  if (req.method === 'GET' && path === '/admin/messages') {
    const phone = url.searchParams.get('phone');
    const tenant = url.searchParams.get('tenant');
    const cols = `id, wa_id, phone10, tenant_slug, resolved_by, kind, body, dispatch,
                  direction, author, sent_by, created_at`;
    let q = env.DB.prepare(`SELECT ${cols} FROM messages ORDER BY id DESC LIMIT 100`);
    if (phone) {
      q = env.DB.prepare(`SELECT ${cols} FROM messages WHERE phone10 = ? ORDER BY id DESC LIMIT 100`)
        .bind(phone10(phone));
    } else if (tenant) {
      q = env.DB.prepare(`SELECT ${cols} FROM messages WHERE tenant_slug = ? ORDER BY id DESC LIMIT 100`)
        .bind(tenant);
    }
    const { results } = await q.all();
    return Response.json(results);
  }

  // Un hilo completo, en orden de lectura (viejo → nuevo).
  //   GET /admin/thread?phone=5511112222
  if (req.method === 'GET' && path === '/admin/thread') {
    return ops.toResponse(await ops.getThread(env, url.searchParams.get('phone') ?? ''));
  }

  // Contestar a mano. Toma el hilo automáticamente.
  //   POST /admin/send {phone, text, hours?}
  if (req.method === 'POST' && path === '/admin/send') {
    const b = await req.json<{ phone: string; text: string; hours?: number }>();
    return ops.toResponse(await ops.sendHuman(env, { ...b, by: 'api' }));
  }

  // Tomar o soltar el hilo sin escribir nada.
  //   POST /admin/threads/handoff {phone, hours}   — hours 0/null = soltar
  if (req.method === 'POST' && path === '/admin/threads/handoff') {
    const b = await req.json<{ phone: string; hours?: number | null }>();
    return ops.toResponse(await ops.handoff(env, { ...b, by: 'api' }));
  }

  // Usuarios de la bandeja. Normalmente se administran desde /inbox; esto es la
  // vía de rescate: crear el primero, o resetear la contraseña de quien la perdió.
  //   POST /admin/users {email, name?, password, role?}   — upsert por correo
  //   GET  /admin/users
  if (req.method === 'POST' && path === '/admin/users') {
    const b = await req.json<{ email: string; name?: string; password: string; role?: string }>();
    const email = normalizeEmail(b.email);
    if (!validEmail(email)) return Response.json({ error: 'correo inválido' }, { status: 400 });
    const bad = passwordProblem(b.password);
    if (bad) return Response.json({ error: bad }, { status: 400 });
    // Si es nuevo y no se dice rol, agente. Si ya existe, el rol y el nombre solo
    // cambian cuando vienen en el cuerpo.
    const roleGiven = b.role === 'admin' || b.role === 'agente';
    const hash = await hashPassword(b.password);
    const givenName = (b.name ?? '').trim();
    await env.DB.prepare(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(email) DO UPDATE SET
         password_hash = excluded.password_hash,
         name = CASE WHEN ?5 = 1 THEN excluded.name ELSE users.name END,
         role = CASE WHEN ?6 = 1 THEN excluded.role ELSE users.role END,
         active = 1`,
    ).bind(
      email, givenName || email.split('@')[0], hash, roleGiven ? b.role : 'agente',
      givenName ? 1 : 0, roleGiven ? 1 : 0,
    ).run();
    // Cambiar contraseña por aquí cierra las sesiones abiertas de esa cuenta.
    await env.DB.prepare(
      `DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)`,
    ).bind(email).run();
    const row = await env.DB.prepare(`SELECT id, email, name, role FROM users WHERE email = ?`).bind(email).first();
    return Response.json({ ok: true, user: row });
  }

  if (req.method === 'GET' && path === '/admin/users') {
    const { results } = await env.DB.prepare(
      `SELECT id, email, name, role, active, created_at, last_login_at FROM users ORDER BY id`,
    ).all();
    return Response.json(results);
  }

  return new Response('not found', { status: 404 });
}
