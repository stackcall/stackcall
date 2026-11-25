DROP TABLE chamados_destinos;
DROP TABLE chamados;

ALTER TABLE usuarios ADD COLUMN receber_cutucadas TEXT NOT NULL DEFAULT 'todos'
    CHECK (receber_cutucadas IN ('todos', 'amigos', 'ninguem'));

CREATE TABLE cutucadas (
    id TEXT PRIMARY KEY NOT NULL,
    remetente_id TEXT NOT NULL REFERENCES usuarios(id),
    destinatario_id TEXT NOT NULL REFERENCES usuarios(id),
    recado TEXT NOT NULL,
    criado_em REAL NOT NULL,
    entregue INTEGER NOT NULL DEFAULT 0 CHECK (entregue IN (0, 1))
);
CREATE INDEX cutucadas_envio ON cutucadas(remetente_id, criado_em);
CREATE INDEX cutucadas_pendentes ON cutucadas(destinatario_id, criado_em) WHERE entregue = 0;
