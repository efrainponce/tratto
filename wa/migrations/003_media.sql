-- Fotos, documentos, audios y videos entrantes.
-- Aplicar:  npx wrangler d1 execute tratto-wa --remote --file=migrations/003_media.sql

-- El archivo vive en R2 (bucket tratto-wa-media); aquí solo la referencia. `body`
-- se sigue usando: para media lleva el caption si la persona escribió uno.
ALTER TABLE messages ADD COLUMN media_key  TEXT;     -- key en R2: t/{tenant}/{phone10}/{wa_id}.ext | lead/…
ALTER TABLE messages ADD COLUMN media_mime TEXT;
ALTER TABLE messages ADD COLUMN media_name TEXT;     -- nombre que se enseña/descarga
ALTER TABLE messages ADD COLUMN media_size INTEGER;  -- bytes
