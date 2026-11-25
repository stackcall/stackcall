CREATE TABLE chamados (
    id TEXT PRIMARY KEY NOT NULL,
    autor_id TEXT NOT NULL REFERENCES usuarios(id),
    sala_id TEXT NOT NULL,
    sala_pai_id TEXT NOT NULL,
    mensagem TEXT,
    criado_em REAL NOT NULL
);
CREATE INDEX chamados_autor_data ON chamados(autor_id, criado_em);
CREATE TABLE chamados_destinos (
    chamado_id TEXT NOT NULL REFERENCES chamados(id) ON DELETE CASCADE,
    usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, chamado_id)
);
CREATE INDEX chamados_destinos_chamado ON chamados_destinos(chamado_id);
