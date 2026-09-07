// Avisos por correo. La regla de oro es que un correo cueste algo: si llega uno por
// cada mensaje, en una semana se ignoran todos y el canal deja de servir.
//
// Solo se avisa cuando hace falta una PERSONA:
//   lead    — número que nunca había escrito. Es una venta potencial entrando en frío.
//   error   — el portal del cliente falló; alguien quedó sin respuesta.
//   humano  — el hilo está en relevo humano, o sea tú te comprometiste a contestar.
// Todo lo demás lo resuelve el agente solo y no merece interrumpir a nadie.
import type { Env, EmailMessage } from './env';

export type NotifyReason = 'lead' | 'error' | 'humano';

interface NotifyInput {
  reason: NotifyReason;
  phone10: string;
  waFrom: string;
  profileName: string | null;
  tenantSlug: string | null;
  text: string | null;
  detail?: string;
}

const SUBJECTS: Record<NotifyReason, (who: string) => string> = {
  lead:   who => `Lead nuevo en WhatsApp: ${who}`,
  error:  who => `El agente falló contestando a ${who}`,
  humano: who => `${who} escribió y tú tienes el hilo`,
};

const LEDE: Record<NotifyReason, string> = {
  lead:   'Un número que nunca había escrito acaba de mandar un mensaje. Recibió el acuse automático; nadie le ha contestado de verdad.',
  error:  'El mensaje quedó guardado, pero el portal del cliente no respondió. La persona recibió un aviso de error en vez de una respuesta.',
  humano: 'Este hilo está en relevo humano, así que el agente no contestó. Está esperándote.',
};

function pretty(phone: string): string {
  const d = phone.replace(/\D/g, '').slice(-10);
  return `+52 ${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

/**
 * Manda el aviso si el enfriamiento lo permite. Devuelve true si salió.
 *
 * El enfriamiento vive en `threads.last_notified_at` y se cobra por hilo, no global:
 * dos leads distintos el mismo minuto son dos correos, y eso está bien — son dos
 * ventas. Lo que no queremos es que UNO conversador mande seis.
 */
export async function notify(env: Env, input: NotifyInput): Promise<boolean> {
  if (!env.NOTIFY_TO || !env.NOTIFY_FROM) return false;
  if (!env.EMAIL && !env.RESEND_API_KEY) return false;

  const cooldownH = Number(env.NOTIFY_COOLDOWN_H ?? '6');
  const fresh = await env.DB.prepare(
    `UPDATE threads SET last_notified_at = datetime('now')
      WHERE phone10 = ?1
        AND (last_notified_at IS NULL
             OR last_notified_at < datetime('now', ?2))`,
  ).bind(input.phone10, `-${cooldownH} hours`).run();

  if ((fresh.meta?.changes ?? 0) === 0) return false;   // todavía en enfriamiento

  const who = input.profileName ? `${input.profileName} (${pretty(input.waFrom)})` : pretty(input.waFrom);
  const inbox = `${env.INBOX_URL ?? 'https://wa.usetratto.com/inbox'}#${input.phone10}`;
  const quote = input.text?.trim() || `(mensaje de tipo ${input.reason === 'error' ? 'desconocido' : 'no textual'})`;

  const rows: Array<[string, string]> = [
    ['De', who],
    ['Cliente', input.tenantSlug ?? 'ninguno todavía — es un lead'],
  ];
  if (input.detail) rows.push(['Detalle', input.detail]);

  const html = `<!doctype html><meta charset="utf-8">
<div style="font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a;max-width:34rem">
  <p style="margin:0 0 1rem">${esc(LEDE[input.reason])}</p>
  <blockquote style="margin:0 0 1.2rem;padding:.7rem .9rem;background:#f4f4f5;border-left:3px solid #25d366;border-radius:0 4px 4px 0;white-space:pre-wrap">${esc(quote)}</blockquote>
  <table style="border-collapse:collapse;margin:0 0 1.4rem;font-size:14px">
    ${rows.map(([k, v]) => `<tr><td style="padding:.15rem 1rem .15rem 0;color:#71717a">${esc(k)}</td><td style="padding:.15rem 0">${esc(v)}</td></tr>`).join('')}
  </table>
  <a href="${inbox}" style="display:inline-block;padding:.6rem 1.1rem;background:#111;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Abrir el hilo</a>
  <p style="margin:1.6rem 0 0;font-size:12px;color:#a1a1aa">tratto-wa · máximo un aviso por hilo cada ${cooldownH} h</p>
</div>`;

  const text = `${LEDE[input.reason]}\n\n> ${quote}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nAbrir el hilo: ${inbox}`;

  try {
    await deliver(env, {
      to: env.NOTIFY_TO,
      from: { email: env.NOTIFY_FROM, name: 'Tratto WhatsApp' },
      subject: SUBJECTS[input.reason](who),
      html,
      text,
    });
    return true;
  } catch (err) {
    // Que no se caiga el webhook por un correo. Se suelta el enfriamiento para que
    // el siguiente mensaje pueda reintentar en vez de quedarse callado 6 horas.
    console.error('notify', err);
    await env.DB.prepare(`UPDATE threads SET last_notified_at = NULL WHERE phone10 = ?`)
      .bind(input.phone10).run();
    return false;
  }
}

/**
 * Dos transportes, misma firma. El binding de Cloudflare es el preferido —no hay
 * llaves que rotar ni un tercero que se caiga—, pero exige que el dominio esté dado
 * de alta en Email Sending. Mientras eso no esté, Resend cubre con una variable.
 */
async function deliver(env: Env, msg: EmailMessage): Promise<void> {
  if (env.EMAIL) {
    await env.EMAIL.send(msg);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: msg.from.name ? `${msg.from.name} <${msg.from.email}>` : msg.from.email,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  });
  if (!res.ok) {
    throw new Error(`resend ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
}
