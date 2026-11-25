CREATE TABLE moderacao_log (
    id INTEGER PRIMARY KEY,
    autor_id TEXT NOT NULL REFERENCES usuarios(id),
    acao TEXT NOT NULL,
    sala_id TEXT NOT NULL,
    usuario_id TEXT REFERENCES usuarios(id),
    destino_id TEXT,
    criado_em INTEGER NOT NULL DEFAULT (unixepoch()),
    resultado TEXT NOT NULL DEFAULT 'pendente'
);
CREATE INDEX moderacao_usuario ON moderacao_log(usuario_id, id DESC);
