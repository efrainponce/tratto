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

/** Palomitas azules. Cosmético: nunca truena. */
export async function markRead(env: Env, messageId: string): Promise<void> {
  try {
    await graphPost(env, { status: 'read', message_id: messageId });
  } catch { /* cosmético */ }
}
