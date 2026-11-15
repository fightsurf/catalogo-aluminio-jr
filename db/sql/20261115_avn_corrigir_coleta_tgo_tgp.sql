-- Correção pontual autorizada: a coleta de TGO e TGP foi em 31/08/2026.
-- Proteções por usuário, registro, exame, valor e data incorreta; idempotente nos próximos boots.
UPDATE public.avn_exames_resultados AS r
SET data_coleta = DATE '2026-08-31',
    atualizado_em = NOW()
FROM public.avn_exames_catalogo AS c
WHERE c.id = r.exame_id
  AND r.usuario_id = 1
  AND r.data_coleta = DATE '2031-08-31'
  AND (
    (r.id = 2 AND c.codigo = 'tgo' AND r.valor = 25 AND r.unidade = 'U/L')
    OR
    (r.id = 3 AND c.codigo = 'tgp' AND r.valor = 29 AND r.unidade = 'U/L')
  );
