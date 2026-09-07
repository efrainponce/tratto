// API mínima de operación, para no depender de `wrangler d1 execute` cada vez que
// entra alguien nuevo. Bearer ADMIN_TOKEN; si el secret no está puesto, cerrado.
import type { Env } from './env';
import { phone10, sendText } from './wa';
import { logOutbound } from './routing';

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
    const tenant = url.searchParams.get('tenant');
    const leads = url.searchParams.get('leads');
    let q = env.DB.prepare(`SELECT * FROM threads ORDER BY last_seen DESC LIMIT 200`);
    if (leads === '1') q = env.DB.prepare(`SELECT * FROM threads WHERE tenant_slug IS NULL ORDER BY last_seen DESC LIMIT 200`);
    else if (tenant) q = env.DB.prepare(`SELECT * FROM threads WHERE tenant_slug = ? ORDER BY last_seen DESC LIMIT 200`).bind(tenant);
    const { results } = await q.all();
    return Response.json(results);
  }

  // Re-rutear un número a mano (p. ej. un lead que se volvió cliente).
  //   POST /admin/threads/assign {phone, tenant|null}
  if (req.method === 'POST' && path === '/admin/threads/assign') {
    const b = await req.json<{ phone: string; tenant: string | null }>();
    const p10 = phone10(b.phone ?? '');
    if (p10.length !== 10) return Response.json({ error: 'teléfono inválido' }, { status: 400 });
    const res = await env.DB.prepare(
      `UPDATE threads SET tenant_slug = ?, resolved_by = 'sticky', needs_review = 0 WHERE phone10 = ?`,
    ).bind(b.tenant, p10).run();
    return Response.json({ ok: true, actualizados: res.meta?.changes ?? 0 });
  }

  // Últimos mensajes, para depurar ruteos.
  //   GET /admin/messages?phone=…&tenant=…
  if (req.method === 'GET' && path === '/admin/messages') {
    const phone = url.searchParams.get('phone');
    const tenant = url.searchParams.get('tenant');
    const cols = `id, wa_id, phone10, tenant_slug, resolved_by, kind, body, dispatch,
                  direction, author, created_at`;
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

  // Un hilo completo, en orden de lectura (viejo → nuevo). Es lo que pinta la bandeja.
  //   GET /admin/thread?phone=5511112222
  if (req.method === 'GET' && path === '/admin/thread') {
    const p10 = phone10(url.searchParams.get('phone') ?? '');
    if (p10.length !== 10) return Response.json({ error: 'teléfono inválido' }, { status: 400 });
    const thread = await env.DB.prepare(`SELECT * FROM threads WHERE phone10 = ?`).bind(p10).first();
    const { results } = await env.DB.prepare(
      `SELECT id, body, kind, direction, author, dispatch, created_at
         FROM messages WHERE phone10 = ? ORDER BY id ASC LIMIT 300`,
    ).bind(p10).all();
    return Response.json({ thread, messages: results });
  }

  // Contestar a mano. Toma el hilo automáticamente: si escribiste tú, tú lo tienes.
  //   POST /admin/send {phone, text, hours?}
  if (req.method === 'POST' && path === '/admin/send') {
    const b = await req.json<{ phone: string; text: string; hours?: number }>();
    const p10 = phone10(b.phone ?? '');
    const text = (b.text ?? '').trim();
    if (p10.length !== 10) return Response.json({ error: 'teléfono inválido' }, { status: 400 });
    if (!text) return Response.json({ error: 'texto vacío' }, { status: 400 });

    const th = await env.DB.prepare(
      `SELECT wa_from, tenant_slug, last_seen FROM threads WHERE phone10 = ?`,
    ).bind(p10).first<{ wa_from: string; tenant_slug: string | null; last_seen: string }>();
    if (!th) return Response.json({ error: 'ese número nunca ha escrito' }, { status: 404 });

    // Meta solo deja texto libre dentro de las 24 h desde el último mensaje de la
    // persona. Fuera de eso hay que usar plantilla aprobada, y no tenemos ninguna.
    const open = await env.DB.prepare(
      `SELECT 1 AS yes FROM threads WHERE phone10 = ? AND last_seen > datetime('now','-24 hours')`,
    ).bind(p10).first();
    if (!open) {
      return Response.json({
        error: 'ventana de 24 h cerrada',
        detalle: 'La persona no escribe desde hace más de 24 h. WhatsApp solo permite ' +
                 'plantillas aprobadas fuera de esa ventana, y esta cuenta no tiene ninguna.',
      }, { status: 409 });
    }

    try {
      await sendText(env, th.wa_from, text);
    } catch (err) {
      return Response.json({ error: 'WhatsApp rechazó el envío', detalle: String(err) }, { status: 502 });
    }
    await logOutbound(env, {
      phone10: p10, to: th.wa_from, tenantSlug: th.tenant_slug, body: text, author: 'human',
    });
    const hours = Number.isFinite(b.hours) ? Number(b.hours) : 6;
    await env.DB.prepare(
      `UPDATE threads SET human_until = datetime('now', ?) WHERE phone10 = ?`,
    ).bind(`+${hours} hours`, p10).run();
    return Response.json({ ok: true, relevo_humano_hasta_en_horas: hours });
  }

  // Tomar o soltar el hilo sin escribir nada.
  //   POST /admin/threads/handoff {phone, hours}   — hours 0/null = soltar
  if (req.method === 'POST' && path === '/admin/threads/handoff') {
    const b = await req.json<{ phone: string; hours?: number | null }>();
    const p10 = phone10(b.phone ?? '');
    if (p10.length !== 10) return Response.json({ error: 'teléfono inválido' }, { status: 400 });
    const hours = b.hours == null ? 0 : Number(b.hours);
    if (hours <= 0) {
      await env.DB.prepare(`UPDATE threads SET human_until = NULL WHERE phone10 = ?`).bind(p10).run();
      return Response.json({ ok: true, relevo: 'soltado — vuelve a contestar el agente' });
    }
    await env.DB.prepare(`UPDATE threads SET human_until = datetime('now', ?) WHERE phone10 = ?`)
      .bind(`+${hours} hours`, p10).run();
    return Response.json({ ok: true, relevo: `humano por ${hours} h` });
  }

  return new Response('not found', { status: 404 });
}
