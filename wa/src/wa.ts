// Salida hacia la Cloud API de Meta (Graph). Un solo número para todo Tratto:
// WHATSAPP_PHONE_NUMBER_ID es el del número de Tratto, no el de ningún cliente.
import type { Env } from './env';

const GRAPH = 'https://graph.facebook.com/v21.0';

/** Últimos 10 dígitos — la llave estable del directorio. Ver comentario en schema.sql. */
export function phone10(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.slice(-10);
}

// Meta reporta los entrantes de México con un "1" heredado tras el 52
// (5215512345678), pero MANDAR a esa cadena exacta truena con #131030
// "not in allowed list": la entrega real solo reconoce el número sin ese 1.
// Heredado de cmp-portal/worker/wa/send.ts, donde ya costó una tarde.
export function normalizeMxTo(to: string): string {
  return /^521\d{10}$/.test(to) ? `52${to.slice(3)}` : to;
}

async function graphPost(env: Env, body: Record<string, unknown>): Promise<void> {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error('WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID sin configurar');
  }
  const res = await fetch(`${GRAPH}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`WhatsApp send falló (${res.status}): ${detail.slice(0, 300)}`);
  }
}

/** Texto plano. WhatsApp corta los cuerpos en 4096 caracteres. */
export async function sendText(env: Env, to: string, body: string): Promise<void> {
  await graphPost(env, { to: normalizeMxTo(to), type: 'text', text: { body: body.slice(0, 4000) } });
}

/**
 * Plantilla aprobada por Meta: la única forma de escribirle a alguien fuera de
 * la ventana de 24 h. `body` son los {{n}} del cuerpo en orden; `urlSuffix` el
 * {{1}} del botón de URL (si la plantilla lo tiene). Meta cobra estos mensajes.
 */
export interface Plantilla { name: string; language?: string; body?: string[]; urlSuffix?: string | null }

// Los parámetros de plantilla no admiten saltos de línea, tabs ni más de 4
// espacios seguidos (error 132018): se aplanan aquí para que ningún portal
// tenga que saberlo.
function paramLimpio(v: string): string {
  return v.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 1000) || '-';
}

export async function sendTemplate(env: Env, to: string, t: Plantilla): Promise<void> {
  const components: unknown[] = [];
  if (t.body?.length) {
    components.push({ type: 'body', parameters: t.body.map(v => ({ type: 'text', text: paramLimpio(String(v)) })) });
  }
  if (t.urlSuffix) {
    components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: t.urlSuffix }] });
  }
  await graphPost(env, {
    to: normalizeMxTo(to), type: 'template',
    template: { name: t.name, language: { code: t.language || 'es_MX' }, components },
  });
}

/**
 * Un archivo entrante, en dos viajes: el media_id da una URL de CDN que caduca en
 * minutos, y esa URL solo entrega los bytes con el mismo Bearer. Se devuelve el
 * stream sin bufferear: un documento puede pesar hasta 100 MB.
 */
export async function fetchMedia(
  env: Env, mediaId: string,
): Promise<{ body: ReadableStream | ArrayBuffer; mime: string | null; size: number | null }> {
  if (!env.WHATSAPP_TOKEN) throw new Error('WHATSAPP_TOKEN sin configurar');
  const auth = { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` };

  const meta = await fetch(`${GRAPH}/${encodeURIComponent(mediaId)}`, { headers: auth });
  if (!meta.ok) {
    const detail = await meta.text().catch(() => '');
    throw new Error(`media ${mediaId}: Graph respondió ${meta.status}: ${detail.slice(0, 200)}`);
  }
  const info = await meta.json<{ url?: string; mime_type?: string; file_size?: number }>();
  if (!info.url) throw new Error(`media ${mediaId}: Graph no devolvió url`);

  const file = await fetch(info.url, { headers: auth });
  if (!file.ok || !file.body) {
    throw new Error(`media ${mediaId}: descarga respondió ${file.status}`);
  }
  // R2 necesita saber el largo para recibir un stream; Meta manda content-length,
  // pero si un día no viniera se bufferea en vez de fallar.
  const len = file.headers.get('content-length');
  const body = len ? file.body : await file.arrayBuffer();
  return { body, mime: info.mime_type ?? file.headers.get('content-type'), size: len ? Number(len) : null };
}

/** Palomitas azules. Cosmético: nunca truena. */
export async function markRead(env: Env, messageId: string): Promise<void> {
  try {
    await graphPost(env, { status: 'read', message_id: messageId });
  } catch { /* cosmético */ }
}
