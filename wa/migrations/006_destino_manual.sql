-- Números que cambian de cliente por comando ("/janing", "/tratto"): gente de Tratto
-- que es usuaria en varios portales y quiere hablar con uno u otro desde el mismo
-- WhatsApp. Tener fila aquí ES el permiso para usar los comandos, y manda sobre el
-- directorio al rutear lo que escribe (ver src/cambio.ts). El directorio no se toca:
-- los avisos del portal original le siguen llegando.
-- El teléfono no va en el repo; se da de alta a mano:
--   INSERT INTO destino_manual (phone10, tenant_slug) VALUES ('<10 dígitos>', 'janing');
-- Aplicar:  npx wrangler d1 execute tratto-wa --remote --file=migrations/006_destino_manual.sql
CREATE TABLE IF NOT EXISTS destino_manual (
  phone10     TEXT PRIMARY KEY,
  tenant_slug TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ¿El portal contesta mensajes (POST /api/wa/inbound)? 0 = no se le despacha nada:
-- queda en /inbox como no_handler. tratto-portal hoy solo recibe lo de SU número
-- (/wa/eventos, reenvio.ts); a él solo se llega con "/tratto".
ALTER TABLE tenants ADD COLUMN agente INTEGER NOT NULL DEFAULT 1;
UPDATE tenants SET agente = 0 WHERE slug = 'tratto';
