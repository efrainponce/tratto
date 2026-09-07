-- Usuarios de la bandeja + sesiones.
-- Aplicar:  npx wrangler d1 execute tratto-wa --remote --file=migrations/002_users.sql

-- Antes la bandeja entraba con el ADMIN_TOKEN compartido pegado en el navegador. Con
-- una sola persona funcionaba; con dos ya no se sabe quién contestó qué, y sacar a
-- alguien obligaba a rotar el token para todos. Ahora cada quien tiene su cuenta.
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

-- Sesiones por cookie. Se guarda el SHA-256 del token, nunca el token: si alguien
-- lee la tabla no puede usar las sesiones. Borrar la fila = cerrar la sesión.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_used   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- Intentos fallidos de login, para frenar fuerza bruta (N por correo cada 15 min).
CREATE TABLE IF NOT EXISTS login_attempts (
  email TEXT NOT NULL,
  at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS login_attempts_idx ON login_attempts(email, at);

-- Quién tomó el hilo y quién mandó cada mensaje. Con varias personas en la bandeja,
-- "tú" ya no significa nada.
ALTER TABLE threads  ADD COLUMN human_by TEXT;       -- nombre del usuario en relevo
ALTER TABLE messages ADD COLUMN sent_by  TEXT;       -- nombre del usuario que mandó (author=human)
