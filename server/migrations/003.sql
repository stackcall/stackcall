CREATE TABLE midias (
    hash TEXT PRIMARY KEY NOT NULL,
    webp BLOB NOT NULL
);
ALTER TABLE usuarios ADD COLUMN avatar_hash TEXT REFERENCES midias(hash);
ALTER TABLE usuarios ADD COLUMN banner_hash TEXT REFERENCES midias(hash);
ALTER TABLE usuarios ADD COLUMN bio TEXT NOT NULL DEFAULT '';
ALTER TABLE usuarios ADD COLUMN tema TEXT NOT NULL DEFAULT 'papel' CHECK (tema IN ('papel', 'noite', 'lima'));
ALTER TABLE usuarios ADD COLUMN cor_destaque TEXT;
CREATE INDEX usuarios_avatar ON usuarios(avatar_hash);
CREATE INDEX usuarios_banner ON usuarios(banner_hash);
