// Operaciones sobre hilos, compartidas por la API de operación (/admin/*, Bearer
// ADMIN_TOKEN) y por la bandeja (/inbox/api/*, sesión de usuario). Una sola
// implementación para que las dos puertas hagan exactamente lo mismo.
import type { Env } from './env';
import { phone10, sendText } from './wa';
import { logOutbound } from './routing';

export interface Result { status: number; body: Record<string, unknown> | unknown[] }

const ok = (body: Record<string, unknown> | unknown[] = { ok: true }): Result => ({ status: 200, body });
const fail = (status: number, error: string, detalle?: string): Result =>
  ({ status, body: detalle ? { error, detalle } : { error } });

const THREAD_COLS = `
  t.phone10, t.wa_from, t.tenant_slug, t.resolved_by, t.profile_name, t.lead_status,
  t.needs_review, t.msg_count, t.human_until, t.human_by, t.first_seen, t.last_seen,
  (SELECT m.direction FROM messages m WHERE m.phone10 = t.phone10 ORDER BY m.id DESC LIMIT 1) AS last_direction,
  (SELECT COALESCE(m.body, m.media_name, '(' || m.kind || ')') FROM messages m WHERE m.phone10 = t.phone10 ORDER BY m.id DESC LIMIT 1) AS last_body`;

/** Hilos ordenados por actividad, con el último mensaje para el preview. */
export async function listThreads(
  env: Env, f: { tenant?: string | null; leads?: boolean },
): Promise<Result> {
  let q = env.DB.prepare(`SELECT ${THREAD_COLS} FROM threads t ORDER BY t.last_seen DESC LIMIT 200`);
  if (f.leads) {
    q = env.DB.prepare(`SELECT ${THREAD_COLS} FROM threads t WHERE t.tenant_slug IS NULL ORDER BY t.last_seen DESC LIMIT 200`);
  } else if (f.tenant) {
    q = env.DB.prepare(`SELECT ${THREAD_COLS} FROM threads t WHERE t.tenant_slug = ? ORDER BY t.last_seen DESC LIMIT 200`).bind(f.tenant);
  }
  const { results } = await q.all();
  return ok(results);
}

/** Un hilo completo en orden de lectura (viejo → nuevo). */
export async function getThread(env: Env, phone: string): Promise<Result> {
  const p10 = phone10(phone);
  if (p10.length !== 10) return fail(400, 'teléfono inválido');
  const thread = await env.DB.prepare(`SELECT ${THREAD_COLS} FROM threads t WHERE t.phone10 = ?`).bind(p10).first();
  if (!thread) return fail(404, 'ese número nunca ha escrito');
  const { results } = await env.DB.prepare(
    `SELECT id, body, kind, direction, author, sent_by, dispatch, created_at,
            media_key, media_mime, media_name, media_size
       FROM messages WHERE phone10 = ? ORDER BY id ASC LIMIT 300`,
  ).bind(p10).all();
  return ok({ thread, messages: results });
}

/**
 * Contestar a mano. Toma el hilo automáticamente (`hours`, 6 por defecto): si
 * escribiste tú, tú lo tienes, y el agente se calla ese rato.
 */
export async function sendHuman(
  env: Env, args: { phone: string; text: string; hours?: number; by: string },
): Promise<Result> {
  const p10 = phone10(args.phone ?? '');
  const text = (args.text ?? '').trim();
  if (p10.length !== 10) return fail(400, 'teléfono inválido');
  if (!text) return fail(400, 'texto vacío');

  const th = await env.DB.prepare(
    `SELECT wa_from, tenant_slug FROM threads WHERE phone10 = ?`,
  ).bind(p10).first<{ wa_from: string; tenant_slug: string | null }>();
  if (!th) return fail(404, 'ese número nunca ha escrito');

  // Meta solo deja texto libre dentro de las 24 h desde el último mensaje de la
  // persona. Fuera de eso hay que usar plantilla aprobada, y no tenemos ninguna.
  const open = await env.DB.prepare(
    `SELECT 1 AS yes FROM threads WHERE phone10 = ? AND last_seen > datetime('now','-24 hours')`,
  ).bind(p10).first();
  if (!open) {
    return fail(409, 'ventana de 24 h cerrada',
      'La persona no escribe desde hace más de 24 h. WhatsApp solo permite plantillas ' +
      'aprobadas fuera de esa ventana, y esta cuenta no tiene ninguna.');
  }

  try {
    await sendText(env, th.wa_from, text);
  } catch (err) {
    return fail(502, 'WhatsApp rechazó el envío', String(err));
  }
  await logOutbound(env, {
    phone10: p10, to: th.wa_from, tenantSlug: th.tenant_slug, body: text,
    author: 'human', sentBy: args.by,
  });
  const hours = Number.isFinite(args.hours) ? Number(args.hours) : 6;
  await env.DB.prepare(
    `UPDATE threads SET human_until = datetime('now', ?1), human_by = ?2 WHERE phone10 = ?3`,
  ).bind(`+${hours} hours`, args.by, p10).run();
  return ok({ ok: true, relevo_humano_hasta_en_horas: hours });
}

/** Tomar (hours > 0) o soltar (hours 0) el hilo sin escribir nada. */
export async function handoff(
  env: Env, args: { phone: string; hours?: number | null; by: string },
): Promise<Result> {
  const p10 = phone10(args.phone ?? '');
  if (p10.length !== 10) return fail(400, 'teléfono inválido');
  const hours = args.hours == null ? 0 : Number(args.hours);
  if (hours <= 0) {
    await env.DB.prepare(`UPDATE threads SET human_until = NULL, human_by = NULL WHERE phone10 = ?`)
      .bind(p10).run();
    return ok({ ok: true, relevo: 'soltado — vuelve a contestar el agente' });
  }
  await env.DB.prepare(
    `UPDATE threads SET human_until = datetime('now', ?1), human_by = ?2 WHERE phone10 = ?3`,
  ).bind(`+${hours} hours`, args.by, p10).run();
  return ok({ ok: true, relevo: `humano por ${hours} h` });
}

/** Re-rutear un número a mano (lead que se volvió cliente, o ruteo mal resuelto). */
export async function assign(env: Env, args: { phone: string; tenant: string | null }): Promise<Result> {
  const p10 = phone10(args.phone ?? '');
  if (p10.length !== 10) return fail(400, 'teléfono inválido');
  if (args.tenant) {
    const t = await env.DB.prepare(`SELECT 1 AS yes FROM tenants WHERE slug = ?`).bind(args.tenant).first();
    if (!t) return fail(404, 'ese cliente no existe');
  }
  const res = await env.DB.prepare(
    `UPDATE threads SET tenant_slug = ?, resolved_by = 'sticky', needs_review = 0,
            lead_status = CASE WHEN ? IS NULL THEN lead_status ELSE NULL END
      WHERE phone10 = ?`,
  ).bind(args.tenant, args.tenant, p10).run();
  return ok({ ok: true, actualizados: res.meta?.changes ?? 0 });
}

/** Seguimiento de un lead: nuevo | contactado | descartado. */
export async function setLeadStatus(env: Env, args: { phone: string; status: string }): Promise<Result> {
  const p10 = phone10(args.phone ?? '');
  if (p10.length !== 10) return fail(400, 'teléfono inválido');
  if (!['nuevo', 'contactado', 'descartado'].includes(args.status)) return fail(400, 'estado inválido');
  await env.DB.prepare(`UPDATE threads SET lead_status = ? WHERE phone10 = ?`).bind(args.status, p10).run();
  return ok();
}

export async function listTenants(env: Env): Promise<Result> {
  const { results } = await env.DB.prepare(`SELECT slug, name, active FROM tenants ORDER BY name`).all();
  return ok(results);
}

export function toResponse(r: Result): Response {
  return Response.json(r.body, { status: r.status });
}
