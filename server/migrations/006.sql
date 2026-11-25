CREATE TABLE sons (
    id TEXT PRIMARY KEY NOT NULL,
    nome TEXT NOT NULL,
    emoji TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('audio/ogg', 'audio/mpeg')),
    duracao_ms INTEGER NOT NULL CHECK (duracao_ms BETWEEN 1 AND 5000),
    arquivo BLOB NOT NULL CHECK (length(arquivo) BETWEEN 1 AND 300000)
);
