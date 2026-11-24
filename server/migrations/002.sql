CREATE TABLE midias (
    hash TEXT PRIMARY KEY NOT NULL,
    webp BLOB NOT NULL
);
ALTER TABLE usuarios ADD COLUMN avatar TEXT REFERENCES midias(hash);
ALTER TABLE usuarios ADD COLUMN banner TEXT REFERENCES midias(hash);
ALTER TABLE usuarios ADD COLUMN bio TEXT NOT NULL DEFAULT '';
ALTER TABLE usuarios ADD COLUMN tema_perfil TEXT NOT NULL DEFAULT 'papel' CHECK (tema_perfil IN ('papel', 'noite', 'lima'));
ALTER TABLE usuarios ADD COLUMN cor TEXT;
CREATE INDEX usuarios_avatar ON usuarios(avatar);
CREATE INDEX usuarios_banner ON usuarios(banner);
