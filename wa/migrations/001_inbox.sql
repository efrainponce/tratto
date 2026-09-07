-- Bandeja humana + avisos por correo.
-- Aplicar:  npx wrangler d1 execute tratto-wa --remote --file=migrations/001_inbox.sql

-- La bitácora solo guardaba lo ENTRANTE. Para una bandeja hacen falta los dos lados
-- del hilo, si no se ven preguntas sin respuestas.
ALTER TABLE messages ADD COLUMN direction TEXT NOT NULL DEFAULT 'in';   -- in | out
ALTER TABLE messages ADD COLUMN author    TEXT;                          -- agent | human | ack | error

-- Relevo humano. Mientras `human_until` esté en el futuro, el agente se calla: si
-- contestas a mano y el bot contesta encima, la persona recibe dos respuestas.
-- Es una fecha y no un booleano a propósito: se suelta solo, así que no se queda
-- un hilo mudo para siempre porque nadie se acordó de apagar el interruptor.
ALTER TABLE threads ADD COLUMN human_until TEXT;

-- Enfriamiento de los avisos: un correo por hilo cada NOTIFY_COOLDOWN_H horas.
ALTER TABLE threads ADD COLUMN last_notified_at TEXT;

CREATE INDEX IF NOT EXISTS messages_dir_idx ON messages(phone10, id);
