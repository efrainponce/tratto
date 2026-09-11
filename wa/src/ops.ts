// Operaciones sobre hilos, compartidas por la API de operación (/admin/*, Bearer
// ADMIN_TOKEN) y por la bandeja (/inbox/api/*, sesión de usuario). Una sola
// implementación para que las dos puertas hagan exactamente lo mismo.
import type { Env } from './env';
import { phone10, sendDocument, sendTemplate, sendText, uploadMedia, type Archivo, type Plantilla } from './wa';
import { logOutbound } from './routing';
import { destinoManual } from './cambio';

export interface Result { status: number; body: Record<string, unknown> | unknown[] }

const ok = (body: Record<string, unknown> | unknown[] = { ok: true }): Result => ({ status: 200, body });
const fail = (status: number, error: string, detalle?: string): Result =>
  ({ status, body: detalle ? { error, detalle } : { error } });

// La ventana de 24 h de Meta se cuenta desde el último mensaje QUE MANDÓ LA
// PERSONA, no desde la última actividad del hilo: sendPortal crea el hilo al
// mandarle una plantilla a alguien que nunca ha escrito, y con `last_seen` la
// ventana saldría abierta y el texto libre rebotaría en Meta (#131047).
const ABIERTA = `EXISTS (SELECT 1 FROM messages m WHERE m.phone10 = t.phone10 AND m.direction = 'in'
                   AND m.created_at > datetime('now','-24 hours'))`;

const THREAD_COLS = `
  t.phone10, t.wa_from, t.tenant_slug, t.resolved_by, t.profile_name, t.lead_status,
  t.needs_review, t.msg_count, t.human_until, t.human_by, t.first_seen, t.last_seen,
  ${ABIERTA} AS abierta,
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
  // persona. Fuera de eso solo van plantillas aprobadas, y la bandeja no las manda.
  const open = await env.DB.prepare(
    `SELECT 1 AS yes FROM threads t WHERE t.phone10 = ? AND ${ABIERTA}`,
  ).bind(p10).first();
  if (!open) {
    return fail(409, 'ventana de 24 h cerrada',
      'La persona no nos ha escrito en las últimas 24 h. Fuera de esa ventana WhatsApp solo ' +
      'permite plantillas aprobadas, y la bandeja todavía no las manda.');
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

/**
 * Lo que un PORTAL manda por su cuenta (p. ej. "te llegó una cotización para
 * verificar"). A diferencia de sendHuman NO toma el hilo: es el agente de ese
 * cliente hablando, no una persona. Solo a números que le pertenecen al tenant
 * (por directorio o por hilo pegajoso).
 *
 * Dentro de la ventana de 24 h va como texto (gratis hasta el 1 oct 2026).
 * Fuera de ella —o si el número nunca ha escrito— solo puede ir una PLANTILLA
 * aprobada por Meta (`template`); sin plantilla es 409/404. Meta cobra cada
 * plantilla, por eso el texto va primero cuando se puede.
 */
export async function sendPortal(
  env: Env, args: { tenant: string; phone: string; text: string; template?: Plantilla | null; archivo?: Archivo | null },
): Promise<Result> {
  const p10 = phone10(args.phone ?? '');
  const text = (args.text ?? '').trim();
  const tenant = (args.tenant ?? '').trim();
  if (!tenant) return fail(400, 'tenant requerido');
  if (p10.length !== 10) return fail(400, 'teléfono inválido');
  if (!text) return fail(400, 'texto vacío');
  const tpl = args.template?.name ? args.template : null;

  const t = await env.DB.prepare(`SELECT active FROM tenants WHERE slug = ?`).bind(tenant).first<{ active: number }>();
  if (!t || !t.active) return fail(403, 'tenant desconocido o inactivo');

  const th = await env.DB.prepare(
    `SELECT t.wa_from, t.tenant_slug, ${ABIERTA} AS abierto FROM threads t WHERE t.phone10 = ?`,
  ).bind(p10).first<{ wa_from: string; tenant_slug: string | null; abierto: number }>();

  // El número tiene que ser de ESE cliente: por directorio, o porque su hilo ya
  // quedó ruteado ahí. Un portal jamás le escribe a la gente de otro. Quien cambia
  // de cliente por comando (cambio.ts) es de los dos: el del directorio le sigue
  // avisando y el elegido le puede contestar.
  const dir = await env.DB.prepare(`SELECT tenant_slug FROM directory WHERE phone10 = ?`)
    .bind(p10).first<{ tenant_slug: string }>();
  const suyo = (dir ? dir.tenant_slug === tenant : th?.tenant_slug === tenant)
    || (await destinoManual(env, p10)) === tenant;
  if (!suyo) return fail(403, 'ese número no pertenece a este cliente');

  const abierto = !!th?.abierto;
  if (!abierto && !tpl) {
    return th
      ? fail(409, 'ventana de 24 h cerrada',
          'La persona no nos ha escrito en las últimas 24 h. WhatsApp solo permite plantillas ' +
          'aprobadas fuera de esa ventana.')
      : fail(404, 'ese número nunca ha escrito',
          'WhatsApp solo deja escribirle a quien nos escribió primero (y hace menos de 24 h), ' +
          'o con una plantilla aprobada.');
  }

  // Sin hilo (nunca escribió) el destino se arma con la lada de México: el
  // directorio guarda 10 dígitos y hoy todos los teléfonos son mexicanos.
  const to = th?.wa_from ?? `52${p10}`;
  const modo: 'texto' | 'plantilla' = abierto ? 'texto' : 'plantilla';
  // Con archivo: dentro de la ventana va como UN mensaje de documento con el
  // texto de pie; fuera, en el encabezado de la plantilla si ella lo tiene
  // (si no, va solo el texto y se avisa con `archivo: 'omitido'`).
  const archivo = args.archivo && args.archivo.bytes.byteLength > 0 ? args.archivo : null;
  const cabeArchivo = !!archivo && (modo === 'texto' || tpl?.header === 'document');
  let conArchivo: 'enviado' | 'omitido' | null = archivo ? (cabeArchivo ? 'enviado' : 'omitido') : null;
  try {
    const mediaId = cabeArchivo ? await uploadMedia(env, archivo!) : null;
    if (modo === 'texto') {
      if (mediaId) await sendDocument(env, to, mediaId, archivo!.filename, text);
      else await sendText(env, to, text);
    } else {
      await sendTemplate(env, to, tpl!, mediaId ? { mediaId, filename: archivo!.filename } : null);
    }
  } catch (err) {
    return fail(502, modo === 'texto' ? 'WhatsApp rechazó el envío' : `WhatsApp rechazó la plantilla ${tpl!.name}`, String(err));
  }
  if (!th) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO threads (phone10, wa_from, tenant_slug, resolved_by, profile_name) VALUES (?, ?, ?, 'directory', ?)`,
    ).bind(p10, to, tenant, null).run();
  }
  await logOutbound(env, {
    phone10: p10, to, tenantSlug: tenant, author: 'portal', sentBy: tenant,
    body: `${modo === 'texto' ? '' : `[plantilla ${tpl!.name}] `}${conArchivo === 'enviado' ? `[${archivo!.filename}] ` : ''}${text}`,
  });
  return ok({ ok: true, modo, archivo: conArchivo });
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

/** El archivo de un envío tal como viene en JSON (base64) → bytes. Tope 20 MB
 *  decodificado; `null` si no hay archivo o no se pudo leer. */
export function archivoDe(media: { filename?: string; mime?: string; base64?: string } | null | undefined): Archivo | null {
  if (!media?.base64) return null;
  if (media.base64.length > 28_000_000) throw new Error('archivo demasiado grande (máx. 20 MB)');
  const bin = atob(media.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes: bytes.buffer, mime: media.mime || 'application/octet-stream', filename: media.filename || 'archivo' };
}
