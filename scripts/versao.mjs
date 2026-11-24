import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const app = new URL('../app/', import.meta.url);
const files = [
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'package.json',
];
const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const cargoPackage = /^[ \t]*\[package\][ \t]*(?:#[^\r\n]*)?\r?\n/m;
const cargoVersion = /^([ \t]*version[ \t]*=[ \t]*)(["'])([^"'\r\n]+)\2([ \t]*(?:#[^\r\n]*)?)$/m;

function validateVersion(value) {
  const match = typeof value === 'string' && versionPattern.exec(value);
  if (!match || match[0] !== value || match[1]?.split('.').some((part) => /^0\d+$/.test(part))) {
    throw new Error(`Versão inválida: ${value}. Use X.Y.Z ou X.Y.Z-teste.1.`);
  }
}

function readManifest(file) {
  const path = new URL(file, app);
  const source = readFileSync(path, 'utf8');

  if (file.endsWith('.toml')) {
    const section = cargoPackage.exec(source);
    const start = section ? section.index + section[0].length : 0;
    const content = source.slice(start).split(/(?=^[ \t]*\[)/m, 1)[0];
    const entry = section && cargoVersion.exec(content);
    if (!entry) throw new Error(`app/${file} precisa de uma versão em [package].`);
    const startVersion = start + entry.index + entry[1].length + 1;

    return {
      path,
      version: entry[3],
      withVersion: (version) => source.slice(0, startVersion) + version +
        source.slice(startVersion + entry[3].length),
    };
  }

  const data = JSON.parse(source);
  return {
    path,
    version: data.version,
    withVersion: (version) => `${JSON.stringify({ ...data, version }, null, 2)}\n`,
  };
}

function main([mode, expected, ...rest]) {
  const check = mode === '--check';
  if (!mode || rest.length || (!check && expected !== undefined)) {
    throw new Error('Use: node scripts/versao.mjs X.Y.Z ou --check [X.Y.Z].');
  }
  const target = check ? expected : mode;
  if (target !== undefined) validateVersion(target);

  if (!existsSync(app) && check && target === undefined) {
    console.warn('app/ ainda não existe. Conferência de versão ignorada.');
    return;
  }

  const manifests = files.map((file) => {
    try {
      const manifest = readManifest(file);
      validateVersion(manifest.version);
      return manifest;
    } catch (error) {
      throw new Error(`app/${file}: ${error.message}`);
    }
  });

  if (check) {
    const version = target ?? manifests[0].version;
    if (manifests.some((manifest) => manifest.version !== version)) {
      const versions = files.map((file, index) => `app/${file}=${manifests[index].version}`);
      throw new Error(`Versão esperada ${version}. Encontrado: ${versions.join(', ')}.`);
    }
    console.log(`Versão conferida: ${version}.`);
    return;
  }

  for (const manifest of manifests) {
    if (manifest.version !== target) {
      writeFileSync(manifest.path, manifest.withVersion(target));
    }
  }
  console.log(`Versão gravada: ${target}.`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
