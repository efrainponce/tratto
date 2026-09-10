# tratto-wa — un solo número de WhatsApp para todo Tratto

Gateway que recibe **todos** los mensajes del número de Tratto (gente de clientes y
leads fríos de la landing), averigua a quién pertenece cada número y reenvía el
mensaje al portal del cliente que corresponde. Este Worker **no contesta con IA**:
identifica, deja bitácora y despacha. El agente vive en cada portal.

`cmp-portal` **no** pasa por aquí: tiene su propio número y su propio webhook.

```
Quien sea → Meta Cloud API → POST https://wa.usetratto.com/wa/webhook
   1. firma HMAC de Meta (WA_APP_SECRET) + dedupe por wa_id
   2. teléfono → cliente:  directory → hilo pegajoso → si no, LEAD
   3. despacho: POST al inbound_url del portal (firmado) │ LEAD: guardar + acuse
   4. lo que el portal devuelva en {reply} se manda por Graph API
```

- **URL productiva:** `https://wa.usetratto.com`
- **Callback URL para Meta:** `https://wa.usetratto.com/wa/webhook`
- **WABA:** `2275720233183131` · **Phone number ID:** `1223241804216054` · **App ID:** `1095525919501864`
- **PIN de verificación en dos pasos del número:** en `.dev.vars` como `WHATSAPP_2FA_PIN` (fuera de git a propósito). Meta lo pide al migrar o re-registrar el número, y **no** se puede desactivar por API — si se pierde, se resetea en WhatsApp Manager → Two-step verification
- **D1:** `tratto-wa` (`23487f72-e117-4619-95e5-28f2ffa7b90b`), cuenta Cloudflare **Tratto**
- Los secretos generados están en `.dev.vars` (ignorado por git) y ya subidos como
  secrets del Worker.

## Estado / pendientes

| | |
|---|---|
| ✅ | Worker desplegado, D1 con schema, handshake y firma verificados en vivo |
| ✅ | Tenant `janing` dado de alta (sin `inbound_url` todavía → manda acuse fijo) |
| ✅ | `WA_APP_SECRET` cargado — firma buena → 200, firma mala → 401, probado en vivo |
| ✅ | `WHATSAPP_PHONE_NUMBER_ID` cargado (`1223241804216054`) |
| ✅ | Webhook suscrito en Meta: topic `whatsapp_business_account`, campo `messages`, WABA suscrita a la app |
| ✅ | Número **CONNECTED** en Cloud API (`+52 1 33 4942 4216`, `platform_type: CLOUD_API`) |
| ✅ | `WHATSAPP_TOKEN` permanente (System User `tratto-wa`, ID `61593948072841`, sin expiración) — envío probado en vivo |
| ✅ | WABA duplicada `1080570111289211` borrada — queda una sola, `2275720233183131` |
| ⚠️ | Business verification pendiente → tope de 250 conversaciones nuevas/día y máx. 2 números |
| 🗓️ | **1 oct 2026: Meta empieza a cobrar los mensajes de servicio.** Cada respuesta del agente es hoy gratis (lo son desde nov 2024) y pasa a costar por mensaje. También las plantillas de utilidad dentro de la ventana de 24 h. Afecta el precio de Tratto, no el código |
| ✅ | Bandeja humana en `/inbox` con cuentas propias (usuarios, roles, sesión) + avisos por correo (lead nuevo · agente caído · relevo humano) |
| ✅ | Fotos/documentos/audios entrantes: se bajan a R2 al momento, se ven en la bandeja y van al portal como URL firmada (ver contrato) |
| ⛔ | Falta crear el bucket `tratto-wa-media`, su regla de 90 días y aplicar `migrations/003_media.sql` en la D1 remota (comandos abajo) |
| ⛔ | Falta el endpoint `/api/wa/inbound` en `janing-portal` (contrato abajo) |
| ⛔ | Falta poblar `directory` con los teléfonos reales de Janing |

## Setup en Meta (una vez)

1. App → **WhatsApp → Configuration → Webhook**:
   - Callback URL: `https://wa.usetratto.com/wa/webhook`
   - Verify token: el valor de `WA_VERIFY_TOKEN` en `.dev.vars`
   - Suscribir el campo **messages**.
2. **App Settings → Basic → App Secret** → `npx wrangler secret put WA_APP_SECRET`
3. **WhatsApp → API Setup → Phone number ID** → `npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID`
4. Token permanente: *System User* en Business Settings con permiso
   `whatsapp_business_messaging` → `npx wrangler secret put WHATSAPP_TOKEN`

> El aviso amarillo del dashboard ("apps unpublished solo reciben webhooks de prueba")
> es real: hasta publicar la app solo llegan los envíos de prueba del dashboard.

Todos los comandos de wrangler aquí van con
`CLOUDFLARE_ACCOUNT_ID=33de936069756a649e49b9b2f673c1a7` y `--env-file=/dev/null`
(el token de la cuenta ve dos cuentas; sin la variable elige la equivocada).

## Cómo decide a qué cliente pertenece un número

En orden, de más fuerte a más débil (`routing.ts::resolve`):

1. **`directory`** — el teléfono está dado de alta con su cliente. Manda siempre: si
   movieron a alguien de cliente, el directorio corrige el hilo viejo.
2. **`threads` (pegajoso)** — ese número ya había quedado ligado a un cliente antes
   (alta manual, o un lead reasignado). Sobrevive aunque no esté en el directorio.
3. **lead** — desconocido. **No se rechaza**: entra igual, queda con
   `lead_status='nuevo'` y recibe un acuse.

La llave son los **últimos 10 dígitos**: Meta reporta los números de México con un
"1" heredado tras el 52 (`5215512345678`) de forma inconsistente, y al *mandar* hay
que quitarlo o Graph responde `#131030 not in allowed list` (ver `wa.ts`).

## Contrato con el portal de un cliente

Cuando `tenants.inbound_url` está puesto, el gateway hace `POST` ahí:

```jsonc
// headers: x-tratto-signature: sha256=<HMAC-SHA256 del cuerpo con GATEWAY_SECRET>
{
  "source": "tratto-wa",
  "tenant": "janing",
  "message": {
    "wa_id": "wamid.…", "from": "5215511112222", "phone10": "5511112222",
    "kind": "text", "text": "…", "media": null,
    "timestamp": "1757000000", "profile_name": "Ana"
  },
  "contact": { "name": "Ana", "role": "compras", "resolved_by": "directory" }
}
```

El portal responde `200` con `{"reply": "texto"}` (o `{}` para no contestar), y
opcionalmente `"sends": [{phone, text, template?, media?}]` — envíos que el gateway
ejecuta por él después de contestar, con el mismo contrato y candados que
`/portal/send`. Es la única forma de mandar algo que nace de un mensaje entrante:
un portal despachado por service binding **no puede llamarnos de regreso** en el
mismo request (Cloudflare lo detecta como recursión y responde 522). El
portal **debe** validar `x-tratto-signature` con el mismo `GATEWAY_SECRET`: es su
única prueba de que el mensaje viene de aquí. Si el portal falla o tarda, el mensaje
ya quedó guardado en `messages` con `dispatch=error:…` y la persona recibe un aviso
de error.

Para conectar Janing: implementar `POST /api/wa/inbound` en `janing-portal`
(resolver la persona por `phone`, correr su agente contra su D1, devolver `reply`) y
luego apuntar el tenant a esa URL.

### Portal → persona (`POST /portal/send`)

El camino de regreso cuando el portal quiere escribir **por su cuenta**, sin que la
persona haya preguntado nada (p. ej. "se generó una cotización, verifícala"). Mismo
secreto, misma firma, sentido contrario:

```jsonc
// POST https://wa.usetratto.com/portal/send
// headers: x-tratto-signature: sha256=<HMAC-SHA256 del cuerpo con GATEWAY_SECRET>
{
  "tenant": "janing", "phone": "5215554369433", "text": "…",
  // opcional: plantilla aprobada por Meta, para cuando la ventana de 24 h está cerrada
  "template": { "name": "cotizacion_verificar_pdf", "language": "es_MX", "header": "document",
                "body": ["Elías", "OPP-0010", "Nave industrial"], "urlSuffix": "10" },
  // opcional: un archivo (base64 dentro del JSON, así la firma lo cubre; máx. 20 MB)
  "media": { "filename": "Cotizacion-OPP-0010.pdf", "mime": "application/pdf", "base64": "JVBERi0…" }
}
```

**Con archivo.** Dentro de la ventana va como UN mensaje de documento con `text` de
pie (caption). Fuera de ella, en el encabezado de la plantilla si ésta lo declara
(`"header": "document"`, la plantilla tiene que haberse creado con `HEADER DOCUMENT`);
si la plantilla no tiene encabezado, sale solo el texto y la respuesta lo dice con
`"archivo": "omitido"`. Los bytes se suben a Meta (`/media`) en cada envío.

Responde `200 {"ok":true, "modo":"texto"|"plantilla", "archivo": "enviado"|"omitido"|null}` o un error con
`{error, detalle?}`: `401` firma mala, `403` el número no es de ese cliente (ni en
`directory` ni con hilo ruteado ahí), `404` nunca ha escrito y no hay plantilla,
`409` **ventana de 24 h cerrada** y no hay plantilla, `502` Meta rechazó el envío (o
la plantilla no está aprobada). Solo texto (sin archivos todavía). **No** toma el
hilo como relevo humano: es el agente del cliente hablando, y queda en `messages` con
`author=portal`.

**Texto vs plantilla.** Dentro de la ventana de 24 h (la persona nos escribió hace
menos de un día) va `text` tal cual — gratis hasta el 1 oct 2026. Fuera de ella, o
si el número nunca ha escrito, WhatsApp solo acepta una **plantilla aprobada**: si el
portal la mandó en `template` se usa esa (`body` son los `{{n}}` del cuerpo en orden,
`urlSuffix` el `{{1}}` del botón de URL; los saltos de línea se aplanan solos), y
**Meta cobra** ese mensaje. Sin plantilla, el error de arriba. Un número sin hilo
tiene que estar en `directory` del tenant; el destino se arma como `52` + 10 dígitos.

Plantillas dadas de alta en la WABA (se crean por API, `POST
/{WABA_ID}/message_templates`, y Meta las revisa — las de categoría *utility* suelen
aprobarse en minutos u horas; se consultan con `GET
/{WABA_ID}/message_templates?fields=name,status`):

| nombre | cuerpo | botón |
|---|---|---|
| `cotizacion_verificar` | Hola {{1}}, se generó la cotización {{2}} ({{3}}) en el portal de Janing y necesita tu verificación. | `https://janing.usetratto.com/oportunidades/{{1}}` |
| `mencion_actualizacion` | Tienes una mención de {{1}} en {{2}} (portal de Janing): "{{3}}". Ábrela para responder. | `https://janing.usetratto.com/{{1}}` |
| `cotizacion_verificar_pdf` | **HEADER DOCUMENT** + Hola {{1}}, se generó la cotización {{2}} ({{3}}) … Va el PDF adjunto. | `https://janing.usetratto.com/oportunidades/{{1}}` |
| `costeo_validar` | Hola {{1}}, el costeo de la cotización {{2}} ({{3}}) está listo y espera tu validación… | `https://janing.usetratto.com/validacion/{{1}}` |
| `actividades_vencidas` | Hola {{1}}, tienes {{2}} actividad(es) vencida(s)… La más antigua: {{3}}. Ábrelas… | `https://janing.usetratto.com/inicio` |

Una plantilla con encabezado de documento necesita un `header_handle` de ejemplo:
se sube un PDF con la Resumable Upload API (`POST /{APP_ID}/uploads?file_name=…&
file_length=…&file_type=application/pdf` → `POST /{upload_id}` con `file_offset: 0`
y los bytes → `{h}`), y ese `h` va en `example.header_handle`. El cuerpo no puede
empezar ni terminar con una variable (ni con `{{n}}.`): Meta lo rechaza.

### Fotos, documentos, audios y videos

Meta no manda el archivo en el webhook, manda un `media_id` cuya URL caduca en
minutos. El gateway lo baja **al momento** y lo deja en el bucket R2 `tratto-wa-media`
(`src/media.ts`). Con `kind` = `image` | `document` | `audio` | `video` | `sticker`
el mensaje llega así (`text` lleva el caption, si lo hubo):

```jsonc
"message": {
  "kind": "document", "text": "el plano que te dije",
  "media": {
    "url": "https://wa.usetratto.com/media/t/janing/5511112222/wamidHBg….pdf?exp=1757086400&sig=…",
    "data": null,
    "mime": "application/pdf", "filename": "plano.pdf", "size": 812331, "sha256": "…"
  }
}
```

- **El gateway es tránsito, no archivo.** La URL está firmada con `GATEWAY_SECRET`
  y vale **24 h**. El portal que quiera quedarse el archivo hace `fetch(url)` y lo
  guarda en **su propio** R2 al recibir el mensaje: son ~30 líneas iguales en cada
  portal.
- **`data` (base64) solo para tenants por `binding:`**, y ahí es la vía buena: el
  portal NO puede hacerle `fetch` a la URL desde dentro del request que le acabamos
  de entregar por el service binding — esa vuelta a `wa.usetratto.com` Cloudflare
  la corta como recursión y devuelve **522**. Es el mismo muro que obliga a que sus
  envíos salientes vayan por `sends[]`. Por URL (tenant HTTP) `data` va `null`: ahí
  el portal es otro origen y el `fetch` funciona. Arriba de 10 MB va `null` siempre;
  si leer R2 falla también, queda `null` y al portal le queda la URL. La copia del gateway vive bajo `t/{tenant}/…` y una regla de ciclo de vida
  la borra a los **90 días**. Los leads (`lead/…`) se quedan: no tienen otro lugar.
- La firma cubre la key completa, prefijo de tenant incluido: un portal solo puede
  bajar lo que se le despachó a él. Los portales **nunca** ven el `WHATSAPP_TOKEN`.
- Si Meta no deja bajar el archivo, el mensaje se despacha igual con `media: null`
  (por `kind` el portal sabe que había algo), queda `dispatch=error:media …` y llega
  aviso por correo. Nunca se deja a la persona sin respuesta por eso.
- Límites de WhatsApp: imagen 5 MB, audio/video 16 MB, documento 100 MB.
- Mandar archivos **de regreso** (portal → persona) no existe todavía (texto sí:
  `/portal/send`, arriba). Cuando haga falta, el contrato es el mismo al revés:
  `{"reply": "…", "media": {"url", "mime", "filename", "caption"}}` y el gateway lo
  sube a Meta.

Una vez (bucket + retención):

```sh
npx wrangler r2 bucket create tratto-wa-media
npx wrangler r2 bucket lifecycle add tratto-wa-media --prefix t/ --expire-days 90
npx wrangler d1 execute tratto-wa --remote --file=migrations/003_media.sql
```

## La bandeja (`/inbox`)

Un número de Cloud API **no se puede abrir en la app de WhatsApp** — es la API o la
app, nunca las dos. Así que la única ventana a las conversaciones es esta:

**https://wa.usetratto.com/inbox** — pensada para el celular (lista de chats →
conversación, como WhatsApp) y a dos columnas en pantalla grande. En el cel conviene
*Añadir a pantalla de inicio*: abre a pantalla completa con su ícono.

**Cuentas.** Cada persona entra con su correo y contraseña (tabla `users`, PBKDF2,
sesión por cookie HttpOnly de 30 días). Ya no se pega el `ADMIN_TOKEN` en el
navegador: ese queda solo para la API de operación y para crear el primer usuario.

- **Primer usuario:** al abrir `/inbox` sin cuentas, la página pide el `ADMIN_TOKEN`
  (está en `.dev.vars`) + nombre, correo y contraseña. Esa cuenta queda como admin.
- **Más usuarios:** menú ⋮ → *Usuarios* (solo admins): alta con contraseña inicial,
  rol (`admin` | `agente`), baja, y resetear contraseña. Dar de baja o resetear cierra
  las sesiones de esa persona. Cada quien cambia su contraseña desde ⋮ → *Cambiar
  contraseña*.
- **Rescate** si nadie puede entrar: `POST /admin/users` con el `ADMIN_TOKEN` (abajo).

**Qué se ve.** Filtros *Todos · Por contestar · Leads*. Un hilo está "por contestar"
cuando lo último que hay es un mensaje entrante y nadie más lo va a responder: es un
lead (no tiene agente) o está en relevo humano. El punto verde y el contador en el
título de la pestaña salen de ahí. Cada respuesta lleva el nombre de quien la mandó.

**Relevo humano.** Si contestas a mano, `threads.human_until` se pone a 6 horas en el
futuro (y `human_by` con tu nombre) y **el agente se calla** en ese hilo. Contestar
los dos es peor que no contestar ninguno. Es una fecha y no un interruptor a
propósito: se suelta solo, así que ningún hilo se queda mudo porque alguien olvidó
reactivarlo. *Tomar* / *Devolver* en la cabecera lo hacen sin escribir.

**Ventana de 24 h.** WhatsApp solo permite texto libre dentro de las 24 h desde el
último mensaje de la persona. Pasado eso el compositor se bloquea y el envío devuelve
`409`: fuera de la ventana solo van plantillas aprobadas, y esta cuenta no tiene
ninguna.

**Detalles del contacto** (⋮ en el hilo): re-rutear a un cliente, o marcar el
seguimiento del lead (`nuevo` · `contactado` · `descartado`).

**Avisos del navegador.** ⋮ → *Activar avisos*: con la pestaña en segundo plano avisa
cuando entra algo por contestar. No es push real (el Worker no manda nada al
navegador); para eso están los correos de abajo.

## Avisos por correo

Solo se avisa cuando hace falta una **persona**. Todo lo demás lo resuelve el agente y
no merece interrumpir a nadie:

| Motivo | Cuándo |
|---|---|
| `lead` | Un número que **nunca** había escrito. Es una venta entrando en frío |
| `error` | El portal del cliente falló; alguien quedó sin respuesta |
| `humano` | El hilo está en relevo humano, o sea tú te comprometiste a contestar |

Máximo **un correo por hilo cada `NOTIFY_COOLDOWN_H` horas** (6 por defecto). El
enfriamiento se cobra por hilo, no global: dos leads distintos el mismo minuto son dos
correos — son dos ventas. Lo que no queremos es que uno conversador mande seis.

Transporte: binding `EMAIL` de Cloudflare Email Sending (`usetratto.com` dado de alta,
DNS configurado). Si el binding no estuviera, `notify.ts` cae solo a Resend con el
secret `RESEND_API_KEY`, sin cambiar código.

A propósito **no** hay detección por palabras clave de "quiero hablar con una persona":
se dispara con falsos positivos y hoy sería puro ruido, porque no hay ningún agente
conectado y *todos* reciben el acuse fijo. Cuando haya conversaciones reales sabremos
qué palabras importan.

## API de operación (`Authorization: Bearer $ADMIN_TOKEN`)

```sh
B=https://wa.usetratto.com; H="Authorization: Bearer $ADMIN_TOKEN"

# clientes
curl -X POST $B/admin/tenants -H "$H" -H 'content-type: application/json' \
  -d '{"slug":"janing","name":"Janing","inbound_url":"https://janing.usetratto.com/api/wa/inbound"}'
curl $B/admin/tenants -H "$H"

# dar de alta teléfonos (acepta cualquier formato: +52 155 1111 2222, 5511112222…)
curl -X POST $B/admin/directory -H "$H" -H 'content-type: application/json' \
  -d '{"tenant":"janing","people":[{"phone":"+525511112222","name":"Ana","role":"compras"}]}'
curl "$B/admin/directory?tenant=janing" -H "$H"

# quién ha escrito
curl $B/admin/threads -H "$H"              # todos
curl "$B/admin/threads?leads=1" -H "$H"    # solo leads sin cliente
curl "$B/admin/messages?phone=5511112222" -H "$H"

# contestar a mano (toma el hilo 6 h automáticamente)
curl -X POST $B/admin/send -H "$H" -H 'content-type: application/json' \
  -d '{"phone":"5511112222","text":"Hola, te marco en un rato"}'

# tomar o soltar un hilo sin escribir
curl -X POST $B/admin/threads/handoff -H "$H" -H 'content-type: application/json' \
  -d '{"phone":"5511112222","hours":6}'   # hours 0 = devolver al agente

# un hilo completo, en orden de lectura
curl "$B/admin/thread?phone=5511112222" -H "$H"

# re-rutear a mano (lead que se volvió cliente, o ruteo mal resuelto)
curl -X POST $B/admin/threads/assign -H "$H" -H 'content-type: application/json' \
  -d '{"phone":"5599998888","tenant":"janing"}'

# usuarios de la bandeja — rescate: crear/resetear contraseña (cierra sus sesiones)
curl -X POST $B/admin/users -H "$H" -H 'content-type: application/json' \
  -d '{"email":"ana@ejemplo.com","name":"Ana","password":"al-menos-8","role":"admin"}'
curl $B/admin/users -H "$H"
```

## Desarrollo

```sh
npm install
npm run typecheck
npx wrangler d1 execute tratto-wa --local --file=schema.sql   # D1 local (schema completo; las migrations/ son para la remota ya existente)
npx wrangler dev --env-file=.dev.vars --port 8791
```

En local `ENVIRONMENT=dev` y sin `WA_APP_SECRET` el webhook acepta cuerpos **sin
firmar**, así que se puede simular una entrega de Meta con un `curl` normal a
`/wa/webhook`. En prod eso es 401.
