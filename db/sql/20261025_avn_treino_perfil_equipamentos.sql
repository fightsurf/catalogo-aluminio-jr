-- AVN: perfil de treino e inventário da academia. Reexecutável, sem DROP.
CREATE TABLE IF NOT EXISTS public.avn_treino_perfil (
 usuario_id BIGINT PRIMARY KEY REFERENCES public.avn_usuario(id) ON DELETE CASCADE,
 nivel VARCHAR(20) NOT NULL DEFAULT 'nao_informado' CHECK(nivel IN ('nao_informado','iniciante','intermediario','avancado')),
 anos_experiencia NUMERIC(5,1) CHECK(anos_experiencia IS NULL OR (anos_experiencia >= 0 AND anos_experiencia <= 80)),
 regularidade VARCHAR(20) NOT NULL DEFAULT 'nao_informada' CHECK(regularidade IN ('nao_informada','regular','retornando','irregular')),
 dias_semana SMALLINT CHECK(dias_semana BETWEEN 1 AND 7),
 duracao_min SMALLINT CHECK(duracao_min BETWEEN 15 AND 240),
 objetivo VARCHAR(40) NOT NULL DEFAULT 'nao_informado' CHECK(objetivo IN ('nao_informado','recomposicao','hipertrofia','forca','condicionamento')),
 limitacoes TEXT NOT NULL DEFAULT '',
 preferencias TEXT NOT NULL DEFAULT '',
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.avn_equipamentos (
 id BIGSERIAL PRIMARY KEY,
 slug VARCHAR(110) NOT NULL UNIQUE,
 nome VARCHAR(150) NOT NULL,
 categoria VARCHAR(50) NOT NULL,
 padrao BOOLEAN NOT NULL DEFAULT TRUE,
 ativo BOOLEAN NOT NULL DEFAULT TRUE,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.avn_usuario_equipamentos (
 usuario_id BIGINT NOT NULL REFERENCES public.avn_usuario(id) ON DELETE CASCADE,
 equipamento_id BIGINT NOT NULL REFERENCES public.avn_equipamentos(id) ON DELETE CASCADE,
 PRIMARY KEY(usuario_id,equipamento_id)
);
CREATE INDEX IF NOT EXISTS avn_usuario_equipamento_idx ON public.avn_usuario_equipamentos(equipamento_id);
CREATE TABLE IF NOT EXISTS public.avn_exercicio_requisitos (
 exercicio_id BIGINT PRIMARY KEY REFERENCES public.avn_exercicios(id) ON DELETE CASCADE,
 modo VARCHAR(15) NOT NULL CHECK(modo IN ('livre','equipamentos','pendente')),
 atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.avn_exercicio_equipamentos (
 exercicio_id BIGINT NOT NULL REFERENCES public.avn_exercicios(id) ON DELETE CASCADE,
 equipamento_id BIGINT NOT NULL REFERENCES public.avn_equipamentos(id) ON DELETE CASCADE,
 PRIMARY KEY(exercicio_id,equipamento_id)
);
CREATE INDEX IF NOT EXISTS avn_exercicio_equipamentos_equip ON public.avn_exercicio_equipamentos(equipamento_id);
-- Lista inicial curada de nomes usuais de academia. Nenhuma base externa redistribuída.
INSERT INTO public.avn_equipamentos(slug,nome,categoria) VALUES
('halteres','Halteres','Pesos livres'),('barra-olimpica','Barra de musculação','Pesos livres'),('anilhas','Anilhas','Pesos livres'),
('kettlebell','Kettlebell','Pesos livres'),('barra-w','Barra W','Pesos livres'),('barra-h','Barra H','Pesos livres'),
('banco-reto','Banco reto','Bancos e suportes'),('banco-regulavel','Banco ajustável/inclinado','Bancos e suportes'),
('banco-scott','Banco Scott','Bancos e suportes'),('rack-agachamento','Rack de agachamento','Bancos e suportes'),
('suporte-agachamento','Suporte para agachamento','Bancos e suportes'),('barra-fixa','Barra fixa','Bancos e suportes'),
('estacao-paralelas','Estação de paralelas','Bancos e suportes'),('banco-lombar','Banco para lombar','Bancos e suportes'),
('step','Step/caixa','Bancos e suportes'),('parede','Parede livre','Bancos e suportes'),('cadeira','Cadeira comum','Bancos e suportes'),
('maquina-supino','Máquina de supino','Peito e ombros'),('supino-inclinado-maquina','Supino inclinado máquina','Peito e ombros'),
('peck-deck','Peck deck/voador','Peito e ombros'),('crucifixo-inverso','Máquina crucifixo inverso','Peito e ombros'),
('desenvolvimento-maquina','Máquina desenvolvimento de ombros','Peito e ombros'),
('elevacao-lateral-maquina','Elevação lateral máquina','Peito e ombros'),
('polia-ajustavel','Polia ajustável','Cabos e polias'),('crossover','Crossover','Cabos e polias'),
('puxada-alta','Máquina de puxada alta','Costas'),('remada-baixa','Máquina de remada baixa','Costas'),
('remada-articulada','Máquina de remada articulada','Costas'),('remada-cavalinho','Máquina de remada cavalinho','Costas'),
('barra-assistida','Barra fixa assistida','Costas'),
('leg-press-45','Leg press 45°','Pernas'),('leg-press-horizontal','Leg press horizontal','Pernas'),
('hack-squat','Hack squat','Pernas'),('smith','Máquina Smith','Pernas'),
('cadeira-extensora','Cadeira extensora','Pernas'),('mesa-flexora','Mesa flexora','Pernas'),
('cadeira-flexora','Cadeira flexora','Pernas'),('cadeira-adutora','Cadeira adutora','Pernas'),
('cadeira-abdutora','Cadeira abdutora','Pernas'),('maquina-gluteos','Máquina de glúteos','Pernas'),
('maquina-elevacao-pelvica','Máquina de elevação pélvica','Pernas'),('panturrilha-em-pe','Máquina panturrilha em pé','Pernas'),
('panturrilha-sentado','Máquina panturrilha sentado','Pernas'),('cinto-agachamento','Máquina belt squat','Pernas'),
('rosca-scott-maquina','Máquina rosca Scott','Braços'),('triceps-maquina','Máquina tríceps','Braços'),
('paralela-assistida','Máquina de paralelas assistida','Braços'),
('abdominal-maquina','Máquina abdominal','Abdômen'),('ab-wheel','Roda abdominal (ab wheel)','Abdômen'),
('banco-abdominal','Banco abdominal','Abdômen'),('bola-suica','Bola suíça','Abdômen'),
('esteira','Esteira','Cardio'),('bicicleta-ergometrica','Bicicleta ergométrica','Cardio'),
('eliptico','Elíptico','Cardio'),('remo-ergometro','Remo ergométrico','Cardio'),
('escada-ergometrica','Simulador de escadas','Cardio'),('corda-pular','Corda de pular','Cardio'),
('faixa-elastica','Faixa elástica','Acessórios'),('mini-band','Mini band','Acessórios'),
('colchonete','Colchonete','Acessórios'),('toalha','Toalha','Acessórios'),
('porta','Batente/porta','Acessórios'),('faixa-suspensao','Fita de suspensão/TRX','Acessórios'),
('tornozeleira','Tornozeleira','Acessórios'),('caneleira','Caneleira','Acessórios')
ON CONFLICT(slug) DO NOTHING;
