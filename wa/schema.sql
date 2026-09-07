-- tratto-wa — esquema del gateway de WhatsApp (D1 `tratto-wa`).
-- Aplicar:  npx wrangler d1 execute tratto-wa --remote --file=schema.sql

-- Clientes con portal propio. `inbound_url` es el endpoint del portal que contesta;
-- NULL = todavía no hay bot, el gateway solo registra y manda un acuse.
CREATE TABLE IF NOT EXISTS tenants (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  inbound_url TEXT,
  ack_text    TEXT,                                   -- acuse mientras no haya inbound_url
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Directorio teléfono → cliente. La llave son los ÚLTIMOS 10 DÍGITOS: Meta reporta
-- los números de México con un "1" heredado tras el 52 (5215512345678) y no siempre
-- de forma consistente, así que comparar por 10 dígitos es lo único estable.
CREATE TABLE IF NOT EXISTS directory (
  phone10     TEXT PRIMARY KEY,
  tenant_slug TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
  name        TEXT,
  role        TEXT,
  source      TEXT NOT NULL DEFAULT 'manual',         -- manual | sync
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS directory_tenant_idx ON directory(tenant_slug);

-- Un hilo por número. Guarda el ruteo PEGAJOSO: una vez que un número quedó ligado a
-- un cliente, se queda ahí aunque no esté en el directorio (así un lead que se
-- convierte en cliente, o alguien dado de alta a mano, no se re-rutea solo).
CREATE TABLE IF NOT EXISTS threads (
  phone10      TEXT PRIMARY KEY,
  wa_from      TEXT NOT NULL,                         -- número tal como lo manda Meta
  tenant_slug  TEXT REFERENCES tenants(slug) ON DELETE SET NULL,  -- NULL = lead
  resolved_by  TEXT NOT NULL,                         -- directory | sticky | lead
  profile_name TEXT,                                  -- nombre de perfil de WhatsApp
  lead_status  TEXT,                                  -- nuevo | contactado | descartado
  needs_review INTEGER NOT NULL DEFAULT 0,
  msg_count    INTEGER NOT NULL DEFAULT 0,
  human_until      TEXT,                              -- relevo humano vigente; NULL = contesta el agente
  human_by         TEXT,                              -- nombre del usuario que tomó el hilo
  last_notified_at TEXT,                              -- enfriamiento de los avisos por correo
  first_seen   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS threads_tenant_idx ON threads(tenant_slug);
CREATE INDEX IF NOT EXISTS threads_last_seen_idx ON threads(last_seen DESC);

-- Dedupe: Meta reintenta la misma entrega si tardamos o fallamos.
CREATE TABLE IF NOT EXISTS processed (
  wa_id   TEXT PRIMARY KEY,
  seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bitácora de TODO lo entrante, ya resuelto a cliente. Es la fuente para depurar
-- ruteos malos y para ver qué llega de números desconocidos.
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_id       TEXT NOT NULL,
  phone10     TEXT NOT NULL,
  wa_from     TEXT NOT NULL,
  tenant_slug TEXT,
  resolved_by TEXT NOT NULL,
  kind        TEXT NOT NULL,                          -- text | image | audio | ...
  body        TEXT,
  raw         TEXT NOT NULL,
  dispatch    TEXT,                                   -- ok | ack | no_handler | error:...
  direction   TEXT NOT NULL DEFAULT 'in',             -- in | out
  author      TEXT,                                   -- agent | human | ack | error
  sent_by     TEXT,                                   -- nombre del usuario (author = human)
  media_key   TEXT,                                   -- archivo en R2 (ver media.ts); body = caption
  media_mime  TEXT,
  media_name  TEXT,
  media_size  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS messages_phone_idx ON messages(phone10, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_tenant_idx ON messages(tenant_slug, created_at DESC);

-- Usuarios de la bandeja (/inbox). Cada quien con su cuenta; el ADMIN_TOKEN queda solo
-- para la API de operación y para crear el primer usuario.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,                -- siempre en minúsculas
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,                       -- pbkdf2$iter$salt$hash (base64)
  role          TEXT NOT NULL DEFAULT 'agente',      -- admin | agente
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- Sesiones por cookie. Se guarda el SHA-256 del token, nunca el token.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_used   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- Intentos fallidos de login (freno a fuerza bruta).
CREATE TABLE IF NOT EXISTS login_attempts (
  email TEXT NOT NULL,
  at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS login_attempts_idx ON login_attempts(email, at);
