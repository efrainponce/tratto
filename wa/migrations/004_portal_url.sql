-- Plantillas que sirven para cualquier cliente. Meta solo deja la variable del
-- botón de URL AL FINAL y con el dominio fijo, así que las plantillas apuntan a
-- https://wa.usetratto.com/ir/{{1}} con {{1}} = "<tenant>/<ruta>" y el gateway
-- redirige al portal del cliente (src/ir.ts). Aquí vive la base de ese portal.
-- Aplicar:  npx wrangler d1 execute tratto-wa --remote --file=migrations/004_portal_url.sql
ALTER TABLE tenants ADD COLUMN portal_url TEXT;   -- https://janing.usetratto.com, sin / final

UPDATE tenants SET portal_url = 'https://janing.usetratto.com' WHERE slug = 'janing';
