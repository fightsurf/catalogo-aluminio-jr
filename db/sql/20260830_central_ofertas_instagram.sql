ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS whatsapp_status VARCHAR(24) NOT NULL DEFAULT 'nao_publicado';
ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS whatsapp_publicado_em TIMESTAMPTZ;
ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS whatsapp_erro TEXT;
ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS instagram_status VARCHAR(24) NOT NULL DEFAULT 'nao_publicado';
ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS instagram_publicado_em TIMESTAMPTZ;
ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS instagram_media_id VARCHAR(80);
ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS instagram_container_id VARCHAR(80);
ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS instagram_erro TEXT;

UPDATE ofertas
SET whatsapp_status = 'publicado',
    whatsapp_publicado_em = COALESCE(whatsapp_publicado_em, publicado_em)
WHERE status = 'publicada'
  AND whatsapp_status = 'nao_publicado'
  AND publicado_em IS NOT NULL;
