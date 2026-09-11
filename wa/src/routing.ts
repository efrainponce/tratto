// El corazón del gateway: de un número suelto a "esto es de Janing" (o "esto es un lead").
import type { Env } from './env';
import { hmacHex } from './crypto';
import { phone10, type Plantilla } from './wa';
import { signedUrl, type MediaRef, type StoredMedia } from './media';

export interface Incoming {
  waId: string;
  from: string;          // como lo manda Meta
  kind: string;          // text | image | document | audio | video | sticker | ...
  text: string | null;   // en media: el caption, si lo hubo
  media: MediaRef | null;      // lo que dice Meta que hay
  stored: StoredMedia | null;  // lo que ya quedó en R2 (se llena antes de despachar)
  profileName: string | null;
  timestamp: string | null;
  raw: unknown;
}

export interface Tenant {
  slug: string;
  name: string;
  inbound_url: string | null;
  ack_text: string | null;
}

export interface Resolution {
  phone10: string;
  tenant: Tenant | null;             // null = lead
  resolvedBy: 'directory' | 'sticky' | 'lead';
  contactName: string | null;
  contactRole: string | null;
}

/**
 * Orden de resolución, de más fuerte a más débil:
 *   1. `directory` — el número está dado de alta con su cliente. Manda siempre:
 *      si a alguien lo movieron de cliente, el directorio corrige el hilo viejo.
 *   2. `threads` (pegajoso) — ya habíamos ligado ese número a un cliente antes
 *      (alta manual, o un lead que se volvió cliente). Sobrevive aunque no esté
 *      en el directorio.
 *   3. lead — desconocido. NO se rechaza: entra igual y queda para ventas.
 *
 * A propósito NO es fail-closed como el bot de cmp-portal: allá un número fuera de
 * la whitelist es alguien que no debería operar el sistema; aquí un número
 * desconocido es justo lo que queremos capturar.
 */
export async function resolve(env: Env, msg: Incoming): Promise<Resolution> {
  const p10 = phone10(msg.from);

  const dir = await env.DB.prepare(
    `SELECT d.tenant_slug, d.name, d.role, t.slug, t.name AS tenant_name, t.inbound_url, t.ack_text
       FROM directory d
       JOIN tenants t ON t.slug = d.tenant_slug AND t.active = 1
      WHERE d.phone10 = ?`,
  ).bind(p10).first<Record<string, string | null>>();

  if (dir) {
    return {
      phone10: p10,
      tenant: {
        slug: dir.slug as string,
        name: dir.tenant_name as string,
        inbound_url: dir.inbound_url,
        ack_text: dir.ack_text,
      },
      resolvedBy: 'directory',
      contactName: dir.name,
      contactRole: dir.role,
    };
  }

  const sticky = await env.DB.prepare(
    `SELECT t.slug, t.name AS tenant_name, t.inbound_url, t.ack_text
       FROM threads th
       JOIN tenants t ON t.slug = th.tenant_slug AND t.active = 1
      WHERE th.phone10 = ?`,
  ).bind(p10).first<Record<string, string | null>>();

  if (sticky) {
    return {
      phone10: p10,
      tenant: {
        slug: sticky.slug as string,
        name: sticky.tenant_name as string,
        inbound_url: sticky.inbound_url,
        ack_text: sticky.ack_text,
      },
      resolvedBy: 'sticky',
      contactName: null,
      contactRole: null,
    };
  }

  return { phone10: p10, tenant: null, resolvedBy: 'lead', contactName: null, contactRole: null };
}

export interface ThreadState {
  isNew: boolean;          // primera vez que este número escribe
  humanUntil: string | null;  // relevo humano vigente; null = contesta el agente
}

/** ¿Alguien tomó este hilo a mano y sigue vigente? */
export async function humanHasThread(env: Env, p10: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS yes FROM threads WHERE phone10 = ? AND human_until > datetime('now')`,
  ).bind(p10).first<{ yes: number }>();
  return !!row;
}

/** Upsert del hilo. `lead_status` solo se siembra la primera vez, para no pisar
 *  el seguimiento que ventas haya puesto después.
 *
 *  Devuelve `isNew` porque es la única señal barata de "lead nuevo": leer el estado
 *  ANTES del upsert. Después ya no se distingue, el upsert borra la evidencia. */
export async function touchThread(env: Env, msg: Incoming, r: Resolution): Promise<ThreadState> {
  const before = await env.DB.prepare(
    `SELECT human_until FROM threads WHERE phone10 = ?`,
  ).bind(r.phone10).first<{ human_until: string | null }>();

  await env.DB.prepare(
    `INSERT INTO threads (phone10, wa_from, tenant_slug, resolved_by, profile_name, lead_status, msg_count)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)
     ON CONFLICT(phone10) DO UPDATE SET
       wa_from      = excluded.wa_from,
       tenant_slug  = COALESCE(excluded.tenant_slug, threads.tenant_slug),
       resolved_by  = excluded.resolved_by,
       profile_name = COALESCE(excluded.profile_name, threads.profile_name),
       msg_count    = threads.msg_count + 1,
       last_seen    = datetime('now')`,
  ).bind(
    r.phone10,
    msg.from,
    r.tenant?.slug ?? null,
    r.resolvedBy,
    msg.profileName,
    r.tenant ? null : 'nuevo',
  ).run();

  return { isNew: !before, humanUntil: before?.human_until ?? null };
}

export async function logMessage(
  env: Env, msg: Incoming, r: Resolution, dispatch: string,
): Promise<void> {
  const s = msg.stored;
  await env.DB.prepare(
    `INSERT INTO messages (wa_id, phone10, wa_from, tenant_slug, resolved_by, kind, body, raw, dispatch, direction,
                           media_key, media_mime, media_name, media_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'in', ?, ?, ?, ?)`,
  ).bind(
    msg.waId, r.phone10, msg.from, r.tenant?.slug ?? null, r.resolvedBy,
    msg.kind, msg.text, JSON.stringify(msg.raw), dispatch,
    s?.key ?? null, s?.mime ?? null, s?.filename ?? null, s?.size ?? null,
  ).run();
}

/** Lo que SALE. Sin esto la bandeja muestra preguntas sin respuestas. */
export async function logOutbound(
  env: Env,
  opts: {
    phone10: string; to: string; tenantSlug: string | null; body: string; author: string;
    sentBy?: string | null;   // nombre del usuario de la bandeja (author = human)
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO messages (wa_id, phone10, wa_from, tenant_slug, resolved_by, kind, body, raw, dispatch, direction, author, sent_by)
     VALUES (?, ?, ?, ?, 'out', 'text', ?, ?, 'sent', 'out', ?, ?)`,
  ).bind(
    `out.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
    opts.phone10, opts.to, opts.tenantSlug, opts.body,
    JSON.stringify({ to: opts.to, body: opts.body }), opts.author, opts.sentBy ?? null,
  ).run();
}

/** true si ya habíamos procesado esa entrega (Meta reintenta). */
export async function alreadyProcessed(env: Env, waId: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO processed (wa_id) VALUES (?)`,
  ).bind(waId).run();
  return (res.meta?.changes ?? 0) === 0;
}

/** Un envío que el portal nos pide hacer por él (mismo contrato que
 *  /portal/send, con el archivo en base64). Se ejecuta en index.ts después
 *  de contestar: el portal no puede llamarnos de regreso desde un request
 *  que le llegó por service binding (recursión → 522). */
export interface EnvioPortal {
  phone: string; text: string;
  template?: Plantilla | null;
  media?: { filename?: string; mime?: string; base64?: string } | null;
}
export interface DispatchResult { status: string; reply: string | null; sends: EnvioPortal[] }

/**
 * Reenvía el mensaje al portal del cliente y devuelve lo que ese portal quiera
 * contestar. El portal valida `x-tratto-signature` (HMAC del cuerpo con
 * GATEWAY_SECRET) — es su única prueba de que el mensaje viene de aquí y no de
 * cualquiera que descubra la URL.
 */
/** Tope de lo que se manda en el payload. El portal de Janing rechaza arriba
 *  de 10 MB de todos modos, y base64 infla un tercio: por encima de esto se
 *  manda solo la URL y que el portal se las arregle. */
const MAX_INLINE_BYTES = 10 * 1024 * 1024;

/** Lee el objeto de R2 y lo devuelve en base64, o null si no se puede. Que
 *  falle NO tumba el despacho: el portal todavía tiene la URL firmada. */
async function bytesBase64(env: Env, key: string, size: number): Promise<string | null> {
  if (size > MAX_INLINE_BYTES) return null;
  try {
    const obj = await env.MEDIA.get(key);
    if (!obj) return null;
    const u8 = new Uint8Array(await obj.arrayBuffer());
    let bin = '';
    const TRAMO = 0x8000;
    for (let i = 0; i < u8.length; i += TRAMO) bin += String.fromCharCode(...u8.subarray(i, i + TRAMO));
    return btoa(bin);
  } catch (err) {
    console.error('bytesBase64', key, err);
    return null;
  }
}

export async function dispatchToTenant(
  env: Env, msg: Incoming, r: Resolution,
): Promise<DispatchResult> {
  const tenant = r.tenant;
  if (!tenant) return { status: 'lead', reply: null, sends: [] };
  if (!tenant.inbound_url) {
    return { status: 'no_handler', reply: tenant.ack_text, sends: [] };
  }

  // `media` va null en texto, y también si Meta no nos dejó bajar el archivo: el
  // portal ve por `kind` que había algo y decide qué hacer.
  //
  // Con un tenant por service binding los bytes van DENTRO del payload
  // (`data`, base64) además de la URL firmada: desde dentro del request que le
  // acabamos de entregar, el portal no puede hacerle fetch a
  // wa.usetratto.com — Cloudflare corta esa vuelta como recursión y devuelve
  // 522. Es el mismo muro que obligó a que sus envíos salieran por `sends[]`.
  // Por URL (tenant HTTP normal) no aplica: ahí el portal es otro origen.
  const s = msg.stored;
  const porBinding = tenant.inbound_url.startsWith('binding:');
  const media = s
    ? {
        url: await signedUrl(env, s.key),
        data: porBinding ? await bytesBase64(env, s.key, s.size) : null,
        mime: s.mime, filename: s.filename, size: s.size, sha256: s.sha256,
      }
    : null;

  const payload = JSON.stringify({
    source: 'tratto-wa',
    tenant: tenant.slug,
    message: {
      wa_id: msg.waId,
      from: msg.from,
      phone10: r.phone10,
      kind: msg.kind,
      text: msg.text,
      media,
      timestamp: msg.timestamp,
      profile_name: msg.profileName,
    },
    contact: { name: r.contactName, role: r.contactRole, resolved_by: r.resolvedBy },
  });

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (env.GATEWAY_SECRET) {
    headers['x-tratto-signature'] = `sha256=${await hmacHex(env.GATEWAY_SECRET, payload)}`;
  }

  // "binding:NOMBRE" → service binding (Worker→Worker, sin Access enfrente).
  // La URL que ve el portal es su propio hostname para que sus rutas no
  // noten la diferencia; la firma HMAC va igual.
  let res: Response;
  if (tenant.inbound_url.startsWith('binding:')) {
    const name = tenant.inbound_url.slice('binding:'.length);
    const svc = (env as unknown as Record<string, Fetcher | undefined>)[name];
    if (!svc) throw new Error(`service binding ${name} no existe en el gateway`);
    res = await svc.fetch(new Request(`https://${tenant.slug}.usetratto.com/api/wa/inbound`, { method: 'POST', headers, body: payload }));
  } else {
    res = await fetch(tenant.inbound_url, { method: 'POST', headers, body: payload });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`portal ${tenant.slug} respondió ${res.status}: ${detail.slice(0, 200)}`);
  }
  type Cuerpo = { reply?: string; sends?: EnvioPortal[] };
  const body = await res.json<Cuerpo>().catch(() => ({} as Cuerpo));
  return { status: 'ok', reply: body.reply ?? null, sends: Array.isArray(body.sends) ? body.sends : [] };
}
