# Pesquisa: releases de apps Tauri 2 (Stackcall)

Data da pesquisa: 2026-11-24. Leitura somente em GitHub (API pública e raw.githubusercontent.com). Nada foi clonado nem instalado.

## Método e limites

- Workflows lidos em `.github/workflows` de cada repositório, na branch padrão.
- Versões de actions conferidas na API do GitHub (`releases/latest` e `tags`) nesta data.
- `action.yml` do tauri-action v0 e v1 lidos na íntegra. Inputs citados são os dos arquivos lidos.
- Não confirmado: `tauri.conf.json` do Cap, do Yaak e do GitButler (caminho não encontrado). O workflow do Cap referencia `apps/desktop-gpui`, o que sugere migração para GPUI: não confirmei se o app desktop ainda é Tauri.
- Pake não entra como app: é uma ferramenta que gera apps Tauri a partir de sites.

## Achado principal

- No tauri-action **v1** o input se chama `uploadUpdaterJson`. `includeUpdaterJson` existe só no **v0**. Quem usa `includeUpdaterJson` com `@v1` ignora o input em silêncio (confirmado no `action.yml` do v1).
- No v1 `owner` e `repo` existem e permitem publicar em outro repositório. A autenticação é pelo `GITHUB_TOKEN` do ambiente, então um PAT vai ali.
- Nenhum dos repositórios lidos tem `cliff.toml`, configuração de release-please ou `.changeset` na raiz. Changelog deles é manual ou feito pelo GitHub.

## 1. Workflows de release

| App | Arquivo | Gatilho | Action | Windows | Cache | Secrets de assinatura |
|---|---|---|---|---|---|---|
| Clash Verge Rev | `.github/workflows/release.yml` | tag (`push: tags`) | `tauri-apps/tauri-action@v1.0.0` | NSIS, x64 e arm64, `windows-latest` | `Swatinem/rust-cache@v2` | `TAURI_PRIVATE_KEY`, `TAURI_KEY_PASSWORD`, Apple |
| Yaak | `.github/workflows/release-app.yml` | tag `v*` e `workflow_dispatch` | `tauri-apps/tauri-action@v0` | args com config de release, arm64 | `Swatinem/rust-cache@v2` | `TAURI_SIGNING_PRIVATE_KEY`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` (Azure Trusted Signing) |
| Jan | `.github/workflows/jan-tauri-build.yaml` + `template-tauri-build-windows-x64.yml` | tag `v[0-9]+.[0-9]+.[0-9]+` | build próprio via template reutilizável; publica com `softprops/action-gh-release@v2.6.2` | NSIS e MSI (MSI só se o build numérico couber) | ccache e cache próprio | `TAURI_SIGNING_PRIVATE_KEY`, `AZURE_CERT_NAME` |
| Pot | `.github/workflows/package.yml` | `change-version` e builds | `pnpm tauri build -b nsis,updater` (sem tauri-action), `softprops/action-gh-release@v1` | NSIS, 3 alvos | não verificado | Apple |
| Spacedrive | `.github/workflows/release.yml` | tag e `workflow_dispatch` (dry run) | `tauri-apps/tauri-action@v0` com `projectPath: apps/tauri` | não confirmado | `setup-rust` local | `TAURI_PRIVATE_KEY`, Apple |
| Hoppscotch | `.github/workflows/build-hoppscotch-desktop.yml` | `workflow_dispatch` | `pnpm tauri build -b appimage -b updater`, sem tauri-action | assina com `signCommand` via jq | não verificado | `TAURI_PRIVATE_KEY` |
| GitButler | `.github/workflows/publish.yaml` | cron diário e `workflow_dispatch` | sem tauri-action; sobe para S3 | sim | `Swatinem/rust-cache` pinado por SHA | `TAURI_PRIVATE_KEY` |
| Cap | `.github/workflows/desktop-release.yml` + `publish.yml` | `workflow_dispatch` | `crabnebula-dev/cloud-release@v0` e `softprops/action-gh-release@v2` | assinatura via SignPath | `.github/actions/setup-rust-cache` | `SIGNPATH_*` |

Pontos de cada caso:

- **Clash Verge Rev**: publica em duas etapas. Cria release em rascunho (`releaseDraft: true`, `releaseCommitish`) e atualiza depois com `gh api`. Usa `uploadUpdaterJson` só no canal estável. Build Windows com `tauriScript: pnpm` e renomeia o NSIS para `_fixed_webview2`.
- **Yaak**: `tauriScript: "node ../../node_modules/@tauri-apps/cli/tauri.js"`, `retryAttempts: 3`, `tagName: "v__VERSION__"`.
- **Jan**: publica o `latest.json` com `WINDOWS_SIGNATURE` lido do output do job. Gera `generate_release_notes: true` no GitHub.
- **Spacedrive**: `tauri-apps/tauri-action@v0` com `args: --target ... --bundles ...`. Binários do daemon não são assinados, documentado no README.
- **GitButler**: S3 com `shallwefootball/s3-upload-action`, sem GitHub Releases.
- **Hoppscotch**: `actions-rs/toolchain@v1` e `apple-actions/import-codesign-certs@v3`. Atualizador aponta para `releases.hoppscotch.com` (domínio próprio).
- **Cap**: `generate_release_notes: true` do GitHub. Publica no CrabNebula.

## 2. Configuração do updater (tauri.conf.json)

| App | Endpoints | `installMode` | Observação |
|---|---|---|---|
| Clash Verge Rev (`src-tauri/tauri.conf.json`) | `update-proxy.json` e `update.json` na release fixa de tag `updater`, com espelhos (gh-proxy, hwdns) | `passive` | Não usa `latest`; a release `updater` guarda o JSON |
| Jan (`src-tauri/tauri.conf.json`) | `https://apps.jan.ai/update-check` e `https://github.com/janhq/jan/releases/latest/download/latest.json` | `passive` | Endpoint próprio como primeiro |
| Spacedrive (`apps/tauri/src-tauri/tauri.conf.json`) | `https://github.com/spacedriveapp/spacedrive/releases/latest/download/latest.json` | não definido | Padrão recomendado |
| Pot (`src-tauri/tauri.conf.json`) | `dl.pot-app.com` (espelho) e `releases/download/updater/update.json` | não definido | `dialog: false` |
| Hoppscotch (`packages/hoppscotch-desktop/src-tauri/tauri.conf.json`) | `https://releases.hoppscotch.com/hoppscotch-selfhost-desktop.json` | não definido | `dialog: true` |

Formato do bloco com `plugins.updater` (Tauri v2): o campo `plugins` confirma a v2 nos cinco arquivos lidos.

## 3. Changelog e versionamento

- Nenhum dos repositórios usa git-cliff, release-please ou changesets na raiz.
- Jan e Cap usam `generate_release_notes` do GitHub (`softprops/action-gh-release` e `crabnebula-dev/cloud-release`).
- Clash mantém `Changelog.md` na raiz e um job "Prepare version and changelog PR" no workflow de release.
- Pot mantém `CHANGELOG` (sem extensão) na raiz.
- Hoppscotch mantém `CHANGELOG.md` na raiz.
- Não verifiquei em cada app o script que altera `package.json`, `Cargo.toml` e `tauri.conf.json`. Recomendo um script próprio no Stackcall (ver seção 5).

## 4. README: link de download

- Pot: `https://github.com/pot-app/pot-desktop/releases/latest` apontando para o `.exe`.
- Pake: link direto `https://github.com/tw93/Pake/releases/latest/download/<arquivo>`.
- Clash: link para `https://github.com/clash-verge-rev/clash-verge-rev/releases`.
- Jan: links para `https://app.jan.ai/download/latest/win-x64` (redirecionamento próprio).
- Cap e Yaak: links para o site (`cap.so/download` e `yaak.app/download`).
- SmartScreen: Spacedrive avisa que os binários não são assinados com Developer ID e explica o bypass no macOS. Jan e Yaak assinam no Windows. Clash e Pot não exibiram aviso de SmartScreen no README lido.
- Badges: nenhum dos READMEs lidos usou badge de versão além do de downloads do Pake (`img.shields.io/github/downloads`).

## 5. Repositório público separado de releases

- Nenhum dos oito repositórios lidos publica binários e `latest.json` em um repositório público separado com PAT.
- Padrões encontrados: o mesmo repositório com tag fixa (Clash `updater`, Pot `updater`); domínio próprio (Jan, Hoppscotch); CDN do fornecedor (Cap, CrabNebula); S3 (GitButler).
- Para o Stackcall, o padrão proposto é o de `owner`/`repo` do tauri-action v1, com PAT de granularidade fina (fine-grained) com permissão `Contents: read and write` somente em `stackcall/releases`. Nome do secret: `RELEASES_TOKEN`.
- Cuidados do cross-repo:
  - O repositório `stackcall/releases` precisa de ao menos um commit na branch usada em `releaseCommitish` (ex.: `main`). Sem isso a criação da tag falha.
  - O repositório precisa ser público para o download anônimo do `latest.json` e dos instaladores.
  - O token do GitHub Actions do repositório privado não serve para escrever no `releases`. Use o PAT.

## 6. Recomendação para o Stackcall

### 6.1 `.github/workflows/release.yml`

```yaml
name: Release

on:
  push:
    tags: ["v*"]

permissions:
  contents: read

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0   # git-cliff precisa do histórico e das tags

      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Gerar notas da versão
        run: |
          cargo install git-cliff --locked --version 2.14.2
          git-cliff --latest --strip header --config cliff.toml --output RELEASE_NOTES.md
        shell: bash

      - name: Build, assinatura e rascunho no repositório público
        uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.RELEASES_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tauriScript: pnpm
          args: --bundles nsis
          owner: stackcall
          repo: releases
          releaseCommitish: main
          tagName: ${{ github.ref_name }}
          releaseName: Stackcall ${{ github.ref_name }}
          releaseBody: Notas em preparação.
          releaseDraft: true
          prerelease: false
          uploadUpdaterJson: true
          updaterJsonPreferNsis: true

      - name: Publicar notas e liberar a release
        env:
          GH_TOKEN: ${{ secrets.RELEASES_TOKEN }}
        run: gh release edit "$GITHUB_REF_NAME" --repo stackcall/releases --notes-file RELEASE_NOTES.md --draft=false
        shell: bash
```

Notas:

- O git-cliff é instalado com `cargo install ... --version 2.14.2`. A alternativa é `orhun/git-cliff-action@v4` (v4.9.1 confirmada), que tem input `config` e `args`. O `action.yml` lido não confirmou input de caminho de saída; por isso o binário é chamado direto.
- O release fica em rascunho até as notas entrarem. O endpoint `releases/latest` ignora rascunhos, então o updater só enxerga a versão depois do `--draft=false`.
- Se preferir publicar as notas via tauri-action, `releaseBody` aceita texto, não caminho de arquivo.

### 6.2 `cliff.toml`

```toml
[changelog]
header = "# Changelog\n\n"
body = """
{% if version %}\
## {{ version | trim_start_matches(pat="v") }} ({{ timestamp | date(format="%d/%m/%Y") }})
{% else %}\
## Não lançado
{% endif %}\
{% for group, commits in commits | group_by(attribute="group") %}
### {{ group }}
{% for commit in commits %}
- {{ commit.message | upper_first }}\
{% endfor %}
{% endfor %}
"""
trim = true

[git]
conventional_commits = true
filter_unconventional = true
split_commits = false
protect_breaking_commits = false
filter_commits = false
tag_pattern = "v[0-9].*"
sort_commits = "newest"
commit_parsers = [
  { message = "^feat", group = "Novidades" },
  { message = "^(perf|improve)", group = "Melhorias" },
  { message = "^fix", group = "Correções" },
  { message = "^(ui|style|refactor)", group = "Ajustes" },
  { message = "^(chore|ci|docs|test)", skip = true },
  { message = ".*", group = "Outras mudanças" },
]
```

- A ordem das seções segue a ordem de `commit_parsers`. Se a versão instalada agrupar fora de ordem, confira com `git-cliff --unreleased`. Como alternativa, prefixe os nomes com número.
- `filter_unconventional = true` descarta commits que não seguem Conventional Commits. Se quiser vê-los, troque para `false`.
- O grupo "Outras mudanças" é um coringa que eu acrescentei. Remova a linha se só quiser as quatro categorias pedidas.

### 6.3 `src-tauri/tauri.conf.json` (trechos)

```json
{
  "bundle": {
    "active": true,
    "createUpdaterArtifacts": true,
    "targets": ["nsis"],
    "windows": {
      "nsis": { "installMode": "currentUser" }
    }
  },
  "plugins": {
    "updater": {
      "pubkey": "CONTEÚDO_DE_stackcall.key.pub_EM_UMA_LINHA",
      "endpoints": [
        "https://github.com/stackcall/releases/releases/latest/download/latest.json"
      ],
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

- `createUpdaterArtifacts` e `bundle.windows.nsis.installMode` não foram lidos em nenhum dos cinco arquivos. Confirme no schema do Tauri 2 antes de usar. O installMode `passive` é o de Clash e Jan.
- Gerar as chaves: `pnpm tauri signer generate -w ~/.tauri/stackcall.key`. A chave privada vai ao secret `TAURI_SIGNING_PRIVATE_KEY` e a senha ao `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. A pública vai ao `pubkey`.
- Sem code signing do Windows, o SmartScreen avisa na instalação. O updater baseado em assinatura do Tauri funciona mesmo assim.

### 6.4 Secrets a criar no repositório privado

| Secret | Uso |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | assinar `latest.json` e os instaladores (Tauri) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | senha da chave |
| `RELEASES_TOKEN` | PAT de granularidade fina, `Contents: read and write`, só em `stackcall/releases` |

Nome e valor de cada secret ficam só no GitHub; não os coloque em arquivos do repositório.

### 6.5 Trecho para o README (Português)

```markdown
## Baixar o Stackcall

Para Windows, baixe o instalador da versão mais recente:

**[Baixar Stackcall para Windows](https://github.com/stackcall/releases/releases/latest/download/Stackcall_x64-setup.exe)**

1. Abra o arquivo `Stackcall_x64-setup.exe` que baixou.
2. Se aparecer a tela azul "O Windows protegeu o seu PC", clique em **Mais informações** e depois em **Executar assim mesmo**. Isso acontece porque o programa ainda não tem certificado de assinatura. É seguro.
3. Siga o instalador. Não precisa de conta nem de senha.

Depois de instalado, o Stackcall avisa quando há uma versão nova e atualiza sozinho.

Todas as versões e notas de mudança ficam em [github.com/stackcall/releases](https://github.com/stackcall/releases/releases).
```

- O nome do arquivo (`Stackcall_x64-setup.exe`) depende do `productName` e do `version`. Confira o nome real no primeiro release e ajuste o link.
- O link `latest/download/<nome>` funciona só com repositório público e release publicada (não rascunho).

## 7. Checklist antes do primeiro release

1. Criar `stackcall/releases` público, com README e um commit na `main`.
2. Criar o PAT fine-grained e gravar em `RELEASES_TOKEN`.
3. Gerar o par de chaves do updater e gravar os dois secrets `TAURI_SIGNING_*`.
4. Colocar `cliff.toml` na raiz e `release.yml` em `.github/workflows`.
5. Conferir `createUpdaterArtifacts` e `installMode` no schema do Tauri 2.
6. Subir uma tag de teste (ex.: `v0.0.1-teste`) e conferir: rascunho no `releases`, `latest.json`, instalador NSIS e as notas. Depois excluir a release de teste.
7. Confirmar que o `latest.json` referencia a URL correta do `.exe` e que o `signature` não está vazio.

## 8. Versões de actions conferidas (2026-11-24)

| Action | Versão confirmada | Fonte |
|---|---|---|
| `tauri-apps/tauri-action` | `v1` (tag `v1.0.0`); v0 atual `v0.6.2` | API `tags` e `releases/latest` |
| `orhun/git-cliff-action` | `v4.9.1` | API `releases/latest` |
| `orhun/git-cliff` (binário) | `v2.14.2` | API `releases/latest` |
| `actions/checkout` | `v7.0.1` | API `releases/latest` |
| `actions/setup-node` | `v7.1.0` | API `releases/latest` |
| `pnpm/action-setup` | `v6.1.1` | API `releases/latest` |
| `Swatinem/rust-cache` | `v2.9.3` (usar `@v2`) | API `releases/latest` |
| `softprops/action-gh-release` | `v3.0.4` (Jan usa `v2.6.2`) | API `releases/latest` |
| `dtolnay/rust-toolchain` | tag `v1`; usar `@stable` | API `tags` |

Links de referência:

- Workflow de Clash: https://github.com/clash-verge-rev/clash-verge-rev/blob/main/.github/workflows/release.yml
- Workflow de Yaak: https://github.com/mountain-loop/yaak/blob/main/.github/workflows/release-app.yml
- Workflow de Jan: https://github.com/janhq/jan/blob/main/.github/workflows/jan-tauri-build.yaml
- Workflow de Spacedrive: https://github.com/spacedriveapp/spacedrive/blob/main/.github/workflows/release.yml
- Workflow de Pot: https://github.com/pot-app/pot-desktop/blob/master/.github/workflows/package.yml
- Workflow de Cap: https://github.com/CapSoftware/Cap/blob/main/.github/workflows/desktop-release.yml
- Workflow de Hoppscotch: https://github.com/hoppscotch/hoppscotch/blob/main/.github/workflows/build-hoppscotch-desktop.yml
- Workflow de GitButler: https://github.com/gitbutlerapp/gitbutler/blob/master/.github/workflows/publish.yaml
- tauri-action v1 (`action.yml`): https://github.com/tauri-apps/tauri-action/blob/v1/action.yml
- tauri-action v0 (`action.yml`): https://github.com/tauri-apps/tauri-action/blob/v0/action.yml
