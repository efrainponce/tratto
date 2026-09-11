// Números que no son del gateway.
//
// Con Embedded Signup un portal conecta su PROPIO número a la app de Meta de
// Tratto (el primero: el de ventas de Tratto, en coexistencia con la app
// WhatsApp Business del cel). Meta tiene una sola callback por app, así que
// todo sigue llegando a /wa/webhook. Lo que entra a un número dado de alta en
// `numeros` no es "alguien que le escribe a Tratto" y no se rutea por
// teléfono: se reenvía tal cual —mensajes, estados, ecos del cel, historial,
// contactos— al portal dueño, que lo guarda y lo contesta él con su token.
import type { Env } from './env';
import { hmacHex } from './crypto';

interface Cambio { field?: string; value?: Record<string, unknown> & { metadata?: { phone_number_id?: string } } }
interface Entrada { id?: string; changes?: Cambio[] }
export interface CuerpoMeta { object?: string; entry?: Entrada[] }

export interface CambioReenviado { waba_id: string | null; field: string; value: unknown }
interface Dueno { slug: string; inbound_url: string | null; portal_url: string | null }
interface Lote { dueno: Dueno; cambios: CambioReenviado[] }

/** Separa del cuerpo lo que es de un portal. Devuelve el cuerpo que se queda
 *  en el gateway (sin esos cambios) y un lote por portal. El número manda
 *  (`metadata.phone_number_id`); un cambio sin número (eventos de la cuenta)
 *  se reconoce por el WABA (`entry.id`). */
export async function separarPorNumero(env: Env, body: CuerpoMeta): Promise<{ resto: CuerpoMeta; lotes: Lote[] }> {
  const numeros = new Set<string>();
  const wabas = new Set<string>();
  for (const e of body.entry ?? []) {
    if (e.id) wabas.add(e.id);
    for (const c of e.changes ?? []) {
      const pn = c.value?.metadata?.phone_number_id;
      if (pn) numeros.add(pn);
    }
  }
  if (numeros.size === 0 && wabas.size === 0) return { resto: body, lotes: [] };

  const marcas = (n: number, desde: number) => Array.from({ length: n }, (_, i) => `?${desde + i}`).join(',');
  const pns = [...numeros];
  const ws = [...wabas];
  let rows: D1Result<{ phone_number_id: string; waba_id: string | null } & Dueno>;
  try {
    rows = await env.DB.prepare(
      `SELECT n.phone_number_id, n.waba_id, t.slug, t.inbound_url, t.portal_url
         FROM numeros n JOIN tenants t ON t.slug = n.tenant_slug AND t.active = 1
        WHERE n.phone_number_id IN (${marcas(pns.length, 1) || 'NULL'})
           OR n.waba_id IN (${marcas(ws.length, pns.length + 1) || 'NULL'})`,
    ).bind(...pns, ...ws).all();
  } catch (err) {
    // Que el reenvío nunca tumbe al número del gateway: sin tabla o con la
    // consulta rota, todo sigue su camino de siempre.
    console.error('separarPorNumero', err);
    return { resto: body, lotes: [] };
  }
  const porNumero = new Map<string, Dueno>();
  const porWaba = new Map<string, Dueno>();
  for (const r of rows.results ?? []) {
    const d = { slug: r.slug, inbound_url: r.inbound_url, portal_url: r.portal_url };
    porNumero.set(r.phone_number_id, d);
    if (r.waba_id) porWaba.set(r.waba_id, d);
  }
  if (porNumero.size === 0) return { resto: body, lotes: [] };

  const lotes = new Map<string, Lote>();
  const resto: CuerpoMeta = { ...body, entry: [] };
  for (const e of body.entry ?? []) {
    const quedan: Cambio[] = [];
    for (const c of e.changes ?? []) {
      const pn = c.value?.metadata?.phone_number_id;
      const dueno = pn ? porNumero.get(pn) : (e.id ? porWaba.get(e.id) : undefined);
      if (!dueno) { quedan.push(c); continue; }
      const lote = lotes.get(dueno.slug) ?? { dueno, cambios: [] };
      lote.cambios.push({ waba_id: e.id ?? null, field: c.field ?? '', value: c.value ?? null });
      lotes.set(dueno.slug, lote);
    }
    if (quedan.length) resto.entry!.push({ ...e, changes: quedan });
  }
  return { resto, lotes: [...lotes.values()] };
}

/** Entrega un lote al portal (`POST /wa/eventos`, firmado con GATEWAY_SECRET).
 *  Lanza si el portal no lo aceptó: el webhook contesta 500 y Meta reintenta
 *  (el portal descarta repetidos por id de mensaje). */
export async function reenviar(env: Env, lote: Lote): Promise<void> {
  const { dueno } = lote;
  const payload = JSON.stringify({ source: 'tratto-wa', tenant: dueno.slug, changes: lote.cambios });
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (env.GATEWAY_SECRET) headers['x-tratto-signature'] = `sha256=${await hmacHex(env.GATEWAY_SECRET, payload)}`;

  // Solo por service binding: por HTTP el hostname del portal está detrás de
  // Cloudflare Access y el gateway no tiene cómo presentarse.
  if (!dueno.inbound_url?.startsWith('binding:')) throw new Error(`tenant ${dueno.slug}: reenvío solo por service binding`);
  const name = dueno.inbound_url.slice('binding:'.length);
  const svc = (env as unknown as Record<string, Fetcher | undefined>)[name];
  if (!svc) throw new Error(`service binding ${name} no existe en el gateway`);
  const base = dueno.portal_url ?? `https://${dueno.slug}.usetratto.com`;
  const res = await svc.fetch(new Request(`${base}/wa/eventos`, { method: 'POST', headers, body: payload }));
  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    throw new Error(`portal ${dueno.slug} respondió ${res.status}: ${detalle.slice(0, 200)}`);
  }
}

/** Alta de un número por su portal, justo después del Embedded Signup. */
export async function altaNumero(env: Env, b: { tenant?: string; phone_number_id?: string; waba_id?: string }): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!b.tenant || !b.phone_number_id || !/^\d{5,25}$/.test(b.phone_number_id)) {
    return { status: 400, body: { error: 'tenant y phone_number_id requeridos' } };
  }
  if (b.phone_number_id === env.WHATSAPP_PHONE_NUMBER_ID) {
    return { status: 409, body: { error: 'ese es el número del gateway' } };
  }
  const t = await env.DB.prepare('SELECT active FROM tenants WHERE slug = ?').bind(b.tenant).first<{ active: number }>();
  if (!t?.active) return { status: 403, body: { error: 'tenant desconocido o inactivo' } };
  await env.DB.prepare(
    `INSERT INTO numeros (phone_number_id, tenant_slug, waba_id) VALUES (?1, ?2, ?3)
     ON CONFLICT(phone_number_id) DO UPDATE SET tenant_slug = excluded.tenant_slug, waba_id = excluded.waba_id`,
  ).bind(b.phone_number_id, b.tenant, b.waba_id ?? null).run();
  return { status: 200, body: { ok: true } };
}
