CREATE TABLE usuarios (
    id TEXT PRIMARY KEY NOT NULL,
    nome_exibicao TEXT NOT NULL,
    nome_login TEXT UNIQUE,
    steam_id TEXT UNIQUE,
    senha_hash TEXT,
    avatar_url TEXT,
    criado_em INTEGER NOT NULL,
    papel_instancia TEXT NOT NULL CHECK (papel_instancia IN ('admin', 'membro')),
    CHECK ((nome_login IS NULL) = (senha_hash IS NULL)),
    CHECK (steam_id IS NOT NULL OR senha_hash IS NOT NULL)
);
CREATE TABLE sessoes (
    id TEXT PRIMARY KEY NOT NULL,
    usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    token_hash BLOB NOT NULL UNIQUE,
    criado_em INTEGER NOT NULL,
    expira_em INTEGER NOT NULL,
    ultimo_uso INTEGER NOT NULL,
    nome_aparelho TEXT
);
CREATE INDEX sessoes_expira_em ON sessoes(expira_em);
CREATE TABLE grupos (
    id TEXT PRIMARY KEY NOT NULL,
    nome TEXT NOT NULL,
    dono_id TEXT REFERENCES usuarios(id),
    criado_em INTEGER NOT NULL
);
CREATE TABLE membros (
    grupo_id TEXT NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
    usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    papel TEXT NOT NULL CHECK (papel IN ('dono', 'admin', 'membro')),
    entrou_em INTEGER NOT NULL,
    PRIMARY KEY (grupo_id, usuario_id)
);
CREATE INDEX membros_usuario ON membros(usuario_id);
CREATE TABLE salas (
    id TEXT PRIMARY KEY NOT NULL,
    grupo_id TEXT NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
    nome TEXT NOT NULL,
    ordem INTEGER NOT NULL
);
CREATE INDEX salas_grupo ON salas(grupo_id, ordem);
CREATE TABLE convites (
    id TEXT PRIMARY KEY NOT NULL,
    grupo_id TEXT NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
    criado_por TEXT REFERENCES usuarios(id),
    codigo_hash BLOB NOT NULL UNIQUE,
    expira_em INTEGER NOT NULL,
    usos_max INTEGER NOT NULL CHECK (usos_max > 0),
    usos INTEGER NOT NULL DEFAULT 0 CHECK (usos BETWEEN 0 AND usos_max),
    revogado INTEGER NOT NULL DEFAULT 0 CHECK (revogado IN (0, 1)),
    inicial INTEGER NOT NULL DEFAULT 0 CHECK (inicial IN (0, 1))
);
CREATE UNIQUE INDEX convite_inicial ON convites(inicial) WHERE inicial = 1;
CREATE TABLE mensagens (
    id TEXT PRIMARY KEY NOT NULL,
    sala_id TEXT NOT NULL REFERENCES salas(id) ON DELETE CASCADE,
    usuario_id TEXT NOT NULL REFERENCES usuarios(id),
    texto TEXT NOT NULL,
    criado_em INTEGER NOT NULL
);
CREATE INDEX mensagens_sala ON mensagens(sala_id, criado_em);
