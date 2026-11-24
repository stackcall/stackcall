# Stackcall

App de voz e transmissão de tela para um grupo de amigos. Cliente desktop em Tauri 2, mídia pelo LiveKit num servidor próprio.

- Salas de voz, transmissão de tela de 720p30 a 4K60 conforme a placa de vídeo, som do jogo junto e chat.
- Quem transmite codifica na própria GPU (NVENC, AMF ou Quick Sync); o servidor só repassa.
- Contas com cadastro por convite por padrão.

O plano e as fases do projeto estão em [docs/PLANO.md](docs/PLANO.md). As referências ficam em [docs/pesquisa/](docs/pesquisa/).

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `app/` | Cliente Tauri 2: interface React + Vite + TypeScript + Tailwind, voz e assistir pelo `livekit-client` |
| `core/` | Núcleo Rust "Go Live": captura WGC, codificação na GPU pelo FFmpeg, som do jogo por process loopback, publicação pré-codificada no LiveKit |
| `sonda/` | Processo separado que testa os codificadores da placa e devolve JSON |
| `server/` | Porteiro em Rust com Axum e SQLite. Gerencia contas, grupos e tokens do LiveKit |
| `infra/` | Compose, LiveKit, Caddy e instaladores de self-host |
| `spikes/` | Provas técnicas isoladas |
| `scripts/` | Versionamento, geração de changelog e medição de latência |
| `releases-repo/` | README sincronizado com a página pública de downloads |

## Rodar localmente

### App

Quando `app/` estiver na sua branch, use Windows com Node.js 24, Rust estável, Visual Studio Build Tools com C++ e WebView2.

```powershell
cd app
npm ci
npm run tauri dev
```

### Porteiro

Na raiz, configure o par de chaves do seu LiveKit e sua URL pública no ambiente da sessão. Para um LiveKit rodando na mesma máquina, use `ws://localhost:7880` como URL.

```powershell
$env:LIVEKIT_API_KEY = '<chave do LiveKit local>'
$env:LIVEKIT_API_SECRET = '<segredo do LiveKit local>'
$env:LIVEKIT_PUBLIC_URL = 'ws://localhost:7880'
cargo run -p porteiro
```

O porteiro escuta em `127.0.0.1:8100` por padrão, grava em `stackcall.sqlite3` e registra o convite inicial na primeira execução. Configure `PORTEIRO_DB` para guardar o banco em outro diretório. Para subir a infraestrutura junto, consulte o [guia de infraestrutura](infra/README.md).

## Hospedar seu próprio servidor

O instalador sobe LiveKit, porteiro e Caddy com Docker Compose v2.24.4 ou mais recente. O porteiro guarda contas, grupos e imagens num volume SQLite. Guarde esse volume e o arquivo de configuração privado ao atualizar a instalação.

### Linux com acesso pela internet

Confira [o script](infra/instalar.sh) antes de executá-lo. Quando o repositório estiver público, instale com:

```sh
curl -fsSL https://raw.githubusercontent.com/stackcall/stackcall/main/infra/instalar.sh | bash
```

Com acesso ao checkout, rode `bash infra/instalar.sh`. O script pede o domínio. Se você deixar em branco, usa o IPv4 público com `sslip.io`. Aponte o domínio próprio para o servidor e libere 443/tcp, 7881/tcp, 7882/udp e 3478/udp. O Caddy obtém o certificado em 443/tcp. O Linux precisa de OpenSSL. O comando remoto também precisa de Git.

### Rede local

Use `bash infra/instalar.sh --local` no Linux ou `.\infra\instalar.ps1` no Windows com Docker Desktop rodando contêineres Linux. O instalador tenta detectar o IPv4 da rede. Para escolher outro endereço, passe `--ip 192.168.1.20` no Linux ou `-Ip 192.168.1.20` no Windows. O modo local usa HTTP e login por nome e senha. Libere 8100/tcp, 7881/tcp e 7882/udp para os demais computadores na LAN.

Abra o link do primeiro admin que o script mostra depois de subir. Ele vale por 30 dias e dá acesso ao grupo Galera. O padrão é permitir cadastro por convite. A configuração fica em `~/.config/stackcall/.env` no Linux (ou em `$XDG_CONFIG_HOME/stackcall/.env`) e em `%LOCALAPPDATA%\Stackcall\Servidor\.env` no Windows. Para mudar a política, edite `MODO_CADASTRO` para `aberto`, `convite` ou `fechado` e rode o instalador novamente. Consulte o [guia de infraestrutura](infra/README.md) para operar e fazer backup.

## Soltar uma versão

1. Na branch da versão, rode os comandos abaixo na raiz. Use git-cliff 2.14.2 para atualizar o histórico que fica no repositório.

   ```sh
   node scripts/versao.mjs X.Y.Z
   git-cliff --offline --use-branch-tags --tag vX.Y.Z --output CHANGELOG.md
   git add app/src-tauri/tauri.conf.json app/src-tauri/Cargo.toml app/package.json CHANGELOG.md
   git commit -m "chore: bump version to X.Y.Z"
   ```

2. Abra o PR da versão. Se quiser escrever as notas à mão, inclua `docs/release-notes/vX.Y.Z.md` no PR.
3. Depois do merge, atualize sua `main`, marque o commit da versão e envie as tags.

   ```sh
   git switch main
   git pull --ff-only
   git tag vX.Y.Z
   git push --tags
   ```

O Actions confere as versões, gera as notas e o histórico, compila o instalador NSIS no Windows e assina o pacote para o updater. A release fica em rascunho até o instalador, o manifesto e o changelog estarem anexados. Tags como `v0.2.0-teste.1` saem como pré-release. Para testar a compilação sem publicar, execute o workflow **Release** manualmente com a versão já gravada no app, sem o prefixo `v`. O instalador e a assinatura ficam nos artefatos da execução.

Os instaladores e o histórico público ficam em [Stackcall Releases](https://github.com/stackcall/releases/releases). O updater consulta [o manifesto da versão estável](https://github.com/stackcall/releases/releases/latest/download/latest.json).

## Licença

Código privado por enquanto, todos os direitos reservados. A abertura com licença livre está prevista para depois (ver decisão D3 no plano).
