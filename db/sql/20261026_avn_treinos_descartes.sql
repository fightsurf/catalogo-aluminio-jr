-- Tombstones persistentes: cancelar treino remove séries mesmo que o telefone esteja offline.
-- Apenas UUID/usuário e data são retidos, sem histórico de treino.
CREATE TABLE IF NOT EXISTS public.avn_treino_mobile_descartes (
 execucao_id UUID PRIMARY KEY,
 usuario_id BIGINT NOT NULL REFERENCES public.avn_usuario(id) ON DELETE CASCADE,
 cancelado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS avn_treino_descartes_usuario ON public.avn_treino_mobile_descartes(usuario_id);
