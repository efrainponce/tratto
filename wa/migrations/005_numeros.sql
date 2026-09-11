-- Números que NO son del gateway. Con Embedded Signup un portal conecta su propio
-- número a la app de Meta de Tratto (p. ej. el de ventas de Tratto, en coexistencia
-- con la app WhatsApp Business del cel). Meta tiene UNA callback por app, así que
-- todo sigue llegando a /wa/webhook; lo que entra a uno de estos números se reenvía
-- tal cual al portal dueño (src/reenvio.ts) en vez de rutearse por teléfono.
-- Aplicar:  npx wrangler d1 execute tratto-wa --remote --file=migrations/005_numeros.sql
CREATE TABLE IF NOT EXISTS numeros (
  phone_number_id TEXT PRIMARY KEY,
  tenant_slug     TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
  waba_id         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS numeros_waba_idx ON numeros(waba_id);

-- El portal de Tratto (portal.usetratto.com) como tenant: recibe por service binding.
INSERT INTO tenants (slug, name, inbound_url, portal_url)
VALUES ('tratto', 'Tratto', 'binding:PORTAL', 'https://portal.usetratto.com')
ON CONFLICT(slug) DO UPDATE SET inbound_url = excluded.inbound_url, portal_url = excluded.portal_url;
