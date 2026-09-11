// Cambio de cliente por comando. Quien es usuario en varios portales (Efraín)
// escribe "/janing" o "/tratto" y lo que mande después va a ese portal, hasta que
// lo cambie. Solo para números con fila en `destino_manual`: para cualquier otro,
// "/algo" es un mensaje normal y sigue su camino.
//
// El directorio NO se toca: ahí sigue diciendo de qué cliente es el número, y con
// eso ese portal le puede seguir mandando avisos (ops.sendPortal acepta los dos).
import type { Env } from './env';
import { phone10, sendText } from './wa';
import { logMessage, logOutbound, touchThread, type Incoming, type Resolution } from './routing';

const COMANDO = /^\/([a-z0-9_-]*)$/i;

/** A qué cliente eligió mandar sus mensajes este número; null = no usa comandos. */
export async function destinoManual(env: Env, p10: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT tenant_slug FROM destino_manual WHERE phone10 = ?`)
    .bind(p10).first<{ tenant_slug: string }>();
  return row?.tenant_slug ?? null;
}

/** true si el mensaje era un comando y ya quedó atendido (no se despacha). */
export async function atenderComando(env: Env, msg: Incoming): Promise<boolean> {
  if (msg.kind !== 'text' || !msg.text) return false;
  const m = COMANDO.exec(msg.text.trim());
  if (!m) return false;
  const p10 = phone10(msg.from);
  const actual = await destinoManual(env, p10);
  if (actual === null) return false;

  const tenants = (await env.DB.prepare(`SELECT slug, name, agente FROM tenants WHERE active = 1 ORDER BY slug`)
    .all<{ slug: string; name: string; agente: number }>()).results ?? [];
  const pedido = m[1].toLowerCase();
  const destino = tenants.find(t => t.slug === pedido);

  let queda = actual;
  let reply: string;
  if (destino) {
    await env.DB.prepare(`UPDATE destino_manual SET tenant_slug = ?, updated_at = datetime('now') WHERE phone10 = ?`)
      .bind(destino.slug, p10).run();
    queda = destino.slug;
    reply = `Listo, ahora hablas con ${destino.name}.` +
      (destino.agente ? '' : ` Todavía no tiene agente: lo que escribas queda en la bandeja, sin respuesta.`) +
      ` Para cambiar: ${tenants.map(t => `/${t.slug}`).join(' · ')}`;
  } else {
    // "/" solo, o un cliente que no existe: la lista, con el actual marcado.
    const lista = tenants.map(t => `/${t.slug}${t.slug === actual ? '  ← ahora' : ''}`).join('\n');
    reply = `${pedido ? `No hay un cliente /${pedido}.\n\n` : ''}Clientes:\n${lista}`;
  }

  // El comando y la respuesta quedan en la bitácora y en el hilo como todo lo demás.
  const r: Resolution = {
    phone10: p10,
    tenant: { slug: queda, name: queda, inbound_url: null, ack_text: null },
    resolvedBy: 'manual', contactName: null, contactRole: null,
  };
  await touchThread(env, msg, r);
  await logMessage(env, msg, r, 'comando');
  try {
    await sendText(env, msg.from, reply);
    await logOutbound(env, { phone10: p10, to: msg.from, tenantSlug: queda, body: reply, author: 'ack' });
  } catch (err) {
    console.error('comando', err);
  }
  return true;
}
