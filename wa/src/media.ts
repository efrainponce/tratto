// Fotos, documentos, audios y videos que llegan por WhatsApp.
//
// Meta NO manda el archivo en el webhook: manda un media_id, y la URL que se
// obtiene con él caduca en minutos. Así que se baja al momento y se guarda en R2.
// El gateway es TRÁNSITO, no archivo: el portal del cliente copia el archivo a su
// propio R2 con la URL firmada que va en el despacho, y aquí una regla de ciclo de
// vida borra el prefijo `t/` a los 90 días. Los leads no tienen otro lugar, así que
// `lead/` se queda.
//
//   t/{tenant}/{phone10}/{wa_id}.pdf     ← clientes con portal (se borra a 90 días)
//   lead/{phone10}/{wa_id}.jpg           ← desconocidos (se queda)
import type { Env } from './env';
import { hmacHex, timingSafeEqual } from './crypto';
import { fetchMedia } from './wa';

/** Lo que trae el webhook de Meta para image | document | audio | video | sticker. */
export interface MediaRef {
  id: string;
  mime: string;
  sha256: string | null;
  filename: string | null;   // solo documentos lo traen
}

/** Lo que quedó en R2 y va en `messages` y en el despacho al portal. */
export interface StoredMedia {
  key: string;
  mime: string;
  filename: string;
  size: number;
  sha256: string | null;
}

export const MEDIA_KINDS = new Set(['image', 'document', 'audio', 'video', 'sticker']);

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'application/pdf': 'pdf', 'text/plain': 'txt',
  'application/msword': 'doc', 'application/vnd.ms-excel': 'xls', 'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'audio/mp4': 'm4a', 'audio/amr': 'amr',
  'video/mp4': 'mp4', 'video/3gpp': '3gp',
};

const GENERIC_NAME: Record<string, string> = {
  image: 'foto', sticker: 'sticker', audio: 'audio', video: 'video', document: 'documento',
};

/** `audio/ogg; codecs=opus` → `audio/ogg`. */
function baseMime(mime: string): string {
  return mime.split(';')[0].trim().toLowerCase();
}

function extensionFor(mime: string, filename: string | null): string {
  const fromName = filename?.match(/\.([A-Za-z0-9]{1,5})$/)?.[1]?.toLowerCase();
  return fromName ?? EXT_BY_MIME[baseMime(mime)] ?? 'bin';
}

// El nombre que se enseña y se descarga. Se sanea porque acaba en un header
// Content-Disposition y en el HTML de la bandeja.
function displayName(kind: string, ref: MediaRef, ext: string): string {
  const raw = ref.filename?.trim();
  if (raw) return raw.replace(/[\\\/"\x00-\x1f]/g, "_").slice(0, 120);
  return `${GENERIC_NAME[kind] ?? 'archivo'}.${ext}`;
}

export function mediaKey(scope: string, phone10: string, waId: string, ext: string): string {
  return `${scope}/${phone10}/${waId.replace(/[^A-Za-z0-9]/g, '')}.${ext}`;
}

/**
 * Baja el archivo de Meta y lo deja en R2. Se llama ANTES de despachar al portal,
 * para que la URL firmada que va en el payload ya apunte a algo que existe.
 */
export async function storeInbound(
  env: Env,
  args: { kind: string; ref: MediaRef; scope: string; phone10: string; waId: string },
): Promise<StoredMedia> {
  const ext = extensionFor(args.ref.mime, args.ref.filename);
  const key = mediaKey(args.scope, args.phone10, args.waId, ext);
  const filename = displayName(args.kind, args.ref, ext);
  const file = await fetchMedia(env, args.ref.id);
  const mime = baseMime(file.mime || args.ref.mime);

  const obj = await env.MEDIA.put(key, file.body, {
    httpMetadata: { contentType: mime },
    customMetadata: { filename, kind: args.kind, sha256: args.ref.sha256 ?? '' },
  });
  return { key, mime, filename, size: obj.size, sha256: args.ref.sha256 };
}

// ── URL firmada para el portal ───────────────────────────────────────────────
//
// GET /media/{key}?exp=<unix>&sig=<HMAC(GATEWAY_SECRET, key|exp)>
// La firma cubre la key completa, prefijo de tenant incluido: un portal solo puede
// bajar lo que se le despachó a él. 24 h de vigencia: margen para que el portal se
// recupere si estaba caído cuando Meta reintentó.

export const SIGNED_TTL_S = 24 * 3600;

const KEY_RE = /^(t\/[a-z0-9-]+|lead)\/\d{10}\/[A-Za-z0-9]+\.[a-z0-9]{1,5}$/;

export function validKey(key: string): boolean {
  return KEY_RE.test(key);
}

export async function signedUrl(env: Env, key: string): Promise<string | null> {
  if (!env.GATEWAY_SECRET || !env.PUBLIC_URL) return null;
  const exp = Math.floor(Date.now() / 1000) + SIGNED_TTL_S;
  const sig = await hmacHex(env.GATEWAY_SECRET, `${key}|${exp}`);
  return `${env.PUBLIC_URL.replace(/\/$/, '')}/media/${key}?exp=${exp}&sig=${sig}`;
}

export async function verifySignature(env: Env, key: string, exp: string | null, sig: string | null): Promise<boolean> {
  if (!env.GATEWAY_SECRET || !exp || !sig || !/^\d{1,12}$/.test(exp)) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacHex(env.GATEWAY_SECRET, `${key}|${exp}`);
  return timingSafeEqual(expected, sig.toLowerCase());
}

/** Sirve un objeto de R2 tal cual. Las dos puertas (firma y sesión) acaban aquí. */
export async function serve(env: Env, key: string): Promise<Response> {
  if (!validKey(key)) return new Response('not found', { status: 404 });
  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response('not found', { status: 404 });
  const filename = obj.customMetadata?.filename ?? key.split('/').pop() ?? 'archivo';
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('content-length', String(obj.size));
  headers.set('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
  headers.set('cache-control', 'private, max-age=3600');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(obj.body, { headers });
}
