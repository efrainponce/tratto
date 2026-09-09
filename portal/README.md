# tratto-portal — el portal de Tratto para Tratto

Lo más mini posible: **clientes → contactos**, **oportunidades** (cada una ES una
cotización: encabezado + líneas, con enlace público), **proyectos** (una oportunidad
ganada) y el **catálogo** de conceptos. Mismo patrón que los portales de clientes
(un Worker + su D1) y que la bandeja del gateway: una sola página sin build, servida
por el Worker, cuentas propias por cookie.

- **URL:** https://portal.usetratto.com
- **Cotización pública:** `https://portal.usetratto.com/c/<token>` (sin login; el
  prospecto la abre desde WhatsApp, la guarda en PDF con el diálogo de impresión y
  puede **aceptarla** con su nombre → la oportunidad pasa a *ganada* y se crea el
  proyecto).
- **D1:** `tratto-portal` (`557960c1-2680-480d-a646-297425179099`), cuenta Cloudflare Tratto.
- Todo wrangler con `CLOUDFLARE_ACCOUNT_ID=33de936069756a649e49b9b2f673c1a7` y `--env-file=/dev/null`.

## Primer uso

1. Abrir https://portal.usetratto.com. Como la tabla `users` está vacía, aparece
   **"Primer usuario"**: pide el `ADMIN_TOKEN` (está en `.dev.vars`, fuera de git, y
   cargado como secret del Worker), nombre, correo y contraseña.
2. Menú ⋮ → **Datos de Tratto**: razón social, RFC, domicilio, correo, vigencia e IVA
   por defecto, y los textos por defecto de "Qué incluye" y "Condiciones".
3. **Catálogo**: ya trae construcción (pago único), renta mensual, agente de WhatsApp
   y módulo adicional. Al crear una oportunidad entran el primer concepto activo de
   pago único y el primero mensual.

## Flujo

`Oportunidades` (board por etapa: nueva → cotizada → negociación → ganada / perdida)
→ **+ Nueva** (cliente existente o nuevo) → editar la cotización (nombre, contacto,
fecha, vigencia, IVA, líneas de inversión inicial y de renta mensual, qué incluye,
condiciones, notas internas) → **Mandar por WhatsApp** (abre wa.me con el enlace; la
etapa pasa a *cotizada*) o **Copiar enlace**. El portal cuenta cuántas veces se abrió
el enlace (las visitas con sesión no cuentan).

Al marcar **ganada** (o cuando el cliente acepta desde el enlace) se crea el proyecto
`PRY-000n` con la renta mensual = líneas mensuales sin IVA. `Proyectos` es otro board
(entrevistas → construcción → arranque → en renta → terminado); clic en la tarjeta
para editar.

## Código

| archivo | qué es |
|---|---|
| `src/index.ts` | rutas: app, setup/login/logout, `/c/<token>` público, `/api/*` con sesión |
| `src/api.ts` | la API y el cálculo de totales (dos bloques: pago único y mensual, IVA por bloque) |
| `src/app-html.ts` | la app (String.raw, sin acentos graves ni `${` adentro) |
| `src/publico-html.ts` | la cotización pública con CSS de impresión |
| `src/auth.ts` | copiado de `wa/src/auth.ts`; cookie `tratto_portal`, Path=/ |
| `schema.sql` | esquema + datos iniciales (idempotente) |

```sh
npm run typecheck
npx wrangler dev --env-file=/dev/null --local --var ADMIN_TOKEN:devtoken --var ENVIRONMENT:dev   # local
npx wrangler d1 execute tratto-portal --local --file=schema.sql --env-file=/dev/null            # D1 local
npx wrangler deploy --env-file=/dev/null
```

No hay generador de PDF en el Worker; la página pública es la cotización. Si un día
hace falta el PDF como archivo (p. ej. para mandarlo por el gateway con plantilla),
`janing/worker/lib/pdf/cotizacion.ts` lo hace con pdf-lib.

## Pendientes

- Mandar la cotización por el número de Tratto (gateway `/portal/send`) en vez de
  wa.me: requiere un tenant `tratto` en el gateway y asignar el hilo del lead.
- Recuperación de contraseña (hoy no hay: se cambia desde el menú con la actual).
