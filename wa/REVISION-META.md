# Revisión de la app Tratto en Meta (Tech Provider)

App: **Tratto** `1095525919501864` · https://developers.facebook.com/apps/1095525919501864

Estado al 11 sep 2026: verificación de negocio aprobada según la API de revisión
(`business_verification_passes: true`), sin envío a revisión, falta política de privacidad.

## Datos de la app

- App ID: `1095525919501864`
- Configuración de Embedded Signup (Facebook Login for Business): **`1712644993575309`**,
  creada el 11 sep 2026 con la plantilla "WhatsApp Embedded Signup Configuration With 60
  Expiration Token" (System user, token de 60 días, WhatsApp accounts,
  `whatsapp_business_management` + `whatsapp_business_messaging`). Cuando Meta apruebe, crear
  otra con vencimiento Never.
- Facebook Login for Business → Client OAuth: dominio y redirect `https://portal.usetratto.com`.
- Coexistencia: se activa en el código del botón con `featureType: 'whatsapp_business_app_onboarding'`;
  el Hosted Embedded Signup de Meta NO la soporta.

## 1. Configuración → Básica (hecho el 11 sep 2026)

| Campo | Valor |
|---|---|
| Ícono (1024×1024) | `landing/assets/tratto-logo-round-whatsapp.png` |
| URL de la política de privacidad | `https://usetratto.com/privacidad` |
| URL de las condiciones del servicio | `https://usetratto.com/terminos` |
| URL de eliminación de datos | `https://usetratto.com/eliminacion-de-datos` |
| Dominios de la app | `usetratto.com` |
| Categoría | Negocios y páginas (Business and Pages) |
| Correo de contacto | verificarlo (hoy sale `contact_email_verified: false`) |

Guardar cambios.

## 2. Revisión de la app → Permisos y funciones

Pedir **acceso avanzado** a los dos:

### whatsapp_business_messaging

> Tratto builds custom client portals for small and mid-size businesses in Mexico
> (quotes, projects, activities). We use whatsapp_business_messaging to send and receive
> WhatsApp messages on behalf of our business customers: replies to their clients inside
> the 24-hour customer service window, and approved utility templates such as "your quote
> is ready to review" with a link to the customer's portal. Incoming messages are received
> through our webhook (https://wa.usetratto.com/wa/webhook) and shown in a shared inbox
> where the business's staff answer them. We never send unsolicited marketing messages.

### whatsapp_business_management

> We use whatsapp_business_management to manage the WhatsApp Business Accounts that our
> business customers connect to Tratto through Embedded Signup: read the WABA and its phone
> numbers, subscribe our app to the WABA's webhooks, create and check the status of message
> templates, and, for customers who keep using the WhatsApp Business app (coexistence),
> sync their contacts and message history so their conversations appear in their portal.

## 3. Video 1: mandar un mensaje desde nuestra app

Grabar la pantalla de la Mac con el iPhone espejeado (app Duplicación del iPhone,
o QuickTime → Nueva grabación de película → cámara iPhone). 1 a 2 minutos, sin cortes.

1. Desde el WhatsApp personal, escribir "Hola" al número de Tratto.
2. En la Mac, abrir https://wa.usetratto.com/inbox (ya con sesión iniciada).
3. Mostrar que el mensaje llegó al hilo.
4. Contestar desde el compositor: "Hi! This message was sent from Tratto via the WhatsApp Cloud API."
5. Mostrar en el iPhone que la respuesta llegó.

La interfaz está en español: poner subtítulos en inglés o explicarlo en las notas (sección 5).

## 4. Video 2: crear una plantilla

Meta acepta hacerlo desde WhatsApp Manager en vez de nuestra app.

1. Abrir WhatsApp Manager → Plantillas de mensajes → Crear plantilla.
2. Categoría **Utilidad**, nombre `app_review_demo`, idioma inglés.
3. Cuerpo: `Hi {{1}}, your quote {{2}} is ready to review in your portal.` (ejemplos: `Ana`, `OPP-0001`).
4. Enviar y mostrar que aparece en la lista (En revisión o Activa).

## 5. Notas para el revisor

> The app UI is in Spanish because our customers are in Mexico.
> Video 1: a WhatsApp user writes to our business number; the message arrives at our
> inbox (https://wa.usetratto.com/inbox) through the Cloud API webhook; we reply from the
> inbox and the reply is delivered to the user's WhatsApp.
> Video 2: we create a utility message template in WhatsApp Manager and submit it for review.
> Our business customers will connect their own WhatsApp Business Accounts through
> Embedded Signup; after onboarding we subscribe to their WABA webhooks and message on
> their behalf only as described above.

## 6. Después de la aprobación

- Pasar la app a **modo Live** (arriba en el panel).
- Configurar Embedded Signup (Facebook Login for Business → Configuraciones) con la opción
  de números de la app de WhatsApp Business (coexistencia).
- Suscribir en el webhook los campos `history`, `smb_app_state_sync` y `smb_message_echoes`.
