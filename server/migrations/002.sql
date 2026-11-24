CREATE TABLE steam_fluxos (
    estado_hash BLOB PRIMARY KEY NOT NULL,
    desafio TEXT NOT NULL,
    codigo_hash BLOB,
    expira_em INTEGER NOT NULL
);
CREATE INDEX steam_fluxos_expira_em ON steam_fluxos(expira_em);
CREATE TABLE steam_trocas (
    token_hash BLOB PRIMARY KEY NOT NULL,
    usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    desafio TEXT NOT NULL,
    expira_em INTEGER NOT NULL
);
CREATE INDEX steam_trocas_expira_em ON steam_trocas(expira_em);
