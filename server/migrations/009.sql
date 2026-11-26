CREATE TABLE boras (
    id TEXT PRIMARY KEY NOT NULL,
    autor_id TEXT NOT NULL REFERENCES usuarios(id),
    sala_id TEXT REFERENCES salas(id) ON DELETE SET NULL,
    recado TEXT NOT NULL DEFAULT '',
    criado_em INTEGER NOT NULL,
    expira_em INTEGER NOT NULL
);
CREATE INDEX boras_autor ON boras(autor_id, criado_em);
CREATE INDEX boras_ativos ON boras(expira_em);

CREATE TABLE bora_respostas (
    bora_id TEXT NOT NULL REFERENCES boras(id) ON DELETE CASCADE,
    usuario_id TEXT NOT NULL REFERENCES usuarios(id),
    resposta TEXT NOT NULL CHECK (resposta IN ('dentro', '10min', 'nao')),
    em INTEGER NOT NULL,
    PRIMARY KEY (bora_id, usuario_id)
);

CREATE TABLE push_inscricoes (
    id TEXT PRIMARY KEY NOT NULL,
    usuario_id TEXT NOT NULL REFERENCES usuarios(id),
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    criado_em INTEGER NOT NULL
);
CREATE INDEX push_inscricoes_usuario ON push_inscricoes(usuario_id);
