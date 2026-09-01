ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS facebook_story_status VARCHAR(24) NOT NULL DEFAULT 'nao_publicado';
ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS facebook_story_publicado_em TIMESTAMPTZ;
ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS facebook_story_post_id VARCHAR(100);
ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS facebook_story_erro TEXT;
ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS facebook_feed_status VARCHAR(24) NOT NULL DEFAULT 'nao_publicado';
ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS facebook_feed_publicado_em TIMESTAMPTZ;
ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS facebook_feed_post_id VARCHAR(100);
ALTER TABLE ofertas ADD COLUMN IF NOT EXISTS facebook_feed_erro TEXT;
