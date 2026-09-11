// tratto-wa — un solo número de WhatsApp para todo Tratto.
//
// Recibe de quien sea (gente de Janing, de clientes futuros, o leads fríos de la
// landing), averigua a qué cliente pertenece el número y reenvía el mensaje al
// portal de ese cliente. Los desconocidos NO se rechazan: quedan como lead.
//
// La autenticación entrante es la firma HMAC de Meta (WA_APP_SECRET). No hay
// Cloudflare Access enfrente porque Meta no puede presentar credenciales.
import type { Env } from './env';
import { hmacHex, timingSafeEqual } from './crypto';
import { sendText, markRead, type Plantilla } from './wa';
import {
  alreadyProcessed, dispatchToTenant, logMessage, logOutbound, resolve, touchThread,
  type DispatchResult, type Incoming,
} from './routing';
import { adminRoutes } from './admin';
import { archivoDe, sendPortal } from './ops';
import { notify, type NotifyReason } from './notify';
import { inboxRoutes } from './inbox';
import { irAlPortal } from './ir';
import { altaNumero, reenviar, separarPorNumero, type CuerpoMeta } from './reenvio';
import { atenderComando } from './cambio';
import { MEDIA_KINDS, serve as serveMedia, storeInbound, verifySignature, type MediaRef } from './media';

const LEAD_REPLY =
  'Hola 👋 Gracias por escribir a Tratto. Ya quedó registrado tu mensaje y ' +
  'Efraín te contesta en breve.';

const ERROR_REPLY =
  'Ocurrió un error procesando tu mensaje 😕 Ya quedó registrado; intenta de nuevo en un momento.';

async function validSignature(env: Env, rawBody: string, header: string | null): Promise<boolean> {
  if (!env.WA_APP_SECRET) {
    // Fail closed en prod. Sin firma solo se puede probar en dev.
    return env.ENVIRONMENT !== 'prod';
  }
  if (!header?.startsWith('sha256=')) return false;
  const expected = await hmacHex(env.WA_APP_SECRET, rawBody);
  return timingSafeEqual(expected, header.slice('sha256='.length).toLowerCase());
}

interface MetaMedia { id: string; mime_type: string; sha256?: string; filename?: string; caption?: string }
interface MetaMessage {
  id: string;
  from: string;
  type: string;
  timestamp?: string;
  text?: { body: string };
  image?: MetaMedia;
  document?: MetaMedia;
  audio?: MetaMedia;
  video?: MetaMedia;
  sticker?: MetaMedia;
  /** Respuesta a un botón QUICK_REPLY de plantilla: llega como type 'button'. */
  button?: { text?: string; payload?: string };
  /** Botones de mensajes interactivos (no plantilla). */
  interactive?: { type?: string; button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } };
}

function mediaOf(m: MetaMessage): MediaRef | null {
  if (!MEDIA_KINDS.has(m.type)) return null;
  const x = m[m.type as 'image' | 'document' | 'audio' | 'video' | 'sticker'];
  if (!x?.id) return null;
  return { id: x.id, mime: x.mime_type ?? '', sha256: x.sha256 ?? null, filename: x.filename ?? null };
}
interface MetaContact { wa_id?: string; profile?: { name?: string } }
interface MetaBody {
  entry?: Array<{ changes?: Array<{ value?: {
    messages?: MetaMessage[];
    contacts?: MetaContact[];
  } }> }>;
}

function extract(body: MetaBody): Incoming[] {
  const out: Incoming[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages) continue;
      // `contacts` trae el nombre de perfil de WhatsApp; sirve para nombrar leads.
      const names = new Map<string, string>();
      for (const c of value.contacts ?? []) {
        if (c.wa_id && c.profile?.name) names.set(c.wa_id, c.profile.name);
      }
      for (const m of value.messages) {
        const media = mediaOf(m);
        // El caption de una foto/documento va como texto: así el agente lo lee igual.
        const caption = media ? (m[m.type as 'image']?.caption ?? null) : null;
        // Tocar un botón de plantilla ("GO, fírmala") o de un mensaje
        // interactivo es, para el portal, lo mismo que escribir ese texto.
        const boton = m.type === 'button' ? (m.button?.text ?? m.button?.payload ?? null)
          : m.type === 'interactive' ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null)
          : null;
        out.push({
          waId: m.id,
          from: m.from,
          kind: boton != null ? 'text' : m.type,
          text: m.type === 'text' ? (m.text?.body ?? null) : (boton ?? caption),
          media,
          stored: null,
          profileName: names.get(m.from) ?? null,
          timestamp: m.timestamp ?? null,
          raw: m,
        });
      }
    }
  }
  return out;
}

async function processMessage(env: Env, msg: Incoming): Promise<void> {
  if (await alreadyProcessed(env, msg.waId)) return;
  await markRead(env, msg.waId);

  // "/janing", "/tratto"… de quien puede cambiar de cliente (cambio.ts).
  if (await atenderComando(env, msg)) return;

  // Un botón de plantilla contesta a la plantilla: va al portal que la mandó
  // (el del directorio), no al que el número eligió por comando.
  const r = await resolve(env, msg, { manual: (msg.raw as MetaMessage).type !== 'button' });
  const thread = await touchThread(env, msg, r);

  // Relevo humano: si alguien tomó el hilo a mano y sigue vigente, el agente se
  // calla. Contestar los dos es peor que no contestar ninguno.
  const humanHasIt = !!thread.humanUntil && thread.humanUntil > new Date().toISOString().replace('T', ' ').slice(0, 19);

  let status = 'lead';
  let reply: string | null = r.tenant ? null : LEAD_REPLY;
  let author = 'ack';
  let detail: string | undefined;
  let sends: DispatchResult['sends'] = [];

  // El archivo se baja ANTES de despachar: la URL firmada que va en el payload tiene
  // que apuntar a algo que ya existe. Si Meta falla, el mensaje sigue su curso sin
  // archivo y alguien recibe aviso; no se deja a la persona sin respuesta por eso.
  let mediaError: string | undefined;
  if (msg.media) {
    try {
      msg.stored = await storeInbound(env, {
        kind: msg.kind, ref: msg.media, waId: msg.waId, phone10: r.phone10,
        scope: r.tenant ? `t/${r.tenant.slug}` : 'lead',
      });
    } catch (err) {
      console.error('media', msg.waId, err);
      mediaError = String(err).slice(0, 300);
    }
  }

  // Botón de respuesta rápida que mandamos con payload "tratto:…" (el
  // "Enterado" de la bienvenida): es para el gateway, no para el agente del
  // portal —que lo tomaría como un mensaje suyo y contestaría cualquier cosa—.
  // Queda en bitácora y abre la ventana de 24 h; no se despacha ni se contesta.
  const acuse = ((msg.raw as MetaMessage).button?.payload ?? '').startsWith('tratto:');

  if (humanHasIt) {
    status = 'humano';
    reply = null;
    author = 'human';
  } else if (acuse) {
    status = 'boton';
    reply = null;
  } else if (r.tenant) {
    try {
      const d = await dispatchToTenant(env, msg, r);
      status = d.status;
      reply = d.reply;
      sends = d.sends;
      author = d.status === 'ok' ? 'agent' : 'ack';
    } catch (err) {
      // El mensaje YA quedó en `messages`; el portal se cayó, no nosotros.
      console.error('dispatch', r.tenant.slug, err);
      detail = String(err).slice(0, 300);
      status = `error:${detail.slice(0, 120)}`;
      reply = ERROR_REPLY;
      author = 'error';
    }
  }

  if (mediaError && !status.startsWith('error:')) {
    status = `error:media ${mediaError.slice(0, 110)}`;
    detail = detail ?? mediaError;
  }

  await logMessage(env, msg, r, status);

  if (reply) {
    try {
      await sendText(env, msg.from, reply);
      await logOutbound(env, {
        phone10: r.phone10, to: msg.from, tenantSlug: r.tenant?.slug ?? null,
        body: reply, author,
      });
    } catch (err) {
      console.error('send', err);
      detail = detail ?? String(err).slice(0, 300);
    }
  }

  // Lo que el portal nos pidió mandar por él (p. ej. el PDF firmado tras un
  // GO), DESPUÉS de su respuesta y con los mismos candados que /portal/send.
  for (const s of sends) {
    try {
      const out = await sendPortal(env, { tenant: r.tenant!.slug, phone: s.phone, text: s.text, template: s.template ?? null, archivo: archivoDe(s.media) });
      if (out.status !== 200) console.error('send diferido', r.tenant!.slug, s.phone, out.body);
    } catch (err) {
      console.error('send diferido', r.tenant!.slug, s.phone, err);
    }
  }

  // Avisar solo cuando hace falta una persona. El enfriamiento vive en notify().
  const reason: NotifyReason | null =
    status.startsWith('error:') ? 'error'
    : humanHasIt ? 'humano'
    : (thread.isNew && !r.tenant) ? 'lead'
    : null;

  if (reason) {
    await notify(env, {
      reason,
      phone10: r.phone10,
      waFrom: msg.from,
      profileName: msg.profileName,
      tenantSlug: r.tenant?.slug ?? null,
      text: msg.text ?? (msg.media ? `(${msg.kind}${msg.stored ? `: ${msg.stored.filename}` : ''})` : null),
      detail,
    });
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // Handshake de verificación de Meta. Es lo único que necesita responder para
    // que el botón "Verify and save" del dashboard acepte la Callback URL.
    if (req.method === 'GET' && url.pathname === '/wa/webhook') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && env.WA_VERIFY_TOKEN && token === env.WA_VERIFY_TOKEN && challenge) {
        return new Response(challenge, { headers: { 'content-type': 'text/plain' } });
      }
      return new Response('forbidden', { status: 403 });
    }

    // Entrantes. Meta reintenta si tardamos: se acusa de recibido de inmediato y
    // el trabajo real corre en waitUntil.
    if (req.method === 'POST' && url.pathname === '/wa/webhook') {
      const raw = await req.text();
      if (!(await validSignature(env, raw, req.headers.get('x-hub-signature-256')))) {
        return new Response('invalid signature', { status: 401 });
      }
      let todo: CuerpoMeta;
      try { todo = JSON.parse(raw); } catch { return new Response('bad request', { status: 400 }); }

      // Lo que entró a un número de portal (Embedded Signup, ver reenvio.ts) se
      // le entrega entero a ese portal ANTES de acusar: si no lo acepta, 500 y
      // Meta reintenta. El resto sigue el camino de siempre.
      const { resto, lotes } = await separarPorNumero(env, todo);
      for (const lote of lotes) {
        try { await reenviar(env, lote); } catch (err) {
          console.error('reenvio', err);
          return new Response('portal no disponible', { status: 500 });
        }
      }
      const body = resto as unknown as MetaBody;

      const messages = extract(body);
      if (messages.length > 0) {
        ctx.waitUntil((async () => {
          for (const m of messages) {
            try { await processMessage(env, m); } catch (err) { console.error('process', err); }
          }
        })());
      }
      return new Response('ok');
    }

    // Archivos para los portales: URL firmada con GATEWAY_SECRET y caducidad. La
    // bandeja usa su propia puerta (/inbox/api/media/…) con sesión.
    if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
      const key = decodeURIComponent(url.pathname.slice('/media/'.length));
      if (!(await verifySignature(env, key, url.searchParams.get('exp'), url.searchParams.get('sig')))) {
        return new Response('forbidden', { status: 403 });
      }
      return serveMedia(env, key);
    }

    // Alta de un número de portal tras su Embedded Signup: {tenant,
    // phone_number_id, waba_id} firmado con GATEWAY_SECRET. Desde ahí, lo que
    // entre a ese número se le reenvía entero (reenvio.ts).
    if (req.method === 'POST' && url.pathname === '/portal/numero') {
      if (!env.GATEWAY_SECRET) return Response.json({ error: 'GATEWAY_SECRET sin configurar' }, { status: 500 });
      const raw = await req.text();
      const header = req.headers.get('x-tratto-signature') ?? '';
      const expected = await hmacHex(env.GATEWAY_SECRET, raw);
      if (!header.startsWith('sha256=') || !timingSafeEqual(expected, header.slice('sha256='.length).toLowerCase())) {
        return Response.json({ error: 'firma inválida' }, { status: 401 });
      }
      let b: { tenant?: string; phone_number_id?: string; waba_id?: string };
      try { b = JSON.parse(raw); } catch { return Response.json({ error: 'cuerpo no es JSON' }, { status: 400 }); }
      const r = await altaNumero(env, b);
      return Response.json(r.body, { status: r.status });
    }

    // Salida de un portal: {tenant, phone, text} firmado con GATEWAY_SECRET —
    // el mismo secreto con el que firmamos lo que les mandamos, en sentido
    // contrario. No toma el hilo (es el agente del cliente, no una persona);
    // ver ops.sendPortal para los candados (tenant, pertenencia, 24 h).
    if (req.method === 'POST' && url.pathname === '/portal/send') {
      if (!env.GATEWAY_SECRET) return Response.json({ error: 'GATEWAY_SECRET sin configurar' }, { status: 500 });
      const raw = await req.text();
      const header = req.headers.get('x-tratto-signature') ?? '';
      const expected = await hmacHex(env.GATEWAY_SECRET, raw);
      if (!header.startsWith('sha256=') || !timingSafeEqual(expected, header.slice('sha256='.length).toLowerCase())) {
        return Response.json({ error: 'firma inválida' }, { status: 401 });
      }
      let b: { tenant?: string; phone?: string; text?: string; template?: Plantilla | null; media?: { filename?: string; mime?: string; base64?: string } | null };
      try { b = JSON.parse(raw); } catch { return Response.json({ error: 'cuerpo no es JSON' }, { status: 400 }); }
      // El archivo viene en base64 dentro del JSON (así la firma lo cubre igual
      // que al texto). Tope 20 MB decodificado — un PDF de cotización pesa KB.
      let archivo: { bytes: ArrayBuffer; mime: string; filename: string } | null = null;
      try { archivo = archivoDe(b.media); } catch (err) {
        return Response.json({ error: String(err).includes('grande') ? 'archivo demasiado grande (máx. 20 MB)' : 'media.base64 inválido' }, { status: String(err).includes('grande') ? 413 : 400 });
      }
      const r = await sendPortal(env, { tenant: b.tenant ?? '', phone: b.phone ?? '', text: b.text ?? '', template: b.template ?? null, archivo });
      return Response.json(r.body, { status: r.status });
    }

    // Botones de plantilla → portal del cliente (/ir/<tenant>/<ruta>). Ver ir.ts.
    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/ir/')) {
      return irAlPortal(env, url);
    }

    if (url.pathname.startsWith('/admin/')) return adminRoutes(req, env, url);

    // La bandeja: página + login + API con sesión de usuario. Ver inbox.ts.
    if (url.pathname === '/inbox' || url.pathname.startsWith('/inbox/')) {
      return inboxRoutes(req, env, url);
    }

    if (url.pathname === '/health') {
      return Response.json({ ok: true, env: env.ENVIRONMENT });
    }

    return new Response('not found', { status: 404 });
  },
};
