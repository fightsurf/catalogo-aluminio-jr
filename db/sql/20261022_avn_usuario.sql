-- Executado automaticamente na inicialização do backend Render (idempotente).
CREATE TABLE IF NOT EXISTS public.avn_usuario (
 id BIGSERIAL PRIMARY KEY,
 nome VARCHAR(150) NOT NULL,
 data_nascimento DATE NOT NULL,
 sexo_referencia_calculo VARCHAR(20) NOT NULL CHECK (sexo_referencia_calculo IN ('masculino','feminino','nao_informado')),
 altura_cm NUMERIC(5,2) NOT NULL CHECK (altura_cm >= 50 AND altura_cm <= 250),
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_avn_usuario_nome ON public.avn_usuario (LOWER(nome));
