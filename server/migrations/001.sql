CREATE TABLE usuarios (
    id TEXT PRIMARY KEY NOT NULL,
    nome TEXT NOT NULL,
    papel TEXT NOT NULL CHECK (papel IN ('dono', 'admin', 'membro')),
    criado_em INTEGER NOT NULL,
    removido_em INTEGER
);
CREATE UNIQUE INDEX usuarios_dono ON usuarios(papel) WHERE papel = 'dono';
CREATE TABLE sessoes (
    id TEXT PRIMARY KEY NOT NULL,
    usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    token_hash BLOB NOT NULL UNIQUE,
    nome_aparelho TEXT NOT NULL,
    criado_em INTEGER NOT NULL,
    ultimo_uso INTEGER NOT NULL
);
CREATE INDEX sessoes_usuarios ON sessoes(usuario_id);
CREATE TABLE convites (
    id TEXT PRIMARY KEY NOT NULL,
    criado_por TEXT REFERENCES usuarios(id),
    codigo_hash BLOB NOT NULL UNIQUE,
    expira_em INTEGER NOT NULL,
    usos_max INTEGER NOT NULL CHECK (usos_max > 0),
    usos INTEGER NOT NULL DEFAULT 0 CHECK (usos BETWEEN 0 AND usos_max),
    revogado INTEGER NOT NULL DEFAULT 0 CHECK (revogado IN (0, 1)),
    inicial INTEGER NOT NULL DEFAULT 0 CHECK (inicial IN (0, 1))
);
CREATE UNIQUE INDEX convites_inicial ON convites(inicial) WHERE inicial = 1;
CREATE TABLE logins_aparelho (
    id TEXT PRIMARY KEY NOT NULL,
    usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    codigo_hash BLOB NOT NULL UNIQUE,
    expira_em INTEGER NOT NULL,
    usado INTEGER NOT NULL DEFAULT 0 CHECK (usado IN (0, 1))
);
CREATE INDEX logins_aparelho_usuario ON logins_aparelho(usuario_id);
CREATE INDEX logins_aparelho_expira ON logins_aparelho(expira_em);
CREATE TABLE amizades (
    usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    amigo_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    criado_em INTEGER NOT NULL,
    PRIMARY KEY (usuario_id, amigo_id),
    CHECK (usuario_id <> amigo_id)
);
CREATE INDEX amizades_amigo ON amizades(amigo_id);
CREATE TABLE salas (
    id TEXT PRIMARY KEY NOT NULL,
    nome TEXT NOT NULL,
    ordem INTEGER NOT NULL
);
CREATE TABLE mensagens (
    id TEXT PRIMARY KEY NOT NULL,
    sala_id TEXT NOT NULL REFERENCES salas(id) ON DELETE CASCADE,
    usuario_id TEXT NOT NULL REFERENCES usuarios(id),
    texto TEXT NOT NULL,
    criado_em INTEGER NOT NULL
);
CREATE INDEX mensagens_sala ON mensagens(sala_id, criado_em);
CREATE TABLE config (
    chave TEXT PRIMARY KEY NOT NULL,
    valor TEXT NOT NULL
);
