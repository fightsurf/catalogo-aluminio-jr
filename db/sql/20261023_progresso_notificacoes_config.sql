-- Configurações persistentes da tela /legado/carradas/progresso.
-- Idempotente. Os textos padrão da versão 23/10/2026 são inseridos
-- automaticamente pelo serviço na primeira consulta/uso (ON CONFLICT DO NOTHING).
-- O arquivo serve também para ambientes sem privilégio de CREATE no runtime.
CREATE TABLE IF NOT EXISTS progresso_notificacoes_geral (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(id=1),
  texto_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  audio_ativo BOOLEAN NOT NULL DEFAULT FALSE,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS progresso_notificacoes_fases (
  codigo VARCHAR(65) PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  texto TEXT NOT NULL DEFAULT '',
  texto_ativo BOOLEAN NOT NULL DEFAULT FALSE,
  audio_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  audio_chave TEXT,
  audio_mime VARCHAR(60),
  audio_origem VARCHAR(25),
  audio_voz_id TEXT,
  audio_voz_nome TEXT,
  audio_modelo TEXT,
  audio_texto TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO progresso_notificacoes_geral(id) VALUES (1) ON CONFLICT DO NOTHING;
