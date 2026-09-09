-- tratto-portal — el portal de Tratto para Tratto, lo más mini posible (D1 `tratto-portal`).
-- Aplicar:  npx wrangler d1 execute tratto-portal --remote --file=schema.sql
--
-- Clientes → contactos. Una oportunidad ES la cotización (encabezado + líneas), con
-- enlace público /c/<token>. Al ganarse se vuelve un proyecto. El catálogo son los
-- conceptos que se repiten (construcción, renta, WhatsApp…).

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,                       -- pbkdf2$iter$salt$hash (base64)
  role          TEXT NOT NULL DEFAULT 'admin',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_used   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS login_attempts (
  email TEXT NOT NULL,
  at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS login_attempts_idx ON login_attempts(email, at);

-- Datos de Tratto que salen en la cotización + defaults (vigencia_dias, iva, alcance, condiciones).
CREATE TABLE IF NOT EXISTS ajustes (
  clave      TEXT PRIMARY KEY,
  valor      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clientes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre     TEXT NOT NULL,
  giro       TEXT,
  ciudad     TEXT,
  rfc        TEXT,
  notas      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contactos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nombre     TEXT NOT NULL,
  puesto     TEXT,
  telefono   TEXT,                                   -- como se capturó; 10 dígitos para WhatsApp
  correo     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS contactos_cliente_idx ON contactos(cliente_id);

CREATE TABLE IF NOT EXISTS catalogo (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  concepto     TEXT NOT NULL,
  descripcion  TEXT,
  periodicidad TEXT NOT NULL DEFAULT 'mensual',      -- unico | mensual
  precio       REAL NOT NULL DEFAULT 0,
  orden        INTEGER NOT NULL DEFAULT 0,
  activo       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS oportunidades (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  folio         TEXT NOT NULL UNIQUE,                -- OPP-0001
  cliente_id    INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  contacto_id   INTEGER REFERENCES contactos(id) ON DELETE SET NULL,
  nombre        TEXT NOT NULL,                       -- "Portal de ventas"
  etapa         TEXT NOT NULL DEFAULT 'nueva',       -- nueva | cotizada | negociacion | ganada | perdida
  fecha         TEXT NOT NULL,                       -- YYYY-MM-DD
  vigencia_dias INTEGER NOT NULL DEFAULT 15,
  moneda        TEXT NOT NULL DEFAULT 'MXN',
  iva           REAL NOT NULL DEFAULT 16,
  alcance       TEXT,                                -- qué incluye (un renglón por punto)
  condiciones   TEXT,
  notas         TEXT,                                -- internas, no salen en la cotización
  token         TEXT NOT NULL UNIQUE,                -- enlace público /c/<token>
  aceptada_at   TEXT,
  aceptada_por  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS oportunidades_etapa_idx ON oportunidades(etapa, updated_at DESC);
CREATE INDEX IF NOT EXISTS oportunidades_cliente_idx ON oportunidades(cliente_id);

CREATE TABLE IF NOT EXISTS lineas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  oportunidad_id INTEGER NOT NULL REFERENCES oportunidades(id) ON DELETE CASCADE,
  orden          INTEGER NOT NULL DEFAULT 0,
  periodicidad   TEXT NOT NULL DEFAULT 'mensual',    -- unico | mensual
  concepto       TEXT NOT NULL,
  descripcion    TEXT,
  cantidad       REAL NOT NULL DEFAULT 1,
  precio         REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS lineas_idx ON lineas(oportunidad_id, orden);

-- Cada vez que alguien abre el enlace público (sin sesión).
CREATE TABLE IF NOT EXISTS vistas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  oportunidad_id INTEGER NOT NULL REFERENCES oportunidades(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS vistas_idx ON vistas(oportunidad_id, created_at DESC);

CREATE TABLE IF NOT EXISTS proyectos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  folio          TEXT NOT NULL UNIQUE,               -- PRY-0001
  cliente_id     INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  oportunidad_id INTEGER REFERENCES oportunidades(id) ON DELETE SET NULL,
  nombre         TEXT NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'entrevistas', -- entrevistas | construccion | arranque | en_renta | terminado
  inicio         TEXT,                               -- YYYY-MM-DD
  renta_mensual  REAL NOT NULL DEFAULT 0,            -- sin IVA
  notas          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS proyectos_estado_idx ON proyectos(estado, updated_at DESC);

-- ── datos iniciales (solo si no existen) ──────────────────────────────────────
INSERT OR IGNORE INTO ajustes (clave, valor) VALUES
  ('razon_social', 'Tratto'),
  ('rfc', ''),
  ('domicilio', ''),
  ('correo', 'hola@usetratto.com'),
  ('telefono', '+52 33 4942 4216'),
  ('web', 'usetratto.com'),
  ('vigencia_dias', '15'),
  ('iva', '16'),
  ('alcance', 'Entrevistas con tu equipo (semana 1): vemos tus Excel, tus cotizaciones reales y tus chats. Salimos con tus etapas y tus reglas escritas.
Construcción del portal (semanas 2 a 4): tus catálogos, tus PDFs, tus permisos, tus fórmulas.
Arranque con oportunidades reales (semana 5): media jornada con tu equipo.
Usuarios ilimitados: entra todo tu equipo, sin cobro por persona.
Permisos por persona, historial de cambios y datos exportables a Excel.
Ajustes incluidos en la renta cuando tu proceso cambie.
Soporte por WhatsApp en horario laboral.'),
  ('condiciones', 'Precios en pesos mexicanos más IVA. Se emite CFDI.
La construcción inicial se paga al arrancar y equivale al primer mes de renta.
La renta mensual se factura por adelantado a partir de la entrega del portal.
Sin plazo forzoso: se puede cancelar con 30 días de aviso. Al terminar entregamos toda tu información en Excel.
Un módulo nuevo completo se cotiza aparte, siempre avisando antes.');

INSERT INTO catalogo (concepto, descripcion, periodicidad, precio, orden)
SELECT 'Construcción del portal', 'Entrevistas con tu equipo, construcción a la medida y arranque con oportunidades reales. Listo en 5 semanas. Se cobra una sola vez y equivale al primer mes de renta.', 'unico', 20000, 1
WHERE NOT EXISTS (SELECT 1 FROM catalogo);
INSERT INTO catalogo (concepto, descripcion, periodicidad, precio, orden)
SELECT 'Renta mensual del portal', 'Portal en operación, usuarios ilimitados, ajustes cuando tu proceso cambie y soporte por WhatsApp en horario laboral.', 'mensual', 20000, 2
WHERE (SELECT count(*) FROM catalogo) = 1;
INSERT INTO catalogo (concepto, descripcion, periodicidad, precio, orden)
SELECT 'Agente de WhatsApp', 'Tu equipo y tus clientes consultan y actualizan el portal por WhatsApp. Incluye el número y los mensajes de servicio.', 'mensual', 4500, 3
WHERE (SELECT count(*) FROM catalogo) = 2;
INSERT INTO catalogo (concepto, descripcion, periodicidad, precio, orden)
SELECT 'Módulo adicional', 'Un módulo nuevo completo (p. ej. compras, órdenes de compra, firma de documentos). Se cotiza según alcance.', 'unico', 15000, 4
WHERE (SELECT count(*) FROM catalogo) = 3;
